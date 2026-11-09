# Splitting Nova into four apps (plan, 2026-11-09)

> **Superseded 2026-11-09:** the owner kept one app. See `docs/studio-workspaces.md` (one studio, four workspaces as tabs or windows). Kept for the feature lists.

Status: **proposal, nothing built.** Written after the owner asked to break Nova into four pieces and to make them browser based.
Roadmap entries are not features; check the source before changing a contract.

## The shape

| App | What it is | Replaces / clones | Output |
| --- | --- | --- | --- |
| **Nova Model** | 3D modelling, rigging, animation, texturing, scenes and landscape | Blender (the parts a game needs) | `.glb`, `.model.json`, `*.scene.json`, terrain recipe |
| **Nova Pixel** | Sprites, tilesets and 2D animation | Pixelorama | `*.sprite.json`, PNG |
| **Nova Sound** | Sound effects, music, tracker, mixer | the existing sound studio, made full | WAV/OGG, song and sfx JSON |
| **Nova Engine** | Lua editor, project manager, scene placement, play, export | the current studio shell + `nova-runtime` | the game, the `.apk` |

They share one thing: **the project folder** (plain files, `docs/project-format.md`). No app calls another; each reads and writes the
folder. That is already the decided architecture, so the split costs nothing in the format. Shared code lives in `packages/`
(file access, UI kit, undo, project-folder types, the Rust-to-WASM core).

## Can all four be browser based? Yes for the tools, with three honest limits

1. **Files.** A project is a folder on disk. Chrome and Edge can open and write a real folder (File System Access API). Firefox and
   Safari cannot; they get an in-browser project (OPFS) with zip import and export. On the Retroid and desktop we also ship the same
   web apps inside the existing Tauri shell, which has full file access. So: one code base, two ways to run it.
2. **Building the APK.** `nova export android` needs the Android SDK and NDK; a browser cannot run them. Nova Engine in a browser can edit,
   run a preview and export a `.npk`; the final APK step stays in the desktop shell (or a local `nova` command). Release signing is
   the owner's anyway.
3. **Heavy 3D.** Browsers run WebGL2 well and WebGPU on recent Chrome/Edge/Safari. Game-sized meshes (up to ~100k triangles, rigs of a
   few hundred bones) are fine. Sculpting millions of polygons is not a goal (see Model, "Not cloned").

The game itself never runs in a WebView on a device (decided). Browser preview in Nova Engine runs the Rust runtime compiled to WASM
(`wgpu` already targets WebGPU/WebGL2) or a thin JS preview; either is a **preview**, and device behaviour is only what the Retroid shows.

## Common stack

- TypeScript + Svelte 5 (as the studio now), Vite, vitest. Rendering in the 3D app: three.js or our own thin WebGL2/WebGPU layer
  (decide in M0 below; three.js is the fast start, our own is cheaper in size and matches the runtime's shading).
- Rust to WASM for the parts that must be fast or must match the runtime exactly: mesh kernel (half-edge, subdivision, bevel, boolean,
  UV unwrap), glTF writer, the audio core (the C core compiles to WASM with Emscripten, or the Rust port), image codecs.
- UI kit shared: dockable panels, property editor, outliner, timeline, node/curve editors, undo/redo with a command stack, keymaps.
- Everything saves plain files a person could read. Studios never write code a person could not have typed.
- **Licences.** Blender (GPL-3) and Blockbench (GPL-3): reimplement ideas, never copy code. Pixelorama is MIT, so code can be
  ported (it is GDScript, so it is a port, not a copy-paste); keep its notice in `licenses/`. Aseprite is not open: do not copy.
  Check any dependency and add its notice.

## 1. Nova Model (the big one)

Goal: what a game maker needs from Blender, with Blender's good ideas (modifier stack, edit modes, shortcuts), and none of its
film-production surface. It is a multi-year product if "clone Blender" were literal, so the plan is by slice, each shippable.

**Foundation (M1)**
- Viewport: orbit/pan/zoom (Blender mouse and trackpad schemes, numpad views), perspective and ortho, grid, gizmos (move, rotate,
  scale), snapping (grid, vertex, edge, face, increment), shading modes (solid, material preview, wireframe), AO and shadows that match
  the runtime's "Switch-class" settings.
- Data: half-edge mesh with n-gons, seams, creases, custom normals, vertex groups, shape keys, multiple UV sets, materials.
- Outliner, properties panel, undo/redo, collections, parenting, hotkeys searchable, save to `.model.json` + `.glb`.

**Modelling (M2)**
- Object and Edit modes (vertex, edge, face), select (box, circle, lasso, loop, ring, linked, similar), extrude, inset, bevel,
  loop cut, knife, bridge, merge, dissolve, fill, grid fill, spin, proportional editing, mirror editing.
- Non-destructive modifier stack (already begun in the studio model editor: Mirror, Subdivision, Bevel, Solidify, Array, Revolve): add
  Boolean, Shrinkwrap, Decimate, Weld, Remesh (voxel), Curve, Lattice, Displace, Triangulate.
- Primitives, curves and surfaces (Bezier, extrude along curve, lathe), text to mesh (for signs), reference images and blueprints.
- Basic sculpt (grab, smooth, inflate, crease, mask) on up to ~500k triangles with a multires-style workflow, not ZBrush.

**Texturing (M3)**
- UV editor: unwrap (angle based), pin, stitch, pack islands, checker overlay, UDIM not needed.
- Texture paint on the model (brush, fill, clone, mask, layers), PBR channels (base, normal, metallic-roughness, emissive) as
  our runtime reads them, baking (AO, normal from high-poly, curvature, lighting to vertex colour or atlas), material editor (a
  small node graph that always compiles to the runtime's single material).
- Atlas packing and export to KTX2 where the runtime supports it.

**Rigging and animation (M4)**
- Armatures: bones, hierarchy, roll, bone shapes, mirror, IK (two-bone and chain), constraints (copy, limit, track-to, child-of),
  envelope and automatic weights, weight painting, pose mode, pose library.
- Animation: dope sheet, graph editor (bezier, linear, constant), NLA-lite (clips, blend, loop), shape keys, root motion, retarget a
  clip between rigs, glTF skin and animation export. Match the runtime's skinning limits (bones per vertex, joint count).
- Rig templates (humanoid, quadruped, car with wheels) so a beginner starts with a working rig.

**Scenes and landscape (M5)**
- 3D scene editor that places models on the snapping grid and writes `*.scene.json` (this part already exists in the studio and moves
  across); lights, cameras, triggers, paths, colliders and navigation hints as object props.
- Landscape: heightmap sculpt and paint, splat-map layers, roads and splines that conform to terrain, water, foliage scatter with
  density maps, a recipe saved as the existing terrain recipe (`terrain.rs`).
- Lightmap bake for static scenes (`bake.rs` knows the format).

**Beginner path (all milestones):** a "simple mode" with ten tools and a guided first model; the full mode shows everything.

**Not cloned:** Cycles/Eevee rendering, geometry nodes, fluids and smoke, cloth, hair, video editing, compositing, Python scripting
(we expose a small Lua-free "recipes" mechanism instead), grease pencil. If a game ever needs one, import it from Blender as a `.glb`.
Blender stays an optional import path (one-click `.blend` to `.glb` through headless `bpy` on the desktop shell only).

## 2. Nova Pixel (Pixelorama, ported)

Pixelorama covers what 2D games need and is MIT. Browser version of its feature set, in this order:

- **P1 Core:** canvas with zoom and grid, layers (pixel, group, tilemap), frames and a timeline with cels, onion skin, tags, playback,
  palettes (create, import, extract), pencil, eraser, bucket, line, rectangle, ellipse, shading, colour picker, selections (rect,
  ellipse, lasso, magic wand), move, transform, flip and rotate, symmetry and tiling modes, pixel-perfect, undo/redo.
- **P2 Production:** linked cels, blend modes, cel and layer effects, reference images, tilemap layers and tileset editor with
  auto-tiling rules, 9-slice, spritesheet import and export (atlas JSON matching `*.sprite.json`), animation tags as named clips,
  hitboxes and anchor points per frame, GIF/PNG sequence/spritesheet export.
- **P3 Interop:** import `.pxo` (Pixelorama), `.aseprite`, PNG and GIF; export the runtime's sprite format directly; hot reload into
  a running game; scriptable batch (resize, recolour palette).
- **P4 Polish:** brushes (custom, dynamics), dithering, palettize and colour reduction, rotsprite and cleanEdge scaling, pixel-art
  vector shapes, animation helpers (squash and stretch presets, cycles).

A web build of Pixelorama already exists, which proves the browser can do this; the work is porting its logic to TypeScript (canvas
2D or WebGL) and wiring our file format. The current studio's sprite editor is the starting code.

## 3. Nova Sound (the existing sound studio, made complete)

Starting point: sample-clock C core in `audio/`, plus the sfx and song editors in the studio. Moves out as its own app.

- **S1 Foundation:** AudioWorklet engine running the core compiled to WASM (so the browser and the device sound the same), the same
  offline render the tests use, waveform editor, record from microphone, import WAV/OGG/MP3/FLAC, export WAV/OGG.
- **S2 Sound effects:** synth designer (oscillators, noise, envelopes, filters, LFO, bit crush, distortion, pitch sweep) with
  randomise and mutate, and effect chains (EQ, compressor, reverb, delay, chorus, limiter), one-shot variations for repeated sounds.
- **S3 Music:** tracker and piano roll, instrument designer (synth, sampler, drum kit), patterns and arrangement, tempo and time
  maps, automation lanes, MIDI import and export, mixer with buses and sends, loop points for seamless game loops.
- **S4 Game audio:** layered adaptive music (stems that fade by game state), randomised sound sets, spatial presets (distance and
  doppler curves the runtime understands), loudness meter and normalisation (LUFS), a soundbank view with usage from the project.
- **S5 Polish:** spectrum and spectrogram, sample slicing, time stretch and pitch shift, VST-like plugin format of our own.

Honest limit: nobody has listened to the existing radio songs; offline renders are not listening tests. Audio latency in a browser
is higher than on the device, so device checks stay mandatory.

## 4. Nova Engine (code and putting it together)

The runtime (`crates/nova-runtime`) plus the project-level editor. It is the app a person opens first and the only one that knows how a
game fits together.

- **E1 Project hub:** create, open, templates, asset browser (thumbnails, search, drag into scenes), links to open a file in Model,
  Pixel or Sound (opens the other app on that file; saving reloads it here).
- **E2 Code:** Lua editor (CodeMirror), completions and hover docs from `nova-api.json`, error list with jump to line, hot reload,
  debugger (breakpoints, watch, profiler), formatter, a gentle "visual script" path for beginners that writes Lua a person could type.
- **E3 Scenes:** 2D and 3D scene editor with the layout tools (snapping grid, tilemaps, object props), prefab-like entities,
  physics and collision shapes, UI layouts, cameras. (Today's studio scene editor.)
- **E4 Play:** run in the browser (runtime to WASM) and on a connected device over ADB, live in-game console, input mapping for the
  controller, screenshot and recording, performance overlay (frame time, draw calls, triangles).
- **E5 Ship:** `.npk` pack, APK export, icons and splash, a settings checklist. Signing and publishing stay with the owner.
- **Engine work still open:** the renderer's opt-in Switch-class settings, a plugin API, networking, and 3D animation playback
  from Nova Model clips.

## Order of work

M0 (about 2 weeks): split the repo into `packages/` and `apps/` with the shared UI kit and the file-access layer; run the current
studio's editors as the first Engine and move the sound and sprite editors out unchanged. Decide three.js or our own renderer.
Then: **Sound** and **Pixel** first (they are closest to done and the browser fit is easy), **Engine** next (it keeps the game
playable), **Model** in parallel as the long project, one milestone at a time. Nova Model M1 to M2 is the first thing worth testing in a
person's hands; M3 to M5 follow.

## Open questions for the owner

1. Chrome-only for folder access is acceptable? (Otherwise OPFS plus zip everywhere else.)
2. Ship each app as its own site, or one hub that opens the four?
3. Keep the Tauri desktop shell as the way to build APKs and talk to the Retroid, with the web apps inside it?
4. Is Nova Model's first target "make a car like the Pine Ridge ones" (hard surface), or "make a character" (rigging)? It sets M2 vs M4.
