//! A running Nova project: its Lua scripts, decoded assets and the per-frame draw lists
//! that scripts fill through the `nova` API.
//!
//! API v1 is immediate mode: scripts call `nova.sprite`, `nova.model`, `nova.ui.text` and
//! friends from `update(dt)` / `draw()`, and the engine renders what was asked that frame.
//! Scenes, entities, tilemaps and animation arrive on top of this in later M2 slices.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use glam::{Mat4, Quat, Vec3};
use mlua::{Function, HookTriggers, Lua, LuaSerdeExt, Table, Value, VmState};

use crate::actions::{self, ActionStates, Binding, Bindings, InputFrame};
use crate::assets::{self, AtlasLayout};
use crate::font;
use crate::gfx::{
    Camera, Fog, FrameInput, Gfx, Lighting, Look, MeshOp, ModelDraw, ModelInstance, PointLight,
    Shadows, Sky, SpriteInstance, Wind,
};
use crate::input::Actions;
use crate::mixer::{self, Sample};
use crate::model::{self, Image, MeshData};
use crate::project::{AssetKind, Project};
use crate::save::SaveStore;
use crate::scene;
use crate::script::new_lua;
use crate::sprite::{self, SpriteDef};
use crate::stream::StreamSource;
use crate::text::{self as vtext, Align, TextEngine};
use crate::tilemap::TileMap;
use crate::vfs::Vfs;

impl Drop for Game {
    fn drop(&mut self) {
        self.flush_save();
    }
}

/// Stability limits for hand-written scripts (not a hostile-code sandbox): one frame of
/// `update` + `draw` may take this long before it is stopped, and loading a project
/// (the entry script and `init`) gets a longer allowance. Lua may use this much memory.
pub const FRAME_BUDGET: Duration = Duration::from_millis(1000);
pub const LOAD_BUDGET: Duration = Duration::from_millis(5000);
pub const LUA_MEMORY_LIMIT: usize = 256 << 20;

/// The entity/scene/timer framework, written in Lua and loaded before every project's
/// entry script. It only takes over the frame when a game calls `nova.start`.
const FRAMEWORK: &str = include_str!("../lua/framework.lua");

fn builtin_module(name: &str) -> Option<&'static str> {
    match name {
        "nova.timers" => Some(include_str!("../lua/timers.lua")),
        _ => None,
    }
}

mod retained_api;
mod solid_api;
mod billboard_api;
mod voxel_api;
mod walls_api;

/// Lone cubes (`nova.voxel.cube`) have mesh ids this far above the start of script-made meshes, above every chunk piece.
const CUBE_MESH_OFFSET: usize = 1 << 28;

const DEFAULT_CAMERA: Camera = Camera {
    eye: Vec3::new(0.0, 6.0, -10.0),
    target: Vec3::new(0.0, 1.0, 0.0),
    fov_y_degrees: 60.0,
};

struct Shared {
    bindings: Bindings,
    base_bindings: Bindings,
    states: ActionStates,
    last_source: Option<String>,
    /// The newest source pressed that a script has not asked about yet (`nova.input.next_source`).
    pending_source: Option<String>,
    fixed_steps: bool,
    view: [f32; 2],
    time: f64,
    layout: AtlasLayout,
    sheets: HashMap<String, SpriteDef>,
    tilemaps: Vec<TileMap>,
    text: TextEngine,
    text_out: Vec<SpriteInstance>,
    pixel_scale: f32,
    sounds: HashMap<String, Arc<Sample>>,
    /// Ogg music in `music/`: kept compressed and decoded a little ahead while it plays.
    streams: HashMap<String, StreamSource>,
    /// The music that is playing now, so `nova.music.seek` knows how to restart it.
    current_music: Option<(Option<StreamSource>, bool)>,
    /// Seconds into that track as last reported by the audio thread.
    music_position: Option<f64>,
    audio: Vec<mixer::Command>,
    rumble: Vec<Rumble>,
    host_stats: HostStats,
    /// The pointer as the host last reported it, what built up since the last step, and what this step sees.
    pointer_now: actions::PointerFrame,
    pointer_acc: actions::PointerFrame,
    pointer_step: actions::PointerFrame,
    /// A script asked for the mouse to be locked (true) or freed (false); the host reads it once.
    grab_request: Option<bool>,
    /// What the scripts took last frame (ms) and the memory they use (KB), for `nova.stats()`.
    lua_ms: f32,
    lua_kb: f32,
    next_sound: u64,
    save: SaveStore,
    mesh_ids: HashMap<String, usize>,
    /// Point lights asked for this frame, and what the last frames made of them (which are lit, how far each has faded in).
    light_requests: Vec<PointLight>,
    light_fader: crate::lights::LightFader,
    /// The static models of `nova.scenery`, kept between frames.
    retained: retained_api::Retained,
    /// Triangle collision (`nova.solid`).
    solid: crate::meshworld::MeshWorld,
    known_models: Vec<String>,
    /// The pictures `nova.billboard` can draw (images in `sprites/fx/`) and how many frames each has.
    fx_sprites: HashMap<String, u32>,
    /// The default drawing scale of each model (`extras.nova.scale`), in the order of `known_models`.
    model_scales: HashMap<String, f32>,
    /// Each model's parts, for drawing pieces that move on their own.
    parts: HashMap<String, Vec<PartRt>>,
    /// Each model's animation clips.
    clips: HashMap<String, Vec<model::Clip>>,
    /// Collision circles `[x, z, r]` of each model, from its file.
    colliders: HashMap<String, Vec<[f32; 3]>>,
    lighting: Lighting,
    world: Vec<SpriteInstance>,
    ui: Vec<SpriteInstance>,
    models: Vec<ModelDraw>,
    /// Meshes drawn in the UI layer this frame (`nova.ui.cube`).
    ui_models: Vec<ModelDraw>,
    /// Joint matrices of the skinned parts drawn this frame (see `FrameInput::joints`).
    joints: Vec<[[f32; 4]; 4]>,
    /// The voxel world (`nova.voxel`), and the mesh of each block kind drawn as a lone cube.
    voxel: crate::voxel::World,
    cubes: HashMap<u8, usize>,
    /// The walls of an indoor level and the grid creatures find their way over (`nova.walls`, `nova.nav`).
    walls: crate::walls::Walls,
    nav: crate::walls::Nav,
    /// Meshes made by `nova.bake.level`, by the handle the script holds (None once freed).
    baked: Vec<Option<usize>>,
    cursor: PadCursor,
    /// Typed characters that no script has read yet.
    typed: String,
    /// This frame's sources and length, for the cursor (kept only while it is on).
    cursor_sources: HashMap<String, f32>,
    frame_dt: f32,
    /// `nova.pause` also stills the engine's own clock (`nova.time`, the wind, the clouds and the stars): while frozen the time stays at `frozen_at`,
    /// and `offset` is how much of the real time has been spent frozen (so that time carries on from where it stopped).
    frozen: bool,
    frozen_at: f64,
    real_time: f64,
    time_offset: f64,
    /// For the profiler: the script time limit's clock and what has been seen.
    deadline: Rc<Cell<Option<Instant>>>,
    profile: Rc<RefCell<Profile>>,
    camera: Camera,
    clear: [f64; 4],
    log: Vec<String>,
}

impl Shared {
    /// Adds a frame's pointer to what is waiting for the next step: presses, releases, movement and scrolling are kept until a
    /// step has seen them (a frame can pass without a step on a fast screen).
    fn take_pointer(&mut self, p: &actions::PointerFrame) {
        let acc = &mut self.pointer_acc;
        acc.pressed |= p.pressed;
        acc.released |= p.released;
        acc.dx += p.dx;
        acc.dy += p.dy;
        acc.wheel += p.wheel;
        self.pointer_now = *p;
    }

    /// The pointer a step sees: where it is and what is held now, and what happened since the last step.
    fn begin_pointer_step(&mut self) {
        let acc = std::mem::take(&mut self.pointer_acc);
        self.pointer_step = actions::PointerFrame {
            pressed: acc.pressed,
            released: acc.released,
            dx: acc.dx,
            dy: acc.dy,
            wheel: acc.wheel,
            ..self.pointer_now
        };
        if self.cursor.enabled {
            self.cursor_step();
        }
    }

    /// The pad cursor's part of a step: a stick moves it, a button clicks it, and while it is in use it is the pointer.
    fn cursor_step(&mut self) {
        let dt = if self.fixed_steps {
            1.0 / 60.0
        } else {
            self.frame_dt
        };
        let get = |k: &str| self.cursor_sources.get(k).copied().unwrap_or(0.0);
        let (ax, ay) = if self.cursor.left_stick {
            (get("axis:left_x"), get("axis:left_y"))
        } else {
            (get("axis:right_x"), get("axis:right_y"))
        };
        let dead = |v: f32| if v.abs() < 0.2 { 0.0 } else { v };
        let (sx, sy) = (dead(ax), dead(ay));
        let down = get("pad:south") > 0.5 || get("axis:r2") > 0.5;
        let real_moved =
            self.pointer_step.dx != 0.0 || self.pointer_step.dy != 0.0 || self.pointer_step.pressed;
        let c = &mut self.cursor;
        if c.x == 0.0 && c.y == 0.0 {
            (c.x, c.y) = (self.view[0] * 0.5, self.view[1] * 0.5);
        }
        if real_moved {
            // a mouse or a finger takes over, and the cursor will start from where it is
            c.active = false;
            (c.x, c.y) = (self.pointer_step.x, self.pointer_step.y);
        } else if sx != 0.0 || sy != 0.0 {
            c.active = true;
        }
        let (dx, dy) = (sx * c.speed * dt, sy * c.speed * dt);
        if c.active {
            c.x = (c.x + dx).clamp(0.0, self.view[0]);
            c.y = (c.y + dy).clamp(0.0, self.view[1]);
            self.pointer_step = actions::PointerFrame {
                present: true,
                x: c.x,
                y: c.y,
                dx,
                dy,
                down,
                pressed: down && !c.was_down,
                released: !down && c.was_down,
                wheel: self.pointer_step.wheel,
                ..actions::PointerFrame::default()
            };
        }
        c.was_down = down;
    }
}

/// What the host measured about the previous frame, for `nova.stats()`.
#[derive(Clone, Copy, Debug, Default)]
pub struct HostStats {
    pub fps: f32,
    pub render_ms: f32,
    pub draw_calls: u32,
    pub triangles: u32,
    pub sprites: u32,
}

/// A request from a script to shake a gamepad (`nova.input.rumble`); the host passes it on where it can.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rumble {
    /// The pad to shake, 1 up to `actions::MAX_PADS`; 0 shakes them all.
    pub pad: u8,
    /// The big (low) motor and the small (high) one, 0 to 1.
    pub strong: f32,
    pub weak: f32,
    pub seconds: f32,
}

/// A model part as the game draws it: its place in the tree and the GPU mesh key of its triangles.
#[derive(Clone)]
struct PartRt {
    name: String,
    parent: Option<usize>,
    rest: Mat4,
    mesh_key: Option<String>,
    /// A mesh that bends with other parts: drawn by the GPU from the joints' matrices.
    skinned: Option<Rc<SkinnedPart>>,
}

struct SkinnedPart {
    /// Which parts the joints are, and their inverse rest matrices.
    skin: model::Skin,
    /// The one mesh (at rest, model space), uploaded with its joint weights.
    key: String,
}

/// A table of three 0-255 numbers as linear multipliers (255 is full strength).
/// A colour as picked on screen ({r, g, b}, 0 to 255) made linear, as `nova.clear` does: for what is drawn, not for light.
fn picture_color(table: &Table, key: &str) -> mlua::Result<Option<[f32; 3]>> {
    Ok(light_color(table, key)?.map(|c| c.map(|v| v.powf(2.2))))
}

fn light_color(table: &Table, key: &str) -> mlua::Result<Option<[f32; 3]>> {
    let Some(c) = table.get::<Option<Table>>(key)? else {
        return Ok(None);
    };
    let mut out = [0.0f32; 3];
    for (i, slot) in out.iter_mut().enumerate() {
        let v: f64 = c
            .get::<Option<f64>>(i + 1)?
            .ok_or_else(|| lua_err(format!("{key} must be {{r, g, b}} with values 0 to 255")))?;
        if !(0.0..=255.0).contains(&v) {
            return Err(lua_err(format!(
                "{key} must be {{r, g, b}} with values 0 to 255, not {v}"
            )));
        }
        *slot = (v / 255.0) as f32;
    }
    Ok(Some(out))
}

/// Where each part of a model is, in the model's own space, for the pose the options of `nova.model` describe: a `clip`, mixed
/// `layers` (with their masks and additive ones) and the script's own turns in `parts`. Returns the parts and a matrix for each.
#[allow(clippy::too_many_arguments)]
fn part_worlds(
    sh: &Shared,
    found: &str,
    id: &str,
    opts: &Option<Table>,
    clip_name: &Option<String>,
    layers: &Option<Table>,
    overrides: &Option<Table>,
    ignore_turns: &[&str],
) -> mlua::Result<(Vec<PartRt>, Vec<Mat4>)> {
    let parts = sh.parts.get(found).cloned().unwrap_or_default();
    // A clip first (it replaces what it animates of each part's authored place) ...
    let mut poses = vec![model::PartPose::default(); parts.len()];
    if let Some(name) = &clip_name {
        let clips = sh.clips.get(found).map(Vec::as_slice).unwrap_or(&[]);
        let clip = clips.iter().find(|c| &c.name == name).ok_or_else(|| {
            lua_err(format!(
                "model '{id}' has no clip '{name}' (its clips: {})",
                if clips.is_empty() {
                    "none".to_string()
                } else {
                    clips
                        .iter()
                        .map(|c| c.name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                }
            ))
        })?;
        let time = number_option(opts, "time")?.unwrap_or(0.0) as f32;
        let looped = match &opts {
            Some(o) => o.get::<Option<bool>>("loop")?.unwrap_or(true),
            None => true,
        };
        poses = clip.pose(time, looped, parts.len());
    }
    if let Some(layers) = &layers {
        let clips = sh.clips.get(found).map(Vec::as_slice).unwrap_or(&[]);
        let mut mixed: Vec<(Vec<model::PartPose>, f32)> = Vec::new();
        // layers with a `mask` are laid over the mix afterwards, on those parts only
        let mut overlays: Vec<(Vec<model::PartPose>, f32, Vec<bool>)> = Vec::new();
        // layers with `additive = true` add how far they are from the rest pose, on top of everything else
        let mut additives: Vec<(Vec<model::PartPose>, f32, Option<Vec<bool>>)> = Vec::new();
        for entry in layers.sequence_values::<Table>() {
            let entry = entry?;
            let name: String = entry.get::<Option<String>>("clip")?.ok_or_else(|| {
                lua_err("each layer needs a clip name: { clip = \"walk\", time = 0.5, weight = 1 }")
            })?;
            let clip = clips.iter().find(|c| c.name == name).ok_or_else(|| {
                lua_err(format!(
                    "model '{id}' has no clip '{name}' (its clips: {})",
                    if clips.is_empty() {
                        "none".to_string()
                    } else {
                        clips
                            .iter()
                            .map(|c| c.name.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    }
                ))
            })?;
            let weight = entry.get::<Option<f64>>("weight")?.unwrap_or(1.0);
            if !weight.is_finite() || weight < 0.0 {
                return Err(lua_err("a layer's weight must be 0 or more"));
            }
            if weight == 0.0 {
                continue;
            }
            let time = entry.get::<Option<f64>>("time")?.unwrap_or(0.0) as f32;
            let looped = entry.get::<Option<bool>>("loop")?.unwrap_or(true);
            let additive = entry.get::<Option<bool>>("additive")?.unwrap_or(false);
            if let Some(names) = entry.get::<Option<Table>>("mask")? {
                // the named parts and everything below them (parents come before their children)
                let mut mask = vec![false; parts.len()];
                for name in names.sequence_values::<String>() {
                    let name = name?;
                    let index = parts.iter().position(|p| p.name == name).ok_or_else(|| {
                        lua_err(format!(
                            "model '{id}' has no part '{name}' for a layer's mask (its parts: {})",
                            parts
                                .iter()
                                .map(|p| p.name.as_str())
                                .collect::<Vec<_>>()
                                .join(", ")
                        ))
                    })?;
                    mask[index] = true;
                }
                for j in 0..parts.len() {
                    if parts[j].parent.is_some_and(|parent| mask[parent]) {
                        mask[j] = true;
                    }
                }
                if additive {
                    additives.push((
                        clip.pose(time, looped, parts.len()),
                        weight as f32,
                        Some(mask),
                    ));
                } else {
                    overlays.push((
                        clip.pose(time, looped, parts.len()),
                        (weight as f32).min(1.0),
                        mask,
                    ));
                }
            } else if additive {
                additives.push((clip.pose(time, looped, parts.len()), weight as f32, None));
            } else {
                mixed.push((clip.pose(time, looped, parts.len()), weight as f32));
            }
        }
        let rests: Vec<(Vec3, Quat, Vec3)> = parts
            .iter()
            .map(|p| {
                let (s, r, t) = p.rest.to_scale_rotation_translation();
                (s, r, t)
            })
            .collect();
        poses = model::blend_poses(&rests, &mixed);
        for (overlay, amount, mask) in &overlays {
            poses = model::overlay_poses(&rests, &poses, overlay, mask, *amount);
        }
        for (delta, amount, mask) in &additives {
            poses = model::additive_poses(&rests, &poses, delta, mask.as_deref(), *amount);
        }
    }
    // ... then the script's own turns on top.
    let mut turn = vec![Mat4::IDENTITY; parts.len()];
    let named: Vec<(String, Table)> = match &overrides {
        Some(t) => t.pairs::<String, Table>().collect::<mlua::Result<_>>()?,
        None => Vec::new(),
    };
    for (name, t) in named {
        let index = parts.iter().position(|p| p.name == name).ok_or_else(|| {
            lua_err(format!(
                "model '{id}' has no part '{name}' (its parts: {})",
                parts
                    .iter()
                    .map(|p| p.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })?;
        if ignore_turns.contains(&name.as_str()) {
            continue;
        }
        turn[index] = part_transform(&t, id, &name)?;
    }
    let mut world = vec![Mat4::IDENTITY; parts.len()];
    for (i, p) in parts.iter().enumerate() {
        let (s0, r0, t0) = p.rest.to_scale_rotation_translation();
        let pose = poses[i];
        let authored = Mat4::from_scale_rotation_translation(
            pose.scale.unwrap_or(s0),
            pose.rotation.unwrap_or(r0),
            pose.translation.unwrap_or(t0),
        );
        let local = authored * turn[i];
        world[i] = p.parent.map_or(local, |parent| world[parent] * local);
    }
    Ok((parts, world))
}

/// A turn, shift and scale applied to one model part on top of its authored place.
fn part_transform(t: &Table, model: &str, part: &str) -> mlua::Result<Mat4> {
    let n = |key: &str| -> mlua::Result<f64> {
        let v = t.get::<Option<f64>>(key)?.unwrap_or(0.0);
        if v.is_finite() {
            Ok(v)
        } else {
            Err(lua_err(format!(
                "parts.{part}.{key} of model '{model}' must be a finite number"
            )))
        }
    };
    let scale = t.get::<Option<f64>>("scale")?.unwrap_or(1.0);
    if !scale.is_finite() || scale <= 0.0 {
        return Err(lua_err(format!(
            "parts.{part}.scale of model '{model}' must be greater than 0"
        )));
    }
    // `quat = {x, y, z, w}` is a turn as a quaternion (what `nova.ik` returns), instead of rx, ry and rz
    let turn = match t.get::<Option<Table>>("quat")? {
        Some(q) => {
            let mut v = [0.0f32; 4];
            for (i, slot) in v.iter_mut().enumerate() {
                let k = ["x", "y", "z", "w"][i];
                let c = q.get::<Option<f64>>(k)?.ok_or_else(|| {
                    lua_err(format!(
                        "parts.{part}.quat of model '{model}' must be {{x, y, z, w}}"
                    ))
                })?;
                if !c.is_finite() {
                    return Err(lua_err(format!(
                        "parts.{part}.quat of model '{model}' must be finite numbers"
                    )));
                }
                *slot = c as f32;
            }
            Mat4::from_quat(Quat::from_xyzw(v[0], v[1], v[2], v[3]).normalize())
        }
        None => {
            Mat4::from_rotation_y(n("ry")? as f32)
                * Mat4::from_rotation_x(n("rx")? as f32)
                * Mat4::from_rotation_z(n("rz")? as f32)
        }
    };
    Ok(
        Mat4::from_translation(Vec3::new(n("x")? as f32, n("y")? as f32, n("z")? as f32))
            * turn
            * Mat4::from_scale(Vec3::splat(scale as f32)),
    )
}

/// Where decoded assets go. `Gfx` is the real target; tests use a fake so project
/// logic can be exercised without a GPU.
pub trait Uploader {
    fn set_atlas(&mut self, atlas: &Image);
    fn add_mesh(&mut self, mesh: &MeshData) -> usize;
    /// A mesh bent by joints: per vertex up to four joint numbers and weights. A target without joints draws it at rest.
    fn add_skinned_mesh(&mut self, mesh: &MeshData, _influences: &[([u16; 4], [f32; 4])]) -> usize {
        self.add_mesh(mesh)
    }
}

impl Uploader for Gfx {
    fn set_atlas(&mut self, atlas: &Image) {
        self.set_sprite_atlas(atlas);
    }
    fn add_mesh(&mut self, mesh: &MeshData) -> usize {
        self.upload_mesh(mesh)
    }
    fn add_skinned_mesh(&mut self, mesh: &MeshData, influences: &[([u16; 4], [f32; 4])]) -> usize {
        self.upload_skinned_mesh(mesh, influences)
    }
}

/// An uploader that keeps nothing: for checking a project without a GPU.
#[derive(Default)]
pub struct NullUploader(usize);

impl Uploader for NullUploader {
    fn set_atlas(&mut self, _atlas: &Image) {}
    fn add_mesh(&mut self, _mesh: &MeshData) -> usize {
        self.0 += 1;
        self.0 - 1
    }
}

pub struct Game {
    pub project: Project,
    deadline: Rc<Cell<Option<Instant>>>,
    vfs: Rc<dyn Vfs>,
    lua: Lua,
    shared: Rc<RefCell<Shared>>,
    atlas: Option<Image>,
    meshes: Vec<(String, MeshData, Option<Vec<model::Influence>>)>,
    world: Vec<SpriteInstance>,
    ui: Vec<SpriteInstance>,
    text: Vec<SpriteInstance>,
    models: Vec<ModelDraw>,
    ui_models: Vec<ModelDraw>,
    joints: Vec<[[f32; 4]; 4]>,
    /// Meshes made by scripts that the renderer has not applied yet (see `clear_mesh_ops`).
    mesh_ops: Vec<MeshOp>,
    camera: Camera,
    lighting: Lighting,
    clear: [f64; 4],
    pub error: Option<String>,
    /// The complete error text including any Lua traceback (the banner shows only `error`).
    pub error_detail: Option<String>,
    pub warnings: Vec<String>,
    pub last_update: Duration,
    stamp: Option<SystemTime>,
    checked: Instant,
    last_flush: Instant,
    save_dir: Option<std::path::PathBuf>,
}

/// A pointer moved by a gamepad stick, for menus built for a mouse (`nova.input.cursor`).
struct PadCursor {
    enabled: bool,
    /// The stick has been used since the real pointer last moved.
    active: bool,
    draw: bool,
    left_stick: bool,
    speed: f32,
    x: f32,
    y: f32,
    was_down: bool,
}

impl Default for PadCursor {
    fn default() -> Self {
        Self {
            enabled: false,
            active: false,
            draw: true,
            left_stick: false,
            speed: 700.0,
            x: 0.0,
            y: 0.0,
            was_down: false,
        }
    }
}

/// What the Lua profiler has seen: time charged to the function that was running when each sample was taken.
#[derive(Default)]
struct Profile {
    on: bool,
    last: Option<Instant>,
    /// Calls into the engine that have begun and not returned: when, and what they are called.
    native: Vec<(Instant, String)>,
    by_function: HashMap<String, (f64, u32)>,
    total_ms: f64,
}

/// The hook that runs every so many VM instructions: it stops a script that has run too long in a frame, and while
/// profiling it also charges the time since the last look to the function that is running now (time spent in the engine
/// on that function's behalf, in nova.* calls, counts for it).
fn install_hook(
    lua: &Lua,
    deadline: Rc<Cell<Option<Instant>>>,
    profile: Rc<RefCell<Profile>>,
    profiling: bool,
) -> mlua::Result<()> {
    let triggers = if profiling {
        // calls and returns too, so that time inside the engine (nova.* functions) is charged to them by name
        HookTriggers::new()
            .every_nth_instruction(2_000)
            .on_calls()
            .on_returns()
    } else {
        HookTriggers::new().every_nth_instruction(20_000)
    };
    lua.set_global_hook(triggers, move |_, debug| {
        let now = Instant::now();
        if profiling {
            let mut p = profile.borrow_mut();
            match debug.event() {
                mlua::debug::DebugEvent::Call => {
                    if debug.source().what == "C" {
                        let name = debug.names().name.as_deref().unwrap_or("?").to_string();
                        p.native.push((now, name));
                    }
                }
                mlua::debug::DebugEvent::Ret => {
                    if debug.source().what == "C"
                        && let Some((start, name)) = p.native.pop()
                    {
                        let spent = now - start;
                        let ms = spent.as_secs_f64() * 1000.0;
                        let entry = p
                            .by_function
                            .entry(format!("(engine) {name}"))
                            .or_insert((0.0, 0));
                        entry.0 += ms;
                        entry.1 += 1;
                        p.total_ms += ms;
                        // the Lua around it did not spend that time
                        if let Some(last) = p.last {
                            p.last = Some(last + spent);
                        }
                    }
                }
                mlua::debug::DebugEvent::Count => {
                    if let Some(last) = p.last {
                        let ms = (now - last).as_secs_f64() * 1000.0;
                        let (names, source) = (debug.names(), debug.source());
                        let name = format!(
                            "{} ({}:{})",
                            names.name.as_deref().unwrap_or("?"),
                            source.short_src.as_deref().unwrap_or("?"),
                            source.line_defined.unwrap_or(0)
                        );
                        let entry = p.by_function.entry(name).or_insert((0.0, 0));
                        entry.0 += ms;
                        entry.1 += 1;
                        p.total_ms += ms;
                    }
                    p.last = Some(now);
                }
                _ => {}
            }
        }
        match deadline.get() {
            Some(limit) if now > limit => Err(lua_err(
                "the script ran for too long in one frame; is there an endless loop?",
            )),
            _ => Ok(VmState::Continue),
        }
    })
}

/// How loud a sound at a place in the world is, and how far to the left or right, for a listener at the camera:
/// the volume falls off to nothing at `range` metres (a square law, so it dies away gently), the pan is the sideways part
/// of the way to it. Returns (gain, pan).
fn spatial(camera: &Camera, at: [f32; 3], range: f32) -> (f32, f32) {
    let to = Vec3::from(at) - camera.eye;
    let d = to.length();
    let gain = (1.0 - d / range.max(0.1)).clamp(0.0, 1.0).powi(2);
    let forward = (camera.target - camera.eye).normalize_or_zero();
    let right = forward.cross(Vec3::Y).normalize_or_zero();
    // right under the listener a sound has no side
    let pan = if d < 0.5 {
        0.0
    } else {
        (to / d).dot(right) * 0.9
    };
    (gain, pan.clamp(-1.0, 1.0))
}

/// `at = {x, y, z}` and `range` from a table of options.
fn spatial_options(opts: &Option<Table>) -> mlua::Result<Option<([f32; 3], f32)>> {
    let Some(t) = opts else { return Ok(None) };
    let Some(at) = t.get::<Option<Table>>("at")? else {
        return Ok(None);
    };
    let get = |i: usize| -> mlua::Result<f32> {
        at.get::<Option<f64>>(i)?
            .map(|v| v as f32)
            .ok_or_else(|| lua_err("at must be {x, y, z}: the place the sound comes from"))
    };
    let range = number_option(opts, "range")?.unwrap_or(32.0) as f32;
    Ok(Some(([get(1)?, get(2)?, get(3)?], range)))
}

fn lua_err(message: impl Into<String>) -> mlua::Error {
    mlua::Error::runtime(message.into())
}

fn first_line(text: &str) -> String {
    text.lines().next().unwrap_or("script error").to_string()
}

fn srgb_to_linear(c: [f64; 4]) -> [f64; 4] {
    [c[0].powf(2.2), c[1].powf(2.2), c[2].powf(2.2), c[3]]
}

fn color_option(opts: &Option<Table>, key: &str, default: [u8; 4]) -> mlua::Result<[u8; 4]> {
    let Some(opts) = opts else { return Ok(default) };
    let Some(table) = opts.get::<Option<Table>>(key)? else {
        return Ok(default);
    };
    let channel = |i: usize, fallback: u8| -> mlua::Result<u8> {
        Ok(table
            .get::<Option<f64>>(i)?
            .map_or(fallback, |v| v.clamp(0.0, 255.0).round() as u8))
    };
    Ok([
        channel(1, default[0])?,
        channel(2, default[1])?,
        channel(3, default[2])?,
        channel(4, 255)?,
    ])
}

/// `{r, g, b[, a]}` with 0-255 channels; white when absent.
fn rgba(color: Option<Table>) -> mlua::Result<[u8; 4]> {
    let Some(t) = color else { return Ok([255; 4]) };
    let ch = |i: usize| {
        t.get::<Option<f64>>(i)
            .map(|v| v.unwrap_or(255.0).clamp(0.0, 255.0).round() as u8)
    };
    Ok([ch(1)?, ch(2)?, ch(3)?, ch(4)?])
}

fn number_option(opts: &Option<Table>, key: &str) -> mlua::Result<Option<f64>> {
    match opts {
        Some(t) => t.get::<Option<f64>>(key),
        None => Ok(None),
    }
}

fn string_option(opts: &Option<Table>, key: &str) -> mlua::Result<Option<String>> {
    match opts {
        Some(t) => t.get::<Option<String>>(key),
        None => Ok(None),
    }
}

/// An image by full id (`sprites/car.png`) or by short name (`car`, meaning `sprites/car.png`).
fn find_image<'a>(layout: &'a AtlasLayout, id: &str) -> Option<&'a assets::AtlasRect> {
    if id == assets::WHITE {
        return None;
    }
    layout
        .rects
        .get(id)
        .or_else(|| layout.rects.get(&format!("sprites/{id}.png")))
}

/// What a sprite name means: the PNG's rectangle in the atlas and, for a sprite sheet
/// (`sprites/hero.sprite.json`), its frame layout. Sheets win over plain images for short names.
fn resolve_sprite<'a>(
    layout: &'a AtlasLayout,
    sheets: &'a HashMap<String, SpriteDef>,
    id: &str,
) -> Option<(&'a assets::AtlasRect, Option<&'a SpriteDef>)> {
    let sheet = sheets
        .get(id)
        .or_else(|| sheets.get(&format!("sprites/{id}.sprite.json")));
    if let Some(def) = sheet {
        return layout.rects.get(&def.image).map(|r| (r, Some(def)));
    }
    find_image(layout, id).map(|r| (r, None))
}

/// A sound by full id (`sounds/hit.wav`) or short name (`hit`, looked up in `sounds/` then `music/`).
fn find_sound<'a>(sounds: &'a HashMap<String, Arc<Sample>>, id: &str) -> Option<&'a Arc<Sample>> {
    sounds.get(id).or_else(|| {
        ["sounds", "music"].iter().find_map(|folder| {
            ["wav", "ogg"]
                .iter()
                .find_map(|ext| sounds.get(&format!("{folder}/{id}.{ext}")))
        })
    })
}

/// Streamed music by full id (`music/theme.ogg`) or short name (`theme`).
fn find_stream<'a>(
    streams: &'a HashMap<String, StreamSource>,
    id: &str,
) -> Option<&'a StreamSource> {
    streams
        .get(id)
        .or_else(|| streams.get(&format!("music/{id}.ogg")))
}

/// A model by full id (`models/car.glb`) or short name (`car`).
fn find_model(models: &[String], id: &str) -> Option<String> {
    if models.iter().any(|m| m == id) {
        return Some(id.to_string());
    }
    let guess = format!("models/{id}.glb");
    models.contains(&guess).then_some(guess)
}

fn sprite_instance(
    shared: &Shared,
    id: &str,
    x: f64,
    y: f64,
    opts: &Option<Table>,
) -> mlua::Result<SpriteInstance> {
    let (rect, sheet) = resolve_sprite(&shared.layout, &shared.sheets, id).ok_or_else(|| {
        let known: Vec<&str> = shared
            .layout
            .rects
            .keys()
            .map(|s| s.as_str())
            .filter(|s| *s != assets::WHITE)
            .take(6)
            .collect();
        lua_err(format!(
            "unknown image '{id}' (looked for '{id}' and 'sprites/{id}.png'; images in this project: {})",
            if known.is_empty() {
                "none".into()
            } else {
                known.join(", ")
            }
        ))
    })?;
    // A sprite sheet draws one frame (`frame`, 0-based) of its grid; a plain image ignores it.
    let cell = match sheet {
        Some(def) => {
            let frame = number_option(opts, "frame")?.unwrap_or(0.0).max(0.0) as u32;
            let (col, row) = def.cell(frame);
            assets::AtlasRect {
                x: rect.x + col * def.frame_width,
                y: rect.y + row * def.frame_height,
                w: def.frame_width,
                h: def.frame_height,
            }
        }
        None => *rect,
    };
    // `src = { x, y, w, h }`: draw only that part of the picture (pixels from its top left), as a nine-slice panel does
    let cell = match &opts {
        Some(o) => {
            match o.get::<Option<Table>>("src")? {
                Some(t) => {
                    let part = |k: &str| -> mlua::Result<u32> {
                        let v = t.get::<Option<f64>>(k)?.ok_or_else(|| {
                        lua_err("src must be { x = 0, y = 0, w = 16, h = 16 }: pixels of the picture")
                    })?;
                        if !v.is_finite() || v < 0.0 {
                            return Err(lua_err("src numbers must be 0 or more"));
                        }
                        Ok(v as u32)
                    };
                    let (sx, sy, sw, sh_) = (part("x")?, part("y")?, part("w")?, part("h")?);
                    if sw == 0 || sh_ == 0 || sx + sw > cell.w || sy + sh_ > cell.h {
                        return Err(lua_err(format!(
                            "src ({sx}, {sy}, {sw} x {sh_}) is not inside the {} x {} picture '{id}'",
                            cell.w, cell.h
                        )));
                    }
                    assets::AtlasRect {
                        x: cell.x + sx,
                        y: cell.y + sy,
                        w: sw,
                        h: sh_,
                    }
                }
                None => cell,
            }
        }
        None => cell,
    };
    let rect = &cell;
    let scale = number_option(opts, "scale")?.unwrap_or(1.0);
    let sx = number_option(opts, "sx")?.unwrap_or(scale);
    let sy = number_option(opts, "sy")?.unwrap_or(scale);
    let (mut w, mut h) = (rect.w as f64 * sx, rect.h as f64 * sy);
    match (number_option(opts, "w")?, number_option(opts, "h")?) {
        (Some(nw), Some(nh)) => (w, h) = (nw, nh),
        (Some(nw), None) => (h, w) = (h * nw / w, nw),
        (None, Some(nh)) => (w, h) = (w * nh / h, nh),
        (None, None) => {}
    }
    let (mut cx, mut cy) = (x, y);
    if string_option(opts, "anchor")?.as_deref() == Some("topleft") {
        cx += w * 0.5;
        cy += h * 0.5;
    }
    Ok(SpriteInstance {
        center: [cx as f32, cy as f32],
        size: [w as f32, h as f32],
        uv: shared.layout.uv(rect),
        color: color_option(opts, "color", [255; 4])?,
        rotation: number_option(opts, "rotation")?.unwrap_or(0.0) as f32,
    })
}

/// Draws (or, with `draw` false, only measures) UI text. Returns its size in logical units.
/// Options: `font` (a built-in name or a project font), `size` in logical units (default 16;
/// the older `scale` means 8 units per step), `color`, `width` (wrap, logical units), `align`
/// (`left`, `center`, `right` within `width`), `shadow` (true, or a colour).
fn draw_text(
    sh: &mut Shared,
    text: &str,
    x: f32,
    y: f32,
    opts: &Option<Table>,
    draw: bool,
) -> mlua::Result<(f32, f32)> {
    let scale = sh.pixel_scale.max(0.25);
    let size = match (number_option(opts, "size")?, number_option(opts, "scale")?) {
        (Some(s), _) => s,
        (None, Some(k)) => k * 8.0,
        (None, None) => 16.0,
    }
    .clamp(4.0, 400.0) as f32;
    let px = (size * scale).round().max(1.0);
    let font_name = string_option(opts, "font")?.unwrap_or_else(|| vtext::DEFAULT_FONT.to_string());
    let mut font = sh.text.resolve(&font_name).ok_or_else(|| {
        lua_err(format!(
            "unknown font '{font_name}' (fonts available: {}; project fonts are TTF or OTF files, for example fonts/title.ttf)",
            sh.text.font_names().join(", ")
        ))
    })?;
    // `fallback` = "name" or { "name", ... }: if the font lacks a character of the text, the first of these that has them all draws it
    if !sh.text.supports(font, text)
        && let Some(o) = opts
    {
        let names: Vec<String> = match o.get::<Value>("fallback")? {
            Value::String(s) => vec![s.to_str()?.to_string()],
            Value::Table(t) => t.sequence_values::<String>().collect::<mlua::Result<_>>()?,
            _ => Vec::new(),
        };
        for name in names {
            if let Some(f) = sh.text.resolve(&name)
                && sh.text.supports(f, text)
            {
                font = f;
                break;
            }
        }
    }
    // `valign`: where `y` is on the text: "top" (the top of the line's box: the default), "middle" (the middle of the capital letters: so that a
    // label centred in a button looks centred) or "baseline"
    let valign = string_option(opts, "valign")?;
    let wrap = number_option(opts, "width")?.map(|w| (w as f32 * scale).max(1.0));
    let align = match string_option(opts, "align")?.as_deref() {
        None | Some("left") => Align::Left,
        Some("center") => Align::Center,
        Some("right") => Align::Right,
        Some(other) => {
            return Err(lua_err(format!(
                "align must be 'left', 'center' or 'right', not '{other}'"
            )));
        }
    };
    let layout = sh.text.layout(font, text, px, wrap);
    let y = match valign.as_deref() {
        None | Some("top") => y,
        Some("baseline") => y - layout.ascent / scale,
        Some("middle") => y + 0.35 * size - layout.ascent / scale,
        Some(other) => {
            return Err(lua_err(format!(
                "valign must be 'top', 'middle' or 'baseline', not '{other}'"
            )));
        }
    };
    // without a `width` to align inside, "center" and "right" are around the point given
    let x = match (align, wrap) {
        (Align::Center, None) => x - layout.width / scale * 0.5,
        (Align::Right, None) => x - layout.width / scale,
        _ => x,
    };
    if draw {
        let color = color_option(opts, "color", [255; 4])?;
        let shadow = match opts {
            Some(t) => match t.get::<Value>("shadow")? {
                Value::Nil | Value::Boolean(false) => None,
                Value::Table(_) => Some(color_option(opts, "shadow", [0, 0, 0, 170])?),
                _ => Some([0, 0, 0, 170]),
            },
            None => None,
        };
        let mut out = std::mem::take(&mut sh.text_out);
        if let Some(shadow) = shadow {
            let offset = (size / 16.0).max(1.0);
            sh.text.draw(
                &mut out,
                font,
                &layout,
                px,
                (x + offset, y + offset),
                scale,
                shadow,
                align,
                wrap,
            );
        }
        sh.text.draw(
            &mut out,
            font,
            &layout,
            px,
            (x, y),
            scale,
            color,
            align,
            wrap,
        );
        sh.text_out = out;
    }
    Ok((layout.width / scale, layout.height / scale))
}

fn rect_instance(
    shared: &Shared,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    color: [u8; 4],
) -> SpriteInstance {
    SpriteInstance {
        center: [(x + w * 0.5) as f32, (y + h * 0.5) as f32],
        size: [w as f32, h as f32],
        uv: shared.layout.white_uv(),
        color,
        rotation: 0.0,
    }
}

fn register_api(lua: &Lua, shared: &Rc<RefCell<Shared>>, vfs: &Rc<dyn Vfs>) -> mlua::Result<()> {
    let nova = lua.create_table()?;

    // --- drawing ---
    // image_size(id) -> w, h: the size in pixels of a picture (one frame of a sprite sheet)
    let s = shared.clone();
    nova.set(
        "image_size",
        lua.create_function(move |_, id: String| {
            let sh = s.borrow();
            let (rect, sheet) = resolve_sprite(&sh.layout, &sh.sheets, &id)
                .ok_or_else(|| lua_err(format!("unknown image '{id}'")))?;
            Ok(match sheet {
                Some(def) => (def.frame_width, def.frame_height),
                None => (rect.w, rect.h),
            })
        })?,
    )?;
    let s = shared.clone();
    nova.set(
        "sprite",
        lua.create_function(
            move |_, (id, x, y, opts): (String, f64, f64, Option<Table>)| {
                let mut sh = s.borrow_mut();
                let inst = sprite_instance(&sh, &id, x, y, &opts)?;
                sh.world.push(inst);
                Ok(())
            },
        )?,
    )?;
    let s = shared.clone();
    nova.set(
        "rect",
        lua.create_function(
            move |_, (x, y, w, h, color): (f64, f64, f64, f64, Option<Table>)| {
                let mut sh = s.borrow_mut();
                let inst = rect_instance(&sh, x, y, w, h, rgba(color)?);
                sh.world.push(inst);
                Ok(())
            },
        )?,
    )?;
    let s = shared.clone();
    nova.set(
        "model",
        lua.create_function(
            move |_, (id, x, y, z, opts): (String, f64, f64, f64, Option<Table>)| {
                let mut sh = s.borrow_mut();
                let found = find_model(&sh.known_models, &id).ok_or_else(|| {
                lua_err(format!(
                    "unknown model '{id}' (looked for '{id}' and 'models/{id}.glb'; models in this project: {})",
                    if sh.known_models.is_empty() { "none".into() } else { sh.known_models.join(", ") }
                ))
            })?;
            let mesh = *sh.mesh_ids.get(&found).ok_or_else(|| {
                lua_err(format!("model '{found}' is not on the GPU yet (draw models from update/draw, not while the script loads)"))
            })?;
            let scale = number_option(&opts, "scale")?.unwrap_or(1.0) as f32
                * sh.model_scales.get(&found).copied().unwrap_or(1.0);
                let rotation =
                    Mat4::from_rotation_y(number_option(&opts, "ry")?.unwrap_or(0.0) as f32)
                        * Mat4::from_rotation_x(number_option(&opts, "rx")?.unwrap_or(0.0) as f32)
                        * Mat4::from_rotation_z(number_option(&opts, "rz")?.unwrap_or(0.0) as f32);
                let matrix = Mat4::from_translation(Vec3::new(x as f32, y as f32, z as f32))
                    * rotation
                    * Mat4::from_scale(Vec3::splat(scale));
                let tint = color_option(&opts, "tint", [255; 4])?.map(|c| c as f32 / 255.0);
                // `shadow = false`: this model does not cast a shadow (clouds, glass, a fake blob shadow)
                let casts = match &opts {
                    Some(o) => o.get::<Option<bool>>("shadow")?.unwrap_or(true),
                    None => true,
                };
                let overrides = match &opts {
                    Some(o) => o.get::<Option<Table>>("parts")?,
                    None => None,
                };
                let clip_name = string_option(&opts, "clip")?;
                // `layers = { { clip = "walk", time = t, weight = 0.7 }, ... }`: several clips mixed by weight (see `nova.animator`)
                let layers = match &opts {
                    Some(o) => o.get::<Option<Table>>("layers")?,
                    None => None,
                };
                if layers.is_some() && clip_name.is_some() {
                    return Err(lua_err("give a model `clip` or `layers`, not both (layers = { { clip = \"walk\", weight = 1 } })"));
                }
                let lod_name = string_option(&opts, "lod")?;
                if lod_name.is_some()
                    && (overrides.is_some() || clip_name.is_some() || layers.is_some())
                {
                    return Err(lua_err(
                        "lod works on plain models: not with clip or parts (a far version of an animated model is not supported yet)",
                    ));
                }
                if overrides.is_some() || clip_name.is_some() || layers.is_some() {
                    // Pieces that move on their own: each part is drawn separately at its turned place.
                    let (parts, world) = part_worlds(&sh, &found, &id, &opts, &clip_name, &layers, &overrides, &[])?;
                    let world_matrices = world.clone();
                    for (i, p) in parts.iter().enumerate() {
                        if let Some(skinned) = &p.skinned {
                            // The mesh follows the parts; it is drawn from the model's own place, bent on the GPU by the
                            // matrices of its joints (each joint's place in the model times its inverse rest matrix).
                            let Some(&mesh) = sh.mesh_ids.get(&skinned.key) else { continue };
                            if sh.joints.len() + skinned.skin.joints.len() > crate::gfx::MAX_JOINT_MATRICES {
                                sh.log.push(format!(
                                    "a frame holds at most {} joints; '{id}' is not drawn",
                                    crate::gfx::MAX_JOINT_MATRICES
                                ));
                                continue;
                            }
                            let base = sh.joints.len() as u32;
                            for (&part, ibm) in skinned.skin.joints.iter().zip(&skinned.skin.inverse_bind) {
                                let m = world_matrices.get(part).copied().unwrap_or(Mat4::IDENTITY) * *ibm;
                                sh.joints.push(m.to_cols_array_2d());
                            }
                            sh.models.push(ModelDraw {
                                casts,
                                mesh,
                                instance: ModelInstance::skinned(matrix.to_cols_array_2d(), tint, base),
                            });
                            continue;
                        }
                        let Some(key) = &p.mesh_key else { continue };
                        let Some(&mesh) = sh.mesh_ids.get(key) else { continue };
                        sh.models.push(ModelDraw {
                            casts,
                            mesh,
                            instance: ModelInstance {
                                matrix: (matrix * world[i]).to_cols_array_2d(),
                                tint,
                            },
                        });
                    }
                    return Ok(());
                }
                let instance = ModelInstance {
                    matrix: matrix.to_cols_array_2d(),
                    tint,
                };
                let instance = match number_option(&opts, "sway")? {
                    Some(sway) if sway != 0.0 => instance.swaying(sway as f32),
                    _ => instance,
                };
                // `lod = "name"`: a cheaper model past `lod_distance` metres (on the ground, from the camera), the two
                // trading places over `lod_fade` metres (see `retained_api::lod_state`)
                if let Some(far_name) = lod_name {
                    let far = find_model(&sh.known_models, &far_name).ok_or_else(|| {
                        lua_err(format!("unknown model '{far_name}' for lod (looked for '{far_name}' and 'models/{far_name}.glb')"))
                    })?;
                    let far_mesh = *sh.mesh_ids.get(&far).ok_or_else(|| {
                        lua_err(format!("model '{far}' is not on the GPU yet (draw models from update/draw, not while the script loads)"))
                    })?;
                    let distance = number_option(&opts, "lod_distance")?.unwrap_or(100.0).max(1.0) as f32;
                    let fade = number_option(&opts, "lod_fade")?.map_or(distance * 0.15, |f| f as f32).max(0.0);
                    let eye = sh.camera.eye;
                    let d = ((x as f32 - eye.x).powi(2) + (z as f32 - eye.z).powi(2)).sqrt();
                    let draws: [Option<(usize, f32)>; 2] = match retained_api::lod_state(d, distance, fade) {
                        retained_api::Lod::Near => [Some((mesh, 0.0)), None],
                        retained_api::Lod::Far => [Some((far_mesh, 0.0)), None],
                        retained_api::Lod::Blend(t) => [Some((mesh, -t)), Some((far_mesh, t))],
                    };
                    for (mesh, dissolve) in draws.into_iter().flatten() {
                        let instance = if dissolve == 0.0 { instance } else { instance.dissolving(dissolve) };
                        sh.models.push(ModelDraw { casts, mesh, instance });
                    }
                    return Ok(());
                }
                sh.models.push(ModelDraw {
                    casts,
                    mesh,
                    instance,
                });
                Ok(())
            },
        )?,
    )?;
    let s = shared.clone();
    nova.set(
        "camera",
        lua.create_function(move |_, v: (f64, f64, f64, f64, f64, f64, Option<f64>)| {
            let mut sh = s.borrow_mut();
            sh.camera = Camera {
                eye: Vec3::new(v.0 as f32, v.1 as f32, v.2 as f32),
                target: Vec3::new(v.3 as f32, v.4 as f32, v.5 as f32),
                fov_y_degrees: v.6.unwrap_or(60.0).clamp(10.0, 120.0) as f32,
            };
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    nova.set(
        "light",
        lua.create_function(move |_, opts: Table| {
            let mut sh = s.borrow_mut();
            if let Some(dir) = opts.get::<Option<Table>>("dir")? {
                let mut v = [0.0f32; 3];
                for (i, slot) in v.iter_mut().enumerate() {
                    *slot = dir
                        .get::<Option<f64>>(i + 1)?
                        .filter(|n| n.is_finite())
                        .ok_or_else(|| lua_err("dir must be {x, y, z}, three numbers"))?
                        as f32;
                }
                let d = Vec3::from(v);
                if d.length() < 1e-6 {
                    return Err(lua_err("dir cannot be {0, 0, 0}; it is the way the light travels, e.g. {-0.4, -1, -0.3}"));
                }
                sh.lighting.direction = d.normalize().to_array();
            }
            if let Some(c) = light_color(&opts, "color")? {
                sh.lighting.color = c;
            }
            if let Some(c) = light_color(&opts, "ambient")? {
                sh.lighting.ambient = c;
            }
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    nova.set(
        "shadows",
        lua.create_function(move |_, opts: Option<Value>| {
            let shadows = match opts {
                None | Some(Value::Nil) | Some(Value::Boolean(false)) => None,
                Some(Value::Boolean(true)) => Some(Shadows::default()),
                Some(Value::Table(t)) => {
                    let o = Some(t);
                    let radius = number_option(&o, "radius")?.unwrap_or(60.0);
                    let strength = number_option(&o, "strength")?.unwrap_or(0.6);
                    if !radius.is_finite() || radius <= 0.0 {
                        return Err(lua_err("shadows radius must be greater than 0 (metres around the camera's target that get shadows)"));
                    }
                    if !(0.0..=1.0).contains(&strength) {
                        return Err(lua_err("shadows strength must be from 0 (none) to 1 (as dark as the ambient light)"));
                    }
                    Some(Shadows {
                        radius: radius as f32,
                        strength: strength as f32,
                    })
                }
                Some(_) => return Err(lua_err("nova.shadows takes a table like { radius = 60, strength = 0.6 }, true, or false")),
            };
            s.borrow_mut().lighting.shadows = shadows;
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    nova.set(
        "sky",
        lua.create_function(move |_, opts: Option<Table>| {
            let Some(opts) = opts else {
                s.borrow_mut().lighting.sky = None;
                return Ok(());
            };
            let top = picture_color(&opts, "top")?
                .ok_or_else(|| lua_err("nova.sky needs top = {r, g, b}: the colour overhead (and horizon = {r, g, b} for the line where it meets the ground)"))?;
            let horizon = picture_color(&opts, "horizon")?.unwrap_or(top);
            let sun = match opts.get::<Option<Table>>("sun")? {
                Some(t) => Some([
                    t.get::<Option<f32>>(1)?.unwrap_or(0.0),
                    t.get::<Option<f32>>(2)?.unwrap_or(1.0),
                    t.get::<Option<f32>>(3)?.unwrap_or(0.0),
                ]),
                None => None,
            };
            let opts = Some(opts);
            let stars = number_option(&opts, "stars")?.unwrap_or(0.0).clamp(0.0, 1.0) as f32;
            let clouds = number_option(&opts, "clouds")?.unwrap_or(0.0).clamp(0.0, 1.0) as f32;
            s.borrow_mut().lighting.sky = Some(Sky { top, horizon, sun, stars, clouds, time: 0.0 });
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    nova.set(
        "fog",
        lua.create_function(move |_, opts: Option<Table>| {
            let Some(opts) = opts else {
                s.borrow_mut().lighting.fog = None;
                return Ok(());
            };
            let color = picture_color(&opts, "color")?
                .ok_or_else(|| lua_err("nova.fog needs color = {r, g, b}, and near and far in metres"))?;
            let opts = Some(opts);
            let near = number_option(&opts, "near")?.unwrap_or(40.0);
            let far = number_option(&opts, "far")?.unwrap_or(250.0);
            if !near.is_finite() || !far.is_finite() || near < 0.0 || far <= near {
                return Err(lua_err(format!(
                    "fog far ({far}) must be greater than near ({near}), and near cannot be negative"
                )));
            }
            s.borrow_mut().lighting.fog = Some(Fog {
                color,
                near: near as f32,
                far: far as f32,
            });
            Ok(())
        })?,
    )?;
    // look { toon = 3, outline = { color = {r, g, b}, strength = 0.8, width = 1 }, exposure = 1, saturation = 1, vignette = 0, bloom = 0, ao = 0, blur = 0 }
    let s = shared.clone();
    nova.set(
        "look",
        lua.create_function(move |_, opts: Option<Table>| {
            let Some(opts) = opts else {
                s.borrow_mut().lighting.look = Look::default();
                return Ok(());
            };
            let some = Some(opts.clone());
            let number = |key: &str, default: f64, lo: f64, hi: f64| -> mlua::Result<f64> {
                let v = number_option(&some, key)?.unwrap_or(default);
                if !v.is_finite() || v < lo || v > hi {
                    return Err(lua_err(format!("look {key} must be from {lo} to {hi}, not {v}")));
                }
                Ok(v)
            };
            let toon = number("toon", 0.0, 0.0, 8.0)?;
            if toon != 0.0 && toon < 2.0 {
                return Err(lua_err("look toon is the number of bands of light: 2 to 8 (0 for smooth light)"));
            }
            let outline = match opts.get::<Value>("outline")? {
                Value::Nil | Value::Boolean(false) => None,
                Value::Boolean(true) => Some(([0.02, 0.02, 0.03], 0.85, 1.0)),
                Value::Table(t) => {
                    let t = Some(t);
                    let color = match &t {
                        Some(t) => picture_color(t, "color")?.unwrap_or([0.02, 0.02, 0.03]),
                        None => unreachable!(),
                    };
                    let strength = number_option(&t, "strength")?.unwrap_or(0.85).clamp(0.0, 1.0);
                    let width = number_option(&t, "width")?.unwrap_or(1.0).clamp(1.0, 4.0);
                    Some((color, strength as f32, width as f32))
                }
                _ => return Err(lua_err("look outline is true, false or { color = {r, g, b}, strength = 0.85, width = 1 }")),
            };
            s.borrow_mut().lighting.look = Look {
                toon: toon as f32,
                outline,
                exposure: number("exposure", 1.0, 0.0, 8.0)? as f32,
                saturation: number("saturation", 1.0, 0.0, 4.0)? as f32,
                vignette: number("vignette", 0.0, 0.0, 1.0)? as f32,
                bloom: number("bloom", 0.0, 0.0, 4.0)? as f32,
                bloom_threshold: number("bloom_threshold", 0.7, 0.0, 1.0)? as f32,
                ao: number("ao", 0.0, 0.0, 1.0)? as f32,
                ao_radius: number("ao_radius", 0.8, 0.05, 8.0)? as f32,
                blur: number("blur", 0.0, 0.0, 1.0)? as f32,
                fxaa: number("fxaa", 0.0, 0.0, 1.0)? as f32,
            };
            Ok(())
        })?,
    )?;
    // wind { direction = 45, strength = 1 }: the way it blows (degrees on the ground, 0 towards +x, 90 towards +z) and how hard
    let s = shared.clone();
    nova.set(
        "wind",
        lua.create_function(move |_, opts: Option<Table>| {
            let Some(opts) = opts else {
                s.borrow_mut().lighting.wind = Wind::default();
                return Ok(());
            };
            let some = Some(opts);
            let degrees = number_option(&some, "direction")?.unwrap_or(0.0);
            let strength = number_option(&some, "strength")?.unwrap_or(1.0);
            if !degrees.is_finite() || !strength.is_finite() || !(0.0..=4.0).contains(&strength) {
                return Err(lua_err("wind takes direction (degrees) and strength from 0 to 4: nova.wind { direction = 45, strength = 1 }"));
            }
            let a = (degrees as f32).to_radians();
            let mut sh = s.borrow_mut();
            sh.lighting.wind.direction = [a.cos(), a.sin()];
            sh.lighting.wind.strength = strength as f32;
            Ok(())
        })?,
    )?;
    // terrain { waves = { { wavelength = 400, direction = 30, height = 6, phase = 0 }, ... } }: hills. The ground's height is the sum of up to eight
    // sine waves (`wavelength` metres from crest to crest, `direction` degrees on the ground, 0 along +x and 90 along +z, `height` the metres from the
    // middle to a crest); every model drawn near the ground is lifted by the height under each of its vertices. nova.terrain() makes it flat again.
    let s = shared.clone();
    nova.set(
        "terrain",
        lua.create_function(move |_, opts: Option<Table>| {
            let mut terrain = crate::gfx::Terrain::default();
            if let Some(opts) = opts {
                let waves: Table = opts.get("waves").map_err(|_| {
                    lua_err("terrain takes waves = { { wavelength = 400, direction = 30, height = 6 }, ... }")
                })?;
                for wave in waves.sequence_values::<Table>() {
                    let wave = wave?;
                    if terrain.count >= crate::gfx::MAX_TERRAIN_WAVES {
                        return Err(lua_err(&format!("terrain has room for {} waves", crate::gfx::MAX_TERRAIN_WAVES)));
                    }
                    let some = Some(wave);
                    let wavelength = number_option(&some, "wavelength")?.unwrap_or(400.0);
                    let direction = number_option(&some, "direction")?.unwrap_or(0.0);
                    let height = number_option(&some, "height")?.unwrap_or(5.0);
                    let phase = number_option(&some, "phase")?.unwrap_or(0.0);
                    if !wavelength.is_finite() || wavelength < 10.0 || !direction.is_finite() || !height.is_finite() || !phase.is_finite() {
                        return Err(lua_err("a terrain wave needs a wavelength of at least 10 metres and finite numbers"));
                    }
                    let k = std::f32::consts::TAU / wavelength as f32;
                    let a = (direction as f32).to_radians();
                    terrain.waves[terrain.count] = [k * a.cos(), k * a.sin(), height as f32, phase as f32];
                    terrain.count += 1;
                }
            }
            s.borrow_mut().lighting.terrain = terrain;
            Ok(())
        })?,
    )?;
    // terrain_height(x, z): the ground's height there. terrain_slope(x, z): how fast it rises along x and along z (two numbers).
    let s = shared.clone();
    nova.set(
        "terrain_height",
        lua.create_function(move |_, (x, z): (f64, f64)| {
            Ok(s.borrow().lighting.terrain.height(x as f32, z as f32) as f64)
        })?,
    )?;
    let s = shared.clone();
    nova.set(
        "terrain_slope",
        lua.create_function(move |_, (x, z): (f64, f64)| {
            let g = s.borrow().lighting.terrain.slope(x as f32, z as f32);
            Ok((g[0] as f64, g[1] as f64))
        })?,
    )?;
    let s = shared.clone();
    nova.set(
        "point_light",
        lua.create_function(move |_, (x, y, z, opts): (f64, f64, f64, Option<Table>)| {
            let radius = number_option(&opts, "radius")?.unwrap_or(10.0);
            if !radius.is_finite() || radius <= 0.0 {
                return Err(lua_err("radius must be greater than 0"));
            }
            let color = match &opts {
                Some(o) => light_color(o, "color")?.unwrap_or([1.0; 3]),
                None => [1.0; 3],
            };
            // a spot light: `dir = {dx, dy, dz}` is the way it points, `angle` the whole width of the cone in degrees (50 by default)
            let (direction, cone) = match &opts {
                Some(o) => match o.get::<Option<Table>>("dir")? {
                    Some(d) => {
                        let mut v = [0.0f64; 3];
                        for (i, slot) in v.iter_mut().enumerate() {
                            *slot = d.get::<Option<f64>>(i + 1)?.ok_or_else(|| {
                                lua_err("light dir must be {dx, dy, dz}, the way the light points")
                            })?;
                        }
                        let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
                        if !len.is_finite() || len < 1e-6 {
                            return Err(lua_err("light dir must not be all zeros"));
                        }
                        let angle = number_option(&opts, "angle")?.unwrap_or(50.0);
                        if !angle.is_finite() || !(1.0..=170.0).contains(&angle) {
                            return Err(lua_err(format!(
                                "light angle must be from 1 to 170 degrees, not {angle}"
                            )));
                        }
                        (
                            [
                                (v[0] / len) as f32,
                                (v[1] / len) as f32,
                                (v[2] / len) as f32,
                            ],
                            (angle.to_radians() / 2.0).cos() as f32,
                        )
                    }
                    None => ([0.0; 3], 0.0),
                },
                None => ([0.0; 3], 0.0),
            };
            // Any number may be asked for; the nearest sixteen are lit, and a change of which fades (see `lights.rs`).
            let mut sh = s.borrow_mut();
            if sh.light_requests.len() < 256 {
                sh.light_requests.push(PointLight {
                    position: [x as f32, y as f32, z as f32],
                    radius: radius as f32,
                    color,
                    direction,
                    cone,
                });
            }
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    nova.set(
        "model_clips",
        lua.create_function(move |lua, id: String| {
            let sh = s.borrow();
            let found = find_model(&sh.known_models, &id)
                .ok_or_else(|| lua_err(format!("unknown model '{id}'")))?;
            let list = lua.create_table()?;
            for (i, c) in sh.clips.get(&found).into_iter().flatten().enumerate() {
                let entry = lua.create_table()?;
                entry.set("name", c.name.clone())?;
                entry.set("duration", c.duration as f64)?;
                list.set(i + 1, entry)?;
            }
            Ok(list)
        })?,
    )?;
    // model_pose(id, opts) -> { [part] = { x, y, z } }: where each part's own origin (its joint) is, in the model's own space, in the pose
    // that `nova.model(id, ..., opts)` would draw (a clip, layers, parts)
    let s = shared.clone();
    nova.set(
        "model_pose",
        lua.create_function(move |lua, (id, opts): (String, Option<Table>)| {
            let sh = s.borrow();
            let found = find_model(&sh.known_models, &id)
                .ok_or_else(|| lua_err(format!("unknown model '{id}'")))?;
            let clip_name = string_option(&opts, "clip")?;
            let layers = match &opts {
                Some(o) => o.get::<Option<Table>>("layers")?,
                None => None,
            };
            let overrides = match &opts {
                Some(o) => o.get::<Option<Table>>("parts")?,
                None => None,
            };
            let (parts, world) = part_worlds(
                &sh,
                &found,
                &id,
                &opts,
                &clip_name,
                &layers,
                &overrides,
                &[],
            )?;
            let out = lua.create_table()?;
            for (p, m) in parts.iter().zip(&world) {
                let at = m.w_axis;
                let entry = lua.create_table()?;
                entry.set("x", at.x as f64)?;
                entry.set("y", at.y as f64)?;
                entry.set("z", at.z as f64)?;
                out.set(p.name.clone(), entry)?;
            }
            Ok(out)
        })?,
    )?;
    // ik(id, opts, { root, mid, tip }, { x, y, z } [, pole]) -> parts, reached: the turns (a `parts` table with `quat`s) that make a
    // limb of two bones reach the target, in the model's own space; the chain's own entries in `opts.parts` are ignored
    let s = shared.clone();
    nova.set(
        "ik",
        lua.create_function(
            move |lua,
                  (id, opts, chain, target, pole): (
                String,
                Option<Table>,
                Table,
                Table,
                Option<Table>,
            )| {
                let sh = s.borrow();
                let found = find_model(&sh.known_models, &id)
                    .ok_or_else(|| lua_err(format!("unknown model '{id}'")))?;
                let names: Vec<String> = chain.sequence_values::<String>().collect::<mlua::Result<_>>()?;
                if names.len() != 3 {
                    return Err(lua_err("nova.ik's chain is three part names: the top of the limb, its middle joint and its end ({ \"Thigh\", \"Shin\", \"Foot\" })"));
                }
                let point = |t: &Table, what: &str| -> mlua::Result<Vec3> {
                    let mut v = [0.0f32; 3];
                    for (i, k) in ["x", "y", "z"].iter().enumerate() {
                        let c = t.get::<Option<f64>>(*k)?.or(t.get::<Option<f64>>(i + 1)?).ok_or_else(|| {
                            lua_err(format!("nova.ik's {what} must be {{x, y, z}} (or {{x, y, z}} as a list)"))
                        })?;
                        if !c.is_finite() {
                            return Err(lua_err(format!("nova.ik's {what} must be finite numbers")));
                        }
                        v[i] = c as f32;
                    }
                    Ok(Vec3::from(v))
                };
                let target = point(&target, "target")?;
                let pole = match &pole {
                    Some(t) => Some(point(t, "pole")?),
                    None => None,
                };
                let clip_name = string_option(&opts, "clip")?;
                let layers = match &opts {
                    Some(o) => o.get::<Option<Table>>("layers")?,
                    None => None,
                };
                let overrides = match &opts {
                    Some(o) => o.get::<Option<Table>>("parts")?,
                    None => None,
                };
                let ignore: Vec<&str> = names.iter().map(String::as_str).collect();
                let (parts, world) =
                    part_worlds(&sh, &found, &id, &opts, &clip_name, &layers, &overrides, &ignore)?;
                let index = |name: &str| -> mlua::Result<usize> {
                    parts.iter().position(|p| p.name == name).ok_or_else(|| {
                        lua_err(format!(
                            "model '{id}' has no part '{name}' (its parts: {})",
                            parts.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", ")
                        ))
                    })
                };
                let (ir, im, it) = (index(&names[0])?, index(&names[1])?, index(&names[2])?);
                if parts[im].parent != Some(ir) || parts[it].parent != Some(im) {
                    return Err(lua_err(format!(
                        "nova.ik's chain must be a part, its child and that one's child; '{}' is not under '{}' under '{}'",
                        names[2], names[1], names[0]
                    )));
                }
                let place = |i: usize| world[i].w_axis.truncate();
                let spin = |i: usize| world[i].to_scale_rotation_translation().1;
                let (root, mid, tip) = (place(ir), place(im), place(it));
                let (new_mid, new_tip, reached) = crate::ik::two_bone(root, mid, tip, target, pole);
                // the top bone turns about the root so that the middle joint goes to its new place ...
                let turn_root = crate::ik::arc(mid - root, new_mid - root);
                // ... carrying the end with it; the lower bone then turns about the middle joint to the end's new place
                let carried_tip = root + turn_root * (tip - root);
                let turn_mid = crate::ik::arc(carried_tip - new_mid, new_tip - new_mid);
                // a world turn as the part's own: its place at rest here is `spin`, and the middle part has the root's turn on it too
                let local = |world_turn: Quat, spin: Quat| (spin.conjugate() * world_turn * spin).normalize();
                let q_root = local(turn_root, spin(ir));
                let q_mid = local(turn_mid, turn_root * spin(im));
                let out = lua.create_table()?;
                for (name, q) in [(&names[0], q_root), (&names[1], q_mid)] {
                    let entry = lua.create_table()?;
                    let quat = lua.create_table()?;
                    quat.set("x", q.x as f64)?;
                    quat.set("y", q.y as f64)?;
                    quat.set("z", q.z as f64)?;
                    quat.set("w", q.w as f64)?;
                    entry.set("quat", quat)?;
                    out.set(name.clone(), entry)?;
                }
                Ok((out, reached))
            },
        )?,
    )?;
    let s = shared.clone();
    nova.set(
        "model_colliders",
        lua.create_function(move |lua, id: String| {
            let sh = s.borrow();
            let found = find_model(&sh.known_models, &id)
                .ok_or_else(|| lua_err(format!("unknown model '{id}'")))?;
            let list = lua.create_table()?;
            for (i, c) in sh.colliders.get(&found).into_iter().flatten().enumerate() {
                let entry = lua.create_table()?;
                entry.set("x", c[0] as f64)?;
                entry.set("z", c[1] as f64)?;
                entry.set("r", c[2] as f64)?;
                list.set(i + 1, entry)?;
            }
            Ok(list)
        })?,
    )?;
    let s = shared.clone();
    nova.set(
        "model_parts",
        lua.create_function(move |lua, id: String| {
            let sh = s.borrow();
            let found = find_model(&sh.known_models, &id)
                .ok_or_else(|| lua_err(format!("unknown model '{id}'")))?;
            let names = lua.create_table()?;
            for (i, p) in sh.parts.get(&found).into_iter().flatten().enumerate() {
                names.set(i + 1, p.name.clone())?;
            }
            Ok(names)
        })?,
    )?;
    let s = shared.clone();
    nova.set(
        "clear",
        lua.create_function(move |_, (r, g, b): (f64, f64, f64)| {
            s.borrow_mut().clear = srgb_to_linear([r / 255.0, g / 255.0, b / 255.0, 1.0]);
            Ok(())
        })?,
    )?;

    // --- UI layer (always native resolution) ---
    let ui = lua.create_table()?;
    let s = shared.clone();
    ui.set(
        "sprite",
        lua.create_function(
            move |_, (id, x, y, opts): (String, f64, f64, Option<Table>)| {
                let mut sh = s.borrow_mut();
                let inst = sprite_instance(&sh, &id, x, y, &opts)?;
                sh.ui.push(inst);
                Ok(())
            },
        )?,
    )?;
    let s = shared.clone();
    ui.set(
        "rect",
        lua.create_function(
            move |_, (x, y, w, h, color): (f64, f64, f64, f64, Option<Table>)| {
                let mut sh = s.borrow_mut();
                let inst = rect_instance(&sh, x, y, w, h, rgba(color)?);
                sh.ui.push(inst);
                Ok(())
            },
        )?,
    )?;
    let s = shared.clone();
    ui.set(
        "text",
        lua.create_function(
            move |_, (x, y, text, opts): (f64, f64, String, Option<Table>)| {
                let mut sh = s.borrow_mut();
                let (w, h) = draw_text(&mut sh, &text, x as f32, y as f32, &opts, true)?;
                Ok((w as f64, h as f64))
            },
        )?,
    )?;
    // text_size(text, opts) -> width, height (logical units) without drawing anything.
    let s = shared.clone();
    ui.set(
        "text_size",
        lua.create_function(move |_, (text, opts): (String, Option<Table>)| {
            let mut sh = s.borrow_mut();
            let (w, h) = draw_text(&mut sh, &text, 0.0, 0.0, &opts, false)?;
            Ok((w as f64, h as f64))
        })?,
    )?;
    // text_width(text, opts_or_scale): the older form took a number (scale, 8 logical units per step).
    let s = shared.clone();
    ui.set(
        "text_width",
        lua.create_function(move |lua, (text, second): (String, Option<Value>)| {
            let opts = match second {
                Some(Value::Table(t)) => Some(t),
                Some(Value::Number(n)) => {
                    let t = lua.create_table()?;
                    t.set("scale", n)?;
                    Some(t)
                }
                Some(Value::Integer(n)) => {
                    let t = lua.create_table()?;
                    t.set("scale", n)?;
                    Some(t)
                }
                _ => None,
            };
            let mut sh = s.borrow_mut();
            Ok(draw_text(&mut sh, &text, 0.0, 0.0, &opts, false)?.0 as f64)
        })?,
    )?;
    nova.set("ui", ui)?;

    // --- view, time, log ---
    let s = shared.clone();
    nova.set(
        "view",
        lua.create_function(move |_, ()| {
            // Whole numbers, so scripts can use them with math.random and as grid sizes. On a
            // screen that is not 16:9 the exact width is fractional; this rounds down.
            let v = s.borrow().view;
            Ok((v[0].floor() as i64, v[1].floor() as i64))
        })?,
    )?;
    let s = shared.clone();
    nova.set(
        "time",
        lua.create_function(move |_, ()| Ok(s.borrow().time))?,
    )?;
    // what the engine measured over the last whole second (zeros in tests and before the first second)
    nova.set(
        "perf",
        lua.create_function(|lua, ()| {
            let p = crate::spike::last_perf();
            let t = lua.create_table()?;
            t.set("fps", p.fps)?;
            t.set("update_ms", p.update_ms)?;
            t.set("lua_ms", p.lua_ms)?;
            t.set("render_ms", p.render_ms)?;
            t.set("gpu_ms", p.gpu_ms)?;
            t.set("frame_p95_ms", p.frame_p95_ms)?;
            t.set("frame_max_ms", p.frame_max_ms)?;
            t.set("draws", p.draws)?;
            t.set("triangles", p.triangles)?;
            t.set("culled", p.culled)?;
            Ok(t)
        })?,
    )?;
    let s = shared.clone();
    nova.set(
        "log",
        lua.create_function(move |_, message: String| {
            log::info!("lua: {message}");
            s.borrow_mut().log.push(message);
            Ok(())
        })?,
    )?;

    // stats(): how the last frame went, for an on-screen profiler
    let s = shared.clone();
    nova.set(
        "stats",
        lua.create_function(move |lua, ()| {
            let sh = s.borrow();
            let t = lua.create_table()?;
            t.set("fps", sh.host_stats.fps as f64)?;
            t.set("lua_ms", sh.lua_ms as f64)?;
            t.set("render_ms", sh.host_stats.render_ms as f64)?;
            t.set("draws", sh.host_stats.draw_calls)?;
            t.set("triangles", sh.host_stats.triangles)?;
            t.set("sprites", sh.host_stats.sprites)?;
            t.set("memory_kb", sh.lua_kb as f64)?;
            Ok(t)
        })?,
    )?;

    voxel_api::install(lua, shared, vfs, &nova)?;
    solid_api::install(lua, shared, vfs, &nova)?;
    walls_api::install(lua, shared, &nova)?;
    billboard_api::install(lua, shared, &nova)?;

    // --- input: named actions, see docs/project-format.md ---
    let input = lua.create_table()?;
    fn unknown_action(sh: &Shared, name: &str) -> mlua::Error {
        let names = sh.bindings.names();
        let shown: Vec<&str> = names.iter().copied().take(14).collect();
        lua_err(format!(
            "unknown input action '{name}' (actions: {}{})",
            shown.join(", "),
            if names.len() > shown.len() {
                ", ..."
            } else {
                ""
            }
        ))
    }
    let s = shared.clone();
    input.set(
        "axis",
        lua.create_function(move |_, name: String| {
            let sh = s.borrow();
            sh.bindings
                .get(&name)
                .ok_or_else(|| unknown_action(&sh, &name))?;
            Ok(sh.states.value(&name) as f64)
        })?,
    )?;
    let s = shared.clone();
    input.set(
        "down",
        lua.create_function(move |_, name: String| {
            let sh = s.borrow();
            sh.bindings
                .get(&name)
                .ok_or_else(|| unknown_action(&sh, &name))?;
            Ok(sh.states.is_down(&name))
        })?,
    )?;
    let s = shared.clone();
    input.set(
        "pressed",
        lua.create_function(move |_, name: String| {
            let sh = s.borrow();
            sh.bindings
                .get(&name)
                .ok_or_else(|| unknown_action(&sh, &name))?;
            Ok(sh.states.was_pressed(&name))
        })?,
    )?;
    let s = shared.clone();
    input.set(
        "released",
        lua.create_function(move |_, name: String| {
            let sh = s.borrow();
            sh.bindings
                .get(&name)
                .ok_or_else(|| unknown_action(&sh, &name))?;
            Ok(sh.states.was_released(&name))
        })?,
    )?;
    let s = shared.clone();
    input.set(
        "actions",
        lua.create_function(move |_, ()| {
            Ok(s.borrow()
                .bindings
                .names()
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>())
        })?,
    )?;
    // bind("jump", { "key:Space", "pad:south" }) or bind("move_x", { negative = {...}, positive = {...} })
    let s = shared.clone();
    input.set(
        "bind",
        lua.create_function(move |lua, (name, spec): (String, Value)| {
            let json: serde_json::Value = lua
                .from_value(spec)
                .map_err(|e| lua_err(format!("bind('{name}'): {e}")))?;
            let binding =
                actions::parse_binding(&json, &format!("bind('{name}')")).map_err(lua_err)?;
            s.borrow_mut().bindings.set(&name, binding).map_err(lua_err)
        })?,
    )?;
    let s = shared.clone();
    input.set(
        "bindings",
        lua.create_function(move |lua, name: String| {
            let sh = s.borrow();
            let binding = sh
                .bindings
                .get(&name)
                .ok_or_else(|| unknown_action(&sh, &name))?;
            match binding {
                Binding::Button(_) => lua.to_value(&binding.source_ids()),
                Binding::Axis { negative, positive } => {
                    let t = lua.create_table()?;
                    t.set(
                        "negative",
                        negative.iter().map(actions::Source::id).collect::<Vec<_>>(),
                    )?;
                    t.set(
                        "positive",
                        positive.iter().map(actions::Source::id).collect::<Vec<_>>(),
                    )?;
                    Ok(Value::Table(t))
                }
            }
        })?,
    )?;
    let s = shared.clone();
    input.set(
        "reset_bindings",
        lua.create_function(move |_, ()| {
            let mut sh = s.borrow_mut();
            sh.bindings = sh.base_bindings.clone();
            Ok(())
        })?,
    )?;
    // rumble(strength, seconds) or rumble { strong, weak, seconds, pad }: shake a gamepad for a moment.
    let s = shared.clone();
    input.set(
        "rumble",
        lua.create_function(move |_, (a, b): (Value, Option<f64>)| {
            let (strong, weak, seconds, pad) = match a {
                Value::Table(t) => {
                    let o = Some(t);
                    let strong = number_option(&o, "strong")?;
                    let weak = number_option(&o, "weak")?;
                    let both = number_option(&o, "strength")?;
                    (
                        strong.or(both).unwrap_or(0.0),
                        weak.or(both).unwrap_or(0.0),
                        number_option(&o, "seconds")?.unwrap_or(0.2),
                        number_option(&o, "pad")?.unwrap_or(0.0),
                    )
                }
                Value::Number(n) => (n, n, b.unwrap_or(0.2), 0.0),
                Value::Integer(n) => (n as f64, n as f64, b.unwrap_or(0.2), 0.0),
                _ => {
                    return Err(lua_err(
                        "nova.input.rumble(strength, seconds) takes a strength from 0 to 1, or a table like { strong = 1, weak = 0.3, seconds = 0.4, pad = 1 }",
                    ))
                }
            };
            for (name, v) in [("strong", strong), ("weak", weak)] {
                if !v.is_finite() || !(0.0..=1.0).contains(&v) {
                    return Err(lua_err(format!("rumble {name} must be from 0 to 1, not {v}")));
                }
            }
            if !seconds.is_finite() || seconds <= 0.0 {
                return Err(lua_err(format!("rumble seconds must be greater than 0, not {seconds}")));
            }
            if pad.fract() != 0.0 || !(0.0..=f64::from(actions::MAX_PADS)).contains(&pad) {
                return Err(lua_err(format!(
                    "rumble pad must be a whole number from 1 to {} (or 0 for all pads), not {pad}",
                    actions::MAX_PADS
                )));
            }
            // a long rumble is cut short: a stuck motor is no fun
            s.borrow_mut().rumble.push(Rumble {
                pad: pad as u8,
                strong: strong as f32,
                weak: weak as f32,
                seconds: seconds.min(5.0) as f32,
            });
            Ok(())
        })?,
    )?;
    // last_source(): the input id (such as "key:KeyZ") that was most recently pressed, for
    // "press a button to bind it" screens; nil until something is pressed.
    let s = shared.clone();
    input.set(
        "last_source",
        lua.create_function(move |_, ()| Ok(s.borrow().last_source.clone()))?,
    )?;
    // pointer(): the mouse, or the first finger, as this step sees it
    let s = shared.clone();
    input.set(
        "pointer",
        lua.create_function(move |lua, ()| {
            let p = s.borrow().pointer_step;
            let t = lua.create_table()?;
            t.set("present", p.present)?;
            t.set("x", p.x as f64)?;
            t.set("y", p.y as f64)?;
            t.set("dx", p.dx as f64)?;
            t.set("dy", p.dy as f64)?;
            t.set("down", p.down)?;
            t.set("right", p.right)?;
            t.set("middle", p.middle)?;
            t.set("pressed", p.pressed)?;
            t.set("released", p.released)?;
            t.set("wheel", p.wheel as f64)?;
            Ok(t)
        })?,
    )?;
    // typed(): the characters typed on a keyboard since the last call (backspace is "\b", enter is "\n")
    let s = shared.clone();
    input.set(
        "typed",
        lua.create_function(move |_, ()| Ok(std::mem::take(&mut s.borrow_mut().typed)))?,
    )?;
    // cursor(on, { speed, stick, draw }): a stick moves a pointer and a button clicks it, for menus built for a mouse
    let s = shared.clone();
    input.set(
        "cursor",
        lua.create_function(move |_, (on, opts): (bool, Option<Table>)| {
            let mut sh = s.borrow_mut();
            sh.cursor.enabled = on;
            if !on {
                sh.cursor.active = false;
                return Ok(());
            }
            if let Some(v) = number_option(&opts, "speed")? {
                sh.cursor.speed = (v as f32).clamp(50.0, 5000.0);
            }
            match string_option(&opts, "stick")?.as_deref() {
                None => {}
                Some("right") => sh.cursor.left_stick = false,
                Some("left") => sh.cursor.left_stick = true,
                Some(other) => {
                    return Err(lua_err(format!(
                        "stick must be 'right' or 'left', not '{other}'"
                    )));
                }
            }
            if let Some(o) = &opts
                && let Some(d) = o.get::<Option<bool>>("draw")?
            {
                sh.cursor.draw = d;
            }
            Ok(())
        })?,
    )?;
    // grab_mouse(true): lock the cursor to the window and hide it, so that the mouse can turn a camera without end
    let s = shared.clone();
    input.set(
        "grab_mouse",
        lua.create_function(move |_, on: bool| {
            s.borrow_mut().grab_request = Some(on);
            Ok(())
        })?,
    )?;
    // next_source(): the source pressed since the last call (and forgets it), or nil: for "press the new key" screens,
    // which call it once when they start listening (to drop the press that opened the screen) and then every frame.
    let s = shared.clone();
    input.set(
        "next_source",
        lua.create_function(move |_, ()| Ok(s.borrow_mut().pending_source.take()))?,
    )?;
    nova.set("input", input)?;
    // --- sound: nova.sound.* effects, nova.music.* one background track ---
    let sound = lua.create_table()?;
    let music = lua.create_table()?;
    for is_music in [false, true] {
        let s = shared.clone();
        let table = if is_music { &music } else { &sound };
        table.set(
            "play",
            lua.create_function(move |_, (name, opts): (String, Option<Table>)| {
                let mut sh = s.borrow_mut();
                let looping = match &opts {
                    Some(t) => t.get::<Option<bool>>("loop")?.unwrap_or(is_music),
                    None => is_music,
                };
                // Ogg files in music/ are streamed when played as music.
                let streamed = if is_music { find_stream(&sh.streams, &name).cloned() } else { None };
                if streamed.is_none() && !is_music && find_stream(&sh.streams, &name).is_some() {
                    return Err(lua_err(format!(
                        "'{name}' is streamed music (an Ogg file in music/); play it with nova.music.play"
                    )));
                }
                let sample = match &streamed {
                    Some(src) => Arc::new(Sample { rate: src.rate, frames: Vec::new() }),
                    None => find_sound(&sh.sounds, &name)
                    .ok_or_else(|| {
                        let mut known: Vec<&str> = sh.sounds.keys().map(String::as_str).collect();
                        known.sort_unstable();
                        known.truncate(6);
                        lua_err(format!(
                            "unknown sound '{name}' (looked for '{name}' and '{name}.wav' or '.ogg' in 'sounds/' and 'music/'; sounds in this project: {})",
                            if known.is_empty() { "none".into() } else { known.join(", ") }
                        ))
                    })?
                    .clone(),
                };
                // a sound at a place in the world: loudness and pan from where the camera is
                let place = if is_music { None } else { spatial_options(&opts)? };
                let (mut volume, mut pan) = (
                    number_option(&opts, "volume")?.unwrap_or(1.0).clamp(0.0, 4.0) as f32,
                    number_option(&opts, "pan")?.unwrap_or(0.0).clamp(-1.0, 1.0) as f32,
                );
                if let Some((at, range)) = place {
                    let (gain, side) = spatial(&sh.camera, at, range);
                    if gain <= 0.001 && !looping {
                        return Ok(0); // too far to hear: not worth a voice
                    }
                    volume *= gain;
                    pan = side;
                }
                let id = sh.next_sound;
                sh.next_sound += 1;
                if is_music {
                    sh.current_music = Some((streamed.clone(), looping));
                    sh.music_position = None;
                }
                sh.audio.push(mixer::Command::Play(Box::new(mixer::Play {
                    id,
                    stream: streamed.map(|src| src.start(looping)),
                    sample,
                    volume,
                    pan,
                    pitch: number_option(&opts, "pitch")?.unwrap_or(1.0).clamp(0.05, 16.0) as f32,
                    looping,
                    music: is_music,
                    fade_in: number_option(&opts, "fade")?.unwrap_or(0.0).clamp(0.0, 60.0) as f32,
                    limit: number_option(&opts, "limit")?.unwrap_or(0.0).clamp(0.0, 32.0) as u32,
                })));
                // how much of it goes to the room's reverb (see nova.sound.room)
                let send = number_option(&opts, "reverb")?.unwrap_or(0.0);
                if !send.is_finite() || !(0.0..=1.0).contains(&send) {
                    return Err(lua_err(format!("reverb must be from 0 to 1, not {send}")));
                }
                if send > 0.0 {
                    sh.audio.push(mixer::Command::Send { id, send: send as f32 });
                }
                Ok(id)
            })?,
        )?;
        let s = shared.clone();
        table.set(
            "volume",
            lua.create_function(move |_, v: f64| {
                let v = v.clamp(0.0, 2.0) as f32;
                s.borrow_mut().audio.push(if is_music {
                    mixer::Command::MusicVolume(v)
                } else {
                    mixer::Command::SfxVolume(v)
                });
                Ok(())
            })?,
        )?;
    }
    let s = shared.clone();
    sound.set(
        "stop",
        lua.create_function(move |_, (id, fade): (u64, Option<f64>)| {
            s.borrow_mut().audio.push(mixer::Command::Stop {
                id,
                fade: fade.unwrap_or(0.0).clamp(0.0, 60.0) as f32,
            });
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    sound.set(
        "set",
        lua.create_function(move |_, (id, opts): (u64, Table)| {
            let mut known = 0;
            let mut read = |key: &str, lo: f64, hi: f64| -> mlua::Result<Option<f32>> {
                match opts.get::<Option<f64>>(key)? {
                    None => Ok(None),
                    Some(v) if v.is_finite() => {
                        known += 1;
                        Ok(Some(v.clamp(lo, hi) as f32))
                    }
                    Some(_) => Err(lua_err(format!("nova.sound.set: '{key}' must be a number"))),
                }
            };
            let (mut volume, mut pan, pitch) = (
                read("volume", 0.0, 4.0)?,
                read("pan", -1.0, 1.0)?,
                read("pitch", 0.05, 16.0)?,
            );
            let reverb = read("reverb", 0.0, 1.0)?;
            // `at`: follow a place in the world (a moving sound: call it every frame)
            if let Some((at, range)) = spatial_options(&Some(opts.clone()))? {
                known += 1;
                let (gain, side) = spatial(&s.borrow().camera, at, range);
                volume = Some(volume.unwrap_or(1.0) * gain);
                pan = Some(side);
            }
            if known == 0 {
                return Err(lua_err(
                    "nova.sound.set(id, { volume = ..., pan = ..., pitch = ..., reverb = ..., at = {x, y, z} }) needs at least one of volume, pan, pitch, reverb or at",
                ));
            }
            let mut sh = s.borrow_mut();
            if let Some(send) = reverb {
                sh.audio.push(mixer::Command::Send { id, send });
            }
            if volume.is_some() || pan.is_some() || pitch.is_some() {
                sh.audio.push(mixer::Command::Set { id, volume, pan, pitch });
            }
            Ok(())
        })?,
    )?;
    // room { size = 0.5, damping = 0.4, mix = 1 }: the reverb that sounds played with `reverb = ...` go to; nova.sound.room() takes it away
    let s = shared.clone();
    sound.set(
        "room",
        lua.create_function(move |_, opts: Option<Table>| {
            let room = match opts {
                None => None,
                Some(t) => {
                    let some = Some(t);
                    let read = |key: &str, default: f64, hi: f64| -> mlua::Result<f32> {
                        let v = number_option(&some, key)?.unwrap_or(default);
                        if !v.is_finite() || !(0.0..=hi).contains(&v) {
                            return Err(lua_err(format!(
                                "room {key} must be from 0 to {hi}, not {v}"
                            )));
                        }
                        Ok(v as f32)
                    };
                    Some(mixer::Room {
                        size: read("size", 0.5, 1.0)?,
                        damping: read("damping", 0.4, 1.0)?,
                        mix: read("mix", 1.0, 2.0)?,
                    })
                }
            };
            s.borrow_mut().audio.push(mixer::Command::Room(room));
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    sound.set(
        "stop_all",
        lua.create_function(move |_, ()| {
            s.borrow_mut().audio.push(mixer::Command::StopAll);
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    music.set(
        "position",
        lua.create_function(move |_, ()| Ok(s.borrow().music_position))?,
    )?;
    let s = shared.clone();
    music.set(
        "seek",
        lua.create_function(move |_, seconds: f64| {
            if !seconds.is_finite() || seconds < 0.0 {
                return Err(lua_err("seek needs a time in seconds, 0 or more"));
            }
            let mut sh = s.borrow_mut();
            let Some((stream, looping)) = sh.current_music.clone() else {
                return Ok(false); // nothing is playing
            };
            let feed = stream.map(|src| src.start_at(looping, (seconds * src.rate as f64) as u64));
            sh.audio.push(mixer::Command::SeekMusic { seconds, feed });
            sh.music_position = Some(seconds);
            Ok(true)
        })?,
    )?;
    let s = shared.clone();
    music.set(
        "stop",
        lua.create_function(move |_, fade: Option<f64>| {
            let mut sh = s.borrow_mut();
            sh.current_music = None;
            sh.music_position = None;
            sh.audio.push(mixer::Command::StopMusic {
                fade: fade.unwrap_or(0.0).clamp(0.0, 60.0) as f32,
            });
            Ok(())
        })?,
    )?;
    nova.set("sound", sound)?;
    nova.set("music", music)?;

    // --- save data: nova.save.get/set/delete/keys/flush ---
    let save = lua.create_table()?;
    let s = shared.clone();
    save.set(
        "get",
        lua.create_function(move |lua, (key, default): (String, Option<Value>)| {
            let sh = s.borrow();
            match sh.save.get(&key) {
                Some(v) => lua.to_value(v),
                None => Ok(default.unwrap_or(Value::Nil)),
            }
        })?,
    )?;
    let s = shared.clone();
    save.set(
        "set",
        lua.create_function(move |lua, (key, value): (String, Value)| {
            let json: serde_json::Value = lua
                .from_value(value)
                .map_err(|e| lua_err(format!("save.set('{key}'): this value cannot be saved ({e}); use numbers, strings, booleans and tables of those")))?;
            s.borrow_mut().save.set(&key, json).map_err(|e| lua_err(format!("save.set: {e}")))
        })?,
    )?;
    let s = shared.clone();
    save.set(
        "delete",
        lua.create_function(move |_, key: String| {
            s.borrow_mut().save.delete(&key);
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    save.set(
        "keys",
        lua.create_function(move |_, ()| {
            let mut keys: Vec<String> = s
                .borrow()
                .save
                .keys()
                .into_iter()
                .map(str::to_string)
                .collect();
            keys.sort();
            Ok(keys)
        })?,
    )?;
    let s = shared.clone();
    save.set(
        "flush",
        lua.create_function(move |_, ()| {
            s.borrow_mut()
                .save
                .flush()
                .map_err(|e| lua_err(format!("save.flush: {e}")))
        })?,
    )?;
    nova.set("save", save)?;

    // --- raw: lookups the Lua framework needs ---
    let raw = lua.create_table()?;
    let s = shared.clone();
    raw.set(
        "has_image",
        lua.create_function(move |_, id: String| {
            let sh = s.borrow();
            Ok(resolve_sprite(&sh.layout, &sh.sheets, &id).is_some())
        })?,
    )?;
    let s = shared.clone();
    raw.set(
        "has_model",
        lua.create_function(move |_, id: String| {
            Ok(find_model(&s.borrow().known_models, &id).is_some())
        })?,
    )?;
    let s = shared.clone();
    raw.set(
        "image_size",
        lua.create_function(move |_, id: String| {
            let sh = s.borrow();
            let (rect, sheet) = resolve_sprite(&sh.layout, &sh.sheets, &id)
                .ok_or_else(|| lua_err(format!("unknown image '{id}'")))?;
            Ok(match sheet {
                Some(def) => (def.frame_width as f64, def.frame_height as f64),
                None => (rect.w as f64, rect.h as f64),
            })
        })?,
    )?;
    // sprite_info(name): nil for plain images; for a sheet its frame count, per-frame
    // durations in milliseconds and tags as { sequence = {frames...}, loop = bool }.
    let s = shared.clone();
    raw.set(
        "sprite_info",
        lua.create_function(move |lua, id: String| {
            let sh = s.borrow();
            let Some((_, Some(def))) = resolve_sprite(&sh.layout, &sh.sheets, &id) else {
                return Ok(Value::Nil);
            };
            let info = lua.create_table()?;
            info.set("frames", def.frames)?;
            info.set("durations", def.durations_ms.clone())?;
            let tags = lua.create_table()?;
            for tag in &def.tags {
                let t = lua.create_table()?;
                t.set("sequence", tag.sequence())?;
                t.set("loop", tag.looping)?;
                tags.set(tag.name.clone(), t)?;
            }
            info.set("tags", tags)?;
            Ok(Value::Table(info))
        })?,
    )?;
    // --- tilemaps: tile data lives here, drawing is culled to the view ---
    let s = shared.clone();
    raw.set(
        "tilemap_create",
        lua.create_function(move |_, spec: Table| {
            let image: String = spec
                .get::<Option<String>>("image")?
                .ok_or_else(|| lua_err("tilemap: missing 'image' (the tileset PNG)"))?;
            let tile_w: u32 = spec.get::<Option<u32>>("tile_width")?.ok_or_else(|| lua_err("tilemap: missing 'tile_width'"))?;
            let tile_h: u32 = spec.get::<Option<u32>>("tile_height")?.ok_or_else(|| lua_err("tilemap: missing 'tile_height'"))?;
            let rows: Vec<Vec<i64>> = spec
                .get::<Option<Vec<Vec<i64>>>>("tiles")?
                .ok_or_else(|| lua_err("tilemap: missing 'tiles' (a list of rows of tile numbers)"))?;
            let mut sh = s.borrow_mut();
            let (id, size) = {
                let rect = find_image(&sh.layout, &image).ok_or_else(|| {
                    lua_err(format!("tilemap: unknown tileset image '{image}' (looked for '{image}' and 'sprites/{image}.png')"))
                })?;
                let id = sh
                    .layout
                    .rects
                    .iter()
                    .find(|(_, r)| *r == rect)
                    .map(|(k, _)| k.clone())
                    .expect("rect came from the layout");
                (id, (rect.w, rect.h))
            };
            let map = TileMap::new(&id, tile_w, tile_h, size, rows).map_err(|e| lua_err(format!("tilemap: {e}")))?;
            sh.tilemaps.push(map);
            Ok(sh.tilemaps.len() - 1)
        })?,
    )?;
    let s = shared.clone();
    raw.set(
        "tilemap_get",
        lua.create_function(move |_, (id, col, row): (usize, i64, i64)| {
            let sh = s.borrow();
            let map = sh
                .tilemaps
                .get(id)
                .ok_or_else(|| lua_err("unknown tilemap"))?;
            Ok(map.get(col, row) as i64)
        })?,
    )?;
    let s = shared.clone();
    raw.set(
        "tilemap_set",
        lua.create_function(move |_, (id, col, row, tile): (usize, i64, i64, i64)| {
            let mut sh = s.borrow_mut();
            let map = sh
                .tilemaps
                .get_mut(id)
                .ok_or_else(|| lua_err("unknown tilemap"))?;
            map.set(col, row, tile)
                .map_err(|e| lua_err(format!("tilemap: {e}")))
        })?,
    )?;
    let s = shared.clone();
    raw.set(
        "tilemap_size",
        lua.create_function(move |_, id: usize| {
            let sh = s.borrow();
            let map = sh
                .tilemaps
                .get(id)
                .ok_or_else(|| lua_err("unknown tilemap"))?;
            Ok((map.width, map.height, map.tile_w, map.tile_h))
        })?,
    )?;
    // tilemap_draw(id, x, y, layer): x, y is where the map's top-left corner is on screen.
    let s = shared.clone();
    raw.set(
        "tilemap_draw",
        lua.create_function(
            move |_, (id, ox, oy, layer): (usize, f64, f64, Option<String>)| {
                let mut sh = s.borrow_mut();
                let ui = match layer.as_deref() {
                    None | Some("world") => false,
                    Some("ui") => true,
                    Some(other) => {
                        return Err(lua_err(format!(
                            "tilemap_draw: layer must be 'world' or 'ui', not '{other}'"
                        )));
                    }
                };
                let view = sh.view;
                let (ox, oy) = (ox as f32, oy as f32);
                let mut out = std::mem::take(if ui { &mut sh.ui } else { &mut sh.world });
                {
                    let map = sh
                        .tilemaps
                        .get(id)
                        .ok_or_else(|| lua_err("unknown tilemap"))?;
                    if let Some((c0, c1, r0, r1)) = map.visible(ox, oy, 1.0, view) {
                        let rect = sh.layout.rects[&map.image];
                        let (tw, th) = (map.tile_w as f32, map.tile_h as f32);
                        for row in r0..=r1 {
                            for col in c0..=c1 {
                                let tile = map.get(col as i64, row as i64);
                                if tile < 0 {
                                    continue;
                                }
                                let t = tile as u32;
                                let cell = assets::AtlasRect {
                                    x: rect.x + (t % map.columns) * map.tile_w,
                                    y: rect.y + (t / map.columns) * map.tile_h,
                                    w: map.tile_w,
                                    h: map.tile_h,
                                };
                                out.push(SpriteInstance {
                                    center: [
                                        ox + (col as f32 + 0.5) * tw,
                                        oy + (row as f32 + 0.5) * th,
                                    ],
                                    size: [tw, th],
                                    uv: sh.layout.uv(&cell),
                                    color: [255; 4],
                                    rotation: 0.0,
                                });
                            }
                        }
                    }
                }
                *(if ui { &mut sh.ui } else { &mut sh.world }) = out;
                Ok(())
            },
        )?,
    )?;
    let s = shared.clone();
    raw.set(
        "input_step",
        lua.create_function(move |_, ()| {
            let mut sh = s.borrow_mut();
            sh.states.begin_step();
            sh.begin_pointer_step();
            Ok(())
        })?,
    )?;
    // freeze_time(on): the engine's clock stops (nova.pause calls this) and carries on from the same moment when it is let go
    let s = shared.clone();
    raw.set(
        "freeze_time",
        lua.create_function(move |_, on: bool| {
            let mut sh = s.borrow_mut();
            if on && !sh.frozen {
                sh.frozen = true;
                sh.frozen_at = sh.time;
            } else if !on && sh.frozen {
                sh.frozen = false;
                sh.time_offset = sh.real_time - sh.frozen_at;
            }
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    raw.set(
        "use_fixed_steps",
        lua.create_function(move |_, ()| {
            s.borrow_mut().fixed_steps = true;
            Ok(())
        })?,
    )?;
    let scene_vfs = vfs.clone();
    raw.set(
        "scene_data",
        lua.create_function(move |lua, name: String| {
            let path = format!("scenes/{}.scene.json", name.replace('.', "/"));
            if !scene_vfs.exists(&path) {
                return Ok(Value::Nil);
            }
            let bytes = scene_vfs.read(&path).map_err(lua_err)?;
            let text = String::from_utf8(bytes)
                .map_err(|_| lua_err(format!("{path} is not valid UTF-8")))?;
            let data = scene::parse_scene(&text, &path).map_err(lua_err)?;
            lua.to_value(&data)
        })?,
    )?;
    retained_api::install(lua, shared, &raw)?;
    nova.set("raw", raw)?;
    lua.globals().set("nova", nova)?;

    // --- require: modules come only from inside the project ---
    let loaded: Table = lua.create_table()?;
    let loading: Table = lua.create_table()?;
    let vfs = vfs.clone();
    lua.globals().set(
        "require",
        lua.create_function(move |lua, name: String| {
            if let Some(v) = loaded.get::<Option<Value>>(name.clone())? {
                return Ok(v);
            }
            if loading.get::<Option<bool>>(name.clone())?.unwrap_or(false) {
                return Err(lua_err(format!("circular require of '{name}'")));
            }
            if let Some(builtin) = builtin_module(&name) {
                loading.set(name.clone(), true)?;
                let result: mlua::Result<Value> =
                    lua.load(builtin).set_name(format!("={name}")).call(());
                loading.set(name.clone(), Value::Nil)?;
                let value = result?;
                loaded.set(name, value.clone())?;
                return Ok(value);
            }
            let path = format!("{}.lua", name.replace('.', "/"));
            let source = vfs
                .read(&path)
                .map_err(|e| lua_err(format!("module '{name}' not found: {e}")))?;
            let source = String::from_utf8(source)
                .map_err(|_| lua_err(format!("module '{name}' is not valid UTF-8")))?;
            loading.set(name.clone(), true)?;
            let result: mlua::Result<Value> =
                lua.load(&source).set_name(format!("@{path}")).call(());
            loading.set(name.clone(), Value::Nil)?;
            let value = result?;
            let value = if matches!(value, Value::Nil) {
                Value::Boolean(true)
            } else {
                value
            };
            loaded.set(name, value.clone())?;
            Ok(value)
        })?,
    )?;
    Ok(())
}

impl Game {
    /// Reads the project, decodes every image and model, packs the atlas and runs the
    /// entry script. Project problems (manifest, assets) are errors; a Lua error in the
    /// entry script is not: it shows in `error` so a fix hot-reloads.
    pub fn load(vfs: Rc<dyn Vfs>) -> Result<Game, String> {
        Self::load_with(vfs, &|_| None)
    }

    /// Like `load`, with save data kept in the folder `save_dir(game_name)` names (None keeps
    /// it in memory). The save is opened before any script runs, so scripts can read it at load.
    pub fn load_with(
        vfs: Rc<dyn Vfs>,
        save_dir: &dyn Fn(&str) -> Option<std::path::PathBuf>,
    ) -> Result<Game, String> {
        let project = Project::open(vfs.as_ref())?;
        let mut warnings = project.warnings.clone();
        let mut store = SaveStore::memory();
        let mut chosen_dir = None;
        if let Some(dir) = save_dir(&project.manifest.name) {
            match SaveStore::open(&dir) {
                Ok((opened, warning)) => {
                    warnings.extend(warning);
                    store = opened;
                    chosen_dir = Some(dir);
                }
                Err(e) => warnings.push(format!("saving is off: {e}")),
            }
        }

        let mut images = Vec::new();
        let mut fx_images = Vec::new();
        for asset in project.assets_of(AssetKind::Image) {
            let bytes = vfs.read(&asset.id)?;
            let image = assets::decode_png(&bytes).map_err(|e| format!("{}: {e}", asset.id))?;
            if asset.id.starts_with(billboard_api::FOLDER) {
                fx_images.push((asset.id.clone(), image.clone()));
            }
            images.push((asset.id.clone(), image));
        }
        let (atlas, layout) = assets::build_atlas(images, assets::MAX_ATLAS)?;

        let mut sheets = HashMap::new();
        for asset in project.assets_of(AssetKind::Sheet) {
            let text = String::from_utf8(vfs.read(&asset.id)?)
                .map_err(|_| format!("{}: not valid UTF-8", asset.id))?;
            let def = sprite::parse_sprite(&text, &asset.id, &|image| {
                layout
                    .rects
                    .get(image)
                    .filter(|_| image != assets::WHITE)
                    .map(|r| (r.w, r.h))
            })?;
            sheets.insert(asset.id.clone(), def);
        }

        let mut meshes = Vec::new();
        // pictures for `nova.billboard`: a textured quad per frame
        let mut fx_sprites = HashMap::new();
        for (id, image) in &fx_images {
            let sheet = sheets.values().find(|d| &d.image == id);
            let quads = billboard_api::frame_meshes(image, sheet);
            fx_sprites.insert(id.clone(), quads.len() as u32);
            for (frame, mesh) in quads.into_iter().enumerate() {
                meshes.push((billboard_api::mesh_key(id, frame as u32), mesh, None));
            }
        }
        let mut model_ids = Vec::new();
        let mut model_parts: HashMap<String, Vec<PartRt>> = HashMap::new();
        let mut model_clips: HashMap<String, Vec<model::Clip>> = HashMap::new();
        let mut model_colliders: HashMap<String, Vec<[f32; 3]>> = HashMap::new();
        let mut model_scales: HashMap<String, f32> = HashMap::new();
        for asset in project.assets_of(AssetKind::Model) {
            let bytes = vfs.read(&asset.id)?;
            let mesh = model::import_glb(&bytes).map_err(|e| format!("{}: {e}", asset.id))?;
            // The same file as separate parts, used when a script turns parts or plays a clip. That importer handles skins and
            // animation clips, so the whole-model importer's notes that it ignores them do not apply when it succeeds.
            let as_parts = model::import_parts(&bytes);
            for note in &mesh.notes {
                let handled = as_parts.is_ok()
                    && (note == "animations are ignored" || note == "skins/bones are ignored");
                if !handled {
                    warnings.push(format!("{}: {note}", asset.id));
                }
            }
            meshes.push((asset.id.clone(), mesh, None));
            model_ids.push(asset.id.clone());
            if let Ok(imported) = as_parts {
                if (imported.scale - 1.0).abs() > 1e-6 {
                    model_scales.insert(asset.id.clone(), imported.scale);
                }
                model_clips.insert(asset.id.clone(), imported.clips);
                if !imported.colliders.is_empty() {
                    model_colliders.insert(asset.id.clone(), imported.colliders);
                }
                let mut runtime = Vec::with_capacity(imported.parts.len());
                for part in imported.parts {
                    let mut skinned = None;
                    let mesh_key = match (part.mesh, part.skin) {
                        (Some(m), Some(mut skin)) => {
                            // One mesh, bent on the GPU: its joint weights go up with it.
                            let key = format!("{}#{}#skin", asset.id, part.name);
                            let influences = std::mem::take(&mut skin.influences);
                            meshes.push((key.clone(), m, Some(influences)));
                            skinned = Some(Rc::new(SkinnedPart { skin, key }));
                            None
                        }
                        (Some(m), None) => {
                            let key = format!("{}#{}", asset.id, part.name);
                            meshes.push((key.clone(), m, None));
                            Some(key)
                        }
                        (None, _) => None,
                    };
                    runtime.push(PartRt {
                        name: part.name,
                        parent: part.parent,
                        rest: part.rest,
                        mesh_key,
                        skinned,
                    });
                }
                model_parts.insert(asset.id.clone(), runtime);
            }
        }

        let mut sounds: HashMap<String, Arc<Sample>> = HashMap::new();
        let mut streams: HashMap<String, StreamSource> = HashMap::new();
        let mut sound_bytes = 0usize;
        for asset in project.assets_of(AssetKind::Audio) {
            let lower = asset.id.to_ascii_lowercase();
            if !lower.ends_with(".wav") && !lower.ends_with(".ogg") {
                warnings.push(format!(
                    "'{}' is not a WAV or Ogg Vorbis file, so it is ignored",
                    asset.id
                ));
                continue;
            }
            if lower.ends_with(".ogg") && asset.id.starts_with("music/") {
                // Music in Ogg is not decoded now: only its header is checked, and it streams when played.
                let source = StreamSource::new(vfs.read(&asset.id)?)
                    .map_err(|e| format!("{}: {e}", asset.id))?;
                streams.insert(asset.id.clone(), source);
                continue;
            }
            let sample = assets::decode_sound(&asset.id, &vfs.read(&asset.id)?)
                .map_err(|e| format!("{}: {e}", asset.id))?;
            sound_bytes += sample.frames.len() * 4;
            if sound_bytes > assets::MAX_SOUND_BYTES {
                return Err(format!(
                    "the project's sounds need more than {} MiB of memory (reached at '{}'); shorten or remove some",
                    assets::MAX_SOUND_BYTES >> 20,
                    asset.id
                ));
            }
            sounds.insert(asset.id.clone(), Arc::new(sample));
        }

        let bindings = match &project.manifest.input {
            Some(input) => Bindings::from_manifest(input)?,
            None => Bindings::defaults(),
        };
        let mut text = TextEngine::new().map_err(|e| format!("built-in fonts: {e}"))?;
        for asset in project.assets_of(AssetKind::Font) {
            text.add_font(&asset.id, &vfs.read(&asset.id)?)
                .map_err(|e| format!("{}: {e}", asset.id))?;
        }

        let shared = Rc::new(RefCell::new(Shared {
            bindings: bindings.clone(),
            base_bindings: bindings,
            states: ActionStates::default(),
            last_source: None,
            pending_source: None,
            fixed_steps: false,
            view: [960.0, 540.0],
            time: 0.0,
            layout: layout.clone(),
            sheets,
            tilemaps: Vec::new(),
            text,
            text_out: Vec::new(),
            pixel_scale: 1.0,
            sounds,
            streams,
            current_music: None,
            music_position: None,
            audio: Vec::new(),
            rumble: Vec::new(),
            host_stats: HostStats::default(),
            pointer_now: actions::PointerFrame::default(),
            pointer_acc: actions::PointerFrame::default(),
            pointer_step: actions::PointerFrame::default(),
            grab_request: None,
            lua_ms: 0.0,
            lua_kb: 0.0,
            next_sound: 1,
            save: store,
            mesh_ids: HashMap::new(),
            known_models: model_ids,
            fx_sprites,
            model_scales,
            parts: model_parts,
            clips: model_clips,
            colliders: model_colliders,
            lighting: Lighting::default(),
            world: Vec::new(),
            ui: Vec::new(),
            models: Vec::new(),
            ui_models: Vec::new(),
            joints: Vec::new(),
            voxel: crate::voxel::World::new(),
            cubes: HashMap::new(),
            walls: crate::walls::Walls::default(),
            nav: crate::walls::Nav::default(),
            baked: Vec::new(),
            retained: Default::default(),
            solid: Default::default(),
            light_requests: Vec::new(),
            light_fader: Default::default(),
            cursor: PadCursor::default(),
            typed: String::new(),
            cursor_sources: HashMap::new(),
            frame_dt: 1.0 / 60.0,
            frozen: false,
            frozen_at: 0.0,
            real_time: 0.0,
            time_offset: 0.0,
            deadline: Rc::new(Cell::new(None)),
            profile: Rc::new(RefCell::new(Profile::default())),
            camera: DEFAULT_CAMERA,
            clear: srgb_to_linear([0.36, 0.55, 0.78, 1.0]),
            log: Vec::new(),
        }));
        let lua = new_lua();
        lua.set_memory_limit(LUA_MEMORY_LIMIT)
            .map_err(|e| format!("cannot limit Lua memory: {e}"))?;
        // A hook every 20,000 VM instructions checks the clock. It is global, so scripts
        // started with go() (coroutines) are covered as well.
        let deadline = shared.borrow().deadline.clone();
        install_hook(
            &lua,
            deadline.clone(),
            shared.borrow().profile.clone(),
            false,
        )
        .map_err(|e| format!("cannot install the script time limit: {e}"))?;
        let mut game = Game {
            deadline,
            stamp: vfs.stamp(),
            vfs: vfs.clone(),
            lua,
            shared: shared.clone(),
            atlas: Some(atlas),
            meshes,
            world: Vec::new(),
            ui: Vec::new(),
            text: Vec::new(),
            models: Vec::new(),
            ui_models: Vec::new(),
            joints: Vec::new(),
            mesh_ops: Vec::new(),
            camera: DEFAULT_CAMERA,
            lighting: Lighting::default(),
            clear: srgb_to_linear([0.36, 0.55, 0.78, 1.0]),
            error: None,
            error_detail: None,
            warnings,
            last_update: Duration::ZERO,
            checked: Instant::now(),
            last_flush: Instant::now(),
            save_dir: chosen_dir,
            project,
        };
        for warning in &game.warnings {
            log::warn!("project: {warning}");
        }
        let entry = game.project.manifest.entry.clone();
        game.deadline.set(Some(Instant::now() + LOAD_BUDGET));
        let result = (|| -> mlua::Result<()> {
            register_api(&game.lua, &shared, &vfs)?;
            game.lua
                .load(FRAMEWORK)
                .set_name("=nova.framework")
                .exec()?;
            let source = vfs.read(&entry).map_err(lua_err)?;
            let source = String::from_utf8(source)
                .map_err(|_| lua_err(format!("{entry} is not valid UTF-8")))?;
            game.lua
                .load(&source)
                .set_name(format!("@{entry}"))
                .exec()?;
            if let Ok(init) = game.lua.globals().get::<Function>("init") {
                init.call::<()>(())?;
            }
            Ok(())
        })();
        game.deadline.set(None);
        if let Err(e) = result {
            log::error!("script error: {e}");
            game.error_detail = Some(e.to_string());
            game.error = Some(first_line(&e.to_string()));
        }
        Ok(game)
    }

    /// Uploads the atlas and meshes (to the GPU). Call once after `load`, before `update`.
    pub fn upload<U: Uploader>(&mut self, target: &mut U) {
        if let Some(atlas) = self.atlas.take() {
            target.set_atlas(&atlas);
        }
        let mut ids = HashMap::new();
        // the flat strip that `nova.line3` stretches into a line (both sides, lit by nothing)
        ids.insert(
            voxel_api::LINE_MESH.to_string(),
            target.add_mesh(&voxel_api::line_mesh()),
        );
        // the same strip, drawn blended, for marks with a see-through colour
        ids.insert(
            voxel_api::SOFT_MESH.to_string(),
            target.add_mesh(&voxel_api::soft_mesh()),
        );
        // a round soft disc for shadow blobs (`nova.quad3` with `round = true`)
        ids.insert(
            voxel_api::BLOB_MESH.to_string(),
            target.add_mesh(&voxel_api::blob_mesh()),
        );
        // the cube `nova.cuboid` stretches into walls and parts (lit, and at full colour)
        ids.insert(
            walls_api::CUBE_MESH.to_string(),
            target.add_mesh(&walls_api::cube_mesh(false)),
        );
        ids.insert(
            walls_api::CUBE_GLOW_MESH.to_string(),
            target.add_mesh(&walls_api::cube_mesh(true)),
        );
        for (id, mesh, influences) in std::mem::take(&mut self.meshes) {
            let mesh_id = match influences {
                Some(influences) => target.add_skinned_mesh(&mesh, &influences),
                None => target.add_mesh(&mesh),
            };
            ids.insert(id, mesh_id);
        }
        self.shared.borrow_mut().mesh_ids = ids;
    }

    /// Keeps this game's save data in `dir` (read now, written as it changes). Without it the
    /// save data lives in memory only. Returns a warning when an unreadable save was set aside.
    pub fn open_save(&mut self, dir: &std::path::Path) -> Result<Option<String>, String> {
        let (store, warning) = SaveStore::open(dir)?;
        self.shared.borrow_mut().save = store;
        self.save_dir = Some(dir.to_path_buf());
        Ok(warning)
    }

    /// The folder save data is kept in, if it is saved at all.
    pub fn save_dir(&self) -> Option<&std::path::Path> {
        self.save_dir.as_deref()
    }

    /// Writes unsaved changes now (also done every few seconds and when the game is dropped).
    pub fn flush_save(&self) {
        if let Err(e) = self.shared.borrow_mut().save.flush() {
            log::error!("{e}");
        }
    }

    /// The periodic save: written by another thread, so that a big save does not hitch a frame.
    fn flush_save_in_background(&self) {
        if let Err(e) = self.shared.borrow_mut().save.flush_background() {
            log::error!("{e}");
        }
    }

    /// Sound commands scripts queued since the last call, for the host to hand to the mixer.
    /// How far into the music track the audio thread is, for `nova.music.position()` (None when no music plays).
    pub fn set_music_position(&self, position: Option<f64>) {
        let mut sh = self.shared.borrow_mut();
        if sh.current_music.is_some() {
            sh.music_position = position;
        }
    }

    pub fn take_audio(&self) -> Vec<mixer::Command> {
        std::mem::take(&mut self.shared.borrow_mut().audio)
    }

    /// What the host measured about the previous frame (the game's own time and memory are added here), for `nova.stats()`.
    pub fn set_host_stats(&mut self, stats: HostStats) {
        let mut sh = self.shared.borrow_mut();
        sh.host_stats = stats;
        sh.lua_ms = self.last_update.as_secs_f32() * 1000.0;
        sh.lua_kb = self.lua.used_memory() as f32 / 1024.0;
    }

    /// Did a script ask for the mouse to be locked (true) or freed (false) since the last call?
    pub fn take_grab_request(&self) -> Option<bool> {
        self.shared.borrow_mut().grab_request.take()
    }

    /// Does any action of this game use the source (such as `key:Escape`)?
    pub fn uses_source(&self, id: &str) -> bool {
        self.shared.borrow().bindings.uses_source(id)
    }

    /// Gamepad rumbles that scripts asked for since the last call.
    pub fn take_rumble(&self) -> Vec<Rumble> {
        std::mem::take(&mut self.shared.borrow_mut().rumble)
    }

    /// Physical pixels per logical unit of the screen the game is drawn on (text is rasterised at
    /// this scale so letters stay sharp). Tests leave it at 1.
    pub fn set_pixel_scale(&mut self, scale: f32) {
        self.shared.borrow_mut().pixel_scale = scale;
    }

    /// The glyph atlas, when new letters were rasterised since the last call, for the GPU upload.
    pub fn take_glyph_atlas(&self) -> Option<Vec<u8>> {
        self.shared
            .borrow_mut()
            .text
            .take_atlas_if_dirty()
            .map(<[u8]>::to_vec)
    }

    /// Makes `math.random` repeatable from here on (tests and replays). Randomness used while the
    /// project loads is not affected.
    pub fn reseed(&self, seed: u64) {
        if let Ok(random_seed) = self
            .lua
            .globals()
            .get::<Table>("math")
            .and_then(|m| m.get::<Function>("randomseed"))
        {
            let _ = random_seed.call::<()>(seed as i64);
        }
    }

    pub fn world_height(&self) -> u32 {
        self.project.manifest.world_height
    }

    pub fn set_error(&mut self, message: String) {
        log::error!("{message}");
        self.error = Some(first_line(&message));
        self.error_detail = Some(message);
    }

    /// True when files changed on disk since the last check (at most every 400 ms).
    pub fn changed_on_disk(&mut self) -> bool {
        if self.checked.elapsed() < Duration::from_millis(400) {
            return false;
        }
        self.checked = Instant::now();
        let stamp = self.vfs.stamp();
        if stamp.is_some() && stamp != self.stamp {
            self.stamp = stamp;
            return true;
        }
        false
    }

    pub fn vfs(&self) -> Rc<dyn Vfs> {
        self.vfs.clone()
    }

    pub fn take_log(&self) -> Vec<String> {
        std::mem::take(&mut self.shared.borrow_mut().log)
    }

    /// Compatibility entry point: the four original actions as plain values.
    pub fn update(&mut self, dt: f32, time: f64, view: [f32; 2], actions: Actions, _pressed: bool) {
        self.update_input(dt, time, view, &InputFrame::from_actions(actions));
    }

    /// Runs one frame of scripts with this frame's input and collects what they asked to draw.
    pub fn update_input(&mut self, dt: f32, time: f64, view: [f32; 2], input: &InputFrame) {
        {
            let mut sh = self.shared.borrow_mut();
            std::mem::swap(&mut sh.world, &mut self.world);
            std::mem::swap(&mut sh.ui, &mut self.ui);
            std::mem::swap(&mut sh.text_out, &mut self.text);
            std::mem::swap(&mut sh.models, &mut self.models);
            std::mem::swap(&mut sh.ui_models, &mut self.ui_models);
            std::mem::swap(&mut sh.joints, &mut self.joints);
            sh.ui_models.clear();
            sh.world.clear();
            sh.ui.clear();
            sh.text_out.clear();
            sh.models.clear();
            sh.joints.clear();
            let bindings = sh.bindings.clone();
            sh.states
                .update(&bindings, &input.sources, &input.overrides);
            sh.frame_dt = dt;
            sh.typed.push_str(&input.typed);
            if sh.cursor.enabled {
                sh.cursor_sources.clone_from(&input.sources);
            }
            if input.last_source.is_some() {
                sh.last_source = input.last_source.clone();
                sh.pending_source = input.last_source.clone();
            }
            sh.take_pointer(&input.pointer);
            sh.view = view; // (before the pointer step, which keeps the pad cursor inside it)
            if !sh.fixed_steps {
                sh.states.begin_step(); // without the framework every frame is one step
                sh.begin_pointer_step();
            }
            sh.real_time = time;
            sh.time = if sh.frozen {
                sh.frozen_at
            } else {
                time - sh.time_offset
            };
        }
        if self.error.is_none() {
            let started = Instant::now();
            self.deadline.set(Some(started + FRAME_BUDGET));
            {
                let profile = self.shared.borrow().profile.clone();
                let mut p = profile.borrow_mut();
                if p.on {
                    p.last = Some(started);
                }
            }
            let globals = self.lua.globals();
            let mut result = Ok(());
            if let Ok(update) = globals.get::<Function>("update") {
                result = update.call::<()>(dt);
            }
            if result.is_ok()
                && let Ok(draw) = globals.get::<Function>("draw")
            {
                result = draw.call::<()>(());
            }
            self.deadline.set(None);
            self.shared.borrow().profile.borrow_mut().last = None;
            self.last_update = started.elapsed();
            if let Err(e) = result {
                log::error!("script error: {e}");
                self.error_detail = Some(e.to_string());
                self.error = Some(first_line(&e.to_string()));
            }
        }
        if self.last_flush.elapsed() > Duration::from_secs(3) {
            self.last_flush = Instant::now();
            self.flush_save_in_background();
        }
        let mut sh = self.shared.borrow_mut();
        std::mem::swap(&mut sh.world, &mut self.world);
        std::mem::swap(&mut sh.ui, &mut self.ui);
        std::mem::swap(&mut sh.text_out, &mut self.text);
        std::mem::swap(&mut sh.models, &mut self.models);
        std::mem::swap(&mut sh.ui_models, &mut self.ui_models);
        std::mem::swap(&mut sh.joints, &mut self.joints);
        let made = std::mem::take(&mut sh.voxel.ops);
        self.mesh_ops.extend(made);
        // equal meshes become one instanced draw; meshes made by scripts (voxel chunks) stay in the order they were drawn in,
        // which is far to near, so that water blends in a sensible order
        // (lone cubes are script-made too, but one kind after another is exactly what lets them be instanced)
        self.models.sort_by_key(|m| {
            if m.mesh >= crate::gfx::DYN_MESH_BASE + CUBE_MESH_OFFSET {
                (2, m.mesh)
            } else if m.mesh >= crate::gfx::DYN_MESH_BASE {
                (1, 0)
            } else {
                (0, m.mesh)
            }
        });
        // the lights for the frame: the nearest of those asked for, fading in and out as the choice changes
        let requests = std::mem::take(&mut sh.light_requests);
        let eye = sh.camera.eye.to_array();
        let dt = sh.frame_dt;
        let lights = sh
            .light_fader
            .resolve(&requests, eye, dt, crate::gfx::MAX_POINT_LIGHTS);
        sh.lighting.point_count = 0;
        for light in lights {
            sh.lighting.push_point(light);
        }
        self.camera = sh.camera;
        self.lighting = sh.lighting;
        if let Some(sky) = self.lighting.sky.as_mut() {
            sky.time = (sh.time % 100_000.0) as f32;
        }
        self.lighting.wind.time = (sh.time % 100_000.0) as f32;
        sh.lighting.point_count = 0; // point lights last one frame; the sun and ambient stay
        self.clear = sh.clear;
        let white = sh.layout.white_uv();
        // the pad cursor, drawn over everything while it is in use
        if sh.cursor.enabled && sh.cursor.active && sh.cursor.draw {
            let (x, y) = (sh.cursor.x, sh.cursor.y);
            for (dx, dy, w, h, color) in [
                (-1.0, -9.0, 2.0, 18.0, [255, 255, 255, 255]),
                (-9.0, -1.0, 18.0, 2.0, [255, 255, 255, 255]),
                (-2.0, -10.0, 4.0, 20.0, [0, 0, 0, 170]),
                (-10.0, -2.0, 20.0, 4.0, [0, 0, 0, 170]),
            ] {
                // (the dark outline goes first so that the white lines are on top)
                self.ui.push(SpriteInstance {
                    center: [x + dx + w * 0.5, y + dy + h * 0.5],
                    size: [w, h],
                    uv: white,
                    color,
                    rotation: 0.0,
                });
            }
            let n = self.ui.len();
            self.ui[n - 4..].reverse();
        }
        drop(sh);
        if let Some(error) = &self.error {
            let columns = (((view[0] - 24.0) / 12.0).floor() as usize).max(10);
            let wrapped: Vec<String> = error
                .chars()
                .collect::<Vec<_>>()
                .chunks(columns)
                .map(|c| c.iter().collect())
                .collect();
            let text = format!("ERROR\n{}", wrapped.join("\n"));
            let height = text.lines().count() as f32 * 18.0 + 12.0;
            self.ui.push(SpriteInstance {
                center: [view[0] * 0.5, 6.0 + height * 0.5],
                size: [view[0] - 8.0, height],
                uv: white,
                color: [150, 20, 20, 235],
                rotation: 0.0,
            });
            font::draw_text(
                &mut self.ui,
                white,
                12.0,
                12.0,
                2.0,
                [255, 255, 255, 255],
                &text,
            );
        }
    }

    /// Adds debug text to the UI layer (stats overlay).
    pub fn debug_text(&mut self, x: f32, y: f32, text: &str) {
        let white = self.shared.borrow().layout.white_uv();
        let w = font::text_width(2.0, text);
        let h = text.lines().count() as f32 * 18.0;
        self.ui.push(SpriteInstance {
            center: [x + (w + 8.0) * 0.5 - 4.0, y + (h + 8.0) * 0.5 - 4.0],
            size: [w + 8.0, h + 8.0],
            uv: white,
            color: [0, 0, 0, 170],
            rotation: 0.0,
        });
        font::draw_text(&mut self.ui, white, x, y, 2.0, [255, 255, 255, 255], text);
    }

    /// Starts or stops the Lua profiler (see `nova.profile`); starting clears what it had seen.
    pub fn set_profile(&mut self, on: bool) {
        let sh = self.shared.borrow();
        {
            let mut p = sh.profile.borrow_mut();
            if on {
                *p = Profile::default();
            }
            p.on = on;
        }
        let _ = install_hook(&self.lua, sh.deadline.clone(), sh.profile.clone(), on);
    }

    /// The functions that took the most script time, most first: (name, milliseconds, samples), and the total.
    pub fn profile_report(&self, top: usize) -> (Vec<(String, f64, u32)>, f64) {
        let sh = self.shared.borrow();
        let p = sh.profile.borrow();
        let mut v: Vec<(String, f64, u32)> = p
            .by_function
            .iter()
            .map(|(k, (ms, n))| (k.clone(), *ms, *n))
            .collect();
        v.sort_by(|a, b| b.1.total_cmp(&a.1));
        v.truncate(top);
        (v, p.total_ms)
    }

    /// No worker threads for the voxel world, so that a run does the same thing every time (tests and headless runs).
    pub fn set_deterministic(&mut self, on: bool) {
        self.shared.borrow_mut().voxel.set_deterministic(on);
    }

    /// The renderer has applied the meshes scripts made (call after drawing a frame, so each is applied once).
    pub fn clear_mesh_ops(&mut self) {
        self.mesh_ops.clear();
    }

    pub fn frame_input(&self, world_height: u32) -> FrameInput<'_> {
        FrameInput {
            clear: self.clear,
            camera: self.camera,
            sprites_back: &self.world,
            models: &self.models,
            joints: &self.joints,
            mesh_ops: &self.mesh_ops,
            ui_models: &self.ui_models,
            lighting: self.lighting,
            sprites_front: &self.ui,
            text: &self.text,
            world_height,
        }
    }

    pub fn image_ids(&self) -> BTreeMap<String, (u32, u32)> {
        self.shared
            .borrow()
            .layout
            .rects
            .iter()
            .filter(|(id, _)| id.as_str() != assets::WHITE)
            .map(|(id, r)| (id.clone(), (r.w, r.h)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::MemVfs;

    fn png_1x1() -> Vec<u8> {
        let mut out = Vec::new();
        let mut e = png::Encoder::new(&mut out, 2, 2);
        e.set_color(png::ColorType::Rgba);
        e.set_depth(png::BitDepth::Eight);
        e.write_header()
            .unwrap()
            .write_image_data(&[255u8; 16])
            .unwrap();
        out
    }

    fn game(files: Vec<(&str, Vec<u8>)>) -> Game {
        let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(files));
        Game::load(vfs).expect("project loads")
    }

    fn manifest() -> Vec<u8> {
        br#"{"format":1,"name":"T"}"#.to_vec()
    }

    fn run(game: &mut Game) {
        game.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
    }

    #[test]
    fn scripts_draw_sprites_text_and_rects_into_the_right_layers() {
        let mut g = game(vec![
            ("nova.json", manifest()),
            ("a.png", png_1x1()),
            (
                "main.lua",
                br#"function update(dt)
                      nova.sprite('a.png', 10, 20, {scale = 3, rotation = 0.5, color = {255, 0, 0, 128}})
                      nova.rect(0, 0, 4, 4, {1, 2, 3, 4})
                      nova.ui.text(5, 5, 'HI')
                      nova.ui.sprite('a.png', 1, 2, {anchor = 'topleft'})
                    end"#
                    .to_vec(),
            ),
        ]);
        run(&mut g);
        assert!(g.error.is_none(), "{:?}", g.error);
        assert_eq!(g.world.len(), 2);
        let s = g.world[0];
        assert_eq!(
            (s.center, s.size, s.color),
            ([10.0, 20.0], [6.0, 6.0], [255, 0, 0, 128])
        );
        assert!((s.rotation - 0.5).abs() < 1e-6);
        assert_eq!(g.world[1].color, [1, 2, 3, 4]);
        assert_eq!(g.ui.len(), 1, "only the anchored sprite is a UI sprite now");
        assert_eq!(g.text.len(), 2, "two letters, drawn as text quads");
        let anchored = g.ui.last().unwrap();
        assert_eq!(
            anchored.center,
            [1.0 + 1.0, 2.0 + 1.0],
            "topleft anchor shifts by half the size"
        );
    }

    #[test]
    fn unknown_assets_report_what_exists() {
        let mut g = game(vec![
            ("nova.json", manifest()),
            ("a.png", png_1x1()),
            (
                "main.lua",
                b"function update(dt) nova.sprite('nope.png', 0, 0) end".to_vec(),
            ),
        ]);
        run(&mut g);
        let e = g.error.clone().expect("error");
        assert!(
            e.contains("unknown image 'nope.png'") && e.contains("a.png"),
            "{e}"
        );
        assert!(g.ui.len() > 10, "the error overlay is drawn");
    }

    #[test]
    fn require_loads_project_modules_only_and_detects_cycles() {
        let mut g = game(vec![
            ("nova.json", manifest()),
            ("lib/util.lua", b"return { n = 7 }".to_vec()),
            ("a.lua", b"local b = require('b') return {b = b}".to_vec()),
            ("b.lua", b"local a = require('a') return {a = a}".to_vec()),
            (
                "main.lua",
                b"local u = require('lib.util')\nassert(u.n == 7 and require('lib.util') == u)\nfunction update(dt) nova.rect(u.n, 0, 1, 1) end"
                    .to_vec(),
            ),
        ]);
        run(&mut g);
        assert!(g.error.is_none(), "{:?}", g.error);
        assert_eq!(g.world.len(), 1);

        let mut cyc = game(vec![
            ("nova.json", manifest()),
            ("a.lua", b"return require('b')".to_vec()),
            ("b.lua", b"return require('a')".to_vec()),
            ("main.lua", b"require('a')".to_vec()),
        ]);
        run(&mut cyc);
        assert!(
            cyc.error.clone().unwrap().contains("circular require"),
            "{:?}",
            cyc.error
        );

        let mut missing = game(vec![
            ("nova.json", manifest()),
            ("main.lua", b"require('../etc/passwd')".to_vec()),
        ]);
        run(&mut missing);
        let e = missing.error.clone().unwrap();
        assert!(
            e.contains("not found") || e.contains("leaves the project"),
            "{e}"
        );
    }

    #[test]
    fn lua_errors_in_the_entry_script_do_not_fail_the_load() {
        let g = game(vec![
            ("nova.json", manifest()),
            ("main.lua", b"this is not lua".to_vec()),
        ]);
        assert!(g.error.is_some());
    }

    #[test]
    fn a_bad_image_is_a_load_error_naming_the_file() {
        let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
            ("nova.json", manifest()),
            ("main.lua", b"".to_vec()),
            ("art/broken.png", b"not a png".to_vec()),
        ]));
        let e = Game::load(vfs).err().expect("must fail");
        assert!(e.starts_with("art/broken.png:"), "{e}");
    }

    #[test]
    fn view_time_and_input_reach_scripts() {
        let mut g = game(vec![
            ("nova.json", manifest()),
            (
                "main.lua",
                b"function update(dt)\n local w, h = nova.view()\n nova.rect(w, h, nova.time(), nova.input.axis('steer'))\nend".to_vec(),
            ),
        ]);
        g.update(
            0.016,
            2.5,
            [1000.0, 540.0],
            Actions {
                steer: 0.5,
                ..Default::default()
            },
            false,
        );
        let r = g.world[0];
        // rect(x=w, y=h, w=time, h=steer): center = (x + w/2, y + h/2)
        assert_eq!(r.size, [2.5, 0.5]);
        assert_eq!(r.center, [1000.0 + 1.25, 540.0 + 0.25]);
    }
}
