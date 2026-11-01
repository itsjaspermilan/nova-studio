# Nova Studio agent guidance

Read `TODO.md` for current milestones and the bounded next assignment, then
`README.md` for behavior, build/setup details and limitations. Inspect source
before changing contracts; roadmap entries are not implemented features.

## Architecture and edit surfaces

- Shared C11 engine/runtime with Lua 5.4.8 and raylib 5.5. Native GPU rendering
  uses macOS GLFW/Cocoa/OpenGL and Android NativeActivity/EGL/OpenGL ES 2.
  Do not introduce WebView gameplay or streamed/software preview rendering.
- `engine/nova.c` implements the Lua API, validation/budgets and native overlap;
  `engine/nova.h` defines frame/draw/input/viewport/service-effect contracts without raylib types.
  Draw commands include rectangles, text, generated cubes and validated
  sprite/static-model handles; audio handles produce service effects.
  `engine/project.{c,h}` preserves v1 and owns
  explicit v2 identity/audio declarations.
  Timers/numeric tweens/sprite frames advance on validated simulation ticks;
  native audio/save effects dispatch after successful Lua calls.
  Lua exposes base/math/string/table, not filesystem/process
  or package libraries; stability limits are not a hostile-script sandbox.
- `runtime/main.c` owns native resources, launcher, scene file loading, input,
  fixed-step loop and presentation options. Scene modes share one engine/format;
  simulation is 60 Hz with a fixed logical 960x540 canvas.
- `runtime/presentation.{c,h}` owns bounded 960x540/1280x720/1920x1080 GPU
  world targets and cube meshes, then composites the world with a separate HUD
  drawn directly into the actual native framebuffer. Layout and pointer helpers
  accept physical preview-panel rectangles as well as full windows. Preserve
  `--capture` as composite logical 960x540; `--capture-native` is a separate
  native-framebuffer output. `NOVA_WORLD_RESOLUTION` supplies a validated
  desktop/Android CMake default. Never confuse window points or logical offscreen
  buffers with native framebuffer pixels.
- `runtime/assets.{c,h}` resolves project roots, validates/decodes PNG and embedded
  static GLB using raylib's pinned cgltf, and stages resource/Lua replacement.
  Declared path/type aliases share resources; failed staging unloads only candidates.
  Keep the documented import subset and reject unsupported features explicitly.
- `runtime/inspect.h` defines read-only inspection v2 and shared headless project
  preflight. Use real declaration-order/alias metadata and `NovaFrame`, not invented
  scene entities. Preserve documented borrowed-view lifetimes and transactional
  failed reload/validation behavior; headless preflight must not upload GPU data.
- `authoring/document.{c,h}` owns bounded manifest/Lua drafts and exact disk
  snapshots with contained atomic/conflict-guarded text/binary output.
  `authoring/editor.c` and `widgets.{c,h}` implement the separate desktop-only
  source/project editor. Preserve explicit dirty/conflict decisions and use
  shared inspection/presentation/runtime for its real preview, not another renderer.
  Save is per file; whole-project runtime reload is transactional separately.
- `authoring/style.{c,h}` owns authoring-only system typography and light/dark
  palette. macOS uses Core Text at physical framebuffer density, with a bounded
  GPU text cache and system interface/monospace fonts; never bundle Apple fonts.
  Preserve font-cache cleanup and source grid/selection metrics. Gameplay/HUD
  bitmap fonts and pixel-art filtering remain separate and unchanged.
- `runtime/saves.{c,h}` owns bounded save v1 atomic files in Nova-owned OS app-data.
  Identities/keys are lowercase hex of ASCII bytes to preserve case distinction.
  Never pass Lua paths or touch other applications' saves. Headless preflight
  uses deterministic missing-save reads and never dispatches audio/save effects.
- `examples/{2d,mixed}/main.lua` are editable scenes. Desktop builds synchronize
  them next to the executable; direct `--scene` permits source-script reload.
  Android resolves the same relative paths through bundled assets.
- `examples/assets/nova.project` and its Lua/CC0 PNG/GLB are the third launcher
  sample. Desktop and Android synchronize the full examples tree; APK verification
  compares every project file as well as old scripts and dependency notices.
- `examples/{sprites,static}/` add original v1 sprite-only and multi-primitive/
  static node-instance projects, runnable by `--project` with the same full-tree
  packaging. The three-card launcher is unchanged; these do not expand imports.
- `CMakeLists.txt` pins native archives/hashes and declares targets/tests/assets.
  `cmake/DependencyNotices.cmake` collects upstream notices;
  `cmake/RaylibAndroid.cmake` applies the checked/idempotent destruction patch.
  Preserve `LINKER:-u,ANativeActivity_onCreate` on the Android shared target.
- `android/app/build.gradle` pins SDK35/build-tools35.0.0, NDK27.2.12479018 and
  CMake3.22.1; min API26, target API33, arm64-v8a. Gradle8.11.1/AGP8.9.2 and
  the NativeActivity manifest are under `android/`. Generated asset sync and
  native notices must run before Android asset merging.
- `tests/core_test.c` covers engine behavior/errors/limits; the CMake lifecycle
  patch test and CLI test run by default. GPU tests are opt-in.
  `tests/services_test.c` covers deterministic playback, WAV validation/budgets,
  isolated atomic-save failures/containment and opt-in native audio lifetime.
  `tests/project_test.c` covers manifest/handle contracts; `tests/assets_test.c`
  covers native paths/imports and opt-in reload/alias/partial-failure cleanup.
  `tests/render_test.c` checks exact pixels from the real native project capture.
  `tests/presentation_test.c` checks real world/HUD targets, DPI/resize/panel
  placement, sprite alpha/filtering and capture shapes; its partial-allocation
  test redirects only allocation/free calls in a separate test build.
  `tests/toolchain_test.sh` uses isolated fake tools, not the real SDK.

## Commands from this repository root

```sh
./scripts/with-toolchain.sh cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
./scripts/with-toolchain.sh cmake --build build -j 4
./scripts/with-toolchain.sh ctest --test-dir build --output-on-failure
./build/nova_studio
./build/nova_studio --scene "$PWD/examples/2d/main.lua"
./build/nova_studio --smoke --frames 120 --capture ./build/mixed.png
./build/nova_studio --world-resolution 1280x720 --frames 2 --capture-native ./build/native.png
bash tests/toolchain_test.sh
./scripts/android-doctor.sh
./scripts/build-android.sh
./scripts/verify-apk.sh
```

Enable graphical CTests with `-DNOVA_GPU_TESTS=ON` at configure time only when
a logged-in desktop is available. Do not confuse deterministic capture runs
with performance measurements. Use the smallest existing test covering a change.
Documentation-only changes need no builds.

## Toolchain, licensing and safety

- Always use `scripts/with-toolchain.sh` for native tooling to avoid stale asdf
  CMake shims. `.tool-versions` pins only Temurin Java17.0.21+9; Homebrew host CLI
  CMake/Ninja have checked minimums, not exact pins via that file. Android's
  CMake comes from Google sdkmanager. Use the committed Gradle wrapper, not
  a system Gradle.
- `./scripts/setup-toolchain.sh --dry-run` is read-only/default. `--install`
  downloads/installs and needs explicit consent for new installation work.
  Download consent never substitutes for interactive SDK license acceptance.
  First builds may also download the pinned native/Gradle dependencies.
- SDK/JDK/PATH resolution lives in `scripts/toolchain-common.sh`; preserve its
  SDK conflict checks and command-local environment handling. Do not rewrite
  shell files, global manager configuration or existing SDK installs.
- An earlier asdf CMake.app failed macOS signing checks and is deliberately
  unused. Never execute/restore/delete it, strip quarantine or disable Gatekeeper
  to make a build pass. Stop and investigate any new security warning.
- Preserve dependency hashes, wrapper JAR and notices in `licenses/` and
  generated desktop/APK assets. Check licenses before adding dependencies/assets.
  Nova-authored source is MIT; preserve LICENSE in distributions without
  relabeling dependencies or the CC0 sample artwork.
- No dependencies on, edits to, or save-data access in GameStudio/Glow43.
  Preserve unrelated changes, local configuration and private signing material.
  Generated outputs/toolchains stay ignored; never commit secrets.
- No remote/push/PR is requested. Include this trailer on requested commits:
  `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`.

The original app registration was folder-backed; Git initialization is not
automatic app conversion. These milestones use confirmed isolated NovaStudio
repository worktrees. Always use the assigned worktree, never the main checkout
or the coordinating GameStudio. Confirm isolation again before parallel writers
in a fresh project/session.

This is a native project/sample launcher and bounded desktop source/project
editor with original static primitive modelling, not a full IDE/mesh modeller. Manifest v1
and the bounded PNG/static GLB pipeline, native framebuffer HUD and bounded
world presets are implemented; skeletal animation, full audio mixing/streaming
and Glow compatibility are not.
Timers/sprite frames/numeric tweens, PCM WAV and explicit project saves are bounded
native services, not automatic lifecycle persistence. Android package
verification passes, but device behavior remains unvalidated.
State these boundaries when reporting results; see TODO for actual prerequisites.
