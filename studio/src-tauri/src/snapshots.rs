//! Named snapshots of a whole project: a copy of its files kept in the project's own `.nova/snapshots/` folder (which is hidden, so it is never part of
//! the game or an export), so that a bold experiment can be undone later. Restoring first takes an automatic snapshot of what is there now, so a restore
//! can be undone too. Nothing outside the project is read or written; symbolic links are not followed or copied.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Folders at the top of a project that are never part of it (the same list `project_files` uses) plus the studio's own `exports`.
const SKIPPED_TOP_LEVEL: [&str; 5] = ["build", "target", "node_modules", "dist", "exports"];
pub const MAX_FILES: usize = 20_000;
pub const MAX_BYTES: u64 = 1 << 30;
const MAX_SNAPSHOTS: usize = 40;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Snapshot {
    /// The folder name inside `.nova/snapshots/`.
    pub id: String,
    pub name: String,
    /// Seconds since 1970.
    pub created: u64,
    pub files: usize,
    pub bytes: u64,
}

fn dir_of(root: &Path) -> PathBuf {
    root.join(".nova").join("snapshots")
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn slug(name: &str) -> String {
    let s: String = name
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
    if s.is_empty() {
        "snapshot".into()
    } else {
        s.chars().take(40).collect()
    }
}

pub fn clean_name(name: &str) -> Result<String, String> {
    let n = name.trim();
    if n.is_empty() || n.chars().count() > 60 || n.chars().any(|c| c.is_control()) {
        return Err("A snapshot needs a name of 1 to 60 characters.".into());
    }
    Ok(n.to_string())
}

/// Every file of the project as (relative path with forward slashes, size), without hidden files and folders, links and the skipped folders.
fn project_files(root: &Path) -> Result<Vec<(String, u64)>, String> {
    let mut out = Vec::new();
    fn walk(dir: &Path, rel: &str, out: &mut Vec<(String, u64)>) -> Result<(), String> {
        for entry in std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let meta = entry.file_type().map_err(|e| e.to_string())?;
            let here = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            if meta.is_symlink() {
                continue;
            }
            if meta.is_dir() {
                if rel.is_empty() && SKIPPED_TOP_LEVEL.contains(&name.as_str()) {
                    continue;
                }
                walk(&entry.path(), &here, out)?;
            } else if meta.is_file() {
                let len = entry.metadata().map_err(|e| e.to_string())?.len();
                out.push((here, len));
            }
        }
        Ok(())
    }
    walk(root, "", &mut out)?;
    out.sort();
    Ok(out)
}

fn copy_files(from: &Path, to: &Path, files: &[(String, u64)]) -> Result<(), String> {
    for (rel, _) in files {
        let src = from.join(rel);
        let dst = to.join(rel);
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        std::fs::copy(&src, &dst).map_err(|e| format!("copying {rel}: {e}"))?;
    }
    Ok(())
}

pub fn create(root: &Path, name: &str) -> Result<Snapshot, String> {
    let name = clean_name(name)?;
    let files = project_files(root)?;
    let bytes: u64 = files.iter().map(|f| f.1).sum();
    if files.len() > MAX_FILES || bytes > MAX_BYTES {
        return Err(format!(
            "The project is too big to snapshot ({} files, {} MB; the limit is {MAX_FILES} files and {} MB).",
            files.len(),
            bytes >> 20,
            MAX_BYTES >> 20
        ));
    }
    let existing = list(root)?;
    if existing.len() >= MAX_SNAPSHOTS {
        return Err(format!(
            "There are {MAX_SNAPSHOTS} snapshots already; delete some first."
        ));
    }
    let created = now();
    let mut id = format!("{created}-{}", slug(&name));
    let base = dir_of(root);
    let mut k = 2;
    while base.join(&id).exists() {
        id = format!("{created}-{}-{k}", slug(&name));
        k += 1;
    }
    let dest = base.join(&id).join("files");
    std::fs::create_dir_all(&dest).map_err(|e| format!("{}: {e}", dest.display()))?;
    if let Err(e) = copy_files(root, &dest, &files) {
        let _ = std::fs::remove_dir_all(base.join(&id));
        return Err(e);
    }
    let info = Snapshot {
        id: id.clone(),
        name,
        created,
        files: files.len(),
        bytes,
    };
    std::fs::write(
        base.join(&id).join("snapshot.json"),
        serde_json::to_string_pretty(&info).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(info)
}

/// Newest first.
pub fn list(root: &Path) -> Result<Vec<Snapshot>, String> {
    let base = dir_of(root);
    let Ok(rd) = std::fs::read_dir(&base) else {
        return Ok(Vec::new());
    };
    let mut out: Vec<Snapshot> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| std::fs::read_to_string(e.path().join("snapshot.json")).ok())
        .filter_map(|t| serde_json::from_str(&t).ok())
        .collect();
    out.sort_by(|a, b| b.created.cmp(&a.created).then(b.id.cmp(&a.id)));
    Ok(out)
}

fn check_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.contains('/')
        || id.contains('\\')
        || id.contains("..")
        || id.starts_with('.')
    {
        return Err(format!("'{id}' is not a snapshot"));
    }
    Ok(())
}

pub fn delete(root: &Path, id: &str) -> Result<(), String> {
    check_id(id)?;
    let dir = dir_of(root).join(id);
    if !dir.join("snapshot.json").exists() {
        return Err(format!("There is no snapshot '{id}'."));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

/// Puts the project back as it was in the snapshot: files the snapshot does not have are removed, the others are written from it. An automatic snapshot
/// of the project as it is now is taken first (named "Before restoring <name>"), and returned so the person can say where it is.
pub fn restore(root: &Path, id: &str) -> Result<Snapshot, String> {
    check_id(id)?;
    let snap = list(root)?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("There is no snapshot '{id}'."))?;
    let from = dir_of(root).join(id).join("files");
    let wanted = {
        let mut v = Vec::new();
        fn walk(dir: &Path, rel: &str, out: &mut Vec<(String, u64)>) -> Result<(), String> {
            for e in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
                let e = e.map_err(|e| e.to_string())?;
                let name = e.file_name().to_string_lossy().to_string();
                let here = if rel.is_empty() {
                    name
                } else {
                    format!("{rel}/{name}")
                };
                if e.file_type().map_err(|e| e.to_string())?.is_dir() {
                    walk(&e.path(), &here, out)?;
                } else {
                    out.push((here, 0));
                }
            }
            Ok(())
        }
        walk(&from, "", &mut v)?;
        v
    };
    let safety = create(root, &format!("Before restoring {}", snap.name))?;
    let keep: std::collections::HashSet<&str> = wanted.iter().map(|f| f.0.as_str()).collect();
    for (rel, _) in project_files(root)? {
        if !keep.contains(rel.as_str()) {
            std::fs::remove_file(root.join(&rel)).map_err(|e| format!("removing {rel}: {e}"))?;
        }
    }
    copy_files(&from, root, &wanted)?;
    prune_empty_dirs(root);
    Ok(safety)
}

/// Removes folders a restore emptied (not hidden ones, and not the project root).
fn prune_empty_dirs(root: &Path) {
    fn walk(dir: &Path, top: bool) -> bool {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return false;
        };
        let mut empty = true;
        for e in rd.filter_map(|e| e.ok()) {
            let name = e.file_name().to_string_lossy().to_string();
            let p = e.path();
            let is_dir = e
                .file_type()
                .map(|t| t.is_dir() && !t.is_symlink())
                .unwrap_or(false);
            if is_dir
                && !name.starts_with('.')
                && !(top && SKIPPED_TOP_LEVEL.contains(&name.as_str()))
            {
                if walk(&p, false) {
                    let _ = std::fs::remove_dir(&p);
                } else {
                    empty = false;
                }
            } else {
                empty = false;
            }
        }
        empty
    }
    walk(root, true);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("nova-snap-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("scenes")).unwrap();
        std::fs::write(d.join("nova.json"), r#"{"format":1,"name":"T"}"#).unwrap();
        std::fs::write(d.join("main.lua"), "-- one").unwrap();
        std::fs::write(d.join("scenes/a.lua"), "a").unwrap();
        std::fs::create_dir_all(d.join("exports")).unwrap();
        std::fs::write(d.join("exports/out.gif"), "big").unwrap();
        d
    }

    #[test]
    fn a_snapshot_keeps_the_projects_files_and_not_exports_or_hidden_ones() {
        let d = project("make");
        std::fs::create_dir_all(d.join(".nova")).unwrap();
        std::fs::write(d.join(".nova/recovery.json"), "x").unwrap();
        let s = create(&d, "  Before the big change ").unwrap();
        assert_eq!(s.name, "Before the big change");
        assert_eq!(s.files, 3);
        assert!(
            d.join(format!(".nova/snapshots/{}/files/scenes/a.lua", s.id))
                .exists()
        );
        assert!(
            !d.join(format!(".nova/snapshots/{}/files/exports", s.id))
                .exists()
        );
        assert!(
            !d.join(format!(".nova/snapshots/{}/files/.nova", s.id))
                .exists()
        );
        assert_eq!(list(&d).unwrap(), vec![s]);
    }

    #[test]
    fn restoring_brings_back_old_files_removes_new_ones_and_keeps_a_way_back() {
        let d = project("restore");
        let before = create(&d, "start").unwrap();
        std::fs::write(d.join("main.lua"), "-- two").unwrap();
        std::fs::write(d.join("scenes/b.lua"), "b").unwrap();
        std::fs::remove_file(d.join("scenes/a.lua")).unwrap();
        std::fs::create_dir_all(d.join("sprites")).unwrap();
        std::fs::write(d.join("sprites/new.png"), "p").unwrap();
        let safety = restore(&d, &before.id).unwrap();
        assert_eq!(
            std::fs::read_to_string(d.join("main.lua")).unwrap(),
            "-- one"
        );
        assert!(d.join("scenes/a.lua").exists());
        assert!(!d.join("scenes/b.lua").exists());
        assert!(
            !d.join("sprites").exists(),
            "a folder the restore emptied goes"
        );
        assert!(
            d.join("exports/out.gif").exists(),
            "exports are not touched"
        );
        assert!(safety.name.starts_with("Before restoring start"));
        // and going back to what was there before the restore
        restore(&d, &safety.id).unwrap();
        assert_eq!(
            std::fs::read_to_string(d.join("main.lua")).unwrap(),
            "-- two"
        );
        assert!(d.join("scenes/b.lua").exists());
        assert!(d.join("sprites/new.png").exists());
    }

    #[test]
    fn names_ids_and_limits_are_checked() {
        let d = project("checks");
        assert!(create(&d, "   ").is_err());
        assert!(create(&d, &"x".repeat(61)).is_err());
        assert!(delete(&d, "../x").is_err());
        assert!(restore(&d, "nope").is_err());
        assert!(delete(&d, "nope").is_err());
        let a = create(&d, "a").unwrap();
        let b = create(&d, "a").unwrap();
        assert_ne!(a.id, b.id, "the same name twice still makes two snapshots");
        delete(&d, &a.id).unwrap();
        assert_eq!(list(&d).unwrap().len(), 1);
    }

    #[test]
    fn a_link_in_the_project_is_not_followed() {
        #[cfg(unix)]
        {
            let d = project("link");
            let outside =
                std::env::temp_dir().join(format!("nova-snap-outside-{}", std::process::id()));
            std::fs::create_dir_all(&outside).unwrap();
            std::fs::write(outside.join("secret.txt"), "s").unwrap();
            std::os::unix::fs::symlink(&outside, d.join("linked")).unwrap();
            let s = create(&d, "l").unwrap();
            assert_eq!(s.files, 3);
            assert!(
                !d.join(format!(".nova/snapshots/{}/files/linked", s.id))
                    .exists()
            );
        }
    }
}
