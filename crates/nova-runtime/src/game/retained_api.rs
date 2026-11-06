//! The retained list of static models behind `nova.scenery`: pieces that never move are kept here, in Rust, in a grid of
//! squares, and put into the frame without Lua being asked about each one every frame (a call from Lua costs about a
//! microsecond a model, which is milliseconds for a town). A piece may name a cheaper model (`lod`) for when it is far.

use super::*;

const CELL: f32 = 40.0;
const NO_LOD: u32 = u32::MAX;

#[derive(Clone, Copy)]
struct Piece {
    slot: u32,
    lod_slot: u32,
    lod_distance: f32,
    lod_fade: f32,
    x: f32,
    z: f32,
    casts: bool,
    /// Beyond this many metres from the camera it is not drawn (it fades out over the last 12% of it): grass is not worth drawing far off.
    max_distance: f32,
    instance: ModelInstance,
}

#[derive(Default)]
pub(super) struct Retained {
    /// The model names pieces refer to, by slot (resolved to GPU meshes each frame, so that a reload of the GPU is harmless).
    names: Vec<String>,
    slots: HashMap<String, u32>,
    cells: HashMap<(i32, i32), Vec<Piece>>,
    count: usize,
}

impl Retained {
    fn slot(&mut self, name: &str) -> u32 {
        if let Some(&s) = self.slots.get(name) {
            return s;
        }
        let s = self.names.len() as u32;
        self.names.push(name.to_string());
        self.slots.insert(name.to_string(), s);
        s
    }
}

fn cell_of(v: f32) -> i32 {
    (v / CELL).floor() as i32
}

/// How far the scenery is drawn when nothing says (no fog to say where things end), in metres.
const AUTO_RANGE: f32 = 300.0;
/// The last share of the draw range over which a piece fades out instead of vanishing.
const RANGE_FADE: f32 = 0.12;

/// Which model of a pair to draw at distance `d`: the near one, the far one, or both (the share `t`, in (0, 1), is how much of
/// the far one: the near one is drawn dissolving by `-t` and the far one by `t`).
pub(super) enum Lod {
    Near,
    Far,
    Blend(f32),
}

/// The state of a pair of models at ground distance `d`, when the change is at `distance` and takes `fade` metres.
pub(super) fn lod_state(d: f32, distance: f32, fade: f32) -> Lod {
    let t = if fade > 0.0 {
        ((d - (distance - fade * 0.5)) / fade).clamp(0.0, 1.0)
    } else if d >= distance {
        1.0
    } else {
        0.0
    };
    if t <= 0.0 {
        Lod::Near
    } else if t >= 1.0 {
        Lod::Far
    } else {
        Lod::Blend(t)
    }
}

/// What to draw of a piece `d` metres away (on the ground) when the range is `radius`: up to two (model slot, dissolve) pairs.
/// Nothing past the range; the cheaper model past `lod_distance`; between the two, across `lod_fade` metres, both, each
/// fading by a screen-door (the near one by `-t`, the far one by `t`, which fill every pixel once together); and a piece
/// that is alone fades out over the last [`RANGE_FADE`] of the range. A dissolve of 0 means solid.
fn pick(p: &Piece, d: f32, radius: f32) -> [Option<(u32, f32)>; 2] {
    let radius = radius.min(p.max_distance);
    if d >= radius {
        return [None, None];
    }
    let edge = radius * (1.0 - RANGE_FADE);
    let fade_out = ((d - edge) / (radius - edge)).clamp(0.0, 1.0);
    let alone = |slot: u32| {
        [
            Some((slot, if fade_out > 0.0 { -fade_out } else { 0.0 })),
            None,
        ]
    };
    if p.lod_slot == NO_LOD {
        return alone(p.slot);
    }
    match lod_state(d, p.lod_distance, p.lod_fade) {
        Lod::Near => alone(p.slot),
        Lod::Far => alone(p.lod_slot),
        Lod::Blend(t) => [Some((p.slot, -t)), Some((p.lod_slot, t))],
    }
}

pub(super) fn install(lua: &Lua, shared: &Rc<RefCell<Shared>>, raw: &Table) -> mlua::Result<()> {
    // add(model, x, y, z, opts): opts are `ry`, `rx`, `rz`, `scale`, `tint`, `shadow`, `lod` (a model name) and
    // `lod_distance` (metres, from the camera on the ground)
    let s = shared.clone();
    raw.set(
        "retain",
        lua.create_function(
            move |_, (id, x, y, z, opts): (String, f64, f64, f64, Option<Table>)| {
                let mut sh = s.borrow_mut();
                let find = |sh: &Shared, name: &str| {
                    find_model(&sh.known_models, name).ok_or_else(|| {
                        lua_err(format!(
                            "unknown model '{name}' (looked for '{name}' and 'models/{name}.glb'; models in this project: {})",
                            if sh.known_models.is_empty() { "none".into() } else { sh.known_models.join(", ") }
                        ))
                    })
                };
                let found = find(&sh, &id)?;
                let lod = match string_option(&opts, "lod")? {
                    Some(name) => Some(find(&sh, &name)?),
                    None => None,
                };
                let scale = number_option(&opts, "scale")?.unwrap_or(1.0) as f32;
                let matrix = Mat4::from_translation(Vec3::new(x as f32, y as f32, z as f32))
                    * Mat4::from_rotation_y(number_option(&opts, "ry")?.unwrap_or(0.0) as f32)
                    * Mat4::from_rotation_x(number_option(&opts, "rx")?.unwrap_or(0.0) as f32)
                    * Mat4::from_rotation_z(number_option(&opts, "rz")?.unwrap_or(0.0) as f32)
                    * Mat4::from_scale(Vec3::splat(scale));
                let tint = color_option(&opts, "tint", [255; 4])?.map(|c| c as f32 / 255.0);
                let casts = match &opts {
                    Some(o) => o.get::<Option<bool>>("shadow")?.unwrap_or(true),
                    None => true,
                };
                let distance = number_option(&opts, "lod_distance")?.unwrap_or(100.0).max(1.0) as f32;
                let sway = number_option(&opts, "sway")?.unwrap_or(0.0) as f32;
                let max_distance = number_option(&opts, "max_distance")?.map_or(f32::INFINITY, |d| d as f32);
                // the metres over which the two models trade places (they are both drawn, each fading by a screen-door)
                let fade = number_option(&opts, "lod_fade")?.map_or(distance * 0.15, |f| f as f32).max(0.0);
                let instance = ModelInstance {
                    matrix: matrix.to_cols_array_2d(),
                    tint,
                };
                let slot = sh.retained.slot(&found);
                let lod_slot = lod.map_or(NO_LOD, |name| sh.retained.slot(&name));
                sh.retained
                    .cells
                    .entry((cell_of(x as f32), cell_of(z as f32)))
                    .or_default()
                    .push(Piece {
                        slot,
                        lod_slot,
                        lod_distance: distance,
                        lod_fade: fade,
                        x: x as f32,
                        z: z as f32,
                        casts,
                        max_distance,
                        instance: if sway != 0.0 {
                            instance.swaying(sway)
                        } else {
                            instance
                        },
                    });
                sh.retained.count += 1;
                Ok(())
            },
        )?,
    )?;
    // draw_retained(x, z [, radius]): puts the pieces within `radius` metres of (x, z) into this frame (by default out to
    // where the fog has covered everything, or 300 m without fog)
    let s = shared.clone();
    raw.set(
        "draw_retained",
        lua.create_function(move |_, (cx, cz, radius): (f64, f64, Option<f64>)| {
            let mut guard = s.borrow_mut();
            let sh = &mut *guard;
            let radius = radius.map_or_else(
                || match sh.lighting.fog {
                    Some(f) if f.far.is_finite() && f.far > 1.0 => {
                        (f.far * 1.05).clamp(20.0, 400.0)
                    }
                    _ => AUTO_RANGE,
                },
                |r| r as f32,
            );
            let (cx, cz) = (cx as f32, cz as f32);
            let meshes: Vec<Option<usize>> = sh
                .retained
                .names
                .iter()
                .map(|n| sh.mesh_ids.get(n).copied())
                .collect();
            for gx in cell_of(cx - radius)..=cell_of(cx + radius) {
                for gz in cell_of(cz - radius)..=cell_of(cz + radius) {
                    let Some(list) = sh.retained.cells.get(&(gx, gz)) else {
                        continue;
                    };
                    for p in list {
                        let (dx, dz) = (p.x - cx, p.z - cz);
                        let d = (dx * dx + dz * dz).sqrt();
                        for (slot, dissolve) in pick(p, d, radius).into_iter().flatten() {
                            if let Some(mesh) = meshes[slot as usize] {
                                let instance = if dissolve == 0.0 {
                                    p.instance
                                } else {
                                    p.instance.dissolving(dissolve)
                                };
                                sh.models.push(ModelDraw {
                                    casts: p.casts,
                                    mesh,
                                    instance,
                                });
                            }
                        }
                    }
                }
            }
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    raw.set(
        "clear_retained",
        lua.create_function(move |_, ()| {
            let mut sh = s.borrow_mut();
            sh.retained.cells.clear();
            sh.retained.count = 0;
            Ok(())
        })?,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn piece(lod: bool) -> Piece {
        Piece {
            slot: 0,
            lod_slot: if lod { 1 } else { NO_LOD },
            lod_distance: 100.0,
            lod_fade: 20.0,
            x: 0.0,
            z: 0.0,
            casts: true,
            max_distance: f32::INFINITY,
            instance: ModelInstance {
                matrix: [[0.0; 4]; 4],
                tint: [1.0; 4],
            },
        }
    }

    #[test]
    fn a_piece_trades_places_with_its_far_model_across_the_fade_without_a_gap() {
        let p = piece(true);
        assert_eq!(pick(&p, 50.0, 300.0), [Some((0, 0.0)), None]);
        assert_eq!(
            pick(&p, 90.0, 300.0),
            [Some((0, 0.0)), None],
            "up to the start of the fade"
        );
        assert_eq!(
            pick(&p, 120.0, 300.0),
            [Some((1, 0.0)), None],
            "from its end"
        );
        // in between both are drawn, with shares that add up to every pixel
        let [near, far] = pick(&p, 105.0, 300.0);
        let (near, far) = (near.unwrap(), far.unwrap());
        assert_eq!((near.0, far.0), (0, 1));
        assert!(near.1 < 0.0 && far.1 > 0.0);
        assert!(
            (near.1 + far.1).abs() < 1e-6,
            "{near:?} {far:?}: the near one drops what the far one keeps"
        );
        // and the far one takes over steadily
        let kept = |d| pick(&p, d, 300.0)[1].map_or(0.0, |(_, t)| t);
        assert!(kept(95.0) < kept(100.0) && kept(100.0) < kept(108.0));
    }

    #[test]
    fn a_piece_fades_out_over_the_end_of_the_range_instead_of_vanishing() {
        let p = piece(false);
        assert_eq!(pick(&p, 200.0, 300.0), [Some((0, 0.0)), None]);
        let [a, _] = pick(&p, 270.0, 300.0);
        let [b, _] = pick(&p, 295.0, 300.0);
        assert!(
            a.unwrap().1 > b.unwrap().1,
            "fading: more of it is dropped nearer the end"
        );
        assert!(b.unwrap().1 > -1.0 && b.unwrap().1 < 0.0);
        assert_eq!(pick(&p, 300.0, 300.0), [None, None]);
    }
}
