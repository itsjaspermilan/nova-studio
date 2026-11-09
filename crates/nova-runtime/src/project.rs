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
    Font,
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
            Some("ttf") | Some("otf") => Self::Font,
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
    /// `"graphics"`: opt-in quality settings of the world pass (HDR, MSAA, shadow cascades, image-based light, anisotropy); the
    /// default is the plain engine. See `docs/switch-class-graphics.md`.
    pub graphics: crate::gfx::Quality,
    /// `"sprite_filter": "smooth"`: pictures are drawn with bilinear filtering (for drawn, not pixel-art, interfaces).
    pub smooth_sprites: bool,
    pub version: Option<String>,
    /// `"materials"`: which models are lit by their glTF material (normal map, metallic, roughness, emission; `docs/materials.md`).
    /// None (the default): every model keeps Nova's plain look. An empty list (`"materials": true`): every model. Otherwise the
    /// models named (short names or paths, as `nova.model` takes them).
    pub materials: Option<Vec<String>>,
    /// The raw `"input"` section (validated when the manifest is read).
    pub input: Option<serde_json::Value>,
    /// `"local_network": true`: the game plays with other devices on the same wifi (`nova.net`); an Android build then
    /// asks for network access.
    pub local_network: bool,
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
    let graphics = match object.get("graphics") {
        None => crate::gfx::Quality::default(),
        Some(Value::Object(g)) => parse_graphics(g).map_err(field_error)?,
        Some(_) => {
            return Err(field_error(
                "\"graphics\" must be an object such as {\"hdr\": true, \"msaa\": 4}",
            ));
        }
    };
    let smooth_sprites = match object.get("sprite_filter") {
        None => false,
        Some(Value::String(s)) if s == "pixel" => false,
        Some(Value::String(s)) if s == "smooth" => true,
        Some(_) => {
            return Err(field_error(
                "\"sprite_filter\" must be \"pixel\" (sharp pixels, the default) or \"smooth\"",
            ));
        }
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
    let local_network = match object.get("local_network") {
        None => false,
        Some(Value::Bool(b)) => *b,
        Some(_) => {
            return Err(field_error(
                "\"local_network\" must be true (the game plays with other devices on the same wifi) or false",
            ));
        }
    };
    let materials = match object.get("materials") {
        None | Some(Value::Bool(false)) => None,
        Some(Value::Bool(true)) => Some(Vec::new()),
        Some(Value::Array(list)) if list.iter().all(Value::is_string) && !list.is_empty() => Some(
            list.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
        ),
        Some(_) => {
            return Err(field_error(
                "\"materials\" must be true (every model is lit by its glTF material) or a list of model names such as [\"rock\", \"knight\"]",
            ));
        }
    };
    for key in object.keys() {
        if ![
            "materials",
            "format",
            "name",
            "entry",
            "world_height",
            "graphics",
            "sprite_filter",
            "version",
            "input",
            "local_network",
        ]
        .contains(&key.as_str())
        {
            warnings.push(format!("{MANIFEST}: unknown key \"{key}\" is ignored"));
        }
    }
    let input = object.get("input").cloned();
    if let Some(input) = &input {
        crate::actions::Bindings::from_manifest(input)?;
    }
    Ok(Manifest {
        name,
        entry,
        world_height,
        graphics,
        smooth_sprites,
        version,
        materials,
        input,
        local_network,
    })
}

/// The manifest's `graphics` object: `hdr` (true/false), `msaa` (1 or 4), `shadow_cascades` (1 to 3), `ibl` (true/false), `anisotropy`
/// (1 to 16).
fn parse_graphics(g: &serde_json::Map<String, Value>) -> Result<crate::gfx::Quality, String> {
    let mut q = crate::gfx::Quality::default();
    for (key, value) in g {
        let flag = || {
            value
                .as_bool()
                .ok_or_else(|| format!("\"graphics\".\"{key}\" must be true or false"))
        };
        let whole = |lo: u64, hi: u64| match value.as_u64() {
            Some(n) if (lo..=hi).contains(&n) => Ok(n as u32),
            _ => Err(format!(
                "\"graphics\".\"{key}\" must be a whole number from {lo} to {hi}"
            )),
        };
        match key.as_str() {
            "hdr" => q.hdr = flag()?,
            "ibl" => q.ibl = flag()?,
            "msaa" => {
                q.msaa = whole(1, 4)?;
                if q.msaa != 1 && q.msaa != 4 {
                    return Err("\"graphics\".\"msaa\" must be 1 (off) or 4".into());
                }
            }
            "shadow_cascades" => q.cascades = whole(1, crate::gfx::MAX_CASCADES as u64)?,
            "anisotropy" => q.aniso = whole(1, 16)?,
            other => {
                return Err(format!(
                    "unknown \"graphics\" setting \"{other}\" (hdr, msaa, shadow_cascades, ibl, anisotropy)"
                ));
            }
        }
    }
    Ok(q)
}

impl Manifest {
    /// Whether the model `id` (a path such as `models/rock.glb`) is drawn with its glTF material (see [`Manifest::materials`]).
    pub fn lit_by_material(&self, id: &str) -> bool {
        match &self.materials {
            None => false,
            Some(list) if list.is_empty() => true,
            Some(list) => list
                .iter()
                .any(|name| name == id || format!("models/{name}.glb") == id),
        }
    }
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
    fn the_graphics_settings_are_read_and_bad_ones_refused() {
        let q = open(&[
            ("nova.json", r#"{"format":1,"name":"G","graphics":{"hdr":true,"msaa":4,"shadow_cascades":3,"ibl":true,"anisotropy":8}}"#),
            ("main.lua", ""),
        ])
        .unwrap()
        .manifest
        .graphics;
        assert_eq!(
            q,
            crate::gfx::Quality {
                hdr: true,
                msaa: 4,
                cascades: 3,
                ibl: true,
                aniso: 8
            }
        );
        // none given: the plain engine
        let plain = open(&[
            ("nova.json", r#"{"format":1,"name":"G"}"#),
            ("main.lua", ""),
        ])
        .unwrap();
        assert_eq!(plain.manifest.graphics, crate::gfx::Quality::default());
        for bad in [
            r#""graphics": true"#,
            r#""graphics": {"msaa": 2}"#,
            r#""graphics": {"shadow_cascades": 9}"#,
            r#""graphics": {"hdr": "yes"}"#,
            r#""graphics": {"fancy": true}"#,
        ] {
            let text = format!(r#"{{"format":1,"name":"G",{bad}}}"#);
            assert!(
                open(&[("nova.json", text.as_str()), ("main.lua", "")]).is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn the_forcing_text_is_parsed() {
        let q =
            crate::gfx::Quality::from_spec("hdr,msaa=4 cascades=2,ibl,aniso=8,height=720").unwrap();
        assert_eq!(
            q,
            crate::gfx::Quality {
                hdr: true,
                msaa: 4,
                cascades: 2,
                ibl: true,
                aniso: 8
            }
        );
        assert!(crate::gfx::Quality::from_spec("bloomy").is_err());
        assert!(crate::gfx::Quality::from_spec("msaa=four").is_err());
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
