//! Crowds of animated models: characters at the same moment of a clip share one pose (one set of joint matrices), a clip model
//! can name a cheaper model for when it is far, and `max_distance` draws nothing beyond it.

use std::cell::Cell;
use std::rc::Rc;
use std::time::Instant;

use nova_runtime::game::{Game, Uploader};
use nova_runtime::input::Actions;
use nova_runtime::model::{Image, MeshData};
use nova_runtime::vfs::{MemVfs, Vfs};

const SLEEVE: &[u8] = include_bytes!("fixtures/studio_model_skin.glb");

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

fn game(script: &str) -> Game {
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("models/sleeve.glb", SLEEVE.to_vec()),
        ("main.lua", script.as_bytes().to_vec()),
    ]));
    let mut g = Game::load(vfs).expect("project loads");
    g.upload(&mut CountingGpu::default());
    g
}

fn frame(g: &mut Game) {
    g.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
    assert!(g.error.is_none(), "{:?}", g.error);
}

#[test]
fn characters_at_one_moment_share_a_pose() {
    // 300 characters with a different phase each, snapped to 0.1 s steps over a 1 s clip: at most ten poses
    let mut g = game(
        "function update(dt) for i = 1, 300 do nova.model('sleeve', i, 0, 0, { clip = 'wave', time = (i * 0.0377) % 1, pose_step = 0.1 }) end end",
    );
    frame(&mut g);
    let input = g.frame_input(0);
    assert_eq!(
        input.models.len(),
        300,
        "everyone is still drawn, one instance each"
    );
    assert!(
        input.joints.len() <= 3 * 10,
        "{} joint matrices",
        input.joints.len()
    );
    let mut bases: Vec<f32> = input
        .models
        .iter()
        .map(|m| m.instance.matrix[0][3])
        .collect();
    bases.sort_by(f32::total_cmp);
    bases.dedup();
    assert_eq!(
        bases.len() * 3,
        input.joints.len(),
        "one set of joints per distinct pose"
    );
    // each instance keeps its own place
    let xs: std::collections::HashSet<u32> = input
        .models
        .iter()
        .map(|m| m.instance.matrix[3][0].to_bits())
        .collect();
    assert_eq!(xs.len(), 300);
}

#[test]
fn exact_times_share_only_when_equal() {
    let mut g = game(
        "function update(dt) for i = 1, 20 do nova.model('sleeve', i, 0, 0, { clip = 'wave', time = (i % 4) / 8 }) end end",
    );
    frame(&mut g);
    assert_eq!(g.frame_input(0).joints.len(), 3 * 4);
}

#[test]
fn a_shared_pose_is_the_same_as_its_own() {
    // the one character, drawn alone at a snapped time, and inside a crowd: the same joint matrices
    let alone = |opts: &str| {
        let mut g = game(&format!(
            "function update(dt) nova.model('sleeve', 0, 0, 0, {opts}) end"
        ));
        frame(&mut g);
        g.frame_input(0).joints.to_vec()
    };
    let snapped = alone("{ clip = 'wave', time = 0.5 }");
    let stepped = alone("{ clip = 'wave', time = 0.53, pose_step = 0.1 }");
    assert_eq!(snapped, stepped);
    let mut g = game(
        "function update(dt) nova.model('sleeve', 0, 0, 0, { clip = 'wave', time = 0.5 }) nova.model('sleeve', 5, 0, 0, { clip = 'wave', time = 0.5 }) end",
    );
    frame(&mut g);
    let input = g.frame_input(0);
    assert_eq!(input.joints.len(), 3);
    assert_eq!(input.joints, &snapped[..]);
}

#[test]
fn the_cache_does_not_outlive_the_frame() {
    let mut g = game(
        "function update(dt) for i = 1, 5 do nova.model('sleeve', i, 0, 0, { clip = 'wave', time = 0.5 }) end end",
    );
    frame(&mut g);
    frame(&mut g);
    let input = g.frame_input(0);
    assert_eq!(input.joints.len(), 3);
    assert_eq!(input.models.len(), 5);
}

const LOD: &str = "nova.camera(0, 2, 0, 0, 0, -10, 60)
function update(dt) nova.model('sleeve', 0, 0, -DIST, { clip = 'wave', time = 0.5, lod = 'sleeve', lod_distance = 40, lod_fade = 10 }) end";

#[test]
fn a_clip_model_swaps_to_its_cheaper_model_far_away() {
    let mut near = game(&LOD.replace("DIST", "10"));
    frame(&mut near);
    let mut far = game(&LOD.replace("DIST", "80"));
    frame(&mut far);
    let mut mid = game(&LOD.replace("DIST", "40"));
    frame(&mut mid);
    let (n, f, m) = (near.frame_input(0), far.frame_input(0), mid.frame_input(0));
    assert_eq!((n.models.len(), f.models.len(), m.models.len()), (1, 1, 2));
    assert_eq!(n.joints.len(), 3, "near: animated");
    assert_eq!(
        f.joints.len(),
        0,
        "far: the plain model, no joints, no pose made"
    );
    assert_ne!(n.models[0].mesh, f.models[0].mesh);
    assert_eq!(
        (
            n.models[0].instance.matrix[1][3],
            f.models[0].instance.matrix[1][3]
        ),
        (0.0, 0.0)
    );
    let dissolves: Vec<f32> = m.models.iter().map(|d| d.instance.matrix[1][3]).collect();
    assert!(
        dissolves.iter().any(|d| *d < 0.0) && dissolves.iter().any(|d| *d > 0.0),
        "{dissolves:?}"
    );
    assert_eq!(m.joints.len(), 3, "between: both drawn");
}

#[test]
fn max_distance_draws_nothing_beyond_it() {
    let script = "nova.camera(0, 2, 0, 0, 0, -10, 60)
function update(dt)
  nova.model('sleeve', 0, 0, -30, { clip = 'wave', time = 0.5, max_distance = 50 })
  nova.model('sleeve', 0, 0, -70, { clip = 'wave', time = 0.25, max_distance = 50 })
  nova.model('sleeve', 5, 0, -70, { max_distance = 50 })
end";
    let mut g = game(script);
    frame(&mut g);
    let input = g.frame_input(0);
    assert_eq!(input.models.len(), 1, "only the near one");
    assert_eq!(input.joints.len(), 3, "and no pose for the far one");
}

#[test]
fn a_far_model_that_is_missing_is_explained() {
    let mut g = game(
        "function update(dt) nova.model('sleeve', 0, 0, 0, { clip = 'wave', lod = 'nope' }) end",
    );
    g.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
    assert!(
        g.error
            .as_deref()
            .is_some_and(|e| e.contains("unknown model 'nope' for lod")),
        "{:?}",
        g.error
    );
}

/// Cost of 300 characters, as `cargo test --release -- --ignored --nocapture crowd_cost`: Lua + pose time per frame, joint
/// matrices a frame, distinct poses and (when a GPU is there) the time of a whole frame with its read-back.
#[test]
#[ignore]
fn crowd_cost() {
    use nova_runtime::gfx::{FrameInput, Gfx};
    let oobi = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../examples/stress/models/character-oobi.glb"
    ))
    .unwrap();
    let make = |opts: &str| {
        let script = format!(
            "nova.camera(0, 14, 40, 0, 0, 0, 60)
nova.light {{ dir = {{ -0.4, -0.8, -0.3 }} }}
local t = 0
function update(dt) t = t + dt end
function draw()
  for i = 1, 300 do
    local a = i * 0.7
    nova.model('character-oobi', math.sin(a) * (6 + i * 0.1), 0, math.cos(a) * (6 + i * 0.1), {{ scale = 1.8, clip = 'walk', time = t + i * 0.13, ry = a, {opts} }})
  end
end"
        );
        let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
            ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
            ("models/character-oobi.glb", oobi.clone()),
            ("main.lua", script.into_bytes()),
        ]));
        Game::load(vfs).expect("loads")
    };
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let mut gfx = Gfx::new(&instance, None).ok();
    println!(
        "{:<44} {:>8} {:>9} {:>7} {:>6} {:>9}",
        "case", "cpu ms", "joints", "draws", "tris", "frame ms"
    );
    for (name, opts) in [
        ("own pose each (before)", ""),
        ("shared poses, step 1/15", "pose_step = 1/15"),
        (
            "shared + lod 30 m + max_distance 70 m",
            "pose_step = 1/15, lod = 'character-oobi', lod_distance = 30, max_distance = 70",
        ),
    ] {
        let mut g = make(opts);
        match &mut gfx {
            Some(gfx) => g.upload(gfx),
            None => g.upload(&mut CountingGpu::default()),
        }
        let frames = 120;
        for _ in 0..10 {
            g.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
        }
        let started = Instant::now();
        let (mut joints, mut count) = (0, 0);
        for _ in 0..frames {
            g.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
            let input = g.frame_input(0);
            joints = input.joints.len();
            count = input.models.len();
        }
        let cpu = started.elapsed().as_secs_f64() * 1000.0 / frames as f64;
        let (mut draws, mut tris, mut frame_ms) = (0, 0, 0.0);
        if let Some(gfx) = &mut gfx {
            let size = (960, 540);
            let t0 = Instant::now();
            let n = 30;
            for _ in 0..n {
                g.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
                let input: FrameInput = g.frame_input(0);
                let (_, stats) = gfx.capture_with_stats(size, &input);
                draws = stats.draw_calls;
                tris = stats.triangles;
            }
            frame_ms = t0.elapsed().as_secs_f64() * 1000.0 / n as f64;
        }
        println!(
            "{name:<44} {cpu:>8.3} {joints:>9} {draws:>7} {tris:>6} {frame_ms:>9.2}  ({count} instances)"
        );
    }
}
