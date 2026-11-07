//! `nova.billboard`: a picture in the world that always faces the camera (soft dust, spray, snow, sparks, smoke).
//!
//! The pictures are the images in `sprites/fx/` (a PNG, or a PNG cut into frames by a `.sprite.json` beside it). Each frame is a
//! unit quad with its own texture window, drawn blended (after the solid things, depth-tested, not writing depth) and unlit.

use super::*;
use crate::model::{Image, MeshData, MeshVertex};

/// Where the pictures a billboard can draw live: `sprites/fx/<name>.png`.
pub(super) const FOLDER: &str = "sprites/fx/";

pub(super) fn mesh_key(image: &str, frame: u32) -> String {
    format!("__fx:{image}#{frame}")
}

/// A quad one across, facing +z and -z, showing the window `uv` (u0, v0, u1, v1) of `image`. The vertex alpha of 254 is what
/// makes the renderer draw it blended.
pub(super) fn quad_mesh(image: &Image, uv: [f32; 4]) -> MeshData {
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    for side in [1.0f32, -1.0] {
        let base = vertices.len() as u32;
        for (sx, sy) in [(-0.5f32, -0.5f32), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)] {
            let (u, v) = (
                if sx < 0.0 { uv[0] } else { uv[2] },
                if sy < 0.0 { uv[3] } else { uv[1] },
            );
            vertices.push(MeshVertex {
                position: [sx * side, sy, 0.0],
                normal: [0.0, 0.0, side],
                color: [255, 255, 255, 254],
                uv: [u, v],
                emissive: 1.0,
            });
        }
        if side > 0.0 {
            indices.extend([0, 1, 2, 0, 2, 3].map(|i| base + i));
        } else {
            indices.extend([0, 2, 1, 0, 3, 2].map(|i| base + i));
        }
    }
    MeshData {
        vertices,
        indices,
        texture: Some(image.clone()),
        notes: Vec::new(),
    }
}

/// The meshes of every frame of an image: the whole picture, or a window per frame of its sheet.
pub(super) fn frame_meshes(
    image: &Image,
    sheet: Option<&crate::sprite::SpriteDef>,
) -> Vec<MeshData> {
    let (w, h) = (image.width as f32, image.height as f32);
    match sheet {
        None => vec![quad_mesh(image, [0.0, 0.0, 1.0, 1.0])],
        Some(def) => (0..def.frames.max(1))
            .map(|f| {
                let (col, row) = def.cell(f);
                let (x, y) = (
                    (col * def.frame_width) as f32,
                    (row * def.frame_height) as f32,
                );
                quad_mesh(
                    image,
                    [
                        x / w,
                        y / h,
                        (x + def.frame_width as f32) / w,
                        (y + def.frame_height as f32) / h,
                    ],
                )
            })
            .collect(),
    }
}

/// `sprites/fx/puff.png` for `fx/puff`, `puff` or the full path.
fn resolve(sh: &Shared, name: &str) -> Option<(String, u32)> {
    [
        name.to_string(),
        format!("sprites/{name}.png"),
        format!("{FOLDER}{name}.png"),
    ]
    .into_iter()
    .find_map(|id| sh.fx_sprites.get(&id).map(|&n| (id, n)))
}

pub(super) fn install(lua: &Lua, shared: &Rc<RefCell<Shared>>, nova: &Table) -> mlua::Result<()> {
    let s = shared.clone();
    nova.set(
        "billboard",
        lua.create_function(
            move |_, (name, x, y, z, size, opts): (String, f64, f64, f64, f64, Option<Table>)| {
                let mut sh = s.borrow_mut();
                let (id, frames) = resolve(&sh, &name).ok_or_else(|| {
                    let mut known: Vec<&str> = sh.fx_sprites.keys().map(|k| k.as_str()).collect();
                    known.sort_unstable();
                    lua_err(format!(
                        "unknown picture '{name}' for nova.billboard: put a PNG in sprites/fx/ (images there: {})",
                        if known.is_empty() { "none".into() } else { known.join(", ") }
                    ))
                })?;
                let frame = (number_option(&opts, "frame")?.unwrap_or(0.0).max(0.0) as u32).min(frames - 1);
                let Some(&mesh) = sh.mesh_ids.get(&mesh_key(&id, frame)) else {
                    return Ok(());
                };
                let tint = color_option(&opts, "color", [255; 4])?.map(|c| c as f32 / 255.0);
                if tint[3] <= 0.0 {
                    return Ok(());
                }
                // the camera's own axes: the quad lies across the view, whichever way the camera looks
                let cam = sh.camera;
                let forward = (cam.target - cam.eye).normalize_or_zero();
                if forward == Vec3::ZERO {
                    return Ok(());
                }
                let mut right = forward.cross(Vec3::Y);
                if right.length_squared() < 1e-8 {
                    right = Vec3::X;
                }
                let right = right.normalize();
                let up = right.cross(forward);
                let rot = number_option(&opts, "rot")?.unwrap_or(0.0) as f32;
                let (sin, cos) = rot.sin_cos();
                let (right, up) = (right * cos + up * sin, up * cos - right * sin);
                let (w, h) = (
                    number_option(&opts, "w")?.unwrap_or(size) as f32,
                    number_option(&opts, "h")?.unwrap_or(size) as f32,
                );
                let matrix = Mat4::from_cols(
                    (right * w).extend(0.0),
                    (up * h).extend(0.0),
                    (-forward).extend(0.0),
                    Vec3::new(x as f32, y as f32, z as f32).extend(1.0),
                );
                sh.models.push(ModelDraw {
                    casts: false,
                    mesh,
                    instance: ModelInstance {
                        matrix: matrix.to_cols_array_2d(),
                        tint,
                    },
                });
                Ok(())
            },
        )?,
    )?;
    // how many frames a picture has (1 for a plain PNG), so that a script can pick or play them
    let s = shared.clone();
    nova.set(
        "billboard_frames",
        lua.create_function(move |_, name: String| {
            let sh = s.borrow();
            Ok(resolve(&sh, &name).map(|(_, n)| n))
        })?,
    )?;
    Ok(())
}
