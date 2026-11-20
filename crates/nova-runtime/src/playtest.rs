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
//!   of a 3D game): see `Walk`.
//! - `"may_time_out": true` on an `until` (or a `walk_to`, or a group) says that running out of time is expected: no warning.
//!
//! A step whose Lua fails (`lua`, `until`) is written down with its step number in the report's `step_errors` and the run
//! goes on, so the pictures and values after it are still there. Only an error of the game itself stops a run.

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
    /// Steer an entity to this point: `[x, y]` in a 2D game, `[x, z]` on the ground of a 3D one.
    pub walk_to: Option<[f64; 2]>,
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
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    #[serde(default)]
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
}

impl Plan {
    pub fn from_file(path: &Path) -> Result<Plan, String> {
        let text = std::fs::read_to_string(path)
            .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        let plan: Plan = serde_json::from_str(&text).map_err(|e| {
            format!(
                "{}: not a play plan: {e} (a plan is {{ \"steps\": [ {{ \"hold\": [\"right\"], \"frames\": 40 }}, {{ \"press\": \"a\" }}, {{ \"wait\": 20, \"capture\": \"after\" }} ], \"capture_at\": [1, 60] }})",
                path.display()
            )
        })?;
        unroll(&plan.steps).map_err(|e| format!("{}: {e}", path.display()))?;
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
            {
                return Err(format!(
                    "{label} is a group (it has \"steps\"), which takes only \"repeat\", \"until\", \"may_time_out\" and \"capture\": put the rest in its steps"
                ));
            }
            let rounds = s.repeat.unwrap_or(if s.until.is_some() { 100 } else { 1 });
            let id = groups.len();
            groups.push(Group {
                until: s.until.clone(),
                quiet: s.may_time_out,
                rounds,
                done: false,
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
            {
                return Err(format!(
                    "{label} has \"tap_every\" but no length: give \"frames\" or \"until\""
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

/// A `walk_to` step under way. Each frame it points the movement actions at the target and afterwards looks at how the
/// walker really moved. It does not assume that "stick right" is +x: it keeps an estimate of the turn between the stick
/// and the ground (`theta`), which starts at none (right is +x, down on the stick is +y in 2D or +z in 3D) and is put
/// right from the measured movement whenever that disagrees by more than 20 degrees for three frames running. That is
/// what makes it work with a stick that is relative to a turned camera. If correcting the turn keeps failing, it tries
/// the mirror image. It walks in a straight line (no path finding) and gives up when it stops getting nearer.
///
/// It drives the axes `move_x`, `move_y` and the buttons `left`, `right`, `up`, `down` together (those the game has; a
/// step's `axes` and `dirs` name others), because it cannot know which of them the game's code reads.
#[derive(Default)]
struct Walk {
    theta: f64,
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
}

const WALK_STUCK_FRAMES: u32 = 120;
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

struct Running {
    index: usize,
    /// Frames of the step already played.
    played: u32,
    walk: Walk,
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
    /// Steps whose own Lua failed (the run went on).
    pub step_errors: Vec<String>,
    /// What stopped the run: an error of the game itself.
    pub error: Option<String>,
    actions: Vec<String>,
}

impl Playtest {
    pub fn new(plan: Plan, fallback_out: &Path) -> Result<Self, String> {
        let out = plan.out.clone().unwrap_or_else(|| fallback_out.into());
        std::fs::create_dir_all(&out)
            .map_err(|e| format!("cannot make the folder {}: {e}", out.display()))?;
        let (flat, groups) = unroll(&plan.steps)?;
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
            step_errors: Vec::new(),
            error: None,
            actions: Vec::new(),
        })
    }

    pub fn seed(&self) -> Option<u64> {
        self.plan.seed
    }

    pub fn start_scene(&self) -> Option<&str> {
        self.plan.start_scene.as_deref()
    }

    /// Whether the run is over once `done` frames have been played.
    pub fn finished(&self, done: u32) -> bool {
        self.error.is_some()
            || done >= MAX_FRAMES
            || (self.steps_done
                && done >= self.plan.frames.unwrap_or(0)
                && self.plan.capture_at.iter().all(|f| *f <= done)
                && done >= 1)
    }

    fn step_length(step: &Step) -> u32 {
        if step.until.is_some() || step.walk_to.is_some() {
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
                    self.step_errors.push(format!(
                        "{}: the group's until `{cond}`: {e}",
                        self.flat[index].label
                    ));
                }
            }
        }
        ended
    }

    /// Points the movement actions of a `walk_to` step at its target.
    fn steer(&mut self, index: usize, game: &Game, input: &mut InputFrame) {
        let Some(flat) = self.flat.get(index) else {
            return;
        };
        let (step, label) = (flat.step.clone(), flat.label.clone());
        let Some(target) = step.walk_to else {
            return;
        };
        let Some(at) = self.at.as_mut() else {
            return;
        };
        let walk = &mut at.walk;
        if walk.over {
            return;
        }
        let (x, y, plane, who) = match game.walker(step.who.as_deref(), step.plane.as_deref()) {
            Ok(w) => w,
            Err(e) => {
                walk.over = true;
                self.step_errors.push(format!("{label} walk_to: {e}"));
                return;
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
        if !walk.started {
            walk.started = true;
            if !use_axes && !use_dirs {
                walk.over = true;
                self.step_errors.push(format!(
                    "{label} walk_to: this game has neither the axes {} nor the buttons {} (its actions: {}); name the ones that move '{who}' with \"axes\": [x, y] or \"dirs\": [left, right, up, down]",
                    axes.join(", "),
                    dirs.join(", "),
                    self.actions.join(", ")
                ));
                return;
            }
            let mut driven = Vec::new();
            if use_axes {
                driven.extend(axes.iter().cloned());
            }
            if use_dirs {
                driven.extend(dirs.iter().cloned());
            }
            let note = format!(
                "walk_to steers '{who}' in the {} plane by driving {} each frame and measuring how it really moved (so a camera-relative stick works); it walks straight, without path finding",
                if plane == "xz" { "x, z" } else { "x, y" },
                driven.join(", ")
            );
            if !self.notes.contains(&note) {
                self.notes.push(note);
            }
        }
        let (dx, dy) = (target[0] - x, target[1] - y);
        let dist = (dx * dx + dy * dy).sqrt();
        let radius = step
            .radius
            .unwrap_or(if plane == "xz" { 0.5 } else { 12.0 });
        if dist <= radius {
            walk.before = None;
            return; // (there: the step ends after this frame)
        }
        let (ux, uy) = (dx / dist, dy / dist);
        let (c, s) = (walk.theta.cos(), walk.theta.sin());
        let stick = (ux * c + uy * s, -ux * s + uy * c);
        walk.before = Some(((x, y), stick));
        let (sx, sy) = if walk.mirror {
            (stick.0, -stick.1)
        } else {
            stick
        };
        let mut set = |name: &String, value: f64| {
            input.overrides.retain(|(n, _)| n != name);
            input.overrides.push((name.clone(), value as f32));
        };
        if use_axes {
            set(&axes[0], sx);
            set(&axes[1], sy);
        }
        if use_dirs {
            // (eight directions: a button is down when the stick leans more than 22.5 degrees its way)
            const LEAN: f64 = 0.383;
            for (name, on) in [
                (&dirs[0], sx < -LEAN),
                (&dirs[1], sx > LEAN),
                (&dirs[2], sy < -LEAN),
                (&dirs[3], sy > LEAN),
            ] {
                if on {
                    set(name, 1.0);
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
        let Some(target) = step.walk_to else {
            return false;
        };
        let Some(at) = self.at.as_mut() else {
            return true;
        };
        let walk = &mut at.walk;
        if walk.over {
            return true;
        }
        let Ok((x, y, plane, who)) = game.walker(step.who.as_deref(), step.plane.as_deref()) else {
            walk.over = true;
            self.step_errors.push(format!(
                "{label} walk_to: the walker is gone (destroyed, or the scene changed)"
            ));
            return true;
        };
        let radius = step
            .radius
            .unwrap_or(if plane == "xz" { 0.5 } else { 12.0 });
        let dist = ((target[0] - x).powi(2) + (target[1] - y).powi(2)).sqrt();
        if dist <= radius {
            walk.over = true;
            return true;
        }
        if let Some(((px, py), (sx, sy))) = walk.before {
            let (vx, vy) = (x - px, y - py);
            let speed = (vx * vx + vy * vy).sqrt();
            walk.top_speed = walk.top_speed.max(speed);
            if speed > 1e-6 && speed >= walk.top_speed * 0.5 {
                let measured = wrap(vy.atan2(vx) - sy.atan2(sx));
                if wrap(measured - walk.theta).abs() > WALK_DEADBAND {
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
                            walk.theta = measured;
                        }
                    }
                } else {
                    walk.off = 0;
                }
            }
        }
        let gain = (radius * 0.25).max(1e-3);
        if walk.best == 0.0 || dist < walk.best - gain {
            walk.best = dist;
            walk.since_best = 0;
            walk.corrections = 0;
        } else {
            walk.since_best += 1;
        }
        let place = format!(
            "'{who}' is at {}, {}, {} from [{}, {}]",
            short(x),
            short(y),
            short(dist),
            short(target[0]),
            short(target[1])
        );
        if walk.since_best >= WALK_STUCK_FRAMES {
            walk.over = true;
            if !step.may_time_out {
                self.warnings.push(format!(
                    "{label}: walk_to stopped getting nearer for {WALK_STUCK_FRAMES} frames and gave up: {place} (something solid is in the way, since it walks straight: go round with two walk_to steps; or the actions it drives do not move '{who}')"
                ));
            }
            return true;
        }
        if last_frame && !step.may_time_out {
            self.warnings.push(format!(
                "{label}: walk_to did not arrive in {} frames: {place} (give it a bigger \"max\")",
                Self::step_length(&step)
            ));
        }
        false
    }

    /// Moves to the step that plays on this frame (running the Lua of steps on the way) and adds what it holds to `input`.
    /// `frame` counts from 0.
    pub fn before_frame(&mut self, frame: u32, game: &Game, input: &mut InputFrame) {
        if self.actions.is_empty() {
            self.actions = game.action_names();
        }
        if frame == 0 || self.steps_done || self.error.is_some() {
            return; // frame 1 is the scene coming up
        }
        loop {
            if self.at.is_none() {
                self.at = Some(Running {
                    index: 0,
                    played: 0,
                    walk: Walk::default(),
                });
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
            let mut apply = |entry: &str, errors: &mut Vec<String>| match held(entry) {
                Ok((true, name, value)) => {
                    input.sources.insert(name, value);
                }
                Ok((false, name, value)) => {
                    input.overrides.retain(|(n, _)| *n != name);
                    input.overrides.push((name, value));
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
            if step.walk_to.is_some() {
                self.steer(index, game, input);
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
                self.warnings.push(format!(
                    "{label}: `{cond}` never held in {} rounds of the group, so the run went on without it",
                    group.rounds
                ));
            }
            return true;
        }
        let mut names = step.hold.as_ref().map(OneOrMany::list).unwrap_or_default();
        names.extend(step.press.as_ref().map(OneOrMany::list).unwrap_or_default());
        names.extend(step.tap.as_ref().map(OneOrMany::list).unwrap_or_default());
        self.check_names(&names);
        if let Some(lua) = &step.lua
            && let Err(e) = game.run_lua(lua, &label)
        {
            self.step_errors.push(format!("{label} lua: {e}"));
        }
        true
    }

    fn next_step(&mut self, game: &Game) -> bool {
        let index = self.at.as_ref().map(|a| a.index + 1).unwrap_or(0);
        self.at = Some(Running {
            index,
            played: 0,
            walk: Walk::default(),
        });
        self.enter_step(index, game)
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
        if !self.setup_done {
            self.setup_done = true;
            if let Some(lua) = self.plan.lua.clone()
                && let Err(e) = game.run_lua(&lua, "lua")
            {
                self.step_errors.push(format!("the plan's lua: {e}"));
            }
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
            if step.walk_to.is_some() {
                if self.walked(index, game, ended) {
                    ended = true;
                }
            } else if let Some(cond) = &step.until {
                match game.lua_truth(cond) {
                    Ok(true) => ended = true,
                    Ok(false) => {
                        if ended && !step.may_time_out {
                            self.warnings.push(format!(
                                "{label}: `{cond}` never held in {length} frames, so the run went on without it (if that is expected, add \"may_time_out\": true)"
                            ));
                        }
                    }
                    Err(e) => {
                        // (a condition that cannot be worked out ends its step; the run goes on)
                        self.step_errors
                            .push(format!("{label} until `{cond}`: {e}"));
                        ended = true;
                    }
                }
            }
            if self.check_groups(index, game) {
                ended = true;
                by_group = true;
            }
            if ended {
                if let Some(at) = self.at.as_mut() {
                    at.played = u32::MAX; // (ends the step)
                }
                if let Some(caption) = &step.capture
                    && !by_group
                {
                    due.push(caption.clone());
                }
                if index + 1 >= self.flat.len() {
                    self.steps_done = true;
                }
            }
        }
        if self.flat.is_empty() {
            self.steps_done = true;
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
        due
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
        self.captures.push(json!({
            "frame": number,
            "label": caption,
            "file": file,
            "prints": self.prints(game),
            "state": game.snapshot(),
        }));
        file
    }

    /// Writes `report.json` and returns where it is.
    pub fn finish(&mut self, frames: u32, game: &Game) -> Result<PathBuf, String> {
        if frames >= MAX_FRAMES {
            self.warnings.push(format!(
                "the run was stopped at {MAX_FRAMES} frames, the longest a run may be"
            ));
        }
        let report = json!({
            "frames": frames,
            "error": self.error,
            "step_errors": self.step_errors,
            "warnings": self.warnings,
            "notes": self.notes,
            "actions": self.actions,
            "captures": self.captures,
            "log": self.log,
            "sounds": self.sounds,
            "end": { "prints": self.prints(game), "state": game.snapshot() },
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
