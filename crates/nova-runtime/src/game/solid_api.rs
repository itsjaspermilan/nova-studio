//! `nova.solid`: collision against the triangles of models (see [`crate::meshworld`]).

use super::*;
use crate::meshworld::CapsuleOpts;

/// A model's triangles, in its own space.
type Triangles = Rc<(Vec<[f32; 3]>, Vec<u32>)>;

fn vec3_table(lua: &Lua, v: Vec3) -> mlua::Result<Table> {
    let t = lua.create_table()?;
    t.set("x", v.x as f64)?;
    t.set("y", v.y as f64)?;
    t.set("z", v.z as f64)?;
    Ok(t)
}

pub(super) fn install(
    lua: &Lua,
    shared: &Rc<RefCell<Shared>>,
    vfs: &Rc<dyn Vfs>,
    nova: &Table,
) -> mlua::Result<()> {
    let solid = lua.create_table()?;
    // read from the model files when first asked for, so that a game that does not use this pays nothing
    let cache: Rc<RefCell<HashMap<String, Triangles>>> = Rc::default();

    // add(model, x, y, z [, { ry, rx, rz, scale }]) -> triangles added
    let (s, v, c) = (shared.clone(), vfs.clone(), cache.clone());
    solid.set(
        "add",
        lua.create_function(
            move |_, (id, x, y, z, opts): (String, f64, f64, f64, Option<Table>)| {
                let mut sh = s.borrow_mut();
                let found = find_model(&sh.known_models, &id).ok_or_else(|| {
                    lua_err(format!(
                        "unknown model '{id}' (looked for '{id}' and 'models/{id}.glb'; models in this project: {})",
                        if sh.known_models.is_empty() { "none".into() } else { sh.known_models.join(", ") }
                    ))
                })?;
                let tris = c.borrow().get(&found).cloned();
                let tris = match tris {
                    Some(t) => t,
                    None => {
                        let bytes = v.read(&found).map_err(lua_err)?;
                        let mesh = model::import_glb(&bytes).map_err(|e| lua_err(format!("{found}: {e}")))?;
                        let positions: Vec<[f32; 3]> = mesh.vertices.iter().map(|v| v.position).collect();
                        let t = Rc::new((positions, mesh.indices));
                        c.borrow_mut().insert(found.clone(), t.clone());
                        t
                    }
                };
                let scale = number_option(&opts, "scale")?.unwrap_or(1.0) as f32;
                let place = Mat4::from_translation(Vec3::new(x as f32, y as f32, z as f32))
                    * Mat4::from_rotation_y(number_option(&opts, "ry")?.unwrap_or(0.0) as f32)
                    * Mat4::from_rotation_x(number_option(&opts, "rx")?.unwrap_or(0.0) as f32)
                    * Mat4::from_rotation_z(number_option(&opts, "rz")?.unwrap_or(0.0) as f32)
                    * Mat4::from_scale(Vec3::splat(scale));
                Ok(sh.solid.add(&tris.0, &tris.1, place))
            },
        )?,
    )?;
    let s = shared.clone();
    solid.set(
        "clear",
        lua.create_function(move |_, ()| {
            s.borrow_mut().solid.clear();
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    solid.set(
        "count",
        lua.create_function(move |_, ()| Ok(s.borrow().solid.len()))?,
    )?;
    // move(x, y, z, radius, height, dx, dy, dz [, { slope, step, snap }]) -> { x, y, z, ground, normal, wall, wall_normal,
    // ceiling, stepped }
    let s = shared.clone();
    solid.set(
        "move",
        lua.create_function(
            move |lua,
                  (x, y, z, radius, height, dx, dy, dz, opts): (
                f64,
                f64,
                f64,
                f64,
                f64,
                f64,
                f64,
                f64,
                Option<Table>,
            )| {
                if !(radius.is_finite() && radius > 0.0) || !(height.is_finite() && height > 0.0) {
                    return Err(lua_err(
                        "nova.solid.move needs a radius and a height above 0 (metres)",
                    ));
                }
                for v in [x, y, z, dx, dy, dz] {
                    if !v.is_finite() {
                        return Err(lua_err(
                            "nova.solid.move: positions and moves must be numbers",
                        ));
                    }
                }
                let defaults = CapsuleOpts::default();
                let o = CapsuleOpts {
                    max_slope_degrees: number_option(&opts, "slope")?
                        .map_or(defaults.max_slope_degrees, |v| v as f32)
                        .clamp(0.0, 89.0),
                    step: number_option(&opts, "step")?
                        .map_or(defaults.step, |v| v as f32)
                        .max(0.0),
                    snap: number_option(&opts, "snap")?
                        .map_or(defaults.snap, |v| v as f32)
                        .max(0.0),
                };
                let m = s.borrow().solid.move_capsule(
                    Vec3::new(x as f32, y as f32, z as f32),
                    radius as f32,
                    height as f32,
                    Vec3::new(dx as f32, dy as f32, dz as f32),
                    &o,
                );
                let out = lua.create_table()?;
                out.set("x", m.pos.x as f64)?;
                out.set("y", m.pos.y as f64)?;
                out.set("z", m.pos.z as f64)?;
                out.set("ground", m.on_ground)?;
                if m.on_ground {
                    out.set("normal", vec3_table(lua, m.ground_normal)?)?;
                }
                out.set("wall", m.hit_wall)?;
                if m.hit_wall {
                    out.set("wall_normal", vec3_table(lua, m.wall_normal)?)?;
                }
                out.set("ceiling", m.hit_ceiling)?;
                out.set("stepped", m.stepped as f64)?;
                Ok(out)
            },
        )?,
    )?;
    // raycast(x, y, z, dx, dy, dz, max) -> distance, nx, ny, nz | nil
    let s = shared.clone();
    solid.set(
        "raycast",
        lua.create_function(
            move |_, (x, y, z, dx, dy, dz, max): (f64, f64, f64, f64, f64, f64, f64)| {
                let hit = s.borrow().solid.raycast(
                    Vec3::new(x as f32, y as f32, z as f32),
                    Vec3::new(dx as f32, dy as f32, dz as f32),
                    max as f32,
                );
                Ok(match hit {
                    Some((d, n)) => mlua::MultiValue::from_iter([
                        Value::Number(d as f64),
                        Value::Number(n.x as f64),
                        Value::Number(n.y as f64),
                        Value::Number(n.z as f64),
                    ]),
                    None => mlua::MultiValue::new(),
                })
            },
        )?,
    )?;
    // floor_below(x, y, z [, max_drop]) -> y, nx, ny, nz | nil
    let s = shared.clone();
    solid.set(
        "floor_below",
        lua.create_function(move |_, (x, y, z, drop): (f64, f64, f64, Option<f64>)| {
            let hit = s.borrow().solid.floor_below(
                Vec3::new(x as f32, y as f32, z as f32),
                drop.unwrap_or(50.0) as f32,
            );
            Ok(match hit {
                Some((h, n)) => mlua::MultiValue::from_iter([
                    Value::Number(h as f64),
                    Value::Number(n.x as f64),
                    Value::Number(n.y as f64),
                    Value::Number(n.z as f64),
                ]),
                None => mlua::MultiValue::new(),
            })
        })?,
    )?;
    nova.set("solid", solid)?;
    Ok(())
}
