#ifndef NOVA_AUDIO_PRODUCTION_H
#define NOVA_AUDIO_PRODUCTION_H

#include "audio.h"

#ifdef __cplusplus
extern "C" {
#endif

#define NOVA_AUDIO_MAX_INSERTS 16
#define NOVA_AUDIO_INSERTS_PER_BUS 4
#define NOVA_AUDIO_MAX_SENDS 16
#define NOVA_AUDIO_DELAY_SECONDS 2
#define NOVA_AUDIO_TAIL_SECONDS 30
#define NOVA_AUDIO_EFFECT_BUFFER_LIMIT (2 * 1024 * 1024)

typedef enum {
    NOVA_AUDIO_LOWPASS,
    NOVA_AUDIO_HIGHPASS,
    NOVA_AUDIO_BELL,
    NOVA_AUDIO_DELAY,
    NOVA_AUDIO_REVERB,
    NOVA_AUDIO_COMPRESSOR,
    NOVA_AUDIO_LIMITER
} NovaAudioInsertType;

typedef struct {
    uint32_t bus;
    NovaAudioInsertType type;
    float wet;                       /* 0..1 linear dry/wet, not equal-power. */
    union {
        struct {
            double frequency_hz, q;   /* 20..rate*0.4 Hz, Q 0.5..4. */
            double gain_db;           /* Bell only, -12..12 dB; otherwise 0. */
        } filter;
        struct {
            uint32_t frames[2];       /* Independent L/R: 1..rate*2, fixed. */
            double feedback;         /* -0.95..0.95. */
            double damping_hz;       /* Feedback low-pass; 0 bypass, or 20..rate*0.45. */
        } delay;
        struct {
            double decay_seconds;    /* 0.1..10, feedback design target, not a measured RT60. */
            double damping_hz;       /* 0 bypass, or 20..rate*0.45. */
        } reverb;
        struct {
            double threshold_db, ratio, makeup_db; /* -60..0 dB, 1..20, -24..24 dB. */
            uint32_t attack_frames, release_frames; /* 1..rate*10; exponential time constants. */
        } compressor;
        struct {
            double ceiling_db;       /* -24..0 dB; local insert sample peak, full wet only. */
            uint32_t release_frames; /* 1..rate*10, instantaneous attack, no lookahead. */
        } limiter;
    } settings;
} NovaAudioInsert;

typedef struct {
    uint32_t source, destination;     /* destination < source; existing parent route remains. */
    bool post_fader;                  /* Both taps are post-insert; false is pre gain/pan. */
    float gain;                      /* 0..2. */
} NovaAudioSend;

typedef enum {
    NOVA_AUDIO_INSERT_WET,
    NOVA_AUDIO_FILTER_FREQUENCY,
    NOVA_AUDIO_BELL_GAIN_DB,
    NOVA_AUDIO_DELAY_FEEDBACK,
    NOVA_AUDIO_COMPRESSOR_THRESHOLD_DB,
    NOVA_AUDIO_COMPRESSOR_MAKEUP_DB,
    NOVA_AUDIO_LIMITER_CEILING_DB,
    NOVA_AUDIO_SEND_GAIN
} NovaAudioProductionParameter;

typedef struct {
    uint64_t frame;
    uint32_t target;                  /* Insert index, or send index for SEND_GAIN. */
    NovaAudioProductionParameter parameter;
    double value;                    /* Named units; prepared ramps use transformed units below. */
    uint32_t ramp_frames;             /* 1..rate*60; must finish within score length. */
} NovaAudioProductionEvent;

typedef struct {
    const NovaAudioInsert *inserts;    /* Array order is insert order within each bus. */
    size_t insert_count;
    const NovaAudioSend *sends;
    size_t send_count;
    const NovaAudioProductionEvent *events; /* Sorted, base + production <= MAX_EVENTS. */
    size_t event_count;
    uint32_t tail_frames, tail_fade_frames; /* Suffix INCLUDED in base.length_frames. */
} NovaAudioProductionDesc;

/* Additive preparation; all existing constructors/structs remain unchanged.
 * Copies arrays and prepares coefficients off-callback. Empty/NULL production
 * is the original path. Inserts require a nonzero declared tail and final fade;
 * every note's release must finish before that suffix. Tail length is explicit
 * editorial timing, not an acoustic-decay estimate.
 * Events apply after base events at the same frame, then in production array
 * order. Ramps are linear in wet/send/feedback, tan(pi*Hz/rate) for cutoff, and
 * linear amplitude for dB endpoints. Delay times/Q/decay/detector times are fixed.
 * At event frame F use the current value; reach the target at F+ramp_frames.
 * Reset/loop logically clear effect history without clearing delay storage.
 * A declared tail adds a complete-output cancellation fade from the current
 * end-fade level, alongside ordinary voice releases. Sends without a tail
 * retain the old voice-only cancellation. See docs/audio-core.md.
 * Failure leaves *out unchanged. No device, file, Lua or UI dependency. */
bool nova_audio_program_create_production(const NovaAudioProgramDesc *base,
    const NovaAudioProductionDesc *production, NovaAudioProgram **out, char *error, size_t error_size);

typedef struct {
    size_t insert_count, send_count, event_count;
    size_t prepared_bytes;            /* New immutable processing data only; not samples/base tables. */
    size_t state_bytes, buffer_bytes;  /* New per-renderer state; buffer_bytes is included in state_bytes. */
    size_t renderer_bytes;            /* Entire renderer incl. new state; no program/sample/transport memory. */
    uint32_t tail_frames, tail_fade_frames;
} NovaAudioProductionInfo;

NovaAudioProductionInfo nova_audio_program_production_info(const NovaAudioProgram *program);

typedef struct {
    size_t insert_count;
    bool tail_active, ended;          /* DSP/tail window only; audio_status.finished also includes voices. */
    uint32_t tail_frames_remaining, cancel_frames_remaining;
    float input_peak[NOVA_AUDIO_MAX_INSERTS][2], output_peak[NOVA_AUDIO_MAX_INSERTS][2];
    uint64_t input_over_frames[NOVA_AUDIO_MAX_INSERTS], output_over_frames[NOVA_AUDIO_MAX_INSERTS];
    float gain[NOVA_AUDIO_MAX_INSERTS], minimum_gain[NOVA_AUDIO_MAX_INSERTS]; /* Dynamics only, before makeup/wet. */
} NovaAudioProductionStatus;

/* Render owner ONLY. Cumulative insert sample peaks and detector reduction;
 * no true-peak/loudness/hardware measurements. No borrowed pointers. Insert
 * output is post-wet, pre-fader and pre-terminal-fade; Master meters include
 * the terminal fade. Remaining frames are declared bounds, not decay estimates.
 * A1 native snapshots retain their existing safe post-insert bus/output meters;
 * live native insert snapshots are not provided. Never read a live renderer
 * from the UI/control thread. Reset clears meters; loop resets preserve them. */
NovaAudioProductionStatus nova_audio_production_status(const NovaAudioRenderer *renderer);

#ifdef __cplusplus
}
#endif
#endif
