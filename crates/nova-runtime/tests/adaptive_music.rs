//! Adaptive music: `nova.music.layers` starts stems of one piece in step, `nova.music.layer` fades one (now or at the next bar line).
//! The mixing itself is tested in `mixer.rs`; these tests check what the scripts ask of it, and the errors a person would meet.

use std::rc::Rc;

use nova_runtime::game::{Game, NullUploader};
use nova_runtime::mixer::Command;
use nova_runtime::vfs::{MemVfs, Vfs};

/// A mono 8-bit 8 kHz WAV of `n` samples of one value.
fn wav(n: usize, value: u8) -> Vec<u8> {
    let mut v = Vec::new();
    v.extend_from_slice(b"RIFF");
    v.extend_from_slice(&(36u32 + n as u32).to_le_bytes());
    v.extend_from_slice(b"WAVEfmt ");
    v.extend_from_slice(&16u32.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes());
    v.extend_from_slice(&8000u32.to_le_bytes());
    v.extend_from_slice(&8000u32.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes());
    v.extend_from_slice(&8u16.to_le_bytes());
    v.extend_from_slice(b"data");
    v.extend_from_slice(&(n as u32).to_le_bytes());
    v.extend(std::iter::repeat_n(value, n));
    v
}

fn game(main: &str) -> Game {
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("music/song_lead.wav", wav(8000, 200)),
        ("music/song_bass.wav", wav(8000, 60)),
        ("music/song_drums.wav", wav(8000, 90)),
        ("music/short.wav", wav(4000, 90)),
        ("main.lua", main.as_bytes().to_vec()),
    ]));
    let mut g = Game::load(vfs).expect("loads");
    g.upload(&mut NullUploader::default());
    g
}

#[test]
fn layers_start_together_with_their_levels_and_a_bar_length() {
    let g = game(
        r#"nova.music.layers({ "song_lead", "song_bass", "song_drums" }, { levels = { 1, 0, 0.5 }, bpm = 120, beats = 3, volume = 0.8, fade = 0.25 })"#,
    );
    assert!(g.error.is_none(), "{:?}", g.error);
    let commands = g.take_audio();
    assert_eq!(commands.len(), 1);
    match &commands[0] {
        Command::PlayLayers {
            layers,
            bar_seconds,
        } => {
            assert!(
                (bar_seconds - 1.5).abs() < 1e-9,
                "3 beats at 120 bpm: {bar_seconds}"
            );
            let levels: Vec<f32> = layers.iter().map(|(_, l)| *l).collect();
            assert_eq!(levels, [1.0, 0.0, 0.5]);
            for (p, _) in layers {
                assert!(p.music && p.looping && p.volume == 0.8 && p.fade_in == 0.25);
            }
            let ids: Vec<u64> = layers.iter().map(|(p, _)| p.id).collect();
            assert!(ids[0] != ids[1] && ids[1] != ids[2]);
        }
        _ => panic!("expected PlayLayers"),
    }
}

#[test]
fn a_layer_is_faded_by_name_now_or_at_the_bar() {
    let g = game(
        r#"
nova.music.layers({ "song_lead", "song_bass" }, { bar = 2 })
nova.music.layer("song_bass", 1, { fade = 0.5, at = "bar" })
nova.music.layer("song_lead", 0)
"#,
    );
    assert!(g.error.is_none(), "{:?}", g.error);
    let commands = g.take_audio();
    let ids: Vec<u64> = match &commands[0] {
        Command::PlayLayers {
            layers,
            bar_seconds,
        } => {
            assert_eq!(*bar_seconds, 2.0);
            layers.iter().map(|(p, _)| p.id).collect()
        }
        _ => panic!(),
    };
    match (&commands[1], &commands[2]) {
        (
            Command::LayerLevel {
                id: a,
                level: la,
                fade: fa,
                at_bar: ba,
            },
            Command::LayerLevel {
                id: b,
                level: lb,
                fade: fb,
                at_bar: bb,
            },
        ) => {
            assert_eq!((*a, *la, *fa, *ba), (ids[1], 1.0, 0.5, true));
            assert_eq!((*b, *lb, *fb, *bb), (ids[0], 0.0, 0.0, false));
        }
        _ => panic!("expected two LayerLevel commands"),
    }
}

fn error_of(main: &str) -> String {
    let g = game(main);
    format!("{:?}", g.error)
}

#[test]
fn mistakes_get_a_plain_error() {
    assert!(error_of(r#"nova.music.layer("song_lead", 1)"#).contains("nova.music.layers"));
    assert!(
        error_of(r#"nova.music.layers({ "song_lead" }); nova.music.layer("nope", 1)"#)
            .contains("its layers: song_lead")
    );
    assert!(
        error_of(r#"nova.music.layers({ "song_lead" }); nova.music.layer("song_lead", 2)"#)
            .contains("0 to 1")
    );
    assert!(error_of(r#"nova.music.layers({ "song_lead" }); nova.music.layer("song_lead", 1, { at = "later" })"#).contains("now\\\" or \\\"bar"));
    assert!(error_of(r#"nova.music.layers({})"#).contains("1 to 8"));
    assert!(error_of(r#"nova.music.layers({ "ghost" })"#).contains("unknown music 'ghost'"));
    assert!(
        error_of(r#"nova.music.layers({ "song_lead", "short" })"#).contains("not the same length")
    );
    assert!(
        error_of(r#"nova.music.layers({ "song_lead" }, { bpm = 5 })"#)
            .contains("bpm must be from 20 to 400")
    );
}

#[test]
fn stopping_the_music_forgets_the_layers() {
    let g = game(
        r#"
nova.music.layers({ "song_lead" })
nova.music.stop()
nova.music.layer("song_lead", 1)
"#,
    );
    assert!(format!("{:?}", g.error).contains("nova.music.layers"));
}

fn music_plays(g: &Game) -> Vec<u64> {
    g.take_audio()
        .iter()
        .filter_map(|c| match c {
            Command::Play(p) if p.music => Some(p.id),
            _ => None,
        })
        .collect()
}

#[test]
fn playing_the_song_that_already_plays_carries_on_unless_asked_to_restart() {
    // A door between two rooms that share a song: the second play keeps the song going, by short or full name.
    let g = game(
        r#"
first = nova.music.play("song_lead")
again = nova.music.play("music/song_lead.wav")
assert(first == again, "the same voice carries on")
"#,
    );
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(music_plays(&g).len(), 1, "one start, not two");
    // restart = true starts it from the top; another song replaces it; after stop it starts again
    let g = game(
        r#"
nova.music.play("song_lead")
nova.music.play("song_lead", { restart = true })
nova.music.play("song_bass")
nova.music.play("song_bass")
nova.music.stop()
nova.music.play("song_bass")
"#,
    );
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(music_plays(&g).len(), 4);
    // a track that does not loop and is not reported playing any more starts again
    let g = game(
        r#"
nova.music.play("short", { loop = false })
nova.music.play("short", { loop = false })
"#,
    );
    assert_eq!(music_plays(&g).len(), 2);
}
