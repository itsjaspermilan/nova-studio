//! Constraints made in the studio (glTF node `extras.nova.constraints`) are applied live in the game: a reach puts the end of a limb on its
//! target, and `constraints = false` draws the model as the animation alone says (limits and copies are tested in `constraints.rs`).

use std::rc::Rc;

use nova_runtime::game::{Game, NullUploader};
use nova_runtime::input::Actions;
use nova_runtime::vfs::{MemVfs, Vfs};

/// A chain body > arm > forearm > hand, each one unit below the last (the arm one unit below the body), every node holding the same
/// triangle; `arm_extras` is the JSON of the arm's `extras`.
fn chain(arm_extras: &str) -> Vec<u8> {
    let f = |v: &[f32]| v.iter().flat_map(|x| x.to_le_bytes()).collect::<Vec<u8>>();
    let mut bin = f(&[0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.1, 0.0]);
    let json = format!(
        r#"{{"asset":{{"version":"2.0"}},"scene":0,"scenes":[{{"nodes":[0]}}],
"nodes":[
 {{"name":"body","mesh":0,"children":[1]}},
 {{"name":"arm","mesh":0,"translation":[0,-1,0],"children":[2],"extras":{arm_extras}}},
 {{"name":"forearm","mesh":0,"translation":[0,-1,0],"children":[3]}},
 {{"name":"hand","mesh":0,"translation":[0,-1,0]}}],
"meshes":[{{"primitives":[{{"attributes":{{"POSITION":0}}}}]}}],
"accessors":[{{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3","min":[0,0,0],"max":[0.1,0.1,0]}}],
"bufferViews":[{{"buffer":0,"byteOffset":0,"byteLength":36}}],
"buffers":[{{"byteLength":{len}}}]}}"#,
        len = bin.len()
    );
    let mut json = json.into_bytes();
    while json.len() % 4 != 0 {
        json.push(b' ');
    }
    while bin.len() % 4 != 0 {
        bin.push(0);
    }
    let total = 12 + 8 + json.len() + 8 + bin.len();
    let mut out = Vec::new();
    out.extend(b"glTF");
    out.extend(2u32.to_le_bytes());
    out.extend((total as u32).to_le_bytes());
    out.extend((json.len() as u32).to_le_bytes());
    out.extend(b"JSON");
    out.extend(&json);
    out.extend((bin.len() as u32).to_le_bytes());
    out.extend(b"BIN\0");
    out.extend(&bin);
    out
}

fn run(glb: Vec<u8>, main: &str) -> Game {
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("models/chain.glb", glb),
        ("main.lua", main.as_bytes().to_vec()),
    ]));
    let mut g = Game::load(vfs).expect("loads");
    g.upload(&mut NullUploader::default());
    g.update(1.0 / 60.0, 0.0, [320.0, 180.0], Actions::default(), false);
    assert!(g.error.is_none(), "{:?}", g.error);
    g
}

#[test]
fn a_reach_puts_the_hand_on_its_target_and_can_be_turned_off() {
    // the arm hangs from (0, -1, 0): its hand rests at (0, -3, 0). Ask it to reach (0.8, -2, 0).
    let reach = r#"{"nova":{"constraints":[{"type":"reach","target":[0.8,-2,0],"pole":[0,0,1]}]}}"#;
    let g = run(
        chain(reach),
        r#"
function update(dt)
  local on = nova.model_pose("chain", {})
  local off = nova.model_pose("chain", { constraints = false })
  assert(math.abs(on.hand.x - 0.8) < 0.01 and math.abs(on.hand.y + 2) < 0.01, "hand " .. on.hand.x .. "," .. on.hand.y)
  assert(math.abs(off.hand.x) < 0.01 and math.abs(off.hand.y + 3) < 0.01, "off " .. off.hand.x .. "," .. off.hand.y)
end
"#,
    );
    drop(g);
}
