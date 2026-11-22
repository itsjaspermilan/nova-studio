//! A scripted headless run: `nova run <project> --headless --play plan.json`. A plan is a route through the game
//! written as steps (hold these actions for so many frames, press that one, keep going until a Lua condition holds),
//! the moments to take pictures of, and Lua expressions to print at each of them. The run writes the pictures and a
//! `report.json` (what was on screen at each picture, the game's log lines and the sounds it started, each with its
//! frame) into the plan's `out` folder. It exists so that a person or an assistant can check a game without eyes on a
//! window: see `docs/agent-guide.md`, and the MCP tool `play` which writes these plans.
//!
//! ```json
//! {
//!   "out": "build/run1",
//!   "start_scene": "cave", "lua": "nova.named('hero').x = 200", "seed": 7,
//!   "steps": [
//!     { "hold": ["right"], "frames": 40 },
//!     { "press": "a" },
//!     { "wait": 20, "capture": "after the swing" },
//!     { "hold": ["move_x=-1"], "until": "nova.named('hero').x < 64", "max": 300 },
//!     { "lua": "nova.named('hero').hp = 1" }
//!   ],
//!   "capture_at": [1, 30], "every": 60, "print": ["nova.named('hero').hp"], "frames": 240
//! }
//! ```
//!
//! Frames are counted from 1: picture 30 is what the screen shows after thirty frames. Frame 1 is the scene coming up
//! (no input); `lua` runs right after it and the steps start at frame 2.
//!
//! More steps:
//! - `{ "hold": ["right"], "tap": "a", "tap_every": 30, "until": "..." }` walks and acts at once: `tap` (or `press`) is
//!   tapped again every `tap_every` frames for as long as the step lasts.
//! - `{ "repeat": 5, "steps": [ ... ] }` plays a group of steps several times; with `"until"` the group stops (in the
//!   middle of a step too) as soon as the condition holds. `repeat` on a plain step plays that step several times.
//! - `{ "walk_to": [x, y], "who": "hero", "radius": 12, "max": 600 }` steers an entity to a point (`[x, z]` on the ground
//!   of a 3D game) round what is solid: see `Walk`. `{ "walk_to": "chest" }` walks to an entity (by name or tag) until
//!   the two hitboxes touch (`reach` apart at most) or it stands against it.
//! - `{ "fight": "enemy", "attack": "a", "max": 600 }` goes to the nearest entity with that tag, taps `attack` when its
//!   hitbox is within `range`, and goes on to the next until none is left.
//! - `"may_time_out": true` on an `until` (or a `walk_to`, a `fight`, or a group) says that running out of time is
//!   expected: no warning.
//!
//! - `"always": "<lua>"` on a step (or a group) is a condition that must hold after every frame it plays, and
//!   `"record": "<lua>"` writes down a value after every frame of it (both also take lists).
//!
//! For the whole plan: `"invincible": true` keeps the hero's `hp` (or `health`, `hearts`, `lives`, `life`, `energy`) from
//! going down at all, refusing every blow as it is dealt, and sets `nova.testing.invincible`; `"stop_on_fail": true` ends
//! the route at the first step that fails; `"overlay": ["hitboxes", "solids", "names"]` draws those over the game;
//! `"lua_each_frame"` (or `"each_frame"`) runs Lua before every frame; `"always"` and `"record"` watch the whole run.
//!
//! A step whose Lua fails (`lua`, `until`) is written down with its step number in the report's `step_errors` and the run
//! goes on, so the pictures and values after it are still there. Only an error of the game itself stops a run. The
//! picture of a step that ends because something came true (`until`, `walk_to`, `fight`) is taken one frame later, when
//! the game has drawn what changed.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{Value, json};

use crate::actions::InputFrame;
use crate::game::Game;

/// A run never goes on longer than this (ten minutes of game time), whatever the plan says.
pub const MAX_FRAMES: u32 = 36_000;

#[derive(Deserialize, Clone, Debug)]
#[serde(untagged)]
pub enum OneOrMany {
    One(String),
    Many(Vec<String>),
}

impl OneOrMany {
    fn list(&self) -> Vec<String> {
        match self {
            OneOrMany::One(s) => vec![s.clone()],
            OneOrMany::Many(v) => v.clone(),
        }
    }
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct Step {
    /// Actions held for the whole step: `"right"`, `"move_x=-1"`, or a source such as `"key:Enter"`.
    pub hold: Option<OneOrMany>,
    /// Actions tapped: held for the step's first two frames. A step with only a press lasts three frames.
    pub press: Option<OneOrMany>,
    /// The same as `press`; with `tap_every` it reads better beside a `hold`.
    pub tap: Option<OneOrMany>,
    /// Tap `tap` and `press` again every so many frames while the step lasts (3 or more).
    pub tap_every: Option<u32>,
    /// How long the step lasts.
    pub frames: Option<u32>,
    /// The same as `frames`, for a step that holds nothing.
    pub wait: Option<u32>,
    /// A Lua expression: the step ends on the frame after which it holds. On a group (`steps`) it ends the group.
    pub until: Option<String>,
    /// The longest an `until` or `walk_to` step may last (600 frames when left out).
    pub max: Option<u32>,
    /// Running out of time (an `until` that never held, a `walk_to` that did not arrive) is expected: no warning.
    #[serde(default, alias = "quiet")]
    pub may_time_out: bool,
    /// Take a picture when the step ends, with this caption.
    pub capture: Option<String>,
    /// Lua run once when the step starts.
    pub lua: Option<String>,
    /// Play the step (or the group in `steps`) this many times.
    pub repeat: Option<u32>,
    /// A group of steps, played in order `repeat` times (once when left out; up to 100 times with an `until`).
    pub steps: Option<Vec<Step>>,
    /// Steer an entity to this point (`[x, y]` in a 2D game, `[x, z]` on the ground of a 3D one), or to an entity by
    /// its name or tag, until it touches it.
    pub walk_to: Option<Target>,
    /// For a `walk_to` an entity: how far apart the two hitboxes may be to count as there (left out: they must overlap
    /// in 2D, which is when `on_collide` runs; 0.3 in 3D). The step also ends when the walker stands against the thing.
    pub reach: Option<f64>,
    /// Walk straight at the place, without looking for a way round what is solid.
    #[serde(default)]
    pub straight: bool,
    /// The tags of the entities a 2D path goes round (`["solid"]` when left out).
    pub avoid: Option<Vec<String>>,
    /// Go to the nearest entity with this tag and attack it, then the next, until none is left.
    pub fight: Option<String>,
    /// The action a `fight` taps (`a` when left out).
    pub attack: Option<OneOrMany>,
    /// Frames from one attack to the next (20).
    pub attack_every: Option<u32>,
    /// How far apart the hitboxes may be for an attack (the walker's own size in 2D, at least 16; 1.5 in 3D).
    pub range: Option<f64>,
    /// Who walks: a scene object's name or a tag (left out: the one named or tagged `hero` or `player`, or what the 2D
    /// camera follows).
    pub who: Option<String>,
    /// How close counts as there (12 units in 2D, 0.5 in 3D).
    pub radius: Option<f64>,
    /// `"xy"` or `"xz"`: which two of the walker's fields the point is in (left out: xz when it has a model).
    pub plane: Option<String>,
    /// The two axis actions `walk_to` drives instead of `move_x`, `move_y`.
    pub axes: Option<[String; 2]>,
    /// The four button actions `walk_to` drives instead of `left`, `right`, `up`, `down`.
    pub dirs: Option<[String; 4]>,
    /// Lua conditions that must hold after every frame of this step (of every step of a group): a frame where one is
    /// false is a failure, said with its frame.
    pub always: Option<OneOrMany>,
    /// Lua expressions written down after every frame of this step (of a group's steps): a value per frame.
    pub record: Option<OneOrMany>,
}

impl Step {
    fn verb(&self) -> &'static str {
        if self.fight.is_some() {
            "fight"
        } else {
            "walk_to"
        }
    }
}

/// Where a `walk_to` goes: a point, or an entity by its name or tag.
#[derive(Deserialize, Clone, Debug)]
#[serde(untagged)]
pub enum Target {
    Point([f64; 2]),
    Entity(String),
}

/// What `overlay` can draw over the pictures.
pub const OVERLAYS: [&str; 4] = ["hitboxes", "solids", "names", "lights"];

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    #[serde(default, alias = "route")]
    pub steps: Vec<Step>,
    /// Frames to take pictures after (counted from 1).
    #[serde(default)]
    pub capture_at: Vec<u32>,
    /// Also take a picture every so many frames (0 for none).
    #[serde(default)]
    pub every: u32,
    /// Lua expressions whose values are written down at every picture and at the end.
    #[serde(default)]
    pub print: Vec<String>,
    /// Run at least this many frames (the steps may take longer).
    pub frames: Option<u32>,
    /// The folder for the pictures and `report.json` (made if missing). Relative to where `nova` is run.
    pub out: Option<PathBuf>,
    pub start_scene: Option<String>,
    /// Lua run once, after the first frame (the scene is up by then).
    pub lua: Option<String>,
    pub seed: Option<u64>,
    /// The hero cannot die: its `hp` (or `health`, `hearts`, `lives`, `life`, `energy`) never goes down (a write that
    /// lowers it is refused as it happens, so one blow bigger than what is left cannot kill), and
    /// `nova.testing.invincible` is true for the game to read.
    #[serde(default, alias = "god")]
    pub invincible: bool,
    /// Who `invincible` protects (left out: the one named or tagged `hero` or `player`).
    pub who: Option<String>,
    /// End the route at the first step that fails (an `until` or `walk_to` that ran out without `may_time_out`, Lua that
    /// failed), so later steps do not play from the wrong place. Everything gathered so far is kept.
    #[serde(default)]
    pub stop_on_fail: bool,
    /// Draw these over the game on every frame: `hitboxes`, `solids`, `names`.
    #[serde(default)]
    pub overlay: Vec<String>,
    /// Lua run before every frame after the first (a setting the scene's own code would otherwise set back).
    #[serde(alias = "each_frame")]
    pub lua_each_frame: Option<String>,
    /// Lua conditions that must hold after every frame of the run (from the first after the scene is up): "the hero
    /// never overlaps a wall", "hp never drops". A frame where one is false is a failure, said with its frame and step.
    pub always: Option<OneOrMany>,
    /// Lua expressions written down after every frame of the run: a value per frame, in the report's `records`.
    pub record: Option<OneOrMany>,
    /// The run's pictures of a 3D game from beside an entity instead of from the game's own camera (see [`View`]).
    pub view: Option<View>,
    /// Every picture's report carries the box of this entity (a name, a tag or a kind) on it, in pixels: what the tools
    /// crop the pictures to.
    pub crop_to: Option<String>,
}

/// A camera for the pictures only (the game plays on with its own): `{ "follow": "hero", "from": "side", "distance": 4 }`
/// looks at the middle of the entity from `distance` metres away, `height` above its middle. `from` is a side of the
/// world: "side" or "right" (from +x), "left" (from -x), "front" (from +z), "back" (from -z), "top" (from above), or
/// "quarter" (from +x and +z, a little above), or `[dx, dy, dz]`: the eye that many metres from the entity's middle.
/// `yaw` (degrees) turns the eye round the entity from that side, counter-clockwise seen from above; `pitch` (degrees) is
/// how far above the level it looks down from (90 straight down).
///
/// The entity's middle is where it is seen: on the hills of `nova.terrain` the renderer lifts it by the ground under it, and
/// so does the view. The eye never goes under the ground there, and it is moved in, along its line of sight, in front of a
/// wall, a solid entity or scenery that would stand between it and the entity.
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct View {
    pub follow: String,
    pub from: Option<ViewFrom>,
    pub distance: Option<f64>,
    pub height: Option<f64>,
    pub yaw: Option<f64>,
    pub pitch: Option<f64>,
}

/// Where a `view` looks from: a side by name, or an offset in metres from the entity's middle.
#[derive(Deserialize, Clone, Debug)]
#[serde(untagged)]
pub enum ViewFrom {
    Side(String),
    Offset([f64; 3]),
}

/// The sides a `view` looks from.
pub const VIEW_SIDES: [&str; 7] = ["side", "right", "left", "front", "back", "top", "quarter"];

/// Where a `view` puts the eye for an entity whose middle (as it is seen) is `mid`, before anything is in the way.
fn view_eye(view: &View, mid: glam::DVec3) -> glam::DVec3 {
    use glam::DVec3;
    let distance = view.distance.unwrap_or(4.0);
    let height = view.height.unwrap_or(0.3);
    let side = match &view.from {
        Some(ViewFrom::Offset(o)) => return mid + DVec3::from_array(*o),
        Some(ViewFrom::Side(s)) => s.as_str(),
        None => "side",
    };
    let mut dir = match side {
        "left" => DVec3::NEG_X,
        "front" => DVec3::Z,
        "back" => DVec3::NEG_Z,
        "top" => DVec3::new(0.0, 1.0, 0.02).normalize(),
        "quarter" => DVec3::new(0.7, 0.35, 0.7).normalize(),
        _ => DVec3::X,
    };
    if let Some(yaw) = view.yaw {
        // counter-clockwise seen from above (from +y): +x turns towards -z
        dir = glam::DQuat::from_rotation_y(yaw.to_radians()) * dir;
    }
    if let Some(pitch) = view.pitch {
        let flat = glam::DVec2::new(dir.x, dir.z);
        let flat = if flat.length() > 1e-6 {
            flat.normalize()
        } else {
            glam::DVec2::new(0.0, 0.02)
        };
        let p = pitch.clamp(-89.0, 89.9).to_radians();
        dir = DVec3::new(flat.x * p.cos(), p.sin(), flat.y * p.cos());
    }
    mid + dir * distance + DVec3::Y * height
}

/// The eye moved so that it sees the entity: in front of a wall, a solid entity or blocking scenery on the way (looked for
/// in the solid world, which the hills do not lift, from just outside the entity's own box) and above the ground under it.
fn clear_eye(game: &Game, b: &[f64], mid: glam::DVec3, eye: glam::DVec3, lift: f64) -> glam::DVec3 {
    use glam::DVec3;
    let margin = 0.3;
    let mut eye = eye;
    let d = eye - mid;
    let len = d.length();
    if len > 1e-3 {
        let dir = d / len;
        // (start outside the entity's own box, so that a solid entity does not hide itself)
        let half = DVec3::new(b[3] - b[0], b[4] - b[1], b[5] - b[2]).length() * 0.5;
        let start = half.min(len * 0.9);
        let from = mid - DVec3::Y * lift + dir * start;
        if let Some(hit) = game.sightline(from.to_array(), dir.to_array(), len - start + margin) {
            let reach = (start + hit - margin).max(start.min(0.5));
            if reach < len {
                eye = mid + dir * reach;
            }
        }
    }
    // never under the ground: the hills where the eye is (and the flat ground, for an entity standing on or above it)
    let ground = game.ground_lift(eye.x, eye.z, 0.0);
    if ground != 0.0 || b[1] - lift >= -0.01 {
        eye.y = eye.y.max(ground + margin);
    }
    eye
}

/// Where a picture of a 3D world puts a point, in pixels from the top left, as the renderer projects it (right-handed,
/// y up, a vertical field of view); `None` behind the camera.
fn project(cam: &crate::gfx::Camera, size: (u32, u32), p: [f64; 3]) -> Option<(f64, f64)> {
    let eye = cam.eye.as_dvec3();
    let f = (cam.target.as_dvec3() - eye).normalize_or_zero();
    let r = f.cross(glam::DVec3::Y).normalize_or_zero();
    let u = r.cross(f);
    let d = glam::DVec3::from_array(p) - eye;
    let z = d.dot(f);
    if z < 0.05 {
        return None;
    }
    let t = ((cam.fov_y_degrees as f64).to_radians() * 0.5).tan();
    let aspect = size.0 as f64 / size.1 as f64;
    let (nx, ny) = (d.dot(r) / (z * t * aspect), d.dot(u) / (z * t));
    Some((
        (nx + 1.0) * 0.5 * size.0 as f64,
        (1.0 - ny) * 0.5 * size.1 as f64,
    ))
}

impl Plan {
    pub fn from_file(path: &Path) -> Result<Plan, String> {
        let text = std::fs::read_to_string(path)
            .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        Self::from_json(&text, &path.display().to_string())
    }

    /// A plan from its JSON text (`name` says where it came from in errors). A `play` tool's route file is one too: its
    /// `route` is the plan's `steps`.
    pub fn from_json(text: &str, name: &str) -> Result<Plan, String> {
        let plan: Plan = serde_json::from_str(text).map_err(|e| {
            format!(
                "{name}: not a play plan: {e} (a plan is {{ \"steps\": [ {{ \"hold\": [\"right\"], \"frames\": 40 }}, {{ \"press\": \"a\" }}, {{ \"wait\": 20, \"capture\": \"after\" }} ], \"capture_at\": [1, 60] }})"
            )
        })?;
        unroll(&plan.steps).map_err(|e| format!("{name}: {e}"))?;
        Ok(plan)
    }
}

/// One held thing: an action forced to a value, or a source (a key, a pad button) held down.
fn held(entry: &str) -> Result<(bool, String, f32), String> {
    let (name, value) = match entry.split_once('=') {
        Some((n, v)) => (
            n,
            v.parse::<f32>()
                .map_err(|_| format!("'{entry}': '{v}' is not a number"))?,
        ),
        None => (entry, 1.0),
    };
    Ok((name.contains(':'), name.to_string(), value))
}

/// One step as it is played: groups and repeats are unrolled into a plain list, each entry keeping the name it is
/// reported by ("step 3.2 (round 4 of 10)").
struct Flat {
    step: Step,
    label: String,
    /// The groups it is inside (outermost first): when one of them is over, the step is skipped.
    groups: Vec<usize>,
    /// The marker after a group's last round (it says so when the group's `until` never held).
    end_of: Option<usize>,
}

struct Group {
    until: Option<String>,
    quiet: bool,
    rounds: u32,
    done: bool,
    /// What its `always` and `record` watch while its steps play, and the label they are reported by.
    always: Vec<String>,
    record: Vec<String>,
    label: String,
}

/// An `always` condition being watched: where it was given, and the frames it was false on.
struct Watch {
    cond: String,
    scope: String,
    checked: u32,
    false_frames: u32,
    first: Option<(u32, String)>,
    last: u32,
    error: bool,
}

/// A `record` expression's values, frame by frame, kept as runs of one value: (first frame, last frame, value). Every frame
/// of the run is kept (a run is at most [`MAX_FRAMES`] long).
struct Record {
    expr: String,
    scope: String,
    runs: Vec<(u32, u32, String)>,
    frames: u32,
}

/// The most steps a plan may unroll to.
const MAX_STEPS: usize = 50_000;

fn unroll(steps: &[Step]) -> Result<(Vec<Flat>, Vec<Group>), String> {
    let mut flat = Vec::new();
    let mut groups = Vec::new();
    flatten(steps, "step ", "", &[], &mut flat, &mut groups)?;
    Ok((flat, groups))
}

fn flatten(
    steps: &[Step],
    prefix: &str,
    suffix: &str,
    inside: &[usize],
    out: &mut Vec<Flat>,
    groups: &mut Vec<Group>,
) -> Result<(), String> {
    for (i, s) in steps.iter().enumerate() {
        let bare = format!("{prefix}{}", i + 1);
        let label = format!("{bare}{suffix}");
        if s.frames.is_some() && s.wait.is_some() {
            return Err(format!(
                "{label} has both \"frames\" and \"wait\": give one"
            ));
        }
        if let Some(n) = s.tap_every
            && n < 3
        {
            return Err(format!(
                "{label}: \"tap_every\" is {n}; a tap takes two frames, so it must be 3 or more"
            ));
        }
        if let Some(children) = &s.steps {
            if s.hold.is_some()
                || s.press.is_some()
                || s.tap.is_some()
                || s.frames.is_some()
                || s.wait.is_some()
                || s.lua.is_some()
                || s.walk_to.is_some()
                || s.fight.is_some()
            {
                return Err(format!(
                    "{label} is a group (it has \"steps\"), which takes only \"repeat\", \"until\", \"may_time_out\", \"capture\", \"always\" and \"record\": put the rest in its steps"
                ));
            }
            let rounds = s.repeat.unwrap_or(if s.until.is_some() { 100 } else { 1 });
            let id = groups.len();
            groups.push(Group {
                until: s.until.clone(),
                quiet: s.may_time_out,
                rounds,
                done: false,
                always: s.always.as_ref().map(OneOrMany::list).unwrap_or_default(),
                record: s.record.as_ref().map(OneOrMany::list).unwrap_or_default(),
                label: format!("{bare}{suffix}"),
            });
            let mut within = inside.to_vec();
            within.push(id);
            for round in 1..=rounds {
                let round_suffix = if rounds > 1 {
                    format!(" (round {round} of {rounds}){suffix}")
                } else {
                    suffix.to_string()
                };
                flatten(
                    children,
                    &format!("{bare}."),
                    &round_suffix,
                    &within,
                    out,
                    groups,
                )?;
                if out.len() > MAX_STEPS {
                    break;
                }
            }
            out.push(Flat {
                step: Step {
                    capture: s.capture.clone(),
                    ..Default::default()
                },
                label,
                groups: inside.to_vec(),
                end_of: Some(id),
            });
        } else {
            if s.tap_every.is_some()
                && s.frames.or(s.wait).is_none()
                && s.until.is_none()
                && s.walk_to.is_none()
                && s.fight.is_none()
            {
                return Err(format!(
                    "{label} has \"tap_every\" but no length: give \"frames\" or \"until\""
                ));
            }
            if s.fight.is_some() && s.walk_to.is_some() {
                return Err(format!(
                    "{label} has both \"fight\" and \"walk_to\": a step does one of them"
                ));
            }
            if let Some(n) = s.attack_every
                && n < 3
            {
                return Err(format!(
                    "{label}: \"attack_every\" is {n}; a tap takes two frames, so it must be 3 or more"
                ));
            }
            if let Some(p) = &s.plane
                && p != "xy"
                && p != "xz"
            {
                return Err(format!(
                    "{label}: \"plane\" is \"xy\" (a flat game) or \"xz\" (the ground of a 3D game), not \"{p}\""
                ));
            }
            let times = s.repeat.unwrap_or(1);
            for round in 1..=times {
                let mut step = s.clone();
                step.repeat = None;
                out.push(Flat {
                    step,
                    label: if times > 1 {
                        format!("{bare} (round {round} of {times}){suffix}")
                    } else {
                        label.clone()
                    },
                    groups: inside.to_vec(),
                    end_of: None,
                });
                if out.len() > MAX_STEPS {
                    break;
                }
            }
        }
        if out.len() > MAX_STEPS {
            return Err(format!(
                "the plan unrolls to more than {MAX_STEPS} steps (its repeats multiply): use an \"until\" or fewer rounds"
            ));
        }
    }
    Ok(())
}

/// A `walk_to` or `fight` step under way. Each frame it points the movement actions at where it is going and afterwards
/// looks at how the walker really moved. It does not assume that "stick right" is +x: it keeps an estimate of the turn
/// between the stick and the ground (`theta`), which starts at none (right is +x, down on the stick is +y in 2D or +z in
/// 3D) and is put right from the measured movement whenever that disagrees by more than 20 degrees for three frames
/// running. That is what makes it work with a stick that is relative to a turned camera. If correcting the turn keeps
/// failing, it tries the mirror image.
///
/// Where it is going is the next corner of a path round what is solid (`Game::path`: the scene's solid tiles and the
/// entities tagged `solid` in a flat game; `nova.solid`, `nova.walls` and the scenery in a 3D one), found when the step
/// starts and again when it stops getting nearer. Without a path (nothing solid is known, or `"straight": true`) it
/// walks straight at the place and gives up when it stops getting nearer.
///
/// It drives the axes `move_x`, `move_y` and the buttons `left`, `right`, `up`, `down` together (those the game has; a
/// step's `axes` and `dirs` name others), because it cannot know which of them the game's code reads.
#[derive(Default)]
struct Walk {
    theta: f64,
    /// A stick that is relative to the 3D camera turns with it: the estimate is `theta + turn_k * (yaw - yaw0)`, where
    /// `turn_k` is 0 (the stick is fixed to the ground), -1 (it follows `nova.cam3.yaw`, as cam3.forward and cam3.right
    /// make it) or 1, whichever has fitted the measured movement best (`turn_err`, a running mean per choice).
    yaw0: f64,
    yaw: f64,
    turn_k: f64,
    turn_err: [f64; 3],
    mirror: bool,
    /// Where the walker was before the frame, and the stick it was given (before mirroring).
    before: Option<((f64, f64), (f64, f64))>,
    best: f64,
    since_best: u32,
    top_speed: f64,
    off: u32,
    corrections: u32,
    started: bool,
    /// The step is over (arrived, stuck, or it could not start).
    over: bool,
    /// The corners still to walk through, and which is next.
    path: Vec<(f64, f64)>,
    leg: usize,
    planned: bool,
    plans: u32,
    planned_at: u32,
    planned_for: i64,
    /// Whether the path reaches the place (or only the nearest place that can be reached).
    reaches: bool,
    /// Where it is heading this frame.
    aim: (f64, f64),
    /// What is left of the minor direction for a game that reads buttons (so that a shallow angle is walked, not rounded).
    dither: (f64, f64),
    frames: u32,
    // a fight
    foes: Option<u32>,
    attacks: u32,
    cooldown: u32,
    swing: u32,
    life_at_start: Option<String>,
    life: Option<String>,
    /// The scene the step began in (its token): a `walk_to` a thing ends when the scene changes under it (a door).
    scene: Option<String>,
}

const WALK_STUCK_FRAMES: u32 = 120;

/// What a walk that failed tried, in words: how often it looked for a way and the corners of the last one.
fn tried(walk: &Walk, names: (&str, &str)) -> String {
    if walk.plans == 0 || walk.path.is_empty() {
        return "It tried walking straight at the place (no way round was planned); go round with a walk_to a point beside what is in the way".to_string();
    }
    let corners: Vec<String> = walk
        .path
        .iter()
        .take(8)
        .map(|p| format!("[{}, {}]", short(p.0), short(p.1)))
        .collect();
    format!(
        "It tried: {} plan{} of a way round what is solid; the last one goes through {}{} ({}, {}), and it was on its way to corner {}{}",
        walk.plans,
        if walk.plans == 1 { "" } else { "s" },
        corners.join(" "),
        if walk.path.len() > 8 { " ..." } else { "" },
        names.0,
        names.1,
        (walk.leg + 1).min(walk.path.len()),
        if walk.reaches {
            ""
        } else {
            "; none of them reaches the place"
        }
    )
}
const WALK_REPLAN_FRAMES: u32 = 45;
const WALK_DEADBAND: f64 = 0.35;

fn wrap(a: f64) -> f64 {
    let mut a = a % std::f64::consts::TAU;
    if a > std::f64::consts::PI {
        a -= std::f64::consts::TAU;
    } else if a < -std::f64::consts::PI {
        a += std::f64::consts::TAU;
    }
    a
}

fn short(v: f64) -> String {
    let s = format!("{v:.2}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" { "0".into() } else { s.into() }
}

fn far(a: (f64, f64), b: (f64, f64)) -> f64 {
    ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt()
}

/// Whether two hitboxes `gap` apart count as touching: within `reach`, or overlapping when no reach is given (an
/// overlap is what `on_collide_<tag>` and `touching` see).
fn touches(gap: f64, reach: f64) -> bool {
    if reach > 0.0 { gap <= reach } else { gap < 0.0 }
}

/// A gap between two hitboxes in words.
fn apart(gap: f64, unit: &str) -> String {
    if gap < 0.0 {
        format!("overlap by {} {unit}", short(-gap))
    } else if gap == 0.0 {
        "touch".to_string()
    } else {
        format!("are {} {unit} apart", short(gap))
    }
}

struct Running {
    index: usize,
    /// Frames of the step already played.
    played: u32,
    walk: Walk,
    /// The input actions the game asked about while the step played.
    reads: std::collections::BTreeSet<String>,
    /// Where the walker was while a direction was held: to say a hold that something solid stopped.
    hold_track: Option<HoldTrack>,
}

/// The walker during a step that holds a direction: where it started and was last, how far it went, and the frames it stood still.
#[derive(Default)]
struct HoldTrack {
    name: String,
    unit: String,
    last: Option<(f64, f64)>,
    path: f64,
    still: u32,
    frames: u32,
}

impl Running {
    fn at(index: usize) -> Self {
        Self {
            index,
            played: 0,
            walk: Walk::default(),
            reads: Default::default(),
            hold_track: None,
        }
    }
}

/// What a moving step is after.
enum Aim {
    Point(f64, f64),
    Entity(String),
    Fight(String),
}

fn aim_of(step: &Step) -> Option<Aim> {
    if let Some(tag) = &step.fight {
        return Some(Aim::Fight(tag.clone()));
    }
    match &step.walk_to {
        Some(Target::Point(p)) => Some(Aim::Point(p[0], p[1])),
        Some(Target::Entity(name)) => Some(Aim::Entity(name.clone())),
        None => None,
    }
}

/// The state of a run: which step is playing and everything noted so far.
pub struct Playtest {
    plan: Plan,
    flat: Vec<Flat>,
    groups: Vec<Group>,
    out: PathBuf,
    at: Option<Running>,
    setup_done: bool,
    steps_done: bool,
    pictures_due: Vec<String>,
    captures: Vec<Value>,
    log: Vec<Value>,
    sounds: Vec<Value>,
    warnings: Vec<String>,
    notes: Vec<String>,
    /// How each walk and fight went, in words.
    results: Vec<String>,
    /// Steps whose own Lua failed (the run went on).
    pub step_errors: Vec<String>,
    /// What stopped the run: an error of the game itself.
    pub error: Option<String>,
    actions: Vec<String>,
    /// Buttons and the axes they share keys with: (button, axis, the side of the axis).
    links: Vec<(String, String, f32)>,
    /// A step failed on this frame (for `stop_on_fail`).
    failed: Option<String>,
    /// The route was stopped at this step.
    stopped: Option<String>,
    god: Option<Value>,
    all_reads: std::collections::BTreeSet<String>,
    render: Value,
    /// The size of the pictures, in pixels (for `crop_to`).
    size: (u32, u32),
    /// The camera of the picture being taken, when `view` gives one.
    view_cam: Option<crate::gfx::Camera>,
    /// Whether a `view` or `crop_to` that could not be followed has been said.
    view_said: bool,
    crop_said: bool,
    /// The `always` conditions and `record` expressions met so far.
    watches: Vec<Watch>,
    records: Vec<Record>,
}

impl Playtest {
    pub fn new(plan: Plan, fallback_out: &Path) -> Result<Self, String> {
        let out = plan.out.clone().unwrap_or_else(|| fallback_out.into());
        std::fs::create_dir_all(&out)
            .map_err(|e| format!("cannot make the folder {}: {e}", out.display()))?;
        let (flat, groups) = unroll(&plan.steps)?;
        for o in &plan.overlay {
            if !OVERLAYS.contains(&o.as_str()) {
                return Err(format!(
                    "\"overlay\" has \"{o}\"; it takes {}",
                    OVERLAYS.join(", ")
                ));
            }
        }
        if let Some(v) = &plan.view {
            match &v.from {
                Some(ViewFrom::Side(from)) if !VIEW_SIDES.contains(&from.as_str()) => {
                    return Err(format!(
                        "\"view\" has \"from\": \"{from}\"; it takes {}, or [dx, dy, dz] in metres from the entity's middle",
                        VIEW_SIDES.join(", ")
                    ));
                }
                Some(ViewFrom::Offset(o))
                    if o.iter().any(|v| !v.is_finite())
                        || o.iter().map(|v| v * v).sum::<f64>() < 0.01 =>
                {
                    return Err("\"view\" has \"from\": [dx, dy, dz], metres from the entity's middle: finite and not all near 0".into());
                }
                _ => {}
            }
            if [v.yaw, v.pitch].iter().flatten().any(|a| !a.is_finite()) {
                return Err("\"view\" has \"yaw\" and \"pitch\" in degrees".into());
            }
            if v.distance.is_some_and(|d| !(d > 0.1 && d < 500.0)) {
                return Err("\"view\" has a \"distance\" in metres, above 0.1".into());
            }
        }
        Ok(Self {
            plan,
            flat,
            groups,
            out,
            at: None,
            setup_done: false,
            steps_done: false,
            pictures_due: Vec::new(),
            captures: Vec::new(),
            log: Vec::new(),
            sounds: Vec::new(),
            warnings: Vec::new(),
            notes: Vec::new(),
            results: Vec::new(),
            step_errors: Vec::new(),
            error: None,
            actions: Vec::new(),
            links: Vec::new(),
            failed: None,
            stopped: None,
            god: None,
            all_reads: Default::default(),
            render: Value::Null,
            size: (960, 540),
            view_cam: None,
            view_said: false,
            crop_said: false,
            watches: Vec::new(),
            records: Vec::new(),
        })
    }

    pub fn seed(&self) -> Option<u64> {
        self.plan.seed
    }

    /// The size of the pictures in pixels (960x540 when not said), for the boxes `crop_to` gives.
    pub fn set_size(&mut self, width: u32, height: u32) {
        self.size = (width.max(1), height.max(1));
    }

    /// The camera the next picture is taken with: the `view`'s, beside the entity it follows as it is now, or `None` for
    /// the game's own. Call it just before taking the picture.
    pub fn view_camera(&mut self, game: &Game) -> Option<crate::gfx::Camera> {
        self.view_cam = None;
        let view = self.plan.view.clone()?;
        let b = match game.extent(&view.follow) {
            Ok((true, b)) if b.len() >= 6 => b,
            Ok(_) => {
                if !std::mem::replace(&mut self.view_said, true) {
                    self.warnings.push(format!("\"view\" is for a 3D game, and '{}' is in a flat one: the pictures are the game's own (use \"crop_to\")", view.follow));
                }
                return None;
            }
            Err(e) => {
                if !std::mem::replace(&mut self.view_said, true) {
                    self.warnings.push(format!(
                        "\"view\" follows '{}': {e}; those pictures are from the game's own camera",
                        view.follow
                    ));
                }
                return None;
            }
        };
        let mid = glam::DVec3::new(
            (b[0] + b[3]) / 2.0,
            (b[1] + b[4]) / 2.0,
            (b[2] + b[5]) / 2.0,
        );
        let lift = b.get(6).copied().unwrap_or(0.0);
        let eye = view_eye(&view, mid);
        let eye = clear_eye(game, &b, mid, eye, lift);
        let cam = crate::gfx::Camera {
            eye: eye.as_vec3(),
            target: mid.as_vec3(),
            fov_y_degrees: game.camera3().fov_y_degrees.clamp(20.0, 90.0),
        };
        self.view_cam = Some(cam);
        Some(cam)
    }

    /// The box of the `crop_to` entity on the picture being taken, in pixels [x0, y0, x1, y1] (it may reach past the
    /// edges), or null when there is no `crop_to` or it is not on the picture.
    fn crop_box(&mut self, game: &Game) -> Value {
        let Some(name) = self.plan.crop_to.clone() else {
            return Value::Null;
        };
        let (w, h) = (self.size.0 as f64, self.size.1 as f64);
        let found = game.extent(&name).and_then(|(three, b)| {
            if !three && b.len() >= 6 {
                let s = h / b[5].max(1.0);
                return Ok([b[0] * s, b[1] * s, b[2] * s, b[3] * s]);
            }
            if b.len() < 6 {
                return Err("it has no place".into());
            }
            let cam = self.view_cam.unwrap_or_else(|| game.camera3());
            let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
            for i in 0..8 {
                let p = [
                    b[if i & 1 == 0 { 0 } else { 3 }],
                    b[if i & 2 == 0 { 1 } else { 4 }],
                    b[if i & 4 == 0 { 2 } else { 5 }],
                ];
                if let Some((x, y)) = project(&cam, self.size, p) {
                    (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
                }
            }
            if x0 > x1 {
                return Err("it is behind the camera".into());
            }
            Ok([x0, y0, x1, y1])
        });
        match found {
            Ok(b) if b[2] > 0.0 && b[3] > 0.0 && b[0] < w && b[1] < h => {
                json!(b.map(|v| (v * 10.0).round() / 10.0))
            }
            Ok(_) => Value::Null,
            Err(e) => {
                if !std::mem::replace(&mut self.crop_said, true) {
                    self.warnings.push(format!(
                        "\"crop_to\" '{name}': {e}; a picture without it is not cropped"
                    ));
                }
                Value::Null
            }
        }
    }

    pub fn start_scene(&self) -> Option<&str> {
        self.plan.start_scene.as_deref()
    }

    /// Whether the run is over once `done` frames have been played.
    pub fn finished(&self, done: u32) -> bool {
        self.error.is_some()
            || done >= MAX_FRAMES
            || (self.steps_done
                && self.pictures_due.is_empty()
                && done >= self.plan.frames.unwrap_or(0)
                && self.plan.capture_at.iter().all(|f| *f <= done)
                && done >= 1)
    }

    fn step_length(step: &Step) -> u32 {
        if step.until.is_some() || step.walk_to.is_some() || step.fight.is_some() {
            return step.max.unwrap_or(600).max(1);
        }
        if let Some(n) = step.frames.or(step.wait) {
            return n;
        }
        if step.press.is_some() || step.tap.is_some() {
            return 3;
        }
        if step.hold.is_some() || step.capture.is_some() {
            return 1;
        }
        0 // (a step that only runs Lua takes no time)
    }

    /// Whether a group the step is inside has ended (its `until` held): the step is then passed over.
    fn skipped(&self, index: usize) -> bool {
        self.flat
            .get(index)
            .is_some_and(|f| f.groups.iter().any(|g| self.groups[*g].done))
    }

    fn length(&self, index: usize) -> u32 {
        if self.skipped(index) {
            return 0;
        }
        self.flat
            .get(index)
            .map_or(0, |f| Self::step_length(&f.step))
    }

    fn note(&mut self, text: String) {
        if !self.notes.contains(&text) {
            self.notes.push(text);
        }
    }

    /// A step did not do what it was for: said as a warning, and with `stop_on_fail` the route ends here.
    fn fail(&mut self, label: &str, text: String) {
        self.warnings.push(text);
        if self.failed.is_none() {
            self.failed = Some(label.to_string());
        }
    }

    fn step_error(&mut self, label: &str, text: String) {
        self.step_errors.push(text);
        if self.failed.is_none() {
            self.failed = Some(label.to_string());
        }
    }

    fn check_names(&mut self, names: &[String]) {
        for entry in names {
            if let Ok((false, name, _)) = held(entry)
                && !self.actions.contains(&name)
            {
                let w = format!(
                    "'{name}' is not an input action of this game, so holding it does nothing (its actions: {})",
                    self.actions.join(", ")
                );
                if !self.warnings.contains(&w) {
                    self.warnings.push(w);
                }
            }
        }
    }

    /// Ends the groups whose `until` holds now. True when one of the groups of step `index` ended.
    fn check_groups(&mut self, index: usize, game: &Game) -> bool {
        let Some(flat) = self.flat.get(index) else {
            return false;
        };
        let mut ended = false;
        for g in flat.groups.clone() {
            if self.groups[g].done {
                ended = true;
                continue;
            }
            let Some(cond) = self.groups[g].until.clone() else {
                continue;
            };
            match game.lua_truth(&cond) {
                Ok(true) => {
                    self.groups[g].done = true;
                    ended = true;
                }
                Ok(false) => {}
                Err(e) => {
                    // (a condition that cannot be worked out ends its group, said once)
                    self.groups[g].done = true;
                    self.groups[g].quiet = true;
                    ended = true;
                    let label = self.flat[index].label.clone();
                    self.step_error(&label, format!("{label}: the group's until `{cond}`: {e}"));
                }
            }
        }
        ended
    }

    /// The buttons that go with the axes a step sets, and the axes that go with its buttons, as the keys and the stick
    /// press both on a real machine: a route that holds `up` moves a hero that reads `move_y`, and the other way round.
    fn link_inputs(&mut self, input: &mut InputFrame, given: &[(String, f32)]) {
        let mut add: Vec<(String, f32)> = Vec::new();
        let mut pairs: Vec<String> = Vec::new();
        for (name, value) in given {
            for (button, axis, side) in &self.links {
                let (other, v) = if button == name && *value >= 0.5 {
                    (axis, *side)
                } else if axis == name && value.abs() >= 0.5 && value.signum() == *side {
                    (button, 1.0)
                } else {
                    continue;
                };
                if given.iter().any(|(n, _)| n == other) {
                    continue; // (the step says what that one is itself)
                }
                if input.overrides.iter().any(|(n, _)| n == other) {
                    continue; // (held for the whole run)
                }
                pairs.push(format!("`{name}` also sets `{other}`"));
                match add.iter_mut().find(|(n, _)| n == other) {
                    Some((_, sum)) => *sum = (*sum + v).clamp(-1.0, 1.0),
                    None => add.push((other.clone(), v)),
                }
            }
        }
        if add.is_empty() {
            return;
        }
        input.overrides.extend(add);
        for pair in pairs {
            self.note(format!(
                "a hold of {pair} (they share keys and the stick, so a real machine sets both; a step that names both is left as written)"
            ));
        }
    }

    /// Points the movement actions of a `walk_to` or `fight` step at where it is going.
    fn steer(&mut self, index: usize, frame: u32, game: &Game, input: &mut InputFrame) {
        let Some(flat) = self.flat.get(index) else {
            return;
        };
        let (step, label) = (flat.step.clone(), flat.label.clone());
        let Some(aim) = aim_of(&step) else {
            return;
        };
        if self.at.as_ref().is_none_or(|a| a.walk.over) {
            return;
        }
        let (who_arg, plane_arg) = (step.who.as_deref(), step.plane.as_deref());
        let (x, y, plane, who, yaw) = match game.walker(who_arg, plane_arg) {
            Ok(w) => w,
            Err(e) => {
                self.at.as_mut().expect("a step is playing").walk.over = true;
                self.step_error(&label, format!("{label} {}: {e}", step.verb()));
                return;
            }
        };
        let three = plane == "xz";
        // where to, and what is there
        let (goal, thing) = match &aim {
            Aim::Point(px, py) => ((*px, *py), None),
            Aim::Entity(name) | Aim::Fight(name) => {
                match game.goal(who_arg, plane_arg, name, matches!(aim, Aim::Fight(_))) {
                    Ok(Some(g)) => ((g.x, g.y), Some(g)),
                    Ok(None) => return, // (nobody left to fight: the step ends after this frame)
                    Err(e) => {
                        self.at.as_mut().expect("a step is playing").walk.over = true;
                        self.step_error(&label, format!("{label} {}: {e}", step.verb()));
                        return;
                    }
                }
            }
        };
        let axes: Vec<String> = match &step.axes {
            Some(a) => a.to_vec(),
            None => vec!["move_x".into(), "move_y".into()],
        };
        let dirs: Vec<String> = match &step.dirs {
            Some(d) => d.to_vec(),
            None => vec!["left".into(), "right".into(), "up".into(), "down".into()],
        };
        let has = |n: &String| self.actions.contains(n);
        let use_axes = axes.iter().all(has);
        let use_dirs = dirs.iter().all(has);
        let started = self.at.as_ref().is_some_and(|a| a.walk.started);
        if !started {
            let walk = &mut self.at.as_mut().expect("a step is playing").walk;
            walk.started = true;
            walk.scene = game.scene_now().map(|(token, _)| token);
            if let Some(g) = &thing {
                walk.foes = Some(g.count);
                walk.life_at_start = g.hp.clone();
            }
            if !use_axes && !use_dirs {
                walk.over = true;
                let text = format!(
                    "{label} {}: this game has neither the axes {} nor the buttons {} (its actions: {}); name the ones that move '{who}' with \"axes\": [x, y] or \"dirs\": [left, right, up, down]",
                    step.verb(),
                    axes.join(", "),
                    dirs.join(", "),
                    self.actions.join(", ")
                );
                self.step_error(&label, text);
                return;
            }
            let mut driven = Vec::new();
            if use_axes {
                driven.extend(axes.iter().cloned());
            }
            if use_dirs {
                driven.extend(dirs.iter().cloned());
            }
            self.note(format!(
                "walk_to and fight steer '{who}' in the {} plane by driving {} each frame and measuring how it really moved (so a camera-relative stick works)",
                if three { "x, z" } else { "x, y" },
                driven.join(", ")
            ));
        }
        let radius = step.radius.unwrap_or(if three { 0.5 } else { 12.0 });
        let reach = step.reach.unwrap_or(if three { 0.3 } else { 0.0 });
        let range = step.range.unwrap_or_else(|| {
            if three {
                1.5
            } else {
                thing.as_ref().map_or(16.0, |g| g.size.max(16.0))
            }
        });
        // there already?
        let fighting = matches!(aim, Aim::Fight(_));
        let in_range = match (&aim, &thing) {
            (Aim::Point(..), _) => far((x, y), goal) <= radius,
            (Aim::Entity(_), Some(g)) => touches(g.gap, reach),
            (Aim::Fight(_), Some(g)) => g.gap <= range,
            _ => false,
        };
        if in_range && !fighting {
            self.at.as_mut().expect("a step is playing").walk.before = None;
            return; // (there: the step ends after this frame)
        }
        // the way there
        let (planned, plans, planned_at, planned_for) = {
            let w = &self.at.as_ref().expect("a step is playing").walk;
            (w.planned, w.plans, w.planned_at, w.planned_for)
        };
        let id = thing.as_ref().map_or(0, |g| g.id);
        let again =
            fighting && !in_range && (frame.saturating_sub(planned_at) >= 30 || id != planned_for);
        if !step.straight && (!planned || again) {
            let name = match &aim {
                Aim::Point(..) => None,
                Aim::Entity(n) | Aim::Fight(n) => Some(n.as_str()),
            };
            let found = game.path(
                who_arg,
                plane_arg,
                goal,
                name,
                step.avoid.as_deref(),
                if fighting { range } else { reach },
            );
            let walk = &mut self.at.as_mut().expect("a step is playing").walk;
            walk.planned = true;
            walk.plans = plans + 1;
            walk.planned_at = frame;
            walk.planned_for = id;
            walk.leg = 0;
            walk.best = 0.0;
            walk.since_best = 0;
            match found {
                Ok(p) => {
                    walk.path = p.points;
                    walk.reaches = p.found;
                    let corners = walk.path.len();
                    if let Some(why) = p.why {
                        walk.reaches = true;
                        self.note(format!("{} walks straight: {why}", step.verb()));
                    } else if !p.found && !fighting {
                        self.note(format!(
                            "{label}: no way to the place was found round what is solid ({} places looked at): '{who}' walks to the nearest place it can reach",
                            p.looked
                        ));
                    } else if plans == 0 && corners > 1 {
                        self.note(format!(
                            "{label}: {} found a way round what is solid through {} corners{}",
                            step.verb(),
                            corners,
                            if three {
                                " (nova.solid, nova.walls and the scenery, tried on a grid of half metres)"
                            } else {
                                " (solid tiles and entities tagged solid, with the walker's own hitbox)"
                            }
                        ));
                    }
                }
                Err(e) => {
                    walk.path.clear();
                    walk.reaches = true;
                    self.note(format!(
                        "{} walks straight: no path could be worked out ({e})",
                        step.verb()
                    ));
                }
            }
        }
        let walk = &mut self.at.as_mut().expect("a step is playing").walk;
        walk.yaw = yaw;
        let tolerance = f64::max(if three { 0.2 } else { 3.0 }, walk.top_speed * 1.1);
        while walk.leg < walk.path.len() && far((x, y), walk.path[walk.leg]) <= tolerance {
            walk.leg += 1;
        }
        walk.aim = walk.path.get(walk.leg).copied().unwrap_or(goal);
        let set = |name: &String, value: f64, input: &mut InputFrame| {
            input.overrides.retain(|(n, _)| n != name);
            input.overrides.push((name.clone(), value as f32));
        };
        if walk.cooldown > 0 {
            walk.cooldown -= 1;
        }
        if !in_range {
            walk.swing = 0; // (what it swung at is gone: the tap is not finished on the next one)
        }
        if fighting && in_range {
            // stand, face it, swing
            if walk.swing == 0 && walk.cooldown == 0 {
                walk.swing = 2;
                walk.cooldown = step.attack_every.unwrap_or(20).max(3);
                walk.attacks += 1;
            }
            let facing = walk.cooldown <= 1 || walk.swing > 0;
            if walk.swing > 0 {
                walk.swing -= 1;
                let attack = match &step.attack {
                    Some(a) => a.list(),
                    None => vec!["a".to_string()],
                };
                for name in &attack {
                    if name.contains(':') {
                        input.sources.insert(name.clone(), 1.0);
                    } else {
                        set(name, 1.0, input);
                    }
                }
            }
            if !facing {
                walk.before = None;
                return;
            }
        }
        let (dx, dy) = (walk.aim.0 - x, walk.aim.1 - y);
        let dist = (dx * dx + dy * dy).sqrt();
        if dist < 1e-6 {
            walk.before = None;
            return;
        }
        let (ux, uy) = (dx / dist, dy / dist);
        let now = walk.theta + walk.turn_k * (walk.yaw - walk.yaw0);
        let (c, s) = (now.cos(), now.sin());
        let stick = (ux * c + uy * s, -ux * s + uy * c);
        walk.before = Some(((x, y), stick));
        let (sx, sy) = if walk.mirror {
            (stick.0, -stick.1)
        } else {
            stick
        };
        if use_axes {
            set(&axes[0], sx, input);
            set(&axes[1], sy, input);
        }
        if use_dirs {
            // The bigger direction's button is down; the smaller one's is down for its share of the frames, so that a
            // shallow angle is walked as a shallow angle (a path's corners are met, a narrow gap is entered).
            let big = sx.abs().max(sy.abs()).max(1e-9);
            let share = |part: f64, left: &mut f64| -> bool {
                let ratio = part.abs() / big;
                if ratio >= 0.999 {
                    return true;
                }
                if ratio < 0.02 {
                    return false;
                }
                *left += ratio;
                if *left >= 1.0 {
                    *left -= 1.0;
                    true
                } else {
                    false
                }
            };
            let on_x = share(sx, &mut walk.dither.0);
            let on_y = share(sy, &mut walk.dither.1);
            for (name, on) in [
                (&dirs[0], on_x && sx < 0.0),
                (&dirs[1], on_x && sx > 0.0),
                (&dirs[2], on_y && sy < 0.0),
                (&dirs[3], on_y && sy > 0.0),
            ] {
                if on {
                    set(name, 1.0, input);
                }
            }
        }
    }

    /// Looks at how the walker moved this frame. True when the step is over.
    fn walked(&mut self, index: usize, game: &Game, last_frame: bool) -> bool {
        let Some(flat) = self.flat.get(index) else {
            return true;
        };
        let (step, label) = (flat.step.clone(), flat.label.clone());
        let Some(aim) = aim_of(&step) else {
            return false;
        };
        if self.at.as_ref().is_none_or(|a| a.walk.over) {
            return true;
        }
        let verb = step.verb();
        let (who_arg, plane_arg) = (step.who.as_deref(), step.plane.as_deref());
        let Ok((x, y, plane, who, _)) = game.walker(who_arg, plane_arg) else {
            let walk = &mut self.at.as_mut().expect("a step is playing").walk;
            walk.over = true;
            let (foes, attacks, frames) = (walk.foes, walk.attacks, walk.frames);
            let text = match &aim {
                Aim::Fight(tag) => format!(
                    "{label} fight: the walker is gone after {frames} frames and {attacks} attacks ({} '{tag}' at the start): it was destroyed, or the scene changed. \"invincible\": true keeps it alive",
                    foes.unwrap_or(0)
                ),
                _ => {
                    format!("{label} {verb}: the walker is gone (destroyed, or the scene changed)")
                }
            };
            self.step_error(&label, text);
            return true;
        };
        let three = plane == "xz";
        let (unit, names) = if three {
            ("m", ("x", "z"))
        } else {
            ("units", ("x", "y"))
        };
        // A walk into a thing that changed the scene (a door) went where it was going: it ends here, and does not walk on
        // to the next thing of that name or tag in the new scene.
        if let Aim::Entity(name) = &aim
            && let Some(start) = self.at.as_ref().and_then(|a| a.walk.scene.clone())
            && let Some((now, scene)) = game.scene_now()
            && now != start
        {
            let walk = &mut self.at.as_mut().expect("a step is playing").walk;
            walk.over = true;
            let text = format!(
                "{label}: walk_to '{name}': reached after {} frames, and the scene changed to '{scene}' (a door), so the step ends there; '{who}' is at {} {}, {} {} in '{scene}'",
                walk.frames + 1,
                names.0,
                short(x),
                names.1,
                short(y)
            );
            self.results.push(text);
            return true;
        }
        let (goal, thing) = match &aim {
            Aim::Point(px, py) => ((*px, *py), None),
            Aim::Entity(name) | Aim::Fight(name) => {
                let fighting = matches!(aim, Aim::Fight(_));
                match game.goal(who_arg, plane_arg, name, fighting) {
                    Ok(Some(g)) => ((g.x, g.y), Some(g)),
                    Ok(None) => {
                        let walk = &mut self.at.as_mut().expect("a step is playing").walk;
                        walk.over = true;
                        let life = match (&walk.life_at_start, &walk.life) {
                            (Some(a), Some(b)) if a != b => {
                                format!("; '{who}' went from {a} to {b}")
                            }
                            (Some(a), _) => format!("; '{who}' still has {a}"),
                            _ => String::new(),
                        };
                        let text = match walk.foes {
                            Some(n) => format!(
                                "{label}: fight '{name}': all {n} beaten in {} frames with {} attacks{life}",
                                walk.frames + 1,
                                walk.attacks
                            ),
                            None => format!("{label}: fight '{name}': there was none to fight"),
                        };
                        self.results.push(text);
                        return true;
                    }
                    Err(e) => {
                        let walk = &mut self.at.as_mut().expect("a step is playing").walk;
                        walk.over = true;
                        if walk.foes.is_some() {
                            // it was there when the step began: walking into it took it (a pickup) or went through it (a door)
                            let text = format!(
                                "{label}: walk_to '{name}': reached after {} frames, and it is gone now (taken, or the scene changed: a door); '{who}' is at {} {}, {} {}",
                                walk.frames + 1,
                                names.0,
                                short(x),
                                names.1,
                                short(y)
                            );
                            self.results.push(text);
                        } else {
                            self.step_error(&label, format!("{label} {verb}: {e}"));
                        }
                        return true;
                    }
                }
            }
        };
        let radius = step.radius.unwrap_or(if three { 0.5 } else { 12.0 });
        let reach = step.reach.unwrap_or(if three { 0.3 } else { 0.0 });
        let walk = &mut self.at.as_mut().expect("a step is playing").walk;
        walk.frames += 1;
        if let Some(g) = &thing
            && g.hp.is_some()
        {
            walk.life = g.hp.clone();
        }
        let dist = far((x, y), goal);
        let place = |walk: &Walk| match &thing {
            Some(g) => format!(
                "'{who}' is at {} {}, {} {}; its hitbox and that of '{}' {}",
                names.0,
                short(x),
                names.1,
                short(y),
                g.label,
                apart(g.gap, unit)
            ),
            None => format!(
                "'{who}' is at {} {}, {} {}, {} {unit} from [{}, {}]{}",
                names.0,
                short(x),
                names.1,
                short(y),
                short(dist),
                short(goal.0),
                short(goal.1),
                if walk.plans > 0 && !walk.reaches {
                    " (no way round what is solid reaches that point)"
                } else {
                    ""
                }
            ),
        };
        match (&aim, &thing) {
            (Aim::Point(..), _) if dist <= radius => {
                walk.over = true;
                let text = format!(
                    "{label}: walk_to [{}, {}]: there after {} frames ({})",
                    short(goal.0),
                    short(goal.1),
                    walk.frames,
                    place(walk)
                );
                self.results.push(text);
                return true;
            }
            (Aim::Entity(_), Some(g)) if touches(g.gap, reach) => {
                walk.over = true;
                let text = format!(
                    "{label}: walk_to '{}': touching it after {} frames ({})",
                    g.label,
                    walk.frames,
                    place(walk)
                );
                self.results.push(text);
                return true;
            }
            _ => {}
        }
        if let Some(((px, py), (sx, sy))) = walk.before {
            let (vx, vy) = (x - px, y - py);
            let speed = (vx * vx + vy * vy).sqrt();
            walk.top_speed = walk.top_speed.max(speed);
            if speed > 1e-6 && speed >= walk.top_speed * 0.5 {
                let measured = wrap(vy.atan2(vx) - sy.atan2(sx));
                let turned = walk.yaw - walk.yaw0;
                for (i, k) in [0.0, -1.0, 1.0].into_iter().enumerate() {
                    let e = wrap(measured - (walk.theta + k * turned)).abs();
                    walk.turn_err[i] = walk.turn_err[i] * 0.9 + e * 0.1;
                }
                if wrap(measured - (walk.theta + walk.turn_k * turned)).abs() > WALK_DEADBAND {
                    walk.off += 1;
                    if walk.off >= 3 {
                        walk.off = 0;
                        walk.corrections += 1;
                        if walk.corrections >= 4 {
                            // (turning the estimate keeps failing: the stick is mirrored against the ground)
                            walk.corrections = 0;
                            walk.mirror = !walk.mirror;
                            walk.theta = 0.0;
                        } else {
                            // (once the camera has turned enough to tell: the choice that has fitted best)
                            if turned.abs() > 0.15 {
                                let best = (0..3)
                                    .min_by(|a, b| walk.turn_err[*a].total_cmp(&walk.turn_err[*b]))
                                    .unwrap_or(0);
                                walk.turn_k = [0.0, -1.0, 1.0][best];
                            }
                            walk.theta = measured;
                            walk.yaw0 = walk.yaw;
                            walk.turn_err = [0.0; 3];
                        }
                    }
                } else {
                    walk.off = 0;
                }
            }
        }
        if let Aim::Fight(tag) = &aim {
            // a fight is over when nobody is left (above) or its time is up
            if last_frame {
                walk.over = true;
                let left = thing.as_ref().map_or(0, |g| g.count);
                let text = format!(
                    "{label}: fight '{tag}': {left} of {} still alive after {} frames and {} attacks ({})",
                    walk.foes.unwrap_or(left),
                    walk.frames,
                    walk.attacks,
                    place(walk)
                );
                if step.may_time_out {
                    self.results.push(text);
                } else {
                    self.fail(&label, format!("{text} (give it a bigger \"max\", another \"attack\" action or a \"range\" that suits the weapon; \"may_time_out\": true if that is expected)"));
                }
                return true;
            }
            return false;
        }
        // how far is left along the way
        let mut left = far((x, y), walk.aim);
        let mut from = walk.aim;
        for p in walk.path.iter().skip(walk.leg + 1) {
            left += far(from, *p);
            from = *p;
        }
        let gain = (radius * 0.25).max(1e-3);
        if walk.best == 0.0 || left < walk.best - gain {
            walk.best = left;
            walk.since_best = 0;
            walk.corrections = 0;
        } else {
            walk.since_best += 1;
        }
        // (on the last stretch: the last corner of a way to a thing is beside it, and may be a place it cannot quite stand)
        let at_the_end = walk.leg + usize::from(thing.is_some()) >= walk.path.len();
        if let Some(g) = &thing
            && at_the_end
            && walk.since_best >= 20
        {
            // walked into it as far as it goes: next to it when the hitboxes are near, or when it is the thing itself
            // that stops the walker (a house is solid a long way from its middle)
            let near = if three {
                reach.max(1.2)
            } else {
                g.size.max(24.0)
            };
            let name = match &aim {
                Aim::Entity(n) | Aim::Fight(n) => Some(n.as_str()),
                Aim::Point(..) => None,
            };
            let against = game.blocked(who_arg, plane_arg, name, step.avoid.as_deref());
            let is_it = against.as_ref().is_some_and(|b| b.1);
            if g.gap > near && !is_it && !step.straight && walk.plans < 4 {
                // against something else: look for another way from here
                walk.planned = false;
                walk.since_best = 0;
                walk.best = 0.0;
                return false;
            }
            walk.over = true;
            let text = format!(
                "{label}: walk_to '{}': stopped against it after {} frames ({})",
                g.label,
                walk.frames,
                place(walk)
            );
            if g.gap <= near || is_it || step.may_time_out {
                self.results.push(text);
            } else {
                let tried = tried(walk, names);
                self.fail(
                    &label,
                    format!(
                        "{text}: that is not next to it: {}. {tried}",
                        match against {
                            Some((what, _)) => format!("blocked by {what}"),
                            None => "nothing the path finder knows touches the walker there (its own code stops it: a clamp at the edge of the level, a state that does not move)".to_string(),
                        }
                    ),
                );
            }
            return true;
        }
        if !step.straight
            && walk.since_best >= WALK_REPLAN_FRAMES
            && walk.plans < 4
            && walk.plans > 0
            && !at_the_end
        {
            walk.planned = false; // (pushed off the way, or something moved: look for the way again)
            return false;
        }
        if walk.since_best >= WALK_STUCK_FRAMES {
            walk.over = true;
            let name = match &aim {
                Aim::Entity(n) | Aim::Fight(n) => Some(n.as_str()),
                Aim::Point(..) => None,
            };
            let against = game.blocked(who_arg, plane_arg, name, step.avoid.as_deref());
            let text = format!(
                "{label}: walk_to stopped getting nearer for {WALK_STUCK_FRAMES} frames and gave up: {}: {}. {}",
                place(walk),
                match against {
                    Some((what, _)) => format!("blocked by {what}"),
                    None if walk.path.is_empty() => format!(
                        "nothing the path finder knows touches it there, so the actions it drives do not move '{who}' or the game's own code stops it"
                    ),
                    None => format!(
                        "nothing the path finder knows touches it there (it knows solid tiles and entities tagged solid in 2D; nova.solid, entities with solid = true, nova.walls and the scenery in 3D), so the game's own code stops '{who}' or the actions it drives do not move it"
                    ),
                },
                tried(walk, names)
            );
            if step.may_time_out {
                self.results.push(text);
            } else {
                self.fail(&label, text);
            }
            return true;
        }
        if last_frame {
            let text = format!(
                "{label}: walk_to did not arrive in {} frames: {} (give it a bigger \"max\")",
                Self::step_length(&step),
                place(walk)
            );
            if step.may_time_out {
                self.results.push(text);
            } else {
                self.fail(&label, text);
            }
        }
        false
    }

    /// Moves to the step that plays on this frame (running the Lua of steps on the way) and adds what it holds to `input`.
    /// `frame` counts from 0.
    pub fn before_frame(&mut self, frame: u32, game: &Game, input: &mut InputFrame) {
        if self.actions.is_empty() {
            self.actions = game.action_names();
            self.links = game.input_links();
            game.record_drawn();
            if self.plan.invincible {
                game.set_testing("invincible", true);
            }
        }
        if frame > 0
            && let Some(lua) = self.plan.lua_each_frame.clone()
            && let Err(e) = game.run_lua(&lua, "lua_each_frame")
        {
            let text = format!("the plan's lua_each_frame: {e}");
            if !self.step_errors.contains(&text) {
                self.step_errors.push(text);
            }
        }
        if frame == 0 || self.steps_done || self.error.is_some() {
            return; // frame 1 is the scene coming up
        }
        loop {
            if self.at.is_none() {
                self.at = Some(Running::at(0));
                if !self.enter_step(0, game) {
                    return;
                }
            }
            let Some((index, played)) = self.at.as_ref().map(|a| (a.index, a.played)) else {
                return;
            };
            let Some(step) = self.flat.get(index).map(|f| f.step.clone()) else {
                self.steps_done = true;
                return;
            };
            if played >= self.length(index) {
                // (a step of no length, or one that ended on the frame before)
                if !self.next_step(game) {
                    return;
                }
                continue;
            }
            let label = self.flat[index].label.clone();
            let mut given: Vec<(String, f32)> = Vec::new();
            let mut apply = |entry: &str, errors: &mut Vec<String>| match held(entry) {
                Ok((true, name, value)) => {
                    input.sources.insert(name, value);
                }
                Ok((false, name, value)) => {
                    input.overrides.retain(|(n, _)| *n != name);
                    input.overrides.push((name.clone(), value));
                    given.push((name, value));
                }
                Err(e) => {
                    let e = format!("{label}: {e}");
                    if !errors.contains(&e) {
                        errors.push(e);
                    }
                }
            };
            for entry in step.hold.as_ref().map(OneOrMany::list).unwrap_or_default() {
                apply(&entry, &mut self.step_errors);
            }
            let tapping = match step.tap_every {
                Some(n) => played % n < 2,
                None => played < 2,
            };
            if tapping {
                let mut taps = step.press.as_ref().map(OneOrMany::list).unwrap_or_default();
                taps.extend(step.tap.as_ref().map(OneOrMany::list).unwrap_or_default());
                for entry in taps {
                    apply(&entry, &mut self.step_errors);
                }
            }
            self.link_inputs(input, &given);
            if step.walk_to.is_some() || step.fight.is_some() {
                self.steer(index, frame, game, input);
            }
            return;
        }
    }

    /// Runs what a step does when it starts. False when the steps are over.
    fn enter_step(&mut self, index: usize, game: &Game) -> bool {
        let Some(flat) = self.flat.get(index) else {
            self.steps_done = true;
            return false;
        };
        let (step, label, end_of) = (flat.step.clone(), flat.label.clone(), flat.end_of);
        if self.check_groups(index, game) {
            return true; // (inside a group that is over: passed by)
        }
        if let Some(g) = end_of {
            let group = &self.groups[g];
            if let Some(cond) = &group.until
                && !group.done
                && !group.quiet
            {
                let text = format!(
                    "{label}: `{cond}` never held in {} rounds of the group, so the run went on without it",
                    group.rounds
                );
                self.fail(&label, text);
            }
            return true;
        }
        let mut names = step.hold.as_ref().map(OneOrMany::list).unwrap_or_default();
        names.extend(step.press.as_ref().map(OneOrMany::list).unwrap_or_default());
        names.extend(step.tap.as_ref().map(OneOrMany::list).unwrap_or_default());
        names.extend(
            step.attack
                .as_ref()
                .map(OneOrMany::list)
                .unwrap_or_default(),
        );
        self.check_names(&names);
        if let Some(lua) = &step.lua
            && let Err(e) = game.run_lua(lua, &label)
        {
            self.step_error(&label, format!("{label} lua: {e}"));
        }
        true
    }

    fn next_step(&mut self, game: &Game) -> bool {
        let index = self.at.as_ref().map(|a| a.index + 1).unwrap_or(0);
        self.at = Some(Running::at(index));
        self.enter_step(index, game)
    }

    /// Says so when a step held actions that nothing in the game asked about while it played.
    fn check_reads(&mut self, step: &Step, label: &str, played: u32) {
        if played < 5 || self.all_reads.is_empty() {
            return; // (too short to tell; or the game reads its input another way, per player)
        }
        let Some(reads) = self.at.as_ref().map(|a| a.reads.clone()) else {
            return;
        };
        let mut unread = Vec::new();
        for entry in step.hold.as_ref().map(OneOrMany::list).unwrap_or_default() {
            let Ok((false, name, _)) = held(&entry) else {
                continue;
            };
            if !self.actions.contains(&name) || reads.contains(&name) {
                continue;
            }
            // (its partner being read is as good: the step set both)
            let partner = self.links.iter().any(|(b, a, _)| {
                (b == &name && reads.contains(a)) || (a == &name && reads.contains(b))
            });
            if !partner {
                unread.push(name);
            }
        }
        if unread.is_empty() {
            return;
        }
        let read: Vec<&str> = reads.iter().map(String::as_str).collect();
        self.warnings.push(format!(
            "{label} held {} for {played} frames, but nothing in the game asked about {} in that time, so the hold did nothing ({}). Hold an action the code reads, or use walk_to",
            unread.join(", "),
            if unread.len() > 1 { "them" } else { "it" },
            if read.is_empty() {
                "the game read no input at all during the step: a menu, a pause or a cutscene may be up".to_string()
            } else {
                format!("it read: {}", read.join(", "))
            }
        ));
    }

    /// Whether a step holds a direction (a button that shares its keys with an axis, `left` and the like, or an axis):
    /// what moves the walker.
    fn holds_direction(&self, step: &Step) -> bool {
        if step.walk_to.is_some() || step.fight.is_some() {
            return false;
        }
        step.hold
            .as_ref()
            .map(OneOrMany::list)
            .unwrap_or_default()
            .iter()
            .any(|entry| match held(entry) {
                Ok((false, name, _)) => {
                    ["left", "right", "up", "down", "move_x", "move_y"].contains(&name.as_str())
                        || self.links.iter().any(|(b, a, _)| *b == name || *a == name)
                }
                _ => false,
            })
    }

    /// Follows the walker while a direction is held (see [`Self::check_hold`]).
    fn track_hold(&mut self, step: &Step, game: &Game) {
        if !self.holds_direction(step) {
            return;
        }
        let Ok((x, y, plane, name, _)) = game.walker(step.who.as_deref(), step.plane.as_deref())
        else {
            return;
        };
        let Some(at) = self.at.as_mut() else { return };
        let t = at.hold_track.get_or_insert_with(|| HoldTrack {
            name,
            unit: if plane == "xz" {
                "metres".into()
            } else {
                "units".into()
            },
            ..Default::default()
        });
        if let Some((lx, ly)) = t.last {
            let d = ((x - lx).powi(2) + (y - ly).powi(2)).sqrt();
            t.path += d;
            t.frames += 1;
            // (still: under a hundredth of a unit, or of a millimetre in 3D)
            if d < if plane == "xz" { 1e-3 } else { 1e-2 } {
                t.still += 1;
            }
        }
        t.last = Some((x, y));
    }

    /// Says a hold of a direction during which the walker stood still for a good part of the time, and what it stands
    /// against: a hold that "did something" but was stopped by a wall or a solid thing halfway.
    fn check_hold(&mut self, step: &Step, label: &str, game: &Game) {
        let Some(t) = self.at.as_mut().and_then(|a| a.hold_track.take()) else {
            return;
        };
        if t.frames < 6 || t.still * 4 < t.frames || t.still < 4 {
            return;
        }
        let against = match game.blocked(step.who.as_deref(), step.plane.as_deref(), None, None) {
            Some((what, _)) => format!("it is against {what}"),
            None => "nothing solid touches it: the game itself held it (a menu, a pause, a rule of its own)".to_string(),
        };
        let held = step
            .hold
            .as_ref()
            .map(OneOrMany::list)
            .unwrap_or_default()
            .join(", ");
        self.warnings.push(format!(
            "{label} held {held} for {} frames, but '{}' stood still for {} of them (it moved {} {} in all): {against}. A position you `print` or `record` after it is where it was stopped, not where the hold would have taken it",
            t.frames, t.name, t.still, short(t.path), t.unit
        ));
    }

    /// Notes what the frame did (log lines, sounds), ends an `until` step whose condition holds, and returns the captions
    /// of the pictures to take of this frame. `frame` counts from 0.
    pub fn after_frame(&mut self, frame: u32, game: &Game) -> Vec<String> {
        let number = frame + 1;
        for line in game.take_log() {
            if self.log.len() < 2000 {
                self.log.push(json!({ "frame": number, "text": line }));
            }
        }
        for line in game.take_sound_log() {
            if self.sounds.len() < 2000 {
                self.sounds.push(json!({ "frame": number, "text": line }));
            }
        }
        let reads = game.take_input_reads();
        if let Some(at) = self.at.as_mut() {
            at.reads.extend(reads.iter().cloned());
        }
        self.all_reads.extend(reads);
        if !self.setup_done {
            self.setup_done = true;
            if let Some(lua) = self.plan.lua.clone()
                && let Err(e) = game.run_lua(&lua, "lua")
            {
                self.step_errors.push(format!("the plan's lua: {e}"));
            }
            if !self.plan.overlay.is_empty()
                && let Err(e) = game.overlay(&self.plan.overlay)
            {
                self.warnings.push(format!("overlay: {e}"));
            }
        }
        if self.plan.invincible {
            self.god = game.god(self.plan.who.as_deref()).or(self.god.take());
        }
        if frame > 0 {
            self.watch(number, game);
        }
        let mut due = std::mem::take(&mut self.pictures_due);
        let playing = self.at.as_ref().map(|a| a.index);
        if let Some(index) = playing
            && let Some(flat) = self.flat.get(index)
            && frame > 0
            && !self.steps_done
        {
            let (step, label) = (flat.step.clone(), flat.label.clone());
            let length = Self::step_length(&step);
            let played = {
                let at = self.at.as_mut().expect("a step is playing");
                at.played = at.played.saturating_add(1);
                at.played
            };
            let mut ended = played >= length;
            let mut by_group = false;
            // a step that ends when something comes true: its picture is of the frame after, when the game has drawn it
            let mut on_condition = false;
            if step.walk_to.is_some() || step.fight.is_some() {
                if self.walked(index, game, ended) {
                    on_condition = !ended;
                    ended = true;
                }
            } else if let Some(cond) = &step.until {
                match game.lua_truth(cond) {
                    Ok(true) => {
                        ended = true;
                        on_condition = true;
                    }
                    Ok(false) => {
                        if ended && !step.may_time_out {
                            self.fail(&label, format!(
                                "{label}: `{cond}` never held in {length} frames, so the run went on without it (if that is expected, add \"may_time_out\": true)"
                            ));
                        }
                    }
                    Err(e) => {
                        // (a condition that cannot be worked out ends its step; the run goes on)
                        self.step_error(&label, format!("{label} until `{cond}`: {e}"));
                        ended = true;
                    }
                }
            }
            if self.check_groups(index, game) {
                ended = true;
                by_group = true;
            }
            self.track_hold(&step, game);
            if ended {
                self.check_reads(&step, &label, played);
                self.check_hold(&step, &label, game);
                if let Some(at) = self.at.as_mut() {
                    at.played = u32::MAX; // (ends the step)
                }
                if let Some(caption) = &step.capture
                    && !by_group
                {
                    if on_condition {
                        self.pictures_due.push(caption.clone());
                    } else {
                        due.push(caption.clone());
                    }
                }
                if index + 1 >= self.flat.len() {
                    self.steps_done = true;
                }
            }
        }
        if self.flat.is_empty() {
            self.steps_done = true;
        }
        if let Some(label) = self.failed.take()
            && self.plan.stop_on_fail
            && self.stopped.is_none()
        {
            // the rest of the route would play from the wrong place: stop here, with a picture of where that is
            let left = self
                .at
                .as_ref()
                .map_or(0, |a| self.flat.len().saturating_sub(a.index + 1));
            self.stopped = Some(format!(
                "the route stopped at {label}, which failed (stop_on_fail): {left} later step{} not played",
                if left == 1 { " was" } else { "s were" }
            ));
            self.steps_done = true;
            self.pictures_due.clear();
            due.push(format!("stopped: {label} failed"));
        }
        if self.plan.capture_at.contains(&number)
            || (self.plan.every > 0 && number.is_multiple_of(self.plan.every))
        {
            due.push(String::new());
        }
        if let Some(e) = game.error.as_deref()
            && self.error.is_none()
        {
            self.error = Some(e.to_string());
        }
        self.render = game.render_facts();
        due
    }

    /// Checks the `always` conditions and writes down the `record` values of the whole run and of the step playing (and
    /// the groups it is in), after frame `number`.
    fn watch(&mut self, number: u32, game: &Game) {
        let mut always: Vec<(String, String, String)> = Vec::new(); // (condition, where it was given, the step now)
        let mut record: Vec<(String, String)> = Vec::new();
        let playing = self
            .at
            .as_ref()
            .map(|a| a.index)
            .filter(|i| !self.steps_done && !self.skipped(*i));
        let now = playing
            .and_then(|i| self.flat.get(i))
            .filter(|f| f.end_of.is_none())
            .map(|f| f.label.clone());
        let list = |v: &Option<OneOrMany>| v.as_ref().map(OneOrMany::list).unwrap_or_default();
        let step_now = now.clone().unwrap_or_else(|| "after the route".to_string());
        for c in list(&self.plan.always) {
            always.push((c, "the whole run".into(), step_now.clone()));
        }
        for e in list(&self.plan.record) {
            record.push((e, "the whole run".into()));
        }
        if let (Some(i), Some(label)) = (playing, now) {
            let flat = &self.flat[i];
            for g in &flat.groups {
                let group = &self.groups[*g];
                for c in &group.always {
                    always.push((c.clone(), group.label.clone(), label.clone()));
                }
                for e in &group.record {
                    record.push((e.clone(), group.label.clone()));
                }
            }
            // (a repeated step is one place, whichever round)
            let bare = label.split(" (round ").next().unwrap_or(&label).to_string();
            for c in list(&flat.step.always) {
                always.push((c, bare.clone(), label.clone()));
            }
            for e in list(&flat.step.record) {
                record.push((e, bare.clone()));
            }
        }
        for (cond, scope, step) in always {
            let held = game.lua_truth(&cond);
            let at = match self
                .watches
                .iter()
                .position(|w| w.cond == cond && w.scope == scope)
            {
                Some(i) => i,
                None => {
                    self.watches.push(Watch {
                        cond: cond.clone(),
                        scope: scope.clone(),
                        checked: 0,
                        false_frames: 0,
                        first: None,
                        last: 0,
                        error: false,
                    });
                    self.watches.len() - 1
                }
            };
            match held {
                Ok(true) => self.watches[at].checked += 1,
                Ok(false) => {
                    let w = &mut self.watches[at];
                    w.checked += 1;
                    w.false_frames += 1;
                    w.last = number;
                    if w.first.is_none() {
                        w.first = Some((number, step.clone()));
                        let text = format!(
                            "always `{cond}` ({}) was false after frame {number}, in {step}",
                            if scope == "the whole run" {
                                "for the whole run".to_string()
                            } else {
                                format!("given on {scope}")
                            }
                        );
                        self.fail(&step, text);
                    }
                }
                Err(e) => {
                    if !std::mem::replace(&mut self.watches[at].error, true) {
                        self.step_error(
                            &step,
                            format!("always `{cond}` (frame {number}, {step}): {e}"),
                        );
                    }
                }
            }
        }
        for (expr, scope) in record {
            let value = game
                .lua_text(&expr)
                .unwrap_or_else(|e| format!("error: {e}"));
            let r = match self
                .records
                .iter()
                .position(|r| r.expr == expr && r.scope == scope)
            {
                Some(i) => &mut self.records[i],
                None => {
                    self.records.push(Record {
                        expr: expr.clone(),
                        scope: scope.clone(),
                        runs: Vec::new(),
                        frames: 0,
                    });
                    self.records.last_mut().expect("just pushed")
                }
            };
            r.frames += 1;
            match r.runs.last_mut() {
                Some(last) if last.2 == value && last.1 + 1 == number => last.1 = number,
                _ => r.runs.push((number, number, value)),
            }
        }
    }

    fn prints(&self, game: &Game) -> Vec<Value> {
        self.plan
            .print
            .iter()
            .map(|expr| {
                let value = game
                    .lua_text(expr)
                    .unwrap_or_else(|e| format!("error: {e}"));
                json!({ "expr": expr, "value": value })
            })
            .collect()
    }

    /// Where the picture of a frame goes, and notes what was on screen then.
    pub fn picture(&mut self, frame: u32, caption: &str, game: &Game) -> PathBuf {
        let number = frame + 1;
        let file = self
            .out
            .join(format!("frame-{number:05}-{}.png", self.captures.len()));
        let crop_box = self.crop_box(game);
        let mut capture = json!({
            "frame": number,
            "label": caption,
            "file": file,
            "prints": self.prints(game),
            "state": game.snapshot(),
            "render": self.render,
        });
        if self.plan.crop_to.is_some() {
            capture["box"] = crop_box;
        }
        if let Some(c) = self.view_cam {
            let r = |v: f32| (v as f64 * 1000.0).round() / 1000.0;
            capture["view"] =
                json!({ "eye": c.eye.to_array().map(r), "target": c.target.to_array().map(r) });
        }
        self.captures.push(capture);
        file
    }

    /// Writes `report.json` and returns where it is.
    pub fn finish(&mut self, frames: u32, game: &Game) -> Result<PathBuf, String> {
        if frames >= MAX_FRAMES {
            self.warnings.push(format!(
                "the run was stopped at {MAX_FRAMES} frames, the longest a run may be"
            ));
        }
        if self.plan.invincible {
            let hook = "a game can also read nova.testing.invincible (true in such a run) where it takes damage";
            match &self.god {
                Some(g) if g["pinned"].as_str().is_some_and(|p| !p.is_empty()) => self.notes.push(format!(
                    "invincible: '{}' kept {} from going down: {} writes that would have lowered it were refused as they were made, so no blow counted, however big. {hook}",
                    g["who"].as_str().unwrap_or("the walker"),
                    g["pinned"].as_str().unwrap_or(""),
                    g["restored"].as_u64().unwrap_or(0)
                )),
                Some(g) => self.warnings.push(format!(
                    "invincible did nothing to '{}': it has none of the fields hp, health, hearts, lives, life, energy as a number. Say who with \"who\", or read nova.testing.invincible in the game's own damage code (it is true in this run)",
                    g["who"].as_str().unwrap_or("the walker")
                )),
                None => self.warnings.push(format!(
                    "invincible found nobody to protect (\"who\" names the entity; left out, the one named or tagged hero or player). {hook}"
                )),
            }
        }
        for w in &self.watches {
            let place = if w.scope == "the whole run" {
                "for the whole run".to_string()
            } else {
                format!("on {}", w.scope)
            };
            if w.error {
                continue; // (said as an error)
            }
            match &w.first {
                None => self.notes.push(format!(
                    "always `{}` ({place}) held after every one of the {} frames it was checked",
                    w.cond, w.checked
                )),
                Some((first, step)) => self.warnings.push(format!(
                    "always `{}` ({place}) was false on {} of the {} frames it was checked: first after frame {first} (in {step}), last after frame {}",
                    w.cond, w.false_frames, w.checked, w.last
                )),
            }
        }
        if !self.plan.overlay.is_empty() {
            self.notes.push(format!(
                "overlay: drawn over every picture of this run: {} (hitboxes green, solid things and tiles red, names white, 2D lights yellow); 2D only",
                self.plan.overlay.join(", ")
            ));
        }
        // (the last frame's picture: framed and cropped as the others)
        self.view_camera(game);
        let end_box = self.crop_box(game);
        let report = json!({
            "frames": frames,
            "error": self.error,
            "step_errors": self.step_errors,
            "warnings": self.warnings,
            "notes": self.notes,
            "route": self.results,
            "stopped": self.stopped,
            "actions": self.actions,
            "read": self.all_reads,
            "captures": self.captures,
            "log": self.log,
            "sounds": self.sounds,
            "records": self.records.iter().map(|r| json!({
                "expr": r.expr,
                "scope": r.scope,
                // every frame, as runs of one value: [first frame, last frame, value]
                "frames": r.frames,
                "runs": r.runs.iter().map(|(a, b, v)| json!([a, b, v])).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
            "drawn": game.drawn(None, None)["counts"].clone(),
            "end": { "prints": self.prints(game), "state": game.snapshot(), "render": game.render_facts() },
            "end_box": end_box,
        });
        let path = self.out.join("report.json");
        std::fs::write(
            &path,
            serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
        Ok(path)
    }
}
