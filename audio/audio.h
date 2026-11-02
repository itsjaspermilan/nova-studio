#ifndef NOVA_AUDIO_H
#define NOVA_AUDIO_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define NOVA_AUDIO_DEFAULT_RATE 48000
#define NOVA_AUDIO_MAX_VOICES 32
#define NOVA_AUDIO_MAX_SAMPLES 32
#define NOVA_AUDIO_MAX_PATCHES 32
#define NOVA_AUDIO_MAX_BUSES 8
#define NOVA_AUDIO_MAX_EVENTS 4096
#define NOVA_AUDIO_MAX_BLOCK 4096
#define NOVA_AUDIO_SAMPLE_SECONDS 60
#define NOVA_AUDIO_TOTAL_SAMPLE_SECONDS 120
#define NOVA_AUDIO_MAX_SECONDS 3600
#define NOVA_AUDIO_WAV_INPUT_LIMIT (16 * 1024 * 1024)
#define NOVA_AUDIO_SAMPLE_PEAK_LIMIT 16.0f
#define NOVA_AUDIO_NO_BUS UINT32_MAX

typedef struct NovaAudioSample NovaAudioSample;
typedef struct NovaAudioProgram NovaAudioProgram;
typedef struct NovaAudioRenderer NovaAudioRenderer;

typedef struct {
    uint32_t sample_rate, channels, frames;
} NovaAudioSampleInfo;

/* Control-thread operations. Samples copy interleaved data at its original rate.
 * Failed creation leaves *out unchanged. Shared-object retain/release operations
 * must be serialized by the host; rendering never touches reference counts. */
bool nova_audio_sample_create(const float *data, NovaAudioSampleInfo info,
    NovaAudioSample **out, char *error, size_t error_size);
void nova_audio_sample_release(NovaAudioSample *sample);
NovaAudioSampleInfo nova_audio_sample_info(const NovaAudioSample *sample);
const float *nova_audio_sample_data(const NovaAudioSample *sample);

typedef enum {
    NOVA_AUDIO_SINE,
    NOVA_AUDIO_SAW,
    NOVA_AUDIO_SQUARE,
    NOVA_AUDIO_TRIANGLE,
    NOVA_AUDIO_NOISE,
    NOVA_AUDIO_SAMPLER
} NovaAudioSource;

typedef struct {
    uint32_t attack_frames, decay_frames, release_frames;
    float sustain;
} NovaAudioEnvelope;

typedef struct {
    NovaAudioSource source;
    NovaAudioEnvelope envelope;
    double lowpass_hz;                 /* 0 bypasses the one-pole low-pass. */
    uint32_t sample, sample_start, sample_end; /* Source frames, [start,end). */
    bool sample_loop;
    double sample_root_hz, sample_max_ratio;
} NovaAudioPatch;

typedef struct {
    uint32_t parent;                   /* Root: NO_BUS; others: parent < index. */
    float gain, pan;                   /* 0..4, -1..1. Stereo balance pan. */
} NovaAudioBus;

typedef struct {
    uint32_t patch, bus;
    double frequency;                 /* Hz; sampler Hz / root Hz; noise: 0. */
    float gain, pan;                   /* 0..4, -1..1. Mono equal-power pan. */
    uint32_t seed;                     /* Nonzero for deterministic noise. */
} NovaAudioNote;

typedef enum {
    NOVA_AUDIO_NOTE_ON,
    NOVA_AUDIO_NOTE_OFF,
    NOVA_AUDIO_VOICE_GAIN,
    NOVA_AUDIO_VOICE_PAN,
    NOVA_AUDIO_VOICE_PITCH,
    NOVA_AUDIO_BUS_GAIN,
    NOVA_AUDIO_BUS_PAN
} NovaAudioEventType;

typedef struct {
    uint64_t frame;                    /* Applied BEFORE this output frame. */
    NovaAudioEventType type;
    uint32_t target;                   /* Unique nonzero note ID, or bus index. */
    NovaAudioNote note;                /* NOTE_ON only. */
    double value;                     /* Parameter events only. */
    uint32_t ramp_frames;              /* Parameter events: >=1, linear ramp. */
} NovaAudioEvent;

typedef struct {
    uint32_t sample_rate;              /* Exactly 48000 or 44100. */
    uint32_t voice_limit;              /* 1..MAX_VOICES; no voice stealing. */
    uint64_t length_frames;            /* [0,length), including release tails. */
    bool loop;                        /* Repeat the entire prepared score. */
    NovaAudioSample *const *samples;
    size_t sample_count;
    const NovaAudioPatch *patches;
    size_t patch_count;
    const NovaAudioBus *buses;
    size_t bus_count;
    const NovaAudioEvent *events;      /* Sorted; equal-time array order wins. */
    size_t event_count;
} NovaAudioProgramDesc;

/* Copies control data, validates all lifetimes/routing, prepares DSP tables, and
 * retains unique immutable samples. Every note needs an OFF and a complete tail.
 * A loop repeats initial bus/voice state; no implicit tail stealing/crossfade. */
bool nova_audio_program_create(const NovaAudioProgramDesc *desc,
    NovaAudioProgram **out, char *error, size_t error_size);
void nova_audio_program_release(NovaAudioProgram *program);
uint32_t nova_audio_program_rate(const NovaAudioProgram *program);
uint64_t nova_audio_program_length(const NovaAudioProgram *program);
size_t nova_audio_program_bus_count(const NovaAudioProgram *program);

bool nova_audio_renderer_create(NovaAudioProgram *program,
    NovaAudioRenderer **out, char *error, size_t error_size);
void nova_audio_renderer_destroy(NovaAudioRenderer *renderer);

typedef enum {
    NOVA_AUDIO_OK,
    NOVA_AUDIO_INVALID_ARGUMENT,
    NOVA_AUDIO_CLOCK_OVERFLOW,
    NOVA_AUDIO_NONFINITE
} NovaAudioResult;

typedef struct {
    uint64_t clock, position;
    bool finished, cancelled;
    NovaAudioResult fault;
    uint32_t active_voices;
    float peak[NOVA_AUDIO_MAX_BUSES][2];
    uint64_t over_frames[NOVA_AUDIO_MAX_BUSES]; /* |sample| > 1, never clipped. */
} NovaAudioStatus;

/* Single render-owner thread only, including status/reset/cancel. No allocation,
 * I/O, logging, locks, Lua or reference-count changes. Host must quiesce callbacks
 * before destruction or transfer. Different renderers have independent clocks.
 * Output is interleaved stereo float, unclipped. 0..MAX_BLOCK frames per call.
 * Invalid arguments leave state/output unchanged; a DSP fault zeros the rest of
 * the block and latches in status. Hosts must surface non-OK results off-callback. */
NovaAudioResult nova_audio_render(NovaAudioRenderer *renderer, float *stereo, size_t frames);
NovaAudioResult nova_audio_cancel(NovaAudioRenderer *renderer, uint32_t fade_frames);
void nova_audio_renderer_reset(NovaAudioRenderer *renderer);
NovaAudioStatus nova_audio_status(const NovaAudioRenderer *renderer);

typedef struct {
    NovaAudioSampleInfo sample;
    uint32_t bits, format;             /* RIFF PCM=1, IEEE float=3. */
    size_t data_bytes, data_offset;
} NovaAudioWavInfo;

/* Strict bounded runtime-compatible RIFF: fmt(16), then data; float32 also needs
 * fact(4) before data. No other chunks.
 * PCM8/16/24 or finite float32; mono/stereo 8000..48000 Hz, <=60 s, <=16 MiB.
 * Float sources outside +/-16 are rejected, never clipped. */
bool nova_audio_wav_inspect(const unsigned char *bytes, size_t size,
    NovaAudioWavInfo *info, char *error, size_t error_size);
bool nova_audio_wav_read(const unsigned char *bytes, size_t size, float *data,
    size_t sample_capacity, char *error, size_t error_size);
bool nova_audio_sample_from_wav(const unsigned char *bytes, size_t size,
    NovaAudioSample **out, char *error, size_t error_size);

typedef enum {
    NOVA_AUDIO_WAV_PCM16,
    NOVA_AUDIO_WAV_PCM24,
    NOVA_AUDIO_WAV_FLOAT32
} NovaAudioWavFormat;

typedef struct {
    uint64_t frames;                   /* Exact output length, starting at zero. */
    NovaAudioWavFormat format;
    bool dither;                      /* Seeded TPDF, integer output only. */
    uint32_t seed;
} NovaAudioExport;

typedef struct {
    uint64_t frames_written, bytes_written;
    float peak[2];
    uint64_t over_frames;
    bool complete;
} NovaAudioExportResult;

typedef bool (*NovaAudioWrite)(void *context, const void *bytes, size_t size);

/* OFFLINE ONLY. A fresh renderer leaves audition state untouched. Uses bounded
 * blocks, never normalizes; integer overflow fails rather than clipping. Writer
 * failure may leave partial bytes: host must discard its private candidate and
 * commit only on success (e.g. QSaveFile). This never opens a file or device. */
bool nova_audio_write_wav(NovaAudioProgram *program, NovaAudioExport options,
    NovaAudioWrite write, void *context, NovaAudioExportResult *result,
    char *error, size_t error_size);

#ifdef __cplusplus
}
#endif
#endif
