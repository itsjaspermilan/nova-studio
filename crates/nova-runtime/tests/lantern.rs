//! Lantern Keep (examples/lantern-keep), a top-down dungeon game, played from its title screen by its own autopilot (F9):
//! the hero walks to the key, opens the door, swings at what comes close, and goes through three rooms. What it checks is
//! what a player would see: no script errors, the rooms follow each other, and the game ends on the win or lose screen.

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
    for _ in 0..4 {
        frame(g, &[]);
    }
}

/// Plays one game from the title with the autopilot and returns what the game logged.
fn play() -> Vec<String> {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/lantern-keep");
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder).expect("the example folder exists"));
    let mut g = Game::load(vfs).expect("the game loads");
    g.upload(&mut CountingGpu::default());
    for _ in 0..30 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:Space"); // press start
    tap(&mut g, "key:F9"); // let the computer play
    let mut log = Vec::new();
    for _ in 0..(60 * 60 * 4) {
        frame(&mut g, &[]);
        log.extend(g.take_log());
        if log
            .iter()
            .any(|l| l.starts_with("win:") || l.starts_with("over:"))
        {
            break;
        }
    }
    log
}

#[test]
fn the_autopilot_plays_through_the_keep() {
    let log = play();
    assert!(
        log.iter().any(|l| l.starts_with("room 1:")),
        "the first room starts: {log:?}"
    );
    assert!(
        log.iter().any(|l| l.starts_with("room 1: door open")),
        "it finds the key and opens the first door: {log:?}"
    );
    assert!(
        log.iter()
            .any(|l| l.starts_with("win:") || l.starts_with("over:")),
        "the game reaches its end: {log:?}"
    );
}

#[test]
fn the_keep_can_be_won() {
    let log = play();
    assert!(
        log.iter().any(|l| l.starts_with("win:")),
        "the autopilot escapes all three rooms: {log:?}"
    );
    for room in 1..=3 {
        assert!(
            log.iter()
                .any(|l| l.starts_with(&format!("room {room}: door open"))),
            "room {room}'s door opens: {log:?}"
        );
    }
}
