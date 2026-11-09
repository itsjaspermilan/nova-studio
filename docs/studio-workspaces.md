# One studio, four workspaces (plan, 2026-11-09)

Status: **proposal, nothing built beyond what the studio already has.** Supersedes `docs/split-plan.md` (four separate apps), which the owner
dropped: Nova stays one Tauri app. Each workflow is a **workspace** that opens as a tab or, on request, in its own window.
Built from the Blender manual (docs.blender.org), the Pixelorama docs (pixelorama.org) and the LMMS manual (docs.lmms.io),
read for what each tool is organised around, plus what the studio already has (`studio/src/components/`: `ModelEditor`, `ModifierStack`,
`SpriteEditor`, `SoundEditor`, `SongEditor`, `TrackEditor`, `TimelineEditor`, `SceneEditor`, `Scene3D`, `Editor`).
Roadmap entries are not features: check the source before changing a contract.

## 1. The spine (shared by every workspace)

What stays the same everywhere, so a person learns it once:

- **Project = one folder of plain files** (decided; `docs/project-format.md`). All workspaces read and write it. The studio never writes
  code a person could not have typed.
- **Windows and tabs.** Window chrome is built in (traffic lights on macOS, drawn caption buttons on Windows; `WindowButtons.svelte`).
  A workspace is a tab in the main window; right-click a tab or press a key to *tear it off* into its own window (Tauri multi-window).
  A torn-off window shares the project, undo history per document, and the file watcher, so two windows on one project stay in step.
- **Areas.** Every workspace is a set of resizable areas (Blender's idea: any area can be switched to another editor type, split,
  joined, maximised, full-screened). Layouts are saved per workspace and per user; each workspace ships 2 to 3 presets
  (for example a modelling, an animation and a texturing layout). Areas always include: **main view**, **browser/outliner** (left), **properties** (right), **timeline or
  strip** (bottom). The Lua code editor can be an area in any workspace.
- **One interface, no beginner mode** (decided 2026-11-09): everyone gets the full toolset. Learnability comes from templates, guided exercises, hints and the command palette (`docs/studio-ux.md` section 6).
- **Command palette** (Cmd/Ctrl-K): search every command, setting and help page; shows the shortcut (Blender's F3 search).
- **Keymaps:** defaults per workspace, an editable keymap, optional Blender and Pixelorama/Aseprite presets. Controller navigation remains
  for the device-side tools only.
- **Undo/redo:** one command stack per open document, visible as a history list (Blender's Undo History), survives tab tear-off.
- **Assets:** one asset browser over the project (thumbnails, tags, search, drag into any workspace). Previews of models, sprites, sounds.
  "Open in" jumps to the owning workspace.
- **Linked data, not copies.** A sprite used in a scene is a reference; edit it in Sprites, the scene updates (hot reload into a running
  game already exists).
- **Preview/Play** is always one key (F5): runs the game from any workspace, on desktop or a connected device.
- **Help:** hover tooltips with the shortcut, "?" on any panel opens its page, a small tutorials system (`lib/tutorials`) per workspace.
- **Status bar:** current tool hints (Blender's status bar), mesh and memory stats, device state, frame cost.

The old idea of exporting out of each app and importing into Engine is not needed: the folder is the shared state.

## 2. Workspace: Model (3D). Reference: Blender

Blender's manual is organised as Interface > Editors > Scenes/Objects > Modeling > Sculpting/Painting > Animation/Rigging > Physics >
Render > Assets. We take the parts a game needs and drop film production. What to build, in order of how much a game needs it.

### 2.1 Layout (default "Modeling" preset)
- **3D viewport** (centre): perspective and orthographic, numpad-style view buttons, navigation gizmo (click an axis to align), grid and
  axes, camera view, local view and isolate, wireframe/solid/material preview, X-ray, overlays toggle (normals, seams, creases, UV
  seams, face orientation, stats), transform gizmos, a **tool shelf** on the left (select, move, rotate, scale, extrude, bevel, knife, ...).
- **Outliner** (top right): objects, collections, children, modifiers, materials, visibility and lock toggles.
- **Properties** (bottom right, tabs like Blender's): Object, Modifiers, Material, Mesh data (vertex groups, shape keys, UV maps),
  Armature/Bone, Constraints, Physics-lite (collision shape), Export.
- **Timeline / Dope sheet** (bottom) for animation; **UV editor** and **Texture paint** as alternate area types.
- Header per area with mode switch: **Object, Edit, Sculpt, Weight Paint, Texture Paint, Pose**.

### 2.2 Modelling tools
- Primitives (cube, plane, cylinder, sphere, cone, torus, capsule) with redo-panel parameters (Blender's "Adjust last operation").
- Selection: click, box, circle, lasso, loop, ring, linked, similar, grow/shrink, random, by material, invert; vertex/edge/face modes;
  X-ray select-through; hide/reveal; select by vertex group.
- Edit: extrude (region, individual, along normal), inset, bevel (edges and vertices, profile), loop cut and slide, knife, bridge loops,
  merge/weld by distance, dissolve, delete, fill, grid fill, subdivide, poke, triangulate/quads, flip normals, recalc normals, spin,
  screw, shear, smooth vertices, relax, shrink/fatten, push/pull, **proportional editing** (falloff types, connected only).
- Transform: G/R/S with axis constraints, numeric input, snapping (grid, vertex, edge, face, volume, increment, absolute), pivot
  point (median, 3D cursor, individual origins, bounding box), orientation (global, local, normal, view), mirror editing, pivot/origin
  tools, align, distribute, clear transforms, apply transforms.
- Modifier stack (exists: Mirror, Subdivision, Bevel, Solidify, Array, Revolve): add **Boolean, Weld, Decimate, Triangulate, Edge
  Split, Weighted Normal, Displace, Curve, Lattice, Shrinkwrap, Simple Deform, Smooth, Remesh (voxel), Screw, Wireframe, Armature,
  Mirror across object**. Per-modifier viewport/export toggles, reorder, apply, apply all, cage kept in `.model.json`.
- Curves: Bezier and NURBS-lite, extrude/bevel along a curve, convert to mesh; text to mesh for signs. Reference images and
  blueprint planes in the viewport (front/side/top); background image opacity.
- Mesh analysis: overhang-like checks do not matter; we need **triangle budget**, non-manifold, n-gons, flipped, loose parts, texel
  density, UV overlap, in a Mesh Analysis overlay with a **budget bar per target** (Retroid hero car 40k triangles).
- LOD: generate lower detail levels (Decimate) and export them with the runtime's LOD naming.

### 2.3 Sculpting and painting (a reduced Blender sculpt)
- Brushes: draw, clay, grab, smooth, inflate, crease, flatten, pinch, mask, move; radius/strength with pressure, falloff curve,
  symmetry (X/Y/Z, radial), dynamic topology or voxel remesh, multires (levels) for up to ~500k triangles; face sets and masks.
- Texture paint: brush, fill, gradient, clone, soften, smear, mask, stencil, projection paint from the view, layers with blend modes,
  per-channel painting (base colour, metallic-roughness, normal, emission), paint to vertex colour; symmetry; brushes shared with Sprites.
- Weight paint: draw, blur, gradient, average, vertex group list, normalise, limit total, mirror weights, auto weights from bones,
  "show zero weights", per-bone weight display.
- Bake: ambient occlusion, curvature, thickness, normal map from a high-poly copy, lighting to atlas or vertex colour, selected-to-active;
  bake outputs the runtime's one-atlas-per-model maps.

### 2.4 UVs and materials
- UV editor: unwrap (angle based, conformal, cube/cylinder/sphere/project from view), mark seams, pin, straighten, align, stitch,
  weld, relax, pack islands (rotate, margin), texel density tools, checker texture, UV stretch overlay, snapping, sync selection;
  multiple UV sets.
- Materials: a PBR surface editor (base colour, metallic, roughness, emission, alpha mode, double sided), texture slots mapped to the
  runtime's four maps, and a **node view** that stays small (colour ramp, mix, texture, noise, AO) and bakes down to the single
  runtime material. Preview with image-based light and the Switch-class settings from `docs/switch-class-graphics.md`.
- Atlas packing across objects; compression (KTX2/ETC2) from the asset pipeline.

### 2.5 Rigging and animation (Blender's Armatures, Posing, Constraints, Shape Keys, Actions, NLA, Drivers)
- Armature: add bones, extrude, subdivide, roll, parent connected, bone groups and colours, mirror (X) building, B-bone-lite for bendy
  limbs, bone shapes in the viewport, envelope display, in front, names and axes.
- Skinning: parent with empty/envelope/automatic weights, weight paint, vertex groups per bone, normalise, bone limit per vertex that
  matches the runtime, bind pose reset.
- Posing: pose mode, IK (two-bone, chain, with pole target), FK/IK switch, constraints (Copy Location/Rotation/Scale, Track To,
  Limit Rotation/Location/Scale, Child Of, Damped Track, Stretch To), custom bone properties, pose library, auto-key, copy/paste
  pose, mirror pose, "snap to world".
- Animation: keyframes on any property, dope sheet, graph editor (bezier handles, interpolation, easing, F-curve modifiers, cycles),
  drivers-lite (a bone value drives a shape key), **actions** (clips) as the unit exported to the game, NLA-lite strips for blending
  and layering, root motion extraction, animation retarget between rigs, onion-skin ghosting, motion paths, markers and events
  (a frame can fire a game event like "footstep").
- Shape keys: sliders, relative/absolute, vertex group masks, driven by bones (faces, cloth-like squash).
- Lattice and soft deformers for squash and stretch. Rig templates: biped, quadruped, bird, car (wheel and steering rig),
  door/chest/hinge, so beginners start with something working. **Auto-rig** for a humanoid from a handful of placed joints
  (Rigify idea, much smaller).
- Physics-lite (editor preview, baked to clips): rigid-body drop to place props, cloth-ish secondary motion via spring bones.

### 2.6 Scene, landscape and level building (3D)
The scene editor already exists (`SceneEditor`, `Scene3D`): objects on a snapping grid, tilemaps, props, written as `*.scene.json`.
Grow it with Blender's idea of **collections, instances and linked libraries**:
- Instances of a model with overrides; collections as prefabs; array/scatter and curve-based placement (fences along a road);
  snapping to surfaces and edges; multi-select transform; groups; layers visibility; level boundaries; triggers and paths as objects
  with props; light probes; occlusion/visibility helpers; lightmap bake preview (`bake.rs`).
- Landscape: heightmap sculpt (raise, lower, smooth, flatten, noise, erosion), paint layers (splat maps), roads and rails as splines
  that conform and cut into terrain, water planes, foliage and rock scatter with density maps and exclusion zones, biomes
  (the terrain recipe, `terrain.rs`), minimap capture. Large worlds in chunks (as `voxel.rs`/`terrain.rs` do).
- Camera and cinematics: camera objects, camera rails, depth of field/bloom settings, a sequencer-lite for cutscenes (Blender's
  Video Sequencer and Storyboarding idea, tiny).

### 2.7 Interop and files
- Import/export glTF 2.0 (done), OBJ, FBX-via-glTF converters later; one-click `.blend` import through headless `bpy` where Blender is
  installed (`scripts/blender/`). Asset library: save a model, rig or material to a library and reuse it across projects (Blender's
  Asset Libraries). Auto-backup and "Recover last session".

**Not cloned:** Cycles/EEVEE, geometry nodes, fluids, smoke, hair, compositor, video editing, drivers beyond bone-to-shape-key,
Python. If a game needs one, import it from Blender as a `.glb`.

## 3. Workspace: Sprites (2D). Reference: Pixelorama

Pixelorama's docs are organised around the canvas, tools, panels (layers, frames/timeline, palettes, tools options), effects,
animation, tilemaps, import/export and the command line. A Pixelorama user should feel at home.

### 3.1 Layout
- **Canvas** (centre) with rulers, grid, pixel grid, tiled-mode preview, symmetry guides, zoom (1x to 64x, pixel-perfect),
  a mini-map for big canvases, a second **preview window** at 1x showing the animation playing.
- **Tool bar** (left): each tool has a left-click and a right-click slot (Pixelorama's two-tool model), with per-tool options in
  a panel; **palette panel** (right) and **colour pickers**; **layers panel** and **frames timeline** (bottom, cels grid).
- Extra areas: **tileset editor**, **reference images**, **animation tags**, **sprite sheet preview**, **Lua area** for batch scripts.

### 3.2 Drawing tools
Pencil, eraser, brush (shapes, sizes, pixel-perfect, custom brushes from selection, dynamics), bucket (similar colour,
selection, whole), line, rectangle, ellipse, polygon-ish shape tools with fill and outline, gradient, shading (lighten/darken,
hue shift), colour picker, **selection**: rectangle, ellipse, lasso, polygon, magic wand, colour select, paint-select; move, 
transform (scale, rotate with RotSprite, clean-edge, nearest), flip, crop to selection, content-aware-lite "pixel-perfect" lines,
text tool, zoom, pan, symmetry modes (horizontal, vertical, diagonal, point, tiled), tiled mode, dithering patterns, outline
generator, drop shadow, gradient map, palettize.

### 3.3 Layers, cels, frames
- Pixel layers, group layers, tilemap layers, 3D-lite layers (a rotating cube to preview) and **audio layers** (a sound clip on the
  timeline, so sound timing can be matched to frames); blend modes, opacity, clipping masks, lock, visibility, onion skin
  (past/future, colour tint), cel linking, cel properties, frame duration per frame, tags (named clips with direction: forward,
  backward, ping-pong), cel and layer **non-destructive effects** (outline, drop shadow, gradient map, palette swap, hue,
  invert, offset, mirror, rotate, pixelate, color-curves, shaders), per-frame **hitboxes, anchor/pivot points, slices (9-slice)**,
  events on frames (for footsteps and attacks).
- Timeline: scrub, loop, FPS, frame ranges, copy/move frames, reverse, add many, "clone frame", ripple edit, cel drag.

### 3.4 Tilemaps and tilesets
- Tilemap layers with a tileset: draw mode (place tiles), manual mode (edit tile pixels, auto-update copies), auto mode; tile
  size, tile shape (square, isometric, hex), offsets, rotated/flipped placement, tile **properties and collision shapes**, terrain
  sets (auto-tiling rules: edges, corners, blob), tiled preview, **tileset import from a PNG** and export as a tileset PNG
  plus Nova's JSON. This feeds the Scene editor's tilemaps.

### 3.5 Palettes
Palette panel with named palettes, import/export (GPL, PAL, PNG, Lospec, JSON), create from the image, edit swatches, swap
and sort, palette "lock" (only palette colours), colour ramps, indexed mode, global and project palettes, and a built-in set.

### 3.6 Files
Open/save `.sprite.json`+PNG (current format, `docs/project-format.md`); import PNG, GIF, APNG, `.pxo` (Pixelorama), `.aseprite`;
export PNG, sprite sheet (rows/columns/pack, padding, trimming, with atlas JSON), GIF, APNG, per-tag, per-layer, per-frame
export, scale on export, a **command line** (`nova sprite export ...`) for batch builds, and a reusable **export profile**.
Auto-save and backups, and reference-image panels (side, overlay, onion) as Pixelorama has.

## 4. Workspace: Sound (music and effects). Reference: LMMS

LMMS is organised around the **Song Editor** (arranging clips on tracks), the **Pattern/Beat+Bassline editor**, the **Piano Roll**,
the **Automation Editor**, the **Mixer**, an **instrument plugin per track** with an **effect chain**, and a **sample** path.
We already have `SoundEditor` (SFX), `SongEditor`, `TrackEditor`; the plan is to bring them up to that shape.

### 4.1 Layout
- **Song editor** (centre): tracks as rows (instrument, sample, pattern, automation, bus), clips with split, resize, knife, loop,
  colour, ghost clips, zoom and snap, tempo and time-signature track, markers, loop region for **loop points** the game uses.
- **Pattern editor** (step sequencer) for drums and rhythms; **Piano roll** for notes (draw, select, strum, glue, quantise,
  humanise, scale/chord helpers, velocity and pan lanes, pitch-bend, ghost notes from other tracks, note properties);
  **Automation editor** (curves: linear, discrete, cubic Hermite with tangents; connect any knob to a curve or an LFO/controller).
- **Mixer** (right or bottom): channels with volume, pan, mute/solo, send routing, FX chains per channel, peak meters, colours;
  master with limiter and loudness meter (LUFS).
- **Instrument/effect panel**: the selected track's plugin UI.
- **Sample editor** (waveform): trim, fade, normalise, reverse, loop points, slice (a SlicerT-like auto-slice), pitch and time stretch,
  gain, record from the microphone, spectrogram view. **SFX designer**: the existing generator with a "mutate/randomise" workflow.

### 4.2 Instruments and effects (built on the C audio core: `docs/audio-core.md`)
- Instruments: subtractive synth (oscillators, noise, filters, envelopes, LFOs, unison), FM/wavetable synth, drum machine (kit of
  samples), sampler/keymap (SF2/SFZ soundfonts later), additive/organ, bass monosynth, an "expression" synth (formula-based),
  Karplus-Strong pluck, vocoder-lite. SFX presets (coin, jump, laser, explosion, hit, pickup, engine, footstep).
- Effects: EQ (parametric + analyser), compressor and multiband, limiter, reverb, delay, chorus/flanger/phaser, distortion/bit
  crusher/waveshaper, filter, gate, pitch shifter, stereo tools, dynamics, spectrum analyser, oscilloscope and vectorscope, a
  bass-boost/transient shaper.
- Controllers: LFO, envelope, peak follower, MIDI input (device keyboard) for live play, tap tempo.
- File I/O: WAV, OGG import and export, MP3 import, MIDI import/export, project template songs, mixdown, **stems** export,
  loop-ready export, loudness normalisation.

### 4.3 Game-specific audio
Adaptive music (layers/stems that mix by game state, transitions on bar lines), randomised sound groups, 3D falloff presets,
a **soundbank view** showing which project files use each sound, audio budget for the device (memory, voices), and an
offline render used in tests. Honest limit: renders are not listening tests; the radio songs have not been listened to by a person.

## 5. Workspace: Engine (code and putting it together)

This is the existing studio's hub plus the runtime. It is the glue: it never tries to be a modeller.
- **Project hub and asset browser** (see the spine), a file tree, search in files, project settings (`nova.json`: resolution, graphics
  options, actions/inputs, targets), device manager (Retroid ADB, emulator profile), export (`.npk`, APK; signing is the owner's).
- **Lua editor**: syntax, completions and hover docs from `nova-api.json`, diagnostics, go-to definition, find references, snippets,
  rename, code folding, split view, minimap, formatter, **debugger** (breakpoints, step, watch, call stack), **profiler**
  (frame time, Lua time, draw calls, triangles, memory) over the existing `PerfStrip`/`DebugPanel`.
- **Scene and UI layout editor** (the shared scene editor, see 2.6).
- **Input and actions editor**, controller mapping, a glyph set (Nintendo, per project decision), localisation tables, save-data
  inspector, a **Simulate** panel (exists) to try inputs.
- **Play**: embedded desktop runtime window, device deploy, hot reload of code and assets, console, screenshots and capture, a
  recorded input replay for tests.

## 6. Cross-workspace features worth planning
- A **common asset database** with import settings (size, filter, compression) per asset; thumbnails cached.
- Drag a model, sprite or sound from the browser into a scene or a code file (inserts a path a person could type).
- A **materials/palette bridge**: a Sprites palette can drive a Model material colour set (the "Switch-class" look from limited colours).
- **Version snapshots** of a project (named, quick restore) so a bold experiment is safe.
- **Tutorials per workspace** from the existing `lib/tutorials`, with a "make a first X in ten minutes" for each.
- **Plugin/addon surface** (later): small TypeScript or Lua addons in the project folder adding a panel, a tool or an exporter.

## 7. What this means for scope (honest)
- Pixelorama and LMMS are each a small team's multi-year product; Blender is hundreds of people. Cloning "Blender" literally is not possible.
  The plan above is ordered by what a game needs; each item should ship as a slice that a game uses.
- Suggested order: **Engine and Sprites polish** (closest to done) > **Sound** (mixer, piano roll, automation, effects) > **Model**
  slices (viewport/edit tools, UV + texture paint + bake, rigging + animation, landscape).
- Each workspace needs one **proving project**: Pine Ridge cars for Model; a small platformer sheet for Sprites; the radio songs for Sound.

## Open questions for the owner
1. Torn-off windows: share one undo history or one per window? (Recommended: per document, shared across windows.)
2. (Settled: no beginner mode.)
3. Should the Blender keymap be the default in Model, or Nova's own simpler one with Blender as a preset?
4. Which workspace do you want first: Model (long, the biggest gap), Sound (mixer/piano roll) or Sprites?
