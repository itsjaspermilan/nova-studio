//! wgpu renderer: batched 2D sprites and instanced low-poly meshes in one pass.
//!
//! The renderer draws into any `TextureView`, so the same code serves the window
//! surface, headless captures and (later) editor viewports.

use bytemuck::{Pod, Zeroable};
use glam::Vec3;
use std::collections::HashMap;
use wgpu::util::DeviceExt;

use crate::model::{Image, MeshData, MeshVertex, Wrap};

mod custom;
mod fx2d;
pub use custom::{MAX_SHADED_DRAWS, MaterialVertex};
pub use fx2d::{
    Blend2d, Fx2d, Fx2dFrame, Light2d, MAX_LIGHTS_2D, MAX_MIRRORED, Rain2d, Reflect2d,
    SHADOW_STYLE, Shape2d, Style2d,
};

pub const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct SpriteInstance {
    pub center: [f32; 2],
    pub size: [f32; 2],
    pub uv: [f32; 4],
    pub color: [u8; 4],
    pub rotation: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct ModelInstance {
    pub matrix: [[f32; 4]; 4],
    pub tint: [f32; 4],
}

impl ModelInstance {
    /// An instance of a skinned mesh: its joints' matrices start at `joint_base` in the frame's palette (see
    /// [`FrameInput::joints`]). The base rides in the one slot of an affine matrix that is always zero.
    pub fn skinned(mut matrix: [[f32; 4]; 4], tint: [f32; 4], joint_base: u32) -> Self {
        matrix[0][3] = joint_base as f32;
        Self { matrix, tint }
    }

    /// The same instance fading by a screen-door: `amount` in (0, 1) is the share of its pixels dropped when negative-signed
    /// (`-0.3` drops 30%) or the share kept when positive (`0.3` keeps 30%), by a fixed noise, so that a near copy at `-t`
    /// and a far copy at `+t` together fill every pixel exactly once: a change of level of detail without a pop. Rides in the
    /// w slot of the matrix's second column (zero in an affine matrix; the shaders read it and zero it).
    pub fn dissolving(mut self, amount: f32) -> Self {
        self.matrix[1][3] = amount;
        self
    }

    /// The same instance lifted by the hills as one rigid piece: the whole model rises by the ground's height under its origin, instead of
    /// every vertex by the height under that vertex (which shears a car on a slope). Its turn is the game's to set (a car tilts by its
    /// own pitch and roll). Rides in the sway slot as a negative number, which a swaying model never has.
    pub fn rigid(mut self) -> Self {
        self.matrix[2][3] = -1.0;
        self
    }

    /// The same instance swaying in the wind: `amount` is how far the top of a thing one metre tall is pushed at full wind (the
    /// shaders bend a vertex in proportion to its height above the instance's origin). Rides in the w slot of the third column.
    pub fn swaying(mut self, amount: f32) -> Self {
        self.matrix[2][3] = amount;
        self
    }

    /// The same instance with dirt on it (`nova.model`'s `dirt`): `amount` 0 (clean) to 1, `color` sRGB 0 to 1, and `on_top` when it
    /// also lies on what faces up (snow). The shaders draw it with no picture: thick at the foot of the model, climbing as it builds
    /// up. Rides in the w slot of the matrix's fourth column (1 in an affine matrix; the shaders read it and put the 1 back) as 2 plus
    /// a whole number of 23 bits: the amount (7), on top (1), the colour (5 each).
    pub fn dirty(mut self, amount: f32, color: [f32; 3], on_top: bool) -> Self {
        let steps = (amount.clamp(0.0, 1.0) * 127.0).round() as u32;
        if steps == 0 {
            self.matrix[3][3] = 1.0;
            return self;
        }
        let c = color.map(|v| (v.clamp(0.0, 1.0) * 31.0).round() as u32);
        let code = steps | (u32::from(on_top) << 7) | (c[0] << 8) | (c[1] << 13) | (c[2] << 18);
        self.matrix[3][3] = 2.0 + code as f32;
        self
    }

    /// The same instance (not a skinned one) as a piece of a model whose own origin is `below` world units under this piece's: dirt and
    /// the model's shade at its foot are measured from the model's base, not the piece's (a wheel's hub). Rides in the w slot of the
    /// matrix's first column, where a skinned instance has its joints.
    pub fn based(mut self, below: f32) -> Self {
        self.matrix[0][3] = -below;
        self
    }
}

/// Per vertex of a skinned mesh: which joints pull it (numbers within the skin) and how hard.
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct SkinVertex {
    pub joints: [u16; 4],
    pub weights: [f32; 4],
}

/// The joint palette is a texture of 4-texel matrices, this many texels across (256 matrices a row).
pub const JOINT_TEXTURE_WIDTH: u32 = 1024;
const JOINT_TEXTURE_ROWS: u32 = 64;
/// Most joint matrices a frame can hold: 16,384, about 680 characters of 24 joints. Draws past it are skipped.
pub const MAX_JOINT_MATRICES: usize = (JOINT_TEXTURE_WIDTH / 4 * JOINT_TEXTURE_ROWS) as usize;

/// Most point lights drawn at once: [`lights::LIGHT_BUDGET`] chosen ones and room for a few that are fading out.
pub const MAX_POINT_LIGHTS: usize = 20;

/// A light that fades to nothing at `radius` world units. Given a `direction` it is a spot light: it lights a cone.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PointLight {
    pub position: [f32; 3],
    pub radius: f32,
    /// Linear multipliers, 1.0 = full.
    pub color: [f32; 3],
    /// The way a spot light points (unit length); all zeros for a light that shines every way.
    pub direction: [f32; 3],
    /// For a spot light: the cosine of half the cone's angle (the light fades out at the edge of the cone).
    pub cone: f32,
}

/// A sky behind everything: `horizon` at and below the horizon line, blending up to `top` overhead. Colours are linear.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sky {
    pub top: [f32; 3],
    pub horizon: [f32; 3],
    /// The direction towards the sun (any length), when the sky shows a sun and, opposite it, a moon.
    pub sun: Option<[f32; 3]>,
    /// How many stars show, 0 to 1.
    pub stars: f32,
    /// How much of the sky is cloud, 0 (none) to 1.
    pub clouds: f32,
    /// Seconds, for twinkling and drifting; set by the game each frame.
    pub time: f32,
    /// The colour of the land under the sky (linear), when the game gives one: surfaces lit by their material are lit by it from
    /// below and mirror it under the horizon.
    pub ground: Option<[f32; 3]>,
}

/// The sun's shadows, in a square of ground `radius` metres either side of what the camera looks at (more is blurrier).
/// `strength` is how dark a shadow is: 0 none, 1 down to the ambient light.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shadows {
    pub radius: f32,
    pub strength: f32,
}

impl Default for Shadows {
    fn default() -> Self {
        Self {
            radius: 60.0,
            strength: 0.6,
        }
    }
}

/// Distance fog: models fade into `color` between `near` and `far` world units from the camera. Colour is linear.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fog {
    pub color: [f32; 3],
    pub near: f32,
    pub far: f32,
}

/// The hills (`nova.terrain`): the ground's height as a sum of up to [`MAX_TERRAIN_WAVES`] sine waves over the ground. Each wave is
/// `[kx, kz, amplitude, phase]`: its height is `amplitude * sin(kx * x + kz * z + phase)`. The shaders lift every vertex of a model that
/// stands near the ground by the height under it, so the game draws everything as if the ground were flat.
pub const MAX_TERRAIN_WAVES: usize = 8;

#[derive(Clone, Debug, PartialEq)]
pub struct Terrain {
    pub waves: [[f32; 4]; MAX_TERRAIN_WAVES],
    pub count: usize,
    /// Designed ground from a picture (`nova.terrain{ heightmap = ... }`); the waves are added on top of it.
    pub map: Option<std::sync::Arc<crate::heightmap::HeightMap>>,
}

impl Default for Terrain {
    fn default() -> Self {
        Self {
            waves: [[0.0; 4]; MAX_TERRAIN_WAVES],
            count: 0,
            map: None,
        }
    }
}

impl Terrain {
    /// The ground's height at a spot (the same sum the shaders make).
    pub fn height(&self, x: f32, z: f32) -> f32 {
        let waves: f32 = self.waves[..self.count]
            .iter()
            .map(|w| w[2] * (w[0] * x + w[1] * z + w[3]).sin())
            .sum();
        waves + self.map.as_ref().map_or(0.0, |m| m.height(x, z))
    }

    /// Whether there is any ground to lift things by.
    pub fn active(&self) -> bool {
        self.count > 0 || self.map.is_some()
    }

    /// The slope there: how fast the height grows with x and with z.
    pub fn slope(&self, x: f32, z: f32) -> [f32; 2] {
        let mut g = [0.0f32; 2];
        for w in &self.waves[..self.count] {
            let c = w[2] * (w[0] * x + w[1] * z + w[3]).cos();
            g[0] += c * w[0];
            g[1] += c * w[1];
        }
        if let Some(m) = &self.map {
            let d = m.slope(x, z);
            g[0] += d[0];
            g[1] += d[1];
        }
        g
    }

    /// The most the ground can rise or fall: the culling of what is drawn grows by this.
    pub fn lift(&self) -> f32 {
        let waves: f32 = self.waves[..self.count].iter().map(|w| w[2].abs()).sum();
        waves
            + self
                .map
                .as_ref()
                .map_or(0.0, |m| m.max.abs().max(m.min.abs()))
    }
}

/// The wind that bends foliage (models drawn with a `sway`): the way it blows (a unit vector on the ground), how hard (0 is
/// still), and the time the game keeps for it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Wind {
    pub direction: [f32; 2],
    pub strength: f32,
    pub time: f32,
}

impl Default for Wind {
    fn default() -> Self {
        Self {
            direction: [1.0, 0.0],
            strength: 0.0,
            time: 0.0,
        }
    }
}

/// How the finished picture is treated: a toon ramp on the sun's light (flat bands of light and shade, as in a cartoon), a
/// line drawn where depth jumps (the outline of things), and a few colour adjustments. All off by default.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Look {
    /// Bands the sun's light is cut into (2 to 8); 0 for smooth light.
    pub toon: f32,
    /// Colour (linear) of the outline, how dark it is (0 to 1) and how wide, in pixels of the world picture; None for none.
    pub outline: Option<([f32; 3], f32, f32)>,
    /// 1 leaves brightness alone; above brightens, below darkens, through a soft shoulder so that brights do not clip.
    pub exposure: f32,
    /// 1 leaves colour alone; 0 is grey; above 1 is more vivid.
    pub saturation: f32,
    /// How much the corners darken, 0 to 1.
    pub vignette: f32,
    /// Strength of the glow around bright things (0 for none, 1 is a lot).
    pub bloom: f32,
    /// Brightness (0 to 1) above which a thing glows.
    pub bloom_threshold: f32,
    /// How dark creases and the feet of things get, 0 to 1 (0 for none), and how far in metres it reaches.
    pub ao: f32,
    pub ao_radius: f32,
    /// Speed blur: streaks toward the edges of the picture, as if rushing past (0 for none, 1 is a lot); the middle stays sharp.
    pub blur: f32,
    /// Edge smoothing (FXAA, done at the world picture's own resolution and before it is scaled up to the screen), 0 (none) to 1 (full). It
    /// costs a few texture reads on the pixels that sit on an edge and almost nothing on the rest.
    pub fxaa: f32,
    /// A colour grade: what the darks and the lights are multiplied by (linear; [1, 1, 1] leaves them alone), blended by brightness.
    /// A night street: blue darks, warm lights.
    pub grade: [[f32; 3]; 2],
}

impl Default for Look {
    fn default() -> Self {
        Self {
            toon: 0.0,
            outline: None,
            exposure: 1.0,
            saturation: 1.0,
            vignette: 0.0,
            bloom: 0.0,
            bloom_threshold: 0.7,
            ao: 0.0,
            ao_radius: 0.8,
            blur: 0.0,
            fxaa: 0.0,
            grade: [[1.0; 3]; 2],
        }
    }
}

impl Look {
    fn graded(&self) -> bool {
        self.grade.iter().flatten().any(|v| (v - 1.0).abs() > 1e-4)
    }

    /// Whether the picture needs the finishing pass (an outline or a colour adjustment; the toon ramp is in the mesh shader).
    pub fn needs_post(&self) -> bool {
        self.graded()
            || self.outline.is_some()
            || (self.exposure - 1.0).abs() > 1e-4
            || (self.saturation - 1.0).abs() > 1e-4
            || self.vignette > 0.0
            || self.bloom > 0.0
            || self.ao > 0.0
            || self.blur > 0.0
            || self.fxaa > 0.0
    }

    /// Whether the finishing pass reads the depth buffer (so that it is kept).
    pub fn reads_depth(&self) -> bool {
        self.outline.is_some() || self.ao > 0.0
    }
}

/// How 3D models are lit and seen: one directional light, an ambient floor, a few point lights, and optionally a sky
/// and fog.
#[derive(Clone, Debug, PartialEq)]
pub struct Lighting {
    /// Direction the light travels (normalised).
    pub direction: [f32; 3],
    pub color: [f32; 3],
    pub ambient: [f32; 3],
    pub points: [PointLight; MAX_POINT_LIGHTS],
    pub point_count: usize,
    pub sky: Option<Sky>,
    pub fog: Option<Fog>,
    pub shadows: Option<Shadows>,
    /// How bright the sky's light is for voxel worlds (`nova.voxel.daylight`): 1 at noon, near 0 at night.
    pub day: f32,
    pub look: Look,
    pub wind: Wind,
    pub terrain: Terrain,
    /// Opt-in quality settings; the world's pipelines are rebuilt when they change (`nova.graphics`, the manifest's `graphics`).
    pub quality: Quality,
    /// The 2D effects of this frame (lights, added light, shadows, reflections, rain); None when a game asks for none.
    pub fx2d: Option<Fx2d>,
}

impl Default for Lighting {
    fn default() -> Self {
        Self {
            direction: Vec3::new(-0.4, -1.0, -0.3).normalize().to_array(),
            color: [1.0; 3],
            ambient: [0.38, 0.4, 0.46],
            points: [PointLight {
                position: [0.0; 3],
                radius: 1.0,
                color: [0.0; 3],
                direction: [0.0; 3],
                cone: 0.0,
            }; MAX_POINT_LIGHTS],
            point_count: 0,
            sky: None,
            fog: None,
            shadows: None,
            day: 1.0,
            look: Look::default(),
            wind: Wind::default(),
            terrain: Terrain::default(),
            quality: Quality::default(),
            fx2d: None,
        }
    }
}

impl Lighting {
    /// Adds a point light for this frame; beyond [`MAX_POINT_LIGHTS`] it is ignored.
    pub fn push_point(&mut self, light: PointLight) -> bool {
        if self.point_count >= MAX_POINT_LIGHTS {
            return false;
        }
        self.points[self.point_count] = light;
        self.point_count += 1;
        true
    }
}

#[derive(Clone, Copy)]
pub struct ModelDraw {
    /// Whether it casts a shadow (when shadows are on); translucent meshes never do.
    pub casts: bool,
    pub mesh: usize,
    pub instance: ModelInstance,
}

#[derive(Clone, Copy)]
pub struct Camera {
    pub eye: Vec3,
    pub target: Vec3,
    pub fov_y_degrees: f32,
}

/// Meshes a script makes while it runs (a voxel world's chunks), applied before the frame draws. Their ids start at
/// [`DYN_MESH_BASE`] so they never clash with meshes loaded from model files.
pub enum MeshOp {
    /// The picture all voxel meshes sample (one atlas of block faces).
    SetAtlas(Image),
    /// Makes or replaces a mesh. `plain` meshes are drawn with a white texture (colours only), the others with the voxel atlas.
    Upload {
        id: usize,
        vertices: Vec<MeshVertex>,
        indices: Vec<u32>,
        plain: bool,
    },
    /// A copy of the loaded mesh `base` with other vertices (its shape keys blended in): the same triangles, picture and material.
    Variant {
        id: usize,
        base: usize,
        vertices: Vec<MeshVertex>,
    },
    /// Makes a mesh (`nova.mesh.make`) with the pictures and surface of the loaded mesh `look` (none: plain colours).
    Styled {
        id: usize,
        look: Option<usize>,
        vertices: Vec<MeshVertex>,
        indices: Vec<u32>,
    },
    Free(usize),
}

pub const DYN_MESH_BASE: usize = 1 << 30;

/// A custom shader on a draw (`shader = "water"` in `nova.model`, `nova.sprite` or `nova.post`): which shader (an id from
/// [`Gfx::add_shader`]), its eight numbers (`params`) and up to two pictures (ids given to [`FrameInput::texture_ops`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shading {
    pub shader: usize,
    pub params: [f32; 8],
    pub textures: [Option<usize>; 2],
}

/// A model drawn with a custom shader: one draw each, after the plain models (opaque) or after the see-through ones (`blend`:
/// alpha-blended, not writing depth).
#[derive(Clone, Copy)]
pub struct ShadedModel {
    pub draw: ModelDraw,
    pub shading: Shading,
    pub blend: bool,
}

/// A sprite drawn with a custom shader: the sprite at `index` of its layer's list (`sprites_back`, or `sprites_front` when `ui`)
/// is drawn with this shading, in its place in the order.
#[derive(Clone, Copy)]
pub struct ShadedSprite {
    pub index: usize,
    pub ui: bool,
    pub shading: Shading,
}

pub struct FrameInput<'a> {
    pub clear: [f64; 4],
    pub camera: Camera,
    pub sprites_back: &'a [SpriteInstance],
    /// Draws using the same mesh must be contiguous; each run becomes one instanced draw.
    pub models: &'a [ModelDraw],
    /// Joint matrices for skinned meshes (model space of each joint, bind pose included): a skinned instance's
    /// [`ModelInstance::skinned`] base says where its joints start. At most [`MAX_JOINT_MATRICES`].
    pub joints: &'a [[[f32; 4]; 4]],
    /// Meshes to make or drop before drawing (see [`MeshOp`]).
    pub mesh_ops: &'a [MeshOp],
    /// Meshes drawn in the UI layer, over the UI's shapes and under its text, with an orthographic camera whose units are
    /// the UI's: a model's x and y are screen right and up, its z toward the viewer. No depth: for small convex shapes
    /// (an inventory icon of a block), whose faces do not overlap.
    pub ui_models: &'a [ModelDraw],
    pub lighting: Lighting,
    pub sprites_front: &'a [SpriteInstance],
    /// Text quads (UI layer, native resolution, drawn after `sprites_front`); the UVs index the
    /// glyph atlas set with [`Gfx::update_glyph_atlas`].
    pub text: &'a [SpriteInstance],
    /// Models drawn with custom shaders (see [`ShadedModel`]).
    pub shaded_models: &'a [ShadedModel],
    /// Sprites of `sprites_back` / `sprites_front` drawn with custom shaders, sorted by layer then index.
    pub shaded_sprites: &'a [ShadedSprite],
    /// A full-screen custom shader over the world picture (before the finishing pass and the UI).
    pub post: Option<Shading>,
    /// Pictures for custom shaders to put on the GPU before drawing (id, picture); an id can be given again to replace it.
    pub texture_ops: &'a [(usize, Image)],
    /// Seconds of game time, for custom shaders.
    pub time: f32,
    /// Height in pixels of the world (sprites_back + models) render target; 0 or >= the
    /// screen height renders the world at native resolution. The width follows the screen
    /// aspect. `sprites_front` (HUD/UI) always renders at native resolution.
    pub world_height: u32,
}

/// Opt-in quality settings of the world pass. The default draws as the engine always has (8-bit target, no multisampling, one
/// shadow map); each setting costs GPU time, recorded in `docs/performance.md`. A setting the GPU cannot do is dropped (see
/// [`Gfx::quality`] for what is in force). Changing one rebuilds the world's pipelines (a hitch; do it at a menu, not mid-race).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Quality {
    /// The world is drawn to a 16-bit float target and put through a filmic tone-mapping curve, and bloom works on real
    /// brightness (so a bright light blooms and a white wall does not).
    pub hdr: bool,
    /// Samples a pixel of the world pass: 1 (off) or 4. An alternative to FXAA that also smooths what shaders make.
    pub msaa: u32,
    /// Cascades of the sun's shadow map (1 is the single map; up to [`MAX_CASCADES`]); more than 1 also filters the edge softly.
    pub cascades: u32,
    /// Light and reflections from the sky on models lit by their material (an irradiance and a reflection cube made from `nova.sky`).
    pub ibl: bool,
    /// Anisotropic filtering of model textures: 1 (off) to 16.
    pub aniso: u32,
}

pub const MAX_CASCADES: u32 = 3;

/// The sky's cube map (`Quality::ibl`): a face's side in texels and how many levels (each half the size; the level is the roughness).
const ENV_SIZE: u32 = 32;
const ENV_LEVELS: u32 = 6;

impl Quality {
    /// Settings from a short text, as `hdr,msaa=4,cascades=3,ibl,aniso=8` (for testing and measuring without editing a game).
    pub fn from_spec(spec: &str) -> Result<Self, String> {
        let mut q = Quality::default();
        for item in spec.split([',', ' ', '\n']).filter(|i| !i.is_empty()) {
            let (key, value) = item.split_once('=').unwrap_or((item, ""));
            let number = || {
                value
                    .parse::<u32>()
                    .map_err(|_| format!("{key} needs a number, as {key}=4"))
            };
            match key {
                "hdr" => q.hdr = true,
                "ibl" => q.ibl = true,
                "msaa" => q.msaa = number()?,
                "cascades" => q.cascades = number()?,
                "aniso" => q.aniso = number()?,
                // (the world picture's height is not a quality setting: see `Quality::forced_world_height`)
                "height" => {}
                other => {
                    return Err(format!(
                        "unknown setting {other} (hdr, msaa=, cascades=, ibl, aniso=)"
                    ));
                }
            }
        }
        Ok(q)
    }

    fn forced_spec() -> Option<String> {
        std::env::var("NOVA_GRAPHICS").ok().or_else(|| {
            // on a device: a file named for the app (its process name, the package), so that one game's test does not change another's
            let process = std::fs::read("/proc/self/cmdline").ok()?;
            let name = String::from_utf8_lossy(process.split(|b| *b == 0).next()?).into_owned();
            std::fs::read_to_string(format!("/data/local/tmp/nova-graphics.{name}")).ok()
        })
    }

    /// `height=720` in the same text: the world picture's height, in place of the manifest's.
    pub fn forced_world_height() -> Option<u32> {
        static FORCED: std::sync::OnceLock<Option<u32>> = std::sync::OnceLock::new();
        *FORCED.get_or_init(|| {
            Self::forced_spec()?
                .split([',', ' ', '\n'])
                .find_map(|i| i.strip_prefix("height=")?.parse().ok())
        })
    }

    /// The settings forced by the environment variable `NOVA_GRAPHICS`, or on a device by the file `/data/local/tmp/nova-graphics.<package>`
    /// (`adb push`), in place of the game's own: for measuring. None when neither exists.
    pub fn forced() -> Option<Quality> {
        static FORCED: std::sync::OnceLock<Option<Quality>> = std::sync::OnceLock::new();
        *FORCED.get_or_init(|| {
            let spec = Self::forced_spec()?;
            match Quality::from_spec(&spec) {
                Ok(q) => {
                    log::info!(
                        "graphics forced to {q:?} by NOVA_GRAPHICS or /data/local/tmp/nova-graphics.<package>"
                    );
                    Some(q)
                }
                Err(e) => {
                    log::error!("NOVA_GRAPHICS: {e}");
                    None
                }
            }
        })
    }
}

impl Default for Quality {
    fn default() -> Self {
        Self {
            hdr: false,
            msaa: 1,
            cascades: 1,
            ibl: false,
            aniso: 1,
        }
    }
}

impl Quality {
    /// What this adapter can really do of what was asked.
    pub fn resolve(mut self, adapter: &wgpu::Adapter) -> Self {
        let features = |format| adapter.get_texture_format_features(format);
        if self.hdr
            && !features(wgpu::TextureFormat::Rgba16Float)
                .allowed_usages
                .contains(
                    wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                )
        {
            self.hdr = false;
        }
        self.msaa = if self.msaa >= 4 { 4 } else { 1 };
        if self.msaa > 1 {
            // (the screen's format is not known here; every sRGB 8-bit format does 4x on the GPUs that do any)
            let color = if self.hdr {
                wgpu::TextureFormat::Rgba16Float
            } else {
                wgpu::TextureFormat::Rgba8UnormSrgb
            };
            let c = features(color).flags;
            if !(c.sample_count_supported(4)
                && c.contains(wgpu::TextureFormatFeatureFlags::MULTISAMPLE_RESOLVE)
                && features(DEPTH_FORMAT).flags.sample_count_supported(4))
            {
                self.msaa = 1;
            }
        }
        self.cascades = self.cascades.clamp(1, MAX_CASCADES);
        self.aniso = self.aniso.clamp(1, 16);
        self
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct FrameStats {
    /// How long the GPU took over a recent frame (the last one whose timing has come back), in milliseconds; 0 where the GPU
    /// cannot say. Unlike `Perf`'s render time, which is the CPU's cost of recording the frame, this is the GPU's own.
    pub gpu_ms: f32,
    /// Model draws left out of the world pass because they are outside the camera's view.
    pub culled: u32,
    /// Model draws left out of the sun's shadow pass because they are outside the light's view volume.
    pub shadow_culled: u32,
    pub draw_calls: u32,
    pub sprites: u32,
    pub triangles: u32,
    pub world_size: (u32, u32),
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SpriteView {
    size: [f32; 2],
    pad: [f32; 2],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Globals {
    view_proj: [[f32; 4]; 4],
    /// xyz: direction the light travels; w: how many point lights are in use.
    light_dir: [f32; 4],
    light_color: [f32; 4],
    ambient: [f32; 4],
    /// xyz: position; w: radius.
    point_pos: [[f32; 4]; MAX_POINT_LIGHTS],
    point_color: [[f32; 4]; MAX_POINT_LIGHTS],
    inv_view_proj: [[f32; 4]; 4],
    /// xyz: the camera.
    eye: [f32; 4],
    /// rgb: colour overhead; w: 1 when there is a sky.
    sky_top: [f32; 4],
    sky_horizon: [f32; 4],
    /// rgb: colour; w: 1 when there is fog.
    fog_color: [f32; 4],
    /// x: where fog starts; y: where it is complete.
    fog_range: [f32; 4],
    light_view_proj: [[f32; 4]; 4],
    /// x: 1 when shadows are on; y: one texel of the shadow map, as a fraction; z: bias; w: how dark a shadow is.
    shadow: [f32; 4],
    /// x: sky brightness for voxel meshes (0 to 1).
    voxel: [f32; 4],
    /// xyz: the way to the sun (unit); w: stars, 0 to 1.
    sky_sun: [f32; 4],
    /// x: cloud cover; y: time; z: 1 when there is a sun and moon.
    sky_extra: [f32; 4],
    /// xy: the way the wind blows (unit); z: how strong (0: none); w: the time (seconds).
    wind: [f32; 4],
    /// xyz: the way a spot light points (zero: it shines every way); w: the cosine of half its cone.
    point_dir: [[f32; 4]; MAX_POINT_LIGHTS],
    /// [0].x: how many hill waves; then each wave's kx, kz, amplitude and phase.
    terrain: [[f32; 4]; MAX_TERRAIN_WAVES + 1],
    /// The heightmap: [0] is x0, z0, 1 / cell, 0; [1] is the samples across minus 1, the rows minus 1, 0, 0. (`terrain[0].y` is 1 when there is one.)
    terrain_map: [[f32; 4]; 2],
    /// The sun's cascaded shadow maps (only with `Quality::cascades` above 1): each cascade's matrix; x: how far (view depth) it reaches, y: its
    /// depth bias, z: a texel's size in metres; and x of the last: how many cascades.
    cascade_vp: [[[f32; 4]; 4]; MAX_CASCADES as usize],
    cascade_info: [[f32; 4]; MAX_CASCADES as usize],
    cascade_count: [f32; 4],
    /// rgb: the land around as the light leaves it (its colour under the sun and the ambient light); w: 1 when the sky has a ground colour.
    ground: [f32; 4],
}

/// One cascade of the sun's shadow: the matrix that draws the map and what the shader needs to read it.
#[derive(Clone, Copy)]
struct CascadePlan {
    vp: glam::Mat4,
    /// Where it stops, as distance along the view.
    far: f32,
    /// Depth bias in clip units.
    bias: f32,
    /// Metres a texel spans.
    texel: f32,
}

/// Side of the (square) shadow map in texels.
const SHADOW_SIZE: u32 = 2048;

struct DynBuffer {
    buffer: wgpu::Buffer,
    capacity: u64,
    usage: wgpu::BufferUsages,
    label: &'static str,
}

impl DynBuffer {
    fn new(
        device: &wgpu::Device,
        label: &'static str,
        usage: wgpu::BufferUsages,
        capacity: u64,
    ) -> Self {
        let usage = usage | wgpu::BufferUsages::COPY_DST;
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size: capacity,
            usage,
            mapped_at_creation: false,
        });
        Self {
            buffer,
            capacity,
            usage,
            label,
        }
    }

    fn write(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, data: &[u8]) {
        let needed = (data.len() as u64).max(4);
        if needed > self.capacity {
            let capacity = needed.next_power_of_two();
            *self = DynBuffer::new(device, self.label, self.usage, capacity);
        }
        if !data.is_empty() {
            queue.write_buffer(&self.buffer, 0, data);
        }
    }
}

struct WorldTarget {
    view: wgpu::TextureView,
    size: (u32, u32),
    group: wgpu::BindGroup,
}

struct MsaaTargets {
    colour: wgpu::TextureView,
    /// The multisampled depth, as a texture the depth resolve reads.
    depth_samples: wgpu::BindGroup,
    /// One sample, for the finishing pass.
    resolved: wgpu::TextureView,
    size: (u32, u32),
}

struct GpuMesh {
    vertices: wgpu::Buffer,
    indices: wgpu::Buffer,
    index_count: u32,
    texture: wgpu::BindGroup,
    /// Some vertex is see-through: the mesh is drawn after the solid ones, blended.
    translucent: bool,
    /// Joints and weights, for a skinned mesh (drawn by the skinned pipelines, never see-through).
    skin: Option<wgpu::Buffer>,
    /// A sphere that holds the whole mesh (centre, radius), in the mesh's own space, for culling.
    bounds: ([f32; 3], f32),
    /// Drawn lit by its glTF material (the project opted in).
    material: Option<custom::GpuMaterial>,
    /// Its detail picture (group 3 of the detail pipeline), for a solid, unskinned mesh that is not drawn by its material.
    detail: Option<wgpu::BindGroup>,
}

/// Times the GPU's work on a frame with two timestamps (the start of the first pass, the end of the last) and reads them back a
/// frame later, so that nothing waits. Only where the adapter has timestamp queries.
struct GpuTimer {
    queries: wgpu::QuerySet,
    resolve: wgpu::Buffer,
    readback: wgpu::Buffer,
    /// Nanoseconds a tick is.
    period: f32,
    /// 0: free, 1: a read is in flight, 2: it has finished and can be read.
    state: std::sync::Arc<std::sync::atomic::AtomicU8>,
    last_ms: f32,
}

impl GpuTimer {
    fn new(device: &wgpu::Device, queue: &wgpu::Queue) -> Self {
        Self {
            queries: device.create_query_set(&wgpu::QuerySetDescriptor {
                label: Some("frame timestamps"),
                ty: wgpu::QueryType::Timestamp,
                count: 2,
            }),
            resolve: device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("timestamps resolve"),
                size: 16,
                usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            }),
            readback: device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("timestamps readback"),
                size: 16,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }),
            period: queue.get_timestamp_period(),
            state: std::sync::Arc::new(std::sync::atomic::AtomicU8::new(0)),
            last_ms: 0.0,
        }
    }

    fn idle(&self) -> bool {
        self.state.load(std::sync::atomic::Ordering::Acquire) == 0
    }

    /// Takes a finished reading, if there is one.
    fn collect(&mut self, device: &wgpu::Device) {
        use std::sync::atomic::Ordering;
        if self.state.load(Ordering::Acquire) == 1 {
            let _ = device.poll(wgpu::PollType::Poll);
        }
        if self.state.load(Ordering::Acquire) == 2 {
            {
                if let Ok(range) = self.readback.slice(..).get_mapped_range() {
                    let t: &[u64] = bytemuck::cast_slice(&range);
                    if t.len() >= 2 && t[1] >= t[0] {
                        self.last_ms = (t[1] - t[0]) as f32 * self.period / 1.0e6;
                    }
                }
            }
            self.readback.unmap();
            self.state.store(0, Ordering::Release);
        }
    }

    /// After the frame was submitted: asks for the two timestamps.
    fn request(&self) {
        use std::sync::atomic::Ordering;
        self.state.store(1, Ordering::Release);
        let state = self.state.clone();
        self.readback
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                state.store(if result.is_ok() { 2 } else { 0 }, Ordering::Release);
            });
    }
}

/// A sphere around the vertices (the middle of their box and the distance to its corner): cheap and never too small.
fn bounding_sphere(vertices: &[MeshVertex]) -> ([f32; 3], f32) {
    if vertices.is_empty() {
        return ([0.0; 3], 0.0);
    }
    let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
    for v in vertices {
        for k in 0..3 {
            lo[k] = lo[k].min(v.position[k]);
            hi[k] = hi[k].max(v.position[k]);
        }
    }
    let centre = [
        (lo[0] + hi[0]) / 2.0,
        (lo[1] + hi[1]) / 2.0,
        (lo[2] + hi[2]) / 2.0,
    ];
    let half = [
        (hi[0] - lo[0]) / 2.0,
        (hi[1] - lo[1]) / 2.0,
        (hi[2] - lo[2]) / 2.0,
    ];
    (
        centre,
        (half[0] * half[0] + half[1] * half[1] + half[2] * half[2]).sqrt(),
    )
}

/// The six planes of the view volume (normals pointing in), for wgpu's 0..1 depth: from a view-projection matrix.
fn frustum_planes(view_proj: &glam::Mat4) -> [glam::Vec4; 6] {
    let row = |i: usize| {
        glam::Vec4::new(
            view_proj.x_axis[i],
            view_proj.y_axis[i],
            view_proj.z_axis[i],
            view_proj.w_axis[i],
        )
    };
    let (r0, r1, r2, r3) = (row(0), row(1), row(2), row(3));
    [r3 + r0, r3 - r0, r3 + r1, r3 - r1, r2, r3 - r2].map(|p| {
        let n = p.truncate().length();
        if n > 0.0 { p / n } else { p }
    })
}

/// Whether a sphere is at least partly inside the view volume.
fn sphere_visible(planes: &[glam::Vec4; 6], centre: Vec3, radius: f32) -> bool {
    planes
        .iter()
        .all(|p| p.truncate().dot(centre) + p.w >= -radius)
}

/// Whether an instance of a mesh with these bounds can be seen: its sphere moved and scaled by the instance's matrix. A skinned
/// mesh's sphere is the rest pose's, grown by half to allow for limbs that swing out.
fn instance_visible(
    planes: &[glam::Vec4; 6],
    bounds: ([f32; 3], f32),
    skinned: bool,
    matrix: &[[f32; 4]; 4],
    lift: f32,
) -> bool {
    let m = glam::Mat4::from_cols_array_2d(matrix);
    let scale = m
        .x_axis
        .truncate()
        .length()
        .max(m.y_axis.truncate().length())
        .max(m.z_axis.truncate().length());
    let centre = m.transform_point3(Vec3::from(bounds.0));
    // (on hills the shaders lift a model by up to `lift` metres: its sphere is grown to match)
    let radius = bounds.1 * scale * if skinned { 1.5 } else { 1.0 } + lift;
    sphere_visible(planes, centre, radius)
}

/// Everything the game gave the GPU, kept on the CPU too, so that the picture can be rebuilt if the GPU's device is lost (a driver
/// reset, or the system taking the GPU away): see [`Gfx::recover`].
/// A vertex's four joints and their weights.
type Influence = ([u16; 4], [f32; 4]);

#[derive(Default)]
struct Backup {
    sprite_atlas: Option<Image>,
    smooth_atlas: bool,
    glyphs: Option<Vec<u8>>,
    /// The loaded meshes in the order they were uploaded (their ids), with the joints and weights of a skinned one.
    meshes: Vec<(MeshData, Option<Vec<Influence>>)>,
    voxel_atlas: Option<Image>,
    dyn_meshes: HashMap<usize, (Vec<MeshVertex>, Vec<u32>, bool)>,
    /// Shape-key variants of loaded meshes: the base mesh and the blended vertices.
    variants: HashMap<usize, (usize, Vec<MeshVertex>)>,
    /// Meshes made by scripts that borrow a loaded mesh's look: that mesh, the vertices and the indices.
    styled: HashMap<usize, (Option<usize>, Vec<MeshVertex>, Vec<u32>)>,
    /// Custom shaders' sources in the order they were added (their ids), and their pictures.
    shaders: Vec<String>,
    shader_textures: HashMap<usize, Image>,
}

pub struct Gfx {
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub format: wgpu::TextureFormat,
    pub adapter_info: wgpu::AdapterInfo,
    /// The quality settings in force (what was asked, less what this GPU cannot do).
    pub quality: Quality,
    /// What was last asked for (before the GPU's limits), so that an unchanged ask costs nothing.
    asked: Quality,
    /// The world target's format: the screen's, or 16-bit float with `quality.hdr`.
    world_format: wgpu::TextureFormat,
    sprite_pipeline: wgpu::RenderPipeline,
    sprite_ui_pipeline: wgpu::RenderPipeline,
    text_pipeline: wgpu::RenderPipeline,
    glyph_texture: wgpu::Texture,
    glyph_group: wgpu::BindGroup,
    sprites_text: DynBuffer,
    blit_pipeline: wgpu::RenderPipeline,
    blit_uniform: wgpu::Buffer,
    blit_group: wgpu::BindGroup,
    depth_layout: wgpu::BindGroupLayout,
    /// The depth buffer, for the finishing pass (outlines).
    depth_group: Option<wgpu::BindGroup>,
    linear_sampler: wgpu::Sampler,
    world: Option<WorldTarget>,
    sprite_view: wgpu::Buffer,
    sprite_view_group: wgpu::BindGroup,
    texture_layout: wgpu::BindGroupLayout,
    sampler_nearest: wgpu::Sampler,
    atlas: wgpu::BindGroup,
    sprites_back: DynBuffer,
    sprites_front: DynBuffer,
    mesh_pipeline: wgpu::RenderPipeline,
    mesh_blend_pipeline: wgpu::RenderPipeline,
    skinned_pipeline: wgpu::RenderPipeline,
    skinned_shadow_pipeline: wgpu::RenderPipeline,
    joint_texture: wgpu::Texture,
    joint_group: wgpu::BindGroup,
    sky_pipeline: wgpu::RenderPipeline,
    shadow_pipeline: wgpu::RenderPipeline,
    /// One view of the shadow map per cascade, to draw into (the shaders read the whole array through the bind group).
    shadow_layers: Vec<wgpu::TextureView>,
    /// With cascades: a copy of the globals for each cascade's own pass (its light matrix), and the groups that bind them.
    cascade_globals: Vec<(wgpu::Buffer, wgpu::BindGroup)>,
    shadow_group: wgpu::BindGroup,
    /// The sky as light: one view of each (level, face) of the cube map to draw into, the pipeline and uniform that draw it, and what
    /// sky it shows now (None: not drawn yet).
    env_views: Vec<wgpu::TextureView>,
    env_pipeline: wgpu::RenderPipeline,
    env_uniform: wgpu::Buffer,
    env_group: wgpu::BindGroup,
    env_key: Option<u64>,
    globals: wgpu::Buffer,
    globals_group: wgpu::BindGroup,
    globals_layout: wgpu::BindGroupLayout,
    /// The heightmap now on the GPU (a fresh device has none, so a recovered one uploads it again at the next frame).
    terrain_loaded: Option<std::sync::Arc<crate::heightmap::HeightMap>>,
    meshes: Vec<GpuMesh>,
    dyn_meshes: HashMap<usize, GpuMesh>,
    backup: Backup,
    /// Set (from the driver's thread) when the device is lost or ran out of memory.
    lost: std::sync::Arc<std::sync::atomic::AtomicBool>,
    voxel_atlas: Option<wgpu::BindGroup>,
    sampler_voxel: wgpu::Sampler,
    /// Buffers of meshes that were freed, kept for the next mesh that fits (a rebuilt chunk piece is about the same size).
    spare_vertices: Vec<wgpu::Buffer>,
    spare_indices: Vec<wgpu::Buffer>,
    /// How many GPU buffers script-made meshes have needed to create, and how many uploads reused one.
    pub mesh_buffers_created: u32,
    pub mesh_buffers_reused: u32,
    ui_mesh_pipeline: wgpu::RenderPipeline,
    ui_globals: wgpu::Buffer,
    ui_globals_group: wgpu::BindGroup,
    ui_instances: DynBuffer,
    model_instances: DynBuffer,
    /// The instances that are in view, for the world pass (the shadow pass has its own set, `model_instances`).
    view_instances: DynBuffer,
    /// Texture bind groups of model meshes by the picture's contents, so that models that carry the same picture (a kit's shared
    /// palette, embedded in every file) share one texture.
    texture_cache: HashMap<u64, wgpu::BindGroup>,
    /// The content hash of each model picture seen, by the picture's address (the picture is kept, so the address stays its own).
    image_hashes: HashMap<usize, (std::sync::Arc<Image>, u64)>,
    /// Model textures' samplers, by smooth filtering (a billboard's) or not and the wrap across u and v (from the glTF file).
    mesh_samplers: HashMap<(bool, [Wrap; 2]), wgpu::Sampler>,
    /// GPU timing, where the adapter can do it.
    gpu_timer: Option<GpuTimer>,
    /// How many textures that sharing has saved (for the tests and the log).
    pub textures_shared: u32,
    depth: Option<(wgpu::TextureView, (u32, u32))>,
    /// With MSAA: the world pass's colour samples, and the depth the finishing pass reads (one sample, made from the samples').
    msaa: Option<MsaaTargets>,
    depth_resolve_pipeline: wgpu::RenderPipeline,
    depth_resolve_layout: wgpu::BindGroupLayout,
    /// Materials and custom shaders.
    extras: custom::Extras,
    /// The 2D effects (lights, added light, shadows, reflections, rain).
    fx2d: fx2d::Fx2dGpu,
}

/// The picture and its smaller copies, one after another (each half the size, averaged with see-through texels counting
/// for less), for `levels` levels. A tile 16 pixels wide stays whole down to level 4, so blocks in an atlas do not
/// bleed into each other.
pub fn mip_chain(image: &Image, levels: u32) -> Vec<u8> {
    let mut out = image.rgba.clone();
    let (mut w, mut h) = (image.width as usize, image.height as usize);
    let mut prev = image.rgba.clone();
    for _ in 1..levels {
        let (nw, nh) = ((w / 2).max(1), (h / 2).max(1));
        let mut next = vec![0u8; nw * nh * 4];
        for y in 0..nh {
            for x in 0..nw {
                let (mut r, mut g, mut b, mut a) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
                for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                    let (sx, sy) = ((x * 2 + dx).min(w - 1), (y * 2 + dy).min(h - 1));
                    let i = (sy * w + sx) * 4;
                    let al = prev[i + 3] as f32 / 255.0;
                    r += prev[i] as f32 * al;
                    g += prev[i + 1] as f32 * al;
                    b += prev[i + 2] as f32 * al;
                    a += al;
                }
                let o = (y * nw + x) * 4;
                if a > 0.0 {
                    next[o] = (r / a).round() as u8;
                    next[o + 1] = (g / a).round() as u8;
                    next[o + 2] = (b / a).round() as u8;
                }
                next[o + 3] = (a / 4.0 * 255.0).round() as u8;
            }
        }
        out.extend_from_slice(&next);
        prev = next;
        (w, h) = (nw, nh);
    }
    out
}

/// An `R32Float` texture of heights (metres), for the vertex shaders' `textureLoad`.
fn terrain_texture_view(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    heights: &[f32],
    width: u32,
    rows: u32,
) -> wgpu::TextureView {
    let size = wgpu::Extent3d {
        width,
        height: rows,
        depth_or_array_layers: 1,
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("heightmap"),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::R32Float,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        bytemuck::cast_slice(heights),
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(width * 4),
            rows_per_image: Some(rows),
        },
        size,
    );
    texture.create_view(&wgpu::TextureViewDescriptor::default())
}

fn globals_bind_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    buffer: &wgpu::Buffer,
    terrain: &wgpu::TextureView,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("globals"),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(terrain),
            },
        ],
    })
}

fn texture_group(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    layout: &wgpu::BindGroupLayout,
    sampler: &wgpu::Sampler,
    label: &str,
    image: &Image,
) -> wgpu::BindGroup {
    texture_group_mips(device, queue, layout, sampler, label, image, 1)
}

/// The sampler of model pictures: sharp texels, or smooth with mipmaps (and anisotropic filtering of up to `aniso` samples along a
/// slanted surface), with the wrap modes of the glTF file.
fn mesh_sampler(device: &wgpu::Device, smooth: bool, wrap: [Wrap; 2], aniso: u16) -> wgpu::Sampler {
    let address = |w: Wrap| match w {
        Wrap::Repeat => wgpu::AddressMode::Repeat,
        Wrap::MirroredRepeat => wgpu::AddressMode::MirrorRepeat,
        Wrap::ClampToEdge => wgpu::AddressMode::ClampToEdge,
    };
    let filter = if smooth {
        wgpu::FilterMode::Linear
    } else {
        wgpu::FilterMode::Nearest
    };
    device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("mesh texture"),
        address_mode_u: address(wrap[0]),
        address_mode_v: address(wrap[1]),
        mag_filter: filter,
        min_filter: filter,
        mipmap_filter: if smooth {
            wgpu::MipmapFilterMode::Linear
        } else {
            wgpu::MipmapFilterMode::Nearest
        },
        anisotropy_clamp: if smooth { aniso.max(1) } else { 1 },
        ..Default::default()
    })
}

/// A texture bind group from a KTX2 picture's compressed blocks, every level as it is.
fn compressed_group(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    layout: &wgpu::BindGroupLayout,
    sampler: &wgpu::Sampler,
    k: &crate::ktx2::Ktx2,
) -> wgpu::BindGroup {
    let data: Vec<u8> = k.levels.concat();
    let texture = device.create_texture_with_data(
        queue,
        &wgpu::TextureDescriptor {
            label: Some("compressed texture"),
            size: wgpu::Extent3d {
                width: k.width,
                height: k.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: k.levels.len() as u32,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: k.format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        },
        wgpu::util::TextureDataOrder::LayerMajor,
        &data,
    );
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("compressed texture"),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(&view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    })
}

fn texture_group_mips(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    layout: &wgpu::BindGroupLayout,
    sampler: &wgpu::Sampler,
    label: &str,
    image: &Image,
    levels: u32,
) -> wgpu::BindGroup {
    let data = if levels > 1 {
        mip_chain(image, levels)
    } else {
        image.rgba.clone()
    };
    let texture = device.create_texture_with_data(
        queue,
        &wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: image.width,
                height: image.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: levels,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        },
        wgpu::util::TextureDataOrder::LayerMajor,
        &data,
    );
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some(label),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(&view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    })
}

impl Gfx {
    pub fn new(
        instance: &wgpu::Instance,
        surface: Option<&wgpu::Surface<'_>>,
    ) -> Result<Self, String> {
        Self::new_with(instance, surface, Quality::default())
    }

    /// [`Gfx::new`] built for a quality setting.
    pub fn new_with(
        instance: &wgpu::Instance,
        surface: Option<&wgpu::Surface<'_>>,
        quality: Quality,
    ) -> Result<Self, String> {
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: surface,
            apply_limit_buckets: false,
        }))
        .map_err(|e| format!("no suitable GPU adapter: {e}"))?;
        let adapter_info = adapter.get_info();
        log::info!(
            "adapter: {} ({:?}, {:?})",
            adapter_info.name,
            adapter_info.backend,
            adapter_info.device_type
        );
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("nova device"),
            // timestamp queries (the GPU's own frame time) where the adapter has them
            required_features: adapter.features()
                & (wgpu::Features::TIMESTAMP_QUERY
                    | wgpu::Features::TEXTURE_COMPRESSION_ASTC
                    | wgpu::Features::TEXTURE_COMPRESSION_ETC2),
            // The lowest common denominator (GLES 3.0 class), with the texture sizes the GPU offers.
            required_limits:
                wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter.limits()),
            ..Default::default()
        }))
        .map_err(|e| format!("cannot create GPU device: {e}"))?;
        // A lost device, or one that ran out of memory, is recovered from (see `recover`); the default handler would panic.
        let lost = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        {
            let lost = lost.clone();
            device.set_device_lost_callback(move |reason, message| {
                log::error!("GPU device lost ({reason:?}): {message}");
                lost.store(true, std::sync::atomic::Ordering::SeqCst);
            });
        }
        {
            let lost = lost.clone();
            device.on_uncaptured_error(std::sync::Arc::new(move |error: wgpu::Error| {
                log::error!("GPU error: {error}");
                // a mistake in how the engine uses the GPU should stop a development build (as wgpu's own handler does); a
                // released build logs it and carries on
                if cfg!(debug_assertions) && matches!(error, wgpu::Error::Validation { .. }) {
                    panic!("wgpu validation error: {error}");
                }
                if matches!(
                    error,
                    wgpu::Error::OutOfMemory { .. } | wgpu::Error::Internal { .. }
                ) {
                    lost.store(true, std::sync::atomic::Ordering::SeqCst);
                }
            }));
        }
        let format = surface
            .map(|surface| {
                let formats = surface.get_capabilities(&adapter).formats;
                formats
                    .iter()
                    .copied()
                    .find(|f| f.is_srgb())
                    .unwrap_or(formats[0])
            })
            .unwrap_or(wgpu::TextureFormat::Rgba8UnormSrgb);
        Ok(Self::build(
            adapter,
            device,
            queue,
            lost,
            adapter_info,
            format,
            quality,
        ))
    }

    /// Makes everything on the GPU (pipelines, buffers, the empty atlases) for a device; `quality` is what the world pass is built for.
    fn build(
        adapter: wgpu::Adapter,
        device: wgpu::Device,
        queue: wgpu::Queue,
        lost: std::sync::Arc<std::sync::atomic::AtomicBool>,
        adapter_info: wgpu::AdapterInfo,
        format: wgpu::TextureFormat,
        quality: Quality,
    ) -> Self {
        let asked = quality;
        let quality = quality.resolve(&adapter);
        let world_format = if quality.hdr {
            wgpu::TextureFormat::Rgba16Float
        } else {
            format
        };
        let samples = quality.msaa;
        let sampler_nearest = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("nearest"),
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });
        // pixelated up close, blended between smaller copies far away
        let sampler_voxel = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("voxel"),
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        });
        let texture_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("texture layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let uniform_layout = |label: &str, visibility| {
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some(label),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            })
        };
        let sprite_view_layout = uniform_layout("sprite view layout", wgpu::ShaderStages::VERTEX);
        // The globals, and (binding 1) the heightmap for `nova.terrain{ heightmap }`: an R32Float texture read with textureLoad in the
        // vertex stage (a 1 x 1 one when there is no map). Every pipeline that takes the globals has this layout.
        let globals_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("globals layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let terrain_view = terrain_texture_view(&device, &queue, &[0.0], 1, 1);

        let sprite_view = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("sprite view"),
            size: std::mem::size_of::<SpriteView>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let sprite_view_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("sprite view"),
            layout: &sprite_view_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: sprite_view.as_entire_binding(),
            }],
        });
        let globals = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("globals"),
            size: std::mem::size_of::<Globals>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let globals_group = globals_bind_group(&device, &globals_layout, &globals, &terrain_view);

        let white = Image {
            width: 1,
            height: 1,
            rgba: vec![255; 4],
        };
        let atlas = texture_group(
            &device,
            &queue,
            &texture_layout,
            &sampler_nearest,
            "empty atlas",
            &white,
        );

        let sprite_shader = device.create_shader_module(wgpu::include_wgsl!("shaders/sprite.wgsl"));
        let mesh_shader = device.create_shader_module(wgpu::include_wgsl!("shaders/mesh.wgsl"));

        let sprite_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("sprite pipeline layout"),
            bind_group_layouts: &[Some(&sprite_view_layout), Some(&texture_layout)],
            immediate_size: 0,
        });
        let sprite_attributes = wgpu::vertex_attr_array![
            0 => Float32x2, 1 => Float32x2, 2 => Float32x4, 3 => Unorm8x4, 4 => Float32
        ];
        let blend = wgpu::BlendState::ALPHA_BLENDING;
        let make_sprite_pipeline = |label: &'static str,
                                    shader: &wgpu::ShaderModule,
                                    depth: bool,
                                    target: wgpu::TextureFormat,
                                    count: u32| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(&sprite_layout),
                vertex: wgpu::VertexState {
                    module: shader,
                    entry_point: Some("vs_main"),
                    compilation_options: Default::default(),
                    buffers: &[Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<SpriteInstance>() as u64,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &sprite_attributes,
                    })],
                },
                fragment: Some(wgpu::FragmentState {
                    module: shader,
                    entry_point: Some("fs_main"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: target,
                        blend: Some(blend),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: depth.then_some(wgpu::DepthStencilState {
                    format: DEPTH_FORMAT,
                    depth_write_enabled: Some(false),
                    depth_compare: Some(wgpu::CompareFunction::Always),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: wgpu::MultisampleState {
                    count,
                    ..Default::default()
                },
                multiview_mask: None,
                cache: None,
            })
        };
        let sprite_pipeline =
            make_sprite_pipeline("sprites", &sprite_shader, true, world_format, samples);
        let sprite_ui_pipeline =
            make_sprite_pipeline("ui sprites", &sprite_shader, false, format, 1);
        let text_shader = device.create_shader_module(wgpu::include_wgsl!("shaders/text.wgsl"));
        let text_pipeline = make_sprite_pipeline("text", &text_shader, false, format, 1);
        let glyph_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("glyph atlas"),
            size: wgpu::Extent3d {
                width: crate::text::ATLAS_SIZE,
                height: crate::text::ATLAS_SIZE,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let glyph_view = glyph_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let glyph_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("glyph atlas"),
            layout: &texture_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&glyph_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&sampler_nearest),
                },
            ],
        });

        let blit_shader = device.create_shader_module(wgpu::include_wgsl!("shaders/blit.wgsl"));
        let blit_uniform_layout =
            uniform_layout("blit uniform layout", wgpu::ShaderStages::FRAGMENT);
        let blit_uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("blit uniform"),
            size: 128,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let blit_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("blit uniform"),
            layout: &blit_uniform_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: blit_uniform.as_entire_binding(),
            }],
        });
        let linear_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("linear"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let depth_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("depth layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Depth,
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            }],
        });
        let depth_resolve_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("depth resolve layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: true,
                    },
                    count: None,
                }],
            });
        // (made for any quality, used only with MSAA: cheap to have)
        let depth_resolve_pipeline = {
            let shader =
                device.create_shader_module(wgpu::include_wgsl!("shaders/depth_resolve.wgsl"));
            let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("depth resolve pipeline layout"),
                bind_group_layouts: &[Some(&depth_resolve_layout)],
                immediate_size: 0,
            });
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("depth resolve"),
                layout: Some(&layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some("vs_main"),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some("fs_main"),
                    compilation_options: Default::default(),
                    targets: &[],
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: DEPTH_FORMAT,
                    depth_write_enabled: Some(true),
                    depth_compare: Some(wgpu::CompareFunction::Always),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: wgpu::MultisampleState::default(),
                multiview_mask: None,
                cache: None,
            })
        };
        let blit_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("blit pipeline layout"),
            bind_group_layouts: &[
                Some(&blit_uniform_layout),
                Some(&texture_layout),
                Some(&depth_layout),
            ],
            immediate_size: 0,
        });
        let blit_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("blit"),
            layout: Some(&blit_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &blit_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &blit_shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });

        // The sun's shadow map: a depth texture the world is drawn into from the sun's side, then sampled by every mesh.
        let shadow_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("shadow map"),
            size: wgpu::Extent3d {
                width: SHADOW_SIZE,
                height: SHADOW_SIZE,
                depth_or_array_layers: quality.cascades,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let shadow_view = shadow_texture.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        let shadow_layers: Vec<wgpu::TextureView> = (0..quality.cascades)
            .map(|layer| {
                shadow_texture.create_view(&wgpu::TextureViewDescriptor {
                    label: Some("shadow cascade"),
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_array_layer: layer,
                    array_layer_count: Some(1),
                    ..Default::default()
                })
            })
            .collect();
        let cascade_globals: Vec<(wgpu::Buffer, wgpu::BindGroup)> = if quality.cascades > 1 {
            (0..quality.cascades)
                .map(|_| {
                    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                        label: Some("cascade globals"),
                        size: std::mem::size_of::<Globals>() as u64,
                        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                        mapped_at_creation: false,
                    });
                    let group =
                        globals_bind_group(&device, &globals_layout, &buffer, &terrain_view);
                    (buffer, group)
                })
                .collect()
        } else {
            Vec::new()
        };
        let shadow_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("shadow sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            compare: Some(wgpu::CompareFunction::LessEqual),
            ..Default::default()
        });
        let shadow_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("shadow layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2Array,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Comparison),
                    count: None,
                },
                // the sky as light (see `env_texture`)
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::Cube,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        // The sky as light: a small cube map (levels are roughness), drawn from `nova.sky` when the game asks for image-based light.
        let env_format = if adapter
            .get_texture_format_features(wgpu::TextureFormat::Rgba16Float)
            .allowed_usages
            .contains(wgpu::TextureUsages::RENDER_ATTACHMENT)
        {
            wgpu::TextureFormat::Rgba16Float
        } else {
            wgpu::TextureFormat::Rgba8UnormSrgb
        };
        let env_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("sky cube"),
            size: wgpu::Extent3d {
                width: ENV_SIZE,
                height: ENV_SIZE,
                depth_or_array_layers: 6,
            },
            mip_level_count: ENV_LEVELS,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: env_format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let env_cube = env_texture.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::Cube),
            ..Default::default()
        });
        let env_views: Vec<wgpu::TextureView> = (0..ENV_LEVELS)
            .flat_map(|level| (0..6).map(move |face| (level, face)))
            .map(|(level, face)| {
                env_texture.create_view(&wgpu::TextureViewDescriptor {
                    label: Some("sky cube face"),
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_mip_level: level,
                    mip_level_count: Some(1),
                    base_array_layer: face,
                    array_layer_count: Some(1),
                    ..Default::default()
                })
            })
            .collect();
        let env_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("sky cube sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        });
        let env_uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("sky cube uniform"),
            size: 48,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let env_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("sky cube layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let env_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("sky cube uniform"),
            layout: &env_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: env_uniform.as_entire_binding(),
            }],
        });
        let env_pipeline = {
            let shader = device.create_shader_module(wgpu::include_wgsl!("shaders/env.wgsl"));
            let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("sky cube pipeline layout"),
                bind_group_layouts: &[Some(&env_layout)],
                immediate_size: 0,
            });
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("sky cube"),
                layout: Some(&layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some("vs_main"),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some("fs_main"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: env_format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview_mask: None,
                cache: None,
            })
        };
        let shadow_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("shadow"),
            layout: &shadow_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&shadow_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&shadow_sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&env_cube),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::Sampler(&env_sampler),
                },
            ],
        });
        let mesh_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("mesh pipeline layout"),
            bind_group_layouts: &[
                Some(&globals_layout),
                Some(&texture_layout),
                Some(&shadow_layout),
            ],
            immediate_size: 0,
        });
        let vertex_attributes = wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Unorm8x4, 3 => Float32x2, 9 => Float32];
        let instance_attributes = wgpu::vertex_attr_array![
            4 => Float32x4, 5 => Float32x4, 6 => Float32x4, 7 => Float32x4, 8 => Float32x4
        ];
        // Opaque meshes write depth and overwrite; meshes with see-through colours (vertex alpha) are drawn after them, blended,
        // without writing depth, so a puff of dust shows the ground behind it.
        let make_mesh_pipeline =
            |label: &'static str, blend: Option<wgpu::BlendState>, depth_write: bool| {
                device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(label),
                    layout: Some(&mesh_layout),
                    vertex: wgpu::VertexState {
                        module: &mesh_shader,
                        entry_point: Some("vs_main"),
                        compilation_options: Default::default(),
                        buffers: &[
                            Some(wgpu::VertexBufferLayout {
                                array_stride: std::mem::size_of::<MeshVertex>() as u64,
                                step_mode: wgpu::VertexStepMode::Vertex,
                                attributes: &vertex_attributes,
                            }),
                            Some(wgpu::VertexBufferLayout {
                                array_stride: std::mem::size_of::<ModelInstance>() as u64,
                                step_mode: wgpu::VertexStepMode::Instance,
                                attributes: &instance_attributes,
                            }),
                        ],
                    },
                    fragment: Some(wgpu::FragmentState {
                        module: &mesh_shader,
                        entry_point: Some("fs_main"),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState {
                            format: world_format,
                            blend,
                            write_mask: wgpu::ColorWrites::ALL,
                        })],
                    }),
                    primitive: wgpu::PrimitiveState {
                        cull_mode: Some(wgpu::Face::Back),
                        ..Default::default()
                    },
                    depth_stencil: Some(wgpu::DepthStencilState {
                        format: DEPTH_FORMAT,
                        depth_write_enabled: Some(depth_write),
                        depth_compare: Some(wgpu::CompareFunction::Less),
                        stencil: Default::default(),
                        bias: Default::default(),
                    }),
                    multisample: wgpu::MultisampleState {
                        count: samples,
                        ..Default::default()
                    },
                    multiview_mask: None,
                    cache: None,
                })
            };
        let shadow_shader = device.create_shader_module(wgpu::include_wgsl!("shaders/shadow.wgsl"));
        let shadow_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("shadow pipeline layout"),
                bind_group_layouts: &[Some(&globals_layout)],
                immediate_size: 0,
            });
        // Depth only: the same vertices and instances as the meshes, from the sun's side. Both faces are drawn (thin
        // shapes like the ground box and flat quads would otherwise leak light) and the bias lives in the sampling.
        let shadow_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("shadow"),
            layout: Some(&shadow_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shadow_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<MeshVertex>() as u64,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &vertex_attributes,
                    }),
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<ModelInstance>() as u64,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &instance_attributes,
                    }),
                ],
            },
            fragment: None,
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let sky_shader = device.create_shader_module(wgpu::include_wgsl!("shaders/sky.wgsl"));
        let sky_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("sky pipeline layout"),
            bind_group_layouts: &[Some(&globals_layout)],
            immediate_size: 0,
        });
        // One triangle over the whole screen, behind everything: no depth test or write.
        let sky_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("sky"),
            layout: Some(&sky_layout),
            vertex: wgpu::VertexState {
                module: &sky_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &sky_shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: world_format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(false),
                depth_compare: Some(wgpu::CompareFunction::Always),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: samples,
                ..Default::default()
            },
            multiview_mask: None,
            cache: None,
        });
        let mesh_pipeline = make_mesh_pipeline("meshes", None, true);
        // Skinned meshes: the same shading, with the vertex stage bending the mesh by the frame's joint palette (a texture).
        let joint_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("joints"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            }],
        });
        let joint_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("joint palette"),
            size: wgpu::Extent3d {
                width: JOINT_TEXTURE_WIDTH,
                height: JOINT_TEXTURE_ROWS,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba32Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let joint_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("joints"),
            layout: &joint_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(
                    &joint_texture.create_view(&wgpu::TextureViewDescriptor::default()),
                ),
            }],
        });
        let skin_attributes = wgpu::vertex_attr_array![10 => Uint16x4, 11 => Float32x4];
        let skinned_mesh_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("skinned mesh pipeline layout"),
            bind_group_layouts: &[
                Some(&globals_layout),
                Some(&texture_layout),
                Some(&shadow_layout),
                Some(&joint_layout),
            ],
            immediate_size: 0,
        });
        let skinned_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("skinned meshes"),
            layout: Some(&skinned_mesh_layout),
            vertex: wgpu::VertexState {
                module: &mesh_shader,
                entry_point: Some("vs_skinned"),
                compilation_options: Default::default(),
                buffers: &[
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<MeshVertex>() as u64,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &vertex_attributes,
                    }),
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<ModelInstance>() as u64,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &instance_attributes,
                    }),
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<SkinVertex>() as u64,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &skin_attributes,
                    }),
                ],
            },
            fragment: Some(wgpu::FragmentState {
                module: &mesh_shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: world_format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                cull_mode: Some(wgpu::Face::Back),
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: samples,
                ..Default::default()
            },
            multiview_mask: None,
            cache: None,
        });
        let skinned_shadow_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("skinned shadow pipeline layout"),
                bind_group_layouts: &[Some(&globals_layout), Some(&joint_layout)],
                immediate_size: 0,
            });
        let skinned_shadow_pipeline =
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("skinned shadow"),
                layout: Some(&skinned_shadow_layout),
                vertex: wgpu::VertexState {
                    module: &shadow_shader,
                    entry_point: Some("vs_skinned"),
                    compilation_options: Default::default(),
                    buffers: &[
                        Some(wgpu::VertexBufferLayout {
                            array_stride: std::mem::size_of::<MeshVertex>() as u64,
                            step_mode: wgpu::VertexStepMode::Vertex,
                            attributes: &vertex_attributes,
                        }),
                        Some(wgpu::VertexBufferLayout {
                            array_stride: std::mem::size_of::<ModelInstance>() as u64,
                            step_mode: wgpu::VertexStepMode::Instance,
                            attributes: &instance_attributes,
                        }),
                        Some(wgpu::VertexBufferLayout {
                            array_stride: std::mem::size_of::<SkinVertex>() as u64,
                            step_mode: wgpu::VertexStepMode::Vertex,
                            attributes: &skin_attributes,
                        }),
                    ],
                },
                fragment: None,
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: DEPTH_FORMAT,
                    depth_write_enabled: Some(true),
                    depth_compare: Some(wgpu::CompareFunction::Less),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: wgpu::MultisampleState::default(),
                multiview_mask: None,
                cache: None,
            });
        // the same meshes drawn into the UI pass (which has no depth): see FrameInput::ui_models
        let ui_mesh_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ui meshes"),
            layout: Some(&mesh_layout),
            vertex: wgpu::VertexState {
                module: &mesh_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<MeshVertex>() as u64,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &vertex_attributes,
                    }),
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<ModelInstance>() as u64,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &instance_attributes,
                    }),
                ],
            },
            fragment: Some(wgpu::FragmentState {
                module: &mesh_shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                cull_mode: Some(wgpu::Face::Back),
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let ui_globals = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("ui globals"),
            size: std::mem::size_of::<Globals>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let ui_globals_group =
            globals_bind_group(&device, &globals_layout, &ui_globals, &terrain_view);
        let ui_instances = DynBuffer::new(
            &device,
            "ui model instances",
            wgpu::BufferUsages::VERTEX,
            1 << 12,
        );
        let mesh_blend_pipeline = make_mesh_pipeline(
            "translucent meshes",
            Some(wgpu::BlendState::ALPHA_BLENDING),
            false,
        );

        let sprites_back =
            DynBuffer::new(&device, "sprites back", wgpu::BufferUsages::VERTEX, 1 << 16);
        let sprites_front = DynBuffer::new(
            &device,
            "sprites front",
            wgpu::BufferUsages::VERTEX,
            1 << 14,
        );
        let sprites_text =
            DynBuffer::new(&device, "sprites text", wgpu::BufferUsages::VERTEX, 1 << 14);
        let model_instances = DynBuffer::new(
            &device,
            "model instances",
            wgpu::BufferUsages::VERTEX,
            1 << 16,
        );

        let view_instances = DynBuffer::new(
            &device,
            "visible model instances",
            wgpu::BufferUsages::VERTEX,
            1 << 16,
        );

        let gpu_timer = device
            .features()
            .contains(wgpu::Features::TIMESTAMP_QUERY)
            .then(|| GpuTimer::new(&device, &queue));

        let fx2d = fx2d::Fx2dGpu::new(
            &device,
            &queue,
            world_format,
            samples,
            &sprite_view_layout,
            &texture_layout,
        );
        let extras = custom::Extras::new(
            &device,
            &queue,
            world_format,
            format,
            samples,
            quality.aniso as u16,
            &custom::Shared {
                globals: &globals_layout,
                texture: &texture_layout,
                shadow: &shadow_layout,
                sprite_view: &sprite_view_layout,
                mesh_shader: &mesh_shader,
            },
        );
        Self {
            adapter,
            device,
            queue,
            format,
            adapter_info,
            quality,
            asked,
            world_format,
            sprite_pipeline,
            sprite_ui_pipeline,
            text_pipeline,
            glyph_texture,
            glyph_group,
            sprites_text,
            blit_pipeline,
            blit_uniform,
            blit_group,
            depth_layout,
            depth_group: None,
            linear_sampler,
            world: None,
            sprite_view,
            sprite_view_group,
            texture_layout,
            sampler_nearest,
            atlas,
            sprites_back,
            sprites_front,
            mesh_pipeline,
            mesh_blend_pipeline,
            skinned_pipeline,
            skinned_shadow_pipeline,
            joint_texture,
            joint_group,
            sky_pipeline,
            shadow_pipeline,
            shadow_layers,
            cascade_globals,
            shadow_group,
            env_views,
            env_pipeline,
            env_uniform,
            env_group,
            env_key: None,
            globals,
            globals_group,
            globals_layout,
            terrain_loaded: None,
            meshes: Vec::new(),
            dyn_meshes: HashMap::new(),
            backup: Backup::default(),
            lost,
            voxel_atlas: None,
            sampler_voxel,
            spare_vertices: Vec::new(),
            spare_indices: Vec::new(),
            mesh_buffers_created: 0,
            mesh_buffers_reused: 0,
            ui_mesh_pipeline,
            ui_globals,
            ui_globals_group,
            ui_instances,
            model_instances,
            view_instances,
            texture_cache: HashMap::new(),
            image_hashes: HashMap::new(),
            mesh_samplers: HashMap::new(),
            gpu_timer,
            textures_shared: 0,
            depth: None,
            msaa: None,
            depth_resolve_pipeline,
            depth_resolve_layout,
            extras,
            fx2d,
        }
    }

    /// `smooth`: bilinear filtering (the atlas then has extruded borders, see `assets::build_atlas_with`).
    pub fn set_sprite_atlas(&mut self, image: &Image, smooth: bool) {
        self.backup.sprite_atlas = Some(image.clone());
        self.backup.smooth_atlas = smooth;
        self.atlas = texture_group(
            &self.device,
            &self.queue,
            &self.texture_layout,
            if smooth {
                &self.linear_sampler
            } else {
                &self.sampler_nearest
            },
            "atlas",
            image,
        );
    }

    /// Replaces the glyph atlas contents (`text::ATLAS_SIZE` squared coverage bytes).
    pub fn update_glyph_atlas(&mut self, coverage: &[u8]) {
        self.backup.glyphs = Some(coverage.to_vec());
        let side = crate::text::ATLAS_SIZE;
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.glyph_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            coverage,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(side),
                rows_per_image: Some(side),
            },
            wgpu::Extent3d {
                width: side,
                height: side,
                depth_or_array_layers: 1,
            },
        );
    }

    /// A buffer of at least `bytes` for a mesh: the one it had if that fits without being much too big, else a spare that
    /// fits, else a new one with a little room to grow.
    fn buffer_for(&mut self, had: Option<wgpu::Buffer>, bytes: u64, vertex: bool) -> wgpu::Buffer {
        let fits = |b: &wgpu::Buffer| b.size() >= bytes && b.size() <= bytes * 2 + 4096;
        let spare = if vertex {
            &mut self.spare_vertices
        } else {
            &mut self.spare_indices
        };
        let mut had = had;
        if let Some(b) = had.take() {
            if fits(&b) {
                self.mesh_buffers_reused += 1;
                return b;
            }
            if spare.len() < 64 {
                spare.push(b);
            }
        }
        if let Some(i) = spare.iter().position(fits) {
            self.mesh_buffers_reused += 1;
            return spare.swap_remove(i);
        }
        self.mesh_buffers_created += 1;
        let size = (bytes + bytes / 4 + 256).next_multiple_of(4);
        self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(if vertex {
                "voxel vertices"
            } else {
                "voxel indices"
            }),
            size,
            usage: (if vertex {
                wgpu::BufferUsages::VERTEX
            } else {
                wgpu::BufferUsages::INDEX
            }) | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        })
    }

    /// A mesh by id: loaded from a model file, or made by a script (ids from [`DYN_MESH_BASE`]).
    fn mesh(&self, id: usize) -> Option<&GpuMesh> {
        if id >= DYN_MESH_BASE {
            self.dyn_meshes.get(&id)
        } else {
            self.meshes.get(id)
        }
    }

    /// Whether the GPU's device was lost (or ran out of memory): [`Gfx::recover`] makes a new one.
    pub fn is_lost(&self) -> bool {
        self.lost.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Destroys the device, as a driver reset would (for testing recovery).
    pub fn simulate_loss(&self) {
        self.device.destroy();
        let _ = self.device.poll(wgpu::PollType::Poll);
    }

    /// Makes a new device and everything on it again from the copies kept on the CPU: the sprite atlas, the glyphs, every loaded
    /// mesh (with the same ids), the voxel atlas and the script-made meshes. What the game holds (mesh ids, its state) stays
    /// valid, so play goes on where it was. `surface` is the window's, if any; the caller configures it again afterwards.
    pub fn recover(
        &mut self,
        instance: &wgpu::Instance,
        surface: Option<&wgpu::Surface<'_>>,
    ) -> Result<(), String> {
        let mut fresh = Gfx::new_with(instance, surface, self.asked)?;
        let backup = std::mem::take(&mut self.backup);
        Self::restore_into(&mut fresh, backup);
        *self = fresh;
        Ok(())
    }

    /// Draws the sky into the cube map when it changed (its colours or the sun), and returns how much to scale the light it gives so that
    /// it averages the game's ambient light. One small pass a face and level (36 in all), only when the sky moves.
    fn update_environment(&mut self, lit: &Lighting) -> f32 {
        let (top, horizon, sun) = match lit.sky {
            Some(k) => (
                k.top,
                k.horizon,
                k.sun.map_or([0.0, 1.0, 0.0, 0.0], |s| {
                    let d = Vec3::from(s).normalize_or(Vec3::Y);
                    [d.x, d.y, d.z, 1.0]
                }),
            ),
            None => (lit.ambient, lit.ambient, [0.0, 1.0, 0.0, 0.0]),
        };
        let numbers: [f32; 12] = [
            top[0], top[1], top[2], 0.0, horizon[0], horizon[1], horizon[2], 0.0, sun[0], sun[1],
            sun[2], sun[3],
        ];
        let key = numbers.iter().fold(0xcbf2_9ce4_8422_2325u64, |h, v| {
            (h ^ u64::from(v.to_bits())).wrapping_mul(0x0100_0000_01b3)
        });
        if self.env_key != Some(key) {
            self.queue
                .write_buffer(&self.env_uniform, 0, bytemuck::cast_slice(&numbers));
            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("sky cube"),
                });
            for (job, view) in self.env_views.iter().enumerate() {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("sky cube face"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
                pass.set_pipeline(&self.env_pipeline);
                pass.set_bind_group(0, &self.env_group, &[]);
                // (the instance number says which level and face)
                pass.draw(0..3, job as u32..job as u32 + 1);
            }
            self.queue.submit([encoder.finish()]);
            self.env_key = Some(key);
        }
        // the light of the sky averaged over a sphere (the upper half is the sky's middle colour, the lower the ground), against the
        // game's ambient, in brightness
        let luma = |c: [f32; 3]| 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        let mid = [0, 1, 2].map(|i| 0.5 * (top[i] + horizon[i]));
        let average = 0.5 * luma(mid) + 0.5 * 0.45 * luma(horizon);
        (luma(lit.ambient) / average.max(1e-3)).clamp(0.25, 4.0)
    }

    /// Changes the quality settings (see [`Quality`]); a change rebuilds the world's pipelines and puts everything back on the GPU.
    pub fn set_quality(&mut self, wanted: Quality) {
        if wanted == self.asked {
            return;
        }
        let mut fresh = Self::build(
            self.adapter.clone(),
            self.device.clone(),
            self.queue.clone(),
            self.lost.clone(),
            self.adapter_info.clone(),
            self.format,
            wanted,
        );
        log::info!("quality: {:?} (asked {:?})", fresh.quality, wanted);
        Self::restore_into(&mut fresh, std::mem::take(&mut self.backup));
        *self = fresh;
    }

    fn restore_into(fresh: &mut Gfx, backup: Backup) {
        if let Some(image) = &backup.sprite_atlas {
            fresh.set_sprite_atlas(image, backup.smooth_atlas);
        }
        if let Some(coverage) = &backup.glyphs {
            fresh.update_glyph_atlas(coverage);
        }
        for (mesh, skin) in &backup.meshes {
            match skin {
                Some(influences) => fresh.upload_skinned_mesh(mesh, influences),
                None => fresh.upload_mesh(mesh),
            };
        }
        let mut ops = Vec::new();
        if let Some(image) = backup.voxel_atlas {
            ops.push(MeshOp::SetAtlas(image));
        }
        for (id, (vertices, indices, plain)) in backup.dyn_meshes {
            ops.push(MeshOp::Upload {
                id,
                vertices,
                indices,
                plain,
            });
        }
        for (id, (base, vertices)) in backup.variants {
            ops.push(MeshOp::Variant { id, base, vertices });
        }
        for (id, (look, vertices, indices)) in backup.styled {
            ops.push(MeshOp::Styled {
                id,
                look,
                vertices,
                indices,
            });
        }
        fresh.apply_mesh_ops(&ops);
        for source in &backup.shaders {
            // (the same ids again; a shader that failed before fails again and keeps its place)
            let _ = fresh.add_shader(source);
        }
        for (id, image) in &backup.shader_textures {
            fresh.set_shader_texture(*id, image);
        }
    }

    /// Puts the game's heightmap on the GPU when it changed (one upload per map, by identity), and points both globals groups at it.
    fn sync_heightmap(&mut self, wanted: Option<&std::sync::Arc<crate::heightmap::HeightMap>>) {
        let same = match (&self.terrain_loaded, wanted) {
            (None, None) => true,
            (Some(a), Some(b)) => std::sync::Arc::ptr_eq(a, b),
            _ => false,
        };
        if same {
            return;
        }
        let view = match wanted {
            Some(m) => terrain_texture_view(&self.device, &self.queue, &m.heights, m.width, m.rows),
            None => terrain_texture_view(&self.device, &self.queue, &[0.0], 1, 1),
        };
        self.globals_group =
            globals_bind_group(&self.device, &self.globals_layout, &self.globals, &view);
        self.ui_globals_group =
            globals_bind_group(&self.device, &self.globals_layout, &self.ui_globals, &view);
        for (buffer, group) in &mut self.cascade_globals {
            *group = globals_bind_group(&self.device, &self.globals_layout, buffer, &view);
        }
        self.terrain_loaded = wanted.cloned();
    }

    /// Uploads a mesh once; the returned id is used by [`ModelDraw`].
    pub fn upload_mesh(&mut self, mesh: &MeshData) -> usize {
        self.backup.meshes.push((
            MeshData {
                morphs: Vec::new(),
                material: mesh.material.clone(),
                vertices: mesh.vertices.clone(),
                indices: mesh.indices.clone(),
                texture: mesh.texture.clone(),
                wrap: mesh.wrap,
                smooth: mesh.smooth,
                notes: Vec::new(),
                compressed: mesh.compressed.clone(),
                detail: mesh.detail.clone(),
            },
            None,
        ));
        let vertices = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("mesh vertices"),
                contents: bytemuck::cast_slice(&mesh.vertices),
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            });
        let indices = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("mesh indices"),
                contents: bytemuck::cast_slice(&mesh.indices),
                usage: wgpu::BufferUsages::INDEX,
            });
        let translucent = mesh.vertices.iter().any(|v| v.color[3] < 255);
        // (a blended mesh, or a model whose file asks for smooth filtering, is filtered smoothly, with mipmaps)
        let smooth = translucent || mesh.smooth;
        // a compressed picture beside the model, when this GPU can read its format
        let compressed = mesh.compressed.as_ref().filter(|k| {
            crate::ktx2::feature_of(k.format).is_none_or(|f| self.device.features().contains(f))
        });
        let aniso = self.quality.aniso as u16;
        let texture = if let Some(k) = compressed {
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            (
                k.width,
                k.height,
                format!("{:?}", k.format),
                &k.levels,
                mesh.wrap,
            )
                .hash(&mut hasher);
            let key = hasher.finish();
            if let Some(group) = self.texture_cache.get(&key) {
                self.textures_shared += 1;
                group.clone()
            } else {
                let device = &self.device;
                let sampler = self
                    .mesh_samplers
                    .entry((true, mesh.wrap))
                    .or_insert_with(|| mesh_sampler(device, true, mesh.wrap, aniso));
                let group =
                    compressed_group(&self.device, &self.queue, &self.texture_layout, sampler, k);
                self.texture_cache.insert(key, group.clone());
                group
            }
        } else {
            match &mesh.texture {
                Some(image) => {
                    use std::hash::{Hash, Hasher};
                    // (a picture many models share, a road's or the ground's, is hashed once: found again by its address, which
                    // stays its own while it is kept here)
                    let content = self
                        .image_hashes
                        .entry(std::sync::Arc::as_ptr(image) as usize)
                        .or_insert_with(|| {
                            let mut hasher = std::collections::hash_map::DefaultHasher::new();
                            (image.width, image.height, &image.rgba).hash(&mut hasher);
                            (image.clone(), hasher.finish())
                        })
                        .1;
                    let mut hasher = std::collections::hash_map::DefaultHasher::new();
                    (content, smooth, mesh.wrap).hash(&mut hasher);
                    let key = hasher.finish();
                    if let Some(group) = self.texture_cache.get(&key) {
                        self.textures_shared += 1;
                        group.clone()
                    } else {
                        // a blended mesh's picture (a billboard) is filtered smoothly, with mipmaps when its sides are powers of two; a solid
                        // model's (usually a palette of flat colours) keeps sharp texels
                        let pow2 = image.width.is_power_of_two() && image.height.is_power_of_two();
                        let device = &self.device;
                        let sampler = self
                            .mesh_samplers
                            .entry((smooth, mesh.wrap))
                            .or_insert_with(|| mesh_sampler(device, smooth, mesh.wrap, aniso));
                        let group = if smooth {
                            // (with anisotropic filtering asked for, every size gets its whole chain of smaller copies)
                            let levels = if aniso > 1 {
                                32 - image.width.max(image.height).leading_zeros()
                            } else if pow2 {
                                32 - image.width.min(image.height).leading_zeros()
                            } else {
                                1
                            };
                            texture_group_mips(
                                &self.device,
                                &self.queue,
                                &self.texture_layout,
                                sampler,
                                "billboard texture",
                                image,
                                levels,
                            )
                        } else {
                            texture_group(
                                &self.device,
                                &self.queue,
                                &self.texture_layout,
                                sampler,
                                "mesh texture",
                                image,
                            )
                        };
                        self.texture_cache.insert(key, group.clone());
                        group
                    }
                }
                None => self.white_group(),
            }
        };
        let material = self.upload_material(mesh);
        let detail = if material.is_none() && !translucent {
            self.upload_detail(mesh)
        } else {
            None
        };
        self.meshes.push(GpuMesh {
            detail,
            vertices,
            indices,
            index_count: mesh.indices.len() as u32,
            texture,
            translucent,
            skin: None,
            bounds: bounding_sphere(&mesh.vertices),
            material,
        });
        self.meshes.len() - 1
    }

    /// Uploads a mesh that bends with joints: `influences` has, for each vertex, up to four joint numbers and weights.
    pub fn upload_skinned_mesh(
        &mut self,
        mesh: &MeshData,
        influences: &[([u16; 4], [f32; 4])],
    ) -> usize {
        let id = self.upload_mesh(mesh);
        self.backup.meshes[id].1 = Some(influences.to_vec());
        let skin: Vec<SkinVertex> = (0..mesh.vertices.len())
            .map(|i| {
                let (joints, weights) = influences.get(i).copied().unwrap_or(([0; 4], [0.0; 4]));
                SkinVertex { joints, weights }
            })
            .collect();
        let buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("mesh skin"),
                contents: bytemuck::cast_slice(&skin),
                usage: wgpu::BufferUsages::VERTEX,
            });
        let mesh = &mut self.meshes[id];
        mesh.skin = Some(buffer);
        mesh.translucent = false;
        id
    }

    fn white_group(&self) -> wgpu::BindGroup {
        let white = Image {
            width: 1,
            height: 1,
            rgba: vec![255; 4],
        };
        texture_group(
            &self.device,
            &self.queue,
            &self.texture_layout,
            &self.sampler_nearest,
            "white",
            &white,
        )
    }

    fn ensure_depth(&mut self, size: (u32, u32)) {
        let samples = self.quality.msaa;
        let have_msaa = self.msaa.as_ref().is_some_and(|m| m.size == size);
        if matches!(&self.depth, Some((_, s)) if *s == size) && (samples == 1 || have_msaa) {
            return;
        }
        let make = |label: &'static str, format: wgpu::TextureFormat, count: u32| {
            self.device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some(label),
                    size: wgpu::Extent3d {
                        width: size.0,
                        height: size.1,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: count,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                        | wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                })
                .create_view(&wgpu::TextureViewDescriptor::default())
        };
        let view = make("depth", DEPTH_FORMAT, samples);
        let depth_for_finishing = if samples > 1 {
            // the world pass draws into samples; the finishing pass reads a one-sample depth made from them
            let resolved = make("resolved depth", DEPTH_FORMAT, 1);
            let colour = make("world samples", self.world_format, samples);
            let depth_samples = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("depth samples"),
                layout: &self.depth_resolve_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&view),
                }],
            });
            self.msaa = Some(MsaaTargets {
                colour,
                depth_samples,
                resolved: resolved.clone(),
                size,
            });
            resolved
        } else {
            self.msaa = None;
            view.clone()
        };
        self.depth_group = Some(self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("depth for the finishing pass"),
            layout: &self.depth_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(&depth_for_finishing),
            }],
        }));
        self.depth = Some((view, size));
    }

    fn ensure_world(&mut self, size: (u32, u32)) {
        if matches!(&self.world, Some(w) if w.size == size) {
            return;
        }
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("world target"),
            size: wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.world_format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("world target"),
            layout: &self.texture_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.linear_sampler),
                },
            ],
        });
        self.world = Some(WorldTarget { view, size, group });
    }

    /// Logical height 540 maps to the target height, so 2D art keeps its size on any screen.
    pub fn ui_scale(size: (u32, u32)) -> f32 {
        size.1 as f32 / 540.0
    }

    /// Makes, replaces and frees the script-made meshes (voxel chunks, baked levels), and sets their atlas.
    fn apply_mesh_ops(&mut self, ops: &[MeshOp]) {
        for op in ops {
            match op {
                MeshOp::SetAtlas(image) => {
                    // five levels: a 16-pixel tile stays whole down to the last, so far blocks blend instead of shimmering
                    let levels = if image.width.min(image.height) >= 16 {
                        5
                    } else {
                        1
                    };
                    self.backup.voxel_atlas = Some(image.clone());
                    self.voxel_atlas = Some(texture_group_mips(
                        &self.device,
                        &self.queue,
                        &self.texture_layout,
                        &self.sampler_voxel,
                        "voxel atlas",
                        image,
                        levels,
                    ));
                    // meshes made earlier keep the old picture until they are rebuilt, which the game does
                }
                MeshOp::Upload {
                    id,
                    vertices,
                    indices,
                    plain,
                } => {
                    let atlas = if *plain {
                        self.white_group()
                    } else {
                        let Some(atlas) = self.voxel_atlas.clone() else {
                            continue;
                        };
                        atlas
                    };
                    if indices.is_empty() {
                        self.dyn_meshes.remove(id);
                        self.backup.dyn_meshes.remove(id);
                        continue;
                    }
                    self.backup
                        .dyn_meshes
                        .insert(*id, (vertices.clone(), indices.clone(), *plain));
                    // the buffers this mesh had, if they still fit (and are not wastefully big), or a spare that fits, or new ones
                    let old = self.dyn_meshes.remove(id);
                    let (vbytes, ibytes): (&[u8], &[u8]) = (
                        bytemuck::cast_slice(vertices),
                        bytemuck::cast_slice(indices),
                    );
                    let (old_v, old_i) = match old {
                        Some(m) => (Some(m.vertices), Some(m.indices)),
                        None => (None, None),
                    };
                    let vertex_buffer = self.buffer_for(old_v, vbytes.len() as u64, true);
                    let index_buffer = self.buffer_for(old_i, ibytes.len() as u64, false);
                    self.queue.write_buffer(&vertex_buffer, 0, vbytes);
                    self.queue.write_buffer(&index_buffer, 0, ibytes);
                    self.dyn_meshes.insert(
                        *id,
                        GpuMesh {
                            vertices: vertex_buffer,
                            indices: index_buffer,
                            index_count: indices.len() as u32,
                            texture: atlas,
                            translucent: vertices.iter().any(|v| v.color[3] < 255),
                            skin: None,
                            bounds: bounding_sphere(vertices),
                            material: None,
                            detail: None,
                        },
                    );
                }
                MeshOp::Variant { id, base, vertices } => {
                    let Some(b) = self.mesh(*base) else { continue };
                    let (indices, index_count, texture, translucent, material, detail) = (
                        b.indices.clone(),
                        b.index_count,
                        b.texture.clone(),
                        b.translucent,
                        b.material.clone(),
                        b.detail.clone(),
                    );
                    let buffer =
                        self.device
                            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                                label: Some("shape key vertices"),
                                contents: bytemuck::cast_slice(vertices),
                                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                            });
                    self.backup.variants.insert(*id, (*base, vertices.clone()));
                    self.dyn_meshes.insert(
                        *id,
                        GpuMesh {
                            vertices: buffer,
                            indices,
                            index_count,
                            texture,
                            translucent,
                            skin: None,
                            bounds: bounding_sphere(vertices),
                            material,
                            detail,
                        },
                    );
                }
                MeshOp::Styled {
                    id,
                    look,
                    vertices,
                    indices,
                } => {
                    self.dyn_meshes.remove(id);
                    self.backup.styled.remove(id);
                    if indices.is_empty() {
                        continue;
                    }
                    let base = look.and_then(|l| self.mesh(l)).map(|b| {
                        (
                            b.texture.clone(),
                            b.translucent,
                            b.material.clone(),
                            b.detail.clone(),
                        )
                    });
                    let (texture, base_translucent, material, detail) = match base {
                        Some(b) => b,
                        None => (self.white_group(), false, None, None),
                    };
                    let vertex_buffer =
                        self.device
                            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                                label: Some("made mesh vertices"),
                                contents: bytemuck::cast_slice(vertices),
                                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                            });
                    let index_buffer =
                        self.device
                            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                                label: Some("made mesh indices"),
                                contents: bytemuck::cast_slice(indices),
                                usage: wgpu::BufferUsages::INDEX | wgpu::BufferUsages::COPY_DST,
                            });
                    self.backup
                        .styled
                        .insert(*id, (*look, vertices.clone(), indices.clone()));
                    self.dyn_meshes.insert(
                        *id,
                        GpuMesh {
                            vertices: vertex_buffer,
                            indices: index_buffer,
                            index_count: indices.len() as u32,
                            texture,
                            translucent: base_translucent
                                || vertices.iter().any(|v| v.color[3] < 255),
                            skin: None,
                            bounds: bounding_sphere(vertices),
                            material,
                            detail,
                        },
                    );
                }
                MeshOp::Free(id) => {
                    // (a shape-key variant shares its base mesh's triangles: that index buffer is not ours to reuse)
                    let variant = self.backup.variants.remove(id).is_some();
                    self.backup.styled.remove(id);
                    self.backup.dyn_meshes.remove(id);
                    if let Some(m) = self.dyn_meshes.remove(id) {
                        if self.spare_vertices.len() < 64 {
                            self.spare_vertices.push(m.vertices);
                        }
                        if !variant && self.spare_indices.len() < 64 {
                            self.spare_indices.push(m.indices);
                        }
                    }
                }
            }
        }
    }

    pub fn render(
        &mut self,
        target: &wgpu::TextureView,
        size: (u32, u32),
        input: &FrameInput,
    ) -> FrameStats {
        self.set_quality(Quality::forced().unwrap_or(input.lighting.quality));
        let aspect = size.0 as f32 / size.1 as f32;
        let world_height = Quality::forced_world_height().unwrap_or(input.world_height);
        let world_size = if world_height != 0 && world_height < size.1 {
            (
                ((world_height as f32 * aspect).round() as u32).max(1),
                world_height,
            )
        } else {
            size
        };
        // a look with an outline or a colour adjustment is finished in the pass that puts the world on the screen, so it
        // always goes through the world target (at the screen's own size if no smaller one was asked for)
        let look = input.lighting.look;
        // (a post effect is drawn over the world picture, so it needs one too)
        let separate = world_size != size
            || look.needs_post()
            || input.post.is_some()
            || self.quality.hdr
            || self.quality.msaa > 1;
        self.ensure_depth(world_size);
        if separate {
            self.ensure_world(world_size);
            let far = match input.lighting.fog {
                Some(f) if f.far.is_finite() && f.far > 1.0 => (f.far * 1.05).clamp(20.0, 400.0),
                _ => 400.0,
            };
            let (outline_color, outline_width, outline_dark) = match look.outline {
                Some((c, dark, width)) => (c, width.max(1.0), dark.clamp(0.0, 1.0)),
                None => ([0.0; 3], 1.0, 0.0),
            };
            let (fog_near, fog_far) = input
                .lighting
                .fog
                .map_or((0.0, 0.0), |f| (f.near, f.far.max(f.near + 0.001)));
            let blit = [
                world_size.0 as f32,
                world_size.1 as f32,
                size.0 as f32 / world_size.0 as f32,
                size.1 as f32 / world_size.1 as f32,
                look.exposure.max(0.0),
                look.saturation.max(0.0),
                look.vignette.clamp(0.0, 1.0),
                outline_dark,
                outline_color[0],
                outline_color[1],
                outline_color[2],
                outline_width,
                0.1,
                far,
                fog_near,
                fog_far,
                look.bloom.clamp(0.0, 4.0),
                look.ao.clamp(0.0, 1.0),
                look.ao_radius.clamp(0.05, 8.0),
                look.bloom_threshold.clamp(0.0, 1.0),
                // pixels of the world picture that one metre spans at one metre away
                world_size.1 as f32 / (2.0 * (input.camera.fov_y_degrees.to_radians() * 0.5).tan()),
                look.blur.clamp(0.0, 1.0),
                look.fxaa.clamp(0.0, 1.0),
                if self.quality.hdr { 1.0 } else { 0.0 },
                look.grade[0][0],
                look.grade[0][1],
                look.grade[0][2],
                if look.graded() { 1.0 } else { 0.0 },
                look.grade[1][0],
                look.grade[1][1],
                look.grade[1][2],
                0.0,
            ];
            self.queue
                .write_buffer(&self.blit_uniform, 0, bytemuck::cast_slice(&blit));
        }
        let scale = Self::ui_scale(size);
        let view = SpriteView {
            size: [size.0 as f32 / scale, size.1 as f32 / scale],
            pad: [0.0; 2],
        };
        self.queue
            .write_buffer(&self.sprite_view, 0, bytemuck::bytes_of(&view));

        // Where the view ends: 400 m, or just past where the fog has covered everything (what is beyond is the fog's colour
        // already, so it is neither drawn nor missed, and the depth buffer keeps more precision).
        let far = match input.lighting.fog {
            Some(f) if f.far.is_finite() && f.far > 1.0 => (f.far * 1.05).clamp(20.0, 400.0),
            _ => 400.0,
        };
        // wgpu clip space is 0..1 in depth with y up, which is glam's "directx" projection.
        let view_proj = glam::camera::rh::proj::directx::perspective(
            input.camera.fov_y_degrees.to_radians(),
            aspect,
            0.1,
            far,
        ) * glam::camera::rh::view::look_at_mat4(
            input.camera.eye,
            input.camera.target,
            Vec3::Y,
        );
        let lit = &input.lighting;
        let mut point_pos = [[0.0f32; 4]; MAX_POINT_LIGHTS];
        let mut point_color = [[0.0f32; 4]; MAX_POINT_LIGHTS];
        let mut point_dir = [[0.0f32; 4]; MAX_POINT_LIGHTS];
        for (i, p) in lit.points.iter().take(lit.point_count).enumerate() {
            point_pos[i] = [
                p.position[0],
                p.position[1],
                p.position[2],
                p.radius.max(0.0001),
            ];
            point_color[i] = [p.color[0], p.color[1], p.color[2], 1.0];
            point_dir[i] = [p.direction[0], p.direction[1], p.direction[2], p.cone];
        }
        let mut terrain_uniform = [[0.0f32; 4]; MAX_TERRAIN_WAVES + 1];
        terrain_uniform[0][0] = lit.terrain.count as f32;
        terrain_uniform[1..].copy_from_slice(&lit.terrain.waves);
        let mut terrain_map = [[0.0f32; 4]; 2];
        if let Some(m) = &lit.terrain.map {
            terrain_uniform[0][1] = 1.0;
            terrain_map = [
                [m.x0, m.z0, 1.0 / m.cell, 0.0],
                [(m.width - 1) as f32, (m.rows - 1) as f32, 0.0, 0.0],
            ];
        }
        let (sky, fog) = (lit.sky, lit.fog);
        // The sun's view of the ground around what the camera looks at: a square box seen along the light, moved in whole
        // texels so that shadows do not crawl as the camera moves.
        let cascade_count = self.quality.cascades.max(1) as usize;
        let plans: Vec<CascadePlan> = match lit.shadows {
            Some(sh) => {
                let dir = Vec3::from(lit.direction).normalize_or_zero();
                let dir = if dir == Vec3::ZERO { -Vec3::Y } else { dir };
                let up = if dir.y.abs() > 0.99 { Vec3::X } else { Vec3::Y };
                let look = glam::camera::rh::view::look_to_mat4(Vec3::ZERO, dir, up);
                let fit = |centre_world: Vec3, r: f32, extent: f32| {
                    let texel = 2.0 * r / SHADOW_SIZE as f32;
                    let mut centre = look.transform_point3(centre_world);
                    centre.x = (centre.x / texel).round() * texel;
                    centre.y = (centre.y / texel).round() * texel;
                    let proj = glam::camera::rh::proj::directx::orthographic(
                        centre.x - r,
                        centre.x + r,
                        centre.y - r,
                        centre.y + r,
                        -centre.z - extent,
                        -centre.z + extent,
                    );
                    (proj * look, texel)
                };
                if cascade_count <= 1 {
                    let r = sh.radius.max(0.5);
                    let (vp, texel) = fit(input.camera.target, r, r * 4.0);
                    vec![CascadePlan {
                        vp,
                        far: f32::MAX,
                        bias: 0.0015,
                        texel,
                    }]
                } else {
                    // Cascades: the view's depth from the camera to `distance` cut into slices (a blend of equal and
                    // geometric steps: fine near the camera, coarse far away), each slice's bounding sphere drawn into its
                    // own map. A sphere does not change size as the camera turns, and its centre moves in whole texels, so
                    // the shadows do not shimmer.
                    let distance = (sh.radius.max(0.5) * 3.0).min(far);
                    let near = 0.3f32;
                    let forward = (input.camera.target - input.camera.eye).normalize_or(Vec3::Z);
                    let tan_half = (input.camera.fov_y_degrees.to_radians() * 0.5).tan();
                    let k = (1.0 + aspect * aspect).sqrt() * tan_half;
                    let mut plans = Vec::with_capacity(cascade_count);
                    let mut start = near;
                    for i in 1..=cascade_count {
                        let f = i as f32 / cascade_count as f32;
                        let end = 0.7 * near * (distance / near).powf(f)
                            + 0.3 * (near + (distance - near) * f);
                        let (a, b) = (start, end);
                        let (cdist, r) = if k * k >= (b - a) / (b + a) {
                            (b, b * k)
                        } else {
                            (
                                0.5 * (a + b) * (1.0 + k * k),
                                0.5 * ((b - a).powi(2)
                                    + 2.0 * (b * b + a * a) * k * k
                                    + (b + a).powi(2) * k.powi(4))
                                .sqrt(),
                            )
                        };
                        let r = (r * 8.0).ceil() / 8.0;
                        let extent = (r * 4.0).max(100.0);
                        let (vp, texel) = fit(input.camera.eye + forward * cdist, r, extent);
                        plans.push(CascadePlan {
                            vp,
                            far: end,
                            bias: (texel * 2.5 + 0.02) / (2.0 * extent),
                            texel,
                        });
                        start = end;
                    }
                    plans
                }
            }
            None => Vec::new(),
        };
        let light_view_proj = plans
            .first()
            .map_or([[0.0; 4]; 4], |p| p.vp.to_cols_array_2d());
        let shadow = match (lit.shadows, plans.first()) {
            (Some(sh), Some(p)) => [1.0, 1.0 / SHADOW_SIZE as f32, p.bias, sh.strength],
            _ => [0.0; 4],
        };
        let mut cascade_vp = [[[0.0f32; 4]; 4]; MAX_CASCADES as usize];
        let mut cascade_info = [[0.0f32; 4]; MAX_CASCADES as usize];
        for (i, p) in plans.iter().enumerate().take(MAX_CASCADES as usize) {
            cascade_vp[i] = p.vp.to_cols_array_2d();
            cascade_info[i] = [p.far, p.bias, p.texel, 0.0];
        }
        let ibl_gain = if self.quality.ibl {
            self.update_environment(lit)
        } else {
            0.0
        };
        let globals = Globals {
            view_proj: view_proj.to_cols_array_2d(),
            light_dir: [
                lit.direction[0],
                lit.direction[1],
                lit.direction[2],
                lit.point_count.min(MAX_POINT_LIGHTS) as f32,
            ],
            light_color: [lit.color[0], lit.color[1], lit.color[2], 1.0],
            ambient: [lit.ambient[0], lit.ambient[1], lit.ambient[2], 1.0],
            point_pos,
            point_color,
            inv_view_proj: view_proj.inverse().to_cols_array_2d(),
            eye: [
                input.camera.eye.x,
                input.camera.eye.y,
                input.camera.eye.z,
                0.0,
            ],
            sky_top: sky.map_or([0.0; 4], |k| [k.top[0], k.top[1], k.top[2], 1.0]),
            sky_horizon: sky.map_or([0.0; 4], |k| {
                [k.horizon[0], k.horizon[1], k.horizon[2], 1.0]
            }),
            fog_color: fog.map_or([0.0; 4], |f| [f.color[0], f.color[1], f.color[2], 1.0]),
            fog_range: fog.map_or([0.0; 4], |f| [f.near, f.far.max(f.near + 0.001), 0.0, 0.0]),
            light_view_proj,
            shadow,
            voxel: [lit.day, lit.look.toon, 0.0, 0.0],
            sky_sun: sky.map_or([0.0, 1.0, 0.0, 0.0], |k| {
                let d = k
                    .sun
                    .map_or(Vec3::Y, |s| Vec3::from(s).normalize_or(Vec3::Y));
                [d.x, d.y, d.z, k.stars]
            }),
            wind: [
                lit.wind.direction[0],
                lit.wind.direction[1],
                lit.wind.strength,
                lit.wind.time,
            ],
            point_dir,
            terrain: terrain_uniform,
            terrain_map,
            cascade_vp,
            cascade_info,
            cascade_count: [
                plans.len() as f32,
                if self.quality.ibl { 1.0 } else { 0.0 },
                ibl_gain,
                (ENV_LEVELS - 1) as f32,
            ],
            sky_extra: sky.map_or([0.0; 4], |k| {
                [
                    k.clouds,
                    k.time,
                    if k.sun.is_some() { 1.0 } else { 0.0 },
                    0.0,
                ]
            }),
            // the land lit as a flat piece of ground is (mesh.wgsl's plain light on a surface that faces up)
            ground: sky.and_then(|k| k.ground).map_or([0.0; 4], |g| {
                let sun = (-lit.direction[1]).max(0.0);
                let l = |i: usize| {
                    g[i] * (lit.ambient[i] + lit.color[i] * sun * (1.0 - lit.ambient[i]))
                };
                [l(0), l(1), l(2), 1.0]
            }),
        };
        self.sync_heightmap(lit.terrain.map.as_ref());
        self.queue
            .write_buffer(&self.globals, 0, bytemuck::bytes_of(&globals));
        if plans.len() > 1 {
            // (each cascade's pass is drawn with its own light matrix: a copy of the globals with that one)
            for ((buffer, _), plan) in self.cascade_globals.iter().zip(&plans) {
                let mut copy = globals;
                copy.light_view_proj = plan.vp.to_cols_array_2d();
                self.queue
                    .write_buffer(buffer, 0, bytemuck::bytes_of(&copy));
            }
        }
        if !input.ui_models.is_empty() {
            // an orthographic camera in the UI's units (y down), looking along -z: clip x = 2X/W - 1, clip y = 1 - 2Y/H,
            // depth from z (nearer is smaller; nothing is depth tested, but it must stay inside 0 to 1)
            let ui_scale = Self::ui_scale(size);
            let (uw, uh) = (size.0 as f32 / ui_scale, size.1 as f32 / ui_scale);
            let ortho = glam::Mat4::from_cols(
                glam::Vec4::new(2.0 / uw, 0.0, 0.0, 0.0),
                glam::Vec4::new(0.0, -2.0 / uh, 0.0, 0.0),
                glam::Vec4::new(0.0, 0.0, -1.0 / 2000.0, 0.0),
                glam::Vec4::new(-1.0, 1.0, 0.5, 1.0),
            );
            let ui_globals = Globals {
                view_proj: ortho.to_cols_array_2d(),
                light_dir: [-0.3, -0.55, -0.78, 0.0],
                light_color: [1.0, 1.0, 1.0, 1.0],
                ambient: [0.6, 0.6, 0.6, 1.0],
                point_pos: [[0.0; 4]; MAX_POINT_LIGHTS],
                point_color: [[0.0; 4]; MAX_POINT_LIGHTS],
                inv_view_proj: ortho.inverse().to_cols_array_2d(),
                eye: [0.0; 4],
                sky_top: [0.0; 4],
                sky_horizon: [0.0; 4],
                fog_color: [0.0; 4],
                fog_range: [0.0; 4],
                light_view_proj: [[0.0; 4]; 4],
                shadow: [0.0; 4],
                voxel: [1.0, 0.0, 0.0, 0.0],
                sky_sun: [0.0, 1.0, 0.0, 0.0],
                sky_extra: [0.0; 4],
                wind: [0.0; 4],
                point_dir: [[0.0; 4]; MAX_POINT_LIGHTS],
                terrain: [[0.0; 4]; MAX_TERRAIN_WAVES + 1],
                terrain_map: [[0.0; 4]; 2],
                cascade_vp: [[[0.0; 4]; 4]; MAX_CASCADES as usize],
                cascade_info: [[0.0; 4]; MAX_CASCADES as usize],
                cascade_count: [0.0; 4],
                ground: [0.0; 4],
            };
            self.queue
                .write_buffer(&self.ui_globals, 0, bytemuck::bytes_of(&ui_globals));
            let instances: Vec<ModelInstance> =
                input.ui_models.iter().map(|m| m.instance).collect();
            self.ui_instances
                .write(&self.device, &self.queue, bytemuck::cast_slice(&instances));
        }

        self.sprites_back.write(
            &self.device,
            &self.queue,
            bytemuck::cast_slice(input.sprites_back),
        );
        self.sprites_front.write(
            &self.device,
            &self.queue,
            bytemuck::cast_slice(input.sprites_front),
        );
        self.sprites_text
            .write(&self.device, &self.queue, bytemuck::cast_slice(input.text));
        self.apply_mesh_ops(input.mesh_ops);
        if let Some(fx) = &input.lighting.fx2d {
            self.fx2d
                .prepare(&self.device, &self.queue, &fx.0, world_size);
        }
        for (id, image) in input.texture_ops {
            self.set_shader_texture(*id, image);
        }
        if !input.joints.is_empty() {
            // the palette: whole rows of the joint texture, only as many as are used
            let count = input.joints.len().min(MAX_JOINT_MATRICES);
            let per_row = (JOINT_TEXTURE_WIDTH / 4) as usize;
            let rows = count.div_ceil(per_row);
            let mut bytes: Vec<u8> = bytemuck::cast_slice(&input.joints[..count]).to_vec();
            bytes.resize(rows * per_row * 64, 0);
            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.joint_texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                &bytes,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(JOINT_TEXTURE_WIDTH * 16),
                    rows_per_image: Some(rows as u32),
                },
                wgpu::Extent3d {
                    width: JOINT_TEXTURE_WIDTH,
                    height: rows as u32,
                    depth_or_array_layers: 1,
                },
            );
        }
        // What the camera can see.
        let planes = frustum_planes(&view_proj);
        let world_models: Vec<ModelDraw> = input
            .models
            .iter()
            .filter(|m| match self.mesh(m.mesh) {
                Some(mesh) => instance_visible(
                    &planes,
                    mesh.bounds,
                    mesh.skin.is_some(),
                    &m.instance.matrix,
                    lit.terrain.lift(),
                ),
                None => true,
            })
            .copied()
            .collect();
        // models with a custom shader: culled the same way, one draw each
        let shaded_models: Vec<ShadedModel> = input
            .shaded_models
            .iter()
            .filter(|m| match self.mesh(m.draw.mesh) {
                Some(mesh) => instance_visible(
                    &planes,
                    mesh.bounds,
                    mesh.skin.is_some(),
                    &m.draw.instance.matrix,
                    lit.terrain.lift(),
                ),
                None => false,
            })
            .copied()
            .collect();
        let culled = (input.models.len() + input.shaded_models.len()
            - world_models.len()
            - shaded_models.len()) as u32;
        let custom_slots = if shaded_models.is_empty()
            && input.shaded_sprites.is_empty()
            && input.post.is_none()
        {
            Vec::new()
        } else {
            let list: Vec<ModelInstance> = shaded_models.iter().map(|m| m.draw.instance).collect();
            self.extras.shaded_instances.write(
                &self.device,
                &self.queue,
                bytemuck::cast_slice(&list),
            );
            self.prepare_custom(input, &shaded_models, world_size, size)
        };
        let (model_slots, rest) =
            custom_slots.split_at(shaded_models.len().min(custom_slots.len()));
        let (sprite_slots, post_slot) = rest.split_at(input.shaded_sprites.len().min(rest.len()));
        let post_slot = post_slot.first().and_then(Option::as_ref);
        let sprite_runs = |ui: bool| -> Vec<(usize, &ShadedSprite, &custom::Slot)> {
            input
                .shaded_sprites
                .iter()
                .zip(sprite_slots)
                .filter(|(s, _)| s.ui == ui)
                .filter_map(|(s, slot)| slot.as_ref().map(|slot| (s.index, s, slot)))
                .collect()
        };
        let world_runs = sprite_runs(false);
        let ui_runs = sprite_runs(true);
        let view_list: Vec<ModelInstance> = world_models.iter().map(|m| m.instance).collect();
        self.view_instances
            .write(&self.device, &self.queue, bytemuck::cast_slice(&view_list));
        // The sun's shadow pass takes what its own box (the light's view volume, depth included: the GPU clips by it) can
        // see, which is a different set from the camera's: a thing behind the camera can shadow the ground in front of it.
        // (opaque custom-shaded models cast shadows as plain ones do)
        let casters = || {
            input.models.iter().chain(
                input
                    .shaded_models
                    .iter()
                    .filter(|m| !m.blend)
                    .map(|m| &m.draw),
            )
        };
        // one list of casters per cascade (each is culled against its own box)
        let shadow_lists: Vec<Vec<ModelDraw>> = plans
            .iter()
            .map(|plan| {
                let light_planes = frustum_planes(&plan.vp);
                casters()
                    .filter(|m| match self.mesh(m.mesh) {
                        Some(mesh) => instance_visible(
                            &light_planes,
                            mesh.bounds,
                            mesh.skin.is_some(),
                            &m.instance.matrix,
                            lit.terrain.lift(),
                        ),
                        None => true,
                    })
                    .copied()
                    .collect()
            })
            .collect();
        let mut shadow_starts = Vec::new();
        if lit.shadows.is_some() {
            let mut instances: Vec<ModelInstance> = Vec::new();
            for list in &shadow_lists {
                shadow_starts.push(instances.len());
                instances.extend(list.iter().map(|m| m.instance));
            }
            self.model_instances
                .write(&self.device, &self.queue, bytemuck::cast_slice(&instances));
        }

        let mut stats = FrameStats {
            world_size,
            culled,
            shadow_culled: if lit.shadows.is_some() {
                (casters().count() - shadow_lists.first().map_or(0, Vec::len)) as u32
            } else {
                0
            },
            ..Default::default()
        };
        if let Some(t) = &mut self.gpu_timer {
            t.collect(&self.device);
            stats.gpu_ms = t.last_ms;
        }
        // time this frame only if the last reading has come back (the timer is one set of two slots)
        let timing = self.gpu_timer.as_ref().is_some_and(GpuTimer::idle);
        let shadow_pass = lit.shadows.is_some() && shadow_lists.iter().any(|l| !l.is_empty());
        let stamps = |begin: bool, end: bool| {
            self.gpu_timer
                .as_ref()
                .filter(|_| timing && (begin || end))
                .map(|t| wgpu::RenderPassTimestampWrites {
                    query_set: &t.queries,
                    beginning_of_pass_write_index: begin.then_some(0),
                    end_of_pass_write_index: end.then_some(1),
                })
        };
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("frame"),
            });
        // 2D effects: the light map and the mirror for the reflections, before the world is drawn
        let fx2d = input.lighting.fx2d.as_ref().map(|f| f.0.as_ref());
        if let Some(fx) = fx2d {
            stats.draw_calls +=
                self.fx2d
                    .encode_before(&mut encoder, fx, &self.sprite_view_group, &self.atlas);
        }
        for (cascade, shadow_models) in shadow_lists.iter().enumerate().filter(|_| shadow_pass) {
            let shadow_globals = match self.cascade_globals.get(cascade) {
                Some((_, group)) if plans.len() > 1 => group,
                _ => &self.globals_group,
            };
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("shadow pass"),
                color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.shadow_layers[cascade],
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: stamps(cascade == 0, false),
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.shadow_pipeline);
            pass.set_bind_group(0, shadow_globals, &[]);
            let mut skinned_now = false;
            let stride = std::mem::size_of::<ModelInstance>() as u64;
            let mut start = 0usize;
            while start < shadow_models.len() {
                let (mesh_id, casts) = (shadow_models[start].mesh, shadow_models[start].casts);
                let mut end = start;
                while end < shadow_models.len()
                    && shadow_models[end].mesh == mesh_id
                    && shadow_models[end].casts == casts
                {
                    end += 1;
                }
                let Some(mesh) = self.mesh(mesh_id) else {
                    start = end;
                    continue;
                };
                if casts && !mesh.translucent {
                    if mesh.skin.is_some() != skinned_now {
                        skinned_now = mesh.skin.is_some();
                        if skinned_now {
                            pass.set_pipeline(&self.skinned_shadow_pipeline);
                            pass.set_bind_group(1, &self.joint_group, &[]);
                        } else {
                            pass.set_pipeline(&self.shadow_pipeline);
                        }
                        pass.set_bind_group(0, shadow_globals, &[]);
                    }
                    if let Some(skin) = &mesh.skin {
                        pass.set_vertex_buffer(2, skin.slice(..));
                    }
                    pass.set_vertex_buffer(0, mesh.vertices.slice(..));
                    pass.set_vertex_buffer(
                        1,
                        self.model_instances.buffer.slice(
                            (shadow_starts[cascade] + start) as u64 * stride
                                ..(shadow_starts[cascade] + end) as u64 * stride,
                        ),
                    );
                    pass.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..mesh.index_count, 0, 0..(end - start) as u32);
                    stats.draw_calls += 1;
                }
                start = end;
            }
        }
        {
            let depth_view = &self.depth.as_ref().expect("depth exists").0;
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("world pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: match (&self.msaa, separate) {
                        (Some(m), true) => &m.colour,
                        (_, true) => &self.world.as_ref().expect("world target exists").view,
                        (_, false) => target,
                    },
                    depth_slice: None,
                    resolve_target: self
                        .msaa
                        .as_ref()
                        .filter(|_| separate)
                        .map(|_| &self.world.as_ref().expect("world target exists").view),
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: input.clear[0],
                            g: input.clear[1],
                            b: input.clear[2],
                            a: input.clear[3],
                        }),
                        // (the samples are only wanted for the resolve into the world target)
                        store: if self.msaa.is_some() {
                            wgpu::StoreOp::Discard
                        } else {
                            wgpu::StoreOp::Store
                        },
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: if look.reads_depth() {
                            wgpu::StoreOp::Store // the finishing pass reads it
                        } else {
                            wgpu::StoreOp::Discard
                        },
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: stamps(!shadow_pass, false),
                occlusion_query_set: None,
                multiview_mask: None,
            });

            let draw_sprites = |pass: &mut wgpu::RenderPass<'_>,
                                pipeline: &wgpu::RenderPipeline,
                                buffer: &DynBuffer,
                                count: usize|
             -> u32 {
                if count == 0 {
                    return 0;
                }
                pass.set_pipeline(pipeline);
                pass.set_bind_group(0, &self.sprite_view_group, &[]);
                pass.set_bind_group(1, &self.atlas, &[]);
                pass.set_vertex_buffer(0, buffer.buffer.slice(..));
                pass.draw(0..6, 0..count as u32);
                count as u32
            };
            if lit.sky.is_some() {
                pass.set_pipeline(&self.sky_pipeline);
                pass.set_bind_group(0, &self.globals_group, &[]);
                pass.draw(0..3, 0..1);
                stats.draw_calls += 1;
            }
            if let Some(fx) = fx2d {
                stats.draw_calls += self.fx2d.draw_world(
                    self,
                    &mut pass,
                    fx,
                    input.sprites_back.len(),
                    &world_runs,
                );
                stats.sprites += input.sprites_back.len() as u32;
            } else if world_runs.is_empty() {
                let back = draw_sprites(
                    &mut pass,
                    &self.sprite_pipeline,
                    &self.sprites_back,
                    input.sprites_back.len(),
                );
                stats.draw_calls += u32::from(back > 0);
                stats.sprites += back;
            } else {
                stats.draw_calls += self.draw_sprite_runs(
                    &mut pass,
                    &self.sprite_pipeline,
                    &self.sprites_back,
                    input.sprites_back.len(),
                    &world_runs,
                    custom::Variant::SpriteWorld,
                );
                stats.sprites += input.sprites_back.len() as u32;
            }

            for translucent in [false, true] {
                if world_models.is_empty() && shaded_models.is_empty() {
                    break;
                }
                pass.set_pipeline(if translucent {
                    &self.mesh_blend_pipeline
                } else {
                    &self.mesh_pipeline
                });
                pass.set_bind_group(0, &self.globals_group, &[]);
                pass.set_bind_group(2, &self.shadow_group, &[]);
                let mut skinned_now = false;
                let mut material_now = false;
                let mut detail_now = false;
                let stride = std::mem::size_of::<ModelInstance>() as u64;
                let mut start = 0usize;
                while start < world_models.len() {
                    let mesh_id = world_models[start].mesh;
                    let mut end = start;
                    while end < world_models.len() && world_models[end].mesh == mesh_id {
                        end += 1;
                    }
                    let Some(mesh) = self.mesh(mesh_id) else {
                        start = end;
                        continue;
                    };
                    // (skinned meshes are always solid)
                    if mesh.translucent != translucent {
                        start = end;
                        continue;
                    }
                    // (a detail picture is for a solid, unskinned mesh in the plain look)
                    let detail = mesh
                        .detail
                        .as_ref()
                        .filter(|_| mesh.skin.is_none() && mesh.material.is_none() && !translucent);
                    if mesh.skin.is_some() != skinned_now
                        || mesh.material.is_some() != material_now
                        || detail.is_some() != detail_now
                    {
                        skinned_now = mesh.skin.is_some();
                        material_now = mesh.material.is_some();
                        detail_now = detail.is_some();
                        let x = &self.extras;
                        pass.set_pipeline(match (skinned_now, material_now) {
                            (false, false) if detail_now => &x.detail_pipeline,
                            (true, false) => &self.skinned_pipeline,
                            (true, true) => &x.skinned_material_pipeline,
                            (false, true) if translucent => &x.material_blend_pipeline,
                            (false, true) => &x.material_pipeline,
                            (false, false) if translucent => &self.mesh_blend_pipeline,
                            (false, false) => &self.mesh_pipeline,
                        });
                        pass.set_bind_group(0, &self.globals_group, &[]);
                        pass.set_bind_group(2, &self.shadow_group, &[]);
                        if skinned_now && !material_now {
                            pass.set_bind_group(3, &self.joint_group, &[]);
                        }
                    }
                    if let Some(skin) = &mesh.skin {
                        pass.set_vertex_buffer(2, skin.slice(..));
                    }
                    if let Some(detail) = detail {
                        pass.set_bind_group(3, detail, &[]);
                    }
                    if let Some(material) = &mesh.material {
                        // (its maps, with the joint palette, are group 3; its tangents and factors follow the other buffers)
                        pass.set_bind_group(3, &material.group, &[]);
                        let slot = if mesh.skin.is_some() { 3 } else { 2 };
                        pass.set_vertex_buffer(slot, material.buffer.slice(..));
                    }
                    pass.set_bind_group(1, &mesh.texture, &[]);
                    pass.set_vertex_buffer(0, mesh.vertices.slice(..));
                    pass.set_vertex_buffer(
                        1,
                        self.view_instances
                            .buffer
                            .slice(start as u64 * stride..end as u64 * stride),
                    );
                    pass.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..mesh.index_count, 0, 0..(end - start) as u32);
                    stats.draw_calls += 1;
                    stats.triangles += mesh.index_count / 3 * (end - start) as u32;
                    start = end;
                }
                if !shaded_models.is_empty() {
                    let (calls, triangles) = self.draw_shaded_models(
                        &mut pass,
                        &shaded_models,
                        model_slots,
                        translucent,
                    );
                    stats.draw_calls += calls;
                    stats.triangles += triangles;
                }
            }
            if fx2d.is_some() {
                stats.draw_calls += self.fx2d.draw_rain(self, &mut pass);
            }
        }
        if let (Some(m), true) = (&self.msaa, look.reads_depth()) {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("depth resolve"),
                color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &m.resolved,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.depth_resolve_pipeline);
            pass.set_bind_group(0, &m.depth_samples, &[]);
            pass.draw(0..3, 0..1);
            stats.draw_calls += 1;
        }
        let post_drawn = match (&input.post, post_slot) {
            (Some(post), Some(slot)) if separate => {
                let drawn = self.draw_post(&mut encoder, post, slot);
                stats.draw_calls += u32::from(drawn);
                drawn
            }
            _ => false,
        };
        {
            // UI pass: always at native resolution, after the (possibly upscaled) world.
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("ui pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: if separate {
                            wgpu::LoadOp::Clear(wgpu::Color::BLACK)
                        } else {
                            wgpu::LoadOp::Load
                        },
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: stamps(false, true),
                occlusion_query_set: None,
                multiview_mask: None,
            });
            if separate {
                pass.set_pipeline(&self.blit_pipeline);
                pass.set_bind_group(0, &self.blit_group, &[]);
                let picture = if post_drawn {
                    &self
                        .extras
                        .post_target
                        .as_ref()
                        .expect("post target exists")
                        .group
                } else {
                    &self.world.as_ref().expect("world target exists").group
                };
                pass.set_bind_group(1, picture, &[]);
                pass.set_bind_group(2, self.depth_group.as_ref().expect("depth exists"), &[]);
                pass.draw(0..3, 0..1);
                stats.draw_calls += 1;
            }
            if !ui_runs.is_empty() {
                stats.draw_calls += self.draw_sprite_runs(
                    &mut pass,
                    &self.sprite_ui_pipeline,
                    &self.sprites_front,
                    input.sprites_front.len(),
                    &ui_runs,
                    custom::Variant::SpriteUi,
                );
                stats.sprites += input.sprites_front.len() as u32;
            } else if !input.sprites_front.is_empty() {
                pass.set_pipeline(&self.sprite_ui_pipeline);
                pass.set_bind_group(0, &self.sprite_view_group, &[]);
                pass.set_bind_group(1, &self.atlas, &[]);
                pass.set_vertex_buffer(0, self.sprites_front.buffer.slice(..));
                pass.draw(0..6, 0..input.sprites_front.len() as u32);
                stats.draw_calls += 1;
                stats.sprites += input.sprites_front.len() as u32;
            }
            if !input.ui_models.is_empty() {
                let stride = std::mem::size_of::<ModelInstance>() as u64;
                let mut start = 0usize;
                while start < input.ui_models.len() {
                    let mesh_id = input.ui_models[start].mesh;
                    let mut end = start;
                    while end < input.ui_models.len() && input.ui_models[end].mesh == mesh_id {
                        end += 1;
                    }
                    if let Some(mesh) = self.mesh(mesh_id).filter(|m| m.skin.is_none()) {
                        pass.set_pipeline(&self.ui_mesh_pipeline);
                        pass.set_bind_group(0, &self.ui_globals_group, &[]);
                        pass.set_bind_group(1, &mesh.texture, &[]);
                        pass.set_bind_group(2, &self.shadow_group, &[]);
                        pass.set_vertex_buffer(0, mesh.vertices.slice(..));
                        pass.set_vertex_buffer(
                            1,
                            self.ui_instances
                                .buffer
                                .slice(start as u64 * stride..end as u64 * stride),
                        );
                        pass.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
                        pass.draw_indexed(0..mesh.index_count, 0, 0..(end - start) as u32);
                        stats.draw_calls += 1;
                        stats.triangles += mesh.index_count / 3 * (end - start) as u32;
                    }
                    start = end;
                }
            }
            if !input.text.is_empty() {
                pass.set_pipeline(&self.text_pipeline);
                pass.set_bind_group(0, &self.sprite_view_group, &[]);
                pass.set_bind_group(1, &self.glyph_group, &[]);
                pass.set_vertex_buffer(0, self.sprites_text.buffer.slice(..));
                pass.draw(0..6, 0..input.text.len() as u32);
                stats.draw_calls += 1;
                stats.sprites += input.text.len() as u32;
            }
        }
        if let (true, Some(t)) = (timing, &self.gpu_timer) {
            encoder.resolve_query_set(&t.queries, 0..2, &t.resolve, 0);
            encoder.copy_buffer_to_buffer(&t.resolve, 0, &t.readback, 0, 16);
        }
        self.queue.submit([encoder.finish()]);
        if let (true, Some(t)) = (timing, &self.gpu_timer) {
            t.request();
        }
        stats
    }

    /// Renders one frame offscreen and returns tightly packed RGBA8 pixels.
    pub fn capture(&mut self, size: (u32, u32), input: &FrameInput) -> Vec<u8> {
        self.capture_with_stats(size, input).0
    }

    /// [`Gfx::capture`], and what the frame drew (draw calls, triangles, how many draws were culled).
    pub fn capture_with_stats(
        &mut self,
        size: (u32, u32),
        input: &FrameInput,
    ) -> (Vec<u8>, FrameStats) {
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("capture"),
            size: wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let stats = self.render(&view, size, input);
        let row_bytes = size.0 * 4;
        let padded = row_bytes.div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)
            * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let readback = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: (padded * size.1) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("capture copy"),
            });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &readback,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded),
                    rows_per_image: Some(size.1),
                },
            },
            wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit([encoder.finish()]);
        let slice = readback.slice(..);
        slice.map_async(wgpu::MapMode::Read, |result| result.expect("map readback"));
        self.device
            .poll(wgpu::PollType::wait_indefinitely())
            .expect("poll");
        let mapped = slice.get_mapped_range().expect("mapped range");
        let mut pixels = Vec::with_capacity((row_bytes * size.1) as usize);
        for row in mapped.chunks(padded as usize).take(size.1 as usize) {
            pixels.extend_from_slice(&row[..row_bytes as usize]);
        }
        (pixels, stats)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn things_outside_the_view_are_culled_and_big_or_scaled_ones_that_reach_in_are_not() {
        use super::{frustum_planes, instance_visible};
        // (dirt rides in the matrix's last slot: a clean instance keeps its 1, and the number is whole, so a float carries it exactly)
        let clean = super::ModelInstance {
            matrix: glam::Mat4::IDENTITY.to_cols_array_2d(),
            tint: [1.0; 4],
        };
        assert_eq!(clean.dirty(0.0, [1.0; 3], true).matrix[3][3], 1.0);
        let w = clean.dirty(1.0, [1.0, 0.0, 1.0], true).matrix[3][3];
        let code = (w - 2.0) as u32;
        assert_eq!(code as f32 + 2.0, w);
        assert_eq!(
            (
                code & 127,
                (code >> 7) & 1,
                (code >> 8) & 31,
                (code >> 13) & 31,
                (code >> 18) & 31
            ),
            (127, 1, 31, 0, 31)
        );
        assert_eq!(clean.dirty(0.5, [0.0; 3], false).matrix[3][3], 2.0 + 64.0);
        // a camera at z = 5 looking down -z, 60 degrees tall, square
        let view_proj =
            glam::camera::rh::proj::directx::perspective(60f32.to_radians(), 1.0, 0.1, 400.0)
                * glam::camera::rh::view::look_at_mat4(
                    Vec3::new(0.0, 0.0, 5.0),
                    Vec3::ZERO,
                    Vec3::Y,
                );
        let planes = frustum_planes(&view_proj);
        let at = |x: f32, y: f32, z: f32, scale: f32| {
            glam::Mat4::from_scale_rotation_translation(
                Vec3::splat(scale),
                glam::Quat::IDENTITY,
                Vec3::new(x, y, z),
            )
            .to_cols_array_2d()
        };
        let unit = ([0.0, 0.0, 0.0], 1.0);
        assert!(
            instance_visible(&planes, unit, false, &at(0.0, 0.0, 0.0, 1.0), 0.0),
            "straight ahead"
        );
        assert!(
            !instance_visible(&planes, unit, false, &at(0.0, 0.0, 50.0, 1.0), 0.0),
            "behind the camera"
        );
        assert!(
            !instance_visible(&planes, unit, false, &at(0.0, 0.0, -500.0, 1.0), 0.0),
            "past the far plane"
        );
        assert!(
            !instance_visible(&planes, unit, false, &at(100.0, 0.0, 0.0, 1.0), 0.0),
            "far to the side"
        );
        assert!(
            !instance_visible(&planes, unit, false, &at(0.0, 100.0, 0.0, 1.0), 0.0),
            "far above"
        );
        assert!(
            instance_visible(&planes, unit, false, &at(100.0, 0.0, 0.0, 120.0), 0.0),
            "scaled up so that it reaches into the view"
        );
        // just outside the edge, but its radius reaches over it
        let edge = 5.0 * (30f32.to_radians()).tan(); // half the view's width at the origin's distance
        assert!(instance_visible(
            &planes,
            unit,
            false,
            &at(edge + 0.5, 0.0, 0.0, 1.0),
            0.0
        ));
        assert!(!instance_visible(
            &planes,
            unit,
            false,
            &at(edge + 1.5, 0.0, 0.0, 1.0),
            0.0
        ));
        // a skinned mesh is allowed half as much again for limbs that swing out
        assert!(!instance_visible(
            &planes,
            unit,
            false,
            &at(edge + 1.3, 0.0, 0.0, 1.0),
            0.0
        ));
        assert!(instance_visible(
            &planes,
            unit,
            true,
            &at(edge + 1.3, 0.0, 0.0, 1.0),
            0.0
        ));
    }

    use super::*;

    #[test]
    fn mip_levels_halve_and_keep_atlas_tiles_apart_down_to_the_last() {
        // a 32 x 32 atlas of two 16-pixel tiles: red and opaque on the left, see-through on the right
        let mut rgba = vec![0u8; 32 * 32 * 4];
        for y in 0..32 {
            for x in 0..16 {
                rgba[(y * 32 + x) * 4..(y * 32 + x) * 4 + 4].copy_from_slice(&[255, 0, 0, 255]);
            }
        }
        let image = Image {
            width: 32,
            height: 32,
            rgba,
        };
        let chain = mip_chain(&image, 5);
        assert_eq!(chain.len(), (32 * 32 + 16 * 16 + 8 * 8 + 4 * 4 + 2 * 2) * 4);
        let last = &chain[(32 * 32 + 16 * 16 + 8 * 8 + 4 * 4) * 4..];
        assert_eq!(
            &last[..4],
            &[255, 0, 0, 255],
            "the left tile is still pure red"
        );
        assert_eq!(last[7], 0, "the right tile is still see-through");
    }
}
