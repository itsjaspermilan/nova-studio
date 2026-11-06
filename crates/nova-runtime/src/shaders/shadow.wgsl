// Depth only: the world as the sun sees it, for the shadow map.
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
    sky_sun: vec4<f32>,
    sky_extra: vec4<f32>,
    wind: vec4<f32>,
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

// Wind: foliage (an instance with a sway weight in the w slot of its matrix's third column) bends with the wind, more the higher
// the vertex is above the instance's origin. A slow swell travels across the field along the wind, with a quicker flutter on it.
fn wind_offset(origin: vec3<f32>, world: vec3<f32>, sway: f32) -> vec3<f32> {
    if (sway == 0.0 || globals.wind.z == 0.0) {
        return vec3<f32>(0.0);
    }
    let h = max(world.y - origin.y, 0.0);
    let t = globals.wind.w;
    let phase = dot(origin.xz, globals.wind.xy) * 0.22;
    let swell = 0.55 + 0.45 * sin(t * 1.3 - phase);
    let flutter = sin(t * 5.1 + origin.x * 0.7 + origin.z * 0.9 + world.y * 2.0) * 0.12;
    let bend = sway * globals.wind.z * h * (swell + flutter);
    return vec3<f32>(globals.wind.x * bend, 0.0, globals.wind.y * bend);
}

@vertex
fn vs_main(v: Vertex, inst: Instance) -> @builtin(position) vec4<f32> {
    let model = mat4x4<f32>(inst.m0, vec4<f32>(inst.m1.xyz, 0.0), vec4<f32>(inst.m2.xyz, 0.0), inst.m3);
    var world = model * vec4<f32>(v.position, 1.0);
    world = vec4<f32>(world.xyz + wind_offset(inst.m3.xyz, world.xyz, inst.m2.w), 1.0);
    return globals.light_view_proj * world;
}

// skinned meshes: see mesh.wgsl (the joints' matrices are in a texture; the instance's w slot says where they start)
@group(1) @binding(0) var joint_texture: texture_2d<f32>;

fn joint_matrix(index: u32) -> mat4x4<f32> {
    let t = index * 4u;
    let x = i32(t % 1024u);
    let y = i32(t / 1024u);
    return mat4x4<f32>(
        textureLoad(joint_texture, vec2<i32>(x, y), 0),
        textureLoad(joint_texture, vec2<i32>(x + 1, y), 0),
        textureLoad(joint_texture, vec2<i32>(x + 2, y), 0),
        textureLoad(joint_texture, vec2<i32>(x + 3, y), 0),
    );
}

struct SkinVertex {
    @location(0) position: vec3<f32>,
    @location(10) joints: vec4<u32>,
    @location(11) weights: vec4<f32>,
};

@vertex
fn vs_skinned(v: SkinVertex, inst: Instance) -> @builtin(position) vec4<f32> {
    let base = u32(inst.m0.w + 0.5);
    let model = mat4x4<f32>(vec4<f32>(inst.m0.xyz, 0.0), vec4<f32>(inst.m1.xyz, 0.0), vec4<f32>(inst.m2.xyz, 0.0), inst.m3);
    var skin = mat4x4<f32>(vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
    for (var k = 0; k < 4; k = k + 1) {
        if (v.weights[k] > 0.0) {
            skin = skin + joint_matrix(base + v.joints[k]) * v.weights[k];
        }
    }
    let total = v.weights.x + v.weights.y + v.weights.z + v.weights.w;
    if (total <= 0.0) {
        skin = mat4x4<f32>(vec4<f32>(1.0, 0.0, 0.0, 0.0), vec4<f32>(0.0, 1.0, 0.0, 0.0), vec4<f32>(0.0, 0.0, 1.0, 0.0), vec4<f32>(0.0, 0.0, 0.0, 1.0));
    }
    return globals.light_view_proj * (model * (skin * vec4<f32>(v.position, 1.0)));
}
