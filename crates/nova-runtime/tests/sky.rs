//! Probe 4, Sky Garden (examples/sky-garden, see docs/probes.md): a 3D platformer. The game ships with a bot (F9) that plays
//! it: stairs, a ramp, two moving platforms that carry it, jumps across gaps, and patrollers to stomp or dodge.

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
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/sky-garden");
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder).expect("the example folder exists"));
    let mut g = Game::load(vfs).expect("the game loads");
    g.set_deterministic(true);
    g.upload(&mut CountingGpu::default());
    g
}

/// The numbers of the newest `sky:` log line (F3 writes one).
fn status(g: &mut Game) -> std::collections::HashMap<String, String> {
    tap(g, "key:F3");
    let line = g
        .take_log()
        .into_iter()
        .rev()
        .find(|l| l.starts_with("sky:"))
        .expect("a status line");
    line["sky:".len()..]
        .split_whitespace()
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn num(s: &std::collections::HashMap<String, String>, k: &str) -> f32 {
    s[k].parse().unwrap()
}

#[test]
fn the_garden_loads_and_the_player_stands_on_the_island() {
    let mut g = game();
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    let s = status(&mut g);
    assert!(num(&s, "y").abs() < 0.05, "standing on the island: {s:?}");
    assert_eq!(s["walkers"], "4");
    assert_eq!(s["falls"], "0");
}

#[test]
fn walking_off_the_edge_falls_and_comes_back_to_the_start() {
    let mut g = game();
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    // the camera faces east at the start, so S walks west to the island's edge
    for _ in 0..140 {
        frame(&mut g, &["key:KeyS"]);
    }
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    let s = status(&mut g);
    assert_eq!(s["falls"], "1", "{s:?}");
    assert!(num(&s, "x").abs() < 3.0, "back at the start: {s:?}");
}

#[test]
fn a_bot_plays_the_garden_to_the_flag() {
    let mut g = game();
    tap(&mut g, "key:F9");
    let mut last = None;
    let mut trail = vec![];
    for second in 0..180 {
        for _ in 0..60 {
            frame(&mut g, &[]);
        }
        if second % 5 == 4 {
            let s = status(&mut g);
            trail.push(format!("{s:?}"));
            if s["won"] == "true" {
                last = Some(s);
                break;
            }
        }
    }
    let s = last.unwrap_or_else(|| {
        panic!(
            "the bot did not reach the flag in three minutes:\n{}",
            trail.join("\n")
        )
    });
    assert!(num(&s, "gems") >= 10.0, "{s:?}");
    assert!(
        num(&s, "ride") > 60.0,
        "it rode the moving platforms: {s:?}"
    );
}

#[test]
fn the_camera_is_pulled_in_by_a_pillar_and_by_nothing_in_the_open() {
    let mut g = game();
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    assert_eq!(
        num(&status(&mut g), "cam_pulls"),
        0.0,
        "open sky behind the player"
    );
    // turn the camera to the east side (right stick), step sideways so that the pillar is between the player and the camera
    for _ in 0..68 {
        frame(&mut g, &["axis:right_x"]);
    }
    for _ in 0..30 {
        frame(&mut g, &["key:KeyD"]);
    }
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    assert!(
        num(&status(&mut g), "cam_pulls") > 5.0,
        "the pillar is in the way of the camera"
    );
}
