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
    /// How long the step lasts.
    pub frames: Option<u32>,
    /// The same as `frames`, for a step that holds nothing.
    pub wait: Option<u32>,
    /// A Lua expression: the step ends on the frame after which it holds.
    pub until: Option<String>,
    /// The longest an `until` step may last (600 frames when left out).
    pub max: Option<u32>,
    /// Take a picture when the step ends, with this caption.
    pub capture: Option<String>,
    /// Lua run once when the step starts.
    pub lua: Option<String>,
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
        for (i, s) in plan.steps.iter().enumerate() {
            if s.frames.is_some() && s.wait.is_some() {
                return Err(format!(
                    "{}: step {} has both \"frames\" and \"wait\": give one",
                    path.display(),
                    i + 1
                ));
            }
        }
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

struct Running {
    index: usize,
    /// Frames of the step already played.
    played: u32,
}

/// The state of a run: which step is playing and everything noted so far.
pub struct Playtest {
    plan: Plan,
    out: PathBuf,
    at: Option<Running>,
    setup_done: bool,
    steps_done: bool,
    pictures_due: Vec<String>,
    captures: Vec<Value>,
    log: Vec<Value>,
    sounds: Vec<Value>,
    warnings: Vec<String>,
    pub error: Option<String>,
    actions: Vec<String>,
}

impl Playtest {
    pub fn new(plan: Plan, fallback_out: &Path) -> Result<Self, String> {
        let out = plan.out.clone().unwrap_or_else(|| fallback_out.into());
        std::fs::create_dir_all(&out)
            .map_err(|e| format!("cannot make the folder {}: {e}", out.display()))?;
        Ok(Self {
            plan,
            out,
            at: None,
            setup_done: false,
            steps_done: false,
            pictures_due: Vec::new(),
            captures: Vec::new(),
            log: Vec::new(),
            sounds: Vec::new(),
            warnings: Vec::new(),
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
        if step.until.is_some() {
            return step.max.unwrap_or(600).max(1);
        }
        if let Some(n) = step.frames.or(step.wait) {
            return n;
        }
        if step.press.is_some() {
            return 3;
        }
        if step.hold.is_some() || step.capture.is_some() {
            return 1;
        }
        0 // (a step that only runs Lua takes no time)
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
                });
                if !self.enter_step(0, game) {
                    return;
                }
            }
            let Some((index, played)) = self.at.as_ref().map(|a| (a.index, a.played)) else {
                return;
            };
            let Some(step) = self.plan.steps.get(index).cloned() else {
                self.steps_done = true;
                return;
            };
            if played >= Self::step_length(&step) {
                // (a step of no length, or one that ended on the frame before)
                if !self.next_step(game) {
                    return;
                }
                continue;
            }
            let mut apply = |entry: &str, error: &mut Option<String>| match held(entry) {
                Ok((true, name, value)) => {
                    input.sources.insert(name, value);
                }
                Ok((false, name, value)) => {
                    input.overrides.retain(|(n, _)| *n != name);
                    input.overrides.push((name, value));
                }
                Err(e) => *error = Some(format!("step {}: {e}", index + 1)),
            };
            for entry in step.hold.as_ref().map(OneOrMany::list).unwrap_or_default() {
                apply(&entry, &mut self.error);
            }
            if played < 2 {
                for entry in step.press.as_ref().map(OneOrMany::list).unwrap_or_default() {
                    apply(&entry, &mut self.error);
                }
            }
            return;
        }
    }

    /// Runs what a step does when it starts. False when the run has to stop (its Lua failed) or the steps are over.
    fn enter_step(&mut self, index: usize, game: &Game) -> bool {
        let Some(step) = self.plan.steps.get(index).cloned() else {
            self.steps_done = true;
            return false;
        };
        let mut names = step.hold.as_ref().map(OneOrMany::list).unwrap_or_default();
        names.extend(step.press.as_ref().map(OneOrMany::list).unwrap_or_default());
        self.check_names(&names);
        if let Some(lua) = &step.lua
            && let Err(e) = game.run_lua(lua, &format!("step {}", index + 1))
        {
            self.error = Some(format!("step {} lua: {e}", index + 1));
            return false;
        }
        true
    }

    fn next_step(&mut self, game: &Game) -> bool {
        let index = self.at.as_ref().map(|a| a.index + 1).unwrap_or(0);
        self.at = Some(Running { index, played: 0 });
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
                self.error = Some(format!("lua: {e}"));
            }
        }
        let mut due = std::mem::take(&mut self.pictures_due);
        if let Some(at) = self.at.as_mut()
            && let Some(step) = self.plan.steps.get(at.index).cloned()
            && frame > 0
            && !self.steps_done
        {
            at.played += 1;
            let mut ended = at.played >= Self::step_length(&step);
            if let Some(cond) = &step.until {
                match game.lua_truth(cond) {
                    Ok(true) => {
                        at.played = u32::MAX; // (ends the step)
                        ended = true;
                    }
                    Ok(false) => {
                        if ended {
                            self.warnings.push(format!(
                                "step {}: `{cond}` never held in {} frames, so the run went on without it",
                                at.index + 1,
                                Self::step_length(&step)
                            ));
                        }
                    }
                    Err(e) => {
                        self.error = Some(format!("step {} until `{cond}`: {e}", at.index + 1));
                    }
                }
            }
            if ended {
                if let Some(caption) = &step.capture {
                    due.push(caption.clone());
                }
                if at.index + 1 >= self.plan.steps.len() {
                    self.steps_done = true;
                }
            }
        }
        if self.plan.steps.is_empty() {
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
            "warnings": self.warnings,
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
