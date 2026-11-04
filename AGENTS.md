# Nova Studio agent guidance

Read `TODO.md` first: it holds the decisions, milestones and the next assignment.
Roadmap entries are not implemented features; inspect the source before changing
a contract. Nova was reset on 2026-11-02; the earlier C11/raylib/Qt code is gone
from `main` (it lives in git tag `archive/copilot-studio-2026-11`).

## What this is

A simple, original, Game Maker 8-style studio for making **native Android games**
(2D and 3D, no WebView, no streamed rendering), first for the Retroid Pocket 6.
Games are written in Lua. The studio covers scenes/layouts, sprites and
animation, 3D models and scenes, and sound/music. Beginners come first: plain
words, few choices, good defaults. There are no fantasy-console limits.

## Architecture (decided; see TODO.md for the table)

- `crates/nova-runtime`: Rust game runtime. Projects: `vfs.rs` (read-only file view), `project.rs`
  (`nova.json` and assets), `assets.rs` (PNG decode, atlas), `game.rs` (Lua API v1, draw lists),
  `content.rs` (benchmark scene or project), `scene.rs` (`*.scene.json` validation), `sprite.rs` (`*.sprite.json`), `tilemap.rs`, `save.rs`,
  `pak.rs` (the `.npk` archive), `voxel.rs` (block worlds: chunks, light, meshing on worker threads, ray, walking box), `terrain.rs` (the terrain recipe, made into chunks on workers), `walls.rs` (boxes, rays, doors and A* paths for indoor 3D). The
  entity/scene/timer/collision/camera framework is Lua in `crates/nova-runtime/lua/` (embedded,
  loaded before every project). Spec in `docs/project-format.md`. `wgpu` renderer
  for 2D and 3D (`gfx.rs`, WGSL in `src/shaders/`), Lua 5.4 via `mlua` (`script.rs`,
  reduced stdlib), glTF import (`model.rs`), input actions (`input.rs`), audio via
  `cpal` + the C core (`audio.rs`, `build.rs`), `winit` host and headless runner
  (`app.rs`), `android-activity` entry in `lib.rs`. Read `docs/spike-results.md`.
- `audio/`: salvaged C11 sample-clock audio core (no raylib/Lua/Qt). Built and
  tested standalone with CMake, and compiled into the runtime by `build.rs`
  (`cc`) behind a small FFI wrapper in `audio.rs`.
  Read `docs/audio-core.md` (its status note lists what is historical).
- Studio (not started): Tauri 2 + TypeScript in a later crate/folder. Editors may
  use web tech; the game never runs in a WebView.
- A project is a folder of plain files (Lua, JSON, PNG, glTF, WAV/OGG). The studio
  must never write code a person could not have typed, and the format must not
  depend on the runtime's internals.
- `docs/ux/`: retained UX research and the Pine Ridge Rally Lua exercise.
  `docs/archive/`: notes from the dropped Qt components, kept for ideas only.

## Studio (`studio/`)

Svelte 5 + TypeScript (Vite, vitest) front end; Tauri 2 backend in `studio/src-tauri` (workspace member
`nova-studio`). The front end talks only through the `Api` interface in `src/lib/types.ts`: `api.ts`
picks the Tauri backend or the in-memory `mock.ts` (browser preview). Every backend file operation is
confined to the open project (`paths.rs`). `src/lib/nova-api.json` must match the Lua API (test
`crates/nova-runtime/tests/api_docs.rs`). Run Node tooling through `scripts/env.sh`.

## Commands (repo root)

```sh
scripts/env.sh cargo build                         # desktop build
scripts/env.sh cargo run --release -p nova-runtime --bin nova -- run examples/rally-demo --headless --frames 120 --capture build/demo.png
scripts/env.sh cargo run --release -p nova-runtime --bin nova -- --headless --frames 300 --capture build/spike.png
scripts/build-apk.sh [--project folder]           # Gradle-free debug APK -> build/android/
scripts/env.sh cargo test
scripts/env.sh cargo clippy --all-targets
scripts/env.sh cargo fmt --check
scripts/env.sh cargo ndk -t arm64-v8a --platform 26 build --release   # Android library
/opt/homebrew/bin/cmake -S audio -B build/audio && /opt/homebrew/bin/cmake --build build/audio && /opt/homebrew/bin/ctest --test-dir build/audio
```

Always go through `scripts/env.sh`. It sets Rust (Homebrew rustup, keg-only),
`ANDROID_HOME`, `ANDROID_NDK_HOME` (NDK 29.0.14206865), `JAVA_HOME` and `PATH` for
that command only. Use `/opt/homebrew/bin/cmake`, not the asdf shim (it has no
version set here). Run the smallest test that covers a change; documentation-only
changes need no builds.

The emulator profile `retroid-sim` (Android 13, arm64, 1920x1080) is for build,
install, lifecycle and input checks only. It says nothing about frame rate,
thermals or audio latency; those need the real device.

## Safety and boundaries

- Do not modify GameStudio (`../GameStudio`) or read its save data. Reading and
  deliberately copying its code is allowed; record provenance in the commit.
- Pixelorama (MIT) and Blockbench (GPL-3) are references. Do not copy Blockbench
  code; reimplement ideas. Check licences before adding any dependency or asset,
  and keep upstream notices in `licenses/` (currently Lua only).
- Downloads and installs need the user's say-so; the Android SDK licence
  acceptance is always the user's. Do not edit shell startup files or global
  manager configuration. Never touch private signing material; release signing,
  device installation and publishing are the user's to do.
- Generated outputs (`target/`, `build*/`) stay ignored. Never commit secrets.
- No remote, push or PR is requested. Commit only when asked, and end requested
  commits with the attribution trailer the session specifies.
- Report limits honestly: emulator results are not device results; offline audio
  renders are not listening tests; nothing is device-validated until recorded.
