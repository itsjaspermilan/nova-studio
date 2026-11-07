// Low-poly meshes: one directional light, flat ambient, point lights, palette/base-colour texture, per-vertex glow.
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
};
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var heightmap: texture_2d<f32>;  // the heightmap (R32Float, metres); 1 x 1 when there is none
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

// Wind: foliage (an instance with a sway weight in the w slot of its matrix's third column) bends with the wind, more the higher
// the vertex is above the instance's origin. A slow swell travels across the field along the wind, with a quicker flutter on it.
// Up in a tree (more than a metre above the origin and away from the trunk's axis) the leaves also flutter on their own: a small
// shaking of each vertex by where it is, so that a crown shimmers instead of leaning like a post.
fn wind_offset(origin: vec3<f32>, world: vec3<f32>, sway: f32) -> vec3<f32> {
    if (sway == 0.0 || globals.wind.z == 0.0) {
        return vec3<f32>(0.0);
    }
    let h = max(world.y - origin.y, 0.0);
    let t = globals.wind.w;
    let strength = globals.wind.z;
    let phase = dot(origin.xz, globals.wind.xy) * 0.22;
    let swell = 0.55 + 0.45 * sin(t * 1.3 - phase);
    let flutter = sin(t * 5.1 + origin.x * 0.7 + origin.z * 0.9 + world.y * 2.0) * 0.12;
    let bend = sway * strength * h * (swell + flutter);
    var offset = vec3<f32>(globals.wind.x * bend, 0.0, globals.wind.y * bend);
    // leaves: how much of a crown this vertex is (high, and out from the trunk's axis)
    let radial = length(world.xz - origin.xz);
    let crown = smoothstep(1.0, 3.0, h) * smoothstep(0.25, 1.2, radial);
    if (crown > 0.0) {
        let a = t * 3.1 + world.x * 2.3 + world.z * 1.9 + world.y * 1.7;
        let shake = crown * strength * 0.07 * (0.6 + 0.4 * swell);
        offset = offset + shake * vec3<f32>(sin(a), 0.5 * sin(a * 1.3 + 1.0), sin(a + 2.1));
    }
    return offset;
}


// Hills: the ground's height as a sum of up to eight sine waves over the ground (`nova.terrain`): terrain[0].x is how many, terrain[1..]
// are (kx, kz, amplitude, phase). Every vertex is lifted by the height under it, so a flat model laid on the ground (a road piece, a
// car, a tree) follows the hills; things up in the sky (an instance whose origin is above 30 m: clouds) stay where they are.
// With a heightmap (terrain[0].y is 1) its bilinear height is added to the waves; outside the picture it keeps the nearest edge's height.
// Same maths as `HeightMap::height` in heightmap.rs.
fn terrain_active() -> bool {
    return globals.terrain[0].x > 0.0 || globals.terrain[0].y > 0.0;
}

fn map_height(p: vec2<f32>) -> f32 {
    let dims = globals.terrain_map[1].xy;
    let f = clamp((p - globals.terrain_map[0].xy) * globals.terrain_map[0].z, vec2<f32>(0.0), dims);
    let i = min(vec2<i32>(floor(f)), vec2<i32>(dims) - vec2<i32>(1));
    let t = f - vec2<f32>(i);
    let a = textureLoad(heightmap, i, 0).x;
    let b = textureLoad(heightmap, i + vec2<i32>(1, 0), 0).x;
    let c = textureLoad(heightmap, i + vec2<i32>(0, 1), 0).x;
    let d = textureLoad(heightmap, i + vec2<i32>(1, 1), 0).x;
    let top = a + (b - a) * t.x;
    let bottom = c + (d - c) * t.x;
    return top + (bottom - top) * t.y;
}

fn map_slope(p: vec2<f32>) -> vec2<f32> {
    let dims = globals.terrain_map[1].xy;
    let raw = (p - globals.terrain_map[0].xy) * globals.terrain_map[0].z;
    let f = clamp(raw, vec2<f32>(0.0), dims);
    let i = min(vec2<i32>(floor(f)), vec2<i32>(dims) - vec2<i32>(1));
    let t = f - vec2<f32>(i);
    let a = textureLoad(heightmap, i, 0).x;
    let b = textureLoad(heightmap, i + vec2<i32>(1, 0), 0).x;
    let c = textureLoad(heightmap, i + vec2<i32>(0, 1), 0).x;
    let d = textureLoad(heightmap, i + vec2<i32>(1, 1), 0).x;
    let inside = vec2<f32>(select(0.0, 1.0, raw.x > 0.0 && raw.x < dims.x), select(0.0, 1.0, raw.y > 0.0 && raw.y < dims.y));
    return inside * vec2<f32>(
        ((b - a) * (1.0 - t.y) + (d - c) * t.y) * globals.terrain_map[0].z,
        ((c - a) * (1.0 - t.x) + (d - b) * t.x) * globals.terrain_map[0].z);
}

fn terrain_height(p: vec2<f32>) -> f32 {
    let n = i32(globals.terrain[0].x);
    var h = 0.0;
    if (globals.terrain[0].y > 0.0) {
        h = map_height(p);
    }
    for (var i = 0; i < n; i = i + 1) {
        let w = globals.terrain[i + 1];
        h = h + w.z * sin(w.x * p.x + w.y * p.y + w.w);
    }
    return h;
}

// The slope of the ground there: d height / dx and d height / dz.
fn terrain_slope(p: vec2<f32>) -> vec2<f32> {
    let n = i32(globals.terrain[0].x);
    var g = vec2<f32>(0.0);
    if (globals.terrain[0].y > 0.0) {
        g = map_slope(p);
    }
    for (var i = 0; i < n; i = i + 1) {
        let w = globals.terrain[i + 1];
        g = g + w.z * cos(w.x * p.x + w.y * p.y + w.w) * vec2<f32>(w.x, w.y);
    }
    return g;
}

// A direction made unit length; a zero-length one (a degenerate face in a model file) stays zero. A plain normalize() of
// zero is NaN, which Metal quietly turns into "no sun" but Vulkan drivers carry through to black pixels.
fn safe_normalize(v: vec3<f32>) -> vec3<f32> {
    return v / max(length(v), 1e-6);
}

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
    // 0: solid; otherwise a screen-door fade (see `ModelInstance::dissolving`)
    @location(5) @interpolate(flat) dissolve: f32,
};

@vertex
fn vs_main(v: Vertex, inst: Instance) -> VertexOut {
    let model = mat4x4<f32>(inst.m0, vec4<f32>(inst.m1.xyz, 0.0), vec4<f32>(inst.m2.xyz, 0.0), inst.m3);
    var out: VertexOut;
    out.dissolve = inst.m1.w;
    var world = model * vec4<f32>(v.position, 1.0);
    world = vec4<f32>(world.xyz + wind_offset(inst.m3.xyz, world.xyz, inst.m2.w), 1.0);
    var normal = select(safe_normalize((model * vec4<f32>(v.normal, 0.0)).xyz), v.normal, v.emissive < 0.0);
    if (terrain_active() && inst.m3.y < 30.0) {
        // on the hills: lifted by the ground's height, and the normal leans with its slope (the shear's inverse transpose)
        world = vec4<f32>(world.x, world.y + terrain_height(world.xz), world.z, 1.0);
        if (v.emissive >= 0.0) {
            let g = terrain_slope(world.xz);
            normal = safe_normalize(vec3<f32>(normal.x - g.x * normal.y, normal.y, normal.z - g.y * normal.y));
        }
    }
    out.world = world.xyz;
    out.position = globals.view_proj * world;
    out.normal = normal;
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
    // a piece fading with distance (scenery between two levels of detail, or at the edge of the draw range): each pixel is
    // kept or dropped by a fixed noise, so that the near and far versions, with opposite signs, fill every pixel between them
    if (in.dissolve != 0.0) {
        let noise = fract(52.9829189 * fract(dot(in.position.xy, vec2<f32>(0.06711056, 0.00583715))));
        if (in.dissolve < 0.0) {
            if (noise < -in.dissolve) { discard; }
        } else {
            if (noise >= in.dissolve) { discard; }
        }
    }
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
    let n = safe_normalize(in.normal);
    // the sun's share is dimmed in a shadow, down to `1 - strength` of it
    let visible = mix(1.0 - globals.shadow.w, 1.0, sun_visibility(in.world, n));
    var diffuse = max(dot(n, -globals.light_dir.xyz), 0.0) * visible;
    // a toon look cuts the sun's light into flat bands (soft only at the pixel's width, so the edges stay clean)
    if (globals.voxel.y >= 1.5) {
        let x = diffuse * globals.voxel.y;
        let w = fwidth(x) * 0.75 + 0.01;
        diffuse = (floor(x) + smoothstep(0.5 - w, 0.5 + w, fract(x))) / globals.voxel.y;
    }
    var light = globals.ambient.rgb + globals.light_color.rgb * diffuse * (1.0 - globals.ambient.rgb);
    let count = i32(globals.light_dir.w);
    for (var i = 0; i < count; i = i + 1) {
        let to_light = globals.point_pos[i].xyz - in.world;
        let dist = length(to_light);
        let falloff = clamp(1.0 - dist / globals.point_pos[i].w, 0.0, 1.0);
        let towards = to_light / max(dist, 0.0001);
        let lambert = max(dot(n, towards), 0.0);
        var cone = 1.0;
        let aim = globals.point_dir[i];
        if (dot(aim.xyz, aim.xyz) > 0.25) {
            // a spot light: full inside the middle of the cone, fading to nothing at its edge
            let across = dot(-towards, aim.xyz);
            cone = smoothstep(aim.w, mix(aim.w, 1.0, 0.45), across);
        }
        light = light + globals.point_color[i].rgb * (falloff * falloff * lambert * cone);
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

// ---- skinned meshes: the joints' matrices for the frame sit in a texture, four texels (columns) a matrix ----
@group(3) @binding(0) var joint_texture: texture_2d<f32>;

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
    @location(1) normal: vec3<f32>,
    @location(2) color: vec4<f32>,
    @location(3) uv: vec2<f32>,
    @location(9) emissive: f32,
    @location(10) joints: vec4<u32>,
    @location(11) weights: vec4<f32>,
};

// The instance's matrix carries where its joints start in its w slot (an affine matrix has 0 there).
@vertex
fn vs_skinned(v: SkinVertex, inst: Instance) -> VertexOut {
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
    let posed = skin * vec4<f32>(v.position, 1.0);
    let normal = (skin * vec4<f32>(v.normal, 0.0)).xyz;
    var out: VertexOut;
    var world = model * posed;
    var world_normal = safe_normalize((model * vec4<f32>(normal, 0.0)).xyz);
    if (terrain_active() && inst.m3.y < 30.0) {
        world = vec4<f32>(world.x, world.y + terrain_height(world.xz), world.z, 1.0);
        let g = terrain_slope(world.xz);
        world_normal = safe_normalize(vec3<f32>(world_normal.x - g.x * world_normal.y, world_normal.y, world_normal.z - g.y * world_normal.y));
    }
    out.world = world.xyz;
    out.position = globals.view_proj * world;
    out.normal = world_normal;
    out.dissolve = inst.m1.w;
    out.color = v.color * vec4<f32>(srgb_to_linear(inst.tint.rgb), inst.tint.a);
    out.uv = v.uv;
    out.emissive = v.emissive;
    return out;
}
