// Low-poly meshes: one directional light, flat ambient, point lights, palette/base-colour texture, per-vertex glow.
struct Globals {
    view_proj: mat4x4<f32>,
    light_dir: vec4<f32>,      // xyz: direction the light travels, w: point light count
    light_color: vec4<f32>,
    ambient: vec4<f32>,
    point_pos: array<vec4<f32>, 20>,   // xyz position, w radius
    point_color: array<vec4<f32>, 20>,
    inv_view_proj: mat4x4<f32>,
    eye: vec4<f32>,
    sky_top: vec4<f32>,
    sky_horizon: vec4<f32>,
    fog_color: vec4<f32>,   // w: 1 when there is fog
    fog_range: vec4<f32>,   // x: start, y: complete
    light_view_proj: mat4x4<f32>,
    shadow: vec4<f32>,      // x: 1 when on, y: one texel, z: bias, w: how dark
    voxel: vec4<f32>,       // x: how bright the sky's light is (voxel meshes); y: bands of toon light (0: smooth)
    sky_sun: vec4<f32>,
    sky_extra: vec4<f32>,
    wind: vec4<f32>,        // xy: the way the wind blows (unit), z: how strong (0: none), w: the time
    point_dir: array<vec4<f32>, 20>,   // xyz: the way a spot light points (zero: every way), w: cosine of half its cone
    terrain: array<vec4<f32>, 9>,      // [0].x: how many hill waves; then (kx, kz, amplitude, phase) each
    terrain_map: array<vec4<f32>, 2>,  // [0]: x0, z0, 1 / cell; [1]: samples across - 1, rows - 1
    cascade_vp: array<mat4x4<f32>, 3>,  // the sun's shadow maps, nearest first (cascades, or the near map and the wide one)
    cascade_info: array<vec4<f32>, 3>,  // x: where the map ends (distance along the view), y: depth bias, z: metres a texel spans, w: softness
    cascade_count: vec4<f32>,           // x: how many maps
    ground: vec4<f32>,                  // rgb: the land around as the light leaves it (its colour under the sun and the ambient light); w: 1 when the sky gave one
    see_through: vec4<f32>,             // `nova.see_through`: xyz the point kept in view, w the radius of the hole at that point (metres)
    see_through_opts: vec4<f32>,        // x: how far short of the point the hole stops (metres), y: how much is dropped (0: off), z: the height above its own base under which nothing is cut, w: within this many metres of the eye everything (above z) goes
    see_through_near: vec4<f32>,        // x: within this many metres of the eye everything (above z) is wholly gone (it fades in out to opts.w), y: how much of that near fade is on (it is independent of opts.y, the hole's)
};
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var heightmap: texture_2d<f32>;  // the heightmap (R32Float, metres); 1 x 1 when there is none
@group(1) @binding(0) var base_texture: texture_2d<f32>;
@group(1) @binding(1) var base_sampler: sampler;
@group(2) @binding(0) var shadow_map: texture_depth_2d_array;
@group(2) @binding(1) var shadow_sampler: sampler_comparison;

struct Vertex {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec4<f32>,
    @location(3) uv: vec2<f32>,
    @location(9) emissive: f32,
};

struct Instance {
    @location(4) m0: vec4<f32>,
    @location(5) m1: vec4<f32>,
    @location(6) m2: vec4<f32>,
    @location(7) m3: vec4<f32>,
    @location(8) tint: vec4<f32>,
};

// Wind: foliage (an instance with a sway weight in the w slot of its matrix's third column) bends with the wind, more the higher
// the vertex is above the instance's origin. A slow swell travels across the field along the wind, with a quicker flutter on it.
// Up in a tree (more than a metre above the origin and away from the trunk's axis) the leaves also flutter on their own: a small
// shaking of each vertex by where it is, so that a crown shimmers instead of leaning like a post.
fn wind_offset(origin: vec3<f32>, world: vec3<f32>, sway: f32) -> vec3<f32> {
    if (sway <= 0.0 || globals.wind.z == 0.0) {
        return vec3<f32>(0.0);
    }
    let h = max(world.y - origin.y, 0.0);
    let t = globals.wind.w;
    let strength = globals.wind.z;
    let phase = dot(origin.xz, globals.wind.xy) * 0.22;
    let swell = 0.55 + 0.45 * sin(t * 1.3 - phase);
    let flutter = sin(t * 5.1 + origin.x * 0.7 + origin.z * 0.9 + world.y * 2.0) * 0.12;
    let bend = sway * strength * h * (swell + flutter);
    var offset = vec3<f32>(globals.wind.x * bend, 0.0, globals.wind.y * bend);
    // leaves: how much of a crown this vertex is (high, and out from the trunk's axis)
    let radial = length(world.xz - origin.xz);
    let crown = smoothstep(1.0, 3.0, h) * smoothstep(0.25, 1.2, radial);
    if (crown > 0.0) {
        let a = t * 3.1 + world.x * 2.3 + world.z * 1.9 + world.y * 1.7;
        let shake = crown * strength * 0.07 * (0.6 + 0.4 * swell);
        offset = offset + shake * vec3<f32>(sin(a), 0.5 * sin(a * 1.3 + 1.0), sin(a + 2.1));
    }
    return offset;
}

// The w slot of the matrix's third column carries the sway and how the instance rides the hills (`ModelInstance::lift` in gfx.rs):
// `sway` (0 or more) lifted vertex by vertex, `-1 - sway` rigid, `-1000 - sway` upright.
fn sway_of(w: f32) -> f32 {
    if (w >= 0.0) { return w; }
    if (w > -999.5) { return -w - 1.0; }
    return -w - 1000.0;
}

// 0 vertex by vertex, 1 rigid, 2 upright
fn lift_mode(w: f32) -> i32 {
    if (w >= 0.0) { return 0; }
    if (w > -999.5) { return 1; }
    return 2;
}

// How much of the ground under the origin (rather than under the vertex) lifts a vertex `h` metres above the origin: rigid all of
// it; upright none at its foot, all of it from `UPRIGHT_FOOT` (gfx.rs, 0.6 m) up, so a tree stands on a slope with its crown level.
fn origin_share(mode: i32, h: f32) -> f32 {
    if (mode == 1) { return 1.0; }
    if (mode == 2) { return smoothstep(0.0, 0.6, h); }
    return 0.0;
}

// The ground's height that lifts a vertex: under it (k = 0), under the origin (k = 1) or between (only what is needed is read)
fn ground_lift(at: vec2<f32>, origin: vec2<f32>, k: f32) -> f32 {
    if (k <= 0.0) { return terrain_height(at); }
    if (k >= 1.0) { return terrain_height(origin); }
    return mix(terrain_height(at), terrain_height(origin), k);
}


// Hills: the ground's height as a sum of up to eight sine waves over the ground (`nova.terrain`): terrain[0].x is how many, terrain[1..]
// are (kx, kz, amplitude, phase). Every vertex is lifted by the height under it, so a flat model laid on the ground (a road piece, a
// car, a tree) follows the hills; things up in the sky (an instance whose origin is above 30 m: clouds) stay where they are.
// With a heightmap (terrain[0].y is 1) its bilinear height is added to the waves; outside the picture it keeps the nearest edge's height.
// Same maths as `HeightMap::height` in heightmap.rs.
fn terrain_active() -> bool {
    return globals.terrain[0].x > 0.0 || globals.terrain[0].y > 0.0;
}

fn map_height(p: vec2<f32>) -> f32 {
    let dims = globals.terrain_map[1].xy;
    let f = clamp((p - globals.terrain_map[0].xy) * globals.terrain_map[0].z, vec2<f32>(0.0), dims);
    let i = min(vec2<i32>(floor(f)), vec2<i32>(dims) - vec2<i32>(1));
    let t = f - vec2<f32>(i);
    let a = textureLoad(heightmap, i, 0).x;
    let b = textureLoad(heightmap, i + vec2<i32>(1, 0), 0).x;
    let c = textureLoad(heightmap, i + vec2<i32>(0, 1), 0).x;
    let d = textureLoad(heightmap, i + vec2<i32>(1, 1), 0).x;
    let top = a + (b - a) * t.x;
    let bottom = c + (d - c) * t.x;
    return top + (bottom - top) * t.y;
}

fn map_slope(p: vec2<f32>) -> vec2<f32> {
    let dims = globals.terrain_map[1].xy;
    let raw = (p - globals.terrain_map[0].xy) * globals.terrain_map[0].z;
    let f = clamp(raw, vec2<f32>(0.0), dims);
    let i = min(vec2<i32>(floor(f)), vec2<i32>(dims) - vec2<i32>(1));
    let t = f - vec2<f32>(i);
    let a = textureLoad(heightmap, i, 0).x;
    let b = textureLoad(heightmap, i + vec2<i32>(1, 0), 0).x;
    let c = textureLoad(heightmap, i + vec2<i32>(0, 1), 0).x;
    let d = textureLoad(heightmap, i + vec2<i32>(1, 1), 0).x;
    let inside = vec2<f32>(select(0.0, 1.0, raw.x > 0.0 && raw.x < dims.x), select(0.0, 1.0, raw.y > 0.0 && raw.y < dims.y));
    return inside * vec2<f32>(
        ((b - a) * (1.0 - t.y) + (d - c) * t.y) * globals.terrain_map[0].z,
        ((c - a) * (1.0 - t.x) + (d - b) * t.x) * globals.terrain_map[0].z);
}

fn terrain_height(p: vec2<f32>) -> f32 {
    let n = i32(globals.terrain[0].x);
    var h = 0.0;
    if (globals.terrain[0].y > 0.0) {
        h = map_height(p);
    }
    for (var i = 0; i < n; i = i + 1) {
        let w = globals.terrain[i + 1];
        h = h + w.z * sin(w.x * p.x + w.y * p.y + w.w);
    }
    return h;
}

// The slope of the ground there: d height / dx and d height / dz.
fn terrain_slope(p: vec2<f32>) -> vec2<f32> {
    let n = i32(globals.terrain[0].x);
    var g = vec2<f32>(0.0);
    if (globals.terrain[0].y > 0.0) {
        g = map_slope(p);
    }
    for (var i = 0; i < n; i = i + 1) {
        let w = globals.terrain[i + 1];
        g = g + w.z * cos(w.x * p.x + w.y * p.y + w.w) * vec2<f32>(w.x, w.y);
    }
    return g;
}

// A direction made unit length; a zero-length one (a degenerate face in a model file) stays zero. A plain normalize() of
// zero is NaN, which Metal quietly turns into "no sun" but Vulkan drivers carry through to black pixels.
fn safe_normalize(v: vec3<f32>) -> vec3<f32> {
    return v / max(length(v), 1e-6);
}

// Instance tints are sRGB values from scripts; the vertex colours stay linear (glTF).
fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    let low = c / 12.92;
    let high = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    return select(high, low, c <= vec3<f32>(0.04045));
}

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) color: vec4<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) world: vec3<f32>,
    @location(4) emissive: f32,
    // 0: solid; otherwise a screen-door fade (see `ModelInstance::dissolving`)
    @location(5) @interpolate(flat) dissolve: f32,
    // dirt on this draw, as the instance carries it (see `ModelInstance::dirty` and `dirt_of`): below 1.5 there is none
    @location(6) @interpolate(flat) dirt: f32,
    // xyz: the vertex in its piece's own space (dirt's blotches are fixed to it); w: metres above the model's base (its own origin)
    @location(7) local: vec4<f32>,
    // how the surface is painted (`paint_of`): 0 plain, 1 a tree's crown, 2 a mass of canopy, 3 ground, 4 running water, 5 boards, 6 roof tiles, 7 stone, 8 pine and larch bark, 9 birch bark, 10 rock
    @location(8) @interpolate(flat) paint: f32,
};

// ---- painted surfaces (docs/project-format.md, "Painted surfaces") ----
// A vertex says how its surface is painted in its `emissive` slot: the glow (0 to 1) plus 1000 times the kind (model.rs PAINT_STEP;
// a model's material says `extras.nova.paint`, a run-time mesh `nova.mesh.make { paint = ... }`). The kind changes the colour and
// the light of the plain look only: a tree's crown gets clumps, leaf strokes, a darker core and a lit rim; the ground soft patches of
// warmer and cooler green and brush strokes near the camera; water moving ripples, glints and foam. The patterns come from one small
// repeating picture of noise (gfx/paint.rs: four noises, 16 cells across, with mip levels) read a few times a pixel at different
// scales and slants, where the pixel is: in its own model's space for a crown (so the pattern sways with the tree), in the world for
// the ground and water. Its mip levels average a pattern away where it would be finer than a pixel, so nothing shimmers.
const PAINT_STEP: f32 = 1000.0;
@group(0) @binding(2) var paint_noise: texture_2d<f32>;
@group(0) @binding(3) var paint_sampler: sampler;

fn paint_of(emissive: f32) -> f32 {
    if (emissive < PAINT_STEP * 0.5) { return 0.0; }
    return floor((emissive + 0.5) / PAINT_STEP);
}

fn glow_of(emissive: f32) -> f32 {
    return emissive - paint_of(emissive) * PAINT_STEP;
}

// The noise picture through a linear map `m` (so `f` cells a metre along an axis is that axis times f / 16) plus `off`, with the
// point's own rate of change across the pixel (`gx`, `gy`: its derivatives, worked out before anything branched) for the mip level.
fn paint_read(p: vec2<f32>, gx: vec2<f32>, gy: vec2<f32>, m: mat2x2<f32>, off: vec2<f32>) -> vec4<f32> {
    return textureSampleGrad(paint_noise, paint_sampler, m * p + off, m * gx, m * gy);
}

// A map that reads `p` along `a` at `fa` cells a metre and along `b` at `fb` (a and b unit and square to each other).
fn paint_axes(a: vec2<f32>, b: vec2<f32>, fa: f32, fb: f32) -> mat2x2<f32> {
    let ka = fa / 16.0;
    let kb = fb / 16.0;
    return mat2x2<f32>(vec2<f32>(a.x * ka, b.x * kb), vec2<f32>(a.y * ka, b.y * kb));
}

// What a painted surface changes before it is lit: its colour and the normal the light sees, and how much the sun wraps round it
// (0: the plain look's light; more: softer, as felt or a mass of leaves takes it).
struct Painted {
    rgb: vec3<f32>,
    normal: vec3<f32>,
    wrap: f32,
    // light added on the side towards the sun at a slant (a crown's lit rim), times the sun's colour
    rim: f32,
    // added after the light: a glint or the sky in water, foam's own brightness
    extra: vec3<f32>,
};

// The ground: big soft patches (about 20 m and 7 m) of warmer and cooler green; dabs of lighter and of darker green (about 1.1 m
// long and 0.25 m wide) with soft but definite edges and finer blade streaks (about 0.45 by 0.1 m), laid along one of two directions,
// the two mixed by the big patches so the strokes lie one way here and another there. A dab's edge is never sharper than about two
// pixels (`edge`), and the strokes fade out where a dab would be under a few pixels wide (`footprint`, metres a pixel spans): the calm
// colour far off. Slopes that face the sun more than level ground are a little warmer and lighter, those turned away a little cooler.
fn paint_ground(rgb: vec3<f32>, world: vec3<f32>, n: vec3<f32>, gx: vec2<f32>, gy: vec2<f32>, footprint: f32) -> Painted {
    var o: Painted;
    let p = world.xz;
    let x = vec2<f32>(1.0, 0.0);
    let z = vec2<f32>(0.0, 1.0);
    let wide = paint_read(p, gx, gy, paint_axes(x, z, 0.045, 0.045), vec2<f32>(0.19, 0.48));
    let big = wide.r;
    let mid = paint_read(p, gx, gy, paint_axes(x, z, 0.14, 0.14), vec2<f32>(0.69, 0.31)).g;
    let patches = big * 0.62 + mid * 0.38;
    let warm = vec3<f32>(1.08, 1.03, 0.80);
    let cool = vec3<f32>(0.88, 0.98, 1.08);
    var c = rgb * mix(cool, warm, smoothstep(0.22, 0.78, patches)) * (0.9 + 0.2 * mid);
    // A ladder of three sizes of strokes (added 2026-11-23, the owner's seventh play: "The grass texture fades away too soon"): the
    // dabs (1.1 m), dabs three times their size (3.3 m by 0.75 m) and sweeps nine times their size (10 m by 2.2 m). Each fades out
    // where it would be under a few pixels wide and the next size is already there, so the painted look carries on out to 80 m and
    // more with no line where one size gives way. What decides is the pixel's size across the view (`fa`): the noise is read with
    // anisotropic filtering (gfx/paint.rs), which keeps a stroke whole when the ground is seen at a slant, up to 8 times as long as
    // it is wide; before, the pixel's length along the view decided, and the dabs were gone at about 20 m from the walking camera.
    let la = length(gx);
    let lb = length(gy);
    let fa = max(max(la, lb) * 0.125, min(la, lb));
    let a1 = vec2<f32>(0.8, 0.6);
    let b1 = vec2<f32>(-0.6, 0.8);
    let a2 = vec2<f32>(0.28, -0.96);
    let b2 = vec2<f32>(0.96, 0.28);
    let w = smoothstep(0.35, 0.65, big);
    var stroke = 0.0;
    let near = 1.0 - smoothstep(0.025, 0.07, fa);
    if (near > 0.0) {
        let edge = max(0.05, fa * 8.0);
        // (lighter dabs in the blue channel, darker ones in the alpha: two noises from one read)
        let s1 = paint_read(p, gx, gy, paint_axes(a1, b1, 0.9, 4.0), vec2<f32>(0.0, 0.0));
        let s2 = paint_read(p, gx, gy, paint_axes(a2, b2, 0.9, 4.0), vec2<f32>(0.43, 0.0));
        let lit = mix(s1.b, s2.b, w);
        let dim = mix(s1.a, s2.a, w);
        let dabs = smoothstep(0.6 - edge, 0.6 + edge, lit) * 0.13 - smoothstep(0.62 - edge, 0.62 + edge, dim) * 0.12;
        let fine = 1.0 - smoothstep(0.01, 0.025, fa);
        var blades = 0.0;
        if (fine > 0.0) {
            let f1 = paint_read(p, gx, gy, paint_axes(a1, b1, 2.2, 10.0), vec2<f32>(0.2, 0.7)).r;
            let f2 = paint_read(p, gx, gy, paint_axes(a2, b2, 2.2, 10.0), vec2<f32>(0.6, 0.1)).r;
            blades = (smoothstep(0.5 - edge * 2.0, 0.5 + edge * 2.0, mix(f1, f2, w)) - 0.5) * 0.09 * fine;
        }
        stroke = dabs * near + blades;
    }
    let near1 = 1.0 - smoothstep(0.08, 0.21, fa);
    if (near1 > 0.0) {
        let edge = max(0.05, fa * 2.7);
        let s1 = paint_read(p, gx, gy, paint_axes(a2, b2, 0.3, 1.33), vec2<f32>(0.71, 0.13));
        let s2 = paint_read(p, gx, gy, paint_axes(a1, b1, 0.3, 1.33), vec2<f32>(0.37, 0.59));
        let lit = mix(s1.b, s2.b, w);
        let dim = mix(s1.a, s2.a, w);
        let dabs = smoothstep(0.6 - edge, 0.6 + edge, lit) * 0.11 - smoothstep(0.62 - edge, 0.62 + edge, dim) * 0.10;
        stroke = stroke + dabs * near1 * mix(1.0, 0.6, near);
    }
    let near2 = 1.0 - smoothstep(0.25, 0.65, fa);
    if (near2 > 0.0) {
        let edge = max(0.05, fa * 0.9);
        let s = paint_read(p, gx, gy, paint_axes(a1, b1, 0.1, 0.45), vec2<f32>(0.53, 0.83));
        let dabs = smoothstep(0.6 - edge, 0.6 + edge, mix(s.b, s.r, w)) * 0.08 - smoothstep(0.62 - edge, 0.62 + edge, s.a) * 0.08;
        stroke = stroke + dabs * near2 * mix(1.0, 0.5, near1);
    }
    c = c * (1.0 + stroke) + vec3<f32>(0.010, 0.014, -0.004) * stroke * 4.0;
    // the sun's side of a slope: warmer and a little lighter; the far side: cooler
    let to_sun = safe_normalize(-globals.light_dir.xyz);
    let lean = dot(n, to_sun) - to_sun.y;
    c = c * mix(vec3<f32>(1.0), select(vec3<f32>(0.94, 0.97, 1.04), vec3<f32>(1.10, 1.06, 0.90), lean > 0.0), min(abs(lean) * 2.2, 1.0));
    o.rgb = c;
    o.normal = n;
    o.wrap = 0.0;
    o.rim = 0.0;
    o.extra = vec3<f32>(0.0);
    return o;
}

// A tree's crown (kind 1, round about its trunk) or a mass of canopy (kind 2, long along its model's x): `local` is the point in the
// model's own space (the pattern is fixed to the tree, so it does not swim as the tree sways; `lx`, `ly` its derivatives). The
// picture is two-dimensional, so a crown reads it on two slanted planes through its space and averages them: a pattern that changes
// whichever way the surface faces. Leaf clumps (about 0.7 m) bend the normal the light sees; leaf dabs (about 18 cm) break the
// colour; what faces in towards the trunk or down is darker (the crown's core), what faces out is lighter; the sun wraps softly round
// it and lights its rim.
fn paint_foliage(rgb: vec3<f32>, local: vec3<f32>, lx: vec3<f32>, ly: vec3<f32>, n: vec3<f32>, kind: f32) -> Painted {
    var o: Painted;
    // the way out of the crown here: away from the trunk's axis (a crown) or from the mass's long middle line (canopy)
    var out_dir = vec3<f32>(local.x, 0.0, local.z);
    if (kind > 1.5) {
        out_dir = vec3<f32>(0.0, 0.0, local.z);
    }
    let outward = dot(n.xz, safe_normalize(out_dir).xz) * min(length(out_dir) * 1.5, 1.0);
    // the two planes: x and z, each slanted by y
    let pa = local.xz + local.y * vec2<f32>(0.37, -0.61);
    let pax = lx.xz + lx.y * vec2<f32>(0.37, -0.61);
    let pay = ly.xz + ly.y * vec2<f32>(0.37, -0.61);
    let pb = local.zy + local.x * vec2<f32>(0.53, 0.29);
    let pbx = lx.zy + lx.x * vec2<f32>(0.53, 0.29);
    let pby = ly.zy + ly.x * vec2<f32>(0.53, 0.29);
    let i2 = mat2x2<f32>(vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0));
    // clumps: three noises a direction, from both planes
    let c1 = paint_read(pa, pax, pay, i2 * (1.35 / 16.0), vec2<f32>(0.11, 0.57));
    let c2 = paint_read(pb, pbx, pby, i2 * (1.35 / 16.0), vec2<f32>(0.73, 0.29));
    let bend = (c1.rgb + c2.gbr) - vec3<f32>(1.0);
    let bn = safe_normalize(n + bend * 0.9);
    // the core: in-facing and under sides darker, out-facing tops lighter
    let core = smoothstep(-0.7, 0.8, outward * 0.75 + n.y * 0.55 + 0.15);
    var c = rgb * mix(0.62, 1.08, core);
    // leaf dabs: lighter and darker leaf with soft but definite edges (never sharper than about two pixels, `edge`), averaged away by
    // the mip levels where a dab is under a pixel
    let d1 = paint_read(pa, pax, pay, i2 * (5.5 / 16.0), vec2<f32>(0.37, 0.05));
    let d2 = paint_read(pb, pbx, pby, i2 * (5.5 / 16.0), vec2<f32>(0.91, 0.62));
    let edge = clamp((length(lx) + length(ly)) * 5.5 * 1.2, 0.05, 0.5);
    let lit = (d1.a + d2.a) * 0.5;
    let dim = (d1.b + d2.r) * 0.5;
    c = c * (1.0 + smoothstep(0.56 - edge, 0.56 + edge, lit) * 0.2 - smoothstep(0.58 - edge, 0.58 + edge, dim) * 0.17);
    // a slow mottle of warmer and cooler greens across the crown
    let mottle = c1.a;
    c = c * (0.92 + 0.16 * mottle) * mix(vec3<f32>(0.97, 1.0, 1.04), vec3<f32>(1.04, 1.02, 0.92), mottle);
    o.rgb = c;
    o.normal = bn;
    o.wrap = 0.45;
    o.rim = 0.32 * core;
    o.extra = vec3<f32>(0.0);
    return o;
}

// Running water: `flow` is the point's (metres across, metres downstream) from the mesh's UVs (`fx`, `fy` its derivatives);
// `depth_in` (0 to 1) its colour's alpha, how deep it is there. Ripples stretched along the flow move downstream; the sky shows in
// them at a slant, the sun glints on them; the shallows are lighter and foam gathers along the waterline (a mesh makes a place shallow
// to put foam there: round a post).
fn paint_water(rgb: vec3<f32>, world: vec3<f32>, flow: vec2<f32>, fx: vec2<f32>, fy: vec2<f32>, depth_in: f32, footprint: f32) -> Painted {
    var o: Painted;
    let t = globals.wind.w;
    let calm = 1.0 - smoothstep(0.05, 0.25, footprint);
    let x = vec2<f32>(1.0, 0.0);
    let z = vec2<f32>(0.0, 1.0);
    // (the time moves the reading downstream: `off` carries it, so the derivatives stay the flow's own)
    let w1 = paint_read(flow, fx, fy, paint_axes(x, z, 1.3, 0.42), vec2<f32>(0.0, -t * 0.55 * 0.42 / 16.0));
    let w2 = paint_read(flow, fx, fy, paint_axes(x, z, 2.6, 0.9), vec2<f32>(0.25, -t * 0.95 * 0.9 / 16.0));
    let r1 = w1.r;
    let r2 = w2.a;
    let wave = r1 * 0.6 + r2 * 0.4;
    // the ripples' slope: the other two noises of the first read, the across one stronger (ripples lie across the flow)
    let n = safe_normalize(vec3<f32>((w1.g - 0.5) * 0.9 * calm, 1.0, (w1.b - 0.5) * 0.5 * calm));
    var c = rgb * (0.96 + 0.22 * (wave - 0.5) * calm);
    // how deep it is here (the mesh's alpha: 0 is 0.2 m above the bed, 1 is 0.6 m deep or more): lighter and a little warmer where
    // the bed comes up, and a line of foam where it meets the bank, broken by the ripples
    let depth = depth_in * 0.8 - 0.2;
    let shallow = 1.0 - smoothstep(0.0, 0.32, depth);
    c = mix(c * 0.9, c * vec3<f32>(1.2, 1.18, 1.02) + vec3<f32>(0.03, 0.03, 0.0), shallow * 0.6);
    let shore = 1.0 - smoothstep(0.015, 0.1, depth);
    let foam = smoothstep(0.38, 0.72, shore * 0.9 + (r2 - 0.5) * 0.8 * calm + (r1 - 0.5) * 0.35);
    let v = safe_normalize(globals.eye.xyz - world);
    let fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
    var sky = globals.ambient.rgb * 1.4;
    if (globals.sky_top.w > 0.5) {
        sky = mix(globals.sky_horizon.rgb, globals.sky_top.rgb, 0.35);
    }
    let to_sun = safe_normalize(-globals.light_dir.xyz);
    let h = safe_normalize(v + to_sun);
    let glint = pow(max(dot(n, h), 0.0), 120.0) * 0.9 * calm;
    let streak = smoothstep(0.6, 0.85, wave) * 0.25 * calm;
    o.extra = sky * (fres * 0.3 + streak * 0.45) + globals.light_color.rgb * glint;
    o.rgb = mix(c, vec3<f32>(0.84, 0.88, 0.86), foam * 0.8);
    o.extra = o.extra * (1.0 - foam);
    o.normal = vec3<f32>(0.0, 1.0, 0.0);
    o.wrap = 0.0;
    o.rim = 0.0;
    return o;
}

// The dirt an instance carries in the w slot of its matrix's fourth column (1 in a clean one; negated when the draw is never cut by
// `nova.see_through`): 2 + a whole number of 23 bits, which
// are how much (7), whether it lies on top (1) and its colour (5 each, sRGB). Unpacked by the pixels that have some: rgb the colour
// (linear), w how much (to 1), plus 2 when it lies on top too (snow).
fn dirt_of(w: f32) -> vec4<f32> {
    let c = u32(w - 1.5);
    let rgb = vec3<f32>(f32((c >> 8u) & 31u), f32((c >> 13u) & 31u), f32((c >> 18u) & 31u)) / 31.0;
    return vec4<f32>(srgb_to_linear(rgb), f32(c & 127u) / 127.0 + 2.0 * f32((c >> 7u) & 1u));
}

// How much of a pixel is under the dirt of its draw (0 to 1), with no picture: it is thrown up from the ground, so it is thick at the
// foot of the model and its edge climbs as it builds up (further at the tail, -z), broken by soft blotches fixed to the model, with
// spatter above the edge and a thin film of dust over the rest; dirt that lies on top (snow) also settles on what faces up.
fn dirt_cover(local: vec4<f32>, n: vec3<f32>, d: f32, far: f32) -> f32 {
    let top = step(1.5, d);
    let amount = d - 2.0 * top;
    let p = local.xyz;
    let blot = 0.6 * sin(p.z * 5.3 + p.y * 3.1) * sin(p.x * 4.7 - p.y * 6.3 + 1.7) + 0.4 * sin(p.z * 13.1 - p.x * 9.7 + p.y * 11.3);
    // (at its most the edge is about 0.6 m up, 0.9 m at the tail: the sills, the arches and the rear, not the roof; it climbs fast at
    // first and slower after, as the square root of the amount)
    let reach = sqrt(amount) * (0.62 + 0.3 * smoothstep(0.0, -1.8, p.z));
    let ragged = blot + 0.5 * sin(p.z * 31.0 + p.y * 23.0 + blot * 4.0) * sin(p.x * 27.0 - p.y * 37.0);
    let level = (reach - local.w) * 2.6 + ragged * 0.6 * amount;
    var cover = 0.92 * smoothstep(0.0, 1.0, level);
    // spatter: a round dot of a few centimetres in some of the cells of a 5 cm grid, each where and as big as its cell's own random
    // number says; more of them near the edge (none far away, where they would be smaller than a pixel and flicker)
    let g = p * 21.0;
    let cell = floor(g);
    let r1 = fract(sin(dot(cell, vec3<f32>(12.9898, 78.233, 37.719))) * 43758.5453);
    let r2 = fract(r1 * 57.31);
    let r3 = fract(r1 * 113.7);
    let off = length(g - cell - vec3<f32>(0.3) - 0.4 * vec3<f32>(r2, r3, fract(r1 * 271.9)));
    let size = 0.1 + 0.2 * r3;
    let chance = amount * smoothstep(-2.6, 0.3, level) * (1.0 - far);
    cover = max(cover, 0.8 * step(r1, 0.75 * chance) * (1.0 - smoothstep(size * 0.6, size, off)));
    cover = max(cover, 0.2 * amount * smoothstep(1.5, 0.3, local.w));
    let lie = top * smoothstep(0.35, 0.8, n.y + blot * 0.12) * smoothstep(0.1, 0.9, amount + ragged * 0.12);
    return clamp(max(cover, lie), 0.0, 1.0);
}

@vertex
fn vs_main(v: Vertex, inst: Instance) -> VertexOut {
    return mesh_vertex(v, inst);
}

// (vs_main's work, shared with the material and custom-shader entry points)
fn mesh_vertex(v: Vertex, inst: Instance) -> VertexOut {
    // (an instance's matrix is affine; the slots that are always 0 or 1 carry other things: see `ModelInstance`)
    let model = mat4x4<f32>(vec4<f32>(inst.m0.xyz, 0.0), vec4<f32>(inst.m1.xyz, 0.0), vec4<f32>(inst.m2.xyz, 0.0), vec4<f32>(inst.m3.xyz, 1.0));
    var out: VertexOut;
    out.dissolve = inst.m1.w;
    out.dirt = inst.m3.w;
    var world = model * vec4<f32>(v.position, 1.0);
    // how high the vertex is above the model's base: a piece drawn on its own (a wheel) says how far below its origin that is (m0.w)
    out.local = vec4<f32>(v.position, (world.y - inst.m3.y - inst.m0.w) / max(length(inst.m1.xyz), 1e-6));
    let mode = lift_mode(inst.m2.w);
    let above = world.y - inst.m3.y;
    world = vec4<f32>(world.xyz + wind_offset(inst.m3.xyz, world.xyz, sway_of(inst.m2.w)), 1.0);
    var normal = select(safe_normalize((model * vec4<f32>(v.normal, 0.0)).xyz), v.normal, v.emissive < 0.0);
    if (terrain_active() && inst.m3.y < 30.0) {
        if (mode == 1) {
            // rigid (see `ModelInstance::rigid`): one height for the whole model, no shear, the normal is left as the game turned it
            world = vec4<f32>(world.x, world.y + terrain_height(inst.m3.xz), world.z, 1.0);
        } else {
            // on the hills: lifted by the ground's height, and the normal leans with its slope (the shear's inverse transpose); an
            // upright model (a tree) only at its foot: above that it rises with the ground under its origin and stays level
            let k = origin_share(mode, above);
            world = vec4<f32>(world.x, world.y + ground_lift(world.xz, inst.m3.xz, k), world.z, 1.0);
            if (v.emissive >= 0.0 && k < 1.0) {
                let g = terrain_slope(world.xz) * (1.0 - k);
                normal = safe_normalize(vec3<f32>(normal.x - g.x * normal.y, normal.y, normal.z - g.y * normal.y));
            }
        }
    }
    out.world = world.xyz;
    out.position = globals.view_proj * world;
    out.normal = normal;
    out.color = v.color * vec4<f32>(srgb_to_linear(inst.tint.rgb), inst.tint.a);
    out.uv = v.uv;
    out.emissive = glow_of(v.emissive);
    out.paint = paint_of(v.emissive);
    return out;
}

// What one shadow map says about a clip-space point: how much light reaches it (3x3 taps of hardware-filtered comparisons, a soft
// edge about four texels wide, times the game's `softness`), or -1 when the point is outside the map or beyond the light's far
// plane. (The "level" sampling has no derivatives, so it can sit in non-uniform control flow, as the choice of map is.)
fn shadow_lookup(clip: vec4<f32>, layer: i32, bias: f32) -> f32 {
    let uv = vec2<f32>(clip.x * 0.5 + 0.5, 0.5 - clip.y * 0.5);
    let depth = clip.z - bias;
    var lit = 0.0;
    for (var x = -1; x <= 1; x = x + 1) {
        for (var y = -1; y <= 1; y = y + 1) {
            let o = vec2<f32>(f32(x), f32(y)) * globals.shadow.y;
            lit = lit + textureSampleCompareLevel(shadow_map, shadow_sampler, uv + o, layer, depth);
        }
    }
    lit = lit / 9.0;
    let inside = uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 && clip.z > 0.0 && clip.z < 1.0;
    return select(-1.0, lit, inside);
}

// One map's answer for a point. The point is pushed off its surface along the normal by what keeps the surface from shadowing
// itself: half a texel, and as much again as the filter's taps reach sideways (a texel and a half, times the softness, and the
// half texel the map's own steps add) times how slanted the surface is to the sun (the sine of the angle between them): a surface
// facing the sun needs almost nothing, one the light grazes the whole reach. Together with the small depth bias (half a texel,
// see `CascadePlan`) that is a few centimetres in the near map, so a shadow starts where its caster touches the ground.
fn cascade_visibility(i: i32, world: vec3<f32>, normal: vec3<f32>) -> f32 {
    let info = globals.cascade_info[i];
    let to_sun = -globals.light_dir.xyz;
    let c = min(abs(dot(normal, to_sun)) / max(length(to_sun), 1e-6), 1.0);
    let slant = sqrt(1.0 - c * c);
    let p = world + normal * info.z * (0.5 + (1.5 * info.w + 0.5) * slant);
    let r = shadow_lookup(globals.cascade_vp[i] * vec4<f32>(p, 1.0), i, info.y);
    return select(1.0, r, r >= 0.0);
}

// How much of the sun reaches a point: 1 in the open, less in a shadow. The nearest map that holds the point is used (cascades, or
// the fine near map and then the wide one), and the shadow is blended between two maps near where one ends, and fades out at the
// end of the last cascade (the wide map has no end: outside its square a point is lit).
fn sun_visibility(world: vec3<f32>, normal: vec3<f32>) -> f32 {
    if (globals.shadow.x < 0.5) {
        return 1.0;
    }
    let count = i32(globals.cascade_count.x);
    if (count <= 1) {
        return cascade_visibility(0, world, normal);
    }
    let depth = (globals.view_proj * vec4<f32>(world, 1.0)).w;
    var i = 0;
    for (var k = 0; k < count - 1; k = k + 1) {
        if (depth > globals.cascade_info[k].x) {
            i = k + 1;
        }
    }
    let end = globals.cascade_info[i].x;
    if (depth > end) {
        return 1.0;
    }
    let start = select(0.0, globals.cascade_info[max(i - 1, 0)].x, i > 0);
    let band = (end - start) * 0.15;
    var visible = cascade_visibility(i, world, normal);
    if (depth > end - band) {
        let t = smoothstep(end - band, end, depth);
        if (i < count - 1) {
            visible = mix(visible, cascade_visibility(i + 1, world, normal), t);
        } else {
            visible = mix(visible, 1.0, t);
        }
    }
    return visible;
}

// See-through (`nova.see_through`): what stands between the camera and a point the game keeps in view (a character under a
// diorama camera that never moves in) is cut away by a screen-door inside a cone from the eye to a circle of `see_through.w` metres
// round that point, stopping `opts.x` metres short of it (so the ground and the walls beside and behind the point stay), its edge
// dithered over the outer 30%. A pixel lower than `opts.z` metres above its own model's base is never cut (the ground, a road, the
// foot of a wall): tree crowns, roofs, the upper walls and a vehicle's body go. The shadow maps are not touched: a cut tree still
// casts its shadow. A model drawn with `see_through = false` (a vehicle the camera works round instead) is never cut.
fn see_through_cut(world: vec3<f32>, above_base: f32, pixel: vec2<f32>, slot: f32) -> bool {
    let o = globals.see_through_opts;
    // (a draw that asked never to be cut, `see_through = false`, carries a negative dirt slot: see `ModelInstance::kept_whole`)
    let nf = globals.see_through_near;
    if ((o.y <= 0.0 && nf.y <= 0.0) || above_base < o.z || slot < 0.0) {
        return false;
    }
    let axis = globals.see_through.xyz - globals.eye.xyz;
    let len = length(axis);
    if (len < 1e-3) {
        return false;
    }
    let d = axis / len;
    let rel = world - globals.eye.xyz;
    // (anything within `opts.w` metres of the eye goes too, its edge dithered over the last fifth: a camera whose eye is in a tree's
    // crown sees out of it, and a roof right under a high camera is no wall across the picture)
    var drop = 0.0;
    if (o.w > 0.0) {
        drop = nf.y * (1.0 - smoothstep(min(nf.x, o.w * 0.999), o.w, length(rel)));
    }
    let along = dot(rel, d);
    if (o.y > 0.0 && along > 0.0 && along <= len - o.x) {
        let r = globals.see_through.w * along / len;
        let off = length(rel - d * along);
        drop = max(drop, o.y * (1.0 - smoothstep(r * 0.7, r, off)));
    }
    if (drop <= 0.0) {
        return false;
    }
    let noise = fract(52.9829189 * fract(dot(pixel, vec2<f32>(0.06711056, 0.00583715))));
    return noise < drop;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    // a piece fading with distance (scenery between two levels of detail, or at the edge of the draw range): each pixel is
    // kept or dropped by a fixed noise, so that the near and far versions, with opposite signs, fill every pixel between them
    if (in.dissolve != 0.0) {
        let noise = fract(52.9829189 * fract(dot(in.position.xy, vec2<f32>(0.06711056, 0.00583715))));
        if (in.dissolve < 0.0) {
            if (noise < -in.dissolve) { discard; }
        } else {
            if (noise >= in.dissolve) { discard; }
        }
    }
    if (see_through_cut(in.world, in.local.w, in.position.xy, in.dirt)) { discard; }
    // (a part of a textured model whose material has no picture has its UVs far out, model.rs NO_TEXTURE_UV: it is drawn white, in
    // its own colours; sampled anyway, since a sample must be taken by every pixel alike)
    let picture = textureSample(base_texture, base_sampler, in.uv);
    let base = select(picture, vec4<f32>(1.0), in.uv.x > 1.0e6) * in.color;
    return plain_light(in, base);
}

// A model with a detail picture (a glTF material's `extras.nova.detail`; model.rs `Detail`): fine grain that repeats over the base
// colour picture `scale` times as often and multiplies the colour by twice its value, so mid-grey changes nothing. Far away the
// picture's smaller copies average out to that grey, so the grain fades by itself. One more texture read than fs_main.
struct DetailParams {
    scale: vec4<f32>,   // xy: how many times the detail picture repeats across the base picture's u and v
};
@group(3) @binding(9) var detail_map: texture_2d<f32>;
@group(3) @binding(10) var detail_sampler: sampler;
@group(3) @binding(11) var<uniform> detail_params: DetailParams;

@fragment
fn fs_detail(in: VertexOut) -> @location(0) vec4<f32> {
    if (in.dissolve != 0.0) {
        let noise = fract(52.9829189 * fract(dot(in.position.xy, vec2<f32>(0.06711056, 0.00583715))));
        if (in.dissolve < 0.0) {
            if (noise < -in.dissolve) { discard; }
        } else {
            if (noise >= in.dissolve) { discard; }
        }
    }
    if (see_through_cut(in.world, in.local.w, in.position.xy, in.dirt)) { discard; }
    let picture = textureSample(base_texture, base_sampler, in.uv);
    let grain = textureSample(detail_map, detail_sampler, in.uv * detail_params.scale.xy).rgb * 2.0;
    let plain = in.uv.x > 1.0e6;
    let base = select(vec4<f32>(picture.rgb * grain, picture.a), vec4<f32>(1.0), plain) * in.color;
    return plain_light(in, base);
}

// ---- painted buildings: wood, roof, stone (kinds 5 to 7; docs/project-format.md, "Painted surfaces") ----
// Worked out in the model's own space (`local`: the pattern is fixed to the house whichever way it is turned) on the plane the
// surface lies in, found from the way its local position changes across the pixel (`lx`, `ly`). Each pattern is a regular rhythm
// (a board, a row of tiles, a course of stones) with a hash of the row and the piece giving each a slightly different colour, soft
// dark joints, and a stretched noise grain; every part of it is faded to the plain colour where it is under a few pixels wide
// (`fp`, metres a pixel spans), so far houses are calm: no shimmer, no moire.

// A hash of two numbers to 0..1 (the same on every GPU: no sine).
fn hash21(p: vec2<f32>) -> f32 {
    var q = fract(p * vec2<f32>(0.1031, 0.1030));
    q = q + dot(q, q.yx + vec2<f32>(33.33));
    return fract((q.x + q.y) * q.x);
}

// A surface's plane in its model's space: `p` the point on it and `gx`, `gy` its change across the pixel along the plane's two
// directions, `fp` how many metres a pixel spans on it.
struct Plane {
    p: vec2<f32>,
    gx: vec2<f32>,
    gy: vec2<f32>,
    fp: f32,
};

fn plane_in(local: vec3<f32>, lx: vec3<f32>, ly: vec3<f32>, u: vec3<f32>, v: vec3<f32>) -> Plane {
    var o: Plane;
    o.p = vec2<f32>(dot(local, u), dot(local, v));
    o.gx = vec2<f32>(dot(lx, u), dot(lx, v));
    o.gy = vec2<f32>(dot(ly, u), dot(ly, v));
    o.fp = max(max(abs(o.gx.x) + abs(o.gy.x), abs(o.gx.y) + abs(o.gy.y)), 1e-5);
    return o;
}

// The plane a wall (or, for a floor, a deck, a top) lies in: along the wall and up it, or along x and z.
fn plane_of_wall(local: vec3<f32>, lx: vec3<f32>, ly: vec3<f32>, nl: vec3<f32>) -> Plane {
    if (abs(nl.y) > 0.7) {
        return plane_in(local, lx, ly, vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 0.0, 1.0));
    }
    if (abs(nl.x) > abs(nl.z)) {
        return plane_in(local, lx, ly, vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(0.0, 1.0, 0.0));
    }
    return plane_in(local, lx, ly, vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0));
}

// Boards: courses of 0.32 m (0.2 m on a floor or deck) run along a wall, one shade each and a little different along their length,
// a soft dark seam between them, a lighter lip on each upper edge, and grain stretched along them.
fn paint_wood(rgb: vec3<f32>, local: vec3<f32>, lx: vec3<f32>, ly: vec3<f32>) -> vec3<f32> {
    let nl = safe_normalize(cross(lx, ly));
    let pl = plane_of_wall(local, lx, ly, nl);
    var h = 0.32;
    if (abs(nl.y) > 0.7) { h = 0.2; }
    let row = floor(pl.p.y / h);
    let f = pl.p.y / h - row;
    let r = hash21(vec2<f32>(row, 3.7));
    let seg = floor((pl.p.x + r * 5.0) / 2.3);
    let rs = hash21(vec2<f32>(row + 11.3, seg));
    let calm = 1.0 - smoothstep(0.07, 0.2, pl.fp);
    // each board its own shade and a little warmer or cooler, and each length of it a little different again
    var c = rgb * (1.0 + ((r - 0.5) * 0.15 + (rs - 0.5) * 0.08) * calm);
    c = c * mix(vec3<f32>(1.0), mix(vec3<f32>(1.04, 1.0, 0.94), vec3<f32>(0.96, 0.99, 1.04), hash21(vec2<f32>(row, 9.1))), 0.6 * calm);
    // grain: streaks about a metre long and a few centimetres across, laid differently on each board
    let ax = vec2<f32>(1.0, 0.0);
    let ay = vec2<f32>(0.0, 1.0);
    let g = paint_read(pl.p, pl.gx, pl.gy, paint_axes(ax, ay, 0.8, 18.0), vec2<f32>(r * 7.3, r * 3.1));
    let g2 = paint_read(pl.p, pl.gx, pl.gy, paint_axes(ax, ay, 2.4, 46.0), vec2<f32>(rs * 5.1, r * 1.7));
    c = c * (1.0 + ((g.g - 0.5) * 0.11 + (g2.b - 0.5) * 0.06) * (1.0 - smoothstep(0.03, 0.12, pl.fp)));
    // the seam between boards (a soft dark line about 2.5 cm wide) and a lighter lip along the board's upper edge
    let d = min(f, 1.0 - f) * h;
    let fine = 1.0 - smoothstep(0.03, 0.09, pl.fp);
    let seam = (1.0 - smoothstep(0.004, 0.012 + pl.fp * 0.8, d)) * fine;
    let lip = smoothstep(0.82, 0.97, f) * fine;
    // (where the seams are too fine to see, they still darken a little on average)
    return c * (1.0 - 0.24 * seam + 0.05 * lip - 0.02 * (1.0 - fine));
}

// A roof's tiles: rows of 0.26 m up the slope, tiles 0.36 m wide, every other row half a tile along, each tile a little different;
// a soft shadow under each row's lower edge scalloped to its tiles, and a joint between tiles.
fn paint_roof(rgb: vec3<f32>, local: vec3<f32>, lx: vec3<f32>, ly: vec3<f32>) -> vec3<f32> {
    var nl = safe_normalize(cross(lx, ly));
    if (nl.y < 0.0) { nl = -nl; }
    let up = vec3<f32>(0.0, 1.0, 0.0);
    var s_dir = up - nl * dot(nl, up);
    if (dot(s_dir, s_dir) < 1e-4) { s_dir = vec3<f32>(0.0, 0.0, 1.0); }
    s_dir = safe_normalize(s_dir);
    let t_dir = safe_normalize(cross(nl, s_dir));
    let pl = plane_in(local, lx, ly, t_dir, s_dir);
    let rh = 0.26;
    let tw = 0.36;
    let row = floor(pl.p.y / rh);
    let f = pl.p.y / rh - row;
    let stag = 0.5 * (row - 2.0 * floor(row * 0.5));
    let col = pl.p.x / tw + stag;
    let id = floor(col);
    let u = col - id;
    let r = hash21(vec2<f32>(row, id));
    let calm = 1.0 - smoothstep(0.06, 0.2, pl.fp);
    var c = rgb * (1.0 + (r - 0.5) * 0.15 * calm);
    c = c * mix(vec3<f32>(1.0), mix(vec3<f32>(1.04, 1.0, 0.93), vec3<f32>(0.95, 0.99, 1.05), hash21(vec2<f32>(id, row + 4.0))), 0.5 * calm);
    // the shadow under a row's lower edge, the edge scalloped (a rounded tile): about the lowest fifth of the row
    let scallop = 0.05 * (1.0 - cos(6.2832 * u));
    let under = 1.0 - smoothstep(0.0, 0.2 + pl.fp / rh, f + scallop);
    // a joint between tiles
    let dj = min(u, 1.0 - u) * tw;
    let joint = (1.0 - smoothstep(0.004, 0.014 + pl.fp * 0.8, dj)) * smoothstep(0.1, 0.3, f);
    let fine = 1.0 - smoothstep(0.03, 0.1, pl.fp);
    return c * (1.0 - 0.2 * under * fine - 0.14 * joint * fine + 0.04 * smoothstep(0.55, 0.9, f) * fine - 0.05 * (1.0 - fine));
}

// Stone: courses of 0.22 m, blocks of about 0.42 m in a different place on each course, each block its own shade, rounded (a little
// darker towards its edges), the mortar between a soft dark, and a slow mottle of warmer and cooler across it.
fn paint_stone(rgb: vec3<f32>, local: vec3<f32>, lx: vec3<f32>, ly: vec3<f32>) -> vec3<f32> {
    let nl = safe_normalize(cross(lx, ly));
    let pl = plane_of_wall(local, lx, ly, nl);
    let rh = 0.22;
    let bw = 0.42;
    let row = floor(pl.p.y / rh);
    let f = pl.p.y / rh - row;
    let col = pl.p.x / bw + hash21(vec2<f32>(row, 1.3)) * 9.0;
    let id = floor(col);
    let u = col - id;
    let r = hash21(vec2<f32>(row + 21.0, id));
    let calm = 1.0 - smoothstep(0.07, 0.2, pl.fp);
    var c = rgb * (1.0 + (r - 0.5) * 0.22 * calm);
    c = c * mix(vec3<f32>(1.0), mix(vec3<f32>(1.04, 1.02, 0.94), vec3<f32>(0.95, 0.99, 1.05), hash21(vec2<f32>(id + 3.0, row))), 0.6 * calm);
    let m = paint_read(pl.p, pl.gx, pl.gy, paint_axes(vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0), 2.0, 2.0), vec2<f32>(0.31, 0.77));
    c = c * (1.0 + (m.g - 0.5) * 0.12 * (1.0 - smoothstep(0.1, 0.3, pl.fp)));
    // each block's rounding and the mortar round it (about 2 cm)
    let e = min(min(u, 1.0 - u) * bw, min(f, 1.0 - f) * rh);
    let rounded = smoothstep(0.0, 0.06, e);
    let mortar = 1.0 - smoothstep(0.006, 0.018 + pl.fp * 0.8, e);
    let fine = 1.0 - smoothstep(0.04, 0.12, pl.fp);
    return c * (1.0 - (0.14 * (1.0 - rounded) + 0.22 * mortar) * fine - 0.06 * (1.0 - fine));
}

// ---- painted bark and rock: kinds 8 (bark), 9 (birch) and 10 (rock; docs/project-format.md, "Painted surfaces") ----
// Worked out in the model's own space like the building kinds, on up to three planes through it (a side seen along x, a side seen
// along z, a top) blended by which way the surface faces, so a pattern that is stretched one way (furrows, strata) runs the right
// way on every side. Every fine part fades to the plain colour where it is under a few pixels wide (`fp`, model metres a pixel
// spans), and the noise's mip levels average the rest away, so far trees and rocks are calm.
struct NaturePlanes {
    w: vec3<f32>,
    fp: f32,
};

fn nature_planes(local: vec3<f32>, lx: vec3<f32>, ly: vec3<f32>, around: bool) -> NaturePlanes {
    var o: NaturePlanes;
    let nl = safe_normalize(cross(lx, ly));
    var d = nl.xz;
    var top = smoothstep(0.55, 0.85, abs(nl.y));
    if (around) {
        // a trunk or branch: by where the pixel is round the axis (smooth across the facets), never from the top
        d = local.xz;
        top = 0.0;
    }
    let dd = max(dot(d, d), 1e-6);
    o.w = vec3<f32>(d.y * d.y / dd, d.x * d.x / dd, 0.0) * (1.0 - top) + vec3<f32>(0.0, 0.0, top);
    o.fp = max(length(lx), length(ly));
    return o;
}

// The point and its change across the pixel on plane `i` (0: x along, y up; 1: z along, y up; 2: x and z), as `paint_read` wants.
fn nature_read(i: i32, local: vec3<f32>, lx: vec3<f32>, ly: vec3<f32>, along: f32, up: f32, off: vec2<f32>) -> vec4<f32> {
    var p = local.xy;
    var gx = lx.xy;
    var gy = ly.xy;
    if (i == 1) {
        p = local.zy;
        gx = lx.zy;
        gy = ly.zy;
    } else if (i == 2) {
        p = local.xz;
        gx = lx.xz;
        gy = ly.xz;
    }
    return paint_read(p, gx, gy, paint_axes(vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0), along, up), off);
}

// Bark of a pine or larch: furrows up the trunk (about 8 cm apart and half a metre long, a darker brown, broken here and there),
// broad plates between them a little lighter or darker, a slow warm and cool mottle, and a darker foot.
fn paint_bark(rgb: vec3<f32>, local: vec3<f32>, lx: vec3<f32>, ly: vec3<f32>) -> vec3<f32> {
    let pl = nature_planes(local, lx, ly, true);
    var furrow = 0.0;
    var plate = 0.0;
    var warm = 0.0;
    for (var i = 0; i < 2; i = i + 1) {
        let w = pl.w[i];
        if (w > 0.01) {
            let f = nature_read(i, local, lx, ly, 22.0, 2.4, vec2<f32>(0.17 + f32(i) * 0.31, 0.43));
            let g = nature_read(i, local, lx, ly, 7.0, 1.1, vec2<f32>(0.61, 0.07 + f32(i) * 0.4));
            furrow = furrow + w * f.g;
            plate = plate + w * g.r;
            warm = warm + w * g.a;
        }
    }
    let fine = 1.0 - smoothstep(0.03, 0.14, pl.fp);
    var c = rgb * (1.0 + (plate - 0.5) * 0.5 * (1.0 - smoothstep(0.1, 0.3, pl.fp)));
    c = c * mix(vec3<f32>(0.96, 0.99, 1.04), vec3<f32>(1.05, 1.0, 0.93), warm);
    // the furrows: dark where the stretched noise runs high, a lighter lip on the plates beside them
    let groove = smoothstep(0.5, 0.66, furrow);
    let ridge = smoothstep(0.4, 0.26, furrow);
    c = c * (1.0 - 0.5 * groove * fine + 0.14 * ridge * fine - 0.07 * (1.0 - fine));
    // a darker foot
    c = c * mix(0.78, 1.0, smoothstep(0.0, 0.9, local.y));
    return c;
}

// A birch's bark, white, with little dark dashes across it (lenticels: about 8 cm by 2 cm, laid round the trunk), broader grey
// blotches here and there, a pale and dim banding, and a trunk that darkens to a rough black foot.
fn paint_birch(rgb: vec3<f32>, local: vec3<f32>, lx: vec3<f32>, ly: vec3<f32>) -> vec3<f32> {
    let pl = nature_planes(local, lx, ly, true);
    var dash = 0.0;
    var blotch = 0.0;
    var band = 0.0;
    for (var i = 0; i < 2; i = i + 1) {
        let w = pl.w[i];
        if (w > 0.01) {
            let a = nature_read(i, local, lx, ly, 8.0, 28.0, vec2<f32>(0.13 + f32(i) * 0.29, 0.71));
            let b = nature_read(i, local, lx, ly, 2.6, 7.5, vec2<f32>(0.47, 0.19 + f32(i) * 0.37));
            let e = nature_read(i, local, lx, ly, 1.3, 36.0, vec2<f32>(0.83, 0.55));
            dash = dash + w * smoothstep(0.62, 0.74, a.g);
            blotch = blotch + w * smoothstep(0.66, 0.8, b.b);
            band = band + w * (e.r - 0.5);
        }
    }
    let fine = 1.0 - smoothstep(0.03, 0.13, pl.fp);
    let mid = 1.0 - smoothstep(0.1, 0.35, pl.fp);
    var c = rgb * (1.0 + band * 0.18 * mid);
    let ink = vec3<f32>(0.2, 0.18, 0.17);
    c = mix(c, c * vec3<f32>(0.62, 0.6, 0.58), clamp(blotch, 0.0, 1.0) * 0.55 * mid);
    c = mix(c, ink, clamp(dash, 0.0, 1.0) * 0.85 * fine);
    // (where the dashes are too fine to see, they still grey the bark a little on average)
    c = c * (1.0 - 0.06 * (1.0 - fine));
    // the foot: the bark goes dark and rough near the ground
    c = mix(c, ink * 1.3, 0.75 * smoothstep(0.55, 0.0, local.y));
    return c;
}

// Rock: a soft speckle (fine light and dark grains, a few centimetres), gentle strata (horizontal bands a hand or two thick,
// slightly lighter and darker), a few painted cracks (thin dark lines that wander, in some places only), a lighter top and a
// darker base, and slow warm and cool patches across it.
fn paint_rock(rgb: vec3<f32>, local: vec3<f32>, lx: vec3<f32>, ly: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
    let pl = nature_planes(local, lx, ly, false);
    var grain = 0.0;
    var strata = 0.0;
    var crack = 0.0;
    var here = 0.0;
    var warm = 0.0;
    for (var i = 0; i < 3; i = i + 1) {
        let w = pl.w[i];
        if (w > 0.01) {
            let s = f32(i);
            let g = nature_read(i, local, lx, ly, 13.0, 13.0, vec2<f32>(0.21 + s * 0.17, 0.62));
            let g2 = nature_read(i, local, lx, ly, 31.0, 31.0, vec2<f32>(0.66 - s * 0.13, 0.08));
            let t = nature_read(i, local, lx, ly, 1.0, 6.0, vec2<f32>(0.4, 0.13 + s * 0.23));
            let k = nature_read(i, local, lx, ly, 1.7, 1.2, vec2<f32>(0.77 - s * 0.2, 0.34));
            let m = nature_read(i, local, lx, ly, 0.7, 0.7, vec2<f32>(0.05 + s * 0.3, 0.9));
            grain = grain + w * ((g.g - 0.5) * 0.7 + (g2.b - 0.5) * 0.45);
            strata = strata + w * (smoothstep(0.38, 0.62, t.b) - 0.5);
            // a crack runs where the noise crosses its middle; only where a second, slower noise is high
            let line = 1.0 - smoothstep(0.005, 0.016 + pl.fp * 0.6, abs(k.r - 0.5));
            crack = crack + w * line;
            here = here + w * smoothstep(0.42, 0.6, m.a);
            warm = warm + w * m.g;
        }
    }
    let fine = 1.0 - smoothstep(0.03, 0.13, pl.fp);
    let mid = 1.0 - smoothstep(0.1, 0.35, pl.fp);
    var c = rgb * (1.0 + grain * 0.28 * (1.0 - smoothstep(0.02, 0.1, pl.fp)) + strata * 0.3 * mid);
    c = c * mix(vec3<f32>(0.94, 0.98, 1.05), vec3<f32>(1.06, 1.01, 0.92), warm);
    c = c * (1.0 - 0.3 * crack * here * fine);
    // lighter where it faces up, darker towards the ground
    c = c * (1.0 + 0.1 * smoothstep(0.3, 0.9, n.y));
    c = c * mix(0.72, 1.0, smoothstep(0.0, 0.55, local.y));
    return c;
}

// The kinds 5 (wood), 6 (roof), 7 (stone), 8 (bark), 9 (birch) and 10 (rock): the colour changes; the light is the plain look's.
fn paint_building(rgb: vec3<f32>, local: vec3<f32>, lx: vec3<f32>, ly: vec3<f32>, n: vec3<f32>, kind: f32) -> Painted {
    var o: Painted;
    if (kind < 5.5) {
        o.rgb = paint_wood(rgb, local, lx, ly);
    } else if (kind < 6.5) {
        o.rgb = paint_roof(rgb, local, lx, ly);
    } else if (kind < 7.5) {
        o.rgb = paint_stone(rgb, local, lx, ly);
    } else if (kind < 8.5) {
        o.rgb = paint_bark(rgb, local, lx, ly);
    } else if (kind < 9.5) {
        o.rgb = paint_birch(rgb, local, lx, ly);
    } else {
        o.rgb = paint_rock(rgb, local, lx, ly, n);
    }
    o.normal = n;
    o.wrap = 0.0;
    o.rim = 0.0;
    o.extra = vec3<f32>(0.0);
    return o;
}

// The plain look's light on a surface of colour `base` (the picture times the vertex colour and the tint): fs_main's work, shared
// with fs_detail.
fn plain_light(in: VertexOut, base_in: vec4<f32>) -> vec4<f32> {
    // (how the point moves across the pixel, worked out before anything branches: a painted surface reads its noise's mip level by it
    // and fades its finest strokes by how many metres a pixel spans)
    let wx = dpdx(in.world);
    let wy = dpdy(in.world);
    let lx = dpdx(in.local.xyz);
    let ly = dpdy(in.local.xyz);
    let ux = dpdx(in.uv);
    let uy = dpdy(in.uv);
    var base = base_in;
    let paint = in.paint;
    // (water's alpha is how deep it is there, not its cover)
    var deep = 1.0;
    if (paint > 3.5 && paint < 4.5) {
        deep = base.a;
        base.a = 1.0;
    }
    // cut-out textures (leaves, glass, plants): see-through texels are not drawn at all
    if (base.a < 0.3) {
        discard;
    }
    if (in.emissive < 0.0) {
        // a voxel surface: light is baked per vertex (x: sky, y: torch/lava), the face shade and ambient occlusion are in the colour
        let light = in.normal.x * globals.voxel.x * vec3<f32>(1.0) + in.normal.y * vec3<f32>(1.0, 0.86, 0.7);
        let vrgb = base.rgb * min(light + vec3<f32>(0.03), vec3<f32>(1.0));
        return vec4<f32>(fog_over(in.world, vrgb), base.a);
    }
    let geo = safe_normalize(in.normal);
    var n = geo;
    var surface = base.rgb;
    var glow = in.emissive;
    var wrap = 0.0;
    var rim = 0.0;
    var extra = vec3<f32>(0.0);
    if (paint > 0.5) {
        var p: Painted;
        if (paint < 2.5) {
            p = paint_foliage(surface, in.local.xyz, lx, ly, geo, paint);
        } else if (paint < 3.5) {
            let gx = wx.xz;
            let gy = wy.xz;
            p = paint_ground(surface, in.world, geo, gx, gy, max(max(abs(gx.x) + abs(gy.x), abs(gx.y) + abs(gy.y)), 1e-5));
        } else if (paint < 4.5) {
            p = paint_water(surface, in.world, in.uv, ux, uy, deep, max(abs(ux.x) + abs(uy.x), abs(ux.y) + abs(uy.y)));
        } else {
            p = paint_building(surface, in.local.xyz, lx, ly, geo, paint);
        }
        surface = p.rgb;
        n = p.normal;
        wrap = p.wrap;
        rim = p.rim;
        extra = p.extra;
    }
    if (abs(in.dirt) > 1.5) {
        let dirt = dirt_of(abs(in.dirt));
        let cover = dirt_cover(in.local, n, dirt.w, smoothstep(10.0, 25.0, distance(in.world, globals.eye.xyz)));
        surface = mix(surface, dirt.rgb, cover);
        glow = glow * (1.0 - 0.7 * cover);
    }
    // the sun's share is dimmed in a shadow, down to `1 - strength` of it (the shadow is looked up on the true surface)
    let visible = mix(1.0 - globals.shadow.w, 1.0, sun_visibility(in.world, geo));
    var diffuse = max((dot(n, -globals.light_dir.xyz) + wrap) / (1.0 + wrap), 0.0) * visible;
    if (rim > 0.0) {
        // the side towards the sun seen at a slant: a lit rim (light through the outer leaves)
        let v = safe_normalize(globals.eye.xyz - in.world);
        let edge = pow(1.0 - max(dot(geo, v), 0.0), 3.0);
        let sunward = smoothstep(-0.2, 0.6, dot(geo, -globals.light_dir.xyz));
        extra = extra + surface * globals.light_color.rgb * (rim * edge * sunward * visible);
    }
    // a toon look cuts the sun's light into flat bands (soft only at the pixel's width, so the edges stay clean)
    if (globals.voxel.y >= 1.5) {
        let x = diffuse * globals.voxel.y;
        let w = fwidth(x) * 0.75 + 0.01;
        diffuse = (floor(x) + smoothstep(0.5 - w, 0.5 + w, fract(x))) / globals.voxel.y;
    }
    var light = globals.ambient.rgb + globals.light_color.rgb * diffuse * (1.0 - globals.ambient.rgb);
    let count = i32(globals.light_dir.w);
    for (var i = 0; i < count; i = i + 1) {
        let to_light = globals.point_pos[i].xyz - in.world;
        let dist = length(to_light);
        let falloff = clamp(1.0 - dist / globals.point_pos[i].w, 0.0, 1.0);
        let towards = to_light / max(dist, 0.0001);
        let lambert = max(dot(n, towards), 0.0);
        var cone = 1.0;
        let aim = globals.point_dir[i];
        if (dot(aim.xyz, aim.xyz) > 0.25) {
            // a spot light: full inside the middle of the cone, fading to nothing at its edge
            let across = dot(-towards, aim.xyz);
            cone = smoothstep(aim.w, mix(aim.w, 1.0, 0.45), across);
        }
        light = light + globals.point_color[i].rgb * (falloff * falloff * lambert * cone);
    }
    // a glowing surface shows its colour at full brightness however dark the scene is
    let rgb = surface * (light + vec3<f32>(glow)) + extra;
    return vec4<f32>(fog_over(in.world, rgb), base.a);
}

// ---- skinned meshes: the joints' matrices for the frame sit in a texture, four texels (columns) a matrix ----
@group(3) @binding(0) var joint_texture: texture_2d<f32>;

fn joint_matrix(index: u32) -> mat4x4<f32> {
    let t = index * 4u;
    let x = i32(t % 1024u);
    let y = i32(t / 1024u);
    return mat4x4<f32>(
        textureLoad(joint_texture, vec2<i32>(x, y), 0),
        textureLoad(joint_texture, vec2<i32>(x + 1, y), 0),
        textureLoad(joint_texture, vec2<i32>(x + 2, y), 0),
        textureLoad(joint_texture, vec2<i32>(x + 3, y), 0),
    );
}

struct SkinVertex {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec4<f32>,
    @location(3) uv: vec2<f32>,
    @location(9) emissive: f32,
    @location(10) joints: vec4<u32>,
    @location(11) weights: vec4<f32>,
};

// The instance's matrix carries where its joints start in its w slot (an affine matrix has 0 there).
@vertex
fn vs_skinned(v: SkinVertex, inst: Instance) -> VertexOut {
    return skinned_vertex(v, inst);
}

// The joints' pull on a vertex, mixed by its weights (the identity when it has none).
fn skin_matrix(v: SkinVertex, base: u32) -> mat4x4<f32> {
    var skin = mat4x4<f32>(vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
    for (var k = 0; k < 4; k = k + 1) {
        if (v.weights[k] > 0.0) {
            skin = skin + joint_matrix(base + v.joints[k]) * v.weights[k];
        }
    }
    let total = v.weights.x + v.weights.y + v.weights.z + v.weights.w;
    if (total <= 0.0) {
        skin = mat4x4<f32>(vec4<f32>(1.0, 0.0, 0.0, 0.0), vec4<f32>(0.0, 1.0, 0.0, 0.0), vec4<f32>(0.0, 0.0, 1.0, 0.0), vec4<f32>(0.0, 0.0, 0.0, 1.0));
    }
    return skin;
}

// (vs_skinned's work, shared with the material and custom-shader entry points)
fn skinned_vertex(v: SkinVertex, inst: Instance) -> VertexOut {
    let base = u32(inst.m0.w + 0.5);
    let model = mat4x4<f32>(vec4<f32>(inst.m0.xyz, 0.0), vec4<f32>(inst.m1.xyz, 0.0), vec4<f32>(inst.m2.xyz, 0.0), vec4<f32>(inst.m3.xyz, 1.0));
    let skin = skin_matrix(v, base);
    let posed = skin * vec4<f32>(v.position, 1.0);
    let normal = (skin * vec4<f32>(v.normal, 0.0)).xyz;
    var out: VertexOut;
    var world = model * posed;
    out.dirt = inst.m3.w;
    out.local = vec4<f32>(v.position, (world.y - inst.m3.y) / max(length(inst.m1.xyz), 1e-6));
    var world_normal = safe_normalize((model * vec4<f32>(normal, 0.0)).xyz);
    if (terrain_active() && inst.m3.y < 30.0) {
        let mode = lift_mode(inst.m2.w);
        if (mode == 1) {
            world = vec4<f32>(world.x, world.y + terrain_height(inst.m3.xz), world.z, 1.0); // rigid
        } else {
            let k = origin_share(mode, world.y - inst.m3.y); // (upright: level above its foot)
            world = vec4<f32>(world.x, world.y + ground_lift(world.xz, inst.m3.xz, k), world.z, 1.0);
            let g = terrain_slope(world.xz) * (1.0 - k);
            world_normal = safe_normalize(vec3<f32>(world_normal.x - g.x * world_normal.y, world_normal.y, world_normal.z - g.y * world_normal.y));
        }
    }
    out.world = world.xyz;
    out.position = globals.view_proj * world;
    out.normal = world_normal;
    out.dissolve = inst.m1.w;
    out.color = v.color * vec4<f32>(srgb_to_linear(inst.tint.rgb), inst.tint.a);
    out.uv = v.uv;
    out.emissive = glow_of(v.emissive);
    out.paint = paint_of(v.emissive);
    return out;
}

// ---- surfaces lit by their glTF material (a project opts in: "materials" in nova.json; docs/materials.md) ----
// A cheap stand-in for physically based light that keeps Nova's sun, shadows, point and spot lights, toon bands and fog: the diffuse
// light is the plain look's, a metal gives up its diffuse colour for a tinted shine, a normalised Blinn-Phong highlight (sharper as
// the roughness falls) stands in for GGX, and the sky's colours (or the ambient light when there is no sky) are what a shiny surface
// reflects, by a Fresnel term.
@group(3) @binding(1) var normal_map: texture_2d<f32>;
@group(3) @binding(2) var surface_map: texture_2d<f32>;
@group(3) @binding(3) var emissive_map: texture_2d<f32>;
@group(3) @binding(4) var map_sampler: sampler;
// the sky as light (`Quality::ibl`; see env.wgsl): a small cube map whose levels are the sky blurred by roughness
@group(2) @binding(2) var env_map: texture_cube<f32>;
@group(2) @binding(3) var env_sampler: sampler;

struct MaterialVertex {
    @location(12) tangent: vec4<f32>,
    @location(13) surface: vec4<f32>,
    @location(14) emission: vec4<f32>,
    @location(15) coat: vec4<f32>,
};

struct MaterialOut {
    @builtin(position) position: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) color: vec4<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) world: vec3<f32>,
    @location(4) emissive: f32,
    @location(5) @interpolate(flat) dissolve: f32,
    @location(6) tangent: vec4<f32>,
    @location(7) surface: vec4<f32>,
    @location(8) emission: vec4<f32>,
    @location(9) coat: vec4<f32>,
    @location(10) @interpolate(flat) dirt: f32,
    @location(11) local: vec4<f32>,
};

// The tangent in the world, leaning with the hills like the normal does (the lift's forward shear).
fn material_out(o: VertexOut, tangent: vec3<f32>, m: MaterialVertex, ground: bool) -> MaterialOut {
    var out: MaterialOut;
    out.position = o.position;
    out.normal = o.normal;
    out.color = o.color;
    out.uv = o.uv;
    out.world = o.world;
    out.emissive = o.emissive;
    out.dissolve = o.dissolve;
    out.dirt = o.dirt;
    out.local = o.local;
    var t = tangent;
    if (ground && terrain_active()) {
        let g = terrain_slope(o.world.xz);
        t = vec3<f32>(t.x, t.y + g.x * t.x + g.y * t.z, t.z);
    }
    out.tangent = vec4<f32>(safe_normalize(t), m.tangent.w);
    out.surface = m.surface;
    out.emission = m.emission;
    out.coat = m.coat;
    return out;
}

@vertex
fn vs_material(v: Vertex, inst: Instance, m: MaterialVertex) -> MaterialOut {
    let o = mesh_vertex(v, inst);
    let model = mat3x3<f32>(inst.m0.xyz, inst.m1.xyz, inst.m2.xyz);
    return material_out(o, model * m.tangent.xyz, m, inst.m3.y < 30.0);
}

@vertex
fn vs_skinned_material(v: SkinVertex, inst: Instance, m: MaterialVertex) -> MaterialOut {
    let o = skinned_vertex(v, inst);
    let skin = skin_matrix(v, u32(inst.m0.w + 0.5));
    let model = mat3x3<f32>(inst.m0.xyz, inst.m1.xyz, inst.m2.xyz);
    return material_out(o, model * (skin * vec4<f32>(m.tangent.xyz, 0.0)).xyz, m, inst.m3.y < 30.0);
}

// The highlight of one light: a normalised Blinn-Phong lobe (its sharpness from the roughness, as GGX's would be) times Schlick's
// Fresnel, times the light's angle on the surface.
fn highlight(n: vec3<f32>, v: vec3<f32>, l: vec3<f32>, rough: f32, f0: vec3<f32>) -> vec3<f32> {
    let nl = dot(n, l);
    if (nl <= 0.0) {
        return vec3<f32>(0.0);
    }
    let h = safe_normalize(v + l);
    let a = rough * rough;
    let shine = clamp(2.0 / max(a * a, 1e-4) - 2.0, 1.0, 2048.0);
    let lobe = (shine + 8.0) / 25.132741 * pow(max(dot(n, h), 0.0), shine);
    let f = f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - max(dot(v, h), 0.0), 5.0);
    return f * (lobe * nl);
}

// What the world reflects along a direction, for a surface this rough: the cube made from the sky when the game asks for it (`ibl`),
// else the sky's two colours over the land's (`nova.sky`'s `ground`, as the sun and the ambient light leave it; dimmed by `shade`,
// the model's own shade on the ground at its foot), meeting at the horizon in a line that is sharper the smoother the surface; with no
// ground colour the land is the horizon, darker; with no sky, the ambient light.
fn environment(dir: vec3<f32>, rough: f32, shade: f32) -> vec3<f32> {
    if (globals.cascade_count.y > 0.5) {
        return textureSampleLevel(env_map, env_sampler, dir, rough * globals.cascade_count.w).rgb;
    }
    var around = globals.ambient.rgb;
    if (globals.sky_top.w > 0.5) {
        let up = mix(globals.sky_horizon.rgb, globals.sky_top.rgb, clamp(dir.y, 0.0, 1.0));
        if (globals.ground.w > 0.5) {
            // (the far land, just under the horizon, is seen edge on and is mostly its own shade: trees, hillsides. That dark line under
            // the bright horizon is what a car's flank and its windows show of the world)
            let blur = 0.03 + rough * 0.5;
            let land = globals.ground.rgb * mix(shade, 0.42, smoothstep(-0.22 - blur, -0.03, dir.y));
            around = mix(land, up, smoothstep(-blur, blur, dir.y));
        } else {
            around = mix(globals.sky_horizon.rgb * 0.45, up, smoothstep(-0.25, 0.0, dir.y));
        }
    }
    return around;
}

@fragment
fn fs_material(in: MaterialOut) -> @location(0) vec4<f32> {
    if (in.dissolve != 0.0) {
        let noise = fract(52.9829189 * fract(dot(in.position.xy, vec2<f32>(0.06711056, 0.00583715))));
        if (in.dissolve < 0.0) {
            if (noise < -in.dissolve) { discard; }
        } else {
            if (noise >= in.dissolve) { discard; }
        }
    }
    if (see_through_cut(in.world, in.local.w, in.position.xy, in.dirt)) { discard; }
    let picture = textureSample(base_texture, base_sampler, in.uv);
    let base = select(picture, vec4<f32>(1.0), in.uv.x > 1.0e6) * in.color;
    // (every map is sampled by every pixel alike; a part without one ignores what it read)
    let bump = textureSample(normal_map, map_sampler, in.uv).xyz * 2.0 - vec3<f32>(1.0);
    let packed = textureSample(surface_map, map_sampler, in.uv);
    let glow_map = textureSample(emissive_map, map_sampler, in.uv).rgb;
    if (base.a < 0.3) {
        discard;
    }
    let geo = safe_normalize(in.normal);
    var n = geo;
    if (in.surface.z != 0.0 && dot(in.tangent.xyz, in.tangent.xyz) > 0.01) {
        // tangent space to the world: the tangent made square to the normal, the bitangent by the file's handedness
        let t = safe_normalize(in.tangent.xyz - geo * dot(geo, in.tangent.xyz));
        let b = cross(geo, t) * in.tangent.w;
        n = safe_normalize(t * (bump.x * in.surface.z) + b * (bump.y * in.surface.z) + geo * bump.z);
    }
    var metallic = in.surface.x;
    var rough = in.surface.y;
    if (in.surface.w > 0.5) {
        rough = rough * packed.g;
        metallic = metallic * packed.b;
    }
    var albedo = base.rgb;
    var coat = in.coat.x;
    var glass = in.coat.z;
    var lamp = 1.0;
    let away = distance(in.world, globals.eye.xyz);
    // dirt lies over the surface: its own dull colour, and no metal, gloss, lacquer or glass shows through it
    if (abs(in.dirt) > 1.5) {
        let dirt = dirt_of(abs(in.dirt));
        let cover = dirt_cover(in.local, geo, dirt.w, smoothstep(10.0, 25.0, away)) * (1.0 - 0.5 * glass);
        albedo = mix(albedo, dirt.rgb, cover);
        metallic = metallic * (1.0 - cover);
        rough = mix(rough, 0.95, cover);
        coat = coat * (1.0 - cover);
        glass = glass * (1.0 - cover);
        lamp = 1.0 - 0.7 * cover;
    }
    rough = clamp(rough, 0.045, 1.0);
    let v = safe_normalize(globals.eye.xyz - in.world);
    let to_sun = -globals.light_dir.xyz;
    let visible = mix(1.0 - globals.shadow.w, 1.0, sun_visibility(in.world, geo));
    var diffuse = max(dot(n, to_sun), 0.0) * visible;
    if (globals.voxel.y >= 1.5) {
        let x = diffuse * globals.voxel.y;
        let w = fwidth(x) * 0.75 + 0.01;
        diffuse = (floor(x) + smoothstep(0.5 - w, 0.5 + w, fract(x))) / globals.voxel.y;
    }
    // the light that falls from the sky on this side of the surface, in place of one ambient colour: made from the sky's own cube and
    // scaled so that it averages the game's ambient light; or, when the sky has a ground colour, the ambient light from above and the
    // land's own light from below, less of both near the model's foot (it stands in its own shade: `shade`)
    var ambient = globals.ambient.rgb;
    var shade = 1.0;
    if (globals.cascade_count.y > 0.5) {
        ambient = textureSampleLevel(env_map, env_sampler, n, globals.cascade_count.w).rgb * globals.cascade_count.z;
    } else if (globals.ground.w > 0.5) {
        shade = 0.4 + 0.6 * smoothstep(0.0, 0.6, in.local.w);
        ambient = mix(globals.ground.rgb * shade, globals.ambient.rgb * (0.6 + 0.4 * shade), smoothstep(-0.9, 0.9, n.y));
    }
    var light = ambient + globals.light_color.rgb * diffuse * (1.0 - ambient);
    var f0 = mix(vec3<f32>(0.04), albedo, metallic);
    // metal flake under a lacquer: grains of about 6 mm, each a little brighter or darker and a few catching the sun (only close to:
    // further off they are smaller than a pixel)
    var sparkle = 0.0;
    if (coat > 0.0 && metallic > 0.05) {
        let near = (1.0 - smoothstep(2.5, 7.0, away)) * coat;
        let grain = fract(sin(dot(floor(in.local.xyz * 160.0), vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
        f0 = f0 * (1.0 + (grain - 0.5) * 0.5 * near);
        sparkle = grain * grain * grain * near;
    }
    // a clear coat: a smooth glossy layer over everything else, lit by the geometry's own normal (no bumps); it reflects a few percent
    // of what it faces, more at a slant, and lets the rest through to the paint below. Glass shines the same way, sharper.
    let coat_rough = mix(max(in.coat.y, 0.03), 0.04, glass);
    let glossy = coat > 0.0 || glass > 0.0;
    var coat_shine = vec3<f32>(0.0);
    if (glossy) {
        coat_shine = globals.light_color.rgb * highlight(geo, v, to_sun, coat_rough, vec3<f32>(0.04)) * visible;
    }
    var shine = globals.light_color.rgb * highlight(n, v, to_sun, rough, f0) * visible;
    if (sparkle > 0.0) {
        let h = safe_normalize(v + to_sun);
        shine = shine + globals.light_color.rgb * f0 * (sparkle * 1.6 * pow(max(dot(n, h), 0.0), 12.0) * max(dot(n, to_sun), 0.0) * visible);
    }
    let count = i32(globals.light_dir.w);
    for (var i = 0; i < count; i = i + 1) {
        let to_light = globals.point_pos[i].xyz - in.world;
        let dist = length(to_light);
        let falloff = clamp(1.0 - dist / globals.point_pos[i].w, 0.0, 1.0);
        let towards = to_light / max(dist, 0.0001);
        var cone = 1.0;
        let aim = globals.point_dir[i];
        if (dot(aim.xyz, aim.xyz) > 0.25) {
            cone = smoothstep(aim.w, mix(aim.w, 1.0, 0.45), dot(-towards, aim.xyz));
        }
        let reach = globals.point_color[i].rgb * (falloff * falloff * cone);
        light = light + reach * max(dot(n, towards), 0.0);
        shine = shine + reach * highlight(n, v, towards, rough, f0);
        if (glossy) {
            coat_shine = coat_shine + reach * highlight(geo, v, towards, coat_rough, vec3<f32>(0.04));
        }
    }
    // what a shiny surface reflects: the sky along the reflection (below the horizon the land, or the horizon darker), or the
    // ambient light with no sky; a rough one shows little of it (its blurred average is in the ambient already)
    let r = reflect(-v, n);
    let around = environment(r, rough, shade);
    let nv = max(dot(n, v), 0.0);
    let fresnel = f0 + (max(vec3<f32>(1.0 - rough), f0) - f0) * pow(1.0 - nv, 5.0);
    let mirror = around * fresnel * (1.0 - rough * 0.85);
    var rgb = albedo * (1.0 - metallic) * light + shine + mirror;
    if (glossy) {
        let nv_geo = max(dot(geo, v), 0.0);
        let sheen = environment(reflect(-v, geo), coat_rough, shade);
        if (coat > 0.0) {
            let fresnel_coat = (0.04 + 0.96 * pow(1.0 - nv_geo, 5.0)) * coat;
            rgb = rgb * (1.0 - fresnel_coat) + coat_shine * coat + sheen * fresnel_coat;
        }
        // glass (`KHR_materials_transmission`), with nothing drawn behind it: a dark tinted pane that mirrors the sky and the land,
        // faintly looking straight in and brightly at a slant, with the sun's sharp glint; and a hint of what is inside: dark looking
        // down into it, lighter looking level, through to the light of the far side
        if (glass > 0.0) {
            let mirrored = 0.09 + 0.91 * pow(1.0 - nv_geo, 5.0);
            let through = environment(-v, 0.5, 1.0) * (0.05 * smoothstep(-0.5, 0.1, -v.y));
            let pane = (albedo * light + through) * (1.0 - mirrored) + sheen * (1.25 * mirrored) + coat_shine * 2.0;
            rgb = mix(rgb, pane, glass);
        }
    }
    if (in.emission.w < -0.5) {
        rgb = rgb + albedo * (in.emissive * lamp);
    } else if (in.emission.w > 0.5) {
        rgb = rgb + in.emission.rgb * glow_map * lamp;
    } else {
        rgb = rgb + in.emission.rgb * lamp;
    }
    return vec4<f32>(fog_over(in.world, rgb), base.a);
}

// ---- distance fog and haze (nova.fog), the last step of every lit surface; gfx.rs `Fog::amount` is the same sum on the CPU ----
// Plain fog fades linearly from fog_range.x to fog_range.y. With a haze height (fog_range.z > 0) it is aerial perspective: it builds
// quickly past the start and then slowly (still complete at the end, so where the view stops never shows), more so low down (below
// fog_range.w, the valley's floor, and over fog_range.z metres above it) than high up; far things lose their colour first (voxel.z)
// and the haze on the sun's side of the view is lit by the sun (voxel.w).
fn fog_over(world: vec3<f32>, rgb: vec3<f32>) -> vec3<f32> {
    if (globals.fog_color.w < 0.5) {
        return rgb;
    }
    let d = distance(world, globals.eye.xyz);
    let t = clamp((d - globals.fog_range.x) / (globals.fog_range.y - globals.fog_range.x), 0.0, 1.0);
    if (globals.fog_range.z <= 0.0) {
        return mix(rgb, globals.fog_color.rgb, t);
    }
    let mid = 0.5 * (globals.eye.y + world.y) - globals.fog_range.w;
    let low = exp(-max(mid, 0.0) / globals.fog_range.z);
    let f = pow(max(1.0 - pow(max(1.0 - t, 1e-6), 1.2 + 0.5 * low), 1e-6), 1.7 - 0.4 * low);
    let grey = dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
    let faded = mix(rgb, vec3<f32>(grey), min(f * 1.6, 1.0) * globals.voxel.z);
    let sunward = max(dot((world - globals.eye.xyz) / max(d, 1e-3), -globals.light_dir.xyz), 0.0);
    let haze = globals.fog_color.rgb + globals.light_color.rgb * (globals.voxel.w * 0.3 * pow(sunward, 6.0));
    return mix(faded, haze, f);
}
