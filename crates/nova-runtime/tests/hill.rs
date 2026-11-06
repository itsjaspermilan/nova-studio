//! Probe 5, Hill Run (examples/hill-run, see docs/probes.md): a third-person character on a field made of triangles
//! (`nova.solid`): rolling hills, a staircase of 0.3 m steps, a cliff it cannot climb, and a path up. The game ships with a bot
//! (F9) that walks the route to the flag.

use std::cell::Cell;
use std::path::PathBuf;
use std::rc::Rc;

use nova_runtime::actions::InputFrame;
use nova_runtime::game::{Game, Uploader};
use nova_runtime::model::{Image, MeshData};
use nova_runtime::vfs::{DirVfs, Vfs};

#[derive(Default)]
struct CountingGpu(Cell<usize>);
impl Uploader for CountingGpu {
    fn set_atlas(&mut self, _: &Image) {}
    fn add_mesh(&mut self, _: &MeshData) -> usize {
        let n = self.0.get();
        self.0.set(n + 1);
        n
    }
}

const DT: f32 = 1.0 / 60.0;

fn frame(g: &mut Game, held: &[&str]) {
    let input = InputFrame {
        sources: held.iter().map(|k| (k.to_string(), 1.0)).collect(),
        ..Default::default()
    };
    g.update_input(DT, 0.0, [960.0, 540.0], &input);
    assert!(g.error.is_none(), "the game raised an error: {:?}", g.error);
}

fn tap(g: &mut Game, key: &str) {
    frame(g, &[key]);
    frame(g, &[]);
}

fn game() -> Game {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/hill-run");
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder).expect("the example folder exists"));
    let mut g = Game::load(vfs).expect("the game loads");
    g.set_deterministic(true);
    g.upload(&mut CountingGpu::default());
    g
}

/// The numbers of the newest `hill:` status line (F3 writes one).
fn status(g: &mut Game) -> std::collections::HashMap<String, String> {
    tap(g, "key:F3");
    let line = g
        .take_log()
        .into_iter()
        .rev()
        .find(|l| l.starts_with("hill: x="))
        .expect("a status line");
    line["hill:".len()..]
        .split_whitespace()
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn number(s: &std::collections::HashMap<String, String>, key: &str) -> f32 {
    s[key]
        .trim_end_matches(',')
        .parse()
        .unwrap_or_else(|_| panic!("{key} = {}", s[key]))
}

#[test]
fn the_character_stands_on_the_hills_and_a_bot_climbs_the_stairs_and_the_path_to_the_flag() {
    let mut g = game();
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    let at_rest = status(&mut g);
    let (x, y) = (number(&at_rest, "x"), number(&at_rest, "y"));
    assert!(
        x.abs() < 0.1 && y > -0.5 && y < 3.0,
        "it settled on the meadow where it started: {at_rest:?}"
    );
    tap(&mut g, "key:F9"); // the bot
    let mut log = Vec::new();
    let mut won = false;
    for _ in 0..60 * 150 {
        frame(&mut g, &[]);
        log.extend(g.take_log());
        if log.iter().any(|l| l.starts_with("hill: flag reached")) {
            won = true;
            break;
        }
    }
    let s = status(&mut g);
    assert!(
        won,
        "the bot reached the flag within 150 s of game time: {s:?} {log:?}"
    );
    assert!(number(&s, "max_height") > 25.0, "up the hill: {s:?}");
    assert!(
        number(&s, "hops") >= 15.0,
        "it hopped up the staircase: {s:?}"
    );
    assert_eq!(
        number(&s, "falls"),
        0.0,
        "and never fell off the world: {s:?}"
    );
}

#[test]
fn walking_at_the_cliff_starts_a_climb_by_itself_and_ends_on_top() {
    let s = run_script("key:F8", 40);
    assert!(number(&s, "max_height") > 19.0, "over the cliff: {s:?}");
    assert!(
        number(&s, "climb") > 1.0,
        "it climbed, without a button: {s:?}"
    );
    assert!(
        number(&s, "mantles") >= 1.0 && number(&s, "falls") == 0.0,
        "{s:?}"
    );
}

#[test]
fn a_player_with_no_strength_left_cannot_climb_the_cliff_and_is_pushed_back_and_slides() {
    let mut g = game();
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:F4"); // the hill below the cliff, bot walking at the peak, with no strength to climb
    let start = status(&mut g);
    let base = number(&start, "y");
    for _ in 0..60 * 40 {
        frame(&mut g, &[]);
    }
    let s = status(&mut g);
    assert_eq!(number(&s, "falls"), 0.0, "{s:?}");
    assert!(
        number(&s, "max_height") > base + 3.0,
        "it climbed the 37 degree hill up to the cliff: {s:?} (from {base})"
    );
    // the hill reaches about 15.6 m at the foot of the cliff and the cliff is 7 m more
    assert!(
        number(&s, "max_height") < 19.0,
        "and no further: it did not walk up a 74 degree cliff: {s:?}"
    );
    assert!(
        number(&s, "slide") > 20.0,
        "it was pushed back by the cliff, sliding: {s:?}"
    );
}

/// A numbers table from the newest status line, after pressing `key` (a teleport) and letting the bot run for `seconds`.
fn run_script(key: &str, seconds: u32) -> std::collections::HashMap<String, String> {
    let mut g = game();
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    tap(&mut g, key);
    for _ in 0..60 * seconds {
        frame(&mut g, &[]);
    }
    status(&mut g)
}

#[test]
fn the_bot_climbs_the_tower_by_walking_at_it_and_steps_over_the_top() {
    let s = run_script("key:F7", 10);
    assert!(number(&s, "max_height") > 12.0, "the tower is 12 m: {s:?}");
    assert!(
        number(&s, "climb") > 3.0 && number(&s, "climb") < 5.9,
        "about 12 m at 2.6 m/s: {s:?}"
    );
    assert!(
        number(&s, "mantles") >= 1.0,
        "it stepped over the top: {s:?}"
    );
    assert!(
        number(&s, "stamina") > 0.0 && number(&s, "falls") == 0.0,
        "{s:?}"
    );
}

#[test]
fn the_bot_climbs_the_74_degree_cliff_that_walking_cannot() {
    let s = run_script("key:F5", 40);
    assert!(
        number(&s, "max_height") > 19.0,
        "past the cliff, which walking could not climb (the walking test stops below 19): {s:?}"
    );
    assert!(number(&s, "mantles") >= 1.0, "{s:?}");
    assert!(number(&s, "falls") == 0.0, "{s:?}");
}

#[test]
fn gliding_from_high_up_covers_far_more_ground_than_falling() {
    let s = run_script("key:F6", 10); // (it lands at about 8.5 s; the bot would then walk off the edge of the field)
    // from 24 m, falling takes 2.2 s; the glider falls at 2.4 m/s and flies at 9 m/s, so it covers some 80 m of the 24 m of height
    assert!(number(&s, "glide_dist") > 50.0, "{s:?}");
    assert!(
        number(&s, "glide_time") > 6.0 && number(&s, "glide_time") < 9.0,
        "{s:?}"
    );
    assert!(
        number(&s, "falls") == 0.0 && s["mode"] == "walk",
        "landed and walking again: {s:?}"
    );
}

#[test]
fn getting_up_over_the_top_rises_only_to_the_ledge_and_stands_on_it() {
    let s = run_script("key:F7", 10);
    let (top, y) = (12.51, number(&s, "y"));
    assert!(
        number(&s, "max_height") < top + 0.6,
        "it did not go way up over the edge and fall back: {s:?}"
    );
    assert!((y - top).abs() < 0.3, "standing on the tower: {s:?}");
    assert_eq!(s["mode"], "walk", "{s:?}");
}

#[test]
fn gliding_into_a_wall_grabs_it_and_climbs() {
    let s = run_script("key:F2", 9);
    assert!(number(&s, "glide_time") > 1.0, "it glided first: {s:?}");
    assert!(
        number(&s, "climb") > 0.5,
        "and then climbed the tower it ran into: {s:?}"
    );
    assert!(
        number(&s, "mantles") >= 1.0 && number(&s, "falls") == 0.0,
        "all the way to the top: {s:?}"
    );
}

#[test]
fn hanging_still_on_a_wall_costs_no_stamina() {
    let s = run_script("key:F1", 6);
    assert_eq!(s["mode"], "climb", "still on the wall: {s:?}");
    // a second of climbing costs a second of the 6; the next 4 seconds of hanging cost nothing
    assert!(number(&s, "stamina") > 4.4, "{s:?}");
    assert!(number(&s, "stamina") < 5.6, "{s:?}");
}

#[test]
fn the_getting_up_starts_with_the_hands_on_the_edge() {
    // the hands reach about 2.2 m above the feet with the arms up: the getting up begins when the ledge is that high
    let mut g = game();
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:F7");
    let mut log = Vec::new();
    for _ in 0..60 * 10 {
        frame(&mut g, &[]);
        log.extend(g.take_log());
    }
    let line = log
        .iter()
        .find(|l| l.starts_with("hill: mantle from"))
        .expect("it got up over the top");
    let nums: Vec<f32> = line
        .split_whitespace()
        .filter_map(|w| w.parse().ok())
        .collect();
    let (from, to) = (nums[0], nums[1]);
    assert!(
        to - from > 1.7 && to - from < 2.3,
        "the feet are about 2 m below the edge when the hands are on it: {line}"
    );
}

#[test]
fn landing_from_the_glider_does_not_jump() {
    // the bot opens the glider with a jump press and never jumps otherwise: when it lands, that press must not be waiting as a jump
    let s = run_script("key:F6", 11);
    assert!(
        number(&s, "glide_time") > 3.0 && s["mode"] == "walk",
        "it glided and landed: {s:?}"
    );
    assert_eq!(number(&s, "jumps"), 0.0, "no jump on landing: {s:?}");
}
