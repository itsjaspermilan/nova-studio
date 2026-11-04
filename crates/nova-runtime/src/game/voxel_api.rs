//! `nova.voxel`, `nova.noise2`, `nova.noise3` and `nova.hash`: the Lua face of [`crate::voxel`].

use super::*;
use crate::gfx::{DYN_MESH_BASE, MeshOp};
use crate::model::MeshVertex;
use crate::voxel::{self, BlockDef, Carve, Shape};

fn cell(v: f64) -> i32 {
    v.floor() as i32
}

fn opt_bool(opts: &Option<Table>, key: &str) -> mlua::Result<Option<bool>> {
    match opts {
        Some(t) => t.get::<Option<bool>>(key),
        None => Ok(None),
    }
}

fn block_id(sh: &Shared, v: Value) -> mlua::Result<u8> {
    match v {
        Value::Integer(i) => u8::try_from(i).map_err(|_| lua_err(format!("{i} is not a block"))),
        Value::Number(n) => Ok(n as u8),
        Value::String(s) => {
            let name = s.to_str()?.to_string();
            sh.voxel
                .find(&name)
                .ok_or_else(|| lua_err(format!("no block called '{name}'")))
        }
        _ => Err(lua_err("a block is its number or its name")),
    }
}

/// A one-block cube centred on the origin, lit at full sky light, for drawing a block as an item or in a hand.
fn cube_mesh(world: &voxel::World, id: u8) -> (Vec<MeshVertex>, Vec<u32>) {
    let def = &world.defs[id as usize];
    let shade = [0.6f32, 0.6, 1.0, 0.5, 0.8, 0.8];
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
    let corners = [(-1.0f32, -1.0f32), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)];
    let n = world.tiles_per_row.max(1);
    let s = 1.0 / n as f32;
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    for k in 0..6 {
        let base = vertices.len() as u32;
        let tile = def.tiles[k] as u32;
        let (tx, ty) = ((tile % n) as f32, (tile / n) as f32);
        for (s1, s2) in corners {
            let (d, t1, t2) = (dirs[k], axes[k].0, axes[k].1);
            let p = [
                0.5 * (d[0] + t1[0] * s1 + t2[0] * s2),
                0.5 * (d[1] + t1[1] * s1 + t2[1] * s2),
                0.5 * (d[2] + t1[2] * s1 + t2[2] * s2),
            ];
            let l = [p[0] + 0.5, p[1] + 0.5, p[2] + 0.5];
            let (u, v) = match k {
                0 => (1.0 - l[2], 1.0 - l[1]),
                1 => (l[2], 1.0 - l[1]),
                2 => (l[0], l[2]),
                3 => (l[0], 1.0 - l[2]),
                4 => (l[0], 1.0 - l[1]),
                _ => (1.0 - l[0], 1.0 - l[1]),
            };
            let g = (shade[k] * 255.0) as u8;
            vertices.push(MeshVertex {
                position: p,
                normal: [1.0, 0.0, 0.0],
                color: [g, g, g, 255],
                uv: [(tx + u) * s, (ty + v) * s],
                emissive: -1.0,
            });
        }
        indices.extend([0, 1, 2, 0, 2, 3].map(|i| base + i));
    }
    (vertices, indices)
}

pub(super) const LINE_MESH: &str = "__line";

/// A one-by-one strip lying across x and y, seen from both sides and shown at full colour whatever the light.
pub(super) fn line_mesh() -> crate::model::MeshData {
    let corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    let mut vertices = Vec::new();
    for side in [1.0f32, -1.0] {
        for c in corners {
            vertices.push(MeshVertex {
                position: [c[0], c[1], 0.0],
                normal: [0.0, 0.0, side],
                color: [255; 4],
                uv: [0.5, 0.5],
                emissive: 1.0,
            });
        }
    }
    crate::model::MeshData {
        vertices,
        indices: vec![0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6],
        texture: None,
        notes: Vec::new(),
    }
}

/// A line from a to b, `width` metres across, always turned to face the camera.
fn push_line(sh: &mut Shared, a: Vec3, b: Vec3, width: f32, tint: [f32; 4]) {
    let Some(&mesh) = sh.mesh_ids.get(LINE_MESH) else {
        return;
    };
    let dir = b - a;
    if dir.length() < 1e-6 {
        return;
    }
    let mid = (a + b) * 0.5;
    let view = (sh.camera.eye - mid).normalize_or_zero();
    let side = dir.cross(view).normalize_or_zero() * width;
    let normal = dir.cross(side).normalize_or_zero();
    let matrix = Mat4::from_cols(
        dir.extend(0.0),
        side.extend(0.0),
        normal.extend(0.0),
        mid.extend(1.0),
    );
    sh.models.push(ModelDraw {
        casts: false,
        mesh,
        instance: ModelInstance {
            matrix: matrix.to_cols_array_2d(),
            tint,
        },
    });
}

pub(super) fn install(
    lua: &Lua,
    shared: &Rc<RefCell<Shared>>,
    vfs: &Rc<dyn Vfs>,
    nova: &Table,
) -> mlua::Result<()> {
    // a stopwatch that runs in real time (nova.time is game time): for spending a fixed share of a frame on work
    let started = std::time::Instant::now();
    nova.set(
        "clock",
        lua.create_function(move |_, ()| Ok(started.elapsed().as_secs_f64()))?,
    )?;
    // noise for terrain: smooth, repeatable, about -1 to 1
    nova.set(
        "noise2",
        lua.create_function(
            |_, (x, z, seed, octaves, gain): (f64, f64, Option<u32>, Option<u32>, Option<f64>)| {
                Ok(voxel::fbm3(
                    x,
                    0.5,
                    z,
                    seed.unwrap_or(0),
                    octaves.unwrap_or(1),
                    gain.unwrap_or(0.5),
                ))
            },
        )?,
    )?;
    nova.set(
        "noise3",
        lua.create_function(
            |_,
             (x, y, z, seed, octaves, gain): (
                f64,
                f64,
                f64,
                Option<u32>,
                Option<u32>,
                Option<f64>,
            )| {
                Ok(voxel::fbm3(
                    x,
                    y,
                    z,
                    seed.unwrap_or(0),
                    octaves.unwrap_or(1),
                    gain.unwrap_or(0.5),
                ))
            },
        )?,
    )?;
    nova.set(
        "hash",
        lua.create_function(|_, (x, y, z, seed): (f64, f64, f64, Option<u32>)| {
            Ok(voxel::hash01(cell(x), cell(y), cell(z), seed.unwrap_or(0)))
        })?,
    )?;

    let s = shared.clone();
    nova.set(
        "line3",
        lua.create_function(
            move |_, (x1, y1, z1, x2, y2, z2, opts): (f64, f64, f64, f64, f64, f64, Option<Table>)| {
                let width = number_option(&opts, "width")?.unwrap_or(0.02) as f32;
                let tint = color_option(&opts, "color", [255; 4])?.map(|c| c as f32 / 255.0);
                push_line(
                    &mut s.borrow_mut(),
                    Vec3::new(x1 as f32, y1 as f32, z1 as f32),
                    Vec3::new(x2 as f32, y2 as f32, z2 as f32),
                    width,
                    tint,
                );
                Ok(())
            },
        )?,
    )?;
    let s = shared.clone();
    nova.set(
        "box3",
        lua.create_function(
            move |_, (x1, y1, z1, x2, y2, z2, opts): (f64, f64, f64, f64, f64, f64, Option<Table>)| {
                let width = number_option(&opts, "width")?.unwrap_or(0.02) as f32;
                let tint = color_option(&opts, "color", [255; 4])?.map(|c| c as f32 / 255.0);
                let (lo, hi) = (
                    Vec3::new(x1.min(x2) as f32, y1.min(y2) as f32, z1.min(z2) as f32),
                    Vec3::new(x1.max(x2) as f32, y1.max(y2) as f32, z1.max(z2) as f32),
                );
                let p = |i: usize| Vec3::new(if i & 1 == 0 { lo.x } else { hi.x }, if i & 2 == 0 { lo.y } else { hi.y }, if i & 4 == 0 { lo.z } else { hi.z });
                let mut sh = s.borrow_mut();
                // the twelve edges: corners that differ in exactly one of the three bits
                for i in 0..8usize {
                    for bit in [1usize, 2, 4] {
                        if i & bit == 0 {
                            push_line(&mut sh, p(i), p(i | bit), width, tint);
                        }
                    }
                }
                Ok(())
            },
        )?,
    )?;

    let v = lua.create_table()?;

    let s = shared.clone();
    let atlas_vfs = vfs.clone();
    v.set(
        "atlas",
        lua.create_function(move |_, (path, per_row): (String, u32)| {
            if per_row == 0 || per_row > 64 {
                return Err(lua_err("tiles per row must be 1 to 64"));
            }
            let bytes = atlas_vfs
                .read(&path)
                .map_err(|e| lua_err(format!("cannot read the block atlas '{path}': {e}")))?;
            let image = assets::decode_png(&bytes)
                .map_err(|e| lua_err(format!("block atlas '{path}': {e}")))?;
            let mut sh = s.borrow_mut();
            sh.voxel.tiles_per_row = per_row;
            sh.voxel.ops.push(MeshOp::SetAtlas(image));
            Ok(())
        })?,
    )?;

    let s = shared.clone();
    v.set(
        "block",
        lua.create_function(move |_, (name, opts): (String, Option<Table>)| {
            let mut def = BlockDef {
                name: name.clone(),
                ..Default::default()
            };
            let shape = string_option(&opts, "shape")?.unwrap_or_else(|| "cube".into());
            def.shape = match shape.as_str() {
                "cube" => Shape::Cube,
                "cross" => Shape::Cross,
                "torch" => Shape::Torch,
                other => {
                    return Err(lua_err(format!(
                        "block '{name}': shape must be cube, cross or torch, not '{other}'"
                    )));
                }
            };
            let all = number_option(&opts, "tile")?;
            let side = number_option(&opts, "side")?.or(all);
            let top = number_option(&opts, "top")?.or(side);
            let bottom = number_option(&opts, "bottom")?.or(side);
            def.tiles = [side, side, top, bottom, side, side].map(|t| t.unwrap_or(0.0) as u16);
            if let Some(Some(list)) = opts
                .as_ref()
                .map(|o| o.get::<Option<Table>>("tiles"))
                .transpose()?
            {
                for k in 0..6 {
                    if let Some(t) = list.get::<Option<f64>>(k + 1)? {
                        def.tiles[k] = t as u16;
                    }
                }
            }
            def.liquid = opt_bool(&opts, "liquid")?.unwrap_or(false);
            def.alpha = number_option(&opts, "alpha")?.map_or(255, |a| a.clamp(0.0, 255.0) as u8);
            def.solid =
                opt_bool(&opts, "solid")?.unwrap_or(def.shape == Shape::Cube && !def.liquid);
            def.opaque = opt_bool(&opts, "opaque")?.unwrap_or(def.solid && def.alpha == 255);
            def.glow = number_option(&opts, "glow")?.map_or(0, |g| g.clamp(0.0, 15.0) as u8);
            def.dim = number_option(&opts, "dim")?.map_or(0, |g| g.clamp(0.0, 15.0) as u8);
            def.cull_same = opt_bool(&opts, "cull_same")?.unwrap_or(def.liquid);
            s.borrow_mut().voxel.define(def).map_err(lua_err)
        })?,
    )?;

    let s = shared.clone();
    v.set(
        "id",
        lua.create_function(move |_, name: String| Ok(s.borrow().voxel.find(&name)))?,
    )?;
    let s = shared.clone();
    v.set(
        "info",
        lua.create_function(move |lua, id: Value| {
            let sh = s.borrow();
            let id = block_id(&sh, id)?;
            let d = &sh.voxel.defs[id as usize];
            let t = lua.create_table()?;
            t.set("name", d.name.clone())?;
            t.set("solid", d.solid)?;
            t.set("opaque", d.opaque)?;
            t.set("liquid", d.liquid)?;
            t.set("glow", d.glow)?;
            t.set("tile", d.tiles[2])?;
            t.set("side_tile", d.tiles[0])?;
            Ok(t)
        })?,
    )?;

    let s = shared.clone();
    v.set(
        "get",
        lua.create_function(move |_, (x, y, z): (f64, f64, f64)| {
            Ok(s.borrow().voxel.get(cell(x), cell(y), cell(z)))
        })?,
    )?;
    let s = shared.clone();
    v.set(
        "set",
        lua.create_function(move |_, (x, y, z, id): (f64, f64, f64, Value)| {
            let mut sh = s.borrow_mut();
            let id = block_id(&sh, id)?;
            Ok(sh.voxel.set_raw(cell(x), cell(y), cell(z), id))
        })?,
    )?;
    let s = shared.clone();
    v.set(
        "edit",
        lua.create_function(move |_, (x, y, z, id): (f64, f64, f64, Value)| {
            let mut sh = s.borrow_mut();
            let id = block_id(&sh, id)?;
            Ok(sh.voxel.edit(cell(x), cell(y), cell(z), id))
        })?,
    )?;
    let s = shared.clone();
    v.set(
        "fill",
        lua.create_function(
            move |_, (x0, y0, z0, x1, y1, z1, id): (f64, f64, f64, f64, f64, f64, Value)| {
                let mut sh = s.borrow_mut();
                let id = block_id(&sh, id)?;
                Ok(sh.voxel.fill(
                    [cell(x0), cell(y0), cell(z0)],
                    [cell(x1), cell(y1), cell(z1)],
                    id,
                ))
            },
        )?,
    )?;
    let s = shared.clone();
    v.set(
        "carve",
        lua.create_function(
            move |_, (x0, y0, z0, x1, y1, z1, opts): (f64, f64, f64, f64, f64, f64, Table)| {
                let mut sh = s.borrow_mut();
                let mut ids = [false; 256];
                let list: Table = opts.get("through").map_err(|_| {
                    lua_err("carve needs `through = { block, ... }`: what it may dig out")
                })?;
                for item in list.sequence_values::<Value>() {
                    let id = block_id(&sh, item?)?;
                    ids[id as usize] = true;
                }
                let scale = opts.get::<Option<f64>>("scale")?.unwrap_or(0.05);
                let c = Carve {
                    seed: opts.get::<Option<u32>>("seed")?.unwrap_or(0),
                    scale: [
                        scale,
                        scale * opts.get::<Option<f64>>("squash")?.unwrap_or(1.0),
                        scale,
                    ],
                    threshold: opts.get::<Option<f64>>("threshold")?.unwrap_or(0.1),
                    tunnels: opts.get::<Option<String>>("kind")?.as_deref() != Some("cavern"),
                    ids,
                };
                Ok(sh.voxel.carve(
                    [cell(x0), cell(y0), cell(z0)],
                    [cell(x1), cell(y1), cell(z1)],
                    &c,
                ))
            },
        )?,
    )?;

    // chunks
    let s = shared.clone();
    v.set(
        "create_chunk",
        lua.create_function(move |_, (cx, cz): (i32, i32)| {
            s.borrow_mut().voxel.create_chunk(cx, cz);
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    v.set(
        "finish_chunk",
        lua.create_function(move |_, (cx, cz): (i32, i32)| {
            s.borrow_mut().voxel.light_chunk(cx, cz);
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    v.set(
        "has_chunk",
        lua.create_function(move |_, (cx, cz): (i32, i32)| Ok(s.borrow().voxel.has_chunk(cx, cz)))?,
    )?;
    let s = shared.clone();
    v.set(
        "unload_chunk",
        lua.create_function(move |_, (cx, cz): (i32, i32)| {
            s.borrow_mut().voxel.unload_chunk(cx, cz);
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    v.set(
        "export_edits",
        lua.create_function(move |_, (cx, cz): (i32, i32)| {
            Ok(s.borrow().voxel.export_edits(cx, cz))
        })?,
    )?;
    let s = shared.clone();
    v.set(
        "import_edits",
        lua.create_function(move |_, (cx, cz, text): (i32, i32, String)| {
            s.borrow_mut()
                .voxel
                .import_edits(cx, cz, &text)
                .map_err(lua_err)
        })?,
    )?;
    let s = shared.clone();
    v.set(
        "apply_saved",
        lua.create_function(move |_, (cx, cz): (i32, i32)| {
            Ok(s.borrow_mut().voxel.apply_saved(cx, cz))
        })?,
    )?;
    let s = shared.clone();
    v.set(
        "save_world",
        lua.create_function(move |_, name: String| {
            let mut sh = s.borrow_mut();
            let bytes = sh.voxel.encode_world();
            sh.save.write_blob(&name, bytes).map_err(lua_err)
        })?,
    )?;
    let s = shared.clone();
    v.set(
        "load_world",
        lua.create_function(move |_, name: String| {
            let mut sh = s.borrow_mut();
            match sh.save.read_blob(&name).map_err(lua_err)? {
                Some(bytes) => sh.voxel.decode_world(&bytes).map_err(lua_err),
                None => Ok(0),
            }
        })?,
    )?;
    let s = shared.clone();
    v.set(
        "modified_chunks",
        lua.create_function(move |lua, ()| {
            let t = lua.create_table()?;
            for (cx, cz) in s.borrow().voxel.modified_chunks() {
                let pair = lua.create_table()?;
                pair.set(1, cx)?;
                pair.set(2, cz)?;
                t.push(pair)?;
            }
            Ok(t)
        })?,
    )?;

    // queries
    let s = shared.clone();
    v.set(
        "light",
        lua.create_function(move |_, (x, y, z): (f64, f64, f64)| {
            Ok(s.borrow().voxel.light(cell(x), cell(y), cell(z)))
        })?,
    )?;
    let s = shared.clone();
    v.set(
        "top",
        lua.create_function(move |_, (x, z): (f64, f64)| {
            let sh = s.borrow();
            let (x, z) = (cell(x), cell(z));
            for y in (0..voxel::SY as i32).rev() {
                let b = sh.voxel.get(x, y, z);
                if b != 0 && sh.voxel.defs[b as usize].shape == Shape::Cube {
                    return Ok(y);
                }
            }
            Ok(-1)
        })?,
    )?;
    let s = shared.clone();
    v.set(
        "raycast",
        lua.create_function(
            move |_,
                  (ox, oy, oz, dx, dy, dz, max, liquids): (
                f64,
                f64,
                f64,
                f64,
                f64,
                f64,
                f64,
                Option<bool>,
            )| {
                let sh = s.borrow();
                // nothing at all (not nil) when the ray hits nothing, so `if nova.voxel.raycast(...)` reads well
                Ok(
                    match sh.voxel.raycast(
                        [ox, oy, oz],
                        [dx, dy, dz],
                        max,
                        liquids.unwrap_or(false),
                    ) {
                        Some(h) => mlua::MultiValue::from_iter(
                            h.cell
                                .iter()
                                .chain(h.normal.iter())
                                .map(|&n| Value::Integer(n as i64))
                                .chain([Value::Number(h.distance), Value::Integer(h.block as i64)]),
                        ),
                        None => mlua::MultiValue::new(),
                    },
                )
            },
        )?,
    )?;
    let s = shared.clone();
    v.set(
        "move",
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
                let m =
                    s.borrow()
                        .voxel
                        .move_box([x, y, z], hw, h, [dx, dy, dz], step.unwrap_or(0.0));
                Ok((
                    m.pos[0],
                    m.pos[1],
                    m.pos[2],
                    m.hit[0],
                    m.hit[1],
                    m.hit[2],
                    m.on_ground,
                ))
            },
        )?,
    )?;

    // drawing
    let s = shared.clone();
    v.set(
        "daylight",
        lua.create_function(move |_, level: f64| {
            s.borrow_mut().lighting.day = level.clamp(0.0, 1.0) as f32;
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    v.set(
        "draw",
        lua.create_function(move |_, opts: Option<Table>| {
            let mut sh = s.borrow_mut();
            let distance = number_option(&opts, "distance")?.unwrap_or(6.0) as f32;
            let budget = number_option(&opts, "budget")?.unwrap_or(2.0).max(0.0) as usize;
            let cam = sh.camera;
            let aspect = (sh.view[0] / sh.view[1].max(1.0)).max(0.1);
            let view_proj = glam::camera::rh::proj::directx::perspective(
                cam.fov_y_degrees.to_radians(),
                aspect,
                0.1,
                400.0,
            ) * glam::camera::rh::view::look_at_mat4(cam.eye, cam.target, Vec3::Y);
            for key in sh
                .voxel
                .dirty_chunks([cam.eye.x, cam.eye.z])
                .into_iter()
                .take(budget)
            {
                sh.voxel.mesh_chunk(key.0, key.1);
            }
            let list = sh.voxel.visible(cam.eye.to_array(), distance, &view_proj);
            for (mesh, _) in list {
                sh.models.push(ModelDraw {
                    casts: false,
                    mesh,
                    instance: ModelInstance {
                        matrix: Mat4::IDENTITY.to_cols_array_2d(),
                        tint: [1.0; 4],
                    },
                });
            }
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    v.set(
        "cube",
        lua.create_function(
            move |_, (id, x, y, z, opts): (Value, f64, f64, f64, Option<Table>)| {
                let mut sh = s.borrow_mut();
                let id = block_id(&sh, id)?;
                if id == 0 {
                    return Ok(());
                }
                let mesh = match sh.cubes.get(&id) {
                    Some(m) => *m,
                    None => {
                        let (vertices, indices) = cube_mesh(&sh.voxel, id);
                        let mesh = DYN_MESH_BASE + (1 << 28) + id as usize;
                        sh.voxel.ops.push(MeshOp::Upload {
                            id: mesh,
                            vertices,
                            indices,
                        });
                        sh.cubes.insert(id, mesh);
                        mesh
                    }
                };
                let scale = number_option(&opts, "scale")?.unwrap_or(1.0) as f32;
                let matrix = Mat4::from_translation(Vec3::new(x as f32, y as f32, z as f32))
                    * Mat4::from_rotation_y(number_option(&opts, "ry")?.unwrap_or(0.0) as f32)
                    * Mat4::from_rotation_x(number_option(&opts, "rx")?.unwrap_or(0.0) as f32)
                    * Mat4::from_rotation_z(number_option(&opts, "rz")?.unwrap_or(0.0) as f32)
                    * Mat4::from_scale(Vec3::splat(scale));
                let tint = color_option(&opts, "tint", [255; 4])?.map(|c| c as f32 / 255.0);
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
    let s = shared.clone();
    v.set(
        "stats",
        lua.create_function(move |lua, ()| {
            let sh = s.borrow();
            let w = &sh.voxel;
            let t = lua.create_table()?;
            t.set("chunks", w.chunks.len())?;
            t.set("meshed", w.stats.meshed)?;
            t.set("mesh_ms", w.stats.mesh_ms as f64)?;
            t.set("light_ms", w.stats.light_ms as f64)?;
            t.set("faces", w.stats.faces)?;
            t.set("drawn", w.stats.drawn)?;
            let dirty = w.chunks.values().filter(|c| c.dirty).count();
            t.set("dirty", dirty)?;
            Ok(t)
        })?,
    )?;

    nova.set("voxel", v)?;
    Ok(())
}
