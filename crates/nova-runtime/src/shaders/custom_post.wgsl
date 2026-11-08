// ---- a custom shader as a full-screen post effect over the world picture (after custom_common.wgsl) ----
@group(0) @binding(0) var nova_scene_texture: texture_2d<f32>;
@group(0) @binding(1) var nova_scene_sampler: sampler;
@group(1) @binding(5) var<uniform> nova_custom: NovaCustom;
@group(1) @binding(6) var nova_tex_a: texture_2d<f32>;
@group(1) @binding(7) var nova_tex_b: texture_2d<f32>;
@group(1) @binding(8) var nova_tex_sampler: sampler;

fn nova_light(s: Surface, rgb: vec3<f32>) -> vec3<f32> {
    return rgb;
}

fn nova_fog(s: Surface, rgb: vec3<f32>) -> vec3<f32> {
    return rgb;
}

// The finished world picture (before the HUD) at a place 0 to 1 across the screen.
fn nova_scene(uv: vec2<f32>) -> vec4<f32> {
    return textureSampleLevel(nova_scene_texture, nova_scene_sampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
}

struct NovaPostOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_post(@builtin(vertex_index) vertex: u32) -> NovaPostOut {
    var corners = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
    let p = corners[vertex];
    var out: NovaPostOut;
    out.position = vec4<f32>(p, 0.0, 1.0);
    out.uv = vec2<f32>((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5);
    return out;
}

@fragment
fn fs_custom(in: NovaPostOut) -> @location(0) vec4<f32> {
    var s = nova_surface_base();
    s.uv = in.uv;
    s.color = nova_scene(in.uv);
    s.pixel = in.position.xy;
    let c = shade(s);
    return vec4<f32>(c.rgb, 1.0);
}
