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

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    let far = globals.inv_view_proj * vec4<f32>(in.ndc, 1.0, 1.0);
    let dir = normalize(far.xyz / far.w - globals.eye.xyz);
    let t = smoothstep(0.0, 0.55, dir.y);
    var rgb = mix(globals.sky_horizon.rgb, globals.sky_top.rgb, t);
    let day = globals.voxel.x;
    // stars: a sparse grid of points on the sphere, twinkling, only when it is dark enough
    if (globals.sky_sun.w > 0.0 && dir.y > -0.05) {
        let cell = floor(dir * 160.0);
        let h = hash3(cell);
        if (h > 0.9965) {
            let centre = (cell + vec3<f32>(0.5)) / 160.0;
            let near = 1.0 - smoothstep(0.0, 0.0045, length(dir - normalize(centre)));
            let twinkle = 0.7 + 0.3 * sin(globals.sky_extra.y * 3.0 + h * 500.0);
            rgb = rgb + vec3<f32>(near * twinkle * globals.sky_sun.w * (0.5 + h * 0.5));
        }
    }
    // sun and moon, opposite each other
    if (globals.sky_extra.z > 0.5) {
        let to_sun = normalize(globals.sky_sun.xyz);
        let sd = dot(dir, to_sun);
        let disc = smoothstep(0.9993, 0.99955, sd);
        let halo = pow(max(sd, 0.0), 48.0) * 0.28;
        rgb = rgb + vec3<f32>(1.0, 0.86, 0.55) * (halo * day) + vec3<f32>(1.0, 0.97, 0.85) * disc * 1.6;
        let md = dot(dir, -to_sun);
        let moon = smoothstep(0.9994, 0.99962, md);
        rgb = mix(rgb, vec3<f32>(0.88, 0.92, 1.0), moon * 0.95);
    }
    // clouds: a flat layer high up, drifting, fading into the haze at the horizon
    if (globals.sky_extra.x > 0.0 && dir.y > 0.03) {
        let along = 380.0 / dir.y;
        let p = (globals.eye.xz + dir.xz * along) * 0.0045 + vec2<f32>(globals.sky_extra.y * 0.004, globals.sky_extra.y * 0.0015);
        let n = value_noise(p) * 0.55 + value_noise(p * 2.3) * 0.3 + value_noise(p * 5.1) * 0.15;
        let cover = 1.0 - globals.sky_extra.x * 0.75;
        let c = smoothstep(cover, cover + 0.2, n) * smoothstep(0.03, 0.22, dir.y);
        let lit = mix(vec3<f32>(0.18, 0.2, 0.28), vec3<f32>(1.0, 0.99, 0.97), clamp(day, 0.0, 1.0));
        rgb = mix(rgb, lit, c * 0.92);
    }
    return vec4<f32>(rgb, 1.0);
}
