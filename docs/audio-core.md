# Native sample-clock audio foundation

This is the first reusable Sound Studio backend, not a finished Sound Studio.
`audio/audio.h` is a C11 API with C++ linkage guards; link `nova_audio`.
It has no raylib, Lua, Qt, device, filesystem or third-party DSP dependency.
The existing game `nova.play` / `nova.stop` service remains a separate,
compatible short-WAV playback path.

The implementation provides stereo float processing at **48 kHz** (the default
constant) or explicitly **44.1 kHz**, prepared sample-clock scores, independent
renderers, synth/sampler voices, envelopes and ramps, a small bus tree, meters,
and offline WAV rendering. It does not record, open devices, or start playback
when a sample is selected. All fixtures and the demonstration composition are
generated from original code, not recordings or another application's assets.

## Build and reproduce

From the assigned Nova Studio checkout:

```sh
./scripts/with-toolchain.sh cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug \
  -DNOVA_GPU_TESTS=OFF -DNOVA_AUDIO_TESTS=OFF
./scripts/with-toolchain.sh cmake --build build --target \
  nova_audio_render nova_audio_tests nova_audio_wav_tests \
  nova_audio_allocation_tests nova_audio_cpp_tests nova_service_tests -j 4
./scripts/with-toolchain.sh ctest --test-dir build --output-on-failure \
  -R '^nova_(audio_(dsp|wav|allocations|cpp_contract|render_cli)|services)$'
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
or singleton audition state exists in this library.

`nova_audio_render`, `nova_audio_cancel`, `nova_audio_status`, and
`nova_audio_renderer_reset` operate on the **single render-owner thread**. They
perform no allocation/free, I/O, logging/diagnostic formatting, Lua calls,
reference-count changes or locking. Never call status or cancel concurrently
from Qt's UI thread. A future adapter must marshal bounded commands and meter
snapshots; a UI lock around rendering is not a suitable adapter.

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
publishes a newly prepared renderer only after successful creation; no new
manifest version or music-document schema is defined here.

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

Still required for the complete Sound Studio: a single-device live-stream
adapter shared with existing services; bounded control/meter transfer; actual
hardware rate/buffer reporting, underruns, device loss and Android focus/lifecycle
handling; streamed full-length music; sound documents and reversible waveform/
loop/crossfade editing; recording consent/input/retention; MIDI; arrangement/
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
