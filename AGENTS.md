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

- `crates/nova-runtime`: Rust game runtime. `wgpu` renderer for 2D and 3D, Lua 5.4
  via `mlua`, `android-activity` + `winit` on Android. Currently only a skeleton.
- `audio/`: salvaged C11 sample-clock audio core (no raylib/Lua/Qt). Built and
  tested standalone with CMake now; linked into Rust through `cc` + FFI in M6.
  Read `docs/audio-core.md` (its status note lists what is historical).
- Studio (not started): Tauri 2 + TypeScript in a later crate/folder. Editors may
  use web tech; the game never runs in a WebView.
- A project is a folder of plain files (Lua, JSON, PNG, glTF, WAV/OGG). The studio
  must never write code a person could not have typed, and the format must not
  depend on the runtime's internals.
- `docs/ux/`: retained UX research and the Pine Ridge Rally Lua exercise.
  `docs/archive/`: notes from the dropped Qt components, kept for ideas only.

## Commands (repo root)

```sh
scripts/env.sh cargo build                         # desktop build
scripts/env.sh cargo test
scripts/env.sh cargo clippy --all-targets
scripts/env.sh cargo fmt --check
scripts/env.sh cargo ndk -t arm64-v8a build --release   # Android library/binary
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
