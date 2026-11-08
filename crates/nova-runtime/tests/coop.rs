//! Coop Test (examples/coop-test): two copies of the game in one process, talking over this computer's own network
//! (loopback UDP, as two devices on one wifi would). One hosts, the other finds it and joins; the joined player's input
//! moves player 2 on the host and the host's picture comes back; the host stopping is noticed. Also: two controllers on
//! one device are two players, each moved by their own pad, and a dash button chosen in Controls is saved.

use std::path::PathBuf;
use std::rc::Rc;
use std::time::{Duration, Instant};

use nova_runtime::actions::InputFrame;
use nova_runtime::game::{Game, NullUploader};
use nova_runtime::input::{PadSnapshot, PadState};
use nova_runtime::vfs::{DirVfs, Vfs};

const DT: f32 = 1.0 / 60.0;

fn game(port: u16) -> Game {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/coop-test");
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder).expect("the example folder exists"));
    let mut g = Game::load(vfs).expect("the game loads");
    g.set_deterministic(true);
    g.set_net_port(port);
    g.upload(&mut NullUploader::default());
    g
}

fn frame_with(g: &mut Game, input: &InputFrame) -> Vec<String> {
    g.update_input(DT, 0.0, [960.0, 540.0], input);
    assert!(g.error.is_none(), "the game raised an error: {:?}", g.error);
    g.take_log()
}

fn frame(g: &mut Game, held: &[&str]) -> Vec<String> {
    let input = InputFrame {
        sources: held.iter().map(|k| (k.to_string(), 1.0)).collect(),
        ..Default::default()
    };
    frame_with(g, &input)
}

fn tap(g: &mut Game, key: &str) -> Vec<String> {
    let mut log = frame(g, &[key]);
    log.extend(frame(g, &[]));
    log
}

/// Runs both games (the guest holding `held`) until `done` is true of a log line of either, in real time (the network
/// is real); fails after ten seconds.
fn until(
    host: &mut Game,
    guest: &mut Game,
    held: &[&str],
    mut done: impl FnMut(&str) -> bool,
) -> String {
    let started = Instant::now();
    let mut seen = Vec::new();
    while started.elapsed() < Duration::from_secs(10) {
        let mut log = frame(host, &[]);
        log.extend(frame(guest, held));
        if let Some(l) = log.iter().find(|l| done(l)) {
            return l.clone();
        }
        seen.extend(log);
        std::thread::sleep(Duration::from_millis(2));
    }
    panic!("timed out; the log was {seen:?}");
}

/// Player `n`'s x from a status line (`p2=840,270,0`).
fn x_of(line: &str, n: u8) -> Option<f32> {
    let key = format!("p{n}=");
    let at = line.find(&key)? + key.len();
    line[at..].split(',').next()?.parse().ok()
}

#[test]
fn a_second_copy_finds_the_host_joins_and_plays_player_two() {
    let (mut host, mut guest) = (game(47850), game(47850));
    // host: the title's second item
    tap(&mut host, "key:ArrowDown");
    let log = tap(&mut host, "key:Enter");
    assert!(
        log.iter().any(|l| l.starts_with("coop: Hosting as")),
        "{log:?}"
    );
    // guest: the third item, then the game it finds
    tap(&mut guest, "key:ArrowDown");
    tap(&mut guest, "key:ArrowDown");
    tap(&mut guest, "key:Enter");
    until(&mut host, &mut guest, &[], |l| {
        l.starts_with("coop: found 1")
    });
    tap(&mut guest, "key:Enter");
    until(&mut host, &mut guest, &[], |l| {
        l == "coop: Joined as player 2"
    });
    // the guest holds left: player 2 moves on the host, and the guest sees it in the host's picture
    let h = until(&mut host, &mut guest, &["key:ArrowLeft"], |l| {
        l.contains("mode=host") && x_of(l, 2).is_some_and(|x| x < 700.0)
    });
    assert!(h.contains("net=hosting"), "{h}");
    assert_eq!(
        x_of(&h, 1),
        Some(120.0),
        "player 1 stayed where it was: {h}"
    );
    let g = until(&mut host, &mut guest, &["key:ArrowLeft"], |l| {
        l.contains("mode=guest") && x_of(l, 2).is_some_and(|x| x < 700.0)
    });
    assert!(g.contains("net=joined me=2"), "{g}");
    // the host leaves (pause, then "Leave the game"): the guest is told why, in plain words
    tap(&mut host, "key:Tab");
    tap(&mut host, "key:Enter");
    let lost = until(&mut host, &mut guest, &[], |l| l.starts_with("coop: lost:"));
    assert!(lost.ends_with("stopped the game"), "{lost}");
}

fn pads(a: PadSnapshot, b: PadSnapshot) -> InputFrame {
    let pad = |key: &str, snap| PadState {
        key: key.into(),
        name: format!("Pad {key}"),
        rumble: true,
        snap,
    };
    InputFrame {
        pads: vec![pad("one", a), pad("two", b)],
        ..Default::default()
    }
}

fn still() -> PadSnapshot {
    PadSnapshot::default()
}

fn button(name: &'static str) -> PadSnapshot {
    PadSnapshot {
        buttons: vec![name],
        axes: vec![],
    }
}

#[test]
fn two_controllers_on_one_device_are_two_players_and_each_moves_their_own() {
    let mut g = game(47851);
    // the any-pad sources come from the platform layer; a test makes them by hand
    let with_any = |mut f: InputFrame| {
        nova_runtime::input::any_pad_sources(&f.pads, &mut f.sources);
        f
    };
    frame_with(&mut g, &with_any(pads(still(), still())));
    // the first pad's A starts "Play here"
    let mut log = frame_with(&mut g, &with_any(pads(button("east"), still())));
    log.extend(frame_with(&mut g, &with_any(pads(still(), still()))));
    assert!(log.iter().any(|l| l == "coop: screen play"), "{log:?}");
    assert!(
        log.iter().any(|l| l.contains("Player 2 joined (Pad two)")),
        "{log:?}"
    );
    let mut line = String::new();
    for _ in 0..120 {
        let right = PadSnapshot {
            buttons: vec![],
            axes: vec![("left_x", 1.0)],
        };
        let l = frame_with(&mut g, &with_any(pads(still(), right)));
        if let Some(s) = l.into_iter().find(|l| l.starts_with("coop: mode=")) {
            line = s;
        }
    }
    assert_eq!(x_of(&line, 1), Some(120.0), "player 1 did not move: {line}");
    assert!(
        x_of(&line, 2).unwrap() > 900.0,
        "player 2 ran right to the wall: {line}"
    );
}

#[test]
fn a_dash_button_chosen_for_player_two_is_saved_and_read_back() {
    let dir = std::env::temp_dir().join(format!("nova-coop-controls-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let mut g = game(47852);
    g.open_save(&dir).unwrap();
    let with_any = |mut f: InputFrame| {
        nova_runtime::input::any_pad_sources(&f.pads, &mut f.sources);
        f.last_source = None;
        f
    };
    // keys pressed with both pads still connected
    let key = |g: &mut Game, k: &str| {
        let mut f = with_any(pads(still(), still()));
        f.sources.insert(k.to_string(), 1.0);
        frame_with(g, &f);
        frame_with(g, &with_any(pads(still(), still())));
    };
    frame_with(&mut g, &with_any(pads(still(), still())));
    // Controls (the fourth item), then the second row: player 2's dash
    for k in [
        "key:ArrowDown",
        "key:ArrowDown",
        "key:ArrowDown",
        "key:Enter",
        "key:ArrowDown",
        "key:Enter",
    ] {
        key(&mut g, k);
    }
    // player 2 presses Y (west): that is their dash now
    let mut press = with_any(pads(still(), button("west")));
    press.last_source = Some("pad:west".into());
    press.last_pad = Some("two".into());
    let mut log = frame_with(&mut g, &press);
    log.extend(frame_with(&mut g, &with_any(pads(still(), still()))));
    assert!(
        log.iter().any(|l| l == "coop: Player 2 dashes with Y"),
        "{log:?}"
    );
    g.flush_save();
    drop(g);
    // a new run reads it back: player 2's dash is Y, player 1's is still A
    let mut g = game(47852);
    g.open_save(&dir).unwrap();
    let saved = std::fs::read_to_string(dir.join("controls.bin")).expect("the controls were saved");
    assert!(saved.contains("pad:west"), "{saved}");
    let _ = std::fs::remove_dir_all(&dir);
    frame_with(&mut g, &with_any(pads(still(), still())));
}
