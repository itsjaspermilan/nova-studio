//! `nova.ambient{...}`: life floating round the camera. Leaves drifting down from the trees near it, white wind curls that draw
//! themselves along the wind and fade, motes of pollen and dust in the sunlight, butterflies over flowers and small birds that fly
//! over in a loose group now and then, or come down by a tree, peck about and fly off when someone comes near.
//!
//! Everything is kept and moved here, in Rust, and drawn as blended quads (one instanced draw for each kind of picture), so the cost
//! is flat: no Lua runs for it, each kind has a hard cap, and nothing is kept farther from the camera than its reach (a thing that
//! drifts out is dropped and a new one is made near the camera). It all follows `nova.wind`. The pictures are painted here, flat and
//! soft, as the game's other things are: no files.
//!
//! Positions are on the flat ground the game draws on (y is the height above the ground there): the hills lift each quad by the
//! ground under it, as for every model.

use super::*;

/// The most of each kind there can be, whatever a game asks for.
pub const MAX_LEAVES: usize = 64;
pub const MAX_STREAKS: usize = 8;
pub const MAX_MOTES: usize = 96;
pub const MAX_BUTTERFLIES: usize = 12;
pub const MAX_FLOCK: usize = 12;
/// Segments of one wind curl's ribbon.
const STREAK_SEGMENTS: usize = 32;
/// A wind curl's alpha at its fullest, and its colour (linear: a white a little towards blue).
const STREAK_ALPHA: f32 = 0.5;
const STREAK_COLOR: [f32; 3] = [0.86, 0.92, 1.0];

const KEYS: [&str; KINDS] = [
    "__ambient:leaf",
    "__ambient:mote",
    "__ambient:streak",
    "__ambient:butterfly",
    "__ambient:bird_up",
    "__ambient:bird_level",
    "__ambient:bird_down",
    "__ambient:bird_sitting",
    "__ambient:bird_up_left",
    "__ambient:bird_level_left",
    "__ambient:bird_down_left",
    "__ambient:bird_sitting_left",
];
/// Pictures: the four kinds, the birds' four drawings facing right and the same facing left (a quad shows only its face, so a bird
/// turned the other way is its own picture, not a mirrored quad).
const KINDS: usize = 12;
/// How far the left-facing birds are from the right-facing ones in [`KEYS`].
const LEFT: usize = 4;
const LEAF: usize = 0;
const MOTE: usize = 1;
const STREAK: usize = 2;
const BUTTERFLY: usize = 3;
const BIRD_UP: usize = 4;
const BIRD_SITTING: usize = 7;

/// The pictures and their quads, for the loader to put on the GPU with the game's meshes.
pub(super) fn meshes() -> Vec<(String, MeshData)> {
    let leaf = paint(32, 32, |x, y| {
        // an almond, pointed at both ends, a little darker on one half, with a pale vein down the middle
        let d = ((x - 0.62).hypot(y) - 1.0).max((x + 0.62).hypot(y) - 1.0);
        let a = smooth(0.06, -0.04, d);
        let shade = if x < 0.0 { 0.84 } else { 1.0 };
        let vein = 1.0 + 0.12 * smooth(0.06, 0.0, x.abs()) * smooth(0.95, 0.6, y.abs());
        [shade * vein, shade * vein, shade * vein, a]
    });
    let mote = paint(16, 16, |x, y| {
        let r = x.hypot(y);
        let a = smooth(1.0, 0.45, r);
        [1.0, 1.0, 1.0, a]
    });
    let streak = paint(32, 32, |_x, y| {
        // across the line (v): a soft-edged stroke, full along its length (u), so quads laid end to end make one line
        let a = smooth(0.95, 0.35, y.abs());
        [1.0, 1.0, 1.0, a]
    });
    let butterfly = paint(32, 32, |x, y| {
        // two rounded wings a side seen face on, a darker rim, and a dark body down the middle
        let wing =
            ((x.abs() - 0.45).hypot(y - 0.22) - 0.42).min((x.abs() - 0.36).hypot(y + 0.38) - 0.3);
        let body = (x / 0.07).hypot(y / 0.6) - 1.0;
        let a = smooth(0.05, -0.03, wing.min(body * 0.07));
        let rim = smooth(-0.13, -0.07, wing);
        let v = if body < 0.0 { 0.25 } else { 1.0 - 0.3 * rim };
        [v, v, v, a]
    });
    let bird = |wings: f32| {
        // a small bird from the side, head to the right: an oval body, a round head, a short tail and two wings at `wings`
        // (1 up, 0 level, -1 down)
        paint(32, 32, move |x, y| {
            let body = ((x / 0.42).hypot((y + 0.05) / 0.2) - 1.0) * 0.2;
            let head = (x - 0.42).hypot(y - 0.07) - 0.15;
            let tail = segment(x, y, -0.35, -0.02, -0.75, 0.06) - 0.07;
            let tip_y = 0.62 * wings;
            let near_wing =
                segment(x, y, -0.02, 0.02, -0.38, tip_y) - 0.08 + 0.03 * ((x + 0.02) / 0.4).abs();
            let far_wing = segment(x, y, 0.05, 0.03, -0.2, tip_y * 0.75) - 0.06;
            let d = body.min(head).min(tail).min(near_wing).min(far_wing);
            let a = smooth(0.04, -0.03, d);
            let beak = segment(x, y, 0.55, 0.06, 0.7, 0.03) - 0.03;
            let a = a.max(smooth(0.03, -0.02, beak));
            // warm brown-grey, the far wing a shade darker, the beak a pale straw
            let c: [f32; 3] = if beak < 0.0 {
                [1.0, 0.78, 0.45]
            } else if far_wing < 0.0 && near_wing > 0.0 {
                [0.5, 0.48, 0.45]
            } else {
                [0.62, 0.6, 0.56]
            };
            [c[0], c[1], c[2], a]
        })
    };
    let sitting = paint(32, 32, |x, y| {
        // perched or pecking: a round body, its head up and forward, a tail cocked up behind, little legs
        let body = ((x / 0.4).hypot((y + 0.15) / 0.3) - 1.0) * 0.3;
        let head = (x - 0.36).hypot(y - 0.18) - 0.18;
        let tail = segment(x, y, -0.3, -0.1, -0.7, 0.18) - 0.07;
        let legs = segment(x, y, 0.0, -0.4, 0.02, -0.62) - 0.025;
        let d = body.min(head).min(tail).min(legs);
        let beak = segment(x, y, 0.5, 0.2, 0.68, 0.16) - 0.035;
        let a = smooth(0.04, -0.03, d.min(beak));
        let breast = smooth(-0.05, 0.05, x + 0.05) * smooth(0.05, -0.05, y + 0.05);
        let v = if beak < 0.0 {
            [1.0, 0.75, 0.4]
        } else {
            [0.62 + 0.3 * breast, 0.6 + 0.12 * breast, 0.56]
        };
        [v[0], v[1], v[2], a]
    });
    let glows = [
        0.25, 1.0, 1.0, 0.45, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35,
    ];
    let birds = [bird(1.0), bird(0.0), bird(-0.9), sitting];
    let left: Vec<Image> = birds.iter().map(mirrored).collect();
    [leaf, mote, streak, butterfly]
        .into_iter()
        .chain(birds)
        .chain(left)
        .zip(KEYS)
        .zip(glows)
        .map(|((image, key), glow)| (key.to_string(), quad(image, glow)))
        .collect()
}

/// The same picture turned left for right.
fn mirrored(image: &Image) -> Image {
    let (w, h) = (image.width as usize, image.height as usize);
    let mut rgba = vec![0u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let (from, to) = ((y * w + x) * 4, (y * w + (w - 1 - x)) * 4);
            rgba[to..to + 4].copy_from_slice(&image.rgba[from..from + 4]);
        }
    }
    Image {
        width: image.width,
        height: image.height,
        rgba,
    }
}

fn smooth(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Distance from (x, y) to the segment from a to b.
fn segment(x: f32, y: f32, ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
    let (px, py, dx, dy) = (x - ax, y - ay, bx - ax, by - ay);
    let h = ((px * dx + py * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
    (px - dx * h).hypot(py - dy * h)
}

/// A picture `w` by `h` from a function of the place (-1 to 1 across, -1 to 1 up) giving linear-ish rgb and alpha, 0 to 1. Colour
/// under a transparent edge is kept (not black), so the soft edges do not darken when filtered.
fn paint(w: u32, h: u32, f: impl Fn(f32, f32) -> [f32; 4]) -> Image {
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
    for j in 0..h {
        for i in 0..w {
            let x = (i as f32 + 0.5) / w as f32 * 2.0 - 1.0;
            let y = 1.0 - (j as f32 + 0.5) / h as f32 * 2.0;
            let c = f(x, y);
            rgba.extend(c.map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8));
        }
    }
    Image {
        width: w,
        height: h,
        rgba,
    }
}

/// A quad one across facing +z and -z (both sides show the picture the same way round), drawn blended (the vertex alpha below 255)
/// with `glow` of its own light.
fn quad(image: Image, glow: f32) -> MeshData {
    let mut mesh = billboard_api::quad_mesh(&image, [0.0, 0.0, 1.0, 1.0]);
    for v in &mut mesh.vertices {
        v.emissive = glow;
    }
    mesh.smooth = true;
    mesh
}

/// What a game asked for (`nova.ambient{...}`).
#[derive(Clone, Debug, Default)]
pub(super) struct Config {
    radius: f32,
    leaves: usize,
    trees: Vec<[f32; 3]>,
    leaf_colors: Vec<[f32; 3]>,
    streaks: usize,
    streak_every: f32,
    /// The ground's height (metres) from which wind curls come more often, up to twice as often and twice as many 10 m higher.
    streak_hills: Option<f32>,
    motes: usize,
    butterflies: usize,
    flowers: Vec<[f32; 2]>,
    butterfly_colors: Vec<[f32; 3]>,
    flock: usize,
    flock_every: f32,
    perches: Vec<[f32; 2]>,
}

#[derive(Clone, Copy, Debug)]
struct Leaf {
    p: Vec3,
    axis: Vec3,
    phase: f32,
    spin: f32,
    size: f32,
    color: [f32; 3],
    /// Seconds lying on the ground (0 while falling).
    resting: f32,
    age: f32,
}

#[derive(Clone, Copy, Debug)]
struct Streak {
    start: Vec3,
    dir: Vec3,
    side: Vec3,
    length: f32,
    loop_r: f32,
    age: f32,
    life: f32,
    width: f32,
}

#[derive(Clone, Copy, Debug)]
struct Mote {
    p: Vec3,
    phase: f32,
    size: f32,
}

#[derive(Clone, Copy, Debug)]
struct Butterfly {
    p: Vec3,
    home: Vec3,
    heading: f32,
    phase: f32,
    color: [f32; 3],
    age: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum BirdState {
    /// Passing over, high up.
    Over,
    /// Coming down to the ground at `target`.
    Landing,
    /// On the ground: pecking and hopping about.
    Down,
    /// Off again: up and away.
    Leaving,
}

#[derive(Clone, Copy, Debug)]
struct Bird {
    p: Vec3,
    v: Vec3,
    target: Vec3,
    state: BirdState,
    flap: f32,
    timer: f32,
    hop: f32,
    facing: f32,
}

/// What `nova.ambient_info()` tells a test: how many of each there are now and the farthest from the camera on the ground.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AmbientInfo {
    pub leaves: usize,
    pub streaks: usize,
    pub motes: usize,
    pub butterflies: usize,
    pub birds: usize,
    pub birds_down: usize,
    pub farthest: f32,
    pub quads: usize,
}

#[derive(Default)]
pub(super) struct Ambient {
    cfg: Option<Config>,
    rng: u64,
    leaves: Vec<Leaf>,
    streaks: Vec<Streak>,
    motes: Vec<Mote>,
    butterflies: Vec<Butterfly>,
    birds: Vec<Bird>,
    leaf_debt: f32,
    streak_timer: f32,
    flock_timer: f32,
    mesh: Option<[usize; KINDS]>,
    last_quads: usize,
}

impl Ambient {
    fn rand(&mut self) -> f32 {
        // xorshift64*
        let mut x = self.rng.max(1);
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.rng = x;
        ((x.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 40) as f32) / (1u64 << 24) as f32
    }

    fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.rand()
    }

    pub(super) fn set(&mut self, cfg: Option<Config>, seed: u64) {
        *self = Ambient {
            mesh: self.mesh,
            rng: seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1,
            cfg,
            ..Default::default()
        };
        if let Some(c) = &self.cfg {
            self.streak_timer = c.streak_every * 0.3;
            self.flock_timer = c.flock_every * 0.35;
        }
    }

    pub(super) fn info(&self, eye: Vec3) -> AmbientInfo {
        let mut far = 0.0f32;
        let mut see = |p: Vec3| far = far.max((p.x - eye.x).hypot(p.z - eye.z));
        self.leaves.iter().for_each(|l| see(l.p));
        self.streaks
            .iter()
            .for_each(|s| see(s.start + s.dir * s.length * 0.5));
        self.motes.iter().for_each(|m| see(m.p));
        self.butterflies.iter().for_each(|b| see(b.p));
        self.birds.iter().for_each(|b| see(b.p));
        AmbientInfo {
            leaves: self.leaves.len(),
            streaks: self.streaks.len(),
            motes: self.motes.len(),
            butterflies: self.butterflies.len(),
            birds: self.birds.len(),
            birds_down: self
                .birds
                .iter()
                .filter(|b| b.state == BirdState::Down)
                .count(),
            farthest: far,
            quads: self.last_quads,
        }
    }

    /// Moves everything on by `dt` seconds round the camera and adds its quads to the frame (`models`).
    pub(super) fn step(
        &mut self,
        dt: f32,
        sh: &Shared,
        models: &mut Vec<ModelDraw>,
        ribbons: &mut Vec<crate::gfx::Ribbon>,
    ) {
        let Some(cfg) = self.cfg.clone() else {
            self.last_quads = 0;
            return;
        };
        if self.mesh.is_none() {
            let mut ids = [0usize; KINDS];
            for (slot, key) in ids.iter_mut().zip(KEYS) {
                let Some(&id) = sh.mesh_ids.get(key) else {
                    return;
                };
                *slot = id;
            }
            self.mesh = Some(ids);
        }
        let mesh = self.mesh.unwrap_or_default();
        let dt = dt.clamp(0.0, 0.1);
        let terrain = &sh.lighting.terrain;
        let cam = sh.camera;
        // the eye on the flat ground the game draws on: its height above the ground under it
        let ground_eye = cam.eye.y - terrain.height(cam.eye.x, cam.eye.z);
        let eye = Vec3::new(cam.eye.x, ground_eye, cam.eye.z);
        let mut forward = cam.target - cam.eye;
        if forward.length_squared() < 1e-8 {
            forward = Vec3::Z;
        }
        let forward = forward.normalize();
        let mut right = forward.cross(Vec3::Y);
        if right.length_squared() < 1e-8 {
            right = Vec3::X;
        }
        let right = right.normalize();
        let up = right.cross(forward);
        let flat_fwd = Vec3::new(forward.x, 0.0, forward.z).normalize_or(Vec3::Z);
        let wind = &sh.lighting.wind;
        let wind_dir = Vec3::new(wind.direction[0], 0.0, wind.direction[1]).normalize_or(Vec3::X);
        let gust = wind.strength * (0.75 + 0.25 * (wind.time * 0.6).sin());
        let wind_v = wind_dir * gust;
        let sun = (-Vec3::from(sh.lighting.direction)).normalize_or(Vec3::Y);
        let r = cfg.radius;
        let ground_dist = |p: Vec3| (p.x - eye.x).hypot(p.z - eye.z);
        let start = models.len();
        // `tint`'s alpha is how far it has faded in (0 to 1). The renderer drops a blended pixel under 0.3 of alpha outright (cut-out
        // pictures), so a fade is a screen-door instead (the share of pixels kept), and each kind keeps its own see-through look
        let push = |models: &mut Vec<ModelDraw>, m: usize, matrix: Mat4, tint: [f32; 4]| {
            let fade = tint[3].clamp(0.0, 1.0);
            if fade <= 0.02 {
                return;
            }
            let look = if m == MOTE {
                0.7
            } else if m == STREAK {
                0.85
            } else {
                1.0
            };
            let instance = ModelInstance {
                matrix: matrix.to_cols_array_2d(),
                tint: [tint[0], tint[1], tint[2], look],
            };
            let instance = if fade < 0.98 {
                instance.dissolving(fade)
            } else {
                instance
            };
            models.push(ModelDraw {
                casts: false,
                mesh: mesh[m],
                instance: instance.rigid().kept_whole(),
            });
        };
        // a quad facing the camera, `w` across and `h` up, turned by `rot` in the view
        let facing = |p: Vec3, w: f32, h: f32, rot: f32| {
            let (s, c) = rot.sin_cos();
            let (rx, uy) = (right * c + up * s, up * c - right * s);
            Mat4::from_cols(
                (rx * w).extend(0.0),
                (uy * h).extend(0.0),
                (-forward).extend(0.0),
                p.extend(1.0),
            )
        };

        // ---- leaves: from the crowns of the trees near the camera, tumbling down along the wind ----
        let want = cfg.leaves.min(MAX_LEAVES);
        if want > 0 {
            self.leaf_debt += dt * want as f32 / 7.0;
            while self.leaf_debt >= 1.0 && self.leaves.len() < want {
                self.leaf_debt -= 1.0;
                let near: Vec<[f32; 3]> = cfg
                    .trees
                    .iter()
                    .filter(|t| (t[0] - eye.x).hypot(t[1] - eye.z) < r * 0.85)
                    .copied()
                    .collect();
                let (x, h, z) = if cfg.trees.is_empty() {
                    let a = self.range(0.0, std::f32::consts::TAU);
                    let d = self.range(3.0, r * 0.8);
                    (
                        eye.x + a.sin() * d,
                        self.range(3.0, 7.0),
                        eye.z + a.cos() * d,
                    )
                } else if near.is_empty() {
                    break;
                } else {
                    let t = near[(self.rand() * near.len() as f32) as usize % near.len()];
                    let a = self.range(0.0, std::f32::consts::TAU);
                    let d = self.range(0.3, 1.6);
                    (
                        t[0] + a.sin() * d,
                        t[2] * self.range(0.5, 0.95),
                        t[1] + a.cos() * d,
                    )
                };
                let color = if cfg.leaf_colors.is_empty() {
                    [0.85, 0.75, 0.3]
                } else {
                    cfg.leaf_colors[(self.rand() * cfg.leaf_colors.len() as f32) as usize
                        % cfg.leaf_colors.len()]
                };
                let axis = Vec3::new(
                    self.range(-1.0, 1.0),
                    self.range(-0.3, 0.3),
                    self.range(-1.0, 1.0),
                )
                .normalize_or(Vec3::X);
                let leaf = Leaf {
                    p: Vec3::new(x, h, z),
                    axis,
                    phase: self.range(0.0, 6.3),
                    spin: self.range(2.0, 4.5),
                    size: self.range(0.2, 0.28),
                    color,
                    resting: 0.0,
                    age: 0.0,
                };
                self.leaves.push(leaf);
            }
            self.leaf_debt = self.leaf_debt.min(2.0);
        }
        self.leaves.retain_mut(|l| {
            l.age += dt;
            if l.resting > 0.0 || l.p.y <= 0.03 {
                l.resting += dt;
                l.p.y = 0.03;
            } else {
                l.phase += dt * l.spin;
                // a leaf falls slowly, swinging across the wind as it goes, and the wind carries it
                let sway = Vec3::new(-wind_dir.z, 0.0, wind_dir.x) * (l.phase * 0.7).sin() * 0.55;
                let v =
                    wind_v * 0.9 + sway + Vec3::new(0.0, -0.5 - 0.25 * (l.phase * 1.4).sin(), 0.0);
                l.p += v * dt;
            }
            l.resting < 2.5 && l.age < 40.0 && ground_dist(l.p) < r * 1.15
        });
        for l in &self.leaves {
            let fade = smooth(0.0, 0.4, l.age) * (1.0 - smooth(1.5, 2.5, l.resting));
            let rot = if l.resting > 0.0 {
                // lying on the ground, face up
                Mat4::from_rotation_x(-std::f32::consts::FRAC_PI_2) * Mat4::from_rotation_z(l.phase)
            } else {
                Mat4::from_axis_angle(l.axis, l.phase)
            };
            let mut m = Mat4::from_translation(l.p)
                * rot
                * Mat4::from_scale(Vec3::new(l.size * 0.62, l.size, 1.0));
            // (only a quad's face is drawn: a leaf turned away is mirrored to face the camera, which a leaf does not mind)
            if m.x_axis
                .truncate()
                .cross(m.y_axis.truncate())
                .dot(eye - l.p)
                < 0.0
            {
                m.x_axis = -m.x_axis;
                m.z_axis = -m.z_axis;
            }
            push(models, LEAF, m, [l.color[0], l.color[1], l.color[2], fade]);
        }

        // ---- wind curls: a white stroke that draws itself along the wind, rolls into a loop and fades ----
        // (more on a hilltop, from `hills` metres of ground up, and while the wind gusts)
        let hill = cfg.streak_hills.map_or(0.0, |h| {
            ((terrain.height(cam.eye.x, cam.eye.z) - h) / 10.0).clamp(0.0, 1.0)
        });
        let want = ((cfg.streaks as f32 * (1.0 + hill)).round() as usize).min(MAX_STREAKS);
        if want > 0 && wind.strength > 0.05 {
            let gusting = (gust / wind.strength.max(1e-3)).powi(2) * 1.3;
            self.streak_timer -= dt * gusting * (1.0 + hill);
            if self.streak_timer <= 0.0 && self.streaks.len() < want {
                self.streak_timer =
                    cfg.streak_every * self.range(0.6, 1.4) / wind.strength.max(0.3).sqrt();
                // ahead of the camera, a little to either side, where it will be seen
                let a = self.range(-0.9, 0.9);
                let d = self.range(5.0, r.min(16.0));
                let ahead = flat_fwd * a.cos() + Vec3::new(-flat_fwd.z, 0.0, flat_fwd.x) * a.sin();
                let length = self.range(4.0, 7.0);
                let mid = Vec3::new(eye.x, 0.0, eye.z) + ahead * d;
                // along the wind, but turned towards across the view: a curl seen end on is a dot (it still goes with the wind's
                // sideways part, and with it entirely when the wind blows across the view)
                let across_view = Vec3::new(-flat_fwd.z, 0.0, flat_fwd.x);
                let sideways = wind_dir.dot(across_view);
                let sign = if sideways.abs() > 0.05 {
                    sideways.signum()
                } else if self.rand() < 0.5 {
                    1.0
                } else {
                    -1.0
                };
                let dir = (wind_dir * 0.5 + across_view * sign * (1.0 - sideways.abs()).max(0.0))
                    .normalize_or(wind_dir);
                let start = mid - dir * length * 0.5 + Vec3::new(0.0, self.range(0.8, 3.2), 0.0);
                let side =
                    Vec3::new(-dir.z, 0.0, dir.x) * if self.rand() < 0.5 { 1.0 } else { -1.0 };
                let streak = Streak {
                    start,
                    dir,
                    side,
                    length,
                    loop_r: self.range(0.35, 0.6),
                    age: 0.0,
                    life: self.range(2.2, 3.0),
                    width: self.range(0.05, 0.08),
                };
                self.streaks.push(streak);
            }
        }
        self.streaks.retain_mut(|s| {
            s.age += dt;
            s.start += wind_v * 0.5 * dt;
            s.age < s.life && ground_dist(s.start) < r * 1.2
        });
        // each curl is a ribbon (gfx/ribbon.rs: blended in its own pass, its edges soft and its faint parts kept): a thin stroke,
        // pointed at both ends, palest at its tail and fullest just behind its head, a slightly blue-tinted white at about half alpha
        for s in &self.streaks {
            let k = s.age / s.life;
            // the head runs ahead and the tail follows it: what is drawn is the part of the path between them
            let head = smooth(0.0, 0.62, k);
            let tail = smooth(0.32, 1.0, k);
            if head - tail < 0.01 {
                continue;
            }
            let alpha = STREAK_ALPHA * smooth(0.0, 0.15, k) * (1.0 - smooth(0.8, 1.0, k));
            let points = (0..=STREAK_SEGMENTS)
                .map(|i| {
                    let w = i as f32 / STREAK_SEGMENTS as f32;
                    let p = curl_point(s, tail + (head - tail) * w);
                    let taper = (std::f32::consts::PI * w).sin().max(0.0).powf(0.6); // (sin(pi) is a hair under 0)
                    let along = 0.35 + 0.65 * smooth(0.0, 0.75, w);
                    [
                        p.x,
                        p.y,
                        p.z,
                        s.width * 0.5 * taper,
                        alpha * along * taper.sqrt(),
                    ]
                })
                .collect();
            ribbons.push(crate::gfx::Ribbon {
                points,
                color: STREAK_COLOR,
            });
        }

        // ---- motes: pollen and dust round the camera, glinting when it looks towards the sun ----
        let want = cfg.motes.min(MAX_MOTES);
        let centre = eye + flat_fwd * 5.0;
        while self.motes.len() < want {
            let p = centre + Vec3::new(self.range(-6.0, 6.0), 0.0, self.range(-6.0, 6.0));
            let mote = Mote {
                p: Vec3::new(
                    p.x,
                    self.range(0.3, (ground_eye + 2.5).clamp(1.5, 6.0)),
                    p.z,
                ),
                phase: self.range(0.0, 6.3),
                size: self.range(0.05, 0.08),
            };
            self.motes.push(mote);
        }
        self.motes.truncate(want);
        let glint = smooth(-0.3, 0.9, forward.dot(sun));
        let top = (ground_eye + 2.5).clamp(1.5, 6.0);
        for i in 0..self.motes.len() {
            let mut m = self.motes[i];
            m.phase += dt;
            let drift = Vec3::new(
                (m.phase * 0.37).sin(),
                (m.phase * 0.53).sin() * 0.6,
                (m.phase * 0.29).cos(),
            ) * 0.12;
            m.p += (wind_v * 0.22 + drift) * dt;
            // kept in a box round a spot ahead of the camera: one that leaves it comes back in on the other side
            for (axis, half) in [(0usize, 6.0f32), (2, 6.0)] {
                let d = m.p[axis] - centre[axis];
                if d.abs() > half {
                    m.p[axis] -= d.signum() * 2.0 * half * (d.abs() / (2.0 * half) + 0.5).floor();
                }
            }
            if m.p.y < 0.2 || m.p.y > top + 0.5 {
                m.p.y = 0.25 + (m.p.y - 0.25).rem_euclid(top);
            }
            self.motes[i] = m;
            let near = 1.0 - smooth(8.0, 11.0, (m.p - Vec3::new(eye.x, m.p.y, eye.z)).length());
            let twinkle = 0.65 + 0.35 * (m.phase * 2.3).sin();
            let a = (0.3 + 0.7 * glint) * twinkle * near * smooth(0.4, 1.4, (m.p - eye).length());
            push(
                models,
                MOTE,
                facing(
                    m.p,
                    m.size * (0.75 + 0.5 * glint),
                    m.size * (0.75 + 0.5 * glint),
                    0.0,
                ),
                [1.0, 0.97, 0.85, a],
            );
        }

        // ---- butterflies: over the flowers near the camera, fluttering about their flower ----
        let want = cfg.butterflies.min(MAX_BUTTERFLIES);
        if want > 0
            && self.butterflies.len() < want
            && !cfg.flowers.is_empty()
            && self.rand() < dt * 2.0
        {
            let near: Vec<[f32; 2]> = cfg
                .flowers
                .iter()
                .filter(|f| (f[0] - eye.x).hypot(f[1] - eye.z) < r * 0.8)
                .copied()
                .collect();
            if !near.is_empty() {
                let f = near[(self.rand() * near.len() as f32) as usize % near.len()];
                let home = Vec3::new(
                    f[0] + self.range(-1.0, 1.0),
                    0.6,
                    f[1] + self.range(-1.0, 1.0),
                );
                let color = if cfg.butterfly_colors.is_empty() {
                    [1.0, 0.95, 0.7]
                } else {
                    cfg.butterfly_colors[(self.rand() * cfg.butterfly_colors.len() as f32) as usize
                        % cfg.butterfly_colors.len()]
                };
                let b = Butterfly {
                    p: home + Vec3::new(0.0, self.range(0.0, 0.6), 0.0),
                    home,
                    heading: self.range(0.0, 6.3),
                    phase: self.range(0.0, 6.3),
                    color,
                    age: 0.0,
                };
                self.butterflies.push(b);
            }
        }
        for i in 0..self.butterflies.len() {
            let mut b = self.butterflies[i];
            b.age += dt;
            b.phase += dt;
            // wandering: the heading turns this way and that, and back towards home when it strays
            let to_home = b.home - b.p;
            let home_heading = to_home.x.atan2(to_home.z);
            let pull = smooth(0.8, 2.6, (to_home.x).hypot(to_home.z));
            let turn = (b.phase * 1.7).sin() * 2.2 + (b.phase * 3.1).cos() * 1.3;
            let diff = (home_heading - b.heading + std::f32::consts::PI)
                .rem_euclid(std::f32::consts::TAU)
                - std::f32::consts::PI;
            b.heading += (turn + diff * pull * 3.0) * dt;
            let speed = 1.1;
            b.p += Vec3::new(b.heading.sin() * speed, 0.0, b.heading.cos() * speed) * dt
                + wind_v * 0.25 * dt;
            b.p.y =
                (b.home.y + 0.35 * (b.phase * 2.1).sin() + 0.2 * (b.phase * 0.7).sin()).max(0.25);
            self.butterflies[i] = b;
        }
        self.butterflies.retain(|b| ground_dist(b.home) < r * 1.1);
        for b in &self.butterflies {
            let flap = (b.phase * 52.0).sin().abs();
            let w = 0.26 * (0.18 + 0.82 * flap);
            let fade = smooth(0.0, 0.6, b.age);
            push(
                models,
                BUTTERFLY,
                facing(b.p, w, 0.2, 0.25 * (b.phase * 1.3).sin()),
                [b.color[0], b.color[1], b.color[2], fade],
            );
        }

        // ---- birds: a small flock now and then, passing over, or coming down by a tree to peck about ----
        let want = cfg.flock.min(MAX_FLOCK);
        if want > 0 && self.birds.is_empty() {
            self.flock_timer -= dt;
            if self.flock_timer <= 0.0 {
                self.flock_timer = cfg.flock_every * self.range(0.7, 1.3);
                let n = (want as f32 * self.range(0.6, 1.0)).round().max(2.0) as usize;
                let n = n.min(want);
                let near: Vec<[f32; 2]> = cfg
                    .perches
                    .iter()
                    .filter(|p| {
                        let d = (p[0] - eye.x).hypot(p[1] - eye.z);
                        d > 9.0 && d < r * 0.9
                    })
                    .copied()
                    .collect();
                // across the view, from one side to the other
                let across = Vec3::new(-flat_fwd.z, 0.0, flat_fwd.x)
                    * if self.rand() < 0.5 { 1.0 } else { -1.0 };
                let heading = (across + flat_fwd * self.range(-0.4, 0.6)).normalize_or(across);
                let land = !near.is_empty() && self.rand() < 0.6;
                let spot = if land {
                    near[(self.rand() * near.len() as f32) as usize % near.len()]
                } else {
                    [0.0, 0.0]
                };
                for k in 0..n {
                    let jitter = Vec3::new(
                        self.range(-3.0, 3.0),
                        self.range(-1.5, 1.5),
                        self.range(-3.0, 3.0),
                    );
                    let (p, v, target, state) = if land {
                        let target = Vec3::new(
                            spot[0] + self.range(-1.6, 1.6),
                            0.0,
                            spot[1] + self.range(-1.6, 1.6),
                        );
                        let from = target - heading * self.range(42.0, 52.0)
                            + Vec3::new(0.0, self.range(14.0, 18.0), 0.0)
                            + jitter;
                        (from, heading * 7.0, target, BirdState::Landing)
                    } else {
                        let mid = Vec3::new(eye.x, 0.0, eye.z) + flat_fwd * self.range(14.0, 26.0);
                        let from = mid - heading * r * 1.6
                            + Vec3::new(0.0, self.range(15.0, 22.0), 0.0)
                            + jitter;
                        (
                            from,
                            heading * self.range(7.5, 8.5),
                            Vec3::ZERO,
                            BirdState::Over,
                        )
                    };
                    let bird = Bird {
                        p,
                        v,
                        target,
                        state,
                        flap: self.range(0.0, 6.3) + k as f32,
                        timer: self.range(6.0, 14.0),
                        hop: 0.0,
                        facing: 1.0,
                    };
                    self.birds.push(bird);
                }
            }
        }
        let cam_flat = Vec3::new(eye.x, 0.0, eye.z);
        for i in 0..self.birds.len() {
            let mut b = self.birds[i];
            match b.state {
                BirdState::Over => {
                    b.p += b.v * dt;
                    b.flap += dt * 13.0;
                }
                BirdState::Landing => {
                    let to = b.target - b.p;
                    let d = to.length();
                    if d < 0.15 {
                        b.p = b.target;
                        b.v = Vec3::ZERO;
                        b.state = BirdState::Down;
                    } else {
                        // gliding in, slowing as it comes down, a few flaps to land
                        let speed = (d * 0.6).clamp(1.6, 7.0);
                        b.v = b.v.lerp(to / d * speed, (dt * 2.5).min(1.0));
                        b.p += b.v * dt;
                        b.flap += dt * if d < 4.0 { 16.0 } else { 3.0 };
                    }
                }
                BirdState::Down => {
                    b.timer -= dt;
                    b.flap += dt;
                    // a hop now and then: a short arc to a spot nearby
                    if b.hop <= 0.0 && self.rand() < dt * 0.5 {
                        b.hop = 0.35;
                        let a = self.range(0.0, 6.3);
                        b.target = b.p + Vec3::new(a.sin(), 0.0, a.cos()) * 0.3;
                    }
                    if b.hop > 0.0 {
                        b.hop -= dt;
                        let k = 1.0 - (b.hop / 0.35).max(0.0);
                        let flat = Vec3::new(b.p.x, 0.0, b.p.z).lerp(
                            Vec3::new(b.target.x, 0.0, b.target.z),
                            (dt / 0.35 * 1.5).min(1.0),
                        );
                        b.p = Vec3::new(flat.x, 0.12 * (k * std::f32::consts::PI).sin(), flat.z);
                    } else {
                        b.p.y = 0.0;
                    }
                    // off when the time is up, or when someone comes near
                    if b.timer <= 0.0
                        || (cam_flat - Vec3::new(b.p.x, 0.0, b.p.z)).length()
                            < 5.5 + ground_eye * 0.3
                    {
                        b.state = BirdState::Leaving;
                        let away = (Vec3::new(b.p.x, 0.0, b.p.z) - cam_flat).normalize_or(Vec3::X);
                        b.v = (away * 4.0 + Vec3::new(0.0, 3.5, 0.0))
                            + Vec3::new(self.range(-1.0, 1.0), 0.0, self.range(-1.0, 1.0));
                    }
                }
                BirdState::Leaving => {
                    b.v += (Vec3::new(b.v.x, 0.0, b.v.z).normalize_or(Vec3::X) * 2.5
                        + Vec3::new(0.0, 0.6, 0.0))
                        * dt;
                    b.v = b.v.clamp_length_max(9.0);
                    b.p += b.v * dt;
                    b.flap += dt * 15.0;
                }
            }
            let screen_x = b.v.dot(right);
            if screen_x.abs() > 0.05 {
                b.facing = screen_x.signum();
            } else if b.state == BirdState::Down {
                b.facing = if (b.target - b.p).dot(right) >= 0.0 {
                    1.0
                } else {
                    -1.0
                };
            }
            self.birds[i] = b;
        }
        self.birds
            .retain(|b| ground_dist(b.p) < r * 2.2 && b.p.y < 60.0);
        for b in &self.birds {
            let (m, size) = if b.state == BirdState::Down {
                (BIRD_SITTING, 0.32)
            } else {
                // flapping (up, level, down, level) and gliding for a while now and then
                let glide = b.state == BirdState::Over && (b.flap * 0.11).sin() > 0.55;
                let f = if glide {
                    1
                } else {
                    [0, 1, 2, 1][((b.flap / 1.5).rem_euclid(4.0)) as usize % 4]
                };
                (BIRD_UP + f, 0.46)
            };
            let lift = if b.state == BirdState::Down {
                size * 0.45
            } else {
                0.0
            };
            let p = b.p + Vec3::new(0.0, lift, 0.0);
            let fade = 1.0 - smooth(r * 1.6, r * 2.1, ground_dist(b.p));
            push(
                models,
                if b.facing < 0.0 { m + LEFT } else { m },
                facing(p, size, size, 0.0),
                [0.62, 0.56, 0.52, fade],
            );
        }
        self.last_quads = models.len() - start;
    }
}

/// A point along a wind curl, `u` from 0 (its start) to 1 (its end): a gentle wave along the wind for most of its length, then a
/// loop rolled up over its end, in the upright plane that holds the wind.
fn curl_point(s: &Streak, u: f32) -> Vec3 {
    let straight = 0.68;
    if u <= straight {
        let x = u / straight * s.length;
        let wave = (u * 9.0).sin() * 0.12 * smooth(0.0, 0.2, u);
        s.start + s.dir * x + Vec3::new(0.0, wave, 0.0) + s.side * (u * 5.0).sin() * 0.1
    } else {
        // round the loop: up and back over itself, ending a little short of a full turn
        let k = (u - straight) / (1.0 - straight);
        let a = k * std::f32::consts::TAU * 0.92;
        let end = s.start
            + s.dir * s.length
            + s.side * (straight * 5.0).sin() * 0.1
            + Vec3::new(0.0, (straight * 9.0).sin() * 0.12, 0.0);
        end + s.dir * (a.sin() * s.loop_r) + Vec3::new(0.0, (1.0 - a.cos()) * s.loop_r, 0.0)
    }
}

/// `{ {x, z, h}, ... }` (or two numbers each): a list of places.
fn places<const N: usize>(t: &Table, key: &str) -> mlua::Result<Vec<[f32; N]>> {
    let Some(list) = t.get::<Option<Table>>(key)? else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for item in list.sequence_values::<Table>() {
        let item = item?;
        let mut p = [0.0f32; N];
        for (i, slot) in p.iter_mut().enumerate() {
            *slot = item.get::<Option<f32>>(i + 1)?.ok_or_else(|| {
                lua_err(format!(
                    "nova.ambient's {key} are lists of {N} numbers each"
                ))
            })?;
        }
        out.push(p);
    }
    Ok(out)
}

/// `{ {r, g, b}, ... }` as picked on screen (0 to 255), made linear as `nova.clear` does.
fn colors(t: &Table, key: &str) -> mlua::Result<Vec<[f32; 3]>> {
    places::<3>(t, key).map(|list| {
        list.into_iter()
            .map(|c| c.map(|v| (v.clamp(0.0, 255.0) / 255.0).powf(2.2)))
            .collect()
    })
}

/// `count` of a part, held to the kind's cap.
fn count(t: &Option<Table>, cap: usize) -> mlua::Result<usize> {
    Ok(number_option(t, "count")?
        .map_or(0, |n| n.max(0.0) as usize)
        .min(cap))
}

fn part(opts: &Table, key: &str) -> mlua::Result<Option<Table>> {
    match opts.get::<Value>(key)? {
        Value::Nil | Value::Boolean(false) => Ok(None),
        Value::Table(t) => Ok(Some(t)),
        _ => Err(lua_err(format!(
            "nova.ambient's {key} is a table of options, e.g. {key} = {{ count = 10 }}"
        ))),
    }
}

pub(super) fn install(lua: &Lua, shared: &Rc<RefCell<Shared>>, nova: &Table) -> mlua::Result<()> {
    let s = shared.clone();
    nova.set(
        "ambient",
        lua.create_function(move |_, opts: Option<Table>| {
            let Some(opts) = opts else {
                s.borrow_mut().ambient.set(None, 0);
                return Ok(());
            };
            for pair in opts.pairs::<String, Value>() {
                let (k, _) = pair?;
                if !["radius", "seed", "leaves", "streaks", "motes", "butterflies", "birds"].contains(&k.as_str()) {
                    return Err(lua_err(format!(
                        "nova.ambient has no '{k}': it takes radius, seed, leaves, streaks, motes, butterflies and birds"
                    )));
                }
            }
            let o = Some(opts.clone());
            let radius = number_option(&o, "radius")?.unwrap_or(30.0);
            if !radius.is_finite() || !(5.0..=120.0).contains(&radius) {
                return Err(lua_err(format!("nova.ambient's radius is 5 to 120 metres, not {radius}")));
            }
            let seed = number_option(&o, "seed")?.unwrap_or(1.0) as u64;
            let mut cfg = Config { radius: radius as f32, streak_every: 3.0, flock_every: 30.0, ..Default::default() };
            if let Some(t) = part(&opts, "leaves")? {
                cfg.leaves = count(&Some(t.clone()), MAX_LEAVES)?;
                cfg.trees = places::<3>(&t, "trees")?;
                cfg.leaf_colors = colors(&t, "colors")?;
            }
            if let Some(t) = part(&opts, "streaks")? {
                let o = Some(t.clone());
                cfg.streaks = count(&o, MAX_STREAKS)?;
                cfg.streak_every = number_option(&o, "every")?.unwrap_or(3.0).clamp(0.3, 120.0) as f32;
                cfg.streak_hills = number_option(&o, "hills")?.map(|h| h as f32);
            }
            if let Some(t) = part(&opts, "motes")? {
                cfg.motes = count(&Some(t), MAX_MOTES)?;
            }
            if let Some(t) = part(&opts, "butterflies")? {
                cfg.butterflies = count(&Some(t.clone()), MAX_BUTTERFLIES)?;
                cfg.flowers = places::<2>(&t, "flowers")?;
                cfg.butterfly_colors = colors(&t, "colors")?;
            }
            if let Some(t) = part(&opts, "birds")? {
                let o = Some(t.clone());
                cfg.flock = count(&o, MAX_FLOCK)?;
                cfg.flock_every = number_option(&o, "every")?.unwrap_or(30.0).clamp(1.0, 600.0) as f32;
                cfg.perches = places::<2>(&t, "perches")?;
            }
            s.borrow_mut().ambient.set(Some(cfg), seed);
            Ok(())
        })?,
    )?;
    let s = shared.clone();
    nova.set(
        "ambient_info",
        lua.create_function(move |lua, ()| {
            let sh = s.borrow();
            let i = sh.ambient.info(sh.camera.eye);
            let t = lua.create_table()?;
            t.set("leaves", i.leaves)?;
            t.set("streaks", i.streaks)?;
            t.set("motes", i.motes)?;
            t.set("butterflies", i.butterflies)?;
            t.set("birds", i.birds)?;
            t.set("birds_down", i.birds_down)?;
            t.set("farthest", i.farthest)?;
            t.set("quads", i.quads)?;
            Ok(t)
        })?,
    )?;
    Ok(())
}
