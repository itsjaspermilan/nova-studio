// Batched 2D quads. Coordinates are logical units: x right, y down, origin top-left.
struct View {
    size: vec2<f32>,
    pad: vec2<f32>,
};
@group(0) @binding(0) var<uniform> view: View;
@group(1) @binding(0) var atlas: texture_2d<f32>;
@group(1) @binding(1) var atlas_sampler: sampler;

struct Instance {
    @location(0) center: vec2<f32>,
    @location(1) size: vec2<f32>,
    @location(2) uv: vec4<f32>,
    @location(3) color: vec4<f32>,
    @location(4) rotation: f32,
};

// Colours from scripts are 8-bit sRGB values; the target is sRGB, so blend in linear space.
fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    let low = c / 12.92;
    let high = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    return select(high, low, c <= vec3<f32>(0.04045));
}

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32, inst: Instance) -> VertexOut {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, -0.5), vec2<f32>(0.5, 0.5),
        vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, 0.5), vec2<f32>(-0.5, 0.5),
    );
    let corner = corners[vertex];
    let s = sin(inst.rotation);
    let c = cos(inst.rotation);
    let local = corner * inst.size;
    let world = vec2<f32>(local.x * c - local.y * s, local.x * s + local.y * c) + inst.center;
    var out: VertexOut;
    out.position = vec4<f32>(world.x / view.size.x * 2.0 - 1.0, 1.0 - world.y / view.size.y * 2.0, 0.0, 1.0);
    out.uv = mix(inst.uv.xy, inst.uv.zw, corner + vec2<f32>(0.5, 0.5));
    out.color = vec4<f32>(srgb_to_linear(inst.color.rgb), inst.color.a);
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    // The glyph atlas is one coverage byte per pixel (R8): it becomes the text colour's alpha.
    let coverage = textureSample(atlas, atlas_sampler, in.uv).r;
    return vec4<f32>(in.color.rgb, in.color.a * coverage);
}
