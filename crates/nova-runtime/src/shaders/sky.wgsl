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
