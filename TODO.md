# Nova Studio: reset plan and TODO

Last updated: 2026-11-02. This replaces the earlier C11/raylib/Qt plan (M0 has
rewritten `AGENTS.md` and `README.md` to match). Nothing below is implemented
unless it is ticked.

## Goal

A Game Maker 8-style studio, simpler and original, that makes **native Android
games** (no WebView, no streamed rendering) for powerful handhelds, first the
Retroid Pocket 6, in 2D and 3D. One app holds a scene/layout editor, a sprite and
animation editor, a 3D model editor and a sound/music studio. Games are written in
an easy language (Lua), not drag-and-drop blocks. Beginner wording, few choices,
good defaults. No fantasy-console limits: native resolution, real GPU, real audio.

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
| 3D modelling | Follow Blockbench's model: hierarchy of parts, per-face texturing, keyframed rigid bones. No skinning/vertex weights in v1. glTF in/out. |
| Look | Low-poly/flat/unlit/vertex-colour/texture shading, simple enough that the editor viewport and the runtime match. |
| Resolution (decided 2026-11-02) | The **world** (3D and background sprites) renders to a target of fixed logical height, default **540 px** (960x540 on 16:9), and is upscaled to the screen with a sharp-bilinear filter. The **UI** (HUD sprites, text) always renders at native screen resolution. Coordinates are logical units, 540 high. Per-game setting `world_height` (e.g. 540, 720, 0 = native); pixel-art games may later opt into a smaller target scaled in whole steps. Implemented in the runtime (`FrameInput::world_height`, `--world-height`). |
| Project manifest (decided 2026-11-02) | `nova.json`: name, entry script and settings. Assets are found by scanning the project's folders; an asset's ID is its project-relative path, so nothing is declared by hand. |
| Scene files (decided 2026-11-02) | JSON data in `scenes/<name>.scene.json` beside the scene's Lua code in `scenes/<name>.lua`. Loading data never executes code; the studio edits and diffs the JSON. |
| Reuse | Nova: audio core, docs/UX research, Pine Ridge Rally, Android notes. GameStudio (read/copy only, never modify it): editors, Lua API design, help, MCP server. Nova's old "no GameStudio" rule is superseded; copy deliberately, record what came from where. |
| Repo | This repo. Rebuild on `main`. Old Copilot work is salvaged from branches, then branches are deleted. |
| Fantasy consoles | Dropped: no console specs, budgets or fixed resolutions. |

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

## M0: Housekeeping (done 2026-11-02, uncommitted)

- [x] Salvaged from `itsjaspermilan-portable-studio-packaging`: `audio/` (C11 core),
  its seven device-free tests (now `audio/tests/`, built by `audio/CMakeLists.txt`,
  all pass), `docs/audio-core.md`, `docs/ux/` research and the Pine Ridge Rally
  script. Qt component notes are in `docs/archive/`. Left behind on purpose: the
  Qt/C++ sources, raylib device adapter and its tests (`audio_device`, lifecycle,
  patch, C++ contract, WAV-via-assets), the branch's MIT `LICENSE`.
- [x] Branch tip kept as git tag `archive/copilot-studio-2026-11`; all
  `itsjaspermilan-*` branches and worktrees deleted. Delete the tag later if the
  old code is no longer wanted. Uncommitted-work archives from the old worktrees
  remain in `~/Developer/copilot-worktrees-backup/` (outside the repo).
- [x] Old C11 engine/runtime/Qt/CMake/Android/scripts/tests removed from `main`
  (history and the tag keep them). Only `licenses/lua.txt` remains.
- [x] `AGENTS.md` and `README.md` rewritten for the new architecture.
- [x] Cargo workspace (`crates/nova-runtime` skeleton), `rust-toolchain.toml`,
  `scripts/env.sh`, new `.gitignore`. Checked: fmt, clippy, test, desktop run,
  `cargo ndk` arm64 build, `apksigner`, `sdkmanager`.
- [ ] Commit this reset (not committed; the user has not asked yet).
- [ ] Choose the project's own licence before public distribution. The old branch
  had an MIT file written by Copilot; it was not carried over.
- [ ] Decide product name/identity (keeping "Nova Studio" is fine).
- [ ] Worth a look in M6: the unfinished music-runtime work in
  `~/Developer/copilot-worktrees-backup/itsjaspermilan-improved-funicular-uncommitted.tgz`.

## M1: Device spike (desktop and emulator done 2026-11-02; device gate open)

Goal: prove Rust + wgpu + Lua + audio is fast enough and workable on Android.
Results, numbers and findings: [docs/spike-results.md](docs/spike-results.md).

- [x] `nova-runtime` crate: window/surface on desktop (macOS) and Android
  (`android-activity`), one shared code path; headless offscreen runner with PNG capture.
- [x] Test scene: 10,000 batched sprites, 400 instanced low-poly cars (53k triangles)
  from an imported GLB with a palette texture, 2D HUD over 3D, per-frame CPU/draw stats.
- [x] Lua 5.4 update loop via `mlua` with a small API and a reduced standard library;
  hot reload on desktop with error reporting.
- [x] Input action layer: keyboard, touch and desktop gamepad (`gilrs`); Android
  controller buttons via native key codes.
- [x] Audio: `cpal` output driving the C audio core live (48 kHz stereo F32 on both).
- [x] Debug-signed APK without Gradle (`scripts/build-apk.sh`); installed and run on
  `retroid-sim` (Vulkan on the host GPU: steady 60 fps, audio running).
- [x] Results recorded for desktop and emulator.
- [ ] **On the Retroid when it arrives:** repeat on device, plus a 10-minute thermal run,
  controller check, audio latency, 60/120 Hz behaviour. Record numbers next to the
  emulator ones.
- Gate: stable frame rate on the device with headroom for the test scene, controller
  works, APK installs. Fallback if `wgpu` or Android windowing fails there: C + SDL3 +
  OpenGL ES, keeping the audio core as is. **Provisionally passed; final decision needs
  the device.**
- Carry into M2 (from the findings): immersive/system-bar handling on Android; an input
  path for analogue sticks and triggers on Android (winit gives key events only); exercise
  touch, keyboard and lifecycle on Android; real text rendering and the resolution policy.

## M2: Runtime v1 (in slices)

### M2a: Projects run (done 2026-11-02)

Spec and API: [docs/project-format.md](docs/project-format.md). Example: `examples/rally-demo/`.

- [x] Project format v1: `nova.json`, asset scanning with path IDs, path rules (no root
  escape, no symlink escape, case-collision check), file/size budgets, actionable errors.
- [x] `Vfs` abstraction (directory, in-memory) so desktop, tests and the future APK share
  one project reader.
- [x] PNG decoding and a one-time atlas packer; static GLB import with warnings.
- [x] Lua API v1 (immediate mode): sprites, rects, models, camera, UI layer, debug text,
  input actions, `require` from inside the project, error banner, whole-project reload.
- [x] `nova run <folder>` (window and `--headless` with `--capture`), F3 stats, 540p world
  with native UI.
- [x] Tests: path rules, manifest errors, atlas packing, Lua API, example project, GPU
  render, hot reload.

### M2b: Scenes and entities (done 2026-11-02)

Spec in [docs/project-format.md](docs/project-format.md); example `examples/crate-dash/`.

- [x] `scenes/<name>.scene.json` v1 (validated in Rust, exact error locations; objects, images,
  texts, background, camera limits; names become scene fields).
- [x] Entity and scene classes with inheritance, defaults, tags, depth ordering, custom draw,
  velocity integration, fixed 60 Hz stepping, pause.
- [x] Timers, tweens (9 easings), and `go` coroutines with `wait` / `wait_until`, owned by
  entities or scenes.
- [x] Collisions: `on_collide_<tag>` handlers with a spatial-grid broad phase (in Lua for
  now), box and circle hitboxes, queries (`nearest`, `in_radius`, `touching`, `send`).
- [x] 2D camera: follow, lerp, limits.
- [x] Short asset names everywhere (`car` for `sprites/car.png`).
- [x] Colour fix: 8-bit sRGB script colours are converted for the sRGB target.
- [x] Tests: 17 framework tests, scene-file validation, a 3-minute soak playing every scene of
  Crate Dash; `--hold` for headless gameplay captures.
- Not done in this slice: moving the collision broad phase to Rust (measure first), paths,
  `in_rect`, tile layers, particles.

### M2c: 2D content (sheets and tilemaps done 2026-11-02; fonts waiting)

- [x] Sprite sheets (`*.sprite.json` v1): frames, per-frame durations, tags with forward /
  reverse / pingpong and loop, validated with exact errors; `frame` drawing option;
  `play`, `set_frame`, `on_animation_end`, `anim_speed`, default `anim`.
- [x] Native tilemaps: validated data, culled drawing, `get`/`set`/`tile_at`/`cell_at`,
  solid tiles, `slide()` with sub-stepping (no tunnelling), scene-file `tilemaps`.
- [x] Crate Dash uses both (animated player, tilemap floor); 25 framework tests.
- [ ] **Real font rendering and text layout** (replaces the debug pixel font): TTF/OTF
  rasterised into a glyph atlas, project fonts in `fonts/`, wrapping and alignment. Needs a
  decision from the user on a bundled default font (licence, look) and consent to download it.
- [ ] Particles, paths, `in_rect`.

### M2d: Services and platform

- [ ] Named input actions with remapping; Android analogue sticks/triggers (needs a
  native-activity input path), touch/lifecycle exercised on Android; immersive mode.
- [ ] Audio service and Lua API (SFX, music, buses) over the C core.
- [ ] Save-data API (project-scoped).
- [ ] 3D extras: simple lights/material options, rigid-bone animation playback.
- [ ] Lua time and memory limits; structured diagnostics for the studio.
- [ ] Project loading on Android (APK asset source behind `Vfs`) and the APK running a
  real project (overlaps M3).

## M3: Packaging and device loop

- [ ] Template APK build + asset packer + signing. Debug keystore generated
  locally; **release signing and distribution stay the user's to do**.
- [ ] `nova` CLI: `run` (desktop), `run --device` (adb push + live reload),
  `export android`, `export desktop`.
- [ ] Preflight checks (missing assets, bad manifest) before export.
- [ ] Third-party licence notices for the Rust dependencies (wgpu, winit, cpal, mlua,
  gltf and their transitive crates) bundled with desktop and APK outputs, and a
  licence allow-list check (e.g. `cargo deny`). Not done yet; required before any
  distribution.
- [ ] Verify APK structure; never claim device behaviour from emulator checks.

## M4: Studio shell (Tauri 2 + TypeScript)

- [ ] Project hub (New/Open/Recent, templates, examples), folder-as-project.
- [ ] File tree with folders, rename/move updates references.
- [ ] Lua editor: Monaco with typed API stubs generated from the runtime, Problems
  panel, hover docs, go-to-error. Optional language server later.
- [ ] Play: runtime in its own native window controlled by the studio, plus Run on
  device. Distinct Run/Pause/Stop controls.
- [ ] Undo/redo across editors, safe saves, recovery, external-change handling.
- [ ] Help window and short tutorials; beginner wording throughout.
- [ ] Port from GameStudio where it fits: project tree, tabs, code editor, layout
  editor, help system, MCP server for agents.

## M5: Sprite studio (Pixelorama model)

- [ ] Document: layers x frames cels, linked cels, opacity/blend, tags with play
  direction, per-frame durations, palettes, tilemap layers. Plain format + PNG.
- [ ] Tools: pencil/eraser/fill/shape/select/move, pixel-perfect, symmetry, onion
  skin, zoom/pan/pinch, reference image.
- [ ] Export spritesheet + JSON read directly by the runtime; tag names are what
  `sprite:play("run")` uses. Import PNG sheets; later Aseprite and `.pxo`.
- [ ] Sprite changes update running games on hot reload.

## M6: Sound studio

- [ ] Rust FFI wrapper over the C audio core; offline render + device audition
  (replace the raylib-tied adapter). Verify tests carried over still pass.
- [ ] SFX generator (sfxr-style) with presets, layering, waveform trim/fade.
- [ ] Instruments: synth patches, sampler, optional SoundFont playback.
- [ ] Music editor: patterns, piano roll, drums, arrangement, tempo; later mixer,
  buses, effects and automation using the existing production DSP.
- [ ] Exports: WAV (PCM16/24/float) and OGG; loops and stems.
- [ ] Microphone recording only with explicit permission and its own consent step.
- Note: Copilot's audio checks were offline renders; no audible-playback or latency
  claim exists. Listen and measure on real output.

## M7: 3D model and scene editors (Blockbench model)

- [ ] Model editor: parts hierarchy, cubes then vertex/face editing, per-face UV
  and texture paint, materials, keyframed rigid-bone animation, glTF export.
- [ ] 3D scene/layout editor: place models, transform gizmos with snapping and
  undo, camera/lighting, separate editor camera.
- [ ] Editor viewport matches the runtime look; add "preview in game renderer".
- [ ] Round-trip tests: authored model to glTF to runtime.

## M8: Golden exercise and release readiness

- [ ] Build a playable **3D rally racer** (design in `docs/ux/`, original) using only
  Nova's tools: models, sprites, music, SFX, Lua. Save, reopen, run, export APK.
- [ ] Failure-recovery exercise: crash during save, bad asset, missing file.
- [ ] Run on the Retroid; log performance and controller behaviour.
- [ ] Windows/Linux studio builds and signing/notarization plan.

## Device validation track (starts when the Retroid arrives)

- [ ] Install/launch, controller axes/buttons, Back/Start, pause/resume,
  rotation/activity recreation, process death, GPU context loss.
- [ ] Frame pacing at 60/120 Hz, thermals over time, battery, audio latency.
- [ ] Do not claim device-proven behaviour before these are recorded.

## Open decisions (ask the user before deciding)

- Pixel-art mode's exact rules (low-resolution target size, integer scaling, UI interaction).
- The full `nova.json` and `*.scene.json` schemas and versioning (the formats themselves are decided).
- glTF subset and material model; texture compression policy for Android.
- Language server and typed-Lua (Luau) timing.
- Studio on Windows/Linux: when, and how the runtime ships with it.
- Licence for Nova, and acceptable licences for bundled dependencies.

## Risks

- `wgpu` on Android: driver quirks and CPU overhead; M1 measures it. Fallback above.
- Lua gameplay code can become the bottleneck; keep hot loops in Rust.
- Scope: five tools is large. Build in milestone order, ship one working slice at
  a time, and exercise it with a real game before widening.
- Two renderers (three.js editor views, native runtime): keep shading simple and
  add the in-game preview.
- Emulator speed is not device speed; do not tune from it.
- Copying GameStudio/Pixelorama/Blockbench ideas: record provenance; respect licences.

## Not now

Skeletal skinning/vertex weights, networking, full DAW features beyond M6, WebView
gameplay, iOS, Glow/GameStudio compatibility, app-store publishing, personal
signing, device installation without the user's go-ahead.
