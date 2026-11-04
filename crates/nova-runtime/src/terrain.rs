//! Terrain from a recipe: what a game describes in Lua (`nova.voxel.terrain { ... }`) as plain data, made into chunks of
//! blocks by this code, which can run on any thread. A chunk depends only on the recipe and its place, never on what
//! was made before it, so chunks can be made in any order, several at once, and again later (trees that cross a border
//! are found by asking the chunks around each one where their trees are).
//!
//! The recipe is: how high the ground is (layers of noise and rivers), the biomes (where it is warm and wet, what the
//! ground is made of, which trees and plants stand on it), caves, ores, lava, and the kinds of tree.

use std::collections::HashMap;

use serde::Deserialize;

use crate::voxel::{SX, SY, SZ, cave_open, fbm3, hash01};

const VOL: usize = SX * SY * SZ;

#[inline]
fn idx(x: usize, y: usize, z: usize) -> usize {
    (y * SZ + z) * SX + x
}

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Layer {
    /// How stretched the noise is: 0.01 changes over about a hundred blocks.
    pub scale: f64,
    pub octaves: u32,
    pub gain: f64,
    /// How many blocks it raises or lowers the ground at most.
    pub amplitude: f64,
    /// Added to the recipe's seed, so that every layer is different.
    pub seed: u32,
}

impl Default for Layer {
    fn default() -> Self {
        Self {
            scale: 0.01,
            octaves: 1,
            gain: 0.5,
            amplitude: 1.0,
            seed: 0,
        }
    }
}

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Rivers {
    pub scale: f64,
    pub octaves: u32,
    /// How wide the band is, in noise units (0.04 is a stream).
    pub width: f64,
    /// How far below the sea level the middle goes.
    pub depth: f64,
    pub seed: u32,
}

impl Default for Rivers {
    fn default() -> Self {
        Self {
            scale: 0.007,
            octaves: 2,
            width: 0.04,
            depth: 2.0,
            seed: 2,
        }
    }
}

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Field {
    pub scale: f64,
    pub octaves: u32,
    pub seed: u32,
}

impl Default for Field {
    fn default() -> Self {
        Self {
            scale: 0.0025,
            octaves: 2,
            seed: 3,
        }
    }
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Range {
    pub min: Option<f64>,
    pub max: Option<f64>,
}

impl Range {
    fn holds(&self, v: f64) -> bool {
        self.min.is_none_or(|m| v >= m) && self.max.is_none_or(|m| v <= m)
    }
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct TreeUse {
    pub kind: String,
    /// How many tries a chunk makes for this kind (each puts a tree down if the place is dry land of this biome).
    pub count: u32,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Plant {
    pub block: String,
    /// The chance, 0 to 1, that a column of this biome's surface has this plant on it (chances add up in order).
    pub chance: f64,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Cactus {
    pub block: String,
    pub chance: f64,
    pub height: i32,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct BiomeSpec {
    pub name: String,
    pub temperature: Range,
    pub wetness: Range,
    pub top: String,
    pub under: String,
    /// Water at the sea level freezes.
    pub ice: bool,
    pub trees: Vec<TreeUse>,
    pub plants: Vec<Plant>,
    pub cactus: Option<Cactus>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct SurfaceSpec {
    pub top: String,
    pub under: String,
    /// For a beach: how far above the sea level the ground may be (1). For a sea bed: how far below it must be (3).
    pub depth: i32,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct CaveSpec {
    /// "tunnel" (winding passages) or "cavern" (rooms).
    pub kind: String,
    pub ymin: i32,
    pub ymax: i32,
    pub scale: f64,
    pub squash: f64,
    pub threshold: f64,
    pub seed: u32,
    /// The blocks it may dig out.
    pub through: Vec<String>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct OreSpec {
    pub block: String,
    pub tries: u32,
    pub ymin: i32,
    pub ymax: i32,
    pub size: u32,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct TreeSpec {
    pub log: String,
    pub leaves: String,
    pub trunk_min: i32,
    pub trunk_max: i32,
}

impl Default for TreeSpec {
    fn default() -> Self {
        Self {
            log: String::new(),
            leaves: String::new(),
            trunk_min: 4,
            trunk_max: 6,
        }
    }
}

/// The recipe as a game writes it, with blocks by name.
#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Spec {
    pub seed: u32,
    pub sea_level: i32,
    /// The ground's height where every layer is zero.
    pub base: f64,
    pub layers: Vec<Layer>,
    pub rivers: Option<Rivers>,
    pub temperature: Field,
    pub wetness: Field,
    pub biomes: Vec<BiomeSpec>,
    pub stone: String,
    pub bedrock: String,
    pub water: String,
    pub ice: Option<String>,
    pub beach: Option<SurfaceSpec>,
    pub seabed: Option<SurfaceSpec>,
    pub caves: Vec<CaveSpec>,
    pub ores: Vec<OreSpec>,
    pub lava: Option<OreSpec>,
    pub trees: HashMap<String, TreeSpec>,
}

impl Default for Spec {
    fn default() -> Self {
        Self {
            seed: 0,
            sea_level: 40,
            base: 47.0,
            layers: Vec::new(),
            rivers: None,
            temperature: Field::default(),
            wetness: Field {
                seed: 4,
                ..Field::default()
            },
            biomes: Vec::new(),
            stone: "stone".into(),
            bedrock: "bedrock".into(),
            water: "water".into(),
            ice: None,
            beach: None,
            seabed: None,
            caves: Vec::new(),
            ores: Vec::new(),
            lava: None,
            trees: HashMap::new(),
        }
    }
}

struct Biome {
    name: String,
    temperature: Range,
    wetness: Range,
    top: u8,
    under: u8,
    ice: bool,
    trees: Vec<(usize, u32)>,
    plants: Vec<(u8, f64)>,
    cactus: Option<(u8, f64, i32)>,
}

struct Cave {
    seed: u32,
    scale: [f64; 3],
    threshold: f64,
    tunnels: bool,
    ymin: i32,
    ymax: i32,
    through: [bool; 256],
}

struct Ore {
    block: u8,
    tries: u32,
    ymin: i32,
    ymax: i32,
    size: u32,
}

struct Tree {
    log: u8,
    leaves: u8,
    trunk_min: i32,
    trunk_max: i32,
}

/// A recipe with its blocks looked up: ready to make chunks.
pub struct Terrain {
    seed: u32,
    sea: i32,
    base: f64,
    layers: Vec<Layer>,
    rivers: Option<Rivers>,
    temperature: Field,
    wetness: Field,
    biomes: Vec<Biome>,
    stone: u8,
    bedrock: u8,
    water: u8,
    ice: Option<u8>,
    beach: Option<(u8, u8, i32)>,
    seabed: Option<(u8, u8, i32)>,
    caves: Vec<Cave>,
    ores: Vec<Ore>,
    lava: Option<Ore>,
    trees: Vec<Tree>,
}

impl Terrain {
    /// Looks the blocks up (`find` gives a block's number by name) and checks the recipe.
    pub fn new(spec: &Spec, find: &dyn Fn(&str) -> Option<u8>) -> Result<Self, String> {
        let block = |name: &str, what: &str| -> Result<u8, String> {
            find(name).ok_or_else(|| format!("terrain: no block called '{name}' (for {what})"))
        };
        if spec.biomes.is_empty() {
            return Err(
                "terrain: needs at least one biome (the last one is used where no other fits)"
                    .into(),
            );
        }
        let mut tree_names: Vec<&String> = spec.trees.keys().collect();
        tree_names.sort();
        let trees = tree_names
            .iter()
            .map(|n| {
                let t = &spec.trees[*n];
                Ok(Tree {
                    log: block(&t.log, &format!("tree '{n}' log"))?,
                    leaves: block(&t.leaves, &format!("tree '{n}' leaves"))?,
                    trunk_min: t.trunk_min,
                    trunk_max: t.trunk_max.max(t.trunk_min),
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let biomes = spec
            .biomes
            .iter()
            .map(|b| {
                let name = &b.name;
                Ok(Biome {
                    name: b.name.clone(),
                    temperature: b.temperature.clone(),
                    wetness: b.wetness.clone(),
                    top: block(&b.top, &format!("biome '{name}' top"))?,
                    under: block(&b.under, &format!("biome '{name}' under"))?,
                    ice: b.ice,
                    trees: b
                        .trees
                        .iter()
                        .map(|t| {
                            let i = tree_names.iter().position(|n| **n == t.kind).ok_or_else(|| format!("terrain: biome '{name}' uses a tree kind '{}' that is not in `trees`", t.kind))?;
                            Ok((i, t.count))
                        })
                        .collect::<Result<_, String>>()?,
                    plants: b.plants.iter().map(|p| Ok((block(&p.block, &format!("biome '{name}' plant"))?, p.chance))).collect::<Result<_, String>>()?,
                    cactus: match &b.cactus {
                        Some(c) => Some((block(&c.block, &format!("biome '{name}' cactus"))?, c.chance, c.height.max(1))),
                        None => None,
                    },
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let surface = |s: &Option<SurfaceSpec>,
                       what: &str,
                       default: i32|
         -> Result<Option<(u8, u8, i32)>, String> {
            match s {
                Some(s) => Ok(Some((
                    block(&s.top, what)?,
                    block(&s.under, what)?,
                    if s.depth == 0 { default } else { s.depth },
                ))),
                None => Ok(None),
            }
        };
        let caves = spec
            .caves
            .iter()
            .map(|c| {
                let mut through = [false; 256];
                for n in &c.through {
                    through[block(n, "a cave's `through`")? as usize] = true;
                }
                let scale = if c.scale == 0.0 { 0.05 } else { c.scale };
                Ok(Cave {
                    seed: spec.seed.wrapping_add(c.seed),
                    scale: [
                        scale,
                        scale * if c.squash == 0.0 { 1.0 } else { c.squash },
                        scale,
                    ],
                    threshold: if c.threshold == 0.0 { 0.1 } else { c.threshold },
                    tunnels: c.kind != "cavern",
                    ymin: c.ymin.max(1),
                    ymax: if c.ymax == 0 {
                        SY as i32 - 2
                    } else {
                        c.ymax.min(SY as i32 - 2)
                    },
                    through,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let ore = |o: &OreSpec| -> Result<Ore, String> {
            Ok(Ore {
                block: block(&o.block, "an ore")?,
                tries: o.tries,
                ymin: o.ymin.max(1),
                ymax: if o.ymax == 0 { SY as i32 - 2 } else { o.ymax },
                size: o.size.max(1),
            })
        };
        Ok(Self {
            seed: spec.seed,
            sea: spec.sea_level,
            base: spec.base,
            layers: spec.layers.clone(),
            rivers: spec.rivers.clone(),
            temperature: spec.temperature.clone(),
            wetness: spec.wetness.clone(),
            biomes,
            stone: block(&spec.stone, "stone")?,
            bedrock: block(&spec.bedrock, "bedrock")?,
            water: block(&spec.water, "water")?,
            ice: match &spec.ice {
                Some(n) => Some(block(n, "ice")?),
                None => None,
            },
            beach: surface(&spec.beach, "the beach", 1)?,
            seabed: surface(&spec.seabed, "the sea bed", 3)?,
            caves,
            ores: spec.ores.iter().map(ore).collect::<Result<_, _>>()?,
            lava: match &spec.lava {
                Some(l) => Some(ore(l)?),
                None => None,
            },
            trees,
        })
    }

    pub fn sea_level(&self) -> i32 {
        self.sea
    }

    /// The height of the top block of the ground at a column (the same however it is asked).
    pub fn height(&self, x: i32, z: i32) -> i32 {
        let mut h = self.base;
        for l in &self.layers {
            h += fbm3(
                x as f64 * l.scale,
                0.5,
                z as f64 * l.scale,
                self.seed.wrapping_add(l.seed),
                l.octaves,
                l.gain,
            ) * l.amplitude;
        }
        if let Some(r) = &self.rivers {
            let river = fbm3(
                x as f64 * r.scale,
                0.5,
                z as f64 * r.scale,
                self.seed.wrapping_add(r.seed),
                r.octaves,
                0.5,
            )
            .abs();
            if river < r.width {
                h = h.min(self.sea as f64 - r.depth + river * (r.depth * 0.8 / r.width));
            }
        }
        h.floor() as i32
    }

    /// Which biome a column is in (an index into the recipe's list; the first whose ranges hold, else the last).
    pub fn biome_index(&self, x: i32, z: i32) -> usize {
        let t = fbm3(
            x as f64 * self.temperature.scale,
            0.5,
            z as f64 * self.temperature.scale,
            self.seed.wrapping_add(self.temperature.seed),
            self.temperature.octaves,
            0.5,
        );
        let w = fbm3(
            x as f64 * self.wetness.scale,
            0.5,
            z as f64 * self.wetness.scale,
            self.seed.wrapping_add(self.wetness.seed),
            self.wetness.octaves,
            0.5,
        );
        self.biomes
            .iter()
            .position(|b| b.temperature.holds(t) && b.wetness.holds(w))
            .unwrap_or(self.biomes.len() - 1)
    }

    pub fn biome_name(&self, x: i32, z: i32) -> &str {
        &self.biomes[self.biome_index(x, z)].name
    }

    /// The blocks of one chunk.
    pub fn generate(&self, cx: i32, cz: i32) -> Vec<u8> {
        let mut blocks = vec![0u8; VOL];
        let (x0, z0) = (cx * SX as i32, cz * SZ as i32);
        let seed = self.seed;
        // the ground
        for lz in 0..SZ {
            for lx in 0..SX {
                let (x, z) = (x0 + lx as i32, z0 + lz as i32);
                let h = self.height(x, z).clamp(2, SY as i32 - 2);
                let biome = &self.biomes[self.biome_index(x, z)];
                let (mut top, mut under) = (biome.top, biome.under);
                if let Some((t, u, d)) = self.beach
                    && h <= self.sea + d
                {
                    (top, under) = (t, u);
                }
                if let Some((t, u, d)) = self.seabed
                    && h < self.sea - d
                {
                    (top, under) = (t, u);
                }
                for y in 1..=(h - 4).max(0) {
                    blocks[idx(lx, y as usize, lz)] = self.stone;
                }
                for y in (h - 3).max(1)..h {
                    blocks[idx(lx, y as usize, lz)] = under;
                }
                blocks[idx(lx, h as usize, lz)] = top;
                blocks[idx(lx, 0, lz)] = self.bedrock;
                if hash01(x, 1, z, seed) < 0.5 {
                    blocks[idx(lx, 1, lz)] = self.bedrock;
                }
                if h < self.sea {
                    for y in (h + 1)..=self.sea {
                        blocks[idx(lx, y as usize, lz)] = self.water;
                    }
                    if biome.ice
                        && let Some(ice) = self.ice
                    {
                        blocks[idx(lx, self.sea as usize, lz)] = ice;
                    }
                }
            }
        }
        // caves
        for c in &self.caves {
            for lz in 0..SZ {
                for lx in 0..SX {
                    for y in c.ymin..=c.ymax {
                        let i = idx(lx, y as usize, lz);
                        if c.through[blocks[i] as usize]
                            && cave_open(
                                c.tunnels,
                                c.seed,
                                c.scale,
                                c.threshold,
                                x0 + lx as i32,
                                y,
                                z0 + lz as i32,
                            )
                        {
                            blocks[i] = 0;
                        }
                    }
                }
            }
        }
        // ores: little blobs inside the stone, found from the chunk's place and a try number
        let mut salt = seed.wrapping_add(50);
        for ore in &self.ores {
            salt = salt.wrapping_add(7);
            for i in 0..ore.tries as i32 {
                let wx = x0 + (hash01(cx, i, cz, salt) * 16.0) as i32;
                let wy = ore.ymin
                    + (hash01(cx, i, cz, salt.wrapping_add(1))
                        * (ore.ymax - ore.ymin).max(1) as f64) as i32;
                let wz = z0 + (hash01(cx, i, cz, salt.wrapping_add(2)) * 16.0) as i32;
                let s2 = salt.wrapping_add(3 + i as u32);
                for k in 1..=ore.size as i32 {
                    let x = wx + (hash01(wx, wy + k, wz, s2) * 3.0 - 1.0 + 0.5).floor() as i32;
                    let y = wy
                        + (hash01(wx + k, wy, wz, s2.wrapping_add(1)) * 3.0 - 1.0 + 0.5).floor()
                            as i32;
                    let z = wz
                        + (hash01(wx, wy, wz + k, s2.wrapping_add(2)) * 3.0 - 1.0 + 0.5).floor()
                            as i32;
                    let (lx, lz) = (x - x0, z - z0);
                    if (0..SX as i32).contains(&lx)
                        && (0..SZ as i32).contains(&lz)
                        && (1..SY as i32 - 1).contains(&y)
                    {
                        let at = idx(lx as usize, y as usize, lz as usize);
                        if blocks[at] == self.stone {
                            blocks[at] = ore.block;
                        }
                    }
                }
            }
        }
        // lava where a cave left room near the bottom
        if let Some(l) = &self.lava {
            for i in 0..l.tries as i32 {
                let lx = (hash01(cx, i, cz, salt.wrapping_add(90)) * 16.0) as usize;
                let lz = (hash01(cx, i, cz, salt.wrapping_add(91)) * 16.0) as usize;
                let y = l.ymin
                    + (hash01(cx, i, cz, salt.wrapping_add(92)) * (l.ymax - l.ymin).max(1) as f64)
                        as i32;
                let at = idx(
                    lx.min(SX - 1),
                    y.clamp(1, SY as i32 - 2) as usize,
                    lz.min(SZ - 1),
                );
                if blocks[at] == 0 {
                    blocks[at] = l.block;
                }
            }
        }
        // trees: those that stand here and those of the chunks around that reach in
        for oz in -1..=1 {
            for ox in -1..=1 {
                let (tx0, tz0) = ((cx + ox) * SX as i32, (cz + oz) * SZ as i32);
                let biome_index = self.biome_index(tx0 + 8, tz0 + 8);
                for (ti, &(kind, count)) in self.biomes[biome_index].trees.iter().enumerate() {
                    for i in 0..count as i32 {
                        let n = i + ti as i32 * 64;
                        let wx = tx0 + (hash01(tx0, n, tz0, seed.wrapping_add(30)) * 16.0) as i32;
                        let wz = tz0 + (hash01(tx0, n, tz0, seed.wrapping_add(31)) * 16.0) as i32;
                        let h = self.height(wx, wz);
                        if h > self.sea + 1 && self.biome_index(wx, wz) == biome_index {
                            self.plant_tree(&mut blocks, &self.trees[kind], wx, wz, h, x0, z0);
                        }
                    }
                }
            }
        }
        // on the surface: plants and cacti
        for lz in 0..SZ {
            for lx in 0..SX {
                let (x, z) = (x0 + lx as i32, z0 + lz as i32);
                let h = self.height(x, z).clamp(2, SY as i32 - 3);
                if h <= self.sea || blocks[idx(lx, (h + 1) as usize, lz)] != 0 {
                    continue;
                }
                let biome = &self.biomes[self.biome_index(x, z)];
                let ground = blocks[idx(lx, h as usize, lz)];
                if ground != biome.top {
                    continue;
                }
                let r = hash01(x, 3, z, seed.wrapping_add(60));
                let mut acc = 0.0;
                for &(b, chance) in &biome.plants {
                    acc += chance;
                    if r < acc {
                        blocks[idx(lx, (h + 1) as usize, lz)] = b;
                        break;
                    }
                }
                if let Some((b, chance, height)) = biome.cactus
                    && r < chance
                {
                    let n = 1 + (hash01(x, 4, z, seed.wrapping_add(61)) * height as f64) as i32;
                    for y in (h + 1)..=(h + n).min(SY as i32 - 2) {
                        blocks[idx(lx, y as usize, lz)] = b;
                    }
                }
            }
        }
        blocks
    }

    #[allow(clippy::too_many_arguments)]
    fn plant_tree(
        &self,
        blocks: &mut [u8],
        tree: &Tree,
        wx: i32,
        wz: i32,
        ground: i32,
        x0: i32,
        z0: i32,
    ) {
        let span = (tree.trunk_max - tree.trunk_min + 1).max(1) as f64;
        let trunk = tree.trunk_min + (hash01(wx, 7, wz, self.seed.wrapping_add(21)) * span) as i32;
        let top = ground + trunk;
        let mut put = |x: i32, y: i32, z: i32, id: u8, only_air: bool| {
            let (lx, lz) = (x - x0, z - z0);
            // the chunk next door places its own part
            if !(0..SX as i32).contains(&lx)
                || !(0..SZ as i32).contains(&lz)
                || !(1..SY as i32 - 1).contains(&y)
            {
                return;
            }
            let at = idx(lx as usize, y as usize, lz as usize);
            if only_air && blocks[at] != 0 {
                return;
            }
            blocks[at] = id;
        };
        for dy in (top - 2)..=(top + 1) {
            let r: i32 = if dy >= top { 1 } else { 2 };
            for dx in -r..=r {
                for dz in -r..=r {
                    let corner = dx.abs() == r && dz.abs() == r;
                    let skip = corner
                        && ((r == 2
                            && hash01(wx + dx, dy, wz + dz, self.seed.wrapping_add(22)) < 0.5)
                            || dy > top);
                    if !skip {
                        put(wx + dx, dy, wz + dz, tree.leaves, true);
                    }
                }
            }
        }
        for y in (ground + 1)..=top {
            put(wx, y, wz, tree.log, false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(name: &str) -> Option<u8> {
        [
            "air",
            "stone",
            "grass",
            "dirt",
            "sand",
            "sandstone",
            "water",
            "bedrock",
            "log",
            "leaves",
            "coal_ore",
            "lava",
            "tall_grass",
            "cactus",
            "ice",
            "gravel",
        ]
        .iter()
        .position(|n| *n == name)
        .map(|i| i as u8)
    }

    fn spec() -> Spec {
        let json = r#"{
            "seed": 7, "sea_level": 40, "base": 47,
            "layers": [ {"scale": 0.004, "octaves": 3, "amplitude": 24, "seed": 0}, {"scale": 0.02, "octaves": 4, "amplitude": 9, "seed": 1} ],
            "rivers": {},
            "biomes": [
                {"name": "desert", "temperature": {"min": 0.22}, "wetness": {"max": 0.12}, "top": "sand", "under": "sandstone", "cactus": {"block": "cactus", "chance": 0.05, "height": 3}},
                {"name": "forest", "wetness": {"min": 0.14}, "top": "grass", "under": "dirt", "trees": [ {"kind": "oak", "count": 8} ], "plants": [ {"block": "tall_grass", "chance": 0.1} ]},
                {"name": "plains", "top": "grass", "under": "dirt", "trees": [ {"kind": "oak", "count": 1} ], "plants": [ {"block": "tall_grass", "chance": 0.1} ]}
            ],
            "beach": {"top": "sand", "under": "sand"}, "seabed": {"top": "gravel", "under": "gravel"},
            "caves": [ {"kind": "tunnel", "ymin": 5, "ymax": 62, "scale": 0.05, "squash": 1.4, "threshold": 0.075, "seed": 40, "through": ["stone", "dirt"]} ],
            "ores": [ {"block": "coal_ore", "tries": 14, "ymin": 6, "ymax": 70, "size": 8} ],
            "lava": {"block": "lava", "tries": 2, "ymin": 6, "ymax": 10},
            "trees": { "oak": {"log": "log", "leaves": "leaves", "trunk_min": 4, "trunk_max": 6} }
        }"#;
        serde_json::from_str(json).expect("the recipe parses")
    }

    fn terrain() -> Terrain {
        Terrain::new(&spec(), &ids).expect("the recipe is fine")
    }

    #[test]
    fn a_chunk_is_the_same_every_time_and_has_what_the_recipe_says() {
        let t = terrain();
        let a = t.generate(3, -2);
        assert_eq!(
            a,
            t.generate(3, -2),
            "pure: the same recipe and place give the same chunk"
        );
        assert_ne!(a, t.generate(4, -2));
        let count = |id: u8| a.iter().filter(|&&b| b == id).count();
        assert_eq!(a.len(), VOL);
        assert!(count(1) > 1000, "stone");
        assert!(count(7) >= SX * SZ, "bedrock under everything");
        assert!(count(10) > 0, "coal");
        // the surface: every column has a ground block at its height
        let (x0, z0) = (3 * 16, -2 * 16);
        for lz in 0..16 {
            for lx in 0..16 {
                let h = t.height(x0 + lx as i32, z0 + lz as i32);
                assert_ne!(a[idx(lx, h as usize, lz)], 0, "ground at {lx} {lz}");
                assert!(h < 120);
            }
        }
    }

    #[test]
    fn trees_that_cross_a_border_are_placed_by_both_chunks_alike() {
        // a recipe of nothing but forest: trees everywhere, so some cross
        let mut s = spec();
        s.biomes = vec![s.biomes[1].clone()];
        let t = Terrain::new(&s, &ids).unwrap();
        let (a, b) = (t.generate(0, 0), t.generate(1, 0));
        // leaves just inside the border of one chunk are matched by leaves just outside it in the other, somewhere along it
        let mut seen = 0;
        for lz in 0..16 {
            for y in 30..100 {
                if a[idx(15, y, lz)] == 9 && b[idx(0, y, lz)] == 9 {
                    seen += 1;
                }
            }
        }
        assert!(seen > 0, "a crown spans the border: {seen}");
        assert!(a.iter().filter(|&&x| x == 8).count() > 0, "logs");
    }

    #[test]
    fn wrong_recipes_say_what_is_wrong() {
        let err = |s: &Spec| Terrain::new(s, &ids).err().expect("an error");
        let mut s = spec();
        s.stone = "granite".into();
        assert!(err(&s).contains("granite"), "{}", err(&s));
        let mut s = spec();
        s.biomes.clear();
        assert!(err(&s).contains("biome"));
        let mut s = spec();
        s.biomes[1].trees[0].kind = "palm".into();
        assert!(err(&s).contains("palm"));
    }

    #[test]
    fn biomes_follow_their_ranges() {
        let t = terrain();
        let mut seen = std::collections::HashSet::new();
        for i in 0..400 {
            seen.insert(t.biome_name(i * 97, i * 53 - 5000).to_string());
        }
        assert!(seen.len() >= 2, "{seen:?}");
        assert_eq!(t.biome_name(0, 0), t.biome_name(0, 0));
    }
}
