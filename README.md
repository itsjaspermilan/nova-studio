# Nova Studio

A simple, original studio for making native Android games in 2D and 3D, in the
spirit of Game Maker 8 but written around an easy language (Lua) instead of
drag-and-drop blocks. It will include a scene/layout editor, a sprite and
animation editor, a 3D model editor and a sound/music studio. The first target
device is the Retroid Pocket 6.

**Status: early.** The runtime plays small projects (`nova run examples/rally-demo`), but there is no studio yet. The repository holds the M1 runtime
spike (Rust, `wgpu`, Lua, audio) that renders 2D + 3D on desktop and the Android
emulator, a salvaged C11 audio core with tests, and design research. Measured
results are in `docs/spike-results.md`; the plan, decisions and milestones are in
`TODO.md`. Start there.

## Layout

| Path | What |
| --- | --- |
| `crates/nova-runtime` | Rust runtime: renderer, Lua host, input, audio, Android entry (M1 spike) |
| `audio/` | C11 audio core and its standalone tests (`docs/audio-core.md`) |
| `docs/project-format.md` | Project format v1 and Lua API v1 (what `nova run` accepts) |
| `examples/rally-demo/` | Immediate-mode project: sprites, 3D models, Lua, HUD |
| `examples/crate-dash/` | A small 2D game using scenes, entities, collisions, timers |
| `docs/spike-results.md` | M1 measurements, proven pieces and open findings |
| `docs/ux/` | UX research, workspace study, and the Pine Ridge Rally exercise |
| `docs/archive/` | Notes from the dropped Qt components, kept for ideas |
| `scripts/env.sh` | Command-local Rust/Android/Java environment |
| `scripts/build-apk.sh` | Gradle-free debug APK of the runtime spike |
| `scripts/gen_spike_assets.py` | Generates the original spike car model |
| `licenses/` | Upstream licence notices for bundled dependencies |

## Build and test

You need Homebrew `rustup`, Homebrew `cmake`, the Android SDK with NDK 29 and an
asdf Java 17 (only for the SDK tools). `TODO.md` lists exactly what is installed.

```sh
scripts/env.sh cargo test
scripts/env.sh cargo run --release -p nova-runtime --bin nova -- run examples/rally-demo   # play a project (F3 stats, Esc quits)
scripts/env.sh cargo run --release -p nova-runtime --bin nova                 # the M1 benchmark scene (--world-height 0 for native world)
scripts/env.sh cargo run --release -p nova-runtime --bin nova -- --headless --frames 300 --size 1920x1080 --capture build/spike.png
scripts/build-apk.sh                                                          # build/android/nova-spike-debug.apk
/opt/homebrew/bin/cmake -S audio -B build/audio
/opt/homebrew/bin/cmake --build build/audio
/opt/homebrew/bin/ctest --test-dir build/audio --output-on-failure
```

Start the Android emulator profile with
`scripts/env.sh emulator -avd retroid-sim`. It is for build/install/lifecycle
checks; it does not predict handheld performance.

## Limits today

- No studio app or editors yet. Projects are hand-written Lua, JSON scenes, PNG and GLB files; there are no real fonts (the UI text is a debug pixel font), audio API or saves yet.
- The APK still embeds the M1 benchmark scene; it cannot load a project yet.
- Only the Android emulator has run the APK; no handheld has.
- The audio core was verified with offline renders only, not by listening.
- The project's own licence is not chosen. Dependency licences are separate.
- Earlier work (C11/raylib/Qt) is kept only in git tag
  `archive/copilot-studio-2026-11`.
