// The sky as light, drawn into the faces and levels of a small cube map (`Gfx::update_environment`): what a shiny surface reflects (the
// levels are the sky blurred by roughness) and, at the blurriest levels, the light that falls on a surface from every side. Made again only
// when the sky's colours or the sun move; there is nothing to author. The sun's disc is left out (the sun is its own light, with a shadow);
// its halo and the glow it lays along the horizon are in.
struct Env {
    top: vec4<f32>,
    horizon: vec4<f32>,
    sun: vec4<f32>,       // xyz: the way to the sun, w: 1 when the sky has one
};
@group(0) @binding(0) var<uniform> env: Env;

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) @interpolate(flat) job: u32,
};

// One triangle over the face; the instance says which face and level (level * 6 + face).
@vertex
fn vs_main(@builtin(vertex_index) i: u32, @builtin(instance_index) job: u32) -> VertexOut {
    let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    var out: VertexOut;
    out.position = vec4<f32>(uv * 2.0 - vec2<f32>(1.0, 1.0), 0.0, 1.0);
    out.job = job;
    return out;
}

// The direction a texel of a cube face looks along (OpenGL's cube map layout; sc runs along the row, tc down the column).
fn face_direction(face: u32, sc: f32, tc: f32) -> vec3<f32> {
    switch face {
        case 0u: { return vec3<f32>(1.0, -tc, -sc); }
        case 1u: { return vec3<f32>(-1.0, -tc, sc); }
        case 2u: { return vec3<f32>(sc, 1.0, tc); }
        case 3u: { return vec3<f32>(sc, -1.0, -tc); }
        case 4u: { return vec3<f32>(sc, -tc, 1.0); }
        default: { return vec3<f32>(-sc, -tc, -1.0); }
    }
}

fn environment(dir: vec3<f32>, rough: f32) -> vec3<f32> {
    // the gradient widens and the haze spreads with the roughness
    let t = smoothstep(0.0, 0.55 + 0.9 * rough, dir.y);
    var rgb = mix(env.horizon.rgb, env.top.rgb, t);
    rgb = mix(rgb, env.horizon.rgb * 1.06, exp(-max(dir.y, 0.0) * 7.0 / (1.0 + 3.0 * rough)) * 0.35);
    // below the horizon: the ground, as the horizon's colour, darker
    rgb = mix(env.horizon.rgb * 0.45, rgb, smoothstep(-0.25 - 0.6 * rough, 0.0, dir.y));
    if (env.sun.w > 0.5) {
        let sun = normalize(env.sun.xyz);
        let elevation = sun.y;
        let sun_colour = mix(vec3<f32>(1.0, 0.5, 0.22), vec3<f32>(1.0, 0.96, 0.84), smoothstep(0.0, 0.5, elevation));
        let low = (1.0 - smoothstep(0.0, 0.5, elevation)) * smoothstep(-0.22, -0.02, elevation);
        let up = smoothstep(-0.06, 0.02, elevation);
        let sd = max(dot(dir, sun), 0.0);
        let halo = pow(sd, mix(14.0, 2.0, rough)) * 0.22 + pow(sd, mix(90.0, 6.0, rough)) * 0.55 * (1.0 - rough);
        rgb = rgb + sun_colour * halo * up;
        // the glow along the horizon on the sun's side
        let side = max(dot(normalize(dir.xz + vec2<f32>(1e-5)), normalize(sun.xz + vec2<f32>(1e-5))), 0.0);
        let band = exp(-max(dir.y, 0.0) * (4.0 + 6.0 * (1.0 - low)) / (1.0 + 2.0 * rough));
        rgb = rgb + sun_colour * pow(side, 2.2) * band * low * 0.7 + sun_colour * band * low * 0.08;
    }
    return rgb;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    let level = in.job / 6u;
    let face = in.job % 6u;
    let size = f32(32u >> level);
    let s = in.position.x / size;
    let t = in.position.y / size;
    let dir = normalize(face_direction(face, 2.0 * s - 1.0, 2.0 * t - 1.0));
    // level 0 is a mirror; the last levels are the whole sky blurred
    let rough = f32(level) / 5.0;
    return vec4<f32>(environment(dir, rough), 1.0);
}
