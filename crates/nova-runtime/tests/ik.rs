//! `nova.model_pose` and `nova.ik`: where a model's joints are in a pose, and the turns that make a two-bone limb reach a target.
//! The model is an arm of three parts made here: `shoulder` at the origin, `elbow` a unit above it, `hand` a unit above that.

use std::cell::Cell;
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

/// A glTF (binary): shoulder > elbow > hand, each a unit above its parent, with one small triangle on the hand (the loader wants some
/// geometry), and a separate part `other`.
fn arm_glb() -> Vec<u8> {
    let json = br#"{"asset":{"version":"2.0"},"scene":0,"scenes":[{"nodes":[0,3]}],
      "nodes":[
        {"name":"shoulder","children":[1]},
        {"name":"elbow","translation":[0,1,0],"children":[2]},
        {"name":"hand","translation":[0,1,0],"mesh":0},
        {"name":"other","translation":[5,0,0]}
      ],
      "meshes":[{"primitives":[{"attributes":{"POSITION":0}}]}],
      "buffers":[{"byteLength":36}],
      "bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36}],
      "accessors":[{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3","min":[0,0,0],"max":[0.1,0.1,0]}]}"#;
    let mut j = json.to_vec();
    while !j.len().is_multiple_of(4) {
        j.push(b' ');
    }
    let mut bin = Vec::new();
    for v in [0.0f32, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.1, 0.0] {
        bin.extend_from_slice(&v.to_le_bytes());
    }
    let total = 12 + 8 + j.len() + 8 + bin.len();
    let mut out = Vec::new();
    out.extend_from_slice(b"glTF");
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&(total as u32).to_le_bytes());
    out.extend_from_slice(&(j.len() as u32).to_le_bytes());
    out.extend_from_slice(b"JSON");
    out.extend_from_slice(&j);
    out.extend_from_slice(&(bin.len() as u32).to_le_bytes());
    out.extend_from_slice(b"BIN\0");
    out.extend_from_slice(&bin);
    out
}

fn run(script: &str) -> (Game, Vec<String>) {
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("models/arm.glb", arm_glb()),
        (
            "main.lua",
            format!("function update(dt)\n{script}\nend").into_bytes(),
        ),
    ]));
    let mut g = Game::load(vfs).expect("loads");
    g.upload(&mut CountingGpu::default());
    g.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
    let log = g.take_log();
    (g, log)
}

fn numbers(line: &str) -> Vec<f32> {
    line.split_whitespace()
        .filter_map(|w| w.parse().ok())
        .collect()
}

const SOLVE: &str = "
local chain = { 'shoulder', 'elbow', 'hand' }
local parts, reached = nova.ik('arm', nil, chain, TARGET, POLE)
local pose = nova.model_pose('arm', { parts = parts })
local e, h = pose.elbow, pose.hand
nova.log(string.format('%s %.4f %.4f %.4f %.4f %.4f %.4f', tostring(reached), e.x, e.y, e.z, h.x, h.y, h.z))
";

#[test]
fn the_pose_names_every_joint_and_the_ik_puts_the_hand_on_the_target_with_the_bones_the_same_length()
 {
    let (g, log) = run(
        "local p = nova.model_pose('arm')\nnova.log(string.format('%.2f %.2f %.2f', p.hand.x, p.hand.y, p.hand.z))\nnova.log(string.format('%.2f', p.other.x))",
    );
    assert!(g.error.is_none(), "{:?}", g.error);
    assert_eq!(log, ["0.00 2.00 0.00", "5.00"]);
    let script = SOLVE
        .replace("TARGET", "{ x = 1.0, y = 1.0, z = 0.3 }")
        .replace("POLE", "{ x = 0, y = 0, z = 9 }");
    let (g, log) = run(&script);
    assert!(g.error.is_none(), "{:?}", g.error);
    let line = log.last().expect("a line");
    assert!(line.starts_with("true"), "{line}");
    let v = numbers(line);
    let (elbow, hand) = ([v[0], v[1], v[2]], [v[3], v[4], v[5]]);
    assert!(
        (hand[0] - 1.0).abs() < 2e-3
            && (hand[1] - 1.0).abs() < 2e-3
            && (hand[2] - 0.3).abs() < 2e-3,
        "the hand is on the target: {hand:?}"
    );
    let len = |a: [f32; 3], b: [f32; 3]| {
        ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
    };
    assert!(
        (len([0.0; 3], elbow) - 1.0).abs() < 2e-3,
        "upper bone: {elbow:?}"
    );
    assert!((len(elbow, hand) - 1.0).abs() < 2e-3, "lower bone");
    assert!(
        elbow[2] > 0.1,
        "the elbow bends toward the pole (+z): {elbow:?}"
    );
    // the other pole, the other way
    let script = SOLVE
        .replace("TARGET", "{ x = 1.0, y = 1.0, z = 0.3 }")
        .replace("POLE", "{ x = 0, y = 0, z = -9 }");
    let (_, log) = run(&script);
    let v = numbers(log.last().unwrap());
    assert!(v[2] < -0.1, "bends the other way: {v:?}");
}

#[test]
fn a_target_out_of_reach_is_not_reached_and_the_limb_stretches_toward_it() {
    let script = SOLVE
        .replace("TARGET", "{ x = 6.0, y = 0.0, z = 0.0 }")
        .replace("POLE", "nil");
    let (g, log) = run(&script);
    assert!(g.error.is_none(), "{:?}", g.error);
    let line = log.last().unwrap();
    assert!(line.starts_with("false"), "{line}");
    let v = numbers(line);
    assert!(
        v[3] > 1.99 && v[3] < 2.0 && v[4].abs() < 0.05,
        "stretched along +x: {v:?}"
    );
}

#[test]
fn bad_chains_and_targets_are_explained() {
    for (script, expect) in [
        (
            "nova.ik('arm', nil, { 'shoulder', 'elbow' }, { x = 0, y = 0, z = 0 })",
            "three part names",
        ),
        (
            "nova.ik('arm', nil, { 'shoulder', 'wing', 'hand' }, { x = 0, y = 0, z = 0 })",
            "has no part 'wing'",
        ),
        (
            "nova.ik('arm', nil, { 'shoulder', 'hand', 'elbow' }, { x = 0, y = 0, z = 0 })",
            "a part, its child and that one's child",
        ),
        (
            "nova.ik('arm', nil, { 'shoulder', 'elbow', 'hand' }, { x = 1 })",
            "target must be",
        ),
        (
            "nova.ik('nope', nil, { 'a', 'b', 'c' }, { x = 0, y = 0, z = 0 })",
            "unknown model",
        ),
    ] {
        let (g, _) = run(script);
        let e = g.error.clone().unwrap_or_default();
        assert!(e.contains(expect), "{script}: {e}");
    }
}
