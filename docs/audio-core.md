# Native sample-clock audio and shared-device foundation

This is a reusable Sound Studio backend, not a finished Sound Studio.
`audio/audio.h` is a C11 API with C++ linkage guards; link `nova_audio`.
It has no raylib, Lua, Qt, device, filesystem or third-party DSP dependency.
`audio/transport.h` adds bounded control/render transfer to that library.
`runtime/audio_device.h` supplies an explicit shared-device adapter; link
`nova_audio_native` and exactly one caller-selected patched raylib host.
The existing game `nova.play` / `nova.stop` service remains a separate,
compatible short-WAV playback path.

The implementation provides stereo float processing at **48 kHz** (the default
constant) or explicitly **44.1 kHz**, prepared sample-clock scores, independent
renderers, synth/sampler voices, envelopes and ramps, a small bus tree, meters,
and offline WAV rendering. The core does not record or open devices. Selecting
a sample does not start playback; the native adapter opens playback only when
explicitly requested. All fixtures and the demonstration composition are
generated from original code, not recordings or another application's assets.

## Build and reproduce

From the assigned Nova Studio checkout:

```sh
./scripts/with-toolchain.sh cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug \
  -DNOVA_GPU_TESTS=OFF -DNOVA_AUDIO_TESTS=OFF
./scripts/with-toolchain.sh cmake --build build --target \
  nova_audio_render nova_audio_tests nova_audio_wav_tests \
  nova_audio_allocation_tests nova_audio_cpp_tests nova_audio_transport_tests \
  nova_audio_device_tests nova_audio_lifecycle_tests nova_service_tests -j 4
./scripts/with-toolchain.sh ctest --test-dir build --output-on-failure \
  -R '^nova_(audio_(dsp|wav|allocations|cpp_contract|render_cli|transport|device_seam|source_patch|lifecycle_seam)|services)$'
./build/nova_audio_render build/audio-master.wav
./build/nova_audio_render build/audio-runtime.wav 44100 pcm24
```

The command generates an eight-second, four-instrument, three-bus original
fixture: filtered saw bass, triangle melody, a 32 kHz percussion sample, and
seeded noise. It writes exactly 384000 stereo frames at 48 kHz or 352800 at
44.1 kHz. The default master is IEEE float32 WAV; integer PCM24/PCM16 output
uses seeded TPDF dither. These are real renders, not an audible-device test.
No microphone, audio device, GUI or SDK installation is involved.

Output destinations must be new. The demonstration uses a same-directory
private candidate, checked write/flush/file-sync/close, then an exclusive hard
link to publish without replacing an existing path. Failure removes only its
candidate; cleanup failures and already-published outcomes are reported.
The command is a backend example, not the editor's document-save transaction,
and does not promise directory-sync/crash-recovery semantics.

## Preparation, ownership and threading

| Object | Ownership and lifetime |
| --- | --- |
| `NovaAudioSample` | Owns a copy of immutable interleaved floats at the original rate and channel count. Input memory may be freed immediately after successful creation. |
| `NovaAudioProgram` | Copies patches, buses and events, retains sample references, validates timing/routing/voice reservations, and builds oscillator/resampler coefficients before use. Source arrays may then be freed or changed. |
| `NovaAudioRenderer` | Retains a program and owns all voice, filter, ramp, RNG, clock, cancellation and meter state. It never writes shared samples/programs. |
| Offline exporter | Creates and destroys its own renderer; it never rewinds or otherwise disturbs an audition/game renderer. |

Creation returns `false` with a diagnostic on invalid input or allocation failure;
the caller's existing output object is unchanged. Releases accept null pointers.
Other getters/reset require a live object. Retain/release counts are not atomic:
serialize creation/destruction involving shared objects on the control side.
Reading/rendering immutable shared objects does not modify those counts.

Use **different renderers for audition and game preview**, even when their
program is shared. Cancelling one cannot stop the other. Release the caller's
program/sample references after successful renderer creation if desired; the
renderer keeps its dependencies alive. Destroy renderers only after their
callback is quiescent. No global current score, global voice pool, device owner
or singleton audition state exists in `nova_audio`.

`nova_audio_render`, `nova_audio_cancel`, `nova_audio_status`, and
`nova_audio_renderer_reset` operate on the **single render-owner thread**. They
perform no allocation/free, I/O, logging/diagnostic formatting, Lua calls,
reference-count changes or locking. Never call status or cancel concurrently
from Qt's UI thread. Use the transport's bounded commands and meter snapshots;
a UI lock around rendering is not a suitable adapter.

The render call accepts 0..4096 frames and writes interleaved stereo floats.
Split larger host requests into chunks. It processes no more than 32 voices,
8 buses and 4096 prepared events; it does not allocate according to block size.
Invalid arguments return `NOVA_AUDIO_INVALID_ARGUMENT` without advancing state
or touching output. A clock overflow or unexpected nonfinite DSP result returns
a distinct fault and zeros the unrendered portion of the block. The fault is
latched in status until reset. The host must report it outside the callback,
not silently treat silence as success.

## Exact time and voice rules

All event, envelope, ramp and score times are **integer output frames**, not
60 Hz simulation ticks or floating-point seconds. Convert musical positions
to absolute frames on the control side with an explicit tempo/rounding policy;
do not accumulate individually rounded beat durations.

- Events are sorted by frame. Array order is the tie-breaker at equal frames.
  An event is applied before rendering its designated frame.
- Note IDs are nonzero and unique for the whole score. Parameter/OFF events must
  follow their ON. Every note needs exactly one later OFF, even a one-shot sample.
- Release tails reserve voice slots. Preparation rejects excess concurrency;
  voices are never silently stolen. A slot ending at frame N can be reused at N.
  Events targeting an ended note or ramps extending past its tail are rejected.
- Score length is start-inclusive/end-exclusive and includes all release tails.
  A score may last up to **one hour**, independently of short-sample budgets.
  Nonlooped playback returns silence after that length; the output clock keeps
  advancing while the score position remains at its end.
- A looping program repeats `[0,length_frames)`, restoring initial bus state,
  note phase and noise seeds at the boundary. All voices must have ended there.
  The loop position is zero immediately after the final frame. This gives
  bit-identical repeated cycles, not automatic crossfading or a guarantee that
  arbitrary authored material is perceptually seamless.
- `nova_audio_cancel(renderer, fade_frames)` stops future score events/loops and
  releases active voices from their current levels. It does not lengthen an
  already shorter release. Repeated cancellation is idempotent. Fade duration is
  explicit and bounded; no hard-cut/voice-stealing cancellation is hidden.
- Reset returns the renderer, clock and meters to a deterministic initial state.

An attack of N frames has levels 0, 1/N, ... before reaching 1 at frame N.
Decay similarly reaches sustain at its exclusive end. OFF captures the current
envelope value, including a partially completed attack/decay, and releases to
zero over the specified frames. Attack/release cannot be zero; each envelope
stage is bounded to 60 seconds. A one-frame transition is valid but not a claim
of inaudibility. Use musically suitable attack/release times.

Gain, pan and pitch automation are linear ramps. At event frame F the old value
is used; at F+N the target is used. A new ramp starts at the old ramp's exact
current value, not its previous target. Phase, envelopes, ramps and RNG advance
once per sample, so output does not depend on host block boundaries. Bit identity
is tested within one build; different platforms' math libraries/compilers are
not promised to produce identical last-bit results.

## Instruments and DSP actually implemented

**Synth:** sine, saw, square, triangle and deterministic seeded white noise.
Periodic sources use 4096-point tables with 1..512-harmonic mip levels generated
from Fourier series during preparation. Adjacent safe levels blend continuously
as pitch changes; represented harmonics stay below a 0.45-times-rate guard band.
This intentionally trades some upper harmonics for bounded aliasing, particularly
at very low/high pitches. Cubic table interpolation is not ideal reconstruction;
the objective residual/alias checks below bound this implementation, not every
possible modulation spectrum. Periodic synth frequencies are 20 Hz..0.45 times
output rate. White noise uses a nonzero seed and frequency 0; pitch automation
is rejected rather than exposing a control that does nothing. No nonlinear
saturation processor or alias-prone waveshaper is exposed.

**Sampler:** mono/stereo original-rate float samples, explicit nondestructive
source-frame trim `[sample_start,sample_end)`, optional exact looping, and pitch
relative to a root frequency. Pitch ratios are 0.25..the patch's declared maximum
(at most 4). Preparation builds a 64-tap Blackman-windowed sinc reconstruction
table with 256 fractional intervals. Coefficients are interpolated per frame;
the source coordinate is an integer rational accumulator, with pitch in Q24.
Unity pitch preserves exact 44.1/48 kHz rational loop timing rather than rounding
each output increment. Input channels/rate are never relabeled.

The reconstruction cutoff is fixed for the patch's **maximum** source step:
0.5 source cycles/frame when that step is <=1, otherwise 0.45 divided by that
step. This prevents a pitching voice from selecting an unsafe filter or
switching filters abruptly, but a wide declared pitch range reduces bandwidth
at lower notes. Use the tightest needed maximum or distinct patches. This is
not time-stretching, formant preservation, disk streaming or an ideal resampler.

Loop filter taps wrap inside the selected source range. One-shot taps outside
the range are zero, never read from hidden trimmed material. One-shots also fade
over the last `release_frames * maximum_source_step` source frames, so even the
fastest allowed pitch has an end fade; slower notes have a longer fade, not
premature source truncation. Explicit note release still applies independently.
Arbitrary mismatched loop endpoints can click: loop crossfade editing and
seamless-loop validation are not implemented or implied.

**Filter:** an optional per-voice one-pole low-pass with a prepared coefficient;
0 Hz means bypass, otherwise 20 Hz..0.45 times output rate. It really processes
the signal, preserves independent stereo state and is covered by measured
frequency-response checks. It is not a resonant filter or a general effects rack.

**Mixer:** gain 0..4, equal-power pan for mono sources, stereo balance for stereo
sources and buses. Stereo center balance is unity, not a forced -3 dB reduction.
Each bus routes to a lower-index parent; bus 0 is Master. Reverse-order mixing
makes a bounded tree with no feedback cycles. Gain/pan ramps operate per frame.
There are no sends, insert chains, compensated-latency processors or solo rules
yet. Use distinct song buses versus eventual game Music/SFX/UI buses.

Mixing uses double accumulators and float output. Cumulative pre-device peak
and over-range-frame counters are available for every bus. Values above unity
remain in the output: **no limiter, saturation or loudness normalization is
applied**. Meters are sample peaks, not true-peak or loudness analysis.

## Minimal C / Qt-side use

```c
NovaAudioPatch patch = {
    .source = NOVA_AUDIO_TRIANGLE,
    .envelope = {240, 2400, 4800, 0.5f}
};
NovaAudioBus master = {NOVA_AUDIO_NO_BUS, 1, 0};
NovaAudioEvent events[] = {
    {.frame = 0, .type = NOVA_AUDIO_NOTE_ON, .target = 1,
     .note = {.frequency = 440, .gain = 0.2f}},
    {.frame = 24000, .type = NOVA_AUDIO_NOTE_OFF, .target = 1}
};
NovaAudioProgramDesc desc = {
    .sample_rate = NOVA_AUDIO_DEFAULT_RATE, .voice_limit = 8,
    .length_frames = 28800, .patches = &patch, .patch_count = 1,
    .buses = &master, .bus_count = 1, .events = events, .event_count = 2
};
NovaAudioProgram *program = NULL;
NovaAudioRenderer *renderer = NULL;
char error[512];
if (!nova_audio_program_create(&desc, &program, error, sizeof(error))) {
    /* Present error on the control/UI thread; retain the authored document. */
} else if (!nova_audio_renderer_create(program, &renderer, error, sizeof(error))) {
    /* Present error; the previous live renderer is still usable. */
}
nova_audio_program_release(program);
/* After success, transfer renderer to the render owner and render bounded blocks.
 * Quiesce that owner before nova_audio_renderer_destroy(renderer). */
```

For C++11/17 hosts, value-initialize structs and assign members rather than using
C designated initializers. `tests/audio_cpp_test.cpp` compiles, links and runs
against the C library without Qt. The host owns transport/document IDs and
keeps document identity distinct from the adapter's transient handle/program
tickets. No new manifest version or music-document schema is defined here.

## Live transport and shared-device integration

The transport and native adapter stream **prepared score rendering**, not files
from disk. Sample, score, event and voice limits above are unchanged. Audition
and game transports have independent clocks, cancellation and ownership even
when they retain the same program; they are not synchronized stem transports.
No sound document, automatic game binding, seek or pause/resume API is implied.

### Control, render and retirement contract

`NovaAudioTransport` has one serialized control producer and one render consumer.
Creation, command submission, receipt/snapshot reads, collection and destruction
are control-side operations. Only `nova_audio_transport_render` runs on the render
owner. Core status/cancel/reset remain render-owner calls made by that function,
not by the GUI. All sample/program retain/release mutations, including offline
renderer preparation and destruction, must remain serialized on the control side.

| Operation or limit | Contract |
| --- | --- |
| Fixed transport rate | 44100 or 48000 Hz; replacement programs must match. Reopen to change rate. Different transports may use different rates. |
| Command and receipt rings | 16 entries each, SPSC, always-lock-free unsigned atomics. A full command ring returns `QUEUE_FULL` without allocating or changing the output ticket. A full receipt ring pauses command consumption, not audio rendering. |
| Renderer ownership | At most 18 retained renderers: 16 pending candidates plus current and retiring. Candidates are created before publication. The render owner only marks retirement; the control side collects and destroys them. |
| `replace` | Enqueues a candidate and returns a monotonically increasing ticket, also its prospective transport-scoped program ID. A successful application crossfades at most one old renderer with the new one. An overlapping transition receives `BUSY`, retains the current score, and retires only the rejected candidate. |
| `CANCEL` | Names the expected program ID; stale controls receive `STALE`. Stops new events and releases voices without an immediate hard cut. Cancellation during fade-in freezes its current gain instead of jumping to unity. |
| `RESET` | Only accepted after the current score is finished/cancelled and no retiring tail remains. Restores that program's initial render state with a new fade-in. Cancel and await completion first. |
| Fade length | Explicit 1..rate*60 frames. Repeated core cancellation remains idempotent: an already-cancelled old tail may finish on its earlier schedule. A one-frame fade is not a perceptual click-free guarantee. |
| Snapshots | Nonblocking triple buffer. Intermediate publications may coalesce; `publication` exposes gaps. Snapshots contain complete current/tail state, cumulative pre-device peaks and over-unity counts, not borrowed renderer pointers. |
| Faults | A render fault zeros transport output and latches in snapshots. Further commands receive `RENDER_FAILED`; close/recreate is the transport recovery operation. No callback logging or success-shaped silence hides the fault. |
| Destruction | Only after callback quiescence. Abandons pending commands/receipts, destroys all retained candidates/current/tail on the control side, and leaves external document/sample ownership intact. |

Submission success means **queued**, not applied. Drain receipts and check their
typed result before confirming a UI action. Failed enqueue leaves the ticket
unchanged. A full queue is explicit backpressure; do not silently drop, duplicate
or spin-retry controls. Polling native transports also collects retired renderers;
pure transport hosts call `nova_audio_transport_collect` themselves.

Commands apply at render-block boundaries (including bounded chunks of a larger
native request); prepared musical events and fades still advance sample by
sample. Given the same command positions, changing block sizes does not change
the rendered signal. This is not sample-accurate scheduling of arbitrary GUI
commands. **`current.position` is rendered score position**, not an observed
hardware/audible playhead. `current.clock` includes rendered silence after score
completion, while position stays at the end or wraps for a score loop. Transport
output counters are not device clocks, latency measurements or xrun counters.

### Native API and host selection

`nova_audio_device_open(NOVA_AUDIO_AUDITION, rate, &handle, error, size)` and the
corresponding `NOVA_AUDIO_GAME` call create at most one stream per role. Opening
is explicit playback-device activation. Selecting an asset must not call it
implicitly. Both streams share the existing raylib/miniaudio device with legacy
WAV resources; there is no Qt or second miniaudio device owner.

Use `nova_audio_device_replace(handle, program, fade_frames, &ticket)`, then
`nova_audio_device_command(handle, NOVA_AUDIO_CANCEL/NOVA_AUDIO_RESET, program_id,
fade_frames, &ticket)` and `nova_audio_device_poll`. Poll returns at most one
receipt and the newest snapshot, with separate presence flags. It still drains
and collects when returning `DEVICE_UNAVAILABLE` or `RENDER_FAILED`; display that
error as well as any supplied receipt/snapshot. Render faults remain reported
even on polls without a new snapshot. `nova_audio_control_message` gives
control-side diagnostics for typed outcomes.

Handles are monotonic identities, not pointers. Closing and reopening a role
cannot revive an old handle. `nova_audio_device_close(handle)` stops, detaches
and unloads only that stream, then destroys its transport. It remains available
when the device or rendering has failed. If the callback is stopped, cancellation
receipts cannot progress: close is the explicit teardown path, not an indefinite
wait. `nova_audio_device_close_transports()` invalidates both handles without
closing the device or disturbing legacy WAV ownership.

Native calls share the serialized control owner of legacy raylib resources.
Unload legacy resources before final shutdown; `nova_shutdown_audio()` now
closes/quiesces the two transports before `CloseAudioDevice()`. A host using
raylib directly must perform the same ordering. Never externally close the
device underneath live transports/resources or shut down from a callback.
Failed stream creation leaves the shared device and other live resources alone;
it does not reopen the device or replace a previous score. Observed rerouting
requires explicit global unload/shutdown/reopen; interruption/stopped states
are reported without silently recreating resources. Android focus policy and
document-level resume/recovery still need host integration and hardware checks.

The adapter is **renderer-host-neutral at link time**. `nova_audio_native`
links only `nova_audio`, not ordinary GLFW raylib. The host supplies exactly one
patched raylib target, including when it builds its own assets/presentation
targets for Qt. Do not accidentally link ordinary `nova_assets` into that host:
the ordinary target intentionally brings its ordinary raylib backend.

For an already-created caller-selected raylib target/source tree:

```cmake
include("${NOVA_SOURCE_DIR}/cmake/RaylibAudio.cmake")
nova_configure_raylib_audio(${NOVA_HOST_RAYLIB_TARGET} "${NOVA_HOST_RAYLIB_SOURCE_DIR}")
target_link_libraries(my_studio PRIVATE nova_audio_native ${NOVA_HOST_RAYLIB_TARGET})
```

The target must compile the pinned `src/raudio.c`; pass a real target, not a CMake
alias. The helper adds C11/include requirements and checks the original source
fingerprint after reversing only recognized Nova substitutions. Unknown upstream
changes fail configuration. Application is idempotent for separate ordinary and
Qt-hosted trees. The archive hash and dependency notices remain intact; no
dependency is added, and Android still uses only the native C backend.

### Actual backend evidence and limitations

The checked hook fixes device close to stop/join miniaudio callbacks **before**
destroying their mixer mutex, and releases that mutex after a start failure.
It also rejects failed PCM buffer allocation and frees PCM data when converter
initialization fails. Diagnostics are preserved. No unrelated raylib code is
changed. Control-side stop/detach/unload uses the existing mixer lock as a
callback retirement barrier before renderer memory is reclaimed.

The new transport, stream trampolines, callback observations and notification
hook allocate/free nothing and perform no Lua, I/O, formatting/logging or new
blocking locks on the render path. **The whole inherited callback is not
lock-free or hard-real-time**: pinned raylib holds `AUDIO.System.lock` across
mixing, converters and stream callbacks; legacy controls also acquire it.
This milestone does not replace that mixer or claim a measured deadline bound.

`nova_audio_device_info()` separates these categories:

| Evidence | Meaning and limits |
| --- | --- |
| `initialized`, `started` | Ready state plus miniaudio's started state; readiness alone does not mean callbacks are running. |
| `mixer_*`, `backend_*` | External mixer and internal backend rates/channels/formats captured after successful initialization. They are configuration evidence, not measured hardware clock rates. Backend name identifies the backend, not a device enumeration. |
| `configured_period_frames/count` | Backend initialization fields, not observed callback size or total audible latency. Zero/unknown fields must remain unavailable in the UI. |
| `callback_observed`, `callback_frames/count` | Last observed mixer callback size and count. Separate atomic observations, not a paired timing measurement; count wraps modulo 2^32. No timing/underrun/latency inference is valid. |
| `notifications` | Sticky events actually received from pinned miniaudio. Hook availability does not mean every backend reports loss/reroutes. Some reroutes are missed; interruption events in this pinned version are iOS-only, not Android audio-focus support. |
| `configuration_current` | Initialized configuration not marked stale by a received reroute. After reroute, original fields remain identifiable stale evidence; no racy reads of live backend configuration pretend to refresh them. Undetected reroutes remain a backend limitation. |
| `underruns_known`, `hardware_latency_known` | False: this backend path supplies neither measured xruns nor hardware/round-trip latency. Do not render those as zero or "healthy". |
| `inherited_output_clipping` | Miniaudio's existing final float clipping setting. Core/transport float headroom does not imply unclipped hardware output. |

Each stream preserves its declared rate. Pinned miniaudio can convert it to the
mixer/device rate using its existing linear resampler (default low-pass order 1);
the core sampler's sinc quality checks do not qualify that separate output
conversion. The adapter requires the pinned stereo float mixer and cancels
raylib's fixed center-pan attenuation (11/16 per channel) with a 16/11 stream
gain, so an already-panned stereo score is not attenuated a second time.
This is not normalization, clipping or a change to legacy WAV/master gain.

Transport meters are before inherited master mixing, device conversion/clipping
and hardware buffering; they do not measure the aggregate legacy-plus-score
output. Device converter/filter history and already-submitted hardware buffers
can also outlive a score command. Cancellation is safe ownership/render timing,
not a promise to retract already-buffered audible frames.

## WAVs, export and native runtime integration

The shared strict reader accepts little-endian RIFF with `fmt(16)`:

| Encoding | Canonical chunks | Native decoded storage |
| --- | --- | --- |
| Unsigned PCM8 / signed PCM16 | fmt, data | Existing pinned raylib decoder, unchanged (PCM16). |
| Signed PCM24 | fmt, data | Shared exact integer-to-float decoder, `Wave.sampleSize = 32`. |
| IEEE float32 | fmt, fact(4), data; fact equals frame count | Shared float decoder, `Wave.sampleSize = 32`, headroom retained. |

Lengths, byte rate, alignment, frame count, optional odd-data zero pad and EOF
must agree exactly. Extra/unknown chunks, extensible/compressed formats, MP3
and OGG are still rejected. Original rates 8000..48000 Hz and mono/stereo are
retained. Float sources must be finite and within +/-16; out-of-range imports
fail explicitly, never normalize or clip.

Existing limits remain: **16 MiB input/file, 64 MiB total project input, 32 asset
declarations, <=60 seconds per sample and <=120 seconds across unique audio
paths**. Alias declarations still share native resource/voice ownership. Core
prepared scores also bound unique sample duration to 120 seconds (pointer aliases
are counted once); float copies may use up to 46,080,000 bytes for the unique
48 kHz stereo samples. Control-side import/preparation may additionally hold
bounded scratch copies and DSP tables. These short-effect limits do not bound
the duration of an arrangement or streamed offline output.

Do not pass new masters through raylib 5.5's `LoadWaveFromMemory`: it always
converts WAV to PCM16, even for float/24-bit input. `nova_decode_wav` instead
validates through the shared reader and decodes new formats into raylib-owned
float memory. Existing `LoadSoundFromWave`, sound aliasing, native device
ownership, transactional staging, stop/pause/reload and Lua APIs are unchanged.
There is **no second device** and no conversion of existing game projects to
the new sequencer. The legacy tick-restarted `nova.play(..., true)` loop still
has its documented tick-sized-gap limitation.

`nova_audio_write_wav` writes a fresh render through a caller-provided sink in
512-frame blocks. Choose the exact frame count (up to one hour); this is also
the explicit truncation/tail decision. Choose full prepared length to include
all tails, or an exact multiple for repeated score cycles. It emits stereo at
the program's real rate; it never changes a header to fake rate conversion.
Canonical exports have no embedded cue/smpl loop metadata. A future sound
document must retain its recipe and loop range; a WAV alone is not that document.
Float32 preserves rendered float bits, including above-unity headroom. PCM24
and PCM16 quantize once at export; seeded TPDF is available and recommended.
Dither is never inserted at intermediate DSP stages or into float masters.
If integer rounding/dither would exceed the representable range, export fails
rather than clipping. Leave headroom, reduce an explicit mix gain, or choose
float. High-headroom float masters may deliberately exceed runtime import
limits and require an explicit runtime delivery mix, not hidden normalization.

The sink is an **offline** contract, not an audio callback. It may do file I/O.
On failure, results report successfully acknowledged blocks/bytes and observed
peaks; the failed sink call may itself have written partial bytes. Never publish
that candidate. A Qt host can use a guarded `QSaveFile`/document transaction and
commit only after success, while preserving the original sound document and
last useful render. No file is opened by the core.

## Evidence and remaining stages

The display/device-free checks exercise exact note/OFF/release positions,
exclusive source/score loop boundaries, 44.1/48 kHz rational conversion,
bit-identical output with differing block sizes, exact gain/pan/pitch ramps,
independent cancellation/reset, nested buses and maximum-voice headroom.
They reject invalid references, rates, envelopes, event ordering, voice
exhaustion, nonfinite data and bad WAVs. Allocator fault injection walks every
score allocation, sample decode and renderer allocation, proves balanced
ownership, and guards against allocation/free/formatting on render operations.

Quality gates compare synth aliases against a naive saw at both output rates
(alias component <0.00001 versus >0.1 for the naive fixture), bound fractional
wavetable residual against a band-limited Fourier reference (<0.00015 RMS), check
2x sampler rejection (<0.00005 RMS versus a 0.35355 pass-band RMS), reject
23 kHz input when converting 48 to 44.1 kHz (<0.0001 RMS), and measure the
low-pass response. These are specific deterministic signal checks, not a
universal alias-free claim or a listening/performance benchmark.

WAV tests check original rates, exact lengths/PCM24 low bits, float headroom,
seeded dither statistics, >60-second offline output, failed sinks, and actual
`nova_decode_wav` / `nova_validate_project` round trips and failure retention.
The optional `nova_audio_master_lifetime` test (`NOVA_AUDIO_TESTS=ON`) exercises
native upload/pause/reload with zero-volume fixtures; it requires explicit
device-testing permission and is not part of headless evidence.

The follow-up transport tests cover exact crossfades, cancellation during a
transition, stale IDs, reset preconditions, block-size-independent transition
signals, full command/receipt rings, coalesced snapshots and a fully occupied
18-renderer pool at shutdown. Allocator guards include transport rendering and
control-side retirement, with failure injection and exact allocation/free balance.
A real producer/consumer pair transfers 3000 commands while rendering, collecting
and reading snapshots concurrently. The fake native host holds its mixer lock
inside an in-flight callback until close requests the lock, proving the detach
barrier before teardown. Its executable links the actual `nova_audio_native`
library without GLFW/raylib and injects render/device/stream/play failures.

The lifecycle seam compiles actual init/close/buffer functions extracted from the
fingerprint-checked patched source. It injects context/device/mutex/start/PCM/
converter failures, checks diagnostics and balance, and invokes a final callback
during device uninitialization to verify that its mutex is still alive. Separate
patch checks exercise idempotence and rejection of unknown source.

Follow-up verification: all 15 focused audio/core/project/asset/service/export
checks passed in ordinary Debug and ASan/UBSan builds. All three threaded/device-
free seam selectors also passed ten consecutive runs under ThreadSanitizer with
the installed Apple Clang, without installing tooling or opening a device.
ASan leak detection was disabled on macOS; allocation balance is covered by the
explicit fault-injection tests, not a leak-sanitizer claim. Both native application
targets link. The opt-in `nova_audio_lifetime` test now also exercises silent
44.1/48 kHz score streams alongside legacy WAV/alias/reload services and final
shutdown, but **was not run** for this milestone.

Still required for the complete Sound Studio: measured underruns/latency and
more complete device-loss recovery; Android focus/lifecycle handling; quality
qualification of the inherited output conversion; streamed full-length music;
sound documents and reversible waveform/loop/crossfade editing; recording
consent/input/retention; MIDI; arrangement/
piano roll; effects, sends, automation UI, stem exports/latency policy, and
runtime-profile audition. Listening, microphone/MIDI hardware and Android
device behavior have not been established by these checks. No comparative
fidelity claim about GameStudio/Glow43 is made.

Initial isolated-worktree verification passed all 11 focused audio/native
compatibility selectors in ordinary Debug and ASan/UBSan builds, with leak
sanitizer disabled on macOS. Allocation/free balance has its separate injected
failure checks. Both native application targets link. The measured sampler
pass/stop RMS values were 0.35355433 / 0.00000155, and the fractional-table saw
residual was 0.00004940 RMS; these are fixture results, not hardware benchmarks.
