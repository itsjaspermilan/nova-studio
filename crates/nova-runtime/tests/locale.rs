//! Languages: `nova.t`, `nova.locale` and the `locales/<code>.json` files.

use std::rc::Rc;

use nova_runtime::game::{Game, NullUploader};
use nova_runtime::vfs::{MemVfs, Vfs};

fn run(files: &[(&str, &str)], main: &str) -> Vec<String> {
    let mut all: Vec<(&str, Vec<u8>)> = vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("main.lua", main.as_bytes().to_vec()),
    ];
    for (p, c) in files {
        all.push((p, c.as_bytes().to_vec()));
    }
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(all));
    let mut game = Game::load(vfs).expect("loads");
    game.upload(&mut NullUploader::default());
    assert!(game.error.is_none(), "{:?}", game.error);
    game.take_log()
}

const EN: &str = r#"{"menu.start":"Start","coins":"{count} coins","coins.one":"one coin","hello":"Hello, {name}!","only_en":"English only"}"#;
const FR: &str = r#"{"menu.start":"Jouer","coins.one":"une pièce","coins.other":"{count} pièces","hello":"Bonjour, {name} !"}"#;

#[test]
fn text_comes_from_the_chosen_language_then_the_default_then_the_key() {
    let log = run(
        &[("locales/en.json", EN), ("locales/fr.json", FR)],
        r#"
nova.log(nova.t("menu.start"))
nova.log(nova.locale.get())
nova.locale.set("fr")
nova.log(nova.t("menu.start"))
nova.log(nova.t("only_en"))
nova.log(nova.t("never_written"))
nova.log(table.concat(nova.locale.available(), ","))
"#,
    );
    assert_eq!(
        log,
        [
            "Start",
            "en",
            "Jouer",
            "English only",
            "never_written",
            "en,fr"
        ]
    );
}

#[test]
fn placeholders_and_plural_forms() {
    let log = run(
        &[("locales/en.json", EN), ("locales/fr.json", FR)],
        r#"
nova.log(nova.t("hello", { name = "Ana" }))
nova.log(nova.t("coins", { count = 1 }))
nova.log(nova.t("coins", { count = 3 }))
nova.locale.set("fr")
nova.log(nova.t("coins", { count = 1 }))
nova.log(nova.t("coins", { count = 3 }))
nova.log(nova.t("hello", { name = "Ana" }))
"#,
    );
    assert_eq!(
        log,
        [
            "Hello, Ana!",
            "one coin",
            "3 coins",
            "une pièce",
            "3 pièces",
            "Bonjour, Ana !"
        ]
    );
}

#[test]
fn a_missing_language_and_a_project_without_any_are_handled() {
    let log = run(
        &[("locales/en.json", EN)],
        r#"
local ok, err = pcall(nova.locale.set, "de")
nova.log(tostring(ok))
nova.log((tostring(err):gsub("^.-:%d+: ", "")))
nova.log(nova.t("menu.start"))
"#,
    );
    assert_eq!(log[0], "false");
    assert!(log[1].contains("locales/de.json"), "{}", log[1]);
    assert_eq!(log[2], "Start");
    let bare = run(
        &[],
        "nova.log(nova.t(\"x\")) nova.log(tostring(nova.locale.get())) nova.log(#nova.locale.available())",
    );
    assert_eq!(bare, ["x", "nil", "0"]);
}

#[test]
fn a_file_with_a_value_that_is_not_text_is_refused_by_name() {
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        (
            "main.lua",
            br#"local ok, err = pcall(nova.locale.set, "en") nova.log(tostring(err))"#.to_vec(),
        ),
        ("locales/en.json", br#"{"a":3}"#.to_vec()),
    ]));
    let mut game = Game::load(vfs).expect("loads");
    game.upload(&mut NullUploader::default());
    let log = game.take_log();
    assert!(log[0].contains("\"a\" must be text"), "{log:?}");
}

// ---- random sound groups ----

fn wav() -> Vec<u8> {
    // a tiny silent mono 8-bit 8 kHz file: 44-byte header and 8 samples
    let mut v = Vec::new();
    v.extend_from_slice(b"RIFF");
    v.extend_from_slice(&(36u32 + 8).to_le_bytes());
    v.extend_from_slice(b"WAVEfmt ");
    v.extend_from_slice(&16u32.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes());
    v.extend_from_slice(&8000u32.to_le_bytes());
    v.extend_from_slice(&8000u32.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes());
    v.extend_from_slice(&8u16.to_le_bytes());
    v.extend_from_slice(b"data");
    v.extend_from_slice(&8u32.to_le_bytes());
    v.extend_from_slice(&[128u8; 8]);
    v
}

fn run_with(files: Vec<(&str, Vec<u8>)>, main: &str) -> (Vec<String>, Option<String>) {
    let mut all: Vec<(&str, Vec<u8>)> = vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("main.lua", main.as_bytes().to_vec()),
    ];
    all.extend(files);
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(all));
    let mut game = Game::load(vfs).expect("loads");
    game.upload(&mut NullUploader::default());
    let error = game.error.clone().map(|e| format!("{e:?}"));
    (game.take_log(), error)
}

#[test]
fn a_group_is_played_like_a_sound_and_a_plain_sound_still_is() {
    let (log, error) = run_with(
        vec![
            ("sounds/a.wav", wav()),
            ("sounds/b.wav", wav()),
            (
                "sounds/steps.group.json",
                br#"{"sounds":["a","b"],"volume":[0.5,1],"pitch":[0.9,1.1],"no_repeat":true}"#
                    .to_vec(),
            ),
        ],
        r#"
math.randomseed(7)
local g = nova.sound.group("steps")
nova.log(#g.sounds .. " " .. tostring(g.no_repeat))
nova.log(tostring(nova.sound.group("a")))
for i = 1, 20 do nova.sound.play("steps") end
nova.sound.play("a")
nova.log("played")
"#,
    );
    assert!(error.is_none(), "{error:?}");
    assert_eq!(log, ["2 true", "nil", "played"]);
}

#[test]
fn a_group_that_is_wrong_is_refused_by_name() {
    let (log, _) = run_with(
        vec![(
            "sounds/bad.group.json",
            br#"{"sounds":[],"volume":[1]}"#.to_vec(),
        )],
        r#"local ok, err = pcall(nova.sound.group, "bad") nova.log(tostring(ok)) nova.log(tostring(err))"#,
    );
    assert_eq!(log[0], "false");
    assert!(log[1].contains("bad.group.json"), "{log:?}");
    let (log, _) = run_with(
        vec![(
            "sounds/bad.group.json",
            br#"{"sounds":["a"],"volume":[1]}"#.to_vec(),
        )],
        r#"local ok, err = pcall(nova.sound.group, "bad") nova.log(tostring(err))"#,
    );
    assert!(
        log[0].contains("\"volume\" is [lowest, highest]"),
        "{log:?}"
    );
}

#[test]
fn vary_changes_each_play_without_touching_the_games_random_numbers() {
    // the same seed gives the same math.random numbers whether or not sounds are played with `vary`
    let main = |vary: bool| {
        format!(
            r#"
math.randomseed(11)
for i = 1, 5 do nova.sound.play("a", {{ volume = 0.8{} }}) end
nova.sound.play("steps"{})
nova.log(tostring(math.random(1000000)))
local ok, err = pcall(nova.sound.play, "a", {{ vary = 2 }})
nova.log(tostring(ok) .. " " .. tostring(err))
"#,
            if vary { ", vary = 0.1" } else { "" },
            if vary { ", { vary = 0.05 }" } else { "" }
        )
    };
    let files = || {
        vec![
            ("sounds/a.wav", wav()),
            (
                "sounds/steps.group.json",
                br#"{"sounds":["a"],"pitch":[0.9,1.1]}"#.to_vec(),
            ),
        ]
    };
    let (plain, e1) = run_with(files(), &main(false));
    let (varied, e2) = run_with(files(), &main(true));
    assert!(e1.is_none() && e2.is_none(), "{e1:?} {e2:?}");
    assert_eq!(plain[0], varied[0], "math.random went on as without vary");
    assert!(
        varied[1].starts_with("false") && varied[1].contains("vary is a number from 0 to 0.5"),
        "{varied:?}"
    );
}
