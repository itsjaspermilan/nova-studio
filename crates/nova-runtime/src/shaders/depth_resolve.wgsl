// Makes the single-sample depth the finishing pass reads (outline, ambient occlusion) from a multisampled one: the nearest of the pixel's samples.
@group(0) @binding(0) var samples: texture_depth_multisampled_2d;

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4<f32> {
    var corners = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
    return vec4<f32>(corners[vertex], 0.0, 1.0);
}

struct Out {
    @builtin(frag_depth) depth: f32,
};

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> Out {
    let texel = vec2<i32>(position.xy);
    var nearest = textureLoad(samples, texel, 0);
    for (var i = 1; i < 4; i = i + 1) {
        nearest = min(nearest, textureLoad(samples, texel, i));
    }
    var out: Out;
    out.depth = nearest;
    return out;
}
