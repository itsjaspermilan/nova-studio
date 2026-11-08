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

/// Android's Back key arrives as the browser-back key or as native key 4. A game sees it as
/// `key:Escape`, which most games use to pause or go back; one that does not use Escape is closed by it, as an Android app is.
pub fn back_as_escape(key: PhysicalKey) -> PhysicalKey {
    match key {
        PhysicalKey::Code(KeyCode::BrowserBack)
        | PhysicalKey::Unidentified(NativeKeyCode::Android(4)) => {
            PhysicalKey::Code(KeyCode::Escape)
        }
        other => other,
    }
}

#[derive(Default)]
pub struct Input {
    keys: HashSet<KeyCode>,
    /// Android: the native key codes held, and the latest value of each motion axis (by axis code), for each input device
    /// (by its Android id; desktop tests use 0).
    native: HashMap<i32, HashSet<u32>>,
    native_axes: HashMap<i32, HashMap<u32, f32>>,
    /// Android: the game controllers the system lists (asked about once a second), and when it was last asked.
    #[cfg(target_os = "android")]
    controllers: Vec<crate::android_input::Controller>,
    #[cfg(target_os = "android")]
    controllers_checked: Option<std::time::Instant>,
    touches: HashMap<u64, ([f32; 2], [f32; 2])>,
    width: f32,
    #[cfg(not(target_os = "android"))]
    pad: Option<gilrs::Gilrs>,
    /// Rumbles in progress; a force-feedback effect stops when it is dropped, so each is kept until its time is up.
    #[cfg(not(target_os = "android"))]
    rumbling: Vec<(std::time::Instant, gilrs::ff::Effect)>,
    /// The mouse (physical pixels): where it is over the window, which buttons are down (left, right, middle), what
    /// happened since the last frame, and whether the game has it locked (then motion is pushes, not positions).
    mouse_pos: Option<[f32; 2]>,
    mouse_down: [bool; 3],
    mouse_edges: (bool, bool),
    mouse_moved: [f32; 2],
    wheel: f32,
    pub mouse_locked: bool,
    /// The finger that is the pointer (the first one down), and its edges since the last frame.
    pointer_finger: Option<u64>,
    finger_edges: (bool, bool),
    finger_moved: [f32; 2],
    previous_active: HashSet<String>,
    /// The source that most recently went down (for "press a key to bind" screens).
    pub last_new_source: Option<String>,
    pub last_unknown_key: Option<String>,
    hud_toggle: bool,
    /// Characters typed since the last frame (see `InputFrame::typed`).
    typed: String,
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

/// What one gamepad is doing, by Nova's button and axis names.
#[derive(Default, Clone, Debug, PartialEq)]
pub struct PadSnapshot {
    pub buttons: Vec<&'static str>,
    pub axes: Vec<(&'static str, f32)>,
}

/// One connected gamepad.
#[derive(Default, Clone, Debug, PartialEq)]
pub struct PadState {
    /// Who it is, stable while it stays connected (and, on Android, across reconnects: the system's device descriptor).
    /// Empty for input from no particular controller (`adb shell input keyevent`), which counts as player 1's.
    pub key: String,
    /// What the system calls it ("Retroid Pocket Controller", "Xbox Wireless Controller").
    pub name: String,
    /// It can shake (or, for a handheld's own controls, the handheld can).
    pub rumble: bool,
    pub snap: PadSnapshot,
}

/// The combined sources of all pads: `pad:south` (any pad holds it) and `axis:left_x` (the pad that moves it most), which a
/// one-player game binds to.
pub fn any_pad_sources(pads: &[PadState], out: &mut Sources) {
    for pad in pads {
        for name in &pad.snap.buttons {
            out.insert(format!("pad:{name}"), 1.0);
        }
        for (name, value) in &pad.snap.axes {
            let any = out.entry(format!("axis:{name}")).or_insert(0.0);
            if value.abs() > any.abs() {
                *any = *value;
            }
        }
    }
}

/// One player's pad as numbered sources: `pad2:south`, `axis2:left_x` (several pads seated as one player add up, as the
/// plain sources do).
pub fn seated_pad_sources(player: u8, snap: &PadSnapshot, out: &mut Sources) {
    use crate::actions::pad_kind;
    for name in &snap.buttons {
        out.insert(format!("{}:{name}", pad_kind("pad", player)), 1.0);
    }
    for (name, value) in &snap.axes {
        let v = out
            .entry(format!("{}:{name}", pad_kind("axis", player)))
            .or_insert(0.0);
        if value.abs() > v.abs() {
            *v = *value;
        }
    }
}

/// An Android device's held key codes and axes as one pad's buttons and axes.
fn native_snapshot(keys: Option<&HashSet<u32>>, axes: Option<&HashMap<u32, f32>>) -> PadSnapshot {
    let mut snap = PadSnapshot::default();
    for code in keys.into_iter().flatten() {
        if let Some(name) = native_pad_name(*code)
            && !snap.buttons.contains(&name)
        {
            snap.buttons.push(name);
        }
    }
    if let Some(axes) = axes {
        for (name, value) in native_axis_sources(axes) {
            if let Some(button) = name.strip_prefix("pad:") {
                if let Some(b) = PAD_NAMES.iter().find(|b| **b == button)
                    && !snap.buttons.contains(b)
                {
                    snap.buttons.push(b);
                }
            } else if let Some(axis) = name.strip_prefix("axis:")
                && let Some(a) = AXIS_NAMES.iter().find(|a| **a == axis)
                && value != 0.0
            {
                snap.axes.push((a, value));
            }
        }
    }
    snap
}

const PAD_NAMES: [&str; 16] = [
    "south",
    "east",
    "west",
    "north",
    "l1",
    "r1",
    "l2",
    "r2",
    "start",
    "select",
    "thumb_l",
    "thumb_r",
    "dpad_up",
    "dpad_down",
    "dpad_left",
    "dpad_right",
];
const AXIS_NAMES: [&str; 6] = ["left_x", "left_y", "right_x", "right_y", "l2", "r2"];

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

    /// Shakes the gamepad(s) a script asked for, when the platform can (gilrs force feedback: Linux and Windows pads that
    /// support it; macOS and Android do nothing yet, and nothing is lost by asking).
    pub fn rumble(&mut self, r: &crate::game::Rumble) {
        #[cfg(not(target_os = "android"))]
        {
            use gilrs::ff::{BaseEffect, BaseEffectType, EffectBuilder, Replay, Ticks};
            let now = std::time::Instant::now();
            self.rumbling.retain(|(until, _)| *until > now);
            let Some(pad) = self.pad.as_mut() else { return };
            let mut connected: Vec<_> = pad
                .gamepads()
                .map(|(id, g)| (id, g.is_ff_supported()))
                .collect();
            connected.sort_by_key(|(id, _)| usize::from(*id));
            let ids: Vec<_> = connected
                .iter()
                .filter(|(id, ff)| {
                    *ff && (r.pad == 0
                        || r.devices.contains(&format!("gilrs:{}", usize::from(*id))))
                })
                .map(|(id, _)| *id)
                .collect();
            if ids.is_empty() {
                return;
            }
            let ms = (r.seconds * 1000.0) as u32;
            let play = |magnitude: f32, kind: fn(u16) -> BaseEffectType| BaseEffect {
                kind: kind((magnitude.clamp(0.0, 1.0) * f32::from(u16::MAX)) as u16),
                scheduling: Replay {
                    play_for: Ticks::from_ms(ms),
                    with_delay: Ticks::from_ms(0),
                    after: Ticks::from_ms(0),
                },
                envelope: Default::default(),
            };
            let mut builder = EffectBuilder::new();
            if r.strong > 0.0 {
                builder.add_effect(play(r.strong, |magnitude| BaseEffectType::Strong {
                    magnitude,
                }));
            }
            if r.weak > 0.0 {
                builder.add_effect(play(r.weak, |magnitude| BaseEffectType::Weak { magnitude }));
            }
            match builder.gamepads(&ids).finish(pad) {
                Ok(effect) => {
                    if effect.play().is_ok() {
                        let until = now + std::time::Duration::from_millis(u64::from(ms) + 100);
                        self.rumbling.push((until, effect));
                    }
                }
                Err(e) => log::debug!("rumble not played: {e}"),
            }
        }
        #[cfg(target_os = "android")]
        {
            // the pads asked for (all when none is named); a pad with no motor of its own that is part of the handheld
            // shakes the handheld, and so does input from no particular controller
            let strength = r.strong.max(r.weak);
            let ms = (r.seconds * 1000.0) as i64;
            let mut handheld = false;
            for c in &self.controllers {
                if r.pad != 0 && !r.devices.contains(&c.descriptor) {
                    continue;
                }
                if c.vibrator {
                    crate::android_input::vibrate(Some(c.id), strength, ms);
                } else if !c.external {
                    handheld = true;
                }
            }
            if r.devices.iter().any(String::is_empty) || (self.controllers.is_empty() && r.pad == 0)
            {
                handheld = true;
            }
            if handheld {
                crate::android_input::vibrate(None, strength, ms);
            }
        }
    }

    /// True once after F3 is pressed.
    pub fn take_toggle_hud(&mut self) -> bool {
        std::mem::take(&mut self.hud_toggle)
    }

    pub fn set_surface_width(&mut self, width: f32) {
        self.width = width;
    }

    /// What has been typed since the last call: printable characters as they are, backspace as \u{8} and enter as \n.
    pub fn take_typed(&mut self) -> String {
        std::mem::take(&mut self.typed)
    }

    /// A key press or release (see [`back_as_escape`]: Android's Back key is Escape).
    pub fn key(&mut self, event: &KeyEvent) {
        self.key_from(0, event);
    }

    /// A key press or release from one input device (on Android, its id: a controller's buttons are keys).
    pub fn key_from(&mut self, device: i32, event: &KeyEvent) {
        let down = event.state == ElementState::Pressed;
        if down {
            use winit::keyboard::{Key, NamedKey};
            match &event.logical_key {
                Key::Named(NamedKey::Backspace) => self.typed.push('\u{8}'),
                Key::Named(NamedKey::Enter) => self.typed.push('\n'),
                _ => {
                    if let Some(text) = &event.text {
                        self.typed.extend(text.chars().filter(|c| !c.is_control()));
                    }
                }
            }
        }
        match back_as_escape(event.physical_key) {
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
                self.native_key(device, code, down)
            }
            PhysicalKey::Unidentified(other) => {
                self.last_unknown_key = Some(format!("{other:?}"));
            }
        }
    }

    /// An Android key code went down or up on one input device.
    pub fn native_key(&mut self, device: i32, code: u32, down: bool) {
        let held = self.native.entry(device).or_default();
        if down {
            if held.insert(code) {
                log::info!("native key down: {code} (device {device})");
            }
        } else {
            held.remove(&code);
        }
    }

    /// A controller's motion axis changed (Android axis code and value).
    pub fn native_axis(&mut self, code: u32, value: f32) {
        self.native_axis_from(0, code, value);
    }

    /// A motion axis of one input device changed.
    pub fn native_axis_from(&mut self, device: i32, code: u32, value: f32) {
        self.native_axes
            .entry(device)
            .or_default()
            .insert(code, value);
    }

    /// The Android controllers as pads: those the system lists (asked again once a second), and any other device that sent
    /// controller input. A device that is not a controller (`adb shell input`, a keyboard) has an empty key: player 1's.
    fn native_pads(&mut self) -> Vec<PadState> {
        #[cfg(target_os = "android")]
        if self
            .controllers_checked
            .is_none_or(|t| t.elapsed() >= std::time::Duration::from_secs(1))
        {
            self.controllers_checked = Some(std::time::Instant::now());
            match crate::android_input::controllers() {
                Ok(list) => {
                    if list != self.controllers {
                        log::info!("controllers: {list:?}");
                    }
                    self.controllers = list;
                }
                Err(e) => log::warn!("cannot list the controllers: {e}"),
            }
        }
        #[cfg(target_os = "android")]
        let listed: Vec<(i32, String, String, bool)> = self
            .controllers
            .iter()
            .map(|c| {
                (
                    c.id,
                    c.descriptor.clone(),
                    c.name.clone(),
                    c.vibrator || !c.external,
                )
            })
            .collect();
        #[cfg(not(target_os = "android"))]
        let listed: Vec<(i32, String, String, bool)> = Vec::new();
        let mut pads: Vec<PadState> = listed
            .iter()
            .map(|(id, key, name, rumble)| PadState {
                key: key.clone(),
                name: name.clone(),
                rumble: *rumble,
                snap: native_snapshot(self.native.get(id), self.native_axes.get(id)),
            })
            .collect();
        let mut others: Vec<i32> = self
            .native
            .keys()
            .chain(self.native_axes.keys())
            .copied()
            .filter(|id| listed.iter().all(|l| l.0 != *id))
            .collect();
        others.sort_unstable();
        others.dedup();
        for id in others {
            let snap = native_snapshot(self.native.get(&id), self.native_axes.get(&id));
            if snap == PadSnapshot::default() {
                continue;
            }
            // with the system's list at hand, a device not on it is not a controller; without it, every device is one
            let known = cfg!(target_os = "android") && !listed.is_empty();
            pads.push(PadState {
                key: if known || id <= 0 {
                    String::new()
                } else {
                    format!("android:{id}")
                },
                name: if id <= 0 {
                    "keys".into()
                } else {
                    format!("device {id}")
                },
                rumble: false,
                snap,
            });
        }
        pads
    }

    pub fn touch(&mut self, id: u64, phase: TouchPhase, x: f32, y: f32) {
        match phase {
            TouchPhase::Started => {
                self.touches.insert(id, ([x, y], [x, y]));
                if self.pointer_finger.is_none() {
                    self.pointer_finger = Some(id);
                    self.finger_edges.0 = true;
                }
            }
            TouchPhase::Moved => {
                if let Some(t) = self.touches.get_mut(&id) {
                    if self.pointer_finger == Some(id) {
                        self.finger_moved[0] += x - t.1[0];
                        self.finger_moved[1] += y - t.1[1];
                    }
                    t.1 = [x, y];
                }
            }
            TouchPhase::Ended | TouchPhase::Cancelled => {
                self.touches.remove(&id);
                if self.pointer_finger == Some(id) {
                    self.pointer_finger = None;
                    self.finger_edges.1 = true;
                }
            }
        }
    }

    /// The cursor moved over the window to (x, y) physical pixels.
    pub fn cursor_moved(&mut self, x: f32, y: f32) {
        if let (Some(before), false) = (self.mouse_pos, self.mouse_locked) {
            self.mouse_moved[0] += x - before[0];
            self.mouse_moved[1] += y - before[1];
        }
        self.mouse_pos = Some([x, y]);
    }

    /// The cursor left the window.
    pub fn cursor_left(&mut self) {
        self.mouse_pos = None;
        self.mouse_down = [false; 3];
    }

    /// Raw mouse motion (what a locked cursor reports instead of positions).
    pub fn mouse_motion(&mut self, dx: f32, dy: f32) {
        if self.mouse_locked {
            self.mouse_moved[0] += dx;
            self.mouse_moved[1] += dy;
        }
    }

    /// A mouse button changed: 0 left, 1 right, 2 middle (others are ignored).
    pub fn mouse_button(&mut self, button: usize, pressed: bool) {
        if button > 2 {
            return;
        }
        if pressed && !self.mouse_down[button] && button == 0 {
            self.mouse_edges.0 = true;
        }
        if !pressed && self.mouse_down[button] && button == 0 {
            self.mouse_edges.1 = true;
        }
        self.mouse_down[button] = pressed;
    }

    /// The wheel turned by `lines` (up positive).
    pub fn mouse_wheel(&mut self, lines: f32) {
        self.wheel += lines;
    }

    /// The pointer for this frame, in the game's units (`scale` physical pixels to one unit); what happened since the last
    /// call (presses, movement, scroll) is reported once. The mouse wins over a finger when both are there.
    pub fn pointer(&mut self, scale: f32) -> crate::actions::PointerFrame {
        let s = scale.max(0.0001);
        let finger = self
            .pointer_finger
            .and_then(|id| self.touches.get(&id))
            .map(|t| t.1);
        let (pos, down, pressed, released, moved) = if let Some(p) = self.mouse_pos {
            (
                Some(p),
                self.mouse_down[0],
                self.mouse_edges.0,
                self.mouse_edges.1,
                self.mouse_moved,
            )
        } else {
            (
                finger,
                finger.is_some(),
                self.finger_edges.0,
                self.finger_edges.1,
                self.finger_moved,
            )
        };
        let frame = crate::actions::PointerFrame {
            present: pos.is_some(),
            x: pos.map_or(0.0, |p| p[0] / s),
            y: pos.map_or(0.0, |p| p[1] / s),
            dx: moved[0] / s,
            dy: moved[1] / s,
            down,
            right: self.mouse_down[1],
            middle: self.mouse_down[2],
            pressed,
            released,
            wheel: self.wheel,
        };
        self.mouse_edges = (false, false);
        self.mouse_moved = [0.0; 2];
        self.finger_edges = (false, false);
        self.finger_moved = [0.0; 2];
        self.wheel = 0.0;
        frame
    }

    /// Everything held right now, and the pads that are connected (see [`InputFrame::pads`]). Call once per frame.
    ///
    /// [`InputFrame::pads`]: crate::actions::InputFrame::pads
    pub fn sources(&mut self) -> Sources {
        self.poll().0
    }

    /// The sources held now, the connected pads, and the pad that pressed the newest source. Call once per frame.
    pub fn poll(&mut self) -> (Sources, Vec<PadState>, Option<String>) {
        let mut s = Sources::new();
        for code in &self.keys {
            s.insert(format!("key:{code:?}"), 1.0);
        }
        #[cfg_attr(target_os = "android", allow(unused_mut))]
        let mut pads = self.native_pads();
        for (i, name) in ["left", "right", "middle"].iter().enumerate() {
            if self.mouse_down[i] {
                s.insert(format!("mouse:{name}"), 1.0);
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
            // Every connected pad, in the order they were plugged in (gilrs ids count up).
            let mut connected: Vec<_> = pad.gamepads().collect();
            connected.sort_by_key(|(id, _)| usize::from(*id));
            pads.extend(connected.iter().map(|(id, gamepad)| PadState {
                key: format!("gilrs:{}", usize::from(*id)),
                name: gamepad.name().to_string(),
                rumble: gamepad.is_ff_supported(),
                snap: {
                    let mut snap = PadSnapshot::default();
                    for (button, name) in BUTTONS {
                        if gamepad.is_pressed(button) {
                            snap.buttons.push(name);
                        }
                    }
                    // gilrs reports stick up as positive; Nova's axes are right and down positive.
                    snap.axes = vec![
                        ("left_x", gamepad.value(Axis::LeftStickX)),
                        ("left_y", -gamepad.value(Axis::LeftStickY)),
                        ("right_x", gamepad.value(Axis::RightStickX)),
                        ("right_y", -gamepad.value(Axis::RightStickY)),
                    ];
                    for (button, name) in
                        [(Button::LeftTrigger2, "l2"), (Button::RightTrigger2, "r2")]
                    {
                        let v = gamepad.button_data(button).map_or(0.0, |d| d.value());
                        snap.axes.push((name, v));
                    }
                    snap
                },
            }));
        }
        any_pad_sources(&pads, &mut s);

        // The newest source, by its plain name (`pad:south`), and which pad pressed it. A pad's source is told apart by
        // its key in `previous_active` (`pad:south@gilrs:1`), so that a second pad pressing a button the first holds is new.
        let mut active: HashSet<String> = s
            .iter()
            .filter(|(k, v)| {
                v.abs() >= DOWN_THRESHOLD && !k.starts_with("pad:") && !k.starts_with("axis:")
            })
            .map(|(k, _)| k.clone())
            .collect();
        let mut by_pad = Sources::new();
        for pad in &pads {
            by_pad.clear();
            seated_pad_sources(0, &pad.snap, &mut by_pad);
            for (k, v) in &by_pad {
                if v.abs() >= DOWN_THRESHOLD {
                    active.insert(format!("{k}@{}", pad.key));
                }
            }
        }
        let mut fresh: Vec<&String> = active.difference(&self.previous_active).collect();
        fresh.sort();
        let mut last_pad = None;
        if let Some(first) = fresh.first() {
            let (source, pad) = match first.split_once('@') {
                Some((source, pad)) => (source.to_string(), Some(pad.to_string())),
                None => ((*first).clone(), None),
            };
            self.last_new_source = Some(source);
            last_pad = pad;
        }
        self.previous_active = active;
        (s, pads, last_pad)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_mouse_gives_button_sources_and_a_pointer_in_game_units() {
        let mut input = Input::default();
        input.cursor_moved(200.0, 100.0);
        input.cursor_moved(230.0, 90.0);
        input.mouse_button(0, true);
        input.mouse_button(1, true);
        input.mouse_wheel(2.0);
        let s = input.sources();
        assert_eq!(s["mouse:left"], 1.0);
        assert_eq!(s["mouse:right"], 1.0);
        assert!(!s.contains_key("mouse:middle"));
        // two physical pixels to a unit
        let p = input.pointer(2.0);
        assert!(p.present && p.down && p.pressed && !p.released && p.right);
        assert_eq!(
            (p.x, p.y, p.dx, p.dy, p.wheel),
            (115.0, 45.0, 15.0, -5.0, 2.0)
        );
        // what happened is reported once; where it is and what is held stay
        let again = input.pointer(2.0);
        assert!(again.down && !again.pressed && again.dx == 0.0 && again.wheel == 0.0);
        input.mouse_button(0, false);
        let up = input.pointer(2.0);
        assert!(!up.down && up.released);
        input.cursor_left();
        assert!(!input.pointer(2.0).present);
        assert!(!input.sources().contains_key("mouse:right"));
    }

    #[test]
    fn a_locked_mouse_reports_pushes_not_positions_and_a_finger_is_the_pointer_without_a_mouse() {
        let mut input = Input {
            mouse_locked: true,
            ..Default::default()
        };
        input.cursor_moved(500.0, 500.0);
        input.cursor_moved(900.0, 900.0); // a locked cursor does not travel: positions say nothing about motion
        input.mouse_motion(7.0, -3.0);
        input.mouse_motion(1.0, 1.0);
        let p = input.pointer(1.0);
        assert_eq!((p.dx, p.dy), (8.0, -2.0));
        // no mouse over the window: the first finger is the pointer
        let mut input = Input::default();
        input.touch(7, TouchPhase::Started, 100.0, 50.0);
        input.touch(8, TouchPhase::Started, 400.0, 400.0);
        input.touch(7, TouchPhase::Moved, 130.0, 60.0);
        let p = input.pointer(1.0);
        assert!(p.present && p.down && p.pressed);
        assert_eq!((p.x, p.y, p.dx, p.dy), (130.0, 60.0, 30.0, 10.0));
        input.touch(7, TouchPhase::Ended, 130.0, 60.0);
        let p = input.pointer(1.0);
        assert!(p.released && !p.pressed);
    }

    fn pad(key: &str, buttons: Vec<&'static str>, axes: Vec<(&'static str, f32)>) -> PadState {
        PadState {
            key: key.into(),
            name: key.into(),
            rumble: false,
            snap: PadSnapshot { buttons, axes },
        }
    }

    #[test]
    fn several_pads_make_combined_sources_and_seated_ones_numbered_sources() {
        let first = pad("one", vec!["south"], vec![("left_x", -0.3), ("r2", 0.0)]);
        let second = pad("two", vec!["east"], vec![("left_x", 0.8), ("r2", 1.0)]);
        let mut s = Sources::new();
        any_pad_sources(&[first.clone(), second.clone()], &mut s);
        // combined: any pad holds a button; the stick moved furthest wins
        assert_eq!(s["pad:south"], 1.0);
        assert_eq!(s["pad:east"], 1.0);
        assert_eq!(s["axis:left_x"], 0.8);
        assert_eq!(s["axis:r2"], 1.0);
        assert!(
            s.keys()
                .all(|k| k.starts_with("pad:") || k.starts_with("axis:"))
        );
        // numbered by the seat the game gave each pad (here the second pad plugged in is player 1)
        seated_pad_sources(1, &second.snap, &mut s);
        seated_pad_sources(2, &first.snap, &mut s);
        assert_eq!(s["pad1:east"], 1.0);
        assert_eq!(s["pad2:south"], 1.0);
        assert!(!s.contains_key("pad1:south") && !s.contains_key("pad2:east"));
        assert_eq!(s["axis1:left_x"], 0.8);
        assert_eq!(s["axis2:left_x"], -0.3);
        // no pad: nothing
        let mut none = Sources::new();
        any_pad_sources(&[], &mut none);
        assert!(none.is_empty());
    }

    #[test]
    fn android_devices_are_separate_pads_and_the_newest_press_names_its_pad() {
        let mut input = Input::default();
        input.native_key(5, 96, true);
        let (s, pads, last) = input.poll();
        assert_eq!(s["pad:south"], 1.0);
        assert_eq!(pads.len(), 1);
        assert_eq!(pads[0].key, "android:5");
        assert_eq!(input.last_new_source.as_deref(), Some("pad:south"));
        assert_eq!(last.as_deref(), Some("android:5"));
        // a second controller presses the same button: it is new, and it is that pad's
        input.native_key(9, 96, true);
        input.native_axis_from(9, 0, -1.0);
        let (_, pads, last) = input.poll();
        assert_eq!(pads.len(), 2);
        assert_eq!(pads[1].snap.buttons, ["south"]);
        assert_eq!(
            pads[1]
                .snap
                .axes
                .iter()
                .find(|a| a.0 == "left_x")
                .unwrap()
                .1,
            -1.0
        );
        assert_eq!(last.as_deref(), Some("android:9"));
        // input from no particular device (adb) is the empty key: player 1's
        input.native_key(-1, 97, true);
        let (_, pads, _) = input.poll();
        assert!(
            pads.iter()
                .any(|p| p.key.is_empty() && p.snap.buttons == ["east"])
        );
    }

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

#[cfg(test)]
mod back_key_tests {
    use super::*;

    #[test]
    fn android_back_is_escape_and_other_keys_are_left_alone() {
        let escape = PhysicalKey::Code(KeyCode::Escape);
        assert_eq!(
            back_as_escape(PhysicalKey::Code(KeyCode::BrowserBack)),
            escape
        );
        assert_eq!(
            back_as_escape(PhysicalKey::Unidentified(NativeKeyCode::Android(4))),
            escape
        );
        assert_eq!(
            back_as_escape(PhysicalKey::Code(KeyCode::KeyA)),
            PhysicalKey::Code(KeyCode::KeyA)
        );
        assert_eq!(
            back_as_escape(PhysicalKey::Unidentified(NativeKeyCode::Android(96))),
            PhysicalKey::Unidentified(NativeKeyCode::Android(96))
        );
    }
}
