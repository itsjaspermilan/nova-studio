// Upscales the low-resolution world target to the screen with a "sharp bilinear" filter:
// texels stay crisp inside, and only a thin band at their edges is blended, so integer
// and non-integer scales both look clean without the blur of plain bilinear.
struct Blit {
    tex_size: vec2<f32>,
    scale: vec2<f32>,
};
@group(0) @binding(0) var<uniform> blit: Blit;
@group(1) @binding(0) var source: texture_2d<f32>;
@group(1) @binding(1) var source_sampler: sampler;

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32) -> VertexOut {
    // One oversized triangle covering the screen.
    var corners = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
    let p = corners[vertex];
    var out: VertexOut;
    out.position = vec4<f32>(p, 0.0, 1.0);
    out.uv = vec2<f32>((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5);
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    let texel = in.uv * blit.tex_size;
    let base = floor(texel);
    let within = fract(texel) - vec2<f32>(0.5, 0.5);
    let blend_region = max(vec2<f32>(0.5, 0.5) - vec2<f32>(0.5, 0.5) / blit.scale, vec2<f32>(0.0, 0.0));
    let offset = (within - clamp(within, -blend_region, blend_region)) * blit.scale + vec2<f32>(0.5, 0.5);
    return textureSample(source, source_sampler, (base + offset) / blit.tex_size);
}
