#ifndef NOVA_AUDIO_TRANSPORT_H
#define NOVA_AUDIO_TRANSPORT_H

#include "audio.h"

#ifdef __cplusplus
extern "C" {
#endif

#define NOVA_AUDIO_COMMAND_CAPACITY 16
#define NOVA_AUDIO_RENDERER_CAPACITY (NOVA_AUDIO_COMMAND_CAPACITY + 2)

typedef struct NovaAudioTransport NovaAudioTransport;

typedef enum {
    NOVA_AUDIO_CONTROL_OK,
    NOVA_AUDIO_CONTROL_INVALID,
    NOVA_AUDIO_CONTROL_QUEUE_FULL,
    NOVA_AUDIO_CONTROL_RENDERERS_FULL,
    NOVA_AUDIO_CONTROL_RATE_MISMATCH,
    NOVA_AUDIO_CONTROL_ALLOCATION_FAILED,
    NOVA_AUDIO_CONTROL_STALE,
    NOVA_AUDIO_CONTROL_BUSY,
    NOVA_AUDIO_CONTROL_RENDER_FAILED,
    NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE,
    NOVA_AUDIO_CONTROL_BACKEND_FAILED,
    NOVA_AUDIO_CONTROL_SOURCE_FAILED,
    NOVA_AUDIO_CONTROL_RETIREMENT_PENDING
} NovaAudioControlResult;

typedef enum {
    NOVA_AUDIO_REPLACE,
    NOVA_AUDIO_CANCEL,
    NOVA_AUDIO_RESET
} NovaAudioControlType;

typedef struct {
    uint64_t ticket, program;
    NovaAudioControlType type;
    NovaAudioControlResult result;
} NovaAudioReceipt;

typedef struct {
    uint64_t publication, output_frames, last_command, program, retiring_program;
    uint32_t sample_rate;
    NovaAudioResult fault;
    NovaAudioStatus current, retiring;
    float peak[2];
    uint64_t over_frames;
} NovaAudioTransportSnapshot;

/* Exactly one serialized control producer and one render consumer. All functions
 * except render are control-side. Reference-count changes/destruction happen only
 * there. Create fails if required atomics are not always lock-free. Destroy only
 * AFTER the host has quiesced callbacks; queued commands are then abandoned. */
bool nova_audio_transport_create(uint32_t rate, NovaAudioTransport **out,
    char *error, size_t error_size);
void nova_audio_transport_destroy(NovaAudioTransport *transport);
uint32_t nova_audio_transport_rate(const NovaAudioTransport *transport);

/* Successful enqueue is NOT successful application: read receipts. A successful
 * replace ticket is also its transport-scoped program ID. Failed enqueue leaves
 * *ticket unchanged.
 * Candidates copy/retain everything before publication; caller may release program
 * after return. Replacements must match the transport rate, and crossfade with at
 * most one old renderer. A second overlapping transition is explicitly BUSY.
 * cancel/reset name a program ID, so stale UI commands cannot affect a new score.
 * reset is only accepted after completion/cancellation; cancel and await finished
 * before reset. fade_frames must be 1..rate*60. */
NovaAudioControlResult nova_audio_transport_replace(NovaAudioTransport *transport,
    NovaAudioProgram *program, uint32_t fade_frames, uint64_t *ticket);
NovaAudioControlResult nova_audio_transport_command(NovaAudioTransport *transport,
    NovaAudioControlType type, uint64_t program, uint32_t fade_frames, uint64_t *ticket);
bool nova_audio_transport_receipt(NovaAudioTransport *transport, NovaAudioReceipt *receipt);
size_t nova_audio_transport_collect(NovaAudioTransport *transport);

/* Nonblocking triple-buffer snapshot: true means a newer complete publication.
 * Intermediate meter snapshots may be coalesced; publication detects gaps.
 * Receipts are never dropped: a full receipt ring stops command consumption.
 * Positions are rendered score positions, never observed audible playheads.
 * Peaks/counters are cumulative transport output, not device/xrun measurements. */
bool nova_audio_transport_snapshot(NovaAudioTransport *transport, NovaAudioTransportSnapshot *snapshot);
const char *nova_audio_control_message(NovaAudioControlResult result);

/* Render owner only. Bounded processing of 0..MAX_BLOCK frames. No allocation,
 * free, logging, locks, I/O or reference-count mutation. Commands apply at block
 * boundaries; musical events inside scores remain sample-clock scheduled.
 * Output is interleaved stereo and unclipped. DSP faults latch in snapshots. */
NovaAudioResult nova_audio_transport_render(NovaAudioTransport *transport, float *stereo, size_t frames);

#ifdef __cplusplus
}
#endif
#endif
