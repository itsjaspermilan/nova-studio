//! `nova.walls`, `nova.nav`, `nova.cuboid`, `nova.cuboid_at` and `nova.quad3`: indoor 3D from boxes (see [`crate::walls`]).

use super::*;
use crate::model::MeshData;
use crate::walls::{Nav, Walls};

pub(super) const CUBE_MESH: &str = "__cube";
pub(super) const CUBE_GLOW_MESH: &str = "__cube_glow";

/// A one-by-one-by-one cube centred on the origin, white, lit by the scene (or shown at full colour when `glow`).
pub(super) fn cube_mesh(glow: bool) -> MeshData {
    let dirs: [[f32; 3]; 6] = [
        [1., 0., 0.],
        [-1., 0., 0.],
        [0., 1., 0.],
        [0., -1., 0.],
        [0., 0., 1.],
        [0., 0., -1.],
    ];
    let axes: [([f32; 3], [f32; 3]); 6] = [
        ([0., 1., 0.], [0., 0., 1.]),
        ([0., 0., 1.], [0., 1., 0.]),
        ([0., 0., 1.], [1., 0., 0.]),
        ([1., 0., 0.], [0., 0., 1.]),
        ([1., 0., 0.], [0., 1., 0.]),
        ([0., 1., 0.], [1., 0., 0.]),
    ];
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    for k in 0..6 {
        let base = vertices.len() as u32;
        for (s1, s2) in [(-1.0f32, -1.0f32), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
            let (d, t1, t2) = (dirs[k], axes[k].0, axes[k].1);
            vertices.push(crate::model::MeshVertex {
                position: [
                    0.5 * (d[0] + t1[0] * s1 + t2[0] * s2),
                    0.5 * (d[1] + t1[1] * s1 + t2[1] * s2),
                    0.5 * (d[2] + t1[2] * s1 + t2[2] * s2),
                ],
                normal: d,
                color: [255; 4],
                uv: [0.5, 0.5],
                emissive: if glow { 1.0 } else { 0.0 },
            });
        }
        indices.extend([0, 1, 2, 0, 2, 3].map(|i| base + i));
    }
    MeshData {
        vertices,
        indices,
        texture: None,
        notes: Vec::new(),
    }
}

fn tint_of(opts: &Option<Table>) -> mlua::Result<[f32; 4]> {
    Ok(color_option(opts, "color", [255; 4])?.map(|c| c as f32 / 255.0))
}

fn push_cube(sh: &mut Shared, matrix: Mat4, tint: [f32; 4], glow: bool) {
    let key = if glow { CUBE_GLOW_MESH } else { CUBE_MESH };
    let Some(&mesh) = sh.mesh_ids.get(key) else {
        return;
    };
    sh.models.push(ModelDraw {
        casts: true,
        mesh,
        instance: ModelInstance {
            matrix: matrix.to_cols_array_2d(),
            tint,
        },
    });
}

pub(super) fn install(lua: &Lua, shared: &Rc<RefCell<Shared>>, nova: &Table) -> mlua::Result<()> {
    // ---- drawing boxes ----
    let s = shared.clone();
    nova.set(
        "cuboid",
        lua.create_function(move |_, (x0, y0, z0, x1, y1, z1, opts): (f64, f64, f64, f64, f64, f64, Option<Table>)| {
            let (lo, hi) = (
                Vec3::new(x0.min(x1) as f32, y0.min(y1) as f32, z0.min(z1) as f32),
                Vec3::new(x0.max(x1) as f32, y0.max(y1) as f32, z0.max(z1) as f32),
            );
            let matrix = Mat4::from_translation((lo + hi) * 0.5) * Mat4::from_scale(hi - lo);
            let glow = match &opts {
                Some(o) => o.get::<Option<bool>>("glow")?.unwrap_or(false),
                None => false,
            };
            push_cube(&mut s.borrow_mut(), matrix, tint_of(&opts)?, glow);
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    nova.set(
        "cuboid_at",
        lua.create_function(
            move |_, (x, y, z, w, h, d, opts): (f64, f64, f64, f64, f64, f64, Option<Table>)| {
                let matrix = Mat4::from_translation(Vec3::new(x as f32, y as f32, z as f32))
                    * Mat4::from_rotation_y(number_option(&opts, "ry")?.unwrap_or(0.0) as f32)
                    * Mat4::from_rotation_x(number_option(&opts, "rx")?.unwrap_or(0.0) as f32)
                    * Mat4::from_rotation_z(number_option(&opts, "rz")?.unwrap_or(0.0) as f32)
                    * Mat4::from_scale(Vec3::new(w as f32, h as f32, d as f32));
                let glow = match &opts {
                    Some(o) => o.get::<Option<bool>>("glow")?.unwrap_or(false),
                    None => false,
                };
                push_cube(&mut s.borrow_mut(), matrix, tint_of(&opts)?, glow);
                Ok(())
            },
        )?,
    )?;
    // a flat square facing a direction, at full colour: a bullet hole, a mark, a sprite in the world
    let s = shared.clone();
    nova.set(
        "quad3",
        lua.create_function(
            move |_,
                  (x, y, z, nx, ny, nz, size, opts): (
                f64,
                f64,
                f64,
                f64,
                f64,
                f64,
                f64,
                Option<Table>,
            )| {
                let mut sh = s.borrow_mut();
                let Some(&mesh) = sh.mesh_ids.get(voxel_api::LINE_MESH) else {
                    return Ok(());
                };
                let normal = Vec3::new(nx as f32, ny as f32, nz as f32).normalize_or_zero();
                if normal == Vec3::ZERO {
                    return Ok(());
                }
                let up = if normal.y.abs() > 0.99 {
                    Vec3::X
                } else {
                    Vec3::Y
                };
                let right = up.cross(normal).normalize();
                let up = normal.cross(right);
                let (w, h) = (
                    number_option(&opts, "w")?.unwrap_or(size) as f32,
                    number_option(&opts, "h")?.unwrap_or(size) as f32,
                );
                // a hair off the surface, so that it does not fight with it
                let at = Vec3::new(x as f32, y as f32, z as f32) + normal * 0.004;
                let matrix = Mat4::from_cols(
                    (right * w).extend(0.0),
                    (up * h).extend(0.0),
                    normal.extend(0.0),
                    at.extend(1.0),
                );
                let tint = tint_of(&opts)?;
                sh.models.push(ModelDraw {
                    casts: false,
                    mesh,
                    instance: ModelInstance {
                        matrix: matrix.to_cols_array_2d(),
                        tint,
                    },
                });
                Ok(())
            },
        )?,
    )?;

    // ---- walls ----
    let walls = lua.create_table()?;
    let s = shared.clone();
    walls.set(
        "add",
        lua.create_function(
            move |_, (x0, z0, x1, z1, y0, y1): (f64, f64, f64, f64, Option<f64>, Option<f64>)| {
                Ok(s.borrow_mut().walls.add(
                    x0 as f32,
                    z0 as f32,
                    x1 as f32,
                    z1 as f32,
                    y0.unwrap_or(0.0) as f32,
                    y1.unwrap_or(100.0) as f32,
                ))
            },
        )?,
    )?;
    let s = shared.clone();
    walls.set(
        "enable",
        lua.create_function(move |_, (id, on): (u32, bool)| {
            s.borrow_mut().walls.set_on(id, on);
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    walls.set(
        "clear",
        lua.create_function(move |_, ()| {
            let mut sh = s.borrow_mut();
            sh.walls.clear();
            sh.nav = Nav::default();
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    walls.set(
        "count",
        lua.create_function(move |_, ()| Ok(s.borrow().walls.len()))?,
    )?;
    let s = shared.clone();
    walls.set(
        "push",
        lua.create_function(
            move |_, (x, z, r, y, h): (f64, f64, f64, Option<f64>, Option<f64>)| {
                let mut sh = s.borrow_mut();
                sh.walls.prepare();
                let (dx, dz) = sh.walls.push(
                    x as f32,
                    z as f32,
                    r as f32,
                    y.unwrap_or(0.0) as f32,
                    h.unwrap_or(1.8) as f32,
                );
                Ok((dx as f64, dz as f64))
            },
        )?,
    )?;
    let s = shared.clone();
    walls.set(
        "move",
        lua.create_function(move |_, (x, z, dx, dz, r, y, h): (f64, f64, f64, f64, f64, Option<f64>, Option<f64>)| {
            let mut sh = s.borrow_mut();
            sh.walls.prepare();
            let (y, h, r) = (y.unwrap_or(0.0) as f32, h.unwrap_or(1.8) as f32, r as f32);
            let (mut px, mut pz) = (x as f32, z as f32);
            // in steps shorter than the body, so that a fast move does not skip through a thin wall
            let steps = (((dx * dx + dz * dz).sqrt() as f32) / (r * 0.5).max(0.05)).ceil().max(1.0) as usize;
            let mut hit = false;
            for _ in 0..steps {
                px += dx as f32 / steps as f32;
                pz += dz as f32 / steps as f32;
                let (ox, oz) = sh.walls.push(px, pz, r, y, h);
                if ox != 0.0 || oz != 0.0 {
                    hit = true;
                }
                px += ox;
                pz += oz;
            }
            Ok((px as f64, pz as f64, hit))
        })?,
    )?;
    let s = shared.clone();
    walls.set(
        "raycast",
        lua.create_function(
            move |_,
                  (x, z, dx, dz, len, y, slope): (
                f64,
                f64,
                f64,
                f64,
                f64,
                Option<f64>,
                Option<f64>,
            )| {
                let mut sh = s.borrow_mut();
                sh.walls.prepare();
                Ok(
                    match sh.walls.raycast(
                        x as f32,
                        z as f32,
                        dx as f32,
                        dz as f32,
                        len as f32,
                        y.unwrap_or(1.5) as f32,
                        slope.unwrap_or(0.0) as f32,
                    ) {
                        Some(h) => mlua::MultiValue::from_iter([
                            Value::Number(h.distance as f64),
                            Value::Number(h.nx as f64),
                            Value::Number(h.nz as f64),
                            Value::Integer(h.id as i64),
                        ]),
                        None => mlua::MultiValue::new(),
                    },
                )
            },
        )?,
    )?;
    let s = shared.clone();
    walls.set(
        "line_clear",
        lua.create_function(
            move |_, (x1, z1, x2, z2, y1, y2): (f64, f64, f64, f64, Option<f64>, Option<f64>)| {
                let mut sh = s.borrow_mut();
                sh.walls.prepare();
                Ok(sh.walls.line_clear(
                    x1 as f32,
                    z1 as f32,
                    x2 as f32,
                    z2 as f32,
                    y1.unwrap_or(1.5) as f32,
                    y2.unwrap_or(1.5) as f32,
                ))
            },
        )?,
    )?;
    nova.set("walls", walls)?;

    // ---- paths ----
    let nav = lua.create_table()?;
    let s = shared.clone();
    nav.set(
        "build",
        lua.create_function(move |_, opts: Table| {
            let get = |k: &str, d: f64| -> mlua::Result<f32> { Ok(opts.get::<Option<f64>>(k)?.unwrap_or(d) as f32) };
            let (x0, z0, x1, z1) = (
                opts.get::<f64>("x0").map_err(|_| lua_err("nova.nav.build needs x0, z0, x1, z1: the part of the ground to cover"))? as f32,
                opts.get::<f64>("z0").map_err(|_| lua_err("nova.nav.build needs x0, z0, x1, z1"))? as f32,
                opts.get::<f64>("x1").map_err(|_| lua_err("nova.nav.build needs x0, z0, x1, z1"))? as f32,
                opts.get::<f64>("z1").map_err(|_| lua_err("nova.nav.build needs x0, z0, x1, z1"))? as f32,
            );
            let (cell, radius, y, h) = (get("cell", 0.5)?, get("radius", 0.4)?, get("y", 0.0)?, get("height", 1.8)?);
            if (x1 - x0) / cell * ((z1 - z0) / cell) > 1.0e6 {
                return Err(lua_err("nova.nav.build: that is more than a million cells; use a bigger `cell` or a smaller area"));
            }
            // walls to leave out of the grid: doors that something can open, so that paths lead through them
            let mut ignore: Vec<u32> = Vec::new();
            if let Some(list) = opts.get::<Option<Table>>("ignore")? {
                for id in list.sequence_values::<u32>() {
                    ignore.push(id?);
                }
            }
            let mut sh = s.borrow_mut();
            sh.walls.prepare();
            let was: Vec<(u32, bool)> = ignore.iter().filter_map(|&id| sh.walls.get(id).map(|w| (id, w.on))).collect();
            for &(id, _) in &was {
                sh.walls.set_on(id, false);
            }
            sh.nav = Nav::build(&sh.walls, x0, z0, x1, z1, cell, radius, y, h);
            for (id, on) in was {
                sh.walls.set_on(id, on);
            }
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    nav.set(
        "path",
        lua.create_function(move |lua, (x1, z1, x2, z2): (f64, f64, f64, f64)| {
            let sh = s.borrow();
            match sh.nav.path((x1 as f32, z1 as f32), (x2 as f32, z2 as f32)) {
                Some(points) => {
                    let list = lua.create_table()?;
                    for (x, z) in points {
                        let p = lua.create_table()?;
                        p.set("x", x as f64)?;
                        p.set("z", z as f64)?;
                        list.push(p)?;
                    }
                    Ok(Value::Table(list))
                }
                None => Ok(Value::Nil),
            }
        })?,
    )?;
    let s = shared.clone();
    nav.set(
        "blocked",
        lua.create_function(move |_, (x, z): (f64, f64)| {
            Ok(s.borrow().nav.is_blocked(x as f32, z as f32))
        })?,
    )?;
    nova.set("nav", nav)?;
    Ok(())
}

#[allow(dead_code)]
fn _walls_type_check(_: &Walls) {}
