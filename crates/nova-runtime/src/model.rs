//! Static glTF/GLB import for the supported subset.
//!
//! Supported: triangle meshes in the default scene (node transforms applied),
//! positions, normals (flat normals are generated when absent), one UV set,
//! COLOR_0, base colour factor, and a single base colour texture. Everything else
//! is not silently dropped: it is listed in [`MeshData::notes`] so the studio and
//! the log can say what was ignored.

use bytemuck::{Pod, Zeroable};
use glam::{Mat3, Mat4, Quat, Vec3};

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct MeshVertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
    pub color: [u8; 4],
    pub uv: [f32; 2],
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
                mesh = Some(data);
            }
        }
        let index = parts.len();
        by_node.insert(node.index(), index);
        parts.push(Part {
            name,
            parent,
            rest: Mat4::from_cols_array_2d(&node.transform().matrix()),
            mesh,
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
    Ok(ModelParts { parts, clips })
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
}
