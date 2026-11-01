# Nova Studio

A working **native runtime slice**, not a finished game editor. The native launcher opens editable Lua examples and a versioned project containing an imported PNG sprite and static GLB model. Everything lives here; GameStudio and Glow43 are unchanged and are not dependencies.

The provisional product name is Nova Studio. This foundation targets desktop authoring and standalone Android games, initially Retroid Pocket 6. It contains **no WebView, browser renderer, or screenshot-streaming gameplay**.

## Build and run on macOS

Requires the Apple command-line tools and CMake 3.22 or later. `.tool-versions` pins only Temurin JDK **17.0.21+9** for asdf. The helper selects the **Homebrew CMake CLI and Ninja 1.10+**, not an asdf-installed GUI app. Homebrew does not pin those formulae to exact project versions; the helper checks their supported minimum versions. Android's separate CMake **3.22.1** is pinned by the Gradle project and installed through Google's SDK manager.

For a reproducible installation, see **Easy toolchain setup** below. Once installed, prefix native commands with `./scripts/with-toolchain.sh` to select the project tools without changing your shell settings; for example `./scripts/with-toolchain.sh cmake -S . -B build`. The first native configure downloads raylib 5.5 and Lua 5.4.8 from upstream; SHA-256 hashes pin both archives. The native build itself does not install SDKs.

From `/Users/jasper/Developer/NovaStudio`:

```sh
./scripts/with-toolchain.sh cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
./scripts/with-toolchain.sh cmake --build build -j 4
./scripts/with-toolchain.sh ctest --test-dir build --output-on-failure
./build/nova_studio
```

Click an example, press **1 / 2 / 3**, or use gamepad **A / B / X**. Move with **WASD, arrow keys, D-pad, or left stick**. In the 3D example, **Space / A** makes the model bounce; in the asset project it lifts the imported gem. **F1 / Start** returns to the launcher, **R** reloads the active script or whole project, and **Esc / Android Back** exits.

Edit the source examples with your preferred text editor, then rebuild to synchronize them into `build/examples`. Asset synchronization runs even when no C source changed. Alternatively, play a source script directly and use R after saving:

```sh
./build/nova_studio --scene "$PWD/examples/2d/main.lua"
./build/nova_studio --scene "$PWD/examples/mixed/main.lua"
./build/nova_studio --project "$PWD/examples/assets/nova.project"
```

The executable resolves its bundled examples relative to its own directory, not the shell's current directory. To move the desktop build, keep `nova_studio`, `examples/`, and `licenses/` together. There is no `.app` bundle, installer, notarization, or integrated script editor yet.

### Native rendering evidence and repeatable checks

On the development machine, the Debug build and focused tests passed. Real GPU runs reported **Apple M4**, OpenGL **4.1 Metal**, and successful texture, shader, framebuffer, and mesh uploads. Both examples ran for 120 frames and exported native framebuffer captures; the launcher also ran and was captured. This is functional execution evidence, **not a Retroid performance benchmark**.

```sh
./build/nova_studio --scene ./examples/2d/main.lua --frames 120 --capture ./build/2d.png
./build/nova_studio --smoke --frames 120 --capture ./build/mixed.png
./build/nova_studio --frames 2 --capture ./build/studio.png
```

The smoke run switches from 2D to mixed at its midpoint and supplies deterministic movement/action input. Each bounded run prints `NOVA_RUN ... status=ok` and exits nonzero on scene/capture errors or an interrupted run. Capture files are real 960x540 native render-target images. `--frames` uses a fixed timestep rather than measuring performance.

Default tests require no display: they cover example movement, mixed-scene commands, native AABB collision, viewport sizing, Lua errors/limits, manifest validation, asset handles, root/symlink containment, PNG/GLB decoding, hierarchical transforms, mirrored winding, 32-bit indices above 65535, CLI validation and the pinned Android lifecycle patch. Opt-in GPU tests also cover whole-project replacement, shared-path caching, cleanup after partial import/Lua failures, and exact sprite/transparency/model-color pixels from a real runtime capture. To include the GPU runs:

```sh
./scripts/with-toolchain.sh cmake -S . -B build -DNOVA_GPU_TESTS=ON
./scripts/with-toolchain.sh cmake --build build -j 4
./scripts/with-toolchain.sh ctest --test-dir build --output-on-failure
```

GPU tests need a logged-in graphical desktop and are opt-in for headless CI. Linux/Windows desktop builds have not been validated; this initial build configuration is macOS/Android-focused.

## Shared engine and project layout

| Path | Purpose |
| --- | --- |
| `engine/` | C11 engine, Lua API, input contract, camera/draw command data, native collision, logical viewport |
| `runtime/main.c` | Shared desktop/Android native game loop, GPU mesh rendering, overlay, input and launcher |
| `engine/project.{c,h}` | Versioned manifest declarations, stable IDs and lexical path validation |
| `runtime/assets.{c,h}` | Native path resolution, PNG/GLB decoding, resource cache and transactional scene replacement |
| `examples/2d/main.lua` | Editable 2D gameplay, moving target and native contact detection |
| `examples/mixed/main.lua` | Editable 3D gameplay, camera, generated mesh models and HUD |
| `examples/assets/` | Editable manifest project, original CC0 PNG/GLB fixtures and provenance notice |
| `android/` | Gradle application, Android NativeActivity manifest, pinned wrapper |
| `tests/` | Focused shared-engine and build-integration tests |
| `licenses/` | Dependency licenses; builds also preserve embedded upstream notices |

**Rendering choice:** raylib 5.5 uses GLFW/Cocoa and OpenGL on macOS, and EGL/OpenGL ES 2 with Android NativeActivity. Lua 5.4.8 has no JIT requirement. Native C owns rendering, meshes, resources, collision and frame scheduling; Lua controls lightweight gameplay. macOS OpenGL is deprecated, so this is a practical first-slice backend, not a commitment to use OpenGL indefinitely.

**Coordinates and timing:** all scenes share a 960x540 logical canvas and 60 Hz fixed simulation. A 2D scene uses nearest-neighbor, integer letterboxing when the window can fit at least one logical canvas; smaller windows use fractional downscaling. 3D/mixed scenes use aspect-preserving fractional scaling with bilinear presentation. Resizing never changes game coordinates. HUDs currently use the same render target as the world; separately sharper HUDs, 720p/1080p settings, and interpolation are future work.

**Lifecycle:** desktop simulation pauses while unfocused and discards accumulated inactive time. Android event polling is provided by raylib's NativeActivity backend, which blocks while unfocused and detaches/rebinds its EGL surface. Delta time is capped to five simulation steps, preventing long catch-up after suspension. Nova applies a small checked/idempotent raylib Android patch to leave its blocking event loop when activity destruction is requested. Native resources are released on exit. Activity recreation starts a fresh scene; unsaved gameplay state is not persisted.

Android pause/resume, controller mapping, OS process death, GPU context loss, thermal behavior, and Retroid display scaling still require device validation. Full GPU context reconstruction is not implemented by Nova. Do not treat a successful desktop run as Android lifecycle validation.

### Minimal scene API

Scenes are ordinary text Lua files with `update(dt, input)`. Both 2D and 3D use the same runtime and format; scene mode is a choice, not an incompatible project type. The initial dimensions are `nova.width` and `nova.height`. `input.horizontal` / `vertical` are -1..1, and `input.action` is a held boolean.

```lua
nova.scene("2d") -- "3d" and "mixed" use the same script format
local x = 100

function update(dt, input)
    x = math.max(0, math.min(nova.width - 32, x + input.horizontal * 200 * dt))
    nova.background(18, 24, 41)
    nova.rectangle(x, 250, 32, 32, 77, 225, 201)
    nova.text("My first native game", 24, 24, 24, 235, 243, 255)
end
```

| Function | Arguments |
| --- | --- |
| `nova.scene` | `"2d"`, `"3d"`, or `"mixed"` |
| `nova.background` | `r, g, b` |
| `nova.rectangle` | `x, y, width, height, r, g, b` |
| `nova.text` | `text, x, y, fontSize, r, g, b` |
| `nova.camera` | `x, y, z, targetX, targetY, targetZ, verticalFovDegrees` |
| `nova.cube` | `centerX, centerY, centerZ, width, height, depth, r, g, b` |
| `nova.asset` | `declaredID`; returns an opaque, scene-local sprite/model handle |
| `nova.sprite` | `handle, x, y, width, height`; whole image, white tint, alpha blending, nearest filtering |
| `nova.model` | `handle, x, y, z, uniformScale`; static model at position, positive scale, no extra rotation |
| `nova.overlap` | `ax, ay, aw, ah, bx, by, bw, bh`; returns boolean, edge-touching is not overlap |

Rectangles and text are drawn after the depth-tested 3D models, as an overlay. Cube commands instance a GPU-uploaded unit-cube mesh model, not software-rendered shapes. Camera up is +Y and its direction may not be parallel to that axis. Color channels are integer 0..255. Sizes must be positive; numeric arguments must be finite and within +/-1,000,000. Text is limited to 191 bytes and the bundled font has limited glyph coverage.

Each update rebuilds the draw-command buffer (maximum 512); Lua gameplay state persists until reload. Both loading and each update have a 200,000-instruction budget and the Lua allocator has a 16 MiB limit. Script errors stop that scene, appear in the native error screen and log, and can be fixed/reloaded. Only base/math/string/table libraries are exposed; filesystem/process/package libraries are absent. These are stability limits for local authoring, **not a hardened security sandbox for hostile scripts**.

### Version 1 project and native asset contract

Run `--project path/to/nova.project`, or choose launcher card **3**. `--project`
and direct `--scene` are mutually exclusive; `--smoke` keeps its original two-scene
behavior. Direct scripts have no declared assets, and cannot acquire asset handles.
Both old examples and 2D/3D/mixed modes retain the same engine and frame format.

The manifest is strict, non-executable ASCII text. Its containing directory is
the project root (the canonical manifest location on desktop); there is no separate
root override. Version 1 is:

```text
nova-project 1
entry main.lua
sprite badge assets/badge.png
model gem assets/gem.glb
```

The header must be the first non-comment directive. Exactly one `.lua` entry is
required, with up to 32 assets. IDs are case-sensitive, unique, 1..63 ASCII letters,
digits, underscores or hyphens. Paths are the rest of each line, may contain
internal spaces, and are limited to 511 bytes; no quoting or inline comments.
Blank lines and whole-line `#` comments are allowed; LF/CRLF work. Unknown versions,
directives, duplicates, wrong extensions, NUL, and manifests over 16 KiB fail with
line-specific errors. Absolute paths, `.`/`..` segments, empty segments, backslashes,
colons and `#` in paths are forbidden. Every referenced file must exist; desktop
canonicalization also rejects symlinks escaping the root and non-regular files.
Android resolves the same relative paths in bundled APK assets, not user storage.

Lua acquires handles by ID, never by filename:

```lua
nova.scene("mixed")
local badge = nova.asset("badge")
local gem = nova.asset("gem")
function update(dt, input)
    nova.sprite(badge, 24, 100, 96, 96)
    nova.model(gem, 0, 0, 0, 1.5)
end
```

Handles are protected userdata, typed and valid only in their owning Lua state.
Sprites join the rectangle/text overlay in command order; imported models join
depth-tested cubes in world command order, and require 3D/mixed mode.
Native code reads/decodes/uploads at project load, never in the per-frame draw
path. IDs sharing the same declared path/type share one native resource and unload
it once. R stages a fresh registry and Lua state, validates the initial update,
then swaps both together and releases the previous project. A failed load/reload
releases all staged resources, retains the previous registry/state internally,
and stops presentation on the actionable native error screen until retry or
return to launcher. Successful reload resets gameplay state and invalidates old
handles. Launcher return and exit release owned resources. There is no cross-project
cache, filesystem watcher, incremental reload or GPU-context reconstruction.

**Supported import subset:**

- **PNG:** 8-bit RGB/RGBA, noninterlaced, 1..2048 pixels per dimension. Palette,
  grayscale, 16-bit and other image formats are rejected. Alpha is preserved.
- **GLB:** glTF 2.0, exactly one embedded BIN buffer and one scene, with all nodes
  belonging to that scene. Static triangle primitives use float32 `POSITION` and
  optional float32 `NORMAL`; normals have no lighting effect in this unlit slice.
  Non-indexed and unsigned 8/16/32-bit indices work, including indices above 65535:
  triangles are expanded rather than truncated. Parent/local translation, normalized
  quaternion rotation, scale and affine matrices are baked into vertices; mirrored
  transforms correct winding. Repeated mesh nodes become separate mesh instances.
  Materialless geometry is opaque white; declared materials must use
  `KHR_materials_unlit` with an opaque base-color factor. Raylib's default shader
  renders those colors without PBR lighting.
- **Explicitly rejected:** all buffer/image URIs (external and data), textures,
  UVs, vertex colors/tangents, animation, skins, morph targets, compression,
  multiple scenes, imported cameras/lights, double-sided/transparent/emissive
  materials, lit/PBR materials and extensions other than `KHR_materials_unlit`.
  Unsupported or malformed data never reports successful fallback geometry.

Bounds: 16 MiB per asset/entry file, 64 MiB total unique asset input, 16 million
total sprite pixels, 256 GLB nodes, 128 node-instanced primitives per model,
65535 expanded vertices per primitive, and 262144 expanded vertices across the
project's unique models. Accessors are nonsparse, component-aligned with strides
up to 252 bytes. Local matrices and transformed positions must be finite and
within +/-1,000,000. Native import is for trusted local authoring, not a hostile-file
security sandbox.

No importer dependency was added: Nova uses cgltf already embedded in pinned
raylib 5.5, but performs strict validation/conversion instead of calling raylib's
permissive `LoadModel` path (which ignores scenes/features, truncates some indices
and may supply fallback geometry). Its embedded upstream notice is already packaged.
The original sample sprite/model have a CC0 provenance notice and can be reproduced
with an installed Python 3 via `scripts/generate-sample-assets.py`.

Desktop builds synchronize the entire `examples/` tree, including the project.
Android's existing Gradle Sync task packages that identical tree before asset
merging. APK verification byte-compares every sample manifest/script/asset/provenance
file, in addition to the old examples, native activity exports and dependency notices.
Custom projects can run directly on desktop; arbitrary project selection/export to
APK is not implemented. The Android launcher includes the bundled sample project.

## Android APK scaffold

The Android application packages the **same C engine, runtime, editable scripts and manifest project assets** into a standalone arm64 APK. The host is Android's built-in NativeActivity, so no custom Java/Kotlin UI or WebView is needed for this slice. No storage/network permissions are requested. The sample launcher is included; a per-game exporter that chooses one project is not implemented yet.

Pinned build configuration: **JDK 17**, **Gradle 8.11.1**, **Android Gradle Plugin 8.9.2**, **NDK 27.2.12479018**, **SDK platform/build-tools 35**, **CMake 3.22.1**, `arm64-v8a`, minimum Android 8/API 26, target Android 13/API 33. Target API 33 is intentional for initial Android 13 development, not a current Play Store publishing configuration. NDK flexible-page-size support is enabled.

**Verified development-machine state:** setup completed using Temurin **17.0.21+9**, Homebrew CMake CLI **4.4.4**, Ninja **1.13.2**, Bash **5.3.20**, and the required Google SDK packages. The debug APK was rebuilt with the manifest/PNG/GLB project at `android/app/build/outputs/apk/debug/app-debug.apk`. Its signature, ARM64 native activity entry points, old Lua examples, every bundled project file and license notices passed verification. No Android device was exercised, so execution/performance/lifecycle behavior on Retroid remains unvalidated.

Run the read-only prerequisite check:

```sh
./scripts/android-doctor.sh
```

### Easy toolchain setup

`.tool-versions` selects asdf tool versions; **it does not install Android SDK packages or pin Homebrew formula versions**. Nova's companion helper uses asdf only for the pinned JDK and Homebrew for the host CMake CLI/Ninja/Bash, then bootstraps Google's command-line tools **19.0 / archive build 13114758** and uses `sdkmanager` for the project SDK components. Gradle itself is installed by the pinned wrapper, not a system Gradle package. No Android Studio IDE or emulator is required.

Minimal macOS prerequisites are Apple command-line tools (`xcode-select --install`, if absent), Homebrew and standard `git`, `curl`, `unzip`, and `shasum`. When needed, the explicit install command installs asdf 0.16+, the CMake CLI and Ninja formulae and Bash 5 (required by the Java plugin) using Homebrew. Existing installations are reused. Homebrew itself is never bootstrapped by a downloaded shell script. On Linux, provide asdf, Bash 5, CMake 3.22+, Ninja 1.10+ and those utilities through your supported package manager; Linux setup has mocked coverage but no real-host installation validation.

From the Nova Studio root:

```sh
./scripts/setup-toolchain.sh --dry-run  # also the default; no downloads or writes
./scripts/setup-toolchain.sh --install # explicit permission to download/install
./scripts/build-android.sh
```

The build command also runs `scripts/verify-apk.sh`; a valid signature alone is not enough. Verification explicitly requires exported `ANativeActivity_onCreate`, `android_main` and `nova_tick` symbols in the AArch64 runtime, matching example scripts and every sample project file (manifest, script, PNG, GLB and provenance), and packaged license notices. This caught and corrected the initial missing native-activity linker entry point. Run the checks again without rebuilding using `./scripts/verify-apk.sh`.

Run installation in a terminal. First-time SDK bootstrap links the [Android SDK License Agreement](https://developer.android.com/studio/terms) and requires typing `ACCEPT`. The subsequent `sdkmanager` package installation presents its own relevant license agreements and asks for your answers. **Download permission does not accept licenses. No `yes` pipeline, blanket acceptance, or manually forged license files are used.** Declining or reaching EOF stops with a nonzero status; successfully installed native tools remain available for a later retry.

The helper installs only missing `platforms;android-35`, `build-tools;35.0.0`, `ndk;27.2.12479018`, `cmake;3.22.1`, and `platform-tools`. API/build-tools/NDK/CMake versions match `android/app/build.gradle`. Google's `sdkmanager` does not select a fixed release for `platform-tools`; missing ADB tools get Google's current stable package, while an existing package is preserved. This does not affect the APK's pinned compiler/SDK configuration.

Paths are resolved consistently by setup, doctor and build: `--sdk-root` (setup only), `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `android/local.properties`'s `sdk.dir`, then `~/Library/Android/sdk` on macOS or `~/Android/Sdk` on Linux. Paths with spaces work. Conflicting SDK variables or a different existing `local.properties` root fail explicitly, rather than installing into one SDK while Gradle builds with another. No `local.properties`, shell startup files or global `.tool-versions` are written. To use another SDK:

```sh
export ANDROID_HOME="/absolute/path/to/your/sdk"
# Unset an obsolete ANDROID_SDK_ROOT or set it to the same directory.
./scripts/setup-toolchain.sh --install
./scripts/android-doctor.sh
./scripts/build-android.sh
```

`./scripts/setup-toolchain.sh --install --sdk-root "/absolute/path/to/your/sdk"` is an alternative for installation; subsequent build commands still need that same root through the environment or an existing matching `local.properties`.

asdf installs Java into its own data directory (normally `~/.asdf/installs`), leaving other JDKs untouched. The Java plugin uses a recorded upstream revision when newly installed; existing plugins are reused without updates. `.asdfrc` disables Java's optional macOS system integration, avoiding sudo or system Java symlinks. An existing explicit `JAVA_HOME` is honored by doctor/build; unset it to use the pinned asdf JDK, or point it to a compatible JDK 17. `./scripts/with-toolchain.sh COMMAND ...` supplies Java/SDK/tool PATH only to that command, explicitly putting Homebrew's CMake/Ninja before asdf shims. No global asdf CMake configuration is changed; use this wrapper for native commands if an old shim remains in your shell PATH. Bare Gradle commands require `JAVA_HOME`/SDK variables to be configured in your own shell.

Homebrew and asdf are distribution mechanisms, **not automatic trust guarantees**. Homebrew verifies its bottle hashes, but still downloads upstream artifacts/bottles; asdf plugins are independently maintained scripts. Nova's Java plugin downloads Eclipse Temurin releases and verifies SHA-256. Google SDK packages still come through `sdkmanager`, even if Homebrew is used to bootstrap Android command-line tools in another workflow. Nova's helper keeps its explicitly versioned, digest-checked Google CLI bootstrap rather than a rolling Homebrew Android cask.

Existing SDK versions and `cmdline-tools/latest` are left alone. The helper uses its own `cmdline-tools/19.0` directory and a checked temporary extraction directory; incomplete or mismatched CLI destinations fail without overwriting them. Re-running a completed installation performs no downloads/package updates or license responses. The bootstrap archive is checked against Google's official `repository2-1.xml` digest (that legacy archive publishes SHA-1); asdf-java verifies its JDK release's SHA-256, and Gradle's distribution is SHA-256-pinned.

A fresh setup may download roughly **2-4 GB** and consume **8-12 GB of disk**, with additional temporary extraction/cache space. Sizes vary by host/package revision; no automatic pruning of existing installations or caches occurs. The first APK build additionally downloads Gradle, Android Gradle Plugin dependencies and the native source archives.

#### CMake.app warning during the initial installation

The original setup attempted CMake 3.31.8 via the community asdf-cmake plugin, which downloaded Kitware's official `cmake-3.31.8-macos-universal.tar.gz` release over HTTPS but did not verify an archive digest. The copied app had a Kitware Developer ID signature and stapled notarization ticket, yet `codesign --verify --deep --strict` and Gatekeeper rejected its QtGui framework as an ambiguous bundle. The framework's expected links were materialized as files/directories; copying by that installer is a likely cause, but the original downloaded archive was not retained for comparison.

The revised helper never installs or selects that asdf CMake.app. It uses the existing Homebrew CLI and verifies that it runs and satisfies CMake 3.22+. No quarantine removal, Gatekeeper disabling, GUI launch or app deletion is performed. If macOS rejects any downloaded tool, stop installation and investigate its source/signature rather than bypassing the warning. After the user chose Homebrew CLI tools and explicitly authorized resuming, SDK installation completed. The rejected app was left untouched in the user's Trash.

Offline, isolated setup tests use fake version-manager/downloader/SDK-manager commands, not your real SDK or user configuration:

```sh
bash tests/toolchain_test.sh
```

The wrapper downloads a SHA-256-pinned Gradle distribution on first use. Its bundled wrapper JAR SHA-256 is `2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046`, from Gradle's `v8.11.1` upstream release. The native CMake build fetches the same pinned raylib/Lua dependencies as desktop. Wrapper, network, CMake and compilation failures are not suppressed.

Equivalent build command and expected output:

```sh
./scripts/with-toolchain.sh sh -c 'cd android && ./gradlew :app:assembleDebug'
./scripts/verify-apk.sh
# android/app/build/outputs/apk/debug/app-debug.apk
```

The APK is signed with Gradle's standard **debug** signing identity, not a production release key. Verification establishes package integrity/structure, not Android hardware behavior. Re-running the real completed setup with stdin closed succeeded without downloads, SDK updates, plugin changes or license prompts; isolated setup tests also cover refusal, checksum failure, incomplete destinations and configuration preservation. The installed SDK occupies about **3 GB** on this machine; caches/JDK/build outputs add further disk usage.

After enabling USB debugging and connecting the intended device, installation/launch commands are:

```sh
./scripts/with-toolchain.sh adb devices -l
./scripts/with-toolchain.sh adb install -r android/app/build/outputs/apk/debug/app-debug.apk
./scripts/with-toolchain.sh adb shell am start -n studio.nova.runtime/android.app.NativeActivity
./scripts/with-toolchain.sh adb logcat -s raylib
```

Run those from the Nova Studio root; choose a specific device using `adb -s SERIAL` when multiple devices are attached. Installation is an explicit user action, not something this foundation runs automatically. Test 2D/mixed scenes, controls, Back/Start, pause/resume and recreation before trusting a device build.

## Deliberately outside this slice

No original asset modeller, extrusion, skeletal animation, importer UI, full textured/PBR model pipeline, lighting/shadows, physics world, scene inspector, project browser, release signing/export wizard, audio API, persistent saves, or user-script module loader yet. The original 3D example uses generated meshes; the third launcher project imports a real static GLB and PNG. Timers currently use `dt` in Lua; audio/save services will share the same scene runtime when added. No existing saves are read or changed, and no Glow compatibility is implied.

**Next work:** stabilize the versioned manifest/import/handle interfaces with real projects and validate the APK on Retroid Pocket 6 with the user's consent, including imported assets, controller/lifecycle/render-resolution checks. Defer the full editor and original primitive/transform modeller until those interfaces are stable; any later authoring UI must use this native pipeline, not a separate preview engine.

## Local source history

Nova Studio has a local Git repository on `main`; no remote/GitHub repository is configured. Source, tests, dependency notices and the intentional Gradle wrapper JAR are tracked. Builds, SDK/toolchain caches, local SDK paths and signing/private machine files are excluded by `.gitignore`. The SDK and asdf installations remain outside the source repository.

Before publishing, select a license for Nova's newly authored project code. Keep the dependency notices shipped beside desktop builds and inside APK assets; they include full original single-header sources where notices are embedded, intentionally favoring preservation over compact packaging in this prototype.
