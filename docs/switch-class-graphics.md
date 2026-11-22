# Switch-class graphics: the opt-in settings

Written 2026-11-09. The renderer already had instancing, culling, GPU skinning, one sun shadow map, FXAA, bloom, ambient occlusion,
colour grading, fog, a sky and the glTF material path (`docs/materials.md`). This adds the settings below, **all off by default: a game
that sets nothing draws exactly as it did**. Each one has its GPU cost measured on the Retroid Pocket 6 in
`docs/performance.md` ("Switch-class settings"), and the way to measure your own game is at the end.

## Turning them on

In `nova.json`:

```json
{ "format": 1, "name": "My Game", "graphics": { "hdr": true, "msaa": 4, "shadow_cascades": 3, "ibl": true, "anisotropy": 16 } }
```

or from Lua, for an options menu (all keys not given go back to off; `nova.graphics()` turns everything off):

```lua
nova.graphics{ hdr = true, msaa = 4, shadow_cascades = 3, ibl = true, anisotropy = 16 }
```

Changing a setting rebuilds the world's pipelines and puts everything back on the GPU (a hitch of a few hundred milliseconds), so do it
from a menu, not mid-race. A setting the GPU cannot do is dropped, and the log says which settings are in force (`quality: ...`).
`world_height` (below) is the manifest's old setting, not part of `graphics`.

| Setting | Values | What it does |
| --- | --- | --- |
| `hdr` | `true` / `false` | the world is drawn to a 16-bit float picture and finished with a filmic tone curve |
| `msaa` | `1` / `4` | 4 samples a pixel on the world pass |
| `shadow_cascades` | `1` to `3` | the sun's shadow in near, middle and far maps, with softly blended edges |
| `ibl` | `true` / `false` | materials are lit and reflect from a cube made from `nova.sky` |
| `anisotropy` | `1` to `16` | smooth model textures stay sharp on slanted surfaces; every size gets its mip chain |

## HDR (`hdr`)

The world pass writes `RGBA16Float`, so light above 1 is kept (a sun glint, a lamp, an emissive part), and the finishing pass puts it
through **ACES** (Narkowicz's fit: a toe, a long straight middle and a shoulder that rolls bright light off to white). `nova.look`
`exposure` multiplies the light before the curve. **Bloom works on real brightness** with `bloom_threshold` in the same units: a white
wall at 1.0 and a lamp at 6 are different things, and one hot pixel cannot put fireflies on the picture (each tap is capped at 12).
Sprites, billboards, custom shaders and a `nova.post` effect all draw into the HDR picture (a post shader sees values above 1).

Expect the picture to change: ACES deepens darks and saturates colours a little, and maps 1.0 to about 0.8. A game made for the plain look
often wants `exposure` 1.1 to 1.3 with `hdr`. `bloom_threshold` is now a real brightness (0.7 to 1.0 means "about white or brighter"), not a
fraction of an 8-bit white.

## MSAA (`msaa = 4`)

A real 4x multisampled world pass, resolved into the world picture: the Adreno is a tiled GPU, so the samples live in tile memory and
the multisampled colour is never written out (`StoreOp::Discard`). It smooths what FXAA cannot (a shader's own edges, thin geometry)
and costs no blur. Use it *instead of* `fxaa` (both work together, but there is little left for FXAA to do).

The finishing pass reads depth for `ao` and `outline`; a multisampled depth cannot be read like that, so with MSAA *and* one of those a
small extra pass makes a one-sample depth (the nearest of the four samples a pixel; a full-screen draw that writes depth).
Without `ao` or `outline` that pass does not run and the depth is never stored.

## Cascaded shadows (`shadow_cascades = 2 or 3`)

One map of 2048 by 2048 becomes up to three, one for each slice of the view: the view's depth from the camera to `3 x radius`
(`nova.shadows { radius }`, default 60, so 180 m) is cut into slices that are fine near the camera and coarse far away (a blend of
equal and geometric steps). Each slice's **bounding sphere** is drawn into its own map, so a map does not change size as the camera
turns, and its centre moves in whole texels, so shadows do not shimmer as the camera moves. Each cascade culls its own casters (a sun
pass for the near slice sees few of them). In the shader the nearest map that holds the pixel is used; across the last 15% of a slice
the shadow blends into the next map's, and fades out at the end of the last one; the normal offset and the bias grow with the
texel size of the cascade, so far shadows do not get acne. The edge is the engine's 3x3 taps of hardware-filtered comparisons (a soft
edge about four texels wide, times `nova.shadows { softness }`) in every cascade.
`shadow_cascades = 1` is the single map of `2 x radius` metres, with a second, fine map of the view's first `nova.shadows { near }`
metres (12 by default) in front of it (added 2026-11-21: one more shadow pass, of the few models near the camera).

Since 2026-11-21 every map's depth bias is half a texel, and the normal offset is half a texel plus the filter's reach times the sine
of the angle between the surface and the sun (nothing for a surface facing the sun, the whole reach for one the light grazes).
Before, the single map's bias was 0.0015 of its depth range, which at radius 42 was half a metre along the light: everything within
about 35 cm of the ground (a wheel, a foot, a car's sill) cast no shadow, and shadows started some way from their casters.

## Image-based light and a clear coat (`ibl`, `KHR_materials_clearcoat`)

With `ibl`, a small cube map (32 by 32 by 6 faces and 6 roughness levels, `RGBA16Float`) is drawn **from `nova.sky`**: the gradient
(top and horizon colours), the haze, the ground below the horizon (the horizon colour, darker), the sun's halo and the glow it lays
along the horizon. It is made again only when the sky's colours or the sun move (36 tiny passes), never per frame; there are no probes
to place. Models that use their glTF material (`"materials"` in `nova.json`) then
 * **reflect** that cube at the surface's roughness (level = roughness: a mirror at 0, the whole sky blurred at 1), where they used the
   sky's two colours before, and
 * take their **ambient light** from it in the direction of the surface normal (a top facing the sky is bluer and brighter than an
   underside facing the ground), scaled so that it averages the game's own `nova.ambient` light.

Clouds and stars are not in the cube (they are low-frequency in reflections anyway). The sun's own light, its shadow and its highlight are
separate and unchanged.

A **clear coat** (`KHR_materials_clearcoat`: `clearcoatFactor`, `clearcoatRoughnessFactor`; Blender's "Coat Weight" and "Coat Roughness")
is a glossy layer over the paint: it reflects 4% of what it faces at a straight look and more at a slant, adds sharp highlights of the sun and the
lamps on the model's smooth normal (not the normal map), and lets the rest of the light through to the paint below. It works with or without `ibl` (without, the sky's two colours
are what the coat reflects). The layer's pictures are ignored, with a note in `nova check`.

## Textures: mipmaps, anisotropy and KTX2

`anisotropy = N` gives every **smooth** model texture (a glTF sampler with linear filtering, a billboard) a full chain of mip levels
for any size, not only powers of two, and anisotropic filtering of up to N samples; so do the normal, metallic-roughness and emission
maps of materials. A palette texture (nearest filtering, the look of the low-poly kits) is left sharp on purpose.

**KTX2** textures: a picture already compressed for the GPU is a quarter to an eighth of the RGBA8 size, in the APK and in memory,
with its mip chain stored. `models/car.ktx2` beside `models/car.glb` becomes the model's base colour picture where the GPU can read
its format (ETC2 on every phone and Apple GPU, ASTC 4x4 to 12x12 on the Adreno and Apple GPUs; the file's own sRGB or linear format
is kept); otherwise the picture inside the `.glb` is used. Read: plain KTX2, one 2D layer, any number of levels, no supercompression
(no Basis Universal yet). `nova ktx2 [--linear] in.png out.ktx2` makes an **ETC2 RGB** file with the whole chain (the sides must be
multiples of 4, the picture opaque). It is an exhaustive-search encoder of ETC1's block modes, which an ETC2 decoder reads as they
are: on a smooth test picture the mean error against the original is about 2 of 255 on the GPU (`tests/ktx2_gpu.rs`). Not done: an ASTC
encoder (the loader reads ASTC files made by other tools, such as `astcenc`, but nothing here writes them), alpha (ETC2 RGBA with EAC
alpha), and stripping the full picture out of the `.glb` (the APK saves memory on the GPU now, and APK size only once the `.glb`
carries a small stand-in picture, which nothing makes for you yet).

## `world_height` 720 and 1080

The world renders at the manifest's `world_height` (540 by default), then is scaled to the 1920 by 1080 panel; `720` and `1080` have
always been allowed (the limit is 4320), and at 1080 the world is the native size. What they cost on the Retroid is in
`docs/performance.md`: the fill cost scales with the pixels (1.8 times at 720, 4 times at 1080), the shadow maps and the geometry do not.
The UI always renders at native resolution. Nothing about a picture's own detail changes: sprites and textures authored for 540 look
softer at 1080 (docs/spike-results.md).

## Measuring on a device

`scripts/graphics-bench.sh` installs nothing: install the APK first (use a package name of your own for a scratch build, as other games
share the device). It forces each setting (`NOVA_GRAPHICS=hdr,msaa=4,cascades=3,ibl,aniso=16,height=720` on a desktop; on a device the
same text in `/data/local/tmp/nova-graphics.<package>`) and prints the mean fps and GPU milliseconds of the log's per-second lines.
Compare against a plain run between settings: the numbers drift a little with the scene's state and the device's temperature.

## Before and after

`docs/images/pine-ridge-roam-before.png` and `-after.png` are Pine Ridge's free roam (the town, 1920 by 1080, a headless desktop capture,
the same frame) plain and with everything on: `hdr`, `msaa 4`, 3 cascades, `ibl`, `anisotropy 16`, `world_height 720`. The
device's own screenshots of the same two settings are `-device-before.png` and `-device-after.png` (taken 25 s after launch, so they
show different moments: the car was moving in them).
