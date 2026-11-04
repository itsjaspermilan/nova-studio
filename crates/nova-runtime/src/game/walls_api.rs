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
                let tint = tint_of(&opts)?;
                // a see-through colour is drawn blended; a solid one as before
                let kind = if tint[3] < 0.999 {
                    voxel_api::SOFT_MESH
                } else {
                    voxel_api::LINE_MESH
                };
                let Some(&mesh) = sh.mesh_ids.get(kind) else {
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
    // ---- standing on things: floors, steps, ramps, platforms that move ----
    let s = shared.clone();
    walls.set(
        "add_ramp",
        lua.create_function(
            move |_,
                  (x0, z0, x1, z1, axis, y_start, y_end, y_base): (
                f64,
                f64,
                f64,
                f64,
                String,
                f64,
                f64,
                Option<f64>,
            )| {
                let axis = match axis.as_str() {
                    "x" => 0u8,
                    "z" => 1u8,
                    other => {
                        return Err(lua_err(format!(
                            "a ramp slopes along 'x' or 'z', not '{other}'"
                        )));
                    }
                };
                let base = y_base.unwrap_or(y_start.min(y_end));
                Ok(s.borrow_mut().walls.add_ramp(
                    x0 as f32,
                    z0 as f32,
                    x1 as f32,
                    z1 as f32,
                    axis,
                    y_start as f32,
                    y_end as f32,
                    base as f32,
                ))
            },
        )?,
    )?;
    let s = shared.clone();
    walls.set(
        "set_box",
        lua.create_function(
            move |_,
                  (id, x0, z0, x1, z1, y0, y1): (
                u32,
                f64,
                f64,
                f64,
                f64,
                Option<f64>,
                Option<f64>,
            )| {
                let mut sh = s.borrow_mut();
                let Some(w) = sh.walls.get(id).copied() else {
                    return Err(lua_err(format!("there is no wall {id}")));
                };
                sh.walls.set_box(
                    id,
                    x0 as f32,
                    z0 as f32,
                    x1 as f32,
                    z1 as f32,
                    y0.map_or(w.y0, |v| v as f32),
                    y1.map_or(w.y1, |v| v as f32),
                );
                Ok(())
            },
        )?,
    )?;
    let s = shared.clone();
    walls.set(
        "move3",
        lua.create_function(
            move |_,
                  (x, y, z, hw, h, dx, dy, dz, step): (
                f64,
                f64,
                f64,
                f64,
                f64,
                f64,
                f64,
                f64,
                Option<f64>,
            )| {
                let mut sh = s.borrow_mut();
                sh.walls.prepare();
                let m = sh.walls.move3(
                    [x as f32, y as f32, z as f32],
                    hw as f32,
                    h as f32,
                    [dx as f32, dy as f32, dz as f32],
                    step.unwrap_or(0.5) as f32,
                );
                let (kind, id) = match m.ground {
                    Some(crate::walls::Support::Wall(i)) => (Value::Nil, Value::Integer(i as i64)),
                    Some(crate::walls::Support::Ramp(i)) => {
                        (Value::Nil, Value::Integer(-(i as i64) - 1))
                    }
                    None => (Value::Nil, Value::Nil),
                };
                let _ = kind;
                Ok(mlua::MultiValue::from_iter([
                    Value::Number(m.pos[0] as f64),
                    Value::Number(m.pos[1] as f64),
                    Value::Number(m.pos[2] as f64),
                    Value::Boolean(m.hit[0]),
                    Value::Boolean(m.hit[1]),
                    Value::Boolean(m.hit[2]),
                    Value::Boolean(m.on_ground),
                    id,
                ]))
            },
        )?,
    )?;
    let s = shared.clone();
    walls.set(
        "floor_below",
        lua.create_function(move |_, (x, y, z, r): (f64, f64, f64, Option<f64>)| {
            let mut sh = s.borrow_mut();
            sh.walls.prepare();
            Ok(
                match sh
                    .walls
                    .floor_below(x as f32, y as f32, z as f32, r.unwrap_or(0.1) as f32)
                {
                    Some((h, support)) => {
                        let id = match support {
                            crate::walls::Support::Wall(i) => i as i64,
                            crate::walls::Support::Ramp(i) => -(i as i64) - 1,
                        };
                        mlua::MultiValue::from_iter([Value::Number(h as f64), Value::Integer(id)])
                    }
                    None => mlua::MultiValue::new(),
                },
            )
        })?,
    )?;
    nova.set("walls", walls)?;

    // ---- baked light ----
    let bake = lua.create_table()?;
    let s = shared.clone();
    bake.set(
        "level",
        lua.create_function(move |_, opts: Table| {
            let rgb = |t: &Table, key: &str, default: [f32; 3]| -> mlua::Result<[f32; 3]> {
                Ok(match t.get::<Option<Table>>(key)? {
                    Some(c) => [
                        c.get::<Option<f32>>(1)?.unwrap_or(255.0) / 255.0,
                        c.get::<Option<f32>>(2)?.unwrap_or(255.0) / 255.0,
                        c.get::<Option<f32>>(3)?.unwrap_or(255.0) / 255.0,
                    ],
                    None => default,
                })
            };
            let mut boxes = Vec::new();
            let list: Table = opts.get("boxes").map_err(|_| lua_err("nova.bake.level needs boxes = { { x0, y0, z0, x1, y1, z1, color = {r, g, b} }, ... }"))?;
            for item in list.sequence_values::<Table>() {
                let b = item?;
                let n = |k: &str| -> mlua::Result<f32> {
                    b.get::<Option<f32>>(k)?.ok_or_else(|| lua_err(format!("a box needs {k}")))
                };
                let (x0, y0, z0, x1, y1, z1) = (n("x0")?, n("y0")?, n("z0")?, n("x1")?, n("y1")?, n("z1")?);
                boxes.push(crate::bake::BoxSpec {
                    min: [x0.min(x1), y0.min(y1), z0.min(z1)],
                    max: [x0.max(x1), y0.max(y1), z0.max(z1)],
                    color: rgb(&b, "color", [0.7; 3])?,
                });
            }
            let mut lights = Vec::new();
            if let Some(list) = opts.get::<Option<Table>>("lights")? {
                for item in list.sequence_values::<Table>() {
                    let l = item?;
                    let n = |k: &str| -> mlua::Result<f32> {
                        l.get::<Option<f32>>(k)?.ok_or_else(|| lua_err(format!("a light needs {k}")))
                    };
                    lights.push(crate::bake::LightSpec {
                        pos: [n("x")?, n("y")?, n("z")?],
                        radius: l.get::<Option<f32>>("radius")?.unwrap_or(12.0),
                        color: rgb(&l, "color", [1.0; 3])?,
                        power: l.get::<Option<f32>>("power")?.unwrap_or(1.0),
                    });
                }
            }
            let options = crate::bake::BakeOptions {
                cell: opts.get::<Option<f32>>("cell")?.unwrap_or(1.0),
                occlusion: opts.get::<Option<f32>>("occlusion")?.unwrap_or(0.5).clamp(0.0, 1.0),
                skip_down_at_or_below: opts.get::<Option<f32>>("skip_down_at_or_below")?.unwrap_or(f32::NEG_INFINITY),
                skip_up_at_or_above: opts.get::<Option<f32>>("skip_up_at_or_above")?.unwrap_or(f32::INFINITY),
            };
            let started = std::time::Instant::now();
            let mut sh = s.borrow_mut();
            sh.walls.prepare();
            let mesh = crate::bake::bake(&boxes, &lights, &sh.walls, &options);
            let count = mesh.vertices.len();
            let handle = sh.baked.len();
            let id = crate::gfx::DYN_MESH_BASE + (1 << 27) + handle;
            sh.voxel.ops.push(crate::gfx::MeshOp::Upload { id, vertices: mesh.vertices, indices: mesh.indices, plain: true });
            sh.baked.push(Some(id));
            let ms = started.elapsed().as_secs_f64() * 1000.0;
            Ok((handle, count, ms))
        })?,
    )?;
    let s = shared.clone();
    bake.set(
        "draw",
        lua.create_function(move |_, handle: usize| {
            let mut sh = s.borrow_mut();
            let Some(Some(mesh)) = sh.baked.get(handle).copied() else {
                return Ok(());
            };
            sh.models.push(ModelDraw {
                casts: false,
                mesh,
                instance: ModelInstance {
                    matrix: Mat4::IDENTITY.to_cols_array_2d(),
                    tint: [1.0; 4],
                },
            });
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    bake.set(
        "free",
        lua.create_function(move |_, handle: usize| {
            let mut sh = s.borrow_mut();
            if let Some(slot) = sh.baked.get_mut(handle)
                && let Some(id) = slot.take()
            {
                sh.voxel.ops.push(crate::gfx::MeshOp::Free(id));
            }
            Ok(())
        })?,
    )?;
    nova.set("bake", bake)?;

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
