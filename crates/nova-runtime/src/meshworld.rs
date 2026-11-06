//! Collision against triangle meshes: a capsule that slides over terrain and walls of any angle, climbs small steps, stays on
//! a slope as it goes down, and rays. `nova.solid` in Lua. This is what a level modelled in a 3D tool needs (hills, caves,
//! cliffs), where [`crate::walls`]' boxes and ramps are only for levels built from boxes.
//!
//! The body is a capsule (a segment with a radius) standing with its feet at a point. A move goes in short steps (never more
//! than half the radius, so that nothing tunnels through a floor), and after each the capsule is pushed out of every triangle it
//! overlaps, along the direction from the nearest point of the triangle. What the pushes were says what it touched: ground
//! (a normal pointing up within the slope limit), a wall or a slope too steep to stand on, a ceiling.

use std::collections::HashMap;

use glam::{Mat4, Vec3};

/// Side of a grid cell, in metres.
const CELL: f32 = 4.0;
const EPS: f32 = 1e-5;

#[derive(Clone, Copy, Debug)]
struct Tri {
    a: Vec3,
    b: Vec3,
    c: Vec3,
    /// Unit normal, by the winding a, b, c (counter-clockwise seen from the front).
    n: Vec3,
}

#[derive(Default)]
pub struct MeshWorld {
    tris: Vec<Tri>,
    cells: HashMap<(i32, i32, i32), Vec<u32>>,
}

/// How a body moves: the steepest slope it can stand on (degrees), the highest step it climbs, how far down it follows ground.
#[derive(Clone, Copy, Debug)]
pub struct CapsuleOpts {
    pub max_slope_degrees: f32,
    pub step: f32,
    pub snap: f32,
}

impl Default for CapsuleOpts {
    fn default() -> Self {
        Self {
            max_slope_degrees: 50.0,
            step: 0.35,
            snap: 0.3,
        }
    }
}

/// Where a capsule ended up.
#[derive(Clone, Copy, Debug)]
pub struct CapsuleMove {
    /// Feet, in the middle.
    pub pos: Vec3,
    pub on_ground: bool,
    /// Up out of the ground it stands on (when `on_ground`).
    pub ground_normal: Vec3,
    /// Touched a wall, or a slope too steep to stand on (`wall_normal` points out of it; its y is above 0 for a steep slope).
    pub hit_wall: bool,
    pub wall_normal: Vec3,
    pub hit_ceiling: bool,
    /// How far it hopped up a ledge in this move (0 if it did not): a camera can ease over it.
    pub stepped: f32,
}

fn cell_of(p: Vec3) -> (i32, i32, i32) {
    (
        (p.x / CELL).floor() as i32,
        (p.y / CELL).floor() as i32,
        (p.z / CELL).floor() as i32,
    )
}

impl MeshWorld {
    pub fn clear(&mut self) {
        self.tris.clear();
        self.cells.clear();
    }

    /// How many triangles there are.
    pub fn len(&self) -> usize {
        self.tris.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tris.is_empty()
    }

    /// Adds a mesh (positions and triangle indices) placed by `place`. Returns how many triangles it added (degenerate ones are
    /// left out).
    pub fn add(&mut self, positions: &[[f32; 3]], indices: &[u32], place: Mat4) -> usize {
        let mut added = 0;
        for t in indices.as_chunks::<3>().0 {
            let get = |i: u32| {
                positions
                    .get(i as usize)
                    .map(|p| place.transform_point3(Vec3::from(*p)))
            };
            let (Some(a), Some(b), Some(c)) = (get(t[0]), get(t[1]), get(t[2])) else {
                continue;
            };
            let n = (b - a).cross(c - a);
            if n.length() < 1e-9 {
                continue;
            }
            let tri = Tri {
                a,
                b,
                c,
                n: n.normalize(),
            };
            let id = self.tris.len() as u32;
            let (lo, hi) = (cell_of(a.min(b).min(c)), cell_of(a.max(b).max(c)));
            for x in lo.0..=hi.0 {
                for y in lo.1..=hi.1 {
                    for z in lo.2..=hi.2 {
                        self.cells.entry((x, y, z)).or_default().push(id);
                    }
                }
            }
            self.tris.push(tri);
            added += 1;
        }
        added
    }

    /// The triangles in cells touching the box, each once.
    fn near(&self, lo: Vec3, hi: Vec3, out: &mut Vec<u32>) {
        out.clear();
        let (a, b) = (cell_of(lo), cell_of(hi));
        for x in a.0..=b.0 {
            for y in a.1..=b.1 {
                for z in a.2..=b.2 {
                    if let Some(list) = self.cells.get(&(x, y, z)) {
                        out.extend_from_slice(list);
                    }
                }
            }
        }
        out.sort_unstable();
        out.dedup();
    }

    /// The first thing a ray hits within `max` metres: the distance and the surface's normal (facing the ray).
    pub fn raycast(&self, origin: Vec3, dir: Vec3, max: f32) -> Option<(f32, Vec3)> {
        let dir = dir.try_normalize()?;
        if self.tris.is_empty() || !max.is_finite() || max <= 0.0 {
            return None;
        }
        let mut cell = cell_of(origin);
        let step = |d: f32| if d > 0.0 { 1 } else { -1 };
        let (sx, sy, sz) = (step(dir.x), step(dir.y), step(dir.z));
        let next = |c: i32, s: i32| (if s > 0 { c + 1 } else { c }) as f32 * CELL;
        let inv = |d: f32| {
            if d.abs() < 1e-12 {
                f32::INFINITY
            } else {
                1.0 / d
            }
        };
        let (ix, iy, iz) = (inv(dir.x), inv(dir.y), inv(dir.z));
        let first = |c: i32, s: i32, o: f32, i: f32| {
            if i.is_finite() {
                (next(c, s) - o) * i
            } else {
                f32::INFINITY
            }
        };
        let mut tmax = Vec3::new(
            first(cell.0, sx, origin.x, ix),
            first(cell.1, sy, origin.y, iy),
            first(cell.2, sz, origin.z, iz),
        );
        let delta = Vec3::new(CELL * ix.abs(), CELL * iy.abs(), CELL * iz.abs());
        let mut best: Option<(f32, Vec3)> = None;
        // a ray crosses at most this many cells before it is `max` long
        for _ in 0..(3.0 * (max / CELL + 2.0)) as usize + 3 {
            if let Some(list) = self.cells.get(&cell) {
                for &i in list {
                    let t = &self.tris[i as usize];
                    if let Some(d) = ray_triangle(origin, dir, t)
                        && d <= max
                        && best.is_none_or(|(b, _)| d < b)
                    {
                        let n = if t.n.dot(dir) > 0.0 { -t.n } else { t.n };
                        best = Some((d, n));
                    }
                }
            }
            let leave = tmax.min_element();
            if best.is_some_and(|(d, _)| d <= leave) || leave > max {
                break;
            }
            if tmax.x <= tmax.y && tmax.x <= tmax.z {
                cell.0 += sx;
                tmax.x += delta.x;
            } else if tmax.y <= tmax.z {
                cell.1 += sy;
                tmax.y += delta.y;
            } else {
                cell.2 += sz;
                tmax.z += delta.z;
            }
        }
        best
    }

    /// The ground under a point: the height of the first surface within `max_drop` below it, and its normal.
    pub fn floor_below(&self, p: Vec3, max_drop: f32) -> Option<(f32, Vec3)> {
        let (d, n) = self.raycast(p, -Vec3::Y, max_drop)?;
        Some((p.y - d, n))
    }

    /// Pushes a capsule (segment `p0`-`p1`, radius `r`) out of every triangle it overlaps; returns where it ended up and the
    /// normals of the pushes (with how deep each was) in the last pass.
    fn depenetrate(
        &self,
        mut feet: Vec3,
        r: f32,
        h: f32,
        walkable: f32,
        contacts: &mut Vec<(Vec3, f32)>,
    ) -> Vec3 {
        let mut ids = Vec::new();
        contacts.clear();
        for _ in 0..4 {
            let (p0, p1) = capsule_segment(feet, r, h);
            self.near(
                p0.min(p1) - Vec3::splat(r + 0.01),
                p0.max(p1) + Vec3::splat(r + 0.01),
                &mut ids,
            );
            let mut moved = false;
            let mut pass = Vec::new();
            for &i in &ids {
                let t = &self.tris[i as usize];
                let (p0, p1) = capsule_segment(feet, r, h);
                if let Some((n, depth)) = push_out(p0, p1, r, t)
                    && depth > 1e-4
                {
                    // ground it can stand on pushes straight up (so that standing on a slope does not creep down
                    // it, and walking up one does not lose speed); anything else pushes straight out
                    if n.y >= walkable {
                        feet.y += depth / n.y;
                    } else {
                        feet += n * depth;
                    }
                    pass.push((n, depth));
                    moved = true;
                }
            }
            if !moved {
                break;
            }
            *contacts = pass;
        }
        feet
    }

    /// Moves a capsule standing with its feet at `feet` (`radius` wide, `height` tall) by `delta`, sliding along what it meets.
    pub fn move_capsule(
        &self,
        feet: Vec3,
        radius: f32,
        height: f32,
        delta: Vec3,
        o: &CapsuleOpts,
    ) -> CapsuleMove {
        let r = radius.max(0.01);
        let h = height.max(2.0 * r);
        let walkable = o.max_slope_degrees.to_radians().cos();
        let mut contacts = Vec::new();
        let mut pos = self.depenetrate(feet, r, h, walkable, &mut contacts);
        let was_grounded = self.ground_at(pos, r, h, walkable).is_some();
        let (mut wall, mut wall_normal, mut ceiling) = (false, Vec3::ZERO, false);
        let mut stepped = 0.0f32;
        let note = |contacts: &[(Vec3, f32)], wall: &mut bool, wn: &mut Vec3, ceil: &mut bool| {
            for &(n, _) in contacts {
                if n.y < -0.7 {
                    *ceil = true;
                } else if n.y < walkable {
                    *wall = true;
                    *wn = n;
                }
            }
        };
        let steps = ((delta.length() / (r * 0.5)).ceil() as usize).clamp(1, 96);
        let sub = delta / steps as f32;
        for _ in 0..steps {
            // up or down first, then along the ground
            if sub.y != 0.0 {
                pos = self.depenetrate(
                    pos + Vec3::new(0.0, sub.y, 0.0),
                    r,
                    h,
                    walkable,
                    &mut contacts,
                );
                note(&contacts, &mut wall, &mut wall_normal, &mut ceiling);
            }
            let along = Vec3::new(sub.x, 0.0, sub.z);
            if along.length() < 1e-9 {
                continue;
            }
            let start = pos;
            let moved = self.depenetrate(start + along, r, h, walkable, &mut contacts);
            let blocked = contacts.iter().any(|(n, _)| n.y < walkable && n.y > -0.7);
            let mut best = moved;
            let mut best_contacts = contacts.clone();
            // blocked by something low enough to step onto: up, over, and down again
            if blocked
                && (was_grounded || self.ground_at(start, r, h, walkable).is_some())
                && o.step > 0.0
                && let Some(over) = self.step_over(start, along, r, h, o, walkable)
            {
                let (gained, kept) = (
                    Vec3::new(over.x - start.x, 0.0, over.z - start.z).dot(along),
                    Vec3::new(moved.x - start.x, 0.0, moved.z - start.z).dot(along),
                );
                if gained > kept + 1e-4 {
                    stepped = stepped.max(over.y - start.y);
                    best = over;
                    best_contacts.clear();
                }
            }
            pos = best;
            note(&best_contacts, &mut wall, &mut wall_normal, &mut ceiling);
        }
        // coming down a slope: stay on it rather than leave the ground and fall
        if was_grounded
            && stepped == 0.0
            && delta.y <= 0.0
            && self.ground_at(pos, r, h, walkable).is_none()
            && o.snap > 0.0
        {
            let mut probe = pos;
            let mut dropped = 0.0;
            while dropped < o.snap {
                let d = (r * 0.5).min(o.snap - dropped);
                probe = self.depenetrate(
                    probe - Vec3::new(0.0, d, 0.0),
                    r,
                    h,
                    walkable,
                    &mut contacts,
                );
                dropped += d;
                if self.ground_at(probe, r, h, walkable).is_some() {
                    pos = probe;
                    break;
                }
            }
        }
        let ground = self.ground_at(pos, r, h, walkable);
        // (a body that has just hopped up a ledge is standing on it, though its middle is still a little short of the edge)
        CapsuleMove {
            pos,
            on_ground: ground.is_some() || stepped > 0.0,
            ground_normal: ground.unwrap_or(Vec3::Y),
            hit_wall: wall,
            wall_normal,
            hit_ceiling: ceiling,
            stepped,
        }
    }

    /// Up onto a ledge: tries up by a step, a radius or so along, and down again. If that lands on ground it can stand on,
    /// higher than the start by no more than a step, the capsule goes to where it would have been (`start + along`) at that
    /// height. A ledge cannot be walked onto a little at a time (the corner of it pushes the capsule back as much as it
    /// moves forward), so the body hops up it at once.
    fn step_over(
        &self,
        start: Vec3,
        along: Vec3,
        r: f32,
        h: f32,
        o: &CapsuleOpts,
        walkable: f32,
    ) -> Option<Vec3> {
        let mut contacts = Vec::new();
        let up = self.depenetrate(
            start + Vec3::new(0.0, o.step, 0.0),
            r,
            h,
            walkable,
            &mut contacts,
        );
        if up.y < start.y + o.step - 1e-3 {
            return None; // a ceiling is in the way
        }
        let ahead = along.normalize_or_zero() * along.length().max(r + 0.05);
        let across = self.depenetrate(up + ahead, r, h, walkable, &mut contacts);
        if contacts.iter().any(|(n, _)| n.y < walkable && n.y > -0.7) {
            return None; // still a wall up there
        }
        // down until it stands
        let mut probe = across;
        let mut dropped = 0.0;
        let mut landing = None;
        while dropped < o.step + 0.02 {
            let d = (r * 0.5).min(o.step + 0.02 - dropped);
            probe = self.depenetrate(
                probe - Vec3::new(0.0, d, 0.0),
                r,
                h,
                walkable,
                &mut contacts,
            );
            dropped += d;
            if self.ground_at(probe, r, h, walkable).is_some() {
                landing = Some(probe.y);
                break;
            }
        }
        let y = landing?;
        if y < start.y + 0.01 || y > start.y + o.step + 1e-3 {
            return None; // not up, or not a step
        }
        // where it would have been, at that height: it must fit there
        let here = Vec3::new(start.x + along.x, y, start.z + along.z);
        let fitted = self.depenetrate(here, r, h, walkable, &mut contacts);
        if (fitted - here).length() > 0.02 {
            return None;
        }
        Some(fitted)
    }

    /// The normal of the ground a capsule stands on, if its feet are on something walkable (within a hair).
    fn ground_at(&self, feet: Vec3, r: f32, h: f32, walkable: f32) -> Option<Vec3> {
        let mut ids = Vec::new();
        let probe = feet - Vec3::new(0.0, 0.03, 0.0);
        let (p0, p1) = capsule_segment(probe, r, h);
        self.near(
            p0.min(p1) - Vec3::splat(r + 0.01),
            p0.max(p1) + Vec3::splat(r + 0.01),
            &mut ids,
        );
        let mut best: Option<(Vec3, f32)> = None;
        for &i in &ids {
            if let Some((n, depth)) = push_out(p0, p1, r, &self.tris[i as usize])
                && n.y >= walkable
                && depth > 0.0
                && best.is_none_or(|(_, d)| depth > d)
            {
                best = Some((n, depth));
            }
        }
        best.map(|(n, _)| n)
    }
}

/// The segment a capsule is made round: from the middle of its lowest sphere to the middle of its highest.
fn capsule_segment(feet: Vec3, r: f32, h: f32) -> (Vec3, Vec3) {
    (
        feet + Vec3::new(0.0, r, 0.0),
        feet + Vec3::new(0.0, h - r, 0.0),
    )
}

/// The push that gets a capsule out of a triangle: the direction (unit, out of the triangle) and how deep it is in; None when
/// it does not touch.
fn push_out(p0: Vec3, p1: Vec3, r: f32, t: &Tri) -> Option<(Vec3, f32)> {
    // through the face: the segment crosses the triangle's plane inside it
    let (d0, d1) = ((p0 - t.a).dot(t.n), (p1 - t.a).dot(t.n));
    if d0 * d1 < 0.0 {
        let s = d0 / (d0 - d1);
        let hit = p0 + (p1 - p0) * s;
        if inside(hit, t) {
            // out the way the capsule is mostly on: past the far end by a radius
            let side = if d0.abs() >= d1.abs() {
                d0.signum()
            } else {
                d1.signum()
            };
            let other = if side == d0.signum() {
                d1.abs()
            } else {
                d0.abs()
            };
            return Some((t.n * side, r + other));
        }
    }
    let (dist, on_seg, on_tri) = segment_triangle(p0, p1, t);
    if dist >= r {
        return None;
    }
    let away = on_seg - on_tri;
    let n = if dist > EPS {
        away / dist
    } else {
        // touching exactly: out of the face it is in front of
        let mid = (p0 + p1) * 0.5;
        if (mid - t.a).dot(t.n) >= 0.0 {
            t.n
        } else {
            -t.n
        }
    };
    Some((n, r - dist))
}

fn inside(p: Vec3, t: &Tri) -> bool {
    let (v0, v1, v2) = (t.b - t.a, t.c - t.a, p - t.a);
    let (d00, d01, d11) = (v0.dot(v0), v0.dot(v1), v1.dot(v1));
    let (d20, d21) = (v2.dot(v0), v2.dot(v1));
    let denom = d00 * d11 - d01 * d01;
    if denom.abs() < 1e-12 {
        return false;
    }
    let v = (d11 * d20 - d01 * d21) / denom;
    let w = (d00 * d21 - d01 * d20) / denom;
    v >= 0.0 && w >= 0.0 && v + w <= 1.0
}

/// The closest point of a triangle to a point (Ericson, Real-Time Collision Detection).
fn closest_on_triangle(p: Vec3, t: &Tri) -> Vec3 {
    let (a, b, c) = (t.a, t.b, t.c);
    let (ab, ac, ap) = (b - a, c - a, p - a);
    let (d1, d2) = (ab.dot(ap), ac.dot(ap));
    if d1 <= 0.0 && d2 <= 0.0 {
        return a;
    }
    let bp = p - b;
    let (d3, d4) = (ab.dot(bp), ac.dot(bp));
    if d3 >= 0.0 && d4 <= d3 {
        return b;
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        return a + ab * (d1 / (d1 - d3));
    }
    let cp = p - c;
    let (d5, d6) = (ab.dot(cp), ac.dot(cp));
    if d6 >= 0.0 && d5 <= d6 {
        return c;
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        return a + ac * (d2 / (d2 - d6));
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        return b + (c - b) * ((d4 - d3) / ((d4 - d3) + (d5 - d6)));
    }
    let denom = 1.0 / (va + vb + vc);
    a + ab * (vb * denom) + ac * (vc * denom)
}

/// The closest points of two segments.
fn segment_segment(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3) -> (Vec3, Vec3) {
    let (d1, d2, r) = (q1 - p1, q2 - p2, p1 - p2);
    let (a, e, f) = (d1.dot(d1), d2.dot(d2), d2.dot(r));
    if a <= EPS && e <= EPS {
        return (p1, p2);
    }
    let (s, t);
    if a <= EPS {
        s = 0.0;
        t = (f / e).clamp(0.0, 1.0);
    } else {
        let c = d1.dot(r);
        if e <= EPS {
            t = 0.0;
            s = (-c / a).clamp(0.0, 1.0);
        } else {
            let b = d1.dot(d2);
            let denom = a * e - b * b;
            let mut s0 = if denom > EPS {
                ((b * f - c * e) / denom).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let mut t0 = (b * s0 + f) / e;
            if t0 < 0.0 {
                t0 = 0.0;
                s0 = (-c / a).clamp(0.0, 1.0);
            } else if t0 > 1.0 {
                t0 = 1.0;
                s0 = ((b - c) / a).clamp(0.0, 1.0);
            }
            s = s0;
            t = t0;
        }
    }
    (p1 + d1 * s, p2 + d2 * t)
}

/// Closest points of a segment and a triangle's surface (not through it: see [`push_out`]): distance, on the segment, on the
/// triangle.
fn segment_triangle(p0: Vec3, p1: Vec3, t: &Tri) -> (f32, Vec3, Vec3) {
    let mut best = (f32::INFINITY, p0, t.a);
    let mut offer = |on_seg: Vec3, on_tri: Vec3| {
        let d = on_seg.distance(on_tri);
        if d < best.0 {
            best = (d, on_seg, on_tri);
        }
    };
    offer(p0, closest_on_triangle(p0, t));
    offer(p1, closest_on_triangle(p1, t));
    for (a, b) in [(t.a, t.b), (t.b, t.c), (t.c, t.a)] {
        let (s, e) = segment_segment(p0, p1, a, b);
        offer(s, e);
    }
    // the segment's closest point to the face itself, when it runs parallel above it
    let (d0, d1) = ((p0 - t.a).dot(t.n), (p1 - t.a).dot(t.n));
    if d0 * d1 >= 0.0 {
        for s in [p0, p1] {
            let q = s - t.n * (s - t.a).dot(t.n);
            if inside(q, t) {
                offer(s, q);
            }
        }
    }
    best
}

/// Möller-Trumbore, both sides: the distance along the ray, if it hits.
fn ray_triangle(o: Vec3, d: Vec3, t: &Tri) -> Option<f32> {
    let (e1, e2) = (t.b - t.a, t.c - t.a);
    let p = d.cross(e2);
    let det = e1.dot(p);
    if det.abs() < 1e-9 {
        return None;
    }
    let inv = 1.0 / det;
    let s = o - t.a;
    let u = s.dot(p) * inv;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = s.cross(e1);
    let v = d.dot(q) * inv;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let dist = e2.dot(q) * inv;
    (dist >= 0.0).then_some(dist)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A quad a, b, c, d (counter-clockwise seen from the front) as two triangles.
    fn quad(w: &mut MeshWorld, a: [f32; 3], b: [f32; 3], c: [f32; 3], d: [f32; 3]) {
        w.add(&[a, b, c, d], &[0, 1, 2, 0, 2, 3], Mat4::IDENTITY);
    }

    /// A floor of side 2s at height y, facing up.
    fn floor(w: &mut MeshWorld, s: f32, y: f32) {
        quad(w, [-s, y, s], [s, y, s], [s, y, -s], [-s, y, -s]);
    }

    fn walk(w: &MeshWorld, from: Vec3, delta: Vec3) -> CapsuleMove {
        w.move_capsule(from, 0.4, 1.8, delta, &CapsuleOpts::default())
    }

    #[test]
    fn a_capsule_lands_on_a_floor_even_from_a_fast_fall() {
        let mut w = MeshWorld::default();
        floor(&mut w, 20.0, 0.0);
        let m = walk(&w, Vec3::new(0.0, 5.0, 0.0), Vec3::new(0.0, -9.0, 0.0));
        assert!(m.on_ground && m.pos.y.abs() < 0.01, "{m:?}");
        assert!((m.ground_normal - Vec3::Y).length() < 1e-4);
        // standing, nothing moves it
        let again = walk(&w, m.pos, Vec3::ZERO);
        assert!((again.pos - m.pos).length() < 0.01 && again.on_ground);
        // in the air, it is not grounded
        assert!(!walk(&w, Vec3::new(0.0, 3.0, 0.0), Vec3::ZERO).on_ground);
    }

    #[test]
    fn a_wall_stops_a_capsule_and_it_slides_along_it() {
        let mut w = MeshWorld::default();
        floor(&mut w, 20.0, 0.0);
        // a wall across x = 3 facing -x
        quad(
            &mut w,
            [3.0, 0.0, -10.0],
            [3.0, 0.0, 10.0],
            [3.0, 5.0, 10.0],
            [3.0, 5.0, -10.0],
        );
        let m = walk(&w, Vec3::new(0.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 1.0));
        assert!(m.hit_wall && m.on_ground, "{m:?}");
        assert!(
            (m.pos.x - 2.6).abs() < 0.02,
            "stopped a radius from the wall: {}",
            m.pos.x
        );
        assert!(m.pos.z > 0.9, "and kept going along it: {}", m.pos.z);
        assert!(m.wall_normal.x < -0.99, "{:?}", m.wall_normal);
    }

    #[test]
    fn a_gentle_slope_is_walked_up_and_a_steep_one_is_not() {
        for (degrees, expect_up) in [(30.0f32, true), (65.0, false)] {
            let mut w = MeshWorld::default();
            let rise = degrees.to_radians().tan();
            // a ramp rising along +x from x = 0 to 10, with a floor before it
            floor(&mut w, 30.0, 0.0);
            quad(
                &mut w,
                [0.0, 0.0, 5.0],
                [10.0, 10.0 * rise, 5.0],
                [10.0, 10.0 * rise, -5.0],
                [0.0, 0.0, -5.0],
            );
            let mut pos = Vec3::new(-3.0, 0.0, 0.0);
            let mut last = walk(&w, pos, Vec3::ZERO);
            for _ in 0..90 {
                last = walk(&w, last.pos, Vec3::new(4.0 / 60.0, -0.003, 0.0));
                pos = last.pos;
            }
            if expect_up {
                assert!(
                    pos.x > 2.0 && pos.y > 1.0,
                    "climbed a {degrees} degree slope: {pos:?}"
                );
                assert!(last.on_ground, "and stands on it");
            } else {
                assert!(pos.x < 0.6, "a {degrees} degree slope is a wall: {pos:?}");
                assert!(
                    last.hit_wall && last.wall_normal.y > 0.2,
                    "steep ground is reported with a normal to slide down: {last:?}"
                );
            }
        }
    }

    #[test]
    fn small_steps_are_climbed_and_tall_ones_block() {
        for (height, climbs) in [(0.25f32, true), (0.7, false)] {
            let mut w = MeshWorld::default();
            floor(&mut w, 30.0, 0.0);
            // a block from x = 2 up to height, as top and front
            quad(
                &mut w,
                [2.0, height, 5.0],
                [10.0, height, 5.0],
                [10.0, height, -5.0],
                [2.0, height, -5.0],
            );
            quad(
                &mut w,
                [2.0, 0.0, 5.0],
                [2.0, height, 5.0],
                [2.0, height, -5.0],
                [2.0, 0.0, -5.0],
            );
            quad(
                &mut w,
                [2.0, 0.0, -5.0],
                [2.0, height, -5.0],
                [2.0, height, 5.0],
                [2.0, 0.0, 5.0],
            );
            let mut m = walk(&w, Vec3::new(0.0, 0.0, 0.0), Vec3::ZERO);
            for _ in 0..120 {
                m = walk(&w, m.pos, Vec3::new(3.0 / 60.0, -0.003, 0.0));
            }
            if climbs {
                assert!(
                    m.pos.x > 3.0 && (m.pos.y - height).abs() < 0.03,
                    "stepped onto a {height} m ledge: {:?}",
                    m.pos
                );
            } else {
                assert!(
                    m.pos.x < 1.7 && m.pos.y < 0.05,
                    "a {height} m wall blocks: {:?}",
                    m.pos
                );
            }
        }
    }

    #[test]
    fn a_capsule_walking_down_a_slope_stays_on_it() {
        let mut w = MeshWorld::default();
        let rise = 25f32.to_radians().tan();
        // a hill coming down along +x from height 5 at x = 0
        quad(
            &mut w,
            [0.0, 5.0, 5.0],
            [10.0, 5.0 - 10.0 * rise, 5.0],
            [10.0, 5.0 - 10.0 * rise, -5.0],
            [0.0, 5.0, -5.0],
        );
        quad(
            &mut w,
            [-10.0, 5.0, 5.0],
            [0.0, 5.0, 5.0],
            [0.0, 5.0, -5.0],
            [-10.0, 5.0, -5.0],
        );
        let mut m = walk(&w, Vec3::new(-2.0, 5.0, 0.0), Vec3::ZERO);
        assert!(m.on_ground);
        let mut grounded_frames = 0;
        for _ in 0..60 {
            // no gravity pulling it down this time: it is the snap that keeps it on the slope
            m = walk(&w, m.pos, Vec3::new(5.0 / 60.0, 0.0, 0.0));
            grounded_frames += m.on_ground as i32;
        }
        assert!(
            m.pos.x > 2.0 && m.pos.y < 4.5,
            "went down the slope: {:?}",
            m.pos
        );
        assert_eq!(grounded_frames, 60, "on the ground every frame");
    }

    #[test]
    fn a_ceiling_is_hit_from_below() {
        let mut w = MeshWorld::default();
        floor(&mut w, 20.0, 0.0);
        // a ceiling at 2.5 m facing down
        quad(
            &mut w,
            [-5.0, 2.5, -5.0],
            [5.0, 2.5, -5.0],
            [5.0, 2.5, 5.0],
            [-5.0, 2.5, 5.0],
        );
        let m = walk(&w, Vec3::new(0.0, 0.0, 0.0), Vec3::new(0.0, 3.0, 0.0));
        assert!(m.hit_ceiling && !m.on_ground, "{m:?}");
        assert!(
            (m.pos.y + 1.8 - 2.5).abs() < 0.03,
            "head at the ceiling: {:?}",
            m.pos
        );
    }

    #[test]
    fn rays_hit_the_nearest_surface_and_report_its_normal() {
        let mut w = MeshWorld::default();
        floor(&mut w, 50.0, 0.0);
        quad(
            &mut w,
            [-1.0, 3.0, 1.0],
            [1.0, 3.0, 1.0],
            [1.0, 3.0, -1.0],
            [-1.0, 3.0, -1.0],
        );
        let (d, n) = w
            .raycast(Vec3::new(0.0, 10.0, 0.0), -Vec3::Y, 100.0)
            .unwrap();
        assert!((d - 7.0).abs() < 1e-4 && n.y > 0.99, "the ledge first: {d}");
        let (d, _) = w
            .raycast(Vec3::new(5.0, 10.0, 0.0), -Vec3::Y, 100.0)
            .unwrap();
        assert!((d - 10.0).abs() < 1e-4, "beside it, the floor: {d}");
        assert!(
            w.raycast(Vec3::new(5.0, 10.0, 0.0), -Vec3::Y, 5.0)
                .is_none(),
            "too short"
        );
        assert!(
            w.raycast(Vec3::new(0.0, 10.0, 0.0), Vec3::Y, 100.0)
                .is_none(),
            "away from everything"
        );
        // a long way across several cells
        let (d, _) = w
            .raycast(
                Vec3::new(-40.0, 1.0, 0.0),
                Vec3::new(1.0, -0.025, 0.0),
                200.0,
            )
            .unwrap();
        assert!((d - 40.0).abs() < 0.1, "grazes the floor 40 m on: {d}");
        let (y, n) = w.floor_below(Vec3::new(0.2, 8.0, 0.2), 20.0).unwrap();
        assert!((y - 3.0).abs() < 1e-4 && n.y > 0.99);
    }

    #[test]
    fn a_placed_mesh_is_where_it_was_put_and_bad_input_is_skipped() {
        let mut w = MeshWorld::default();
        let square = [
            [-1.0, 0.0, 1.0],
            [1.0, 0.0, 1.0],
            [1.0, 0.0, -1.0],
            [-1.0, 0.0, -1.0],
        ];
        let n = w.add(
            &square,
            &[0, 1, 2, 0, 2, 3, 0, 0, 1, 0, 9, 9],
            Mat4::from_translation(Vec3::new(10.0, 4.0, 0.0)),
        );
        assert_eq!(
            n, 2,
            "the degenerate and the out-of-range triangle are skipped"
        );
        let (y, _) = w.floor_below(Vec3::new(10.0, 9.0, 0.0), 20.0).unwrap();
        assert!((y - 4.0).abs() < 1e-4);
        assert!(w.floor_below(Vec3::new(0.0, 9.0, 0.0), 20.0).is_none());
        w.clear();
        assert!(w.is_empty());
    }

    /// A bumpy field, gentle everywhere (under 30 degrees), as a grid of triangles.
    fn terrain_height(x: f32, z: f32) -> f32 {
        1.2 * (x * 0.31).sin() * (z * 0.27).cos() + 0.6 * (x * 0.13 + z * 0.17).sin()
    }

    fn hills(w: &mut MeshWorld) -> fn(f32, f32) -> f32 {
        let height: fn(f32, f32) -> f32 = terrain_height;
        let (n, size) = (80usize, 1.0f32);
        let mut positions = Vec::new();
        for i in 0..=n {
            for j in 0..=n {
                let (x, z) = ((i as f32 - 40.0) * size, (j as f32 - 40.0) * size);
                positions.push([x, height(x, z), z]);
            }
        }
        let mut indices = Vec::new();
        for i in 0..n {
            for j in 0..n {
                let a = (i * (n + 1) + j) as u32;
                let (b, c, d) = (a + 1, a + (n + 1) as u32, a + (n + 1) as u32 + 1);
                indices.extend_from_slice(&[a, b, d, a, d, c]);
            }
        }
        // the winding must face up: flip if the first triangle faces down
        let t = |k: usize| Vec3::from(positions[indices[k] as usize]);
        if (t(1) - t(0)).cross(t(2) - t(0)).y < 0.0 {
            for tri in indices.chunks_mut(3) {
                tri.swap(1, 2);
            }
        }
        w.add(&positions, &indices, Mat4::IDENTITY);
        height
    }

    #[test]
    fn walking_over_bumpy_ground_in_every_direction_never_leaves_or_sinks() {
        let mut w = MeshWorld::default();
        let height = hills(&mut w);
        assert!(w.len() > 12_000);
        let mut seed = 12345u32;
        let mut rnd = move || {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed >> 8) as f32 / (1 << 24) as f32
        };
        let (mut frames, mut grounded, mut worst) = (0, 0, 0.0f32);
        for _ in 0..12 {
            let mut m = walk(
                &w,
                Vec3::new((rnd() - 0.5) * 16.0, 6.0, (rnd() - 0.5) * 16.0),
                Vec3::new(0.0, -9.0, 0.0),
            );
            let a = rnd() * std::f32::consts::TAU;
            for k in 0..250 {
                // a gravity of one frame's worth, a stride of 5 m/s, and now and then a turn
                let turn = if k % 100 == 99 { 0.8 } else { 0.0 };
                let d = Vec3::new(
                    (a + turn * (k / 100) as f32).cos(),
                    0.0,
                    (a + turn * (k / 100) as f32).sin(),
                );
                m = walk(&w, m.pos, d * (5.0 / 60.0) + Vec3::new(0.0, -0.003, 0.0));
                frames += 1;
                grounded += m.on_ground as i32;
                worst = worst.max((m.pos.y - height(m.pos.x, m.pos.z)).abs());
            }
        }
        assert!(
            grounded as f32 / frames as f32 > 0.97,
            "on the ground {grounded} of {frames} frames"
        );
        assert!(
            worst < 0.15,
            "never more than a hand off the surface (its triangles are coarser than the formula): {worst}"
        );
    }
}
