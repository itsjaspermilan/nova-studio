//! Static glTF/GLB import for the supported subset.
//!
//! Supported: triangle meshes in the default scene (node transforms applied),
//! positions, normals (flat normals are generated when absent), one UV set,
//! COLOR_0, base colour factor, and a single base colour texture. Everything else
//! is not silently dropped: it is listed in [`MeshData::notes`] so the studio and
//! the log can say what was ignored.

use bytemuck::{Pod, Zeroable};
use glam::{Mat3, Mat4, Quat, Vec3, Vec4};

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct MeshVertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
    pub color: [u8; 4],
    pub uv: [f32; 2],
    /// How much the surface lights itself, from the material's emissive factor: 0 is lit by the scene only; at 1 the
    /// colour shows at full brightness whatever the lights do.
    pub emissive: f32,
}

#[derive(Clone, Debug)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

#[derive(Default)]
pub struct MeshData {
    pub vertices: Vec<MeshVertex>,
    pub indices: Vec<u32>,
    pub texture: Option<Image>,
    /// Features present in the file that this importer does not support.
    pub notes: Vec<String>,
}

impl MeshData {
    /// A flat, upward-facing square of the given half size sampling one UV point.
    pub fn ground(half: f32, uv: [f32; 2]) -> Self {
        let corners = [
            [-half, 0.0, half],
            [half, 0.0, half],
            [half, 0.0, -half],
            [-half, 0.0, -half],
        ];
        MeshData {
            vertices: corners
                .iter()
                .map(|&position| MeshVertex {
                    position,
                    normal: [0.0, 1.0, 0.0],
                    color: [255; 4],
                    uv,
                    emissive: 0.0,
                })
                .collect(),
            indices: vec![0, 1, 2, 0, 2, 3],
            ..Default::default()
        }
    }
}

fn to_rgba(data: &gltf::image::Data) -> Result<Vec<u8>, String> {
    use gltf::image::Format::*;
    let px = &data.pixels;
    Ok(match data.format {
        R8G8B8A8 => px.clone(),
        R8G8B8 => px
            .as_chunks::<3>()
            .0
            .iter()
            .flat_map(|c| [c[0], c[1], c[2], 255])
            .collect(),
        R8G8 => px
            .as_chunks::<2>()
            .0
            .iter()
            .flat_map(|c| [c[0], c[0], c[0], c[1]])
            .collect(),
        R8 => px.iter().flat_map(|&v| [v, v, v, 255]).collect(),
        other => {
            return Err(format!(
                "texture format {other:?} is not supported (8-bit images only)"
            ));
        }
    })
}

/// Joint numbers and weights for each vertex that `append_mesh` makes from this mesh (when it keeps the file's vertices).
fn read_influences(
    mesh: &gltf::Mesh,
    buffers: &[gltf::buffer::Data],
) -> Option<Vec<([u16; 4], [f32; 4])>> {
    let mut out = Vec::new();
    for primitive in mesh.primitives() {
        if primitive.mode() != gltf::mesh::Mode::Triangles {
            continue;
        }
        let reader = primitive.reader(|b| Some(&buffers[b.index()]));
        let count = reader.read_positions()?.count();
        // Without normals the importer splits vertices per triangle, which would no longer match.
        reader.read_normals()?;
        let joints: Vec<[u16; 4]> = reader.read_joints(0)?.into_u16().collect();
        let weights: Vec<[f32; 4]> = reader.read_weights(0)?.into_f32().collect();
        if joints.len() != count || weights.len() != count {
            return None;
        }
        out.extend(joints.into_iter().zip(weights));
    }
    Some(out)
}

/// Reads every triangle primitive of a mesh into `out`, with positions and normals moved by `world`.
fn append_mesh(
    out: &mut MeshData,
    mesh: &gltf::Mesh,
    world: Mat4,
    buffers: &[gltf::buffer::Data],
    texture_index: &mut Option<usize>,
) {
    let normal_matrix = Mat3::from_mat4(world).inverse().transpose();
    for primitive in mesh.primitives() {
        if primitive.mode() != gltf::mesh::Mode::Triangles {
            out.notes.push(format!(
                "primitive mode {:?} skipped (triangles only)",
                primitive.mode()
            ));
            continue;
        }
        if primitive.morph_targets().count() > 0 {
            out.notes.push("morph targets are ignored".into());
        }
        let reader = primitive.reader(|b| Some(&buffers[b.index()]));
        let Some(positions) = reader.read_positions() else {
            out.notes.push("primitive without POSITION skipped".into());
            continue;
        };
        let positions: Vec<[f32; 3]> = positions.collect();
        let normals: Option<Vec<[f32; 3]>> = reader.read_normals().map(|n| n.collect());
        let uvs: Option<Vec<[f32; 2]>> = reader.read_tex_coords(0).map(|t| t.into_f32().collect());
        let colors: Option<Vec<[u8; 4]>> =
            reader.read_colors(0).map(|c| c.into_rgba_u8().collect());
        let mut indices: Vec<u32> = match reader.read_indices() {
            Some(i) => i.into_u32().collect(),
            None => (0..positions.len() as u32).collect(),
        };
        let pbr = primitive.material().pbr_metallic_roughness();
        let factor = pbr.base_color_factor();
        if let Some(info) = pbr.base_color_texture() {
            let index = info.texture().source().index();
            match *texture_index {
                None => *texture_index = Some(index),
                Some(first) if first != index => out
                    .notes
                    .push("more than one base colour texture: only the first is used".into()),
                _ => {}
            }
            if info.tex_coord() != 0 {
                out.notes.push("only UV set 0 is supported".into());
            }
        }
        let tint = factor.map(|c| (c.clamp(0.0, 1.0) * 255.0).round() as u8);
        // (the studio writes the same number in all three channels; with a coloured one the brightest counts)
        let emissive = primitive
            .material()
            .emissive_factor()
            .into_iter()
            .fold(0.0f32, f32::max)
            .clamp(0.0, 1.0);
        let base = out.vertices.len() as u32;
        let mut verts: Vec<MeshVertex> = (0..positions.len())
            .map(|i| {
                let p = world.transform_point3(Vec3::from(positions[i]));
                let n = normals
                    .as_ref()
                    .map(|n| (normal_matrix * Vec3::from(n[i])).normalize_or_zero())
                    .unwrap_or(Vec3::Y);
                let c = colors.as_ref().map(|c| c[i]).unwrap_or([255; 4]);
                let mul = |a: u8, b: u8| ((a as u16 * b as u16 + 127) / 255) as u8;
                MeshVertex {
                    position: p.to_array(),
                    normal: n.to_array(),
                    color: [
                        mul(c[0], tint[0]),
                        mul(c[1], tint[1]),
                        mul(c[2], tint[2]),
                        mul(c[3], tint[3]),
                    ],
                    uv: uvs.as_ref().map(|u| u[i]).unwrap_or([0.0, 0.0]),
                    emissive,
                }
            })
            .collect();
        if normals.is_none() {
            // Flat shading: give every triangle its own vertices and face normal.
            let mut flat = Vec::with_capacity(indices.len());
            for tri in indices.as_chunks::<3>().0.iter() {
                let [a, b, c] = [tri[0], tri[1], tri[2]].map(|i| verts[i as usize]);
                let n = (Vec3::from(b.position) - Vec3::from(a.position))
                    .cross(Vec3::from(c.position) - Vec3::from(a.position))
                    .normalize_or_zero();
                for mut v in [a, b, c] {
                    v.normal = n.to_array();
                    flat.push(v);
                }
            }
            verts = flat;
            indices = (0..verts.len() as u32).collect();
        }
        out.vertices.extend(verts);
        out.indices.extend(indices.iter().map(|i| i + base));
    }
}

/// One node of a model: where it sits in its parent and the triangles that move with it.
pub struct Part {
    pub name: String,
    /// Index of the parent part (parents always come before their children).
    pub parent: Option<usize>,
    /// The node's own transform in its parent, as authored.
    pub rest: Mat4,
    /// Triangles in the part's own space (so the part can be turned about its pivot); `None` for an empty node.
    pub mesh: Option<MeshData>,
    /// Set when `mesh` bends with other parts: its triangles are in model space, as at rest.
    pub skin: Option<Skin>,
}

/// One vertex's joints (numbers within the skin) and their weights.
pub type Influence = ([u16; 4], [f32; 4]);

/// How a mesh follows the parts it hangs on (glTF skin): up to four joints per vertex.
pub struct Skin {
    /// The part index of each joint.
    pub joints: Vec<usize>,
    /// Each joint's inverse rest matrix (model space to the joint's space).
    pub inverse_bind: Vec<Mat4>,
    /// Per vertex: joint numbers (into `joints`) and their weights.
    pub influences: Vec<Influence>,
}

impl Skin {
    /// The mesh's vertices when the parts are at `world` (each part's place in the model, indexed like the parts).
    pub fn pose(&self, bind: &[MeshVertex], world: &[Mat4]) -> Vec<MeshVertex> {
        let joint: Vec<Mat4> = self
            .joints
            .iter()
            .zip(&self.inverse_bind)
            .map(|(&part, &ibm)| world.get(part).copied().unwrap_or(Mat4::IDENTITY) * ibm)
            .collect();
        bind.iter()
            .zip(&self.influences)
            .map(|(v, (j, w))| {
                let mut m = Mat4::ZERO;
                let mut total = 0.0;
                for k in 0..4 {
                    if let (true, Some(&jm)) = (w[k] > 0.0, joint.get(j[k] as usize)) {
                        m += jm * w[k];
                        total += w[k];
                    }
                }
                if total <= 0.0 {
                    return *v;
                }
                let n = (Mat3::from_mat4(m) * Vec3::from(v.normal)).normalize_or_zero();
                MeshVertex {
                    position: m.transform_point3(Vec3::from(v.position)).to_array(),
                    normal: n.to_array(),
                    ..*v
                }
            })
            .collect()
    }
}

/// Which transform of a part a keyframe track drives.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClipPath {
    Translation,
    Rotation,
    Scale,
}

/// Keyframes for one transform of one part. Values are xyz (w unused) or an xyzw quaternion.
pub struct Channel {
    pub part: usize,
    pub path: ClipPath,
    /// Hold each value until the next key instead of blending.
    pub step: bool,
    pub times: Vec<f32>,
    pub values: Vec<[f32; 4]>,
}

/// A named animation: tracks that move parts over `duration` seconds.
pub struct Clip {
    pub name: String,
    pub duration: f32,
    pub channels: Vec<Channel>,
}

/// What a clip says one part looks like at an instant; anything it does not animate stays as authored.
#[derive(Clone, Copy, Default)]
pub struct PartPose {
    pub translation: Option<Vec3>,
    pub rotation: Option<Quat>,
    pub scale: Option<Vec3>,
}

impl Clip {
    /// The time a clip is read at: wrapped for looping clips, held at the ends otherwise.
    pub fn local_time(&self, t: f32, looped: bool) -> f32 {
        if !t.is_finite() {
            return 0.0;
        }
        if self.duration <= 0.0 {
            0.0
        } else if looped {
            t.rem_euclid(self.duration)
        } else {
            t.clamp(0.0, self.duration)
        }
    }

    /// The pose of every part (indexed like the model's parts) at time `t`.
    pub fn pose(&self, t: f32, looped: bool, part_count: usize) -> Vec<PartPose> {
        let t = self.local_time(t, looped);
        let mut out = vec![PartPose::default(); part_count];
        for c in &self.channels {
            let Some(pose) = out.get_mut(c.part) else {
                continue;
            };
            let v = c.sample(t);
            match c.path {
                ClipPath::Translation => pose.translation = Some(Vec3::new(v[0], v[1], v[2])),
                ClipPath::Scale => pose.scale = Some(Vec3::new(v[0], v[1], v[2])),
                ClipPath::Rotation => {
                    pose.rotation = Some(Quat::from_xyzw(v[0], v[1], v[2], v[3]).normalize())
                }
            }
        }
        out
    }
}

/// Several poses mixed by weight: what a character looks like part way between walking and running, or while one animation
/// is fading into another. `rests` is each part's authored (scale, rotation, translation); a clip that does not animate a
/// part counts as that rest for the part. Weights need not add up to one (they are divided by their sum); a part that no pose
/// animates stays as authored (all `None`). Rotations are mixed along the short way round.
pub fn blend_poses(rests: &[(Vec3, Quat, Vec3)], layers: &[(Vec<PartPose>, f32)]) -> Vec<PartPose> {
    let total: f32 = layers.iter().map(|l| l.1.max(0.0)).sum();
    let mut out = vec![PartPose::default(); rests.len()];
    if total <= 0.0 {
        return out;
    }
    for (i, &(s0, r0, t0)) in rests.iter().enumerate() {
        let pick = |f: fn(&PartPose) -> bool| layers.iter().any(|l| l.0.get(i).is_some_and(f));
        if pick(|p| p.translation.is_some()) {
            let mut v = Vec3::ZERO;
            for (poses, w) in layers {
                v += poses.get(i).and_then(|p| p.translation).unwrap_or(t0) * (w.max(0.0) / total);
            }
            out[i].translation = Some(v);
        }
        if pick(|p| p.scale.is_some()) {
            let mut v = Vec3::ZERO;
            for (poses, w) in layers {
                v += poses.get(i).and_then(|p| p.scale).unwrap_or(s0) * (w.max(0.0) / total);
            }
            out[i].scale = Some(v);
        }
        if pick(|p| p.rotation.is_some()) {
            let mut q = Vec4::ZERO;
            let mut reference: Option<Quat> = None;
            for (poses, w) in layers {
                let r = poses.get(i).and_then(|p| p.rotation).unwrap_or(r0);
                let reference = *reference.get_or_insert(r);
                let sign = if r.dot(reference) < 0.0 { -1.0 } else { 1.0 };
                q += Vec4::from(r) * (sign * w.max(0.0) / total);
            }
            out[i].rotation = Some(Quat::from_vec4(q).normalize());
        }
    }
    out
}

/// Lays `overlay` over `base` on the parts `mask` names (and nothing else), by `amount` (0 leaves the base alone, 1 replaces it): a
/// character that runs with the legs of the run clip and the arms of an aiming clip. What the overlay does not animate of a part
/// is left as it is; a part the base did not animate is taken from `rests` to mix with.
pub fn overlay_poses(
    rests: &[(Vec3, Quat, Vec3)],
    base: &[PartPose],
    overlay: &[PartPose],
    mask: &[bool],
    amount: f32,
) -> Vec<PartPose> {
    let amount = amount.clamp(0.0, 1.0);
    let mut out: Vec<PartPose> = base.to_vec();
    out.resize(rests.len(), PartPose::default());
    for (i, &(s0, r0, t0)) in rests.iter().enumerate() {
        if !mask.get(i).copied().unwrap_or(false) {
            continue;
        }
        let Some(top) = overlay.get(i) else {
            continue;
        };
        if let Some(t) = top.translation {
            out[i].translation = Some(out[i].translation.unwrap_or(t0).lerp(t, amount));
        }
        if let Some(sc) = top.scale {
            out[i].scale = Some(out[i].scale.unwrap_or(s0).lerp(sc, amount));
        }
        if let Some(r) = top.rotation {
            out[i].rotation = Some(out[i].rotation.unwrap_or(r0).slerp(r, amount).normalize());
        }
    }
    out
}

/// Adds `delta` (a pose measured from the parts' authored rests: how far the clip turns, moves and scales each part away from its
/// rest) to `base`, by `amount`, on the parts `mask` names (all of them when `mask` is empty): a breathing or a lean laid over any
/// walk or run. A part the base did not animate starts from its rest.
pub fn additive_poses(
    rests: &[(Vec3, Quat, Vec3)],
    base: &[PartPose],
    delta: &[PartPose],
    mask: Option<&[bool]>,
    amount: f32,
) -> Vec<PartPose> {
    let mut out: Vec<PartPose> = base.to_vec();
    out.resize(rests.len(), PartPose::default());
    for (i, &(s0, r0, t0)) in rests.iter().enumerate() {
        if mask.is_some_and(|m| !m.get(i).copied().unwrap_or(false)) {
            continue;
        }
        let Some(top) = delta.get(i) else {
            continue;
        };
        if let Some(t) = top.translation {
            out[i].translation = Some(out[i].translation.unwrap_or(t0) + (t - t0) * amount);
        }
        if let Some(sc) = top.scale {
            let ratio = Vec3::new(
                sc.x / s0.x.max(1e-6),
                sc.y / s0.y.max(1e-6),
                sc.z / s0.z.max(1e-6),
            );
            let factor = Vec3::ONE.lerp(ratio, amount);
            out[i].scale = Some(out[i].scale.unwrap_or(s0) * factor);
        }
        if let Some(r) = top.rotation {
            let turn = r * r0.conjugate();
            let part = Quat::IDENTITY.slerp(turn, amount);
            out[i].rotation = Some((part * out[i].rotation.unwrap_or(r0)).normalize());
        }
    }
    out
}

impl Channel {
    fn sample(&self, t: f32) -> [f32; 4] {
        let n = self.times.len();
        if n == 0 {
            return [0.0, 0.0, 0.0, 1.0];
        }
        if n == 1 || t <= self.times[0] {
            return self.values[0];
        }
        if t >= self.times[n - 1] {
            return self.values[n - 1];
        }
        // The last key at or before t.
        let i = self.times.partition_point(|&k| k <= t) - 1;
        let (a, b) = (self.values[i], self.values[i + 1]);
        if self.step {
            return a;
        }
        let span = self.times[i + 1] - self.times[i];
        let f = if span > 0.0 {
            (t - self.times[i]) / span
        } else {
            0.0
        };
        if self.path == ClipPath::Rotation {
            let q = Quat::from_xyzw(a[0], a[1], a[2], a[3])
                .normalize()
                .slerp(Quat::from_xyzw(b[0], b[1], b[2], b[3]).normalize(), f);
            return q.to_array();
        }
        std::array::from_fn(|k| a[k] + (b[k] - a[k]) * f)
    }
}

/// A model as parts plus its animation clips.
pub struct ModelParts {
    pub parts: Vec<Part>,
    pub clips: Vec<Clip>,
    /// What a car or a character bumps into, as circles `[x, z, radius]` on the ground in the model's own frame (metres,
    /// x across, z forward, before any scale the game draws it with). The studio writes them as the scene's
    /// `extras.nova.colliders`.
    pub colliders: Vec<[f32; 3]>,
    /// Capsules `[ax, az, bx, bz, radius]`: a segment from (ax, az) to (bx, bz) made `radius` thick (`extras.nova.capsules`).
    pub capsules: Vec<[f32; 5]>,
    /// Boxes `[x, z, half_width, half_length, turn]` (`extras.nova.boxes`): centred on (x, z), `half_width` across and
    /// `half_length` along the model's z axis, turned by `turn` radians.
    pub boxes: Vec<[f32; 5]>,
    /// How big the model is drawn by default: `extras.nova.scale` (1 when absent). A skinned model cannot be resized by its geometry (the skeleton and
    /// the animations would not follow), so the importer script writes this instead and the game multiplies its `scale` by it.
    pub scale: f32,
}

/// The default drawing scale of a glTF's default scene (see [`ModelParts::scale`]).
fn read_scale(scene: &gltf::Scene) -> f32 {
    scene
        .extras()
        .as_ref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw.get()).ok())
        .and_then(|v| v["nova"]["scale"].as_f64())
        .map_or(1.0, |s| (s as f32).clamp(0.01, 100.0))
}

/// The list `extras.nova.<key>` of a glTF's default scene, each entry a list of `N` finite numbers; malformed entries and
/// those `ok` refuses (radii not above zero) are skipped.
fn read_shapes<const N: usize>(
    scene: &gltf::Scene,
    key: &str,
    ok: impl Fn(&[f32; N]) -> bool,
) -> Vec<[f32; N]> {
    let Some(raw) = scene.extras() else {
        return Vec::new();
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw.get()) else {
        return Vec::new();
    };
    v["nova"][key]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| {
            let c = c.as_array()?;
            let mut out = [0.0f32; N];
            for (i, slot) in out.iter_mut().enumerate() {
                let n = c.get(i)?.as_f64()? as f32;
                if !n.is_finite() {
                    return None;
                }
                *slot = n;
            }
            ok(&out).then_some(out)
        })
        .collect()
}

/// Reads a glTF as a tree of parts, for models whose pieces move on their own (wheels, doors, arms).
pub fn import_parts(bytes: &[u8]) -> Result<ModelParts, String> {
    let (document, buffers, images) =
        gltf::import_slice(bytes).map_err(|e| format!("glTF import failed: {e}"))?;
    let scene = document
        .default_scene()
        .or_else(|| document.scenes().next())
        .ok_or("glTF has no scene")?;
    let mut parts: Vec<Part> = Vec::new();
    let mut by_node: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
    let mut used = std::collections::HashSet::new();
    let mut pending_skins = Vec::new();
    // Depth first, parents before children, siblings in file order.
    let mut roots: Vec<gltf::Node> = scene.nodes().collect();
    roots.reverse();
    let mut stack: Vec<(gltf::Node, Option<usize>)> =
        roots.into_iter().map(|n| (n, None)).collect();
    while let Some((node, parent)) = stack.pop() {
        let mut name = node
            .name()
            .filter(|n| !n.trim().is_empty())
            .map_or_else(|| format!("part{}", node.index()), str::to_string);
        if !used.insert(name.clone()) {
            name = format!("{name}_{}", node.index());
            used.insert(name.clone());
        }
        let mut mesh = None;
        let mut skin_source = None;
        if let Some(source) = node.mesh() {
            let mut data = MeshData::default();
            let mut texture: Option<usize> = None;
            append_mesh(&mut data, &source, Mat4::IDENTITY, &buffers, &mut texture);
            if !data.vertices.is_empty() {
                if let Some(index) = texture {
                    let image = &images[index];
                    data.texture = Some(Image {
                        width: image.width,
                        height: image.height,
                        rgba: to_rgba(image)?,
                    });
                }
                if let Some(skin) = node.skin() {
                    let influences = read_influences(&source, &buffers);
                    match influences {
                        Some(i) if i.len() == data.vertices.len() => skin_source = Some((skin, i)),
                        _ => {}
                    }
                }
                mesh = Some(data);
            }
        }
        let index = parts.len();
        if let Some((skin, influences)) = skin_source {
            let reader = skin.reader(|b| Some(&buffers[b.index()]));
            let joint_nodes: Vec<usize> = skin.joints().map(|j| j.index()).collect();
            let inverse_bind = reader
                .read_inverse_bind_matrices()
                .map(|m| m.map(|a| Mat4::from_cols_array_2d(&a)).collect())
                .unwrap_or_else(|| vec![Mat4::IDENTITY; joint_nodes.len()]);
            pending_skins.push((index, joint_nodes, inverse_bind, influences));
        }
        by_node.insert(node.index(), index);
        parts.push(Part {
            name,
            parent,
            rest: Mat4::from_cols_array_2d(&node.transform().matrix()),
            mesh,
            skin: None,
        });
        let mut children: Vec<gltf::Node> = node.children().collect();
        children.reverse();
        for child in children {
            stack.push((child, Some(index)));
        }
    }
    if parts.iter().all(|p| p.mesh.is_none()) {
        return Err("glTF contains no triangle geometry".into());
    }
    // Joints are nodes that may come after the skinned node, so their parts are looked up now.
    for (part, joint_nodes, inverse_bind, influences) in pending_skins {
        let joints: Option<Vec<usize>> = joint_nodes
            .iter()
            .map(|n| by_node.get(n).copied())
            .collect();
        if let Some(joints) = joints.filter(|j| j.len() == inverse_bind.len() && !j.is_empty()) {
            parts[part].skin = Some(Skin {
                joints,
                inverse_bind,
                influences,
            });
        }
    }
    let mut clips: Vec<Clip> = Vec::new();
    for (i, animation) in document.animations().enumerate() {
        let mut name = animation
            .name()
            .filter(|n| !n.trim().is_empty())
            .map_or_else(|| format!("clip{i}"), str::to_string);
        if clips.iter().any(|c| c.name == name) {
            name = format!("{name}_{i}");
        }
        let mut channels = Vec::new();
        for channel in animation.channels() {
            let Some(&part) = by_node.get(&channel.target().node().index()) else {
                continue;
            };
            let path = match channel.target().property() {
                gltf::animation::Property::Translation => ClipPath::Translation,
                gltf::animation::Property::Rotation => ClipPath::Rotation,
                gltf::animation::Property::Scale => ClipPath::Scale,
                gltf::animation::Property::MorphTargetWeights => continue,
            };
            let reader = channel.reader(|b| Some(&buffers[b.index()]));
            let (Some(inputs), Some(outputs)) = (reader.read_inputs(), reader.read_outputs())
            else {
                continue;
            };
            let times: Vec<f32> = inputs.collect();
            let mut values: Vec<[f32; 4]> = match outputs {
                gltf::animation::util::ReadOutputs::Translations(v) => {
                    v.map(|a| [a[0], a[1], a[2], 0.0]).collect()
                }
                gltf::animation::util::ReadOutputs::Scales(v) => {
                    v.map(|a| [a[0], a[1], a[2], 0.0]).collect()
                }
                gltf::animation::util::ReadOutputs::Rotations(v) => v.into_f32().collect(),
                gltf::animation::util::ReadOutputs::MorphTargetWeights(_) => continue,
            };
            let interpolation = channel.sampler().interpolation();
            if interpolation == gltf::animation::Interpolation::CubicSpline {
                // Each key carries in-tangent, value, out-tangent; the tangents are dropped (blended linearly).
                values = values.as_chunks::<3>().0.iter().map(|c| c[1]).collect();
            }
            if times.is_empty() || values.len() != times.len() {
                continue;
            }
            channels.push(Channel {
                part,
                path,
                step: interpolation == gltf::animation::Interpolation::Step,
                times,
                values,
            });
        }
        let duration = channels
            .iter()
            .filter_map(|c| c.times.last().copied())
            .fold(0.0f32, f32::max);
        clips.push(Clip {
            name,
            duration,
            channels,
        });
    }
    let colliders = read_shapes(&scene, "colliders", |c: &[f32; 3]| c[2] > 0.0);
    let capsules = read_shapes(&scene, "capsules", |c: &[f32; 5]| c[4] > 0.0);
    let boxes = read_shapes(&scene, "boxes", |c: &[f32; 5]| c[2] > 0.0 && c[3] > 0.0);
    let scale = read_scale(&scene);
    Ok(ModelParts {
        parts,
        clips,
        colliders,
        capsules,
        boxes,
        scale,
    })
}

pub fn import_glb(bytes: &[u8]) -> Result<MeshData, String> {
    let (document, buffers, images) =
        gltf::import_slice(bytes).map_err(|e| format!("glTF import failed: {e}"))?;
    let mut out = MeshData::default();
    if document.animations().count() > 0 {
        out.notes.push("animations are ignored".into());
    }
    if document.skins().count() > 0 {
        out.notes.push("skins/bones are ignored".into());
    }
    for name in document.extensions_used() {
        out.notes.push(format!("extension {name} is ignored"));
    }
    let scene = document
        .default_scene()
        .or_else(|| document.scenes().next())
        .ok_or("glTF has no scene")?;
    let mut texture_index: Option<usize> = None;
    let mut stack: Vec<(gltf::Node, Mat4)> = scene.nodes().map(|n| (n, Mat4::IDENTITY)).collect();
    while let Some((node, parent)) = stack.pop() {
        let world = parent * Mat4::from_cols_array_2d(&node.transform().matrix());
        for child in node.children() {
            stack.push((child, world));
        }
        let Some(mesh) = node.mesh() else { continue };
        append_mesh(&mut out, &mesh, world, &buffers, &mut texture_index);
    }
    if out.vertices.is_empty() {
        return Err("glTF contains no triangle geometry".into());
    }
    if let Some(index) = texture_index {
        let data = &images[index];
        out.texture = Some(Image {
            width: data.width,
            height: data.height,
            rgba: to_rgba(data)?,
        });
    }
    out.notes.sort();
    out.notes.dedup();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CAR: &[u8] = include_bytes!("../assets/spike/car.glb");

    #[test]
    fn imports_the_spike_car_with_texture_and_no_notes() {
        let mesh = import_glb(CAR).expect("car imports");
        assert_eq!(mesh.vertices.len(), 264);
        assert_eq!(mesh.indices.len(), 132 * 3);
        assert!(
            mesh.indices
                .iter()
                .all(|&i| (i as usize) < mesh.vertices.len())
        );
        let texture = mesh.texture.expect("palette texture");
        assert_eq!((texture.width, texture.height), (48, 8));
        assert_eq!(texture.rgba.len(), 48 * 8 * 4);
        assert!(mesh.notes.is_empty(), "unexpected notes: {:?}", mesh.notes);
    }

    #[test]
    fn rejects_garbage_with_a_clear_error() {
        let error = import_glb(b"not a glb").err().expect("must fail");
        assert!(error.starts_with("glTF import failed"), "{error}");
    }

    #[test]
    fn ground_is_two_triangles() {
        let ground = MeshData::ground(10.0, [0.5, 0.5]);
        assert_eq!((ground.vertices.len(), ground.indices.len()), (4, 6));
    }
}

#[cfg(test)]
mod studio_model_tests {
    use super::*;

    /// `studio/src/lib/model-doc.test.ts` pins this file to what the studio's exporter writes for its
    /// sample model: a 16-unit body cube and a rotated, offset wheel cube, at 1/16 scale.
    #[test]
    fn studio_shapes_load_and_wind_outwards() {
        // Eight shapes from the studio's exporter (studio/src/lib/model-shapes.test.ts): box, wedge, pyramid,
        // cylinder, cone, sphere, a turned box and an extruded mesh, at 1/16 scale.
        let mesh = import_glb(include_bytes!("../tests/fixtures/studio_model_shapes.glb")).unwrap();
        assert!(mesh.notes.is_empty(), "{:?}", mesh.notes);
        assert_eq!(mesh.vertices.len(), 314);
        assert_eq!(mesh.indices.len(), 148 * 3);
        // Every triangle winds outwards, so the volume the triangles enclose is the sum of the solids' volumes.
        let mut six_volumes = 0.0f64;
        for t in mesh.indices.chunks(3) {
            let p = |i: u32| {
                let v = mesh.vertices[i as usize].position;
                glam::DVec3::new(v[0] as f64, v[1] as f64, v[2] as f64)
            };
            six_volumes += p(t[0]).dot(p(t[1]).cross(p(t[2])));
        }
        let units = six_volumes / 6.0 * 16.0f64.powi(3);
        assert!((units - 2907.39778661252).abs() < 0.05, "volume {units}");
        for v in &mesh.vertices {
            let n = Vec3::from(v.normal);
            assert!((n.length() - 1.0).abs() < 1e-4, "unit normals, got {n:?}");
        }
        assert!(
            mesh.vertices.iter().any(|v| v.color == [255, 136, 0, 255]),
            "the cone's colour survived"
        );
    }

    #[test]
    fn studio_textures_reach_the_vertices() {
        // A painted box (top face green, north face red, the rest baked white) and a plain #336699 box, from the
        // studio's exporter (studio/src/lib/model-texture.test.ts). The picture is 32x32 plus a white row.
        let mesh = import_glb(include_bytes!(
            "../tests/fixtures/studio_model_textured.glb"
        ))
        .unwrap();
        assert!(mesh.notes.is_empty(), "{:?}", mesh.notes);
        let tex = mesh.texture.as_ref().expect("the embedded texture");
        assert_eq!((tex.width, tex.height), (32, 33));
        let texel = |x: u32, y: u32| {
            let i = ((y * tex.width + x) * 4) as usize;
            [
                tex.rgba[i],
                tex.rgba[i + 1],
                tex.rgba[i + 2],
                tex.rgba[i + 3],
            ]
        };
        assert!((0..32).all(|x| texel(x, 32) == [255; 4]), "the white row");
        assert_eq!(mesh.vertices.len(), 48);
        // Each face is four consecutive vertices; the middle of its texture coordinates is a texel centre.
        for (face, quad) in mesh.vertices.chunks(4).enumerate() {
            let mid = quad.iter().fold([0.0f32; 2], |a, v| {
                [a[0] + v.uv[0] / 4.0, a[1] + v.uv[1] / 4.0]
            });
            let sampled = texel(
                ((mid[0] * 32.0) as u32).min(31),
                ((mid[1] * 33.0) as u32).min(32),
            );
            let normal = Vec3::from(quad[0].normal);
            if face < 6 {
                let want = if normal.y > 0.9 {
                    [0, 255, 0, 255]
                } else if normal.z < -0.9 {
                    [255, 0, 0, 255]
                } else {
                    [255, 255, 255, 255]
                };
                assert_eq!(
                    sampled, want,
                    "painted box face {face} with normal {normal:?}"
                );
                assert!(quad.iter().all(|v| v.color == [255, 255, 255, 255]));
            } else {
                assert_eq!(sampled, [255; 4], "the plain box samples the white texel");
                assert!(quad.iter().all(|v| v.color == [51, 102, 153, 255]));
            }
        }
    }

    #[test]
    fn studio_models_load_with_the_expected_shape() {
        let mesh = import_glb(include_bytes!("../tests/fixtures/studio_model.glb")).unwrap();
        assert!(mesh.notes.is_empty(), "{:?}", mesh.notes);
        assert_eq!(mesh.vertices.len(), 48, "two cubes of 24 vertices");
        assert_eq!(mesh.indices.len(), 72, "24 triangles");
        let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
        for v in &mesh.vertices {
            for a in 0..3 {
                lo[a] = lo[a].min(v.position[a]);
                hi[a] = hi[a].max(v.position[a]);
            }
            let n = Vec3::from(v.normal);
            assert!((n.length() - 1.0).abs() < 1e-4, "unit normals, got {n:?}");
        }
        // Body: x and z from -0.5 to 0.5, y 0 to 1. Wheel (rotated 90 degrees about z, at (6, 2, 8)/16):
        // x 4/16 to 8/16, y 0 to 4/16, z 7/16 to 9/16, so the whole model reaches z = 9/16.
        let close = |a: f32, b: f32| (a - b).abs() < 1e-4;
        assert!(close(lo[0], -0.5) && close(hi[0], 0.5), "{lo:?} {hi:?}");
        assert!(close(lo[1], 0.0) && close(hi[1], 1.0), "{lo:?} {hi:?}");
        assert!(
            close(lo[2], -0.5) && close(hi[2], 9.0 / 16.0),
            "{lo:?} {hi:?}"
        );
        let dark = mesh
            .vertices
            .iter()
            .filter(|v| v.color == [32, 32, 32, 255])
            .count();
        assert_eq!(dark, 24, "the wheel's dark colour survived");
        // Triangles face outward: for every triangle the geometric normal agrees with the stored one.
        for t in mesh.indices.chunks(3) {
            let [a, b, c] = [t[0], t[1], t[2]].map(|i| &mesh.vertices[i as usize]);
            let geometric = (Vec3::from(b.position) - Vec3::from(a.position))
                .cross(Vec3::from(c.position) - Vec3::from(a.position));
            assert!(
                geometric.dot(Vec3::from(a.normal)) > 0.0,
                "winding disagrees with the normal"
            );
        }
    }

    fn rest() -> Vec<(Vec3, Quat, Vec3)> {
        vec![(Vec3::ONE, Quat::IDENTITY, Vec3::new(0.0, 1.0, 0.0)); 2]
    }

    fn pose(y: Option<f32>, turn: Option<f32>) -> Vec<PartPose> {
        vec![
            PartPose {
                translation: y.map(|y| Vec3::new(0.0, y, 0.0)),
                rotation: turn.map(Quat::from_rotation_z),
                scale: None,
            },
            PartPose::default(),
        ]
    }

    #[test]
    fn poses_are_mixed_by_weight_and_normalised() {
        let a = pose(Some(0.0), Some(0.0));
        let b = pose(Some(4.0), Some(1.0));
        let mixed = blend_poses(&rest(), &[(a.clone(), 1.0), (b.clone(), 3.0)]);
        assert!(
            (mixed[0].translation.unwrap().y - 3.0).abs() < 1e-5,
            "a quarter of 0 and three of 4"
        );
        let (axis, angle) = mixed[0].rotation.unwrap().to_axis_angle();
        assert!(
            (axis.z.abs() - 1.0).abs() < 1e-4 && (angle - 0.75).abs() < 0.02,
            "turned about 0.75 rad: {angle}"
        );
        // weights of 2 and 6 are the same as 1 and 3
        let same = blend_poses(&rest(), &[(a, 2.0), (b, 6.0)]);
        assert!((same[0].translation.unwrap().y - 3.0).abs() < 1e-5);
        // a part nothing animates stays as authored
        assert!(mixed[1].translation.is_none() && mixed[1].rotation.is_none());
    }

    #[test]
    fn a_clip_that_leaves_a_part_alone_counts_as_its_rest_and_rotations_take_the_short_way() {
        // one pose raises the part, the other does not animate it: halfway between 4 and the rest, 1
        let mixed = blend_poses(
            &rest(),
            &[(pose(Some(4.0), None), 1.0), (pose(None, None), 1.0)],
        );
        assert!((mixed[0].translation.unwrap().y - 2.5).abs() < 1e-5);
        // a turn of +359 degrees and one of 1 degree are 2 degrees apart: the middle is about 0, not 180
        let a = pose(None, Some(359f32.to_radians()));
        let b = pose(None, Some(1f32.to_radians()));
        let mixed = blend_poses(&rest(), &[(a, 1.0), (b, 1.0)]);
        assert!(mixed[0].rotation.unwrap().angle_between(Quat::IDENTITY) < 0.02);
        // no weight, no pose
        let none = blend_poses(&rest(), &[(pose(Some(1.0), None), 0.0)]);
        assert!(none[0].translation.is_none());
    }
}
