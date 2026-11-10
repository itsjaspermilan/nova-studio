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
        ["Start", "en", "Jouer", "English only", "never_written", "en,fr"]
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
        ["Hello, Ana!", "one coin", "3 coins", "une pièce", "3 pièces", "Bonjour, Ana !"]
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
    let bare = run(&[], "nova.log(nova.t(\"x\")) nova.log(tostring(nova.locale.get())) nova.log(#nova.locale.available())");
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
