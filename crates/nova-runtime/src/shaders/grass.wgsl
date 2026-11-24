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
    flora: vec4<f32>,          // x plants a square at the thickest; y the distance; z a plant's height; w the kinds
    flora_b: vec4<f32>,        // x plants a square metre in the patches; y the patches' size; z their cover; w the spots
    flora_c: vec4<f32>,        // x the most plants a square metre; y 1: fade by coverage (multisampling); z 1: flora on
    spots: array<vec4<f32>, 16>,
};
@group(3) @binding(20) var<uniform> grass: GrassParams;
@group(3) @binding(21) var grass_map: texture_2d<f32>;
@group(3) @binding(22) var grass_colors: texture_2d<f32>;
@group(3) @binding(23) var grass_sampler: sampler;
@group(3) @binding(24) var flora_picture: texture_2d<f32>;
@group(3) @binding(25) var flora_sampler: sampler;

struct GrassOut {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec3<f32>,
    // how much of the blade is left as it fades out with the distance (1 whole)
    @location(1) fade: f32,
};

// A fixed screen-door threshold for a pixel (interleaved gradient noise): a fade without multisampling keeps the pixels under it.
fn grass_door(pixel: vec2<f32>) -> f32 {
    return fract(52.9829189 * fract(dot(pixel, vec2<f32>(0.06711056, 0.00583715))));
}

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
    let ck = grass_hash(k, u32(tile.w * 16777216.0));
    // (each clump's distance is jittered by up to 9% either way, by its own number: the grass thins and ends with no ring)
    let d = distance(centre, globals.eye.xz) * (1.0 + 0.18 * (grass_hash(k, u32(tile.w * 9341.0)) - 0.5));
    // past its number for this distance a clump sinks away (slowly: the clumps from 20% under the count kept here to 20% over it
    // come up one after another as the camera nears, over a few metres of a walk, never in a frame)
    let kept = f32(per) * grass_share(d);
    var grow = clamp((kept * 1.2 - f32(k)) / max(0.4 * kept, 1.0), 0.0, 1.0);
    // where it grows
    var cover = 1.0;
    if (grass.map_area.w > 0.5) {
        cover = textureSampleLevel(grass_map, grass_sampler, grass_uv(centre, grass.map_area, grass.sizes.xy), 0.0).r;
    }
    // (a thin cover keeps fewer clumps, and those shorter)
    grow = grow * smoothstep(ck * 0.85, ck * 0.85 + 0.15, cover);
    // over the last quarter of the distance what is left also dithers away
    out.fade = min(grow * 2.0, 1.0) * (1.0 - smoothstep(grass.shape.z * 0.75, grass.shape.z, d));
    let blade = vi / 5u;
    let point = vi - blade * 5u;
    if (grow <= 0.001 || out.fade <= 0.001) {
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
    // a fading blade: by coverage with multisampling (soft), else by a fixed screen-door
    if (grass.flora_c.y > 0.5) {
        return vec4<f32>(in.color, in.fade);
    }
    if (in.fade < 0.999 && in.fade < grass_door(in.position.xy)) {
        discard;
    }
    return vec4<f32>(in.color, 1.0);
}

// ---- flora: flowers and small plants among the grass (`nova.grass { flowers = { ... } }`, Flora in gfx/grass.rs) ----
// Painted pictures stood upright on the ground and turned to the camera (a quad of two triangles a plant, made from the vertex and
// instance numbers), placed like the clumps (the k-th point of an R2 sequence over each square), kept where a patch or a garden spot
// says, swaying and bending with the grass, lit like the ground, fading in and out with the distance. `Grass::flora_places` is the
// CPU's copy of where they stand: keep the two the same.

struct FloraOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) light: vec3<f32>,
    @location(2) world: vec3<f32>,
    @location(3) fade: f32,
};

// Value noise over the ground, 0 to 1, one cell a unit (value_noise in grass.rs).
fn flora_noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = p - i;
    let u = f * f * (vec2<f32>(3.0) - 2.0 * f);
    let a = bitcast<u32>(i32(i.x));
    let b = bitcast<u32>(i32(i.y)) + 7919u;
    let c00 = grass_hash(a, b);
    let c10 = grass_hash(a + 1u, b);
    let c01 = grass_hash(a, b + 1u);
    let c11 = grass_hash(a + 1u, b + 1u);
    let top = c00 + (c10 - c00) * u.x;
    let bottom = c01 + (c11 - c01) * u.x;
    return top + (bottom - top) * u.y;
}

// Plants a square metre at `p` (x) and the kind there (y), `h` the plant's own random number (flora_here in grass.rs).
fn flora_here(p: vec2<f32>, h: f32) -> vec2<f32> {
    var dens = 0.0;
    var in_spot = false;
    let spots = i32(grass.flora_b.w);
    for (var s = 0; s < spots; s = s + 1) {
        let q = grass.spots[s];
        let d = distance(p, q.xy);
        if (d < q.z) {
            in_spot = true;
            let t = clamp((d - q.z * 0.6) / (q.z * 0.4), 0.0, 1.0);
            dens = max(dens, q.w * (1.0 - t * t * (3.0 - 2.0 * t)));
        }
    }
    // (in the patches only where the grass is full; in a spot where there is grass at all: never on a road, a path or a porch)
    var cover = 1.0;
    if (grass.map_area.w > 0.5) {
        cover = textureSampleLevel(grass_map, grass_sampler, grass_uv(p, grass.map_area, grass.sizes.xy), 0.0).r;
    }
    if (in_spot && cover < 0.5) {
        dens = 0.0;
    }
    if (!in_spot) {
        if (cover >= 0.95) {
            let inv = 1.0 / max(grass.flora_b.y, 0.5);
            let n = flora_noise(p * inv);
            let edge = 1.0 - grass.flora_b.z;
            let t = clamp((n - (edge - 0.1)) / 0.2, 0.0, 1.0);
            dens = grass.flora_b.x * t * t * (3.0 - 2.0 * t);
        }
    }
    let inv2 = 1.0 / (max(grass.flora_b.y, 0.5) * 1.7);
    let n2 = flora_noise(p * inv2 + vec2<f32>(31.7, 17.3));
    let pick = clamp(n2 * 1.3 - 0.15 + (h - 0.5) * 0.35, 0.0, 0.999);
    return vec2<f32>(dens, floor(pick * grass.flora.w));
}

@vertex
fn vs_flora(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FloraOut {
    var out: FloraOut;
    let per = u32(grass.flora.x);
    let slot = ii / per;
    let k = ii - slot * per;
    let tile = grass.tiles[slot];
    let su = u32(tile.w * 16777216.0);
    let off = vec2<f32>(fract(tile.w * 3.7 + 0.31), fract(tile.w * 5.3 + 0.67));
    let r2 = fract(off + f32(k) * vec2<f32>(0.7548776662, 0.5698402910));
    let p = tile.xy + r2 * grass.shape.w;
    // (this square's own count: the most plants a square metre in it, tile.z, as Flora::per_tile_in)
    let most = tile.z;
    let local = clamp(ceil(most * grass.shape.w * grass.shape.w), 1.0, 1024.0);
    // thinning further off (the first plants of a square are kept longest) and gone by the distance, each plant at its own; the
    // cheap test first, so a plant that is not drawn costs a few instructions
    let dist = distance(p, globals.eye.xz) * (1.0 + 0.2 * (grass_hash(k, su + 53u) - 0.5));
    let fd = grass.flora.y;
    let near = fd * 0.35;
    let share = select(pow(near / max(dist, 1e-3), 0.7), 1.0, dist <= near);
    let kept = local * share;
    let grow = clamp((kept * 1.4 - f32(k)) / max(0.4 * kept, 1.0), 0.0, 1.0);
    let fade = grow * (1.0 - smoothstep(fd * 0.66, fd, dist));
    if (fade <= 0.001) {
        out.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
        return out;
    }
    let here = flora_here(p, grass_hash(k, su + 31u));
    if (grass_hash(k, su + 77u) * most >= here.x) {
        out.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
        return out;
    }
    let h2 = grass_hash(k, su + 91u);
    let h3 = grass_hash(k, su + 113u);
    let h4 = grass_hash(k, su + 157u);
    // a fading plant is smaller too: it comes up out of the grass rather than appearing
    let size = grass.flora.z * (0.7 + 0.6 * h2) * mix(0.55, 1.0, fade);
    // (the quad's four corners: GrassGpu's index list makes the two triangles)
    let q = vec2<f32>(f32(vi & 1u), f32(vi >> 1u));
    let to_eye = globals.eye.xz - p;
    let el = length(to_eye);
    let dir = select(vec2<f32>(0.0, 1.0), to_eye / el, el > 1e-3);
    let right = vec2<f32>(dir.y, -dir.x);
    // the wind (the grass's swell, flutter and gusts) and anything passing through
    var lean = vec2<f32>(0.0);
    if (globals.wind.z > 0.0 && grass.misc.y > 0.0) {
        let t = globals.wind.w;
        let wave = sin(t * 1.6 - dot(p, globals.wind.xy) * 0.18 + sin(dot(p, vec2<f32>(0.07, -0.05))) * 1.5);
        let gust = 0.5 + 0.5 * wave;
        let flutter = sin(t * 5.1 + h3 * 27.0 + p.x * 1.1 + p.y * 0.9) * 0.25;
        lean = globals.wind.xy * (globals.wind.z * grass.misc.y * size * (0.12 + 0.3 * gust * gust + flutter * 0.3));
    }
    let bends = i32(grass.misc.z);
    for (var b = 0; b < bends; b = b + 1) {
        let bq = grass.bends[b];
        let away = p - bq.xz;
        let bd = length(away);
        let f = 1.0 - smoothstep(bq.w * 0.45, bq.w * 1.1, bd);
        if (f > 0.0) {
            lean = lean + select(away / bd, dir, bd < 1e-3) * (size * 0.9 * f);
        }
    }
    let lean_k = min(length(lean) / max(size, 1e-3), 0.9);
    let t = q.y;
    let ground = grass_ground(p);
    // upright, turned a little back towards an eye that looks down on it (from the van, or from above, a picture stood straight up
    // would be seen edge on): the picture's up is 55% of the way from the world's up to the view's
    let root = vec3<f32>(p.x, ground.x - 0.03, p.y);
    let right3 = vec3<f32>(right.x, 0.0, right.y);
    let view = safe_normalize(globals.eye.xyz - (root + vec3<f32>(0.0, size * 0.5, 0.0)));
    let up3 = safe_normalize(mix(vec3<f32>(0.0, 1.0, 0.0), cross(view, right3), 0.55));
    let rise = t * size * sqrt(1.0 - lean_k * lean_k * t);
    out.world = root + right3 * ((q.x - 0.5) * size) + up3 * rise + vec3<f32>(lean.x, 0.0, lean.y) * (t * t);
    // lit as the ground under it, the sun wrapping round a little, darker at its foot among the blades
    let n = safe_normalize(vec3<f32>(-ground.y, 1.0, -ground.z));
    let to_sun = safe_normalize(-globals.light_dir.xyz);
    // (the sun on the plant's middle as the ground's own shadow has it: filtered over a few texels, and blended from one map to the
    // next where the fine near map ends. One unfiltered look in whichever map the point fell in lit or darkened the whole plant at
    // once: a plant at a shadow's edge blinked as a crown's shadow swayed, as the shadow maps stepped with the camera, and as the
    // camera's turn moved it from the near map to the wide one)
    let visible = mix(1.0 - globals.shadow.w, 1.0, sun_visibility(vec3<f32>(p.x, ground.x + size * 0.5, p.y), n));
    let diffuse = max((dot(n, to_sun) + 0.3) / 1.3, 0.0) * visible;
    out.light = (globals.ambient.rgb + globals.light_color.rgb * diffuse * (1.0 - globals.ambient.rgb)) * mix(0.72, 1.0, t);
    let u = select(q.x, 1.0 - q.x, h4 < 0.5);
    out.uv = vec2<f32>((here.y + 0.03 + u * 0.94) / grass.flora.w, 0.995 - t * 0.99);
    out.fade = fade;
    out.position = globals.view_proj * vec4<f32>(out.world, 1.0);
    return out;
}

// How much of the picture covers this pixel (0 to 1), before the plant's fade.
fn flora_cover(alpha: f32, uv: vec2<f32>) -> f32 {
    // texels of the picture a pixel spans (more than 1: the picture is drawn smaller than it is, from its smaller levels)
    let span = uv * vec2<f32>(textureDimensions(flora_picture, 0));
    let texels = max(length(dpdx(span)), length(dpdy(span)));
    // where it is drawn larger than it is, the blurred edge of the magnified picture is sharpened back to about a pixel; where it
    // is drawn smaller, its filtered alpha already is the share of the pixel the plant covers (a thin stem is a faint line), so it
    // is given nearly as it is (at most twice as steep round the cut). Sharpening that too made every texel-thin stem and petal
    // edge a hard cut that came and went as the pixels slid over it.
    let edge = max(fwidth(alpha), mix(1e-3, 0.5, clamp(texels - 1.0, 0.0, 1.0)));
    return clamp((alpha - 0.45) / edge + 0.5, 0.0, 1.0);
}

// What is drawn solid (writing the depth) from what is blended over the rest: covered at least this much.
const FLORA_SOLID: f32 = 0.95;

// The flora is drawn in two passes (the owner on the device: "The flowers flicker for some reason"; tests/flora_gpu.rs,
// flowers_hold_steady_as_the_camera_turns_and_walks). First what is solid, the inside of each picture, writing the depth; then
// everything else blended over it, without writing the depth: the edges of the pictures, their thin stems and petals, and whole
// plants fading in or out with the distance. Before, the edges and the fades were drawn by coverage (alpha-to-coverage, the
// pixel's four samples): a pixel that a petal's edge covers by a share can only take 0, 1, 2, 3 or 4 of them, so as the camera
// moved each edge pixel stepped by a quarter of the flower's contrast with the grass, and a thin stem or a fading plant (a
// dissolve over the screen's own pattern without multisampling) crawled. Blended, a pixel changes as smoothly as the share
// does. The blended part is not sorted among the plants: two edges over one pixel are rare and both faint.
@fragment
fn fs_flora(in: FloraOut) -> @location(0) vec4<f32> {
    let c = textureSample(flora_picture, flora_sampler, in.uv);
    let a = flora_cover(c.a, in.uv) * in.fade;
    if (a < FLORA_SOLID) {
        discard;
    }
    return vec4<f32>(fog_over(in.world, c.rgb * in.light), 1.0);
}

@fragment
fn fs_flora_soft(in: FloraOut) -> @location(0) vec4<f32> {
    let c = textureSample(flora_picture, flora_sampler, in.uv);
    let a = flora_cover(c.a, in.uv) * in.fade;
    if (a < 0.004 || a >= FLORA_SOLID) {
        discard;
    }
    return vec4<f32>(fog_over(in.world, c.rgb * in.light), a);
}
