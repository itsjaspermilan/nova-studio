//! Recorded input: what was held and where the pointer was, frame by frame, as a small JSON file that plays back the same
//! way every time (`nova run --headless --input play.json`, and in tests), and that a real session can write
//! (`nova run --record play.json`).
//!
//! A script is a list of events. An event starts at frame `at`, lasts `for` frames (1 if left out) and says what is held
//! (`hold`: source id to value, like `{"key:KeyW": 1}`) and, if it has one, the pointer (`pointer`). Everything in an event
//! applies on every frame it covers, a pointer's `dx`, `dy`, `wheel` and `pressed` too, so a mouse that is pushed along
//! for ten frames is an event with `for: 10` and a `dx`. Events that overlap add up: a source takes the biggest value,
//! and the pointer comes from the latest event that has one.
//!
//! ```json
//! [
//!   { "at": 0,  "for": 300, "hold": { "key:KeyW": 1 } },
//!   { "at": 20, "for": 1,   "pointer": { "x": 640, "y": 360, "pressed": true, "down": true } },
//!   { "at": 21, "for": 30,  "pointer": { "x": 640, "y": 360, "dx": 4, "down": true } }
//! ]
//! ```

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::actions::{InputFrame, PointerFrame};

fn one() -> u32 {
    1
}

fn is_one(n: &u32) -> bool {
    *n == 1
}

fn is_false(b: &bool) -> bool {
    !*b
}

fn is_zero(v: &f32) -> bool {
    *v == 0.0
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct PointerEvent {
    #[serde(skip_serializing_if = "is_false")]
    pub absent: bool,
    #[serde(skip_serializing_if = "is_zero")]
    pub x: f32,
    #[serde(skip_serializing_if = "is_zero")]
    pub y: f32,
    #[serde(skip_serializing_if = "is_zero")]
    pub dx: f32,
    #[serde(skip_serializing_if = "is_zero")]
    pub dy: f32,
    #[serde(skip_serializing_if = "is_false")]
    pub down: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub right: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub middle: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub pressed: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub released: bool,
    #[serde(skip_serializing_if = "is_zero")]
    pub wheel: f32,
}

impl PointerEvent {
    fn to_frame(&self) -> PointerFrame {
        PointerFrame {
            present: !self.absent,
            x: self.x,
            y: self.y,
            dx: self.dx,
            dy: self.dy,
            down: self.down,
            right: self.right,
            middle: self.middle,
            pressed: self.pressed,
            released: self.released,
            wheel: self.wheel,
        }
    }

    fn from_frame(p: &PointerFrame) -> Self {
        Self {
            absent: !p.present,
            x: p.x,
            y: p.y,
            dx: p.dx,
            dy: p.dy,
            down: p.down,
            right: p.right,
            middle: p.middle,
            pressed: p.pressed,
            released: p.released,
            wheel: p.wheel,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub at: u32,
    #[serde(rename = "for", default = "one", skip_serializing_if = "is_one")]
    pub frames: u32,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub hold: BTreeMap<String, f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pointer: Option<PointerEvent>,
}

#[derive(Clone, Debug, Default)]
pub struct InputScript {
    pub events: Vec<Event>,
}

impl InputScript {
    pub fn parse(text: &str) -> Result<Self, String> {
        let events: Vec<Event> =
            serde_json::from_str(text).map_err(|e| format!("not a recorded-input file: {e}"))?;
        for (i, e) in events.iter().enumerate() {
            if e.frames == 0 {
                return Err(format!(
                    "event {} (at frame {}) lasts 0 frames: \"for\" must be at least 1",
                    i + 1,
                    e.at
                ));
            }
        }
        Ok(Self { events })
    }

    pub fn from_file(path: &std::path::Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(path)
            .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        Self::parse(&text).map_err(|e| format!("{}: {e}", path.display()))
    }

    /// The frame after the last event ends: how long the script runs.
    pub fn length(&self) -> u32 {
        self.events
            .iter()
            .map(|e| e.at + e.frames)
            .max()
            .unwrap_or(0)
    }

    /// The input of frame `n`.
    pub fn frame(&self, n: u32) -> InputFrame {
        let mut sources: HashMap<String, f32> = HashMap::new();
        let mut pointer = PointerFrame::default();
        for e in &self.events {
            if n < e.at || n >= e.at + e.frames {
                continue;
            }
            for (k, v) in &e.hold {
                let slot = sources.entry(k.clone()).or_insert(*v);
                if v.abs() > slot.abs() {
                    *slot = *v;
                }
            }
            if let Some(p) = &e.pointer {
                pointer = p.to_frame();
            }
        }
        InputFrame {
            sources,
            pointer,
            ..Default::default()
        }
    }
}

/// Writes down the input of a session, a frame at a time, as a script.
#[derive(Default)]
pub struct Recorder {
    frames: Vec<(HashMap<String, f32>, PointerFrame)>,
}

impl Recorder {
    pub fn push(&mut self, frame: &InputFrame) {
        // actions forced by --hold are not input; only what was physically held and where the pointer was
        self.frames.push((frame.sources.clone(), frame.pointer));
    }

    pub fn frames(&self) -> usize {
        self.frames.len()
    }

    /// The session as a script: runs of equal frames become one event, and frames with nothing in them are left out.
    pub fn to_json(&self) -> String {
        let mut events: Vec<Event> = Vec::new();
        let mut i = 0;
        while i < self.frames.len() {
            let (sources, pointer) = &self.frames[i];
            let mut j = i + 1;
            while j < self.frames.len() && self.frames[j] == self.frames[i] {
                j += 1;
            }
            let empty_pointer = *pointer == PointerFrame::default();
            if !sources.is_empty() || !empty_pointer {
                events.push(Event {
                    at: i as u32,
                    frames: (j - i) as u32,
                    hold: sources.iter().map(|(k, v)| (k.clone(), *v)).collect(),
                    pointer: (!empty_pointer).then(|| PointerEvent::from_frame(pointer)),
                });
            }
            i = j;
        }
        serde_json::to_string_pretty(&events).expect("events serialise") + "\n"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_hold_sources_for_their_frames_and_overlaps_add_up() {
        let s = InputScript::parse(
            r#"[
                { "at": 2, "for": 3, "hold": { "key:KeyW": 1 } },
                { "at": 3, "hold": { "key:KeyW": 0.5, "key:Space": 1 } },
                { "at": 4, "for": 2, "pointer": { "x": 10, "y": 20, "dx": 3, "pressed": true } }
            ]"#,
        )
        .unwrap();
        assert_eq!(s.length(), 6);
        assert!(s.frame(1).sources.is_empty());
        assert_eq!(s.frame(2).sources["key:KeyW"], 1.0);
        let f3 = s.frame(3);
        assert_eq!(f3.sources["key:KeyW"], 1.0, "the bigger value wins");
        assert_eq!(f3.sources["key:Space"], 1.0);
        let f4 = s.frame(4);
        assert!(f4.pointer.present && f4.pointer.pressed);
        assert_eq!(
            (f4.pointer.x, f4.pointer.y, f4.pointer.dx),
            (10.0, 20.0, 3.0)
        );
        assert!(
            s.frame(5).pointer.pressed,
            "a pointer event applies on every frame it covers"
        );
        assert!(s.frame(6).sources.is_empty());
        assert!(
            !s.frame(6).pointer.present,
            "no pointer when no event has one"
        );
    }

    #[test]
    fn mistakes_are_named() {
        assert!(
            InputScript::parse("{")
                .unwrap_err()
                .contains("recorded-input")
        );
        assert!(
            InputScript::parse(r#"[{"at": 1, "for": 0}]"#)
                .unwrap_err()
                .contains("at least 1")
        );
        assert!(
            InputScript::parse(r#"[{"at": 1, "nonsense": true}]"#).is_err(),
            "unknown fields are refused"
        );
    }

    #[test]
    fn a_recording_plays_back_as_the_session_was() {
        let mut rec = Recorder::default();
        let mut frames = Vec::new();
        for n in 0..40u32 {
            let mut f = InputFrame::default();
            if (5..20).contains(&n) {
                f.sources.insert("key:KeyW".into(), 1.0);
            }
            if n == 10 {
                f.pointer = PointerFrame {
                    present: true,
                    x: 100.0,
                    y: 50.0,
                    pressed: true,
                    down: true,
                    ..Default::default()
                };
            }
            if (11..15).contains(&n) {
                f.pointer = PointerFrame {
                    present: true,
                    x: 104.0,
                    y: 50.0,
                    dx: 1.0,
                    down: true,
                    ..Default::default()
                };
            }
            rec.push(&f);
            frames.push(f);
        }
        let json = rec.to_json();
        assert!(
            json.matches("\"at\"").count() <= 5,
            "equal frames are one event: {json}"
        );
        let back = InputScript::parse(&json).unwrap();
        for (n, f) in frames.iter().enumerate() {
            let g = back.frame(n as u32);
            assert_eq!(f.sources, g.sources, "frame {n}");
            assert_eq!(f.pointer, g.pointer, "frame {n}");
        }
    }
}
