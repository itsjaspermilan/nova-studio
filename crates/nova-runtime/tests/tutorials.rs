//! The Lua in the studio's lessons (studio/src/lib/tutorials/*.lua) must run. Each lesson's files are applied on top
//! of the Starter template the way a learner would, lessons in order, and the project is loaded and played for a while.
//! Files are named `NN-lesson__M-name.lua` and start with `-- file: <path in the project>`.

use std::cell::Cell;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::rc::Rc;

use nova_runtime::game::{Game, Uploader};
use nova_runtime::input::Actions;
use nova_runtime::model::{Image, MeshData};
use nova_runtime::vfs::{MemVfs, Vfs};

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

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Every file under the Starter template, by project path.
fn starter() -> BTreeMap<String, Vec<u8>> {
    fn walk(dir: &std::path::Path, prefix: &str, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let name = format!("{prefix}{}", entry.file_name().to_string_lossy());
            if entry.path().is_dir() {
                walk(&entry.path(), &format!("{name}/"), out);
            } else {
                out.insert(name, std::fs::read(entry.path()).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(
        &root().join("studio/src-tauri/templates/starter"),
        "",
        &mut out,
    );
    out
}

/// (lesson number, snippet file name, project path, code) in lesson order.
fn snippets() -> Vec<(u32, String, String, String)> {
    let dir = root().join("studio/src/lib/tutorials");
    let mut all = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "lua") {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let text = std::fs::read_to_string(&path).unwrap();
            let target = text
                .lines()
                .next()
                .and_then(|l| l.strip_prefix("-- file: "))
                .unwrap_or_else(|| panic!("{name} must start with '-- file: <path>'"))
                .trim()
                .to_string();
            let code = text.split_once('\n').map(|x| x.1).unwrap_or("").to_string();
            let number: u32 = name
                .split('-')
                .next()
                .unwrap()
                .parse()
                .unwrap_or_else(|_| panic!("{name}: lesson number"));
            all.push((number, name, target, code));
        }
    }
    all.sort();
    all
}

/// A short, valid mono WAV for lessons that play a sound they made.
fn wav() -> Vec<u8> {
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 22050,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::new(&mut cursor, spec).unwrap();
        for i in 0..2000 {
            w.write_sample(((i as f32 * 0.2).sin() * 8000.0) as i16)
                .unwrap();
        }
        w.finalize().unwrap();
    }
    cursor.into_inner()
}

fn play(files: BTreeMap<String, Vec<u8>>, frames: usize) -> Game {
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(
        files
            .iter()
            .map(|(p, b)| (p.as_str(), b.clone()))
            .collect::<Vec<(&str, Vec<u8>)>>(),
    ));
    let mut g = Game::load(vfs).expect("project loads");
    g.upload(&mut CountingGpu::default());
    for i in 0..frames {
        g.update(
            1.0 / 60.0,
            i as f64 / 60.0,
            [960.0, 540.0],
            Actions::default(),
            false,
        );
    }
    g
}

#[test]
fn the_starter_template_runs_before_any_lesson() {
    let g = play(starter(), 120);
    assert!(g.error.is_none(), "{:?}", g.error);
}

#[test]
fn every_lesson_runs_on_top_of_the_ones_before_it() {
    let all = snippets();
    assert!(all.len() >= 6, "found {} snippets", all.len());
    let mut lessons: Vec<u32> = all.iter().map(|s| s.0).collect();
    lessons.dedup();
    for upto in lessons {
        let mut files = starter();
        files.insert("sounds/coin.wav".into(), wav());
        files.insert(
            "models/robot.glb".into(),
            include_bytes!("fixtures/studio_model_anim.glb").to_vec(),
        );
        for (n, _, target, code) in all.iter().filter(|s| s.0 <= upto) {
            let _ = n;
            files.insert(target.clone(), code.clone().into_bytes());
        }
        let g = play(files, 180);
        assert!(
            g.error.is_none(),
            "after lesson {upto}: {:?}\n{:?}",
            g.error,
            g.error_detail
        );
        let input = g.frame_input(0);
        assert!(
            !input.sprites_back.is_empty() || !input.models.is_empty(),
            "after lesson {upto} something is drawn"
        );
    }
}

#[test]
fn lesson_one_puts_six_coins_and_a_score_in_the_level() {
    let mut files = starter();
    for (n, _, target, code) in snippets() {
        if n == 1 {
            files.insert(target, code.into_bytes());
        }
    }
    let g = play(files, 30);
    assert!(g.error.is_none(), "{:?}", g.error);
    // Six coins are drawn as squares in the world, besides the player's sprite.
    assert!(
        g.frame_input(0).sprites_back.len() >= 7,
        "{} sprites",
        g.frame_input(0).sprites_back.len()
    );
}

/// Plays a project while holding right and jumping, returning (sprites at the start, sprites at the end, sounds started).
fn run_to_the_right(files: BTreeMap<String, Vec<u8>>) -> (usize, usize, usize) {
    use nova_runtime::actions::InputFrame;
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(
        files
            .iter()
            .map(|(p, b)| (p.as_str(), b.clone()))
            .collect::<Vec<(&str, Vec<u8>)>>(),
    ));
    let mut g = Game::load(vfs).expect("project loads");
    g.upload(&mut CountingGpu::default());
    let held = InputFrame {
        overrides: vec![("move_x".to_string(), 1.0), ("jump".to_string(), 1.0)],
        ..Default::default()
    };
    let (mut first, mut sounds) = (0, 0);
    for i in 0..600 {
        g.update_input(1.0 / 60.0, i as f64 / 60.0, [960.0, 540.0], &held);
        assert!(g.error.is_none(), "{:?}", g.error);
        sounds += g.take_audio().len();
        if i == 2 {
            first = g.frame_input(0).sprites_back.len();
        }
    }
    (first, g.frame_input(0).sprites_back.len(), sounds)
}

#[test]
fn playing_lesson_one_the_player_can_pick_the_coins_up() {
    let mut files = starter();
    for (n, _, target, code) in snippets() {
        if n == 1 {
            files.insert(target, code.into_bytes());
        }
    }
    let (start, end, _) = run_to_the_right(files);
    assert!(
        end < start,
        "coins disappeared as they were collected: {start} sprites at the start, {end} after"
    );
}

#[test]
fn the_sound_lesson_plays_a_sound_when_a_coin_is_picked_up() {
    let mut files = starter();
    files.insert("sounds/coin.wav".into(), wav());
    for (n, _, target, code) in snippets() {
        if n <= 3 {
            files.insert(target, code.into_bytes());
        }
    }
    let (_, _, sounds) = run_to_the_right(files);
    assert!(sounds > 0, "a coin pickup should start a sound");
}
