//! Walls for indoor 3D: boxes standing on the ground plane (x and z, with a height range), that bodies slide along, rays stop
//! at and doors open in; and a grid path finder over them so that creatures can find their way round.
//!
//! The ground is x and z, y is up, as everywhere in Nova. A wall is a box `x0..x1`, `z0..z1`, `y0..y1`; a door is a wall that is
//! switched off while it is open.

use std::collections::{BinaryHeap, HashMap, HashSet};

const CELL: f32 = 4.0;

#[derive(Clone, Copy, Debug)]
pub struct Wall {
    pub x0: f32,
    pub z0: f32,
    pub x1: f32,
    pub z1: f32,
    pub y0: f32,
    pub y1: f32,
    pub on: bool,
}

#[derive(Default)]
pub struct Walls {
    walls: Vec<Wall>,
    grid: HashMap<(i32, i32), Vec<u32>>,
    dirty: bool,
}

/// What a ray found: how far, the way the face it hit points (on the ground), and which wall.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RayHit {
    pub distance: f32,
    pub nx: f32,
    pub nz: f32,
    pub id: u32,
}

impl Walls {
    pub fn clear(&mut self) {
        self.walls.clear();
        self.grid.clear();
        self.dirty = false;
    }

    pub fn len(&self) -> usize {
        self.walls.len()
    }

    pub fn is_empty(&self) -> bool {
        self.walls.is_empty()
    }

    /// Adds a wall (corners in any order) and gives its number.
    pub fn add(&mut self, x0: f32, z0: f32, x1: f32, z1: f32, y0: f32, y1: f32) -> u32 {
        self.walls.push(Wall {
            x0: x0.min(x1),
            z0: z0.min(z1),
            x1: x0.max(x1),
            z1: z0.max(z1),
            y0: y0.min(y1),
            y1: y0.max(y1),
            on: true,
        });
        self.dirty = true;
        (self.walls.len() - 1) as u32
    }

    /// Switches a wall on or off (a door open is a wall off).
    pub fn set_on(&mut self, id: u32, on: bool) {
        if let Some(w) = self.walls.get_mut(id as usize) {
            w.on = on;
        }
    }

    pub fn get(&self, id: u32) -> Option<&Wall> {
        self.walls.get(id as usize)
    }

    pub fn all(&self) -> &[Wall] {
        &self.walls
    }

    fn rebuild(&mut self) {
        if !self.dirty {
            return;
        }
        self.grid.clear();
        for (i, w) in self.walls.iter().enumerate() {
            for cx in (w.x0 / CELL).floor() as i32..=(w.x1 / CELL).floor() as i32 {
                for cz in (w.z0 / CELL).floor() as i32..=(w.z1 / CELL).floor() as i32 {
                    self.grid.entry((cx, cz)).or_default().push(i as u32);
                }
            }
        }
        self.dirty = false;
    }

    /// Makes the lookup grid current (call after adding walls and before asking; the queries take `&self`).
    pub fn prepare(&mut self) {
        self.rebuild();
    }

    /// The walls near a box on the ground, once each.
    fn near(&self, x0: f32, z0: f32, x1: f32, z1: f32, out: &mut Vec<u32>) {
        out.clear();
        for cx in (x0 / CELL).floor() as i32..=(x1 / CELL).floor() as i32 {
            for cz in (z0 / CELL).floor() as i32..=(z1 / CELL).floor() as i32 {
                if let Some(list) = self.grid.get(&(cx, cz)) {
                    for &i in list {
                        if !out.contains(&i) {
                            out.push(i);
                        }
                    }
                }
            }
        }
    }

    /// How far a circle of radius `r` standing at (x, z) with its feet at `y` and `h` tall must move to be out of the walls:
    /// the sum of what each wall it overlaps pushes it, tried a few times over so that a corner settles.
    pub fn push(&self, x: f32, z: f32, r: f32, y: f32, h: f32) -> (f32, f32) {
        let (mut px, mut pz) = (0.0f32, 0.0f32);
        let mut near = Vec::new();
        for _ in 0..4 {
            let (cx, cz) = (x + px, z + pz);
            self.near(cx - r, cz - r, cx + r, cz + r, &mut near);
            let mut moved = false;
            for &i in &near {
                let w = &self.walls[i as usize];
                if !w.on || y + h <= w.y0 || y >= w.y1 {
                    continue;
                }
                let (cx, cz) = (x + px, z + pz);
                let (qx, qz) = (cx.clamp(w.x0, w.x1), cz.clamp(w.z0, w.z1));
                let (dx, dz) = (cx - qx, cz - qz);
                let d2 = dx * dx + dz * dz;
                if d2 >= r * r {
                    continue;
                }
                if d2 > 1e-9 {
                    let d = d2.sqrt();
                    px += dx / d * (r - d);
                    pz += dz / d * (r - d);
                } else {
                    // the centre is inside the box: out by the nearest face
                    let out = [
                        (cx - w.x0, -1.0, 0.0),
                        (w.x1 - cx, 1.0, 0.0),
                        (cz - w.z0, 0.0, -1.0),
                        (w.z1 - cz, 0.0, 1.0),
                    ];
                    let (depth, nx, nz) = out
                        .into_iter()
                        .min_by(|a, b| a.0.total_cmp(&b.0))
                        .expect("four faces");
                    px += nx * (depth + r);
                    pz += nz * (depth + r);
                }
                moved = true;
            }
            if !moved {
                break;
            }
        }
        (px, pz)
    }

    /// The first wall a ray meets: from (x, z) along the direction (dx, dz) for `length`, rising `slope` for each unit along the
    /// ground, starting `y` high, so that a wall lower than the ray is passed over.
    pub fn raycast(
        &self,
        x: f32,
        z: f32,
        dx: f32,
        dz: f32,
        length: f32,
        y: f32,
        slope: f32,
    ) -> Option<RayHit> {
        let len = (dx * dx + dz * dz).sqrt();
        if len < 1e-9 {
            return None;
        }
        let (dx, dz) = (dx / len, dz / len);
        let (ex, ez) = (x + dx * length, z + dz * length);
        let mut near = Vec::new();
        self.near(
            x.min(ex) - 0.01,
            z.min(ez) - 0.01,
            x.max(ex) + 0.01,
            z.max(ez) + 0.01,
            &mut near,
        );
        let mut best: Option<RayHit> = None;
        for &i in &near {
            let w = &self.walls[i as usize];
            if !w.on {
                continue;
            }
            // where the ray is inside the footprint on the ground: from tmin to tmax, entering through a side
            let (mut tmin, mut tmax) = (0.0f32, length);
            let (mut nx, mut nz) = (0.0f32, 0.0f32);
            let mut miss = false;
            for (axis, o, d, lo, hi) in [(0, x, dx, w.x0, w.x1), (1, z, dz, w.z0, w.z1)] {
                if d.abs() < 1e-9 {
                    if o < lo || o > hi {
                        miss = true;
                        break;
                    }
                    continue;
                }
                let (ta, tb) = ((lo - o) / d, (hi - o) / d);
                let (near_t, far_t) = if ta < tb { (ta, tb) } else { (tb, ta) };
                if near_t > tmin {
                    tmin = near_t;
                    (nx, nz) = if axis == 0 {
                        (-d.signum(), 0.0)
                    } else {
                        (0.0, -d.signum())
                    };
                }
                tmax = tmax.min(far_t);
                if tmin > tmax {
                    miss = true;
                    break;
                }
            }
            if miss {
                continue;
            }
            // and where it is within the wall's height: the ray rises evenly, so that is a stretch too
            let (mut lo_t, mut hi_t) = (tmin, tmax);
            if slope.abs() < 1e-9 {
                if y < w.y0 || y > w.y1 {
                    continue;
                }
            } else {
                let (ta, tb) = ((w.y0 - y) / slope, (w.y1 - y) / slope);
                lo_t = lo_t.max(ta.min(tb));
                hi_t = hi_t.min(ta.max(tb));
                if lo_t > hi_t {
                    continue;
                }
            }
            // (through the top or the bottom of the wall, not a side, the face has no direction on the ground)
            let (nx, nz) = if lo_t > tmin + 1e-6 {
                (0.0, 0.0)
            } else {
                (nx, nz)
            };
            if best.is_none_or(|b| lo_t < b.distance) {
                best = Some(RayHit {
                    distance: lo_t,
                    nx,
                    nz,
                    id: i,
                });
            }
        }
        best
    }

    /// Whether nothing stands between two places (given with how high each is).
    pub fn line_clear(&self, x1: f32, z1: f32, x2: f32, z2: f32, y1: f32, y2: f32) -> bool {
        let (dx, dz) = (x2 - x1, z2 - z1);
        let len = (dx * dx + dz * dz).sqrt();
        if len < 1e-6 {
            return true;
        }
        self.raycast(x1, z1, dx, dz, len, y1, (y2 - y1) / len)
            .is_none()
    }
}

/// A grid over the ground that says where a body of a given size can stand, and finds paths over it.
#[derive(Default)]
pub struct Nav {
    cell: f32,
    x0: f32,
    z0: f32,
    w: usize,
    h: usize,
    blocked: Vec<bool>,
}

impl Nav {
    /// Marks every cell whose middle is closer to a wall than `radius`.
    pub fn build(
        walls: &Walls,
        x0: f32,
        z0: f32,
        x1: f32,
        z1: f32,
        cell: f32,
        radius: f32,
        y: f32,
        height: f32,
    ) -> Nav {
        let cell = cell.max(0.1);
        let (w, h) = (
            ((x1 - x0) / cell).ceil().max(1.0) as usize,
            ((z1 - z0) / cell).ceil().max(1.0) as usize,
        );
        let mut blocked = vec![false; w * h];
        for cz in 0..h {
            for cx in 0..w {
                let (px, pz) = (x0 + (cx as f32 + 0.5) * cell, z0 + (cz as f32 + 0.5) * cell);
                let (dx, dz) = walls.push(px, pz, radius, y, height);
                blocked[cz * w + cx] = dx.abs() + dz.abs() > 1e-4;
            }
        }
        Nav {
            cell,
            x0,
            z0,
            w,
            h,
            blocked,
        }
    }

    pub fn is_blocked(&self, x: f32, z: f32) -> bool {
        match self.cell_of(x, z) {
            Some((cx, cz)) => self.blocked[cz * self.w + cx],
            None => true,
        }
    }

    fn cell_of(&self, x: f32, z: f32) -> Option<(usize, usize)> {
        if self.cell <= 0.0 {
            return None;
        }
        let (fx, fz) = ((x - self.x0) / self.cell, (z - self.z0) / self.cell);
        if fx < 0.0 || fz < 0.0 {
            return None;
        }
        let (cx, cz) = (fx as usize, fz as usize);
        (cx < self.w && cz < self.h).then_some((cx, cz))
    }

    fn centre(&self, c: (usize, usize)) -> (f32, f32) {
        (
            self.x0 + (c.0 as f32 + 0.5) * self.cell,
            self.z0 + (c.1 as f32 + 0.5) * self.cell,
        )
    }

    /// The nearest free cell to a place (the place itself when free), searching a few rings out.
    fn free_cell_near(&self, x: f32, z: f32) -> Option<(usize, usize)> {
        let (fx, fz) = (
            ((x - self.x0) / self.cell).floor() as i32,
            ((z - self.z0) / self.cell).floor() as i32,
        );
        for ring in 0..4i32 {
            let mut best: Option<((usize, usize), f32)> = None;
            for dz in -ring..=ring {
                for dx in -ring..=ring {
                    if dx.abs().max(dz.abs()) != ring {
                        continue;
                    }
                    let (cx, cz) = (fx + dx, fz + dz);
                    if cx < 0
                        || cz < 0
                        || cx as usize >= self.w
                        || cz as usize >= self.h
                        || self.blocked[cz as usize * self.w + cx as usize]
                    {
                        continue;
                    }
                    let c = (cx as usize, cz as usize);
                    let (mx, mz) = self.centre(c);
                    let d = (mx - x).powi(2) + (mz - z).powi(2);
                    if best.is_none_or(|b| d < b.1) {
                        best = Some((c, d));
                    }
                }
            }
            if let Some((c, _)) = best {
                return Some(c);
            }
        }
        None
    }

    /// Whether a straight line between two places crosses only free cells.
    fn grid_clear(&self, a: (f32, f32), b: (f32, f32)) -> bool {
        let (dx, dz) = (b.0 - a.0, b.1 - a.1);
        let steps = ((dx.abs().max(dz.abs()) / (self.cell * 0.5)).ceil() as usize).max(1);
        (0..=steps).all(|i| {
            let t = i as f32 / steps as f32;
            !self.is_blocked(a.0 + dx * t, a.1 + dz * t)
        })
    }

    /// A route from one place to another round the walls: the corners to turn at, ending at the goal (or at the free cell
    /// nearest it). None when there is no way.
    pub fn path(&self, from: (f32, f32), to: (f32, f32)) -> Option<Vec<(f32, f32)>> {
        let start = self.free_cell_near(from.0, from.1)?;
        let goal = self.free_cell_near(to.0, to.1)?;
        if start == goal {
            return Some(vec![to]);
        }
        #[derive(PartialEq)]
        struct Node(f32, (usize, usize));
        impl Eq for Node {}
        impl PartialOrd for Node {
            fn partial_cmp(&self, o: &Self) -> Option<std::cmp::Ordering> {
                Some(self.cmp(o))
            }
        }
        impl Ord for Node {
            fn cmp(&self, o: &Self) -> std::cmp::Ordering {
                o.0.total_cmp(&self.0) // the smallest first
            }
        }
        let heuristic = |c: (usize, usize)| {
            (((c.0 as f32 - goal.0 as f32).powi(2) + (c.1 as f32 - goal.1 as f32).powi(2)).sqrt())
                * self.cell
        };
        let mut open = BinaryHeap::new();
        let mut came: HashMap<(usize, usize), (usize, usize)> = HashMap::new();
        let mut cost: HashMap<(usize, usize), f32> = HashMap::new();
        let mut closed: HashSet<(usize, usize)> = HashSet::new();
        cost.insert(start, 0.0);
        open.push(Node(heuristic(start), start));
        while let Some(Node(_, cur)) = open.pop() {
            if cur == goal {
                break;
            }
            if !closed.insert(cur) {
                continue;
            }
            let base = cost[&cur];
            for (dx, dz) in [
                (1i32, 0i32),
                (-1, 0),
                (0, 1),
                (0, -1),
                (1, 1),
                (1, -1),
                (-1, 1),
                (-1, -1),
            ] {
                let (nx, nz) = (cur.0 as i32 + dx, cur.1 as i32 + dz);
                if nx < 0 || nz < 0 || nx as usize >= self.w || nz as usize >= self.h {
                    continue;
                }
                let n = (nx as usize, nz as usize);
                if self.blocked[n.1 * self.w + n.0] {
                    continue;
                }
                // no cutting a corner of a wall
                if dx != 0
                    && dz != 0
                    && (self.blocked[cur.1 * self.w + n.0] || self.blocked[n.1 * self.w + cur.0])
                {
                    continue;
                }
                let step = if dx != 0 && dz != 0 { 1.4142 } else { 1.0 } * self.cell;
                let c = base + step;
                if cost.get(&n).is_none_or(|&old| c < old) {
                    cost.insert(n, c);
                    came.insert(n, cur);
                    open.push(Node(c + heuristic(n), n));
                }
            }
        }
        if !came.contains_key(&goal) {
            return None;
        }
        // back from the goal to the start, then pull the string tight: drop corners that a straight line can skip
        let mut cells = vec![goal];
        while let Some(&p) = came.get(cells.last().expect("not empty")) {
            cells.push(p);
            if p == start {
                break;
            }
        }
        cells.reverse();
        let points: Vec<(f32, f32)> = cells.iter().map(|&c| self.centre(c)).collect();
        let mut out = Vec::new();
        let mut anchor = from;
        let mut i = 0;
        while i < points.len() {
            let mut far = i;
            for j in (i..points.len()).rev() {
                if self.grid_clear(anchor, points[j]) {
                    far = j;
                    break;
                }
            }
            out.push(points[far]);
            anchor = points[far];
            i = far + 1;
        }
        if let Some(last) = out.last_mut()
            && self.grid_clear(*last, to)
        {
            *last = to;
        }
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two rooms side by side, 10 by 10, with a doorway 2 wide in the wall between them at z 4 to 6.
    fn rooms() -> (Walls, u32) {
        let mut w = Walls::default();
        for (x0, z0, x1, z1) in [
            (0.0, -0.5, 20.0, 0.0),
            (0.0, 10.0, 20.0, 10.5),
            (-0.5, 0.0, 0.0, 10.0),
            (20.0, 0.0, 20.5, 10.0),
        ] {
            w.add(x0, z0, x1, z1, 0.0, 3.0);
        }
        w.add(10.0, 0.0, 10.3, 4.0, 0.0, 3.0);
        w.add(10.0, 6.0, 10.3, 10.0, 0.0, 3.0);
        let door = w.add(10.0, 4.0, 10.3, 6.0, 0.0, 3.0);
        w.prepare();
        (w, door)
    }

    #[test]
    fn a_body_is_pushed_out_of_a_wall_and_slides_along_it() {
        let (w, _) = rooms();
        // standing 0.2 from the left wall with a radius of 0.5 is pushed out by 0.3
        let (dx, dz) = w.push(0.2, 5.0, 0.5, 0.0, 1.8);
        assert!((dx - 0.3).abs() < 1e-4 && dz.abs() < 1e-4, "{dx} {dz}");
        // a corner pushes both ways
        let (dx, dz) = w.push(0.2, 0.2, 0.5, 0.0, 1.8);
        assert!(dx > 0.2 && dz > 0.2, "{dx} {dz}");
        // far from walls: nothing
        assert_eq!(w.push(5.0, 5.0, 0.5, 0.0, 1.8), (0.0, 0.0));
        // a centre inside a wall is thrown out by the nearest face
        let (dx, _) = w.push(10.15, 2.0, 0.4, 0.0, 1.8);
        assert!(dx.abs() > 0.4, "{dx}");
        // above the wall's top or below its bottom there is no wall
        assert_eq!(w.push(0.2, 5.0, 0.5, 3.5, 1.8), (0.0, 0.0));
    }

    #[test]
    fn a_ray_stops_at_the_first_wall_and_says_which_face() {
        let (mut w, door) = rooms();
        w.set_on(door, false); // (open)
        // from the middle of the left room towards the right along z = 2: the dividing wall at x = 10
        let hit = w
            .raycast(5.0, 2.0, 1.0, 0.0, 30.0, 1.5, 0.0)
            .expect("a wall");
        assert!((hit.distance - 5.0).abs() < 1e-4, "{hit:?}");
        assert_eq!(
            (hit.nx, hit.nz),
            (-1.0, 0.0),
            "the face points back at the ray"
        );
        // through the doorway at z = 5 it goes on to the far wall at x = 20
        let hit = w
            .raycast(5.0, 5.0, 1.0, 0.0, 30.0, 1.5, 0.0)
            .expect("the far wall");
        assert!(
            (hit.distance - 15.0).abs() < 1e-4 && hit.id != door,
            "{hit:?}"
        );
        // shut the door and it is the door that stops it
        w.set_on(door, true);
        assert_eq!(
            w.raycast(5.0, 5.0, 1.0, 0.0, 30.0, 1.5, 0.0)
                .expect("the door")
                .id,
            door
        );
        // too short to reach
        assert!(w.raycast(5.0, 2.0, 1.0, 0.0, 4.0, 1.5, 0.0).is_none());
        // a ray rising 0.5 a metre is 6.25 high at the dividing wall, over its 3: it passes over every wall
        assert!(w.raycast(0.5, 2.0, 1.0, 0.0, 30.0, 1.5, 0.5).is_none());
        // rising 0.1 a metre it is 2.45 high there, and hits it
        assert!(
            w.raycast(0.5, 2.0, 1.0, 0.0, 30.0, 1.5, 0.1)
                .is_some_and(|h| (h.distance - 9.5).abs() < 1e-4)
        );
        // coming down onto the top of a wall from above, steeply, it hits the top: a face with no direction on the ground
        let top = w
            .raycast(10.1, 2.0, 1.0, 0.0, 1.0, 3.5, -4.0)
            .expect("the wall's top");
        assert!(
            (top.distance - 0.125).abs() < 1e-4 && (top.nx, top.nz) == (0.0, 0.0),
            "{top:?}"
        );
        // a ray that starts inside a wall hits it at once
        assert_eq!(
            w.raycast(10.15, 2.0, 1.0, 0.0, 5.0, 1.0, 0.0)
                .map(|h| h.distance),
            Some(0.0)
        );
    }

    #[test]
    fn sight_is_blocked_by_walls_and_by_closed_doors_only() {
        let (mut w, door) = rooms();
        assert!(
            w.line_clear(2.0, 2.0, 8.0, 8.0, 1.5, 1.5),
            "inside one room"
        );
        assert!(
            !w.line_clear(5.0, 2.0, 15.0, 2.0, 1.5, 1.5),
            "through the dividing wall"
        );
        w.set_on(door, false);
        assert!(
            w.line_clear(5.0, 5.0, 15.0, 5.0, 1.5, 1.5),
            "through the open doorway"
        );
        w.set_on(door, true);
        assert!(
            !w.line_clear(5.0, 5.0, 15.0, 5.0, 1.5, 1.5),
            "the door is shut"
        );
        // looking up over the wall: a high target (a bird?) sees past a 3 high wall
        assert!(w.line_clear(5.0, 2.0, 15.0, 2.0, 5.0, 5.0));
    }

    #[test]
    fn paths_go_through_the_doorway_and_not_through_a_shut_door() {
        let (mut w, door) = rooms();
        w.set_on(door, false);
        let nav = Nav::build(&w, -1.0, -1.0, 21.0, 11.0, 0.5, 0.4, 0.0, 1.8);
        let path = nav
            .path((3.0, 2.0), (17.0, 2.0))
            .expect("a way through the doorway");
        // it passes through the doorway: some point of it is near x = 10 with z between 4 and 6
        let through = path
            .iter()
            .any(|p| (p.0 - 10.15).abs() < 1.5 && (3.5..6.5).contains(&p.1));
        assert!(through, "{path:?}");
        assert_eq!(*path.last().unwrap(), (17.0, 2.0), "ends at the goal");
        // the string is pulled tight: a handful of corners, not a cell at a time
        assert!(path.len() <= 4, "{path:?}");
        // every leg of it is clear of walls for a body of the nav's size
        let mut at = (3.0f32, 2.0f32);
        for p in &path {
            assert!(nav.grid_clear(at, *p), "{at:?} -> {p:?}");
            at = *p;
        }
        // with the door shut there is no way
        w.set_on(door, true);
        let nav = Nav::build(&w, -1.0, -1.0, 21.0, 11.0, 0.5, 0.4, 0.0, 1.8);
        assert!(nav.path((3.0, 2.0), (17.0, 2.0)).is_none());
        // in one room it is a straight line
        let straight = nav.path((2.0, 2.0), (8.0, 8.0)).expect("open floor");
        assert_eq!(straight, vec![(8.0, 8.0)]);
        // a goal inside a wall goes to the nearest free place
        assert!(
            nav.path((2.0, 2.0), (-0.1, 5.0)).is_some(),
            "a goal inside the outer wall goes to the nearest free place in the room"
        );
        assert!(
            nav.is_blocked(10.15, 2.0) && !nav.is_blocked(5.0, 5.0) && nav.is_blocked(-50.0, 0.0)
        );
    }
}
