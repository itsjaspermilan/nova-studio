# Nova Studio

A working **native runtime and bounded desktop source/project editor**, not a full game IDE. The native launcher opens editable Lua examples and versioned projects containing imported PNG sprites and static GLB models. The separate native editor edits actual project/Lua files and previews them through the same runtime. Everything lives here; GameStudio and Glow43 are unchanged and are not dependencies.

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
./build/nova_studio --project "$PWD/examples/sprites/nova.project"
./build/nova_studio --project "$PWD/examples/static/nova.project"
```

The executables resolve bundled examples relative to their own directory, not the shell's current directory. To move the desktop build, keep `nova_studio`, optional `nova_editor`, `examples/`, and `licenses/` (including Nova's MIT LICENSE) together. There is no `.app` bundle, installer or notarization.

### Native desktop project editor

```sh
./build/nova_editor
./build/nova_editor --browse "$PWD/examples"
./build/nova_editor --project "$PWD/examples/assets/nova.project"
```

`nova_editor` is a separate desktop-only raylib executable. The ordinary
`nova_studio` launcher, direct scenes, Android runtime and standalone startup
are unchanged. The browser lists real directories and `.project` files;
use **Up**, **List directory**, wheel scrolling or the top absolute/relative
manifest-path field and **Open**. Work on a copy of a sample if you want to
preserve it: the editor writes the files it opened, not cosmetic editor state.

**Manifest / Lua** edit the actual source bytes, with click/drag selection,
UTF-8 insertion/paste, Shift-arrow selection, arrows/Home/End, vertical and
horizontal wheel scrolling, Ctrl/Cmd-A/C/X/V and one-step Ctrl/Cmd-Z undo/redo.
Enter inserts a newline; Tab inserts four spaces. The bitmap font's existing
glyph coverage still applies. Manifest drafts are bounded to 16 KiB and Lua
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
The modeller uses the **saved** manifest, never a draft asset path. Projects
without a declared model fail explicitly; add/save a declaration in the editor
first. Existing GLB is not changed on entry.

Create **box**, **pyramid** or **cylinder**, select a stable-ID list item, and
edit XYZ position/rotation/scale, opaque RGB or cylinder sides. **Apply values**
validates and commits typed fields to the source draft; **Reset values** discards
only those un-applied fields. Selection, save, export and deletion cannot
silently lose typed values. **Delete selected** preserves every remaining ID
and the next unused ID. **Original RGB demo** is available only in an empty
document and creates original separated primitives, not copied artwork.
Front/perspective/side and bounded button/wheel zoom change only the preview
camera, not authored transforms.

Editable source defaults to `<declared-model-path>.nova-model`. A contained
project-relative `.nova-model` path can be entered with **Open / new source**
to reopen source or start a new document; its parent directory must already
exist. New documents are unsaved, even when empty. **Save source** atomically
creates/replaces that strict source document. **Export declared GLB** separately
exports the draft to the displayed model declaration. Existing GLB requires an
explicit native overwrite decision; external source/binary edits are preserved
until the exact observed version is reviewed and explicitly approved. Source
conflicts offer the shell's full scrollable read-only text viewer. A second
external edit invalidates prior consent. Symlink/hard-link/root escapes and
failed source parses never replace the current draft/live view.

Successful export means generated bytes passed `nova_decode_glb`, the guarded
write succeeded, and the actual saved project passed `nova_validate_project`.
The UI shows native exported counts/bounds. If GLB was written but another
project file fails preflight, that partial outcome is stated explicitly, not
reported as a verified project export. Return to the editor and **Reload saved**
to restart gameplay with exported assets; source save, asset export and gameplay
reload remain separate. Returning/closing with unsaved source or un-applied
fields requires explicit discard or cancel.

Native previews stage private project fixtures only on model edits, through
`nova_open_scene`, real decoded/uploaded/cached `NovaResources`, and the shared
`runtime/presentation` world/native-framebuffer panel compositor. Failed staging
retains old live resources with an explicit stale-preview error. Auto-fit scales
only the draw instance to remain within the native camera clip range; displayed
inspection bounds and exported geometry remain authored coordinates. View/camera
changes do not upload meshes. Private preview fixtures are removed on exit.
There is no second renderer, WebView, arbitrary-mesh reconstruction, vertex/face
modelling, textured material editor, skeletal authoring or animated GLB support.

`authoring/model.{c,h}` implements original bounded box, pyramid and cylinder
geometry without another importer or rendering engine. The editable source is
strict non-executable ASCII `nova-model 1`, separate from the exported GLB:

```text
nova-model 1
next 2
primitive 1 cylinder 8 0 0 0 0 0 0 1 1 1 80 190 230
```

`next` is the monotonically increasing next unused numeric ID. Each primitive
line contains ID, shape, sides, position XYZ, Euler rotation XYZ in degrees,
scale XYZ and integer RGB. Box/pyramid sides must be zero; cylinder sides are
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
outward winding and per-primitive `KHR_materials_unlit` opaque colors in one
embedded BIN and one scene. Maximum generated geometry is 24576 expanded
vertices (8192 triangles), with a 512 KiB GLB ceiling. Every returned export
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

| Path | Purpose |
| --- | --- |
| `engine/` | C11 engine, Lua API, input contract, camera/draw command data, native collision, logical viewport |
| `runtime/main.c` | Shared desktop/Android native game loop, input, launcher and capture options |
| `runtime/presentation.{c,h}` | Shared GPU world ownership, framebuffer/panel layout, native HUD drawing and composite captures |
| `engine/project.{c,h}` | Versioned manifest declarations, stable IDs and lexical path validation |
| `runtime/assets.{c,h}` | Native path resolution, PNG/GLB decoding, resource cache and transactional scene replacement |
| `runtime/inspect.h` | Read-only loaded scene/resource views and shared headless project preflight v2 |
| `runtime/saves.{c,h}` | Project-owned, hex-encoded bounded save keys and atomic versioned file replacement |
| `authoring/document.{c,h}` | Bounded real file drafts, disk snapshots, contained atomic/conflict-guarded text/binary output |
| `authoring/editor.c`, `authoring/widgets.{c,h}` | Native project browser, source/property editing, decisions and shared-runtime preview |
| `examples/2d/main.lua` | Editable 2D gameplay, moving target and native contact detection |
| `examples/mixed/main.lua` | Editable 3D gameplay, camera, generated mesh models and HUD |
| `examples/assets/` | Editable manifest project, original CC0 PNG/GLB fixtures and provenance notice |
| `examples/sprites/`, `examples/static/` | Original sprite-only and multi-primitive/static node-instance regression projects |
| `android/` | Gradle application, Android NativeActivity manifest, pinned wrapper |
| `tests/` | Focused shared-engine and build-integration tests |
| `licenses/` | Dependency licenses; builds also preserve embedded upstream notices |

**Rendering choice:** raylib 5.5 uses GLFW/Cocoa and OpenGL on macOS, and EGL/OpenGL ES 2 with Android NativeActivity. Lua 5.4.8 has no JIT requirement. Native C owns rendering, meshes, resources, collision and frame scheduling; Lua controls lightweight gameplay. macOS OpenGL is deprecated, so this is a practical first-slice backend, not a commitment to use OpenGL indefinitely.

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
| `nova.cube` | `centerX, centerY, centerZ, width, height, depth, r, g, b` |
| `nova.asset` | `declaredID`; returns an opaque, scene-local sprite/model/audio handle |
| `nova.sprite` | `spriteHandle or framePlayback, x, y, width, height`; whole image, white tint, alpha blending, nearest filtering |
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

**Audio subset/lifetime:** WAV must be little-endian RIFF PCM with exactly a
16-byte `fmt ` chunk followed by `data`: mono/stereo unsigned PCM8 or signed PCM16,
8000..48000 Hz, nonempty, at most 60 seconds per sound and 120 seconds across unique
project sounds. Chunk lengths, alignment, byte rate, optional zero RIFF padding and
file length must match exactly. Float/compressed WAV, metadata/extra chunks, MP3,
OGG and streaming music are explicitly rejected. Decoding uses pinned raylib's
existing decoder; no dependency is added. Decode/upload happens only at load.
Audio input shares the existing per-file/project input budgets; total duration also
bounds backend resampling storage.

The native audio device initializes lazily for an audio project and closes on
runtime shutdown. Each unique audio path has one sound/voice, at most 32; aliases
share playback, volume and stop state. Playing restarts that voice; this milestone
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

Skeletal/animated-GLB import/playback, animation editor, audio mixing/streaming,
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
audio sample rate/channel/sample-frame count, or model node-instanced primitive count, expanded vertex count and AABB after
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

No original asset modeller, extrusion, skeletal animation, full textured/PBR model pipeline, lighting/shadows, physics world, full IDE/debugger, release-signing GUI or user-script module loader is delivered by this editor slice. The bounded native project/source inspector, shared runtime timers/tweens/sprite frames, PCM audio, explicit project saves and local CLI export/signing are implemented. Live previews share those normal gameplay services; automated authoring evidence uses isolated v1 fixtures. The original 3D example uses generated meshes; imported projects use the strict static GLB/PNG subset. No Glow compatibility is implied.

**Next work:** the separately bounded original static primitive/transform modeller can reuse the document/widget/presentation seams; skeletal/animated GLB require future contracts. Validate the APK on Retroid Pocket 6 only with the user's intended device and consent, including imported assets and controller/lifecycle/render-resolution checks. Desktop authoring and package checks are not Android device evidence.

## Local source history

Nova Studio has a local Git repository on `main`; no remote/GitHub repository is configured. Source, tests, dependency notices and the intentional Gradle wrapper JAR are tracked. Builds, SDK/toolchain caches, local SDK paths and signing/private machine files are excluded by `.gitignore`. The SDK and asdf installations remain outside the source repository.

Nova-authored source/documentation are **MIT licensed** (Copyright (c) 2026 Nova Studio contributors); see `LICENSE`. Vendored Lua/raylib/GLFW/native-glue/Gradle code retains its upstream licenses, and original sample PNG/GLB artwork retains CC0 provenance. Keep the LICENSE and dependency notices shipped beside desktop builds and inside APK assets; they include full original single-header sources where notices are embedded, intentionally favoring preservation over compact packaging in this prototype. No public publishing, remote push or store release is performed by these local tools.
