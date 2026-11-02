//! Project-scoped save data: one small JSON file per game.
//!
//! Scripts keep named values (`nova.save.set("best", 12)`); the store holds them and
//! writes `save.json` atomically (a temporary file in the same folder, then a rename), so
//! a crash or a power cut mid-write cannot leave half a file. A save that cannot be read is
//! set aside as `save.json.corrupt-<time>` and the game starts with an empty one, so a damaged
//! file never stops a game from starting.

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

pub const FORMAT: u64 = 1;
pub const MAX_BYTES: usize = 1 << 20;
pub const MAX_KEY_CHARS: usize = 128;

#[derive(Debug)]
pub struct SaveStore {
    path: Option<PathBuf>,
    data: Map<String, Value>,
    dirty: bool,
}

fn check_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.chars().count() > MAX_KEY_CHARS {
        return Err(format!("save keys must be 1 to {MAX_KEY_CHARS} characters"));
    }
    Ok(())
}

impl SaveStore {
    /// A store that is never written to disk (headless runs and tests).
    pub fn memory() -> Self {
        Self {
            path: None,
            data: Map::new(),
            dirty: false,
        }
    }

    /// Opens `<dir>/save.json`, creating the folder when needed. Returns the store and a
    /// warning when an unreadable save was set aside.
    pub fn open(dir: &Path) -> Result<(Self, Option<String>), String> {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("cannot create the save folder '{}': {e}", dir.display()))?;
        let path = dir.join("save.json");
        let mut warning = None;
        let data = match std::fs::read_to_string(&path) {
            Ok(text) => match parse(&text) {
                Ok(data) => data,
                Err(reason) => {
                    let stamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let aside = dir.join(format!("save.json.corrupt-{stamp}"));
                    let moved = std::fs::rename(&path, &aside).is_ok();
                    warning = Some(format!(
                        "the save file could not be read ({reason}); {} and started a new one",
                        if moved {
                            format!("it was kept as '{}'", aside.display())
                        } else {
                            "it was ignored".into()
                        }
                    ));
                    Map::new()
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Map::new(),
            Err(e) => return Err(format!("cannot read '{}': {e}", path.display())),
        };
        Ok((
            Self {
                path: Some(path),
                data,
                dirty: false,
            },
            warning,
        ))
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.data.get(key)
    }

    pub fn keys(&self) -> Vec<&str> {
        self.data.keys().map(String::as_str).collect()
    }

    pub fn set(&mut self, key: &str, value: Value) -> Result<(), String> {
        check_key(key)?;
        let previous = self.data.insert(key.to_string(), value);
        if self.serialized().len() > MAX_BYTES {
            match previous {
                Some(old) => self.data.insert(key.to_string(), old),
                None => self.data.remove(key),
            };
            return Err(format!(
                "saving '{key}' would make the save file bigger than {} KiB",
                MAX_BYTES >> 10
            ));
        }
        self.dirty = true;
        Ok(())
    }

    pub fn delete(&mut self, key: &str) {
        if self.data.remove(key).is_some() {
            self.dirty = true;
        }
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    fn serialized(&self) -> Vec<u8> {
        let mut root = Map::new();
        root.insert("format".into(), Value::Number(FORMAT.into()));
        root.insert("data".into(), Value::Object(self.data.clone()));
        serde_json::to_vec_pretty(&Value::Object(root)).expect("JSON values always serialise")
    }

    /// Writes the file if anything changed. Does nothing for an in-memory store.
    pub fn flush(&mut self) -> Result<(), String> {
        let Some(path) = &self.path else {
            self.dirty = false;
            return Ok(());
        };
        if !self.dirty {
            return Ok(());
        }
        let temp = path.with_extension("json.tmp");
        std::fs::write(&temp, self.serialized())
            .map_err(|e| format!("cannot write the save file: {e}"))?;
        std::fs::rename(&temp, path).map_err(|e| format!("cannot replace the save file: {e}"))?;
        self.dirty = false;
        Ok(())
    }
}

fn parse(text: &str) -> Result<Map<String, Value>, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| format!("not valid JSON: {e}"))?;
    let root = value.as_object().ok_or("not a JSON object")?;
    match root.get("format").and_then(Value::as_u64) {
        Some(FORMAT) => {}
        Some(other) => {
            return Err(format!(
                "it is format {other}, newer than this Nova understands ({FORMAT})"
            ));
        }
        None => return Err("it has no \"format\"".into()),
    }
    root.get("data")
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| "it has no \"data\" object".into())
}

/// Where a game's saves live on this platform: `<data home>/Nova/<slug of the game name>`.
/// None when the platform gives no home folder (callers then fall back to memory).
pub fn default_dir(game_name: &str) -> Option<PathBuf> {
    let slug: String = game_name
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
    let slug = if slug.is_empty() {
        "game".to_string()
    } else {
        slug
    };
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let base = if cfg!(target_os = "macos") {
        home?.join("Library/Application Support")
    } else if cfg!(target_os = "windows") {
        PathBuf::from(std::env::var_os("APPDATA")?)
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| home.map(|h| h.join(".local/share")))?
    };
    Some(base.join("Nova").join(slug))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nova-save-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn values_survive_a_round_trip_through_the_file() {
        let dir = scratch("roundtrip");
        let (mut s, warning) = SaveStore::open(&dir).unwrap();
        assert!(warning.is_none());
        s.set("best", json!(12)).unwrap();
        s.set("settings", json!({"volume": 0.5, "names": ["a", "b"]}))
            .unwrap();
        assert!(s.is_dirty());
        s.flush().unwrap();
        assert!(!s.is_dirty());
        assert!(dir.join("save.json").exists());
        assert!(
            !dir.join("save.json.tmp").exists(),
            "the temporary file is gone"
        );

        let (again, _) = SaveStore::open(&dir).unwrap();
        assert_eq!(again.get("best"), Some(&json!(12)));
        assert_eq!(
            again.get("settings"),
            Some(&json!({"volume": 0.5, "names": ["a", "b"]}))
        );
        assert_eq!(again.get("missing"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_removes_and_marks_dirty_only_when_something_changed() {
        let mut s = SaveStore::memory();
        s.set("a", json!(1)).unwrap();
        s.flush().unwrap();
        s.delete("nothing");
        assert!(!s.is_dirty());
        s.delete("a");
        assert!(s.is_dirty());
        assert_eq!(s.get("a"), None);
        assert!(s.keys().is_empty());
    }

    #[test]
    fn a_damaged_save_is_set_aside_and_the_game_starts_fresh() {
        for (case, bytes) in [
            ("garbage", "not json at all {"),
            ("array", "[1,2]"),
            ("noformat", r#"{"data":{}}"#),
            ("future", r#"{"format":99,"data":{}}"#),
            ("nodata", r#"{"format":1}"#),
        ] {
            let dir = scratch(case);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("save.json"), bytes).unwrap();
            let (s, warning) = SaveStore::open(&dir).unwrap();
            let warning = warning.unwrap_or_else(|| panic!("{case}: no warning"));
            assert!(
                warning.contains("could not be read") && warning.contains("save.json.corrupt-"),
                "{case}: {warning}"
            );
            assert!(s.keys().is_empty());
            assert!(!dir.join("save.json").exists(), "{case}: moved aside");
            let aside = std::fs::read_dir(&dir).unwrap().flatten().any(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("save.json.corrupt-")
            });
            assert!(aside, "{case}: the old file is kept for recovery");
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn keys_and_total_size_are_limited_without_losing_existing_data() {
        let mut s = SaveStore::memory();
        assert!(s.set("", json!(1)).unwrap_err().contains("1 to 128"));
        assert!(s.set(&"k".repeat(129), json!(1)).is_err());
        s.set("small", json!("ok")).unwrap();
        let big = "x".repeat(MAX_BYTES);
        let e = s.set("big", json!(big)).unwrap_err();
        assert!(e.contains("bigger than 1024 KiB"), "{e}");
        assert_eq!(s.get("big"), None, "the failed write left nothing behind");
        assert_eq!(s.get("small"), Some(&json!("ok")));
        // Replacing a value with one that is too big keeps the old one.
        let e = s.set("small", json!("y".repeat(MAX_BYTES))).unwrap_err();
        assert!(e.contains("bigger"), "{e}");
        assert_eq!(s.get("small"), Some(&json!("ok")));
    }

    #[test]
    fn default_directory_is_per_game_and_sanitised() {
        if let Some(dir) = default_dir("Crate Dash!") {
            assert!(dir.ends_with("Nova/crate-dash"), "{dir:?}");
        }
        if let Some(dir) = default_dir("???") {
            assert!(dir.ends_with("Nova/game"), "{dir:?}");
        }
    }
}
