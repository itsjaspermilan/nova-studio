//! The decoded files the test harness shares between loads (`nova_runtime::load_cache`, turned on by `testing::load_dir`):
//! games made from the shared files play exactly as games loaded from scratch, cannot change each other, and a file changed
//! on disk is decoded again. The tests here switch the sharing on and off for the whole process, so they take turns.

use std::sync::Mutex;

use nova_runtime::game::{Game, NullUploader};
use nova_runtime::load_cache;
use nova_runtime::testing;
use nova_runtime::vfs::{DirVfs, Vfs};

static TURN: Mutex<()> = Mutex::new(());

const GAME: &str = "examples/mountain-post";

/// The plan both games play: into the valley, walk about, look at the postmaster, the camera and what is drawn.
const PLAN: &str = r#"{ "start_scene": "valley", "steps": [ { "hold": ["move_y=-1"], "frames": 90 }, { "hold": ["move_x=1"], "frames": 40 } ],
    "record": "string.format('%.4f %.4f', nova.named('postmaster').x, nova.named('postmaster').z)",
    "print": ["nova.current_scene()", "string.format('%.4f %.4f', nova.named('van').x, nova.named('van').z)"] }"#;

/// The game as `Game::load` gives it with sharing on or off (the same steps as `testing::load_dir`, music decoding left on).
fn load(shared: bool) -> Game {
    load_cache::share(shared);
    let folder = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(GAME);
    let vfs: std::rc::Rc<dyn Vfs> = std::rc::Rc::new(DirVfs::new(&folder).unwrap());
    let mut g = Game::load(vfs).expect("the game loads");
    g.upload(&mut NullUploader::default());
    g
}

/// What a played plan says, without anything that depends on the wall clock (the game's ground cover is planted a few
/// milliseconds a frame, so the frame it says it is done on depends on how busy the machine is: the log's lines are compared,
/// not their frames).
fn played(
    g: &mut Game,
) -> (
    serde_json::Value,
    serde_json::Value,
    Vec<String>,
    serde_json::Value,
) {
    let r = testing::play(g, PLAN).expect("the plan plays");
    assert!(r.errors().is_empty(), "{:?}", r.errors());
    let walked = r.json["records"][0]["runs"].as_array().map_or(0, Vec::len);
    assert!(walked > 20, "the postmaster walks about ({walked} places)");
    (
        r.json["records"].clone(),
        r.json["end"]["prints"].clone(),
        r.log().into_iter().map(|(_, line)| line).collect(),
        r.drawn.clone(),
    )
}

#[test]
fn a_game_from_shared_files_plays_as_one_loaded_from_scratch() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let mut fresh = load(false);
    let warnings = fresh.warnings.clone();
    let expected = played(&mut fresh);
    drop(fresh);

    let mut first = load(true);
    let (made, _) = load_cache::counts();
    let mut second = load(true);
    let (made_after, reused) = load_cache::counts();
    assert_eq!(made, made_after, "the second load decoded nothing new");
    assert!(
        reused > 20,
        "the second load reused the pictures, models and sounds ({reused} reuses)"
    );
    // the same warnings (a model's missing picture is said again even when the model was not read again)
    assert_eq!(first.warnings, warnings);
    assert_eq!(second.warnings, warnings);
    // each plays exactly as the game loaded from scratch, one after the other
    assert_eq!(
        played(&mut first),
        expected,
        "the first shared game plays as a fresh one"
    );
    assert_eq!(
        played(&mut second),
        expected,
        "the second shared game plays as a fresh one"
    );
    load_cache::share(false);
}

#[test]
fn two_games_from_shared_files_do_not_affect_each_other() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let mut fresh = load(false);
    let expected = played(&mut fresh);
    drop(fresh);

    let mut a = load(true);
    let mut b = load(true);
    // one game changes all it can: its state, its scene, its models' poses and colours, its save, its music
    testing::play(
        &mut a,
        r#"{ "start_scene": "office", "lua": "ZZ_MARK = 42; require('lib.state').carrying = 'pip'", "steps": [ { "hold": ["move_x=-1"], "frames": 120 } ] }"#,
    )
    .expect("a plays");
    assert_eq!(a.lua_text("ZZ_MARK").unwrap(), "42");
    // the other neither sees it nor plays any differently
    assert_eq!(b.lua_text("rawget(_G, 'ZZ_MARK')").unwrap(), "nil");
    assert_eq!(b.lua_text("require('lib.state').carrying").unwrap(), "nil");
    assert_eq!(played(&mut b), expected);
    // and the first, played on afterwards, is still a game of its own
    assert_eq!(a.lua_text("ZZ_MARK").unwrap(), "42");
    drop(a);
    // a game made after both were dropped plays the same too (nothing they did stayed in what is shared)
    let mut c = load(true);
    assert_eq!(played(&mut c), expected);
    load_cache::share(false);
}

#[test]
fn the_two_games_may_load_on_two_threads_at_once() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    load_cache::share(false); // (empty: both threads ask for every file at the same moment)
    let mut fresh = load(false);
    let expected = played(&mut fresh);
    drop(fresh);
    let runs: Vec<_> = (0..4)
        .map(|_| {
            std::thread::spawn(|| {
                let mut g = load(true);
                played(&mut g)
            })
        })
        .collect();
    for run in runs {
        assert_eq!(run.join().expect("the thread plays"), expected);
    }
    load_cache::share(false);
}

fn png(w: u32, h: u32) -> Vec<u8> {
    let mut out = Vec::new();
    let mut e = png::Encoder::new(&mut out, w, h);
    e.set_color(png::ColorType::Rgba);
    e.set_depth(png::BitDepth::Eight);
    e.write_header()
        .unwrap()
        .write_image_data(&vec![255u8; (w * h * 4) as usize])
        .unwrap();
    out
}

#[test]
fn a_file_changed_on_disk_is_decoded_again() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let dir = std::env::temp_dir().join(format!("nova-load-cache-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("sprites")).unwrap();
    std::fs::write(dir.join("nova.json"), r#"{ "format": 1, "name": "T" }"#).unwrap();
    std::fs::write(dir.join("main.lua"), "W, H = nova.image_size('box')\n").unwrap();
    std::fs::write(dir.join("sprites/box.png"), png(4, 4)).unwrap();
    let size = |g: &Game| g.lua_text("W .. 'x' .. H").unwrap();
    let a = testing::load_dir(&dir).unwrap();
    assert_eq!(size(&a), "4x4");
    let b = testing::load_dir(&dir).unwrap();
    assert_eq!(size(&b), "4x4");
    // a new picture of the same name: the next load sees it, and the games already loaded keep theirs
    std::fs::write(dir.join("sprites/box.png"), png(6, 2)).unwrap();
    let c = testing::load_dir(&dir).unwrap();
    assert_eq!(size(&c), "6x2");
    assert_eq!(size(&a), "4x4");
    let _ = std::fs::remove_dir_all(&dir);
    load_cache::share(false);
}
