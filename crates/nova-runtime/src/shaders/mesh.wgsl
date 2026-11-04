// Low-poly meshes: one directional light, flat ambient, point lights, palette/base-colour texture, per-vertex glow.
struct Globals {
    view_proj: mat4x4<f32>,
    light_dir: vec4<f32>,      // xyz: direction the light travels, w: point light count
    light_color: vec4<f32>,
    ambient: vec4<f32>,
    point_pos: array<vec4<f32>, 16>,   // xyz position, w radius
    point_color: array<vec4<f32>, 16>,
    inv_view_proj: mat4x4<f32>,
    eye: vec4<f32>,
    sky_top: vec4<f32>,
    sky_horizon: vec4<f32>,
    fog_color: vec4<f32>,   // w: 1 when there is fog
    fog_range: vec4<f32>,   // x: start, y: complete
    light_view_proj: mat4x4<f32>,
    shadow: vec4<f32>,      // x: 1 when on, y: one texel, z: bias, w: how dark
    voxel: vec4<f32>,       // x: how bright the sky's light is (voxel meshes)
};
@group(0) @binding(0) var<uniform> globals: Globals;
@group(1) @binding(0) var base_texture: texture_2d<f32>;
@group(1) @binding(1) var base_sampler: sampler;
@group(2) @binding(0) var shadow_map: texture_depth_2d;
@group(2) @binding(1) var shadow_sampler: sampler_comparison;

struct Vertex {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec4<f32>,
    @location(3) uv: vec2<f32>,
    @location(9) emissive: f32,
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
    @location(3) world: vec3<f32>,
    @location(4) emissive: f32,
};

@vertex
fn vs_main(v: Vertex, inst: Instance) -> VertexOut {
    let model = mat4x4<f32>(inst.m0, inst.m1, inst.m2, inst.m3);
    var out: VertexOut;
    let world = model * vec4<f32>(v.position, 1.0);
    out.world = world.xyz;
    out.position = globals.view_proj * world;
    // voxel meshes (emissive < 0) carry their baked light levels in `normal` instead of a direction
    out.normal = select(normalize((model * vec4<f32>(v.normal, 0.0)).xyz), v.normal, v.emissive < 0.0);
    out.color = v.color * vec4<f32>(srgb_to_linear(inst.tint.rgb), inst.tint.a);
    out.uv = v.uv;
    out.emissive = v.emissive;
    return out;
}

// How much of the sun reaches a point: 1 in the open, less in a shadow (a soft edge from 3x3 samples).
fn sun_visibility(world: vec3<f32>, normal: vec3<f32>) -> f32 {
    if (globals.shadow.x < 0.5) {
        return 1.0;
    }
    // push the point a little along its normal so that surfaces facing away from the sun do not shadow themselves
    let p = world + normal * 0.03;
    let clip = globals.light_view_proj * vec4<f32>(p, 1.0);
    let uv = vec2<f32>(clip.x * 0.5 + 0.5, 0.5 - clip.y * 0.5);
    let depth = clip.z - globals.shadow.z;
    var lit = 0.0;
    for (var x = -1; x <= 1; x = x + 1) {
        for (var y = -1; y <= 1; y = y + 1) {
            let o = vec2<f32>(f32(x), f32(y)) * globals.shadow.y;
            lit = lit + textureSampleCompare(shadow_map, shadow_sampler, uv + o, depth);
        }
    }
    lit = lit / 9.0;
    // outside the map, or beyond the light's far plane, there is no shadow
    let inside = uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 && clip.z > 0.0 && clip.z < 1.0;
    return select(1.0, lit, inside);
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    let base = textureSample(base_texture, base_sampler, in.uv) * in.color;
    // cut-out textures (leaves, glass, plants): see-through texels are not drawn at all
    if (base.a < 0.3) {
        discard;
    }
    if (in.emissive < 0.0) {
        // a voxel surface: light is baked per vertex (x: sky, y: torch/lava), the face shade and ambient occlusion are in the colour
        let light = in.normal.x * globals.voxel.x * vec3<f32>(1.0) + in.normal.y * vec3<f32>(1.0, 0.86, 0.7);
        var vrgb = base.rgb * min(light + vec3<f32>(0.03), vec3<f32>(1.0));
        if (globals.fog_color.w > 0.5) {
            let d = distance(in.world, globals.eye.xyz);
            let f = clamp((d - globals.fog_range.x) / (globals.fog_range.y - globals.fog_range.x), 0.0, 1.0);
            vrgb = mix(vrgb, globals.fog_color.rgb, f);
        }
        return vec4<f32>(vrgb, base.a);
    }
    let n = normalize(in.normal);
    // the sun's share is dimmed in a shadow, down to `1 - strength` of it
    let visible = mix(1.0 - globals.shadow.w, 1.0, sun_visibility(in.world, n));
    let diffuse = max(dot(n, -globals.light_dir.xyz), 0.0) * visible;
    var light = globals.ambient.rgb + globals.light_color.rgb * diffuse * (1.0 - globals.ambient.rgb);
    let count = i32(globals.light_dir.w);
    for (var i = 0; i < count; i = i + 1) {
        let to_light = globals.point_pos[i].xyz - in.world;
        let dist = length(to_light);
        let falloff = clamp(1.0 - dist / globals.point_pos[i].w, 0.0, 1.0);
        let lambert = max(dot(n, to_light / max(dist, 0.0001)), 0.0);
        light = light + globals.point_color[i].rgb * (falloff * falloff * lambert);
    }
    // a glowing surface shows its colour at full brightness however dark the scene is
    var rgb = base.rgb * (light + vec3<f32>(in.emissive));
    if (globals.fog_color.w > 0.5) {
        let d = distance(in.world, globals.eye.xyz);
        let f = clamp((d - globals.fog_range.x) / (globals.fog_range.y - globals.fog_range.x), 0.0, 1.0);
        rgb = mix(rgb, globals.fog_color.rgb, f);
    }
    return vec4<f32>(rgb, base.a);
}
