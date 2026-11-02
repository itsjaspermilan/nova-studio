# Embeddable Qt Sprite component

`authoring/sprite/` supplies an editable sprite document, QPainter canvas and
Qt Widgets workspace. It is an opt-in library, **not another editor application,
a filesystem writer, or completion of the integrated Sprite Studio milestone**.
The existing C11/Lua runtime, manifests, scene contracts and Android targets are
unchanged. No raylib/GLFW context is created by this component.

## Embedding and persistence boundary

Link `nova_sprite` and include `sprite/workspace.hpp`. The namespace is
`nova::sprite`. `Document` owns the bounded source state and `QUndoStack`;
`Canvas`, `AnimationPreview` and `Workspace` borrow it. Keep all access on one
GUI thread and destroy these widgets **before** their document. In a host widget
with a document member and a child workspace, explicitly delete the workspace
in the host's destructor before member destruction.

`Workspace(Document&, QWidget*)` provides the full component; `Canvas` and
`AnimationPreview` can also be embedded separately. The workspace has a
1280x720 logical minimum; 1440x900 is the normal reviewed size. Inspector pages
scroll without moving their Apply/Reset footers. Theme changes are local to the
workspace; they do not change QApplication styling or native file dialogs.
Long names remain complete in fields/accessibility/heading tooltips and are
elided in the heading/status instead of enlarging the window.

Relevant API:

| API | Contract |
| --- | --- |
| `Document::create(size, name, mode, error)` | Replace with a new dirty document and UUID. Host must resolve the old draft first. |
| `Document::load(bytes, error)` | Strict parse into a candidate. Success replaces state and resets history/dirty state; failure leaves the live draft and undo stack intact. |
| `Document::state()` | Borrowed const view; copy before retaining across a mutation. |
| `Document::serialize(bytes, error)` | Complete editable binary source, without writing anything. |
| `Document::exportBundle(bundle, error)` | All source, frame PNGs and metadata as values; failure leaves the caller's previous bundle unchanged. |
| `Document::revision()` | Monotonic, process-local snapshot token; not persisted identity. |
| `Document::markSaved(revision)` | Acknowledge successful source persistence only if the current revision still matches and no gesture is active. |
| `Workspace::prepareSnapshot(error)` | Refuse unresolved inspector text/numbers or a drawing gesture. Does not discard, auto-apply or save them. |
| `Workspace::importPng(bytes, error)` | Validate and undoably paste into the current cel/selection origin. No path access or file copying. |
| `Workspace::setHostActions(save, import, export)` | Show caller-owned QActions; unspecified actions stay hidden. The host implements native pickers, dialogs and guarded persistence. |
| `Workspace::undoAction()/redoAction()` | Guarded, labelled sprite actions. Unapplied fields prevent undo/redo from rebinding a draft to a different layer/palette/animation. |
| `Workspace::saveRequested()` | Canvas Cmd/Ctrl-S intent. Connect this to the host save action explicitly. |

Listen to `Document::changed`, `pixelsChanged`, `dirtyChanged` and
`historyTrimmed`, plus `Workspace::problem` and `pendingEditsChanged`. The host's
unsaved-work indication must include **both** `document.isDirty()` and
`workspace.hasPendingEdits()`. Widget-local fields are not serialized into the
document until applied. Failures retain those fields; closing/replacing the
document needs an explicit host decision. Recovery of unapplied UI fields is
also a host responsibility.

For a complete delivery snapshot, the host calls:

```cpp
QString error;
nova::sprite::ExportBundle snapshot;
bool ready = workspace.prepareSnapshot(error) &&
             document.exportBundle(snapshot, error);
```

Report `error` on failure. On success, the value contains:

```cpp
struct ExportBundle {
    quint64 revision;
    QSize frameSize;
    qint64 compositePixels;
    qint64 pngBytes;
    QByteArray source;
    QByteArray metadata;
    QVector<ExportFrame> frames;
};
struct ExportFrame {
    Id id;
    QString fileName;
    QByteArray png;
};
```

The host resolves destinations, protects existing assets and exact snapshots,
preflights the **whole** project, stages the source and derived files in its
journal, and acknowledges the persisted source revision only after the actual
write succeeds. Treat leaf names such as `frame-42.png` as document-local,
not global asset paths: namespace them using the source UUID and retain stable
association IDs. Never reconstruct editable layers from these PNGs.

The current Qt foundation journal is fixed to scene -> Lua -> manifest, at most
three text documents. It cannot safely accept these payloads without an explicit
binary/multi-file extension. Do not bypass that journal with direct writes.

Source-only persistence is independent: after `prepareSnapshot`, capture
`document.revision()` and call `serialize`. If runtime publication cannot fit or
support the project, the host can explicitly save source while retaining the
previous published assets and marking derived content stale in its association
index. `markSaved` describes source persistence, **not** runtime publishability.
The host owns that stale-derived status and must not present it as a successful
runtime update.

## Editing behavior

The canvas has Select, Move, Pencil, Brush, Eraser, exact contiguous Fill, Line,
Rectangle, Ellipse and Eyedropper. Pencil is always one pixel; brush/eraser/shape
outlines use 1..64 px. Shapes can be filled. Tool opacity and RGBA8 drawing
colors work in pixel or antialiased smooth-raster mode. Fill is four-connected
and matches the exact selected-layer RGBA value. Painting respects rectangular
selection, visibility and locking.

Selection operations affect one layer/frame: move/nudge, resize, horizontal/
vertical flip, quarter-turn rotation, copy/cut/paste and delete. Transforms must
fit the canvas. Clipboard copy is not flattened across layers. This is not a
vector, free-transform, arbitrary-angle, lasso or HDR image editor.

Canvas resize/crop moves or clips all cels without resampling. Artwork scaling
resamples all cels, with nearest-neighbor pixels or smooth raster interpolation.
Both have separate labelled preview dialogs. Pivot and collision bounds move/
scale with the operation; a crop that would lose them is rejected rather than
silently clamped or discarded.

Layers are bottom-to-top normal source-over, with visibility, locking and
0..255 opacity. Every frame has one full-size cel per layer. Layer and frame
deletion are undoable, but at least one of each must remain. Named palettes
retain their RGBA8 swatches.

Frames have individual millisecond durations, duplication and reordering.
Named animations store ordered stable frame references, not numeric positions:
reordering preserves membership in the new timeline order; deletion removes a
reference but refuses to empty an animation. Duplicating a frame does not
silently add it to named animations. Applying a named range intentionally
replaces membership with that inclusive range.

Onion skin shows previous/next timeline frames in rose/blue at adjustable
opacity. The separate editor preview uses elapsed-time lookup with exact saved
durations, so delayed UI ticks do not accumulate frame-timing drift. It does not
change the selected editing frame or start gameplay; edits/hiding stop playback.
UI repaint cadence is not a guarantee of displaying every one-millisecond frame.

Pivot is an integer canvas coordinate, including edges. Collision metadata is
none or one positive contained integer rectangle. Both are visibly overlaid
but are **metadata, not implemented native collision/animation behavior**.

The canvas owns its shortcuts only while focused: Q/W/P/B/E/G/L/R/O/I select
tools, arrows move the keyboard cursor, Enter stamps/sets endpoints, Escape
cancels, Home fits, and +/- zoom. Move-tool arrows nudge selections; Shift
increases movement, Alt-arrows pan. Space-left-drag/middle-drag pan. Wheel zoom
anchors at the pointer; trackpad pixel scrolling pans unless Control is held.
Pixel mode snaps to crisp reciprocal/integer zooms; smooth mode allows
continuous zoom. Native Qt text fields retain their own selection, clipboard,
undo, focus and input-method behavior.

One stroke/shape/move is one undo command. Gesture previews are not independent
commands; Escape, focus loss, hiding, deactivation or destruction cancels them.
Undo during an unfinished gesture cancels that gesture without also undoing an
earlier edit. History keeps at most 64 commands and conservatively charges both
before/after rasters against 128 MiB. Crossing that raster bound clears older
history, preserves the latest undoable action and emits a visible explanation.
This is not an unlimited or total-process memory bound.

IDs are positive `quint32` values below `INT32_MAX`; the persisted next-ID
high-water mark is never rolled backward by undo. Undoing creation can therefore
leave identity metadata dirty even when the visible artwork looks unchanged.

## Bounds and strict source format

| Item | Bound |
| --- | --- |
| Dimensions | 1..2048 per axis |
| Layers / frames | 1..16 / 1..32 |
| Total cel pixels | width * height * layers * frames <=16,777,216 |
| Source input/output envelope | 65 MiB |
| Palettes / colors | 1..8 palettes, 1..64 RGBA8 colors each |
| Named animations | 0..32, each with 1..32 distinct existing frame IDs |
| Duration | 1..60000 ms per frame |
| Names | 1..96 UTF-8 bytes, trimmed, valid Unicode, no control/format characters; unique within each named category |
| Per-frame PNG | <=16 MiB, noninterlaced 8-bit RGB/RGBA |
| Aggregate frame PNG payloads | <=65 MiB |
| Export JSON | <=64 KiB |
| Inventory | At most 34 payloads: source, metadata, 32 PNGs |

The contractual complete-delivery storage envelope is **130 MiB + 64 KiB**
(source envelope + PNG aggregate + JSON), before journal/index overhead and
before any prior/backup generations. Returned actual counts/bytes, not this
ceiling, drive project preflight.

`.nova-sprite` is binary `NVSPRITE`, version 1. It is not JSON/base64:

1. Eight-byte magic; little-endian u32 version, zero reserved flags, dimensions,
   layer/frame/palette/animation counts, next ID and raster-mode enum.
2. Length-prefixed strict UTF-8 UUID/name; pivot; collision-present boolean and
   optional rectangle.
3. Layer ID/name/visibility/lock/opacity records.
4. Frame ID/duration, then row-major straight RGBA8 bytes for every layer cel,
   without row padding or compressed image streams.
5. Palette ID/name/color count and packed `0xAARRGGBB` u32 colors.
6. Animation ID/name/loop/reference count and ordered frame IDs.

Integers and booleans occupy four bytes, including string byte lengths.
UUIDs are 32 lowercase hexadecimal bytes. Unknown versions/flags/enums,
non-boolean values, invalid UTF-8, invalid IDs/names/references, overflowed
budgets, truncation and trailing bytes are rejected. The complete raw-raster
extent is checked before allocating decoded images. Canonical serialization
retains even RGB values of fully transparent cel pixels.

The **exact largest valid v1 source is 67,121,780 bytes**:

```text
67,108,864 raw cel bytes
       212 header, UUID, longest sprite name, pivot and rectangle
     1,856 = 16 * 116 layer records
       256 = 32 * 8 frame records
     2,912 = 8 * 364 maximum palettes
     7,680 = 32 * 240 maximum animations
----------
67,121,780
```

All maxima are simultaneously achievable with 256x128, 16 layers, 32 frames
and longest names. There is **no base64 expansion**; a blob-backed store should
preserve the bytes directly. Keep the 65 MiB envelope for the public contract.

## Export and runtime boundary

The PNG encoder checks the native import subset and decodes each result to
compare every rendered RGBA pixel. The native-decoder regression separately
passes asymmetric exported pixels, including alpha, through `nova_decode_sprite`.
Composited pixels are distinct from editable cel bytes. Raw values are RGBA8;
HDR, 16-bit-channel and CMYK pixel conversions are explicitly rejected, and
there is no authored color-profile/16-bit workflow.

`nova-sprite-export` JSON version 1 retains the source UUID/name/SHA256,
dimensions/mode, pivot/rectangle, frame IDs/files/exact durations/byte counts/
SHA256 values, named animation order/loop flags and aggregate requirements.
Digests are lowercase SHA256 hex over the exact payload bytes. Revision is
returned in memory, not persisted as source identity. The JSON has no self-digest;
the host may hash its exact bytes when constructing its association index.

This is neither an atlas nor generated Lua. The existing native `nova.frames`
accepts 1..32 sprite handles, one seconds-per-frame value and optional loop.
It does not consume variable durations, atlas regions, pivots or this metadata.
Export never drops frames, changes durations or advertises runtime playback.
An unsupported delivery returns an error, leaving editable source available.

Thirty-two component frames do not reserve thirty-two project declarations.
Models, audio and other sprites share existing declaration/pixel/byte budgets;
those constraints can reject an otherwise valid sprite delivery. Remaining
coordinated work includes the blob-backed journal/association index, guarded
source/generated-asset ownership, scene placement and stable references,
matching native playback/metadata, intentional preview updates, and the final
3D rally game built through Nova's scene/model/sprite/Lua/audio tools.

## Build, dependency and evidence

`NOVA_QT_SPRITE` defaults OFF and is included only by the desktop CMake branch.
It declares Qt >=6.5 Core/Gui/Widgets, C++17 and AUTOMOC; tests also use QtTest.
The available Homebrew `qtbase` **6.12.0_2** (Qt runtime 6.12.0) is reused.
No new package, SDK, signing or global configuration was installed or changed.

The used Qt modules offer LGPLv3/GPLv3/commercial licensing; see
<https://doc.qt.io/qt-6/licensing.html>. This build links the installed shared
Qt libraries. Before shipping the integrated Qt host, its deployment must
provide the appropriate Qt/third-party notices and LGPL compliance materials;
the existing C runtime notice collector does not package Qt. Nova's component
and original vector action icons remain MIT.

```sh
./scripts/with-toolchain.sh cmake -S . -B build-sprite \
  -DCMAKE_BUILD_TYPE=Debug -DNOVA_QT_SPRITE=ON \
  -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qtbase
./scripts/with-toolchain.sh cmake --build build-sprite \
  --target nova_sprite_document_tests nova_sprite_widget_tests \
           nova_sprite_runtime_png_tests -j 4
./scripts/with-toolchain.sh ctest --test-dir build-sprite --output-on-failure \
  -R '^nova_sprite_(document|widgets|runtime_png)$'
```

The document suite covers malformed/failing loads, retained output and undo,
stable-ID references, gestures, asymmetric transforms, exact limits, source/
PNG/metadata round trips, unsupported precision and history bounds. Its maximum
source fixture writes and reopens all 67,121,780 source bytes plus all generated
files in an isolated temporary directory. A separate high-entropy 32-frame
fixture exercises the full 16,777,216 composite-pixel budget.

The offscreen widget suite drives actual Qt buttons, fields, lists, pointer
gestures, keyboard events and input-method commits; it checks pending numeric
text, guarded undo, opacity/onion pixels, tools, selection, frame/palette/range
controls, fixed-footer scrolling, size previews, host actions, failure retention
and teardown. Its private offscreen clipboard does not replace the OS clipboard.
This is not an OS IME, accessibility-client or novice usability study.

With `-DNOVA_SPRITE_NATIVE_TESTS=ON`, two separate selectors exist:

- `nova_sprite_native_layout`: exposed Cocoa-widget authoring/output and
  `QWidget::grab` captures at normal/minimum sizes, dark/light, DPR 2. These are
  real native-widget renders, not concepts or independent OS-compositor/input
  evidence. The test creates, saves and reopens a layered animated rally marker;
  that marker is not the final playable 3D rally exercise.
- `nova_sprite_native`: the full control suite, additionally requiring Qt's
  active/focused state and Cocoa's own NSApp-active/NSWindow-key state. This
  remains blocked when the desktop reports locked. It fails nonzero with a
  diagnostic rather than forcing Qt active state or silently skipping the gate.

Native tests use only widget-targeted synthetic events, never global OS input.
Use LLDB for a potentially crashing native reproduction and inspect the
debuggee's exit status, not merely LLDB's status:

```sh
NOVA_SPRITE_CAPTURE_DIR="$PWD/build-sprite/sprite-evidence" \
./scripts/with-toolchain.sh lldb --batch -o run -o 'process status' \
  -k 'thread backtrace all' -k 'process kill' -- \
  build-sprite/nova_sprite_widget_tests.app/Contents/MacOS/nova_sprite_widget_tests \
  authoredRoundTripAndCaptures
```

Omit the final test-case argument only on an unlocked, uncontested desktop to
exercise the stronger full-native gate. Do not unlock the machine or change
security settings for automation. No successful Cocoa input claim follows from
the exposed-layout test.

The isolated component checkpoint passed the three focused selectors in Debug
and in an ASan/UBSan build of the project C/C++/Objective-C/Objective-C++ code
and native dependencies (installed Qt/system frameworks are not instrumented;
macOS leak sanitizer is disabled). A fresh `NOVA_QT_SPRITE=OFF` build passed
core/project/CLI/lifecycle-patch checks; the launcher linked only native system
frameworks, not Qt.

Final exposed Cocoa layout/authoring and resize/scale dialog captures completed
under LLDB with debuggee exit 0. The separate native focus/accessibility case
returned debuggee exit 1 with the explicit locked-desktop diagnostic. That is a
retained validation blocker, not a component test pass. The user explicitly
deferred native input verification for this bounded component handoff; the
strict assertions remain unchanged for the later unlocked-desktop check.
Reproducible captures and logs are generated under the ignored `build-sprite/`,
not committed as claims of final integrated acceptance.
