//! `nova export`: checking a game before it leaves the studio, and the folder a finished desktop game is handed over in.
//! (The Android APK is built by `scripts/build-apk.sh`, which needs the Android toolchain; `nova export android` finds and runs it.)

use std::path::{Path, PathBuf};
use std::rc::Rc;

use crate::diagnostics::{self, Diagnostic};
use crate::game::{Game, NullUploader};
use crate::input::Actions;
use crate::pak;
use crate::project::Project;
use crate::vfs::{DirVfs, Vfs};

/// What `nova check` and `nova export` found: the problems, and whether any is an error.
pub struct CheckReport {
    pub ok: bool,
    pub name: Option<String>,
    pub frames_run: u32,
    pub problems: Vec<Diagnostic>,
}

/// Loads a project without a GPU, runs it for `frames` steps and lists every problem found.
pub fn check_project(folder: &Path, frames: u32) -> CheckReport {
    let mut problems: Vec<Diagnostic> = Vec::new();
    let mut name = None;
    let mut frames_run = 0;
    match DirVfs::new(folder).and_then(|v| Game::load(Rc::new(v) as Rc<dyn Vfs>)) {
        Err(message) => problems.push(diagnostics::parse(&message, "error")),
        Ok(mut game) => {
            name = Some(game.project.manifest.name.clone());
            game.upload(&mut NullUploader::default());
            for warning in &game.warnings {
                problems.push(diagnostics::parse(warning, "warning"));
            }
            for frame in 0..frames {
                if game.error.is_some() {
                    break;
                }
                game.update(
                    1.0 / 60.0,
                    frame as f64 / 60.0,
                    [960.0, 540.0],
                    Actions::default(),
                    false,
                );
                frames_run += 1;
            }
            if let Some(detail) = game.error_detail.take() {
                problems.push(diagnostics::parse(&detail, "error"));
            }
        }
    }
    CheckReport {
        ok: !problems.iter().any(|p| p.severity == "error"),
        name,
        frames_run,
        problems,
    }
}

/// An id made of lower-case letters, digits and underscores from a game's name, safe as a file name and an Android package part.
pub fn game_id(name: &str) -> String {
    let slug: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    if slug.is_empty() {
        "game".to_string()
    } else if slug.starts_with(|c: char| c.is_ascii_digit()) {
        format!("g{slug}")
    } else {
        slug
    }
}

/// What an export wrote.
pub struct Exported {
    pub dir: PathBuf,
    /// Paths of the files, relative to `dir`.
    pub files: Vec<String>,
}

/// Writes a folder `<out>/<id>/` that plays the game on a computer: the `nova` program (copied from `exe`) under the game's
/// name, `game.npk` beside it (the program plays it when started with no arguments), small start scripts and the notices
/// in `notices` (the third-party licences), when given.
pub fn export_desktop(
    project: &Path,
    out: &Path,
    exe: &Path,
    notices: Option<&str>,
) -> Result<Exported, String> {
    let vfs = DirVfs::new(project)?;
    let opened = Project::open(&vfs)?;
    let id = game_id(&opened.manifest.name);
    let windows = exe.extension().is_some_and(|e| e == "exe");
    let program = if windows {
        format!("{id}.exe")
    } else {
        id.clone()
    };
    let dir = out.join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let write = |name: &str, bytes: &[u8]| {
        std::fs::write(dir.join(name), bytes).map_err(|e| format!("cannot write {name}: {e}"))
    };
    let mut files = vec![];
    std::fs::copy(exe, dir.join(&program))
        .map_err(|e| format!("cannot copy {}: {e}", exe.display()))?;
    files.push(program.clone());
    write("game.npk", &pak::pack(&vfs)?)?;
    files.push("game.npk".into());
    write(
        "play.sh",
        format!(
            "#!/bin/sh\ncd \"$(dirname \"$0\")\"\nexec ./{program} run --pak game.npk \"$@\"\n"
        )
        .as_bytes(),
    )?;
    files.push("play.sh".into());
    write(
        "play.bat",
        format!("@echo off\r\ncd /d \"%~dp0\"\r\n{program} run --pak game.npk %*\r\n").as_bytes(),
    )?;
    files.push("play.bat".into());
    write(
        "README.txt",
        format!(
            "{name}\n\nRun {program} (or play.sh / play.bat) to play. F3 shows statistics, Esc quits.\n\nThis folder holds the game's runtime ({program}), its packed files (game.npk) and the licences of the software it\nis built from (THIRD-PARTY.txt).\n",
            name = opened.manifest.name
        )
        .as_bytes(),
    )?;
    files.push("README.txt".into());
    if let Some(text) = notices {
        write("THIRD-PARTY.txt", text.as_bytes())?;
        files.push("THIRD-PARTY.txt".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for name in [program.as_str(), "play.sh"] {
            let path = dir.join(name);
            let mut perm = std::fs::metadata(&path)
                .map_err(|e| e.to_string())?
                .permissions();
            perm.set_mode(0o755);
            std::fs::set_permissions(&path, perm).map_err(|e| e.to_string())?;
        }
    }
    Ok(Exported { dir, files })
}

/// Looks for `scripts/build-apk.sh` in each of `starts` and the folders above them (the Nova source tree).
pub fn find_apk_script(starts: &[PathBuf]) -> Option<PathBuf> {
    for start in starts {
        let mut at: Option<&Path> = Some(start.as_path());
        while let Some(dir) = at {
            let script = dir.join("scripts").join("build-apk.sh");
            if script.is_file() {
                return Some(script);
            }
            at = dir.parent();
        }
    }
    None
}
