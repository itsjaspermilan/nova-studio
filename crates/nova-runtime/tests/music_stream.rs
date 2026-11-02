//! Ogg music in `music/` is streamed, not decoded at load. There is no Ogg encoder here and no third-party audio is
//! checked in, so these tests need a real file: run with `NOVA_TEST_OGG=/path/to/some.ogg cargo test --test music_stream`.

use std::cell::Cell;
use std::rc::Rc;

use nova_runtime::game::{Game, Uploader};
use nova_runtime::input::Actions;
use nova_runtime::mixer::Command;
use nova_runtime::model::{Image, MeshData};
use nova_runtime::vfs::{MemVfs, Vfs};

struct Gpu(Cell<usize>);
impl Uploader for Gpu {
    fn set_atlas(&mut self, _: &Image) {}
    fn add_mesh(&mut self, _: &MeshData) -> usize {
        self.0.set(self.0.get() + 1);
        0
    }
}

fn game(ogg: Vec<u8>, script: &str) -> Game {
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("music/theme.ogg", ogg),
        ("main.lua", script.as_bytes().to_vec()),
    ]));
    let mut g = Game::load(vfs).expect("project loads");
    g.upload(&mut Gpu(Cell::new(0)));
    g.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
    g
}

fn real_ogg() -> Option<Vec<u8>> {
    std::fs::read(std::env::var("NOVA_TEST_OGG").ok()?).ok()
}

#[test]
fn ogg_music_plays_as_a_stream_and_is_not_a_sound_effect() {
    let Some(ogg) = real_ogg() else { return };
    let g = game(ogg.clone(), "nova.music.play('theme', { fade = 1 })");
    assert!(g.error.is_none(), "{:?}", g.error);
    let commands = g.take_audio();
    match &commands[0] {
        Command::Play(p) => {
            assert!(p.music && p.looping && p.fade_in == 1.0);
            assert!(p.stream.is_some(), "streamed, not decoded");
            assert!(
                p.sample.frames.is_empty(),
                "nothing was decoded into memory"
            );
        }
        _ => panic!("expected a Play command"),
    }
    // The same file as a sound effect is refused with a pointer to the right call.
    let g = game(ogg, "nova.sound.play('theme')");
    let e = g.error.clone().unwrap_or_default();
    assert!(
        e.contains("is streamed music") && e.contains("nova.music.play"),
        "{e}"
    );
}

#[test]
fn a_streamed_track_reaches_the_mixer_and_makes_sound() {
    let Some(ogg) = real_ogg() else { return };
    let g = game(ogg, "nova.music.play('theme')");
    let mut mixer = nova_runtime::mixer::Mixer::new(44100);
    for c in g.take_audio() {
        mixer.apply(c);
    }
    let start = std::time::Instant::now();
    let mut peak = 0.0f32;
    while start.elapsed() < std::time::Duration::from_secs(3) && peak < 0.001 {
        let mut out = vec![0.0; 512];
        mixer.render(&mut out);
        peak = out.iter().fold(peak, |a, s| a.max(s.abs()));
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    assert!(peak > 0.001, "the stream became audible, peak {peak}");
}
