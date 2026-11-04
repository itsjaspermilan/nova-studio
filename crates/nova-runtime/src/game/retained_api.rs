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
    lod_distance2: f32,
    x: f32,
    z: f32,
    casts: bool,
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
                let distance = number_option(&opts, "lod_distance")?.unwrap_or(100.0) as f32;
                let slot = sh.retained.slot(&found);
                let lod_slot = lod.map_or(NO_LOD, |name| sh.retained.slot(&name));
                sh.retained
                    .cells
                    .entry((cell_of(x as f32), cell_of(z as f32)))
                    .or_default()
                    .push(Piece {
                        slot,
                        lod_slot,
                        lod_distance2: distance * distance,
                        x: x as f32,
                        z: z as f32,
                        casts,
                        instance: ModelInstance {
                            matrix: matrix.to_cols_array_2d(),
                            tint,
                        },
                    });
                sh.retained.count += 1;
                Ok(())
            },
        )?,
    )?;
    // draw_retained(x, z, radius): puts the pieces within `radius` metres of (x, z) into this frame
    let s = shared.clone();
    raw.set(
        "draw_retained",
        lua.create_function(move |_, (cx, cz, radius): (f64, f64, f64)| {
            let mut guard = s.borrow_mut();
            let sh = &mut *guard;
            let (cx, cz, radius) = (cx as f32, cz as f32, radius as f32);
            let meshes: Vec<Option<usize>> = sh
                .retained
                .names
                .iter()
                .map(|n| sh.mesh_ids.get(n).copied())
                .collect();
            let r2 = radius * radius;
            for gx in cell_of(cx - radius)..=cell_of(cx + radius) {
                for gz in cell_of(cz - radius)..=cell_of(cz + radius) {
                    let Some(list) = sh.retained.cells.get(&(gx, gz)) else {
                        continue;
                    };
                    for p in list {
                        let (dx, dz) = (p.x - cx, p.z - cz);
                        let d2 = dx * dx + dz * dz;
                        if d2 >= r2 {
                            continue;
                        }
                        let slot = if p.lod_slot != NO_LOD && d2 >= p.lod_distance2 {
                            p.lod_slot
                        } else {
                            p.slot
                        };
                        if let Some(mesh) = meshes[slot as usize] {
                            sh.models.push(ModelDraw {
                                casts: p.casts,
                                mesh,
                                instance: p.instance,
                            });
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
