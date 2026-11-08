//! Custom shaders from scripts (`docs/shaders.md`): `shader = "water"` (with `params` and `textures`) in the options of
//! `nova.model`, `nova.sprite` and `nova.ui.sprite`, and `nova.post(name, opts)` for a full-screen effect over the world.
//! The shader files are checked when the project loads ([`crate::shader::validate`]); a broken one is a problem in
//! `nova check`, and a draw that names it is drawn plainly (logged once) so the game keeps running.

use super::*;
use crate::gfx::{ShadedModel, ShadedSprite, Shading};

/// The project's shaders and this frame's custom-shaded draws.
#[derive(Default)]
pub(super) struct ShaderState {
    /// Shader name (`water` for `shaders/water.wgsl`) to its id on the GPU (set by `Game::upload`).
    pub ids: HashMap<String, usize>,
    /// Shaders that did not compile: name to the message.
    pub broken: HashMap<String, String>,
    /// The checked shaders' sources, to put on the GPU (name, text), in file order.
    pub sources: Vec<(String, String)>,
    /// Pictures used by shaders: path to the id the renderer knows it by.
    textures: HashMap<String, usize>,
    /// Pictures decoded but not yet on the GPU.
    pub pending_textures: Vec<(usize, Image)>,
    pub models: Vec<ShadedModel>,
    pub sprites: Vec<ShadedSprite>,
    /// The post effect, kept until changed (like `nova.look`).
    pub post: Option<Shading>,
    /// Broken shaders already reported in the log.
    warned: std::collections::HashSet<String>,
}

/// What the frame hands the renderer.
#[derive(Default)]
pub(super) struct FrameShading {
    pub models: Vec<ShadedModel>,
    pub sprites: Vec<ShadedSprite>,
    pub post: Option<Shading>,
    pub texture_ops: Vec<(usize, Image)>,
    pub time: f32,
}

/// Reads every `shaders/*.wgsl` file of the project and checks it. Returns the problems (`path:line:column: message`).
pub(super) fn load_shaders(
    project: &Project,
    vfs: &dyn Vfs,
    state: &mut ShaderState,
) -> Vec<String> {
    let mut problems = Vec::new();
    let mut paths: Vec<&str> = project
        .assets
        .iter()
        .map(|a| a.id.as_str())
        .filter(|p| crate::shader::name_of(p).is_some())
        .collect();
    paths.sort();
    for path in paths {
        let name = crate::shader::name_of(path).expect("filtered");
        let text = match vfs.read(path).map(String::from_utf8) {
            Ok(Ok(t)) => t,
            Ok(Err(_)) => {
                problems.push(format!("{path}: not valid UTF-8"));
                state.broken.insert(name, "not valid UTF-8".into());
                continue;
            }
            Err(e) => {
                problems.push(format!("{path}: {e}"));
                state.broken.insert(name, e);
                continue;
            }
        };
        match crate::shader::validate(&text) {
            Ok(()) => state.sources.push((name, text)),
            Err(e) => {
                problems.push(e.describe(path));
                state.broken.insert(name, e.describe(path));
            }
        }
    }
    problems
}

/// The `shader`, `params`, `textures` (and, for models, `blend`) options of a draw: None when it names no shader, or names one
/// that did not compile (then it is drawn plainly and the log says why, once).
pub(super) fn shading_option(
    sh: &mut Shared,
    vfs: &dyn Vfs,
    opts: &Option<Table>,
) -> mlua::Result<Option<(Shading, bool)>> {
    let Some(o) = opts else { return Ok(None) };
    let Some(name) = o.get::<Option<String>>("shader")? else {
        return Ok(None);
    };
    shading_named(sh, vfs, &name, o).map(|s| {
        s.map(|s| {
            (
                s,
                o.get::<Option<bool>>("blend")
                    .ok()
                    .flatten()
                    .unwrap_or(false),
            )
        })
    })
}

fn shading_named(
    sh: &mut Shared,
    vfs: &dyn Vfs,
    name: &str,
    o: &Table,
) -> mlua::Result<Option<Shading>> {
    let state = &mut sh.shading;
    let Some(&shader) = state.ids.get(name) else {
        if let Some(why) = state.broken.get(name) {
            if state.warned.insert(name.to_string()) {
                let line =
                    format!("shader '{name}' did not compile, so it is drawn without it: {why}");
                log::warn!("{line}");
                sh.log.push(line);
            }
            return Ok(None);
        }
        let mut known: Vec<&str> = state.ids.keys().map(String::as_str).collect();
        known.sort();
        return Err(lua_err(format!(
            "unknown shader '{name}' (a shader is a file shaders/{name}.wgsl; shaders in this project: {})",
            if known.is_empty() {
                "none".into()
            } else {
                known.join(", ")
            }
        )));
    };
    let mut params = [0.0f32; 8];
    if let Some(t) = o.get::<Option<Table>>("params")? {
        let len = t.raw_len();
        if len > 8 {
            return Err(lua_err(
                "a shader takes at most 8 params (s.param.xyzw, s.param2.xyzw)",
            ));
        }
        for (i, slot) in params.iter_mut().enumerate().take(len) {
            *slot = t
                .get::<Option<f64>>(i + 1)?
                .ok_or_else(|| lua_err("params must be a list of numbers, such as { 0.5, 2 }"))?
                as f32;
        }
    }
    let mut textures = [None, None];
    if let Some(t) = o.get::<Option<Table>>("textures")? {
        if t.raw_len() > 2 {
            return Err(lua_err(
                "a shader takes at most 2 textures (nova_texture_a, nova_texture_b)",
            ));
        }
        for (i, slot) in textures.iter_mut().enumerate() {
            if let Some(image) = t.get::<Option<String>>(i + 1)? {
                *slot = Some(texture_id(state, vfs, &image)?);
            }
        }
    }
    Ok(Some(Shading {
        shader,
        params,
        textures,
    }))
}

/// The id of a picture for shaders, decoding it the first time it is named: a project path, or a short name for
/// `sprites/<name>.png` or `textures/<name>.png`.
fn texture_id(state: &mut ShaderState, vfs: &dyn Vfs, name: &str) -> mlua::Result<usize> {
    let candidates = [
        name.to_string(),
        format!("sprites/{name}.png"),
        format!("textures/{name}.png"),
    ];
    for path in &candidates {
        if let Some(&id) = state.textures.get(path) {
            return Ok(id);
        }
    }
    for path in &candidates {
        if let Ok(bytes) = vfs.read(path) {
            let image =
                crate::assets::decode_png(&bytes).map_err(|e| lua_err(format!("{path}: {e}")))?;
            let id = state.textures.len();
            state.textures.insert(path.clone(), id);
            state.pending_textures.push((id, image));
            return Ok(id);
        }
    }
    Err(lua_err(format!(
        "no picture '{name}' for a shader (looked for '{name}', 'sprites/{name}.png' and 'textures/{name}.png')"
    )))
}

/// A model draw, plain or with its shading.
pub(super) fn push_model(sh: &mut Shared, draw: ModelDraw, shading: Option<(Shading, bool)>) {
    match shading {
        Some((shading, blend)) => sh.shading.models.push(ShadedModel {
            // (a blended model never casts a shadow, like a see-through one)
            draw: ModelDraw {
                casts: draw.casts && !blend,
                ..draw
            },
            shading,
            blend,
        }),
        None => sh.models.push(draw),
    }
}

/// Marks the sprite just pushed to the world (or UI) list as drawn with `shading`.
pub(super) fn mark_sprite(sh: &mut Shared, ui: bool, shading: Option<(Shading, bool)>) {
    let Some((shading, _)) = shading else { return };
    let len = if ui { sh.ui.len() } else { sh.world.len() };
    if len > 0 {
        sh.shading.sprites.push(ShadedSprite {
            index: len - 1,
            ui,
            shading,
        });
    }
}

pub(super) fn install(
    lua: &Lua,
    shared: &Rc<RefCell<Shared>>,
    vfs: &Rc<dyn Vfs>,
    nova: &Table,
) -> mlua::Result<()> {
    // nova.post("name", { params, textures }) sets the full-screen effect over the world; nova.post() or nova.post(nil) clears it
    let (s, v) = (shared.clone(), vfs.clone());
    nova.set(
        "post",
        lua.create_function(move |lua, (name, opts): (Option<String>, Option<Table>)| {
            let mut sh = s.borrow_mut();
            let shading = match name {
                None => None,
                Some(name) => {
                    let o = match opts {
                        Some(o) => o,
                        None => lua.create_table()?,
                    };
                    shading_named(&mut sh, v.as_ref(), &name, &o)?
                }
            };
            sh.shading.post = shading;
            Ok(())
        })?,
    )?;
    // nova.shaders() -> { "water", "dissolve" }: the shaders that compiled
    let s = shared.clone();
    nova.set(
        "shaders",
        lua.create_function(move |lua, ()| {
            let sh = s.borrow();
            let mut names: Vec<&String> = sh.shading.ids.keys().collect();
            names.sort();
            lua.create_sequence_from(names.into_iter().cloned())
        })?,
    )?;
    Ok(())
}
