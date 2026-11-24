// The sky: one triangle over the screen, coloured by how far above the horizon each pixel looks.
struct Globals {
    view_proj: mat4x4<f32>,
    light_dir: vec4<f32>,
    light_color: vec4<f32>,
    ambient: vec4<f32>,
    point_pos: array<vec4<f32>, 20>,
    point_color: array<vec4<f32>, 20>,
    inv_view_proj: mat4x4<f32>,
    eye: vec4<f32>,
    sky_top: vec4<f32>,
    sky_horizon: vec4<f32>,
    fog_color: vec4<f32>,
    fog_range: vec4<f32>,
    light_view_proj: mat4x4<f32>,
    shadow: vec4<f32>,
    voxel: vec4<f32>,
    sky_sun: vec4<f32>,     // xyz: towards the sun, w: how many stars show
    sky_extra: vec4<f32>,   // x: cloud cover, y: time, z: 1 when there is a sun and moon
    wind: vec4<f32>,        // xy: the way the wind blows, z: how strong, w: time
    point_dir: array<vec4<f32>, 20>,
    terrain: array<vec4<f32>, 9>,
    terrain_map: array<vec4<f32>, 2>,
    cascade_vp: array<mat4x4<f32>, 3>,
    cascade_info: array<vec4<f32>, 3>,
    cascade_count: vec4<f32>,
    ground: vec4<f32>,
    see_through: vec4<f32>,
    see_through_opts: vec4<f32>,
    see_through_near: vec4<f32>,
    outline_view: vec4<f32>,
    sky_paint: vec4<f32>,   // x: 1 for the painted look, y: the sun's disc's radius (radians)
    sky_far: vec4<f32>,     // rgb: the far hills along the horizon, w: their height (radians; 0: none)
};
@group(0) @binding(0) var<uniform> globals: Globals;

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) ndc: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VertexOut {
    // (0,0) (2,0) (0,2) in uv space covers the screen
    let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    var out: VertexOut;
    out.ndc = uv * 2.0 - vec2<f32>(1.0, 1.0);
    out.position = vec4<f32>(out.ndc, 1.0, 1.0);
    return out;
}

fn hash3(p: vec3<f32>) -> f32 {
    var q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
    q = q + dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

fn hash2(p: vec2<f32>) -> f32 {
    var q = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    q = q + dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

fn value_noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2<f32>(1.0, 0.0)), u.x), mix(hash2(i + vec2<f32>(0.0, 1.0)), hash2(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}

// The sky is drawn from the sun's place. Its colours are the game's (top and horizon: what the sky is at this hour); the sun adds to them what a
// sun does: a disc that goes from white to orange as it sinks, a halo, a glow along the horizon that is strongest under a low sun and on the
// sun's side, clouds that it lights (bright edges towards it, dark undersides, orange at sunset, grey at night), stars that come out as it sets
// and a moon opposite it. With no sun in the sky the sun's elevation is taken as noon and the sky is as it always was.
@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    let far = globals.inv_view_proj * vec4<f32>(in.ndc, 1.0, 1.0);
    let dir = normalize(far.xyz / far.w - globals.eye.xyz);
    if (globals.sky_paint.x > 0.5) {
        return vec4<f32>(painted_sky(dir), 1.0);
    }
    let has_sun = globals.sky_extra.z > 0.5;
    let sun = normalize(select(vec3<f32>(0.0, 1.0, 0.0), globals.sky_sun.xyz, has_sun));
    let elevation = sun.y;
    // how bright the day is (0 at night, 1 by day), and how much the sun is near the horizon (the golden hour, and the dusk after it)
    let daylight = select(globals.voxel.x, smoothstep(-0.12, 0.22, elevation), has_sun);
    let low = select(0.0, (1.0 - smoothstep(0.0, 0.5, elevation)) * smoothstep(-0.22, -0.02, elevation), has_sun);
    // the sun's own colour: white overhead, orange where the air is thick
    let sun_colour = mix(vec3<f32>(1.0, 0.5, 0.22), vec3<f32>(1.0, 0.96, 0.84), smoothstep(0.0, 0.5, elevation));
    let t = smoothstep(0.0, 0.55, dir.y);
    var rgb = mix(globals.sky_horizon.rgb, globals.sky_top.rgb, t);
    // a haze that thickens towards the horizon
    rgb = mix(rgb, globals.sky_horizon.rgb * 1.06, exp(-max(dir.y, 0.0) * 7.0) * 0.35);
    // the glow along the horizon, on the sun's side
    if (has_sun && low > 0.0) {
        let side = max(dot(normalize(dir.xz + vec2<f32>(1e-5)), normalize(sun.xz + vec2<f32>(1e-5))), 0.0);
        let band = exp(-max(dir.y, 0.0) * (4.0 + 6.0 * (1.0 - low)));
        rgb = rgb + sun_colour * pow(side, 2.2) * band * low * 0.7 + sun_colour * band * low * 0.08;
    }
    // stars: a sparse grid of points on the sphere, twinkling; as many as the game says, fading in as the sun sets
    let dark = select(1.0, 1.0 - smoothstep(-0.12, 0.12, elevation), has_sun);
    if (globals.sky_sun.w > 0.0 && dark > 0.0 && dir.y > -0.05) {
        let cell = floor(dir * 160.0);
        let h = hash3(cell);
        if (h > 0.9965) {
            let centre = (cell + vec3<f32>(0.5)) / 160.0;
            let near = 1.0 - smoothstep(0.0, 0.0045, length(dir - normalize(centre)));
            let twinkle = 0.7 + 0.3 * sin(globals.sky_extra.y * 3.0 + h * 500.0);
            rgb = rgb + vec3<f32>(near * twinkle * globals.sky_sun.w * dark * (0.5 + h * 0.5));
        }
    }
    // sun and moon, opposite each other
    if (has_sun) {
        let sd = dot(dir, sun);
        let up = smoothstep(-0.06, 0.02, elevation); // the sun sets behind the ground
        let disc = smoothstep(0.99925, 0.99955, sd);
        let halo = pow(max(sd, 0.0), 14.0) * 0.22 + pow(max(sd, 0.0), 90.0) * 0.55;
        rgb = rgb + sun_colour * halo * up + sun_colour * disc * 1.8 * up;
        let md = dot(dir, -sun);
        let moon_up = smoothstep(0.1, -0.05, elevation);
        let moon = smoothstep(0.9994, 0.99962, md);
        rgb = mix(rgb, vec3<f32>(0.88, 0.92, 1.0), moon * 0.95 * moon_up);
        rgb = rgb + vec3<f32>(0.5, 0.6, 0.9) * pow(max(md, 0.0), 60.0) * 0.12 * moon_up;
    }
    // clouds: a flat layer high up, drifting, fading into the haze at the horizon. The sun lights them: their edges towards it are bright,
    // their undersides dark, and under a low sun they take its colour.
    if (globals.sky_extra.x > 0.0 && dir.y > 0.03) {
        let along = 380.0 / dir.y;
        let p = (globals.eye.xz + dir.xz * along) * 0.0045 + vec2<f32>(globals.sky_extra.y * 0.004, globals.sky_extra.y * 0.0015);
        let n = value_noise(p) * 0.55 + value_noise(p * 2.3) * 0.3 + value_noise(p * 5.1) * 0.15;
        let cover = 1.0 - globals.sky_extra.x * 0.75;
        let c = smoothstep(cover, cover + 0.2, n) * smoothstep(0.03, 0.22, dir.y);
        // the same cloud a step towards the sun: if it is thinner there this edge faces the light
        let toward = normalize(sun.xz + vec2<f32>(1e-5)) * 0.06;
        let n2 = value_noise(p + toward) * 0.55 + value_noise((p + toward) * 2.3) * 0.3 + value_noise((p + toward) * 5.1) * 0.15;
        let facing = clamp(0.5 + (n - n2) * 6.0, 0.0, 1.0);
        let day_light = clamp(daylight, 0.0, 1.0);
        let shade = mix(vec3<f32>(0.14, 0.16, 0.24), vec3<f32>(0.62, 0.66, 0.78), day_light);
        let bright = mix(vec3<f32>(0.2, 0.22, 0.32), mix(vec3<f32>(1.0, 0.99, 0.97), sun_colour * 1.1, low * 0.75), day_light);
        let lit = mix(shade, bright, select(1.0, 0.35 + 0.65 * facing, has_sun));
        rgb = mix(rgb, lit, c * 0.92);
    }
    return vec4<f32>(rgb, 1.0);
}

// ---- the painted sky (`nova.sky { style = "painted" }`): a backdrop painted round the camera, like a toy theatre's ----
// Everything is placed by the way the pixel looks (its bearing round the horizon and its height above it), so it never comes nearer:
// a soft gradient, a far range of rounded hills along the horizon, three bands of rounded clouds (far and small low down, near and big
// higher up) drifting at their own speeds, and a round sun with a wide soft glow. Each cloud is a few circles standing on a flat base,
// in one cell of its band (so a pixel looks at two cells a band, at most), shaded in two flat tones with a soft painted line between
// them and a lit rim on the sun's side.

const TAU: f32 = 6.2831853;

fn smin(a: f32, b: f32, k: f32) -> f32 {
    let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Rounded bumps along a circle of `period` cells (smoothstep between random heights, so each bump is round on top).
fn bumps(x: f32, period: f32, seed: f32) -> f32 {
    let i = floor(x);
    let f = fract(x);
    let a = hash2(vec2<f32>(i - period * floor(i / period), seed));
    let j = i + 1.0;
    let b = hash2(vec2<f32>(j - period * floor(j / period), seed));
    return mix(a, b, f * f * (3.0 - 2.0 * f));
}

// One cloud of a band at cell `c` (u, v in cell units; v from the band's base): x its signed distance (negative inside), y its height
// above its base and z its place across, both as fractions of its half width. Far away (x = 1000) when the cell has no cloud.
fn cloud_shape(u: f32, v: f32, c: f32, cn: f32, band: f32, cover: f32) -> vec3<f32> {
    let seed = band * 7.31;
    if (hash2(vec2<f32>(cn, seed + 1.0)) > cover) {
        return vec3<f32>(1000.0, 0.0, 0.0);
    }
    let w = 0.35 + 0.3 * hash2(vec2<f32>(cn + 0.37, seed + 2.0));
    let cx = c + 0.5 + (hash2(vec2<f32>(cn + 0.71, seed + 3.0)) - 0.5) * 0.24;
    let base = (hash2(vec2<f32>(cn + 0.13, seed + 4.0)) - 0.4) * 0.35;
    let p = vec2<f32>(u - cx, v - base);
    var d = 1000.0;
    for (var k = 0; k < 5; k = k + 1) {
        let s = f32(k) * 0.25 - 0.5;
        let jitter = hash2(vec2<f32>(cn + f32(k) * 0.29, seed + 5.0));
        let r = w * (0.48 - 0.42 * s * s * 2.2) * (0.85 + 0.3 * jitter);
        let x = s * w * 1.1;
        d = smin(d, length(p - vec2<f32>(x, r * 0.55)) - r, 0.07 * w);
    }
    d = max(d, -p.y);
    return vec3<f32>(d, p.y / w, p.x / w);
}

fn painted_sky(dir: vec3<f32>) -> vec3<f32> {
    let elev = asin(clamp(dir.y, -1.0, 1.0));
    let az = atan2(dir.x, dir.z);
    let time = globals.sky_extra.y;
    let has_sun = globals.sky_extra.z > 0.5;
    let sun = normalize(select(vec3<f32>(0.0, 1.0, 0.0), globals.sky_sun.xyz, has_sun));
    let sun_up = select(0.0, smoothstep(-0.06, 0.04, sun.y), has_sun);
    let sun_colour = mix(vec3<f32>(1.0, 0.62, 0.36), vec3<f32>(1.0, 0.95, 0.84), smoothstep(0.0, 0.45, sun.y));
    // (the angle to the sun, precise near it)
    let to_sun = 2.0 * asin(clamp(length(dir - sun) * 0.5, 0.0, 1.0));
    // the gradient: the horizon's colour low down, the top's overhead, eased like a wash of paint
    let t = 1.0 - exp(-max(elev, 0.0) * 3.0);
    var rgb = mix(globals.sky_horizon.rgb, globals.sky_top.rgb, t);
    // the haze along the horizon lit on the sun's side, as the haze over the land is (mesh.wgsl fog_over)
    let sunward = max(dot(dir, sun), 0.0);
    rgb = rgb + globals.light_color.rgb * (globals.voxel.w * 0.3 * pow(sunward, 6.0) * exp(-max(elev, 0.0) * 6.0) * sun_up);
    // the sun's glow, wide and soft, and its disc
    if (has_sun) {
        let r = max(globals.sky_paint.y, 0.002);
        let glow = 0.32 * exp(-to_sun / (r * 3.5)) + 0.12 * exp(-to_sun / 0.4);
        rgb = rgb + sun_colour * glow * sun_up;
        let disc = 1.0 - smoothstep(r * 0.86, r * 1.06, to_sun);
        rgb = mix(rgb, mix(vec3<f32>(1.0, 0.99, 0.93), sun_colour, 0.25), disc * sun_up);
    }
    let cover = clamp(globals.sky_extra.x, 0.0, 1.0);
    let wind = 1.0 + globals.wind.z * 0.5;
    let pix = max(fwidth(elev), 1e-4);
    // three bands, far to near; the far hills stand in front of the farthest
    for (var band = 0; band < 3; band = band + 1) {
        if (band == 1 && globals.sky_far.w > 0.0) {
            rgb = far_hills(rgb, az, elev, pix);
        }
        if (cover <= 0.0) {
            continue;
        }
        let fb = f32(band);
        let cells = select(select(13.0, 21.0, band == 1), 34.0, band == 0);
        let base = select(select(0.15, 0.075, band == 1), 0.032, band == 0);
        let speed = select(select(0.0042, 0.0028, band == 1), 0.0018, band == 0);
        let haze = select(select(0.08, 0.22, band == 1), 0.42, band == 0);
        let u = fract((az + time * speed * wind) / TAU + 0.5) * cells;
        let v = (elev - base) / TAU * cells;
        if (v < -0.4 || v > 1.4) {
            continue;
        }
        let c = floor(u);
        let other = select(c - 1.0, c + 1.0, fract(u) > 0.5);
        var best = cloud_shape(u, v, c, c, fb, cover * 0.9);
        let second = cloud_shape(u, v, other, other - cells * floor(other / cells), fb, cover * 0.9);
        if (second.x < best.x) {
            best = second;
        }
        let soft = 0.005 + pix / TAU * cells;
        let alpha = 1.0 - smoothstep(-soft, soft, best.x);
        if (alpha <= 0.0) {
            continue;
        }
        // two flat tones: the lit body and its shaded underside, parted by a gently wavy painted line
        let lit = mix(vec3<f32>(0.8, 0.78, 0.72), globals.sky_horizon.rgb, haze);
        let shade = mix(lit * vec3<f32>(0.8, 0.84, 0.94), globals.sky_top.rgb, 0.12);
        let line = 0.24 + 0.05 * sin(best.z * 9.0 + fb * 2.0);
        var colour = mix(shade, lit, smoothstep(line - 0.03, line + 0.03, best.y));
        // a lit rim on the side towards the sun, brighter the nearer the sun is
        let rim = 1.0 - smoothstep(0.0, 0.09, -best.x);
        let da = atan2(sin(atan2(sun.x, sun.z) - az), cos(atan2(sun.x, sun.z) - az));
        let towards = normalize(vec2<f32>(da, asin(clamp(sun.y, -1.0, 1.0)) - elev) + vec2<f32>(1e-5, 0.0));
        let outward = normalize(vec2<f32>(best.z, best.y - 0.3) + vec2<f32>(1e-5, 0.0));
        let side = smoothstep(-0.2, 0.8, dot(outward, towards));
        let near_sun = 0.25 + 1.2 * exp(-to_sun / 0.35);
        colour = colour + sun_colour * (rim * side * near_sun * 0.22 * sun_up);
        rgb = mix(rgb, colour, alpha * smoothstep(-0.01, 0.03, elev) * (0.82 + 0.18 * cover));
    }
    if (globals.sky_far.w > 0.0 && cover <= 0.0) {
        rgb = far_hills(rgb, az, elev, pix);
    }
    return rgb;
}

// The far range: a paler back ridge and a nearer one in the game's colour, rounded bumps all round the horizon (below the horizon
// it is the nearer ridge, so the end of the view is never an empty sky under the land).
fn far_hills(rgb_in: vec3<f32>, az: f32, elev: f32, pix: f32) -> vec3<f32> {
    let h = globals.sky_far.w;
    let x = (az / TAU + 0.5) * 48.0;
    let back = h * (0.42 + 0.42 * bumps(x * 0.5, 24.0, 11.0) + 0.16 * bumps(x * 1.5, 72.0, 12.0));
    let front = h * (0.12 + 0.36 * bumps(x * 0.75 + 3.0, 36.0, 13.0) + 0.1 * bumps(x * 2.0, 96.0, 14.0));
    let aa = pix * 1.2;
    // their feet stand in the haze (the fog's colour, as the land at the end of the view is): each ridge is its colour at the top and
    // the haze at the horizon
    let mist = select(globals.sky_horizon.rgb, globals.fog_color.rgb, globals.fog_color.w > 0.5);
    let back_colour = mix(globals.sky_far.rgb, globals.sky_horizon.rgb, 0.45);
    let back_tone = mix(mist, back_colour, smoothstep(-0.2 * h, back, elev));
    var rgb = mix(rgb_in, back_tone, 1.0 - smoothstep(back - aa, back + aa, elev));
    let front_tone = mix(mist, globals.sky_far.rgb, smoothstep(-0.1 * h, front * 1.1, elev));
    rgb = mix(rgb, front_tone, 1.0 - smoothstep(front - aa, front + aa, elev));
    return rgb;
}
