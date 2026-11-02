//! One action layer over keyboard, touch and gamepad. Lua only ever sees actions.
//!
//! Actions: `steer` (-1..1), `throttle` (0..1), `brake` (0..1), `action` (button).
//! Android gamepad buttons arrive as winit key events carrying native key codes;
//! analogue sticks and triggers are not delivered by winit and need a
//! native-activity input path (recorded as an open item in docs/spike-results.md).

use std::collections::{HashMap, HashSet};

use winit::event::{ElementState, KeyEvent, TouchPhase};
use winit::keyboard::{KeyCode, NativeKeyCode, PhysicalKey};

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
    touches: HashMap<u64, ([f32; 2], [f32; 2])>,
    width: f32,
    #[cfg(not(target_os = "android"))]
    pad: Option<gilrs::Gilrs>,
    action_was_down: bool,
    pub action_pressed: bool,
    pub last_unknown_key: Option<String>,
    hud_toggle: bool,
}

// Android KeyEvent codes for game controllers.
const DPAD_LEFT: u32 = 21;
const DPAD_RIGHT: u32 = 22;
const BUTTON_A: u32 = 96;
const BUTTON_B: u32 = 97;
const BUTTON_X: u32 = 99;
const BUTTON_L2: u32 = 104;
const BUTTON_R2: u32 = 105;

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

    /// Call once per frame before running scripts.
    pub fn frame(&mut self) -> Actions {
        let key = |codes: &[KeyCode]| codes.iter().any(|c| self.keys.contains(c));
        let native = |codes: &[u32]| codes.iter().any(|c| self.native.contains(c));
        let mut steer = 0.0f32;
        if key(&[KeyCode::KeyA, KeyCode::ArrowLeft]) || native(&[DPAD_LEFT]) {
            steer -= 1.0;
        }
        if key(&[KeyCode::KeyD, KeyCode::ArrowRight]) || native(&[DPAD_RIGHT]) {
            steer += 1.0;
        }
        #[cfg_attr(target_os = "android", allow(unused_mut))]
        let mut throttle: f32 =
            if key(&[KeyCode::KeyW, KeyCode::ArrowUp]) || native(&[BUTTON_A, BUTTON_R2]) {
                1.0
            } else {
                0.0
            };
        #[cfg_attr(target_os = "android", allow(unused_mut))]
        let mut brake: f32 =
            if key(&[KeyCode::KeyS, KeyCode::ArrowDown]) || native(&[BUTTON_B, BUTTON_L2]) {
                1.0
            } else {
                0.0
            };
        #[cfg_attr(target_os = "android", allow(unused_mut))]
        let mut action = key(&[KeyCode::Space]) || native(&[BUTTON_X]);

        // Touch: left half steers by dragging sideways, right half holds the throttle.
        for (start, current) in self.touches.values() {
            if start[0] < self.width * 0.5 {
                steer += ((current[0] - start[0]) / (self.width * 0.12).max(1.0)).clamp(-1.0, 1.0);
            } else {
                throttle = 1.0;
            }
        }

        #[cfg(not(target_os = "android"))]
        if let Some(pad) = self.pad.as_mut() {
            while pad.next_event().is_some() {}
            if let Some((_, gamepad)) = pad.gamepads().next() {
                use gilrs::{Axis, Button};
                let x = gamepad.value(Axis::LeftStickX);
                if x.abs() > 0.12 {
                    steer += x;
                }
                let trigger = |b| gamepad.button_data(b).map(|d| d.value()).unwrap_or(0.0);
                throttle = throttle.max(trigger(Button::RightTrigger2)).max(
                    if gamepad.is_pressed(Button::South) {
                        1.0
                    } else {
                        0.0
                    },
                );
                brake = brake.max(trigger(Button::LeftTrigger2)).max(
                    if gamepad.is_pressed(Button::East) {
                        1.0
                    } else {
                        0.0
                    },
                );
                action |= gamepad.is_pressed(Button::West);
            }
        }

        self.action_pressed = action && !self.action_was_down;
        self.action_was_down = action;
        Actions {
            steer: steer.clamp(-1.0, 1.0),
            throttle,
            brake,
            action,
        }
    }
}
