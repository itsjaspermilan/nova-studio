// file: shaders/wave.wgsl
// A shader decides the colour of every pixel of whatever is drawn with it.
// `s` holds what is known about the pixel: s.color (the model's own colour), s.world (where it is), s.time (seconds) and more.
fn shade(s: Surface) -> vec4<f32> {
    // a band of light that runs up the model and starts again, once a second
    let band = fract(s.world.y * 1.5 - s.time);
    let glow = smoothstep(0.85, 1.0, band);
    // the model lit as usual, plus the band in cyan
    let rgb = nova_light(s, s.color.rgb) + vec3<f32>(0.2, 0.9, 1.0) * glow;
    return vec4<f32>(rgb, 1.0);
}
