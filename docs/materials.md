# Materials: normal maps, metal, shine and glow from glTF

Nova draws models in its own plain look by default: colour (vertex colours, the base colour factor and picture) lit by the sun,
its shadow, the ambient light, point and spot lights, toon bands and fog. A project can choose to light models by **their glTF
material** instead, which adds:

- **normal maps** (`normalTexture`): small bumps and grooves that catch the light, with no extra triangles;
- **metallic and roughness** (`metallicFactor`, `roughnessFactor`, `metallicRoughnessTexture`): metal takes the colour of its
  reflection, smooth surfaces show a sharp highlight of the sun and lights and reflect the sky, rough ones a wide soft one;
- **emission** (`emissiveFactor`, `emissiveTexture`): light a surface gives off by itself, in its own colour.

Nothing changes for a project that does not opt in. Every example game looks as it did.

## Opting in

In `nova.json`:

```json
{ "format": 1, "name": "My Game", "materials": true }
```

lights every model by its material. To light only some, name them (short names or paths, as `nova.model` takes them):

```json
{ "format": 1, "name": "My Game", "materials": ["knight", "models/props/lantern.glb"] }
```

A name that is not a model of the project is a warning in `nova check`. `examples/material-demo` shows a brick block with a normal
map, a gold sphere and a glowing lamp (and two custom shaders, see `docs/shaders.md`).

## What is read from the file

| glTF | Used as |
| --- | --- |
| `baseColorFactor`, `baseColorTexture`, `COLOR_0` | the colour, as in the plain look |
| `metallicFactor`, `roughnessFactor` | per part; a part with no material at all is not metal and fully rough (glTF's own default would be metal) |
| `metallicRoughnessTexture` | blue is metallic, green is roughness (both times the factors) |
| `normalTexture` and its `scale` | tangent space, OpenGL style (green is up the picture), as glTF says |
| `TANGENT` | used when the file has it; otherwise Nova works tangents out from the positions and texture coordinates |
| `emissiveFactor`, `emissiveTexture` | added light. A grey `emissiveFactor` with no picture keeps Nova's own meaning: the surface glows in its own colour at that strength (what the model editor's glow writes) |

Each kind of picture is taken from the first part that has one (as the base colour picture is), and maps use the same texture
coordinates (`TEXCOORD_0`) and repeat mode as the base colour. Not read: occlusion maps, `KHR_materials_*` extensions other than clearcoat (transmission, emissive strength...), a second UV set; the model's notes in `nova check` list what was ignored. A part with a normal
map but no base colour picture is drawn without its normal map.

## The light

It is a cheap stand-in for physically based light, chosen to sit with Nova's other light rather than to match a path tracer:

- diffuse light is the plain look's (sun times shadow, ambient, point and spot lights, toon bands), on the colour times
  (1 - metallic);
- each light adds a highlight: a normalised Blinn-Phong lobe whose sharpness comes from the roughness, times Schlick's Fresnel term
  (non-metals reflect 4%, metals their own colour);
- the reflection of the surroundings is the sky's two colours along the reflected view (or the ambient light when there is no
  sky), by a roughness-aware Fresnel term; there are no reflection probes or screen-space reflections;
- a **clear coat** (`KHR_materials_clearcoat`: `clearcoatFactor` and `clearcoatRoughnessFactor`; Blender's "Coat Weight" exports it) is a smooth glossy layer over all of that, as on car paint: it takes a few percent of the light at a straight look and more at a slant, adds its own sharp sun and lamp highlights and reflects the sky (a mirror at its roughness), using the model's smooth normal, not the normal map. The layer's pictures are ignored (the factors are used; `nova check` says so);
- emission is added, then fog.

With `nova.graphics{ ibl = true }` the reflections and the ambient light of materials come from a small cube map made from `nova.sky` (see `docs/switch-class-graphics.md`) instead of the sky's two colours and one ambient colour.

Skinned and animated models, scenery, level of detail fades and shadows work as before. See-through models stay see-through.

## Cost

Per pixel: three more texture reads (normal, metallic-roughness, emission maps; a 1 x 1 picture when a model has none) and a
highlight for the sun and each point light. Per vertex: 48 more bytes (tangent, metallic, roughness, emission), held only for the
models that are opted in. On the Retroid Pocket 6 (Adreno 740) at 1080p the demo's GPU time is recorded in `docs/performance.md`.

## On a GPU reset and on OpenGL ES

The material buffers and maps are made again with the rest when the GPU device is lost (`Gfx::recover`). The material shaders are
translated for OpenGL ES 3.0 in the tests (`shader::tests::nova_shaders_translate_for_gles`), so the fallback backend can draw them;
that backend has not been run on a device since it was fixed (see TODO.md).
