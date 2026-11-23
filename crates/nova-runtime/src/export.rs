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

/// The calls whose first argument names a file of the project, and the kind of file (see `Game::asset_exists`).
fn asset_call(name: &str) -> Option<&'static str> {
    Some(match name {
        "sound.play" => "sound",
        "music.play" => "music",
        "goto_scene" | "start" => "scene",
        "sprite" => "sprite",
        "model" => "model",
        _ => return None,
    })
}

/// The text of a string literal at the start of `rest` (after an optional `(`), when it is the whole argument: not
/// `"walk_" .. dir` or a text with escapes, which cannot be judged.
fn first_literal(rest: &str) -> Option<String> {
    let rest = rest.trim_start();
    let rest = rest.strip_prefix('(').unwrap_or(rest).trim_start();
    let quote = rest.chars().next().filter(|c| *c == '"' || *c == '\'')?;
    let inside = &rest[1..];
    let end = inside.find(quote)?;
    let text = &inside[..end];
    if text.is_empty() || text.contains('\\') || inside[end + 1..].trim_start().starts_with("..") {
        return None;
    }
    Some(text.to_string())
}

/// How many single-letter edits turn one name into the other.
fn edits(a: &str, b: &str) -> usize {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut prev = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let here = row[j + 1];
            row[j + 1] = (prev + usize::from(ca != cb)).min(row[j] + 1).min(here + 1);
            prev = here;
        }
    }
    row[b.len()]
}

/// A name given to a common call that matches no file: the warning, with the nearest name there is.
fn missing_asset(game: &Game, kind: &str, call: &str, name: &str) -> Option<String> {
    if game.asset_exists(kind, name) {
        return None;
    }
    let names = game.asset_names(kind);
    let short = name.rsplit('/').next().unwrap_or(name);
    let nearest = names
        .iter()
        .min_by_key(|n| edits(n, name).min(edits(n, short) + 1));
    let folder = match kind {
        "sound" => "sounds/ or music/",
        "music" => "music/",
        "sprite" => "sprites/",
        "model" => "models/",
        _ => "scenes/",
    };
    Some(format!(
        "{call} names the {kind} '{name}', which is not in {folder}{}, so this line will fail when it runs",
        match nearest {
            Some(n) => format!(" (the nearest is '{n}')"),
            None => format!(" (there is no {kind} in this project yet)"),
        }
    ))
}

/// An entity whose class has a `sprite` or `model` and that defines its own `draw()` which draws nothing of its own
/// (no `nova.Entity.draw(self)`, and no other call that draws a sprite, a model or anything with a `draw`): its picture is never drawn. Returns
/// the line of the `draw` function.
fn draw_hides_picture(code: &str) -> Option<usize> {
    let lines: Vec<&str> = code.lines().collect();
    let start = lines.iter().position(|l| {
        let t = l.trim_start();
        t.starts_with("function ") && (t.contains(":draw(") || t.contains(".draw(self"))
    })?;
    if lines[start].starts_with(|c: char| c.is_whitespace()) {
        return None; // (a draw defined inside something else: not judged)
    }
    let end = lines[start + 1..]
        .iter()
        .position(|l| l.trim_end() == "end")
        .map(|i| start + 1 + i)?;
    let body: String = lines[start + 1..end].concat();
    let draws = ["draw(", "sprite(", "model(", "mesh(", "billboard("]
        .iter()
        .any(|d| body.contains(d));
    // only what the class's own spec says (`nova.entity { sprite = "..." }`): a `sprite = "..."` in a spawn call's props
    // elsewhere in the file is another entity's
    let spec = entity_specs(code);
    let tight: String = spec.chars().filter(|c| !c.is_whitespace()).collect();
    let has_picture = tight.contains("sprite=\"")
        || tight.contains("model=\"")
        || tight.contains("sprite='")
        || tight.contains("model='");
    (!draws && has_picture).then_some(start + 1)
}

/// The text of every `nova.entity { ... }` table in the code (with a parent, `nova.entity(Parent, { ... })`, the table
/// after it), braces matched.
fn entity_specs(code: &str) -> String {
    let mut out = String::new();
    let mut from = 0;
    while let Some(at) = code[from..].find("nova.entity") {
        let begin = from + at + "nova.entity".len();
        let Some(open) = code[begin..].find('{').map(|i| begin + i) else {
            break;
        };
        let mut depth = 0usize;
        let mut end = code.len();
        for (i, ch) in code[open..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = open + i + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
        out.push_str(&code[open..end]);
        out.push('\n');
        from = end;
    }
    out
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
        let source = String::from_utf8_lossy(&bytes);
        let source_lines: Vec<&str> = source.lines().collect();
        let code = code_only(&source);
        // the text of the source from the place `rest` (a tail of the code's line `n`) starts, string literals intact
        let original = |n: usize, line: &str, rest: &str| -> String {
            let col = line[..line.len() - rest.len()].chars().count();
            source_lines
                .get(n)
                .map(|l| l.chars().skip(col).collect())
                .unwrap_or_default()
        };
        if entry.path.starts_with("entities/")
            && let Some(line) = draw_hides_picture(&code)
        {
            out.push(format!(
                "{}:{line}: this entity has a sprite or a model, and its own draw() replaces the drawing of it, so it is never drawn: call nova.Entity.draw(self) in draw() where the picture should be drawn (or draw it yourself with nova.sprite or nova.model)",
                entry.path
            ));
        }
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
                let joined = parts.join(".");
                if let Some(kind) = asset_call(&joined)
                    && let Some(name) = first_literal(&original(n, line, rest))
                    && let Some(text) = missing_asset(game, kind, &format!("nova.{joined}"), &name)
                {
                    out.push(format!("{}:{}: {text}", entry.path, n + 1));
                }
                if let Some(text) = wrong_first_argument(&joined, rest) {
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
            // an entity's picture: `sprite = "hero"`, `model = "tree"` (in nova.entity { ... }, or self.sprite = "...")
            for (field, kind) in [("sprite", "sprite"), ("model", "model")] {
                for (at, _) in line.match_indices(field) {
                    if line[..at]
                        .chars()
                        .next_back()
                        .is_some_and(|c| ident(c) || c == ':')
                        || line[at + field.len()..].starts_with(|c: char| ident(c))
                    {
                        continue;
                    }
                    let after = line[at + field.len()..].trim_start();
                    let Some(value) = after.strip_prefix('=').filter(|v| !v.starts_with('='))
                    else {
                        continue;
                    };
                    if let Some(name) = first_literal(&original(n, line, value))
                        && !value.trim_start().starts_with('(')
                        && let Some(text) = missing_asset(game, kind, &format!("{field} ="), &name)
                    {
                        out.push(format!("{}:{}: {text}", entry.path, n + 1));
                    }
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
    if let Some(text) = with_game_notices(Some(project), notices) {
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

/// The game's own notices: every `.txt` and `.md` file in the project's `licenses/` folder (the licences of the art, sounds
/// and fonts the game took from others, such as a Kenney pack's), in name order, each under its file name. None when the
/// folder is missing or holds none.
pub fn game_notices(project: &Path) -> Option<String> {
    let dir = project.join("licenses");
    let mut names: Vec<PathBuf> = std::fs::read_dir(&dir)
        .ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_file() && p.extension().is_some_and(|x| x == "txt" || x == "md"))
        .collect();
    names.sort();
    let mut out = String::new();
    for path in names {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        out.push_str(&format!("---- licenses/{name}\n\n{}\n\n", text.trim_end()));
    }
    (!out.is_empty()).then_some(out)
}

/// The notices an exported game carries: the engine's (`engine`, the licences of the software the runtime is built from)
/// followed by the game's own (`game_notices`), under a heading. None when there are neither.
pub fn with_game_notices(project: Option<&Path>, engine: Option<&str>) -> Option<String> {
    let game = project.and_then(game_notices);
    match (engine, game) {
        (None, None) => None,
        (Some(e), None) => Some(e.to_string()),
        (e, Some(g)) => Some(format!(
            "{}==== This game's own assets: the licences of what it took from others (its licenses/ folder)\n\n{g}",
            e.map(|e| format!("{}\n\n", e.trim_end()))
                .unwrap_or_default()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A game's own licences (its `licenses/` folder) travel with the engine's in the exported THIRD-PARTY.txt, in name
    /// order, each under its file name; a game without the folder gets the engine's alone.
    #[test]
    fn the_games_own_licences_follow_the_engines_notices() {
        let dir = std::env::temp_dir().join(format!("nova-notices-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("licenses")).unwrap();
        assert_eq!(
            with_game_notices(Some(&dir), Some("ENGINE")).as_deref(),
            Some("ENGINE")
        );
        assert_eq!(with_game_notices(Some(&dir), None), None);
        std::fs::write(dir.join("licenses/b-pack.txt"), "CC0 pack B\n").unwrap();
        std::fs::write(dir.join("licenses/a-font.md"), "OFL font A").unwrap();
        std::fs::write(dir.join("licenses/notes.png"), "not a notice").unwrap();
        let text = with_game_notices(Some(&dir), Some("ENGINE\n")).unwrap();
        assert!(
            text.starts_with("ENGINE\n\n==== This game's own assets"),
            "{text}"
        );
        let a = text
            .find("---- licenses/a-font.md\n\nOFL font A")
            .expect("the font's notice");
        let b = text
            .find("---- licenses/b-pack.txt\n\nCC0 pack B")
            .expect("the pack's notice");
        assert!(a < b, "in name order");
        assert!(!text.contains("not a notice"));
        assert!(
            with_game_notices(Some(&dir), None)
                .unwrap()
                .starts_with("==== This game's own assets")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The warning about a draw() that hides the picture looks only at the class's own spec: a `sprite = "..."` in a
    /// spawn call's props elsewhere in the file is another entity's.
    #[test]
    fn a_draw_hides_the_picture_only_of_a_class_that_has_one() {
        let has = "local E = nova.entity { sprite = \"hero\", hp = { 3 } }\nfunction E:draw()\n  nova.log('x')\nend\nreturn E\n";
        assert_eq!(draw_hides_picture(&code_only(has)), Some(2));
        let spawns = "local E = nova.entity { hp = 3 }\nfunction E:hit() nova.spawn(\"fx\", 0, 0, { sprite = \"fx_burst\" }) end\nfunction E:draw()\n  nova.log('x')\nend\nreturn E\n";
        assert_eq!(draw_hides_picture(&code_only(spawns)), None);
        let child = "local E = nova.entity(require(\"entities.base\"), { model = 'crate' })\nfunction E:draw()\n  nova.log('x')\nend\nreturn E\n";
        assert_eq!(draw_hides_picture(&code_only(child)), Some(2));
    }
}
