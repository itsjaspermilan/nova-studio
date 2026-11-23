// An outline round a model (`nova.model`'s `outline = { color, width }`): the model's own triangles again, back faces only, each vertex
// pushed out on the screen by `width` pixels (constant on the screen, whatever the distance) away from the model's middle, in a flat
// colour. Drawn after the world's models and depth tested against them, so it shows only round the silhouette (and where the model is
// behind something, it is behind it too). Not cut by `nova.see_through`, not lit, not fogged.
struct Globals {
    view_proj: mat4x4<f32>,
    light_dir: vec4<f32>,      // xyz: direction the light travels, w: point light count
    light_color: vec4<f32>,
    ambient: vec4<f32>,
    point_pos: array<vec4<f32>, 20>,   // xyz position, w radius
    point_color: array<vec4<f32>, 20>,
    inv_view_proj: mat4x4<f32>,
    eye: vec4<f32>,
    sky_top: vec4<f32>,
    sky_horizon: vec4<f32>,
    fog_color: vec4<f32>,   // w: 1 when there is fog
    fog_range: vec4<f32>,   // x: start, y: complete
    light_view_proj: mat4x4<f32>,
    shadow: vec4<f32>,      // x: 1 when on, y: one texel, z: bias, w: how dark
    voxel: vec4<f32>,       // x: how bright the sky's light is (voxel meshes); y: bands of toon light (0: smooth)
    sky_sun: vec4<f32>,
    sky_extra: vec4<f32>,
    wind: vec4<f32>,        // xy: the way the wind blows (unit), z: how strong (0: none), w: the time
    point_dir: array<vec4<f32>, 20>,   // xyz: the way a spot light points (zero: every way), w: cosine of half its cone
    terrain: array<vec4<f32>, 9>,      // [0].x: how many hill waves; then (kx, kz, amplitude, phase) each
    terrain_map: array<vec4<f32>, 2>,  // [0]: x0, z0, 1 / cell; [1]: samples across - 1, rows - 1
    cascade_vp: array<mat4x4<f32>, 3>,  // the sun's shadow maps, nearest first (cascades, or the near map and the wide one)
    cascade_info: array<vec4<f32>, 3>,  // x: where the map ends (distance along the view), y: depth bias, z: metres a texel spans, w: softness
    cascade_count: vec4<f32>,           // x: how many maps
    ground: vec4<f32>,                  // rgb: the land around as the light leaves it (its colour under the sun and the ambient light); w: 1 when the sky gave one
    see_through: vec4<f32>,             // `nova.see_through`: xyz the point kept in view, w the radius of the hole at that point (metres)
    see_through_opts: vec4<f32>,        // x: how far short of the point the hole stops (metres), y: how much is dropped (0: off), z: the height above its own base under which nothing is cut, w: within this many metres of the eye everything (above z) goes
    see_through_near: vec4<f32>,        // x: within this many metres of the eye everything (above z) is wholly gone (it fades in out to opts.w), y: how much of that near fade is on (it is independent of opts.y, the hole's)
    outline_view: vec4<f32>,         // x, y: the world picture's size in pixels
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
    @location(8) color: vec4<f32>,   // rgb, and the width in pixels
    @location(10) middle: vec4<f32>, // the model's middle in the world
};

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec3<f32>,
};

@vertex
fn vs_main(v: Vertex, inst: Instance) -> VertexOut {
    let model = mat4x4<f32>(
        vec4<f32>(inst.m0.xyz, 0.0), vec4<f32>(inst.m1.xyz, 0.0), vec4<f32>(inst.m2.xyz, 0.0), vec4<f32>(inst.m3.xyz, 1.0));
    let world = model * vec4<f32>(v.position, 1.0);
    var clip = globals.view_proj * world;
    let mid = globals.view_proj * vec4<f32>(inst.middle.xyz, 1.0);
    let view = max(globals.outline_view.xy, vec2<f32>(1.0));
    // the direction on the screen from the model's middle to this vertex, in pixels
    let d = (clip.xy / clip.w - mid.xy / max(mid.w, 1e-4)) * view * 0.5;
    let l = length(d);
    if (l > 1e-4 && clip.w > 0.0) {
        // (a pixel is 2 / view of the clip space's width and height)
        clip = vec4<f32>(clip.xy + d / l * inst.color.w * 2.0 / view * clip.w, clip.z, clip.w);
    }
    var out: VertexOut;
    out.position = clip;
    out.color = inst.color.rgb;
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    return vec4<f32>(in.color, 1.0);
}
