// Low-poly meshes: one directional light, flat ambient, palette/base-colour texture.
struct Globals {
    view_proj: mat4x4<f32>,
    light_dir: vec4<f32>,
    ambient: vec4<f32>,
};
@group(0) @binding(0) var<uniform> globals: Globals;
@group(1) @binding(0) var base_texture: texture_2d<f32>;
@group(1) @binding(1) var base_sampler: sampler;

struct Vertex {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec4<f32>,
    @location(3) uv: vec2<f32>,
};

struct Instance {
    @location(4) m0: vec4<f32>,
    @location(5) m1: vec4<f32>,
    @location(6) m2: vec4<f32>,
    @location(7) m3: vec4<f32>,
    @location(8) tint: vec4<f32>,
};

// Instance tints are sRGB values from scripts; the vertex colours stay linear (glTF).
fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    let low = c / 12.92;
    let high = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    return select(high, low, c <= vec3<f32>(0.04045));
}

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) color: vec4<f32>,
    @location(2) uv: vec2<f32>,
};

@vertex
fn vs_main(v: Vertex, inst: Instance) -> VertexOut {
    let model = mat4x4<f32>(inst.m0, inst.m1, inst.m2, inst.m3);
    var out: VertexOut;
    out.position = globals.view_proj * (model * vec4<f32>(v.position, 1.0));
    out.normal = normalize((model * vec4<f32>(v.normal, 0.0)).xyz);
    out.color = v.color * vec4<f32>(srgb_to_linear(inst.tint.rgb), inst.tint.a);
    out.uv = v.uv;
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    let base = textureSample(base_texture, base_sampler, in.uv) * in.color;
    let diffuse = max(dot(normalize(in.normal), -globals.light_dir.xyz), 0.0);
    let light = globals.ambient.rgb + vec3<f32>(diffuse) * (1.0 - globals.ambient.rgb);
    return vec4<f32>(base.rgb * light, base.a);
}
