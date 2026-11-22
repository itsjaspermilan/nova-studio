//! A small harness for a game's own Rust tests (`crates/nova-runtime/tests/<game>.rs`): load the game without a GPU, play a
//! route exactly as `nova run --headless --play` and the `play` tool do (every key of the plan: `always`, `record`, `print`,
//! `invincible`, `each_frame`, ...), and read the report. So a test file needs no copy of the frame loop of its own.
//!
//! ```no_run
//! use nova_runtime::testing;
//! let mut game = testing::load_dir("examples/starter-topdown").unwrap();
//! let report = testing::play(&mut game, r#"{ "route": [ { "hold": ["right"], "frames": 30 } ],
//!     "record": "nova.named('hero').x", "always": "nova.named('hero').hp > 0" }"#).unwrap();
//! assert!(report.warnings().is_empty(), "{:?}", report.warnings());
//! assert_eq!(report.drawn_count("ui_text", Some("MAP")), 0, "the map is not drawn");
//! ```
//!
//! What was drawn: `play` keeps each frame's draw calls ([`Game::drawn`]), and a route's `print` can say
//! `nova.testing.drawn('ui_text')`; [`Report::drawn`] is the last frame's, and a test that drives frames by hand calls
//! [`Game::record_drawn`] once and [`Game::drawn`] after a frame.

use std::path::{Path, PathBuf};
use std::rc::Rc;

use serde_json::Value;

use crate::actions::InputFrame;
use crate::game::{Game, NullUploader};
use crate::playtest::{Plan, Playtest};
use crate::vfs::{DirVfs, MemVfs, Vfs};

/// The game in a folder (relative paths are from the repository root, where `examples/` is), loaded and given to a [`NullUploader`] (no GPU).
pub fn load_dir(folder: impl AsRef<Path>) -> Result<Game, String> {
    let folder = folder.as_ref();
    let folder = if folder.is_absolute() {
        folder.to_path_buf()
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(folder)
    };
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder)?);
    let mut game = Game::load(vfs)?;
    game.upload(&mut NullUploader::default());
    Ok(game)
}

/// A game made of these files (path, contents), loaded and given to a [`NullUploader`] (no GPU).
pub fn load_files(files: Vec<(&'static str, Vec<u8>)>) -> Result<Game, String> {
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(files));
    let mut game = Game::load(vfs)?;
    game.upload(&mut NullUploader::default());
    Ok(game)
}

/// Keys of a `play` tool call that are about its pictures or its answer, not the run: a route file written for the tool
/// may carry them, and the harness leaves them out (and says so in the report's notes).
const TOOL_ONLY: [&str; 10] = [
    "project",
    "size",
    "crop",
    "crop_margin",
    "zoom",
    "compare",
    "audio",
    "image_out",
    "press",
    "hold",
];

/// Plays a plan (its JSON text, or a `play` tool route file's: `route` is its `steps`) on the game, as the headless runner
/// does: 960x540, 60 frames a second, the plan's seed. Pictures are not drawn (there is no GPU); their captions are in
/// [`Report::pictures`].
pub fn play(game: &mut Game, plan: &str) -> Result<Report, String> {
    play_sized(game, plan, [960.0, 540.0])
}

/// [`play`] of a route file.
pub fn play_file(game: &mut Game, path: impl AsRef<Path>) -> Result<Report, String> {
    let path = path.as_ref();
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    play(game, &text)
}

/// [`play`] with a screen of another size in units (the view `nova.view()` gives).
pub fn play_sized(game: &mut Game, plan: &str, view: [f32; 2]) -> Result<Report, String> {
    let mut value: Value =
        serde_json::from_str(plan).map_err(|e| format!("not a play plan: {e}"))?;
    let mut left_out = Vec::new();
    if let Some(map) = value.as_object_mut() {
        for key in TOOL_ONLY {
            if map.remove(key).is_some() {
                left_out.push(key);
            }
        }
        map.remove("out");
        if let Some(route) = map.remove("route") {
            map.entry("steps").or_insert(route);
        }
        if let Some(each) = map.remove("each_frame") {
            map.entry("lua_each_frame").or_insert(each);
        }
    }
    let plan = Plan::from_json(&value.to_string(), "the plan")?;
    let dir = scratch();
    let mut run = Playtest::new(plan, &dir)?;
    run.set_size(view[0] as u32, view[1] as u32);
    game.reseed(run.seed().unwrap_or(1));
    if let Some(scene) = run.start_scene() {
        game.start_in_scene(scene)?;
    }
    let mut pictures = Vec::new();
    let mut frame = 0;
    while !run.finished(frame) {
        let mut input = InputFrame::default();
        run.before_frame(frame, game, &mut input);
        game.update_input(1.0 / 60.0, frame as f64 / 60.0, view, &input);
        for caption in run.after_frame(frame, game) {
            let _ = run.picture(frame, &caption, game);
            pictures.push((frame + 1, caption));
        }
        frame += 1;
    }
    let drawn = game.drawn(None, None);
    let file = run.finish(frame, game)?;
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&dir);
    let mut report: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if !left_out.is_empty()
        && let Some(notes) = report["notes"].as_array_mut()
    {
        notes.push(Value::from(format!(
            "the test harness left out {} (they are about the play tool's pictures and answer)",
            left_out.join(", ")
        )));
    }
    Ok(Report {
        json: report,
        pictures,
        drawn,
    })
}

/// A scratch folder of its own for each run (two tests running at once never share one).
fn scratch() -> PathBuf {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static N: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "nova-testing-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

/// What a played plan said: `report.json`, with readers for what tests ask most.
pub struct Report {
    /// The whole report (docs/project-format.md, "Testing helpers").
    pub json: Value,
    /// The pictures the plan asked for: (frame, caption). Not drawn: there is no GPU.
    pub pictures: Vec<(u32, String)>,
    /// What the last frame drew: `{ "counts": {...}, "items": [ { "kind", "name", "x", "y", ... } ] }` ([`Game::drawn`]).
    pub drawn: Value,
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

impl Report {
    /// The warnings: a step that never got where it went, an `always` that was false, a hold nothing read or that was blocked.
    pub fn warnings(&self) -> Vec<String> {
        strings(&self.json["warnings"])
    }

    /// The Lua errors: the game's (`error`) and the steps' (`step_errors`).
    pub fn errors(&self) -> Vec<String> {
        let mut e: Vec<String> = self.json["error"]
            .as_str()
            .map(str::to_string)
            .into_iter()
            .collect();
        e.extend(strings(&self.json["step_errors"]));
        e
    }

    /// The notes (an `always` that held, what `invincible` did).
    pub fn notes(&self) -> Vec<String> {
        strings(&self.json["notes"])
    }

    /// The game's `nova.log` lines, each with its frame.
    pub fn log(&self) -> Vec<(u64, String)> {
        self.json["log"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|l| {
                        (
                            l["frame"].as_u64().unwrap_or(0),
                            l["text"].as_str().unwrap_or("").to_string(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// A `print` expression's value at the end of the run, as the report has it (strings keep their quotes).
    pub fn printed(&self, expr: &str) -> Option<String> {
        self.json["end"]["prints"]
            .as_array()?
            .iter()
            .find(|p| p["expr"] == expr)
            .and_then(|p| p["value"].as_str().map(str::to_string))
    }

    /// A `record` expression's values over the run, as runs of one value: (first frame, last frame, value).
    pub fn record(&self, expr: &str) -> Vec<(u32, u32, String)> {
        self.json["records"]
            .as_array()
            .and_then(|a| a.iter().find(|r| r["expr"] == expr))
            .and_then(|r| r["runs"].as_array())
            .map(|runs| {
                runs.iter()
                    .map(|r| {
                        (
                            r[0].as_u64().unwrap_or(0) as u32,
                            r[1].as_u64().unwrap_or(0) as u32,
                            r[2].as_str().unwrap_or("").to_string(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The last frame's draw calls of `kind` (`"ui"` for every UI kind) whose name or words contain `pattern`.
    pub fn drawn(&self, kind: &str, pattern: Option<&str>) -> Vec<Value> {
        self.drawn["items"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter(|i| {
                        let k = i["kind"].as_str().unwrap_or("");
                        (k == kind || (kind == "ui" && k.starts_with("ui_")))
                            && pattern
                                .is_none_or(|p| i["name"].as_str().is_some_and(|n| n.contains(p)))
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// How many of those there were.
    pub fn drawn_count(&self, kind: &str, pattern: Option<&str>) -> usize {
        self.drawn(kind, pattern).len()
    }
}
