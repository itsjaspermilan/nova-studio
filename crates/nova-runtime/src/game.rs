//! A running Nova project: its Lua scripts, decoded assets and the per-frame draw lists
//! that scripts fill through the `nova` API.
//!
//! API v1 is immediate mode: scripts call `nova.sprite`, `nova.model`, `nova.ui.text` and
//! friends from `update(dt)` / `draw()`, and the engine renders what was asked that frame.
//! Scenes, entities, tilemaps and animation arrive on top of this in later M2 slices.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;
use std::time::{Duration, Instant, SystemTime};

use glam::{Mat4, Vec3};
use mlua::{Function, HookTriggers, Lua, LuaSerdeExt, Table, Value, VmState};

use crate::assets::{self, AtlasLayout};
use crate::font;
use crate::gfx::{Camera, FrameInput, Gfx, ModelDraw, ModelInstance, SpriteInstance};
use crate::input::Actions;
use crate::model::{self, Image, MeshData};
use crate::project::{AssetKind, Project};
use crate::save::SaveStore;
use crate::scene;
use crate::script::new_lua;
use crate::sprite::{self, SpriteDef};
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

const DEFAULT_CAMERA: Camera = Camera {
    eye: Vec3::new(0.0, 6.0, -10.0),
    target: Vec3::new(0.0, 1.0, 0.0),
    fov_y_degrees: 60.0,
};

struct Shared {
    actions: Actions,
    action_pressed: bool,
    view: [f32; 2],
    time: f64,
    layout: AtlasLayout,
    sheets: HashMap<String, SpriteDef>,
    tilemaps: Vec<TileMap>,
    save: SaveStore,
    mesh_ids: HashMap<String, usize>,
    known_models: Vec<String>,
    world: Vec<SpriteInstance>,
    ui: Vec<SpriteInstance>,
    models: Vec<ModelDraw>,
    camera: Camera,
    clear: [f64; 4],
    log: Vec<String>,
}

/// Where decoded assets go. `Gfx` is the real target; tests use a fake so project
/// logic can be exercised without a GPU.
pub trait Uploader {
    fn set_atlas(&mut self, atlas: &Image);
    fn add_mesh(&mut self, mesh: &MeshData) -> usize;
}

impl Uploader for Gfx {
    fn set_atlas(&mut self, atlas: &Image) {
        self.set_sprite_atlas(atlas);
    }
    fn add_mesh(&mut self, mesh: &MeshData) -> usize {
        self.upload_mesh(mesh)
    }
}

pub struct Game {
    pub project: Project,
    deadline: Rc<Cell<Option<Instant>>>,
    vfs: Rc<dyn Vfs>,
    lua: Lua,
    shared: Rc<RefCell<Shared>>,
    atlas: Option<Image>,
    meshes: Vec<(String, MeshData)>,
    world: Vec<SpriteInstance>,
    ui: Vec<SpriteInstance>,
    models: Vec<ModelDraw>,
    camera: Camera,
    clear: [f64; 4],
    pub error: Option<String>,
    pub warnings: Vec<String>,
    pub last_update: Duration,
    stamp: Option<SystemTime>,
    checked: Instant,
    last_flush: Instant,
    save_dir: Option<std::path::PathBuf>,
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
            let scale = number_option(&opts, "scale")?.unwrap_or(1.0) as f32;
                let rotation =
                    Mat4::from_rotation_y(number_option(&opts, "ry")?.unwrap_or(0.0) as f32)
                        * Mat4::from_rotation_x(number_option(&opts, "rx")?.unwrap_or(0.0) as f32)
                        * Mat4::from_rotation_z(number_option(&opts, "rz")?.unwrap_or(0.0) as f32);
                let matrix = Mat4::from_translation(Vec3::new(x as f32, y as f32, z as f32))
                    * rotation
                    * Mat4::from_scale(Vec3::splat(scale));
                let tint = color_option(&opts, "tint", [255; 4])?.map(|c| c as f32 / 255.0);
                sh.models.push(ModelDraw {
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
                let scale = number_option(&opts, "scale")?
                    .unwrap_or(2.0)
                    .clamp(0.5, 32.0) as f32;
                let color = color_option(&opts, "color", [255; 4])?;
                let uv = sh.layout.white_uv();
                font::draw_text(&mut sh.ui, uv, x as f32, y as f32, scale, color, &text);
                Ok(())
            },
        )?,
    )?;
    ui.set(
        "text_width",
        lua.create_function(|_, (text, scale): (String, Option<f64>)| {
            Ok(font::text_width(scale.unwrap_or(2.0) as f32, &text) as f64)
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
    let s = shared.clone();
    nova.set(
        "log",
        lua.create_function(move |_, message: String| {
            log::info!("lua: {message}");
            s.borrow_mut().log.push(message);
            Ok(())
        })?,
    )?;

    // --- input ---
    let input = lua.create_table()?;
    let s = shared.clone();
    input.set(
        "axis",
        lua.create_function(move |_, name: String| {
            let a = s.borrow().actions;
            match name.as_str() {
                "steer" => Ok(a.steer as f64),
                "throttle" => Ok(a.throttle as f64),
                "brake" => Ok(a.brake as f64),
                "action" => Ok(if a.action { 1.0 } else { 0.0 }),
                other => Err(lua_err(format!(
                    "unknown input action '{other}' (steer, throttle, brake, action)"
                ))),
            }
        })?,
    )?;
    let s = shared.clone();
    input.set(
        "down",
        lua.create_function(move |_, name: String| {
            let a = s.borrow().actions;
            match name.as_str() {
                "steer" => Ok(a.steer != 0.0),
                "throttle" => Ok(a.throttle > 0.0),
                "brake" => Ok(a.brake > 0.0),
                "action" => Ok(a.action),
                other => Err(lua_err(format!("unknown input action '{other}'"))),
            }
        })?,
    )?;
    let s = shared.clone();
    input.set(
        "pressed",
        lua.create_function(move |_, name: String| match name.as_str() {
            "action" => Ok(s.borrow().action_pressed),
            other => Err(lua_err(format!(
                "'{other}' has no pressed edge yet (only 'action')"
            ))),
        })?,
    )?;
    nova.set("input", input)?;
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
        for asset in project.assets_of(AssetKind::Image) {
            let bytes = vfs.read(&asset.id)?;
            let image = assets::decode_png(&bytes).map_err(|e| format!("{}: {e}", asset.id))?;
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
        for asset in project.assets_of(AssetKind::Model) {
            let bytes = vfs.read(&asset.id)?;
            let mesh = model::import_glb(&bytes).map_err(|e| format!("{}: {e}", asset.id))?;
            for note in &mesh.notes {
                warnings.push(format!("{}: {note}", asset.id));
            }
            meshes.push((asset.id.clone(), mesh));
        }

        let shared = Rc::new(RefCell::new(Shared {
            actions: Actions::default(),
            action_pressed: false,
            view: [960.0, 540.0],
            time: 0.0,
            layout: layout.clone(),
            sheets,
            tilemaps: Vec::new(),
            save: store,
            mesh_ids: HashMap::new(),
            known_models: meshes.iter().map(|(id, _)| id.clone()).collect(),
            world: Vec::new(),
            ui: Vec::new(),
            models: Vec::new(),
            camera: DEFAULT_CAMERA,
            clear: srgb_to_linear([0.36, 0.55, 0.78, 1.0]),
            log: Vec::new(),
        }));
        let lua = new_lua();
        lua.set_memory_limit(LUA_MEMORY_LIMIT)
            .map_err(|e| format!("cannot limit Lua memory: {e}"))?;
        // A hook every 20,000 VM instructions checks the clock. It is global, so scripts
        // started with go() (coroutines) are covered as well.
        let deadline: Rc<Cell<Option<Instant>>> = Rc::new(Cell::new(None));
        let hook_deadline = deadline.clone();
        lua.set_global_hook(
            HookTriggers::new().every_nth_instruction(20_000),
            move |_, _| match hook_deadline.get() {
                Some(limit) if Instant::now() > limit => Err(lua_err(
                    "the script ran for too long in one frame; is there an endless loop?",
                )),
                _ => Ok(VmState::Continue),
            },
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
            models: Vec::new(),
            camera: DEFAULT_CAMERA,
            clear: srgb_to_linear([0.36, 0.55, 0.78, 1.0]),
            error: None,
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
        for (id, mesh) in std::mem::take(&mut self.meshes) {
            ids.insert(id, target.add_mesh(&mesh));
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

    pub fn world_height(&self) -> u32 {
        self.project.manifest.world_height
    }

    pub fn set_error(&mut self, message: String) {
        log::error!("{message}");
        self.error = Some(first_line(&message));
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

    /// Runs one frame of scripts and collects what they asked to draw.
    pub fn update(
        &mut self,
        dt: f32,
        time: f64,
        view: [f32; 2],
        actions: Actions,
        action_pressed: bool,
    ) {
        {
            let mut sh = self.shared.borrow_mut();
            std::mem::swap(&mut sh.world, &mut self.world);
            std::mem::swap(&mut sh.ui, &mut self.ui);
            std::mem::swap(&mut sh.models, &mut self.models);
            sh.world.clear();
            sh.ui.clear();
            sh.models.clear();
            sh.actions = actions;
            sh.action_pressed = action_pressed;
            sh.view = view;
            sh.time = time;
        }
        if self.error.is_none() {
            let started = Instant::now();
            self.deadline.set(Some(started + FRAME_BUDGET));
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
            self.last_update = started.elapsed();
            if let Err(e) = result {
                log::error!("script error: {e}");
                self.error = Some(first_line(&e.to_string()));
            }
        }
        if self.last_flush.elapsed() > Duration::from_secs(3) {
            self.last_flush = Instant::now();
            self.flush_save();
        }
        let mut sh = self.shared.borrow_mut();
        std::mem::swap(&mut sh.world, &mut self.world);
        std::mem::swap(&mut sh.ui, &mut self.ui);
        std::mem::swap(&mut sh.models, &mut self.models);
        self.models.sort_by_key(|m| m.mesh); // equal meshes become one instanced draw
        self.camera = sh.camera;
        self.clear = sh.clear;
        let white = sh.layout.white_uv();
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

    pub fn frame_input(&self, world_height: u32) -> FrameInput<'_> {
        FrameInput {
            clear: self.clear,
            camera: self.camera,
            sprites_back: &self.world,
            models: &self.models,
            sprites_front: &self.ui,
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
        assert!(g.ui.len() > 2, "text pixels plus an anchored sprite");
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
