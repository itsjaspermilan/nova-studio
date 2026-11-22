//! "What was drawn this frame", for tests and the `play` tool: a short list of the draw calls of the frame (models, world sprites
//! and rectangles, UI sprites, rectangles, lines and texts) with their names or words and where they were put, so a test can
//! say "the map is not drawn" or "the lap counter reads 2/3" without the game keeping flags of its own for it.
//!
//! It is kept only when asked for (a `play` run, or a test that calls [`Game::record_drawn`]): an ordinary game pays one
//! `Option` check per draw call. Lua reads it as `nova.testing.drawn(kind, match)`.

use mlua::{Lua, Table};
use serde_json::{Value, json};

use super::{Game, Shared};

/// One draw call of the frame.
#[derive(Clone, Debug)]
pub(crate) struct Drawn {
    /// `model`, `sprite`, `rect`, `text` (the world layer) or `ui_sprite`, `ui_rect`, `ui_line`, `ui_text`, `ui_poly` (the UI)
    pub kind: &'static str,
    /// the model's or picture's name, or the words of a text ("" for a plain rectangle)
    pub name: String,
    /// where: x, y (and z for a model), in the units of its layer
    pub at: [f64; 3],
    /// width and height for a rectangle, a sprite (its frame's size before scaling) and a text (as laid out); 0 for a model
    pub size: [f64; 2],
}

/// The kinds a summary can be asked for.
pub const KINDS: [&str; 10] = [
    "model",
    "sprite",
    "rect",
    "text",
    "ui_sprite",
    "ui_rect",
    "ui_line",
    "ui_text",
    "ui_poly",
    "ui_model",
];

/// Notes one draw call when the frame's list is being kept.
pub(crate) fn note(sh: &mut Shared, kind: &'static str, name: &str, at: [f64; 3], size: [f64; 2]) {
    if let Some(list) = sh.drawn.as_mut() {
        list.push(Drawn {
            kind,
            name: name.to_string(),
            at,
            size,
        });
    }
}

fn r(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn matches(d: &Drawn, kind: Option<&str>, pattern: Option<&str>) -> bool {
    kind.is_none_or(|k| d.kind == k || (k == "ui" && d.kind.starts_with("ui_")))
        && pattern.is_none_or(|p| d.name.contains(p))
}

/// Counts per kind, and the items: `{ counts = {...}, items = { { kind, name, x, y, z, w, h }, ... } }` as JSON.
pub(crate) fn summary(list: &[Drawn], kind: Option<&str>, pattern: Option<&str>) -> Value {
    let mut counts = serde_json::Map::new();
    let mut items = Vec::new();
    for d in list.iter().filter(|d| matches(d, kind, pattern)) {
        let n = counts.entry(d.kind).or_insert(json!(0));
        *n = json!(n.as_u64().unwrap_or(0) + 1);
        let mut item = json!({ "kind": d.kind, "name": d.name, "x": r(d.at[0]), "y": r(d.at[1]) });
        if d.kind == "model" || d.kind == "ui_model" {
            item["z"] = json!(r(d.at[2]));
        } else {
            item["w"] = json!(r(d.size[0]));
            item["h"] = json!(r(d.size[1]));
        }
        items.push(item);
    }
    json!({ "counts": counts, "items": items })
}

impl Game {
    /// Keeps a list of each frame's draw calls from the next frame on (see [`Game::drawn`]); `play` runs do this.
    pub fn record_drawn(&self) {
        let mut sh = self.shared.borrow_mut();
        if sh.drawn.is_none() {
            sh.drawn = Some(Vec::new());
        }
    }

    /// What the last frame drew (call it between frames): `{ "counts": { "ui_text": 4, ... }, "items": [ { "kind", "name",
    /// "x", "y", ("z" | "w", "h") }, ... ] }`, only of `kind` (or `"ui"` for every UI kind) and only those whose name or
    /// words contain `pattern`, when given. Empty until [`Game::record_drawn`] was called and a frame was drawn.
    pub fn drawn(&self, kind: Option<&str>, pattern: Option<&str>) -> Value {
        let sh = self.shared.borrow();
        summary(sh.drawn.as_deref().unwrap_or(&[]), kind, pattern)
    }
}

/// Clears the list at the start of a frame (when it is kept).
pub(crate) fn begin_frame(sh: &mut Shared) {
    if let Some(list) = sh.drawn.as_mut() {
        list.clear();
    }
}

/// `nova.testing.drawn(kind, match)`: the draw calls of the frame so far (after a frame, in a `play` run's `print`, the whole
/// frame), as `{ { kind = "ui_text", name = "LAP 2/3", x = .., y = .., w = .., h = .. }, ... }`; `kind` is one of [`KINDS`]
/// or "ui" (every UI kind) or nil (all), `match` a piece of the name or words. `nova.testing.drawn_count(kind, match)` is how
/// many. Kept only in a `play` run or a test that called `Game::record_drawn`; elsewhere it says so (and keeps them from the
/// next frame on).
pub(crate) fn register(
    lua: &Lua,
    nova: &Table,
    shared: &std::rc::Rc<std::cell::RefCell<Shared>>,
) -> mlua::Result<()> {
    let testing: Table = match nova.get::<Option<Table>>("testing")? {
        Some(t) => t,
        None => {
            let t = lua.create_table()?;
            nova.set("testing", t.clone())?;
            t
        }
    };
    let check = |kind: &Option<String>| -> mlua::Result<()> {
        if let Some(k) = kind
            && k != "ui"
            && !KINDS.contains(&k.as_str())
        {
            return Err(mlua::Error::runtime(format!(
                "nova.testing.drawn: no kind '{k}'; the kinds are {}, \"ui\" (all of the UI's) or nil (everything)",
                KINDS.join(", ")
            )));
        }
        Ok(())
    };
    let s = shared.clone();
    testing.set(
        "drawn",
        lua.create_function(move |lua, (kind, pattern): (Option<String>, Option<String>)| {
            check(&kind)?;
            let mut sh = s.borrow_mut();
            let Some(list) = sh.drawn.as_ref() else {
                sh.drawn = Some(Vec::new());
                return Err(mlua::Error::runtime(
                    "nova.testing.drawn keeps the draw calls only in a play run or a test that called game.record_drawn(); it keeps them from the next frame on",
                ));
            };
            let v = summary(list, kind.as_deref(), pattern.as_deref());
            lua.to_value(&v["items"])
        })?,
    )?;
    let s = shared.clone();
    testing.set(
        "drawn_count",
        lua.create_function(move |_, (kind, pattern): (Option<String>, Option<String>)| {
            check(&kind)?;
            let mut sh = s.borrow_mut();
            let Some(list) = sh.drawn.as_deref() else {
                // (a count of 0 would pass "the map is not drawn" for the wrong reason)
                sh.drawn = Some(Vec::new());
                return Err(mlua::Error::runtime(
                    "nova.testing.drawn_count keeps the draw calls only in a play run or a test that called game.record_drawn(); it keeps them from the next frame on",
                ));
            };
            Ok(list
                .iter()
                .filter(|d| matches(d, kind.as_deref(), pattern.as_deref()))
                .count())
        })?,
    )?;
    Ok(())
}

use mlua::LuaSerdeExt;
