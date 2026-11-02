//! The project manifest (`nova.json`) and the asset index.
//!
//! A project is a folder. `nova.json` names the game and its entry script; every other
//! file is discovered by scanning, and an asset's ID is its project-relative path, so
//! nothing is declared by hand. Format version 1.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::vfs::{Vfs, VfsEntry, normalize};

pub const MANIFEST: &str = "nova.json";
pub const FORMAT: u64 = 1;
pub const DEFAULT_WORLD_HEIGHT: u32 = 540;
pub const MAX_WORLD_HEIGHT: u32 = 4320;
pub const MAX_PROJECT_BYTES: u64 = 1 << 30;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AssetKind {
    Image,
    Model,
    Script,
    Scene,
    Sheet,
    Audio,
    Other,
}

impl AssetKind {
    pub fn from_path(path: &str) -> Self {
        let lower = path.to_ascii_lowercase();
        if lower.ends_with(".scene.json") {
            return Self::Scene;
        }
        if lower.ends_with(".sprite.json") {
            return Self::Sheet;
        }
        match lower.rsplit_once('.').map(|(_, ext)| ext) {
            Some("png") => Self::Image,
            Some("glb") => Self::Model,
            Some("lua") => Self::Script,
            Some("wav") | Some("ogg") => Self::Audio,
            _ => Self::Other,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Asset {
    /// Stable identifier: the project-relative path.
    pub id: String,
    pub kind: AssetKind,
    pub size: u64,
}

#[derive(Clone, Debug)]
pub struct Manifest {
    pub name: String,
    pub entry: String,
    pub world_height: u32,
    pub version: Option<String>,
}

pub struct Project {
    pub manifest: Manifest,
    pub assets: Vec<Asset>,
    /// Non-fatal findings (unknown manifest keys, unsupported file types).
    pub warnings: Vec<String>,
}

fn field_error(message: impl Into<String>) -> String {
    format!("{MANIFEST}: {}", message.into())
}

pub fn parse_manifest(text: &str, warnings: &mut Vec<String>) -> Result<Manifest, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| {
        field_error(format!(
            "not valid JSON (line {}, column {}): {e}",
            e.line(),
            e.column()
        ))
    })?;
    let object = value.as_object().ok_or_else(|| {
        field_error("must be a JSON object like {\"format\": 1, \"name\": \"My Game\"}")
    })?;

    match object.get("format") {
        None => return Err(field_error("missing \"format\"; add \"format\": 1")),
        Some(v) if v.as_u64() == Some(FORMAT) => {}
        Some(v) => {
            return Err(field_error(format!(
                "unsupported \"format\" {v}; this Nova understands format {FORMAT}"
            )));
        }
    }
    let name = match object.get("name") {
        None => return Err(field_error("missing \"name\"; give the game a title")),
        Some(Value::String(s)) if !s.trim().is_empty() && s.chars().count() <= 80 => {
            s.trim().to_string()
        }
        Some(_) => {
            return Err(field_error(
                "\"name\" must be a non-empty string of at most 80 characters",
            ));
        }
    };
    let entry = match object.get("entry") {
        None => "main.lua".to_string(),
        Some(Value::String(s)) => {
            normalize(s).map_err(|e| field_error(format!("\"entry\": {e}")))?
        }
        Some(_) => {
            return Err(field_error(
                "\"entry\" must be a path string such as \"main.lua\"",
            ));
        }
    };
    if !entry.to_ascii_lowercase().ends_with(".lua") {
        return Err(field_error(format!(
            "\"entry\" is '{entry}' but must be a .lua file"
        )));
    }
    let world_height = match object.get("world_height") {
        None => DEFAULT_WORLD_HEIGHT,
        Some(v) => match v.as_u64() {
            Some(h) if h <= MAX_WORLD_HEIGHT as u64 => h as u32,
            _ => {
                return Err(field_error(format!(
                    "\"world_height\" must be a whole number from 0 to {MAX_WORLD_HEIGHT} (0 = native resolution)"
                )));
            }
        },
    };
    let version = match object.get("version") {
        None => None,
        Some(Value::String(s)) => Some(s.clone()),
        Some(_) => {
            return Err(field_error(
                "\"version\" must be a string such as \"1.0.0\"",
            ));
        }
    };
    for key in object.keys() {
        if !["format", "name", "entry", "world_height", "version"].contains(&key.as_str()) {
            warnings.push(format!("{MANIFEST}: unknown key \"{key}\" is ignored"));
        }
    }
    Ok(Manifest {
        name,
        entry,
        world_height,
        version,
    })
}

impl Project {
    pub fn open(vfs: &dyn Vfs) -> Result<Project, String> {
        let manifest_bytes = vfs.read(MANIFEST).map_err(|_| {
            format!(
                "no {MANIFEST} found. A Nova project is a folder with a {MANIFEST} file, for example:\n  {{\"format\": 1, \"name\": \"My Game\"}}"
            )
        })?;
        let manifest_text = String::from_utf8(manifest_bytes)
            .map_err(|_| field_error("is not valid UTF-8 text"))?;
        let mut warnings = Vec::new();
        let manifest = parse_manifest(&manifest_text, &mut warnings)?;

        let entries = vfs.list()?;
        let mut assets = Vec::new();
        let mut by_lowercase: BTreeMap<String, String> = BTreeMap::new();
        let mut total = 0u64;
        for VfsEntry { path, size } in entries {
            if path == MANIFEST {
                continue;
            }
            total += size;
            // Case-insensitive file systems would make these two files collide on some machines.
            if let Some(other) = by_lowercase.insert(path.to_lowercase(), path.clone()) {
                return Err(format!(
                    "two files differ only by letter case: '{other}' and '{path}'. Rename one so the project works on every system."
                ));
            }
            let kind = AssetKind::from_path(&path);
            let lower = path.to_ascii_lowercase();
            if lower.ends_with(".jpg")
                || lower.ends_with(".jpeg")
                || lower.ends_with(".gif")
                || lower.ends_with(".bmp")
            {
                warnings.push(format!(
                    "'{path}' is not a supported image type yet (use PNG); it is ignored"
                ));
            }
            assets.push(Asset {
                id: path,
                kind,
                size,
            });
        }
        if total > MAX_PROJECT_BYTES {
            return Err(format!(
                "project files total {} MiB; the limit is {} MiB",
                total >> 20,
                MAX_PROJECT_BYTES >> 20
            ));
        }
        if !assets.iter().any(|a| a.id == manifest.entry) {
            return Err(field_error(format!(
                "\"entry\" is '{}' but that file does not exist in the project",
                manifest.entry
            )));
        }
        Ok(Project {
            manifest,
            assets,
            warnings,
        })
    }

    pub fn assets_of(&self, kind: AssetKind) -> impl Iterator<Item = &Asset> {
        self.assets.iter().filter(move |a| a.kind == kind)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::MemVfs;

    fn open(files: &[(&str, &str)]) -> Result<Project, String> {
        let vfs = MemVfs::new(files.iter().map(|(p, d)| (*p, d.as_bytes().to_vec())));
        Project::open(&vfs)
    }

    #[test]
    fn minimal_project_opens_with_defaults() {
        let p = open(&[
            ("nova.json", r#"{"format":1,"name":"Rally"}"#),
            ("main.lua", ""),
        ])
        .unwrap();
        assert_eq!(p.manifest.name, "Rally");
        assert_eq!(p.manifest.entry, "main.lua");
        assert_eq!(p.manifest.world_height, 540);
        assert!(p.warnings.is_empty());
    }

    #[test]
    fn assets_are_discovered_with_path_ids_and_kinds() {
        let p = open(&[
            (
                "nova.json",
                r#"{"format":1,"name":"G","entry":"game/start.lua","world_height":0}"#,
            ),
            ("game/start.lua", ""),
            ("sprites/car.png", "x"),
            ("models/car.glb", "x"),
            ("sound/hit.wav", "x"),
            ("scenes/title.scene.json", "{}"),
            ("notes.txt", "x"),
        ])
        .unwrap();
        assert_eq!(p.manifest.world_height, 0);
        let kinds: Vec<_> = p
            .assets
            .iter()
            .map(|a| (a.id.as_str(), a.kind.clone()))
            .collect();
        assert!(kinds.contains(&("sprites/car.png", AssetKind::Image)));
        assert!(kinds.contains(&("models/car.glb", AssetKind::Model)));
        assert!(kinds.contains(&("sound/hit.wav", AssetKind::Audio)));
        assert!(kinds.contains(&("scenes/title.scene.json", AssetKind::Scene)));
        assert!(kinds.contains(&("notes.txt", AssetKind::Other)));
        assert_eq!(p.assets_of(AssetKind::Image).count(), 1);
    }

    #[test]
    fn missing_manifest_explains_what_to_create() {
        let e = open(&[("main.lua", "")]).err().unwrap();
        assert!(
            e.contains("no nova.json found") && e.contains("\"format\": 1"),
            "{e}"
        );
    }

    #[test]
    fn malformed_manifests_give_actionable_errors() {
        let cases: &[(&str, &str)] = &[
            ("{ nope", "not valid JSON"),
            ("[]", "must be a JSON object"),
            (r#"{"name":"G"}"#, "missing \"format\""),
            (r#"{"format":2,"name":"G"}"#, "unsupported \"format\" 2"),
            (r#"{"format":1}"#, "missing \"name\""),
            (r#"{"format":1,"name":""}"#, "non-empty string"),
            (
                r#"{"format":1,"name":"G","entry":"../x.lua"}"#,
                "leaves the project",
            ),
            (
                r#"{"format":1,"name":"G","entry":"/abs/x.lua"}"#,
                "absolute",
            ),
            (
                r#"{"format":1,"name":"G","entry":"main.txt"}"#,
                "must be a .lua file",
            ),
            (r#"{"format":1,"name":"G","entry":7}"#, "path string"),
            (
                r#"{"format":1,"name":"G","world_height":-5}"#,
                "whole number",
            ),
            (
                r#"{"format":1,"name":"G","world_height":99999}"#,
                "whole number",
            ),
            (r#"{"format":1,"name":"G","version":3}"#, "must be a string"),
        ];
        for (manifest, expected) in cases {
            let e = open(&[("nova.json", manifest), ("main.lua", "")])
                .err()
                .unwrap_or_default();
            assert!(
                e.contains(expected),
                "manifest {manifest}: expected '{expected}' in '{e}'"
            );
        }
    }

    #[test]
    fn missing_entry_file_is_reported() {
        let e = open(&[(
            "nova.json",
            r#"{"format":1,"name":"G","entry":"start.lua"}"#,
        )])
        .err()
        .unwrap();
        assert!(
            e.contains("'start.lua'") && e.contains("does not exist"),
            "{e}"
        );
    }

    #[test]
    fn unknown_keys_and_unsupported_images_warn_without_failing() {
        let p = open(&[
            ("nova.json", r#"{"format":1,"name":"G","colour":"red"}"#),
            ("main.lua", ""),
            ("a.jpg", "x"),
        ])
        .unwrap();
        assert_eq!(p.warnings.len(), 2, "{:?}", p.warnings);
        assert!(
            p.warnings
                .iter()
                .any(|w| w.contains("unknown key \"colour\""))
        );
        assert!(
            p.warnings
                .iter()
                .any(|w| w.contains("a.jpg") && w.contains("PNG"))
        );
    }

    #[test]
    fn case_colliding_files_are_rejected() {
        let e = open(&[
            ("nova.json", r#"{"format":1,"name":"G"}"#),
            ("main.lua", ""),
            ("Sprites/A.png", "x"),
            ("sprites/a.png", "x"),
        ])
        .err()
        .unwrap();
        assert!(e.contains("differ only by letter case"), "{e}");
    }
}
