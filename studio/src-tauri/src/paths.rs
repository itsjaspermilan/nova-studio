//! Keeping every file operation inside the open project.
//!
//! Paths from the front end are project-relative with forward slashes. Anything absolute, with `..`,
//! backslashes or odd components is refused, and the resolved location must still be inside the
//! project once symbolic links are followed.

use std::path::{Component, Path, PathBuf};

/// Validates a project-relative path and returns it in canonical `a/b/c` form.
pub fn normalize(rel: &str) -> Result<String, String> {
    if rel.is_empty() {
        return Err("the path is empty".into());
    }
    if rel.contains('\0') || rel.contains('\\') {
        return Err(format!("'{rel}' is not a valid project path"));
    }
    if rel.starts_with('/') || rel.as_bytes().get(1) == Some(&b':') {
        return Err(format!("'{rel}' is an absolute path; use a path inside the project"));
    }
    let mut parts = Vec::new();
    for part in rel.split('/') {
        match part {
            "" | "." => {}
            ".." => return Err(format!("'{rel}' leaves the project folder")),
            other => parts.push(other),
        }
    }
    if parts.is_empty() {
        return Err(format!("'{rel}' does not name a file"));
    }
    Ok(parts.join("/"))
}

/// The absolute location of `rel` inside `root`. The file need not exist yet, but its nearest
/// existing parent must resolve to somewhere inside the project.
pub fn confine(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = normalize(rel)?;
    let root = root.canonicalize().map_err(|e| format!("the project folder is not available: {e}"))?;
    let full = root.join(&rel);
    let mut existing = full.as_path();
    while !existing.exists() {
        existing = existing.parent().ok_or("the path has no parent")?;
    }
    let real = existing.canonicalize().map_err(|e| format!("cannot resolve '{rel}': {e}"))?;
    if !real.starts_with(&root) {
        return Err(format!("'{rel}' resolves outside the project folder"));
    }
    // A path that only differs by how it is spelled must not slip past.
    if full.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!("'{rel}' leaves the project folder"));
    }
    Ok(full)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nova-paths-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn normalize_accepts_plain_paths_and_rejects_escapes() {
        assert_eq!(normalize("a/b.lua").unwrap(), "a/b.lua");
        assert_eq!(normalize("./a//b/./c").unwrap(), "a/b/c");
        for bad in ["", "/etc/passwd", "../x", "a/../../x", "C:/x", "a\\b", ".", "./", "a\0b"] {
            assert!(normalize(bad).is_err(), "'{bad}'");
        }
    }

    #[test]
    fn confine_resolves_new_and_existing_files_inside_the_project() {
        let root = scratch("ok");
        std::fs::create_dir_all(root.join("scenes")).unwrap();
        std::fs::write(root.join("main.lua"), "x").unwrap();
        assert!(confine(&root, "main.lua").unwrap().ends_with("main.lua"));
        assert!(confine(&root, "scenes/new/deep/file.lua").unwrap().ends_with("scenes/new/deep/file.lua"));
        assert!(confine(&root, "../outside").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_links_cannot_lead_out_of_the_project() {
        let root = scratch("link");
        let outside = scratch("outside");
        std::fs::write(outside.join("secret.txt"), "s").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("linked")).unwrap();
        std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("leak.txt")).unwrap();
        for rel in ["linked/secret.txt", "linked/new.txt", "leak.txt"] {
            let e = confine(&root, rel).unwrap_err();
            assert!(e.contains("outside the project"), "{rel}: {e}");
        }
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }
}
