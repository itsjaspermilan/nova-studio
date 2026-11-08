# Custom shaders

A custom shader is a small file of WGSL (the shading language of WebGPU, which Nova's renderer uses) that decides the colour of
each pixel of a model, a sprite, or the whole world picture. Put it in the project's `shaders/` folder:

```wgsl
// shaders/glow_pulse.wgsl: the model's own colour, pulsing brighter and dimmer once a second
fn shade(s: Surface) -> vec4<f32> {
    let pulse = 0.75 + 0.25 * sin(s.time * 6.283);
    return vec4<f32>(nova_fog(s, nova_light(s, s.color.rgb) * pulse), s.color.a);
}
```

and name it in a draw:

```lua
nova.model("crystal", x, y, z, { shader = "glow_pulse" })
nova.sprite("coin", x, y, { shader = "shine", params = { 0.5 } })
nova.ui.sprite("button", x, y, { shader = "shine" })
nova.post("postcard", { params = { 0.35 } })     -- over the whole world picture, until nova.post() clears it
```

An entity passes its `shader`, `shader_params`, `shader_textures` and `blend` fields on, so a scene file's object can carry them in
its props, or the class can set them:

```lua
return nova.entity { model = "pool", shader = "water", blend = true, shader_params = { 1.6, 7, 0.72 } }
```

The file's name without `.wgsl` is the shader's name (`shaders/fx/heat.wgsl` is `"fx/heat"`). `nova.shaders()` lists the ones that
compiled. `examples/material-demo` has three: water ripples, a dissolve, and a post effect.

## The one function: `shade`

`fn shade(s: Surface) -> vec4<f32>` returns the pixel's colour, linear red, green, blue and alpha (0 to 1; brighter than 1 is
allowed and shows in bloom). Everything it can know is in `s`:

| Field | On a model | On a sprite | As a post effect |
| --- | --- | --- | --- |
| `s.uv` | the model's texture coordinates | 0 to 1 across the picture, (0, 0) at its top left | 0 to 1 across the screen |
| `s.color` | its colour as Nova would draw it before light: picture x vertex colour x tint | the picture's pixel x tint | the finished world picture here |
| `s.tint` | vertex colour x tint | the tint | white |
| `s.normal` | the surface's direction in the world | (0, 0, 1) | (0, 0, 1) |
| `s.world` | where the pixel is in the world (metres) | (0, 0, 0) | (0, 0, 0) |
| `s.pixel`, `s.size` | the pixel's place on the picture being drawn and that picture's size, in pixels |||
| `s.time` | seconds of game time (stops with `nova.pause`) |||
| `s.param`, `s.param2` | the draw's `params = { ... }`: the first four numbers, then the next four (missing ones are 0) |||

Helpers you can call:

| Helper | What it does |
| --- | --- |
| `nova_light(s, rgb)` | a colour lit the way Nova lights models here: the sun and its shadow, ambient, point and spot lights, toon bands. On sprites and post effects it returns `rgb` unchanged |
| `nova_fog(s, rgb)` | the scene's fog over a colour (models only; unchanged elsewhere) |
| `nova_texture_a(uv)`, `nova_texture_b(uv)` | the draw's pictures, `textures = { "noise", "ripples" }`: a project path or a short name for `sprites/<name>.png` or `textures/<name>.png`; filtered and repeating; white when not given. They are read as colours (sRGB made linear, like every picture Nova draws): for a picture of plain numbers (noise, a height) use `pow(value, 1.0 / 2.2)` to get back what was painted |
| `nova_scene(uv)` | the world picture at another place (post effects; transparent black elsewhere) |
| `nova_sprite(uv)` | the sprite's own picture at a place 0 to 1 across it (sprites only) |
| `nova_noise(p)`, `nova_hash(p)`, `nova_luma(rgb)` | smooth noise 0 to 1, a repeatable random number 0 to 1, how bright a colour looks |

`discard;` leaves the pixel undrawn (a dissolve, a cut-out). A model drawn with `blend = true` is see-through by the alpha it
returns: it is drawn after the solid models, does not hide what is behind it and casts no shadow. Without `blend` the alpha is
ignored and the model casts a shadow of its whole shape (holes made by `discard` do not show in the shadow). Sprites always blend.
A post effect's alpha is ignored.

You can write your own functions, constants and structs beside `shade`. Names starting with `nova_` are Nova's, and a few others
(`safe_normalize`, `srgb_to_linear`, `globals`, ...) are taken by the prelude: the error says so if you reuse one.

## What a shader cannot do

It cannot declare its own GPU resources (`@group`, `@binding`, `var<uniform>`, `var<storage>`), entry points (`@vertex`,
`@fragment`, `@compute`), `override`s, or switch on extensions (`enable`). It gets at most eight numbers and two pictures. This keeps
every shader working with the rest of the renderer on every backend. A shader with a loop that never ends would hang the GPU until
the system resets it (Nova then recovers the device, see below); keep loops short and bounded.

## Mistakes

Every shader file is compiled when the game loads and by `nova check` (the studio's Problems panel), before anything reaches the GPU,
with naga, the shader compiler inside wgpu. A mistake is reported on the file's own line and column:

```
error: shaders/water.wgsl:12: invalid field accessor `colour`
```

The game still runs: a draw that names a shader with a mistake is drawn without it, and the log says so once. A draw that names a
shader that does not exist is a script error that lists the project's shaders.

The same check translates each shader for OpenGL ES 3.0, so one that the fallback backend could not run is reported the same way
("would not run on OpenGL ES 3.0 ...") rather than failing on a device.

## Cost and limits

Each custom-shaded model or sprite is its own draw call (they are not batched like plain ones), at most 255 a frame (more are
skipped); a post effect is one extra full-screen pass at the world picture's resolution. Each shader's pipelines are made the
first time it is drawn in a way (on a model, a skinned model, see-through, a sprite, a post effect), which can take a few
milliseconds once. Custom shaders and their pictures are put back after a GPU device loss with the same names. A custom shader on a
model replaces Nova's material light for that draw (call `nova_light` for the plain light).
