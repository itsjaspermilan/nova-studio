# Nova Studio: reset plan and TODO

Last updated: 2026-11-05 (the roadmap entries below carry their own dates). This replaces the earlier C11/raylib/Qt plan (M0 has
rewritten `AGENTS.md` and `README.md` to match). Nothing below is implemented
unless it is ticked.

## Where things stand

**Device, 2026-11-05: the Retroid Pocket 6 arrived and the stress benchmark has run on it** (`docs/performance.md`): all 13 phases hold 60 fps, the worst (1.15 M triangles, 200 skinned characters, 16 lights, shadows) takes 13.3 ms of GPU, Lua at most 2.7 ms. Not yet done on it: (the 120 Hz mode is not a target; the display is set to 60) rotation and the sound itself. **Done on it, 2026-11-05: the rally played by hand (analogue triggers with brake lock-up, tyres, car size and HUD fixed from the owner's notes; a frame-pacing stutter found and fixed, `pacing.rs`), Bunker Run and Sky Garden played (fine, unpolished), the games listed under Android Games in Lantern (the manifest now says `isGame`), lifecycle over adb (Home, screen off, app switch, 15 quick cycles, kill and relaunch; it found and fixed a background busy loop and music that kept playing), an 11-minute heat run (8 benchmark runs: 59.7 fps throughout, GPU times flat, chip sensor 64 to 67 C; see `docs/performance.md`), the controller (all 16 buttons and 6 axes, see Known gaps) and the screen (full screen, no bars or band).**

**Update 2026-11-05.** Since the paragraph below: probe games (Blockfield, Ember Swarm, Bunker Run, Pine Ridge Rally,
Sky Garden) exercised the engine and are in `docs/probes.md`; the engine gained 3D collision (`nova.walls`, `nova.solid`),
GPU skinning, animation blending and `nova.animator`, performance tools and culling, retained scenery with level of detail,
pop-in fixes, `nova.look`, and the Kenney kits are in the games. 430 Rust tests and 487 studio tests pass; clippy and fmt are clean.
**Nothing has run on a physical device**: the Retroid is due on the evening of 2026-11-05. First on the device, in order:
`scripts/bench.sh` (the `gpu=` column against 16.7 ms), controller axes and buttons in Pine Ridge Rally and Bunker Run, a
10-minute thermal run, pause/resume and rotation, screen bars and cutout, audio latency. Record each result in
`docs/performance.md` and the "Device validation track" below, and replace the estimates there with the measured numbers.

## The first long session (2026-11-02)

Done and committed: M0 (reset), M1 (device spike), and M2 (the runtime) apart from the items under
"Known gaps". The runtime has scenes and entities, collisions, timers and tweens, sprite sheets with
animation tags, native tilemaps, real vector text with nine bundled fonts, a sound mixer, named input
actions with project bindings and rebinding, project save data, script time/memory limits, and a
Gradle-free APK path. Three example games run on desktop and on the Android emulator:
`examples/rally-demo` (immediate mode, 3D), `examples/crate-dash` (a small complete 2D game) and
`examples/font-gallery`. 145 Rust tests plus 7 audio-core tests pass. Nothing has run on a physical
device; the Retroid has not arrived.

Waiting on the user:
- **The Retroid** for the M1 device gate (frame pacing, thermals, controller, audio latency).
- Nothing blocks the studio now: the first slice (hub, code editor, Play) was approved and is built
  (see M4). The look and feel is a first draft in `studio/src/app.css`; tell me what to change.

Can proceed without input, in rough priority: the rest of the scene editor (tile painting, props, entity previews); the sprite studio (M5); rigid-bone model
animation and simple lights; streamed music; the C audio core's synthesis for the sound studio
(M6); Android analogue input and immersive mode (need the device to verify).

## Known gaps (audited 2026-11-02)

Everything we know is missing or unverified, in one place. "Device" means it needs the Retroid (or
another physical Android device) to settle; the emulator cannot.

**Needs the device**
- [ ] Frame pacing, thermals over 10+ minutes, battery, 60/120 Hz behaviour (emulator speed is not
  device speed; the Lua framework and collision grid are unmeasured on handheld CPUs).
- [x] Controller axes on Android (2026-11-02, code only): the workspace uses `vendor/winit` (stock winit 0.30.13 plus one patch, see its
  `NOVA-PATCH.md`) which reports a controller's sticks, triggers and d-pad hat as `AxisMotion`; `input.rs` turns them into `axis:left_x`,
  `axis:right_y`, `axis:l2`..., `pad:dpad_*` (tested with synthetic values; compiles for arm64). **Verified on the Retroid Pocket 6 (2026-11-05, `examples/input-test`)**:
  its "Retroid Pocket Controller" sends the left stick as X/Y, the right stick as Z/RZ, the triggers as BRAKE/GAS (and also as the
  L2/R2 buttons, keys 104 and 105, so a game bound to both `pad:l2` and `axis:l2` sees both) and the d-pad as HAT_X/HAT_Y; all 16
  buttons and all 6 axes arrived as the right sources and each axis reached full deflection (the negative side was not recorded
  separately). Not tried: Back and Home (the system takes them), a second pad. [ ] Rumble, several pads and remapping are not implemented.
- [ ] Audio latency and underruns on real output (AAudio low-latency mode is not requested; only
  callback time was measured, about 0.1 ms on the emulator).
- [~] Android lifecycle, exercised on the Retroid Pocket 6 over `adb` (2026-11-05, Pine Ridge Rally): Home and back, screen off and on,
  another app over it and back, 15 quick Home-and-back cycles (same process, 59.6 fps after, no crash in the log, memory 179.5 to
  183.2 MB), and the process killed in the background then relaunched (fresh start, audio and surface back) all work. **Found and fixed
  by it:** in the background the event loop spun a whole core (1,040 CPU ticks in 10 s) and the audio stream kept playing; now the loop
  waits and the stream is paused (2 ticks in 10 s, the player is "paused"). Not exercised: rotation (the device's rotation lock is on
  and changing a system setting was not mine to do; the manifest is `sensorLandscape` and handles the config change), the Back key
  (the rally keeps running when it is pressed: whether a game should quit on Back is the game's choice), and **GPU device loss, which
  is not handled at all** (it cannot be provoked from here).
- [x] Immersive mode on the real panel (2026-11-05): a screenshot from the Retroid (1920x1080 in landscape, from a 1080x1920 panel)
  shows the game across the whole screen: no black band, no system bars. (The emulator's phone profile is what had the cutout and the bars.)
- [ ] Verify the Retroid's facts: SoC, Android version (assumed 13), screen size/refresh, how its
  controller is presented, USB debugging.
- [x] Keyboard and gamepad-button input on Android: `adb shell input keyevent` reached the game on the emulator (native key 96 started Crate Dash's jump)
  with the patched winit; touch unchanged. A physical keyboard is unverified.

**Runtime and format**
- [x] Music as Ogg (2026-11-02): songs now save as `music/<name>.ogg` (about a fifth of the WAV or less; the studio backend encodes with libvorbis through `vorbis_rs`, BSD-3, notice in `licenses/vorbis-ogg.txt`), a WAV in `music/` offers **Convert to Ogg** (the WAV goes to the project trash), and Ogg files can be listened to in the studio. [ ] No importer that converts on the way in yet; sound effects stay WAV.
- [x] Streamed music (2026-11-02): Ogg in `music/` streams through a lock-free ring fed by a decoder thread (`stream.rs`); checked against one real Ogg with `NOVA_TEST_OGG` (samples identical to full decode, loops). `nova.music.position()` / `nova.music.seek()` and an underrun counter in the F3 audio line (2026-11-02); a streamed seek jumps by the file's page index and decodes only a little before the spot (about 30 ms to the first sound anywhere in a 90 s track; samples match a full decode). Emulator run (2026-11-02, a 90 s Ogg looped for over two minutes on the Android emulator): position tracked, one seek and a loop wrap, 0 underruns, audio callback max 0.6 ms. [ ] The emulator says nothing about a real handheld's CPU or audio path; WAV music still decodes into memory at load (the studio converts it to Ogg on request). Text is done except
  world-space text and variable-font weights.
- [ ] The OpenGL ES fallback backend was fixed (limits) but not re-run on Android since; Vulkan is what
  has been exercised.
- [x] GPU timestamps (2026-11-04): `gpu_ms` in `nova.perf()` and the log line, where the adapter has timestamp queries.
- [~] 3D (updated 2026-11-05): collision exists (`nova.walls` boxes and ramps, `nova.solid` triangle meshes, voxels), models animate (clips, skins, blending, `nova.animator`), there are point lights (the 16 nearest), the sun's shadows and `nova.look`. Still none: rigid-body physics, IK, bloom or ambient occlusion, normal maps or PBR.
- [ ] Text is UI layer only and draws on top of UI sprites.
- [ ] The mixer resamples linearly (pitched-up sounds can alias) and has no buses or effects; the C
  audio core's synthesis and DSP are not connected to game audio (M6).
- [ ] Hot reload restarts the whole project (no state-preserving reload).
- [x] Lua errors carry their call stack as data (2026-11-02): `nova check --json` gives each diagnostic a `stack` (file, line, function, internal), and
  the studio's Problems panel lists the frames of the person's own code, each opening its file at the line.
- [ ] Released builds: the native library is not stripped or size-optimised, and 16 KB page-size
  alignment for newer Android versions has not been checked.

**Delivery and product**
- [ ] APKs are debug-signed only; release signing, distribution and installing on a device are the
  user's to do. `nova export android` does not exist yet (a script does the work).
- [ ] Third-party licence notices for Rust dependencies are not bundled into outputs (fonts' notices are
  in `licenses/fonts/`).
- [ ] The studio now has every editor in a first version (code, scene, sprite with layers, sound effects, music,
  3D model); each has open items listed under M4 to M7. No Windows/Linux builds. On 2026-11-02 the user ran the
  native window (`tauri dev`) and reported that it works; only that one overall check was made, so individual
  native-only paths (folder picker, Play against a game, audio and WebGL in the real webview) were not
  separately recorded.

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
| 3D modelling | Follow Blockbench's model: hierarchy of parts, per-face texturing, keyframed bones; skinned meshes bend with the part tree (added 2026-11-02, CPU skinning). glTF in/out. |
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
- [x] Real text (2026-11-02): vector fonts rasterised at the screen's pixel size into a glyph atlas (`text.rs`), kerning, wrapping, alignment, shadow, nine bundled OFL fonts (`licenses/fonts/`), project `fonts/*.ttf|otf`; `examples/font-gallery`. Variable fonts use their default weight; text is UI-layer only.
- [x] Particles (`nova.particles`, `nova.burst`) and sprite pivots (`pivot = { x, y }`), 2026-11-02. [ ] Paths, `in_rect`.

### M2d: Services and platform

- [x] Named input actions (2026-11-02): `actions.rs` bindings engine, `nova.json` `"input"`, run-time `nova.input.bind`, step-latched `pressed`/`released`, Android native key codes and desktop `gilrs`; all tested.
- [ ] Android analogue sticks/triggers (needs a native-activity input path), lifecycle exercised on Android; immersive mode.
- [x] Audio service v1 (2026-11-02): WAV decoding, a tested mixer (32 effect voices, one music track, pan/pitch/volume/fades, soft clip), `nova.sound` / `nova.music`, run on the audio thread through `cpal`; verified on the emulator. Ogg Vorbis decoding added later the same day. Not yet: streamed music, buses and effects, and the C core's synthesis and DSP (M6).
- [x] Save-data API (`nova.save`, atomic JSON file, corruption recovery, 1 MiB limit; done 2026-11-02).
- [x] 3D extras (2026-11-02): sun colour/direction, ambient and up to 8 point lights from Lua (`nova.light`, `nova.point_light`); models import as part trees and scripts turn parts about their pivots (`parts = { wheel = { rx = t } }`, `nova.model_parts`, entity field `parts`); rigid parts only. Animation clips (2026-11-02): glTF clips (translation/rotation/scale tracks) play via `nova.model(..., { clip, time, loop })`, `nova.model_clips`, and entity `play_clip` / `stop_clip` / `on_clip_end`. [ ] Not yet: skinning, morph targets, blending between clips, shadows, material options, lit sprites.
- [x] Lua time and memory limits (256 MiB; 1 s per frame, 5 s to load; covers coroutines; done 2026-11-02).
- [x] Structured diagnostics for the studio (`nova check --json`, Problems panel).
- [x] Project loading on Android: `.npk` single-file archive behind `Vfs`, bundled in the APK as
  `assets/project.npk`; `scripts/build-apk.sh --project <folder>` builds a per-game APK; Crate Dash
  verified on the emulator (2026-11-02). Real-device behaviour still unverified.

## M3: Packaging and device loop

- [x] (script version) APK build + asset packer + signing: `scripts/build-apk.sh --project`, `nova pack`, `nova info`. Moving it into a `nova export android` command remains.
- [ ] Template APK build + asset packer + signing. Debug keystore generated
  locally; **release signing and distribution stay the user's to do**.
- [x] `nova export desktop|android <project> [--out dir]` (2026-11-02): checks the game, then writes a folder that plays it (program, `game.npk`,
  start scripts, licence notices; started with no arguments the program plays the `game.npk` beside it) or a debug-signed APK (runs
  `scripts/build-apk.sh`, so it needs the source tree and Android tools; `NOVA_REPO` points at it). The studio's Export… button runs the same.
  Verified: Crate Dash exported to an APK carrying `project.npk`, the native library and the notices. [ ] `run --device` (adb push + live reload).
- [x] Preflight checks before export: `nova check` runs first, and an export with errors writes nothing.
- [x] Third-party licence notices (2026-11-02): `scripts/third-party.sh` writes `licenses/rust-dependencies.txt` (348 crates, grouped by licence
  text, plus Lua and the fonts' licences) and `--check` fails on a licence outside an allow-list; every desktop export and APK carries it.
  Not a legal review: run `scripts/third-party.sh --check` after changing dependencies.
- [ ] Verify APK structure; never claim device behaviour from emulator checks.

## M4: Studio shell (Tauri 2 + TypeScript)

First slice, built (Svelte 5 + TypeScript + CodeMirror 6; backend in `studio/src-tauri`):
- [x] Project hub (New/Open/Recent, templates, examples), folder-as-project.
- [x] File tree: create, rename, delete (to `.nova/trash`). Renaming offers to update references (full paths, short names after known calls such as `nova.sprite("x")`, scene `kind`, sheet `image`); files with unsaved edits are skipped. [ ] Short names are not updated when a file moves out of its folder (e.g. `sprites/` to `art/`).
- [x] Lua editor: CodeMirror (not Monaco), completions and hover docs from `nova-api.json` (kept in step
  with the runtime by a test), project names inside strings (sprites, sounds, scenes, actions),
  Problems panel from `nova check --json`, click-to-line. [ ] Optional language server later.
- [x] Play: runs `nova run` as its own native window; Run/Stop, log console, saves first. [ ] Pause,
  and Run on device.
Second slice, built: visual scene editor for `*.scene.json` (opens by default, JSON view one click away):
- [x] Canvas with pan/zoom, snap grid, select and drag, arrow-key nudge, duplicate, delete, undo/redo.
- [x] Palette of project entities and PNGs, inspector for kind/name/position/scale/layer/depth/text/
  colour, scene background and size. Saves tidy, diff-friendly JSON; unknown keys pass through.
- [x] Pictures come from the project (`read_image` data URLs); tile maps are drawn.
- [x] Tile painting (paint, fill, erase, make tiles solid, resize, new map from a tileset image) and object `props` editing (text, number, true/false; tables stay in JSON).
- [x] Objects are drawn with their entity's real sprite (read from `entities/*.lua`, following parent classes; first frame of a sheet, pivot respected) and selected by that sprite's size.
- [ ] Not yet: animations playing in the editor, entities that set their sprite in code (they stay boxes named by kind), multi-select, rotate/resize handles, (renames now update scene references).
- [x] External changes: when the studio window regains focus, open text files changed on disk are reloaded if nothing is unsaved, or flagged with Keep mine / Load from disk (and a confirm before saving over them) if there is. Saves are already atomic. [ ] Not yet: changed PNG/WAV/GLB files are not noticed, no crash-recovery drafts, no undo that spans editors.
- [x] Help window (2026-11-02; F1, "? Help" in the project bar, a "make your first game" button in the hub): a
  start page, five hands-on lessons with per-step checkboxes (first game, drawing and animating a sprite, a sound
  effect, a level bigger than the screen, a 3D model with an animation), a searchable Nova reference, and a
  keys-and-tips page. Lesson code is in `studio/src/lib/tutorials/*.lua` with an "Add to my project" button, and the
  runtime's `tests/tutorials.rs` plays every file on top of the Starter template (including picking up the coins
  and the sound). [ ] Not yet: tooltips on the studio's own buttons, a first-run prompt, lessons for tile maps and
  the music editor in depth, translated text.
- [ ] Port from GameStudio where it fits: project tree, tabs, code editor, layout
  editor, help system, MCP server for agents.

## M5: Sprite studio (Pixelorama model)

First slice, built (`SpriteEditor.svelte`, pure logic in `pixels.ts` and `sprite-doc.ts`):
- [x] One layer, many frames; per-frame durations; animation tags with forward/reverse/ping-pong and
  loop; open a `.sprite.json` (sheet) or a plain `.png`; New sprite (8 to 128 px) in the file tree.
- [x] Tools: pencil, eraser, fill, line, rectangle, ellipse, colour picker; brush size, filled shapes,
  flips, clear, onion skin, grid, zoom, a 32-colour palette, undo/redo, animation preview.
- [x] Saves the sheet PNG (16 frames wide) and tidy sprite JSON the runtime reads; tag names are what
  `self:play("run")` uses. Importing existing sheets works through the same JSON.
- [x] Second pass: rectangle select with move, copy/cut/paste/delete, mirror drawing (left-right, up-down), pixel-perfect pencil, resize canvas with an anchor, recent colours.
- [x] Layers (2026-11-02): up to 32 layers per sprite with show/hide, opacity, rename, add, duplicate, reorder,
  merge down and delete; drawing, selection and flips act on the active layer; frame and canvas edits apply to
  every layer. The exported PNG and `*.sprite.json` stay flat (what the runtime reads); layers are kept in
  `sprites/<name>.layers.json` beside them (one PNG sheet per layer inside, hidden from the file tree, moved and
  deleted with the sprite) and are only trusted while they add up to the sheet, so a PNG edited elsewhere is
  flattened to one layer with a notice. A plain `.png` has no layers file and is saved flat.
- [x] Animations that own their frames, and sheet import (2026-11-02): the sprite editor shows one animation's frames at a time;
  adding, removing or moving a frame changes that animation only; an animations panel lists them with a thumbnail,
  name, direction, loop, one speed for all frames, reorder, duplicate and delete. The file format is unchanged (tags
  saved as consecutive blocks; overlapping tags from other tools are split on opening). "Import sheet…" cuts any project
  PNG into tiles (guessed tile size, gap, border, skip empty) into a new animation, one per row, or onto the current
  animation. Tests in `sprite-doc.test.ts`; nothing changed in the runtime.
- [x] Editor usability pass (2026-11-02, from `docs/ux/editor-research.md`): model editor handles (move, turn, resize), multi-select,
  face pull arrow, taper, inset, loop cut, point symmetry, paint opacity and lock alpha; sprite onion skin counts and tint,
  frame drag to reorder, import by tile count and smart slice.
- [x] Fourth round, rest (2026-11-02): knife, cross-part turn and resize, drag several frames, duration scaling, linked cels.
- [x] Fourth round, painting and UV (2026-11-02): placed faces can be flipped (negative width or height); line, rectangle, ellipse and gradient tools in the texture picture (with opacity and lock alpha) and mirror painting on the model.
- [x] Easing and GLB import (2026-11-02): keys can ease in, out, both or step (baked into extra glTF keys on export); a plain `.glb` in
  `models/` has an "✎ Edit" button that reads its parts, mesh colours and animations into an editable model (original kept as
  `<name>-original.glb`; textures and morph targets are not carried over, and it says so; skins are, see below).
- [x] Skinned meshes (2026-11-02): a mesh shape can bend with the parts of its model ("Bend with parts": automatic weights from the part
  tree, weights per picked point, re-worked when points change; follows renames and deletes). Exported as a glTF skin; the runtime reads
  JOINTS_0/WEIGHTS_0, poses on the CPU and rewrites a pool of 8 meshes per skinned part each frame (`MeshWrite` in `FrameInput`). The
  studio's maths and the runtime agree on a fixture (`tests/skin.rs`); a headless render shows the bend. The viewport bends it in Animate.
  Not device-timed: skinning cost on the Retroid is unmeasured. Importing a `.glb` keeps its skin (joints that are nodes become the bones; a different bind pose is noted). Not done: blending clips, normals in the viewport.
- [x] Third round (2026-11-02): vertex snap while dragging points, per-face UV rectangles for boxes, turn and resize for several shapes in one part.
- [x] Second usability round (2026-11-02): pivot tool, edge picking with bevel and open-edge extend, sprite frame multi-select with copy, delete and
  move between animations.
- [x] Resource tree (2026-11-02): the studio shows Sprites, 3D Models, Scenes, Entities, Sounds, Music... as one item each (a sprite is its JSON
  plus its picture and layers, a model its JSON plus `.glb` and texture, a scene its Lua plus layout); renaming and deleting move the files
  together; a Files view shows everything as on disk. Research notes in `docs/ux/editor-research.md`.
- [ ] Not yet: drag-and-drop of frames between animations, a sheet-grid view of a whole sprite, animation preview thumbnails that play,
  linked cels, blend modes, custom/imported palettes, reference images, hot-reload of a running game, Aseprite/`.pxo` import.
  Semi-transparent pixels can lose precision on save (the webview's canvas premultiplies alpha).
- [ ] (original plan, still open) layers x frames cels, linked cels, blend modes, palettes, tilemap layers.
- [ ] Sprite changes update running games on hot reload.

## M6: Sound studio

- [ ] Rust FFI wrapper over the C audio core; offline render + device audition
  (replace the raylib-tied adapter). Verify tests carried over still pass.
- [x] First slice, built in TypeScript (`sfx.ts`, `wav.ts`, `SoundEditor.svelte`): an sfxr-style effect
  generator (5 waves, slide, vibrato, pitch jump, envelope, punch, filters, presets, randomise/mutate)
  saved as `sounds/<name>.sfx.json` plus the rendered `sounds/<name>.wav` the game plays; a WAV
  editor (waveform, selection, keep/cut, trim silence, fades, normalise, gain, reverse, undo) that
  reads 8/16/24/32-bit PCM and float and saves 16-bit PCM. Preview uses the browser's Web Audio; it
  has not been listened to on a device and says nothing about runtime latency.
- [ ] Still open there: layering several effects, loops/crossfades, OGG export, spectrum view.
- [ ] Instruments: synth patches, sampler, optional SoundFont playback.
- [x] First slice, built (`SongEditor.svelte`, pure logic and synthesis in `song.ts`): a step-sequencer piano
  roll with synth tracks (square/saw/triangle/sine/noise, ADSR, pan, volume, mute) and a seven-piece
  synthesised drum kit, tempo, bar count, click/drag/resize/remove notes, transpose, undo, looping
  playback with a playhead (Web Audio) and note audition. Saved as `music/<name>.song.json`; saving
  renders the song offline to `music/<name>.wav` (stereo 44.1 kHz, tails wrapped so it loops without a
  gap) for `nova.music.play("name")`.
- [ ] Still open there: patterns and arrangement (one song is one looping pattern for now), per-note
  velocity editing, swing, effects/buses, sampler and SoundFont instruments, import of MIDI, Ogg export,
  and whether the long WAV (about 10 MB a minute) should become Ogg for shipping.
- [ ] (original plan) Music editor: patterns, piano roll, drums, arrangement, tempo; later mixer,
  buses, effects and automation using the existing production DSP.
- [ ] Exports: WAV (PCM16/24/float) and OGG; loops and stems.
- [ ] Microphone recording only with explicit permission and its own consent step.
- Note: Copilot's audio checks were offline renders; no audible-playback or latency
  claim exists. Listen and measure on real output.

## M7: 3D model and scene editors (Blockbench model)

- [x] First slice, built (`ModelEditor.svelte`, three.js 0.170 in the studio only; pure logic in `model-doc.ts`
  and `glb.ts`): a parts hierarchy of coloured cubes (per-face colours), orbit viewport with click-to-
  select, numeric editing, keyboard nudging, duplicate/delete/undo, saved as `models/<name>.model.json`
  and exported to `models/<name>.glb` (one node per part, vertex colours, 1/16 scale by default) which
  the runtime's real importer loads (fixture + Rust test pin the two together).
- [x] Animations (2026-11-02): an Animate mode with clips (name, length, loop), a scrub bar with key diamonds,
  play/stop, and a pose panel where editing a part's position, rotation or scale keys it at the current time; clips are
  saved in the `.model.json` and exported into the `.glb`, and the runtime plays them (`clip`/`time`, `play_clip`).
- [x] Shapes and meshes (2026-11-02): besides boxes, a part holds wedges, pyramids, cylinders, cones and spheres (sides
  and smooth/flat shading are settable), each with its own turn about its centre; "Edit points" turns any shape
  into a free mesh whose points you drag (camera-plane drag, snap to whole units, shift to pick several) and whose
  faces you click, extrude (negative digs in), delete, flip, split, colour and smooth; points can be deleted, faces
  made between picked points, close points welded. A "flat square" starts a mesh from nothing. Mirror copies of a
  shape (X/Y/Z) or of a whole part with its children. One shared triangle generator (`model-mesh.ts`) feeds both the
  view and the `.glb`; fixture `studio_model_shapes.glb` and the Rust test `studio_shapes_load_and_wind_outwards`
  pin it to the runtime's importer (outward winding checked by enclosed volume).
- [x] Textures (2026-11-02): a model carries one painted picture (`models/<name>.texture.png`, embedded in the `.glb` with
  UVs). Shapes opt in ("Paint with the model's texture"): their colours are baked into a block of the picture, they unwrap
  automatically (box cross, round strips and caps, per-polygon flats for meshes), and a Texture tab paints on the model in
  3D or on the picture in 2D (pencil, eraser, fill, picker, brush size, undo), shows every unwrap over the picture, moves
  blocks by dragging, resizes the picture and packs blocks. Mirror copies of boxes show the texels reflected. Checked
  by `model-uv`/`model-texture` tests, a fixture the runtime's importer reads (`studio_textures_reach_the_vertices`) and a
  headless render. Painted pixels do not follow a block when a shape is resized or its mesh is edited (paint last).
- [ ] Still open: painting with layers or alpha cut-outs, texture tiling, live symmetry editing, copy/paste of keys, lights/materials, a "preview in game renderer" button.
- [ ] (original plan) Model editor: parts hierarchy, cubes then vertex/face editing, per-face UV
  and texture paint, materials, keyframed rigid-bone animation, glTF export.
- [x] Nova MCP server and a game made with it (2026-11-03): `studio/mcp/server.ts` (bundled by `scripts/nova-mcp.sh`, registered in `.mcp.json`,
  docs in `docs/mcp.md`, tests in `studio/mcp/server.test.ts`) writes models, sound effects, songs, pixel sprites and scene layouts with the
  studio's own code, runs `check`, and returns screenshots. `examples/pine-ridge-rally` is a 3D rally game built that way (scripts in
  `scripts/rally/`): two circuits, three rivals, menus, four songs, fifteen sounds, 31 models; `tests/rally.rs` plays both circuits through the
  menus and a full race. Runtime changes it needed: translucent models are blended, `nova run --press`. **Never played by a person or on a device**:
  handling, sound and music were judged by numbers and pictures only. Found on the way: an entity's `vx`/`vz` are built in (they move it), so a
  game keeping its own velocity under those names moves twice as fast. [ ] Not yet: ghost laps, split screen, damage, a studio UI for the server.
- [x] Rally third circuit (2026-11-03): Frost Pass, packed snow with thin grip (`scripts/rally/*` write its models, song and layout; `scenes/frost_pass.*`); the chooser, horizon and tests cover it.
- [x] Engine: self-lit shapes (2026-11-03): a shape's `emissive` (0 to 1, the studio's Glow slider) becomes a glTF material with `emissiveFactor`; the runtime reads it into a per-vertex glow and the mesh shader adds it to the light (`MeshVertex.emissive`, vertex attribute 9). Tests: studio export + fixture, importer, and a GPU render in the dark.
- [x] Engine: sky and fog (2026-11-03): `nova.sky{ top, horizon }` paints a gradient behind the 3D view (a full-screen pass, `sky.wgsl`), `nova.fog{ color, near, far }` fades models into a colour with distance (in `mesh.wgsl`); scene files take the same as `sky` and `fog` keys. Colours are as picked on screen. Tests: GPU renders for both, Lua mistakes, scene validation. The rally circuits use them (fog the colour of the horizon hides the scenery's edge).
- [x] Engine: 3D particles (2026-11-03): the particle emitter (`nova.particles`, `nova.burst`) takes a `model` and a z, with a cone of directions (`dir`, `spread`), gravity along y and tint/alpha over life. The rally dust now uses it instead of its own pool. 2D particles were already there.
- [x] Engine: sun shadows (2026-11-03): `nova.shadows{ radius, strength }` renders a 2048 depth map from the sun around the camera's target (texel-snapped so shadows do not crawl), and the mesh shader dims the sun's share with a 3x3 compare; `shadow = false` on a model drawn keeps it from casting, see-through meshes never cast. Tests: a GPU render (shade on/off, opt-out) and Lua mistakes. The rally uses them (radius 42) with an Options switch; the blob shadow remains when they are off. Not measured on a device: the extra pass is the cost to watch on the Retroid.
- [x] Engine: static scenery with culling, and collision from models (2026-11-03): `nova.scenery` (grid of cells drawn within `range` of the camera, `add`, `push`, `draw`, `clear`, `count`) and entity classes with `static = true`; a model's `colliders` circles (the model editor's Collision panel and green rings) go into the glTF scene extras and are read back by the runtime (`nova.model_colliders`). The rally's own `lib/world.lua` and its SOLID table are gone: the circles live in the models, scenery is static entities, `lib/lamps.lua` keeps only the lamp lights. (The framework already had `nova.world` for its internal state; the new module is `nova.scenery`.) Tests: studio format/export/UI, runtime import, Lua culling and push.
- [x] Input: several pads and rumble (2026-11-03): sources `pad1:`..`pad4:` and `axis1:`..`axis4:` for each pad in plug-in order next to the combined `pad:` and `axis:` (desktop, gilrs; `pads_to_sources` is unit-tested), and `nova.input.rumble` (queued by the game, played through gilrs force feedback where a pad supports it). Remapping already existed (`bind`, `bindings`, `reset_bindings`, `last_source`). NOT verified on hardware: no pad here has been rumbled, macOS gilrs has no force feedback, and Android neither separates controllers nor rumbles (no JNI vibration yet). The rally has a Vibration option and shakes the pad on a hit.
- [x] Second game (2026-11-03): Lantern Keep, a top-down dungeon in 2D (`examples/lantern-keep`, made by `scripts/lantern/build.mjs` through the MCP tools plus hand-written Lua): tilemap rooms with solid tiles and a door that opens, sprite animation, tags and collisions, particles, scene inheritance, saved best time, sounds and a song; `tests/lantern.rs` plays it with an autopilot (F9) and checks it can be won. No engine change was needed; the bugs found were the game's own (the autopilot reset in each new room, and a sword that missed things beside it). Not played by a person.
- [x] Skin demo (2026-11-03): `examples/skin-demo`, a walking figure with skinned arms and legs next to a stiff copy (`scripts/walker/build.mjs`); the MCP `model_write` tool takes `bend: true` for automatic weights. The gradient view of skin weights was finally looked at in the browser preview on this model and works. Found and fixed along the way: the game warned "animations are ignored" and "skins/bones are ignored" for models whose clips and skins it does use; `tests/examples.rs` now runs every example for 3 s and demands no problems at all. Also fixed: the jsdom change had set Vite's `resolve.conditions` for the dev server and the build (blank studio); it is now test-only.
- [x] Rally controls screen (2026-11-03): Options > Controls lists what can be changed, waits for the next key or button, replaces just that kind of entry (keys or gamepad) and saves the choices (`lib/controls.lua`, `nova.input.bind`, the new `nova.input.next_source` which reports each press once); "Back to the defaults" undoes it. Tested through the menus in `tests/rally.rs`. Not tried with a real gamepad.
- [x] Rally damage, tyre wear and rivals that steer round things (2026-11-03): only hard hits (over 6 m/s into a barrier) damage the body, which takes top speed and power and makes the car drift to one side and smoke; sliding, the handbrake and the rough wear the tyres, which costs up to 30% of the grip (the rivals' cornering speed follows it); HUD bars for both. The rivals now look ahead with the new engine call `nova.scenery.ahead` and steer away from and ease off for what is in the way (before this they scraped the same barrier every lap, which damage turned into getting stuck). Tests: all four circuits and a trial still finish with nobody stuck, and the computer driver's tyres wear and its car survives.
- [x] Studio Activity panel for the MCP server (2026-11-03): every MCP tool call is logged to `.nova/activity.jsonl` (`logActivity` in `studio/mcp/server.ts`); the bottom panel's Activity tab reads it every 3 s and on focus (`lib/activity.ts`, `studio.refreshActivity`), with a count of what is new, plain-words rows, failures marked and clickable file names. Tests: server log, parser, panel; tried in the browser preview with a written log. Not tried against a live assistant session in the Tauri app.
- [x] Probe 1, Ember Swarm (2026-11-03; `docs/probes.md`, `examples/ember-swarm`, `scripts/swarm/`): a 3D survivors-style shooter built to find gaps, not to be good. Found and fixed: collisions and queries were 2D only (`nova.collision { plane = "xz" }`), neighbour queries scanned every entity (grid behind `nova.in_radius` and `nova.nearest`; 1000 enemies went from 62 ms to 8.6 ms of Lua a frame), a latent `CELL` shadowing bug, the mixer's 32 voices being stolen by spam (`limit` option on `nova.sound.play`), and the headless runner hiding where time goes. Not fixed (written up): raycasts and height collision, a camera/aim helper, mouse look, UI layout helpers, an in-game profiler, GC spikes. Not measured on a device.
- [x] Probe 1 follow-ups (2026-11-03): `nova.stats()`; raycasts (`nova.raycast`, `nova.scenery.raycast`, `line_clear`) and hitbox heights; `nova.cam3` (follow, first person, look, screen rays, ground point); mouse and pointer input (`mouse:` sources, `nova.input.pointer`, `grab_mouse`; Escape no longer closes a game that uses it); UI helpers (`nova.ui.row`, `column`, `hit`, `clicked`, `choose`). Frame-time spikes turned out not to be GC (three collector settings measured, no difference). Ember Swarm uses all of them (first person has a hit scan with vertical aim assist, F3 shows the profiler). Not tried: a real mouse in a real window (only the event plumbing and unit tests), touch on a device. Still open: floors, ramps and ledges; wall segments and boxes for scenery.
- [ ] Probe 2, Blockfield (started 2026-11-03; a block-building survival game in the style of the 2016 originals, original art and names, no Mojang assets): engine part done and committed: `nova.voxel` (`voxel.rs`, `game/voxel_api.rs`): 16x128x16 chunks, sky and torch light by flood fill (incremental on edits), meshing with ambient occlusion and smooth light baked in the vertices (voxel branch in `mesh.wgsl`, `nova.voxel.daylight`), runtime meshes (`MeshOp`), block raycast, a walking box that slides and steps (`nova.voxel.move`: this is also the floors/ramps/ledges answer for voxel worlds, not for scenery), caves (`carve`), `nova.noise2/noise3/hash`, edit export for saves. 13 unit tests. The game itself is playable (`examples/blockfield`, written up in `docs/probes.md`): biomes, caves, ores, trees, mining with tools, placing, falling sand, drops, hunger, day and night, a make menu with smelting, zombies, creepers and pigs, saving. Seen on the desktop GPU in headless captures only; 113 chunks made in 220 ms and a frame of about 1 ms on an Apple M4 (release). [ ] Not done: a person has not played it (mouse and controller feel, sound balance), nothing is measured on a device, no music, no sun/moon/clouds, water and lava do not flow, no leaf decay, no more animals or monsters, flat block icons in the UI.
- [x] Threads for the voxel world (2026-11-03): a pool of worker threads (`voxel.rs`, `Pool`) builds chunk meshes and makes chunks. Meshing is in 16-high sections (a change rebuilds only the sections it touches; culling is per section), on snapshots that share the chunk data without copying it (copy on write); terrain is made from a recipe the game describes in Lua (`nova.voxel.terrain`, `terrain.rs`: layers of noise, rivers, biomes, caves, ores, lava, trees) by the same workers. A few finished chunks are lit and taken in each frame. Workers by default: the cores less two, up to three; `nova.voxel.threads(n)` sets it; headless runs and tests use none (`Game::set_deterministic`), so every run does the same thing. Tests: workers build exactly what the game thread builds; a change rebuilds the right sections; a recipe makes the same chunk every time; the game makes its world on real threads. Measured on an Apple M4 (release): 113 chunks ready in 133 ms of real time (287 ms when the game thread made them), the mean frame while loading 3.2 ms and the worst 9.3 ms (it was a 12 to 14 ms spike for every chunk). [ ] Not measured on a handheld. Lighting still runs on the game thread (about 0.9 ms a chunk, and it spreads into neighbouring chunks, which is why it is not on a worker); a lighting pass that works on a snapshot is the next step if the device shows it matters. [ ] Other threadable work, not done: decoding PNG/glTF/WAV/Ogg and building the sprite atlas at load; `save.json` on a background thread (the world file is written on the game thread too, whole); skinned-part posing; GPU pipeline creation at startup. **Looked at and left alone, with numbers (Ember Swarm, 1000 enemies, M4):** a render thread (draw 1.9 ms against 8.2 ms of Lua: at most a fifth of the frame, for one more frame of input delay and an Android surface lifecycle that would have to follow; revisit if a device shows drawing on the CPU at a quarter of the frame or more and the GPU not the limit); collision and neighbour queries in Rust (the framework's own part is 2.2 of the 8.2 microseconds an enemy costs, so a port saves at most a quarter, and it needs entity positions to live in Rust; the voxel world's own queries, raycast and the walking box, already are Rust).
- [ ] Voxel follow-ups: done 2026-11-03: the world file (`nova.voxel.save_world`, up to 256 MiB, beside the save), sections of 16 and culling per section, water drawn far to near, mipmaps for the block atlas (five levels, so tiles stay apart), a sky with sun, moon, stars and drifting clouds (`nova.sky { sun, stars, clouds }`), lines in 3D (`nova.line3`, `nova.box3`; Blockfield's block outline is one now). Still open: each rebuilt section makes two new GPU buffers (pool them or write into a bigger one); more draw calls than whole-chunk meshes (about 8 sections a chunk at most: merge far sections if a device is draw-bound); lighting on the game thread (above); `nova.voxel.draw` must come after `nova.camera` in a frame; block icons in the UI are flat tiles; nothing here has run on Android or a handheld (the library builds for it).
- [x] **Gaps Blockfield showed (listed and done 2026-11-03; each item below says what was and was not done).** Engine, most useful first:
  - [x] Scripted input for headless runs and tests: `--hold` takes action names and `--press` keys; nothing can move or click the pointer, so tests build input frames by hand (a bug with saved items in hand got past every test for that reason). A small recorded-input format (frame, source, value, pointer) that plays back in `nova run --headless` and in tests, and records from a real session. DONE 2026-11-03: `--input play.json` plays back recorded input (sources and the pointer, frame by frame) in headless runs and windows, `--record play.json` writes a run's input in the same format (`inputscript.rs`, documented in project-format.md); a test plays `tests/data/blockfield-dig.json` (look down, hold mine, place). A build flake found on the way is fixed: `cargo test --release` failed once to link after every edit because the release profile's `panic = "abort"` made cargo build the library in two flavours that wrote the same unhashed cdylib file; `panic = "abort"` now applies to the Android targets only (`.cargo/config.toml`; `cargo ndk` still gets it, checked), desktop release builds unwind.
  - [x] Positional sound: `nova.sound.play(name, { at = {x, y, z} })` with distance fade and left/right pan from the camera, done in the mixer (mobs and footsteps play at a fixed volume and pan today). DONE 2026-11-03: `nova.sound.play(name, { at = {x, y, z}, range })` and `nova.sound.set(id, { at = ... })`: volume falls to nothing at `range` metres (a square law) and the pan follows the camera's right; a one-shot beyond its range is not played (returns 0). Blockfield's creatures use it. Not heard by a person: the law and the pan scale were checked by sign and size only.
  - [x] A Lua profiler: `nova.stats()` says how long Lua took, not where. The engine already has a Lua hook (for the deadline); a sampling profiler that reports the top functions would answer the first question on a handheld (F3 overlay and headless summary). DONE 2026-11-03: `nova.profile(on)`, `nova.profile_report(n)` and `nova run --headless --profile`: a sampling profiler (every 2,000 VM instructions) that charges time to the running Lua function and times engine calls by name (`(engine) pump_chunks`). It found a real waste in Blockfield on its first run (a per-frame loop over 169 chunks with string keys: about 80% of the game's script time, now skipped while the ring is whole). Not shown in the F3 overlay yet; not run on a device.
  - [x] Lighting on a worker thread (about 0.9 ms a chunk on the game thread; it spreads into neighbouring chunks, so it needs a pass over a snapshot whose changes are merged back). DONE 2026-11-03: a chunk's light is made as if alone by a worker (`light_isolated`, plain arrays: 0.07 ms) and then joined to its neighbours on the game thread (`finish_light`: only the border cells that would brighten the cell across start the flood, read straight from the two chunks' arrays; a neighbour that is not lit yet is skipped, it does its own border when it is). Tests: the result equals the first way it was made (kept as `light_chunk_reference`, test only) for a lone chunk and for a 5 x 5 patch of bumpy ground with overhangs, glass and torches lit in the opposite order; a world with workers lights every chunk the same as one without. The change that mattered was not the thread: the border pass flooded unlit neighbours, which took 4 ms a chunk in a flat test world and now takes 0.2. Loading 113 chunks in Blockfield (release, M4): 40 ms of real time, mean frame 0.2 ms, worst 1.7 ms (was 133 ms, 3.2 and 9.3); headless runs on the game thread: p95 frame 2.8 ms (was 12).
  - [x] Dynamic meshes do not batch: dropped items and particles drawn with `nova.voxel.cube` are one draw each (script-made meshes keep their submit order for blending, so equal meshes are not merged). Instance equal opaque ones. DONE 2026-11-03: lone cubes sort by kind after the chunk pieces (which keep their far-to-near order), so equal ones are one instanced draw (a test checks twenty cubes of two kinds make two runs).
  - [x] GPU cost of sections: about 8 sections a chunk means more draw calls (86 to 169 in Blockfield), and each rebuilt section makes two new GPU buffers. Pool or reuse buffers; merge far sections if a device is draw-bound. DONE 2026-11-03: buffers are reused: a rebuilt piece writes into the buffers it had when they still fit (not more than twice too big), a freed mesh's buffers wait as spares for the next that fits, new ones get room to grow (`Gfx::mesh_buffers_created` / `mesh_buffers_reused`; a GPU test checks it). NOT done: merging far sections to cut draw calls; wait for a device to say it is draw-bound.
  - [x] Save writes on a background thread (the world file is written whole on the game thread every 15 s; fine now, a hitch for a big world). DONE 2026-11-03: the periodic `save.json` flush and `nova.voxel.save_world` are written by another thread (temporary file then rename, one save-file write at a time; a flush that finds the last still running waits for the next call; errors are kept for the next `wait`/flush; the explicit flush, the game's drop and a hot reload still write and wait). Tests: a 3 MB file written in the background and read back at once, newest value wins, dropping the store waits, a write into a vanished folder is an error. Whole-file writes remain: a very big world file is still rewritten every save (an append-only or per-chunk file is the next step if it matters).
  UI:
  - [x] A scrollable list/grid helper for mouse, d-pad and touch (the make menu hand-wrote scrolling, hover, click hit-testing and up/down edge detection; `nova.ui.choose` only handles a fixed set of rectangles). DONE 2026-11-03: `nova.ui.list{...}` (framework.lua): keys, wheel, pointer hover and click, rows to draw into, scroll hints, grids; Blockfield's make menu uses it and lost its hand-written scrolling. Touch dragging to scroll is not done (a finger is a click).
  - [x] Text alignment without a box: `align = "center"` and `"right"` only work inside a `width` box, so the game passes a 900-pixel box everywhere; it should align around the point given. DONE 2026-11-03: `align` center and right without `width` now align around x (the middle, or the right edge); with a width nothing changed (every use in the examples has one). Blockfield dropped its 900-pixel box.
  - [x] Block and model pictures in the UI: inventory icons are flat tiles; draw a cube or a model into the UI layer (isometric icons). DONE 2026-11-03: `nova.ui.cube(block, x, y, size)`: an isometric cube in the UI layer through a new UI mesh pass (orthographic camera in UI units, no depth, drawn between the UI's shapes and its text; `FrameInput::ui_models`). Blocks only: models from files are not drawn into the UI. Blockfield's hotbar, make menu and carried grid use it.
  - [x] A pad-driven pointer: a stick-moved cursor that behaves like the mouse pointer, so that pointer-style menus work with a controller on the Retroid (the menus use the d-pad only). DONE 2026-11-03: `nova.input.cursor(true, { speed, stick, draw })`: a stick moves a cursor and A or the right trigger clicks, reported by `nova.input.pointer()`; a real mouse or touch takes over (tested with stick and button input; not tried with a real controller). The Blockfield menu turns it on.
  - [x] Text entry: no on-screen keyboard or text field, so a game cannot ask for a world name. DONE 2026-11-03: `nova.input.typed()` (winit key text, backspace and enter included), `nova.ui.text_field` and an on-screen `nova.ui.keyboard` (a grid over `nova.ui.list`); Blockfield names the world from its pause screen with either. Not tried on Android's soft keyboard (NativeActivity gives no text): the on-screen keyboard is the way there.
  - [ ] Found while doing them, not done: models from files cannot be drawn into the UI (only block cubes: `nova.ui.cube`); a finger cannot drag a list to scroll it (a touch is a click; the wheel and d-pad scroll); Android's soft keyboard gives no text through NativeActivity (the on-screen `nova.ui.keyboard` is the way there); the profiler's list is not on the F3 overlay yet; the pause screen's "Paused" text sits behind the on-screen keyboard (a layout slip in Blockfield, not engine); everything above was tested on the desktop (a GPU for the renderer pieces) and nothing on a handheld or with a real controller.
- [x] Probe 3, Bunker Run (2026-11-03; `docs/probes.md`, `examples/bunker-run`, `scripts/bunker/`): an indoor first-person shooter. Engine: `nova.walls` (boxes with heights, push, move, ray, line of sight, doors as switched-off walls; `walls.rs`), `nova.nav` (grid and A* paths, `ignore` for doors), `nova.cuboid`, `nova.cuboid_at`, `nova.quad3` (boxes and flat marks from code), the point light limit raised from 8 to 16. Game: a text map, five kinds of creature, two weapons, doors, a key, a boss, a bot that plays it (F9) and a test where it wins (`tests/bunker.rs`). Measured on an M4: a path 0.27 ms, the grid 0.4 ms, 0.18 ms of Lua a frame with ten creatures. [ ] Not done: no textures on boxes, walls are axis-aligned (no slopes, stairs or turned walls), floors are flat, nothing tried on a device or by a person with a mouse.
  - [ ] Found by it, to do. DONE 2026-11-04: `nova.cam3.basis()` and `nova.cam3.to_world(lx, ly, lz)` (a place in the camera's own terms; Bunker Run's pistol and Blockfield's held block use it), and `velocity = false` on an entity class (the engine no longer adds `vx`/`vz` to its place; tested; Bunker Run's player uses it, and documented). STILL OPEN: textured and tiled boxes (a picture along a stretched cuboid); lights: a light list for each object or tile if twelve lights a pixel is too much on the handheld; fade lights in and out (the nearest-eight-wins choice pops).
  - [ ] **Lighting (asked 2026-11-03; step 1 done the same day: light baked into level boxes, `nova.bake.level`, `bake.rs`; see below for what is left)** was basic (asked 2026-11-03; Bunker Run only looks right with the ambient turned well up).** What exists: one sun, a flat ambient, up to 16 point lights each added per pixel (distance fade and facing), a shadow map for the sun only, baked sky and torch light in the voxel world. Missing: shadows or any blocking for point lights (a lamp lights floors and ceilings through walls); occlusion and bounce (corners, under doors); light baked into level geometry (a level cannot carry its lighting); specular, normal maps, textures on boxes; lights that pop as the nearest set changes; glow or bloom round lamps. Suggested order: (1) bake light into boxes at level load (per-face or per-vertex light from the lamps with line of sight through `nova.walls`, the way `voxel.rs` bakes into vertices; the 16 live lights stay for what moves), (2) fade lights in and out, (3) shadows for one or two chosen lights if a device can afford it. **Done:** (1) `nova.bake.level` bakes lamp light into boxes at load (lamps lit by line of sight through `nova.walls`, soft facing, corner darkening, light stored as hue and intensity per vertex and added to the live light), tested in `bake.rs`; Bunker Run uses it (6 ms for 12,264 vertices; one draw; live lights no longer pop). **Still open:** fade live lights in and out; shadows for one or two live lights; light through a door as it opens (the bake is of the doors shut); bounce; textures on boxes; bloom or halos round lamps.
- [x] Probe 4, Sky Garden (2026-11-04; `docs/probes.md`, `examples/sky-garden`, `scripts/sky/`): a 3D platformer. Engine: `nova.walls.move3` (a body in three dimensions: lands, steps up, ceilings, slopes), `add_ramp`, `set_box` (platforms that move; the script carries what stands on them), `floor_below`. Game: islands, stairs, a ramp, a platform that slides and one that lifts, patrollers to stomp, gems, checkpoints, a flag, a camera that is pulled in by walls, jump feel (coyote time, buffering, variable height), a bot (F9) and tests (`tests/sky.rs`). [ ] Not done: (`nova.quad3` alpha: done, see the Android entry), no sloped mesh (a ramp is drawn as slices), no textures on boxes, the camera is one ray (its corner can clip a wall edge), a platform's side does not push a body, ground ids carry their kind in their sign, nothing tried by a person or on a device.
- [ ] glTF files that point at an external texture (`uri`), as most downloaded kits (Kenney's) do, do not load: the importer reads the .glb alone. Resolve relative `uri`s through the project's file view. Found 2026-11-04 with Kenney's Platformer Kit in Sky Garden, which works round it by embedding the texture (`scripts/kenney.mjs`).
- [ ] **Toward games like Super Mario Odyssey and Breath of the Wild (stated 2026-11-04; the target is "inspired by", at 540p on the Retroid; PS2-era games are well within reach already).** What the engine lacks, most blocking first. Roadmap entries, not features:
  1. [~] Collision and character control (2026-11-05: `nova.solid`, `meshworld.rs`: a capsule that slides on any triangle mesh, walks slopes, hops ledges, snaps to ground, rays; unit-tested, not yet used in a game or on a device; climbing and gliding are rules a game writes on top). Was: only boxes, ramps and circles exist; there is no capsule moving against arbitrary triangle meshes (slopes of any angle, walls, ledges, climbing, gliding). Odyssey's movement and BotW's climbing need it.
  2. [~] Animation (2026-11-05: clip blending by weight, `layers`, and `nova.animator` with crossfades, blend states and one-shots are in; Sky Garden uses it): still no IK (feet on slopes, looking at things), no additive or masked layers, no animation events or root motion. Was: no blending between clips, no state machine, no IK (feet on slopes, looking at things). A character's feel depends on all three.
  3. [~] World scale (2026-11-04 and 05: frustum and shadow-box culling, retained scenery in Rust, distance LOD for scenery and `nova.model` with a screen-door crossfade, point lights chosen by nearness with fades, voxel sections that fade in; see `docs/performance.md`): still no streaming of areas, no foliage (thousands of alpha-cut instances with wind), no terrain system beyond voxels and meshes, no LOD for animated models, no occlusion culling. Nothing is measured on a device.
  4. [~] Look (2026-11-05: `nova.look`: toon ramp on the sun, depth outline, exposure, saturation, vignette are in; see `docs/project-format.md`): still no bloom, ambient occlusion or depth of field, no normal maps or PBR, no custom shaders for water and effects, cost on the Retroid unmeasured. Was: one sun with a single shadow map, up to 16 point lights, no post-processing (tone mapping, bloom, outlines or a toon ramp, ambient occlusion, depth of field), no normal maps or PBR; water and special effects need custom shaders. A stylized look beats chasing realism at 540p.
  5. [ ] CPU budget: gameplay is Lua (1,000 enemies were about 8 ms on an M4; a Snapdragon is slower). A large simulation needs its hot parts in Rust (positions, collision and neighbour queries), which also needs entity positions to live in Rust.
  Suggested order (2026-11-04): (1) culling plus a stress benchmark that prints a result line and runs on the device (the first thing to run on the Retroid); (2) clip blending and a small animation state machine; (3) capsule-versus-mesh collision; (4) toon shading with post-processing (tone map, bloom, outline). **Done 2026-11-05: (1) to (4) in the forms above** (bloom is the one piece of (4) not built). Next, in rough order: run `scripts/bench.sh` on the Retroid and let the numbers reorder this; use `nova.solid` in a real game (a third-person character on a hilly level) to find what it lacks (steep-slope sliding, moving ground, climbing); bloom and ambient occlusion if the device has room; foliage and terrain; IK and additive animation layers; Rust-side entity positions for big simulations.
- [x] Kenney kits in the games (2026-11-04; `docs/probes.md`): Pine Ridge Rally's cars, trees, rocks, bushes, guardrails, lamps and start arch, and Bunker Run's creatures, weapons and pickups are kit models (`scripts/rally/kit-models.sh`, `scripts/bunker/kit-models.sh`, both built on `scripts/kenney.mjs`). Then the same day: the rally's roads are the racing kit's slab (stretched, three colourings; every other slab 12 mm higher) and the studio's scene view draws `.glb`-only models (read into a model, faces coloured from the picture). [ ] Not done: the rally's ground, mountains, tires, hay bales, signs, tower and desert and harbour props are still the editor's models, the red desert rocks are grey, the road has no dashed centre line; the studio shows kit models as flat-shaded shapes, not textured; Bunker Run's creatures are dark in the bunker (ambient, or a faint light on them); the player's gun is placed by eye and not seen with a creature in the same frame; the other kits (industrial and commercial city, prototype, mini-forest, racing track pieces) are unused; the animated-characters kit is FBX only. [ ] `scripts/kenney.mjs` cannot scale a skinned model in the file (draw it with `scale`).
- [x] Performance tools and culling (2026-11-04; `docs/performance.md`): frustum culling of the world pass (a bounding sphere per mesh, `culled` in the stats), a far plane that follows the fog, identical textures shared between meshes, `nova.perf()` and a per-second log line with the engine's own numbers, **GPU frame time from timestamp queries** (`gpu_ms`; read back a frame late; the emulator's virtual GPU supports it), `examples/stress` (Nova Stress: a city of Kenney's pieces, cars, skinned characters, lights, shadows, in ten phases) and `scripts/bench.sh` (builds, installs and runs it on a device or the emulator and prints a line a phase). `scripts/kenney.mjs` copies models out of any unzipped Kenney kit with the texture embedded (ten kits are in `examples/` as zips, not committed; `licenses/kenney-kits.txt`). On the emulator every phase holds 60 fps, worst case 10 ms of GPU; the device is estimated at 3 to 4 times slower on the GPU and 2 to 2.5 on the CPU, so a Sky-Garden-sized game has plenty of headroom and a dense lit and shadowed city does not. [x] **Run `scripts/bench.sh` on the Retroid: done 2026-11-05, all phases at 60 fps (`docs/performance.md`).** [x] Done 2026-11-04: (1) retained static models: `nova.scenery` pieces live in Rust (`game/retained_api.rs`) and cost Lua nothing per frame (city 48: Lua 3.0 ms to 0.08); (2) distance level of detail: a piece or static class names `lod` and `lod_distance` (city 48: 577 k triangles to 154 k); (4) the sun's shadow pass is culled against the sun's own box (worst case GPU 9.9 to 7.5 ms). Pop-in (2026-11-05): voxel sections fade in and out, point lights are the 16 nearest with fades (`lights.rs`), `nova.model` has `lod` (`docs/performance.md`). Pop-in (2026-11-04): the draw range follows the fog and fades out over its last 12%, level of detail is a screen-door crossfade (`lod_fade`; a GPU test measures it), see `docs/performance.md`. Still open: LOD is for scenery only (not `nova.model` or animated models), has no blend or hysteresis, and the stress city's far buildings are Kenney's low-detail ones stretched to size, not matching ones; one far model per piece; a lighter shadow pass for distant casters; moving things (cars) still cost Lua a call each. [ ] Found, not done: (3) no occlusion culling (a street-level camera in a dense city draws everything in front of it); (5) the headless runner's per-second snapshot lags a second, so `nova.perf()` in a headless run is stale at phase edges; (6) models: the racing kit's textures are separate PNGs and its `KHR_materials_unlit` is dropped (flat shading lost), the animated-characters kit is FBX only (no importer); (7) the emulator reports the host GPU's time through a virtual one: relative, not absolute.
- [x] Android screen (2026-11-04), found by running Sky Garden in the emulator: (1) a black band across the top: the emulator's phone profile has a camera cutout, and Android keeps a landscape window out of one (the theme now says `windowLayoutInDisplayCutoutMode` always, `android/res/values-v30`, shortEdges for 28 and 29; `build-apk.sh` compiles `android/res`); (2) the "home bar" (navigation bar) stayed: the fullscreen theme only hides the status bar, so `android_ui.rs` asks the window for sticky immersive mode through JNI (the `jni` crate, already in the lockfile) at start and whenever focus comes back. Both verified on the emulator (window frame 1920x1080, both bars invisible); not on a device. [ ] A game cannot yet ask where the safe area is (a HUD in the corner of a phone with a camera hole would sit under it): needs `nova.safe_area()`. [ ] The camera in Sky Garden showed a steeper pitch on the emulator than on desktop; its look input there (a pointer without a mouse) is unlooked-at. Also: `nova.quad3` now honours alpha (a colour with alpha below 255 is drawn blended through a second, nearly-opaque mesh; the Sky Garden blob shadow was a solid black square on Android: the desktop capture's PNG alpha had made it look grey), and the mesh shader's normals are made unit length safely (a zero normal gave NaN; this was suspected of the black square and was not the cause, but it is a hazard on Vulkan drivers).
- [x] GPU skinning (2026-11-04): skinned meshes are bent in the vertex shader (`vs_skinned` in `mesh.wgsl` and `shadow.wgsl`) from a per-frame palette of joint matrices kept in an Rgba32Float texture (4 texels a matrix, 1024 across: no storage buffers, so it should also work on GLES), with joints and weights in a second vertex buffer; an instance carries where its joints start in the w slot of its matrix (`ModelInstance::skinned`). Replaces the CPU posing and the pool of 8 rewritable meshes per part (`MeshWrite` is gone; `SKIN_SLOTS` is gone, and with it the silent loss of every animated model past the eighth). Found by measuring Kenney's character in Sky Garden. Measured on an M4, headless: 1,000 animated characters (1.1M triangles) are 3 draws and 2.2 ms of render (1.6 ms of Lua for 1,000 calls); before, 300 drew 8. Tests: the palette gives the studio's own numbers; one mesh and three instances is one draw; 300 animated draws all draw; a GPU test renders the bent mesh and the CPU-posed mesh and demands the same picture (and fails if the pose differs). [ ] Not done: skinned meshes with see-through colours are not drawn (the blended pass has no skinned pipeline), skinned meshes are not drawn in the UI layer, nothing measured on the Snapdragon, blending between clips is still missing.
- [x] Rally fourth circuit (2026-11-03): Harbour Lights, asphalt at night. No new engine feature: the scene sets a dark sun and ambient with `nova.light`, and `lib/race.lua` spends the eight `nova.point_light`s a frame on the player's headlights, the two nearest rivals and the street lamps nearest the camera (`entities/lamp.lua`, `world.light_lamps`). Models, song and layout come from `scripts/rally/*`. Lamp heads and tail lights glow (see the emissive entry). Not listened to or driven by a person.
- [x] Editor polish (2026-11-03): the 3D scene view can snap placed objects to the edge of the nearest road piece (a distance slider, turned along the road: `snapToRoad`), and the model editor's "Bend with parts" key is clickable: a part shows how strongly it holds each point as a blue-to-red gradient (`boneHeat`, `heatColor`). Snap-to-road was tried in the browser preview; the gradient has unit tests only (no skinned example project to look at). Component tests (jsdom, a dev dependency only, MIT; `studio/src/test/dom.ts` and `gl.ts` stand in for what jsdom lacks) mount the scene, model, sound and song editors: `studio/src/components/*.test.ts`.
- [x] Rally time trial (2026-11-03): the circuit chooser has a Mode (race or time trial). A trial has no rivals; the best lap is recorded ten times a second into the save file and replays as a blue ghost car on later laps; the results screen lists the laps; the HUD shows the gap to the ghost (green and negative when ahead); lap one is timed from the line, so every trial lap is a flying lap. `tests/rally.rs` plays one.
- [x] The studio on real content (2026-11-03): `studio/src/lib/examples.test.ts` opens every model, scene, song, sound and sprite of the shipped examples in the editors' own code (they must open, save back unchanged for studio-made files, keep all data for hand-written ones, and each model must export the committed `.glb` byte for byte). Trying Pine Ridge Rally in the browser preview (`await __loadExample("pine-ridge-rally")` in the dev console, `lib/dev-examples.ts`, development only) found and fixed: the 3D scene view made thousands of draw calls (now every shape of every model is one instanced mesh, `scene-three.ts`), a long entity list squashed to nothing in the palette and inspector, a grid that looked like a black slab, 2D world size fields and a useless flat view for a 3D level, and a drag that rewrote the file when nothing had moved. Then added: scenery painting in the 3D view (pick a kind in the palette; click the ground to put one down, or drag with a brush of 0 to 40 m and 1 to 12 objects a dab, random turn and size; one undo step a stroke; Esc stops; `placeObjects` and `scatterPoints` in `scene-model.ts`, tested). An eraser takes objects away under the same brush (of the picked kind, or any). A Map button in the 3D view looks straight down (orthographic, pan and zoom; the same select, move, place and erase tools work). Painted scenery keeps off the road (a checkbox; any object with "road" in its kind counts). The model editor's part tree draws nesting with └, "＋ Part" says where the part will go, and a skinned shape's points show the colour of the part that holds them most, with a key. [ ] Not yet: snapping objects onto the road, a way to see the weights as a gradient.
- [x] Live sound control and a real suspension (2026-11-03): `nova.sound.set(id, { volume, pan, pitch })` changes a playing sound (glides over ~10 ms; mixer `Command::Set`, tested in `mixer.rs` and `framework.rs`). Pine Ridge Rally's engine, gravel and tyre squeal are now looping samples steered with it, and its cars have the wheels as parts of their own (`chassis` > `body` + four wheels): each wheel rides the ground bumps while the body floats on four sprung corners that lean and nod with braking, power and cornering. [ ] Not heard on a device or by ear; the numbers (spring, damper, shifts) were checked by sign and size only.
- [x] 3D scene view (2026-11-03): the scene editor has a 2D/3D switch. 3D shows each object whose entity says `model = "name"` (read from
  `models/<name>.model.json`, rest pose, vertex colours) and a wire box for the others; click to select, drag the arrows to move (snapped), orbit
  camera, a Z field, and a "Game camera" panel (eye, target, field of view, "Use this view") backed by the new scene key `camera`, which the
  runtime applies when the scene is built (`tests/models3d.rs`). Turn and size are the props `ry`/`sx`, edited as properties.
  [ ] Not yet: rotate and scale gizmos, textured or animated models in the view, lights in the scene file, ground or terrain pieces, a
  view through the game camera, 3D objects in the 2D canvas (they show as boxes at x, y).
- [ ] Editor viewport matches the runtime look; add "preview in game renderer".
- [ ] Round-trip tests: authored model to glTF to runtime.

## M8: Golden exercise and release readiness

- [ ] Build a playable **3D rally racer** (design in `docs/ux/`, original) using only
  Nova's tools: models, sprites, music, SFX, Lua. Save, reopen, run, export APK.
- [ ] Failure-recovery exercise: crash during save, bad asset, missing file.
- [~] Run on the Retroid; log performance and controller behaviour (performance: the stress benchmark ran 2026-11-05, see `docs/performance.md`; controller not yet).
- [x] macOS app bundle (2026-11-02): `scripts/build-studio-app.sh [--install]` builds `Nova Studio.app` with the `nova` runtime and the examples inside, sealed with an ad-hoc signature; installed to /Applications on the author's Mac and launched. [ ] Developer-ID signing, notarisation, a DMG, Windows/Linux builds, an app icon of its own design.

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

Networking, full DAW features beyond M6, WebView
gameplay, iOS, Glow/GameStudio compatibility, app-store publishing, personal
signing, device installation without the user's go-ahead.
