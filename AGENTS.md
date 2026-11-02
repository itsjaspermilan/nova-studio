# Nova Studio agent guidance

Read `TODO.md` for current milestones and the bounded next assignment, then
`README.md` for behavior, build/setup details and limitations. Inspect source
before changing contracts; roadmap entries are not implemented features.

## Active product direction

The user has approved implementing the researched studio, not merely polishing
the current launcher or preserving every earlier editor decision. Follow the
active roadmap at the top of `TODO.md` and the retained
`docs/ux/nova-studio-ux-assessment.md` / workspace study. That report's original
current-state evidence describes `918cefa`; the newer integrated implementation
already supplies assets, bounded editing/modelling and runtime services.

The approved desktop editor technology is Qt 6/C++. Retain the C11/Lua runtime
and Android game outputs; Qt must not become an Android runtime dependency.
Prove actual native GPU hosting and desktop input/accessibility facilities
before relying on the new UI bridge.

The Qt workspace must use a deliberate, polished visual system, not an unstyled
stock-widget demo. Follow the retained study's hierarchy with system typography,
original crisp icons, consistent spacing and clear interaction states, preserving
keyboard, IME and accessibility semantics. Review actual native application
captures at normal and minimum sizes; concept images are not implementation
evidence. Use OS-native Open/Save/folder pickers wherever available. Keep import
options separate when necessary to retain the native picker. Do not globally
force nonnative dialogs to make automation pass; isolate test configuration and
distinguish native-panel display/cancel coverage from OS-owned file selection.

The user approved additional essential, license-compatible open-source
dependencies for the agreed studio implementation so unattended work can
continue. Declare dependencies or establish an actual missing-dependency
failure before installation; record package versions, purpose and changes.
Coordinate host installations through the parent to avoid competing installers.
This does not authorize Android/Xcode SDK changes, security-setting changes,
purchases, signing, device installation or public publishing. Existing
microphone/device-consent boundaries and security-warning stops still apply.

New gameplay authoring is Lua-first with visual scene/asset/music tools.
Preserve legacy typed-action projects, but do not expand their forms as the new
primary logic interface or overwrite user-authored scripts. Existing custom
controls, limited undo and partial multi-file save semantics may be replaced
to meet the researched input/accessibility/work-safety requirements. Keep
working native contracts and explicit compatibility/migration behavior.

Final integrated acceptance includes a playable 3D rally racer built through
Nova's actual scene/model/sprite/Lua/audio tools, then saved, reopened, run and
exported. The earlier externally authored 2D assessment game is not that proof.

## Architecture and edit surfaces

- Shared C11 engine/runtime with Lua 5.4.8 and raylib 5.5. Native GPU rendering
  uses macOS GLFW/Cocoa/OpenGL and Android NativeActivity/EGL/OpenGL ES 2.
  Do not introduce WebView gameplay or streamed/software preview rendering.
- `engine/nova.c` implements the Lua API, validation/budgets and native overlap;
  `engine/nova.h` defines frame/draw/input/viewport/service-effect contracts without raylib types.
  Draw commands include rectangles, text, generated cubes and validated
  sprite/static-model handles; audio handles produce service effects.
  `engine/project.{c,h}` preserves v1 and owns
  explicit v2 identity/audio declarations plus opt-in v3 authored scenes.
  `engine/scene.{c,h}` owns strict nova-scene v1/v2, stable object IDs and UTF-8
  display names. v1 means zero rotation; v2 adds bounded XYZ degrees after size.
  `engine/transform.{c,h}` centralizes right-handed scale -> X/Y/Z -> translation,
  inverse/bounds/ray math, matching primitive modelling. Cube pivots are centres;
  models use asset origins. Finite Lua rotations normalize to [-180,180), while
  authored values stay within +/-360. Optional draw angles are complete trailing
  triples, never shifted colour arguments. Scene objects and Lua share the
  512-command frame budget. `nova.object`/`position`/`set_position` and
  `rotation`/`set_rotation` validate opaque handle generation and lifetime;
  runtime mutations never edit authored files or upgrade scene versions. Per-object lifecycle
  and automatic conversion of v1/v2/generated projects are not implemented.
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
  Opaque unlit base-colour PNG GLBs use finite float TEXCOORD_0, explicit nearest/
  clamp samplers, <=16 embedded PNGs (<=1 MiB/1024 per dimension each),
  <=4,194,304 model pixels and the shared <=16,777,216 project sprite/model
  pixel budget.
  CPU images and GPU textures are resource-owned once; materials/node aliases
  borrow cache entries. Keep CPU preflight context-free and partial upload cleanup.
  Declared path/type aliases share resources; failed staging unloads only candidates.
  Keep the documented import subset and reject unsupported features explicitly.
- `runtime/inspect.h` defines read-only inspection v2 and shared headless project
  preflight. Use real declaration-order/alias metadata and `NovaFrame`, not invented
  scene entities. Preserve documented borrowed-view lifetimes and transactional
  failed reload/validation behavior; headless preflight must not upload GPU data.
- `authoring/document.{c,h}` owns bounded manifest/Lua drafts and exact disk
  snapshots with contained atomic/conflict-guarded text/binary output.
  The separately named authored-source opener permits 65 MiB binary sources/
  recovery blobs; ordinary output remains 16 MiB and source text 256 KiB.
  Keep the same root/no-follow/no-clobber/conflict guarantees for every opener.
  `authoring/editor.c` and `widgets.{c,h}` implement the separate desktop-only
  source/project editor. Preserve explicit dirty/conflict decisions and use
  shared inspection/presentation/runtime for its real preview, not another renderer.
  Save is per file; whole-project runtime reload is transactional separately.
- `authoring/qt/` is the new desktop-only Scene/Code foundation, enabled with
  `NOVA_QT_STUDIO=ON`. Qt owns context/window/input/accessibility; the pinned
  raylib custom backend compiles the identical native import/presentation code.
  Never link its rcore and GLFW rcore into one process. One viewport owns the
  global renderer; restore Qt's nonzero FBO after world rendering. Disconnect
  outgoing signals and incoming application callbacks before late widget
  destruction can reach dead actions or derived members. Shared audio belongs
  to the application, not the viewport/context: close it only after resource
  owners are destroyed. Link `nova_audio_native` plus the selected Qt host and
  apply `nova_configure_raylib_audio` to that host; never pull ordinary
  `nova_assets`/GLFW raylib into the Qt graph.
  `ProjectDocument` owns scene/Lua/manifest, selection and unified core undo.
  Asset participants use a separate authoring-only index v1 and blob-backed
  journal/recovery v2; source/output snapshots, disk versions and publication
  state are explicit. Source-only saving retains stale generated output, not
  a successful fresh export. Host Run/export must check runtimeAssetsReady,
  and acknowledgments require the original component snapshot/session identity
  plus the exact participant/revision/digest; never reconstruct a process UUID.
  Real component embedding/undo routing follows separately. The journal is a
  recoverable multi-file commit, not filesystem atomicity. Interrupted journals
  block runtime/export; v2 checks exact before/absence and completed-write
  versions, while original v1 text records retain old/new-byte compatibility.
  Do not overwrite unresolved recovery or drop newer source/derived snapshots.
  Respect 65 MiB source, 16 MiB derived and 256 MiB active payload bounds, and
  520 MiB record / 1040 MiB blob-store limits. Never inline large binaries in
  JSON or stretch this bounded byte API into a recording/streaming format.
  Native production file panels must remain native; deterministic tests may
  inject a per-dialog configuration, never a production/app-wide nonnative flag.
  macOS native Qt CTests run under LLDB and check the debuggee's actual exit,
  including a negative-result runner regression. A locked desktop may expose
  windows without activating them; keep focus assertions and qualification gaps
  intact, without changing OS security settings.
  Keep system input/IME/accessibility, scoped styling and original vector icons.
  Scene Move uses world axes, Rotate uses Euler-parameter rings, and Scale uses
  local axes, with one undo per changed gesture and full cancellation. The first
  authored rotation explicitly upgrades v1 to v2 in the same undo command; no-op
  fields/gestures must not upgrade or rewrite the draft. Editing camera/grid,
  framing/clip planes and navigation stay separate from the authored camera and
  Run input. Picking uses transformed local bounds, not triangle-exact geometry.
  Qt's GPU gizmo/system-text overlay uses the same framebuffer after rlgl;
  restore culling and 4-byte glyph upload alignment before starting its painter.
  Keep point/logical/framebuffer mappings consistent at high DPI. 2D retains
  its fixed, unrotated canvas; no second viewport or software game renderer.
  Scene edits do not rewrite scripts; Run saves/stages normal runtime services,
  while visual authoring uses nondispatching staging. The legacy editor remains
  available for its owned projects and primitive modelling.
- `authoring/game.{c,h}` owns strict nova-game v1 resources/objects/actions/
  rooms/stable instances and bounded undo. `game.nova-game` is authored source;
  `game.project` / `game.generated.lua` are exact verified generated ownership,
  never a reconstruction of hand-authored projects. Save is three guarded
  single-file writes with explicit partial outcomes, not a filesystem transaction.
  `authoring/game_ui.{c,h}` is the default native beginner workspace for BOTH
  dimensions, with a native import browser, appearance/object bridge, actual
  typed behavior actions, room selection/snap/per-drag undo and starting-room
  Run/Stop. Keep setup/local creation sheets separate from the room workspace,
  grouped resources separate from the current-room outline, and object selection
  in the room unless the explicit Resource preview tab is chosen. Inspector
  actions scroll independently with fixed Apply/Reset. Native UI tests must
  exercise actual form typing, hit targets and scrolling, not only backend
  action dispatch. Private previews use shared staging/presentation, retain prior live
  resources/frame on failure and clean their own fixtures. 3D floor plans are
  labelled editing diagrams, not a replacement gameplay renderer. Advanced and
  visual drafts are retained independently; unknown data/edited generated
  outputs must not be silently migrated or overwritten.
- `authoring/model.{c,h}` owns named stable-ID box/pyramid/cylinder parts and
  strict nova-model v2 texture references (v1 still reads losslessly with derived
  names). Export embeds opaque PNGs with automatic planar/cylindrical UVs into
  supported unlit GLB. `model_ui`/`model_view` reuse native staging, guard unapplied
  fields/source/GLB conflicts, and upload only on edits. Models + -> New model
  creates guarded no-clobber source/GLB files, then uses that same modeller.
  PNG copy, model source/GLB saves and game saves are separate persistent writes,
  with honest partial outcomes. Discard/undo never deletes imported files.
  Keep Parts / large central viewport / contextual Inspector and one primary
  Save. Source-only save/reopen/export paths and technical diagnostics belong
  under Advanced/Details. Named texture choices use actual cached thumbnails,
  explicit assignment and Colour only, never blind cycling/per-frame uploads.
  Apply/Reset stay fixed while Inspector properties scroll; deletion confirms
  that part undo is unavailable. Shared original vector action icons retain
  labels and delayed shortcut/disabled-reason tooltips. Numeric transform
  controls do not imply viewport gizmos. Native hit/typing/hover/scroll and
  minimum/large high-DPI captures are regression evidence, not novice studies.
- `authoring/style.{c,h}` owns authoring-only system typography and light/dark
  palette. macOS uses Core Text at physical framebuffer density, with a bounded
  GPU text cache and system interface/monospace fonts; never bundle Apple fonts.
  Preserve font-cache cleanup and source grid/selection metrics. Gameplay/HUD
  bitmap fonts and pixel-art filtering remain separate and unchanged.
- `runtime/saves.{c,h}` owns bounded save v1 atomic files in Nova-owned OS app-data.
  Identities/keys are lowercase hex of ASCII bytes to preserve case distinction.
  Never pass Lua paths or touch other applications' saves. Headless preflight
  uses deterministic missing-save reads and never dispatches audio/save effects.
- `audio/audio.{c,h}` owns shared C11 sample-clock DSP; `audio/wav.c` owns strict
  bounded WAV decoding and offline checked-sink output. See `docs/audio-core.md`
  for sample/score/renderer ownership, exact frame/loop/ramp semantics and signal
  quality bounds. Renderers are single-owner, independently cancellable, and
  allocate/log/lock nothing while rendering. Keep the existing device/legacy
  service ownership; no competing device or implicit sequencer migration.
  PCM24/float masters must not use raylib's PCM16-forcing WAV loader. Do not relax
  short-effect budgets or equate them with score/offline duration.
- `authoring/sound/` is an opt-in, embeddable Qt short-SFX component, not a host
  application or full Sound Studio. See `docs/sound-component.md` for sealed
  snapshot/open-revision provenance, strict binary source, named history and
  SourceOnly/PublishDerived acknowledgements. Preserve whole canonical originals
  (<=60s/16 MiB each, <=60s/32 MiB aggregate); >30s originals require explicit
  source-frame regions for the 30s composition. Workers own independent native
  objects; only explicit Play may ask the injected host for the existing Audition
  role. Join before transferring native reference ownership, poll receipts, and
  retain/hand off detached close-retry handles even on failed open. No direct
  file writes, global/device shutdown, alternate audio backend or implicit sound
  registration. The host supplies native pickers/journal/actions; pending fields
  block snapshots. Offscreen QWidget evidence is not native/input/audio approval.
- `audio/transport.{c,h}` supplies fixed-rate SPSC control/receipt queues,
  coalesced snapshots and control-side renderer retirement. Core status/cancel/
  reset remain render-owner operations; all reference mutations stay serialized
  on the control side. `runtime/audio_device.{c,h}` owns two independently
  controlled streams on the existing device, not another device or Qt backend.
  Link `nova_audio_native` with exactly one caller-selected raylib host and call
  `nova_configure_raylib_audio(target, source_dir)` for that source/target.
  Preserve callback-quiescent detach and device-before-mutex teardown, explicit
  errors/backpressure, and pending-candidate cleanup. The inherited mixer still
  locks and converts/clips output; no whole-callback realtime guarantee follows.
  Report rendered score position, configured formats/periods and observed callback
  size separately; never invent latency/xrun metrics. Comprehensive device loss/
  Android focus, recording/MIDI, sound documents and Sound UI remain.
- `audio/stream.{c,h}` owns original-rate disk WAV playback with a fixed 64 KiB PCM
  ring, <=96 KiB instance and configured 256 KiB reader stack (OS overhead separate).
  One worker owns PCM reads/decoding; callback work is bounded and generation-tagged.
  Keep pause-before-seek, exact exclusive loop bounds, explicit software starvation/
  late source faults and callback-detach -> worker-join -> descriptor/free ordering.
  Failed joins retain ownership for close retry. The native convenience API allows
  a score or file per role; the pure stream remains future mixer input, not a
  permanent multitrack restriction. Desktop focus policy is host-controlled.
  One-hour disk bounds do not relax old short-effect budgets. Manifest/Lua/
  packaged-Android streaming remains coordinated follow-up, not a new schema.
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
  `cmake/RaylibAudio.cmake` fingerprints pinned raudio.c before applying the
  checked lifecycle/allocation/evidence hook for either desktop host or Android.
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
- `tests/audio*_test.*` covers sample-clock timing, source/score loops, rate
  conversion, envelopes/ramps, band-limiting/filter evidence, headroom, native
  WAV/project round trips, offline failures/no-clobber, C++ linkage and allocation
  balance. Transport/device seams add concurrent SPSC transfer, full queues,
  fault handling and callback retirement; lifecycle tests compile actual patched
  functions with allocation/init failure injection. Device upload/lifetime checks
  remain explicitly opt-in; deterministic signals are not human listening,
  hardware, latency or comparative benchmarks.
  Disk fixtures verify complete 75-second/>16 MiB playback with fixed storage,
  exact one-hour limits, loop/seek/pause/fade boundaries, partial I/O/late faults
  and concurrent render/control/reader close with allocation/descriptor/thread balance.
- `tests/game_test.c` covers both-mode source/reference/behavior/generation/
  guarded reopen/conflict/import/no-clobber contracts. `game_failure_test.c`
  redirects only the save call in a separate test build to check honest partial
  writes/draft retention. `game_ui_test.c` exercises real native controls/action
  paths, both-dimensional rooms/per-drag undo/save/reopen/Run/Stop, exact native
  framebuffer pixels and actual retained engines/resources on staging failure.
  Test-local input functions never synthesize OS events into another app.

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

For the new desktop studio (Qt Base must already be installed with consent):

```sh
./scripts/with-toolchain.sh cmake -S . -B build -DNOVA_QT_STUDIO=ON \
  -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qtbase
./scripts/with-toolchain.sh cmake --build build -j 4
open "build/Nova Studio.app"
```

For potentially crashing native UI reproductions, use LLDB and verify the
debuggee's exit status, not merely LLDB's status. Do not mask failures or change
CrashReporter/security settings. Ordinary Qt test failures must return nonzero
with cleanup, not abort. Send Return as a key event, not a newline in
`QTest::keyClicks`; popup interactions target the popup that owns the input.

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

This is a native project/sample launcher and bounded desktop beginner object/
room editor for both 2D and 3D, with separate Advanced source/project editing and
original static primitive modelling, not a full IDE/mesh modeller. Manifest v1
and the bounded PNG/static GLB pipeline, native framebuffer HUD and bounded
world presets are implemented; skeletal animation, full runtime music/mixing integration
and Glow compatibility are not.
Timers/sprite frames/numeric tweens, PCM WAV and explicit project saves are bounded
native services, not automatic lifecycle persistence. Android package
verification passes, but device behavior remains unvalidated.
State these boundaries when reporting results; see TODO for actual prerequisites.
The bounded modelling/PNG milestone is implemented, not a full material/mesh editor.
Keep rigging, skeletal animation, detailed mesh/UV editing, PBR and texture painting
deferred. Texture tests must assert asymmetric orientation and mirrored/nonmirrored
UV/vertex correspondence through the final triangle, and allocation/free balance.
