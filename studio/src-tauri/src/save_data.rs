//! The save-data inspector's backend: where this project's `save.json` lives on this computer (the same place `nova run` keeps it:
//! `<data home>/Nova/<slug of the game's name>/save.json`, see `crates/nova-runtime/src/save.rs`), reading it, writing it back after a check, and
//! setting it aside so the game starts fresh. Saves written by a game on another device are not here.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

/// The same limit the runtime applies when it writes a save.
const MAX_BYTES: usize = 1 << 20;

/// What the runtime does to a game's name to make a folder name (kept in step with `save::default_dir`).
pub fn slug(game_name: &str) -> String {
    let s: String = game_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if s.is_empty() { "game".to_string() } else { s }
}

fn data_home() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    if cfg!(target_os = "macos") {
        Some(home?.join("Library/Application Support"))
    } else if cfg!(target_os = "windows") {
        Some(PathBuf::from(std::env::var_os("APPDATA")?))
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| home.map(|h| h.join(".local/share")))
    }
}

/// The folder a game's save is kept in on this computer.
pub fn save_folder(game_name: &str) -> Option<PathBuf> {
    Some(data_home()?.join("Nova").join(slug(game_name)))
}

fn game_name(root: &Path) -> Result<String, String> {
    let text =
        std::fs::read_to_string(root.join("nova.json")).map_err(|e| format!("nova.json: {e}"))?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("nova.json: {e}"))?;
    v.get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "nova.json has no name".to_string())
}

#[derive(Serialize, Debug, PartialEq)]
pub struct SaveInfo {
    /// The folder, for showing the person where it is.
    pub folder: String,
    pub exists: bool,
    /// The file's text (pretty-printed when it is valid), empty when there is none.
    pub text: String,
    /// Files set aside earlier (`save.json.corrupt-…`, `save.json.reset-…`), newest last.
    pub aside: Vec<String>,
}

fn info(folder: &Path) -> Result<SaveInfo, String> {
    let file = folder.join("save.json");
    let (exists, text) = match std::fs::read_to_string(&file) {
        Ok(t) => {
            let pretty = serde_json::from_str::<Value>(&t)
                .ok()
                .and_then(|v| serde_json::to_string_pretty(&v).ok())
                .unwrap_or(t);
            (true, pretty)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (false, String::new()),
        Err(e) => return Err(format!("{}: {e}", file.display())),
    };
    let mut aside: Vec<String> = std::fs::read_dir(folder)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| {
                    n.starts_with("save.json.corrupt-") || n.starts_with("save.json.reset-")
                })
                .collect()
        })
        .unwrap_or_default();
    aside.sort();
    Ok(SaveInfo {
        folder: folder.display().to_string(),
        exists,
        text,
        aside,
    })
}

pub fn read(root: &Path) -> Result<SaveInfo, String> {
    let folder =
        save_folder(&game_name(root)?).ok_or("this computer gives no folder for save data")?;
    read_in(&folder)
}

pub fn read_in(folder: &Path) -> Result<SaveInfo, String> {
    info(folder)
}

/// Checks that a text is a save the runtime would accept: valid JSON, `format` 1, an object `data`, within the size limit.
pub fn check(text: &str) -> Result<Value, String> {
    if text.len() > MAX_BYTES {
        return Err(format!("A save may be at most {} KiB.", MAX_BYTES / 1024));
    }
    let v: Value = serde_json::from_str(text).map_err(|e| format!("Not valid JSON: {e}"))?;
    let obj = v.as_object().ok_or("A save is an object.")?;
    match obj.get("format").and_then(Value::as_u64) {
        Some(1) => {}
        other => {
            return Err(format!(
                "\"format\" must be 1 (it is {}).",
                other.map_or("missing".to_string(), |n| n.to_string())
            ));
        }
    }
    if !obj.get("data").is_some_and(Value::is_object) {
        return Err("\"data\" must be an object of values.".into());
    }
    Ok(v)
}

/// Writes the save the safe way (a temporary file, then a rename) after checking it. The old file is kept as `save.json.reset-<n>` first.
pub fn write_in(folder: &Path, text: &str, stamp: u64) -> Result<(), String> {
    let v = check(text)?;
    std::fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let file = folder.join("save.json");
    if file.exists() {
        std::fs::copy(&file, folder.join(format!("save.json.reset-{stamp}")))
            .map_err(|e| e.to_string())?;
    }
    let tmp = folder.join("save.json.tmp");
    std::fs::write(&tmp, serde_json::to_string(&v).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

pub fn write(root: &Path, text: &str) -> Result<(), String> {
    let folder =
        save_folder(&game_name(root)?).ok_or("this computer gives no folder for save data")?;
    write_in(&folder, text, now())
}

/// Moves the save aside (`save.json.reset-<n>`) so the game starts with none. Nothing is deleted.
pub fn reset_in(folder: &Path, stamp: u64) -> Result<bool, String> {
    let file = folder.join("save.json");
    if !file.exists() {
        return Ok(false);
    }
    std::fs::rename(&file, folder.join(format!("save.json.reset-{stamp}")))
        .map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn reset(root: &Path) -> Result<bool, String> {
    let folder =
        save_folder(&game_name(root)?).ok_or("this computer gives no folder for save data")?;
    reset_in(&folder, now())
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("nova-save-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn the_folder_name_is_made_the_way_the_runtime_makes_it() {
        assert_eq!(slug("Pine Ridge Rally"), "pine-ridge-rally");
        assert_eq!(slug("  Ünï!  "), "n");
        assert_eq!(slug("???"), "game");
    }

    #[test]
    fn only_a_save_the_runtime_would_accept_can_be_written() {
        assert!(check(r#"{"format":1,"data":{"best":3}}"#).is_ok());
        assert!(check("{ nope").unwrap_err().contains("JSON"));
        assert!(check(r#"{"data":{}}"#).unwrap_err().contains("format"));
        assert!(
            check(r#"{"format":2,"data":{}}"#)
                .unwrap_err()
                .contains("format")
        );
        assert!(check(r#"{"format":1}"#).unwrap_err().contains("data"));
        assert!(check(r#"[1]"#).is_err());
        let big = format!(
            r#"{{"format":1,"data":{{"x":"{}"}}}}"#,
            "a".repeat(MAX_BYTES)
        );
        assert!(check(&big).unwrap_err().contains("KiB"));
    }

    #[test]
    fn reading_writing_and_resetting_keep_the_old_file() {
        let dir = scratch("flow");
        let none = read_in(&dir).unwrap();
        assert!(!none.exists && none.text.is_empty());
        write_in(&dir, r#"{"format":1,"data":{"best":3}}"#, 1).unwrap();
        let first = read_in(&dir).unwrap();
        assert!(
            first.exists && first.text.contains("\"best\": 3"),
            "{}",
            first.text
        );
        write_in(&dir, r#"{"format":1,"data":{"best":9}}"#, 2).unwrap();
        assert_eq!(
            read_in(&dir).unwrap().aside,
            vec!["save.json.reset-2".to_string()]
        );
        assert!(
            std::fs::read_to_string(dir.join("save.json.reset-2"))
                .unwrap()
                .contains("3")
        );
        assert!(write_in(&dir, "{ nope", 3).is_err());
        assert!(
            read_in(&dir).unwrap().text.contains("9"),
            "a refused write leaves the save alone"
        );
        assert!(reset_in(&dir, 4).unwrap());
        assert!(!read_in(&dir).unwrap().exists);
        assert!(!reset_in(&dir, 5).unwrap());
        assert!(dir.join("save.json.reset-4").exists());
    }

    #[test]
    fn a_damaged_save_is_shown_as_it_is() {
        let dir = scratch("bad");
        std::fs::write(dir.join("save.json"), "{ nope").unwrap();
        let i = read_in(&dir).unwrap();
        assert!(i.exists);
        assert_eq!(i.text, "{ nope");
    }
}
