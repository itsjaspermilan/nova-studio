#ifndef NOVA_AUDIO_STREAM_H
#define NOVA_AUDIO_STREAM_H

#include "transport.h"

#ifdef __cplusplus
extern "C" {
#endif

#define NOVA_AUDIO_STREAM_BLOCK 1024
#define NOVA_AUDIO_STREAM_BLOCKS 8
#define NOVA_AUDIO_STREAM_MAX_SECONDS 3600
#define NOVA_AUDIO_STREAM_HEAP_LIMIT (96 * 1024)
#define NOVA_AUDIO_STREAM_WORKER_STACK (256 * 1024)

typedef struct NovaAudioStream NovaAudioStream;

typedef enum {
    NOVA_STREAM_PAUSE,
    NOVA_STREAM_RESUME,
    NOVA_STREAM_SEEK,
    NOVA_STREAM_REGION,
    NOVA_STREAM_CANCEL
} NovaAudioStreamControl;

typedef struct {
    NovaAudioStreamControl type;
    uint64_t generation;             /* Initial generation is 1; take later values from receipts/snapshots. */
    uint64_t frame, end_frame;        /* SEEK: target. REGION: [frame,end_frame), starts paused at frame. */
    bool loop;                       /* REGION only. */
    uint32_t fade_frames;             /* PAUSE/RESUME/CANCEL: 0..rate*60; 0 explicitly requests a hard gate. */
} NovaAudioStreamCommand;

typedef struct {
    uint64_t ticket, generation;
    NovaAudioStreamControl type;
    NovaAudioControlResult result;
} NovaAudioStreamReceipt;

typedef enum {
    NOVA_STREAM_PAUSED,
    NOVA_STREAM_PLAYING,
    NOVA_STREAM_PAUSING,
    NOVA_STREAM_CANCELLING,
    NOVA_STREAM_CANCELLED,
    NOVA_STREAM_ENDED,
    NOVA_STREAM_FAULTED
} NovaAudioStreamState;

typedef enum {
    NOVA_STREAM_NO_FAULT,
    NOVA_STREAM_READ_FAILED,
    NOVA_STREAM_SOURCE_CHANGED,
    NOVA_STREAM_INVALID_PCM,
    NOVA_STREAM_CLOCK_OVERFLOW
} NovaAudioStreamFault;

typedef struct {
    NovaAudioWavInfo wav;
    uint64_t file_bytes;
    size_t instance_bytes, decoded_buffer_bytes, worker_stack_bytes; /* Excludes OS/thread runtime overhead. */
} NovaAudioStreamInfo;

typedef struct {
    uint64_t publication, generation, last_command, completed_command;
    uint64_t output_frames, rendered_frames, position, loop_begin, loop_end, loops;
    uint64_t underrun_frames, underrun_episodes, stale_blocks, over_frames;
    uint64_t fault_frame;
    uint32_t buffered_frames;
    NovaAudioStreamState state;
    NovaAudioStreamFault fault;
    int system_error;
    bool loop, starved;
    float gain, peak[2];
} NovaAudioStreamSnapshot;

typedef enum {
    NOVA_STREAM_RENDER_OK,
    NOVA_STREAM_RENDER_STARVED,
    NOVA_STREAM_RENDER_PAUSED,
    NOVA_STREAM_RENDER_ENDED,
    NOVA_STREAM_RENDER_CANCELLED,
    NOVA_STREAM_RENDER_FAULT,
    NOVA_STREAM_RENDER_INVALID
} NovaAudioStreamRenderResult;

/* Control side. Trusted host-selected regular file, not a Lua path/import API.
 * Pins one read-only descriptor, validates a bounded header, starts one reader
 * worker and leaves playback PAUSED. No device activation. Output unchanged on
 * failure. PCM validation is incremental, before decoded blocks are published.
 * One serialized control producer and one render consumer per instance. */
bool nova_audio_stream_open(const char *path, NovaAudioStream **out, char *error, size_t error_size);
NovaAudioStreamInfo nova_audio_stream_info(const NovaAudioStream *stream);

/* Quiesce the render owner FIRST. Stops/joins the worker before closing/freeing.
 * May wait for an in-flight OS read; never call from an audio callback. On join
 * failure retains *stream for retry. Once freed, *stream is NULL even if closing
 * the descriptor reported an error. Pending commands/receipts are abandoned. */
bool nova_audio_stream_close(NovaAudioStream **stream, char *error, size_t error_size);

/* Successful enqueue is not application/completion. Drain receipts. Full queues
 * leave *ticket unchanged; full receipt queues defer commands, not rendering.
 * SEEK/REGION require paused/ended/cancelled state: PAUSE, await completion,
 * SEEK/REGION, then RESUME explicitly. No implicit desktop focus policy.
 * No implicit rewind; PAUSE/CANCEL consume their fade-out frames before holding.
 * completed_command marks their fade completion; other controls complete at
 * application, not at prefill completion or the end of a RESUME ramp.
 * Generation guards reject stale commands, and tagged decode blocks discard
 * work from earlier seeks/regions/cancellation. */
NovaAudioControlResult nova_audio_stream_command(NovaAudioStream *stream,
    NovaAudioStreamCommand command, uint64_t *ticket);
bool nova_audio_stream_receipt(NovaAudioStream *stream, NovaAudioStreamReceipt *receipt);
bool nova_audio_stream_snapshot(NovaAudioStream *stream, NovaAudioStreamSnapshot *snapshot);
const char *nova_audio_stream_fault_message(NovaAudioStreamFault fault);

/* Render owner only, 0..NOVA_AUDIO_MAX_BLOCK frames, original source rate, stereo
 * float (mono duplicated, not normalized). No reads/decoding/allocation/free,
 * logging, locks or OS calls. Underflow emits counted silence without advancing
 * source position. These are software starvation counts, not hardware xruns.
 * Positions describe frames rendered/consumed, never an audible playhead. */
NovaAudioStreamRenderResult nova_audio_stream_render(NovaAudioStream *stream, float *stereo, size_t frames);

#ifdef __cplusplus
}
#endif
#endif
