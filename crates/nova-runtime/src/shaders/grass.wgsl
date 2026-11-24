// ---- grass (gfx/grass.rs, `nova.grass`; docs/project-format.md "Grass") ----
// Appended to mesh.wgsl (its terrain, shadow and paint functions are used). Clumps of blades made from the vertex and instance
// numbers alone: instance = square * clumps_a_square + k, vertex = blade * 5 + point. Everything is worked out and lit per point,
// so the fragment shader only writes the colour.

struct GrassParams {
    map_area: vec4<f32>,       // x0, z0, 1 / cell, 1 when there is a map
    sizes: vec4<f32>,          // the map's samples across and rows, the colour grid's
    colors_area: vec4<f32>,    // x0, z0, 1 / cell, 1 when there is a colour grid
    base: vec4<f32>,           // rgb: the colour without a grid (linear); w: blade height
    shape: vec4<f32>,          // x: clumps a square; y: where it thins from; z: where it ends; w: the square's side
    misc: vec4<f32>,           // x: blade width; y: sway; z: bends; w: blades a clump
    bends: array<vec4<f32>, 8>,
    tiles: array<vec4<f32>, 160>,
};
@group(3) @binding(20) var<uniform> grass: GrassParams;
@group(3) @binding(21) var grass_map: texture_2d<f32>;
@group(3) @binding(22) var grass_colors: texture_2d<f32>;
@group(3) @binding(23) var grass_sampler: sampler;

struct GrassOut {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec3<f32>,
};

fn grass_hash(a: u32, b: u32) -> f32 {
    var h = a * 0x8da6b343u + b * 0xd8163841u + 0x9e3779b9u;
    h = h ^ (h >> 15u);
    h = h * 0x2c1b3c6du;
    h = h ^ (h >> 12u);
    h = h * 0x297a2d39u;
    h = h ^ (h >> 15u);
    return f32(h & 0xffffu) / 65535.0;
}

// The share of clumps kept at `d` metres (Grass::share in grass.rs).
fn grass_share(d: f32) -> f32 {
    let near = grass.shape.y;
    let end = grass.shape.z;
    let base = select(near / max(d, 1e-3), 1.0, d <= near);
    let t = clamp((d - end * 0.7) / (end * 0.3), 0.0, 1.0);
    return base * (1.0 - t * t * (3.0 - 2.0 * t));
}

// A picture laid over the ground at `p` (bilinear); `area` and the picture's size in samples.
fn grass_uv(p: vec2<f32>, area: vec4<f32>, size: vec2<f32>) -> vec2<f32> {
    return ((p - area.xy) * area.z + vec2<f32>(0.5)) / size;
}

// The ground's height and slope at `p` in one go (terrain_height and terrain_slope, the heightmap's four samples read once):
// x the height, yz the slope along x and z.
fn grass_ground(p: vec2<f32>) -> vec3<f32> {
    var out = vec3<f32>(0.0);
    if (globals.terrain[0].y > 0.0) {
        let dims = globals.terrain_map[1].xy;
        let raw = (p - globals.terrain_map[0].xy) * globals.terrain_map[0].z;
        let f = clamp(raw, vec2<f32>(0.0), dims);
        let i = min(vec2<i32>(floor(f)), vec2<i32>(dims) - vec2<i32>(1));
        let t = f - vec2<f32>(i);
        let a = textureLoad(heightmap, i, 0).x;
        let b = textureLoad(heightmap, i + vec2<i32>(1, 0), 0).x;
        let c = textureLoad(heightmap, i + vec2<i32>(0, 1), 0).x;
        let d = textureLoad(heightmap, i + vec2<i32>(1, 1), 0).x;
        let top = a + (b - a) * t.x;
        let bottom = c + (d - c) * t.x;
        let inside = vec2<f32>(select(0.0, 1.0, raw.x > 0.0 && raw.x < dims.x), select(0.0, 1.0, raw.y > 0.0 && raw.y < dims.y));
        out = vec3<f32>(top + (bottom - top) * t.y, inside * vec2<f32>(
            ((b - a) * (1.0 - t.y) + (d - c) * t.y) * globals.terrain_map[0].z,
            ((c - a) * (1.0 - t.x) + (d - b) * t.x) * globals.terrain_map[0].z));
    }
    let n = i32(globals.terrain[0].x);
    for (var k = 0; k < n; k = k + 1) {
        let w = globals.terrain[k + 1];
        let ph = w.x * p.x + w.y * p.y + w.w;
        out = out + vec3<f32>(w.z * sin(ph), w.z * cos(ph) * w.x, w.z * cos(ph) * w.y);
    }
    return out;
}

// The sun on a point of a blade: one filtered comparison in the map that holds it (the shadow's edge on grass needs no more).
fn grass_sun(world: vec3<f32>) -> f32 {
    if (globals.shadow.x < 0.5) {
        return 1.0;
    }
    let count = i32(globals.cascade_count.x);
    var i = 0;
    if (count > 1) {
        let depth = (globals.view_proj * vec4<f32>(world, 1.0)).w;
        for (var k = 0; k < count - 1; k = k + 1) {
            if (depth > globals.cascade_info[k].x) {
                i = k + 1;
            }
        }
        if (depth > globals.cascade_info[i].x) {
            return 1.0;
        }
    }
    let info = globals.cascade_info[i];
    let clip = globals.cascade_vp[i] * vec4<f32>(world + vec3<f32>(0.0, info.z * 1.5, 0.0), 1.0);
    let uv = vec2<f32>(clip.x * 0.5 + 0.5, 0.5 - clip.y * 0.5);
    if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0 || clip.z <= 0.0 || clip.z >= 1.0) {
        return 1.0;
    }
    return textureSampleCompareLevel(shadow_map, shadow_sampler, uv, i, clip.z - info.y);
}

@vertex
fn vs_grass(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GrassOut {
    var out: GrassOut;
    let per = u32(grass.shape.x);
    let slot = ii / per;
    let k = ii - slot * per;
    let tile = grass.tiles[slot];
    let side = grass.shape.w;
    // the clump's place: the k-th point of the R2 sequence, offset by the square's seed
    let r2 = fract(vec2<f32>(tile.w, fract(tile.w * 7.31)) + f32(k) * vec2<f32>(0.7548776662, 0.5698402910));
    let centre = tile.xy + r2 * side;
    let d = distance(centre, globals.eye.xz);
    // past its number for this distance a clump sinks away (smoothly, over the last 15% of the clumps kept here)
    let kept = f32(per) * grass_share(d);
    var grow = clamp((kept - f32(k)) / max(0.15 * kept, 1.0), 0.0, 1.0);
    // where it grows
    var cover = 1.0;
    if (grass.map_area.w > 0.5) {
        cover = textureSampleLevel(grass_map, grass_sampler, grass_uv(centre, grass.map_area, grass.sizes.xy), 0.0).r;
    }
    let ck = grass_hash(k, u32(tile.w * 16777216.0));
    // (a thin cover keeps fewer clumps, and those shorter)
    grow = grow * smoothstep(ck * 0.85, ck * 0.85 + 0.15, cover);
    let blade = vi / 5u;
    let point = vi - blade * 5u;
    if (grow <= 0.001) {
        out.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
        out.color = vec3<f32>(0.0);
        return out;
    }
    let bseed = k * 8u + blade + u32(tile.w * 9973.0);
    let h1 = grass_hash(bseed, 1u);
    let h2 = grass_hash(bseed, 2u);
    let h3 = grass_hash(bseed, 3u);
    let h4 = grass_hash(bseed, 4u);
    // thinner far off, the clumps that are kept grow wider so the meadow keeps its cover
    let share = max(grass_share(d), 0.05);
    let widen = mix(1.0, inverseSqrt(share), 0.6);
    let around = h3 * 6.2831853;
    let out_dir = vec2<f32>(cos(around), sin(around));
    let root = centre + out_dir * (0.16 * sqrt(h2) * widen);
    let height = grass.base.w * (0.6 + 0.8 * h4) * grow * mix(0.55, 1.0, cover);
    let width = grass.misc.x * (0.75 + 0.5 * h1) * widen;
    let face = h1 * 6.2831853;
    let across = vec2<f32>(cos(face), sin(face));
    // how it leans: outwards from the clump, the wind's swell and flutter (a gust travels across the meadow along the wind),
    // and away from anything passing through it
    var lean = out_dir * height * (0.25 + 0.3 * h2);
    var gust = 0.0;
    if (globals.wind.z > 0.0 && grass.misc.y > 0.0) {
        let t = globals.wind.w;
        let wave = sin(t * 1.6 - dot(centre, globals.wind.xy) * 0.18 + sin(dot(centre, vec2<f32>(0.07, -0.05))) * 1.5);
        gust = 0.5 + 0.5 * wave;
        let flutter = sin(t * 6.3 + h3 * 31.0 + centre.x * 1.3 + centre.y * 1.1) * 0.25;
        let push = globals.wind.z * grass.misc.y * height * (0.25 + 0.45 * gust * gust + flutter * 0.4);
        lean = lean + globals.wind.xy * push;
    }
    let ground = grass_ground(root);
    let ground_y = ground.x;
    let bends = i32(grass.misc.z);
    var pressed = 0.0;
    for (var b = 0; b < bends; b = b + 1) {
        let q = grass.bends[b];
        let away = root - q.xz;
        let dist = length(away);
        let f = 1.0 - smoothstep(q.w * 0.45, q.w, dist);
        if (f > 0.0) {
            let dir = select(away / dist, out_dir, dist < 1e-3);
            lean = lean + dir * (height * 1.1 * f);
            pressed = max(pressed, f);
        }
    }
    // a blade keeps about its length: the more it leans, the lower its tip
    let lean_len = length(lean);
    let tip_y = height * sqrt(max(1.0 - min(lean_len / max(height, 1e-3), 0.95) * min(lean_len / max(height, 1e-3), 0.95), 0.1));
    var t = 0.0;
    var s = 0.0;
    if (point == 0u) { s = -1.0; }
    if (point == 1u) { s = 1.0; }
    if (point == 2u) { t = 0.55; s = -0.72; }
    if (point == 3u) { t = 0.55; s = 0.72; }
    if (point == 4u) { t = 1.0; }
    let curve = t * t;
    let xz = root + lean * curve + across * (s * width * 0.5);
    let world = vec3<f32>(xz.x, ground_y + tip_y * t - 0.08 * (1.0 - t), xz.y);
    // the ground's colour under the clump, as the painted ground lays its big patches on it (paint_ground's first two reads)
    var c = grass.base.rgb;
    if (grass.colors_area.w > 0.5) {
        c = textureSampleLevel(grass_colors, grass_sampler, grass_uv(centre, grass.colors_area, grass.sizes.zw), 0.0).rgb;
    }
    let pw = textureSampleLevel(paint_noise, paint_sampler, centre * (0.045 / 16.0) + vec2<f32>(0.19, 0.48), 0.0).r;
    let pm = textureSampleLevel(paint_noise, paint_sampler, centre * (0.14 / 16.0) + vec2<f32>(0.69, 0.31), 0.0).g;
    let patches = pw * 0.62 + pm * 0.38;
    c = c * mix(vec3<f32>(0.88, 0.98, 1.08), vec3<f32>(1.08, 1.03, 0.80), smoothstep(0.22, 0.78, patches)) * (0.9 + 0.2 * pm);
    let g = ground.yz;
    let n = safe_normalize(vec3<f32>(-g.x, 1.0, -g.y));
    let to_sun = safe_normalize(-globals.light_dir.xyz);
    let slope_lean = dot(n, to_sun) - to_sun.y;
    c = c * mix(vec3<f32>(1.0), select(vec3<f32>(0.94, 0.97, 1.04), vec3<f32>(1.10, 1.06, 0.90), slope_lean > 0.0), min(abs(slope_lean) * 2.2, 1.0));
    // darker at the root (where it meets the ground's own colour), lighter and warmer towards the tip, a sheen where a gust bends it
    let far_k = smoothstep(grass.shape.y, grass.shape.z, d);
    let tone = mix(mix(vec3<f32>(0.70, 0.74, 0.78), vec3<f32>(1.07, 1.06, 0.90), t), vec3<f32>(0.97), far_k * 0.7) * (1.0 + 0.05 * (h4 - 0.5));
    c = c * tone * (1.0 + t * (0.08 * gust * globals.wind.z * grass.misc.y + 0.12 * pressed));
    // the light: the ground's, softened a little towards the tip (light through the blade)
    let visible = mix(1.0 - globals.shadow.w, 1.0, grass_sun(world));
    let wrap = 0.35 * t;
    let diffuse = max((dot(n, to_sun) + wrap) / (1.0 + wrap), 0.0) * visible;
    let light = globals.ambient.rgb + globals.light_color.rgb * diffuse * (1.0 - globals.ambient.rgb);
    var rgb = c * light;
    if (globals.fog_color.w > 0.5) {
        let fd = distance(world, globals.eye.xyz);
        let f = clamp((fd - globals.fog_range.x) / (globals.fog_range.y - globals.fog_range.x), 0.0, 1.0);
        rgb = mix(rgb, globals.fog_color.rgb, f);
    }
    out.position = globals.view_proj * vec4<f32>(world, 1.0);
    out.color = rgb;
    return out;
}

@fragment
fn fs_grass(in: GrassOut) -> @location(0) vec4<f32> {
    return vec4<f32>(in.color, 1.0);
}
