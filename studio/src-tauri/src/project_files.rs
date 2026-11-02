//! The project's files as the studio sees them: listing, reading, writing, creating, renaming and
//! deleting, always confined to the project folder (see `paths`).

use std::path::Path;

use serde::Serialize;

use crate::paths::{confine, normalize};

pub const MAX_EDIT_BYTES: u64 = 4 << 20;
const MAX_FILES: usize = 20_000;
const SKIPPED_TOP_LEVEL: [&str; 4] = ["build", "target", "node_modules", "dist"];

#[derive(Debug, Serialize, PartialEq)]
pub struct FileEntry {
    pub path: String,
    pub dir: bool,
    pub size: u64,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct FileContent {
    /// The text, when the file is UTF-8 and small enough to edit.
    pub text: Option<String>,
    pub binary: bool,
    pub size: u64,
}

/// Every file and folder in the project, sorted by path. Hidden entries (starting with `.`),
/// symbolic links and top-level build output are left out, matching what the runtime treats as the project.
pub fn list_files(root: &Path) -> Result<Vec<FileEntry>, String> {
    fn walk(dir: &Path, prefix: &str, out: &mut Vec<FileEntry>) -> Result<(), String> {
        for entry in std::fs::read_dir(dir).map_err(|e| format!("cannot read '{}': {e}", dir.display()))? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                continue;
            }
            let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
            if kind.is_dir() {
                if prefix.is_empty() && SKIPPED_TOP_LEVEL.contains(&name.as_str()) {
                    continue;
                }
                out.push(FileEntry { path: rel.clone(), dir: true, size: 0 });
                walk(&entry.path(), &rel, out)?;
            } else if kind.is_file() {
                if out.len() >= MAX_FILES {
                    return Err(format!("the project has more than {MAX_FILES} files"));
                }
                let size = entry.metadata().map_err(|e| e.to_string())?.len();
                out.push(FileEntry { path: rel, dir: false, size });
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(root, "", &mut out)?;
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

pub fn read_file(root: &Path, rel: &str) -> Result<FileContent, String> {
    let path = confine(root, rel)?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("cannot read '{rel}': {e}"))?;
    if !meta.is_file() {
        return Err(format!("'{rel}' is not a file"));
    }
    let size = meta.len();
    if size > MAX_EDIT_BYTES {
        return Ok(FileContent { text: None, binary: true, size });
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("cannot read '{rel}': {e}"))?;
    match String::from_utf8(bytes) {
        Ok(text) => Ok(FileContent { text: Some(text), binary: false, size }),
        Err(_) => Ok(FileContent { text: None, binary: true, size }),
    }
}

/// Saves text to a file by writing a temporary file in the same folder and renaming it over the
/// target, so an interrupted save never leaves half a file.
pub fn write_file(root: &Path, rel: &str, text: &str) -> Result<(), String> {
    if text.len() as u64 > MAX_EDIT_BYTES {
        return Err(format!("'{rel}' is bigger than the {} MiB editing limit", MAX_EDIT_BYTES >> 20));
    }
    let path = confine(root, rel)?;
    if path.is_dir() {
        return Err(format!("'{rel}' is a folder"));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("cannot create the folder for '{rel}': {e}"))?;
    }
    let temp = path.with_file_name(format!(
        ".{}.nova-save",
        path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
    ));
    std::fs::write(&temp, text).map_err(|e| format!("cannot save '{rel}': {e}"))?;
    std::fs::rename(&temp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        format!("cannot replace '{rel}': {e}")
    })
}

pub fn create_file(root: &Path, rel: &str, contents: &str) -> Result<(), String> {
    let path = confine(root, rel)?;
    if path.exists() {
        return Err(format!("'{rel}' already exists"));
    }
    write_file(root, rel, contents)
}

pub fn create_dir(root: &Path, rel: &str) -> Result<(), String> {
    let path = confine(root, rel)?;
    if path.exists() {
        return Err(format!("'{rel}' already exists"));
    }
    std::fs::create_dir_all(&path).map_err(|e| format!("cannot create '{rel}': {e}"))
}

pub fn rename(root: &Path, from: &str, to: &str) -> Result<(), String> {
    let (from_path, to_path) = (confine(root, from)?, confine(root, to)?);
    if normalize(from)? == "nova.json" {
        return Err("nova.json is the project's manifest and cannot be renamed".into());
    }
    if !from_path.exists() {
        return Err(format!("'{from}' does not exist"));
    }
    if to_path.exists() {
        return Err(format!("'{to}' already exists"));
    }
    if let Some(parent) = to_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("cannot create the folder for '{to}': {e}"))?;
    }
    std::fs::rename(&from_path, &to_path).map_err(|e| format!("cannot rename '{from}': {e}"))
}

/// Moves a file or folder into `.nova/trash/<time>/` inside the project instead of erasing it.
/// Returns where it went.
pub fn delete(root: &Path, rel: &str) -> Result<String, String> {
    let path = confine(root, rel)?;
    let canonical = normalize(rel)?;
    if canonical == "nova.json" {
        return Err("nova.json is the project's manifest and cannot be deleted".into());
    }
    if !path.exists() {
        return Err(format!("'{rel}' does not exist"));
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let target_rel = format!(".nova/trash/{stamp}/{canonical}");
    let target = root.join(&target_rel);
    std::fs::create_dir_all(target.parent().expect("has a parent"))
        .map_err(|e| format!("cannot create the trash folder: {e}"))?;
    std::fs::rename(&path, &target).map_err(|e| format!("cannot delete '{rel}': {e}"))?;
    Ok(target_rel)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn project(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("nova-files-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("scenes")).unwrap();
        std::fs::create_dir_all(root.join(".nova")).unwrap();
        std::fs::create_dir_all(root.join("build")).unwrap();
        std::fs::write(root.join("nova.json"), r#"{"format":1,"name":"T"}"#).unwrap();
        std::fs::write(root.join("main.lua"), "print('x')").unwrap();
        std::fs::write(root.join("scenes/a.lua"), "return 1").unwrap();
        std::fs::write(root.join(".nova/notes.json"), "{}").unwrap();
        std::fs::write(root.join("build/out.bin"), "z").unwrap();
        root
    }

    #[test]
    fn listing_shows_files_and_folders_sorted_and_hides_hidden_and_build_output() {
        let root = project("list");
        let names: Vec<_> = list_files(&root).unwrap().into_iter().map(|e| (e.path, e.dir)).collect();
        assert_eq!(
            names,
            [("main.lua".to_string(), false), ("nova.json".into(), false), ("scenes".into(), true), ("scenes/a.lua".into(), false)]
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reading_returns_text_and_flags_binary_and_oversized_files() {
        let root = project("read");
        assert_eq!(read_file(&root, "main.lua").unwrap().text.as_deref(), Some("print('x')"));
        std::fs::write(root.join("pic.png"), [0x89, 0x50, 0xff, 0xfe, 0x00]).unwrap();
        let png = read_file(&root, "pic.png").unwrap();
        assert!(png.binary && png.text.is_none());
        std::fs::write(root.join("big.txt"), vec![b'a'; (MAX_EDIT_BYTES + 1) as usize]).unwrap();
        assert!(read_file(&root, "big.txt").unwrap().binary, "too big to edit");
        assert!(read_file(&root, "scenes").unwrap_err().contains("not a file"));
        assert!(read_file(&root, "missing.lua").is_err());
        assert!(read_file(&root, "../etc/hosts").unwrap_err().contains("leaves the project"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn writing_is_atomic_creates_folders_and_leaves_no_temporary_files() {
        let root = project("write");
        write_file(&root, "main.lua", "new").unwrap();
        assert_eq!(std::fs::read_to_string(root.join("main.lua")).unwrap(), "new");
        write_file(&root, "entities/deep/hero.lua", "return nil").unwrap();
        assert!(root.join("entities/deep/hero.lua").exists());
        let stray: Vec<_> = std::fs::read_dir(&root).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().ends_with(".nova-save")).collect();
        assert!(stray.is_empty());
        assert!(write_file(&root, "scenes", "x").unwrap_err().contains("is a folder"));
        assert!(write_file(&root, "../evil.lua", "x").is_err());
        assert!(write_file(&root, "big.txt", &"a".repeat((MAX_EDIT_BYTES + 1) as usize)).unwrap_err().contains("editing limit"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn create_rename_and_delete_follow_the_rules() {
        let root = project("ops");
        create_file(&root, "lib/util.lua", "return {}").unwrap();
        assert!(create_file(&root, "lib/util.lua", "x").unwrap_err().contains("already exists"));
        create_dir(&root, "sounds").unwrap();
        assert!(create_dir(&root, "sounds").is_err());

        rename(&root, "lib/util.lua", "lib/tools/util.lua").unwrap();
        assert!(root.join("lib/tools/util.lua").exists() && !root.join("lib/util.lua").exists());
        assert!(rename(&root, "lib/tools/util.lua", "main.lua").unwrap_err().contains("already exists"));
        assert!(rename(&root, "nova.json", "game.json").unwrap_err().contains("manifest"));
        assert!(rename(&root, "nope.lua", "x.lua").unwrap_err().contains("does not exist"));
        assert!(rename(&root, "main.lua", "../x.lua").is_err());

        let trashed = delete(&root, "lib/tools/util.lua").unwrap();
        assert!(trashed.starts_with(".nova/trash/") && trashed.ends_with("/lib/tools/util.lua"));
        assert!(root.join(&trashed).exists(), "kept in the project's trash, not erased");
        assert!(!root.join("lib/tools/util.lua").exists());
        assert!(delete(&root, "nova.json").unwrap_err().contains("manifest"));
        assert!(delete(&root, "ghost").is_err());
        assert!(delete(&root, "../x").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
