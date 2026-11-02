//! A read-only view of a project's files, independent of where they live.
//!
//! Desktop reads a folder; the APK will read bundled assets; tests use memory. All
//! three share the same path rules: project-relative, forward slashes, no `..`, no
//! absolute paths, so a project can never reach outside itself.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

pub const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_FILES: usize = 20_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VfsEntry {
    pub path: String,
    pub size: u64,
}

pub trait Vfs {
    fn read(&self, path: &str) -> Result<Vec<u8>, String>;
    /// Every regular file, sorted by path.
    fn list(&self) -> Result<Vec<VfsEntry>, String>;
    /// The newest modification time of any file, if the source can tell (hot reload).
    fn stamp(&self) -> Option<SystemTime> {
        None
    }
    fn exists(&self, path: &str) -> bool {
        self.read(path).is_ok()
    }
}

/// Validates and normalises a project-relative path. Returns the canonical spelling.
pub fn normalize(path: &str) -> Result<String, String> {
    if path.is_empty() {
        return Err("path is empty".into());
    }
    if path.contains('\0') {
        return Err("path contains a NUL byte".into());
    }
    if path.contains('\\') {
        return Err(format!("'{path}' uses backslashes; use forward slashes"));
    }
    if path.starts_with('/') || path.as_bytes().get(1) == Some(&b':') {
        return Err(format!(
            "'{path}' is an absolute path; use a path inside the project"
        ));
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                return Err(format!(
                    "'{path}' leaves the project folder ('..' is not allowed)"
                ));
            }
            other => parts.push(other),
        }
    }
    if parts.is_empty() {
        return Err(format!("'{path}' does not name a file"));
    }
    Ok(parts.join("/"))
}

pub struct MemVfs {
    files: BTreeMap<String, Vec<u8>>,
}

impl MemVfs {
    pub fn new<'a>(files: impl IntoIterator<Item = (&'a str, Vec<u8>)>) -> Self {
        Self {
            files: files.into_iter().map(|(p, d)| (p.to_string(), d)).collect(),
        }
    }
}

impl Vfs for MemVfs {
    fn read(&self, path: &str) -> Result<Vec<u8>, String> {
        let path = normalize(path)?;
        self.files
            .get(&path)
            .cloned()
            .ok_or_else(|| format!("file '{path}' not found"))
    }

    fn list(&self) -> Result<Vec<VfsEntry>, String> {
        Ok(self
            .files
            .iter()
            .map(|(path, data)| VfsEntry {
                path: path.clone(),
                size: data.len() as u64,
            })
            .collect())
    }
}

pub struct DirVfs {
    root: PathBuf,
}

const SKIPPED_DIRECTORIES: [&str; 4] = ["build", "target", "node_modules", "dist"];

impl DirVfs {
    pub fn new(root: &Path) -> Result<Self, String> {
        let root = root
            .canonicalize()
            .map_err(|e| format!("cannot open project folder '{}': {e}", root.display()))?;
        if !root.is_dir() {
            return Err(format!("'{}' is not a folder", root.display()));
        }
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn walk(&self, dir: &Path, prefix: &str, out: &mut Vec<VfsEntry>) -> Result<(), String> {
        let entries =
            std::fs::read_dir(dir).map_err(|e| format!("cannot read '{}': {e}", dir.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue; // hidden files and the studio's own notes
            }
            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            if file_type.is_symlink() {
                continue; // never follow links: they could point outside the project
            }
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if file_type.is_dir() {
                if prefix.is_empty() && SKIPPED_DIRECTORIES.contains(&name.as_str()) {
                    continue;
                }
                self.walk(&entry.path(), &rel, out)?;
            } else if file_type.is_file() {
                if out.len() >= MAX_FILES {
                    return Err(format!("project has more than {MAX_FILES} files"));
                }
                let size = entry.metadata().map_err(|e| e.to_string())?.len();
                out.push(VfsEntry { path: rel, size });
            }
        }
        Ok(())
    }
}

impl Vfs for DirVfs {
    fn read(&self, path: &str) -> Result<Vec<u8>, String> {
        let path = normalize(path)?;
        let full = self.root.join(&path);
        let real = full
            .canonicalize()
            .map_err(|_| format!("file '{path}' not found"))?;
        if !real.starts_with(&self.root) {
            return Err(format!("'{path}' resolves outside the project folder"));
        }
        let meta = std::fs::metadata(&real).map_err(|e| format!("cannot read '{path}': {e}"))?;
        if !meta.is_file() {
            return Err(format!("'{path}' is not a file"));
        }
        if meta.len() > MAX_FILE_BYTES {
            return Err(format!(
                "'{path}' is {} MiB; the limit is {} MiB",
                meta.len() >> 20,
                MAX_FILE_BYTES >> 20
            ));
        }
        std::fs::read(&real).map_err(|e| format!("cannot read '{path}': {e}"))
    }

    fn list(&self) -> Result<Vec<VfsEntry>, String> {
        let mut out = Vec::new();
        self.walk(&self.root, "", &mut out)?;
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    fn stamp(&self) -> Option<SystemTime> {
        let mut newest = None;
        let mut stack = vec![self.root.clone()];
        let mut seen = 0usize;
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') {
                    continue;
                }
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if file_type.is_symlink() {
                    continue;
                }
                if file_type.is_dir() {
                    if !(dir == self.root && SKIPPED_DIRECTORIES.contains(&name.as_str())) {
                        stack.push(entry.path());
                    }
                } else if let Ok(modified) = entry.metadata().and_then(|m| m.modified()) {
                    newest = Some(newest.map_or(modified, |n: SystemTime| n.max(modified)));
                    seen += 1;
                    if seen > MAX_FILES {
                        return newest;
                    }
                }
            }
        }
        newest
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_accepts_plain_relative_paths() {
        assert_eq!(normalize("a/b.png").unwrap(), "a/b.png");
        assert_eq!(normalize("./a//b/./c.lua").unwrap(), "a/b/c.lua");
    }

    #[test]
    fn normalize_rejects_escapes_and_oddities() {
        for bad in [
            "",
            "/etc/passwd",
            "../x",
            "a/../../x",
            "a/..",
            "C:/x",
            "a\\b",
            ".",
            "./",
            "a\0b",
        ] {
            assert!(normalize(bad).is_err(), "'{bad}' should be rejected");
        }
        assert!(
            normalize("../x")
                .unwrap_err()
                .contains("leaves the project")
        );
        assert!(normalize("/etc/passwd").unwrap_err().contains("absolute"));
    }

    #[test]
    fn mem_vfs_reads_and_lists_sorted() {
        let vfs = MemVfs::new([("b.lua", b"2".to_vec()), ("a/x.png", b"1".to_vec())]);
        assert_eq!(vfs.read("./a/x.png").unwrap(), b"1");
        assert!(vfs.read("missing").unwrap_err().contains("not found"));
        let paths: Vec<_> = vfs.list().unwrap().into_iter().map(|e| e.path).collect();
        assert_eq!(paths, ["a/x.png", "b.lua"]);
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nova-vfs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn dir_vfs_lists_files_skips_hidden_and_build_output() {
        let dir = scratch("list");
        std::fs::create_dir_all(dir.join("sprites")).unwrap();
        std::fs::create_dir_all(dir.join(".nova")).unwrap();
        std::fs::create_dir_all(dir.join("build")).unwrap();
        std::fs::write(dir.join("main.lua"), "x").unwrap();
        std::fs::write(dir.join("sprites/a.png"), "y").unwrap();
        std::fs::write(dir.join(".nova/notes.json"), "z").unwrap();
        std::fs::write(dir.join("build/out.bin"), "z").unwrap();
        let vfs = DirVfs::new(&dir).unwrap();
        let paths: Vec<_> = vfs.list().unwrap().into_iter().map(|e| e.path).collect();
        assert_eq!(paths, ["main.lua", "sprites/a.png"]);
        assert!(vfs.stamp().is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn dir_vfs_never_follows_symlinks_out_of_the_project() {
        let dir = scratch("link");
        let outside = scratch("outside");
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.join("secret.txt"), dir.join("leak.txt")).unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("linked")).unwrap();
        std::fs::write(dir.join("ok.lua"), "1").unwrap();
        let vfs = DirVfs::new(&dir).unwrap();
        let paths: Vec<_> = vfs.list().unwrap().into_iter().map(|e| e.path).collect();
        assert_eq!(paths, ["ok.lua"], "links are not listed");
        assert!(
            vfs.read("leak.txt")
                .unwrap_err()
                .contains("outside the project")
        );
        assert!(
            vfs.read("linked/secret.txt")
                .unwrap_err()
                .contains("outside the project")
        );
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outside);
    }
}
