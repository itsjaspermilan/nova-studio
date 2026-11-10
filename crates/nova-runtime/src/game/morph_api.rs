//! Shape keys (glTF morph targets): `nova.model(id, x, y, z, { morph = { smile = 0.6 } })` blends a model's shape keys by name, and
//! `nova.model_morphs(id)` lists them.
//!
//! The blend is made on the CPU, once per distinct set of weights (rounded to sixteenths) and mesh, and the renderer keeps it as a copy
//! of the loaded mesh with other vertices (`MeshOp::Variant`: same triangles, picture and material). The least recently used copies
//! are freed past [`MAX_VARIANTS`]. Normals are not blended (they stay as at rest), and a part that bends with a skeleton ignores
//! shape keys.

use super::*;
use crate::gfx::{DYN_MESH_BASE, MeshOp};
use crate::model::MeshVertex;
use std::collections::VecDeque;

/// How many blended copies are kept on the GPU at once.
const MAX_VARIANTS: usize = 512;
/// The ids of blended copies start this far above the start of script-made meshes (below the voxel cubes and the walls' meshes).
const VARIANT_ID_BASE: usize = DYN_MESH_BASE + (1 << 26);

/// One mesh's shape keys with its vertices at rest.
pub(super) struct MorphSet {
    pub base: Vec<MeshVertex>,
    pub names: Vec<String>,
    pub deltas: Vec<Vec<[f32; 3]>>,
}

#[derive(Default)]
pub(super) struct Variants {
    /// By mesh key.
    pub sets: HashMap<String, Rc<MorphSet>>,
    /// The shape keys of each model, in the order the file lists them.
    pub model_names: HashMap<String, Vec<String>>,
    cache: HashMap<(String, Vec<i8>), usize>,
    order: VecDeque<(String, Vec<i8>)>,
    next: usize,
}

/// `morph = { name = weight, ... }` from the options of `nova.model`: weights by shape key name (any number; 0 to 1 is the range the keys are made for).
pub(super) fn weights_option(opts: &Option<Table>) -> mlua::Result<Option<HashMap<String, f32>>> {
    let Some(table) = opts
        .as_ref()
        .map(|o| o.get::<Option<Table>>("morph"))
        .transpose()?
        .flatten()
    else {
        return Ok(None);
    };
    let mut out = HashMap::new();
    for pair in table.pairs::<String, f64>() {
        let (name, w) = pair?;
        if !w.is_finite() {
            return Err(lua_err(format!("morph weight '{name}' must be a number")));
        }
        out.insert(name, w as f32);
    }
    Ok(Some(out))
}

/// The mesh to draw for part mesh `key` (loaded as `base_id`) with these weights: a blended copy, or `base_id` when the part has no shape keys
/// or every weight is zero.
pub(super) fn mesh_for(
    sh: &mut Shared,
    key: &str,
    base_id: usize,
    weights: &HashMap<String, f32>,
) -> usize {
    let Some(set) = sh.morph.sets.get(key).cloned() else {
        return base_id;
    };
    let steps: Vec<i8> = set
        .names
        .iter()
        .map(|n| {
            (weights.get(n).copied().unwrap_or(0.0) * 16.0)
                .round()
                .clamp(-32.0, 64.0) as i8
        })
        .collect();
    if steps.iter().all(|&s| s == 0) {
        return base_id;
    }
    let cache_key = (key.to_string(), steps);
    if let Some(&id) = sh.morph.cache.get(&cache_key) {
        if let Some(at) = sh.morph.order.iter().position(|k| *k == cache_key) {
            let k = sh.morph.order.remove(at).unwrap();
            sh.morph.order.push_back(k);
        }
        return id;
    }
    let mut vertices = set.base.clone();
    for (target, &step) in set.deltas.iter().zip(&cache_key.1) {
        if step == 0 {
            continue;
        }
        let w = step as f32 / 16.0;
        for (v, d) in vertices.iter_mut().zip(target) {
            v.position[0] += d[0] * w;
            v.position[1] += d[1] * w;
            v.position[2] += d[2] * w;
        }
    }
    while sh.morph.cache.len() >= MAX_VARIANTS {
        let Some(old) = sh.morph.order.pop_front() else {
            break;
        };
        if let Some(id) = sh.morph.cache.remove(&old) {
            sh.voxel.ops.push(MeshOp::Free(id));
        }
    }
    let id = VARIANT_ID_BASE + sh.morph.next;
    sh.morph.next += 1;
    sh.voxel.ops.push(MeshOp::Variant {
        id,
        base: base_id,
        vertices,
    });
    sh.morph.cache.insert(cache_key.clone(), id);
    sh.morph.order.push_back(cache_key);
    id
}

pub(super) fn register(lua: &Lua, nova: &Table, shared: &Rc<RefCell<Shared>>) -> mlua::Result<()> {
    let s = shared.clone();
    nova.set(
        "model_morphs",
        lua.create_function(move |lua, id: String| {
            let sh = s.borrow();
            let found = find_model(&sh.known_models, &id)
                .ok_or_else(|| lua_err(format!("unknown model '{id}'")))?;
            let list = lua.create_table()?;
            for (i, name) in sh
                .morph
                .model_names
                .get(&found)
                .into_iter()
                .flatten()
                .enumerate()
            {
                list.set(i + 1, name.clone())?;
            }
            Ok(list)
        })?,
    )
}
