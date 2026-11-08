//! Keyframe animations: `animations/<name>.anim.json`, format version 1.
//!
//! An animation file is *data*, like a scene file: a length, whether it loops, and tracks. A
//! **value track** moves one field of one thing (an entity, a named object of the scene, the
//! scene itself, or the camera) through keys; an **event track** calls a function on its
//! target at given times; a **sound track** plays sounds at given times. The studio's timeline
//! editor writes these files; hand edits are fine. Lua plays them with
//! `nova.play_anim(name, { target = self })` (`lua/anim.lua`).
//!
//! ```json
//! {
//!   "version": 1,
//!   "length": 1.2,
//!   "loop": false,
//!   "tracks": [
//!     { "target": "self", "field": "y", "relative": true,
//!       "keys": [ { "time": 0, "value": 0, "ease": "out_back" }, { "time": 0.6, "value": -64 } ] },
//!     { "target": "lamp", "field": "tint",
//!       "keys": [ { "time": 0, "value": [255, 255, 255] }, { "time": 1.2, "value": [255, 180, 60] } ] },
//!     { "type": "event", "target": "self", "keys": [ { "time": 1.2, "call": "opened", "args": [1] } ] },
//!     { "type": "sound", "keys": [ { "time": 0, "sound": "door", "volume": 0.8 } ] }
//!   ]
//! }
//! ```
//!
//! A key's `ease` says how the value travels from that key to the next one: one of [`EASES`]
//! (`"step"` holds it until the next key) or `[x1, y1, x2, y2]`, a cubic Bézier like CSS's
//! `cubic-bezier` (x1 and x2 between 0 and 1). The default is `"linear"`. Values are numbers, or
//! lists of numbers (a colour) of the same length in every key of the track. Keys are sorted by
//! time when read. The checked file comes back with every default filled in, so the Lua player
//! never has to guess.

use serde_json::{Map, Value, json};

pub const VERSION: u64 = 1;
/// Where animation files live and what they end with.
pub const FOLDER: &str = "animations/";
pub const SUFFIX: &str = ".anim.json";
/// The longest animation, in seconds (an hour: a mistake, not a cutscene, beyond that).
pub const MAX_LENGTH: f64 = 3600.0;
pub const MAX_TRACKS: usize = 256;
pub const MAX_KEYS: usize = 4096;
/// The easings a key can name (the same as `nova.ease`, plus `step`).
pub const EASES: &[&str] = &[
    "linear",
    "step",
    "in_quad",
    "out_quad",
    "in_out_quad",
    "in_cubic",
    "out_cubic",
    "in_out_cubic",
    "in_sine",
    "out_sine",
    "in_out_sine",
    "in_back",
    "out_back",
    "in_out_back",
    "out_bounce",
    "out_elastic",
];

fn err(path: &str, message: impl std::fmt::Display) -> String {
    format!("{path}: {message}")
}

fn check_keys(o: &Map<String, Value>, at: &str, allowed: &[&str]) -> Result<(), String> {
    for key in o.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(err(
                at,
                format!(
                    "unknown key \"{key}\" (allowed here: {})",
                    allowed.join(", ")
                ),
            ));
        }
    }
    Ok(())
}

fn finite(v: &Value) -> Option<f64> {
    v.as_f64().filter(|n| n.is_finite())
}

fn opt_number(o: &Map<String, Value>, key: &str, at: &str) -> Result<Option<f64>, String> {
    match o.get(key) {
        None => Ok(None),
        Some(v) => finite(v)
            .map(Some)
            .ok_or_else(|| err(at, format!("\"{key}\" must be a number"))),
    }
}

fn name(o: &Map<String, Value>, key: &str, at: &str) -> Result<Option<String>, String> {
    match o.get(key) {
        None => Ok(None),
        Some(Value::String(s)) if !s.trim().is_empty() => Ok(Some(s.clone())),
        Some(_) => Err(err(
            at,
            format!("\"{key}\" must be a name (a non-empty string)"),
        )),
    }
}

/// A field name, or a path of names joined by dots (`hud.alpha`).
fn field_path(s: &str) -> bool {
    !s.is_empty()
        && s.split('.').all(|part| {
            let mut chars = part.chars();
            matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
                && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        })
}

fn ease(v: Option<&Value>, at: &str) -> Result<Value, String> {
    match v {
        None => Ok(json!("linear")),
        Some(Value::String(s)) if EASES.contains(&s.as_str()) => Ok(json!(s)),
        Some(Value::String(s)) => Err(err(
            at,
            format!("unknown \"ease\" \"{s}\" (use one of {})", EASES.join(", ")),
        )),
        Some(Value::Array(a)) => {
            let n: Vec<f64> = a.iter().filter_map(finite).collect();
            if a.len() != 4 || n.len() != 4 {
                return Err(err(
                    at,
                    "a curve \"ease\" is [x1, y1, x2, y2]: four numbers",
                ));
            }
            if !(0.0..=1.0).contains(&n[0]) || !(0.0..=1.0).contains(&n[2]) {
                return Err(err(
                    at,
                    "a curve \"ease\" [x1, y1, x2, y2] needs x1 and x2 between 0 and 1",
                ));
            }
            Ok(json!(n))
        }
        Some(_) => Err(err(
            at,
            "\"ease\" must be a name like \"out_quad\" or a curve [x1, y1, x2, y2]",
        )),
    }
}

/// Reads and checks one animation file. `file` names it in messages
/// (`animations/door.anim.json.tracks[1].keys[0]: ...`).
pub fn parse_anim(text: &str, file: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| {
        err(
            file,
            format!(
                "not valid JSON (line {}, column {}): {e}",
                e.line(),
                e.column()
            ),
        )
    })?;
    let root = value.as_object().ok_or_else(|| {
        err(
            file,
            "must be a JSON object like {\"version\": 1, \"length\": 1, \"tracks\": []}",
        )
    })?;
    match root.get("version") {
        None => return Err(err(file, "missing \"version\"; add \"version\": 1")),
        Some(v) if v.as_u64() == Some(VERSION) => {}
        Some(v) => {
            return Err(err(
                file,
                format!(
                    "unsupported \"version\" {v}; this Nova understands animation version {VERSION}"
                ),
            ));
        }
    }
    check_keys(
        root,
        file,
        &["version", "length", "loop", "tracks", "notes"],
    )?;
    let looping = match root.get("loop") {
        None => false,
        Some(Value::Bool(b)) => *b,
        Some(_) => return Err(err(file, "\"loop\" must be true or false")),
    };
    let tracks_in = match root.get("tracks") {
        None => Vec::new(),
        Some(Value::Array(a)) => a.clone(),
        Some(_) => return Err(err(file, "\"tracks\" must be a list")),
    };
    if tracks_in.len() > MAX_TRACKS {
        return Err(err(
            file,
            format!(
                "{} tracks is too many (at most {MAX_TRACKS})",
                tracks_in.len()
            ),
        ));
    }
    let mut tracks = Vec::new();
    let mut last_key = 0.0f64;
    for (ti, track) in tracks_in.iter().enumerate() {
        let at = format!("{file}.tracks[{ti}]");
        let t = track
            .as_object()
            .ok_or_else(|| err(&at, "a track must be an object"))?;
        let kind = match t.get("type") {
            None => "value",
            Some(Value::String(s)) if ["value", "event", "sound"].contains(&s.as_str()) => {
                s.as_str()
            }
            Some(v) => {
                return Err(err(
                    &at,
                    format!("unknown track \"type\" {v} (use \"value\", \"event\" or \"sound\")"),
                ));
            }
        };
        let allowed: &[&str] = match kind {
            "value" => &["type", "target", "field", "relative", "keys", "name"],
            "event" => &["type", "target", "keys", "name"],
            _ => &["type", "keys", "name"],
        };
        check_keys(t, &at, allowed)?;
        let target = name(t, "target", &at)?.unwrap_or_else(|| "self".to_string());
        let keys_in = match t.get("keys") {
            None => Vec::new(),
            Some(Value::Array(a)) => a.clone(),
            Some(_) => return Err(err(&at, "\"keys\" must be a list")),
        };
        if keys_in.len() > MAX_KEYS {
            return Err(err(
                &at,
                format!("{} keys is too many (at most {MAX_KEYS})", keys_in.len()),
            ));
        }
        let mut keys: Vec<(f64, Value)> = Vec::new();
        let mut width: Option<usize> = None; // numbers (0) or lists of this many numbers
        for (ki, key) in keys_in.iter().enumerate() {
            let at = format!("{at}.keys[{ki}]");
            let k = key
                .as_object()
                .ok_or_else(|| err(&at, "a key must be an object like {\"time\": 0}"))?;
            let time = opt_number(k, "time", &at)?
                .ok_or_else(|| err(&at, "missing \"time\" (seconds from the start)"))?;
            if time < 0.0 {
                return Err(err(&at, "\"time\" cannot be before 0"));
            }
            last_key = last_key.max(time);
            let out = match kind {
                "value" => {
                    check_keys(k, &at, &["time", "value", "ease"])?;
                    let v = k
                        .get("value")
                        .ok_or_else(|| err(&at, "missing \"value\""))?;
                    let (w, value) = if let Some(n) = finite(v) {
                        (0, json!(n))
                    } else if let Some(a) = v.as_array() {
                        let n: Vec<f64> = a.iter().filter_map(finite).collect();
                        if a.is_empty() || a.len() > 16 || n.len() != a.len() {
                            return Err(err(
                                &at,
                                "\"value\" must be a number or a list of 1 to 16 numbers (a colour is [r, g, b] or [r, g, b, a])",
                            ));
                        }
                        (n.len(), json!(n))
                    } else {
                        return Err(err(&at, "\"value\" must be a number or a list of numbers"));
                    };
                    match width {
                        None => width = Some(w),
                        Some(prev) if prev != w => {
                            return Err(err(
                                &at,
                                "every key of a track needs the same kind of value (all numbers, or all lists of the same length)",
                            ));
                        }
                        _ => {}
                    }
                    json!({ "time": time, "value": value, "ease": ease(k.get("ease"), &at)? })
                }
                "event" => {
                    check_keys(k, &at, &["time", "call", "args"])?;
                    let call = name(k, "call", &at)?.ok_or_else(|| {
                        err(&at, "missing \"call\" (the name of the function to call)")
                    })?;
                    if !field_path(&call) || call.contains('.') {
                        return Err(err(
                            &at,
                            format!(
                                "\"call\" \"{call}\" must be a plain function name (letters, digits and _)"
                            ),
                        ));
                    }
                    let args = match k.get("args") {
                        None => json!([]),
                        Some(Value::Array(a)) if a.iter().all(|v| !v.is_null()) => json!(a),
                        Some(_) => {
                            return Err(err(&at, "\"args\" must be a list of values (no null)"));
                        }
                    };
                    json!({ "time": time, "call": call, "args": args })
                }
                _ => {
                    check_keys(k, &at, &["time", "sound", "volume", "pitch", "pan"])?;
                    let sound = name(k, "sound", &at)?
                        .ok_or_else(|| err(&at, "missing \"sound\" (the sound's name)"))?;
                    let volume = opt_number(k, "volume", &at)?.unwrap_or(1.0);
                    let pitch = opt_number(k, "pitch", &at)?.unwrap_or(1.0);
                    let pan = opt_number(k, "pan", &at)?.unwrap_or(0.0);
                    if !(0.0..=4.0).contains(&volume)
                        || !(0.05..=8.0).contains(&pitch)
                        || !(-1.0..=1.0).contains(&pan)
                    {
                        return Err(err(
                            &at,
                            "\"volume\" is 0 to 4, \"pitch\" 0.05 to 8 and \"pan\" -1 to 1",
                        ));
                    }
                    json!({ "time": time, "sound": sound, "volume": volume, "pitch": pitch, "pan": pan })
                }
            };
            keys.push((time, out));
        }
        // (a stable sort: two keys at the same time keep their order, so a jump can be made of two keys)
        keys.sort_by(|a, b| a.0.total_cmp(&b.0));
        let keys: Vec<Value> = keys.into_iter().map(|(_, k)| k).collect();
        let label = name(t, "name", &at)?;
        let mut out = json!({ "type": kind, "keys": keys });
        let o = out.as_object_mut().expect("an object");
        if let Some(label) = label {
            o.insert("name".into(), json!(label));
        }
        if kind != "sound" {
            o.insert("target".into(), json!(target));
        }
        if kind == "value" {
            let field = name(t, "field", &at)?.ok_or_else(|| {
                err(
                    &at,
                    "missing \"field\" (what to change: x, y, angle, alpha, tint...)",
                )
            })?;
            if !field_path(&field) {
                return Err(err(
                    &at,
                    format!(
                        "\"field\" \"{field}\" must be a name, or names joined by dots (hud.alpha)"
                    ),
                ));
            }
            let relative = match t.get("relative") {
                None => false,
                Some(Value::Bool(b)) => *b,
                Some(_) => return Err(err(&at, "\"relative\" must be true or false")),
            };
            o.insert("field".into(), json!(field));
            o.insert("relative".into(), json!(relative));
        }
        tracks.push(out);
    }
    let length = match opt_number(root, "length", file)? {
        Some(l) => l,
        None => last_key,
    };
    if !(length > 0.0 && length <= MAX_LENGTH) {
        return Err(err(
            file,
            format!("\"length\" must be more than 0 seconds and at most {MAX_LENGTH}"),
        ));
    }
    if last_key > length + 1e-9 {
        return Err(err(
            file,
            format!(
                "a key is at {last_key} s, after the end of the animation (\"length\" {length}); make it longer or move the key"
            ),
        ));
    }
    Ok(json!({ "length": length, "loop": looping, "tracks": tracks }))
}

/// The file an animation's short name points to: `door.open` and `door/open` are `animations/door/open.anim.json`.
pub fn path_of(name: &str) -> String {
    let short = name
        .trim_start_matches(FOLDER)
        .trim_end_matches(SUFFIX)
        .replace('.', "/");
    format!("{FOLDER}{short}{SUFFIX}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(text: &str) -> Value {
        parse_anim(text, "animations/t.anim.json").expect("parses")
    }
    fn bad(text: &str) -> String {
        parse_anim(text, "animations/t.anim.json").expect_err("is rejected")
    }

    #[test]
    fn fills_defaults_and_sorts_keys() {
        let v = ok(r#"{"version":1,"tracks":[
            {"field":"x","keys":[{"time":1,"value":10},{"time":0,"value":0,"ease":"out_back"}]},
            {"type":"event","keys":[{"time":0.5,"call":"ding"}]},
            {"type":"sound","keys":[{"time":0.25,"sound":"door"}]}]}"#);
        assert_eq!(v["length"], json!(1.0), "length defaults to the last key");
        assert_eq!(v["loop"], json!(false));
        let t = &v["tracks"][0];
        assert_eq!(t["target"], json!("self"));
        assert_eq!(t["relative"], json!(false));
        assert_eq!(t["keys"][0]["time"], json!(0.0));
        assert_eq!(t["keys"][0]["ease"], json!("out_back"));
        assert_eq!(t["keys"][1]["ease"], json!("linear"));
        assert_eq!(v["tracks"][1]["keys"][0]["args"], json!([]));
        assert_eq!(v["tracks"][2]["keys"][0]["volume"], json!(1.0));
        assert!(v["tracks"][2].get("target").is_none());
    }

    #[test]
    fn accepts_colours_curves_paths_and_loops() {
        let v = ok(r#"{"version":1,"length":2,"loop":true,"tracks":[
            {"target":"scene","field":"hud.alpha","keys":[{"time":0,"value":0,"ease":[0.4,0,0.2,1]},{"time":2,"value":1}]},
            {"target":"lamp","field":"tint","keys":[{"time":0,"value":[255,255,255]},{"time":1,"value":[255,0,0]}]}]}"#);
        assert_eq!(v["loop"], json!(true));
        assert_eq!(
            v["tracks"][0]["keys"][0]["ease"],
            json!([0.4, 0.0, 0.2, 1.0])
        );
        assert_eq!(v["tracks"][1]["keys"][1]["value"], json!([255.0, 0.0, 0.0]));
    }

    #[test]
    fn explains_mistakes_with_their_place() {
        let cases = [
            (r#"{"tracks":[]}"#, "missing \"version\""),
            (r#"{"version":2}"#, "unsupported \"version\""),
            (r#"{"version":1}"#, "\"length\" must be more than 0"),
            (
                r#"{"version":1,"length":1,"speed":2}"#,
                "unknown key \"speed\"",
            ),
            (
                r#"{"version":1,"length":1,"tracks":[{"keys":[]}]}"#,
                "tracks[0]: missing \"field\"",
            ),
            (
                r#"{"version":1,"length":1,"tracks":[{"field":"x","keys":[{"value":1}]}]}"#,
                "keys[0]: missing \"time\"",
            ),
            (
                r#"{"version":1,"length":1,"tracks":[{"field":"x","keys":[{"time":2,"value":1}]}]}"#,
                "after the end",
            ),
            (
                r#"{"version":1,"length":1,"tracks":[{"field":"x","keys":[{"time":0,"value":1,"ease":"wobbly"}]}]}"#,
                "unknown \"ease\"",
            ),
            (
                r#"{"version":1,"length":1,"tracks":[{"field":"x","keys":[{"time":0,"value":1,"ease":[2,0,0,1]}]}]}"#,
                "x1 and x2",
            ),
            (
                r#"{"version":1,"length":1,"tracks":[{"field":"x","keys":[{"time":0,"value":1},{"time":1,"value":[1,2]}]}]}"#,
                "keys[1]: every key",
            ),
            (
                r#"{"version":1,"length":1,"tracks":[{"field":"2x","keys":[]}]}"#,
                "\"field\" \"2x\"",
            ),
            (
                r#"{"version":1,"length":1,"tracks":[{"type":"event","keys":[{"time":0,"call":"a.b"}]}]}"#,
                "plain function name",
            ),
            (
                r#"{"version":1,"length":1,"tracks":[{"type":"sound","keys":[{"time":0}]}]}"#,
                "missing \"sound\"",
            ),
            (
                r#"{"version":1,"length":1,"tracks":[{"type":"sound","target":"x","keys":[]}]}"#,
                "unknown key \"target\"",
            ),
            (
                r#"{"version":1,"length":1,"tracks":[{"type":"dance"}]}"#,
                "unknown track \"type\"",
            ),
            (
                r#"{"version":1,"length":1,"tracks":[{"field":"x","keys":[{"time":-1,"value":0}]}]}"#,
                "before 0",
            ),
            ("{", "not valid JSON"),
        ];
        for (text, want) in cases {
            let e = bad(text);
            assert!(e.starts_with("animations/t.anim.json"), "{e}");
            assert!(e.contains(want), "{text}: wanted {want:?} in {e:?}");
        }
    }

    #[test]
    fn short_names_point_into_the_animations_folder() {
        assert_eq!(path_of("door_open"), "animations/door_open.anim.json");
        assert_eq!(path_of("menus.slide"), "animations/menus/slide.anim.json");
        assert_eq!(path_of("animations/a.anim.json"), "animations/a.anim.json");
    }

    #[test]
    fn the_lua_player_knows_every_easing() {
        let lua = include_str!("../lua/timers.lua");
        for e in EASES.iter().filter(|e| **e != "step") {
            assert!(
                lua.contains(&format!("  {e} = ")),
                "lua/timers.lua has no easing {e}"
            );
        }
    }
}
