//! The M1 spike scene: thousands of 2D sprites over a 3D rally scene, a Lua-driven
//! car, a debug HUD and frame-time statistics. It exists to measure, not to ship.

use glam::{Mat4, Vec3};

use crate::font;
use crate::gfx::{Camera, FrameInput, FrameStats, Gfx, ModelDraw, ModelInstance, SpriteInstance};
use crate::model::{self, Image, MeshData};
use crate::script::ScriptState;

pub const CAR_GLB: &[u8] = include_bytes!("../assets/spike/car.glb");
pub const MAIN_LUA: &str = include_str!("../assets/spike/main.lua");

const ATLAS: u32 = 64;

/// Procedural sprite atlas: four 32x32 tiles (disc, rounded square, diamond, ring).
pub fn make_atlas() -> Image {
    let mut rgba = vec![0u8; (ATLAS * ATLAS * 4) as usize];
    for y in 0..ATLAS {
        for x in 0..ATLAS {
            let (tx, ty) = (x / 32, y / 32);
            let (u, v) = ((x % 32) as f32 + 0.5 - 16.0, (y % 32) as f32 + 0.5 - 16.0);
            let inside = match (tx, ty) {
                (0, 0) => u * u + v * v <= 15.0 * 15.0,
                (1, 0) => u.abs() <= 14.0 && v.abs() <= 14.0,
                (0, 1) => u.abs() + v.abs() <= 15.0,
                _ => {
                    let d = (u * u + v * v).sqrt();
                    (9.0..=15.0).contains(&d)
                }
            };
            if inside {
                let i = ((y * ATLAS + x) * 4) as usize;
                rgba[i..i + 4].copy_from_slice(&[255, 255, 255, 255]);
            }
        }
    }
    Image {
        width: ATLAS,
        height: ATLAS,
        rgba,
    }
}

fn tile_uv(tile: u32) -> [f32; 4] {
    let (tx, ty) = ((tile % 2) as f32, (tile / 2) as f32);
    let inset = 0.5 / ATLAS as f32;
    [
        tx * 0.5 + inset,
        ty * 0.5 + inset,
        tx * 0.5 + 0.5 - inset,
        ty * 0.5 + 0.5 - inset,
    ]
}

/// Interior of the rounded square: always opaque white, used for solid shapes and text.
fn solid_uv() -> [f32; 4] {
    let (x, y) = (48.0 / ATLAS as f32, 16.0 / ATLAS as f32);
    let e = 1.0 / ATLAS as f32;
    [x - e, y - e, x + e, y + e]
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> f32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 40) as f32 / (1u64 << 24) as f32
    }
}

struct Particle {
    pos: [f32; 2],
    vel: [f32; 2],
    size: f32,
    rotation: f32,
    spin: f32,
    tile: u32,
    color: [u8; 4],
}

#[derive(Default)]
pub struct FrameTimes {
    pub update_ms: f32,
    pub lua_ms: f32,
    pub render_ms: f32,
}

pub struct Spike {
    particles: Vec<Particle>,
    rng: Rng,
    car_mesh: usize,
    ground_mesh: usize,
    built_cars: Option<usize>,
    scenery: Vec<ModelDraw>,
    models: Vec<ModelDraw>,
    back: Vec<SpriteInstance>,
    front: Vec<SpriteInstance>,
    pub adapter: String,
    pub notes: Vec<String>,
}

impl Spike {
    pub fn new(gfx: &mut Gfx) -> Result<Self, String> {
        gfx.set_sprite_atlas(&make_atlas());
        let car = model::import_glb(CAR_GLB)?;
        let notes = car.notes.clone();
        for note in &notes {
            log::warn!("car.glb: {note}");
        }
        let car_mesh = gfx.upload_mesh(&car);
        // The ground samples the palette's off-white cell and is tinted green per instance.
        let ground = MeshData {
            texture: car.texture,
            ..MeshData::ground(120.0, [(1.0 + 0.5) / 6.0, 0.5])
        };
        let ground_mesh = gfx.upload_mesh(&ground);
        let adapter = format!("{} ({:?})", gfx.adapter_info.name, gfx.adapter_info.backend);
        Ok(Self {
            particles: Vec::new(),
            rng: Rng(0x9E37_79B9_7F4A_7C15),
            car_mesh,
            ground_mesh,
            built_cars: None,
            scenery: Vec::new(),
            models: Vec::new(),
            back: Vec::new(),
            front: Vec::new(),
            adapter,
            notes,
        })
    }

    fn resize_particles(&mut self, count: usize, view: [f32; 2]) {
        while self.particles.len() < count {
            let r = &mut self.rng;
            self.particles.push(Particle {
                pos: [r.next() * view[0], r.next() * view[1]],
                vel: [(r.next() - 0.5) * 120.0, (r.next() - 0.5) * 120.0],
                size: 6.0 + r.next() * 10.0,
                rotation: r.next() * std::f32::consts::TAU,
                spin: (r.next() - 0.5) * 3.0,
                tile: (r.next() * 4.0) as u32 % 4,
                color: [
                    (80.0 + r.next() * 175.0) as u8,
                    (80.0 + r.next() * 175.0) as u8,
                    (80.0 + r.next() * 175.0) as u8,
                    170,
                ],
            });
        }
        self.particles.truncate(count);
    }

    fn rebuild_scenery(&mut self, count: usize) {
        if self.built_cars == Some(count) {
            return;
        }
        self.built_cars = Some(count);
        self.scenery.clear();
        self.scenery.push(ModelDraw {
            mesh: self.ground_mesh,
            instance: ModelInstance {
                matrix: Mat4::from_translation(Vec3::new(0.0, -0.02, 0.0)).to_cols_array_2d(),
                tint: [0.45, 0.62, 0.34, 1.0],
            },
        });
        let side = (count as f32).sqrt().ceil() as i32 + 2;
        let mut r = Rng(42);
        let mut placed = 0;
        'grid: for gz in 0..side {
            for gx in 0..side {
                if placed == count {
                    break 'grid;
                }
                let x = (gx - side / 2) as f32 * 9.0 + 4.5;
                let z = (gz - side / 2) as f32 * 9.0 + 4.5;
                if x.abs() < 7.0 && z.abs() < 7.0 {
                    continue; // keep the start area clear for the player car
                }
                let m = Mat4::from_translation(Vec3::new(x, 0.0, z))
                    * Mat4::from_rotation_y(r.next() * std::f32::consts::TAU);
                let tint = [
                    0.55 + r.next() * 0.45,
                    0.55 + r.next() * 0.45,
                    0.55 + r.next() * 0.45,
                    1.0,
                ];
                self.scenery.push(ModelDraw {
                    mesh: self.car_mesh,
                    instance: ModelInstance {
                        matrix: m.to_cols_array_2d(),
                        tint,
                    },
                });
                placed += 1;
            }
        }
    }

    /// Advances the sprite simulation and builds this frame's draw lists.
    /// `hud` is the text drawn over everything. Returns the elapsed simulation time.
    pub fn build(&mut self, dt: f32, size: (u32, u32), state: &ScriptState, hud: &str) -> f32 {
        let started = std::time::Instant::now();
        let scale = Gfx::ui_scale(size);
        let view = [size.0 as f32 / scale, size.1 as f32 / scale];
        self.resize_particles(state.sprite_count, view);
        self.rebuild_scenery(state.car_count);

        // Draws sharing a mesh must be contiguous; the player car joins the other cars at the end.
        self.models.clear();
        self.models.extend_from_slice(&self.scenery);
        let [x, z, heading] = state.car;
        let m = Mat4::from_translation(Vec3::new(x, 0.0, z)) * Mat4::from_rotation_y(heading);
        self.models.push(ModelDraw {
            mesh: self.car_mesh,
            instance: ModelInstance {
                matrix: m.to_cols_array_2d(),
                tint: [1.0; 4],
            },
        });

        self.back.clear();
        for p in &mut self.particles {
            p.pos[0] += p.vel[0] * dt;
            p.pos[1] += p.vel[1] * dt;
            p.rotation += p.spin * dt;
            if p.pos[0] < 0.0 || p.pos[0] > view[0] {
                p.vel[0] = -p.vel[0];
                p.pos[0] = p.pos[0].clamp(0.0, view[0]);
            }
            if p.pos[1] < 0.0 || p.pos[1] > view[1] {
                p.vel[1] = -p.vel[1];
                p.pos[1] = p.pos[1].clamp(0.0, view[1]);
            }
            self.back.push(SpriteInstance {
                center: p.pos,
                size: [p.size, p.size],
                uv: tile_uv(p.tile),
                color: p.color,
                rotation: p.rotation,
            });
        }

        self.front.clear();
        let panel_h = hud.lines().count() as f32 * 9.0 * 2.0 + 8.0;
        self.front.push(SpriteInstance {
            center: [
                4.0 + (font::text_width(2.0, hud) + 8.0) * 0.5,
                4.0 + panel_h * 0.5,
            ],
            size: [font::text_width(2.0, hud) + 8.0, panel_h],
            uv: solid_uv(),
            color: [0, 0, 0, 170],
            rotation: 0.0,
        });
        font::draw_text(
            &mut self.front,
            solid_uv(),
            8.0,
            8.0,
            2.0,
            [255, 255, 255, 255],
            hud,
        );
        started.elapsed().as_secs_f32() * 1000.0
    }

    pub fn frame_input(&self, state: &ScriptState, world_height: u32) -> FrameInput<'_> {
        let c = state.camera;
        FrameInput {
            clear: [0.36, 0.55, 0.78, 1.0].map(|v: f64| v.powf(2.2)),
            camera: Camera {
                eye: Vec3::new(c[0], c[1], c[2]),
                target: Vec3::new(c[3], c[4], c[5]),
                fov_y_degrees: 60.0,
            },
            sprites_back: &self.back,
            models: &self.models,
            sprites_front: &self.front,
            world_height,
        }
    }
}

/// Rolling frame statistics for the HUD and the end-of-run summary.
pub struct Perf {
    frame_ms: Vec<f32>,
    window_start: std::time::Instant,
    window_frames: u32,
    pub fps: f32,
    pub times: FrameTimes,
    pub stats: FrameStats,
}

impl Default for Perf {
    fn default() -> Self {
        Self {
            frame_ms: Vec::new(),
            window_start: std::time::Instant::now(),
            window_frames: 0,
            fps: 0.0,
            times: FrameTimes::default(),
            stats: FrameStats::default(),
        }
    }
}

#[derive(Debug)]
pub struct Summary {
    pub frames: usize,
    pub mean_ms: f32,
    pub p95_ms: f32,
    pub max_ms: f32,
}

impl Perf {
    pub fn record(&mut self, frame_ms: f32) {
        self.frame_ms.push(frame_ms);
        self.window_frames += 1;
        let elapsed = self.window_start.elapsed().as_secs_f32();
        if elapsed >= 1.0 {
            self.fps = self.window_frames as f32 / elapsed;
            self.window_frames = 0;
            self.window_start = std::time::Instant::now();
            log::info!(
                "fps={:.1} upd={:.2}ms lua={:.2}ms render={:.2}ms draws={} sprites={} tris={}",
                self.fps,
                self.times.update_ms,
                self.times.lua_ms,
                self.times.render_ms,
                self.stats.draw_calls,
                self.stats.sprites,
                self.stats.triangles
            );
        }
    }

    pub fn summary(&self) -> Option<Summary> {
        if self.frame_ms.is_empty() {
            return None;
        }
        let mut sorted = self.frame_ms.clone();
        sorted.sort_by(|a, b| a.total_cmp(b));
        Some(Summary {
            frames: sorted.len(),
            mean_ms: sorted.iter().sum::<f32>() / sorted.len() as f32,
            p95_ms: sorted[((sorted.len() as f32 * 0.95) as usize).min(sorted.len() - 1)],
            max_ms: *sorted.last().unwrap(),
        })
    }
}

pub fn hud_text(
    spike: &Spike,
    perf: &Perf,
    state: &ScriptState,
    script_error: Option<&str>,
    audio: &str,
) -> String {
    let mut text = format!(
        "NOVA SPIKE  {}\nFPS {:.1}  UPD {:.2}  LUA {:.2}  DRAW {:.2} MS\nWORLD {}X{}  DRAWS {}  SPRITES {}  TRIS {}  CARS {}\nAUDIO {}",
        spike.adapter.to_uppercase(),
        perf.fps,
        perf.times.update_ms,
        perf.times.lua_ms,
        perf.times.render_ms,
        perf.stats.world_size.0,
        perf.stats.world_size.1,
        perf.stats.draw_calls,
        perf.stats.sprites,
        perf.stats.triangles,
        state.car_count,
        audio.to_uppercase(),
    );
    if let Some(error) = script_error {
        text.push_str("\nSCRIPT ERROR: ");
        text.push_str(&error.chars().take(70).collect::<String>().to_uppercase());
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atlas_solid_region_is_opaque_white() {
        let atlas = make_atlas();
        let uv = solid_uv();
        for (u, v) in [
            (uv[0], uv[1]),
            (uv[2], uv[3]),
            (0.5 * (uv[0] + uv[2]), 0.5 * (uv[1] + uv[3])),
        ] {
            let (x, y) = ((u * ATLAS as f32) as u32, (v * ATLAS as f32) as u32);
            let i = ((y * ATLAS + x) * 4) as usize;
            assert_eq!(
                &atlas.rgba[i..i + 4],
                &[255, 255, 255, 255],
                "uv ({u}, {v})"
            );
        }
    }

    #[test]
    fn perf_summary_reports_percentiles() {
        let mut perf = Perf::default();
        for i in 1..=100 {
            perf.record(i as f32);
        }
        let s = perf.summary().unwrap();
        assert_eq!(s.frames, 100);
        assert_eq!(s.max_ms, 100.0);
        assert!((s.p95_ms - 96.0).abs() < 1.5, "{}", s.p95_ms);
    }
}
