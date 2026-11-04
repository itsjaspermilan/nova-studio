//! Light baked into level geometry: boxes cut into small squares whose corners are lit once, at load, by the lamps that can see
//! them (walls stop the light), with the corners and the bottoms of walls darkened a little. The result is one mesh, drawn every
//! frame at no cost per light; what moves (a muzzle flash, a creature's lamp) still lights it live on top.
//!
//! Each corner carries the baked light as a colour (the hue of what lights it, at full strength) and an intensity (how much), which
//! the mesh shader adds to the live light: the picture is the box's colour times (ambient + live lights + baked light).

use crate::model::{MeshData, MeshVertex};
use crate::walls::Walls;

#[derive(Clone, Copy, Debug)]
pub struct BoxSpec {
    pub min: [f32; 3],
    pub max: [f32; 3],
    /// 0 to 1.
    pub color: [f32; 3],
}

#[derive(Clone, Copy, Debug)]
pub struct LightSpec {
    pub pos: [f32; 3],
    pub radius: f32,
    /// 0 to 1.
    pub color: [f32; 3],
    /// How bright it is at its own place (1 is a full white light).
    pub power: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct BakeOptions {
    /// The size of the squares the faces are cut into, in metres: smaller shows light in more detail and makes more of them.
    pub cell: f32,
    /// How dark the corners get, 0 (not at all) to 1.
    pub occlusion: f32,
    /// Faces pointing down at or below this height are left out (the underside of a floor nobody sees).
    pub skip_down_at_or_below: f32,
    /// Faces pointing up at or above this height are left out (the top of a ceiling).
    pub skip_up_at_or_above: f32,
}

impl Default for BakeOptions {
    fn default() -> Self {
        Self {
            cell: 1.0,
            occlusion: 0.5,
            skip_down_at_or_below: f32::NEG_INFINITY,
            skip_up_at_or_above: f32::INFINITY,
        }
    }
}

/// The directions of the horizontal rays that feel for nearby walls.
const AO_RAYS: usize = 8;
const AO_REACH: f32 = 1.3;

fn inside(b: &BoxSpec, p: [f32; 3]) -> bool {
    (0..3).all(|a| p[a] > b.min[a] + 1e-4 && p[a] < b.max[a] - 1e-4)
}

/// Cuts the boxes' faces into squares and lights their corners. Returns the mesh (colours and baked light in the vertices).
pub fn bake(
    boxes: &[BoxSpec],
    lights: &[LightSpec],
    walls: &Walls,
    opts: &BakeOptions,
) -> MeshData {
    let cell = opts.cell.max(0.1);
    let mut vertices: Vec<MeshVertex> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    for (bi, b) in boxes.iter().enumerate() {
        for axis in 0..3usize {
            for dir in [-1.0f32, 1.0] {
                let plane = if dir > 0.0 { b.max[axis] } else { b.min[axis] };
                if axis == 1 {
                    if dir < 0.0 && plane <= opts.skip_down_at_or_below {
                        continue;
                    }
                    if dir > 0.0 && plane >= opts.skip_up_at_or_above {
                        continue;
                    }
                }
                let (ua, va) = match axis {
                    0 => (2usize, 1usize),
                    1 => (0, 2),
                    _ => (0, 1),
                };
                let (su, sv) = (b.max[ua] - b.min[ua], b.max[va] - b.min[va]);
                let (nu, nv) = (
                    ((su / cell).ceil() as usize).max(1),
                    ((sv / cell).ceil() as usize).max(1),
                );
                let mut normal = [0.0f32; 3];
                normal[axis] = dir;
                let at = |i: usize, j: usize| -> [f32; 3] {
                    let mut p = [0.0f32; 3];
                    p[axis] = plane;
                    p[ua] = b.min[ua] + su * i as f32 / nu as f32;
                    p[va] = b.min[va] + sv * j as f32 / nv as f32;
                    p
                };
                // the lit corners of this face, made when a square needs them
                let mut index: Vec<Option<u32>> = vec![None; (nu + 1) * (nv + 1)];
                let mut corner = |i: usize, j: usize, vertices: &mut Vec<MeshVertex>| -> u32 {
                    if let Some(k) = index[j * (nu + 1) + i] {
                        return k;
                    }
                    let p = at(i, j);
                    let (hue, intensity) = light_at(p, normal, lights, walls, boxes, opts);
                    let color = [
                        (b.color[0] * hue[0] * 255.0).round() as u8,
                        (b.color[1] * hue[1] * 255.0).round() as u8,
                        (b.color[2] * hue[2] * 255.0).round() as u8,
                        255,
                    ];
                    vertices.push(MeshVertex {
                        position: p,
                        normal,
                        color,
                        uv: [0.5, 0.5],
                        emissive: intensity,
                    });
                    let k = (vertices.len() - 1) as u32;
                    index[j * (nu + 1) + i] = Some(k);
                    k
                };
                for j in 0..nv {
                    for i in 0..nu {
                        // a square against another box is not seen
                        let (p0, p1) = (at(i, j), at(i + 1, j + 1));
                        let centre = [
                            (p0[0] + p1[0]) * 0.5 + normal[0] * 0.02,
                            (p0[1] + p1[1]) * 0.5 + normal[1] * 0.02,
                            (p0[2] + p1[2]) * 0.5 + normal[2] * 0.02,
                        ];
                        if boxes
                            .iter()
                            .enumerate()
                            .any(|(k, o)| k != bi && inside(o, centre))
                        {
                            continue;
                        }
                        let quad = [
                            corner(i, j, &mut vertices),
                            corner(i + 1, j, &mut vertices),
                            corner(i + 1, j + 1, &mut vertices),
                            corner(i, j + 1, &mut vertices),
                        ];
                        // wound so that the front faces out: the corners go u then v, which is counter-clockwise for some axes and
                        // clockwise for others
                        // (u cross v points along -x, -y and +z for the three axes)
                        let counter = match axis {
                            0 | 1 => dir < 0.0,
                            _ => dir > 0.0,
                        };
                        let order: [usize; 6] = if counter {
                            [0, 1, 2, 0, 2, 3]
                        } else {
                            [0, 2, 1, 0, 3, 2]
                        };
                        indices.extend(order.map(|k| quad[k]));
                    }
                }
            }
        }
    }
    MeshData {
        vertices,
        indices,
        texture: None,
        notes: Vec::new(),
    }
}

/// The baked light at a point of a surface facing `n`: its hue (strongest channel 1) and its intensity.
fn light_at(
    p: [f32; 3],
    n: [f32; 3],
    lights: &[LightSpec],
    walls: &Walls,
    _boxes: &[BoxSpec],
    opts: &BakeOptions,
) -> ([f32; 3], f32) {
    // looked at from a little off the surface, so that it does not find its own wall
    let q = [p[0] + n[0] * 0.06, p[1] + n[1] * 0.06, p[2] + n[2] * 0.06];
    let mut sum = [0.0f32; 3];
    for l in lights {
        let d = [l.pos[0] - q[0], l.pos[1] - q[1], l.pos[2] - q[2]];
        let dist = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        if dist >= l.radius || dist < 1e-4 {
            continue;
        }
        let facing = (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / dist;
        // soft: a face turned half away still gets some, one turned right away none
        let wrap = (facing * 0.5 + 0.5).powi(2);
        if wrap <= 0.0 {
            continue;
        }
        if !walls.line_clear(l.pos[0], l.pos[2], q[0], q[2], l.pos[1], q[1]) {
            continue;
        }
        let fall = (1.0 - dist / l.radius).powi(2);
        let k = l.power * fall * wrap;
        for (total, c) in sum.iter_mut().zip(l.color) {
            *total += c * k;
        }
    }
    // corners: feel for walls close by, level with the point, all round
    let mut near = 0.0f32;
    if opts.occlusion > 0.0 {
        let y = q[1].clamp(0.05, 100.0);
        for r in 0..AO_RAYS {
            let a = r as f32 / AO_RAYS as f32 * std::f32::consts::TAU;
            if let Some(h) = walls.raycast(q[0], q[2], a.cos(), a.sin(), AO_REACH, y, 0.0) {
                near += 1.0 - h.distance / AO_REACH;
            }
        }
    }
    let ao = 1.0 - opts.occlusion * (near / AO_RAYS as f32).min(1.0);
    let peak = sum[0].max(sum[1]).max(sum[2]);
    if peak <= 1e-5 {
        return ([1.0; 3], 0.0);
    }
    ([sum[0] / peak, sum[1] / peak, sum[2] / peak], peak * ao)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A room 8 by 8 and 3 high, a wall box across the middle with no gap (z from 3.8 to 4.2), a lamp in the south half.
    fn scene() -> (Vec<BoxSpec>, Walls) {
        let mut walls = Walls::default();
        let mut boxes = Vec::new();
        let mut wall = |x0: f32, z0: f32, x1: f32, z1: f32| {
            walls.add(x0, z0, x1, z1, 0.0, 3.0);
            boxes.push(BoxSpec {
                min: [x0, 0.0, z0],
                max: [x1, 3.0, z1],
                color: [0.8, 0.8, 0.8],
            });
        };
        wall(-0.2, -0.2, 8.2, 0.0);
        wall(-0.2, 8.0, 8.2, 8.2);
        wall(-0.2, 0.0, 0.0, 8.0);
        wall(8.0, 0.0, 8.2, 8.0);
        wall(0.0, 3.8, 8.0, 4.2);
        boxes.push(BoxSpec {
            min: [-1.0, -0.2, -1.0],
            max: [9.0, 0.0, 9.0],
            color: [0.5, 0.5, 0.5],
        });
        walls.prepare();
        (boxes, walls)
    }

    fn intensity_near(mesh: &MeshData, p: [f32; 3], normal: [f32; 3]) -> f32 {
        mesh.vertices
            .iter()
            .filter(|v| v.normal == normal)
            .min_by(|a, b| {
                let d = |v: &MeshVertex| {
                    (v.position[0] - p[0]).powi(2)
                        + (v.position[1] - p[1]).powi(2)
                        + (v.position[2] - p[2]).powi(2)
                };
                d(a).total_cmp(&d(b))
            })
            .map_or(-1.0, |v| v.emissive)
    }

    fn lamp(x: f32, z: f32) -> LightSpec {
        LightSpec {
            pos: [x, 2.8, z],
            radius: 12.0,
            color: [1.0, 0.9, 0.7],
            power: 1.0,
        }
    }

    #[test]
    fn light_falls_off_with_distance_and_stops_at_walls() {
        let (boxes, walls) = scene();
        let mesh = bake(
            &boxes,
            &[lamp(2.0, 2.0)],
            &walls,
            &BakeOptions {
                occlusion: 0.0,
                ..Default::default()
            },
        );
        // the floor under the lamp is brighter than the floor far from it in the same room
        let under = intensity_near(&mesh, [2.0, 0.0, 2.0], [0.0, 1.0, 0.0]);
        let far = intensity_near(&mesh, [7.0, 0.0, 1.0], [0.0, 1.0, 0.0]);
        assert!(under > far && far > 0.0, "{under} {far}");
        // the floor on the other side of the wall gets nothing
        let behind = intensity_near(&mesh, [2.0, 0.0, 6.0], [0.0, 1.0, 0.0]);
        assert_eq!(behind, 0.0, "light does not go through the wall");
        // the wall's face towards the lamp is lit, its face away from it is not
        let facing = intensity_near(&mesh, [2.0, 1.5, 3.8], [0.0, 0.0, -1.0]);
        let away = intensity_near(&mesh, [2.0, 1.5, 4.2], [0.0, 0.0, 1.0]);
        assert!(facing > 0.0 && away == 0.0, "{facing} {away}");
        // a lamp outside its radius lights nothing
        let none = bake(
            &boxes,
            &[LightSpec {
                radius: 1.0,
                ..lamp(2.0, 2.0)
            }],
            &walls,
            &BakeOptions::default(),
        );
        assert_eq!(intensity_near(&none, [7.0, 0.0, 1.0], [0.0, 1.0, 0.0]), 0.0);
    }

    #[test]
    fn the_colour_of_the_lamp_is_the_hue_and_corners_are_darker() {
        let (boxes, walls) = scene();
        let red = LightSpec {
            color: [1.0, 0.1, 0.1],
            ..lamp(4.0, 2.0)
        };
        let flat = bake(
            &boxes,
            &[red],
            &walls,
            &BakeOptions {
                occlusion: 0.0,
                ..Default::default()
            },
        );
        let v = flat
            .vertices
            .iter()
            .find(|v| v.normal == [0.0, 1.0, 0.0] && v.emissive > 0.0 && v.position[1] == 0.0)
            .expect("a lit floor corner");
        // the box is grey, lit red: the vertex colour is red-ish (red channel full, the others low)
        assert!(
            v.color[0] > v.color[1] * 3 && v.color[0] > 100,
            "{:?}",
            v.color
        );
        // with occlusion, a floor corner next to a wall is darker than the same corner without
        let ao = bake(
            &boxes,
            &[red],
            &walls,
            &BakeOptions {
                occlusion: 0.8,
                ..Default::default()
            },
        );
        let (a, b) = (
            intensity_near(&flat, [1.0, 0.0, 1.0], [0.0, 1.0, 0.0]),
            intensity_near(&ao, [1.0, 0.0, 1.0], [0.0, 1.0, 0.0]),
        );
        assert!(b < a, "next to a wall: {a} without, {b} with");
        let (mid_a, mid_b) = (
            intensity_near(&flat, [4.0, 0.0, 2.0], [0.0, 1.0, 0.0]),
            intensity_near(&ao, [4.0, 0.0, 2.0], [0.0, 1.0, 0.0]),
        );
        assert!(
            (mid_a - mid_b).abs() < mid_a * 0.1,
            "in the open it is much the same: {mid_a} {mid_b}"
        );
    }

    #[test]
    fn hidden_faces_are_left_out_and_triangles_face_out() {
        let (boxes, walls) = scene();
        let all = bake(&boxes, &[], &walls, &BakeOptions::default());
        let trimmed = bake(
            &boxes,
            &[],
            &walls,
            &BakeOptions {
                skip_down_at_or_below: 0.0,
                skip_up_at_or_above: 3.0,
                ..Default::default()
            },
        );
        assert!(
            trimmed.indices.len() < all.indices.len(),
            "{} against {}",
            trimmed.indices.len(),
            all.indices.len()
        );
        // every triangle's winding agrees with the normal its corners carry
        for t in all.indices.chunks(3) {
            let (a, b, c) = (
                all.vertices[t[0] as usize],
                all.vertices[t[1] as usize],
                all.vertices[t[2] as usize],
            );
            let e1 = [
                b.position[0] - a.position[0],
                b.position[1] - a.position[1],
                b.position[2] - a.position[2],
            ];
            let e2 = [
                c.position[0] - a.position[0],
                c.position[1] - a.position[1],
                c.position[2] - a.position[2],
            ];
            let cross = [
                e1[1] * e2[2] - e1[2] * e2[1],
                e1[2] * e2[0] - e1[0] * e2[2],
                e1[0] * e2[1] - e1[1] * e2[0],
            ];
            let dot = cross[0] * a.normal[0] + cross[1] * a.normal[1] + cross[2] * a.normal[2];
            assert!(dot > 0.0, "a triangle faces the wrong way: {a:?}");
        }
        // squares that touch another box are not made: the wall's bottom edge sits on the floor box (its top is at y 0)
        assert!(
            !all.vertices.iter().any(|v| v.normal == [0.0, -1.0, 0.0]
                && v.position[1] == 0.0
                && v.position[0] > 0.5
                && v.position[0] < 7.5
                && (v.position[2] - 3.8).abs() < 0.01),
            "no underside where the wall stands on the floor"
        );
    }
}
