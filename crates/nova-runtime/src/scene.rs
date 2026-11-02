//! Scene data: `scenes/<name>.scene.json`, format version 1.
//!
//! A scene file is *data*: loading it never runs code. It places objects (entities made
//! from `entities/<kind>.lua`), pictures and texts, and sets the background. The scene's
//! Lua code lives beside it in `scenes/<name>.lua`; anything given a `name` becomes a
//! field of that scene (`self.player`). The studio will edit these files; hand edits are fine.
//!
//! ```json
//! {
//!   "version": 1,
//!   "background": [130, 178, 232],
//!   "width": 1200, "height": 540,
//!   "objects":  [ { "kind": "player", "name": "hero", "x": 40, "y": 200, "props": { "hp": 3 } } ],
//!   "images":   [ { "image": "sprites/cloud.png", "x": 100, "y": 40, "scale": 2, "depth": 50 } ],
//!   "texts":    [ { "text": "HELLO", "x": 8, "y": 8, "scale": 3, "color": [255, 255, 255] } ]
//! }
//! ```

use serde_json::{Map, Number, Value};

pub const VERSION: u64 = 1;

fn err(path: &str, message: impl std::fmt::Display) -> String {
    format!("{path}: {message}")
}

fn number(v: &Value, at: &str, what: &str) -> Result<f64, String> {
    v.as_f64()
        .filter(|n| n.is_finite())
        .ok_or_else(|| err(at, format!("{what} must be a number")))
}

fn optional_number(
    o: &Map<String, Value>,
    key: &str,
    at: &str,
    default: f64,
) -> Result<f64, String> {
    match o.get(key) {
        None => Ok(default),
        Some(v) => number(v, &format!("{at}.{key}"), &format!("\"{key}\"")),
    }
}

fn string<'a>(o: &'a Map<String, Value>, key: &str, at: &str) -> Result<&'a str, String> {
    match o.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Ok(s),
        Some(_) => Err(err(
            &format!("{at}.{key}"),
            format!("\"{key}\" must be a non-empty string"),
        )),
        None => Err(err(at, format!("missing \"{key}\""))),
    }
}

fn optional_name(o: &Map<String, Value>, at: &str) -> Result<Option<String>, String> {
    match o.get("name") {
        None => Ok(None),
        Some(Value::String(s)) => {
            let mut chars = s.chars();
            let ok = chars
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                && chars.all(|c| c.is_ascii_alphanumeric() || c == '_');
            if ok {
                Ok(Some(s.clone()))
            } else {
                Err(err(
                    &format!("{at}.name"),
                    format!(
                        "\"{s}\" is not a valid name; use letters, digits and underscores, starting with a letter"
                    ),
                ))
            }
        }
        Some(_) => Err(err(&format!("{at}.name"), "\"name\" must be a string")),
    }
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

fn color(v: Option<&Value>, at: &str) -> Result<Option<Value>, String> {
    let Some(v) = v else { return Ok(None) };
    let list = v
        .as_array()
        .filter(|a| (3..=4).contains(&a.len()))
        .ok_or_else(|| {
            err(
                at,
                "\"color\" must be [r, g, b] or [r, g, b, a], each 0 to 255",
            )
        })?;
    let mut out = Vec::with_capacity(4);
    for (i, c) in list.iter().enumerate() {
        let n = c
            .as_f64()
            .filter(|n| (0.0..=255.0).contains(n))
            .ok_or_else(|| {
                err(
                    &format!("{at}[{i}]"),
                    "colour channels must be numbers from 0 to 255",
                )
            })?;
        out.push(Value::Number(Number::from_f64(n.round()).expect("finite")));
    }
    Ok(Some(Value::Array(out)))
}

fn num(n: f64) -> Value {
    Value::Number(Number::from_f64(n).expect("finite"))
}

/// Validates a scene file and returns it with defaults filled in (every object has
/// `x`, `y`, `z`; every image has `scale`, `depth`, `layer`; and so on). `file` is only
/// used in messages.
pub fn parse_scene(text: &str, file: &str) -> Result<Value, String> {
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
            "must be a JSON object like {\"version\": 1, \"objects\": []}",
        )
    })?;
    match root.get("version") {
        None => return Err(err(file, "missing \"version\"; add \"version\": 1")),
        Some(v) if v.as_u64() == Some(VERSION) => {}
        Some(v) => {
            return Err(err(
                file,
                format!(
                    "unsupported \"version\" {v}; this Nova understands scene version {VERSION}"
                ),
            ));
        }
    }
    check_keys(
        root,
        file,
        &[
            "version",
            "background",
            "width",
            "height",
            "objects",
            "images",
            "texts",
        ],
    )?;

    let mut out = Map::new();
    out.insert("version".into(), Value::Number(VERSION.into()));
    if let Some(bg) = color(root.get("background"), &format!("{file}.background"))? {
        out.insert("background".into(), bg);
    }
    for key in ["width", "height"] {
        if let Some(v) = root.get(key) {
            let n = number(v, &format!("{file}.{key}"), &format!("\"{key}\""))?;
            if n <= 0.0 {
                return Err(err(
                    &format!("{file}.{key}"),
                    format!("\"{key}\" must be greater than 0"),
                ));
            }
            out.insert(key.into(), num(n));
        }
    }

    let list = |key: &str| -> Result<Vec<&Value>, String> {
        match root.get(key) {
            None => Ok(vec![]),
            Some(Value::Array(a)) => Ok(a.iter().collect()),
            Some(_) => Err(err(
                &format!("{file}.{key}"),
                format!("\"{key}\" must be a list"),
            )),
        }
    };

    let mut names: Vec<String> = Vec::new();
    let mut take_name = |name: &Option<String>, at: &str| -> Result<(), String> {
        if let Some(n) = name {
            if names.contains(n) {
                return Err(err(
                    at,
                    format!("the name \"{n}\" is used twice in this scene"),
                ));
            }
            names.push(n.clone());
        }
        Ok(())
    };

    let mut objects = Vec::new();
    for (i, item) in list("objects")?.into_iter().enumerate() {
        let at = format!("{file}.objects[{i}]");
        let o = item
            .as_object()
            .ok_or_else(|| err(&at, "each object must be a JSON object"))?;
        check_keys(o, &at, &["kind", "name", "x", "y", "z", "props"])?;
        let kind = string(o, "kind", &at)?;
        let name = optional_name(o, &at)?;
        take_name(&name, &at)?;
        let mut obj = Map::new();
        obj.insert("kind".into(), Value::String(kind.to_string()));
        if let Some(n) = name {
            obj.insert("name".into(), Value::String(n));
        }
        for key in ["x", "y", "z"] {
            obj.insert(key.into(), num(optional_number(o, key, &at, 0.0)?));
        }
        match o.get("props") {
            None => {}
            Some(Value::Object(p)) => {
                obj.insert("props".into(), Value::Object(p.clone()));
            }
            Some(_) => {
                return Err(err(
                    &format!("{at}.props"),
                    "\"props\" must be an object of field values",
                ));
            }
        }
        objects.push(Value::Object(obj));
    }
    out.insert("objects".into(), Value::Array(objects));

    let mut images = Vec::new();
    for (i, item) in list("images")?.into_iter().enumerate() {
        let at = format!("{file}.images[{i}]");
        let o = item
            .as_object()
            .ok_or_else(|| err(&at, "each image must be a JSON object"))?;
        check_keys(
            o,
            &at,
            &[
                "image", "name", "x", "y", "scale", "depth", "layer", "color",
            ],
        )?;
        let image = string(o, "image", &at)?;
        let name = optional_name(o, &at)?;
        take_name(&name, &at)?;
        let layer = match o.get("layer") {
            None => "world",
            Some(Value::String(s)) if s == "world" || s == "ui" => s.as_str(),
            Some(_) => {
                return Err(err(
                    &format!("{at}.layer"),
                    "\"layer\" must be \"world\" or \"ui\"",
                ));
            }
        };
        let mut obj = Map::new();
        obj.insert("image".into(), Value::String(image.to_string()));
        if let Some(n) = name {
            obj.insert("name".into(), Value::String(n));
        }
        obj.insert("x".into(), num(optional_number(o, "x", &at, 0.0)?));
        obj.insert("y".into(), num(optional_number(o, "y", &at, 0.0)?));
        obj.insert("scale".into(), num(optional_number(o, "scale", &at, 1.0)?));
        obj.insert("depth".into(), num(optional_number(o, "depth", &at, 0.0)?));
        obj.insert("layer".into(), Value::String(layer.to_string()));
        if let Some(c) = color(o.get("color"), &format!("{at}.color"))? {
            obj.insert("color".into(), c);
        }
        images.push(Value::Object(obj));
    }
    out.insert("images".into(), Value::Array(images));

    let mut texts = Vec::new();
    for (i, item) in list("texts")?.into_iter().enumerate() {
        let at = format!("{file}.texts[{i}]");
        let o = item
            .as_object()
            .ok_or_else(|| err(&at, "each text must be a JSON object"))?;
        check_keys(
            o,
            &at,
            &["text", "name", "x", "y", "scale", "depth", "color"],
        )?;
        let text = string(o, "text", &at)?;
        let name = optional_name(o, &at)?;
        take_name(&name, &at)?;
        let mut obj = Map::new();
        obj.insert("text".into(), Value::String(text.to_string()));
        if let Some(n) = name {
            obj.insert("name".into(), Value::String(n));
        }
        obj.insert("x".into(), num(optional_number(o, "x", &at, 0.0)?));
        obj.insert("y".into(), num(optional_number(o, "y", &at, 0.0)?));
        obj.insert("scale".into(), num(optional_number(o, "scale", &at, 2.0)?));
        obj.insert(
            "depth".into(),
            num(optional_number(o, "depth", &at, -10.0)?),
        );
        if let Some(c) = color(o.get("color"), &format!("{at}.color"))? {
            obj.insert("color".into(), c);
        }
        texts.push(Value::Object(obj));
    }
    out.insert("texts".into(), Value::Array(texts));

    Ok(Value::Object(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> Result<Value, String> {
        parse_scene(text, "scenes/t.scene.json")
    }

    #[test]
    fn minimal_scene_gets_empty_lists() {
        let v = parse(r#"{"version":1}"#).unwrap();
        assert_eq!(v["objects"], serde_json::json!([]));
        assert_eq!(v["images"], serde_json::json!([]));
        assert_eq!(v["texts"], serde_json::json!([]));
    }

    #[test]
    fn full_scene_is_validated_and_defaults_are_filled() {
        let v = parse(
            r#"{"version":1,"background":[1,2,3],"width":1200,"height":540,
                "objects":[{"kind":"player","name":"hero","x":10,"y":20,"props":{"hp":3}},{"kind":"crate"}],
                "images":[{"image":"a.png","x":1,"y":2,"layer":"ui","color":[255,0,0,128]}],
                "texts":[{"text":"HI","name":"title"}]}"#,
        )
        .unwrap();
        assert_eq!(v["background"], serde_json::json!([1.0, 2.0, 3.0]));
        assert_eq!(v["objects"][0]["props"]["hp"], 3);
        assert_eq!(v["objects"][1]["x"].as_f64(), Some(0.0), "x defaults to 0");
        assert_eq!(v["images"][0]["layer"], "ui");
        assert_eq!(v["images"][0]["scale"].as_f64(), Some(1.0));
        assert_eq!(v["texts"][0]["scale"].as_f64(), Some(2.0));
        assert_eq!(v["texts"][0]["depth"].as_f64(), Some(-10.0));
    }

    #[test]
    fn malformed_scenes_name_the_exact_problem() {
        let cases: &[(&str, &str)] = &[
            ("{ nope", "not valid JSON"),
            ("[]", "must be a JSON object"),
            (r#"{}"#, "missing \"version\""),
            (r#"{"version":2}"#, "unsupported \"version\" 2"),
            (
                r#"{"version":1,"colour":[1,2,3]}"#,
                "unknown key \"colour\"",
            ),
            (r#"{"version":1,"background":[1,2]}"#, "[r, g, b]"),
            (r#"{"version":1,"background":[1,2,999]}"#, "background[2]"),
            (r#"{"version":1,"width":0}"#, "greater than 0"),
            (
                r#"{"version":1,"objects":{}}"#,
                "\"objects\" must be a list",
            ),
            (r#"{"version":1,"objects":[3]}"#, "objects[0]: each object"),
            (
                r#"{"version":1,"objects":[{"x":1}]}"#,
                "objects[0]: missing \"kind\"",
            ),
            (
                r#"{"version":1,"objects":[{"kind":""}]}"#,
                "objects[0].kind",
            ),
            (
                r#"{"version":1,"objects":[{"kind":"a","x":"left"}]}"#,
                "objects[0].x: \"x\" must be a number",
            ),
            (
                r#"{"version":1,"objects":[{"kind":"a","bogus":1}]}"#,
                "unknown key \"bogus\"",
            ),
            (
                r#"{"version":1,"objects":[{"kind":"a","props":[]}]}"#,
                "objects[0].props",
            ),
            (
                r#"{"version":1,"objects":[{"kind":"a","name":"1bad"}]}"#,
                "not a valid name",
            ),
            (
                r#"{"version":1,"objects":[{"kind":"a","name":"p"},{"kind":"b","name":"p"}]}"#,
                "used twice",
            ),
            (
                r#"{"version":1,"images":[{"x":1}]}"#,
                "images[0]: missing \"image\"",
            ),
            (
                r#"{"version":1,"images":[{"image":"a.png","layer":"sky"}]}"#,
                "images[0].layer",
            ),
            (
                r#"{"version":1,"texts":[{"x":1}]}"#,
                "texts[0]: missing \"text\"",
            ),
        ];
        for (text, expected) in cases {
            let e = parse(text)
                .err()
                .unwrap_or_else(|| format!("accepted {text}"));
            assert!(
                e.contains(expected),
                "scene {text}: expected '{expected}' in '{e}'"
            );
            assert!(
                e.starts_with("scenes/t.scene.json"),
                "messages begin with the file: {e}"
            );
        }
    }
}
