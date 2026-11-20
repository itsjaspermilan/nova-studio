//! `nova export`: checking a game before it leaves the studio, and the folder a finished desktop game is handed over in.
//! (The Android APK is built by `android.rs`, which needs the Android SDK.)

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

/// A Lua source with its comments and the insides of its strings blanked out (line breaks kept), so that what is
/// left is code only and a word in a comment is not mistaken for a call.
fn code_only(source: &str) -> String {
    let b: Vec<char> = source.chars().collect();
    let mut out = String::with_capacity(source.len());
    let mut i = 0;
    // (a long bracket's level at `at`: `[[` is 0, `[=[` is 1; none: not one)
    let long_open = |at: usize| -> Option<usize> {
        if b.get(at) != Some(&'[') {
            return None;
        }
        let mut n = 0;
        while b.get(at + 1 + n) == Some(&'=') {
            n += 1;
        }
        (b.get(at + 1 + n) == Some(&'[')).then_some(n)
    };
    let blank = |c: char| if c == '\n' { '\n' } else { ' ' };
    while i < b.len() {
        let c = b[i];
        let comment = c == '-' && b.get(i + 1) == Some(&'-');
        let long = if comment {
            long_open(i + 2)
        } else {
            long_open(i)
        };
        if let Some(level) = long {
            // a long string or a block comment: to its closing bracket of the same level
            let start = if comment { i + 2 } else { i };
            let mut j = start + level + 2;
            loop {
                if j >= b.len() {
                    break;
                }
                if b[j] == ']'
                    && (0..level).all(|k| b.get(j + 1 + k) == Some(&'='))
                    && b.get(j + 1 + level) == Some(&']')
                {
                    j += level + 2;
                    break;
                }
                j += 1;
            }
            out.extend(b[i..j.min(b.len())].iter().map(|c| blank(*c)));
            i = j;
        } else if comment {
            while i < b.len() && b[i] != '\n' {
                out.push(' ');
                i += 1;
            }
        } else if c == '"' || c == '\'' {
            out.push(c);
            i += 1;
            while i < b.len() && b[i] != c && b[i] != '\n' {
                if b[i] == '\\' && i + 1 < b.len() {
                    out.push(' ');
                    i += 1;
                }
                out.push(blank(b[i]));
                i += 1;
            }
            if i < b.len() && b[i] == c {
                out.push(c);
                i += 1;
            }
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

/// Common calls whose first argument has one kind (`n` a number, `s` text, `t` a table), with the call as it is meant.
const FIRST_ARGUMENT: &[(&str, char, &str)] = &[
    (
        "music.stop",
        'n',
        "nova.music.stop(0.5): the seconds to fade over",
    ),
    (
        "music.play",
        's',
        "nova.music.play(\"town\", { volume = 0.5 })",
    ),
    (
        "sound.play",
        's',
        "nova.sound.play(\"hit\", { volume = 0.8 })",
    ),
    ("goto_scene", 's', "nova.goto_scene(\"cave\")"),
    ("start", 's', "nova.start(\"title\")"),
    ("named", 's', "nova.named(\"hero\")"),
    ("first", 's', "nova.first(\"enemy\"): a tag"),
    ("all", 's', "nova.all(\"enemy\"): a tag"),
    ("count", 's', "nova.count(\"enemy\"): a tag"),
    ("scene_data", 's', "nova.scene_data(\"cave\")"),
    ("clear", 'n', "nova.clear(r, g, b)"),
    ("camera", 'n', "nova.camera(ex, ey, ez, tx, ty, tz)"),
    ("cam.set", 'n', "nova.cam.set(x, y)"),
    (
        "shadows",
        't',
        "nova.shadows{ radius = 30, strength = 0.8 } (or nil for none)",
    ),
    (
        "fog",
        't',
        "nova.fog{ color = { r, g, b }, near = 40, far = 250 } (or nil for none)",
    ),
    (
        "light",
        't',
        "nova.light{ dir = { x, y, z }, ambient = { r, g, b } }",
    ),
    (
        "collision",
        't',
        "nova.collision{ plane = \"xz\", cell = 4 }",
    ),
];

/// Says so when one of the calls in [`FIRST_ARGUMENT`] is given a literal of the wrong kind (`rest` is the line from
/// just after the call's name): `nova.music.stop({ fade = 1 })` takes a number. Only what can be read off the line is
/// judged; a variable or an expression is not.
fn wrong_first_argument(name: &str, rest: &str) -> Option<String> {
    let (_, wanted, example) = FIRST_ARGUMENT.iter().find(|(n, _, _)| *n == name)?;
    let rest = rest.trim_start();
    // (`nova.fog{ ... }` and `nova.start "title"` are calls too)
    let argument = match rest.strip_prefix('(') {
        Some(inside) => inside.trim_start(),
        None if rest.starts_with(['{', '"', '\'']) => rest,
        None => return None,
    };
    let first = argument.chars().next()?;
    let given = match first {
        '{' => 't',
        '"' | '\'' => 's',
        c if c.is_ascii_digit() => 'n',
        _ => return None,
    };
    if given == *wanted {
        return None;
    }
    // (a text that is joined to something, or a number in a sum, is still what it is; a table is never a number)
    let word = |k: char| match k {
        't' => "a table",
        's' => "a text",
        _ => "a number",
    };
    Some(format!(
        "nova.{name} is given {} and takes {} there ({example})",
        word(given),
        word(*wanted)
    ))
}

/// Mistakes that can be read off the scripts without running the line they are on:
/// - a common call given a literal of the wrong kind (`nova.music.stop({ fade = 1 })` takes a number);
/// - a `nova.<name>` that the API does not have (a call such as `nova.scene_nowx()` in a pickup's code only fails when
///   something is picked up, long after `check`'s few frames);
/// - `self.y = self.y + self.vy * dt`: the engine itself adds `vx`, `vy`, `vz` to the position every step, so an entity
///   that keeps its own speed in `vy` and moves by it too goes twice as far (unless it says `velocity = false`).
fn source_warnings(game: &Game) -> Vec<String> {
    let vfs = game.vfs();
    let ignore = &game.project.manifest.ignore;
    let mut out = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    let ident = |c: char| c.is_ascii_alphanumeric() || c == '_';
    for entry in vfs.list().unwrap_or_default() {
        if !entry.path.ends_with(".lua") || crate::project::ignored(ignore, &entry.path) {
            continue;
        }
        let Ok(bytes) = vfs.read(&entry.path) else {
            continue;
        };
        let code = code_only(&String::from_utf8_lossy(&bytes));
        // (an entity with `velocity = false` moves itself: its vx, vy, vz are its own)
        let own_velocity = code
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect::<String>()
            .contains("velocity=false");
        for (n, line) in code.lines().enumerate() {
            // names under `nova.`
            let mut from = 0;
            while let Some(found) = line[from..].find("nova.") {
                let at = from + found;
                from = at + 5;
                let before = line[..at].chars().next_back();
                if before.is_some_and(|c| ident(c) || c == '.' || c == ':') {
                    continue; // (`self.nova.x`, `supernova.x`: not the API)
                }
                let mut parts: Vec<String> = Vec::new();
                let mut rest = &line[at + 5..];
                loop {
                    let len = rest.chars().take_while(|c| ident(*c)).count();
                    if len == 0 || rest.starts_with(|c: char| c.is_ascii_digit()) {
                        break;
                    }
                    parts.push(rest[..len].to_string());
                    rest = &rest[len..];
                    match rest.strip_prefix('.') {
                        Some(r) if !r.starts_with('.') => rest = r,
                        _ => break,
                    }
                }
                // (a name that the line itself gives a value is the game's own: `nova.score = 0`)
                let assigned =
                    rest.trim_start().starts_with('=') && !rest.trim_start().starts_with("==");
                if parts.is_empty() || assigned {
                    continue;
                }
                if let Some(text) = wrong_first_argument(&parts.join("."), rest) {
                    out.push(format!(
                        "{}:{}: {text}, so this line will fail when it runs",
                        entry.path,
                        n + 1
                    ));
                }
                if let Some(missing) = game.api_missing(&parts)
                    && seen.insert((entry.path.clone(), missing.clone()))
                {
                    out.push(format!(
                        "{}:{}: {missing} is not in the Lua API, so this line will fail when it runs (look the name up with the api tool, or in docs/project-format.md)",
                        entry.path,
                        n + 1
                    ));
                }
            }
            // moving by the engine's own velocity fields
            let tight: String = line.chars().filter(|c| !c.is_whitespace()).collect();
            for axis in ["x", "y", "z"] {
                let moved = [
                    format!("self.{axis}=self.{axis}+"),
                    format!("self.{axis}=self.{axis}-"),
                ]
                .iter()
                .any(|p| tight.contains(p.as_str()));
                let by = format!("self.v{axis}");
                let uses = tight
                    .match_indices(by.as_str())
                    .any(|(i, _)| !tight[i + by.len()..].starts_with(|c: char| ident(c)));
                if moved && uses && !own_velocity {
                    out.push(format!(
                        "{}:{}: self.{axis} is moved by self.v{axis} here, and the engine also adds vx, vy, vz to every entity's position each step, so it moves twice as far: only set self.v{axis} and let the engine do the moving, or put `velocity = false` in the entity (nova.entity {{ velocity = false, ... }}) so that vx, vy, vz are your own, or keep your speed under another name",
                        entry.path,
                        n + 1
                    ));
                }
            }
        }
    }
    out
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
            for error in &game.shader_errors {
                problems.push(diagnostics::parse(error, "error"));
            }
            let read_off = source_warnings(&game);
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
            // (after the frames: a name the game's own code gives `nova` while it runs is then known)
            for warning in read_off
                .iter()
                .filter(|w| !w.contains(" is not in the Lua API"))
                .chain(
                    source_warnings(&game)
                        .iter()
                        .filter(|w| w.contains(" is not in the Lua API")),
                )
            {
                problems.push(diagnostics::parse(warning, "warning"));
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
