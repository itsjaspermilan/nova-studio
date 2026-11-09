# Nova Studio: plan and TODO

Last updated: 2026-11-09. Nothing below is implemented unless it is ticked. The long history (milestones M0 to M8, the probe games, the
per-game notes and the device logs) was pruned on 2026-11-09; it is in git: `git show db3e9c5:TODO.md`. Detail on finished runtime work lives in
`docs/` (`project-format.md`, `performance.md`, `spike-results.md`, `materials.md`, `switch-class-graphics.md`, `local-coop.md`, `debugger.md`, `play-on-device.md`).

## Where things stand

- **Plan (2026-11-09): one studio with four workspaces** (Model, Sprites, Sound, Engine). The master checklist is the next section;
  its detail is in `docs/studio-workspaces.md` (features) and `docs/studio-ux.md` (menus, toolbars, input, windows).
- **Art direction (2026-11-09):** Switch 1-class graphics at 60 fps on the Retroid (decisions table below).
- **Examples:** `examples/pine-ridge-rally` is the one game kept. The others were removed on 2026-11-09 and live in git tag
  `archive/examples-2026-11`. Small feature fixtures stay (`stress`, `material-demo`, `physics-toybox`, `skin-demo`, `ik-demo`, `menus`,
  `coop-test`, `font-gallery`, `sound-check`, `input-test`) because tests and scripts use them.
- **Engine (done, see docs):** native Rust runtime on wgpu + Lua; scenes, entities, 2D and 3D, GPU skinning, clips and IK, physics
  (Rapier), voxels, terrain, materials and shaders, keyframe animations, a sound mixer with streamed music, local wifi co-op, the
  Gradle-free APK path, and the opt-in Switch-class renderer (HDR, MSAA, cascaded shadows, image-based light, KTX2).
- **Device (Retroid Pocket 6, Android 13, Snapdragon 8 Gen 2 class, 1080x1920 panel shown in landscape, serial bc8565a3):** the stress
  benchmark holds 60 fps in all phases, and a 35-minute soak of Pine Ridge free roam with the car driving ran at 59.7 fps with no
  throttling (`docs/performance.md`). The emulator profile `retroid-sim` says nothing about frame rate, thermals or audio latency.
- **Not verified by a person or on the device:** the radio songs and engine sounds have not been listened to; drift feel, stiffness and
  camera are first guesses; the new cars are not played on the Retroid; the studio's native-only paths were checked once overall.

## One studio, four workspaces (decided 2026-11-09): the master checklist

Decided with the owner: **one Tauri app** (the four-app split in `docs/split-plan.md` was dropped). Four workspaces open as tabs or, on
request, their own windows: **Model** (3D, modelled on Blender), **Sprites** (2D, Pixelorama), **Sound** (LMMS), **Engine** (Lua, scenes,
play, export). One project folder. A document opens in one place at a time, one undo history per document. One full interface, no beginner mode.
Blender keymap in Model. Goal: a free, all-in-one studio for making games, no strings attached; nothing quirky.
**Detail lives in the docs; this list is what must not be missed. Tick an item only when it is built and checked.**

- Features per workspace: `docs/studio-workspaces.md` (sections 2 to 5, with the Blender, Pixelorama and LMMS references).
- UX, menus, toolbars, input, windows, test plan: `docs/studio-ux.md`. Order of work is in its section 8.
- The studio already has first versions of most editors (`studio/src/components/`: ModelEditor, ModifierStack, SpriteEditor, SoundEditor,
  SongEditor, TrackEditor, TimelineEditor, SceneEditor, Scene3D, Editor); items below say what is added.

### S0: Mockups and decisions (before code)
- [x] Wireframes for each workspace and the first-launch screen: `docs/ux/studio-wireframes.html` (owner approved 2026-11-09).
- [ ] Icon set chosen (one family, 16/20/24 px) and licence checked (`licenses/`).
- [ ] Evaluate the Windows snap-layout plugins; plan a Windows test (no Windows machine here).

### S1: The spine (every workspace needs it)
- [~] Command registry (2026-11-09: `studio/src/lib/commands.ts`, 10 tests; the studio's shortcuts and the Cmd/Ctrl-K palette use it; not yet: icons in a shared set, the shortcut editor, menus and toolbars reading it): id, plain name, icon, per-OS shortcut, enabled rule, help text; menus, toolbars, context menus, palette, tooltips, shortcut editor and help search all read it.
- [~] Menus (2026-11-09: one layout, `lib/menus.ts`, for both): the macOS system menu bar is built by `src-tauri/src/menu.rs` (checked by listing it through accessibility in `tauri dev`: File, Edit, View, Run, Window, Help; Run greyed with no project; a menu click reaching the command is not confirmed), and drawn menus (`MenuBar.svelte`, used on Windows and in the browser preview; Undo checked in a text field in the preview). Not yet: per-workspace menus, Alt-key access, Windows run, the Edit menu's Undo and Redo through the system menu in editors.
- [ ] Window chrome: macOS overlay title bar with native traffic lights; Windows `decorations: false` with our own caption buttons (+ snap-layout flyout, unverified until run on Windows).
- [~] Command palette (Cmd/Ctrl-K, `CommandPalette.svelte`, checked in the browser preview; searches commands only so far) searching commands, documents, assets, Lua symbols, help, settings.
- [ ] Keymap system: per-workspace defaults, Blender preset (default in Model), editable, conflict warnings, printable cheat sheet.
- [~] Areas (2026-11-09: each workspace remembers whether its tree and bottom panel are shown and how big they are, Cmd/Ctrl+J shows or hides the bottom panel, Window > Reset layout; `lib/layout.svelte.ts`, 5 tests, checked in the browser preview). Not yet: a right-hand properties area and a left tool shelf at the shell level (the editors still carry their own panels), split/join, switchable area types, named saved layouts, layouts per project.
- [~] Workspace tabs (2026-11-09: Model, Sprites, Sound, Engine in the top bar, Cmd/Ctrl+1 to 4, in the Window menu; a file opens in the workspace that owns it, each workspace remembers its document and shows a home page when none is open; a document opens once; `lib/workspaces.ts`, store tests). Not yet: each workspace's own layout, toolbar and panels (they still share the old editor area), tear-off windows (Tauri multi-window) with "open in another window" + Jump, and the undo history list.
- [~] Crash recovery (2026-11-09: `lib/recovery.ts`; every 30 s, and when the window hides or closes, a copy of each document's unsaved text is kept beside the studio's settings (not in the project), removed on save or tab close, and offered back with Restore / Discard when the project opens if it differs from the file; 7 tests; text documents only). Not yet: a sprite's unsaved pixels and a model's unsaved edits that live outside the tab text, checked in the real app after a forced quit, a recovery list in a menu, named version snapshots of the whole project.
- [ ] First-launch screen: navigation scheme (mouse, trackpad, pen), short practice area.
- [ ] Learnability instead of a beginner mode: tool hints in the status bar, a guided first exercise per workspace (`lib/tutorials`), project templates.
- [ ] Input layer: 3-button mouse, Mac trackpad gestures, Windows precision touchpad, pen pressure/tilt/barrel button, emulate-numpad, on-screen navigation gizmos; natural-scroll follows the OS.
- [ ] Accessibility: keyboard focus order and rings, screen-reader names, UI scale 75 to 200 percent, reduced motion, high-contrast theme, colour-blind-safe graphs, no hover-only functions, 32 px targets.
- [ ] Shared asset browser (thumbnails, tags, search, drag into any workspace, "Open in"); linked data, not copies; F5 Play from anywhere; status bar with tool hints, budgets, device.
- [ ] Themes: system, dark, light; one accent colour.

### S2: Model workspace (`docs/studio-workspaces.md` section 2)
- [ ] 2.1 Layout: viewport (persp/ortho, view gizmo, grid, camera, local view, shading, X-ray, overlays), tool shelf, outliner, properties tabs, mode switch (Object, Edit, Sculpt, Weight Paint, Texture Paint, Pose).
- [ ] 2.2 Modelling: primitives with redo panel; selection tools; extrude, inset, bevel, loop cut, knife, bridge, merge, dissolve, fill, spin, screw and the rest; proportional editing; snapping, pivot, orientation, mirror editing; more modifiers (Boolean, Weld, Decimate, Triangulate, Edge Split, Weighted Normal, Displace, Curve, Lattice, Shrinkwrap, Simple Deform, Smooth, Remesh, Screw, Wireframe, Armature); curves and text-to-mesh; reference images; mesh analysis with triangle-budget bar; LOD generation.
- [ ] 2.3 Sculpt, texture paint (layers, projection, per-channel), weight paint, baking (AO, curvature, normal, lighting).
- [ ] 2.4 UV editor (unwrap, seams, pin, pack, texel density, checker, stretch) and material editor (PBR, small node view baking to the runtime material); atlas packing, KTX2.
- [ ] 2.5 Rigging and animation: bones, skinning, IK, constraints, pose library, dope sheet, graph editor, actions as clips, NLA-lite, shape keys, markers/events, retarget, rig templates, humanoid auto-rig.
- [ ] 2.6 Scenes and landscape: instances, collections/prefabs, scatter, curve placement, surface snapping, terrain sculpt/paint/roads/water/foliage/biomes, camera and cutscene sequencer-lite, lightmap preview.
- [ ] 2.7 Interop: glTF (done), OBJ, one-click `.blend` import (headless bpy), asset libraries, backups.
- [ ] Proving project: the Pine Ridge cars made and edited in the workspace, not by script.

### S3: Sound workspace (section 4)
- [ ] Song editor (tracks, clips, split/knife/loop, tempo and time-signature track, markers, loop points), pattern editor, piano roll, automation editor.
- [ ] Mixer (channels, sends, FX chains, meters, colours, master limiter, LUFS); sample editor (trim, fade, slice, stretch, record, spectrogram); SFX designer with mutate.
- [ ] Instruments (subtractive, FM/wavetable, drum machine, sampler/soundfont, pluck, organ) and effects (EQ, compressor, limiter, reverb, delay, chorus, distortion, filter, gate, pitch shift, analysers); controllers (LFO, envelope).
- [ ] File I/O (WAV, OGG, MP3 import, MIDI, stems, loop-ready export); game audio (adaptive stems, random sound groups, 3D falloff presets, soundbank usage view, voice/memory budget).
- [ ] A person listens to the songs (nobody has yet).

### S4: Sprites workspace (section 3)
- [ ] Canvas (rulers, grids, tiled mode, symmetry, mini-map, preview window), two-slot tool bar, full drawing, selection and transform tool set, palettes (import/export, lock, indexed).
- [ ] Layers (pixel, group, tilemap, audio), blend modes, clipping, cel linking, tags with direction, per-frame timing, onion skin, non-destructive effects, hitboxes, pivots, 9-slice, frame events.
- [ ] Tilemaps and tilesets (draw/manual/auto, shapes, collision, terrain auto-tiling) feeding the scene editor.
- [ ] Import `.pxo`, `.aseprite`, PNG, GIF, APNG; export sheet/GIF/APNG per tag/layer/frame; export profiles; `nova sprite export` command line.

### S5: Engine workspace (section 5)
- [ ] Hub, project settings, device manager, export (`.npk`, APK), asset import settings.
- [ ] Lua editor: go to definition, references, rename, snippets, folding, formatter; debugger and profiler panels.
- [ ] Scene and UI layout editor (shared with Model 2.6); input and actions editor, localisation, save inspector.
- [ ] Play: desktop window, device deploy, hot reload, console, capture, input replay.

### Cross-cutting
- [ ] UX tests with 3 to 5 people per workspace; input matrix (Mac trackpad, Windows touchpad, 3-button and 2-button mouse, pen); VoiceOver and keyboard-only audit; record results.
- [ ] Palette bridge between Sprites and Model materials; drag assets into scenes and code; plugin/addon surface (later).
- [ ] Licences checked for every dependency and asset; Blender and Blockbench code not copied; Pixelorama notices in `licenses/`.


## Goal

A Game Maker 8-style studio, simpler and original, that makes **native Android
games** (no WebView, no streamed rendering) for powerful handhelds, first the
Retroid Pocket 6, in 2D and 3D. One app holds a scene/layout editor, a sprite and
animation editor, a 3D model editor and a sound/music studio. Games are written in
an easy language (Lua), not drag-and-drop blocks. Beginner wording, few choices,
good defaults. Native resolution, real GPU, real audio.

## Decisions (made with the user, 2026-11-02)

| Topic | Decision |
| --- | --- |
| Games | Native Rust runtime, `wgpu` (Vulkan/GLES on Android, Metal on Mac, Vulkan/DX12 elsewhere). One renderer for 2D and 3D. Optional per-game pixel-art mode; it is a setting, not a console. |
| Android shell | `android-activity` + `winit`, no Java UI layer. APK built from a prebuilt template, no Gradle for users. |
| Scripting | Lua 5.4 via `mlua`. The engine does heavy work natively (entities, batching, collisions, animation); Lua runs gameplay. Luau is a possible later swap for types. |
| Studio | Tauri 2 + TypeScript. Editors may use web tech (three.js for 3D views, Canvas for sprites). The *game* never runs in a WebView. |
| Project format | A folder of plain files: Lua, JSON, PNG, glTF, WAV/OGG. Studio never generates code a person could not have typed. Format is independent of the runtime so a different runtime could read it. |
| Sound | Reuse Nova's C11 audio core (`audio/`, no raylib/Lua/Qt dependency) through FFI behind a safe Rust wrapper; same DSP for in-game and exports. Device output via a Rust audio backend (replaces the raylib-tied adapter). |
| Sprites | Follow Pixelorama's model: layers x frames cel grid, linked cels, animation tags with direction, per-frame duration, onion skin, pixel-perfect drawing, symmetry, palettes, tilemap layers. Our own plain format; import Aseprite/.pxo later. |
| 3D modelling | Follow Blockbench's model: hierarchy of parts, per-face texturing, keyframed bones; skinned meshes bend with the part tree (added 2026-11-02, CPU skinning). glTF in/out. |
| Look | Low-poly/flat/unlit/vertex-colour/texture shading, simple enough that the editor viewport and the runtime match. |
| Resolution (decided 2026-11-02) | The **world** (3D and background sprites) renders to a target of fixed logical height, default **540 px** (960x540 on 16:9), and is upscaled to the screen with a sharp-bilinear filter. The **UI** (HUD sprites, text) always renders at native screen resolution. Coordinates are logical units, 540 high. Per-game setting `world_height` (e.g. 540, 720, 0 = native); pixel-art games may later opt into a smaller target scaled in whole steps. Implemented in the runtime (`FrameInput::world_height`, `--world-height`). |
| Project manifest (decided 2026-11-02) | `nova.json`: name, entry script and settings. Assets are found by scanning the project's folders; an asset's ID is its project-relative path, so nothing is declared by hand. |
| Scene files (decided 2026-11-02) | JSON data in `scenes/<name>.scene.json` beside the scene's Lua code in `scenes/<name>.lua`. Loading data never executes code; the studio edits and diffs the JSON. |
| Art direction (decided 2026-11-09, supersedes the "3D modelling" and "Look" rows above) | Aim for **Switch 1-class graphics at 60 fps** on the Retroid Pocket 6: detailed, textured, PBR-lit models (hero cars 15-40k triangles, props thousands), not blocky low poly. The renderer already has it (`"materials": true`: normal, metallic-roughness and emission maps, docs/materials.md); the gaps are the asset pipeline and the modeller. Do not try to out-Blender Blender: **take what works from Blender** into the studio (a non-destructive modifier stack: mirror, subdivision, bevel; proportional editing; snapping; reference images; Blender-style navigation and shortcuts; UV unwrap and baking) and use Blender (headless, `bpy`) as the heavy modeller through a one-click import and as the backend of procedural generators. One atlas per model (base colour, normal, metallic-roughness; ambient occlusion baked into the colour). World render height goes from 540 towards 720/1080 for games that want it (`world_height`).**Renderer steps done 2026-11-09** (`docs/switch-class-graphics.md`, costs in `docs/performance.md`): opt-in `graphics` settings: HDR target with an ACES curve and HDR bloom, 4x MSAA, 3 sun-shadow cascades, a sky cube for image-based light and a `KHR_materials_clearcoat` layer on materials, anisotropic filtering with full mip chains, KTX2 (ETC2/ASTC) textures beside models with a `nova ktx2` ETC2 encoder; `world_height` 720 and 1080 measured. Not done: an ASTC encoder, Basis Universal, ETC2 alpha, stripping the PNG out of the `.glb`; nothing here is judged by a player yet. |
| Reuse | Nova: audio core, docs/UX research, Pine Ridge Rally, Android notes. GameStudio (read/copy only, never modify it): editors, Lua API design, help, MCP server. Nova's old "no GameStudio" rule is superseded; copy deliberately, record what came from where. |
| Repo | This repo. Rebuild on `main`. Old Copilot work is salvaged from branches, then branches are deleted. |

References to study (read-only; MIT Pixelorama is safe to learn from, GPL-3
Blockbench is for workflow ideas only, do not copy its code):
Pixelorama, Blockbench, GameStudio, Game Maker 8 manual.

## Toolchain on this Mac (installed 2026-11-02)

- Rust stable via Homebrew `rustup`: put `/opt/homebrew/opt/rustup/bin` first on
  `PATH` (the shell config is untouched; plain `cargo` is still Homebrew's Rust,
  which GameStudio's Tauri build uses). Targets `aarch64-linux-android`,
  `x86_64-linux-android`; `cargo-ndk` 4.1.x.
- Android SDK at `~/Library/Android/sdk`: build-tools 36.1.0, platform 36, NDK
  `29.0.14206865`, emulator, platform-tools, cmdline-tools `latest`, arm64
  Android 13 Google APIs system image. Java 17 (asdf `temurin-17.0.21+9`) is for
  `sdkmanager`/`apksigner`.
- Emulator profile `retroid-sim`: 1920x1080, 400 dpi, 4 GB. Start:
  `~/Library/Android/sdk/emulator/emulator -avd retroid-sim`.
  Good for build/install/lifecycle/input checks. **Not** for frame rate, thermals or
  audio latency: this Mac is far faster than the handheld.
- Verified: a Rust hello-world cross-compiled with cargo-ndk ran on the emulator.
- `sdkmanager` prints a deprecation notice pointing to the newer `android` CLI in
  cmdline-tools; it still works. Revisit if it stops.
- Homebrew `cmake` stays (GameStudio). Old Nova installs (Qt, Ninja, Gradle cache,
  NDK 27, SDK 35, old build dirs, worktrees) are removed.
- Verify when the device arrives (do not assume): Retroid Pocket 6 SoC, Android
  version (believed 13), screen size/refresh, controller as Android gamepad,
  USB debugging.
- `scripts/env.sh <command>` sets `PATH`, `ANDROID_HOME`, `ANDROID_NDK_HOME` and
  `JAVA_HOME` command-locally (exists now); shell startup files stay untouched.

## Open engine, device and delivery items

**Needs the device**
- [ ] Audio latency and underruns on real output (AAudio low-latency mode is not requested).
- [ ] Battery (the soak ran on USB power); rotation (the device's rotation lock is on and changing it is not ours to do); Back and Home keys.
- [ ] Local co-op on the Retroid: the JNI controller list, vibration, the multicast lock and broadcast on its wifi, a desktop joining it, the
  APK's permissions; then two Retroids together (latency, a dropped wifi); more than one player on a joined device; the Retroid's button
  labels (assumed Nintendo by position, south = B).
- [ ] A real GPU driver reset (the recovery path is tested with a destroyed device only).
- [ ] Do not claim device-proven behaviour before it is recorded in `docs/performance.md`.

**Runtime and format**
- [ ] The OpenGL ES fallback backend was fixed (limits) but not re-run on Android; Vulkan is what has been exercised.
- [ ] Text is UI layer only and draws on top of UI sprites; world-space text and variable-font weights.
- [ ] Streamed music resamples linearly; a sound sped up past about 1.5 times can alias.
- [ ] glTF files that point at an external texture (`uri`) do not load: resolve relative `uri`s through the project's file view.
- [ ] Paths and `in_rect` in the collision helpers.
- [ ] Keyframe animations: a 3D preview, a curve (graph) editor, copy/paste and multi-select of keys, a "record" mode, blending and bone animation.
- [ ] Models from files cannot be drawn into the UI (only block cubes); a finger cannot drag a list to scroll it.
- [ ] Renderer follow-ups: ASTC encoder, Basis Universal, ETC2 alpha, stripping the PNG out of the `.glb` (`docs/switch-class-graphics.md`).
- [ ] The wish list toward Odyssey/BotW-style games (collision and character control, lighting, terrain, crowds) is in the old TODO: `git show db3e9c5:TODO.md`, "Toward games like".
- [ ] From the rally: skinned instancing and LOD for skinned models; heightmap terrain beyond the sine hills (the `terrain.rs` recipe exists), particle ground contact and soft particle sprites; a simulation test harness in the studio; capsule and box colliders in the model editor.

**Delivery and product**
- [ ] Choose the project's own licence before public distribution; decide the product name (keeping "Nova Studio" is fine).
- [ ] Third-party licence notices for Rust dependencies are not bundled into outputs (fonts' notices are in `licenses/fonts/`).
- [ ] Released builds: the native library is not stripped or size-optimised; 16 KB page-size alignment is unchecked.
- [ ] APKs are debug-signed only; release signing, distribution and installing are the owner's to do.
- [ ] macOS: Developer-ID signing, notarisation, a DMG, an app icon; Windows and Linux builds.
- [ ] Failure-recovery exercise: crash during save, bad asset, missing file.

## Open decisions (ask the user before deciding)

- Pixel-art mode's exact rules (low-resolution target size, integer scaling, UI interaction).
- The full `nova.json` and `*.scene.json` schemas and versioning (the formats themselves are decided).
- Texture compression policy for Android (KTX2 ETC2 exists; ASTC not yet).
- Language server and typed-Lua (Luau) timing.
- Studio on Windows/Linux: when, and how the runtime ships with it.
- Licence for Nova, and acceptable licences for bundled dependencies.
- Pine Ridge: merge the radio branch `claude/pine-ridge-radio-d72262`; whether the menu modes go (free roam only); bring progression back (`state.UNLOCK_ALL_VEHICLES`).

## Risks

- Scope: four workspaces is large and "clone Blender" has no end. Ship one working slice at a time and exercise it with a real project.
- `wgpu` on Android: driver quirks and CPU overhead. Lua gameplay code can become the bottleneck; keep hot loops in Rust.
- Windows chrome and input (snap layouts, touchpads) cannot be tested on this Mac.
- Emulator speed is not device speed; do not tune from it.
- Copying ideas from Blender, Blockbench (GPL-3), Pixelorama (MIT) and LMMS (GPL): record provenance, never copy GPL code.

## Not now

Online networking (internet servers, accounts, matchmaking; local wifi co-op is in), WebView gameplay, a browser version of the studio,
iOS, Glow/GameStudio compatibility, app-store publishing, personal signing, device installation without the user's go-ahead.
