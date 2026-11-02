//! New projects: the built-in templates and copying the shipped examples.

use std::path::{Path, PathBuf};

use serde::Serialize;

pub struct Template {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub files: &'static [(&'static str, &'static [u8])],
}

pub const TEMPLATES: &[Template] = &[
    Template {
        id: "blank",
        name: "Blank",
        description: "One script and a moving square. The smallest thing that runs.",
        files: &[
            ("nova.json", include_bytes!("../templates/blank/nova.json")),
            ("main.lua", include_bytes!("../templates/blank/main.lua")),
        ],
    },
    Template {
        id: "starter",
        name: "Starter game",
        description: "A scene, an animated player entity with jumping, and the folders a real game uses.",
        files: &[
            ("nova.json", include_bytes!("../templates/starter/nova.json")),
            ("main.lua", include_bytes!("../templates/starter/main.lua")),
            ("scenes/title.lua", include_bytes!("../templates/starter/scenes/title.lua")),
            ("scenes/title.scene.json", include_bytes!("../templates/starter/scenes/title.scene.json")),
            ("entities/player.lua", include_bytes!("../templates/starter/entities/player.lua")),
            ("sprites/player.sprite.json", include_bytes!("../templates/starter/sprites/player.sprite.json")),
            ("sprites/player_sheet.png", include_bytes!("../templates/starter/sprites/player_sheet.png")),
        ],
    },
];

#[derive(Serialize)]
pub struct TemplateInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
}

pub fn template_infos() -> Vec<TemplateInfo> {
    TEMPLATES.iter().map(|t| TemplateInfo { id: t.id, name: t.name, description: t.description }).collect()
}

/// A folder name for a game name: lowercase letters and digits, other runs become one dash.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() { "game".into() } else { out }
}

pub fn check_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("give the game a name".into());
    }
    if name.chars().count() > 80 {
        return Err("the game's name can be at most 80 characters".into());
    }
    Ok(name.to_string())
}

/// Sets the game's name in a `nova.json` file's text, keeping every other key.
fn with_name(manifest: &[u8], name: &str) -> Result<Vec<u8>, String> {
    let mut value: serde_json::Value = serde_json::from_slice(manifest).map_err(|e| format!("nova.json: {e}"))?;
    value["name"] = serde_json::Value::String(name.to_string());
    let mut text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    text.push('\n');
    Ok(text.into_bytes())
}

fn destination(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let dest = parent.join(slug(name));
    if dest.exists() && std::fs::read_dir(&dest).map_err(|e| e.to_string())?.next().is_some() {
        return Err(format!("'{}' already exists and is not empty; pick another name or folder", dest.display()));
    }
    Ok(dest)
}

pub fn create_from_template(parent: &Path, name: &str, template: &str) -> Result<PathBuf, String> {
    let name = check_name(name)?;
    let template = TEMPLATES.iter().find(|t| t.id == template).ok_or_else(|| format!("unknown template '{template}'"))?;
    let dest = destination(parent, &name)?;
    for (rel, bytes) in template.files {
        let target = dest.join(rel);
        std::fs::create_dir_all(target.parent().expect("has a parent")).map_err(|e| format!("cannot create '{}': {e}", target.display()))?;
        let data = if *rel == "nova.json" { with_name(bytes, &name)? } else { bytes.to_vec() };
        std::fs::write(&target, data).map_err(|e| format!("cannot write '{}': {e}", target.display()))?;
    }
    Ok(dest)
}

/// Copies a project folder (an example) to `parent/<slug of name>`, skipping hidden files and
/// build output, and renames the game in the copy.
pub fn copy_project(source: &Path, parent: &Path, name: &str) -> Result<PathBuf, String> {
    fn copy(from: &Path, to: &Path, top: bool) -> Result<(), String> {
        std::fs::create_dir_all(to).map_err(|e| format!("cannot create '{}': {e}", to.display()))?;
        for entry in std::fs::read_dir(from).map_err(|e| format!("cannot read '{}': {e}", from.display()))? {
            let entry = entry.map_err(|e| e.to_string())?;
            let file = entry.file_name().to_string_lossy().into_owned();
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if file.starts_with('.') || kind.is_symlink() || (top && ["build", "target", "node_modules", "dist"].contains(&file.as_str())) {
                continue;
            }
            if kind.is_dir() {
                copy(&entry.path(), &to.join(&file), false)?;
            } else {
                std::fs::copy(entry.path(), to.join(&file)).map_err(|e| format!("cannot copy '{file}': {e}"))?;
            }
        }
        Ok(())
    }
    let name = check_name(name)?;
    if !source.join("nova.json").is_file() {
        return Err(format!("'{}' is not a Nova project", source.display()));
    }
    let dest = destination(parent, &name)?;
    copy(source, &dest, true)?;
    let manifest = std::fs::read(dest.join("nova.json")).map_err(|e| e.to_string())?;
    std::fs::write(dest.join("nova.json"), with_name(&manifest, &name)?).map_err(|e| e.to_string())?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nova-tpl-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn slugs_are_safe_folder_names() {
        assert_eq!(slug("Crate Dash!"), "crate-dash");
        assert_eq!(slug("  My  Game  "), "my-game");
        assert_eq!(slug("???"), "game");
        assert_eq!(slug("../../etc"), "etc");
        assert_eq!(slug("ÄÖ"), "game");
    }

    #[test]
    fn names_are_checked() {
        assert!(check_name("  ").is_err());
        assert!(check_name(&"x".repeat(81)).is_err());
        assert_eq!(check_name("  Hi  ").unwrap(), "Hi");
    }

    #[test]
    fn every_template_creates_a_project_with_the_chosen_name() {
        for t in TEMPLATES {
            let parent = scratch(t.id);
            let dest = create_from_template(&parent, "Space Hopper", t.id).unwrap();
            assert!(dest.ends_with("space-hopper"));
            let manifest: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dest.join("nova.json")).unwrap()).unwrap();
            assert_eq!(manifest["name"], "Space Hopper", "{}", t.id);
            assert_eq!(manifest["format"], 1);
            for (rel, bytes) in t.files {
                assert!(dest.join(rel).is_file(), "{} lacks {rel}", t.id);
                if *rel != "nova.json" {
                    assert_eq!(std::fs::read(dest.join(rel)).unwrap(), *bytes);
                }
            }
            let _ = std::fs::remove_dir_all(&parent);
        }
    }

    #[test]
    fn creating_over_an_existing_project_is_refused_and_unknown_templates_explained() {
        let parent = scratch("exists");
        create_from_template(&parent, "Dup", "blank").unwrap();
        let e = create_from_template(&parent, "Dup", "blank").unwrap_err();
        assert!(e.contains("already exists and is not empty"), "{e}");
        assert!(create_from_template(&parent, "X", "nope").unwrap_err().contains("unknown template"));
        assert!(create_from_template(&parent, "", "blank").is_err());
        // An empty existing folder is fine.
        std::fs::create_dir_all(parent.join("empty-one")).unwrap();
        assert!(create_from_template(&parent, "Empty One", "blank").is_ok());
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn copying_an_example_skips_hidden_files_and_renames_the_game() {
        let source = scratch("src");
        std::fs::write(source.join("nova.json"), r#"{"format":1,"name":"Original","world_height":720}"#).unwrap();
        std::fs::create_dir_all(source.join("sprites")).unwrap();
        std::fs::write(source.join("sprites/a.png"), [1, 2, 3]).unwrap();
        std::fs::create_dir_all(source.join(".nova")).unwrap();
        std::fs::write(source.join(".nova/state"), "x").unwrap();
        std::fs::create_dir_all(source.join("build")).unwrap();
        let parent = scratch("dst");
        let dest = copy_project(&source, &parent, "My Copy").unwrap();
        assert!(dest.join("sprites/a.png").is_file());
        assert!(!dest.join(".nova").exists() && !dest.join("build").exists());
        let manifest: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dest.join("nova.json")).unwrap()).unwrap();
        assert_eq!((manifest["name"].as_str(), manifest["world_height"].as_u64()), (Some("My Copy"), Some(720)), "other keys survive");
        assert!(copy_project(&parent, &parent, "x").unwrap_err().contains("not a Nova project"));
        let _ = std::fs::remove_dir_all(&source);
        let _ = std::fs::remove_dir_all(&parent);
    }
}
