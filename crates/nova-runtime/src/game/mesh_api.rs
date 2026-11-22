//! `nova.mesh`: a mesh a script builds from lists of numbers at run time (a road made from a seed, a ground, a ribbon), drawn
//! like a model. `make` takes the points, the triangles and, if it wants them, colours, texture coordinates and normals; `look`
//! borrows the pictures and the surface of a loaded model's mesh (a road's sheet and its grain), so a made mesh can look exactly
//! like one made offline. The renderer lifts it by the hills (`nova.terrain`) as it does any model drawn near the ground.

use super::*;
use crate::gfx::{DYN_MESH_BASE, MeshOp};
use crate::model::{MeshVertex, NO_TEXTURE_UV};

/// Meshes made by `nova.mesh.make` have ids this far above the start of script-made meshes (voxel chunks are below, shape-key
/// copies at 1 << 26, baked levels at 1 << 27, lone cubes at 1 << 28).
const MADE_ID_BASE: usize = DYN_MESH_BASE + (1 << 27) + (1 << 26);
/// At most this many points in one mesh (a road of 10 km at a row every 2 m is about 100,000).
const MAX_POINTS: usize = 2_000_000;

/// An sRGB channel (0 to 255) as a linear byte, the way the model loader keeps vertex colours.
fn linear_byte(v: f64) -> u8 {
    let c = (v / 255.0).clamp(0.0, 1.0);
    let l = if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    };
    (l * 255.0).round() as u8
}

/// A list of numbers from `spec[key]` (None when absent).
fn numbers(spec: &Table, key: &str) -> mlua::Result<Option<Vec<f64>>> {
    let Some(t) = spec.get::<Option<Table>>(key)? else {
        return Ok(None);
    };
    let n = t.raw_len();
    let mut out = Vec::with_capacity(n);
    for i in 1..=n {
        out.push(t.raw_get::<f64>(i).map_err(|_| {
            lua_err(format!(
                "nova.mesh.make: {key}[{i}] is not a number (the list must be numbers only)"
            ))
        })?);
    }
    Ok(Some(out))
}

/// The vertices and indices of a mesh from its spec (see the docs of `nova.mesh.make`). Normals left out are worked out from the
/// triangles (each point gets the sum of the faces round it, weighted by their area).
pub(super) fn build(spec: &Table) -> mlua::Result<(Vec<MeshVertex>, Vec<u32>)> {
    let positions = numbers(spec, "positions")?.ok_or_else(|| {
        lua_err("nova.mesh.make needs positions = { x1, y1, z1, x2, y2, z2, ... }")
    })?;
    if positions.len() % 3 != 0 {
        return Err(lua_err(format!(
            "nova.mesh.make: positions has {} numbers, not a multiple of 3 (x, y, z for each point)",
            positions.len()
        )));
    }
    let count = positions.len() / 3;
    if count > MAX_POINTS {
        return Err(lua_err(format!(
            "nova.mesh.make: {count} points is more than the {MAX_POINTS} one mesh may have"
        )));
    }
    let raw = numbers(spec, "indices")?.ok_or_else(|| {
        lua_err("nova.mesh.make needs indices = { a, b, c, ... } (three point numbers, from 1, for each triangle)")
    })?;
    if raw.len() % 3 != 0 {
        return Err(lua_err(format!(
            "nova.mesh.make: indices has {} numbers, not a multiple of 3",
            raw.len()
        )));
    }
    let mut indices = Vec::with_capacity(raw.len());
    for (k, &v) in raw.iter().enumerate() {
        if v.fract() != 0.0 || v < 1.0 || v > count as f64 {
            return Err(lua_err(format!(
                "nova.mesh.make: indices[{}] is {v}: a point number from 1 to {count}",
                k + 1
            )));
        }
        indices.push(v as u32 - 1);
    }
    let check = |name: &str, list: &Option<Vec<f64>>, per: usize| -> mlua::Result<()> {
        if let Some(l) = list
            && l.len() != count * per
        {
            return Err(lua_err(format!(
                "nova.mesh.make: {name} has {} numbers; {count} points need {}",
                l.len(),
                count * per
            )));
        }
        Ok(())
    };
    let colors = numbers(spec, "colors")?;
    let uvs = numbers(spec, "uvs")?;
    let normals = numbers(spec, "normals")?;
    // colours: four numbers a point (r, g, b, a), or three when `colors_rgb` is true
    let per_color = if spec.get::<Option<bool>>("colors_rgb")?.unwrap_or(false) {
        3
    } else {
        4
    };
    check("colors", &colors, per_color)?;
    check("uvs", &uvs, 2)?;
    check("normals", &normals, 3)?;
    let mut vertices: Vec<MeshVertex> = (0..count)
        .map(|i| {
            let color = match &colors {
                Some(c) => {
                    let at = i * per_color;
                    [
                        linear_byte(c[at]),
                        linear_byte(c[at + 1]),
                        linear_byte(c[at + 2]),
                        if per_color == 4 {
                            c[at + 3].clamp(0.0, 255.0).round() as u8
                        } else {
                            255
                        },
                    ]
                }
                None => [255; 4],
            };
            MeshVertex {
                position: [
                    positions[i * 3] as f32,
                    positions[i * 3 + 1] as f32,
                    positions[i * 3 + 2] as f32,
                ],
                normal: match &normals {
                    Some(n) => [n[i * 3] as f32, n[i * 3 + 1] as f32, n[i * 3 + 2] as f32],
                    None => [0.0; 3],
                },
                color,
                uv: match &uvs {
                    Some(u) => [u[i * 2] as f32, u[i * 2 + 1] as f32],
                    None => NO_TEXTURE_UV,
                },
                emissive: 0.0,
            }
        })
        .collect();
    if normals.is_none() {
        let mut sum = vec![Vec3::ZERO; count];
        for tri in indices.as_chunks::<3>().0 {
            let p = |k: usize| Vec3::from(vertices[tri[k] as usize].position);
            let face = (p(1) - p(0)).cross(p(2) - p(0)); // (its length is twice the area: bigger faces count for more)
            for &k in tri {
                sum[k as usize] += face;
            }
        }
        for (v, n) in vertices.iter_mut().zip(sum) {
            v.normal = n.try_normalize().unwrap_or(Vec3::Y).to_array();
        }
    }
    Ok((vertices, indices))
}

pub(super) fn install(lua: &Lua, shared: &Rc<RefCell<Shared>>, nova: &Table) -> mlua::Result<()> {
    let mesh = lua.create_table()?;
    let s = shared.clone();
    mesh.set(
        "make",
        lua.create_function(move |_, spec: Table| {
            let started = std::time::Instant::now();
            let (vertices, indices) = build(&spec)?;
            let mut sh = s.borrow_mut();
            // `look = "road_pine_ridge"`: the pictures and surface of that model's mesh
            let look = match spec.get::<Option<String>>("look")? {
                Some(name) => {
                    let found = find_model(&sh.known_models, &name).ok_or_else(|| {
                        lua_err(format!(
                            "nova.mesh.make: look = '{name}' is not a model of this project"
                        ))
                    })?;
                    Some(*sh.mesh_ids.get(&found).ok_or_else(|| {
                        lua_err(format!(
                            "nova.mesh.make: model '{found}' is not on the GPU yet (make meshes from enter, update or draw, not while the script loads)"
                        ))
                    })?)
                }
                None => None,
            };
            let handle = sh.made_meshes.len() + 1;
            let id = MADE_ID_BASE + handle;
            let count = vertices.len();
            sh.voxel.ops.push(MeshOp::Styled {
                id,
                look,
                vertices,
                indices,
            });
            sh.made_meshes.push(Some(id));
            Ok((handle, count, started.elapsed().as_secs_f64() * 1000.0))
        })?,
    )?;
    let s = shared.clone();
    mesh.set(
        "draw",
        lua.create_function(move |_, (handle, opts): (usize, Option<Table>)| {
            let mut sh = s.borrow_mut();
            let Some(Some(id)) = handle
                .checked_sub(1)
                .and_then(|h| sh.made_meshes.get(h))
                .copied()
            else {
                return Err(lua_err(format!(
                    "nova.mesh.draw: no mesh {handle} (made by nova.mesh.make, and not freed)"
                )));
            };
            let at = Vec3::new(
                number_option(&opts, "x")?.unwrap_or(0.0) as f32,
                number_option(&opts, "y")?.unwrap_or(0.0) as f32,
                number_option(&opts, "z")?.unwrap_or(0.0) as f32,
            );
            let matrix = Mat4::from_translation(at)
                * Mat4::from_rotation_y(number_option(&opts, "ry")?.unwrap_or(0.0) as f32)
                * Mat4::from_scale(Vec3::splat(
                    number_option(&opts, "scale")?.unwrap_or(1.0) as f32
                ));
            let tint = color_option(&opts, "tint", [255; 4])?.map(|c| c as f32 / 255.0);
            let casts = match &opts {
                Some(o) => o.get::<Option<bool>>("shadow")?.unwrap_or(false),
                None => false,
            };
            sh.models.push(ModelDraw {
                casts,
                mesh: id,
                instance: ModelInstance {
                    matrix: matrix.to_cols_array_2d(),
                    tint,
                },
            });
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    mesh.set(
        "free",
        lua.create_function(move |_, handle: usize| {
            let mut sh = s.borrow_mut();
            if let Some(slot) = handle
                .checked_sub(1)
                .and_then(|h| sh.made_meshes.get_mut(h))
                && let Some(id) = slot.take()
            {
                sh.voxel.ops.push(MeshOp::Free(id));
            }
            Ok(())
        })?,
    )?;
    nova.set("mesh", mesh)?;

    // the wall clock: whole seconds since 1970-01-01 00:00 UTC, as the device's clock has it (for a daily challenge or a date;
    // nova.time and nova.clock are stopwatches)
    nova.set(
        "utc",
        lua.create_function(|_, ()| {
            let secs = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            Ok(secs)
        })?,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(lua: &Lua, code: &str) -> Table {
        lua.load(code).eval::<Table>().unwrap()
    }

    #[test]
    fn a_quad_from_lists_gets_its_points_colours_and_normals() {
        let lua = Lua::new();
        let t = spec(
            &lua,
            "return { positions = { 0, 0, 0,  1, 0, 0,  1, 0, 1,  0, 0, 1 }, indices = { 1, 3, 2,  1, 4, 3 },
                      colors = { 255, 0, 0, 255,  0, 255, 0, 255,  0, 0, 255, 255,  188, 188, 188, 128 }, uvs = { 0, 0, 1, 0, 1, 1, 0, 1 } }",
        );
        let (v, i) = build(&t).unwrap();
        assert_eq!(v.len(), 4);
        assert_eq!(i, vec![0, 2, 1, 0, 3, 2]);
        assert_eq!(v[2].position, [1.0, 0.0, 1.0]);
        assert_eq!(v[0].color, [255, 0, 0, 255]);
        // sRGB 188 is about half the light: kept as a linear byte, as the model loader keeps vertex colours
        assert!((v[3].color[0] as i32 - 128).abs() <= 2, "{:?}", v[3].color);
        assert_eq!(v[3].color[3], 128);
        assert_eq!(v[1].uv, [1.0, 0.0]);
        // wound counter-clockwise seen from above: the worked-out normals point up
        for p in &v {
            assert!((p.normal[1] - 1.0).abs() < 1e-6, "{:?}", p.normal);
        }
    }

    #[test]
    fn a_mesh_without_colours_or_uvs_is_white_and_untextured() {
        let lua = Lua::new();
        let t = spec(
            &lua,
            "return { positions = { 0, 0, 0,  0, 1, 0,  0, 0, 1 }, indices = { 1, 2, 3 }, normals = { 1, 0, 0,  1, 0, 0,  1, 0, 0 } }",
        );
        let (v, _) = build(&t).unwrap();
        assert_eq!(v[0].color, [255; 4]);
        assert_eq!(v[0].uv, NO_TEXTURE_UV);
        assert_eq!(v[1].normal, [1.0, 0.0, 0.0]);
    }

    #[test]
    fn bad_lists_are_refused_with_what_is_wrong() {
        let lua = Lua::new();
        let cases = [
            ("return { indices = { 1, 2, 3 } }", "needs positions"),
            (
                "return { positions = { 0, 0 }, indices = { 1, 1, 1 } }",
                "multiple of 3",
            ),
            (
                "return { positions = { 0, 0, 0 }, indices = { 1, 1, 2 } }",
                "from 1 to 1",
            ),
            (
                "return { positions = { 0, 0, 0 }, indices = { 1, 1, 1 }, uvs = { 0 } }",
                "uvs has 1",
            ),
            (
                "return { positions = { 0, 0, 0 }, indices = { 1, 1, 1 }, colors = { 1, 2, 3 } }",
                "colors has 3",
            ),
            (
                "return { positions = { 0, 'a', 0 }, indices = { 1, 1, 1 } }",
                "positions[2]",
            ),
        ];
        for (code, want) in cases {
            let err = build(&spec(&lua, code)).unwrap_err().to_string();
            assert!(err.contains(want), "{code}: {err}");
        }
        // three numbers a colour with colors_rgb
        let t = spec(
            &lua,
            "return { positions = { 0, 0, 0 }, indices = { 1, 1, 1 }, colors = { 10, 20, 30 }, colors_rgb = true }",
        );
        assert!(build(&t).is_ok());
    }
}
