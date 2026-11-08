// ---- Nova's custom shader hook (docs/shaders.md): what every `shaders/<name>.wgsl` file can use ----
// The person's file defines `fn shade(s: Surface) -> vec4<f32>`: the colour of one pixel (linear rgb, alpha) from what is known
// there. The file is placed after this prelude, so its line numbers are counted from its own first line in error messages.

struct Surface {
    // model: its texture coordinates; sprite: 0 to 1 across the picture (0, 0 at its top left); post effect: 0 to 1 across the screen
    uv: vec2<f32>,
    // model: its colour as Nova would draw it before light (picture x vertex colour x tint); sprite: the picture's texel x tint;
    // post effect: the finished picture at this pixel
    color: vec4<f32>,
    // model: the vertex colour x tint (no picture); sprite: the tint; post effect: white
    tint: vec4<f32>,
    // model: the surface's direction in the world (unit); otherwise (0, 0, 1)
    normal: vec3<f32>,
    // model: where the pixel is in the world, metres; otherwise (0, 0, 0)
    world: vec3<f32>,
    // the pixel's place on the picture being drawn, in pixels from its top left, and that picture's size
    pixel: vec2<f32>,
    size: vec2<f32>,
    // seconds since the game started (Nova's own clock: it stops while the game is paused with nova.pause)
    time: f32,
    // the draw's `params = { ... }`: the first four numbers, then the next four (missing ones are 0)
    param: vec4<f32>,
    param2: vec4<f32>,
};

struct NovaCustom {
    param: vec4<f32>,
    param2: vec4<f32>,
    // x: time, yz: the size of the picture being drawn, w: unused
    info: vec4<f32>,
    // a sprite's place in the sprite atlas (u0, v0, u1, v1)
    rect: vec4<f32>,
};

// The draw's two pictures (`textures = { "noise", "ripples" }`), filtered and repeating; white when not given.
fn nova_texture_a(uv: vec2<f32>) -> vec4<f32> {
    return textureSampleLevel(nova_tex_a, nova_tex_sampler, uv, 0.0);
}

fn nova_texture_b(uv: vec2<f32>) -> vec4<f32> {
    return textureSampleLevel(nova_tex_b, nova_tex_sampler, uv, 0.0);
}

// Brightness of a colour as the eye sees it (0 to 1 for ordinary colours).
fn nova_luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// A smooth value noise, 0 to 1, that changes about once per unit of `p`.
fn nova_noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = nova_hash(i);
    let b = nova_hash(i + vec2<f32>(1.0, 0.0));
    let c = nova_hash(i + vec2<f32>(0.0, 1.0));
    let d = nova_hash(i + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// A repeatable random number, 0 to 1, for a point.
fn nova_hash(p: vec2<f32>) -> f32 {
    let q = fract(p * vec2<f32>(0.1031, 0.1030));
    let r = q + dot(q, q.yx + 33.33);
    return fract((r.x + r.y) * r.x);
}

fn nova_surface_base() -> Surface {
    var s: Surface;
    s.uv = vec2<f32>(0.0);
    s.color = vec4<f32>(1.0);
    s.tint = vec4<f32>(1.0);
    s.normal = vec3<f32>(0.0, 0.0, 1.0);
    s.world = vec3<f32>(0.0);
    s.pixel = vec2<f32>(0.0);
    s.size = nova_custom.info.yz;
    s.time = nova_custom.info.x;
    s.param = nova_custom.param;
    s.param2 = nova_custom.param2;
    return s;
}
