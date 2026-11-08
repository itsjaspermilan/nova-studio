// ---- a custom shader on a sprite (after sprite.wgsl and custom_common.wgsl) ----
@group(2) @binding(5) var<uniform> nova_custom: NovaCustom;
@group(2) @binding(6) var nova_tex_a: texture_2d<f32>;
@group(2) @binding(7) var nova_tex_b: texture_2d<f32>;
@group(2) @binding(8) var nova_tex_sampler: sampler;

// Sprites are not lit: the colour as it is.
fn nova_light(s: Surface, rgb: vec3<f32>) -> vec3<f32> {
    return rgb;
}

fn nova_fog(s: Surface, rgb: vec3<f32>) -> vec3<f32> {
    return rgb;
}

fn nova_scene(uv: vec2<f32>) -> vec4<f32> {
    return vec4<f32>(0.0);
}

// The sprite's own picture at a place 0 to 1 across it (for shaders that move or ripple it).
fn nova_sprite(uv: vec2<f32>) -> vec4<f32> {
    let r = nova_custom.rect;
    return textureSampleLevel(atlas, atlas_sampler, mix(r.xy, r.zw, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0))), 0.0);
}

@fragment
fn fs_custom(in: VertexOut) -> @location(0) vec4<f32> {
    let r = nova_custom.rect;
    var s = nova_surface_base();
    s.uv = (in.uv - r.xy) / max(r.zw - r.xy, vec2<f32>(1e-9));
    s.color = textureSampleLevel(atlas, atlas_sampler, in.uv, 0.0) * in.color;
    s.tint = in.color;
    s.pixel = in.position.xy;
    return shade(s);
}
