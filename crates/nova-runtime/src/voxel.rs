//! Voxel worlds: blocks stored in 16 x 128 x 16 chunks, lit by a flood fill (sky and torch light), turned into meshes
//! with ambient occlusion and smooth light baked into the vertices, plus the queries a game needs: a ray through the
//! blocks, a box that slides along them, and noise for making terrain.
//!
//! Everything here is plain data and maths. The Lua side (`voxel_lua.rs`) only calls into it, and the meshes it
//! produces leave as [`MeshOp`]s for the renderer.
//!
//! Coordinates: x and z are the ground, y is up, and block (x, y, z) fills [x, x+1) x [y, y+1) x [z, z+1).

use std::collections::{HashMap, VecDeque};

use glam::{Mat4, Vec4};

use crate::gfx::{DYN_MESH_BASE, MeshOp};
use crate::model::MeshVertex;

pub const SX: usize = 16;
pub const SY: usize = 128;
pub const SZ: usize = 16;
const VOL: usize = SX * SY * SZ;
/// Light goes from 0 (dark) to this.
pub const MAX_LIGHT: u8 = 15;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Shape {
    /// A full block.
    Cube,
    /// Two crossed flat pictures: grass, flowers, saplings.
    Cross,
    /// A thin post, standing on the floor of its cell.
    Torch,
}

#[derive(Clone, Debug)]
pub struct BlockDef {
    pub name: String,
    /// Atlas tile for each face: +x, -x, +y (top), -y (bottom), +z, -z.
    pub tiles: [u16; 6],
    /// A body cannot move through it.
    pub solid: bool,
    /// Stops light and hides the faces behind it.
    pub opaque: bool,
    pub liquid: bool,
    pub shape: Shape,
    /// Light it gives off, 0 to 15.
    pub glow: u8,
    /// Light lost passing through it, on top of the one level every step costs (water, leaves).
    pub dim: u8,
    /// Faces between two of these are not drawn (glass, leaves, water).
    pub cull_same: bool,
    /// 255 is solid colour; less is blended over what is behind it (water, ice).
    pub alpha: u8,
}

impl Default for BlockDef {
    fn default() -> Self {
        Self {
            name: String::new(),
            tiles: [0; 6],
            solid: true,
            opaque: true,
            liquid: false,
            shape: Shape::Cube,
            glow: 0,
            dim: 0,
            cull_same: false,
            alpha: 255,
        }
    }
}

pub struct Chunk {
    pub blocks: Vec<u8>,
    sky: Vec<u8>,
    glow: Vec<u8>,
    /// The meshes of this chunk: solid and cut-out faces, and blended ones (water).
    pub meshes: [Option<usize>; 2],
    /// Where the mesh content is (min x, y, z, max x, y, z), for culling.
    pub bounds: [f32; 6],
    /// The mesh is out of date.
    pub dirty: bool,
    /// Gameplay edits made since generation, as index -> block, for saving.
    pub edits: HashMap<u32, u8>,
    pub lit: bool,
}

impl Chunk {
    fn new() -> Self {
        Self {
            blocks: vec![0; VOL],
            sky: vec![0; VOL],
            glow: vec![0; VOL],
            meshes: [None, None],
            bounds: [0.0; 6],
            dirty: false,
            edits: HashMap::new(),
            lit: false,
        }
    }
}

#[derive(Default, Clone, Copy, Debug)]
pub struct Stats {
    pub chunks: usize,
    pub meshed: u32,
    pub mesh_ms: f32,
    pub light_ms: f32,
    pub faces: u32,
    pub drawn: u32,
}

pub struct World {
    pub defs: Vec<BlockDef>,
    pub chunks: HashMap<(i32, i32), Chunk>,
    pub tiles_per_row: u32,
    next_mesh: usize,
    free_ids: Vec<usize>,
    /// Mesh changes waiting for the renderer.
    pub ops: Vec<MeshOp>,
    /// The player's changes to chunks that are not loaded (and those read from a saved world), put back when they are made.
    pub saved: HashMap<(i32, i32), HashMap<u32, u8>>,
    pub stats: Stats,
}

#[inline]
fn idx(x: usize, y: usize, z: usize) -> usize {
    (y * SZ + z) * SX + x
}

/// The chunk a block is in, and its place inside it.
#[inline]
pub fn split(x: i32, z: i32) -> ((i32, i32), usize, usize) {
    (
        (x.div_euclid(SX as i32), z.div_euclid(SZ as i32)),
        x.rem_euclid(SX as i32) as usize,
        z.rem_euclid(SZ as i32) as usize,
    )
}

const DIRS: [[i32; 3]; 6] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
];

impl Default for World {
    fn default() -> Self {
        Self::new()
    }
}

impl World {
    pub fn new() -> Self {
        let air = BlockDef {
            name: "air".into(),
            solid: false,
            opaque: false,
            ..Default::default()
        };
        Self {
            defs: vec![air],
            chunks: HashMap::new(),
            tiles_per_row: 16,
            next_mesh: DYN_MESH_BASE,
            free_ids: Vec::new(),
            ops: Vec::new(),
            saved: HashMap::new(),
            stats: Stats::default(),
        }
    }

    pub fn define(&mut self, def: BlockDef) -> Result<u8, String> {
        if self.defs.len() >= 255 {
            return Err("at most 254 kinds of block".into());
        }
        if self.defs.iter().any(|d| d.name == def.name) {
            return Err(format!("a block called '{}' already exists", def.name));
        }
        self.defs.push(def);
        Ok((self.defs.len() - 1) as u8)
    }

    pub fn find(&self, name: &str) -> Option<u8> {
        self.defs
            .iter()
            .position(|d| d.name == name)
            .map(|i| i as u8)
    }

    fn def(&self, id: u8) -> &BlockDef {
        self.defs.get(id as usize).unwrap_or(&self.defs[0])
    }

    pub fn has_chunk(&self, cx: i32, cz: i32) -> bool {
        self.chunks.contains_key(&(cx, cz))
    }

    pub fn create_chunk(&mut self, cx: i32, cz: i32) {
        self.chunks.entry((cx, cz)).or_insert_with(Chunk::new);
    }

    /// Drops a chunk and its meshes. Neighbours are marked for rebuilding (their border faces change).
    pub fn unload_chunk(&mut self, cx: i32, cz: i32) {
        if let Some(chunk) = self.chunks.remove(&(cx, cz)) {
            if !chunk.edits.is_empty() {
                self.saved.insert((cx, cz), chunk.edits.clone());
            }
            for id in chunk.meshes.into_iter().flatten() {
                self.free_mesh(id);
            }
        }
        for dx in -1..=1 {
            for dz in -1..=1 {
                if let Some(c) = self.chunks.get_mut(&(cx + dx, cz + dz)) {
                    c.dirty = true;
                }
            }
        }
    }

    fn alloc_mesh(&mut self) -> usize {
        self.free_ids.pop().unwrap_or_else(|| {
            self.next_mesh += 1;
            self.next_mesh - 1
        })
    }

    fn free_mesh(&mut self, id: usize) {
        self.ops.push(MeshOp::Free(id));
        self.free_ids.push(id);
    }

    // ---- blocks -------------------------------------------------------------------------------

    /// The block at a place: 0 (air) outside the world's height and in chunks that are not loaded.
    pub fn get(&self, x: i32, y: i32, z: i32) -> u8 {
        if !(0..SY as i32).contains(&y) {
            return 0;
        }
        let (key, lx, lz) = split(x, z);
        match self.chunks.get(&key) {
            Some(c) => c.blocks[idx(lx, y as usize, lz)],
            None => 0,
        }
    }

    /// Sets a block without touching light or meshes (for generating a chunk). False when the chunk is not there.
    pub fn set_raw(&mut self, x: i32, y: i32, z: i32, id: u8) -> bool {
        if !(0..SY as i32).contains(&y) {
            return false;
        }
        let (key, lx, lz) = split(x, z);
        match self.chunks.get_mut(&key) {
            Some(c) => {
                c.blocks[idx(lx, y as usize, lz)] = id;
                true
            }
            None => false,
        }
    }

    /// Fills a box (both corners included) with one block, without touching light or meshes.
    pub fn fill(&mut self, a: [i32; 3], b: [i32; 3], id: u8) -> usize {
        let mut n = 0;
        let (y0, y1) = (a[1].min(b[1]).max(0), a[1].max(b[1]).min(SY as i32 - 1));
        for z in a[2].min(b[2])..=a[2].max(b[2]) {
            for x in a[0].min(b[0])..=a[0].max(b[0]) {
                let (key, lx, lz) = split(x, z);
                if let Some(c) = self.chunks.get_mut(&key) {
                    for y in y0..=y1 {
                        c.blocks[idx(lx, y as usize, lz)] = id;
                        n += 1;
                    }
                }
            }
        }
        n
    }

    /// Replaces blocks in a box with air where a 3D noise says so: caves. `ids` are the blocks it may dig through.
    pub fn carve(&mut self, min: [i32; 3], max: [i32; 3], c: &Carve) -> usize {
        let mut n = 0;
        for z in min[2]..=max[2] {
            for x in min[0]..=max[0] {
                let (key, lx, lz) = split(x, z);
                let Some(chunk) = self.chunks.get_mut(&key) else {
                    continue;
                };
                for y in min[1].max(1)..=max[1].min(SY as i32 - 2) {
                    let i = idx(lx, y as usize, lz);
                    if !c.ids[chunk.blocks[i] as usize] {
                        continue;
                    }
                    let p = [
                        x as f64 * c.scale[0],
                        y as f64 * c.scale[1],
                        z as f64 * c.scale[2],
                    ];
                    let open = if c.tunnels {
                        perlin3(p[0], p[1], p[2], c.seed).abs() < c.threshold
                            && perlin3(p[0] + 31.7, p[1] - 7.3, p[2] + 11.1, c.seed.wrapping_add(1))
                                .abs()
                                < c.threshold
                    } else {
                        perlin3(p[0], p[1], p[2], c.seed) > c.threshold
                    };
                    if open {
                        chunk.blocks[i] = 0;
                        n += 1;
                    }
                }
            }
        }
        n
    }

    // ---- light --------------------------------------------------------------------------------

    fn light_at(&self, ch: usize, x: i32, y: i32, z: i32) -> u8 {
        if y >= SY as i32 {
            return if ch == 0 { MAX_LIGHT } else { 0 };
        }
        if y < 0 {
            return 0;
        }
        let (key, lx, lz) = split(x, z);
        match self.chunks.get(&key) {
            Some(c) => {
                if ch == 0 {
                    c.sky[idx(lx, y as usize, lz)]
                } else {
                    c.glow[idx(lx, y as usize, lz)]
                }
            }
            None => 0,
        }
    }

    /// Sets light and marks the chunk for rebuilding when it changed. False when there is no such cell.
    fn set_light(&mut self, ch: usize, x: i32, y: i32, z: i32, v: u8) -> bool {
        if !(0..SY as i32).contains(&y) {
            return false;
        }
        let (key, lx, lz) = split(x, z);
        let Some(c) = self.chunks.get_mut(&key) else {
            return false;
        };
        let i = idx(lx, y as usize, lz);
        let slot = if ch == 0 {
            &mut c.sky[i]
        } else {
            &mut c.glow[i]
        };
        if *slot != v {
            *slot = v;
            c.dirty = true;
        }
        true
    }

    /// Light levels (sky, torch) at a cell.
    pub fn light(&self, x: i32, y: i32, z: i32) -> (u8, u8) {
        (self.light_at(0, x, y, z), self.light_at(1, x, y, z))
    }

    fn cell_exists(&self, x: i32, y: i32, z: i32) -> bool {
        (0..SY as i32).contains(&y) && self.chunks.contains_key(&split(x, z).0)
    }

    /// Spreads light outward from the cells in `queue`, which already hold their level.
    fn spread(&mut self, ch: usize, mut queue: VecDeque<[i32; 3]>) {
        while let Some([x, y, z]) = queue.pop_front() {
            let level = self.light_at(ch, x, y, z);
            if level == 0 {
                continue;
            }
            for (k, d) in DIRS.iter().enumerate() {
                let (nx, ny, nz) = (x + d[0], y + d[1], z + d[2]);
                if !self.cell_exists(nx, ny, nz) {
                    continue;
                }
                let def = self.def(self.get(nx, ny, nz));
                if def.opaque {
                    continue;
                }
                // sky light falls straight down without fading
                let step = if ch == 0 && k == 3 {
                    def.dim
                } else {
                    1 + def.dim
                };
                let next = level.saturating_sub(step);
                if next > self.light_at(ch, nx, ny, nz) {
                    self.set_light(ch, nx, ny, nz, next);
                    queue.push_back([nx, ny, nz]);
                }
            }
        }
    }

    /// Takes away the light that came through `start` (which held `old`) and puts back what other sources still give.
    fn unspread(&mut self, ch: usize, start: [i32; 3], old: u8) {
        let mut remove: VecDeque<([i32; 3], u8)> = VecDeque::new();
        let mut again: VecDeque<[i32; 3]> = VecDeque::new();
        self.set_light(ch, start[0], start[1], start[2], 0);
        remove.push_back((start, old));
        while let Some(([x, y, z], level)) = remove.pop_front() {
            for (k, d) in DIRS.iter().enumerate() {
                let (nx, ny, nz) = (x + d[0], y + d[1], z + d[2]);
                if !self.cell_exists(nx, ny, nz) {
                    continue;
                }
                let v = self.light_at(ch, nx, ny, nz);
                if v == 0 {
                    continue;
                }
                let down = ch == 0 && k == 3;
                if v < level || (down && v <= level) {
                    self.set_light(ch, nx, ny, nz, 0);
                    remove.push_back(([nx, ny, nz], v));
                    let glow = self.def(self.get(nx, ny, nz)).glow;
                    if ch == 1 && glow > 0 {
                        self.set_light(1, nx, ny, nz, glow);
                        again.push_back([nx, ny, nz]);
                    }
                } else {
                    again.push_back([nx, ny, nz]);
                }
            }
        }
        self.spread(ch, again);
    }

    /// Light for a new chunk: sky straight down every column, torches, then the flood across the whole chunk and over its
    /// borders into (and from) the chunks that are already there.
    #[allow(clippy::needless_range_loop)] // (the loops index a 16 x 16 table of heights and compute world places from the same numbers)
    pub fn light_chunk(&mut self, cx: i32, cz: i32) {
        let t = std::time::Instant::now();
        if !self.chunks.contains_key(&(cx, cz)) {
            return;
        }
        let (bx, bz) = (cx * SX as i32, cz * SZ as i32);
        let mut sky_queue: VecDeque<[i32; 3]> = VecDeque::new();
        let mut glow_queue: VecDeque<[i32; 3]> = VecDeque::new();
        // sky columns, and the height from which each column sees the whole sky
        let mut tops = [[0i32; SZ]; SX];
        {
            let defs = self.defs.clone();
            let chunk = self.chunks.get_mut(&(cx, cz)).expect("checked");
            for lz in 0..SZ {
                for lx in 0..SX {
                    let mut level = MAX_LIGHT;
                    let mut top = 0;
                    for y in (0..SY).rev() {
                        let i = idx(lx, y, lz);
                        let d = &defs[chunk.blocks[i] as usize];
                        if d.opaque {
                            level = 0;
                        } else {
                            level = level.saturating_sub(d.dim);
                        }
                        if level < MAX_LIGHT && top == 0 {
                            top = y as i32 + 1;
                        }
                        chunk.sky[i] = level;
                        chunk.glow[i] = d.glow;
                        if d.glow > 0 {
                            glow_queue.push_back([bx + lx as i32, y as i32, bz + lz as i32]);
                        }
                    }
                    tops[lx][lz] = top;
                }
            }
            chunk.dirty = true;
            chunk.lit = true;
        }
        // where light could spill sideways out of a column that sees the sky into a neighbour that does not
        for lz in 0..SZ {
            for lx in 0..SX {
                let (wx, wz) = (bx + lx as i32, bz + lz as i32);
                let own = tops[lx][lz];
                for k in [0usize, 1, 4, 5] {
                    let d = DIRS[k];
                    let (nx, nz) = (wx + d[0], wz + d[2]);
                    let other = if (0..SX as i32).contains(&(lx as i32 + d[0]))
                        && (0..SZ as i32).contains(&(lz as i32 + d[2]))
                    {
                        tops[(lx as i32 + d[0]) as usize][(lz as i32 + d[2]) as usize]
                    } else {
                        self.column_top(nx, nz).unwrap_or(0)
                    };
                    for y in own..other.max(own) {
                        sky_queue.push_back([wx, y, wz]);
                    }
                }
                // decayed light under leaves and water
                for y in 0..own.max(0) {
                    if self.light_at(0, wx, y, wz) > 1 {
                        sky_queue.push_back([wx, y, wz]);
                    }
                }
            }
        }
        // across the borders, both ways
        for i in 0..SX.max(SZ) as i32 {
            for y in 0..SY as i32 {
                let cells = [
                    ([bx + i, bz], [bx + i, bz - 1]),
                    ([bx + i, bz + SZ as i32 - 1], [bx + i, bz + SZ as i32]),
                    ([bx, bz + i], [bx - 1, bz + i]),
                    ([bx + SX as i32 - 1, bz + i], [bx + SX as i32, bz + i]),
                ];
                for (inside, outside) in cells {
                    for (queue, ch) in [(&mut sky_queue, 0), (&mut glow_queue, 1)] {
                        if self.light_at(ch, inside[0], y, inside[1]) > 1 {
                            queue.push_back([inside[0], y, inside[1]]);
                        }
                        if self.light_at(ch, outside[0], y, outside[1]) > 1 {
                            queue.push_back([outside[0], y, outside[1]]);
                        }
                    }
                }
            }
        }
        self.spread(0, sky_queue);
        self.spread(1, glow_queue);
        self.stats.light_ms += t.elapsed().as_secs_f32() * 1000.0;
    }

    /// The y from which a column sees the whole sky (just above its highest opaque or dimming block).
    fn column_top(&self, x: i32, z: i32) -> Option<i32> {
        let (key, lx, lz) = split(x, z);
        let chunk = self.chunks.get(&key)?;
        for y in (0..SY).rev() {
            let d = self.def(chunk.blocks[idx(lx, y, lz)]);
            if d.opaque || d.dim > 0 {
                return Some(y as i32 + 1);
            }
        }
        Some(0)
    }

    /// A player's or a game's change to the world: sets the block, keeps the light right, remembers it for saving and
    /// marks the meshes that show it. False when the chunk is not loaded.
    pub fn edit(&mut self, x: i32, y: i32, z: i32, id: u8) -> bool {
        if !(0..SY as i32).contains(&y) || !self.chunks.contains_key(&split(x, z).0) {
            return false;
        }
        if self.get(x, y, z) == id {
            return true;
        }
        let t = std::time::Instant::now();
        let (key, lx, lz) = split(x, z);
        {
            let c = self.chunks.get_mut(&key).expect("checked");
            let i = idx(lx, y as usize, lz);
            c.blocks[i] = id;
            c.edits.insert(i as u32, id);
            c.dirty = true;
        }
        // the neighbours' border faces and light samples change too
        for d in [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
            [-1, -1],
            [1, -1],
            [-1, 1],
        ] {
            let (nk, _, _) = split(x + d[0], z + d[1]);
            if nk != key
                && (lx == 0 || lx == SX - 1 || lz == 0 || lz == SZ - 1)
                && let Some(n) = self.chunks.get_mut(&nk)
            {
                n.dirty = true;
            }
        }
        let p = [x, y, z];
        for ch in 0..2 {
            let old = self.light_at(ch, x, y, z);
            if old > 0 {
                self.unspread(ch, p, old);
            }
            let mut queue = VecDeque::new();
            if ch == 1 {
                let glow = self.def(id).glow;
                if glow > 0 {
                    self.set_light(1, x, y, z, glow);
                    queue.push_back(p);
                }
            } else if !self.def(id).opaque && y == SY as i32 - 1 {
                let v = MAX_LIGHT.saturating_sub(self.def(id).dim);
                self.set_light(0, x, y, z, v);
                queue.push_back(p);
            }
            // light from around flows into the cell if it lets light through now
            for d in DIRS {
                let n = [x + d[0], y + d[1], z + d[2]];
                if self.cell_exists(n[0], n[1], n[2]) && self.light_at(ch, n[0], n[1], n[2]) > 0 {
                    queue.push_back(n);
                }
            }
            // an emitter that is opaque keeps its own glow
            if ch == 1 && self.def(id).glow == 0 {
                self.set_light(1, x, y, z, 0);
            }
            self.spread(ch, queue);
        }
        self.stats.light_ms += t.elapsed().as_secs_f32() * 1000.0;
        true
    }

    // ---- meshing ------------------------------------------------------------------------------

    /// All eight neighbours are loaded and lit, which smooth light and occlusion need at the border.
    pub fn can_mesh(&self, cx: i32, cz: i32) -> bool {
        (-1..=1).all(|dx| {
            (-1..=1).all(|dz| self.chunks.get(&(cx + dx, cz + dz)).is_some_and(|c| c.lit))
        })
    }

    /// The chunks that need a new mesh and can have one, nearest to a place first.
    pub fn dirty_chunks(&self, near: [f32; 2]) -> Vec<(i32, i32)> {
        let mut list: Vec<((i32, i32), f32)> = self
            .chunks
            .iter()
            .filter(|(k, c)| c.dirty && c.lit && self.can_mesh(k.0, k.1))
            .map(|(k, _)| {
                let dx = (k.0 * SX as i32 + 8) as f32 - near[0];
                let dz = (k.1 * SZ as i32 + 8) as f32 - near[1];
                (*k, dx * dx + dz * dz)
            })
            .collect();
        list.sort_by(|a, b| a.1.total_cmp(&b.1));
        list.into_iter().map(|(k, _)| k).collect()
    }

    /// Builds the meshes of one chunk and queues them for the renderer.
    pub fn mesh_chunk(&mut self, cx: i32, cz: i32) {
        let t = std::time::Instant::now();
        let mut solid = MeshBuild::default();
        let mut blend = MeshBuild::default();
        let (bx, bz) = (cx * SX as i32, cz * SZ as i32);
        let mut lo = [f32::MAX; 3];
        let mut hi = [f32::MIN; 3];
        {
            let me = &*self;
            let chunk = &me.chunks[&(cx, cz)];
            for y in 0..SY {
                for lz in 0..SZ {
                    for lx in 0..SX {
                        let b = chunk.blocks[idx(lx, y, lz)];
                        if b == 0 {
                            continue;
                        }
                        let def = me.def(b);
                        let (x, yy, z) = (bx + lx as i32, y as i32, bz + lz as i32);
                        let target = if def.alpha < 255 {
                            &mut blend
                        } else {
                            &mut solid
                        };
                        let before = target.vertices.len();
                        match def.shape {
                            Shape::Cube => me.mesh_cube(target, def, b, x, yy, z),
                            Shape::Cross => me.mesh_cross(target, def, x, yy, z),
                            Shape::Torch => me.mesh_torch(target, def, x, yy, z),
                        }
                        if target.vertices.len() > before {
                            lo = [
                                lo[0].min(x as f32),
                                lo[1].min(yy as f32),
                                lo[2].min(z as f32),
                            ];
                            hi = [
                                hi[0].max(x as f32 + 1.0),
                                hi[1].max(yy as f32 + 1.0),
                                hi[2].max(z as f32 + 1.0),
                            ];
                        }
                    }
                }
            }
        }
        let faces = (solid.indices.len() + blend.indices.len()) as u32 / 6;
        let old = self.chunks[&(cx, cz)].meshes;
        let mut meshes = [None, None];
        for (slot, build) in [solid, blend].into_iter().enumerate() {
            if build.indices.is_empty() {
                if let Some(id) = old[slot] {
                    self.free_mesh(id);
                }
                continue;
            }
            let id = match old[slot] {
                Some(id) => id,
                None => self.alloc_mesh(),
            };
            self.ops.push(MeshOp::Upload {
                id,
                vertices: build.vertices,
                indices: build.indices,
            });
            meshes[slot] = Some(id);
        }
        let chunk = self.chunks.get_mut(&(cx, cz)).expect("exists");
        chunk.meshes = meshes;
        chunk.dirty = false;
        chunk.bounds = if lo[0] == f32::MAX {
            [0.0; 6]
        } else {
            [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]]
        };
        self.stats.meshed += 1;
        self.stats.faces = faces;
        self.stats.mesh_ms += t.elapsed().as_secs_f32() * 1000.0;
    }

    fn tile_uv(&self, tile: u16, u: f32, v: f32) -> [f32; 2] {
        let n = self.tiles_per_row.max(1);
        let (tx, ty) = (tile as u32 % n, tile as u32 / n);
        let s = 1.0 / n as f32;
        [(tx as f32 + u) * s, (ty as f32 + v) * s]
    }

    fn opaque_at(&self, x: i32, y: i32, z: i32) -> bool {
        if y < 0 {
            return true;
        }
        self.def(self.get(x, y, z)).opaque
    }

    /// Smooth light and ambient occlusion for the four corners of one face of the cell (x, y, z), from the cells in front.
    fn face_corners(&self, p: [i32; 3], k: usize) -> ([f32; 4], [f32; 4], [u8; 4]) {
        let d = DIRS[k];
        let (t1, t2) = FACE_AXES[k];
        let front = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
        let mut sky = [0.0; 4];
        let mut glow = [0.0; 4];
        let mut ao = [3u8; 4];
        for (c, (s1, s2)) in CORNERS.iter().enumerate() {
            let at = |a: i32, b: i32| {
                [
                    front[0] + t1[0] * a + t2[0] * b,
                    front[1] + t1[1] * a + t2[1] * b,
                    front[2] + t1[2] * a + t2[2] * b,
                ]
            };
            let side1 = at(*s1, 0);
            let side2 = at(0, *s2);
            let corner = at(*s1, *s2);
            let o1 = self.opaque_at(side1[0], side1[1], side1[2]);
            let o2 = self.opaque_at(side2[0], side2[1], side2[2]);
            let oc = self.opaque_at(corner[0], corner[1], corner[2]);
            ao[c] = if o1 && o2 {
                0
            } else {
                3 - (o1 as u8 + o2 as u8 + oc as u8)
            };
            // average the light of the cells that are open
            let mut cells = vec![front];
            if !o1 {
                cells.push(side1);
            }
            if !o2 {
                cells.push(side2);
            }
            if !oc && !(o1 && o2) {
                cells.push(corner);
            }
            let n = cells.len() as f32;
            let (mut s, mut g) = (0.0, 0.0);
            for q in cells {
                let (a, b) = self.light(q[0], q[1], q[2]);
                s += a as f32;
                g += b as f32;
            }
            sky[c] = s / n;
            glow[c] = g / n;
        }
        (sky, glow, ao)
    }

    fn mesh_cube(&self, out: &mut MeshBuild, def: &BlockDef, id: u8, x: i32, y: i32, z: i32) {
        let top = if def.liquid && !self.def(self.get(x, y + 1, z)).liquid {
            0.875
        } else {
            1.0
        };
        for k in 0..6 {
            let d = DIRS[k];
            let n = self.get(x + d[0], y + d[1], z + d[2]);
            let nd = self.def(n);
            if nd.opaque || (n == id && def.cull_same) {
                continue;
            }
            if y + d[1] < 0 {
                continue;
            }
            let (sky, glow, ao) = self.face_corners([x, y, z], k);
            let (t1, t2) = FACE_AXES[k];
            let mut verts = [[0f32; 3]; 4];
            let mut uvs = [[0f32; 2]; 4];
            for (c, (s1, s2)) in CORNERS.iter().enumerate() {
                let local = [
                    0.5 + 0.5 * (d[0] + t1[0] * s1 + t2[0] * s2) as f32,
                    0.5 + 0.5 * (d[1] + t1[1] * s1 + t2[1] * s2) as f32,
                    0.5 + 0.5 * (d[2] + t1[2] * s1 + t2[2] * s2) as f32,
                ];
                verts[c] = [
                    x as f32 + local[0],
                    y as f32 + local[1] * top,
                    z as f32 + local[2],
                ];
                let (u, v) = match k {
                    0 => (1.0 - local[2], 1.0 - local[1]),
                    1 => (local[2], 1.0 - local[1]),
                    2 => (local[0], local[2]),
                    3 => (local[0], 1.0 - local[2]),
                    4 => (local[0], 1.0 - local[1]),
                    _ => (1.0 - local[0], 1.0 - local[1]),
                };
                uvs[c] = self.tile_uv(def.tiles[k], u, v);
            }
            out.quad(
                &verts,
                &uvs,
                &sky,
                &glow,
                &ao,
                FACE_SHADE[k],
                def.alpha,
                false,
            );
            // a water surface is seen from below too
            if def.liquid && k == 2 {
                out.quad(
                    &verts,
                    &uvs,
                    &sky,
                    &glow,
                    &ao,
                    FACE_SHADE[k],
                    def.alpha,
                    true,
                );
            }
        }
    }

    fn own_light(&self, x: i32, y: i32, z: i32) -> ([f32; 4], [f32; 4]) {
        let (s, g) = self.light(x, y, z);
        ([s as f32; 4], [g as f32; 4])
    }

    fn mesh_cross(&self, out: &mut MeshBuild, def: &BlockDef, x: i32, y: i32, z: i32) {
        let (sky, glow) = self.own_light(x, y, z);
        let (fx, fy, fz) = (x as f32, y as f32, z as f32);
        let uvs = [
            self.tile_uv(def.tiles[0], 0.0, 1.0),
            self.tile_uv(def.tiles[0], 1.0, 1.0),
            self.tile_uv(def.tiles[0], 1.0, 0.0),
            self.tile_uv(def.tiles[0], 0.0, 0.0),
        ];
        for (a, b) in [([0.0, 0.0], [1.0, 1.0]), ([1.0, 0.0], [0.0, 1.0])] {
            let verts = [
                [fx + a[0], fy, fz + a[1]],
                [fx + b[0], fy, fz + b[1]],
                [fx + b[0], fy + 1.0, fz + b[1]],
                [fx + a[0], fy + 1.0, fz + a[1]],
            ];
            out.quad(&verts, &uvs, &sky, &glow, &[3; 4], 0.95, 255, false);
            out.quad(&verts, &uvs, &sky, &glow, &[3; 4], 0.95, 255, true);
        }
    }

    fn mesh_torch(&self, out: &mut MeshBuild, def: &BlockDef, x: i32, y: i32, z: i32) {
        let (sky, glow) = self.own_light(x, y, z);
        let (lo, hi, height) = (7.0 / 16.0, 9.0 / 16.0, 10.0 / 16.0);
        let (fx, fy, fz) = (x as f32, y as f32, z as f32);
        for k in 0..6 {
            let d = DIRS[k];
            let (t1, t2) = FACE_AXES[k];
            let mut verts = [[0f32; 3]; 4];
            let mut uvs = [[0f32; 2]; 4];
            for (c, (s1, s2)) in CORNERS.iter().enumerate() {
                let q = [
                    d[0] + t1[0] * s1 + t2[0] * s2,
                    d[1] + t1[1] * s1 + t2[1] * s2,
                    d[2] + t1[2] * s1 + t2[2] * s2,
                ];
                let px = if q[0] > 0 { hi } else { lo };
                let pz = if q[2] > 0 { hi } else { lo };
                let py = if q[1] > 0 { height } else { 0.0 };
                verts[c] = [fx + px, fy + py, fz + pz];
                let (u, v) = match k {
                    2 => (
                        (px - lo) / (hi - lo) * 0.125 + 0.4375,
                        0.375 + (pz - lo) / (hi - lo) * 0.125,
                    ),
                    3 => (0.4375, 0.9),
                    0 | 1 => (
                        0.4375
                            + (if k == 0 {
                                1.0 - (pz - lo) / (hi - lo)
                            } else {
                                (pz - lo) / (hi - lo)
                            }) * 0.125,
                        1.0 - py,
                    ),
                    _ => (
                        0.4375
                            + (if k == 4 {
                                (px - lo) / (hi - lo)
                            } else {
                                1.0 - (px - lo) / (hi - lo)
                            }) * 0.125,
                        1.0 - py,
                    ),
                };
                uvs[c] = self.tile_uv(def.tiles[0], u, v);
            }
            out.quad(
                &verts,
                &uvs,
                &sky,
                &glow,
                &[3; 4],
                FACE_SHADE[k].max(0.8),
                255,
                false,
            );
        }
    }

    // ---- queries ------------------------------------------------------------------------------

    /// A ray through the blocks. Stops at the first block that is not air and not a liquid (a liquid too when `liquids`).
    /// Gives the block, the face it entered through (the way that face points) and how far along the ray it was.
    pub fn raycast(&self, o: [f64; 3], dir: [f64; 3], max: f64, liquids: bool) -> Option<Hit> {
        let len = (dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]).sqrt();
        if len < 1e-9 {
            return None;
        }
        let d = [dir[0] / len, dir[1] / len, dir[2] / len];
        let mut cell = [
            o[0].floor() as i32,
            o[1].floor() as i32,
            o[2].floor() as i32,
        ];
        let mut step = [0i32; 3];
        let mut t_max = [f64::INFINITY; 3];
        let mut t_delta = [f64::INFINITY; 3];
        for a in 0..3 {
            if d[a] > 0.0 {
                step[a] = 1;
                t_delta[a] = 1.0 / d[a];
                t_max[a] = (cell[a] as f64 + 1.0 - o[a]) / d[a];
            } else if d[a] < 0.0 {
                step[a] = -1;
                t_delta[a] = -1.0 / d[a];
                t_max[a] = (o[a] - cell[a] as f64) / -d[a];
            }
        }
        let mut t = 0.0;
        let mut normal = [0, 0, 0];
        for _ in 0..4096 {
            let b = self.get(cell[0], cell[1], cell[2]);
            if b != 0 {
                let def = self.def(b);
                if !def.liquid || liquids {
                    return Some(Hit {
                        cell,
                        normal,
                        distance: t,
                        block: b,
                    });
                }
            }
            let a = if t_max[0] < t_max[1] && t_max[0] < t_max[2] {
                0
            } else if t_max[1] < t_max[2] {
                1
            } else {
                2
            };
            t = t_max[a];
            if t > max {
                return None;
            }
            cell[a] += step[a];
            t_max[a] += t_delta[a];
            normal = [0, 0, 0];
            normal[a] = -step[a];
        }
        None
    }

    fn solid_at(&self, x: i32, y: i32, z: i32) -> bool {
        self.def(self.get(x, y, z)).solid
    }

    /// Moves a box (feet at `pos`, `hw` either side, `h` tall) by `delta`, sliding along solid blocks like a walking
    /// body: up and down first, then each horizontal axis. `step` is the height it climbs without jumping (0 for none).
    pub fn move_box(&self, pos: [f64; 3], hw: f64, h: f64, delta: [f64; 3], step: f64) -> Moved {
        let bb = [
            pos[0] - hw,
            pos[1],
            pos[2] - hw,
            pos[0] + hw,
            pos[1] + h,
            pos[2] + hw,
        ];
        let was_grounded = {
            let mut probe = bb;
            self.clip(&mut probe, 1, -0.02) > -0.02 + 1e-9
        };
        let (mut moved, mut hit) = self.slide(bb, delta);
        if step > 0.0 && (hit[0] || hit[2]) && (was_grounded || (hit[1] && delta[1] < 0.0)) {
            // try the same walk from a step higher, then come back down onto whatever is there
            let mut up = bb;
            let lift = self.clip(&mut up, 1, step);
            let (mut over, over_hit) = self.slide(up, [delta[0], 0.0, delta[2]]);
            let mut down_hit = false;
            let fall = self.clip(&mut over, 1, -lift);
            if fall > -lift + 1e-9 {
                down_hit = true;
            }
            let (a, b) = (
                (moved[0] - bb[0]).powi(2) + (moved[2] - bb[2]).powi(2),
                (over[0] - bb[0]).powi(2) + (over[2] - bb[2]).powi(2),
            );
            if b > a + 1e-9 {
                moved = over;
                hit = [over_hit[0], down_hit || hit[1], over_hit[2]];
            }
        }
        let on_ground = hit[1] && delta[1] <= 0.0 || (was_grounded && delta[1] <= 0.0);
        let on_ground = on_ground && {
            let mut probe = moved;
            self.clip(&mut probe, 1, -0.02) > -0.02 + 1e-9
        };
        Moved {
            pos: [
                (moved[0] + moved[3]) * 0.5,
                moved[1],
                (moved[2] + moved[5]) * 0.5,
            ],
            hit,
            on_ground,
        }
    }

    fn slide(&self, mut bb: [f64; 6], delta: [f64; 3]) -> ([f64; 6], [bool; 3]) {
        let mut hit = [false; 3];
        for axis in [1usize, 0, 2] {
            let want = delta[axis];
            let got = self.clip(&mut bb, axis, want);
            hit[axis] = (got - want).abs() > 1e-9;
        }
        (bb, hit)
    }

    /// Moves the box along one axis as far as `d` allows (in small pieces) and returns how far it went.
    fn clip(&self, bb: &mut [f64; 6], axis: usize, d: f64) -> f64 {
        let pieces = (d.abs() / 0.4).ceil().max(1.0) as usize;
        let each = d / pieces as f64;
        let mut total = 0.0;
        for _ in 0..pieces {
            let allowed = self.clip_once(bb, axis, each);
            bb[axis] += allowed;
            bb[axis + 3] += allowed;
            total += allowed;
            if (allowed - each).abs() > 1e-12 {
                break;
            }
        }
        total
    }

    fn clip_once(&self, bb: &[f64; 6], axis: usize, d: f64) -> f64 {
        if d == 0.0 {
            return 0.0;
        }
        const EPS: f64 = 1e-7;
        let (a1, a2) = match axis {
            0 => (1, 2),
            1 => (0, 2),
            _ => (0, 1),
        };
        let mut lo = [0i32; 3];
        let mut hi = [0i32; 3];
        for a in 0..3 {
            let (mut mn, mut mx) = (bb[a], bb[a + 3]);
            if a == axis {
                if d > 0.0 {
                    mx += d;
                } else {
                    mn += d;
                }
            }
            lo[a] = (mn + EPS).floor() as i32;
            hi[a] = (mx - EPS).floor() as i32;
        }
        let mut allowed = d;
        for x in lo[0]..=hi[0] {
            for y in lo[1]..=hi[1] {
                for z in lo[2]..=hi[2] {
                    if !self.solid_at(x, y, z) {
                        continue;
                    }
                    let c = [x as f64, y as f64, z as f64];
                    // overlap on the other two axes
                    if bb[a1 + 3] <= c[a1] + EPS || bb[a1] >= c[a1] + 1.0 - EPS {
                        continue;
                    }
                    if bb[a2 + 3] <= c[a2] + EPS || bb[a2] >= c[a2] + 1.0 - EPS {
                        continue;
                    }
                    if allowed > 0.0 && bb[axis + 3] <= c[axis] + EPS {
                        allowed = allowed.min(c[axis] - bb[axis + 3]);
                    } else if allowed < 0.0 && bb[axis] >= c[axis] + 1.0 - EPS {
                        allowed = allowed.max(c[axis] + 1.0 - bb[axis]);
                    }
                }
            }
        }
        allowed
    }

    // ---- saving -------------------------------------------------------------------------------

    /// The gameplay edits of a chunk as hex text (three bytes each: place in the chunk, block), or nothing when it has none.
    pub fn export_edits(&self, cx: i32, cz: i32) -> Option<String> {
        let c = self.chunks.get(&(cx, cz))?;
        if c.edits.is_empty() {
            return None;
        }
        let mut keys: Vec<_> = c.edits.iter().collect();
        keys.sort();
        let mut s = String::with_capacity(keys.len() * 6);
        for (i, id) in keys {
            s.push_str(&format!("{:04x}{:02x}", i, id));
        }
        Some(s)
    }

    /// Puts saved edits back into a chunk (before it is lit).
    pub fn import_edits(&mut self, cx: i32, cz: i32, text: &str) -> Result<usize, String> {
        let c = self
            .chunks
            .get_mut(&(cx, cz))
            .ok_or("chunk is not loaded")?;
        if !text.len().is_multiple_of(6) || !text.is_ascii() {
            return Err("saved edits are damaged".into());
        }
        let mut n = 0;
        for chunk in text.as_bytes().chunks(6) {
            let s = std::str::from_utf8(chunk).map_err(|e| e.to_string())?;
            let i = u32::from_str_radix(&s[..4], 16).map_err(|e| e.to_string())?;
            let id = u8::from_str_radix(&s[4..], 16).map_err(|e| e.to_string())?;
            if (i as usize) < VOL {
                c.blocks[i as usize] = id;
                c.edits.insert(i, id);
                n += 1;
            }
        }
        Ok(n)
    }

    /// Puts back what the player changed in this chunk before it was dropped, or was read from a saved world.
    pub fn apply_saved(&mut self, cx: i32, cz: i32) -> usize {
        let Some(edits) = self.saved.get(&(cx, cz)) else {
            return 0;
        };
        let Some(c) = self.chunks.get_mut(&(cx, cz)) else {
            return 0;
        };
        for (&i, &id) in edits {
            if (i as usize) < VOL {
                c.blocks[i as usize] = id;
                c.edits.insert(i, id);
            }
        }
        edits.len()
    }

    /// Every change the player made, loaded or not, as one file: "NVX1", a count, then for each chunk its place, how many
    /// changes it has and each as (place in the chunk: 2 bytes, block: 1 byte).
    pub fn encode_world(&self) -> Vec<u8> {
        let mut all: std::collections::BTreeMap<(i32, i32), &HashMap<u32, u8>> =
            std::collections::BTreeMap::new();
        for (k, e) in &self.saved {
            all.insert(*k, e);
        }
        for (k, c) in &self.chunks {
            if !c.edits.is_empty() {
                all.insert(*k, &c.edits);
            } else {
                all.remove(k);
            }
        }
        let mut out = b"NVX1".to_vec();
        out.extend((all.len() as u32).to_le_bytes());
        for ((cx, cz), edits) in all {
            out.extend(cx.to_le_bytes());
            out.extend(cz.to_le_bytes());
            out.extend((edits.len() as u32).to_le_bytes());
            let mut sorted: Vec<_> = edits.iter().collect();
            sorted.sort();
            for (i, id) in sorted {
                out.extend((*i as u16).to_le_bytes());
                out.push(*id);
            }
        }
        out
    }

    /// Reads a file made by `encode_world` into the kept changes (replacing them); returns how many chunks it holds.
    pub fn decode_world(&mut self, bytes: &[u8]) -> Result<usize, String> {
        let bad = || "the world file is damaged".to_string();
        let mut at = 0usize;
        let mut take = |n: usize| -> Result<&[u8], String> {
            let s = bytes.get(at..at + n).ok_or_else(bad)?;
            at += n;
            Ok(s)
        };
        if take(4)? != b"NVX1" {
            return Err("this is not a world file".into());
        }
        let count = u32::from_le_bytes(take(4)?.try_into().map_err(|_| bad())?) as usize;
        let mut saved = HashMap::new();
        for _ in 0..count {
            let cx = i32::from_le_bytes(take(4)?.try_into().map_err(|_| bad())?);
            let cz = i32::from_le_bytes(take(4)?.try_into().map_err(|_| bad())?);
            let n = u32::from_le_bytes(take(4)?.try_into().map_err(|_| bad())?) as usize;
            let mut edits = HashMap::with_capacity(n);
            for _ in 0..n {
                let i = u16::from_le_bytes(take(2)?.try_into().map_err(|_| bad())?);
                let id = take(1)?[0];
                edits.insert(i as u32, id);
            }
            saved.insert((cx, cz), edits);
        }
        self.saved = saved;
        Ok(count)
    }

    pub fn modified_chunks(&self) -> Vec<(i32, i32)> {
        let mut v: Vec<_> = self
            .chunks
            .iter()
            .filter(|(_, c)| !c.edits.is_empty())
            .map(|(k, _)| *k)
            .collect();
        v.sort();
        v
    }

    /// Meshes to draw this frame: every chunk within `distance` chunks that the view can see.
    pub fn visible(
        &mut self,
        eye: [f32; 3],
        distance: f32,
        view_proj: &Mat4,
    ) -> Vec<(usize, bool)> {
        let frustum = Frustum::new(view_proj);
        let max2 = (distance * SX as f32).powi(2);
        let mut out = Vec::new();
        let mut solid_first: Vec<((i32, i32), f32)> = Vec::new();
        for (key, c) in &self.chunks {
            if c.meshes == [None, None] {
                continue;
            }
            let b = c.bounds;
            let nx = eye[0].clamp(b[0], b[3]) - eye[0];
            let nz = eye[2].clamp(b[2], b[5]) - eye[2];
            let d2 = nx * nx + nz * nz;
            if d2 > max2 || !frustum.sees([b[0], b[1], b[2]], [b[3], b[4], b[5]]) {
                continue;
            }
            solid_first.push((*key, d2));
        }
        // far to near: translucent water over water is blended in a sensible order
        solid_first.sort_by(|a, b| b.1.total_cmp(&a.1));
        for (key, _) in solid_first {
            let c = &self.chunks[&key];
            for (slot, id) in c.meshes.iter().enumerate() {
                if let Some(id) = id {
                    out.push((*id, slot == 1));
                }
            }
        }
        self.stats.drawn = out.len() as u32;
        out
    }
}

pub struct Hit {
    pub cell: [i32; 3],
    /// The way the face it entered through points (0, 0, 0 when the ray started inside).
    pub normal: [i32; 3],
    pub distance: f64,
    pub block: u8,
}

#[derive(Debug)]
pub struct Moved {
    pub pos: [f64; 3],
    /// Blocked on x, y, z.
    pub hit: [bool; 3],
    pub on_ground: bool,
}

pub struct Carve {
    pub seed: u32,
    pub scale: [f64; 3],
    pub threshold: f64,
    pub tunnels: bool,
    pub ids: [bool; 256],
}

/// The tilted-box test for what a camera can see.
pub struct Frustum {
    planes: [Vec4; 6],
}

impl Frustum {
    pub fn new(m: &Mat4) -> Self {
        let r = [m.row(0), m.row(1), m.row(2), m.row(3)];
        Self {
            planes: [
                r[3] + r[0],
                r[3] - r[0],
                r[3] + r[1],
                r[3] - r[1],
                r[2],
                r[3] - r[2],
            ],
        }
    }

    pub fn sees(&self, min: [f32; 3], max: [f32; 3]) -> bool {
        self.planes.iter().all(|p| {
            // the box corner furthest along the plane's normal
            let x = if p.x >= 0.0 { max[0] } else { min[0] };
            let y = if p.y >= 0.0 { max[1] } else { min[1] };
            let z = if p.z >= 0.0 { max[2] } else { min[2] };
            p.x * x + p.y * y + p.z * z + p.w >= 0.0
        })
    }
}

#[derive(Default)]
struct MeshBuild {
    vertices: Vec<MeshVertex>,
    indices: Vec<u32>,
}

/// Brightness of a light level, in steps of a fifth less.
fn curve(level: f32) -> f32 {
    0.8f32.powf(MAX_LIGHT as f32 - level)
}

const AO_FACTOR: [f32; 4] = [0.5, 0.67, 0.83, 1.0];
/// +x, -x, +y, -y, +z, -z: how much of the light a face takes, as in the old games.
const FACE_SHADE: [f32; 6] = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];
const CORNERS: [(i32, i32); 4] = [(-1, -1), (1, -1), (1, 1), (-1, 1)];
/// The two directions along each face, chosen so that the first crossed with the second points out of the face.
const FACE_AXES: [([i32; 3], [i32; 3]); 6] = [
    ([0, 1, 0], [0, 0, 1]),
    ([0, 0, 1], [0, 1, 0]),
    ([0, 0, 1], [1, 0, 0]),
    ([1, 0, 0], [0, 0, 1]),
    ([1, 0, 0], [0, 1, 0]),
    ([0, 1, 0], [1, 0, 0]),
];

impl MeshBuild {
    #[allow(clippy::too_many_arguments)]
    fn quad(
        &mut self,
        verts: &[[f32; 3]; 4],
        uvs: &[[f32; 2]; 4],
        sky: &[f32; 4],
        glow: &[f32; 4],
        ao: &[u8; 4],
        shade: f32,
        alpha: u8,
        reversed: bool,
    ) {
        let base = self.vertices.len() as u32;
        for c in 0..4 {
            let g = shade * AO_FACTOR[ao[c] as usize];
            let byte = (g * 255.0).round() as u8;
            self.vertices.push(MeshVertex {
                position: verts[c],
                // the light levels travel in the normal, and a negative glow tells the shader this is a voxel surface
                normal: [
                    curve(sky[c]),
                    if glow[c] > 0.0 { curve(glow[c]) } else { 0.0 },
                    0.0,
                ],
                color: [byte, byte, byte, alpha],
                uv: uvs[c],
                emissive: -1.0,
            });
        }
        // split the quad along the diagonal that hides the least shading
        let flip = (ao[0] as i32 + ao[2] as i32) < (ao[1] as i32 + ao[3] as i32);
        let order: [u32; 6] = if flip {
            [1, 2, 3, 1, 3, 0]
        } else {
            [0, 1, 2, 0, 2, 3]
        };
        if reversed {
            for tri in order.chunks(3).rev() {
                self.indices
                    .extend([tri[2], tri[1], tri[0]].map(|i| base + i));
            }
        } else {
            self.indices.extend(order.map(|i| base + i));
        }
    }
}

// ---- noise ------------------------------------------------------------------------------------

fn hash3(x: i32, y: i32, z: i32, seed: u32) -> u32 {
    let mut h = seed ^ 0x9e37_79b9;
    for v in [x as u32, y as u32, z as u32] {
        h = (h ^ v).wrapping_mul(0x85eb_ca6b);
        h ^= h >> 15;
        h = h.wrapping_mul(0xc2b2_ae35);
        h ^= h >> 13;
    }
    h
}

/// A repeatable number from 0 up to (not including) 1 for a place and seed.
pub fn hash01(x: i32, y: i32, z: i32, seed: u32) -> f64 {
    hash3(x, y, z, seed) as f64 / 4_294_967_296.0
}

fn grad(h: u32, x: f64, y: f64, z: f64) -> f64 {
    match h % 12 {
        0 => x + y,
        1 => -x + y,
        2 => x - y,
        3 => -x - y,
        4 => x + z,
        5 => -x + z,
        6 => x - z,
        7 => -x - z,
        8 => y + z,
        9 => -y + z,
        10 => y - z,
        _ => -y - z,
    }
}

fn fade(t: f64) -> f64 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// Gradient noise, about -1 to 1, smooth, the same every time for a seed.
pub fn perlin3(x: f64, y: f64, z: f64, seed: u32) -> f64 {
    let (xi, yi, zi) = (x.floor() as i32, y.floor() as i32, z.floor() as i32);
    let (xf, yf, zf) = (x - xi as f64, y - yi as f64, z - zi as f64);
    let (u, v, w) = (fade(xf), fade(yf), fade(zf));
    let g = |dx: i32, dy: i32, dz: i32| {
        grad(
            hash3(xi + dx, yi + dy, zi + dz, seed),
            xf - dx as f64,
            yf - dy as f64,
            zf - dz as f64,
        )
    };
    let x00 = lerp(g(0, 0, 0), g(1, 0, 0), u);
    let x10 = lerp(g(0, 1, 0), g(1, 1, 0), u);
    let x01 = lerp(g(0, 0, 1), g(1, 0, 1), u);
    let x11 = lerp(g(0, 1, 1), g(1, 1, 1), u);
    lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 0.7
}

/// Noise summed over `octaves` scales (each twice as fine and `gain` as strong), kept within about -1 to 1.
pub fn fbm3(x: f64, y: f64, z: f64, seed: u32, octaves: u32, gain: f64) -> f64 {
    let (mut sum, mut amp, mut freq, mut norm) = (0.0, 1.0, 1.0, 0.0);
    for o in 0..octaves.max(1) {
        sum += perlin3(x * freq, y * freq, z * freq, seed.wrapping_add(o * 101)) * amp;
        norm += amp;
        amp *= gain;
        freq *= 2.0;
    }
    sum / norm
}

#[cfg(test)]
mod tests {
    use super::*;

    fn world() -> World {
        let mut w = World::new();
        w.define(BlockDef {
            name: "stone".into(),
            ..Default::default()
        })
        .unwrap();
        w.define(BlockDef {
            name: "glass".into(),
            opaque: false,
            cull_same: true,
            ..Default::default()
        })
        .unwrap();
        w.define(BlockDef {
            name: "torch".into(),
            solid: false,
            opaque: false,
            shape: Shape::Torch,
            glow: 14,
            ..Default::default()
        })
        .unwrap();
        w
    }

    /// A flat floor of stone, ground at y = 0..=9, across a square of chunks, lit and ready.
    fn flat(w: &mut World, radius: i32) {
        flat_with(w, radius, |_| {});
    }

    fn flat_with(w: &mut World, radius: i32, build: impl FnOnce(&mut World)) {
        for cx in -radius..=radius {
            for cz in -radius..=radius {
                w.create_chunk(cx, cz);
                w.fill([cx * 16, 0, cz * 16], [cx * 16 + 15, 9, cz * 16 + 15], 1);
            }
        }
        build(w);
        for cx in -radius..=radius {
            for cz in -radius..=radius {
                w.light_chunk(cx, cz);
            }
        }
    }

    #[test]
    fn noise_is_repeatable_and_bounded() {
        let a = perlin3(1.3, 2.7, -4.1, 7);
        assert_eq!(a, perlin3(1.3, 2.7, -4.1, 7));
        assert_ne!(a, perlin3(1.3, 2.7, -4.1, 8));
        let mut max = 0.0f64;
        for i in 0..2000 {
            let v = fbm3(i as f64 * 0.37, i as f64 * 0.11, i as f64 * 0.53, 3, 4, 0.5);
            max = max.max(v.abs());
        }
        assert!(max <= 1.2, "noise strayed to {max}");
        assert!((0.0..1.0).contains(&hash01(3, 4, 5, 1)));
    }

    #[test]
    fn sky_light_falls_and_spreads_under_an_overhang() {
        let mut w = world();
        flat(&mut w, 2);
        assert_eq!(w.light(5, 10, 5).0, 15);
        assert_eq!(w.light(5, 5, 5).0, 0, "inside the stone");
        // a roof 2 high at y = 12, 5 wide: the middle is darker than the open edge
        for x in 0..5 {
            for z in 0..5 {
                w.edit(x, 12, z, 1);
            }
        }
        let edge = w.light(5, 11, 2).0;
        let middle = w.light(2, 11, 2).0;
        assert!(edge >= 14, "next to the open sky: {edge}");
        assert!(
            middle < edge && middle >= 12,
            "under the roof, lit from the sides: {middle}"
        );
        // taking the roof away puts the sun back
        for x in 0..5 {
            for z in 0..5 {
                w.edit(x, 12, z, 0);
            }
        }
        assert_eq!(w.light(2, 11, 2).0, 15);
    }

    #[test]
    fn torches_light_and_darken_again() {
        let mut w = world();
        // a closed room: air at y 10..=11 inside, stone around and above, built before the light is worked out
        flat_with(&mut w, 2, |w| {
            w.fill([0, 10, 0], [6, 13, 6], 1);
            w.fill([1, 10, 1], [5, 11, 5], 0);
        });
        assert_eq!(w.light(3, 10, 3), (0, 0), "a sealed room is dark");
        w.edit(3, 10, 3, 3);
        assert_eq!(w.light(3, 10, 3).1, 14);
        assert_eq!(w.light(3, 10, 4).1, 13);
        assert_eq!(
            w.light(5, 10, 5).1,
            10,
            "two steps over and two across: 14 - 4"
        );
        w.edit(3, 10, 3, 0);
        assert_eq!(
            w.light(3, 10, 4),
            (0, 0),
            "removing the torch removes its light"
        );
    }

    #[test]
    fn light_crosses_chunk_borders() {
        let mut w = world();
        flat(&mut w, 2);
        // a tunnel under the ground from x = 10 across the border at x = 16
        for x in 10..24 {
            w.edit(x, 5, 3, 0);
        }
        w.edit(20, 5, 3, 3);
        assert_eq!(w.light(20, 5, 3).1, 14);
        assert_eq!(
            w.light(14, 5, 3).1,
            8,
            "6 steps away, across the chunk border"
        );
    }

    #[test]
    fn faces_are_hidden_between_blocks() {
        let mut w = world();
        flat(&mut w, 1);
        w.mesh_chunk(0, 0);
        // a flat chunk of stone: the top (256 faces) and nothing else, since the sides touch neighbours and the bottom is the world's floor
        assert_eq!(w.stats.faces, 256);
        // a block on top adds five faces (its bottom is hidden)
        w.edit(3, 10, 3, 1);
        w.mesh_chunk(0, 0);
        assert_eq!(w.stats.faces, 256 - 1 + 5);
        // glass beside glass shows no inner face: two blocks = 10 faces, against 12 apart
        w.edit(8, 10, 8, 2);
        w.edit(9, 10, 8, 2);
        w.mesh_chunk(0, 0);
        assert_eq!(
            w.stats.faces,
            260 + 8,
            "two glass blocks side by side: 5 + 5 faces less the 2 where they touch"
        );
    }

    #[test]
    fn mesh_vertices_are_well_formed() {
        let mut w = world();
        flat(&mut w, 1);
        w.mesh_chunk(0, 0);
        let Some(MeshOp::Upload {
            vertices, indices, ..
        }) = w.ops.iter().find(|o| matches!(o, MeshOp::Upload { .. }))
        else {
            panic!("no upload");
        };
        assert_eq!(indices.len() % 3, 0);
        assert!(indices.iter().all(|&i| (i as usize) < vertices.len()));
        // faces point up: counter-clockwise seen from above
        let (a, b, c) = (
            vertices[indices[0] as usize],
            vertices[indices[1] as usize],
            vertices[indices[2] as usize],
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
        let cross_y = e1[2] * e2[0] - e1[0] * e2[2];
        assert!(cross_y > 0.0, "top face winding {cross_y}");
        assert!(
            vertices
                .iter()
                .all(|v| v.emissive < 0.0 && v.normal[0] > 0.0)
        );
    }

    #[test]
    fn raycast_finds_the_face_it_enters() {
        let mut w = world();
        flat(&mut w, 1);
        let hit = w
            .raycast([2.5, 14.5, 2.5], [0.0, -1.0, 0.0], 10.0, false)
            .unwrap();
        assert_eq!(hit.cell, [2, 9, 2]);
        assert_eq!(hit.normal, [0, 1, 0]);
        assert!((hit.distance - 4.5).abs() < 1e-9);
        // sideways into a block
        w.edit(5, 10, 2, 1);
        let hit = w
            .raycast([0.5, 10.5, 2.5], [1.0, 0.0, 0.0], 10.0, false)
            .unwrap();
        assert_eq!((hit.cell, hit.normal), ([5, 10, 2], [-1, 0, 0]));
        assert!(
            w.raycast([0.5, 10.5, 2.5], [1.0, 0.0, 0.0], 3.0, false)
                .is_none(),
            "too short"
        );
        assert!(
            w.raycast([0.5, 20.5, 2.5], [0.0, 1.0, 0.0], 50.0, false)
                .is_none(),
            "into the sky"
        );
    }

    #[test]
    fn a_body_stands_walks_into_walls_and_steps_up() {
        let mut w = world();
        flat(&mut w, 1);
        // falls onto the floor (top of the stone is y = 10)
        let m = w.move_box([2.5, 12.0, 2.5], 0.3, 1.8, [0.0, -5.0, 0.0], 0.0);
        assert!((m.pos[1] - 10.0).abs() < 1e-6, "{:?}", m);
        assert!(m.on_ground && m.hit[1]);
        // a wall one block high: without a step it stops, with half a block it still does, a full block needs a jump
        w.edit(4, 10, 2, 1);
        w.edit(4, 11, 2, 1);
        let m = w.move_box([2.5, 10.0, 2.5], 0.3, 1.8, [3.0, 0.0, 0.0], 0.6);
        assert!(
            (m.pos[0] - (4.0 - 0.3)).abs() < 1e-6,
            "stopped at the wall: {:?}",
            m
        );
        assert!(m.hit[0]);
        // a single block is climbed with a step of a block
        w.edit(4, 11, 2, 0);
        let m = w.move_box([3.6, 10.0, 2.5], 0.3, 1.8, [0.5, 0.0, 0.0], 0.6);
        assert!(
            (m.pos[0] - 3.7).abs() < 1e-6 && m.pos[1] == 10.0,
            "0.6 is not a block: {:?}",
            m
        );
        let m = w.move_box([3.6, 10.0, 2.5], 0.3, 1.8, [0.5, 0.0, 0.0], 1.0);
        assert!(
            (m.pos[0] - 4.1).abs() < 1e-6 && (m.pos[1] - 11.0).abs() < 1e-6,
            "stepped up: {:?}",
            m
        );
        assert!(m.on_ground);
        // and walking off the far side comes down again
        let m = w.move_box([4.6, 11.0, 2.5], 0.3, 1.8, [0.5, -0.5, 0.0], 1.0);
        assert!(m.pos[0] > 5.0 && m.pos[1] <= 11.0, "{:?}", m);
        // a ceiling stops a jump
        w.edit(2, 13, 2, 1);
        let m = w.move_box([2.5, 10.0, 2.5], 0.3, 1.8, [0.0, 4.0, 0.0], 0.0);
        assert!(
            (m.pos[1] - (13.0 - 1.8)).abs() < 1e-6 && m.hit[1],
            "{:?}",
            m
        );
    }

    #[test]
    fn a_fast_body_does_not_tunnel() {
        let mut w = world();
        flat(&mut w, 1);
        let m = w.move_box([2.5, 40.0, 2.5], 0.3, 1.8, [0.0, -60.0, 0.0], 0.0);
        assert!((m.pos[1] - 10.0).abs() < 1e-6, "{:?}", m);
    }

    #[test]
    fn edits_save_and_load() {
        let mut w = world();
        flat(&mut w, 1);
        w.edit(3, 10, 3, 1);
        w.edit(4, 9, 4, 0);
        let text = w.export_edits(0, 0).unwrap();
        assert_eq!(text.len(), 12);
        assert_eq!(w.modified_chunks(), vec![(0, 0)]);
        let mut fresh = world();
        flat(&mut fresh, 1);
        assert_eq!(fresh.import_edits(0, 0, &text).unwrap(), 2);
        assert_eq!(fresh.get(3, 10, 3), 1);
        assert_eq!(fresh.get(4, 9, 4), 0);
        assert!(fresh.import_edits(0, 0, "zz").is_err());
        assert!(w.export_edits(1, 1).is_none());
    }

    #[test]
    fn a_world_file_keeps_edits_of_loaded_and_dropped_chunks() {
        let mut w = world();
        flat(&mut w, 2);
        w.edit(3, 10, 3, 1);
        w.edit(40, 10, 3, 1); // chunk (2, 0)
        w.unload_chunk(2, 0);
        w.edit(5, 9, 5, 0);
        let bytes = w.encode_world();
        assert_eq!(&bytes[..4], b"NVX1");
        let mut fresh = world();
        flat(&mut fresh, 2);
        assert_eq!(fresh.decode_world(&bytes).unwrap(), 2);
        assert_eq!(fresh.apply_saved(0, 0), 2);
        assert_eq!((fresh.get(3, 10, 3), fresh.get(5, 9, 5)), (1, 0));
        fresh.unload_chunk(2, 0);
        fresh.create_chunk(2, 0);
        assert_eq!(fresh.apply_saved(2, 0), 1);
        assert_eq!(fresh.get(40, 10, 3), 1);
        assert!(fresh.decode_world(b"NVX1\x05").is_err());
        assert!(fresh.decode_world(b"nope").is_err());
        // a chunk whose edits were all undone is not kept
        let mut w2 = world();
        flat(&mut w2, 1);
        w2.edit(3, 10, 3, 1);
        w2.chunks.get_mut(&(0, 0)).unwrap().edits.clear();
        assert_eq!(w2.encode_world().len(), 8);
    }

    #[test]
    fn carving_leaves_air_only_where_allowed() {
        let mut w = world();
        flat(&mut w, 1);
        let mut ids = [false; 256];
        ids[1] = true;
        let c = Carve {
            seed: 5,
            scale: [0.07; 3],
            threshold: 0.1,
            tunnels: false,
            ids,
        };
        let n = w.carve([0, 2, 0], [15, 8, 15], &c);
        assert!(n > 0 && n < 16 * 7 * 16, "carved {n}");
        assert_eq!(w.get(3, 0, 3), 1, "the floor stays");
        let none = Carve {
            ids: [false; 256],
            ..c
        };
        assert_eq!(w.carve([0, 2, 0], [15, 8, 15], &none), 0);
    }

    #[test]
    fn unloading_frees_meshes_and_marks_neighbours() {
        let mut w = world();
        flat(&mut w, 2);
        w.mesh_chunk(0, 0);
        w.mesh_chunk(1, 0);
        assert!(!w.chunks[&(1, 0)].dirty);
        w.ops.clear();
        w.unload_chunk(0, 0);
        assert!(w.ops.iter().any(|o| matches!(o, MeshOp::Free(_))));
        assert!(w.chunks[&(1, 0)].dirty);
        assert!(!w.can_mesh(1, 0));
    }

    #[test]
    fn the_frustum_sees_what_is_in_front() {
        let proj = glam::camera::rh::proj::directx::perspective(1.0, 1.5, 0.1, 100.0);
        let view = glam::camera::rh::view::look_at_mat4(
            glam::Vec3::new(0.0, 0.0, 0.0),
            glam::Vec3::new(0.0, 0.0, -1.0),
            glam::Vec3::Y,
        );
        let f = Frustum::new(&(proj * view));
        assert!(f.sees([-1.0, -1.0, -11.0], [1.0, 1.0, -9.0]));
        assert!(!f.sees([-1.0, -1.0, 9.0], [1.0, 1.0, 11.0]), "behind");
        assert!(
            !f.sees([200.0, 0.0, -10.0], [201.0, 1.0, -9.0]),
            "far to the side"
        );
    }
}
