//! `nova check` end to end: the real binary on small projects written to a temp folder.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nova-check-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(dir: &Path, rel: &str, text: &str) {
    let path = dir.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn check(dir: &Path) -> (bool, Value, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_nova"))
        .args(["check", &dir.to_string_lossy(), "--json"])
        .output()
        .expect("runs nova");
    let report: Value = serde_json::from_slice(&out.stdout).unwrap_or_else(|e| {
        panic!(
            "stdout is JSON ({e}): {}",
            String::from_utf8_lossy(&out.stdout)
        )
    });
    (
        out.status.success(),
        report,
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn first(report: &Value) -> &Value {
    &report["diagnostics"][0]
}

#[test]
fn a_good_project_passes_with_no_diagnostics() {
    let dir = scratch("good");
    write(&dir, "nova.json", r#"{"format":1,"name":"Good"}"#);
    write(
        &dir,
        "main.lua",
        "function update(dt) nova.rect(0, 0, 4, 4) end",
    );
    let (ok, report, stderr) = check(&dir);
    assert!(ok && report["ok"] == true, "{report}");
    assert_eq!(report["name"], "Good");
    assert_eq!(report["diagnostics"].as_array().unwrap().len(), 0);
    assert_eq!(report["frames_run"], 60);
    assert!(stderr.is_empty(), "no log noise: {stderr}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_lua_syntax_error_names_the_file_and_line() {
    let dir = scratch("syntax");
    write(&dir, "nova.json", r#"{"format":1,"name":"S"}"#);
    write(&dir, "main.lua", "local x = 1\nthis is not lua\n");
    let (ok, report, _) = check(&dir);
    assert!(!ok && report["ok"] == false);
    let d = first(&report);
    assert_eq!(
        (
            d["file"].as_str(),
            d["line"].as_u64(),
            d["severity"].as_str()
        ),
        (Some("main.lua"), Some(2), Some("error")),
        "{d}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_runtime_error_in_a_scene_points_at_the_scene_and_keeps_the_real_message() {
    let dir = scratch("runtime");
    write(&dir, "nova.json", r#"{"format":1,"name":"R"}"#);
    write(&dir, "main.lua", "nova.start('s')");
    write(
        &dir,
        "scenes/s.lua",
        "local S = nova.scene {}\nfunction S:enter()\n  nova.sprite('nope', 1, 2)\nend\nreturn S",
    );
    let (ok, report, _) = check(&dir);
    assert!(!ok);
    let d = first(&report);
    assert_eq!(
        (d["file"].as_str(), d["line"].as_u64()),
        (Some("scenes/s.lua"), Some(3)),
        "{d}"
    );
    assert!(
        d["message"]
            .as_str()
            .unwrap()
            .contains("unknown image 'nope'"),
        "{d}"
    );
    assert!(d["detail"].as_str().unwrap().contains("stack traceback"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn data_file_problems_name_the_file_and_place() {
    let dir = scratch("data");
    write(&dir, "nova.json", r#"{"format":1,"name":"D"}"#);
    write(&dir, "main.lua", "nova.start('s')");
    write(&dir, "scenes/s.lua", "return nova.scene {}");
    write(
        &dir,
        "scenes/s.scene.json",
        r#"{"version":1,"objects":[{"x":1}]}"#,
    );
    let (ok, report, _) = check(&dir);
    assert!(!ok);
    let d = first(&report);
    assert_eq!(d["file"], "scenes/s.scene.json", "{d}");
    assert_eq!(d["place"], "objects[0]", "{d}");
    assert_eq!(d["message"], "missing \"kind\"");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn project_level_problems_and_missing_folders_are_reported_without_a_file() {
    let dir = scratch("empty");
    let (ok, report, _) = check(&dir);
    assert!(!ok);
    assert!(
        first(&report)["message"]
            .as_str()
            .unwrap()
            .starts_with("no nova.json found")
    );
    assert!(first(&report)["file"].is_null());

    let (ok, report, _) = check(&dir.join("does-not-exist"));
    assert!(!ok);
    assert!(
        first(&report)["message"]
            .as_str()
            .unwrap()
            .contains("cannot open project folder")
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn warnings_do_not_fail_the_check() {
    let dir = scratch("warn");
    write(
        &dir,
        "nova.json",
        r#"{"format":1,"name":"W","colour":"red"}"#,
    );
    write(&dir, "main.lua", "");
    write(&dir, "pic.jpg", "x");
    let (ok, report, _) = check(&dir);
    assert!(ok, "{report}");
    let diags = report["diagnostics"].as_array().unwrap();
    assert_eq!(diags.len(), 2);
    assert!(diags.iter().all(|d| d["severity"] == "warning"));
    assert!(diags.iter().any(|d| d["file"] == "nova.json"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_shipped_examples_all_check_clean() {
    for example in ["pine-ridge-rally", "font-gallery"] {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples")
            .join(example);
        let (ok, report, _) = check(&dir);
        assert!(
            ok && report["diagnostics"].as_array().unwrap().is_empty(),
            "{example}: {report}"
        );
    }
}

#[test]
fn the_plain_text_report_is_readable() {
    let dir = scratch("text");
    write(&dir, "nova.json", r#"{"format":1,"name":"T"}"#);
    write(&dir, "main.lua", "oops oops");
    let out = Command::new(env!("CARGO_BIN_EXE_nova"))
        .args(["check", &dir.to_string_lossy()])
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.contains("error: main.lua:1:") && text.contains("errors found"),
        "{text}"
    );
    assert_eq!(out.status.code(), Some(1));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_runtime_error_comes_with_its_call_stack() {
    let dir = scratch("stack");
    write(&dir, "nova.json", r#"{"format":1,"name":"Stack"}"#);
    write(
        &dir,
        "main.lua",
        "local function inner() error('boom') end\nlocal function outer() inner() end\nfunction update(dt) outer() end\n",
    );
    let (ok, report, _) = check(&dir);
    assert!(!ok);
    let d = first(&report);
    assert_eq!(d["file"], "main.lua");
    let frames: Vec<(String, i64)> = d["stack"]
        .as_array()
        .expect("a stack")
        .iter()
        .filter(|f| f["internal"] == false)
        .map(|f| {
            (
                f["file"].as_str().unwrap().to_string(),
                f["line"].as_i64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        frames,
        [
            ("main.lua".to_string(), 1),
            ("main.lua".to_string(), 2),
            ("main.lua".to_string(), 3)
        ],
        "{d}"
    );
}

/// Mistakes on lines that the check's few frames never reach are read off the source: a `nova.<name>` the API does not
/// have, and an entity that moves itself by the engine's own velocity fields.
#[test]
fn names_the_api_does_not_have_and_double_movement_are_found_without_running_the_line() {
    let dir = scratch("read-off");
    write(
        &dir,
        "nova.json",
        r#"{"format":1,"name":"Lint","ignore":["tools"]}"#,
    );
    write(&dir, "main.lua", "nova.start('s')\nnova.score = 0\n");
    write(
        &dir,
        "scenes/s.lua",
        "local S = nova.scene {}\nfunction S:enter() nova.spawn('gem', 10, 10) nova.spawn('faller', 50, 10) nova.spawn('walker', 90, 10) end\nreturn S\n",
    );
    write(
        &dir,
        "entities/gem.lua",
        r#"-- nova.not_a_call() in a comment is not code, nor is "nova.in_a_string()" or [[ nova.in_a_long_string() ]]
local Gem = nova.entity { tags = { "gem" }, hitbox = { 0, 0, 8, 8 } }
function Gem:on_collide_hero(hero)
  nova.scene_nowx():gem_taken(self)   -- only runs when a gem is picked up
  nova.cam.shake_it(4)
  nova.sound.play("ding")
  nova.score = nova.score + 1
  local e = nova.cam3.eye.x + nova.world.time
  mynova.thing()
end
return Gem
"#,
    );
    write(
        &dir,
        "entities/faller.lua",
        "local F = nova.entity { vy = 0 }\nfunction F:update(dt)\n  self.vy = self.vy + 600 * dt\n  self.y = self.y + self.vy * dt\n  self.x = self.x + 20 * dt\n  if self.vyx == self.vy then end\nend\nreturn F\n",
    );
    // (an entity that says it moves itself may use the names as its own)
    write(
        &dir,
        "entities/walker.lua",
        "local Wk = nova.entity { velocity = false, vx = 30 }\nfunction Wk:update(dt) self.x = self.x + self.vx * dt end\nreturn Wk\n",
    );
    write(&dir, "tools/gen.lua", "nova.nothing_here()\n");
    let (ok, report, _) = check(&dir);
    assert!(ok, "warnings are not errors: {report}");
    let said: Vec<String> = report["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| {
            format!(
                "{} {}:{} {}",
                d["severity"].as_str().unwrap(),
                d["file"].as_str().unwrap_or("?"),
                d["line"],
                d["message"].as_str().unwrap()
            )
        })
        .collect();
    assert_eq!(said.len(), 3, "{said:#?}");
    assert!(
        said.iter().any(|s| s.starts_with(
            "warning entities/faller.lua:4 self.y is moved by self.vy here, and the engine also adds vx, vy, vz"
        ) && s.contains("velocity = false")),
        "{said:#?}"
    );
    assert!(
        said.iter()
            .any(|s| s
                .starts_with("warning entities/gem.lua:4 nova.scene_nowx is not in the Lua API")),
        "{said:#?}"
    );
    assert!(
        said.iter()
            .any(|s| s
                .starts_with("warning entities/gem.lua:5 nova.cam.shake_it is not in the Lua API")),
        "{said:#?}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_wrong_kind_of_argument_is_read_off_a_line_that_never_ran_and_carries_its_place_when_it_runs() {
    let dir = scratch("kinds");
    write(&dir, "nova.json", r#"{"format":1,"name":"K"}"#);
    write(&dir, "main.lua", "nova.start(\"title\")");
    write(
        &dir,
        "scenes/title.lua",
        "local S = nova.scene {}\nfunction S:later()\n  nova.music.stop({ fade = 1 })\n  nova.music.stop(0.5)\n  nova.music.stop(self.fade)\n  nova.sound.play { name = \"hit\" }\n  nova.shadows(0.5)\n  nova.shadows(nil)\n  nova.fog{ near = 1, far = 2 }\n  nova.goto_scene(\"cave\" .. 1)\nend\nreturn S\n",
    );
    let (ok, report, _) = check(&dir);
    assert!(ok, "warnings only: {report}");
    let found: Vec<(u64, String)> = report["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| {
            (
                d["line"].as_u64().unwrap_or(0),
                d["message"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    assert_eq!(found.len(), 3, "{found:?}");
    assert_eq!(found[0].0, 3);
    assert!(
        found[0].1.starts_with("nova.music.stop is given a table and takes a number there (nova.music.stop(0.5): the seconds to fade over), so this line will fail when it runs"),
        "{found:?}"
    );
    assert!(
        found[1].0 == 6
            && found[1]
                .1
                .starts_with("nova.sound.play is given a table and takes a text there"),
        "{found:?}"
    );
    assert!(
        found[2].0 == 7
            && found[2]
                .1
                .starts_with("nova.shadows is given a number and takes a table there"),
        "{found:?}"
    );

    // when the line does run, the error says where it is and which call it was
    write(
        &dir,
        "scenes/title.lua",
        "local S = nova.scene {}\nfunction S:update(dt)\n  local opts = { fade = 1 }\n  nova.music.stop(opts)\nend\nreturn S\n",
    );
    let (ok, report, _) = check(&dir);
    assert!(!ok);
    let d = first(&report);
    assert_eq!(
        (d["file"].as_str(), d["line"].as_u64()),
        (Some("scenes/title.lua"), Some(4)),
        "{d}"
    );
    assert!(
        d["message"]
            .as_str()
            .unwrap()
            .starts_with("bad argument #1 to 'stop': error converting Lua table to f64"),
        "{d}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
