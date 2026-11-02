# Nova Studio

A simple, original studio for making native Android games in 2D and 3D, in the
spirit of Game Maker 8 but written around an easy language (Lua) instead of
drag-and-drop blocks. It will include a scene/layout editor, a sprite and
animation editor, a 3D model editor and a sound/music studio. The first target
device is the Retroid Pocket 6.

**Status: early reset.** Nothing playable exists yet. The repository holds a Rust
workspace skeleton, a salvaged C11 audio core with tests, and design research.
`TODO.md` has the plan, decisions and milestones; start there.

## Layout

| Path | What |
| --- | --- |
| `crates/nova-runtime` | Rust runtime skeleton (the M1 device spike builds on it) |
| `audio/` | C11 audio core and its standalone tests (`docs/audio-core.md`) |
| `docs/ux/` | UX research, workspace study, and the Pine Ridge Rally exercise |
| `docs/archive/` | Notes from the dropped Qt components, kept for ideas |
| `scripts/env.sh` | Command-local Rust/Android/Java environment |
| `licenses/` | Upstream licence notices for bundled dependencies |

## Build and test

You need Homebrew `rustup`, Homebrew `cmake`, the Android SDK with NDK 29 and an
asdf Java 17 (only for the SDK tools). `TODO.md` lists exactly what is installed.

```sh
scripts/env.sh cargo test
scripts/env.sh cargo ndk -t arm64-v8a build --release
/opt/homebrew/bin/cmake -S audio -B build/audio
/opt/homebrew/bin/cmake --build build/audio
/opt/homebrew/bin/ctest --test-dir build/audio --output-on-failure
```

Start the Android emulator profile with
`scripts/env.sh emulator -avd retroid-sim`. It is for build/install/lifecycle
checks; it does not predict handheld performance.

## Limits today

- No renderer, scripting, studio app, editors or APK export yet.
- No Android device has run anything from this repository.
- The audio core was verified with offline renders only, not by listening.
- The project's own licence is not chosen. Dependency licences are separate.
- Earlier work (C11/raylib/Qt) is kept only in git tag
  `archive/copilot-studio-2026-11`.
