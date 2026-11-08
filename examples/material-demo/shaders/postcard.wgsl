// A post effect over the whole world picture: warm, faded colours, a soft vignette and a slow shimmer, like an old postcard.
// params: s.param.x how strong (0 to 1).

fn shade(s: Surface) -> vec4<f32> {
    // a gentle sideways shimmer, a pixel or two
    let wobble = sin(s.uv.y * 40.0 + s.time * 2.0) * 0.0012;
    let c = nova_scene(s.uv + vec2<f32>(wobble, 0.0)).rgb;
    let grey = nova_luma(c);
    let sepia = vec3<f32>(grey * 1.07, grey * 0.95, grey * 0.78);
    let toned = mix(c, sepia, s.param.x);
    let d = distance(s.uv, vec2<f32>(0.5));
    let vignette = 1.0 - smoothstep(0.45, 0.85, d) * 0.45;
    return vec4<f32>(toned * vignette, 1.0);
}
