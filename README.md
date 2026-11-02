# Nova Studio

A working **native Lua-first studio foundation for 2D and 3D**: a Qt 6 desktop application with Scene and Code workspaces, visual object transforms, PNG/static GLB import, guarded project saving/recovery and live native Run/Stop. The C11/Lua runtime, legacy Objects/Rooms editor, Advanced source editor and original static primitive modeller remain available. This is the first Qt authoring milestone, **not the complete five-workspace studio or a full IDE**. Everything lives here; GameStudio and Glow43 are unchanged and are not dependencies.

The provisional product name is Nova Studio. This foundation targets desktop authoring and standalone Android games, initially Retroid Pocket 6. It contains **no WebView, browser renderer, or screenshot-streaming gameplay**.

## Build and run on macOS

Requires the Apple command-line tools and CMake 3.22 or later. `.tool-versions` pins only Temurin JDK **17.0.21+9** for asdf. The helper selects the **Homebrew CMake CLI and Ninja 1.10+**, not an asdf-installed GUI app. Homebrew does not pin those formulae to exact project versions; the helper checks their supported minimum versions. Android's separate CMake **3.22.1** is pinned by the Gradle project and installed through Google's SDK manager.

For a reproducible installation, see **Easy toolchain setup** below. Once installed, prefix native commands with `./scripts/with-toolchain.sh` to select the project tools without changing your shell settings; for example `./scripts/with-toolchain.sh cmake -S . -B build`. The first native configure downloads raylib 5.5 and Lua 5.4.8 from upstream; SHA-256 hashes pin both archives. The native build itself does not install SDKs.

From your Nova Studio checkout:

```sh
./scripts/with-toolchain.sh cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug \
  -DNOVA_QT_STUDIO=ON -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qtbase
./scripts/with-toolchain.sh cmake --build build -j 4
./scripts/with-toolchain.sh ctest --test-dir build --output-on-failure
open "build/Nova Studio.app"
# Or launch directly with an existing manifest:
"build/Nova Studio.app/Contents/MacOS/Nova Studio" --project /path/to/nova.project
```

The optional desktop target `nova_studio_app` needs **Qt Base >=6.5**; macOS was
verified with Homebrew `qtbase` **6.12.0** at the prefix above. Configuration does
not install Qt. Obtain consent before new host installations. Omit the prefix
when Qt is already discoverable. `-DNOVA_QT_STUDIO=OFF` (the default) retains the
Qt-free C11 build; Android always uses that runtime and rejects the Qt option.

**`Nova Studio.app` is the new desktop authoring entry point.** `nova_editor`
is the retained compatibility editor, and `./build/nova_studio` is the native
sample launcher/runtime, not the editor. On other desktop hosts the Qt target
is `nova_studio_app`; Windows/Linux desktop behavior has not been qualified.
The [active studio roadmap](TODO.md#active-product-build-researched-lua-first-studio)
and [retained UX specification](docs/ux/nova-studio-ux-assessment.md) describe the
larger Lua-first studio now being implemented; their concept screens are not
implemented features.

The independent [editable mesh component](docs/mesh-authoring.md) adds real
polygon editing, undoable topology/material/UV operations, strict `.nova-mesh`
source and native-decoder-verified static GLB snapshots. Enable the optional
desktop `NOVA_MESH_AUTHORING` target with Qt Core; it does not replace the
existing modeller UI or yet provide the integrated Qt Model workspace.
It performs no file writes or rendering. Shared save/recovery, the single
native viewport and scene/runtime integration remain separate requirements.

The opt-in [Qt Sprite component](docs/sprite-component.md) adds an embeddable
layer/frame document, drawing canvas and styled workspace, with preserved
editable source and separate PNG/metadata snapshots. It is not another
standalone editor or an integrated project save/runtime-animation feature.
Its host must provide native pickers, guarded binary/multi-file persistence,
whole-project preflight and scene integration; the default runtime stays Qt-free.

The opt-in [Qt short-SFX Sound component](docs/sound-component.md)
(`NOVA_QT_SOUND=ON`) adds immutable editable sound documents, preserved canonical
WAV originals, source-frame waveform trim/fades/reverse, layered native-engine
instruments, editable presets, cancellable exports and a receipt-based audition
host seam. It fits inside the studio content area and performs no file writes or
automatic hardware activation. Compositions are bounded to 30 seconds; originals
retain the existing 60-second/16-MiB envelope and longer-than-composition sources
require an explicit region. This is not an integrated Sound tab, recorder,
arranger/piano roll, MIDI tool or full mixer; native pickers, project-journal
registration and final host/runtime integration remain separate stages.

All three authoring components can be built alongside the Qt application with
`-DNOVA_QT_SPRITE=ON -DNOVA_MESH_AUTHORING=ON -DNOVA_QT_SOUND=ON`. Enabling them
does not yet add Sprite/Model/Sound tabs. The mesh checks include a CPU-only
consumer linked to the Qt-selected runtime, keeping the ordinary GLFW renderer
out of that host.

In the sample launcher, click an example, press **1 / 2 / 3**, or use gamepad **A / B / X**. Move with **WASD, arrow keys, D-pad, or left stick**. In the 3D example, **Space / A** makes the model bounce; in the asset project it lifts the imported gem. **F1 / Start** returns to the launcher, **R** reloads the active script or whole project, and **Esc / Android Back** exits.

Edit the source examples with your preferred text editor, then rebuild to synchronize them into `build/examples`. Asset synchronization runs even when no C source changed. Alternatively, play a source script directly and use R after saving:

```sh
./build/nova_studio --scene "$PWD/examples/2d/main.lua"
./build/nova_studio --scene "$PWD/examples/mixed/main.lua"
./build/nova_studio --project "$PWD/examples/assets/nova.project"
./build/nova_studio --project "$PWD/examples/sprites/nova.project"
./build/nova_studio --project "$PWD/examples/static/nova.project"
```

The executables resolve bundled examples relative to their own directory, not
the shell's current directory. The Qt app uses `Contents/Resources/examples`.
For the C11 runtime/legacy editor, keep `nova_studio`, optional `nova_editor`,
`examples/`, and `licenses/` (including Nova's MIT LICENSE) together.
The Qt `.app` dynamically links the installed Qt frameworks: it is a
**development bundle, not a portable installer or signed/notarized release**.
Its Qt notices and LGPLv3/GPLv3 texts are in `Resources/licenses/qt-base`.
Core, Gui, Widgets, OpenGL and OpenGLWidgets are LGPLv3-capable Qt Base modules;
Qt Test is test-only. No GPL-only add-on was introduced. See
[`authoring/qt/NOTICE.txt`](authoring/qt/NOTICE.txt) before release packaging.

### Qt Scene and Code foundation

**New project** creates a fresh folder with a 2D sprite or 3D model starter,
an editable `main.lua`, a `start.nova-scene`, and an opt-in v3 `nova.project`.
Existing folders are never overwritten. **Open project** accepts v1/v2/v3
manifests without automatic conversion. Production Open, parent-folder,
import and separate-recovery-copy pickers use OS-native `QFileDialog` panels
where available; import validation/options do not replace the native picker.
Standard Qt controls retain Unicode/IME, selection/clipboard, focus and
accessibility interfaces. Original vector action icons, system typography,
light/dark palette adaptation and dockable/resizable panels are authoring-only.

Only **Scene** and **Code** are exposed. Sprite painting, a new mesh/model
workspace and Sound Studio are later milestones, not empty tabs. The existing
primitive modeller and typed-action projects stay in the compatibility editor,
available from File. A legacy generated `game.project`/`game.generated.lua`
is read-only here: its owning `.nova-game` source is not reconstructed or
silently replaced. Hand-authored v1/v2 Lua stays editable, with native initial
frame/asset inspection but no fabricated visual scene hierarchy.

In Scene, select an object in the outline or native viewport. Edit its UTF-8
display name, position, size/scale, 3D rotation, compatible appearance and primitive
colour in the Inspector; finishing a changed field commits an undoable edit. Stable IDs are
read-only. Add shapes, duplicate or delete objects, or import a supported PNG/
static GLB and **Add selected asset to scene**. Imported files are copied to
fresh contained paths immediately; **undo/discard removes registration, never
deletes the copied file**. Sprite/model tint, physics and per-object lifecycle
are not implied by these controls.

The labelled **Move / Rotate / Scale** tools have constant-screen-size,
colour-coded native viewport handles and numeric Inspector alternatives:

| Tool (key while the viewport owns input) | Gesture | Snap |
| --- | --- | --- |
| Move (W) | World-axis arrows; centre or object dragging moves on XZ in 3D, XY in 2D | Absolute grid, initially 0.25 world units in 3D / 16 logical pixels in 2D |
| Rotate (E) | 3D Euler-axis rings; edge-on handles hide rather than offering an unstable drag | Absolute degrees, initially 15 |
| Scale (R) | Local-axis handles; centre scales uniformly while preserving proportions | Percentage change from the gesture start, initially 10% |

Transforms use the same **right-handed, +Y-up, local scale -> X rotation ->
Y rotation -> Z rotation -> translation** convention as the primitive modeller.
Angles are degrees; cube pivots are their centres and GLB pivots are their asset
origins. Rotate rings follow the corresponding Euler parameter, not three
independent world axes. Picking intersects transformed local bounds (oriented
boxes), not triangle-exact mesh geometry. Plain transforms reuse GPU resources.
Each completed changed gesture is one undo command. Escape, focus loss,
deactivation or hiding the viewport cancels and restores the prior draft.
Selecting, an unchanged field commit, or returning a rotation gesture to its
original value does not upgrade the scene. Gameplay Lua is never regenerated.

**Orbit**, **Pan**, **Frame** and the **View** menu control a separate, disposable
3D editing camera. Alt-drag or right-drag orbits; Alt+Shift-drag or middle-drag
pans. The labelled Orbit/Pan tools also support left-drag and arrow keys.
Wheel or +/- zooms; F frames selection, Shift+F frames all, and Home restores
the authored game camera view. Framing uses transformed bounds and editor-only
clip distances; the unobtrusive ground grid/axis compass can be hidden.
Navigation never enters document undo or changes the game camera, and the
editing view survives Run/Stop. Scene settings explicitly edit the saved game
camera instead. Shortcuts belong to the viewport, not Lua/property text fields;
while running they cannot switch authoring tools or move the editing camera.
2D retains its unrotated, fixed logical 960x540 canvas and Move/Scale tools;
3D navigation and rotation are disabled there. There is still one native GPU
viewport and one shared game renderer, not a software editing renderer.

Code provides native text editing, Lua highlighting, `Ctrl+Space` API/project
reference completion, signatures, an offline reference, find, and debounced
line diagnostics. Syntax checking compiles without executing gameplay.
Double-click a line problem to navigate to it. This is not an LSP, debugger,
refactoring engine or automatic script rewrite. **Moving/renaming/duplicating/
deleting a visual object never regenerates the gameplay Lua**; deleting a
referenced ID yields a useful runtime error until the reference or deletion
is corrected. Studio's Unicode UI does not extend the game's bitmap HUD font.

**Run game / F5** coherently saves, requires current published asset outputs,
then stages the real saved project through the shared engine/assets/presentation.
A source-only save retains editable work but blocks Run until publication
succeeds; it never silently plays stale generated assets. The focused viewport
receives gameplay
keys; blur, hidden windows and modal dialogs pause simulation/services and
clear input. Escape releases game focus, not the application. **Stop /
Shift+F5** discards runtime changes and restores the authored scene. Failed
asset/scene/Lua staging retains the previous native resources/output and
labels the preview as retained, with Problems details. Use View -> Reload
native preview assets (F6) to explicitly reload external asset changes.
Authoring previews, including read-only projects, validate WAVs without opening
an audio device or uploading native sounds. Graphics still use the real GPU.
Audio upload belongs to explicit Run; Sound audition has its separate Play action.

#### Document ownership and recoverable saving

One project document owns manifest, scene, Lua, selection and a shared
256-command undo stack. Nearby text edits coalesce; transforms/import
registration are independent named commands. Selection alone is not a file
edit. Saved bytes, disk snapshots and disposable running engine state are
separate.

Save prechecks exact disk snapshots, records a guarded recovery snapshot and
commit journal, then writes **scene, Lua, manifest** with the existing contained
atomic **per-file** replacement. The journal is removed only after every file
is rechecked. This is a **recoverable multi-file commit, not filesystem-atomic
multi-file replacement**. A partial failure reports how many files were
written and keeps the journal and draft. Runtime/export preflight refuses a
project with a pending journal. Save/reopen can finish it only when each file
still matches the recorded old or new version; external edits are never
blindly overwritten. Same-session recovery preserves edits made after the
failed commit as a newer, unsaved draft.

A 600 ms debounced `.nova-studio-recovery` retains authoring snapshots, not
runtime gameplay state. On reopen, review its timestamp and saved-base/draft
details, then explicitly Restore, Discard or Keep for later. An older unresolved
recovery is not overwritten by new autosave. File -> Compare with disk shows
the saved base, draft and current file. Reopen or save a **new separate recovery
copy** when resolving a conflict; there is no automatic merge/force-overwrite
path. Closing dirty work requires Save, Keep recovery, Discard, or Cancel.
An interrupted persistent commit cannot be discarded as if no writes happened.
A project lock prevents simultaneous Qt writers; legacy/external editors do
not share that lock, so exact file guards still apply.

#### Asset source/output participation

`ProjectDocument` also supplies the persistence boundary for real asset
components. This is a **registration/storage API**, not new Sprite/Model/Sound tabs,
component codecs, or completed workspace/undo integration. It does not change
runtime manifest versions: PNG/GLB/WAV outputs use ordinary existing declarations,
and authoring associations live in `.nova-studio-assets` **version 1**.
Existing v1/v2 projects keep their versions and exact hand-authored Lua.
Legacy generated projects remain read-only.

The host freezes an actual component snapshot, then uses these interfaces on
the `ProjectDocument` owning thread:

| Interface | Contract |
| --- | --- |
| `StudioAssetSnapshot` | Stable host `id`/`kind`, component revision, bounded JSON association metadata, one binary source and a complete output list. Each `StudioAssetFile` carries a contained relative path, owned bytes and an exact expected disk version. PNG/GLB/WAV outputs also require their actual `runtimeId`/`runtimeType`; metadata sidecars have no runtime ID. |
| `readAssetFile(path, &bytes, &expected, &error)` | Reads a guarded existing file or captures absence, including when its parent directories do not exist yet. `expected` is an opaque existence/version token; never fabricate one or refresh it silently after a conflict. |
| `stageAssetSnapshot(snapshot, &error)` | Validates registration, budgets and versions, and deep-owns input strings/bytes, including Qt `fromRawData` buffers. It creates no project files/directories. Re-staging the same participant replaces its pending snapshot, not its persistent identity/source path/kind. |
| `assetSnapshots()` / `savedAssetSnapshots()` | Current pending values versus the last committed source/output associations. Ordinary core undo cannot unregister live participant bindings. Component history/inspector drafts remain the component's responsibility; there is no invented asset undo command. |
| `assetSnapshotDigest(snapshot)` | Lowercase SHA-256 of the deterministic compact snapshot descriptor, including revision, metadata, source/output hashes and publication mode, but excluding disk-version tokens. Use the normalized snapshot returned after staging. |
| `assetSnapshotSaved(id, revision, digest)` / `isAssetSnapshotSaved(...)` | Acknowledge only that exact committed snapshot, and reject acknowledgment as current when a newer snapshot is staged. Reentrant edits made by an acknowledgment receiver remain dirty and get their own recovery record. |
| `assetPublication(id)` | Reports whether the current source snapshot is saved, whether derived output is stale, its diagnostic, and the **last committed derived generation's** revision/exact-source SHA-256. A pending candidate is not reported as a published generation. |
| `runtimeAssetsReady(&error)` | Refuses pending/uncommitted or source-only/stale asset generations, interrupted commits and disk conflicts. This supplements, not replaces, ordinary Lua/scene/runtime preflight. |

Keep the **original component snapshot and session identity** until its exact
acknowledgment is processed. A persisted participant ID is not a replacement
for a component's process-local UUID; revisions may restart on reopen. In
particular, do not reconstruct a current Mesh UUID from the index to
acknowledge an older export. Finish/validate component inspector fields before
freezing any snapshot. Source codecs and export completeness belong to those
components; this layer does not infer a scene/model from a generated file.

Source and unbound metadata paths cannot overlap any declared runtime asset,
including normalized/case-equivalent aliases. A generated output may adopt an
existing runtime file only with its exact declared ID, type and path; a new ID
cannot take over another declaration's file, and a shared path with an unmanaged
alias is refused. Unrelated runtime aliases remain readable and unchanged.
Binding normalization preserves complete supported paths, including spaces.
These ownership checks apply during staging, index loading and v2 recovery;
source-only saving cannot bypass them. The native printable-ASCII relative-path
contract is unchanged; Unicode lookalikes are not an escape from containment.

`PublishDerived` requests a complete generated set and whole-project,
CPU-only native preflight in a private staging directory. This includes
untouched runtime assets, the authored scene, current Lua and its initial
update, without GPU upload, live audio or save effects. Failure keeps the
candidate source/output snapshots recoverable and leaves the previous
generated files/index unchanged. It never silently downgrades to source-only.

For a generated canonical WAV, set the output's `runtimeType` to
`NOVA_ASSET_AUDIO`, its contained `.wav` path and explicit `runtimeId`. The
manifest receives an ordinary `audio` declaration. Publication requires an
existing v2/v3 project; v1 receives an explicit diagnostic, never an implicit
upgrade. A v1 project can still save editable sound source using `SourceOnly`,
without an audio declaration. Metadata sidecars remain separately guarded
unbound files, not disguised WAV outputs.

WAV publication uses the existing native decoder and whole-project preflight:
canonical RIFF PCM8/PCM16/PCM24 or finite float32 within +/-16, mono/stereo,
8000..48000 Hz, at most 60 seconds per native sound, 120 seconds across unique
project sounds, 16 MiB per file and the shared 64 MiB runtime input budget.
Unsupported/compressed or extra-chunk WAVs are rejected before project outputs
change. No device is opened or playback/save
effect dispatched by preflight. The Sound component owns its narrower
**33 MiB editable-source / 30-second composition** contract and embeds retained
originals in that source; the persistence layer does not invent a sound codec
or widen native budgets. Invalid/oversized WAV publication never silently
replaces the previous WAV or converts the operation into a source-only save.

For unsupported/over-budget exports, explicitly stage `SourceOnly` with a
nonempty `derivedProblem` and no replacement outputs. This saves the editable
source and retains the **last committed generated set and bindings**, labeling
them stale with their generating source digest. With no previous export, it
creates no runtime outputs/declarations. Source-only saving does not require
Lua to run successfully. The host must block an apparent current-source
Run/export, or explicitly offer the last published output; it must not label a
source-only acknowledgment as a fresh export. Removing an output from a later
complete publication removes its association/declaration, **not the old file**.
Retired files are subsequently independent of this document's disk guards.

Limits are binary MiB/KiB and checked without truncation:

| Boundary | Limit |
| --- | --- |
| Authored source file | 65 MiB (68,157,440 bytes) |
| Each derived file, including runtime PNG/GLB/WAV | 16 MiB; existing native import/pixel/audio/asset-count limits still apply |
| Active source + output payloads | 256 MiB across at most 16 participants and 128 files |
| Association metadata | 64 KiB per participant; 1 MiB complete index |
| Journal/recovery metadata | 2 MiB |
| One record's combined before/after payloads | 520 MiB, including retained retired files/core documents |
| Private content-addressed blob store | 1040 MiB; only verified, unreferenced owned blobs are cleaned up |

The current Sprite envelope is a 65 MiB source, up to 32 PNGs totaling 65 MiB,
and 64 KiB export metadata: **130 MiB + 64 KiB / 34 files**. Its exact maximal
serialized source is 67,121,780 bytes. Mesh needs at most 64 MiB source plus
one 16 MiB GLB. Sound's 33 MiB source and up-to-16 MiB WAV plus metadata fit the
same bounds. The budgets accommodate a complete component, both generations
and recovery overhead. Aggregate project and union-of-old/new-file
limits can still reject a larger transaction before project-file mutation.
These are bounded in-memory byte snapshots, **not a streamed recording API**;
future large audio sources need a deliberate file-backed participation design.
The separate C `nova_document_open_authored_source` opener reuses the same
guarded implementation; `nova_document_open_output` remains capped at 16 MiB
and text editing at 256 KiB.

With registered assets, recovery/commit records use **version 2**: bounded
JSON descriptors reference immutable SHA-256 blobs in
`.nova-studio-snapshots`, rather than base64-expanding binary source data.
Source files, complete derived sets, association index, scene, Lua and
manifest participate together. Exact root/file versions and expected absence
are recorded; symlinks, hardlinks, reserved/escaping paths and case-folded or
Unicode-normalized path aliases are refused. Each file is still committed
atomically **on its own**, with a durable attempted-write marker and completed
version receipt. A crash between replacement and its receipt may recognize
the exact intended after-bytes, but never overwrite that file. An unattempted
absent target that appears externally is a conflict even if its bytes match.
The journal remains the runtime/export barrier until the complete set is
verified; this is not filesystem-wide atomicity.

Recovery checks all required blobs, including a newer recovery's source/output
set, and disk guards before project writes. Its recovery metadata guard is held
through commit/rebasing; external replacements are not silently adopted.
Finishing an older commit rebases newer recovery onto its confirmed versions,
preserving the newer source and matching derived snapshots across both
same-session recovery and restart. Missing/tampered blobs, malformed metadata,
duplicate JSON keys, external edits and interrupted cleanup are explicit
failures, not overwritten successes. Unknown or empty existing recovery records
require an explicit review/discard decision. Original **version-1 three-text-file
records remain supported explicitly**, with their original old/new-byte recovery
contract. Binary comparison/recovery views show lengths and hashes rather than
dumping binary data into text controls.

A separate version-2 recovery copy consists of the chosen new JSON file
**and its adjacent, uniquely named `.nova-studio-copy-...` blob directory**.
Keep/copy both; it has no dependency on the live project's cleanup. Existing
copy filenames are never overwritten. These are recovery snapshots, not a
permanent revision-history archive or an automatic merge/import facility.

#### Opt-in manifest v3 and nova-scene v1/v2

v1/v2 manifests and legacy generated ownership are unchanged. v3 adds one
required contained `.nova-scene` path to the v2 identity/audio declarations:

```text
nova-project 3
identity my-game
entry main.lua
scene start.nova-scene
```

```text
nova-scene 1
mode 3d
background 18 24 41
camera 7 6 9 0 0 0 50
object player cube - 0 0 0 1 1 1 77 225 201 Player
```

Object fields are stable ID, `rectangle`/`cube`/`sprite`/`model`, asset ID (or
`-` for a primitive), XYZ position, XYZ size/scale, RGB, then a UTF-8 display
name in **scene v1**. New projects and existing v1 files keep this zero-rotation
format. The first deliberate nonzero authored 3D rotation upgrades the scene
to **v2**, as labelled in the tools/Inspector; that same undo command restores
the exact preceding v1 draft. Merely focusing/committing an unchanged field does
not upgrade it. Resetting a v2 rotation to zero does not silently downgrade.
Older Nova builds that only understand scene v1 reject v2 rather than dropping
orientation. Manifest v3 and the project journal format are unchanged.

**Scene v2** adds mandatory `rx ry rz` between XYZ size/scale and RGB on every
object record, including zero triples for 2D objects:

```text
nova-scene 2
mode 3d
background 18 24 41
camera 7 6 9 0 0 0 50
object player cube - 0 0 0 2 1 4 0 45 0 77 225 201 Player
```

Scene bounds: 64 KiB, 128 objects, existing 1..63-character ASCII IDs,
1..127 UTF-8-byte names without ASCII controls, positions +/-10000, sizes .01..1000.
Authored rotation angles must be finite and within +/-360; partial triples
and nonzero v1 rotations are invalid. 2D objects require Z=0/depth=1 and zero
rotation; visual types must match 2D/3D/mixed mode.
Asset types/references are checked, and asset RGB must be white because
sprite/model tint is unsupported. Camera bounds/FOV are validated. Unknown
versions/directives, duplicates, malformed UTF-8 and nonfinite numbers fail
without replacing the prior document.

```lua
local player = nova.object("player")
function update(dt, input)
    local x, y, z = nova.position(player)
    nova.set_position(player, x + input.horizontal * 3 * dt, y,
                      z + input.vertical * 3 * dt)
end
```

Opaque object handles validate type, generation and lifetime. Lua changes the
engine's disposable scene copy, never the authoring draft. The scene's mode
cannot be changed by Lua. Static scene visuals follow behavior updates and are
prepended below Lua overlays, sharing the existing **512-command** frame budget
and failure/effect-discard behavior. The API deliberately has no per-object
Create/Step/Destroy lifecycle. Export preflight includes the scene file in its
required inventory; Qt is not a game-runtime dependency.

For 3D objects, `nova.rotation(object)` returns XYZ Euler degrees and
`nova.set_rotation(object, rx, ry, rz)` changes the runtime orientation.
**Finite runtime angles normalize to [-180, 180)** before conversion to the
native float representation: 180 becomes -180, and complete turns become 0.
Continuous steering may therefore accumulate beyond 360 without stopping a
scene. NaN/infinity, partial triples, wrong handles and 2D setters fail explicitly.
This works with both scene versions, without changing saved bytes or upgrading
v1 at runtime; Stop/reload restores the authored orientation. For example:

```lua
local car = nova.object("player")
local rx, yaw, rz = nova.rotation(car)
function update(dt, input)
    yaw = yaw + input.horizontal * 90 * dt
    nova.set_rotation(car, rx, yaw, rz)
end
```

#### Native bridge and validation boundaries

`QOpenGLWidget` owns the native context/window/input. A small backend compiled
with the hash-pinned raylib 5.5 sources lets the **same C renderer, asset
decoders and presentation** draw into Qt's actual, resize-dependent GPU FBO.
The world target is bounded; HUD composition uses physical framebuffer pixels.
There is no hidden GLFW window, private Qt API, WebView, CPU readback display
or second scene renderer. Raylib globals currently permit one context-owned
viewport per process. Editor gizmos/system-text chrome draw through Qt's
OpenGL paint device into that same FBO after native drawing, with vertex-array,
culling and pixel-upload alignment ownership kept separate. Viewport destruction disconnects outgoing signals and
application-state callbacks before late widget teardown can reach dead actions
or derived members; Qt and ordinary GLFW raylib builds are not linked
into the same process. Both renderer hosts use the same checked audio hooks,
with `nova_audio_native` linked only to the selected host. Shared audio belongs
to the application, not the graphics context: viewport teardown releases its
own scene resources without closing an independent audition stream. Application
shutdown closes audio after the windows and their resource owners are destroyed.

With an active logged-in desktop:

```sh
./scripts/with-toolchain.sh cmake -S . -B build -DNOVA_QT_STUDIO=ON \
  -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qtbase -DNOVA_GPU_TESTS=ON
./scripts/with-toolchain.sh cmake --build build -j 4
./scripts/with-toolchain.sh ctest --test-dir build --output-on-failure -R '^nova_(scene|qt_.*)$'
```

On macOS, the native Qt CTests, including optional Sprite controls, use the
installed LLDB to capture a failing debuggee's backtrace without changing
CrashReporter or OS security settings.
They require the test process itself to exit zero; LLDB's status alone is not
success. A device-free runner regression deliberately returns a QtTest failure
and checks that it is rejected. Native focus checks require an unlocked desktop;
exposed windows on a locked desktop do not qualify as active-window coverage.

Coverage includes real native 2D/3D pixels/input, Unicode input-method events,
clipboard preservation, accessibility text interfaces, docking/resizing,
actual New/typed transform/Code/import/undo/Save/Open/Run/Stop controls,
partial-save recovery, external edits and retained failed previews.
Workspace file-selection tests inject a **per-dialog test-only** standard
Qt widget dialog; production retains native panels. Separate native-panel
display/cancel coverage is not a claim that automated Qt events exercised
OS-owned selection controls or a human IME/VoiceOver workflow.
Captures are `build/qt-studio-{2d,3d}.png`,
`build/qt-studio-{2d,3d}-min.png` (1100x740 logical), and
`build/qt-studio-code-{2d,3d}.png`.
The orientation follow-up adds headless `nova_scene`, `nova_qt_documents` and
`nova_qt_scene_tools` contracts plus native `sceneTransformsAndNavigation` /
`flatSceneTools` widget cases and rotated cube/GLB pixel checks in the bridge
suite. Coverage includes explicit v1/v2 undo/recovery/reopen, unchanged-field
precision, one-command gestures, cancellation, editor/game-camera separation,
large-scene framing and hit-coordinate/gizmo-pixel agreement at native density.
Its actual native captures are `build/qt-scene-tools.png`,
`build/qt-scene-tools-min.png`, `build/qt-scene-rotate.png`,
`build/qt-scene-tools-2d.png` and `build/qt-rotated-native-model.png`.
These focused exposed-window cases can run under LLDB on a locked desktop;
they do not replace the original unlocked-window focus assertions.
These are regression evidence, not novice, performance or Android-device
validation. The larger studio's requested final acceptance exercise is a
playable **3D rally racer** using every delivered authoring component, including
the future Sprite/Model/Sound workspaces; that exercise is not completed here.

### Legacy native desktop project editor

```sh
./build/nova_editor
./build/nova_editor --browse "$PWD/examples"
./build/nova_editor --game "/path/to/MyGame/game.nova-game"
./build/nova_editor --advanced
./build/nova_editor --project "$PWD/examples/assets/nova.project"
```

`nova_editor` is a separate desktop-only raylib executable. The ordinary
`nova_studio` launcher, direct scenes, Android runtime and standalone startup
are unchanged. It opens **Objects and Rooms** by default. `--project` opens
existing hand-authored projects directly in **Advanced**; they are not converted.

#### Beginner workflow: appearance -> object -> room -> Run

The dedicated **New Project** screen has local project **Name**, **2D / 3D** and
**Location** controls plus an existing-folder browser. Choose **Create project**,
or switch to **Open Project**, choose `game.nova-game` and explicitly **Open project**.
The compact **Project...** menu returns to these screens; **Cancel** retains the
current project and drafts. Setup fields never occupy the room toolbar.
Creation exclusively creates a new child directory; an existing destination
is refused. A saved, runnable
starting room opens immediately with an original turquoise sprite or original
untextured pyramid and a player object controlled by WASD/arrows. No manifest
or Lua editing is needed. The two modes use the same resource/object/room model.
The 3D starter retains its original `.nova-model` primitive source for the
existing static modeller; arbitrary imported GLB is not reconstructed as primitives.

The left **Resources** panel groups **Sprites**, **Models**, **Objects** and
**Rooms**. Each group's **+** opens its own local creation/import form; group
headings collapse and the panel scrolls. A separate **Room instances** outline
lists only instances in the current room and scrolls independently.
The Sprites **+** opens a PNG browser with its own **Name** and type controls.
**Models + -> New model** creates independently editable source and a supported
GLB in fresh stable-ID destinations, then opens the original native modeller.
**Import existing GLB instead...** opens the static-GLB browser.
Navigate with **Up / Browse**, choose a file, then
explicitly **Import appearance**. Selection/navigation never saves. Import validates
through the shared decoder and guardedly copies into a fresh stable-ID filename;
existing destinations are refused. It writes that asset copy, not the game
document. Undo/deletion retain imported files rather than silently deleting
potentially useful data. PNG painting is not integrated into this legacy
workspace; the separate Qt component above supplies its authoring foundation.
Animated GLB is not implemented.

The modeller has **Parts** on the left, a large central **Model view**, and a
contextual **Inspector** on the right, matching the room workspace's hierarchy.
Add a **Box**, **Pyramid** or **Cylinder**, name it, then **Apply** the labelled
XYZ position/rotation/scale and RGB colour fields. **Reset** keeps the last
applied values. The Inspector scrolls independently; Apply/Reset stay fixed.
**Import texture...** copies an opaque PNG into a fresh contained project file
and assigns it to the selected part, initially with white RGB tint.
**Choose texture...** lists named imported images with real cached thumbnails,
an explicit selected choice and **Colour only**; it never blindly cycles through
materials. Parts can share one image. The real model preview shows the assignment;
Colour multiplies the texture. **Save** (also Cmd/Ctrl-S) is the one primary model
save action. It prechecks source/GLB snapshots, saves editable parts, then asks
before replacing the game model. These are separate guarded
writes, not one transaction; cancellation/failure after source save reports
**1 of 2 files written**. PNG import itself already wrote a separate file.
**Advanced...** holds source-only saving, reopen, separate GLB export and file/
geometry diagnostics. **Details** shows full errors without competing with normal
editing. GLB is the portable 3D file used by the game; users do not need to
choose its path in the beginner workflow.
**Return to project -> Create object using this... -> Place -> Run** needs no
GLB-path or manifest editing. Save the game separately to persist its resource/
object/room references. Build play areas by placing environment-piece objects
in rooms rather than forcing the whole level into a single model.

Select the appearance in the left resource tree and choose **Create object using
this...**. The local **Create Object** form suggests a unique name and lets you
choose its appearance. Its **Name** names the new reusable object; the inspector
Name field renames the selected resource without changing its stable ID or references.
The right panel is a real bounded behavior editor, not an editable Lua template:

| Event | Supported typed action | Meaning |
|---|---|---|
| Create | Set position | Optional absolute initial XYZ, overriding placed position on Run |
| Step | Move with controls | Horizontal/vertical input times speed: XY for sprites, XZ for models |
| Step | Constant movement | XYZ units per second, added on every simulation tick |
| Primary press | Move by offset | Typed XYZ displacement once per Space/action rising edge |

Toggle each supported action explicitly and **Apply** to commit typed
numbers to the draft; **Reset** discards only those unapplied fields. The
contextual **Inspector** follows the resource/object/room/instance selection,
groups appearance, transform and events, and scrolls expanded actions while
keeping Apply/Reset visible.
2D has no editable Z/depth; 3D uses model translation and uniform scale, with
real room camera/look-at/FOV properties. There are no placeholder collision,
physics, rotation, sound, sprite animation or full GameMaker compatibility actions.
Existing Lua audio/save/timer APIs remain available to Advanced projects.

Select a **Room** in the tree. Selecting an object sets the placement palette
and its inspector **without leaving the room**. Room tools are immediately
above the canvas: **Place** repeats click-to-place; **Select** selects and drags
one placed instance. **Grid** is on by
default. The 2D layout is the actual shared native preview; the 3D layout has a
shared native perspective preview plus a labelled XZ floor-plan diagram
(-10..10), with Y height in instance properties. The diagram is not a second
gameplay renderer. Arrow keys nudge a selected instance by one snap step when
no text field owns focus. Each completed drag/property edit is one undo step;
Escape/blur cancels an in-progress drag. **Undo / Redo** retains the last 16
authored changes, not filesystem writes. **Delete selected...** requires an
explicit decision. Used appearances/objects, occupied rooms and the starting
room cannot be deleted until dependencies are removed/reassigned. Remaining
IDs and references are preserved; no guessed Lua rename rewriting occurs.

The **Rooms +** form has its own **Name** and **2D / 3D** choice; it never
converts existing room contents. **Room setup** selects the current room's
inspector; the separate outline selects placed instances. **Resource**
is an explicit tab for inspecting an appearance/object; **Room** returns to the
same layout. Room instances have stable IDs, object references, names, position
and scale. **Set as starting room** chooses
what the game runs, independently of which room is currently being edited.
**Run** explicitly saves/preflights and stages that whole generated project in
the same native engine/presentation pipeline used by desktop and Android.
**Stop / Restart** are explicit; Stop restores authoring with room, selection,
properties and drafts retained. Only the clicked/focused game preview consumes
gameplay keys; blur, minimization and modal decisions suspend simulation/services
and clear preview keyboard focus. Deterministic frame runs are not performance
or device-validation claims.

#### Authored source, generated ownership and safe saving

`game.nova-game` is strict **nova-game v1** authored data: resources (32),
reusable objects (32), rooms (8), instances (128), global stable IDs and the
designated start. Names are unique within each category and use 1..31 ASCII
letters/digits/underscore. Positions are bounded to +/-10000, velocities/offsets
to +/-1000, speed to 0..1000, object size to 0.01..1000 and instance scale to
0.01..100 (combined size <=1000). Snap is 0.01..128. Parsing rejects unknown
versions/directives, invalid references, mode/appearance mismatches, duplicate
IDs/names and nonfinite values; failed open preserves the current draft.
The source is bounded to 64 KiB and has a separate in-memory undo/context state.
IDs are not reused after undo/deletion; undoing creation can leave the next-ID
counter dirty even when the visible resource has been removed.

`game.project` and `game.generated.lua` are explicitly generated and owned.
They are ordinary runtime v1 manifest/Lua output; run them with
`nova_studio --project /path/to/MyGame/game.project` or use existing standalone
export tooling with this manifest. Visual reopen verifies both generated files
against generation of the saved authored source. **Edited/missing generated
outputs block visual Save/Run** rather than clobbering them or silently adopting
hand-authored behavior. Keep an independent copy for Advanced customization.
Malformed/future `.nova-game` source opens in Advanced for text repair; it is
never partially parsed and reconstructed by visual Save.

**Save** writes authored source, generated Lua, then generated manifest, using
three separate `NovaDocument` exact-snapshot guarded saves. It is **not an atomic
multi-file transaction**. All generated disk snapshots are checked before any
write; a source conflict offers the full exact observed text and explicit
overwrite consent for that version only. Newer edits invalidate consent.
Partial writes report the number of files written; pending generated drafts
remain dirty, and Run aborts. Retry in the same session after fixing the cause.
If a partial save is closed before retry, inconsistent outputs remain blocked
on reopen and require explicit Advanced repair/preservation, not an automatic
overwrite. If all files were saved but preflight fails, that outcome is reported
separately. Failed save/import/runtime replacement keeps authored drafts and
the previous live engine/resources; failed private preview staging shows the
retained frame with an explicit failure label, not a successful current preview.
Creation failures report the incomplete new directory and keep the previous
project; they do not pretend to have rolled back multiple files.

**Project... -> Advanced source editor** switches to the original manifest/Lua
browser/editor without discarding visual drafts or editor context; **Objects / Rooms** returns without
discarding Advanced drafts. Reopen visual source explicitly to adopt saved
source repairs, with a dirty-discard decision. Saving Advanced generated-file
edits does not authorize visual overwrites. Closing either workspace requires
an explicit discard decision for outstanding drafts. There is no autosave on
view/project switching.

Focused evidence uses isolated private fixtures and native action paths, never
OS keyboard/mouse injection into another editor:

```sh
./scripts/with-toolchain.sh ctest --test-dir build \
  -R 'nova_game_authoring|nova_game_save_failures|nova_gpu_objects_rooms' --output-on-failure
```

The native workflow test exercises both creation/import pickers, the
appearance/object bridge and behavior toggle, room placement, drag-level undo,
typed edits, save/reopen, designated-start Run/Stop/Restart and exact native
framebuffer colors. Failed preflight/staging retains real prior engines/GPU
resources. Both generated projects also reopen in the real editor executable
and run/capture through the ordinary runtime executable. All 50 configured
desktop CTests passed; focused headless and native model/editor/workflow consumers
also passed AddressSanitizer/UndefinedBehaviorSanitizer. The ordinary debug Android launcher was rebuilt and its complete
sample/notices/native/signature inventory verified; no device was installed
or validated and personal release signing remains deferred.

#### Advanced source/project editor

The Advanced browser lists real directories, `.project` files and `game.nova-game`;
use **Up**, **List directory**, wheel scrolling or the top absolute/relative
manifest-path field and **Open**. Work on a copy of a sample if you want to
preserve it: the editor writes the files it opened, not cosmetic editor state.

The authoring UI uses smooth system typography and restrained platform-style
surfaces, inspired by GameStudio's visual direction without using its renderer,
code or assets. On macOS, Core Text resolves the system interface font and Menlo
for source text at 13 logical points, rasterized at the actual framebuffer density.
Rounded controls, blue focus/selection and neutral panels follow the system
light/dark preference. These remain native GPU-drawn controls, not AppKit widgets
or a WebView. Apple font files are never copied or bundled. Other desktop builds
use an installed system sans/monospace pair (DejaVu/Liberation where available)
and report missing fonts explicitly rather than falling back to pixel text.
Gameplay HUD fonts, pixel-art filtering and native scene presentation are unchanged.

**Manifest / Lua** edit the actual source bytes, with click/drag selection,
UTF-8 insertion/paste, Shift-arrow selection, arrows/Home/End, vertical and
horizontal wheel scrolling, Ctrl/Cmd-A/C/X/V and one-step Ctrl/Cmd-Z undo/redo.
Enter inserts a newline; Tab inserts four spaces. Source selection is a
codepoint-based monospace grid, not a full bidirectional/IME text system.
Manifest drafts are bounded to 16 KiB and Lua
editing to 256 KiB; larger runtime scenes remain runnable but are explicitly
rejected by this bounded editor. Single-line path/property fields append text;
Backspace removes a character and Ctrl/Cmd-A clears the field before replacement.

**Save active / Ctrl/Cmd-S** atomically saves only the selected document.
Save manifest and Lua separately when changing both; there is no multi-file
filesystem transaction or automatic save. **Reload saved / Ctrl/Cmd-R** stages
the actual disk project through `nova_open_scene`, then replaces engine/resources
only on success. Reload does not save drafts. **Open saved entry** opens the
current disk manifest's Lua entry, requiring a discard decision if the old source
is dirty. A malformed manifest or unavailable entry still opens the manifest for
repair, with an explicit diagnostic; fix/save it, then open its entry and reload.

The asset inspector's **Live metadata** comes from `nova_inspect_scene`;
**Saved metadata / Preflight saved** comes from side-effect-free
`nova_validate_project`. Declaration order, alias resource indices, input bytes,
dimensions, primitive/vertex counts, baked bounds and PCM information are real
runtime/import results and **read-only**. Previous/next select declarations.
**Copy path to field / Apply draft path** changes a real asset path in the
manifest draft, preserving other lines/comments/CRLF. **Draft entry / identity**
edit those existing directives (identity requires v2). Add/remove/rename IDs,
change declaration types or upgrade the header in Manifest text; all existing
parser/import exclusions remain enforced on preflight/reload. There are no
invented persistent scene entities, transform gizmos or imported mesh editing.

**Draft, disk snapshot and live state are separate.** Asterisks mark unsaved
documents; the panel shows disk conflicts and transient local save/live counters,
not serialized scene IDs. Disk view shows the last saved/opening snapshot or
the exact observed external-conflict text. Reload checks disk snapshots without
discarding drafts and reports when the running disk candidate differs from them.
Failed import/Lua replacement retains the old engine and resource ownership;
its last frame remains visibly labelled **failed / retained / paused**, not a
successful preview. The actual live source path is shown independently of the
open document. **Details** opens the full error/status diagnostic.

Dirty project switching, closing, rereading and changing Lua entry require an
explicit native **cancel / discard** decision. Saving checks exact bytes plus
file identity/size/mode/timestamps, locks the containing directory for cooperating
Nova writers, stages/fsyncs a same-directory temporary, rechecks disk immediately
before atomic replacement and fsyncs the directory. External changes are refused;
the UI retains draft and observed disk text and offers review, reread or explicit
overwrite of **that exact observed version**. A newer edit requires another
decision. Files/parent directories reached through symlinks, hard-linked files,
replaced project roots, NUL text and oversized input are rejected for authoring;
the runtime's unchanged read-only import rules are separate. This is optimistic
local-file coordination, not a hostile-process filesystem sandbox.

Click the genuine native preview for WASD/arrows and Space gameplay input.
Editing controls do not send gameplay keys. **Pause / Resume**, unfocused or
minimized windows and decision dialogs pause simulation/services. The preview
uses shared `NovaFrame`, `NovaResources`, the 60 Hz engine/services loop and
`runtime/presentation.h`'s caller-provided physical framebuffer rectangle and
matching pointer conversion; it does not copy a renderer or run another engine
format. The validated CMake world preset also applies to the editor.
V2 live previews use the same project-owned save/audio services as ordinary
gameplay; headless preflight never plays audio or reads/writes live saves.

Bounded native evidence (requires a logged-in desktop):

```sh
./build/nova_editor --project ./examples/assets/nova.project \
  --frames 60 --capture ./build/editor.png
./build/nova_editor --smoke --frames 90 --capture ./build/editor-authored.png
./scripts/with-toolchain.sh ctest --test-dir build \
  -R 'nova_documents|nova_text_editing|nova_gpu_editor' --output-on-failure
```

`--capture` here captures the **native editor framebuffer**, not the runtime's
logical compatibility capture. `--smoke` requires at least 90 frames and refuses
`--project`: it creates/removes a private temporary v1 fixture using original
CC0 sample PNG/GLB and an original Lua scene. It exercises the same text mutation
and UI action paths for draft/save/reload, Lua/import rollback, newer external
conflicts and dirty-switch decisions, then checks exact preview/chrome pixels.
It does not synthesize OS keyboard events or access gameplay saves/audio/signing.
Ordinary `--project --frames` still runs normal live project service effects;
use headless preflight or this v1 smoke for side-effect-free authoring checks.

### Native rendering evidence and repeatable checks

On the development machine, the Debug build and focused tests passed. Real GPU runs reported **Apple M4**, OpenGL **4.1 Metal**, and successful texture, shader, framebuffer, and mesh uploads. Both examples ran for 120 frames and exported native framebuffer captures; the launcher also ran and was captured. This is functional execution evidence, **not a Retroid performance benchmark**.

```sh
./build/nova_studio --scene ./examples/2d/main.lua --frames 120 --capture ./build/2d.png
./build/nova_studio --smoke --frames 120 --capture ./build/mixed.png
./build/nova_studio --frames 2 --capture ./build/studio.png
```

The smoke run switches from 2D to mixed at its midpoint and supplies deterministic movement/action input. Each bounded run prints `NOVA_RUN ... status=ok` and exits nonzero on scene/capture errors or an interrupted run. `--capture` remains a real GPU-rendered **960x540 composite with the HUD**, independently of world/window resolution. `--capture-native` is a separate explicit output of the actual native framebuffer, including letterboxes; it also requires `--frames`. Both outputs can be requested with distinct paths. `--frames` uses a fixed timestep rather than measuring performance.

```sh
./build/nova_studio --project ./examples/assets/nova.project --world-resolution 1280x720 \
  --frames 120 --capture ./build/logical.png --capture-native ./build/native.png
```

`NOVA_PRESENT` reports the allocated world texture size, native overlay/framebuffer
pixel dimensions, window-point dimensions and fixed logical canvas size.
On the Apple M4 desktop, focused checks measured 960x540, 1280x720 and 1920x1080
world color/depth targets against the same 1920x1080 native HUD framebuffer
(960x540 window points at 2x DPI). A half-logical-pixel HUD rectangle occupied
exactly one native pixel, with unchanged neighboring background pixels: the HUD
is not an enlarged 960x540 offscreen overlay. Resizing to 1200x800 window points
produced a 2400x1600 framebuffer and a 2D integer viewport at (240,260), 1920x1080;
the world target did not resize. These are functional rendering measurements,
not frame-pacing/performance measurements or Android device evidence.

Default tests require no display: they cover example movement, mixed-scene commands, native AABB collision, viewport sizing, Lua errors/limits, manifest validation, asset handles, root/symlink containment, PNG/GLB decoding, hierarchical transforms, mirrored winding, 32-bit indices above 65535, CLI validation and the pinned Android lifecycle patch. Opt-in GPU tests also cover whole-project replacement, shared-path caching, cleanup after partial import/Lua failures, and exact sprite/transparency/model-color pixels from a real runtime capture. To include the GPU runs:

```sh
./scripts/with-toolchain.sh cmake -S . -B build -DNOVA_GPU_TESTS=ON
./scripts/with-toolchain.sh cmake --build build -j 4
./scripts/with-toolchain.sh ctest --test-dir build --output-on-failure
```

GPU tests need a logged-in graphical desktop and are opt-in for headless CI. Linux/Windows desktop builds have not been validated; this initial build configuration is macOS/Android-focused.

## Shared engine and project layout

### Bounded native static modeller

The desktop `nova_editor` now includes an original static primitive/transform
modeller integrated with its real project/source/asset shell:

```sh
./build/nova_editor --project "$PWD/examples/static/nova.project"
# Or enter the same native modeller UI immediately:
./build/nova_editor --project "$PWD/examples/static/nova.project" --modeller
```

In the project inspector, select a model declaration and click **Modeller**.
If the current inspected declaration is not a model, the first saved model
declaration is selected; the exact destination is displayed before any write.
In Advanced, the modeller uses the **saved** manifest, never a draft asset path. Projects
without a declared model fail explicitly; add/save a declaration in the editor
first. Existing GLB is not changed on entry.

Create **Box**, **Pyramid** or **Cylinder** in Parts, select a named part, and
edit its unique ASCII name, XYZ position/rotation/scale, opaque RGB or cylinder
sides in the Inspector. **Apply** validates and commits typed fields to the
source draft; **Reset** discards only those un-applied fields. Selection, save,
export and deletion cannot silently lose typed values. **Delete part...** asks
for confirmation, explicitly states that no part undo is available, and preserves
every remaining ID and the next unused ID. **Advanced... -> Original colour demo**
is available only in an empty document and creates original separated primitives,
not copied artwork.
Front/perspective/side and bounded button/wheel zoom change only the preview
camera, not authored transforms. Properties scroll independently; Apply/Reset
and the Parts delete action remain fixed. Named texture choices use the existing
staged GPU image cache; opening/scrolling the chooser or hovering controls does
not upload textures. Missing/stale thumbnails are labelled unavailable, never
replaced with a fake texture approximation.

Editable source defaults to `<declared-model-path>.nova-model`. A contained
project-relative `.nova-model` path can be entered under **Advanced...** with **Open / new source**
to reopen source or start a new document; its parent directory must already
exist. New documents are unsaved, even when empty. **Save source only** atomically
creates/replaces that strict source document. **Export GLB separately...** separately
exports the draft to the displayed model declaration. Existing GLB requires an
explicit native overwrite decision; external source/binary edits are preserved
until the exact observed version is reviewed and explicitly approved. Source
conflicts offer the shell's full scrollable read-only text viewer. A second
external edit invalidates prior consent. Symlink/hard-link/root escapes and
failed source parses never replace the current draft/live view.

Successful Advanced export means generated bytes passed `nova_decode_glb`, the guarded
write succeeded, and the actual saved project passed `nova_validate_project`.
The UI shows native exported counts/bounds. If GLB was written but another
project file fails preflight, that partial outcome is stated explicitly, not
reported as a verified project export. Return to the editor and **Reload saved**
to restart gameplay with exported assets; source save, asset export and gameplay
reload remain separate. Returning/closing with unsaved source or un-applied
fields or an unexported model revision requires explicit discard or cancel.
Objects/Rooms uses the same modeller with a fixed source destination and
the primary **Save** bridge; its export validates the actual self-contained GLB even
before the new resource has been saved in the game manifest. Run separately
preflights the entire generated game. Edited generated game outputs still block
visual Save/Run; importing or editing a model does not authorize their overwrite.

The room workspace and modeller share small original native vector icons for
real Save/Run/Stop, Undo/Redo, add/delete and selection actions. Inspector
transform headings identify numeric controls, not nonexistent viewport gizmos.
Labels remain alongside nonobvious icons; hovering action icons briefly shows
the action/shortcut or its disabled reason. These are functional control/layout
checks, not a novice usability study or a claim that the editor is equivalent
to another product.

Native previews stage private project fixtures only on model edits, through
`nova_open_scene`, real decoded/uploaded/cached `NovaResources`, and the shared
`runtime/presentation` world/native-framebuffer panel compositor. Failed staging
retains old live resources with an explicit stale-preview error. Auto-fit scales
only the draw instance to remain within the native camera clip range; displayed
inspection bounds and exported geometry remain authored coordinates. View/camera
changes do not upload meshes. Private preview fixtures are removed on exit.
There is no second renderer, WebView, arbitrary-mesh reconstruction, vertex/face
modelling, full material/PBR editor, skeletal authoring or animated GLB support.

`authoring/model.{c,h}` implements original bounded box, pyramid and cylinder
geometry without another importer or rendering engine. The editable source is
strict non-executable ASCII `nova-model 2`, separate from the exported GLB:

```text
nova-model 2
next 2
texture 1 resource_5.glb.texture_1.png
primitive 1 cylinder 8 0 0 0 0 0 0 1 1 1 255 255 255 Body 1
```

`next` is the monotonically increasing next unused numeric ID. Each primitive
line contains ID, shape, sides, position XYZ, Euler rotation XYZ in degrees,
scale XYZ, integer RGB, unique 1..31 letter/digit/underscore part name and texture
index (0 for plain colour). Texture declarations precede parts and have consecutive
1-based indices and unique contained project-relative `.png` paths without spaces.
Paths are relative to the project root, not the source's directory.
Up to 16 PNG declarations are retained, including currently unassigned imports.
Version 1 remains readable without losing transforms, colours, sides or IDs;
its implicit part names become `Part_<ID>`, with no textures. Explicit source
saving writes v2; opening never rewrites the old source. Unknown versions fail.
Box/pyramid sides must be zero; cylinder sides are
3..32. Scale defines the full unit-shape extent (cylinder diameter/height).
Shapes are centered at the origin, Y-up; rotations apply right-handed X, Y,
then Z after scaling and before translation. Up to 64 primitives, positive
scale 0.01..1000, position +/-10000, rotation +/-360, opaque RGB 0..255 and
32767 source bytes are accepted. Unknown directives, duplicate/stale IDs,
nonfinite numbers and unsupported shapes fail explicitly. Blank lines are
allowed, comments are not. IDs survive reordering/deletion; they are not array
indices. Empty documents are editable but cannot export an empty GLB.

Memory parse/serialization/export APIs replace their outputs only on success.
GLB exports bake authored transforms into float32 triangle positions, preserving
outward winding and per-primitive `KHR_materials_unlit` opaque colours in one
embedded BIN and one scene. UVs are generated before transforms: dominant-axis
planar mapping for box faces/pyramid sides and caps, cylindrical wrapping for
cylinder sides with a seam at positive X, and planar cylinder caps. V increases
down the PNG for vertical faces. No manual UV editor is needed. The GLB embeds
all declared PNG bytes, so runtime/export does not need external image paths.
Maximum generated geometry is 24576 expanded vertices (8192 triangles), with a
16 MiB GLB ceiling and the stricter texture budgets below. Every returned export
passes the exact native `nova_decode_glb` importer first; headless tests also
run `nova_validate_project` and verify real counts/bounds. Arbitrary imported
GLB meshes are never presented as recoverable primitive-source documents.
Default `nova_model` tests cover strict source, all 256 native color-byte round
trips, geometry winding/counts/transformed bounds, limits, actual project preflight
and guarded source/binary saves. Opt-in `nova_gpu_model` verifies exact native
RGB pixels, transformed shape height and failed-reload resource retention.
`nova_gpu_modeller_ui` injects only input into the production native widgets:
it exercises create/select/delete/edit, source reopen/save, full conflict review,
stale overwrite consent, GLB cancel/export/preflight, symlink rejection and
un-applied-field guards, checks cache revisions/native pixels, then captures the
real `nova_editor --modeller` shell. Generated evidence is
`build/model-roundtrip.png`, `build/modeller-ui.png` and
`build/modeller-shell.png`; these are desktop functional checks, not Android
device validation or performance measurements.
`nova_textured_model` also checks v1/v2 named sources, texture paths/materials/
images/UV rejection, exact pixel/dimension/byte budgets and headless preflight.
`nova_gpu_textured_model` checks asymmetric quadrant orientation/widths, shared
material/node/resource aliases and retained live textures on failed reload.
`nova_gpu_texture_lifetime` redirects only texture allocation/free calls in a
separate test build, verifies balanced unique uploads/releases and failure on
the second texture upload. `nova_gpu_textured_workflow` uses actual native hit,
typing, browser and scroll controls for New model, named parts, PNG assignment,
Save/reopen/export, Create Object, placement and Run, then reopens both editor
and standalone runtime. Evidence includes `build/textured-native.png`,
`build/textured-model-workspace.png` and `build/textured-room-run.png`.

| Path | Purpose |
| --- | --- |
| `engine/` | C11 engine, Lua API, input contract, camera/draw command data, native collision, logical viewport |
| `runtime/main.c` | Shared desktop/Android native game loop, input, launcher and capture options |
| `runtime/presentation.{c,h}` | Shared GPU world ownership, framebuffer/panel layout, native HUD drawing and composite captures |
| `engine/project.{c,h}` | Versioned manifest declarations, stable IDs and lexical path validation |
| `engine/scene.{c,h}` | Strict authored scene v1 and data-owned visual commands for opt-in manifest v3 |
| `runtime/assets.{c,h}` | Native path resolution, PNG/GLB decoding, resource cache and transactional scene replacement |
| `runtime/inspect.h` | Read-only loaded scene/resource views and shared headless project preflight v2 |
| `runtime/saves.{c,h}` | Project-owned, hex-encoded bounded save keys and atomic versioned file replacement |
| `authoring/document.{c,h}` | Bounded real file drafts, disk snapshots, contained atomic/conflict-guarded text/binary output |
| `authoring/qt/`, `cmake/QtStudio.cmake` | Desktop Scene/Code app, unified documents/recovery, system controls and Qt-hosted native GPU bridge |
| `authoring/editor.c`, `authoring/widgets.{c,h}` | Native project browser, source/property editing, decisions and shared-runtime preview |
| `authoring/style.{c,h}` | System typography, framebuffer-density text cache and platform-style authoring palette |
| `examples/2d/main.lua` | Editable 2D gameplay, moving target and native contact detection |
| `examples/mixed/main.lua` | Editable 3D gameplay, camera, generated mesh models and HUD |
| `examples/assets/` | Editable manifest project, original CC0 PNG/GLB fixtures and provenance notice |
| `examples/sprites/`, `examples/static/` | Original sprite-only and multi-primitive/static node-instance regression projects |
| `android/` | Gradle application, Android NativeActivity manifest, pinned wrapper |
| `tests/` | Focused shared-engine and build-integration tests |
| `licenses/` | Dependency licenses; builds also preserve embedded upstream notices |

**Rendering choice:** the standalone runtime and legacy editor use raylib 5.5
with GLFW/Cocoa/OpenGL on macOS; the Qt app owns its native OpenGL context and
hosts the same renderer without GLFW. Android uses EGL/OpenGL ES 2 with
NativeActivity, never Qt. Lua 5.4.8 has no JIT requirement. Native C owns
rendering, meshes, resources and collision; Lua controls lightweight gameplay.
macOS OpenGL is deprecated, so this is a practical first-slice backend, not a
commitment to use OpenGL indefinitely.

**Coordinates and timing:** all scenes share a 960x540 logical canvas and 60 Hz fixed simulation. A 2D scene uses nearest-neighbor, integer letterboxing when the **native framebuffer** can fit at least one logical canvas; smaller framebuffers use fractional downscaling. 3D/mixed worlds use aspect-preserving fractional scaling with bilinear presentation. Resizing and display DPI never change gameplay coordinates.

**Separate world and HUD:** the GPU world/background target has exactly three
bounded 16:9 choices: `960x540` (default), `1280x720`, or `1920x1080`.
Use `--world-resolution` on desktop, or set the validated CMake cache setting
`-DNOVA_WORLD_RESOLUTION=1280x720` for a compiled default on desktop/Android.
CLI selection overrides that default. Invalid values fail explicitly before
window creation/dependency fetch respectively; failed GPU allocation does not
fall back to another resolution or destroy a previous presentation target.

Only depth-tested cubes/static models and the background use that world target.
Existing rectangle/text/sprite commands remain ordered overlay commands in every
scene mode, drawn **directly into the actual native framebuffer**, after world
presentation. In a sprite-only/2D scene, all geometry is therefore native overlay;
the world preset affects its background only, not a newly invented 2D world layer.
HUD logical positions/sizes are scaled into the same letterbox viewport; commands
outside it are clipped, and sprite alpha blending/nearest texture filtering are
retained. The existing bundled bitmap font/glyph limits remain; there is no new
font importer or vector-font rasterizer. No native-sized overlay texture is
allocated, and resize/DPI changes do not recreate scene assets or the world target.
Interpolation and GPU-context reconstruction are still absent.

### Reusable native presentation host contract

`runtime/presentation.h` is a raylib-aware **host** helper, not a second engine,
and adds no raylib types to `NovaFrame` or `engine/nova.h`. Zero-initialized
`NovaPresentation` owns its world color/depth target and unit-cube model until
`nova_presentation_destroy`, called before closing the GPU context. Configure
outside drawing scopes; a failed replacement frees only its candidate and
returns/logs an actionable error. Successful replacement retains the cube and
releases the previous target; repeated same-preset configuration is a no-op.
Resources and the frame are borrowed for drawing and retain their existing
reload/inspection lifetimes.

`nova_world_resolution_default()` returns the validated build preset.
`nova_world_resolution_parse()` accepts only the three exact preset strings.
`nova_presentation_layout()` computes layout in physical framebuffer pixels,
not window points. `nova_presentation_layout_region()` does the same inside a
caller-provided `NovaFramebufferRect` (also used by the desktop editor), rejecting
empty/out-of-framebuffer regions without mutating the output. Returned
`NovaPresentationLayout` includes window and framebuffer dimensions, the requested
pixel rectangle and the actual letterbox `NovaViewport`.
`nova_presentation_pointer()` maps window/touch points through the framebuffer
ratio and that same offset viewport to fixed logical coordinates. Letterbox/outside
points remain outside the logical canvas rather than being clamped into controls.
Reacquire layout after resize/DPI changes; invalid/zero dimensions return failure.

Call `nova_presentation_world()` once for the current frame outside host drawing.
Within the host's `BeginDrawing` or `BeginTextureMode`, use
`nova_begin_canvas(actual_target_width, actual_target_height)`, then
`nova_presentation_composite(..., layout.viewport)` for the identical world/HUD
path in a full framebuffer or panel, and finally `nova_end_canvas(saved_state)`.
These non-nested scopes restore matrices and the full active-target viewport;
do not nest them inside an existing camera/scissor scope. Compositing does not
clear the caller's framebuffer or draw in panel letterboxes, so the host owns
its surrounding UI/background. Launcher/error UI uses the same logical overlay
scope, not world rendering. Editor controls are owned separately by `authoring/`.

The compatibility capture uses a separately allocated 960x540 GPU target and
the same compositor, with logical-size HUD drawing; it is not a resize of the
native screenshot and never becomes a world-only capture. Native capture reads
the active default framebuffer before buffer swap and rejects mismatched target
dimensions. Capture/read/export failures return a nonzero bounded-run status.
Focused tests cover pixel-space panel placement/clipping, high-DPI pointer
mapping, zero/invalid sizes, all world/depth sizes, single-native-pixel HUD detail,
partial-alpha/nearest sprites, allocation rollback/retry/cleanup, both decoded
capture shapes and exact default direct-scene/project regression pixels.

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
| `nova.cube` | `centerX, centerY, centerZ, width, height, depth, r, g, b [, rx, ry, rz]` |
| `nova.asset` | `declaredID`; returns an opaque, scene-local sprite/model/audio handle |
| `nova.sprite` | `spriteHandle or framePlayback, x, y, width, height`; whole image, white tint, alpha blending, nearest filtering |
| `nova.model` | `handle, x, y, z, uniformScale [, rx, ry, rz]`; positive scale, rotation about the asset origin |
| `nova.overlap` | `ax, ay, aw, ah, bx, by, bw, bh`; returns boolean, edge-touching is not overlap |

Rectangles and text are drawn after the depth-tested 3D models, as an overlay. Cube commands instance a GPU-uploaded unit-cube mesh model, not software-rendered shapes. Camera up is +Y and its direction may not be parallel to that axis. Color channels are integer 0..255. Sizes must be positive; position/size arguments must be finite and within +/-1,000,000. Text is limited to 191 bytes and the bundled font has limited glyph coverage.

Cube/model rotations are optional **complete trailing triples**, in degrees,
using local scale -> right-handed X/Y/Z rotation -> translation. Omit all three
for the old zero-rotation behavior. Cube RGB arguments stay at positions 7..9;
rotation starts at 10 (model rotation starts at 6). No argument-count heuristic
reinterprets colours as angles. Finite runtime angles normalize to [-180, 180);
partial triples and nonfinite angles are errors.

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
  optional float32 `NORMAL`, and optional float32 `TEXCOORD_0` (VEC2, same count
  as positions, finite 0..1). UVs are required when a material has a PNG.
  Normals have no lighting effect in this unlit slice.
  Non-indexed and unsigned 8/16/32-bit indices work, including indices above 65535:
  triangles are expanded rather than truncated. Parent/local translation, normalized
  quaternion rotation, scale and affine matrices are baked into vertices; mirrored
  transforms correct winding. Repeated mesh nodes become separate mesh instances.
  Materialless geometry is opaque white; declared materials must use
  `KHR_materials_unlit` with an opaque base-color factor. Raylib's default shader
  renders those colours without PBR lighting. Opaque base-colour PNG textures
  may use embedded buffer-view images with MIME `image/png`, texture coordinate
  set 0, and explicit nearest min/mag + clamp-to-edge S/T sampler (9728/33071).
  RGB tint multiplies the sampled PNG. Each PNG must be 8-bit RGB/RGBA,
  noninterlaced, 1..1024 per dimension, <=1 MiB, and every decoded alpha must be
  255. No mipmaps are needed, including NPOT textures on Android GLES2.
  CPU decode owns each image once; native staging uploads it once and materials
  borrow the cached texture. Scene aliases share the entire resource. Partial
  upload/reload failures release only candidate images/textures/meshes; successful
  replacement releases the old cache once. Headless preflight never uploads.
- **Explicitly rejected:** all buffer/image URIs (external and data), other
  texture formats, UV sets/transforms, vertex colors/tangents, animation, skins, morph targets, compression,
  multiple scenes, imported cameras/lights, double-sided/transparent/emissive
  materials, lit/PBR materials and extensions other than `KHR_materials_unlit`.
  Unsupported or malformed data never reports successful fallback geometry.

Bounds: 16 MiB per asset/entry file, 64 MiB total unique asset input, 16 million
total sprite plus model-texture pixels (16,777,216), 16 images/textures/samplers
and 4,194,304 decoded texture pixels per GLB, 128 materials, 256 GLB nodes,
128 node-instanced primitives per model,
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
Custom projects can run directly on desktop or use the separate local APK export
workflow below. The ordinary Android debug launcher still includes all samples.

Two additional original v1 projects exercise the same subset without new importer
features. `examples/sprites/` is a sprite-only 2D scene with RGB checker tiles,
an RGBA token and a second declaration aliasing that token. `examples/static/`
contains an indexed cube and non-indexed pyramid as two unlit primitives in one
mesh, repeated under three static nodes with parent translation, quaternion/scale
and mirrored affine matrix transforms. It decodes to six primitives/162 expanded
vertices and local baked bounds `(-2.5, 0, -0.5)`..`(3.5, 1.5, 0.5)`.
Both projects include CC0 provenance and are reproduced by the same generator.
They are runnable through `--project` and included by the full desktop/Android
examples-tree sync; the existing three-card launcher is unchanged. GPU CTests
capture both projects and verify exact sprite transparency/RGB and primitive-color
pixels; headless tests check declarations, aliases, bounds and authoring errors.

### Version 2 projects and native gameplay services

Version 1 syntax and static PNG/GLB support are unchanged. Version 2 adds a
required persistent identity and optional audio declarations, under the same
manifest/path/32-asset budgets:

```text
nova-project 2
identity my-original-game
entry main.lua
sprite idle art/idle.png
sprite step art/step.png
audio click audio/click.wav
```

`identity` occurs exactly once and is a case-sensitive 1..63 ASCII identifier
(letters, digits, underscores, hyphens). It is **not** an Android applicationId,
manifest location, title or automatically derived hash. Keep it stable when moving
or exporting a project; change it for a separate game's saves. Identical identities
intentionally share saves inside the same OS app-data namespace. Distinct Android
packages have separate internal storage, even when their project identity matches.
Version 1 and direct scenes have no persistent identity and reject save calls.
Timers/numeric tweens work in direct scenes too; frame playback needs sprite assets.

| Lua function | Contract |
| --- | --- |
| `nova.play` | `audioHandle, volume[, loop]`; volume 0..1, optional boolean loop defaults false |
| `nova.stop` | `audioHandle`; stop the shared sound and cancel its loop |
| `nova.save_get` | `key`; stored binary Lua string or nil for a missing key; I/O/corruption is an error |
| `nova.save_set` | `key, binaryString`; queue an atomic replacement; no automatic table serialization |
| `nova.timer` | `seconds[, repeat]`; opaque timer; optional boolean repeat defaults false |
| `nova.timer_poll` | `timer`; consume and return all expirations since the last poll |
| `nova.tween` | `from, to, seconds[, easing]`; numeric endpoints within +/-1,000,000; `"linear"` or `"smooth"` |
| `nova.tween_value` | `tween`; return current number and completion boolean |
| `nova.frames` | `denseArrayOfSpriteHandles, secondsPerFrame[, loop]`; 1..32 frames, optional boolean loop |
| `nova.cancel` | `timerOrPlayback`; release it; subsequent use is an explicit cancelled-handle error |

New service calls enforce exact argument counts and types (numeric strings are not
numbers). Durations are finite 1/60..3600 seconds. Each scene has at most 64 live
timer/tween/frame-playback handles; cancellation or Lua garbage collection reclaims
a slot without making an old handle valid again. Finished handles retain their
result until cancelled/collected. Timers retain at most 1,000,000 unpolled expirations.
The handles are protected userdata, not editable tables.
At most 16 native save reads are allowed per Lua loading/update call; reads
satisfied by that call's queued writes do not perform I/O or consume that budget.

Playback advances **before** `update`, only by the engine's validated simulation
`dt`; creation starts at zero, zero-dt staging never advances time, and a handle
created during an update first advances on the next tick. One-shot timers expire
once; repeating timers preserve remainder and count skipped periods. Tweens clamp
to the endpoint; smooth easing is smoothstep. Nonlooped sprite sequences hold their
last image; looped ones wrap to the first. Compose numeric tweens for x/y/z/scale
transforms and pass frame playback directly to `nova.sprite`:

```lua
local steps = nova.frames({nova.asset("idle"), nova.asset("step")}, 0.15, true)
local x = nova.tween(20, 300, 2, "smooth")
local timer = nova.timer(1, true)
local click = nova.asset("click")
local score = tonumber(nova.save_get("score") or "0")
function update(dt, input)
    if nova.timer_poll(timer) > 0 then
        score = score + 1
        nova.save_set("score", tostring(score))
        nova.play(click, 0.3)
    end
    nova.sprite(steps, nova.tween_value(x), 120, 32, 32)
end
```

**Audio subset/lifetime:** WAV must be little-endian RIFF with exactly a
16-byte `fmt ` chunk followed by `data` for unsigned PCM8 or signed PCM16/PCM24.
IEEE float32 is also supported with exactly `fmt(16)`, `fact(4)`, then `data`;
the fact frame count must match. All formats are mono/stereo, 8000..48000 Hz,
nonempty, at most 60 seconds per sound and 120 seconds across unique project
sounds. Chunk lengths, alignment, byte rate, zero odd-data padding and file
length must match exactly. Float samples must be finite and within +/-16;
headroom is retained, never silently normalized/clipped. Compressed/extensible
WAV, metadata/extra chunks, MP3, OGG and streaming music are explicitly rejected
by this legacy asset service; the separate disk-stream API below does not relax it.
PCM8/16 keeps pinned raylib's existing decoder. PCM24/float32 uses the shared
float decoder before native upload because raylib's WAV loader would otherwise
reduce it to PCM16. No dependency is added. Decode/upload happens only at load.
Audio input shares the existing per-file/project input budgets; total duration also
bounds backend resampling storage.

The native audio device initializes lazily for an audio project and closes on
runtime shutdown. Each unique audio path has one sound/voice, at most 32; aliases
share playback, volume and stop state. Playing restarts that voice; this legacy API
does not provide overlapping voices, pitch, spatial audio or sample-accurate/gapless
loops. Loop replay is checked at simulation ticks, so there may be a tick-sized gap.
Desktop focus suspension pauses/resumes sounds with simulation. Android activity
suspension/audio routing still requires device validation.

Default `nova_services` tests need no device and use isolated temporary save roots,
including partial-write failures, case distinctions, corrupt files, symlink escapes,
audio budgets and live-save-independent preflight. Enable
`-DNOVA_AUDIO_TESTS=ON` and run `ctest --test-dir build -R nova_audio_lifetime`
through `scripts/with-toolchain.sh` for real native device/resource/play/stop/
pause/reload/alias cleanup checks; it uses generated silence, not a listening test.
That opt-in test also covers independently controlled silent score/file streams
sharing this device and final callback-quiescent shutdown. It remains a hardware
gate, not part of the default device-free suite.

**Save containment/format:** keys use the same 1..63 ASCII identifier grammar and
are case-sensitive; values are binary strings of 0..4096 bytes. A project may
persist at most 32 keys. Identity directories and key filenames are lowercase hex
of the original ASCII bytes, never raw names: `Case` and `case`, or `Key` and `key`,
stay distinct on case-insensitive macOS filesystems. Locations are:

- macOS: `$HOME/Library/Application Support/NovaStudio/projects/<hex-identity>/<hex-key>.sav`.
- Android: `<NativeActivity internalDataPath>/NovaStudio/projects/<hex-identity>/<hex-key>.sav`.
- Other POSIX desktops: `$XDG_DATA_HOME/NovaStudio/projects/...`, or
  `$HOME/.local/share/NovaStudio/projects/...` when XDG is unset.

The OS app-data base must already exist and resolve to a directory; errors are
explicit. Nova-owned child directories are created lazily on a write, with private
permissions. Lua cannot choose a base/path, enumerate files, load filesystem modules
or access another application's saves. Nova-owned directory/file symlinks and
nonregular/multiply-linked save files are rejected. Save v1 is eight bytes
`NOVASV1\n`, a four-byte unsigned little-endian payload length, then exactly that
many payload bytes; unknown versions/truncation/trailing data fail rather than
silently becoming a missing save.

Writers serialize with a project-directory lock. A private exclusive same-directory
candidate is fully written, file-synced and closed before atomic rename. Any
pre-commit failure preserves the previous save and removes the owned candidate.
Rename is the commit point; a subsequent directory-sync failure explicitly reports
that the value committed but crash durability could not be confirmed. Saves are
per-key atomic, not a multi-key transaction, and no gameplay state is auto-saved.

**Effects and reload:** audio/save writes share a maximum of 16 queued effects
across top-level loading and the initial update, then 16 per dispatched tick.
Reads see the newest queued write to the same key before dispatch. Native runtime
dispatch runs only after Lua loading/update succeeds; a Lua error discards that
call's queued effects. Native I/O/device failures stop the scene and log/show an
explicit error. Already committed earlier effects are not rolled back if a later
effect fails. Successful whole-project reload stops old sounds, resets all
timers/tweens/frames/Lua state and preserves explicit saved data. Failed staging
never plays candidate sounds or writes candidate saves; failed native dispatch
retains the old engine/resources but can have earlier per-key commits as above.
Return to launcher/exit releases sounds and all scene-local handles.

Skeletal/animated-GLB import/playback, animation editor, Lua-controlled audio mixing/music streaming,
save migration/cloud sync, automatic lifecycle saves and filesystem module loading
are not implemented.

#### Original self-contained services demo

Run `./build/nova_studio --project "$PWD/examples/services/nova.project"`.
Its original two-frame geometric sprite moves with a smooth numeric tween, and a
repeating timer updates the HUD. Press **Space / gamepad A** to increment the
project-owned saved count and play a quiet original synthesized chime; holding the
button does not repeat. R resets the timer/motion but keeps the saved count.
No save writes or playback occur without a button press. Invalid saved counter
data is an explicit error, not silently reset.

The stable identity is `nova-demo-services-v1`. Separate `nova.export.json` uses
the `nova-export` v1 schema and Android applicationId
`studio.nova.games.services_demo`; it is not a manifest directive or save identity.
The project is self-contained, not another launcher card.

Reproduce only this demo's CC0 PNG/WAV assets with
`/usr/bin/python3 scripts/generate-service-assets.py`, or verify byte-for-byte
without writing via `--check`. `examples/services/NOTICE.txt` records provenance
and the bounded PCM WAV format. Existing sample assets are not rewritten.
Default `nova_services` preflight/scene regressions simulate idle/button/held/reload
behavior using an isolated save root and a nonplaying audio-effect recorder,
without audible playback or actual user save access.

### Sample-clock audio/DSP foundation

The separate shared C11 `nova_audio` library now provides stereo float processing
at 48 kHz or explicitly 44.1 kHz, exact-frame event/loop scheduling, bounded
voices, band-limited synths and a rate-aware sinc sampler, envelopes, smoothed
gain/pan/pitch, a real low-pass filter, nested buses and unclipped peak monitoring.
Immutable prepared scores and independently owned renderers separate audition,
game preview and offline export lifetimes. Render operations allocate nothing
and perform no Lua, I/O, logging or locking. No device is opened by this library;
the existing game playback/device ownership above is unchanged.

Offline output includes float32 masters and deliberately quantized/dithered
PCM24/PCM16 WAVs. Integer overflow fails explicitly instead of clipping.
Score/export length is bounded to one hour, independently of unchanged
short-sample import budgets. Reproduce the original eight-second fixture without
audio-device access (output paths must be new):

```sh
./scripts/with-toolchain.sh cmake --build build --target nova_audio_render -j 4
./build/nova_audio_render build/audio-master.wav
./build/nova_audio_render build/audio-runtime.wav 44100 pcm24
```

See [the C/C++ API, ownership, DSP limits and evidence](docs/audio-core.md).

`audio/production.h` adds opt-in stereo low/high-pass and bell EQ, signed/damped
delay, room reverb, linked compression and a sample-peak-only limiter, plus
acyclic pre/post-fader sends and sample-clock automation. It returns the same
prepared program consumed by existing offline/live renderers; old public
contracts and no-effect output remain unchanged. Limits are 16 inserts (four
per bus), 16 sends, 4096 combined events and 2 MiB of effect buffers per renderer.
Tail/fade bounds are explicitly included in score length, with logical-history
reset and control-side retirement. Memory accounting and render-owner insert
diagnostics are exposed; native live insert-meter snapshots are not yet provided.
No limiter/normalization is applied by default, and software meters are not
true-peak, loudness, hardware-latency or xrun measurements.

`audio/transport.h` adds bounded command/receipt queues, coalesced meter snapshots
and control-side renderer retirement. `runtime/audio_device.h` exposes independent
Audition/Game handles through two streams on the **existing single device**.
Replace/cancel/reset use explicit fades and program identities; full queues,
stale controls, overlapping transitions, render faults and device unavailability
have typed outcomes. Position means rendered score position, not an audible
hardware playhead. Opening is explicit; no asset selection starts playback.

Link `nova_audio_native` plus exactly one chosen raylib host; it has no transitive
GLFW/raylib dependency. Both ordinary and Qt-hosted targets use
`nova_configure_raylib_audio(target, source_dir)` from `cmake/RaylibAudio.cmake`.
The checked/idempotent hook fixes callback-before-mutex shutdown and partial
stream cleanup, rejecting unknown upstream source without changing archive hashes.
It reports configured mixer/backend formats/periods separately from observed
callback sizes and received notifications. Xruns and hardware latency remain
explicitly unavailable. The inherited mixer still locks, may resample, and applies
its existing output clipping; the whole device callback is not claimed lock-free.
Core/offline float masters retain their unclipped headroom.

`audio/stream.h` / `nova_audio_stream` now provide actual disk-backed canonical
PCM8/16/24/float32 WAV playback, up to one hour at the original 8..48 kHz rate.
One reader worker owns PCM reads/decoding; the callback consumes a fixed 64 KiB
stereo-float ring, with an instance capped at 96 KiB and a configured 256 KiB
worker stack (not a whole-process/OS-overhead cap). The device-free fixture checks
every frame of a 75-second, 28,800,056-byte float file, beyond both short-effect
limits without relaxing them.

`nova_audio_device_open_file`, `file_command` and `file_poll` reuse the same
Audition/Game roles and caller-selected host. Each role initially owns a score
or file; the low-level stream remains embeddable in a future multitrack mixer.
Files open paused, with explicit fades, pause/resume, source-frame seek and
exclusive loop bounds. Generation guards reject stale work; starvation emits
counted silence without consuming source frames. Changed-source/late-decode/I/O
faults and queue-full outcomes are explicit. Close detaches callbacks before
joining the reader and freeing it; failed joins retain ownership for retry.
Positions and starvation counts are software evidence, not audible playheads or
hardware xruns. Desktop audition/focus policy remains the host's decision.

This is **not a complete Sound Studio**: manifest/Lua/packaged-Android music binding,
multitrack disk mixing,
comprehensive device-loss/Android-focus handling, recording, MIDI, sound documents,
waveform/arrangement/piano-roll UI, production/mixer/automation controls and aligned-stem workflows
remain later stages. Device-free concurrent/sanitizer checks do not establish human
listening, microphone/MIDI, latency or Android device behavior.

### Native read-only inspection v2

`runtime/inspect.h` defines `NOVA_INSPECTION_VERSION == 2` without raylib types.
`nova_inspect_scene(engine, resources)` returns a borrowed `NovaSceneInspection`
for the matching engine/resources pair owned by the native host. It reports the
last successfully opened scene, not editor entities: requested source path,
project root, resolved entry path, manifest-relative entry, declaration-order
asset IDs/types/paths, manifest version/explicit identity, and the actual `NovaFrame` (mode, camera, background and
ordered draw commands). For direct `--scene` loads, entry/source preserve the
supplied path; they have no project root, relative entry or assets.
Before first successful open, or after resource unloading,
`loaded` is false and frame/assets are NULL. Both arguments must be a matching
host pair; resources must be non-NULL. This is not a cross-thread snapshot API.

Each `NovaAssetInspection` includes the input file byte count, sprite dimensions,
audio sample rate/channel/sample-frame count, or model embedded-image count/
decoded texture-pixel count, node-instanced primitive count, expanded vertex count and AABB after
baked GLB hierarchy transforms, before Lua positioning/scaling. Type-inapplicable
fields are zero. `resource_index` points to the first declaration sharing the
same path/type; `NovaCommand.asset` indexes declarations, not that unique resource.
Aliases keep their own IDs/paths and share metadata. No GPU object IDs, mutable
resource pointers, imported node identities or synthetic persistent scene objects
are exposed. Counts/bounds describe decoded geometry, not glTF accessor hints.

Strings/assets are borrowed from the host registry. They remain valid until the
next successful `nova_open_scene`, `nova_unload_resources` or owner destruction;
successful replacement resets Lua state and all views must be reacquired even
if their addresses appear unchanged. The frame is borrowed from the engine and
changes at every `nova_tick`; copy it before another tick if a snapshot is needed.
Scene errors clear commands through the existing engine contract.
`scene_error` is the engine's current error; `load_error` records the last failed
open attempt and may change on any open attempt. A failed reload preserves all
previous declarations/resource metadata and the previous engine/frame, but the
runtime presents its error screen rather than rendering that retained frame.
A successful open clears `load_error`; unloading clears the registry entirely.
Do not retain a view's scalar counts/status across replacement.

`nova_validate_project(path, &validation, error, error_size)` is the same
manifest/path/import/Lua staging path with GPU/audio upload disabled. It needs no window or audio device
and returns a copied `NovaProjectValidation`: manifest entry/relative required
asset paths, resolved root/entry, and the same per-declaration CPU metadata.
Success requires all import budgets, Lua loading and a zero-dt initial update
to pass; failures leave the output unchanged and return/log an actionable error.
Candidate CPU resources and Lua state are always released, without touching an
active scene. The returned value has no borrowed pointers and remains valid
independently of later validation/reloads. It describes files read during that
call, not an atomic filesystem snapshot or assurance against subsequent edits;
exporters must validate their staged copy. Preflight never resolves/reads/writes live
save storage: each unqueued key is deterministically missing (nil), and queued
save writes are visible only to subsequent Lua reads in that same preflight call.
Audio effects and save-write arguments/budgets are validated but never dispatched.
Headless success does not establish
GPU upload, later-update behavior, rendering or Android device compatibility.

## Android APK scaffold

The Android application packages the **same C engine, runtime, editable scripts and manifest project assets** into an arm64 APK. The host is Android's built-in NativeActivity, so no custom Java/Kotlin UI or WebView is needed for this slice. No storage/network permissions are requested. The ordinary debug build includes the sample launcher; per-game release exports start directly in one selected project.

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

## Local per-game APK export and personal release signing

This is a local command-line exporter, not an editor/export wizard or a store
publishing service. It preserves `nova.project` v1 unchanged. The separate strict
JSON **nova-export version 1** configuration requires these fields:

```json
{
  "format": "nova-export",
  "version": 1,
  "applicationId": "studio.nova.games.my_game",
  "displayName": "My Game",
  "versionCode": 1,
  "versionName": "0.1.0",
  "provenance": ["NOTICE.txt"]
}
```

`applicationId` is a stable dotted lowercase Android identity (letters, digits,
underscores; each segment starts with a letter), distinct from the debug
launcher's `studio.nova.runtime`. Display/version names are 1..64 ASCII
letters/digits/spaces/dots/underscores/hyphens, starting with a letter/digit.
`versionCode` is an integer 1..2100000000. `provenance` explicitly names 1..32
unique project-relative license/provenance files using the same contained-path
syntax as manifest v1. Include the licenses/attribution for **all** game content;
the exporter cannot determine your legal rights from file bytes. Unknown or
duplicate JSON fields are errors. `examples/assets/nova.export.json` is a sample.
Neither this configuration nor the manifest contains signing credentials.
The only optional field is `worldResolution`: exactly `"960x540"` (default),
`"1280x720"` or `"1920x1080"`. It is passed as the standalone Android
`NOVA_WORLD_RESOLUTION` CMake default for the shared native renderer, separate
from application identity and manifest syntax. Higher world resolution does not
change gameplay coordinates or select a software/streamed renderer. Runtime
support for this setting is supplied by the separate native-resolution HUD
milestone; it does not itself establish device performance.

Use an existing configured toolchain and `/usr/bin/python3` 3.9+ with only its
standard library (no SDK/key/package installation is performed):

```sh
./scripts/export-apk.sh stage \
  --project examples/assets/nova.project \
  --config examples/assets/nova.export.json \
  --output build/exports/asset-demo-v1
./scripts/export-apk.sh build --export build/exports/asset-demo-v1
```

Staging runs `nova_export_validate`, a thin headless consumer of
`nova_validate_project`, so the actual manifest, native PNG/GLB imports,
aggregate limits, Lua source and initial update/instruction budgets must pass.
It copies and revalidates **only** the manifest (renamed `game/nova.project`),
declared entry/assets and explicitly selected provenance, together with Nova's
MIT LICENSE and the full upstream dependency/native-glue notices. It does not
copy unrelated project files, other games, source configuration or private keys.
The new output directory must be outside the game project root. Stages have an
exact file inventory and SHA-256 receipt; changed files require restaging, not
an in-place edit. The receipt is local build metadata, not a signed attestation.

`build` uses the committed Gradle wrapper and
`-PnovaExportDirectory=<absolute-stage>` with separate Android/native outputs.
It builds `assembleRelease` with `NOVA_STANDALONE=ON`, no debug signing fallback
and no debuggable flag. Startup opens `game/nova.project`; F1/Start cannot enter
the sample launcher. R can retry a failed load; Esc/Back exits. The ordinary
desktop, `--scene`/`--project`, sample-launcher and `build-android.sh` debug paths
are unchanged. The **unsigned**, structurally verified APK is:

```text
<export>/android-build/outputs/apk/release/app-release-unsigned.apk
```

### One-time local key setup and repeat updates

Key creation/unlock is deliberately a **local interactive user step**, never
performed by the exporter or an unattended agent. Keep a reusable personal
keystore outside **every Git repository** and export directory, for example
`$HOME/.nova/keys/personal-games.jks`. With your JDK's `keytool`, generate a
long-lived RSA signing key interactively (`-genkeypair -keyalg RSA -keysize 3072
-validity 10000 -alias personal-games -keystore <external-file>`); do not pass
password flags. Obtain its certificate SHA-256 using interactive
`keytool -list -v -keystore <external-file> -alias personal-games`. Back up the
key/password securely outside Git; losing the key prevents normal updates.
One personal key may sign multiple games, each with a different application ID.
MIT source licensing does not require publishing your private signing key.

From your local terminal, with an **existing** key and its public certificate
fingerprint:

```sh
./scripts/export-apk.sh sign --export build/exports/asset-demo-v1 \
  --keystore "$HOME/.nova/keys/personal-games.jks" --alias personal-games \
  --certificate-sha256 <64-hex-digit-SHA256>
./scripts/export-apk.sh verify --export build/exports/asset-demo-v1 \
  --apk build/exports/asset-demo-v1/studio.nova.games.asset_demo-1-release.apk \
  --certificate-sha256 <64-hex-digit-SHA256>
```

`sign` refuses noninteractive input, in-repository keystores, output overwrites,
changed stages, debug certificates and a mismatched pinned certificate.
`apksigner` owns its hidden terminal prompts; the scripts accept **no password
arguments, password files or password environment variables**. The APK is
16-KiB-page aligned and v2-signed, then verified before the final file is exposed.
Failed/cancelled signing never yields a debug-signed or success-shaped release.
Actual personal-key signing has not been exercised unattended; isolated-tool
tests cover that path without creating or opening any real personal key.

For updates on both Retroids, retain the **same applicationId and signing
certificate**, increment `versionCode` (display `versionName` alone is not enough),
restage/build/sign, then install the same resulting APK on each device.
Local `build/exports/version-history.json` rejects changed exports/APK bytes with
a reused or lower code and rejects certificate changes after a personal release.
Identical stage/APK bytes can be rebuilt; runtime/toolchain changes may also
require a code increment. Keep your configuration/version record when
cleaning generated builds; Android's installed version is authoritative.
Across clean checkouts, pass `--previous-export <prior-stage>` to both `stage`
and `build` to require the same identity and a strictly higher code. Retain the
public certificate pin independently; the local history is not global and
cannot replace Android's update checks.

A debug-signed installation **cannot** be updated with a personal release
certificate under the same ID. Use a different game ID (the normal export case),
or explicitly uninstall the old debug app before the first release install;
uninstalling removes its app data. No automatic uninstall/install is performed.
The verification checks exact selected-game/notices bytes and inventory, ARM64
native activity exports/standalone build marker, SDK/application/display/version
metadata, no extra activities/services/permissions, non-debug release flags and
the pinned v2 signing certificate. These are package checks, **not device
execution, lifecycle/context-loss or Retroid performance validation**.

## Deliberately outside this slice

The retained native modeller does not provide arbitrary-mesh reconstruction, vertex/face editing or extrusion. The optional editable-mesh component now adds vertex/edge/face editing and bounded extrusion, but its integrated Qt workspace remains pending. Skeletal animation, PBR/full material systems, texture painting, lighting/shadows, a physics world, full IDE/debugger, release-signing GUI and user-script module loader are not delivered. The bounded native project/source inspector and original named primitive modeller with opaque PNG materials, shared runtime timers/tweens/sprite frames, PCM audio, explicit project saves and local CLI export/signing are implemented. Live previews share those normal gameplay services; automated authoring evidence uses isolated fixtures. The original 3D example uses generated meshes; imported projects use the strict static GLB/PNG subset. No Glow compatibility is implied.

**Remaining gates:** personal signing-key creation/unlock and installation on the user's intended Retroids require the user's local participation and consent. Validate imported assets, controllers, lifecycle and render resolutions on those devices before claiming hardware-proven behavior. Public publishing is not authorized. Skeletal/animated GLB and broader authoring require separate future contracts; desktop authoring and package checks are not Android device evidence.

## Local source history

Nova Studio has a local Git repository with `main` as its foundation branch and locally committed milestone work on isolated authoring/runtime worktree branches; no remote/GitHub repository is configured. Source, tests, dependency notices and the intentional Gradle wrapper JAR are tracked. Builds, SDK/toolchain caches, local SDK paths and signing/private machine files are excluded by `.gitignore`. The SDK and asdf installations remain outside the source repository.

Nova-authored source/documentation are **MIT licensed** (Copyright (c) 2026 Nova Studio contributors); see `LICENSE`. Vendored Lua/raylib/GLFW/native-glue/Gradle code retains its upstream licenses, and original sample PNG/GLB artwork retains CC0 provenance. Keep the LICENSE and dependency notices shipped beside desktop builds and inside APK assets; they include full original single-header sources where notices are embedded, intentionally favoring preservation over compact packaging in this prototype. No public publishing, remote push or store release is performed by these local tools.
