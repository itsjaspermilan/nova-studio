//! Static glTF/GLB import for the supported subset.
//!
//! Supported: triangle meshes in the default scene (node transforms applied),
//! positions, normals (flat normals are generated when absent), one UV set,
//! COLOR_0, base colour factor, and a single base colour texture. Everything else
//! is not silently dropped: it is listed in [`MeshData::notes`] so the studio and
//! the log can say what was ignored.

use bytemuck::{Pod, Zeroable};
use glam::{Mat3, Mat4, Vec3};

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
            let uvs: Option<Vec<[f32; 2]>> =
                reader.read_tex_coords(0).map(|t| t.into_f32().collect());
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
                match texture_index {
                    None => texture_index = Some(index),
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
