//! Probe 1, Ember Swarm (examples/ember-swarm, see docs/probes.md): a 3D survivors-style shooter made to find the engine's
//! limits. This runs it with the benchmark keys (F9 autopilot, F5 for a hundred more enemies, held steady) and checks two
//! things: it runs without errors with hundreds of enemies, and the cost of a frame grows about in proportion to the number
//! of enemies, not with its square (the first version, which looked through every enemy for every enemy, did).

use std::cell::Cell;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Instant;

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

/// Runs the game with `hundreds` hundred enemies held steady and returns the mean milliseconds of Lua a frame once they are all
/// there, and how many enemies there were.
fn mean_frame_ms(hundreds: usize) -> (f64, usize) {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/ember-swarm");
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&folder).expect("the example folder exists"));
    let mut g = Game::load(vfs).expect("the game loads");
    g.upload(&mut CountingGpu::default());
    for _ in 0..5 {
        frame(&mut g, &[]);
    }
    tap(&mut g, "key:F9");
    for _ in 0..hundreds {
        tap(&mut g, "key:F5");
    }
    // let them all arrive (eight a frame)
    for _ in 0..(hundreds * 100 / 8 + 120) {
        frame(&mut g, &[]);
    }
    let started = Instant::now();
    let frames = 240;
    for _ in 0..frames {
        frame(&mut g, &[]);
    }
    let ms = started.elapsed().as_secs_f64() * 1000.0 / frames as f64;
    g.take_log();
    (ms, hundreds * 100)
}

#[test]
fn the_swarm_runs_with_hundreds_of_enemies_and_its_cost_grows_in_step_with_their_number() {
    let (small, n_small) = mean_frame_ms(1);
    let (large, n_large) = mean_frame_ms(6);
    assert_eq!((n_small, n_large), (100, 600));
    // six times the enemies: about six times the time if the cost is in step (the old, quadratic version was about 27 times)
    let ratio = large / small.max(0.01);
    eprintln!("swarm: 100 enemies {small:.2} ms, 600 enemies {large:.2} ms, x{ratio:.1}");
    assert!(
        ratio < 14.0,
        "frame cost per enemy grew with the crowd: 100 enemies {small:.2} ms, 600 enemies {large:.2} ms (x{ratio:.1})"
    );
}
