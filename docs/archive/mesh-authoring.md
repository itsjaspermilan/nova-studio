> **Archived (2026-11-02):** describes a Qt component of the previous architecture. The Qt/C++ code is not carried forward (it remains in git tag `archive/copilot-studio-2026-11`). Kept only for the document models, limits and test ideas it records; the new editors are specified in `TODO.md`.

# Editable mesh component

`authoring/mesh/document.hpp` provides the desktop-only `nova::mesh` C++17
document library. This is a working geometry/source/export component, **not an
integrated Model workspace**. It does not create controls, a window, a renderer,
a graphics context, a journal, or files. The existing primitive modeller and
its `nova-model` v1/v2 C API are unchanged.

The retained [Model Studio specification](ux/nova-studio-ux-assessment.md#12-model-studio)
remains the integration target. An executable test harness is not evidence of
beginner usability, native picking/gizmos, accessibility, or the complete 3D
rally creation exercise.

## Build and dependencies

The component is opt-in and excluded from the Android CMake branch:

```sh
./scripts/with-toolchain.sh cmake -S . -B build-mesh \
  -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qtbase \
  -DNOVA_MESH_AUTHORING=ON -DNOVA_GPU_TESTS=OFF -DNOVA_AUDIO_TESTS=OFF
./scripts/with-toolchain.sh cmake --build build-mesh \
  --target nova_mesh_tests nova_mesh_ownership_tests nova_model_tests nova_textured_model_tests -j 4
./scripts/with-toolchain.sh ctest --test-dir build-mesh --output-on-failure \
  -R '^nova_(mesh_.*|model|textured_model)$'
```

`cmake/MeshAuthoring.cmake` declares Qt **6.5 or later, Core only** for Unicode,
owned byte arrays, JSON and SHA-256. Development was verified with the already
installed Homebrew `qtbase` **6.12.0_2**, reporting Qt **6.12.0**. No packages
were installed for this component. It does not require Qt Gui, Widgets, Test,
OpenGLWidgets, or Qt on Android.

`nova_mesh` links **only Qt6::Core**. Runtime/raylib/cgltf headers are private
compile-time inputs; decoder and image-release symbols intentionally remain
unresolved in the static archive. Each consumer must supply exactly one native
host: CPU/CLI tests explicitly link `nova_assets`, while the Qt workspace must
link `nova_qt_runtime` and `nova_qt_raylib`. Both hosts use the same runtime
PNG/GLB decoder and pinned raylib 5.5/cgltf implementation; there is no second
import library or PNG codec. Do not add even a `PRIVATE nova_assets` dependency
to `nova_mesh`: CMake propagates static-library link requirements, bringing
ordinary GLFW/rcore into the Qt process and violating single-context ownership.

Nova-authored component code remains MIT. Qt Core is available under
[LGPLv3 or a commercial license](https://doc.qt.io/qt-6/licensing.html), with
additional [upstream third-party notices](https://doc.qt.io/qt-6/licenses-used-in-qt.html).
The Homebrew Qt framework is dynamically linked, not copied into this tree.
Desktop distribution must preserve applicable Qt notices/source availability
and replacement/relinking rights; this optional library build is not a Qt
redistribution package or a new runtime licensing decision.

## Document, selection and ownership

`State` contains objects, organizational groups, materials, embedded opaque
PNG textures and exact imported originals. IDs are nonzero `uint32_t` values
unique across every category, including vertices and faces. `nextId` is a
high-water mark. Object vertices are stored in ascending ID order. Names are
Unicode, bounded to 128 UTF-16 code units / 512 UTF-8 bytes, without controls.
Names need not be unique; references always use IDs.

Each object has:

- A name, optional group and optional retained-original ID.
- A world-space origin, and vertices relative to that origin.
- Ordered polygon faces, material IDs, and per-corner UVs and optional normals.

An object origin is a modelling pivot, not another scene transform. Moving the
origin preserves world geometry. Groups do not create scene entities, nested
transform hierarchies, or runtime contracts. A new primitive has one-unit
extent/diameter, centered at the origin; the plane is a one-unit XZ square.
Coordinates are Y-up and use the runtime's world units without implicit scale
conversion.

`Selection` names Object, Vertex, Edge or Face mode. Object mode can select
multiple objects. Component modes target one object. Edge identities are
ascending endpoint-ID pairs, validated against actual polygon edges.
`selectionStatistics` gives selection bounds and actual geometry counts.
`Preview` contains native-float-precision triangles with object, face, vertex
and material IDs, UVs and normals. Use source face loops for editable edge
overlays, **not triangulation diagonals**.

`Document::state()` returns `shared_ptr<const State>`. Published states deep-own
incoming strings/bytes, including `QString::fromRawData` and
`QByteArray::fromRawData` inputs; later changes to the caller's backing memory
cannot change a document. Imported images and native CPU model buffers are
temporary, separately released decoder resources, never borrowed GPU handles.
Returned state/byte snapshots remain valid after later edits or document
destruction.

`Document` is single-owner, not internally locked. Capture immutable values on
its owning thread; workers may process those values, not mutate the Document.
Revision comparisons reject obsolete results but are not a mutex. Selection
changes do not make source dirty or increment the content revision.

## Implemented operations and their boundaries

Every successful destructive operation is one named undo command. Failed
operations leave state, selection, revision, dirty state, output parameters
and history unchanged, with a nonempty `QString` diagnostic.

| Operation | Exact supported behavior |
| --- | --- |
| Primitives | Box, XZ plane, pyramid, cylinder with 3..32 sides, low-poly sphere with 8..32 longitude segments and half as many latitude divisions. Editable vertices/polygons, not retained primitive guesses. |
| Transforms | Translation, XYZ Euler rotation (X then Y then Z) and positive nonuniform scale about a world pivot. Object, vertex, edge and face selections affect real vertices. Non-planar polygon results are rejected with an instruction to triangulate first. |
| Snap | Object origins move rigidly to a world grid. Component vertices snap individually; collapsed or invalid faces are rejected. |
| Duplicate/group/origin | Duplicate selected objects with new IDs and a world offset; group/ungroup without changing geometry; explicit origin, bounds-center or ground-center placement. Duplicates retain their original/material links. |
| Delete | Object deletion removes those objects. Face deletion removes those faces. Vertex/edge deletion removes their incident faces, then unused vertices and empty objects. This is deletion, not an advertised edge-dissolve tool. Originals are retained. |
| Extrude | One connected coplanar consistently oriented face region with one simple boundary. The cap moves by a signed normal distance; boundary walls are created, with no internal walls between selected faces. Holes, pinches and disconnected regions are rejected. Cap face IDs remain selected for repeated extrusion. |
| Inset | A true constant-distance planar offset of one convex face, with an inner cap and surrounding faces. UVs interpolate on the original triangulated surface. Crossing, collapsed or reversed inner edges are rejected; this is not centroid scaling. |
| Bevel | One sharp edge on a closed, outward-oriented convex solid, up to 4,096 vertices/faces. A bisector-plane cut clips the solid and creates an actual chamfer face. Depth must be less than half the distance to the next existing vertex; the cap must have 3..32 corners. This is not a general multi-edge, rounded, or concave-solid bevel. |
| Cut | A diagonal between two existing, nonadjacent vertices of one convex face. Corner data is retained. Arbitrary freehand knife/loop-cut tools are not implied. |
| Subdivide | Triangles split into four triangles; convex n-gons split into corner quads. Shared midpoint vertices and inserted corners on unselected neighbors prevent T-junctions. Neighbors that would exceed 32 corners are rejected. This is linear subdivision, not smoothing. |
| Triangulate | Ear clipping of simple planar polygons, including concave faces. Stable vertex IDs choose ears, so affine transforms and mirroring do not change UV-interpolation diagonals. |
| Mirror | Reflect whole objects, optionally duplicated, about an axis-aligned world plane. Reverse winding and reflect authored normals, keeping corner UV/vertex correspondence. No automatic joining/welding. |
| Normals | Flip selected faces and authored normals, or explicitly recalculate flat normals. Full affine transforms use inverse-transpose normals. Partial-face geometry transforms clear affected authored normals; new inset/wall/bevel-cap faces are flat. Subdivision/intersections interpolate authored normals; cancellation is rejected rather than silently replacing them. |
| Weld | Explicit exact-position welding of selected vertices. Corner UVs/normals remain distinct. Collapsed faces, branching boundaries, disconnected vertex fans and non-manifold edges are rejected. Imports are never implicitly welded. |
| UVs | Edit each corner, affine UV translation/rotation/scale including reflection, planar axis projection, or deterministic aspect-preserving face-island grid unwrapping with 0..25% padding per cell. Values outside 0..1 fail; there is no silent wrap/clamp of user edits. Generated projections remove only boundary roundoff. |
| Materials/textures | Opaque unlit RGB base-color factors with optional shared PNG. Exact-byte texture imports reuse an existing texture ID. Material assignment, named materials/textures and texture-byte replacement are undoable. Referenced materials/textures cannot be deleted until explicitly unassigned. No painting implementation is duplicated here. |

Faces must be simple and planar, with no repeated/collapsed corners or
degenerate final triangle, and must remain representable at native float
precision. Each edge has at most two incident faces and each vertex has one
connected face fan. A face has either authored unit normals at every corner,
or flat normals at every corner. Mixed/inconsistent winding is representable
so users can explicitly correct normals, but operations requiring a consistent
surface reject it.

Polygon and manifold validation is not a whole-model intersection/Boolean
solver: separate surfaces may overlap. There is no automatic self-intersection
repair, arbitrary topology healing, sculpting, rigging, PBR, bones, skinning,
animation, detailed texture painting, or general seam-optimized UV unwrapping.
The host must expose these actual modes/constraints, not nonfunctional buttons
for a larger modeller.

## Strict editable source

The new source is **`nova-mesh` version 1**, conventionally `.nova-mesh`.
It is a separate schema, never an in-place replacement for `.nova-model`.
It uses UTF-8 JSON with fixed-array records. Exact arities and types are checked;
unknown fields/versions, JSON objects in place of records, malformed base64,
bad IDs/references, invalid Unicode/numbers/topology/resources and trailing
data fail atomically. Arrays avoid JSON duplicate-key overwrite semantics.

The complete schema is:

```text
["nova-mesh", 1, nextId, groups, textures, materials, objects, originals]
group    = [id, name]
texture  = [id, name, canonicalBase64Png]
material = [id, name, red, green, blue, textureIdOrZero]
object   = [id, name, groupIdOrZero, [originX, originY, originZ],
            vertices, faces, originalIdOrZero]
vertex   = [id, localX, localY, localZ]
face     = [id, materialId, corners]
corner   = [vertexId, u, v, null | [normalX, normalY, normalZ]]
original = [id, name, canonicalBase64Glb, lowercaseSha256Hex]
```

Serialization is deterministic compact JSON with one trailing newline.
`parseSource` and `serializeSource` publish their output only on success.
Empty documents can be saved as source; runtime export requires geometry.
Undo history, selection, window state, document UUID and revision are not
serialized.

An explicit GLB import adds editable objects and retains the exact original
bytes. New objects reference that retained original. Editing, duplication,
undoing the import, deleting geometry, or branching history never discards
that archive. Consequently, undoing an import/creation can leave source dirty:
retained originals and allocated-ID high-water marks are intentional persistent
changes even if the visible geometry returns to an earlier state.

Legacy v1/v2 parsing, serialization, texture resolution and GLB export remain
the responsibility of `authoring/model.{c,h}`. An explicit conversion can export
that source with the existing C API, then import those GLB bytes as a **new**
mesh document. The host must also retain the legacy `.nova-model` source;
this component does not guess primitives or overwrite that source. It retains
the imported GLB, not an unprovided legacy document.

Texture inputs are the current embedded PNG resource bytes, not a second
editable raster document. Replacing them is undoable, but the host must retain
the original external PNG or Sprite source independently; no such input file
is written or deleted by this component.

## Native GLB fidelity

Import first runs `nova_decode_glb_images`, the actual runtime validation and
CPU decoder. Pinned cgltf then supplies original index identity and metadata.
Native-decoded transformed positions and UVs are used verbatim. Each
node/primitive becomes an independent editable triangle object; hierarchy,
node transforms and mirrored instances are explicitly baked. Index identities
within that primitive are retained. Unindexed data stays unindexed until the
user explicitly welds it.

Authored normals are normalized after inverse-transpose transformation, with
handedness/winding accounted for. Nonfinite, zero, uncovered or untransformable
normals are rejected even though the unlit runtime does not use normals for
lighting. Editable import also rejects degenerate/non-manifold geometry that
the renderer alone might accept. Failure does not adopt even part of an
original or modify an existing document.

Export creates normalized, unindexed triangles split by object/material and
the native per-primitive vertex limit. It includes normals, per-corner float
`TEXCOORD_0`, opaque unlit base colors, embedded original PNG bytes, and explicit
nearest/clamp samplers, then validates the complete result with the actual
native decoder. Material color factors follow the runtime's float-to-RGB8
quantization; a future viewport must not substitute a lit/PBR-looking preview.

The runtime snapshot does not preserve polygon boundaries, editor groups,
unused material definitions, scene-node hierarchy or binary buffer layout.
That information belongs in editable source and/or the untouched archived
original, not a claim of byte-identical GLB reproduction. The supported rendered
geometry, oriented triangles, base-color appearance, embedded pixels and UV
correspondence are round-trip tested, including final triangles of transformed,
mirrored, aliased, textured and untextured primitives.

## Budgets and host save contract

| Resource | Enforced limit |
| --- | --- |
| Persisted editable source | 64 MiB total, including base64 PNGs/originals; adoption/serialization fail rather than truncating |
| Runtime output inventory | One GLB, at most 16 MiB including embedded PNGs; no external binary sidecars |
| Objects / organizational groups | 128 / 128 |
| Geometry | At most 262,144 vertices and 262,144 expanded triangle vertices; 3..32 corners/face |
| Runtime batches | At most 128 object/material chunks, each at most 65,535 expanded vertices |
| Material definitions | 256 in source; only referenced materials appear in the at-most-128 runtime batches |
| Textures | 16 PNGs, each <=1 MiB and 1..1024 pixels per dimension; combined <=4,194,304 decoded pixels; every pixel opaque |
| Retained originals | At most 8 GLBs, combined <=16 MiB |
| Undo | At most 64 commands and 128 MiB of conservatively charged before/after state payload; oldest commands expire at those bounds |

The runtime's shared 16,777,216 project sprite/model pixel budget still requires
whole-project preflight. This component cannot budget other assets.

`Document::snapshot(includeGlb, error)` returns `shared_ptr<const ByteSnapshot>`:

```cpp
struct ByteSnapshot {
    const QUuid document;
    const std::uint64_t revision;
    const QByteArray source;
    const QByteArray sourceSha256; // Raw 32-byte SHA-256 of exact source bytes.
    const QByteArray glb;
};
```

`snapshot(false, error)` supplies source even when derived GLB export is over
budget. `snapshot(true, error)` fails explicitly if either output cannot be
produced; it does not disguise a previous GLB as current output. All bytes are
owned values; the host never frees a raw component allocation. A maximum
current asset inventory needs **80 MiB** (64 MiB source + 16 MiB GLB), excluding
index/journal metadata. Reserve **160 MiB** if a transaction retains full old
and candidate generations simultaneously.

The document UUID distinguishes live document instances; monotonic content
revision increases on edits, undo and redo. Reopen creates a new UUID/revision;
the canonical source digest is durable across reopen. `commit` accepts a
complete candidate plus selection and expected revision, enabling a host to
prepare a drag in a temporary document and publish it as one named command.
It refuses stale revisions and changes to existing archived originals.

Only after the host's guarded write succeeds should it call
`markPersisted(snapshot, error)`. A foreign UUID or older revision/digest is
rejected without clearing newer source dirty state. This is **not** evidence
that files were written; the component performs no file I/O.

Source-only save may clear source dirty state while preserving a previous valid
GLB. The host asset index must separately record the generating source digest,
retain that prior output set, and visibly mark it stale with the current export
diagnostic. Do not equate clean editable source with an up-to-date game asset.

## Remaining integration requirements

The foundation's original three-text-document scene/Lua/manifest journal does
not become a mesh transaction merely by linking this library. Host integration
must register source/output identities, exact disk snapshots and digests,
no-clobber creation, external-change decisions, source-only/stale-output state,
recoverable multi-file writes, and crash recovery for the byte inventories
above. Native Open/Save/import pickers and dirty-close decisions belong there.

Build the Model tab inside the existing Qt shell with the retained Parts /
large viewport / contextual Inspector hierarchy, explicit selection modes,
polished labelled controls, independent inspector scrolling, Apply/Reset,
accessible numeric equivalents to gizmos and keyboard/IME semantics. Route
shared Undo/Redo to the active mesh Document; do not simultaneously record the
same operation in the project QUndoStack. Cross-document commands need an
explicit coordinator rather than two competing histories.

The existing single native viewport/context must stage candidate GLB resources,
use immutable IDs/geometry for picking and overlays, retain the previous live
resources on staging failure, and visibly distinguish stale preview from
current source. This library never uploads or renders a model. Scene asset
identity/placement, intentional asset refresh, Run/Stop and selected-project
export still need that shared integration. Runtime scene rotations are not
changed by baked mesh transforms here.

Final acceptance still requires original low-poly modelling through the actual
Qt controls, material/UV edits, source save/close/reopen, faithful native preview,
placement/use in the 3D rally project, Run and game export. No GUI captures,
device behavior, novice study, accessibility certification or performance
benchmark is claimed by these component tests.

## Verification

The four device-free suites are `nova_mesh_document`, `nova_mesh_native`,
`nova_mesh_capacity` and `nova_mesh_ownership`. They cover operation geometry
and volumes, conforming topology, failure atomicity, source strictness,
selection/undo/redo, stale/foreign save results, byte ownership, UV islands,
normal transformation and interpolation failures, exact native-decoded
triangle/UV/color/pixel correspondence, import-original retention, legacy
export compatibility and hard capacity boundaries.

`nova_mesh_host_linkage` checks the generated direct and interface link
properties are Qt6::Core only, guarding against an implicit renderer dependency.
CPU test executables select their ordinary runtime host explicitly; that link
choice is not part of the component's interface.

When both `NOVA_QT_STUDIO` and `NOVA_MESH_AUTHORING` are enabled,
`nova_qt_mesh_host` separately links the component to `nova_qt_runtime`, not
`nova_assets`. It creates a textured source, exports and decodes GLB geometry/
pixels, reimports the retained original and reopens the editable source using
the Qt-selected native host. It opens no viewport or audio device.

The capacity suite reaches **262,143 expanded vertices**, split into five
native primitives including a final three-vertex primitive, then verifies
rejection above the limit. It also checks the 64 MiB source cap, native texture
dimensions/pixel caps, a source-only asset whose embedded bytes exceed runtime
GLB size, and count/byte-bounded history.

The ownership executable recompiles only the native bridge and asset decoder
with test-local allocation/image seams. It checks exact acquired/released
buffer/image balance, plus 45 model-allocation and five image-load failure
points across import validation/adoption; production targets are unmodified.
Both those seams and the ordinary library run without a window or device.
These five tests and the two existing model/textured-model regressions pass in
ordinary Debug and fully ASan/UBSan-instrumented native builds. macOS leak
sanitizer is disabled; the explicit ownership counters supply the allocation
balance evidence. Installed Qt/system frameworks are not instrumented.
