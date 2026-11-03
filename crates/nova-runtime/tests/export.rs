//! `nova export`: the real binary exporting a game for a computer, the checks before it, and the helper that finds the APK script.

use std::path::{Path, PathBuf};
use std::process::Command;

use nova_runtime::export;
use nova_runtime::pak::PakVfs;
use nova_runtime::project::Project;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nova-export-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(dir: &Path, rel: &str, text: &str) {
    let path = dir.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn small_game(dir: &Path, name: &str) {
    write(
        dir,
        "nova.json",
        &format!(r#"{{"format":1,"name":"{name}"}}"#),
    );
    write(
        dir,
        "main.lua",
        "function draw() nova.rect(10, 10, 20, 20) end\n",
    );
}

#[test]
fn a_desktop_export_is_a_folder_that_plays_the_game() {
    let game = scratch("game");
    small_game(&game, "My Little Game!");
    let out = scratch("out");
    let result = Command::new(env!("CARGO_BIN_EXE_nova"))
        .args(["export", "desktop"])
        .arg(&game)
        .arg("--out")
        .arg(&out)
        .output()
        .expect("runs nova");
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let dir = out.join("my_little_game");
    for file in [
        "my_little_game",
        "game.npk",
        "play.sh",
        "play.bat",
        "README.txt",
        "THIRD-PARTY.txt",
    ] {
        assert!(dir.join(file).is_file(), "{file} is missing");
    }
    // the licences really are there
    let notices = std::fs::read_to_string(dir.join("THIRD-PARTY.txt")).unwrap();
    assert!(notices.contains("wgpu") && notices.contains("Permission is hereby granted"));
    // the packed game opens, and the exported program plays it
    let bytes = std::fs::read(dir.join("game.npk")).unwrap();
    let project = Project::open(&PakVfs::new(bytes.into()).unwrap()).unwrap();
    assert_eq!(project.manifest.name, "My Little Game!");
    let run = Command::new(dir.join("my_little_game"))
        .args(["run", "--pak", "game.npk", "--headless", "--frames", "5"])
        .current_dir(&dir)
        .output()
        .expect("runs the exported program");
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert!(
            std::fs::metadata(dir.join("play.sh"))
                .unwrap()
                .permissions()
                .mode()
                & 0o111
                != 0
        );
        let script = std::fs::read_to_string(dir.join("play.sh")).unwrap();
        assert!(script.contains("./my_little_game run --pak game.npk"));
    }
}

#[test]
fn a_game_with_errors_is_not_exported() {
    let game = scratch("broken");
    small_game(&game, "Broken");
    write(&game, "main.lua", "this is not lua (\n");
    let out = scratch("broken-out");
    let result = Command::new(env!("CARGO_BIN_EXE_nova"))
        .args(["export", "desktop"])
        .arg(&game)
        .arg("--out")
        .arg(&out)
        .output()
        .expect("runs nova");
    assert!(!result.status.success());
    let said = String::from_utf8_lossy(&result.stdout).to_string()
        + &String::from_utf8_lossy(&result.stderr);
    assert!(
        said.contains("main.lua") && said.contains("not exported"),
        "{said}"
    );
    assert!(!out.join("broken").exists());
}

#[test]
fn export_checks_its_arguments() {
    for args in [
        vec!["export"],
        vec!["export", "ios", "x"],
        vec!["export", "desktop"],
        vec!["export", "desktop", "x", "--nope"],
    ] {
        let result = Command::new(env!("CARGO_BIN_EXE_nova"))
            .args(&args)
            .output()
            .unwrap();
        assert_eq!(result.status.code(), Some(2), "{args:?}");
    }
}

#[test]
fn ids_are_safe_file_and_package_names() {
    assert_eq!(export::game_id("My Little Game!"), "my_little_game");
    assert_eq!(export::game_id("2 Fast"), "g2_fast");
    assert_eq!(export::game_id("!!!"), "game");
    assert_eq!(export::game_id("Crate Dash"), "crate_dash");
}

#[test]
fn the_apk_script_is_found_above_where_you_are() {
    let root = scratch("repo");
    write(&root, "scripts/build-apk.sh", "#!/bin/bash\n");
    let deep = root.join("a/b/c");
    std::fs::create_dir_all(&deep).unwrap();
    assert_eq!(
        export::find_apk_script(&[deep]),
        Some(root.join("scripts/build-apk.sh"))
    );
    let elsewhere = scratch("nowhere");
    assert_eq!(export::find_apk_script(&[elsewhere]), None);
}
