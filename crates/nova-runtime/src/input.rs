//! Platform input: keyboard, touch and gamepad, reported as *sources* (see `actions.rs`).
//!
//! Games never see this layer directly; project bindings turn sources into named actions.
//! Android gamepad buttons arrive as winit key events carrying native key codes. Analogue sticks,
//! triggers and the d-pad hat arrive as `AxisMotion` events from the patched winit in `vendor/winit`
//! (stock winit drops them), with Android axis codes; `native_axis_sources` turns those into Nova's
//! sources. On desktop `gilrs` provides everything.

use std::collections::{HashMap, HashSet};

use winit::event::{ElementState, KeyEvent, TouchPhase};
use winit::keyboard::{KeyCode, NativeKeyCode, PhysicalKey};

use crate::actions::{DOWN_THRESHOLD, Sources};

/// The four original actions as plain values. Kept for the benchmark scene and the
/// compatibility entry point `Game::update`.
#[derive(Default, Clone, Copy, Debug, PartialEq)]
pub struct Actions {
    pub steer: f32,
    pub throttle: f32,
    pub brake: f32,
    pub action: bool,
}

impl Actions {
    /// True when no action is held.
    pub fn is_empty(&self) -> bool {
        *self == Actions::default()
    }
}

#[derive(Default)]
pub struct Input {
    keys: HashSet<KeyCode>,
    native: HashSet<u32>,
    /// Latest value of each Android motion axis from a game controller, by axis code.
    native_axes: HashMap<u32, f32>,
    touches: HashMap<u64, ([f32; 2], [f32; 2])>,
    width: f32,
    #[cfg(not(target_os = "android"))]
    pad: Option<gilrs::Gilrs>,
    previous_active: HashSet<String>,
    /// The source that most recently went down (for "press a key to bind" screens).
    pub last_new_source: Option<String>,
    pub last_unknown_key: Option<String>,
    hud_toggle: bool,
}

/// Sticks inside this much of centre read as zero.
const STICK_DEADZONE: f32 = 0.12;

/// Android motion axes (the `AMOTION_EVENT_AXIS_*` codes) from a game controller as Nova sources: `axis:left_x`, `axis:left_y`,
/// `axis:right_x`, `axis:right_y` (right and down positive), `axis:l2` and `axis:r2` (0 to 1), and the d-pad hat as `pad:dpad_*`.
/// Controllers differ in which axes carry the right stick (Z and RZ, or RX and RY) and the triggers (LTRIGGER and RTRIGGER, or
/// BRAKE and GAS); whichever moves furthest is used.
pub fn native_axis_sources(axes: &HashMap<u32, f32>) -> Vec<(String, f32)> {
    const X: u32 = 0;
    const Y: u32 = 1;
    const Z: u32 = 11;
    const RX: u32 = 12;
    const RY: u32 = 13;
    const RZ: u32 = 14;
    const HAT_X: u32 = 15;
    const HAT_Y: u32 = 16;
    const LT: u32 = 17;
    const RT: u32 = 18;
    const GAS: u32 = 22;
    const BRAKE: u32 = 23;
    let get = |code: u32| axes.get(&code).copied().unwrap_or(0.0);
    let bigger = |a: f32, b: f32| if a.abs() >= b.abs() { a } else { b };
    let dead = |v: f32| {
        if v.abs() < STICK_DEADZONE {
            0.0
        } else {
            v.clamp(-1.0, 1.0)
        }
    };
    let mut out = vec![
        ("axis:left_x".to_string(), dead(get(X))),
        ("axis:left_y".to_string(), dead(get(Y))),
        ("axis:right_x".to_string(), dead(bigger(get(RX), get(Z)))),
        ("axis:right_y".to_string(), dead(bigger(get(RY), get(RZ)))),
        (
            "axis:l2".to_string(),
            get(LT).max(get(BRAKE)).clamp(0.0, 1.0),
        ),
        ("axis:r2".to_string(), get(RT).max(get(GAS)).clamp(0.0, 1.0)),
    ];
    for (name, held) in [
        ("dpad_left", get(HAT_X) < -0.5),
        ("dpad_right", get(HAT_X) > 0.5),
        ("dpad_up", get(HAT_Y) < -0.5),
        ("dpad_down", get(HAT_Y) > 0.5),
    ] {
        if held {
            out.push((format!("pad:{name}"), 1.0));
        }
    }
    out
}

/// Android `KeyEvent` codes for game controllers and the D-pad.
fn native_pad_name(code: u32) -> Option<&'static str> {
    Some(match code {
        19 => "dpad_up",
        20 => "dpad_down",
        21 => "dpad_left",
        22 => "dpad_right",
        96 => "south",
        97 => "east",
        99 => "west",
        100 => "north",
        102 => "l1",
        103 => "r1",
        104 => "l2",
        105 => "r2",
        106 => "thumb_l",
        107 => "thumb_r",
        108 => "start",
        109 => "select",
        _ => return None,
    })
}

impl Input {
    pub fn new() -> Self {
        Self {
            #[cfg(not(target_os = "android"))]
            pad: gilrs::Gilrs::new()
                .map_err(|e| log::warn!("gamepad support unavailable: {e}"))
                .ok(),
            ..Default::default()
        }
    }

    /// True once after F3 is pressed.
    pub fn take_toggle_hud(&mut self) -> bool {
        std::mem::take(&mut self.hud_toggle)
    }

    pub fn set_surface_width(&mut self, width: f32) {
        self.width = width;
    }

    pub fn key(&mut self, event: &KeyEvent) {
        let down = event.state == ElementState::Pressed;
        match event.physical_key {
            PhysicalKey::Code(code) => {
                if down && code == KeyCode::F3 && !event.repeat {
                    self.hud_toggle = true;
                }
                if down {
                    self.keys.insert(code);
                } else {
                    self.keys.remove(&code);
                }
            }
            PhysicalKey::Unidentified(NativeKeyCode::Android(code)) => {
                if down {
                    if self.native.insert(code) {
                        log::info!("native key down: {code}");
                    }
                } else {
                    self.native.remove(&code);
                }
            }
            PhysicalKey::Unidentified(other) => {
                self.last_unknown_key = Some(format!("{other:?}"));
            }
        }
    }

    /// A controller's motion axis changed (Android axis code and value).
    pub fn native_axis(&mut self, code: u32, value: f32) {
        self.native_axes.insert(code, value);
    }

    pub fn touch(&mut self, id: u64, phase: TouchPhase, x: f32, y: f32) {
        match phase {
            TouchPhase::Started => {
                self.touches.insert(id, ([x, y], [x, y]));
            }
            TouchPhase::Moved => {
                if let Some(t) = self.touches.get_mut(&id) {
                    t.1 = [x, y];
                }
            }
            TouchPhase::Ended | TouchPhase::Cancelled => {
                self.touches.remove(&id);
            }
        }
    }

    /// Everything held right now. Call once per frame.
    pub fn sources(&mut self) -> Sources {
        let mut s = Sources::new();
        for code in &self.keys {
            s.insert(format!("key:{code:?}"), 1.0);
        }
        for code in &self.native {
            if let Some(name) = native_pad_name(*code) {
                s.insert(format!("pad:{name}"), 1.0);
            }
        }
        for (name, value) in native_axis_sources(&self.native_axes) {
            if value != 0.0 {
                s.insert(name, value);
            }
        }
        // Touch: the left half is a steering area (dragging sideways or up and down), the
        // right half is a button.
        let drag_range = (self.width * 0.12).max(1.0);
        for (start, current) in self.touches.values() {
            if start[0] < self.width * 0.5 {
                s.insert("touch:left".into(), 1.0);
                let dx = ((current[0] - start[0]) / drag_range).clamp(-1.0, 1.0);
                let dy = ((current[1] - start[1]) / drag_range).clamp(-1.0, 1.0);
                // With several fingers on the left half, the biggest push wins.
                for (id, v) in [("touch:drag_x", dx), ("touch:drag_y", dy)] {
                    let entry = s.entry(id.to_string()).or_insert(0.0);
                    if v.abs() > entry.abs() {
                        *entry = v;
                    }
                }
            } else {
                s.insert("touch:right".into(), 1.0);
            }
        }

        #[cfg(not(target_os = "android"))]
        if let Some(pad) = self.pad.as_mut() {
            while pad.next_event().is_some() {}
            if let Some((_, gamepad)) = pad.gamepads().next() {
                use gilrs::{Axis, Button};
                const BUTTONS: [(Button, &str); 16] = [
                    (Button::South, "south"),
                    (Button::East, "east"),
                    (Button::West, "west"),
                    (Button::North, "north"),
                    (Button::LeftTrigger, "l1"),
                    (Button::RightTrigger, "r1"),
                    (Button::LeftTrigger2, "l2"),
                    (Button::RightTrigger2, "r2"),
                    (Button::Start, "start"),
                    (Button::Select, "select"),
                    (Button::LeftThumb, "thumb_l"),
                    (Button::RightThumb, "thumb_r"),
                    (Button::DPadUp, "dpad_up"),
                    (Button::DPadDown, "dpad_down"),
                    (Button::DPadLeft, "dpad_left"),
                    (Button::DPadRight, "dpad_right"),
                ];
                for (button, name) in BUTTONS {
                    if gamepad.is_pressed(button) {
                        s.insert(format!("pad:{name}"), 1.0);
                    }
                }
                // gilrs reports stick up as positive; Nova's axes are right and down positive.
                s.insert("axis:left_x".into(), gamepad.value(Axis::LeftStickX));
                s.insert("axis:left_y".into(), -gamepad.value(Axis::LeftStickY));
                s.insert("axis:right_x".into(), gamepad.value(Axis::RightStickX));
                s.insert("axis:right_y".into(), -gamepad.value(Axis::RightStickY));
                for (button, name) in [(Button::LeftTrigger2, "l2"), (Button::RightTrigger2, "r2")]
                {
                    let v = gamepad.button_data(button).map_or(0.0, |d| d.value());
                    s.insert(format!("axis:{name}"), v);
                }
            }
        }

        let active: HashSet<String> = s
            .iter()
            .filter(|(_, v)| v.abs() >= DOWN_THRESHOLD)
            .map(|(k, _)| k.clone())
            .collect();
        let mut fresh: Vec<&String> = active.difference(&self.previous_active).collect();
        fresh.sort();
        if let Some(first) = fresh.first() {
            self.last_new_source = Some((*first).clone());
        }
        self.previous_active = active;
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn android_native_codes_map_to_gamepad_buttons() {
        for (code, name) in [
            (96, "south"),
            (97, "east"),
            (99, "west"),
            (100, "north"),
            (108, "start"),
            (21, "dpad_left"),
        ] {
            assert_eq!(native_pad_name(code), Some(name));
        }
        assert_eq!(native_pad_name(4), None, "BACK is not a gamepad button");
    }

    fn axes(list: &[(u32, f32)]) -> HashMap<u32, f32> {
        list.iter().copied().collect()
    }
    fn source(list: &[(String, f32)], name: &str) -> f32 {
        list.iter()
            .find(|(n, _)| n == name)
            .map_or(0.0, |(_, v)| *v)
    }

    #[test]
    fn sticks_map_to_axes_with_a_dead_zone() {
        let s = native_axis_sources(&axes(&[(0, 0.8), (1, -0.5), (11, 0.05), (14, -1.0)]));
        assert_eq!(source(&s, "axis:left_x"), 0.8);
        assert_eq!(source(&s, "axis:left_y"), -0.5);
        assert_eq!(source(&s, "axis:right_x"), 0.0, "inside the dead zone");
        assert_eq!(source(&s, "axis:right_y"), -1.0);
        let still = native_axis_sources(&axes(&[(0, 0.1), (1, -0.11)]));
        assert!(still.iter().all(|(_, v)| *v == 0.0));
    }

    #[test]
    fn controllers_that_use_other_axes_for_the_right_stick_and_triggers_still_work() {
        // RX/RY instead of Z/RZ, BRAKE/GAS instead of the triggers
        let s = native_axis_sources(&axes(&[(12, 0.6), (13, -0.7), (23, 0.4), (22, 1.0)]));
        assert_eq!(source(&s, "axis:right_x"), 0.6);
        assert_eq!(source(&s, "axis:right_y"), -0.7);
        assert_eq!(source(&s, "axis:l2"), 0.4);
        assert_eq!(source(&s, "axis:r2"), 1.0);
        // when both pairs report, the one that moved furthest wins
        let both = native_axis_sources(&axes(&[(11, 0.2), (12, -0.9), (17, 0.3), (23, 0.8)]));
        assert_eq!(source(&both, "axis:right_x"), -0.9);
        assert_eq!(source(&both, "axis:l2"), 0.8);
        // triggers never go below zero or above one
        let wild = native_axis_sources(&axes(&[(17, -0.5), (18, 3.0)]));
        assert_eq!(
            (source(&wild, "axis:l2"), source(&wild, "axis:r2")),
            (0.0, 1.0)
        );
    }

    #[test]
    fn the_hat_is_a_dpad() {
        let s = native_axis_sources(&axes(&[(15, -1.0), (16, 1.0)]));
        assert_eq!(source(&s, "pad:dpad_left"), 1.0);
        assert_eq!(source(&s, "pad:dpad_down"), 1.0);
        assert!(
            s.iter()
                .all(|(n, _)| n != "pad:dpad_right" && n != "pad:dpad_up")
        );
        assert!(
            native_axis_sources(&axes(&[(15, 0.0), (16, 0.2)]))
                .iter()
                .all(|(n, _)| !n.starts_with("pad:"))
        );
    }

    #[test]
    fn axis_events_reach_the_sources_and_release_when_the_stick_centres() {
        let mut input = Input::default();
        input.native_axis(0, 1.0);
        input.native_axis(18, 0.9);
        let s = input.sources();
        assert_eq!(s["axis:left_x"], 1.0);
        assert_eq!(s["axis:r2"], 0.9);
        assert_eq!(input.last_new_source.as_deref(), Some("axis:left_x"));
        input.native_axis(0, 0.0);
        input.native_axis(18, 0.0);
        assert!(!input.sources().contains_key("axis:left_x"));
    }

    #[test]
    fn touch_halves_and_drags_become_sources() {
        let mut input = Input {
            width: 1000.0,
            ..Default::default()
        };
        input.touch(1, TouchPhase::Started, 100.0, 300.0);
        input.touch(1, TouchPhase::Moved, 220.0, 300.0);
        input.touch(2, TouchPhase::Started, 800.0, 300.0);
        let s = input.sources();
        assert_eq!(s["touch:left"], 1.0);
        assert_eq!(s["touch:right"], 1.0);
        assert_eq!(
            s["touch:drag_x"], 1.0,
            "a 120 px drag on a 1000 px screen is a full push"
        );
        assert_eq!(s["touch:drag_y"], 0.0);
        input.touch(1, TouchPhase::Ended, 220.0, 300.0);
        input.touch(2, TouchPhase::Cancelled, 800.0, 300.0);
        let s = input.sources();
        assert!(!s.contains_key("touch:left") && !s.contains_key("touch:right"));
    }

    #[test]
    fn the_last_new_source_is_remembered_for_rebinding_screens() {
        let mut input = Input {
            width: 1000.0,
            ..Default::default()
        };
        assert_eq!(input.sources().len(), 0);
        input.touch(1, TouchPhase::Started, 800.0, 100.0);
        input.sources();
        assert_eq!(input.last_new_source.as_deref(), Some("touch:right"));
        input.sources(); // still held: not new again
        input.touch(1, TouchPhase::Ended, 800.0, 100.0);
        input.touch(2, TouchPhase::Started, 50.0, 100.0);
        input.sources();
        assert_eq!(input.last_new_source.as_deref(), Some("touch:left"));
    }
}
