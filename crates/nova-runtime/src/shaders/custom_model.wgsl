// ---- a custom shader on a model (after mesh.wgsl and custom_common.wgsl) ----
@group(3) @binding(5) var<uniform> nova_custom: NovaCustom;
@group(3) @binding(6) var nova_tex_a: texture_2d<f32>;
@group(3) @binding(7) var nova_tex_b: texture_2d<f32>;
@group(3) @binding(8) var nova_tex_sampler: sampler;

// The scene's light on a colour at this pixel, as Nova lights its models: the sun (and its shadow), the ambient light, the point
// and spot lights, toon bands when the look has them. No fog: add it with nova_fog.
fn nova_light(s: Surface, rgb: vec3<f32>) -> vec3<f32> {
    let n = safe_normalize(s.normal);
    let visible = mix(1.0 - globals.shadow.w, 1.0, sun_visibility(s.world, n));
    var diffuse = max(dot(n, -globals.light_dir.xyz), 0.0) * visible;
    if (globals.voxel.y >= 1.5) {
        let x = diffuse * globals.voxel.y;
        diffuse = (floor(x) + step(0.5, fract(x))) / globals.voxel.y;
    }
    var light = globals.ambient.rgb + globals.light_color.rgb * diffuse * (1.0 - globals.ambient.rgb);
    let count = i32(globals.light_dir.w);
    for (var i = 0; i < count; i = i + 1) {
        let to_light = globals.point_pos[i].xyz - s.world;
        let dist = length(to_light);
        let falloff = clamp(1.0 - dist / globals.point_pos[i].w, 0.0, 1.0);
        let towards = to_light / max(dist, 0.0001);
        var cone = 1.0;
        let aim = globals.point_dir[i];
        if (dot(aim.xyz, aim.xyz) > 0.25) {
            cone = smoothstep(aim.w, mix(aim.w, 1.0, 0.45), dot(-towards, aim.xyz));
        }
        light = light + globals.point_color[i].rgb * (falloff * falloff * max(dot(n, towards), 0.0) * cone);
    }
    return rgb * light;
}

// The scene's fog over a colour at this pixel (unchanged when there is no fog).
fn nova_fog(s: Surface, rgb: vec3<f32>) -> vec3<f32> {
    if (globals.fog_color.w < 0.5) {
        return rgb;
    }
    let d = distance(s.world, globals.eye.xyz);
    let t = clamp((d - globals.fog_range.x) / (globals.fog_range.y - globals.fog_range.x), 0.0, 1.0);
    if (globals.fog_range.z <= 0.0) {
        return mix(rgb, globals.fog_color.rgb, t);
    }
    // the haze (mesh.wgsl fog_over): thicker low down, far colour fades first, lit towards the sun
    let low = exp(-max(0.5 * (globals.eye.y + s.world.y) - globals.fog_range.w, 0.0) / globals.fog_range.z);
    let f = pow(max(1.0 - pow(max(1.0 - t, 1e-6), 1.2 + 0.5 * low), 1e-6), 1.7 - 0.4 * low);
    let faded = mix(rgb, vec3<f32>(dot(rgb, vec3<f32>(0.299, 0.587, 0.114))), min(f * 1.6, 1.0) * globals.voxel.z);
    let sunward = max(dot((s.world - globals.eye.xyz) / max(d, 1e-3), -globals.light_dir.xyz), 0.0);
    return mix(faded, globals.fog_color.rgb + globals.light_color.rgb * (globals.voxel.w * 0.3 * pow(sunward, 6.0)), f);
}

// Only a post effect can read the finished picture; elsewhere this is transparent black.
fn nova_scene(uv: vec2<f32>) -> vec4<f32> {
    return vec4<f32>(0.0);
}

@fragment
fn fs_custom(in: VertexOut) -> @location(0) vec4<f32> {
    if (in.dissolve != 0.0) {
        let noise = fract(52.9829189 * fract(dot(in.position.xy, vec2<f32>(0.06711056, 0.00583715))));
        if (in.dissolve < 0.0) {
            if (noise < -in.dissolve) { discard; }
        } else {
            if (noise >= in.dissolve) { discard; }
        }
    }
    let picture = textureSample(base_texture, base_sampler, in.uv);
    var s = nova_surface_base();
    s.uv = select(in.uv, vec2<f32>(0.0), in.uv.x > 1.0e6);
    s.color = select(picture, vec4<f32>(1.0), in.uv.x > 1.0e6) * in.color;
    s.tint = in.color;
    s.normal = safe_normalize(in.normal);
    s.world = in.world;
    s.pixel = in.position.xy;
    return shade(s);
}
