> **Archived (2026-11-02):** describes a Qt component of the previous architecture. The Qt/C++ code is not carried forward (it remains in git tag `archive/copilot-studio-2026-11`). Kept only for the document models, limits and test ideas it records; the new editors are specified in `TODO.md`.

# Embeddable short-SFX document and waveform workspace

`authoring/sound/` is the next **bounded, desktop-only Sound component**, not the
complete Sound Studio. It adds owned editable sound sources, nondestructive
waveform editing, layered procedural/sample effects, original editable presets,
native-engine rendering and an injected audition interface. It does not create
another application, OpenGL context, audio device, project writer or runtime
format. The Scene/Code shell does not yet expose it.

The implementation uses the existing A0 `audio/audio.h` program API. It does not
silently replace the DSP with a UI synthesizer or assume future production
effects. Native games, Lua and Android remain Qt-free. No GameStudio/Glow43
code, data, assets or dependency is involved.

## Build and verification

Qt Base >=6.5 is required only when `NOVA_QT_SOUND=ON`. Verification used the
already installed Homebrew Qt Base **6.12.0**, AppleClang 21 and the existing
pinned C11 audio engine. No new package, Qt Multimedia module, SDK or audio
backend was installed.

```sh
./scripts/with-toolchain.sh cmake -S . -B build-sound \
  -DCMAKE_BUILD_TYPE=Debug -DNOVA_QT_SOUND=ON \
  -DNOVA_GPU_TESTS=OFF -DNOVA_AUDIO_TESTS=OFF \
  -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qtbase
./scripts/with-toolchain.sh cmake --build build-sound --target \
  nova_sound_document_tests nova_sound_audio_tests \
  nova_sound_widget_tests nova_sound_native_host_tests -j 4
./scripts/with-toolchain.sh ctest --test-dir build-sound --output-on-failure \
  -R '^nova_sound_'
```

`nova_sound` links Qt Core/Gui/Widgets and `nova_audio`, not a renderer/device
host. `nova_sound_native` additionally links `nova_audio_native`; its final
consumer must link **exactly one** caller-selected patched raylib host. For the
Qt application that is its existing Qt-hosted raylib, not GLFW raylib.
`nova_configure_raylib_audio` must have been applied to that host. The component
does not select either backend or close the shared device.

The five selectors cover the document, real rendered audio, offscreen controls,
native-adapter seam and host-neutral linkage. Coverage includes:

- Strict source round trips, original byte preservation, exact region frames,
  named undo/redo, immutable snapshots surviving their document, reserved IDs,
  invalid/truncated sources, limits, and foreign/stale/reopened acknowledgements.
- Exact A0 program equivalence; asymmetric stereo trim/reverse/fades through the
  final frame; the actual one-frame sampler edge behavior; original-rate
  44.1-to-48 kHz mono conversion; PCM24/16 fidelity; deterministic presets and
  dither; clipping errors, cancellation, and asynchronous ownership transfer.
- Actual QWidget mouse/key/IME events, source-frame fields and waveform drag,
  selection/zoom, mute, pending fields, stale fields across reopen, scrolling,
  host actions, settings precision/reopen guards, cancellation/stale export
  delivery and teardown during work.
- Play-only host activation, receipts rather than optimistic playing state,
  queued Stop, polling failure, unavailable hardware, close-retry ownership
  including a failed open, and retirement transfer on destruction.

The same five selectors pass with the component and native C audio code built
under AddressSanitizer/UndefinedBehaviorSanitizer. LeakSanitizer is disabled on
macOS; this is not an LSan or whole-Qt-internals claim. The existing DSP,
transport, allocation-failure/balance and C++ contract tests also pass.

When `NOVA_QT_STUDIO` is also enabled, `nova_qt_sound_host` uses this component's
actual codec/compiler with `ProjectDocument` and the Qt-selected native runtime.
It covers default PCM24 and float32 publication, native preflight, exact
participant/revision/digest acknowledgements, source-only retention of the old
WAV/metadata, guarded discard/reload without a saved acknowledgement,
stale-output Run readiness and reopened component identity.
No native audio device is opened. This is a persistence consumer, not a claim
that the actual Studio shell or native input is integrated.

`build-sound/sound-evidence/` contains actual **offscreen QWidget captures**:
1000x540 central content, 900x480 compact content in both palettes, and embedding
in a 1280x720 test shell with a project dock. The captures were inspected; host
Save/Import/Export and fixed Apply/Reset remain visible, while properties scroll.
These are not native-compositor, active-window, human IME/VoiceOver, novice,
hardware-audio, latency or performance qualification. No audio device or
microphone was activated. The desktop remained locked.

Future native GUI checks must use `tests/qt_native_test.cmake` on macOS and check
the debuggee exit. Do not bypass focus assertions, unlock the desktop, or change
OS security settings. Production file selection belongs to host-native panels;
the component has no file dialog and changes no application-wide dialog flags.

## Exact bounds and format

| Resource | Bound |
| --- | --- |
| Layers / preserved originals | 8 / 8 |
| Output composition | Stereo, 44100 or 48000 Hz; default 48000; at most 30 seconds including tails |
| Each original | Existing canonical WAV profile: <=60 s, <=16 MiB, mono/stereo, original 8000..48000 Hz, PCM8/16/24 or finite float32 within +/-16 |
| All retained originals | <=60 seconds and <=32 MiB of original WAV bytes |
| Editable source | <=33 MiB, strict binary `.nova-sound` v1 |
| Each derived WAV / metadata | <=16 MiB / <=64 KiB |
| Undo/redo | 64 named commands; <=128 MiB accounted document/history storage including active, saved and acknowledged-derived media baselines |
| Prepared sample layers | Existing engine <=120 seconds total, counting repeated materialized regions; failure retains editable sources |

The 128 MiB accounting includes original WAV bytes, decoded float payloads and
conservatively charged state metadata. It is not a process-RSS promise:
allocator/Qt/thread overhead, waveform caches, native compilation/render
candidates and **externally retained snapshots/export values** are separate.
Hosts must budget and release their retained values. Samples are decoded at
their original rate/channels and immutable shared media avoids copying their
payload for every parameter edit. Oldest history is evicted with a notification,
including at the byte boundary during undo/redo; saved/derived baselines are
never made falsely clean to accommodate an edit.

Import accepts the core's existing 60-second/16-MiB original envelope. An
original longer than 30 seconds is retained **whole** without an implicit layer. Select an
explicit <=30-second original-frame region and choose **Add region**. Import
also preserves an otherwise valid one-frame original or an original imported
when all layer slots are occupied, without pretending a playable layer exists.
A layer needs at least two output frames because of the engine's ON/OFF/edge
contract. No import is silently truncated, relabeled, normalized or converted
to a lossy source. Noncanonical WAV chunks/codecs fail explicitly using the
existing decoder; this does not add a general-purpose audio importer.

### Binary `.nova-sound` v1

Integers are unsigned little-endian 32-bit values; reals are IEEE binary64
little-endian; booleans are exactly 0 or 1. Text is a length-prefixed UTF-8 byte
string, at most 96 bytes, without control characters. Unknown versions/flags,
invalid enums/nonfinite numbers, duplicate IDs, bad references, invalid UTF-8,
truncation, trailing fields and limit violations fail without replacing the
current document.

Ordered contents:

1. Eight magic bytes `NVSOUND\0`, version `1`, reserved flags `0`.
2. Canonical lowercase document UUID without braces, name, output rate, master
   gain, next/reserved ID, original count, layer count.
3. Each original's ID, name and length-prefixed **verbatim canonical WAV bytes**.
4. Each layer's ID, name, A0 source enum, enabled flag, output start/duration,
   gain/pan, start/end Hz, sweep flag, seed, attack/decay/release frames, sustain,
   low-pass Hz, original ID, original begin/end frames, fade-in/out frames,
   reverse flag.
5. A 32-byte SHA-256 of every preceding byte, for corruption detection, not
   authentication. `SourceValue::sha256` hashes the **complete file**, including
   that internal checksum.

Original and layer IDs share a nonzero monotonic namespace. Undo does not reuse
IDs. Reserved-ID high-water advances are serialized: undoing an identity-creating
operation can leave a source/derived-metadata change to save even when the audio
content is restored. Ordinary property undo can return to a clean saved state.
The persistent UUID and IDs survive reopen; the transient open-session UUID and
monotonic revision number deliberately do **not**. A new open cannot validate an
acknowledgement or pending edit issued by an earlier open with the same revision.

## Editing and compilation semantics

The source is authoritative; generated WAV/metadata and mix waveforms are
disposable values, not the document. Selection, scroll/zoom, visible waveform
mode and audition position are view state, not persistent edits.

Layer Start, synth duration/ADSR and pitch-sweep times use integer **output**
frames. The UI displays milliseconds and rounds an edited time to the nearest
output frame; unedited fields preserve their precise stored values. Changing
output rate explicitly rounds each output-time field to the nearest new frame
while leaving original-source frames and bytes unchanged. The resulting state
must still validate; an invalid conversion does not partially apply.

Sample trim is `[begin,end)` in **original source frames**. Fade lengths are
also original-source frames, must not overlap, and follow playback direction:
select the region, reverse its frame order if requested, then apply its fades.
For a fade of N >=2 frames, the endpoints are exactly 0 and 1 (fade-in) or 1 and
0 (fade-out); a one-frame fade zeros that endpoint. Stereo channels are never
swapped. Temporary edited floats retain original rate/channels and feed the
existing 64-tap sinc sampler at unity pitch. The original waveform remains
clearly labeled unchanged; **Mix** displays the actual native-rendered output.

The A0 sampler still imposes one output frame of attack/release and its
one-shot boundary rules: the first output sample is zero, the final rendered
frame is not an invented extra zero, and resampling/filter edge behavior is
the engine's actual behavior. This is not byte-identical PCM pass-through.
Waveform and audition tests assert these edges, including through the last
asymmetric stereo frame. Audition additionally has a 5 ms transport fade-in/
crossfade and Stop requests a 10 ms cancellation fade; offline export does not
add those audition-only transport fades.

Sine/saw/square/triangle, seeded noise, gain/pan, ADSR, linear-Hz pitch sweep and
one-pole low-pass compile directly to `NovaAudioPatch`, notes and events. White
noise has a seed, not a fictional pitch. Each layer is a single one-shot voice;
there is no voice stealing. Master gain is the engine's root-bus gain. Muting
omits a layer's voice, not its authored extent: output ends at the greatest
authored layer end. Rendering an empty/all-muted document is an explicit error.

Soft confirm, Bright pickup, Soft impact and Rally air brake are original
editable two-layer recipes, not opaque recordings or canned exported sounds.
They do not claim a comparative listening study or finished rally soundtrack.

Rendering uses `nova_audio_write_wav` with a bounded checked in-memory sink.
PCM16/24 optionally use the engine's seeded TPDF dither. Integer clipping fails,
never saturates/normalizes. Float exports retain headroom within the runtime's
finite +/-16 source profile; exceeding that profile fails explicitly. Output is
native-decoder-verified before delivery. Peaks/over-range counts are sample
peaks before device processing, not true-peak/loudness analysis.

## Host integration and persistence API

`Document` is a serialized GUI/control-thread owner. `state()` returns an owned
immutable state. `snapshot()` is an inexpensive immutable `SnapshotPtr` containing
state plus `{session, document, number}` provenance; it survives destruction of
the document. Imported bytes are copied into owned storage even if the caller
supplies a borrowed `QByteArray::fromRawData` view.

```cpp
auto snapshot = workspace.prepareSnapshot(error); // Refuses unapplied fields.
if (!snapshot) return;
auto source = nova::sound::sourceValue(snapshot, error);
if (!source) return;
// Feed source->bytes to the HOST's guarded project journal.
// Only after durable success:
if (!document.markPersisted(*source, nova::sound::SaveIntent::SourceOnly, nullptr, error))
    return;
```

For derived audio, call `Workspace::requestExport(ExportSettings, error)` and
handle `exportReady(ExportPtr)`. The immutable value provides:

| Field | Meaning |
| --- | --- |
| `source` | Matching `SourcePtr`, source bytes and full-file SHA-256 |
| `wav` / `metadata` | Separate generated file payloads, with no destination paths |
| `rate` / `frames` / `settings` | Exact output profile/length/encoding/dither |
| `peak` / `overFrames` | Native pre-device sample-peak evidence |
| `waveform` | Owned decoded **generated** audio, distinct from original media |

Metadata is UTF-8 JSON with `format: "nova-sound-render"`, version 1, document
UUID, complete-source SHA-256, rate, stereo channel count, exact frames, encoding,
dither/seed, peaks/over-range count and explicit nonlooping length policy. It is
not a new engine manifest or Lua contract.

After the host durably commits matching source/WAV/metadata, call:

```cpp
if (!document.markPersisted(*output->source,
    nova::sound::SaveIntent::PublishDerived, output.get(), error))
    return;
```

The host must check every returned failure. `SourceOnly` rejects a derived
acknowledgement and retains the prior generated baseline; stale output remains
explicit. `PublishDerived` requires a successful render of the exact source
revision/hash. Foreign documents, older revisions and previous opens are
rejected even when bytes or numeric revision counters happen to match. Reopen
conservatively marks generated audio unverified/stale; it does not inspect a
host's existing WAV or invent persistence success.

No component API writes a source, export, original, cache, manifest, recovery
file or journal. No `.wav` registration is assumed from Sprite/Mesh transaction
support. Host integration must separately provide contained paths, exact disk
guards, source-only/derived intents, aggregate/file/participant budgets,
recoverable multi-file commits and recovery, project preflight, audio declaration
registration and conflicts with existing generated output. `markPersisted`
is an acknowledgement of that real transaction, not permission to bypass it.
Do not pass old recovery completion as a successful save of a newer draft.

`Workspace(Document&, AuditionHost*, QWidget*)` embeds in the central area,
without a forced standalone-window minimum. Its 720x400 hint allows a host
layout; the verified usable compact surface is 900x480. `setHostActions` binds
the host's existing Save/Import/Export `QAction`s without changing their enabled
state or intercepting them. Those handlers must call `prepareSnapshot` or
`requestExport` to respect pending fields. `importWav(bytes,name,error)` consumes
host-selected bytes; selection/pickers are host-owned. Inspector Apply/Reset
remain fixed while properties scroll. Keyboard/IME/native text editing and Qt
accessibility interfaces remain intact.

## Async rendering, audition and teardown

Each `RenderJob` owns one worker and at most one result. A job compiles entirely
independent native samples/programs/renderers from immutable values. No mutable
native reference count is shared with another worker or a live audition. WAV
output checks cancellation every 512-frame sink block; sample preparation checks
between bounded chunks and before/after the existing bounded table preparation.
Preparation itself is not a realtime callback.

Export completion is delivered only when its immutable revision is still current.
Cancelled, failed or superseded candidates are discarded without overwriting the
prior waveform or emitting `exportReady`. Preview refresh coalesces to the newest
revision. `RenderJob` transfers an audition program's sole control ownership only
after joining its finished worker. Destruction cancels/joins pending work; it does
not leave callbacks accessing dead widgets. Core rendering still performs no
allocation/I/O/locking/logging/Lua.

Preparing, opening a document, importing, selecting, painting a waveform or
constructing any widget/adapter **never opens hardware**. Only explicit Play
starts audition preparation and then requests `AuditionHost::open`. The shipped
`NativeAuditionHost` hardcodes the existing `NOVA_AUDIO_AUDITION` role. It never
opens Game, a third role, an alternate Qt backend or global shutdown.

The host is a testable seam for open/replace/cancel/poll/close. Replace/Stop
submission means queued, not playing/stopped. Poll drains bounded receipts,
collects retired renderers through the native adapter, and reads coalesced
snapshots; receipts confirm state. The UI exposes rendered score position,
cumulative pre-device peaks and actual host diagnostics. Device configured periods
and observed callback size are separate. Software starvation is **not applicable
to prepared memory scores**, not a fabricated zero hardware-xrun count. Hardware
xruns and latency remain unavailable.

Document edits do not silently replace a playing score: its older revision is
explicitly labeled, and Play requests a newly prepared score. Failed staging
retains the owned previous stream with an error. On a stopped/unavailable
callback, polling errors trigger explicit per-role close rather than waiting
forever for a receipt.

`Audition::shutdown(error)` closes only its owned handle. `RETIREMENT_PENDING`
retains it for another close, including when a failed open exceptionally returned
an owned handle. `SOURCE_FAILED` after native descriptor close means ownership
ended, but its diagnostic is still reported. Other uncertain close failures
also retain ownership rather than guessing it was freed.

The host must outlive the controller/widget. `NativeAuditionHost` requires an
`AuditionRetirementOwner`: if destruction cannot finish retirement, ownership
is transferred to `retainAuditionHandle(handle)` after reporting the failure.
That application-owned queue must keep the numeric handle and retry
`nova_audio_device_close` on its serialized control owner; it must not discard
the handle, close the Game role or close the shared device. Normal application
audio-device shutdown still occurs only after all resource owners and retained
retirements have finished.

## Remaining stages

This component does **not** implement recording/microphone permissions, sample
splits/multiclip arrangement, loop editing/crossfades, time-stretch or sample
pitch, piano roll, pattern/drum sequencing, MIDI, multitrack disk media, mixer
inserts/sends/automation, live production-effect meters, stems, or interactive
music bindings. Long streamed music/recordings need a separate pinned-media
persistence model; the A2 one-hour disk stream is not a byte-snapshot document
format. Do not embed hours of PCM in this source or relax runtime budgets.

Still required: final Scene/Code shell and project-journal integration, native
input/compositor and audible-device qualification, fuller Sound production and
runtime binding, portable application delivery, and the playable **3D rally
racer built, saved, reopened, run and exported through all Nova tools**. Neither
this component nor its generated test sounds completes the full Sound Studio
or that acceptance exercise.
