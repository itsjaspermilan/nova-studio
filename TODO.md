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
SHA-256: `263c9faeda7af198fdc9f18d4c1efdd42d179c7e653e125e0d79c85a49c1301d`.
Signature v2, AArch64 ELF/activity exports, byte-identical example scripts and
license notices pass `./scripts/verify-apk.sh`. This is debug signing and package
verification, not device execution or release readiness.

## Next bounded implementation: manifest and native asset pipeline

These items are pending. Implement them in prerequisite order as one focused
slice, before building a full editor or modeller:

1. [ ] Define and validate a versioned project manifest: project root, entry Lua
   scene and declared assets with stable identifiers. Keep 2D/3D/mixed in the
   shared scene format. Resolve project-relative paths consistently and reject
   malformed manifests, duplicate identifiers, missing files and root escapes
   with actionable errors. Preserve existing direct `--scene` and launcher use.
2. [ ] After the manifest contract, add native asset registration/loading and
   explicit resource ownership. Keep file decoding, GPU upload, caching and
   unload/reload in native code; Lua should reference validated asset handles,
   not gain arbitrary filesystem access. Reuse the current core/frame/runtime
   boundary rather than introducing a separate engine for each scene mode.
3. [ ] After registration/lifetime handling, support a small documented sprite
   image subset and static GLB mesh import, with Lua draw commands for each.
   Demonstrate one real imported sprite and one static model with the existing
   camera/overlay. Investigate raylib's pinned import support before adding
   another dependency. Use original or appropriately licensed test assets.
   Explicitly report unsupported model/material features, not silent success.
4. [ ] With those imports working, wire identical project/assets into desktop
   and Android packaging. Add focused manifest/path/error/lifetime tests and
   bounded native render checks; rebuild and structurally verify the APK with
   the new assets. Update verification beyond its current example-only checks.
   Retain both existing example scenes and their behavior.

Acceptance: a project folder containing an editable script, manifest, sprite
and static GLB can run through the shared native path on desktop and be packaged
into the Android APK. Failures are visible; assets are not decoded/uploaded every
frame; resources are released/replaced correctly. APK success alone does not
claim Android rendering was exercised. No asset authoring UI, full importer UI,
animation, full PBR renderer, audio/saves or release exporter in this slice.

Open design choices for that session: manifest filename/schema and versioning,
minimal image/material/GLB feature subset (including external URI policy),
asset-handle and reload semantics, and project selection/CLI shape. These are
not existing APIs or irrevocably selected formats. State the supported subset;
ask the user before making significant compatibility/product decisions.

### Recommended fresh-session kickoff

> Work only in NovaStudio. Read AGENTS.md, TODO.md and README.md, then implement
> the bounded "manifest and native asset pipeline" slice in TODO.md: validated
> project manifest, native resource registry/lifetime, sprite and static GLB
> imports, and desktop/Android asset packaging with focused tests. Preserve the
> current examples and shared 2D/3D/mixed runtime. Do not build the full editor
> or modeller, add unrelated services, or claim device validation. Surface
> significant open design choices; do not perform large new installs or accept
> SDK licenses silently.

## Separate device-validation track

No Android hardware was connected during the completed build. With the user's
consent and intended device attached:

- [ ] Install/launch the APK and verify both scenes, controller axes/buttons,
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

- [ ] Project browser/scene inspector/editor: after the manifest and native asset
  APIs, build authoring UI backed by those real contracts, not a decorative mock.
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
