//! Shape keys (glTF morph targets): the importer reads them by name, `nova.model(..., { morph = {...} })` asks the renderer for a blended
//! copy of the mesh, and an unchanged model keeps its loaded mesh.

use std::rc::Rc;

use nova_runtime::game::{Game, NullUploader};
use nova_runtime::gfx::{DYN_MESH_BASE, MeshOp};
use nova_runtime::input::Actions;
use nova_runtime::model::import_parts;
use nova_runtime::vfs::{MemVfs, Vfs};

/// A triangle with one shape key, `lift`, that raises every point by 2 (with or without normals in the file).
fn triangle(normals: bool) -> Vec<u8> {
    let f = |v: &[f32]| v.iter().flat_map(|x| x.to_le_bytes()).collect::<Vec<u8>>();
    let mut bin = f(&[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]);
    bin.extend(f(&[0.0, 2.0, 0.0, 0.0, 2.0, 0.0, 0.0, 2.0, 0.0]));
    if normals {
        bin.extend(f(&[0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0]));
    }
    let normal_view = if normals {
        r#",{"buffer":0,"byteOffset":72,"byteLength":36}"#
    } else {
        ""
    };
    let normal_accessor = if normals {
        r#",{"bufferView":2,"componentType":5126,"count":3,"type":"VEC3"}"#
    } else {
        ""
    };
    let attributes = if normals {
        r#""POSITION":0,"NORMAL":2"#
    } else {
        r#""POSITION":0"#
    };
    let json = format!(
        r#"{{"asset":{{"version":"2.0"}},"scene":0,"scenes":[{{"nodes":[0]}}],"nodes":[{{"name":"tri","mesh":0}}],
"meshes":[{{"extras":{{"targetNames":["lift"]}},"primitives":[{{"attributes":{{{attributes}}},"targets":[{{"POSITION":1}}]}}]}}],
"accessors":[{{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3","min":[0,0,0],"max":[1,1,0]}},{{"bufferView":1,"componentType":5126,"count":3,"type":"VEC3"}}{normal_accessor}],
"bufferViews":[{{"buffer":0,"byteOffset":0,"byteLength":36}},{{"buffer":0,"byteOffset":36,"byteLength":36}}{normal_view}],
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

fn game(glb: Vec<u8>, main: &str) -> Game {
    let vfs: Rc<dyn Vfs> = Rc::new(MemVfs::new(vec![
        ("nova.json", br#"{"format":1,"name":"T"}"#.to_vec()),
        ("models/tri.glb", glb),
        ("main.lua", main.as_bytes().to_vec()),
    ]));
    let mut g = Game::load(vfs).expect("loads");
    g.set_deterministic(true);
    g.upload(&mut NullUploader::default());
    g
}

fn frame(g: &mut Game) {
    g.clear_mesh_ops();
    g.update(1.0 / 60.0, 0.0, [320.0, 180.0], Actions::default(), false);
}

#[test]
fn the_importer_reads_the_shape_key_by_name_aligned_with_the_vertices() {
    for normals in [true, false] {
        let parts = import_parts(&triangle(normals)).expect("imports");
        let mesh = parts.parts[0].mesh.as_ref().expect("a mesh");
        assert_eq!(mesh.morphs.len(), 1);
        assert_eq!(mesh.morphs[0].name, "lift");
        assert_eq!(mesh.morphs[0].deltas.len(), mesh.vertices.len());
        assert!(mesh.morphs[0].deltas.iter().all(|d| *d == [0.0, 2.0, 0.0]));
    }
}

#[test]
fn a_model_without_morph_weights_keeps_its_loaded_mesh_and_with_them_gets_a_blended_copy() {
    let mut g = game(
        triangle(true),
        r#"
function update(dt) end
function draw()
  nova.model("tri", 0, 0, 0)
  nova.model("tri", 0, 0, 0, { morph = { lift = 0.5 } })
  nova.model("tri", 0, 0, 0, { morph = { lift = 0.5 } })
  nova.model("tri", 0, 0, 0, { morph = { lift = 0 } })
end
"#,
    );
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
    let input = g.frame_input(180);
    let variants: Vec<_> = input
        .mesh_ops
        .iter()
        .filter_map(|op| match op {
            MeshOp::Variant { id, base, vertices } => Some((*id, *base, vertices.clone())),
            _ => None,
        })
        .collect();
    assert_eq!(variants.len(), 1, "one blend for the one set of weights");
    let (id, _, vertices) = &variants[0];
    assert!(*id >= DYN_MESH_BASE);
    let ys: Vec<f32> = vertices.iter().map(|v| v.position[1]).collect();
    assert_eq!(
        ys,
        vec![1.0, 1.0, 2.0],
        "at rest 0, 0, 1, each raised by half of 2"
    );
    // the draws (instanced runs are ordered by mesh, so count them): the blended copy twice, and the loaded mesh twice (plain, and weight zero)
    let meshes: Vec<usize> = input.models.iter().map(|m| m.mesh).collect();
    assert_eq!(meshes.len(), 4);
    assert_eq!(meshes.iter().filter(|&&m| m == *id).count(), 2);
    let loaded: Vec<usize> = meshes.iter().copied().filter(|&m| m != *id).collect();
    assert_eq!(loaded.len(), 2);
    // (the plain draw is the whole model, the weight-zero one its part: both are loaded meshes, neither a blend)
    assert!(loaded.iter().all(|&m| m < DYN_MESH_BASE));
}

#[test]
fn the_shape_keys_of_a_model_are_listed() {
    let mut g = game(
        triangle(false),
        r#"
function update(dt)
  local names = nova.model_morphs("tri")
  assert(#names == 1 and names[1] == "lift", "names: " .. #names)
end
"#,
    );
    frame(&mut g);
    assert!(g.error.is_none(), "{:?}", g.error);
}
