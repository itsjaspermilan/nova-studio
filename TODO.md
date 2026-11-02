# Nova Studio handoff and TODO

Last checked: 2026-11-01. Read `README.md` for full commands and limitations,
and `AGENTS.md` before making changes. This is a working native vertical slice,
not a finished editor or a hardware-validated game engine.

## Current integrated handoff

The approved bounded software milestones are implemented and locally committed:
manifest/native assets, inspection, runtime services, standalone export/signing
tooling, native HUD, source/project editor, original static primitive modeller,
beginner 2D/3D Objects and Rooms with the substantive native UX follow-up,
and named primitive modelling with bounded opaque PNG textures.
No remote push, personal-key operation or device installation was performed.

The latest modelling implementation's 50-test suite passed, including real native both-dimension form/
typing/scroll workflows, game frames/pixels, source/modeller/export regressions
and guarded save-failure tests. The ordinary debug Android launcher also builds
and passes exact APK verification. Screenshots cover minimum 1200x780 logical
layout and high-DPI framebuffer output; these are not device/performance claims.

Earlier foundation evidence: the combined 42-test desktop suite passed with GPU/audio enabled before the last
integration correction to modeller dirty-state reporting. All 23 display-free
tests passed afterward. After the usable macOS desktop returned, all six final
authoring CLI/GPU selectors also passed, including the real-shell missing-source/
dirty-state regression. The temporary GLFW/no-monitor blocker is resolved.
Repeat the focused authoring checks with an active logged-in desktop:

```sh
./scripts/with-toolchain.sh ctest --test-dir build --output-on-failure \
  -R '^nova_(gpu_modeller_ui|gpu_editor.*|editor_cli_.*)$'
```

The final ordinary Android launcher rebuild/package verification passed.
Current modelling-milestone debug APK SHA-256:
`98cc9b0521e6b1008aaf037f229fa95d510aaae6578c240ce27b551630037da6`.
The standalone `build/exports/services-demo-v3/` export also built and passed exact
package verification: manifest v2/audio, increasing versionCode 3, compiled
`NOVA_STANDALONE=ON` and world preset `1920x1080`. Its generated unsigned release
APK SHA-256 is
`930c069390f598e4477102c8dd8c19a14925dddbf77b609bed3365e1a5bd3347`.
It is not personally signed or an install-ready release deliverable.

Current user decision: defer personal release signing and use the existing
debug-signed launcher APK at
`android/app/build/outputs/apk/debug/app-debug.apk` for development/device testing.
Debug signing is not release readiness; standalone release exports remain
unsigned until the separate personal-signing task is completed.

The user approved the beginner object/room authoring milestone below after
testing the source-oriented editor. Other remaining work requires personal-key/
device participation, public-publishing authorization, or separately approved
advanced engine/authoring scope. Historical milestone evidence follows.

## Completed milestone: beginner 2D and 3D game authoring

User direction: follow GameMaker 7's simple resource/object/room workflow,
building equivalent 2D and 3D workflows together. Use GameStudio's comparable
functionality as a read-only interaction reference, not copied implementation,
assets or a runtime dependency. Preserve the native renderer and system-style UI.

- [x] Research GameStudio's implemented project/resource/object/event/room and
  Run workflows. Transfer resource -> reusable object -> placed instance -> Run,
  layout-first opening, the appearance-to-object shortcut and contextual room
  selection/snap/undo patterns. GameStudio object behavior remains Lua-authored;
  Nova's beginner event/actions interface is new work, not copied functionality.
  Reference evidence is source-observed, not a live-app UX verification.
- [x] Add real versioned object/room authoring data with stable resource and
  instance references, validation and guarded save/reopen behavior. Preserve
  existing manifest/Lua projects and desktop/Android runtime contracts.
- [x] Make New Project -> Add Sprite/Model -> Create Object -> Place in Room ->
  Run work for both 2D and 3D without requiring manifest or Lua edits.
- [x] Organize the default native editor around a resource tree, contextual
  object/event/room editing and properties. Keep source/manifest controls under
  Advanced; preserve dirty/conflict/error decisions without exposing routine
  asset-export/reload mechanics as beginner tasks. Keep the original modeller.
- [x] Prove both real native workflows, including resource/object/instance
  edits, save/reopen, play/stop, failure retention and old-project regressions;
  preserve debug Android build/package verification. Device execution still
  requires separate consent; personal signing remains deferred.

Integrated as `92bf971`. All 46 configured desktop CTests passed in the
coordinator's worktree, including native action/pixel workflows for both
dimensions and existing runtime/editor/modeller regressions. The ordinary debug
Android APK also rebuilt and passed package verification here.
The subsequent contextual UX revision also passed all 12 focused integrated
authoring checks, including both dimensions' real native form/typing/scroll/
placement/play paths and existing Advanced editor/modeller regressions.
This is bounded native room/object authoring, not a GameMaker compatibility
layer. Full IDE, arbitrary mesh editing and animated GLB remain outside scope.

## Completed milestone: easy 3D modelling and basic textures

User decision: deliver this after Objects and Rooms, not as an expansion of the
current implementation. Beginner workflow: Models -> New Model -> assemble
parts -> assign colours/textures -> Save -> Create Object -> place in a 3D Room
-> Run. Build play areas by arranging objects/environment pieces in rooms,
without requiring an entire level to be authored as one mesh.

- [x] Make the original primitive modeller approachable for static characters,
  props and environment pieces: named/selectable parts, clear positioning/
  scaling and colour controls, with the model-to-object bridge and guarded
  source/export/save/reopen workflow integrated into the default editor.
- [x] Add bounded PNG colour textures with automatic primitive UV mapping and
  straightforward material assignment. Extend the actual native GLB import/
  export, GPU rendering and resource ownership contracts; the opaque unlit
  importer now accepts the explicit embedded PNG subset. Preserve old untextured
  projects and explicit format/path/budget errors; no placeholder texture UI.
- [x] Verify real textured primitive output, source/export/reopen round trips,
  object/room usage, failed-import/reload retention and texture/resource cleanup
  on desktop, plus debug Android build/package integrity. Device visual output
  still needs separately consented testing.

All 50 configured desktop CTests passed (GPU and audio enabled), including the
new headless texture/material/path/UV/budget suite, exact asymmetric native
quadrant pixels (4278/13020/4278/13020), texture allocation/free seam (22 balanced
uploads/releases, second-upload rollback), and real native Models -> New model ->
named parts -> PNG -> Save/reopen -> Create Object -> room Run workflow.
Original 2D, untextured model, editor, presentation and services tests still pass.
The new UV decoder initially had a last-vertex indexing overrun; it was corrected
before the final suite. Explicit mirrored/nonmirrored final-triangle vertex/UV
correspondence now covers textured/untextured multi-primitive/node-alias models.
Seven focused fully ASan/UBSan-instrumented selectors passed, including original
modeller/editor consumers, real editor child processes and the texture allocation
failure path; six focused instrumented headless selectors also passed.
Final Save model cancellation and post-export project-preview failure assertions
passed both instrumented and ordinary native workflow runs: a written source is
reported as 1 of 2 outputs, and staging errors retain the old engine/mesh without
being replaced by a success message.
Debug Android was rebuilt and exact sample/notices/ARM64/activity/signature
verification passed. No device visual/performance/lifecycle guarantee follows.

The source is nova-model v2 with unique named parts and contained PNG declarations;
v1 reads preserve the old IDs/transforms/colours and derive `Part_<ID>` names.
PNG copy, model source/GLB writes and game saves remain separate guarded writes,
not a multi-file transaction. Failed/cancelled partial saves report persistent
outcomes; undo/discard retains copied files. Screenshots are
`build/textured-native.png`, `build/textured-model-workspace.png` and
`build/textured-room-run.png`.

Initial characters are static assembled models; rigging/skeletal animation,
detailed UV/vertex editing,
arbitrary mesh authoring and broader PBR materials remain separately scoped
later work. No new dependency/version or external artwork was added; only the
existing hash-pinned build dependencies were fetched for this isolated worktree.
Personal signing and device installation remain deferred.

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
materials, animation, skins, compression or authoring UI.
This is a bounded interchange contract, not general glTF compatibility.

The new APK is generated in this worktree at the same relative path above.
Manifest-milestone APK SHA-256 (historical):
`9831fee2b5f49337f96c26bba13e6952613d780716aeb1fedd771a9b1edabd1e`.
All 11 desktop CTests (including opt-in GPU/capture/lifetime checks) passed;
targeted manifest/import/lifetime checks were rerun after the final parser changes.
Android rendering and lifecycle behavior have still not been exercised on a device.

## Completed bounded slice: interface stabilization

- [x] Exercise the v1 project/import/handle contract with original sprite-only
  RGB/RGBA and multi-primitive/static node-instance projects. Reproducible CC0
  assets use the existing full examples-tree sync; the launcher remains unchanged.
  No material/import compatibility was broadened.
- [x] Stable native read-only inspection v1 in `runtime/inspect.h`: real loaded
  declarations, alias indices, input bytes, dimensions, decoded primitive/vertex
  counts/baked bounds and actual frame/errors. README specifies borrowed metadata
  lifetimes and successful/failed reload behavior; no mock editor entities.
- [x] Shared headless project preflight using the same import/path/Lua staging
  path without GPU uploads. Copied output is committed only after initial update
  validity/budgets pass, and failed validation cannot mutate an active scene.
- [x] Focused declaration/handle/import/preflight regressions, authoring reload
  rollback/reordering, runtime errors and native alias ownership checks. Opt-in
  GPU captures check exact pixels from both original projects, not mock rendering.

All 15 desktop CTests, including both old scenes and the new exact-pixel GPU
captures, passed. Headless core/project/asset tests also passed ASan/UBSan.
Regeneration is byte-identical, and the synchronized desktop examples tree matches
the source tree. Android uses the existing full-tree sync, but this milestone did
not rebuild an APK or exercise a device; integration/package verification is a
separate coordination step. No editor/modeller or runtime service was added.

## Completed bounded slice: separate native HUD and world presentation

- [x] Shared native GPU presentation helper with a validated 960x540 default and
  bounded 1280x720/1920x1080 world color/depth presets. Desktop CLI overrides
  `--world-resolution`; CMake `NOVA_WORLD_RESOLUTION` supplies the desktop/Android
  build default without requiring Android arguments.
- [x] Rectangle/text/sprite HUD commands draw directly into the actual native
  framebuffer, separate from world rendering, with fixed logical coordinates,
  nearest sprite filtering/alpha, native-pixel integer 2D letterboxing and
  aspect-preserving mixed/3D presentation. Resize/DPI do not reload world/assets.
- [x] Existing `--capture` remains composite logical 960x540 including the HUD.
  Explicit bounded `--capture-native` exports native framebuffer dimensions
  and letterboxes instead; metadata reports real world/native/window dimensions.
- [x] Reusable caller-provided framebuffer preview rectangles with matching
  high-DPI pointer/layout mapping, without editor UI or another preview engine.
- [x] Focused headless layout/CLI/config errors, native color/depth target sizes,
  single-native-pixel HUD evidence, panel clipping, partial sprite alpha/nearest
  filtering, GPU partial-allocation rollback/cleanup/retry and default regression
  pixels. Android shared presentation compiles and APK integrity checks pass.

On Apple M4, all 28 desktop CTests passed, including original scenes/projects
and native GPU/capture/lifetime checks. World targets were measured at
960x540, 1280x720 and 1920x1080; the native overlay was 1920x1080 at 2x display DPI.
A half-logical-pixel HUD line occupied exactly one native pixel. A 1200x800-point
window resize yielded 2400x1600 native pixels with a 1920x1080 integer viewport
at (240,260), retaining its 960x540 world target. CLI captures decode to logical
960x540 and separately measured native dimensions for every world preset.
Android debug APK build/signature/ARM64 native-entry/sample-tree/notices checks
passed; this is not device execution or GPU-context reconstruction evidence.
No exporter/service/editor/modeller changes belong to this isolated milestone.

## Completed bounded slice: native desktop project/source editor

- [x] Separate desktop `nova_editor` target: real directory/project browser,
  manifest/Lua editing, existing entry/identity/asset-path properties, and real
  saved/live inspection v2 declarations/aliases/import metadata. Malformed
  manifests remain editable; imported bounds/counts are read-only.
- [x] Bounded UTF-8 text mutation/selection and one-step undo; independent
  draft/saved-snapshot/live state, full diagnostics and explicit native dirty
  switch/close/reread/entry and exact observed external-edit decisions.
- [x] Contained single-link/no-symlink documents, exact bytes/stat snapshots,
  same-directory atomic/fsynced saves and newer-conflict rejection. Save is
  per document; whole-project engine/resource reload is transactional separately.
  A small length-based text/binary output seam supports later authored exports.
- [x] Genuine GPU project panel through shared presentation/inspection/runtime
  contracts, 60 Hz ticks with post-success services, pause/error/hidden/unfocused
  suspension, retained prior engine/resources on failed candidate replacement.
- [x] Display-free document/property/path/conflict/budget/NUL/CRLF/error/undo
  tests, isolated original native save/reload/Lua/import rollback smoke and exact
  framebuffer preview/chrome pixels. Default runtime/old projects remain intact.

All 37 desktop CTests passed, including native GPU tests, on Apple M4. Display-free
document and text-editing tests also passed AddressSanitizer/UndefinedBehaviorSanitizer. Editor
capture measured 2560x1600 native pixels for a 1280x800-point window with the
960x540 default world target. The 90-frame original v1 authoring fixture checks
green `(77,225,201)` preview pixels after saving/reloading, exact prior engine/
texture preservation on failed Lua/import reload, aliases, newer external
conflict rejection and failed dirty-project-switch preservation. Fixtures are
private temporary files, removed afterward; no gameplay saves, audio playback,
private keys or devices were used. Bounded frame runs are not performance tests.

This editor checkpoint is a source/project inspector, not a full IDE, persistent
scene entity editor or hostile-file/process sandbox. The separately completed
static primitive modeller is described below. Android is unchanged by the
desktop-only editor; an APK/device run was not performed for this milestone.

## Completed static authoring and separate device-validation gate

- [ ] Perform the separate consented Android device-validation track below,
  including the third launcher project and imported PNG/GLB visual output.
- [x] Build an original bounded static primitive/transform modeller exporting
  only supported opaque unlit GLB. Strict editable `.nova-model` source is
  separate from exported geometry; the real desktop editor shell supports
  create/select/delete, transform/color/sides, guarded save/reopen/overwrite
  decisions and actual native import/preflight inspection. Shared GPU previews
  stage/cache only on edits, retain old live resources on failure and clean
  private fixtures. Headless model/document tests and opt-in native widget,
  exact RGB/transform/cache and real-shell captures pass. See README workflow.

### Completed system-style authoring UI

- [x] Smooth macOS system interface typography and Menlo source text instead of
  the editor/modeller's bitmap font; framebuffer-density rasterization with a
  bounded, cleaned native GPU cache. Apple fonts are resolved from the OS, not
  copied into the repository or distributions.
- [x] GameStudio-inspired neutral light/dark panels, rounded controls, blue
  focus/selection and native window chrome, retaining the existing native UI
  layout and runtime preview. No WebView, GameStudio dependency or changes to
  its source/assets/save data.
- [x] Native glyph antialiasing and upright orientation evidence, cache eviction
  exercise, and existing text/edit/save/reload/conflict/modeller GPU workflows.
  Gameplay bitmap text, original scene output and sprite filtering stay separate.

### Completed beginner Objects and Rooms workflow

- [x] Native beginner workspace is the default, with one coherent 2D/3D
  appearance -> reusable object -> placed room instance -> Run model.
  New creates an exclusively named project directory and saved runnable starter;
  native resource/location browser, validated no-clobber PNG/static-GLB import
  and explicit appearance -> Create object using this bridge.
- [x] Strict separately authored nova-game v1 resources, stable object/room/
  instance references, names/transforms/camera and designated starting room.
  Explicit actual Create/Step/primary-press typed movement actions; no pretend
  collision/physics/rotation/audio library or full GameMaker compatibility.
- [x] Native room layouts: shared runtime 2D/3D presentation, separate labelled
  XZ floor-plan editing diagram for 3D, selection/movement/snap/nudge, typed
  properties, per-drag undo, bounded redo and explicit dependency-aware deletion.
- [x] Explicit Save/preflight/Run/Stop/Restart, preserving authoring room,
  selection/drafts and actual prior live resources on failure. Guarded single-file
  authored/Lua/manifest writes report partial outcomes honestly; generated edits
  are not overwritten/adopted, unknown source stays repairable in Advanced.
  Visual and Advanced drafts remain separate; no save-first switching/autosave.
- [x] Both-dimension headless parser/reference/behavior/conflict/no-clobber
  tests, injected per-file failures and hidden real-native action/framebuffer
  evidence, with original source/modeller/presentation/export regressions.
  Ordinary DEBUG Android launcher and complete sample/notices/native/signature
  inventory built/verified; no personal keys, device installation or performance
  claims. Device behavior remains unvalidated.
- [x] Substantive native UX follow-up: dedicated New/Open Project screens;
  local import/object/room forms; grouped resource tree and independent room
  outline; persistent room/palette when selecting objects; adjacent Select/
  Place/Grid tools; explicit Resource preview; contextual scrolling inspector
  with fixed Apply/Reset; compact project title/Save/Run/Stop/Restart header.
  Raw paths remain in setup/import/Advanced, not the ordinary room workspace.
  Native hit/typing/scroll tests cover both dimensions, minimum 1200x780 layout,
  high-DPI framebuffer output, expanded actual movement actions, and retained
  authoring state through Save/Open/Run/Stop. Captures are functional UX evidence,
  not performance measurements or Android device validation.

All 45 configured native CTests passed, including both real standalone generated
projects and the original editor/modeller/runtime/export regressions. The new
headless authoring/save-failure tests also passed ASan/UBSan; isolated toolchain
tests and the ordinary debug APK inventory/signature check passed.

This is bounded beginner authoring, not full GameMaker compatibility, a full IDE,
sprite painter, arbitrary mesh editor, physics engine or animated GLB pipeline.
The supported catalog and ownership/recovery boundaries are explicit in README.
Textured primitive authoring is not included in this completed slice.

### Subsequent modelling milestone (now completed above)

- [x] Approachable static character/prop/environment modelling, basic PNG
  textures and automatic primitive UV mapping, AFTER Objects and Rooms.
  Preserve the shared room/object model and existing original primitive source/
  supported GLB importer. Delivered in the separate follow-up described above;
  no placeholder texture controls or second renderer were added.

### Recommended fresh-session kickoff

> Read AGENTS.md, TODO.md and README.md in the assigned NovaStudio worktree.
> The native beginner object/room workflow for both dimensions, Advanced
> project/source editor and bounded named/static primitive modeller with opaque
> embedded PNG materials are implemented.
> Preserve generated ownership/no-clobber/partial-save contracts, real
> document/widgets, inspection v2 and shared
> presentation/preflight seams, direct scenes, old examples and strict static/
> unlit imports. Broader authoring/materials/animated GLB require a separate
> approved scope. Device execution
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

- [x] Bounded native desktop project browser/source editor and saved/live scene/
  asset inspector; see completed editor slice above. Full IDE features are deferred.
- [x] Original simplified low-poly modeller: bounded box/pyramid/cylinder,
  static transforms and opaque unlit RGB, with separate stable-ID source and
  validated GLB export integrated into the native desktop authoring shell.
  Arbitrary imported meshes are not reconstructed as authored primitives.
  Skeletal authoring/animation, vertex/face modelling and broader import remain
  deferred; this is not a Blender replacement or Android device evidence.
- [x] Separate native-resolution HUD and bounded configurable world rendering;
  see completed presentation slice above and README for the reusable host contract.
- [x] Bounded shared runtime services: explicit manifest v2 identity/PCM WAV,
  native cached playback, project-owned atomic save v1, deterministic timers,
  timed sprite frames and numeric transform tweens. V1/static GLB remain unchanged;
  headless preflight validates effects without audio or live save reads/writes.
  Default deterministic service regressions and opt-in native audio lifetime
  tests cover errors, budgets, reload and isolated persistence.
  The self-contained `examples/services/` v2 demo includes original reproducible
  CC0 sprites/PCM chime, timer/tween/frame playback, edge-triggered audio/saves and
  separate `nova.export.json` metadata. Automated demo checks are headless with
  isolated saves and recorded (not played) audio effects.
- [ ] Skeletal/animated-GLB playback/import, audio mixing/streaming, automatic
  lifecycle saves and filesystem module loader: deferred, not delivered here.
- [x] Local per-game standalone native APK export with separate nova-export v1
  metadata/provenance, native headless validation and exact-file staging.
  Ordinary launcher/debug and desktop builds remain.
- [x] Personal non-debug release-signing tooling: reusable external keystore,
  interactive apksigner prompts, certificate pin, stable IDs/increasing codes,
  and structural APK checks. Actual user's key creation/unlock remains local.
- [ ] Personal release signing: deferred at the user's request; use debug
  signing for now. Later, create or reuse the user's external signing keystore,
  store its identity/password in macOS Keychain, back up the encrypted keystore
  to iCloud Drive with a separately recoverable password and independent backup,
  and interactively sign/verify a standalone release with its certificate pin.
  Login Keychain import does not automatically sync the signing identity to
  iCloud Keychain. Preserve the same certificate/application ID and increase
  versionCode for updates; never treat a debug certificate as a personal release.
- [x] MIT license for Nova-authored source, packaged with distributions while
  preserving original upstream notices and CC0 sample artwork provenance.
  Export/signing milestone verification: eight default CTests (including 19
  isolated/native exporter tests), isolated toolchain tests, desktop build,
  real per-game unsigned release build and ordinary launcher debug rebuild
  passed. Real apksigner rejects the existing debug certificate as a release.
  No personal signing key was created/unlocked and no device was modified.
- [ ] Production/store distribution and broader platform validation. No public
  publishing or actual personal-key/device installation has been performed.

No Glow compatibility is implemented or promised. Mac OpenGL is deprecated;
future backend work must preserve the native desktop/Android path.

## Copilot folder/worktree coordination

The original app session was folder-backed. Adding local `.git` does not itself
convert that registration, but these coordinated milestones now use confirmed
isolated NovaStudio repository worktrees. Use the assigned worktree, not the main
checkout or GameStudio. Confirm registration and checkout isolation again before
parallel writers in a fresh project/session. No remote is required for local work.
