//! Named input actions and the bindings that drive them.
//!
//! The platform layer reports *sources*: what is physically held right now, as ids with values
//! (`key:Space` = 1, `pad:south` = 1, `axis:left_x` = -0.7, `touch:right` = 1). A project
//! binds named *actions* to sources; scripts only ever ask about actions (`nova.input.down("jump")`).
//! That keeps games independent of the device and makes remapping a data change.
//!
//! Source ids:
//! - `key:<Name>`: a keyboard key by its W3C-style name (`KeyA`, `Digit1`, `ArrowLeft`, `Space`, `Enter`, `F5`...)
//! - `pad:<button>`: `south`, `east`, `west`, `north` (the A, B, X, Y positions), `l1`, `r1`, `l2`,
//!   `r2`, `start`, `select`, `thumb_l`, `thumb_r`, `dpad_up`, `dpad_down`, `dpad_left`, `dpad_right`
//! - `axis:<name>`: `left_x`, `left_y`, `right_x`, `right_y` (right and down are positive) and the triggers
//!   `l2`, `r2` (0 to 1); a trailing `+` or `-` takes only that direction (`axis:left_x-`)
//! - `touch:<zone>`: `left` or `right` (a finger held on that half of the screen), `drag_x`, `drag_y`
//!   (how far a finger on the left half has been dragged, -1 to 1)

use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::Value;

/// Active sources and their values.
pub type Sources = HashMap<String, f32>;

/// One frame of input as the game host receives it: what is held, plus values forced on top
/// (used by `--hold` and tests) and the source most recently pressed.
#[derive(Default, Clone, Debug)]
pub struct InputFrame {
    pub sources: Sources,
    pub overrides: Vec<(String, f32)>,
    pub last_source: Option<String>,
}

impl InputFrame {
    /// The four original actions as forced values.
    pub fn from_actions(a: crate::input::Actions) -> Self {
        let mut overrides = vec![
            ("steer".to_string(), a.steer),
            ("throttle".to_string(), a.throttle),
            ("brake".to_string(), a.brake),
            ("action".to_string(), if a.action { 1.0 } else { 0.0 }),
        ];
        // Keep the "no input" case free of forced values so real bindings still work.
        if a.is_empty() {
            overrides.clear();
        }
        InputFrame {
            overrides,
            ..Default::default()
        }
    }

    /// The four original actions as plain numbers, from the default bindings (for the
    /// benchmark scene's script).
    pub fn legacy_actions(&self) -> crate::input::Actions {
        let defaults = Bindings::defaults();
        let value = |name: &str| {
            self.overrides
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, v)| *v)
                .unwrap_or_else(|| defaults.get(name).map_or(0.0, |b| b.value(&self.sources)))
        };
        crate::input::Actions {
            steer: value("steer").clamp(-1.0, 1.0),
            throttle: value("throttle").clamp(0.0, 1.0),
            brake: value("brake").clamp(0.0, 1.0),
            action: value("action") >= DOWN_THRESHOLD,
        }
    }
}

pub const DEADZONE: f32 = 0.2;
pub const DOWN_THRESHOLD: f32 = 0.5;

const PAD_BUTTONS: [&str; 16] = [
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
const AXES: [&str; 6] = ["left_x", "left_y", "right_x", "right_y", "l2", "r2"];
const TOUCH_ZONES: [&str; 4] = ["left", "right", "drag_x", "drag_y"];

fn is_key_name(name: &str) -> bool {
    let letters = name
        .strip_prefix("Key")
        .is_some_and(|l| l.len() == 1 && l.chars().all(|c| c.is_ascii_uppercase()));
    let digits = name
        .strip_prefix("Digit")
        .is_some_and(|d| d.len() == 1 && d.chars().all(|c| c.is_ascii_digit()));
    let numpad = name
        .strip_prefix("Numpad")
        .is_some_and(|d| d.len() == 1 && d.chars().all(|c| c.is_ascii_digit()));
    let function = name
        .strip_prefix('F')
        .and_then(|n| n.parse::<u8>().ok())
        .is_some_and(|n| (1..=12).contains(&n));
    letters
        || digits
        || numpad
        || function
        || [
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "Space",
            "Enter",
            "Escape",
            "Tab",
            "Backspace",
            "Delete",
            "Insert",
            "Home",
            "End",
            "PageUp",
            "PageDown",
            "ShiftLeft",
            "ShiftRight",
            "ControlLeft",
            "ControlRight",
            "AltLeft",
            "AltRight",
            "Comma",
            "Period",
            "Slash",
            "Semicolon",
            "Quote",
            "BracketLeft",
            "BracketRight",
            "Backslash",
            "Minus",
            "Equal",
            "Backquote",
            "NumpadEnter",
            "NumpadAdd",
            "NumpadSubtract",
            "NumpadMultiply",
            "NumpadDivide",
        ]
        .contains(&name)
}

#[derive(Clone, Debug, PartialEq)]
pub enum Source {
    Key(String),
    Pad(String),
    /// `sign` 0 takes the direction the binding's list implies; +1 or -1 forces one.
    Axis {
        name: String,
        sign: i8,
    },
    Touch(String),
}

impl Source {
    pub fn parse(text: &str) -> Result<Source, String> {
        let (kind, name) = text.split_once(':').ok_or_else(|| {
            format!("'{text}' is not an input source; write it like key:Space, pad:south, axis:left_x or touch:right")
        })?;
        match kind {
            "key" if is_key_name(name) => Ok(Source::Key(name.to_string())),
            "key" => Err(format!(
                "'{name}' is not a key name; use names like KeyA, Digit1, ArrowLeft, Space, Enter, ShiftLeft, F5"
            )),
            "pad" if PAD_BUTTONS.contains(&name) => Ok(Source::Pad(name.to_string())),
            "pad" => Err(format!(
                "'{name}' is not a gamepad button; the buttons are {}",
                PAD_BUTTONS.join(", ")
            )),
            "axis" => {
                let (base, sign) = match name.strip_suffix('+') {
                    Some(b) => (b, 1),
                    None => match name.strip_suffix('-') {
                        Some(b) => (b, -1),
                        None => (name, 0),
                    },
                };
                if AXES.contains(&base) {
                    Ok(Source::Axis {
                        name: base.to_string(),
                        sign,
                    })
                } else {
                    Err(format!(
                        "'{base}' is not an axis; the axes are {}",
                        AXES.join(", ")
                    ))
                }
            }
            "touch" if TOUCH_ZONES.contains(&name) => Ok(Source::Touch(name.to_string())),
            "touch" => Err(format!(
                "'{name}' is not a touch zone; use {}",
                TOUCH_ZONES.join(", ")
            )),
            other => Err(format!(
                "'{other}:' is not a kind of input source (key, pad, axis, touch)"
            )),
        }
    }

    pub fn id(&self) -> String {
        match self {
            Source::Key(n) => format!("key:{n}"),
            Source::Pad(n) => format!("pad:{n}"),
            Source::Axis { name, sign } => format!(
                "axis:{name}{}",
                match sign {
                    1 => "+",
                    -1 => "-",
                    _ => "",
                }
            ),
            Source::Touch(n) => format!("touch:{n}"),
        }
    }

    /// Strength 0 to 1 when used as `direction` (+1 for a positive list, -1 for a negative one).
    fn strength(&self, sources: &Sources, direction: i8) -> f32 {
        let get = |id: &str| sources.get(id).copied().unwrap_or(0.0);
        match self {
            Source::Key(_) | Source::Pad(_) => get(&self.id()).clamp(0.0, 1.0),
            Source::Touch(n) if n == "drag_x" || n == "drag_y" => {
                let v = get(&self.id());
                (v * direction as f32).clamp(0.0, 1.0)
            }
            Source::Touch(_) => get(&self.id()).clamp(0.0, 1.0),
            Source::Axis { name, sign } => {
                let raw = get(&format!("axis:{name}"));
                let dir = if *sign != 0 { *sign } else { direction };
                let v = (raw * dir as f32).clamp(0.0, 1.0);
                if v < DEADZONE {
                    0.0
                } else {
                    (v - DEADZONE) / (1.0 - DEADZONE)
                }
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Binding {
    /// Down when any source is held; value 0 to 1.
    Button(Vec<Source>),
    /// Value from -1 (the negative sources) to 1 (the positive ones).
    Axis {
        negative: Vec<Source>,
        positive: Vec<Source>,
    },
}

impl Binding {
    pub fn value(&self, sources: &Sources) -> f32 {
        match self {
            Binding::Button(list) => list
                .iter()
                .map(|s| s.strength(sources, 1))
                .fold(0.0, f32::max),
            Binding::Axis { negative, positive } => {
                let neg = negative
                    .iter()
                    .map(|s| s.strength(sources, -1))
                    .fold(0.0, f32::max);
                let pos = positive
                    .iter()
                    .map(|s| s.strength(sources, 1))
                    .fold(0.0, f32::max);
                pos - neg
            }
        }
    }

    pub fn is_axis(&self) -> bool {
        matches!(self, Binding::Axis { .. })
    }

    pub fn source_ids(&self) -> Vec<String> {
        match self {
            Binding::Button(l) => l.iter().map(Source::id).collect(),
            Binding::Axis { negative, positive } => {
                negative.iter().chain(positive).map(Source::id).collect()
            }
        }
    }
}

fn parse_list(value: &Value, at: &str) -> Result<Vec<Source>, String> {
    let list = value.as_array().ok_or_else(|| {
        format!("{at}: must be a list of sources like [\"key:Space\", \"pad:south\"]")
    })?;
    if list.is_empty() {
        return Err(format!("{at}: needs at least one source"));
    }
    list.iter()
        .enumerate()
        .map(|(i, v)| {
            let text = v
                .as_str()
                .ok_or_else(|| format!("{at}[{i}]: sources are strings like \"key:Space\""))?;
            Source::parse(text).map_err(|e| format!("{at}[{i}]: {e}"))
        })
        .collect()
}

/// One action's binding from JSON or a Lua table converted to JSON: a list of sources (a
/// button) or `{ "negative": [...], "positive": [...] }` (an axis).
pub fn parse_binding(value: &Value, at: &str) -> Result<Binding, String> {
    match value {
        Value::Array(_) => Ok(Binding::Button(parse_list(value, at)?)),
        Value::Object(o) => {
            for key in o.keys() {
                if key != "negative" && key != "positive" {
                    return Err(format!(
                        "{at}: unknown key \"{key}\" (an axis has \"negative\" and \"positive\")"
                    ));
                }
            }
            let part = |key: &str| -> Result<Vec<Source>, String> {
                match o.get(key) {
                    Some(v) => parse_list(v, &format!("{at}.{key}")),
                    None => Err(format!(
                        "{at}: an axis needs both \"negative\" and \"positive\" lists"
                    )),
                }
            };
            Ok(Binding::Axis {
                negative: part("negative")?,
                positive: part("positive")?,
            })
        }
        _ => Err(format!(
            "{at}: must be a list of sources (a button) or an object with \"negative\" and \"positive\" (an axis)"
        )),
    }
}

fn valid_action_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

#[derive(Clone, Debug)]
pub struct Bindings {
    map: BTreeMap<String, Binding>,
}

impl Bindings {
    /// Built-in actions: `left right up down`, `a b x y`, `l1 r1 l2 r2`, `start select`, the axes
    /// `move_x move_y look_x look_y`, and the older `steer throttle brake action`.
    pub fn defaults() -> Self {
        let s = |text: &str| Source::parse(text).expect("built-in source is valid");
        let list = |items: &[&str]| items.iter().map(|t| s(t)).collect::<Vec<_>>();
        let mut map = BTreeMap::new();
        let mut button = |name: &str, items: &[&str]| {
            map.insert(name.to_string(), Binding::Button(list(items)));
        };
        button(
            "left",
            &["key:ArrowLeft", "key:KeyA", "pad:dpad_left", "axis:left_x-"],
        );
        button(
            "right",
            &[
                "key:ArrowRight",
                "key:KeyD",
                "pad:dpad_right",
                "axis:left_x+",
            ],
        );
        button(
            "up",
            &["key:ArrowUp", "key:KeyW", "pad:dpad_up", "axis:left_y-"],
        );
        button(
            "down",
            &["key:ArrowDown", "key:KeyS", "pad:dpad_down", "axis:left_y+"],
        );
        button("a", &["pad:south", "key:KeyZ", "key:Space", "touch:right"]);
        button("b", &["pad:east", "key:KeyX"]);
        button("x", &["pad:west", "key:KeyC"]);
        button("y", &["pad:north", "key:KeyV"]);
        button("l1", &["pad:l1", "key:KeyQ"]);
        button("r1", &["pad:r1", "key:KeyE"]);
        button("l2", &["pad:l2", "axis:l2", "key:Digit1"]);
        button("r2", &["pad:r2", "axis:r2", "key:Digit2"]);
        button("start", &["pad:start", "key:Enter"]);
        button("select", &["pad:select", "key:Tab"]);
        // The older four, kept so existing games keep working.
        button(
            "throttle",
            &[
                "key:KeyW",
                "key:ArrowUp",
                "pad:south",
                "pad:r2",
                "axis:r2",
                "touch:right",
            ],
        );
        button(
            "brake",
            &["key:KeyS", "key:ArrowDown", "pad:east", "pad:l2", "axis:l2"],
        );
        button("action", &["key:Space", "pad:west"]);
        let mut axis = |name: &str, neg: &[&str], pos: &[&str]| {
            map.insert(
                name.to_string(),
                Binding::Axis {
                    negative: list(neg),
                    positive: list(pos),
                },
            );
        };
        axis(
            "move_x",
            &[
                "key:ArrowLeft",
                "key:KeyA",
                "pad:dpad_left",
                "axis:left_x",
                "touch:drag_x",
            ],
            &[
                "key:ArrowRight",
                "key:KeyD",
                "pad:dpad_right",
                "axis:left_x",
                "touch:drag_x",
            ],
        );
        axis(
            "move_y",
            &["key:ArrowUp", "key:KeyW", "pad:dpad_up", "axis:left_y"],
            &["key:ArrowDown", "key:KeyS", "pad:dpad_down", "axis:left_y"],
        );
        axis("look_x", &["axis:right_x"], &["axis:right_x"]);
        axis("look_y", &["axis:right_y"], &["axis:right_y"]);
        axis(
            "steer",
            &[
                "key:ArrowLeft",
                "key:KeyA",
                "pad:dpad_left",
                "axis:left_x",
                "touch:drag_x",
            ],
            &[
                "key:ArrowRight",
                "key:KeyD",
                "pad:dpad_right",
                "axis:left_x",
                "touch:drag_x",
            ],
        );
        Bindings { map }
    }

    /// The defaults with a project's `"input"` section applied: a name that already exists is
    /// replaced, a new one is added.
    pub fn from_manifest(input: &Value) -> Result<Self, String> {
        let object = input
            .as_object()
            .ok_or("nova.json: \"input\" must be an object of action names to bindings")?;
        let mut bindings = Self::defaults();
        for (name, value) in object {
            if !valid_action_name(name) {
                return Err(format!(
                    "nova.json.input: '{name}' is not a valid action name; use lowercase letters, digits and underscores, starting with a letter"
                ));
            }
            let binding = parse_binding(value, &format!("nova.json.input.{name}"))?;
            bindings.map.insert(name.clone(), binding);
        }
        Ok(bindings)
    }

    pub fn get(&self, name: &str) -> Option<&Binding> {
        self.map.get(name)
    }

    pub fn set(&mut self, name: &str, binding: Binding) -> Result<(), String> {
        if !valid_action_name(name) {
            return Err(format!(
                "'{name}' is not a valid action name; use lowercase letters, digits and underscores"
            ));
        }
        self.map.insert(name.to_string(), binding);
        Ok(())
    }

    pub fn names(&self) -> Vec<&str> {
        self.map.keys().map(String::as_str).collect()
    }
}

/// The current value of every action plus edge detection.
///
/// `pressed` / `released` are *latched*: a press that happens on a frame in which no game step
/// runs is remembered until the next step consumes it, and a press is reported to exactly one step,
/// however many steps run per frame.
#[derive(Default)]
pub struct ActionStates {
    values: HashMap<String, f32>,
    down: HashSet<String>,
    latched_pressed: HashSet<String>,
    latched_released: HashSet<String>,
    step_pressed: HashSet<String>,
    step_released: HashSet<String>,
}

impl ActionStates {
    /// Re-evaluates every action from this frame's sources, then applies `overrides` (used by
    /// `--hold` and tests) on top.
    pub fn update(&mut self, bindings: &Bindings, sources: &Sources, overrides: &[(String, f32)]) {
        for (name, binding) in &bindings.map {
            let mut v = binding.value(sources);
            if let Some((_, o)) = overrides.iter().find(|(n, _)| n == name) {
                v = *o;
            }
            self.set_value(name, v, binding.is_axis());
        }
        // Overrides for names with no binding still count (a script may ask for them).
        for (name, v) in overrides {
            if bindings.get(name).is_none() {
                self.set_value(name, *v, false);
            }
        }
    }

    fn set_value(&mut self, name: &str, value: f32, is_axis: bool) {
        let was_down = self.down.contains(name);
        let now_down = value.abs() >= DOWN_THRESHOLD && (is_axis || value > 0.0);
        self.values.insert(name.to_string(), value);
        match (was_down, now_down) {
            (false, true) => {
                self.down.insert(name.to_string());
                self.latched_pressed.insert(name.to_string());
            }
            (true, false) => {
                self.down.remove(name);
                self.latched_released.insert(name.to_string());
            }
            _ => {}
        }
    }

    /// Call at the start of each game step: what was pressed since the last step becomes
    /// what this step sees.
    pub fn begin_step(&mut self) {
        self.step_pressed = std::mem::take(&mut self.latched_pressed);
        self.step_released = std::mem::take(&mut self.latched_released);
    }

    pub fn value(&self, name: &str) -> f32 {
        self.values.get(name).copied().unwrap_or(0.0)
    }
    pub fn is_down(&self, name: &str) -> bool {
        self.down.contains(name)
    }
    pub fn was_pressed(&self, name: &str) -> bool {
        self.step_pressed.contains(name)
    }
    pub fn was_released(&self, name: &str) -> bool {
        self.step_released.contains(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn held(items: &[(&str, f32)]) -> Sources {
        items.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    #[test]
    fn sources_parse_and_round_trip_with_clear_errors() {
        for ok in [
            "key:Space",
            "key:KeyA",
            "key:Digit1",
            "key:F12",
            "key:ArrowLeft",
            "pad:south",
            "pad:dpad_up",
            "axis:left_x",
            "axis:left_x-",
            "axis:r2+",
            "touch:right",
            "touch:drag_x",
        ] {
            assert_eq!(Source::parse(ok).unwrap().id(), ok);
        }
        let cases: &[(&str, &str)] = &[
            ("Space", "not an input source"),
            ("key:space", "not a key name"),
            ("key:F13", "not a key name"),
            ("pad:cross", "not a gamepad button"),
            ("axis:left_z", "not an axis"),
            ("touch:middle", "not a touch zone"),
            ("mouse:left", "not a kind of input source"),
        ];
        for (text, expected) in cases {
            let e = Source::parse(text).unwrap_err();
            assert!(e.contains(expected), "{text}: {e}");
        }
    }

    #[test]
    fn button_actions_go_down_with_any_source_and_analogue_sources_have_a_deadzone() {
        let b = Binding::Button(vec![
            Source::parse("key:Space").unwrap(),
            Source::parse("axis:r2").unwrap(),
        ]);
        assert_eq!(b.value(&held(&[])), 0.0);
        assert_eq!(b.value(&held(&[("key:Space", 1.0)])), 1.0);
        assert_eq!(
            b.value(&held(&[("axis:r2", 0.1)])),
            0.0,
            "inside the deadzone"
        );
        assert!((b.value(&held(&[("axis:r2", 1.0)])) - 1.0).abs() < 1e-6);
        let half = b.value(&held(&[("axis:r2", 0.6)]));
        assert!(
            half > 0.4 && half < 0.6,
            "rescaled past the deadzone: {half}"
        );
    }

    #[test]
    fn axis_actions_combine_directions_and_signed_sticks() {
        let a = &Bindings::defaults().map["move_x"].clone();
        assert_eq!(a.value(&held(&[("key:KeyD", 1.0)])), 1.0);
        assert_eq!(a.value(&held(&[("key:ArrowLeft", 1.0)])), -1.0);
        assert_eq!(
            a.value(&held(&[("key:KeyA", 1.0), ("key:KeyD", 1.0)])),
            0.0,
            "both cancel"
        );
        assert!(a.value(&held(&[("axis:left_x", -1.0)])) < -0.99);
        assert!(a.value(&held(&[("axis:left_x", 0.5)])) > 0.2);
        assert!(
            a.value(&held(&[("touch:drag_x", -0.7)])) < -0.6,
            "a drag left steers left"
        );
        assert_eq!(
            a.value(&held(&[("axis:left_y", 1.0)])),
            0.0,
            "other axes do not leak in"
        );
    }

    #[test]
    fn defaults_keep_the_older_four_actions_working() {
        let b = Bindings::defaults();
        let v = |name: &str, s: &[(&str, f32)]| b.get(name).unwrap().value(&held(s));
        assert_eq!(v("throttle", &[("key:KeyW", 1.0)]), 1.0);
        assert_eq!(v("throttle", &[("touch:right", 1.0)]), 1.0);
        assert_eq!(v("brake", &[("key:ArrowDown", 1.0)]), 1.0);
        assert_eq!(v("action", &[("key:Space", 1.0)]), 1.0);
        assert_eq!(v("steer", &[("key:KeyD", 1.0)]), 1.0);
        assert_eq!(v("a", &[("pad:south", 1.0)]), 1.0);
        assert_eq!(v("start", &[("key:Enter", 1.0)]), 1.0);
        assert_eq!(v("left", &[("axis:left_x", -1.0)]), 1.0);
        assert_eq!(
            v("up", &[("axis:left_y", -1.0)]),
            1.0,
            "stick up is negative y"
        );
    }

    #[test]
    fn manifest_input_replaces_and_adds_actions_and_reports_exact_errors() {
        let b = Bindings::from_manifest(&json!({
            "fire": ["key:KeyZ", "pad:west"],
            "move_x": { "negative": ["key:KeyJ"], "positive": ["key:KeyL"] },
            "a": ["key:Enter"]
        }))
        .unwrap();
        assert!(b.get("fire").is_some());
        assert_eq!(
            b.get("a").unwrap().value(&held(&[("pad:south", 1.0)])),
            0.0,
            "replaced, not merged"
        );
        assert_eq!(b.get("a").unwrap().value(&held(&[("key:Enter", 1.0)])), 1.0);
        assert_eq!(
            b.get("move_x").unwrap().value(&held(&[("key:KeyJ", 1.0)])),
            -1.0
        );
        assert!(b.get("left").is_some(), "untouched defaults remain");

        let cases: &[(Value, &str)] = &[
            (json!([]), "must be an object"),
            (json!({"Fire": ["key:KeyZ"]}), "not a valid action name"),
            (
                json!({"fire": "key:KeyZ"}),
                "nova.json.input.fire: must be a list",
            ),
            (json!({"fire": []}), "needs at least one source"),
            (
                json!({"fire": [3]}),
                "nova.json.input.fire[0]: sources are strings",
            ),
            (
                json!({"fire": ["key:Nope"]}),
                "nova.json.input.fire[0]: 'Nope' is not a key name",
            ),
            (json!({"fire": {"negative": ["key:KeyA"]}}), "needs both"),
            (
                json!({"fire": {"negative": ["key:KeyA"], "positive": ["key:KeyD"], "extra": 1}}),
                "unknown key \"extra\"",
            ),
            (json!({"fire": 7}), "must be a list of sources"),
        ];
        for (input, expected) in cases {
            let e = Bindings::from_manifest(input).unwrap_err();
            assert!(
                e.contains(expected),
                "{input}: expected '{expected}' in '{e}'"
            );
        }
    }

    #[test]
    fn presses_are_latched_to_exactly_one_step() {
        let bindings = Bindings::defaults();
        let mut st = ActionStates::default();
        // Frame 1: pressed, but no step runs this frame (a 120 Hz display between 60 Hz steps).
        st.update(&bindings, &held(&[("key:KeyZ", 1.0)]), &[]);
        assert!(
            st.is_down("a") && !st.was_pressed("a"),
            "not visible until a step begins"
        );
        // Frame 2: still held, then two steps run: only the first sees the press.
        st.update(&bindings, &held(&[("key:KeyZ", 1.0)]), &[]);
        st.begin_step();
        assert!(
            st.was_pressed("a"),
            "the step that follows sees the press that happened earlier"
        );
        st.begin_step();
        assert!(!st.was_pressed("a"), "and only that step");
        assert!(st.is_down("a"));
        // Release between steps is latched too.
        st.update(&bindings, &held(&[]), &[]);
        assert!(!st.is_down("a"));
        st.begin_step();
        assert!(st.was_released("a"));
        st.begin_step();
        assert!(!st.was_released("a"));
    }

    #[test]
    fn a_quick_tap_between_steps_is_not_lost() {
        let bindings = Bindings::defaults();
        let mut st = ActionStates::default();
        st.update(&bindings, &held(&[("key:KeyX", 1.0)]), &[]);
        st.update(&bindings, &held(&[]), &[]); // released again before any step ran
        st.begin_step();
        assert!(
            st.was_pressed("b") && st.was_released("b"),
            "both edges survive"
        );
    }

    #[test]
    fn overrides_win_and_unknown_names_read_as_zero() {
        let bindings = Bindings::defaults();
        let mut st = ActionStates::default();
        st.update(
            &bindings,
            &held(&[("key:KeyD", 1.0)]),
            &[("move_x".into(), -0.5), ("custom".into(), 1.0)],
        );
        assert_eq!(st.value("move_x"), -0.5);
        assert!(st.is_down("custom"));
        assert_eq!(st.value("nothing"), 0.0);
        assert!(!st.is_down("nothing"));
        // Axes count as down in either direction; buttons only for positive values.
        assert!(st.is_down("move_x"));
    }

    #[test]
    fn rebinding_at_runtime_changes_what_drives_an_action() {
        let mut b = Bindings::defaults();
        b.set(
            "a",
            Binding::Button(vec![Source::parse("key:KeyM").unwrap()]),
        )
        .unwrap();
        assert_eq!(b.get("a").unwrap().value(&held(&[("key:KeyM", 1.0)])), 1.0);
        assert_eq!(b.get("a").unwrap().value(&held(&[("pad:south", 1.0)])), 0.0);
        assert!(b.set("Bad Name", Binding::Button(vec![])).is_err());
        assert_eq!(b.get("a").unwrap().source_ids(), ["key:KeyM"]);
    }
}
