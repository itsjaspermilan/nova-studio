//! `nova.physics`: rigid bodies on Rapier (see [`crate::physics`]). The framework gives entities bodies with it (`body = "dynamic"`)
//! and copies the bodies' places back each step; a game can also call it directly.
//!
//! Units are the game's: pixels in a 2D world (turned into metres with `scale`, 50 pixels a metre unless
//! `nova.physics.settings { scale = N }` says otherwise) and metres in a 3D one. Turns are an angle in radians in 2D
//! and a quaternion `{ x, y, z, w }` in 3D (or `rx`, `ry`, `rz` in the order `nova.model` uses).

use super::*;
use crate::physics::{
    BodyDesc, CharacterOpts, JointDesc, JointKind, Kind, Physics, Shape, d2, d3, id2, id3, split_id,
};

/// A model's corner points and triangles, in its own space.
type Triangles = Rc<(Vec<[f32; 3]>, Vec<[u32; 3]>)>;

fn bad(msg: impl Into<String>) -> mlua::Error {
    lua_err(format!("nova.physics: {}", msg.into()))
}

/// `{ x, y, z }` or `{ 1, 2, 3 }`.
fn vec_of(t: &Table) -> mlua::Result<[f32; 3]> {
    let get = |k: &str, i: i64| -> mlua::Result<f32> {
        Ok(t.get::<Option<f64>>(k)?
            .or(t.get::<Option<f64>>(i)?)
            .unwrap_or(0.0) as f32)
    };
    Ok([get("x", 1)?, get("y", 2)?, get("z", 3)?])
}

fn vec_option(opts: &Option<Table>, key: &str) -> mlua::Result<Option<[f32; 3]>> {
    match opts {
        Some(o) => match o.get::<Option<Table>>(key)? {
            Some(t) => Ok(Some(vec_of(&t)?)),
            None => Ok(None),
        },
        None => Ok(None),
    }
}

fn bool_option(opts: &Option<Table>, key: &str) -> mlua::Result<Option<bool>> {
    match opts {
        Some(o) => o.get::<Option<bool>>(key),
        None => Ok(None),
    }
}

/// A 3D turn from `quat = { x, y, z, w }` or `rx`, `ry`, `rz` (applied as `nova.model` does: y, then x, then z).
fn quat_option(opts: &Option<Table>) -> mlua::Result<Option<[f32; 4]>> {
    if let Some(o) = opts
        && let Some(q) = o.get::<Option<Table>>("quat")?
    {
        return Ok(Some(quat_of(&q)?));
    }
    let (rx, ry, rz) = (
        number_option(opts, "rx")?,
        number_option(opts, "ry")?,
        number_option(opts, "rz")?,
    );
    if rx.is_none() && ry.is_none() && rz.is_none() {
        return Ok(None);
    }
    let q = Quat::from_rotation_y(ry.unwrap_or(0.0) as f32)
        * Quat::from_rotation_x(rx.unwrap_or(0.0) as f32)
        * Quat::from_rotation_z(rz.unwrap_or(0.0) as f32);
    Ok(Some(q.to_array()))
}

fn quat_of(q: &Table) -> mlua::Result<[f32; 4]> {
    let get = |k: &str, i: i64, d: f64| -> mlua::Result<f32> {
        Ok(q.get::<Option<f64>>(k)?
            .or(q.get::<Option<f64>>(i)?)
            .unwrap_or(d) as f32)
    };
    Ok([
        get("x", 1, 0.0)?,
        get("y", 2, 0.0)?,
        get("z", 3, 0.0)?,
        get("w", 4, 1.0)?,
    ])
}

/// Reads a model's triangles from its file the first time they are asked for.
fn model_triangles(
    sh: &Shared,
    vfs: &Rc<dyn Vfs>,
    cache: &RefCell<HashMap<String, Triangles>>,
    id: &str,
) -> mlua::Result<(Triangles, f32)> {
    let found =
        find_model(&sh.known_models, id).ok_or_else(|| bad(format!("unknown model '{id}'")))?;
    let scale = sh.model_scales.get(&found).copied().unwrap_or(1.0);
    if let Some(t) = cache.borrow().get(&found) {
        return Ok((t.clone(), scale));
    }
    let bytes = vfs.read(&found).map_err(lua_err)?;
    let mesh = model::import_glb(&bytes).map_err(|e| lua_err(format!("{found}: {e}")))?;
    let points: Vec<[f32; 3]> = mesh.vertices.iter().map(|v| v.position).collect();
    let tris: Vec<[u32; 3]> = mesh
        .indices
        .as_chunks::<3>()
        .0
        .iter()
        .map(|c| [c[0], c[1], c[2]])
        .collect();
    let t = Rc::new((points, tris));
    cache.borrow_mut().insert(found, t.clone());
    Ok((t, scale))
}

fn bounds(points: &[[f32; 3]]) -> Option<([f32; 3], [f32; 3])> {
    let mut lo = [f32::MAX; 3];
    let mut hi = [f32::MIN; 3];
    for p in points {
        for k in 0..3 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    }
    (lo[0] <= hi[0]).then_some((lo, hi))
}

/// The solid tiles of a tilemap as boxes, each row's runs of solid tiles joined into one box (game units, from the map's corner).
fn tile_boxes(map: &crate::tilemap::TileMap, solid: &[i64]) -> Vec<([f32; 3], [f32; 3])> {
    let (tw, th) = (map.tile_w as f32 * map.scale, map.tile_h as f32 * map.scale);
    let mut out = Vec::new();
    for row in 0..map.height as i64 {
        let mut col = 0i64;
        while col < map.width as i64 {
            let is_solid = |c: i64| {
                let t = map.get(c, row) as i64;
                t >= 0 && solid.contains(&t)
            };
            if !is_solid(col) {
                col += 1;
                continue;
            }
            let start = col;
            while col < map.width as i64 && is_solid(col) {
                col += 1;
            }
            let w = (col - start) as f32 * tw;
            out.push((
                [start as f32 * tw + w * 0.5, row as f32 * th + th * 0.5, 0.0],
                [w * 0.5, th * 0.5, 0.0],
            ));
        }
    }
    out
}

fn kind_option(opts: &Option<Table>) -> mlua::Result<Kind> {
    match string_option(opts, "kind")? {
        None => Ok(Kind::Dynamic),
        Some(k) => Kind::parse(&k).ok_or_else(|| {
            bad(format!(
                "kind '{k}' is not one of dynamic, static, kinematic, character"
            ))
        }),
    }
}

fn contact_table(
    lua: &Lua,
    c: &crate::physics::Contact,
    three: bool,
    unit: f32,
) -> mlua::Result<Table> {
    let t = lua.create_table()?;
    let id = |i: u32| if three { id3(i) } else { id2(i) };
    t.set("a", id(c.a))?;
    t.set("b", id(c.b))?;
    t.set("started", c.started)?;
    t.set("sensor", c.sensor)?;
    t.set("x", (c.point[0] * unit) as f64)?;
    t.set("y", (c.point[1] * unit) as f64)?;
    t.set("nx", c.normal[0] as f64)?;
    t.set("ny", c.normal[1] as f64)?;
    if three {
        t.set("z", c.point[2] as f64)?;
        t.set("nz", c.normal[2] as f64)?;
    }
    t.set("speed", (c.speed * unit) as f64)?;
    Ok(t)
}

pub(super) fn install(
    lua: &Lua,
    shared: &Rc<RefCell<Shared>>,
    vfs: &Rc<dyn Vfs>,
    nova: &Table,
) -> mlua::Result<()> {
    let physics = lua.create_table()?;
    let cache: Rc<RefCell<HashMap<String, Triangles>>> = Rc::default();

    // settings { scale = 50, gravity = { 0, 490 }, gravity3 = { 0, -9.81, 0 } }
    let s = shared.clone();
    physics.set(
        "settings",
        lua.create_function(move |_, opts: Option<Table>| {
            let mut sh = s.borrow_mut();
            let p = &mut sh.physics;
            if let Some(scale) = number_option(&opts, "scale")? {
                if !(scale.is_finite() && scale > 0.0) {
                    return Err(bad("settings: scale (pixels in a metre) must be above 0"));
                }
                if p.d2.as_ref().is_some_and(|w| !w.is_empty()) {
                    return Err(bad(
                        "settings: set the scale before the first 2D body is made",
                    ));
                }
                p.scale = scale as f32;
            }
            if let Some(g) = vec_option(&opts, "gravity")? {
                let g = [g[0] / p.scale, g[1] / p.scale, 0.0];
                p.gravity2 = g;
                if let Some(w) = &mut p.d2 {
                    w.set_gravity(g);
                }
            }
            if let Some(g) = vec_option(&opts, "gravity3")? {
                p.gravity3 = g;
                if let Some(w) = &mut p.d3 {
                    w.set_gravity(g);
                }
            }
            Ok((
                p.scale as f64,
                (p.gravity2[0] * p.scale) as f64,
                (p.gravity2[1] * p.scale) as f64,
            ))
        })?,
    )?;

    // body(opts) -> id
    let (s, v, c) = (shared.clone(), vfs.clone(), cache.clone());
    physics.set(
        "body",
        lua.create_function(move |_, opts: Option<Table>| {
            let sh_ref = s.borrow();
            let three = match number_option(&opts, "dim")? {
                Some(3.0) => true,
                Some(2.0) => false,
                Some(_) => return Err(bad("body: dim is 2 or 3")),
                None => number_option(&opts, "z")?.is_some() || string_option(&opts, "model")?.is_some(),
            };
            // game units -> metres
            let unit = if three { 1.0 } else { sh_ref.physics.scale };
            let m = |v: f64| v as f32 / unit;
            let num = |k: &str, d: f64| -> mlua::Result<f64> { Ok(number_option(&opts, k)?.unwrap_or(d)) };
            let kind = kind_option(&opts)?;
            let mut d = BodyDesc {
                kind,
                pos: [m(num("x", 0.0)?), m(num("y", 0.0)?), m(num("z", 0.0)?)],
                ..Default::default()
            };
            if three {
                if let Some(q) = quat_option(&opts)? {
                    d.rot = q;
                }
            } else {
                d.rot = [num("angle", 0.0)? as f32, 0.0, 0.0, 0.0];
                d.pos[2] = 0.0;
            }
            let model = string_option(&opts, "model")?;
            let size_scale = num("scale", 1.0)? as f32;
            let shape_name = string_option(&opts, "shape")?.unwrap_or_else(|| "box".into());
            // a model's corners give the default size of a box, ball or capsule, and the shape is put over the model
            let model_box = match &model {
                Some(id) if three && matches!(shape_name.as_str(), "box" | "sphere" | "ball" | "circle" | "capsule") => {
                    let (tris, scale) = model_triangles(&sh_ref, &v, &c, id)?;
                    bounds(&tris.0).map(|(lo, hi)| {
                        let k = scale * size_scale;
                        (lo.map(|x| x * k), hi.map(|x| x * k))
                    })
                }
                _ => None,
            };
            let sizes = [number_option(&opts, "w")?, number_option(&opts, "h")?, number_option(&opts, "d")?];
            let radius = number_option(&opts, "radius")?;
            if let Some((lo, hi)) = model_box
                && sizes.iter().all(|s| s.is_none()) && radius.is_none() {
                    d.offset = [(lo[0] + hi[0]) * 0.5, (lo[1] + hi[1]) * 0.5, (lo[2] + hi[2]) * 0.5];
                }
            let half_of = |k: usize, fallback: f32| -> f32 {
                match sizes[k] {
                    Some(v) => m(v) * 0.5,
                    None => match model_box {
                        Some((lo, hi)) => (hi[k] - lo[k]) * 0.5,
                        None => fallback,
                    },
                }
            };
            let default_half = if three { 0.5 } else { 16.0 / unit };
            d.shape = match shape_name.as_str() {
                "box" => {
                    let hx = half_of(0, default_half);
                    let hy = half_of(1, if sizes[0].is_some() && !three { hx } else { default_half });
                    let hz = half_of(2, if three { hx } else { 0.0 });
                    Shape::Box { half: [hx, hy, hz] }
                }
                "circle" | "ball" | "sphere" => {
                    let r = match radius {
                        Some(r) => m(r),
                        None => match model_box {
                            Some((lo, hi)) => (0..3).map(|k| (hi[k] - lo[k]) * 0.5).fold(0.0, f32::max),
                            None => default_half,
                        },
                    };
                    Shape::Ball { r }
                }
                "capsule" => {
                    let r = match radius {
                        Some(r) => m(r),
                        None => match model_box {
                            Some((lo, hi)) => ((hi[0] - lo[0]).max(hi[2] - lo[2]) * 0.5).max(0.01),
                            None => default_half * 0.5,
                        },
                    };
                    let tall = match number_option(&opts, "height")?.or(sizes[1]) {
                        Some(h) => m(h),
                        None => match model_box {
                            Some((lo, hi)) => hi[1] - lo[1],
                            None => default_half * 4.0,
                        },
                    };
                    Shape::Capsule { half: (tall * 0.5 - r).max(0.0), r }
                }
                "model" | "hull" | "mesh" => {
                    let id = model.clone().ok_or_else(|| bad(format!("body: shape '{shape_name}' needs a model")))?;
                    if !three {
                        return Err(bad("body: a model shape is for 3D bodies"));
                    }
                    let (tris, scale) = model_triangles(&sh_ref, &v, &c, &id)?;
                    let k = scale * size_scale;
                    let points: Vec<[f32; 3]> = tris.0.iter().map(|p| p.map(|x| x * k)).collect();
                    // a model that moves is the hull round it; one that stays put keeps every triangle (unless asked for its hull)
                    if shape_name == "hull" || kind != Kind::Static {
                        Shape::Hull(points)
                    } else {
                        Shape::Mesh(points, tris.1.clone())
                    }
                }
                "points" => {
                    let list: Table = opts
                        .as_ref()
                        .and_then(|o| o.get::<Option<Table>>("points").ok().flatten())
                        .ok_or_else(|| bad("body: shape 'points' needs points = { {x, y[, z]}, ... }"))?;
                    let mut pts = Vec::new();
                    for p in list.sequence_values::<Table>() {
                        let p = vec_of(&p?)?;
                        pts.push([p[0] / unit, p[1] / unit, if three { p[2] } else { 0.0 }]);
                    }
                    Shape::Hull(pts)
                }
                "tiles" => {
                    if three {
                        return Err(bad("body: shape 'tiles' is for 2D (a tilemap)"));
                    }
                    let map_id = number_option(&opts, "map")?.ok_or_else(|| bad("body: shape 'tiles' needs map (a tilemap's number)"))?;
                    let map = sh_ref.tilemaps.get(map_id as usize).ok_or_else(|| bad("body: unknown tilemap"))?;
                    let solid: Vec<i64> = match &opts {
                        Some(o) => o.get::<Option<Vec<i64>>>("solid")?.unwrap_or_default(),
                        None => Vec::new(),
                    };
                    let boxes = tile_boxes(map, &solid)
                        .into_iter()
                        .map(|(c, h)| (c.map(|x| x / unit), h.map(|x| x / unit)))
                        .collect();
                    Shape::Boxes(boxes)
                }
                "solid" => {
                    if !three {
                        return Err(bad("body: shape 'solid' (the nova.solid triangles) is for 3D"));
                    }
                    let mut points = Vec::new();
                    let mut tris = Vec::new();
                    for t in sh_ref.solid.triangles() {
                        let base = points.len() as u32;
                        points.extend_from_slice(&t);
                        tris.push([base, base + 1, base + 2]);
                    }
                    d.pos = [0.0; 3];
                    d.rot = [0.0, 0.0, 0.0, 1.0];
                    Shape::Mesh(points, tris)
                }
                "walls" => {
                    if !three {
                        return Err(bad("body: shape 'walls' (the nova.walls boxes and ramps) is for 3D"));
                    }
                    let mut boxes = Vec::new();
                    for w in sh_ref.walls.all().iter().filter(|w| w.on) {
                        boxes.push((
                            [(w.x0 + w.x1) * 0.5, (w.y0 + w.y1) * 0.5, (w.z0 + w.z1) * 0.5],
                            [(w.x1 - w.x0).abs() * 0.5, (w.y1 - w.y0).abs() * 0.5, (w.z1 - w.z0).abs() * 0.5],
                        ));
                    }
                    d.pos = [0.0; 3];
                    d.rot = [0.0, 0.0, 0.0, 1.0];
                    let ramps = sh_ref.walls.ramps().to_vec();
                    drop(sh_ref);
                    let mut sh = s.borrow_mut();
                    let world = sh.physics.world3();
                    let mut first = None;
                    if !boxes.is_empty() {
                        first = world.add(&BodyDesc { shape: Shape::Boxes(boxes), ..d.clone() });
                    }
                    // each ramp a wedge of its own (static bodies cost nothing while nothing touches them)
                    for r in ramps {
                        let (lo, hi) = (r.y_start, r.y_end);
                        let top = |x: f32, z: f32| {
                            let t = if r.axis == 0 { (x - r.x0) / (r.x1 - r.x0) } else { (z - r.z0) / (r.z1 - r.z0) };
                            lo + (hi - lo) * t
                        };
                        let mut pts = Vec::new();
                        for (x, z) in [(r.x0, r.z0), (r.x1, r.z0), (r.x0, r.z1), (r.x1, r.z1)] {
                            pts.push([x, r.y_base, z]);
                            pts.push([x, top(x, z), z]);
                        }
                        let id = world.add(&BodyDesc { shape: Shape::Hull(pts), ..d.clone() });
                        first = first.or(id);
                    }
                    return Ok(first.map(id3));
                }
                other => {
                    return Err(bad(format!(
                        "body: shape '{other}' is not one of box, circle, sphere, capsule, model, hull, points, tiles, solid, walls"
                    )));
                }
            };
            if let Some(o) = vec_option(&opts, "offset")? {
                d.offset = [o[0] / unit, o[1] / unit, if three { o[2] } else { 0.0 }];
            }
            d.mass = number_option(&opts, "mass")?.map(|v| v as f32);
            if let Some(v) = number_option(&opts, "density")? {
                d.density = v as f32;
            }
            d.bounce = num("bounce", d.bounce as f64)? as f32;
            d.friction = num("friction", d.friction as f64)? as f32;
            d.damping = num("damping", d.damping as f64)? as f32;
            d.spin_damping = num("spin_damping", d.spin_damping as f64)? as f32;
            d.gravity_scale = num("gravity", 1.0)? as f32;
            d.sensor = bool_option(&opts, "sensor")?.unwrap_or(false);
            d.fixed_rotation = bool_option(&opts, "fixed_rotation")?.unwrap_or(false);
            d.bullet = bool_option(&opts, "bullet")?.unwrap_or(false);
            drop(sh_ref);
            let mut sh = s.borrow_mut();
            let id = if three { sh.physics.world3().add(&d).map(id3) } else { sh.physics.world2().add(&d).map(id2) };
            Ok(id)
        })?,
    )?;

    // A body's world and index, or an error that says what went wrong.
    fn with<R>(
        p: &mut Physics,
        id: u32,
        f2: impl FnOnce(&mut d2::World, u32, f32) -> R,
        f3: impl FnOnce(&mut d3::World, u32) -> R,
    ) -> Option<R> {
        let (three, i) = split_id(id)?;
        if three {
            p.d3.as_mut().map(|w| f3(w, i))
        } else {
            let scale = p.scale;
            p.d2.as_mut().map(|w| f2(w, i, scale))
        }
    }

    let s = shared.clone();
    physics.set(
        "remove",
        lua.create_function(move |_, id: u32| {
            Ok(with(
                &mut s.borrow_mut().physics,
                id,
                |w, i, _| w.remove(i),
                |w, i| w.remove(i),
            )
            .unwrap_or(false))
        })?,
    )?;
    let s = shared.clone();
    physics.set(
        "clear",
        lua.create_function(move |_, ()| {
            s.borrow_mut().physics.clear();
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    physics.set(
        "count",
        lua.create_function(move |_, ()| Ok(s.borrow().physics.body_count()))?,
    )?;
    let s = shared.clone();
    physics.set(
        "step",
        lua.create_function(move |_, dt: Option<f64>| {
            let t0 = std::time::Instant::now();
            let mut sh = s.borrow_mut();
            sh.physics.step(dt.unwrap_or(1.0 / 60.0) as f32);
            sh.physics_ms = t0.elapsed().as_secs_f32() * 1000.0;
            Ok(())
        })?,
    )?;
    // moved(out) -> n: the bodies the last step moved, flat in `out`, eleven numbers each: id, x, y, z, the turn (2D: angle, 0, 0, 0;
    // 3D: qx, qy, qz, qw) and the velocity vx, vy, vz
    let s = shared.clone();
    let scratch: Rc<RefCell<Vec<f32>>> = Rc::default();
    physics.set(
        "moved",
        lua.create_function(move |_, out: Table| {
            let sh = s.borrow();
            let mut buf = scratch.borrow_mut();
            let mut n = 0i64;
            for three in [false, true] {
                buf.clear();
                let unit = if three { 1.0 } else { sh.physics.scale };
                if three {
                    if let Some(w) = &sh.physics.d3 {
                        w.moved(&mut buf);
                    }
                } else if let Some(w) = &sh.physics.d2 {
                    w.moved(&mut buf);
                }
                for c in buf.as_chunks::<11>().0 {
                    let id = if three {
                        id3(c[0] as u32)
                    } else {
                        id2(c[0] as u32)
                    };
                    out.raw_set(n + 1, id)?;
                    out.raw_set(n + 2, (c[1] * unit) as f64)?;
                    out.raw_set(n + 3, (c[2] * unit) as f64)?;
                    out.raw_set(n + 4, (c[3] * unit) as f64)?;
                    for k in 0..4 {
                        out.raw_set(n + 5 + k as i64, c[4 + k] as f64)?;
                    }
                    for k in 0..3 {
                        out.raw_set(n + 9 + k as i64, (c[8 + k] * unit) as f64)?;
                    }
                    n += 11;
                }
            }
            Ok(n)
        })?,
    )?;
    // contacts() -> { { a, b, started, sensor, x, y, z, nx, ny, nz, speed }, ... } since the last call
    let s = shared.clone();
    physics.set(
        "contacts",
        lua.create_function(move |lua, ()| {
            let mut sh = s.borrow_mut();
            let out = lua.create_table()?;
            let scale = sh.physics.scale;
            let mut n = 0;
            if let Some(w) = &mut sh.physics.d2 {
                for c in w.take_contacts() {
                    n += 1;
                    out.raw_set(n, contact_table(lua, &c, false, scale)?)?;
                }
            }
            if let Some(w) = &mut sh.physics.d3 {
                for c in w.take_contacts() {
                    n += 1;
                    out.raw_set(n, contact_table(lua, &c, true, 1.0)?)?;
                }
            }
            Ok(out)
        })?,
    )?;
    // pose(id) -> x, y, angle (2D) | x, y, z, qx, qy, qz, qw (3D)
    let s = shared.clone();
    physics.set(
        "pose",
        lua.create_function(move |_, id: u32| {
            let sh = s.borrow();
            let p = &sh.physics;
            let Some((three, i)) = split_id(id) else {
                return Ok(mlua::MultiValue::new());
            };
            let n = |v: f32| Value::Number(v as f64);
            Ok(if three {
                match p.d3.as_ref().and_then(|w| w.pose(i)) {
                    Some((x, r)) => mlua::MultiValue::from_iter([
                        n(x[0]),
                        n(x[1]),
                        n(x[2]),
                        n(r[0]),
                        n(r[1]),
                        n(r[2]),
                        n(r[3]),
                    ]),
                    None => mlua::MultiValue::new(),
                }
            } else {
                match p.d2.as_ref().and_then(|w| w.pose(i)) {
                    Some((x, r)) => {
                        mlua::MultiValue::from_iter([n(x[0] * p.scale), n(x[1] * p.scale), n(r[0])])
                    }
                    None => mlua::MultiValue::new(),
                }
            })
        })?,
    )?;
    // velocity(id) -> vx, vy, spin (2D) | vx, vy, vz, wx, wy, wz (3D)
    let s = shared.clone();
    physics.set(
        "velocity",
        lua.create_function(move |_, id: u32| {
            let sh = s.borrow();
            let p = &sh.physics;
            let Some((three, i)) = split_id(id) else {
                return Ok(mlua::MultiValue::new());
            };
            let n = |v: f32| Value::Number(v as f64);
            Ok(if three {
                match p.d3.as_ref().and_then(|w| w.velocity(i)) {
                    Some((v, a)) => mlua::MultiValue::from_iter([
                        n(v[0]),
                        n(v[1]),
                        n(v[2]),
                        n(a[0]),
                        n(a[1]),
                        n(a[2]),
                    ]),
                    None => mlua::MultiValue::new(),
                }
            } else {
                match p.d2.as_ref().and_then(|w| w.velocity(i)) {
                    Some((v, a)) => {
                        mlua::MultiValue::from_iter([n(v[0] * p.scale), n(v[1] * p.scale), n(a[2])])
                    }
                    None => mlua::MultiValue::new(),
                }
            })
        })?,
    )?;

    // Calls that take a vector in game units: set_velocity, impulse, force (z left out in 2D).
    type VecFn2 = fn(&mut d2::World, u32, [f32; 3]);
    type VecFn3 = fn(&mut d3::World, u32, [f32; 3]);
    let vector_calls: [(&str, VecFn2, VecFn3); 3] = [
        (
            "set_velocity",
            |w, i, v| w.set_velocity(i, v),
            |w, i, v| w.set_velocity(i, v),
        ),
        (
            "impulse",
            |w, i, v| w.impulse(i, v),
            |w, i, v| w.impulse(i, v),
        ),
        ("force", |w, i, v| w.force(i, v), |w, i, v| w.force(i, v)),
    ];
    for (name, f2, f3) in vector_calls {
        let s = shared.clone();
        physics.set(
            name,
            lua.create_function(move |_, (id, x, y, z): (u32, f64, f64, Option<f64>)| {
                let v = [x as f32, y as f32, z.unwrap_or(0.0) as f32];
                with(
                    &mut s.borrow_mut().physics,
                    id,
                    |w, i, k| f2(w, i, [v[0] / k, v[1] / k, 0.0]),
                    |w, i| f3(w, i, v),
                );
                Ok(())
            })?,
        )?;
    }
    // impulse_at(id, jx, jy, jz, px, py, pz): a push at a point (2D: give jz and pz as 0)
    let s = shared.clone();
    physics.set(
        "impulse_at",
        lua.create_function(
            move |_, (id, jx, jy, jz, px, py, pz): (u32, f64, f64, f64, f64, f64, f64)| {
                let (j, at) = (
                    [jx as f32, jy as f32, jz as f32],
                    [px as f32, py as f32, pz as f32],
                );
                with(
                    &mut s.borrow_mut().physics,
                    id,
                    |w, i, k| {
                        w.impulse_at(i, [j[0] / k, j[1] / k, 0.0], [at[0] / k, at[1] / k, 0.0])
                    },
                    |w, i| w.impulse_at(i, j, at),
                );
                Ok(())
            },
        )?,
    )?;
    // set_spin(id, w) in 2D (radians a second, clockwise on screen) | set_spin(id, wx, wy, wz) in 3D; spin_impulse the same as a push
    for (name, impulse) in [("set_spin", false), ("spin_impulse", true)] {
        let s = shared.clone();
        physics.set(
            name,
            lua.create_function(
                move |_, (id, a, b, c): (u32, f64, Option<f64>, Option<f64>)| {
                    with(
                        &mut s.borrow_mut().physics,
                        id,
                        |w, i, k| {
                            let v = [0.0, 0.0, a as f32];
                            if impulse {
                                w.torque_impulse(i, v.map(|x| x / (k * k)))
                            } else {
                                w.set_spin(i, v)
                            }
                        },
                        |w, i| {
                            let v = [a as f32, b.unwrap_or(0.0) as f32, c.unwrap_or(0.0) as f32];
                            if impulse {
                                w.torque_impulse(i, v)
                            } else {
                                w.set_spin(i, v)
                            }
                        },
                    );
                    Ok(())
                },
            )?,
        )?;
    }
    // place(id, x, y, z [, turn]) puts a body there at once; target(...) glides a kinematic body there over the next step;
    // turn is an angle (2D) or a quaternion table (3D)
    for (name, glide) in [("place", false), ("target", true)] {
        let s = shared.clone();
        physics.set(
            name,
            lua.create_function(
                move |_, (id, x, y, z, turn): (u32, f64, f64, Option<f64>, Value)| {
                    let pos = [x as f32, y as f32, z.unwrap_or(0.0) as f32];
                    let rot3 = match &turn {
                        Value::Table(t) => Some(quat_of(t)?),
                        _ => None,
                    };
                    let rot2 = match turn {
                        Value::Number(a) => Some([a as f32, 0.0, 0.0, 0.0]),
                        Value::Integer(a) => Some([a as f32, 0.0, 0.0, 0.0]),
                        _ => None,
                    };
                    with(
                        &mut s.borrow_mut().physics,
                        id,
                        |w, i, k| {
                            let p = [pos[0] / k, pos[1] / k, 0.0];
                            if glide {
                                w.kinematic_target(i, p, rot2)
                            } else {
                                w.place(i, p, rot2)
                            }
                        },
                        |w, i| {
                            if glide {
                                w.kinematic_target(i, pos, rot3)
                            } else {
                                w.place(i, pos, rot3)
                            }
                        },
                    );
                    Ok(())
                },
            )?,
        )?;
    }
    let s = shared.clone();
    physics.set(
        "teleport",
        lua.create_function(move |_, (id, x, y, z): (u32, f64, f64, Option<f64>)| {
            let pos = [x as f32, y as f32, z.unwrap_or(0.0) as f32];
            with(
                &mut s.borrow_mut().physics,
                id,
                |w, i, k| w.teleport(i, [pos[0] / k, pos[1] / k, 0.0]),
                |w, i| w.teleport(i, pos),
            );
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    physics.set(
        "wake",
        lua.create_function(move |_, id: u32| {
            with(
                &mut s.borrow_mut().physics,
                id,
                |w, i, _| w.wake(i),
                |w, i| w.wake(i),
            );
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    physics.set(
        "sleeping",
        lua.create_function(move |_, id: u32| {
            Ok(with(
                &mut s.borrow_mut().physics,
                id,
                |w, i, _| w.sleeping(i),
                |w, i| w.sleeping(i),
            )
            .unwrap_or(false))
        })?,
    )?;
    let s = shared.clone();
    physics.set(
        "mass",
        lua.create_function(move |_, id: u32| {
            Ok(with(
                &mut s.borrow_mut().physics,
                id,
                |w, i, _| w.mass(i),
                |w, i| w.mass(i),
            )
            .unwrap_or(0.0) as f64)
        })?,
    )?;

    // ray(x, y, dx, dy, max [, { ignore = id, sensors = true }]) (2D) and ray3(x, y, z, dx, dy, dz, max [, opts]) (3D)
    // -> { body, distance, x, y, z, nx, ny, nz } | nil
    fn hit_table(
        lua: &Lua,
        h: crate::physics::RayHit,
        three: bool,
        unit: f32,
    ) -> mlua::Result<Value> {
        let t = lua.create_table()?;
        t.set("body", if three { id3(h.body) } else { id2(h.body) })?;
        t.set("distance", (h.distance * unit) as f64)?;
        t.set("x", (h.point[0] * unit) as f64)?;
        t.set("y", (h.point[1] * unit) as f64)?;
        t.set("nx", h.normal[0] as f64)?;
        t.set("ny", h.normal[1] as f64)?;
        if three {
            t.set("z", h.point[2] as f64)?;
            t.set("nz", h.normal[2] as f64)?;
        }
        Ok(Value::Table(t))
    }
    let s = shared.clone();
    physics.set(
        "ray",
        lua.create_function(
            move |lua, (x, y, dx, dy, max, opts): (f64, f64, f64, f64, f64, Option<Table>)| {
                let sh = s.borrow();
                let Some(w) = &sh.physics.d2 else {
                    return Ok(Value::Nil);
                };
                let k = sh.physics.scale;
                let ignore = number_option(&opts, "ignore")?
                    .and_then(|i| split_id(i as u32))
                    .filter(|(t, _)| !t)
                    .map(|(_, i)| i);
                let sensors = bool_option(&opts, "sensors")?.unwrap_or(false);
                match w.ray(
                    [x as f32 / k, y as f32 / k, 0.0],
                    [dx as f32, dy as f32, 0.0],
                    max as f32 / k,
                    ignore,
                    sensors,
                ) {
                    Some(h) => hit_table(lua, h, false, k),
                    None => Ok(Value::Nil),
                }
            },
        )?,
    )?;
    let s = shared.clone();
    physics.set(
        "ray3",
        lua.create_function(
            move |lua,
                  (x, y, z, dx, dy, dz, max, opts): (
                f64,
                f64,
                f64,
                f64,
                f64,
                f64,
                f64,
                Option<Table>,
            )| {
                let sh = s.borrow();
                let Some(w) = &sh.physics.d3 else {
                    return Ok(Value::Nil);
                };
                let ignore = number_option(&opts, "ignore")?
                    .and_then(|i| split_id(i as u32))
                    .filter(|(t, _)| *t)
                    .map(|(_, i)| i);
                let sensors = bool_option(&opts, "sensors")?.unwrap_or(false);
                match w.ray(
                    [x as f32, y as f32, z as f32],
                    [dx as f32, dy as f32, dz as f32],
                    max as f32,
                    ignore,
                    sensors,
                ) {
                    Some(h) => hit_table(lua, h, true, 1.0),
                    None => Ok(Value::Nil),
                }
            },
        )?,
    )?;

    // joint(kind, a, b | nil, opts) -> joint id: kind is fixed, hinge, ball, rope, spring or slider; opts x, y, z (the anchor,
    // in the world; default a's position), bx, by, bz (the end on b for a rope or spring), axis, min, max, motor, strength,
    // length, stiffness, damping, collide
    let s = shared.clone();
    physics.set(
        "joint",
        lua.create_function(move |_, (kind, a, b, opts): (String, u32, Option<u32>, Option<Table>)| {
            let mut sh = s.borrow_mut();
            let p = &mut sh.physics;
            let (three, ia) = split_id(a).ok_or_else(|| bad("joint: a is not a body"))?;
            let ib = match b {
                Some(b) => {
                    let (tb, ib) = split_id(b).ok_or_else(|| bad("joint: b is not a body"))?;
                    if tb != three {
                        return Err(bad("joint: a 2D body cannot be joined to a 3D one"));
                    }
                    Some(ib)
                }
                None => None,
            };
            let unit = if three { 1.0 } else { p.scale };
            let pos_a = if three {
                p.d3.as_ref().and_then(|w| w.pose(ia)).map(|x| x.0)
            } else {
                p.d2.as_ref().and_then(|w| w.pose(ia)).map(|x| x.0)
            }
            .ok_or_else(|| bad("joint: a is not a body"))?;
            let get = |k: &str, d: f32| -> mlua::Result<f32> { Ok(number_option(&opts, k)?.map_or(d, |v| v as f32 / unit)) };
            let anchor = [get("x", pos_a[0])?, get("y", pos_a[1])?, if three { get("z", pos_a[2])? } else { 0.0 }];
            let anchor_b = if number_option(&opts, "bx")?.is_some() || number_option(&opts, "by")?.is_some() {
                Some([get("bx", anchor[0])?, get("by", anchor[1])?, if three { get("bz", anchor[2])? } else { 0.0 }])
            } else {
                None
            };
            let raw = |k: &str| number_option(&opts, k).map(|v| v.map(|v| v as f32));
            let slider = kind == "slider";
            // a slider's limits are lengths (scaled in 2D); a hinge's are angles
            let lim_unit = if slider { unit } else { 1.0 };
            let limits = match (raw("min")?, raw("max")?) {
                (None, None) => None,
                (lo, hi) => Some([lo.unwrap_or(f32::MIN) / lim_unit, hi.unwrap_or(f32::MAX) / lim_unit]),
            };
            let strength = raw("strength")?.unwrap_or(1.0);
            let motor = raw("motor")?.map(|v| (if slider { v / unit } else { v }, strength));
            let between = || {
                let e = anchor_b.unwrap_or(anchor);
                let d: f32 = (0..3).map(|k| (e[k] - anchor[k]).powi(2)).sum::<f32>().sqrt();
                d
            };
            let jk = match kind.as_str() {
                "fixed" => JointKind::Fixed,
                "hinge" => JointKind::Hinge,
                "ball" => JointKind::Ball,
                "rope" => JointKind::Rope { max: number_option(&opts, "length")?.map_or(between(), |v| v as f32 / unit) },
                "spring" => JointKind::Spring {
                    length: number_option(&opts, "length")?.map_or(between(), |v| v as f32 / unit),
                    stiffness: raw("stiffness")?.unwrap_or(50.0),
                    damping: raw("damping")?.unwrap_or(2.0),
                },
                "slider" => JointKind::Slider,
                other => return Err(bad(format!("joint: '{other}' is not one of fixed, hinge, ball, rope, spring, slider"))),
            };
            let desc = JointDesc {
                kind: jk,
                anchor,
                anchor_b,
                axis: vec_option(&opts, "axis")?.unwrap_or(if three { [0.0, 1.0, 0.0] } else { [1.0, 0.0, 0.0] }),
                limits,
                motor,
                collide: bool_option(&opts, "collide")?.unwrap_or(false),
            };
            let j = if three { p.world3().joint(ia, ib, &desc) } else { p.world2().joint(ia, ib, &desc) };
            Ok(j.map(|j| if three { id3(j) } else { id2(j) }))
        })?,
    )?;
    let s = shared.clone();
    physics.set(
        "unjoint",
        lua.create_function(move |_, id: u32| {
            with(
                &mut s.borrow_mut().physics,
                id,
                |w, i, _| w.remove_joint(i),
                |w, i| w.remove_joint(i),
            );
            Ok(())
        })?,
    )?;
    // move(id, dx, dy, dz [, { slope, step, snap, mass }]) -> { x, y, z, ground } for a character body
    let s = shared.clone();
    physics.set(
        "move",
        lua.create_function(
            move |lua, (id, dx, dy, dz, opts): (u32, f64, f64, Option<f64>, Option<Table>)| {
                let mut sh = s.borrow_mut();
                let (three, i) = split_id(id).ok_or_else(|| bad("move: not a body"))?;
                let unit = if three { 1.0 } else { sh.physics.scale };
                let d = CharacterOpts::default();
                let o = CharacterOpts {
                    max_slope_degrees: number_option(&opts, "slope")?
                        .map_or(d.max_slope_degrees, |v| v as f32),
                    step: number_option(&opts, "step")?.map_or(d.step * unit, |v| v as f32) / unit,
                    snap: number_option(&opts, "snap")?.map_or(d.snap * unit, |v| v as f32) / unit,
                    mass: number_option(&opts, "mass")?.map_or(d.mass, |v| v as f32),
                };
                let delta = [
                    dx as f32 / unit,
                    dy as f32 / unit,
                    dz.unwrap_or(0.0) as f32 / unit,
                ];
                let dt = 1.0 / 60.0;
                let m = if three {
                    sh.physics
                        .d3
                        .as_mut()
                        .and_then(|w| w.character_move(i, delta, dt, &o))
                } else {
                    sh.physics
                        .d2
                        .as_mut()
                        .and_then(|w| w.character_move(i, [delta[0], delta[1], 0.0], dt, &o))
                }
                .ok_or_else(|| bad("move: the body is not a character (kind = \"character\")"))?;
                let t = lua.create_table()?;
                t.set("x", (m.pos[0] * unit) as f64)?;
                t.set("y", (m.pos[1] * unit) as f64)?;
                if three {
                    t.set("z", m.pos[2] as f64)?;
                }
                t.set("ground", m.grounded)?;
                Ok(t)
            },
        )?,
    )?;
    nova.set("physics", physics)?;
    Ok(())
}
