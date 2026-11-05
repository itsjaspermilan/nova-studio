// Upscales the low-resolution world target to the screen with a "sharp bilinear" filter:
// texels stay crisp inside, and only a thin band at their edges is blended, so integer
// and non-integer scales both look clean without the blur of plain bilinear.
// When the game asks for a look (`nova.look`) the same pass also draws an outline where the depth jumps and adjusts the colour.
struct Blit {
    tex_size: vec2<f32>,
    scale: vec2<f32>,
    grade: vec4<f32>,         // x: exposure, y: saturation, z: vignette, w: outline darkness (0: no outline)
    outline_color: vec4<f32>, // rgb linear, w: width in world texels
    depth: vec4<f32>,         // x: near, y: far of the camera, z: fog starts, w: fog is complete (0: no fog)
};
@group(0) @binding(0) var<uniform> blit: Blit;
@group(1) @binding(0) var source: texture_2d<f32>;
@group(1) @binding(1) var source_sampler: sampler;
@group(2) @binding(0) var depth_map: texture_depth_2d;

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

// The distance along the view of what a depth value is (the camera's perspective, 0 to 1 depth).
fn eye_depth(d: f32) -> f32 {
    let near = blit.depth.x;
    let far = blit.depth.y;
    return near * far / max(far - d * (far - near), 1e-4);
}

fn depth_at(texel: vec2<i32>) -> f32 {
    let size = vec2<i32>(blit.tex_size);
    return eye_depth(textureLoad(depth_map, clamp(texel, vec2<i32>(0), size - vec2<i32>(1)), 0));
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    let texel = in.uv * blit.tex_size;
    let base = floor(texel);
    let within = fract(texel) - vec2<f32>(0.5, 0.5);
    let blend_region = max(vec2<f32>(0.5, 0.5) - vec2<f32>(0.5, 0.5) / blit.scale, vec2<f32>(0.0, 0.0));
    let offset = (within - clamp(within, -blend_region, blend_region)) * blit.scale + vec2<f32>(0.5, 0.5);
    var color = textureSample(source, source_sampler, (base + offset) / blit.tex_size);
    var rgb = color.rgb;
    // an outline where the distance to the surface jumps between this texel and its neighbours (relative to how far it is,
    // so that a far hill does not get a line for every ripple), fading with the fog
    if (blit.grade.w > 0.0) {
        let c = vec2<i32>(base);
        let w = i32(max(blit.outline_color.w, 1.0));
        let z = depth_at(c);
        let jump = max(
            max(abs(depth_at(c + vec2<i32>(w, 0)) - z), abs(depth_at(c - vec2<i32>(w, 0)) - z)),
            max(abs(depth_at(c + vec2<i32>(0, w)) - z), abs(depth_at(c - vec2<i32>(0, w)) - z)),
        ) / max(z, 0.01);
        var edge = smoothstep(0.03, 0.09, jump);
        if (blit.depth.w > 0.0) {
            edge = edge * (1.0 - smoothstep(blit.depth.z, blit.depth.w, z));
        }
        rgb = mix(rgb, blit.outline_color.rgb, edge * blit.grade.w);
    }
    // exposure with a soft shoulder (a curve that is straight near black and bends toward white, so brights do not clip)
    if (abs(blit.grade.x - 1.0) > 1e-4) {
        let e = rgb * blit.grade.x;
        rgb = e / (1.0 + max(e - vec3<f32>(1.0), vec3<f32>(0.0)));
    }
    if (abs(blit.grade.y - 1.0) > 1e-4) {
        let grey = dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
        rgb = max(mix(vec3<f32>(grey), rgb, blit.grade.y), vec3<f32>(0.0));
    }
    if (blit.grade.z > 0.0) {
        let p = in.uv * 2.0 - vec2<f32>(1.0, 1.0);
        rgb = rgb * (1.0 - blit.grade.z * clamp(dot(p, p) * 0.35, 0.0, 1.0));
    }
    return vec4<f32>(rgb, color.a);
}
