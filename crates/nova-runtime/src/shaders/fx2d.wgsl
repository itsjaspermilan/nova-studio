// 2D effects (gfx/fx2d.rs): sprites that add light or are lit by it, soft and round shapes, the light map, puddle reflections and
// rain. Everything here is opt-in; a game that asks for none of it never draws with these pipelines.
//
// Coordinates are the sprites' logical units (x right, y down, the view 540 high). Colours from scripts are 8-bit sRGB; the
// target is sRGB (or linear float), so the shaders work in linear light. Every fragment here returns premultiplied colour.
struct View {
    size: vec2<f32>,
    pad: vec2<f32>,
};
@group(0) @binding(0) var<uniform> view: View;
@group(1) @binding(0) var atlas: texture_2d<f32>;
@group(1) @binding(1) var atlas_sampler: sampler;

struct Fx {
    // pixels of the world picture (the light map and the mirror cover it exactly)
    canvas: vec2<f32>,
    // the world position (units) of the view's top-left corner: rain and rings stay put on the ground as the camera moves
    origin: vec2<f32>,
    time: f32,
    // rain: 0 (none) to 1
    rain: f32,
    // sideways units per unit of fall
    wind: f32,
    drops: f32,
    splashes: f32,
    // reflections: how far they wobble (units), how strong (0 to 1), how bright rain rings are on the water
    ripple: f32,
    strength: f32,
    rings: f32,
    rain_color: vec4<f32>,
    // the colour reflections are multiplied by (linear); w: 1 when the light map is on
    tint: vec4<f32>,
};
@group(2) @binding(0) var light_map: texture_2d<f32>;
@group(2) @binding(1) var light_sampler: sampler;
@group(2) @binding(2) var<uniform> fx: Fx;
@group(3) @binding(0) var mirror: texture_2d<f32>;
@group(3) @binding(1) var mirror_sampler: sampler;

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    let low = c / 12.92;
    let high = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    return select(high, low, c <= vec3<f32>(0.04045));
}

// ---------------------------------------------------------------- sprites (the same quads as sprite.wgsl)
struct Instance {
    @location(0) center: vec2<f32>,
    @location(1) size: vec2<f32>,
    @location(2) uv: vec4<f32>,
    @location(3) color: vec4<f32>,
    @location(4) rotation: f32,
};

struct SpriteOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
    // -1 to 1 across the quad (for the round shapes)
    @location(2) local: vec2<f32>,
};

@vertex
fn vs_sprite(@builtin(vertex_index) vertex: u32, inst: Instance) -> SpriteOut {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, -0.5), vec2<f32>(0.5, 0.5),
        vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, 0.5), vec2<f32>(-0.5, 0.5),
    );
    let corner = corners[vertex];
    let s = sin(inst.rotation);
    let c = cos(inst.rotation);
    let local = corner * inst.size;
    let world = vec2<f32>(local.x * c - local.y * s, local.x * s + local.y * c) + inst.center;
    var out: SpriteOut;
    out.position = vec4<f32>(world.x / view.size.x * 2.0 - 1.0, 1.0 - world.y / view.size.y * 2.0, 0.0, 1.0);
    out.uv = mix(inst.uv.xy, inst.uv.zw, corner + vec2<f32>(0.5, 0.5));
    out.color = vec4<f32>(srgb_to_linear(inst.color.rgb), inst.color.a);
    out.local = corner * 2.0;
    return out;
}

fn light_at(position: vec4<f32>) -> vec3<f32> {
    return textureSampleLevel(light_map, light_sampler, position.xy / fx.canvas, 0.0).rgb;
}

fn picture(in: SpriteOut) -> vec4<f32> {
    return textureSample(atlas, atlas_sampler, in.uv) * in.color;
}

// a disc with a one-pixel soft rim (`local` is -1 to 1 across the quad, so an ellipse when the quad is not square)
fn disc(in: SpriteOut) -> vec4<f32> {
    let d = length(in.local);
    let rim = max(fwidth(d), 1e-3);
    return vec4<f32>(in.color.rgb, in.color.a * (1.0 - smoothstep(1.0 - rim, 1.0, d)));
}

// soft all the way: full in the middle, nothing at the edge (glows, drop shadows)
fn soft(in: SpriteOut) -> vec4<f32> {
    let d = clamp(length(in.local), 0.0, 1.0);
    let k = 1.0 - d * d;
    return vec4<f32>(in.color.rgb, in.color.a * k * k);
}

fn premultiplied(c: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(c.rgb * c.a, c.a);
}

@fragment
fn fs_picture(in: SpriteOut) -> @location(0) vec4<f32> {
    return premultiplied(picture(in));
}

@fragment
fn fs_picture_lit(in: SpriteOut) -> @location(0) vec4<f32> {
    let c = picture(in);
    return premultiplied(vec4<f32>(c.rgb * light_at(in.position), c.a));
}

@fragment
fn fs_disc(in: SpriteOut) -> @location(0) vec4<f32> {
    return premultiplied(disc(in));
}

@fragment
fn fs_disc_lit(in: SpriteOut) -> @location(0) vec4<f32> {
    let c = disc(in);
    return premultiplied(vec4<f32>(c.rgb * light_at(in.position), c.a));
}

@fragment
fn fs_soft(in: SpriteOut) -> @location(0) vec4<f32> {
    return premultiplied(soft(in));
}

@fragment
fn fs_soft_lit(in: SpriteOut) -> @location(0) vec4<f32> {
    let c = soft(in);
    return premultiplied(vec4<f32>(c.rgb * light_at(in.position), c.a));
}

// ---------------------------------------------------------------- the light map
// Each light is a quad as wide as its circle, added into a small float picture (a quarter of the world picture's size) cleared to the
// ambient colour. The world's sprites are multiplied by it where they stand. The fall-off is (1 - d^2)^2: full at the middle, half at
// about 0.54 of the radius, nothing at the edge.
struct LightIn {
    @location(0) center: vec2<f32>,
    @location(1) radius: vec2<f32>,
    @location(2) color: vec4<f32>,
};

struct LightOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) color: vec4<f32>,
};

@vertex
fn vs_light(@builtin(vertex_index) vertex: u32, l: LightIn) -> LightOut {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
    );
    let corner = corners[vertex];
    let world = l.center + corner * l.radius;
    var out: LightOut;
    out.position = vec4<f32>(world.x / view.size.x * 2.0 - 1.0, 1.0 - world.y / view.size.y * 2.0, 0.0, 1.0);
    out.local = corner;
    out.color = l.color;
    return out;
}

@fragment
fn fs_light(in: LightOut) -> @location(0) vec4<f32> {
    let k = max(1.0 - dot(in.local, in.local), 0.0);
    return vec4<f32>(in.color.rgb * (k * k), 0.0);
}

// ---------------------------------------------------------------- reflections
fn hash21(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

// Rain rings on the water: the world cut into cells 28 units square; a cell holds a ring now and then, which grows and fades.
fn rings_at(world: vec2<f32>) -> f32 {
    if (fx.rain <= 0.0 || fx.rings <= 0.0) {
        return 0.0;
    }
    let cell = floor(world / 28.0);
    let h = hash21(cell);
    let period = 0.7 + 0.6 * h;
    let t = fx.time / period + h * 7.0;
    let age = fract(t);
    let cycle = floor(t);
    // only some cells, more of them in heavier rain
    if (hash21(cell + vec2<f32>(cycle, cycle * 1.7)) > fx.rain * 0.8) {
        return 0.0;
    }
    let centre = (cell + vec2<f32>(0.3, 0.3) + 0.4 * vec2<f32>(hash21(cell + cycle), hash21(cell - cycle))) * 28.0;
    let d = (world - centre) * vec2<f32>(1.0, 2.2);
    let r = age * 11.0;
    let band = 1.0 - smoothstep(0.0, 1.1, abs(length(d) - r));
    return band * (1.0 - age);
}

// The puddle tiles again, each showing the mirror (the things above it, flipped, drawn into their own picture) where its own picture is
// opaque, darkened and tinted, wobbling a little from side to side.
@fragment
fn fs_reflect(in: SpriteOut) -> @location(0) vec4<f32> {
    let mask = textureSample(atlas, atlas_sampler, in.uv).a * in.color.a;
    // (the view is always 540 units high)
    let px_per_unit = fx.canvas.y / 540.0;
    let world = in.position.xy / px_per_unit + fx.origin;
    let wobble = sin(world.y * 0.85 + fx.time * 2.7) + 0.5 * sin(world.y * 2.3 - fx.time * 4.1);
    let uv = (in.position.xy + vec2<f32>(wobble * fx.ripple * px_per_unit * 0.6, 0.0)) / fx.canvas;
    let r = textureSampleLevel(mirror, mirror_sampler, uv, 0.0);
    var rgb = r.rgb * fx.tint.rgb;
    if (fx.tint.w > 0.5) {
        rgb = rgb * light_at(in.position);
    }
    let a = r.a * fx.strength * mask;
    rgb = rgb * fx.strength * mask;
    rgb = rgb + rings_at(world) * fx.rings * fx.rain_color.rgb * mask;
    return vec4<f32>(rgb, a);
}

// ---------------------------------------------------------------- rain
// Drawn from the instance number alone (no buffer, no script): the first `drops` instances are streaks falling along the wind, the
// rest are splash rings on the ground. Each is placed by a hash of its number, wrapped round the view and moved against the camera so
// that they belong to the world, not the screen.
struct RainOut {
    @builtin(position) position: vec4<f32>,
    // streaks: x across (-1 to 1), y along (0 at the head, 1 at the tail); splashes: -1 to 1 across the ring
    @location(0) local: vec2<f32>,
    // x: 0 for a streak, 1 for a splash; y: how bright (0 to 1)
    @location(1) kind: vec2<f32>,
};

fn hash11(n: f32) -> f32 {
    return fract(sin(n * 12.9898 + 78.233) * 43758.5453);
}

fn wrap(v: f32, span: f32) -> f32 {
    return v - floor(v / span) * span;
}

@vertex
fn vs_rain(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> RainOut {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
    );
    let corner = corners[vertex];
    let i = f32(instance);
    var out: RainOut;
    var world: vec2<f32>;
    if (i < fx.drops) {
        // a streak: falls `fall` units a second along (wind, 1); the head starts above the view and wraps
        let dir = normalize(vec2<f32>(fx.wind, 1.0));
        let len = mix(16.0, 30.0, hash11(i * 3.1));
        let fall = mix(560.0, 760.0, hash11(i * 5.7));
        let span = vec2<f32>(view.size.x + abs(fx.wind) * view.size.y + 80.0, view.size.y + 80.0);
        let travel = fx.time * fall;
        var head = vec2<f32>(hash11(i * 1.3) * span.x, hash11(i * 2.9) * span.y) + dir * travel - fx.origin;
        head = vec2<f32>(wrap(head.x, span.x), wrap(head.y, span.y)) - vec2<f32>(40.0 + max(fx.wind, 0.0) * view.size.y, 40.0);
        let side = vec2<f32>(dir.y, -dir.x);
        world = head - dir * len * corner.y + side * corner.x * 0.55;
        out.kind = vec2<f32>(0.0, mix(0.45, 1.0, hash11(i * 7.3)));
    } else {
        // a splash: a ring that grows and fades over its own short time, then comes back somewhere else
        let j = i - fx.drops;
        let period = 0.35 + 0.3 * hash11(j * 4.1);
        let t = fx.time / period + hash11(j * 9.7);
        let age = fract(t);
        let cycle = floor(t);
        var at = vec2<f32>(hash11(j * 1.7 + cycle * 0.61), hash11(j * 3.3 + cycle * 1.37)) * view.size - fx.origin;
        at = vec2<f32>(wrap(at.x, view.size.x), wrap(at.y, view.size.y));
        let size = vec2<f32>(7.0, 2.8) * (0.35 + age);
        let c = vec2<f32>(corner.x, corner.y * 2.0 - 1.0);
        world = at + c * size;
        out.kind = vec2<f32>(1.0, 1.0 - age);
        out.local = c;
        out.position = vec4<f32>(world.x / view.size.x * 2.0 - 1.0, 1.0 - world.y / view.size.y * 2.0, 0.0, 1.0);
        return out;
    }
    out.local = corner;
    out.position = vec4<f32>(world.x / view.size.x * 2.0 - 1.0, 1.0 - world.y / view.size.y * 2.0, 0.0, 1.0);
    return out;
}

@fragment
fn fs_rain(in: RainOut) -> @location(0) vec4<f32> {
    var a: f32;
    if (in.kind.x < 0.5) {
        // brightest at the head, fading along the tail
        a = (1.0 - in.local.y) * (1.0 - abs(in.local.x) * 0.5) * in.kind.y;
    } else {
        let d = length(in.local);
        a = (1.0 - smoothstep(0.0, 0.3, abs(d - 0.8))) * in.kind.y * 0.45;
    }
    a = a * fx.rain_color.a;
    var rgb = fx.rain_color.rgb;
    if (fx.tint.w > 0.5) {
        // rain catches the light: brighter near lamps and signs
        rgb = rgb * (vec3<f32>(0.45) + light_at(in.position));
    }
    return vec4<f32>(rgb * a, a);
}
