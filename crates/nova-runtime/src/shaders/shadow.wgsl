// Depth only: the world as the sun sees it, for the shadow map.
struct Globals {
    view_proj: mat4x4<f32>,
    light_dir: vec4<f32>,
    light_color: vec4<f32>,
    ambient: vec4<f32>,
    point_pos: array<vec4<f32>, 16>,
    point_color: array<vec4<f32>, 16>,
    inv_view_proj: mat4x4<f32>,
    eye: vec4<f32>,
    sky_top: vec4<f32>,
    sky_horizon: vec4<f32>,
    fog_color: vec4<f32>,
    fog_range: vec4<f32>,
    light_view_proj: mat4x4<f32>,
    shadow: vec4<f32>,
    voxel: vec4<f32>,
};
@group(0) @binding(0) var<uniform> globals: Globals;

struct Vertex {
    @location(0) position: vec3<f32>,
};

struct Instance {
    @location(4) m0: vec4<f32>,
    @location(5) m1: vec4<f32>,
    @location(6) m2: vec4<f32>,
    @location(7) m3: vec4<f32>,
};

@vertex
fn vs_main(v: Vertex, inst: Instance) -> @builtin(position) vec4<f32> {
    let model = mat4x4<f32>(inst.m0, inst.m1, inst.m2, inst.m3);
    return globals.light_view_proj * (model * vec4<f32>(v.position, 1.0));
}
