# Nova Studio handoff and TODO

Last checked: 2026-11-01. Read `README.md` for full commands and limitations,
and `AGENTS.md` before making changes. This is a working native vertical slice,
not a finished editor or a hardware-validated game engine.

## Verified completed foundation

- [x] Independent source tree: no dependency on GameStudio or Glow43.
- [x] Shared C11 engine and native desktop/Android runtime, raylib 5.5 and
  Lua 5.4.8, with upstream archive hashes and preserved dependency notices.
- [x] Runnable native launcher, editable 2D example, and mixed 3D camera/
  generated cube mesh example with a 2D overlay. No WebView or streaming renderer.
- [x] Shared scene modes, input contract, native AABB overlap, Lua error/limit
  handling, script reload, fixed 60 Hz updates and logical 960x540 presentation.
- [x] Real macOS GPU execution/captures on Apple M4. Default three CTests,
  opt-in GPU runs and earlier core sanitizer checks passed.
- [x] Android NativeActivity scaffold with pinned Gradle/AGP/SDK/NDK/CMake,
  arm64-v8a packaging and checked native lifecycle source patch.
- [x] Explicit, idempotent toolchain setup and isolated setup tests. Standard
  `.tool-versions` pins only asdf Java; Homebrew supplies host CLI CMake/Ninja/
  Bash, Google sdkmanager supplies Android packages, and Gradle uses its wrapper.
  The actual completed setup rerun needed no downloads or license responses.
- [x] Android debug APK built. Verification caught and fixed missing static
  native-glue retention; `ANativeActivity_onCreate`, `android_main` and `nova_tick`
  are now required exports. Existing APK verification was rerun on this date.
- [x] Local source-only Git repository on `main`, no remote. Foundation commit:
  `0236784056458da4b0a59979ae67d0dccf0d06f4`. Generated builds, SDKs/caches,
  private configuration and signing material are ignored; wrapper JAR is tracked.

APK: `android/app/build/outputs/apk/debug/app-debug.apk` (generated, not committed).
Foundation APK SHA-256 (historical):
`263c9faeda7af198fdc9f18d4c1efdd42d179c7e653e125e0d79c85a49c1301d`.
Signature v2, AArch64 ELF/activity exports, byte-identical example scripts and
license notices pass `./scripts/verify-apk.sh`. This is debug signing and package
verification, not device execution or release readiness.

## Completed bounded slice: manifest and native asset pipeline

- [x] Strict non-executable `nova.project` v1 text manifest, rooted at its containing
  directory, with one Lua entry and stable typed asset IDs. Line-specific format
  errors, duplicate IDs, missing files, lexical/root/symlink escapes and non-regular
  desktop files are rejected. `--scene` and the two original examples remain.
- [x] Native registry, declared-path/type cache and explicit ownership. Lua gets
  protected typed handles through `nova.asset`, not filesystem access. R stages
  resources plus a new Lua state and initial update, then replaces both atomically.
  Failed staging frees candidate resources and shows an error; previous state is
  retained internally but not presented as a successful reload.
- [x] Native `nova.sprite` and `nova.model` commands through the shared frame/runtime.
  PNG supports noninterlaced 8-bit RGB/RGBA. GLB supports embedded static triangles,
  hierarchical affine transforms, mirrored winding and opaque unlit base colors.
  Unsigned 8/16/32-bit indices are expanded, not truncated. Unsupported features
  fail explicitly. Reuses cgltf inside pinned raylib 5.5; no new dependency.
- [x] Original CC0 sprite and octahedron with reproducible generator/provenance in
  `examples/assets/`, accessible as launcher card 3 or via `--project`.
  Desktop and Android package the same project. Verification now byte-compares
  every sample project file, not only the previous scripts.
- [x] Default manifest/handle/path/import tests and opt-in native GPU project,
  exact capture-pixel and reload/cache/partial-failure lifetime checks. Desktop
  builds and both old GPU scenes remain working. Android debug APK rebuild and
  signature/AArch64/activity-export/project-asset verification passed.

Approved initial contract: text v1 manifest, `--project <manifest>`, typed scene-local
handles and whole-project R replacement; PNG and embedded-only static unlit GLB.
See README for exact syntax, limits and exclusions. No URIs/textured or lit/PBR
materials, animation, skins, compression, authoring UI or per-game exporter.
This is a bounded interchange contract, not general glTF compatibility.

The new APK is generated in this worktree at the same relative path above.
Current SHA-256:
`9831fee2b5f49337f96c26bba13e6952613d780716aeb1fedd771a9b1edabd1e`.
All 11 desktop CTests (including opt-in GPU/capture/lifetime checks) passed;
targeted manifest/import/lifetime checks were rerun after the final parser changes.
Android rendering and lifecycle behavior have still not been exercised on a device.

## Next bounded work: interface stabilization, not the full editor

- [ ] Exercise the v1 project/import/handle contract with additional original
  projects, including 2D-only sprites, multiple static primitives and authoring
  reload errors. Keep expanded support explicitly versioned and tested; do not
  silently accept unsupported materials.
- [ ] Perform the separate consented Android device-validation track below,
  including the third launcher project and imported PNG/GLB visual output.
- [ ] Agree on stable scene/asset inspector interfaces before implementing
  a full editor or modeller. Neither authoring application is delivered here.

### Recommended fresh-session kickoff

> Read AGENTS.md, TODO.md and README.md in the assigned NovaStudio worktree.
> Stabilize the implemented manifest v1/native PNG/static GLB interfaces with
> focused original-project fixtures and regression coverage. Preserve direct
> scenes, desktop and Android packaging. Do not start the full editor/modeller
> or broaden import compatibility without a confirmed contract. Device execution
> needs separate consent and an intended attached device; APK verification is
> not device validation.

## Separate device-validation track

No Android hardware was connected during the completed build. With the user's
consent and intended device attached:

- [ ] Install/launch the APK and verify all three samples (including imported
  sprite/model output), controller axes/buttons,
  Back/Start, resizing/display scaling and visual output.
- [ ] Exercise pause/resume, activity destruction/recreation, OS process death
  and GPU context loss. Full GPU context reconstruction and persisted gameplay
  state are not implemented; record failures rather than implying support.
- [ ] Measure real frame pacing, thermal behavior and Retroid performance.
  Bounded desktop `--frames` runs use deterministic time, not a device benchmark.

This track can proceed independently of manifest work. It is required before
claiming device-proven behavior, not before implementing a desktop asset loader.
ADB installation is an explicit device-modifying action; see README commands.

## Later work and actual prerequisites

- [ ] Project browser/scene inspector/editor: after the implemented manifest/native
  asset APIs stabilize, build authoring UI backed by those real contracts, not a mock.
- [ ] Original simplified low-poly modeller: after asset interchange is usable;
  start with static primitives/transforms/materials. Skeletal authoring and
  animation require their own later engine/import contracts. Do not copy Blender.
- [ ] Separate native-resolution HUD and configurable world rendering: current
  world AND overlay use the same 960x540 target; sharper HUDs are not delivered.
- [ ] Shared audio, persistent saves and animation services: absent today.
  Lua can accumulate `dt`; there is no dedicated timer service/module loader.
- [ ] Per-game export, production signing/distribution and broader platform
  validation: current APK bundles the sample launcher, not one selected project.
- [ ] Select a license for newly authored Nova code before public distribution;
  dependency licenses do not select the project's own license.

No Glow compatibility is implemented or promised. Mac OpenGL is deprecated;
future backend work must preserve the native desktop/Android path.

## Copilot folder/worktree coordination

The app session was registered as a folder-backed project. Adding local `.git`
does not by itself convert that app registration into a repository/worktree
project. A fresh session may use this folder sequentially, but do not run parallel
writers against it. For isolated sessions, register/open NovaStudio as a Git
repository in Copilot and confirm that each session actually has its own checkout/
worktree before parallel work. Verify the new session's cwd; do not default to
the coordinating GameStudio repository. No remote is required for local work.
