//! Skinned models: a mesh that bends with the parts it is weighted to, read from the .glb the studio exports.

use std::cell::Cell;
use std::rc::Rc;

use nova_runtime::game::{Game, Uploader};
use nova_runtime::input::Actions;
use nova_runtime::model::{self, Image, MeshData};
use nova_runtime::vfs::{MemVfs, Vfs};

/// `waving()` in studio/src/lib/model-skin.test.ts: a 16-point sleeve (rings of four at y = -8, -4, 0, 4 around the
/// part `arm`, which hangs from `body` at (6, 10, 0)), weighted automatically to body, arm and hand, 1/16 scale.
/// The clip "wave" turns the arm 90 degrees about z over one second.
/// Expected points are `skinnedPoints` of the studio, in model units (the file is 1/16 of that).
const SLEEVE: &[u8] = include_bytes!("fixtures/studio_model_skin.glb");

const REST: [(usize, [f32; 3]); 3] = [
    (0, [5.0, 2.0, -1.0]),
    (4, [5.0, 6.0, -1.0]),
    (12, [5.0, 14.0, -1.0]),
];
const WAVED: [(usize, [f32; 3]); 4] = [
    (0, [14.0, 9.0, -1.0]),
    (4, [9.874, 8.9244, -1.0]),
    (8, [5.5, 9.5, -1.0]),
    (12, [4.9223, 13.8705, -1.0]),
];
const HALFWAY: [(usize, [f32; 3]); 2] = [(0, [10.9497, 3.636, -1.0]), (4, [8.0427, 6.4528, -1.0])];

/// Each polygon corner is its own vertex (12 quads, 4 corners), so a point of the sleeve is found at its first corner:
/// point `p` of rings 0 to 2 is polygon `p`, corner 0; the top ring's points are the last corners of the quads below.
fn vertex_of(point: usize) -> usize {
    if point < 12 {
        point * 4
    } else {
        (point - 12) * 4 + 8 * 4 + 3
    }
}

fn near(got: [f32; 3], want: [f32; 3], what: &str) {
    for k in 0..3 {
        assert!(
            (got[k] * 16.0 - want[k]).abs() < 2e-3,
            "{what}: got {:?} (x16), want {want:?}",
            got.map(|v| v * 16.0)
        );
    }
}

#[test]
fn the_importer_reads_the_skin() {
    let imported = model::import_parts(SLEEVE).expect("imports");
    let skinned: Vec<_> = imported.parts.iter().filter(|p| p.skin.is_some()).collect();
    assert_eq!(skinned.len(), 1);
    let skin = skinned[0].skin.as_ref().unwrap();
    let names: Vec<_> = skin
        .joints
        .iter()
        .map(|&j| imported.parts[j].name.as_str())
        .collect();
    assert_eq!(names, ["arm", "hand", "body"]);
    assert_eq!(skin.influences.len(), 48);
    assert_eq!(skinned[0].mesh.as_ref().unwrap().vertices.len(), 48);
    for (_, w) in &skin.influences {
        assert!((w.iter().sum::<f32>() - 1.0).abs() < 1e-3);
    }
}

/// The parts' places in the model (parents first), with the clip's pose where it has one.
fn world_at(imported: &model::ModelParts, time: f32) -> Vec<glam::Mat4> {
    let poses = imported.clips[0].pose(time, false, imported.parts.len());
    let mut world = vec![glam::Mat4::IDENTITY; imported.parts.len()];
    for (i, p) in imported.parts.iter().enumerate() {
        let (s, r, t) = p.rest.to_scale_rotation_translation();
        let local = glam::Mat4::from_scale_rotation_translation(
            poses[i].scale.unwrap_or(s),
            poses[i].rotation.unwrap_or(r),
            poses[i].translation.unwrap_or(t),
        );
        world[i] = p.parent.map_or(local, |parent| world[parent] * local);
    }
    world
}

#[test]
fn posing_matches_the_studios_own_numbers() {
    let imported = model::import_parts(SLEEVE).unwrap();
    let part = imported.parts.iter().find(|p| p.skin.is_some()).unwrap();
    let bind = &part.mesh.as_ref().unwrap().vertices;
    let skin = part.skin.as_ref().unwrap();
    for (time, expected) in [(0.0, &REST[..]), (1.0, &WAVED[..]), (0.5, &HALFWAY[..])] {
        let posed = skin.pose(bind, &world_at(&imported, time));
        for &(i, want) in expected {
            near(
                posed[vertex_of(i)].position,
                want,
                &format!("point {i} at t={time}"),
            );
        }
    }
    // normals stay unit length
    let posed = skin.pose(bind, &world_at(&imported, 1.0));
    for v in &posed {
        let n = glam::Vec3::from(v.normal);
        assert!((n.length() - 1.0).abs() < 1e-3);
    }
}

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

#[test]
fn a_clip_bends_the_mesh_in_the_game() {
    let mut g = game(
        "function update(dt) nova.model('sleeve', 0, 0, 0, { clip = 'wave', time = 1, loop = false }) end",
    );
    g.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
    assert!(g.error.is_none(), "{:?}", g.error);
    let input = g.frame_input(0);
    assert_eq!(
        input.models.len(),
        1,
        "the sleeve is the only thing with triangles"
    );
    assert_eq!(input.mesh_writes.len(), 1);
    assert_eq!(input.mesh_writes[0].mesh, input.models[0].mesh);
    assert_eq!(input.mesh_writes[0].vertices.len(), 48);
    near(
        input.mesh_writes[0].vertices[vertex_of(0)].position,
        [14.0, 9.0, -1.0],
        "point 0",
    );
}

#[test]
fn every_draw_gets_a_mesh_of_its_own() {
    let mut g = game(
        "function update(dt) for i = 1, 3 do nova.model('sleeve', i * 10, 0, 0, { clip = 'wave', time = i / 4, loop = false }) end end",
    );
    g.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
    assert!(g.error.is_none(), "{:?}", g.error);
    let input = g.frame_input(0);
    let mut meshes: Vec<_> = input.models.iter().map(|m| m.mesh).collect();
    meshes.sort_unstable();
    meshes.dedup();
    assert_eq!(meshes.len(), 3);
    assert_eq!(input.mesh_writes.len(), 3);
    // the next frame starts over
    g.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
    assert_eq!(g.frame_input(0).mesh_writes.len(), 3);
}

#[test]
fn without_a_clip_the_whole_model_draws_at_rest() {
    let mut g = game("function update(dt) nova.model('sleeve', 0, 0, 0) end");
    g.update(1.0 / 60.0, 0.0, [960.0, 540.0], Actions::default(), false);
    let input = g.frame_input(0);
    assert_eq!(input.models.len(), 1);
    assert!(input.mesh_writes.is_empty());
}
