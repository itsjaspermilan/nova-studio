// Dissolve: the model burns away bit by bit and comes back. A noise picture (textures = { "noise" }) says which bit goes first;
// pixels below the line are not drawn, and a band just above it glows like an ember.
// params: s.param.x cycles a second, s.param.y how wide the glowing edge is.

fn shade(s: Surface) -> vec4<f32> {
    // how much is gone: 0 (whole) to 1 (all gone), going and coming back
    let amount = 0.5 - 0.5 * cos(s.time * s.param.x * 6.2831853);
    // (pictures are read as colours, made linear; this one is plain numbers, so it is put back as painted)
    let noise = pow(nova_texture_a(s.uv * vec2<f32>(1.0, 1.5)).r, 1.0 / 2.2);
    // a little more of the top goes first
    let line = amount * 1.15 - 0.075 + (s.world.y - 1.2) * 0.05;
    if (noise < line) {
        discard;
    }
    let lit = nova_light(s, s.color.rgb);
    let edge = 1.0 - smoothstep(0.0, s.param.y, noise - line);
    let ember = mix(vec3<f32>(1.0, 0.25, 0.02), vec3<f32>(1.0, 0.85, 0.3), edge) * 2.0;
    let rgb = mix(lit, ember, edge * step(0.001, amount));
    return vec4<f32>(nova_fog(s, rgb), 1.0);
}
