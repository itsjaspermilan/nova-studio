# Nova Studio agent guidance

Read `TODO.md` for current milestones and the bounded next assignment, then
`README.md` for behavior, build/setup details and limitations. Inspect source
before changing contracts; roadmap entries are not implemented features.

## Architecture and edit surfaces

- Shared C11 engine/runtime with Lua 5.4.8 and raylib 5.5. Native GPU rendering
  uses macOS GLFW/Cocoa/OpenGL and Android NativeActivity/EGL/OpenGL ES 2.
  Do not introduce WebView gameplay or streamed/software preview rendering.
- `engine/nova.c` implements the Lua API, validation/budgets and native overlap;
  `engine/nova.h` defines frame/draw/input/viewport contracts without raylib types.
  Draw commands include rectangles, text, generated cubes and validated
  sprite/static-model handles. `engine/project.{c,h}` owns manifest v1 syntax.
  Lua exposes base/math/string/table, not filesystem/process
  or package libraries; stability limits are not a hostile-script sandbox.
- `runtime/main.c` owns native resources, launcher, scene file loading, input,
  fixed-step loop and presentation. Scene modes share one engine/format.
  World and overlay currently share a 960x540 target; simulation is 60 Hz.
- `runtime/assets.{c,h}` resolves project roots, validates/decodes PNG and embedded
  static GLB using raylib's pinned cgltf, and stages resource/Lua replacement.
  Declared path/type aliases share resources; failed staging unloads only candidates.
  Keep the documented import subset and reject unsupported features explicitly.
- `runtime/inspect.h` defines read-only inspection v1 and shared headless project
  preflight. Use real declaration-order/alias metadata and `NovaFrame`, not invented
  scene entities. Preserve documented borrowed-view lifetimes and transactional
  failed reload/validation behavior; headless preflight must not upload GPU data.
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
  `tests/project_test.c` covers manifest/handle contracts; `tests/assets_test.c`
  covers native paths/imports and opt-in reload/alias/partial-failure cleanup.
  `tests/render_test.c` checks exact pixels from the real native project capture.
  `tests/toolchain_test.sh` uses isolated fake tools, not the real SDK.

## Commands from this repository root

```sh
./scripts/with-toolchain.sh cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
./scripts/with-toolchain.sh cmake --build build -j 4
./scripts/with-toolchain.sh ctest --test-dir build --output-on-failure
./build/nova_studio
./build/nova_studio --scene "$PWD/examples/2d/main.lua"
./build/nova_studio --smoke --frames 120 --capture ./build/mixed.png
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
  The newly authored project's license is still an open distribution decision.
- No dependencies on, edits to, or save-data access in GameStudio/Glow43.
  Preserve unrelated changes, local configuration and private signing material.
  Generated outputs/toolchains stay ignored; never commit secrets.
- No remote/push/PR is requested. Include this trailer on requested commits:
  `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`.

The app registration remains folder-backed despite local Git on `main`; Git
initialization is not automatic app conversion. Use sequential ownership here,
or confirm repository registration AND isolated worktrees before parallel writers.
Check cwd: `/Users/jasper/Developer/NovaStudio`, not the coordinating GameStudio.

This is a native project/sample launcher, not a full editor/modeller. Manifest v1
and the bounded PNG/static GLB pipeline are implemented; native-resolution HUD,
audio/save/animation APIs and Glow compatibility are not. Android package
verification passes, but device behavior remains unvalidated.
State these boundaries when reporting results; see TODO for actual prerequisites.
