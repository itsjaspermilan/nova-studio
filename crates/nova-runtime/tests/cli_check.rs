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
    for example in ["rally-demo", "crate-dash", "font-gallery"] {
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
