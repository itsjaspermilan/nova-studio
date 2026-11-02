//! Structured problems: turns the runtime's error messages into `{ file, line, place, message }`
//! so the studio can list them, jump to them and underline them in the editor.
//!
//! Messages come in a few shapes, all produced by this crate:
//! - Lua: `runtime error: scenes/play.lua:8: bad argument ...` (plus a traceback), or
//!   `syntax error: scenes/s.lua:3: ']' expected near ','`
//! - data files: `scenes/t.scene.json.objects[0]: missing "kind"`, `nova.json.input.fire[0]: ...`,
//!   `sprites/hero.sprite.json: not valid JSON (line 3, column 5): ...`
//! - assets: `art/broken.png: not a readable PNG`, `fonts/x.ttf: not a usable font`
//! - whole-project problems with no file (`no nova.json found`)

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Diagnostic {
    pub severity: &'static str,
    /// Project-relative path, when the message names one.
    pub file: Option<String>,
    /// 1-based line, when known.
    pub line: Option<u32>,
    /// Where inside a data file (`objects[0].kind`), when known.
    pub place: Option<String>,
    /// The message without the location prefix (first line only).
    pub message: String,
    /// The complete original text, including any Lua traceback.
    pub detail: String,
}

/// A project-relative path that stays inside the project (no `..`, not absolute).
fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains(':')
        && !path.contains('\\')
        && path.split('/').all(|part| part != ".." && !part.is_empty())
}

fn is_path_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/' | ' ')
}

/// The first `path.lua:LINE:` in the text that is a project file (the framework's own chunks
/// are named `nova.framework` and never end in `.lua`).
fn lua_location(text: &str) -> Option<(String, u32, usize)> {
    let mut search = 0;
    while let Some(found) = text[search..].find(".lua:") {
        let end = search + found + 4; // index of ':' after ".lua"
        let start = text[..end]
            .rfind(|c: char| !is_path_char(c))
            .map_or(0, |i| i + 1);
        let path = text[start..end].trim_start();
        let digits: String = text[end + 1..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        if safe_path(path)
            && let Ok(line) = digits.parse()
        {
            return Some((path.to_string(), line, end + 1 + digits.len()));
        }
        search = end;
    }
    None
}

fn json_line(text: &str) -> Option<u32> {
    let at = text.find("(line ")? + 6;
    let digits: String = text[at..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

/// Splits `file[.place]: message` at the first `": "` when the head looks like a project path.
fn data_location(text: &str) -> Option<(String, Option<String>, String)> {
    let (head, rest) = text.split_once(": ")?;
    if head.is_empty() || head.contains(' ') || head.len() > 200 {
        return None;
    }
    let is_file = |s: &str| {
        [
            ".json", ".png", ".ttf", ".otf", ".wav", ".glb", ".lua", ".npk",
        ]
        .iter()
        .any(|ext| s.ends_with(ext))
    };
    if let Some(i) = head.find(".json") {
        let file = &head[..i + 5];
        let place = head[i + 5..].trim_start_matches('.');
        return Some((
            file.to_string(),
            (!place.is_empty()).then(|| place.to_string()),
            rest.to_string(),
        ));
    }
    if is_file(head) {
        return Some((head.to_string(), None, rest.to_string()));
    }
    None
}

pub fn parse(message: &str, severity: &'static str) -> Diagnostic {
    let detail = message.to_string();
    let first = message.lines().next().unwrap_or("").trim();

    if let Some((file, line, after)) = lua_location(message) {
        // The location is in the first line ("runtime error: scenes/play.lua:8: bad argument")
        // or only in the traceback below it; in that case the first line is the message.
        let first_end = message.find('\n').unwrap_or(message.len());
        let text = if after <= first_end {
            message[after..first_end]
                .trim_start_matches(':')
                .trim()
                .to_string()
        } else {
            first
                .strip_prefix("runtime error:")
                .or_else(|| first.strip_prefix("syntax error:"))
                .unwrap_or(first)
                .trim()
                .to_string()
        };
        let text = if text.is_empty() {
            first.to_string()
        } else {
            text
        };
        return Diagnostic {
            severity,
            file: Some(file),
            line: Some(line),
            place: None,
            message: text,
            detail,
        };
    }
    // Errors raised from Lua arrive as "runtime error: <message>"; the message may itself start with a path.
    let bare = first
        .strip_prefix("runtime error:")
        .or_else(|| first.strip_prefix("syntax error:"))
        .unwrap_or(first)
        .trim();
    if let Some((file, place, rest)) = data_location(bare).filter(|(f, _, _)| safe_path(f)) {
        return Diagnostic {
            severity,
            file: Some(file),
            line: json_line(first),
            place,
            message: rest,
            detail,
        };
    }
    Diagnostic {
        severity,
        file: None,
        line: None,
        place: None,
        message: first.to_string(),
        detail,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lua_runtime_errors_give_file_line_and_message() {
        let d = parse(
            "runtime error: scenes/play.lua:8: bad argument #2 to 'random' (number has no integer representation)\nstack traceback:\n\t[C]: in function 'math.random'\n\tscenes/play.lua:8: in method 'enter'",
            "error",
        );
        assert_eq!(d.file.as_deref(), Some("scenes/play.lua"));
        assert_eq!(d.line, Some(8));
        assert!(
            d.message.starts_with("bad argument #2 to 'random'"),
            "{}",
            d.message
        );
        assert!(d.detail.contains("stack traceback"));
    }

    #[test]
    fn when_only_the_traceback_has_the_location_the_message_is_the_first_line() {
        let d = parse(
            "runtime error: unknown image 'nope' (looked for 'nope')\nstack traceback:\n\t[C]: in field 'sprite'\n\tscenes/s.lua:3: in method 'enter'\n\tnova.framework:822: in upvalue 'enter_scene'",
            "error",
        );
        assert_eq!((d.file.as_deref(), d.line), (Some("scenes/s.lua"), Some(3)));
        assert_eq!(d.message, "unknown image 'nope' (looked for 'nope')");
    }

    #[test]
    fn framework_frames_are_skipped_in_favour_of_the_project_frame_in_the_traceback() {
        let d = parse(
            "runtime error: nova.framework:358: sprite 'hero' not found\nstack traceback:\n\t[C]: in ?\n\tnova.framework:358: in function <nova.framework:355>\n\tentities/hero.lua:12: in method 'draw'",
            "error",
        );
        assert_eq!(d.file.as_deref(), Some("entities/hero.lua"));
        assert_eq!(d.line, Some(12));
    }

    #[test]
    fn syntax_errors_and_main_chunk_errors_parse() {
        let d = parse(
            "syntax error: scenes/s.lua:3: ']' expected near ','",
            "error",
        );
        assert_eq!((d.file.as_deref(), d.line), (Some("scenes/s.lua"), Some(3)));
        assert_eq!(d.message, "']' expected near ','");
        let d = parse(
            "syntax error: main.lua:1: unexpected symbol near 'this'",
            "error",
        );
        assert_eq!((d.file.as_deref(), d.line), (Some("main.lua"), Some(1)));
    }

    #[test]
    fn data_file_errors_give_the_file_the_place_and_the_json_line() {
        let d = parse("scenes/t.scene.json.objects[0]: missing \"kind\"", "error");
        assert_eq!(d.file.as_deref(), Some("scenes/t.scene.json"));
        assert_eq!(d.place.as_deref(), Some("objects[0]"));
        assert_eq!(d.message, "missing \"kind\"");

        let d = parse("nova.json.input.fire[0]: 'Nope' is not a key name", "error");
        assert_eq!(
            (d.file.as_deref(), d.place.as_deref()),
            (Some("nova.json"), Some("input.fire[0]"))
        );

        let d = parse(
            "sprites/hero.sprite.json: not valid JSON (line 3, column 5): expected value",
            "error",
        );
        assert_eq!(
            (d.file.as_deref(), d.line, d.place.as_deref()),
            (Some("sprites/hero.sprite.json"), Some(3), None)
        );

        let d = parse("nova.json: missing \"format\"; add \"format\": 1", "error");
        assert_eq!(d.file.as_deref(), Some("nova.json"));
    }

    #[test]
    fn data_errors_raised_from_lua_keep_their_file_despite_the_runtime_error_prefix() {
        let d = parse(
            "runtime error: scenes/s.scene.json.objects[0]: missing \"kind\"\nstack traceback:\n\t[C]: in field 'scene_data'\n\tnova.framework:820: in upvalue 'enter_scene'",
            "error",
        );
        assert_eq!(d.file.as_deref(), Some("scenes/s.scene.json"));
        assert_eq!(d.place.as_deref(), Some("objects[0]"));
        assert_eq!(d.message, "missing \"kind\"");
    }

    #[test]
    fn asset_errors_name_the_file() {
        for (text, file) in [
            (
                "art/broken.png: not a readable PNG: bad header",
                "art/broken.png",
            ),
            ("fonts/x.ttf: not a usable font: bad", "fonts/x.ttf"),
            ("sounds/s.wav: not a readable WAV file", "sounds/s.wav"),
            ("models/m.glb: glTF import failed: x", "models/m.glb"),
        ] {
            assert_eq!(parse(text, "error").file.as_deref(), Some(file), "{text}");
        }
    }

    #[test]
    fn project_wide_problems_have_no_file() {
        let d = parse(
            "no nova.json found. A Nova project is a folder with a nova.json file, for example:\n  {\"format\": 1}",
            "error",
        );
        assert_eq!((d.file, d.line), (None, None));
        assert!(d.message.starts_with("no nova.json found"));
        let d = parse(
            "the script ran for too long in one frame; is there an endless loop?",
            "warning",
        );
        assert_eq!((d.file, d.severity), (None, "warning"));
    }

    #[test]
    fn odd_inputs_never_panic() {
        for text in [
            "",
            ":",
            ".lua:",
            "x.lua:9",
            "a.lua:b:",
            ".json: x",
            "../../x.lua:3: nope",
            "\n\n",
        ] {
            let _ = parse(text, "error");
        }
        assert_eq!(
            parse("../../x.lua:3: nope", "error").file,
            None,
            "paths that leave the project are not trusted"
        );
    }
}
