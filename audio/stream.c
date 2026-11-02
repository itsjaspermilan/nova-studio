#include "stream.h"
#include "wav_internal.h"

#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

enum { DIRTY = 4 };

typedef struct {
    uint64_t generation, position, begin, end;
    bool loop, idle;
} ReadRequest;

typedef struct {
    uint64_t generation, fault_frame;
    unsigned frames;
    bool end;
    NovaAudioStreamFault fault;
    int system_error;
    float samples[NOVA_AUDIO_STREAM_BLOCK * 2];
} DecodeBlock;

typedef struct {
    NovaAudioStreamCommand command;
    uint64_t ticket;
} Control;

struct NovaAudioStream {
    int fd;
    struct stat identity;
    NovaAudioStreamInfo info;
    pthread_t worker;
    bool joined, closing;
    atomic_uint stop, data_read, data_write;
    DecodeBlock blocks[NOVA_AUDIO_STREAM_BLOCKS];
    ReadRequest requests[3];
    atomic_uint request_middle;
    unsigned request_read, request_write;
    Control commands[NOVA_AUDIO_COMMAND_CAPACITY];
    NovaAudioStreamReceipt receipts[NOVA_AUDIO_COMMAND_CAPACITY];
    atomic_uint command_read, command_write, receipt_read, receipt_write;
    uint64_t next_ticket;
    NovaAudioStreamSnapshot snapshots[3], status;
    atomic_uint snapshot_middle;
    unsigned snapshot_read, snapshot_write;
    unsigned block_offset, ramp_frames, ramp_position;
    float ramp_start, ramp_end;
    uint64_t transition_ticket;
};

_Static_assert(ATOMIC_INT_LOCK_FREE == 2, "Disk streaming requires lock-free unsigned atomics");
_Static_assert(sizeof(NovaAudioStream) <= NOVA_AUDIO_STREAM_HEAP_LIMIT, "Disk stream exceeds fixed heap budget");

static bool fail(char *error, size_t size, const char *message, int code)
{
    if (error && size) {
        if (code) snprintf(error, size, "%s (system error %d)", message, code);
        else snprintf(error, size, "%s", message);
    }
    return false;
}

static bool same_source(const struct stat *a, const struct stat *b)
{
    return a->st_dev == b->st_dev && a->st_ino == b->st_ino && a->st_size == b->st_size &&
#ifdef __APPLE__
        a->st_mtimespec.tv_sec == b->st_mtimespec.tv_sec && a->st_mtimespec.tv_nsec == b->st_mtimespec.tv_nsec &&
        a->st_ctimespec.tv_sec == b->st_ctimespec.tv_sec && a->st_ctimespec.tv_nsec == b->st_ctimespec.tv_nsec;
#else
        a->st_mtim.tv_sec == b->st_mtim.tv_sec && a->st_mtim.tv_nsec == b->st_mtim.tv_nsec &&
        a->st_ctim.tv_sec == b->st_ctim.tv_sec && a->st_ctim.tv_nsec == b->st_ctim.tv_nsec;
#endif
}

static bool read_bytes(NovaAudioStream *s, uint64_t offset, unsigned char *bytes, size_t size, int *code)
{
    while (size) {
        if (atomic_load_explicit(&s->stop, memory_order_acquire)) { *code = ECANCELED; return false; }
        ssize_t count = pread(s->fd, bytes, size, (off_t)offset);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) { *code = count < 0 ? errno : 0; return false; }
        bytes += count; offset += (size_t)count; size -= (size_t)count;
    }
    return true;
}

static bool next_request(NovaAudioStream *s, ReadRequest *request)
{
    if (!(atomic_load_explicit(&s->request_middle, memory_order_acquire) & DIRTY)) return false;
    unsigned middle = atomic_exchange_explicit(&s->request_middle, s->request_read, memory_order_acq_rel);
    s->request_read = middle & 3u;
    *request = s->requests[s->request_read];
    return true;
}

static void request_read(NovaAudioStream *s, bool idle)
{
    s->requests[s->request_write] = (ReadRequest){.generation = s->status.generation,
        .position = s->status.position, .begin = s->status.loop_begin, .end = s->status.loop_end,
        .loop = s->status.loop, .idle = idle};
    s->request_write = atomic_exchange_explicit(&s->request_middle, s->request_write | DIRTY,
        memory_order_acq_rel) & 3u;
}

static void decode_block(NovaAudioStream *s, ReadRequest request, DecodeBlock *block)
{
    *block = (DecodeBlock){.generation = request.generation, .fault_frame = request.position};
    struct stat before, after;
    if (fstat(s->fd, &before) != 0) { block->fault = NOVA_STREAM_READ_FAILED; block->system_error = errno; return; }
    if (!same_source(&before, &s->identity)) { block->fault = NOVA_STREAM_SOURCE_CHANGED; return; }
    if (request.position == request.end) { block->end = true; return; }
    size_t frames = request.loop || request.end - request.position > NOVA_AUDIO_STREAM_BLOCK ?
        NOVA_AUDIO_STREAM_BLOCK : (size_t)(request.end - request.position);
    unsigned stride = s->info.wav.sample.channels * s->info.wav.bits / 8;
    unsigned char raw[NOVA_AUDIO_STREAM_BLOCK * 2 * 4];
    uint64_t position = request.position, loop_length = request.end - request.begin;
    size_t decoded = 0;
    while (decoded < frames) {
        /* Cache one entire short loop inside this block; a one-frame loop must
         * not reduce the ring to eight frames or require thousands of reads. */
        if (request.loop && decoded >= loop_length) {
            for (; decoded < frames; ++decoded) {
                block->samples[decoded * 2] = block->samples[(decoded % loop_length) * 2];
                block->samples[decoded * 2 + 1] = block->samples[(decoded % loop_length) * 2 + 1];
            }
            break;
        }
        size_t count = frames - decoded;
        if (count > request.end - position) count = (size_t)(request.end - position);
        if (request.loop && count > loop_length - decoded) count = (size_t)(loop_length - decoded);
        uint64_t offset = s->info.wav.data_offset + position * stride;
        if (!read_bytes(s, offset, raw, count * stride, &block->system_error)) {
            block->fault = NOVA_STREAM_READ_FAILED; block->fault_frame = position; break;
        }
        size_t bad_frame;
        if (!nova_wav_decode(raw, count, &s->info.wav, block->samples + decoded * 2, true, &bad_frame)) {
            block->fault = NOVA_STREAM_INVALID_PCM; block->fault_frame = position + bad_frame; break;
        }
        decoded += count; position += count;
        if (request.loop && position == request.end) position = request.begin;
    }
    if (fstat(s->fd, &after) != 0) { block->fault = NOVA_STREAM_READ_FAILED; block->system_error = errno; return; }
    if (!same_source(&after, &s->identity)) { block->fault = NOVA_STREAM_SOURCE_CHANGED; return; }
    if (block->fault) return;
    block->frames = (unsigned)frames;
    block->end = !request.loop && request.position + frames == request.end;
}

static void *read_worker(void *context)
{
    NovaAudioStream *s = context;
    ReadRequest request = {.generation = 1, .end = s->info.wav.sample.frames};
    unsigned write = 0;
    bool idle = false;
    while (!atomic_load_explicit(&s->stop, memory_order_acquire)) {
        if (next_request(s, &request)) idle = request.idle;
        unsigned read = atomic_load_explicit(&s->data_read, memory_order_acquire);
        if (idle || write - read == NOVA_AUDIO_STREAM_BLOCKS) {
            const struct timespec delay = {.tv_nsec = 1000000};
            nanosleep(&delay, NULL);
            continue;
        }
        DecodeBlock *block = &s->blocks[write % NOVA_AUDIO_STREAM_BLOCKS];
        decode_block(s, request, block);
        if (atomic_load_explicit(&s->stop, memory_order_acquire)) break;
        if (next_request(s, &request)) { idle = request.idle; continue; }
        request.position += block->frames;
        if (request.loop) request.position = request.begin + (request.position - request.begin) % (request.end - request.begin);
        idle = block->end || block->fault != NOVA_STREAM_NO_FAULT;
        atomic_store_explicit(&s->data_write, ++write, memory_order_release);
    }
    return NULL;
}

static void publish(NovaAudioStream *s)
{
    unsigned read = atomic_load_explicit(&s->data_read, memory_order_relaxed);
    unsigned end = atomic_load_explicit(&s->data_write, memory_order_acquire);
    s->status.buffered_frames = 0;
    for (unsigned index = read; index != end; ++index) {
        DecodeBlock *block = &s->blocks[index % NOVA_AUDIO_STREAM_BLOCKS];
        if (block->generation == s->status.generation && !block->fault)
            s->status.buffered_frames += block->frames - (index == read ? s->block_offset : 0);
    }
    ++s->status.publication;
    s->snapshots[s->snapshot_write] = s->status;
    s->snapshot_write = atomic_exchange_explicit(&s->snapshot_middle, s->snapshot_write | DIRTY,
        memory_order_acq_rel) & 3u;
}

bool nova_audio_stream_open(const char *path, NovaAudioStream **out, char *error, size_t error_size)
{
    if (!path || !*path || !out) return fail(error, error_size, "disk stream requires a file and output pointer", 0);
    NovaAudioStream *s = calloc(1, sizeof(*s));
    if (!s) return fail(error, error_size, "disk stream allocation failed", 0);
    s->fd = -1;
    atomic_init(&s->stop, 0); atomic_init(&s->data_read, 0); atomic_init(&s->data_write, 0);
    atomic_init(&s->request_middle, 2); s->request_read = 1;
    atomic_init(&s->command_read, 0); atomic_init(&s->command_write, 0);
    atomic_init(&s->receipt_read, 0); atomic_init(&s->receipt_write, 0);
    atomic_init(&s->snapshot_middle, 2); s->snapshot_read = 1;
    s->fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
    if (s->fd < 0) { fail(error, error_size, "cannot open disk audio source", errno); goto failure; }
    if (fstat(s->fd, &s->identity) != 0) { fail(error, error_size, "cannot inspect disk audio source", errno); goto failure; }
    if (!S_ISREG(s->identity.st_mode) || s->identity.st_size < 44 ||
        (uint64_t)s->identity.st_size > (uint64_t)UINT32_MAX + 8) {
        fail(error, error_size, "disk audio source must be a regular, RIFF-sized file", 0); goto failure;
    }
    unsigned char header[56];
    size_t size = (uint64_t)s->identity.st_size < sizeof(header) ? (size_t)s->identity.st_size : sizeof(header);
    int code = 0;
    if (!read_bytes(s, 0, header, size, &code)) { fail(error, error_size, "cannot read WAV header", code); goto failure; }
    if (!nova_wav_header(header, size, (uint64_t)s->identity.st_size, NOVA_AUDIO_STREAM_MAX_SECONDS,
        &s->info.wav, error, error_size)) goto failure;
    if (s->info.wav.data_bytes & 1u) {
        unsigned char pad;
        if (!read_bytes(s, (uint64_t)s->identity.st_size - 1, &pad, 1, &code)) {
            fail(error, error_size, "cannot read WAV padding", code); goto failure;
        }
        if (pad) { fail(error, error_size, "WAV requires zero odd-data padding", 0); goto failure; }
    }
    struct stat after;
    if (fstat(s->fd, &after) != 0) { fail(error, error_size, "cannot recheck disk audio source", errno); goto failure; }
    if (!same_source(&s->identity, &after)) { fail(error, error_size, "disk audio source changed during open", 0); goto failure; }
    s->info.file_bytes = (uint64_t)s->identity.st_size;
    s->info.instance_bytes = sizeof(*s);
    s->info.decoded_buffer_bytes = NOVA_AUDIO_STREAM_BLOCKS * NOVA_AUDIO_STREAM_BLOCK * 2 * sizeof(float);
    s->info.worker_stack_bytes = NOVA_AUDIO_STREAM_WORKER_STACK;
    s->next_ticket = 1;
    s->status = (NovaAudioStreamSnapshot){.generation = 1, .state = NOVA_STREAM_PAUSED,
        .loop_end = s->info.wav.sample.frames};
    publish(s);
    pthread_attr_t attributes;
    code = pthread_attr_init(&attributes);
    if (code) { fail(error, error_size, "cannot initialize disk reader attributes", code); goto failure; }
    code = pthread_attr_setstacksize(&attributes, NOVA_AUDIO_STREAM_WORKER_STACK);
    if (!code) code = pthread_create(&s->worker, &attributes, read_worker, s);
    pthread_attr_destroy(&attributes);
    if (code) { fail(error, error_size, "cannot create bounded disk reader", code); goto failure; }
    *out = s;
    if (error && error_size) *error = '\0';
    return true;
failure:
    if (s->fd >= 0 && close(s->fd) != 0) fail(error, error_size, "disk source setup and descriptor cleanup failed", errno);
    free(s);
    return false;
}

NovaAudioStreamInfo nova_audio_stream_info(const NovaAudioStream *s) { return s->info; }

bool nova_audio_stream_close(NovaAudioStream **stream, char *error, size_t error_size)
{
    if (!stream || !*stream) return fail(error, error_size, "disk stream close requires a live owned stream", 0);
    NovaAudioStream *s = *stream;
    s->closing = true;
    atomic_store_explicit(&s->stop, 1, memory_order_release);
    if (!s->joined) {
        int code = pthread_join(s->worker, NULL);
        if (code) return fail(error, error_size, "cannot join disk reader; ownership retained", code);
        s->joined = true;
    }
    int code = close(s->fd) == 0 ? 0 : errno;
    free(s); *stream = NULL;
    if (code) return fail(error, error_size, "disk source descriptor close failed after reader retirement", code);
    if (error && error_size) *error = '\0';
    return true;
}

NovaAudioControlResult nova_audio_stream_command(NovaAudioStream *s, NovaAudioStreamCommand command, uint64_t *ticket)
{
    if (!s || s->closing || !ticket || !command.generation || s->next_ticket == UINT64_MAX ||
        command.type < NOVA_STREAM_PAUSE || command.type > NOVA_STREAM_CANCEL ||
        command.fade_frames > s->info.wav.sample.sample_rate * 60) return NOVA_AUDIO_CONTROL_INVALID;
    if (command.type == NOVA_STREAM_SEEK || command.type == NOVA_STREAM_REGION) {
        if (command.fade_frames || command.frame > s->info.wav.sample.frames) return NOVA_AUDIO_CONTROL_INVALID;
        if (command.type == NOVA_STREAM_REGION &&
            (command.frame >= command.end_frame || command.end_frame > s->info.wav.sample.frames)) return NOVA_AUDIO_CONTROL_INVALID;
        if (command.type == NOVA_STREAM_SEEK && (command.end_frame || command.loop)) return NOVA_AUDIO_CONTROL_INVALID;
    } else if (command.frame || command.end_frame || command.loop) return NOVA_AUDIO_CONTROL_INVALID;
    unsigned write = atomic_load_explicit(&s->command_write, memory_order_relaxed);
    unsigned read = atomic_load_explicit(&s->command_read, memory_order_acquire);
    if (write - read == NOVA_AUDIO_COMMAND_CAPACITY) return NOVA_AUDIO_CONTROL_QUEUE_FULL;
    uint64_t next = ++s->next_ticket;
    s->commands[write % NOVA_AUDIO_COMMAND_CAPACITY] = (Control){command, next};
    atomic_store_explicit(&s->command_write, write + 1, memory_order_release);
    *ticket = next;
    return NOVA_AUDIO_CONTROL_OK;
}

bool nova_audio_stream_receipt(NovaAudioStream *s, NovaAudioStreamReceipt *receipt)
{
    unsigned read = atomic_load_explicit(&s->receipt_read, memory_order_relaxed);
    if (read == atomic_load_explicit(&s->receipt_write, memory_order_acquire)) return false;
    *receipt = s->receipts[read % NOVA_AUDIO_COMMAND_CAPACITY];
    atomic_store_explicit(&s->receipt_read, read + 1, memory_order_release);
    return true;
}

bool nova_audio_stream_snapshot(NovaAudioStream *s, NovaAudioStreamSnapshot *snapshot)
{
    if (!(atomic_load_explicit(&s->snapshot_middle, memory_order_acquire) & DIRTY)) return false;
    unsigned middle = atomic_exchange_explicit(&s->snapshot_middle, s->snapshot_read, memory_order_acq_rel);
    s->snapshot_read = middle & 3u;
    *snapshot = s->snapshots[s->snapshot_read];
    return true;
}

static void ramp(NovaAudioStream *s, float target, unsigned frames)
{
    s->ramp_start = s->status.gain; s->ramp_end = target;
    s->ramp_frames = frames; s->ramp_position = 0;
    if (!frames) s->status.gain = target;
}

static void finish_transition(NovaAudioStream *s)
{
    s->status.gain = 0; s->ramp_frames = 0;
    if (s->status.state == NOVA_STREAM_CANCELLING) {
        s->status.state = NOVA_STREAM_CANCELLED;
        s->status.generation = s->transition_ticket;
        request_read(s, true);
    } else s->status.state = NOVA_STREAM_PAUSED;
    s->status.completed_command = s->transition_ticket;
}

static NovaAudioControlResult apply(NovaAudioStream *s, Control control)
{
    NovaAudioStreamCommand command = control.command;
    if (command.generation != s->status.generation) return NOVA_AUDIO_CONTROL_STALE;
    if (s->status.fault) return NOVA_AUDIO_CONTROL_RENDER_FAILED;
    if (s->status.state == NOVA_STREAM_PAUSING || s->status.state == NOVA_STREAM_CANCELLING)
        return NOVA_AUDIO_CONTROL_BUSY;
    if (command.type == NOVA_STREAM_SEEK || command.type == NOVA_STREAM_REGION) {
        if (s->status.state == NOVA_STREAM_PLAYING) return NOVA_AUDIO_CONTROL_BUSY;
        if (command.type == NOVA_STREAM_SEEK && (command.frame < s->status.loop_begin ||
            command.frame > s->status.loop_end || (s->status.loop && command.frame == s->status.loop_end)))
            return NOVA_AUDIO_CONTROL_INVALID;
        if (command.type == NOVA_STREAM_REGION) {
            s->status.loop_begin = command.frame; s->status.loop_end = command.end_frame;
            s->status.loop = command.loop;
        }
        s->status.position = command.frame;
        s->status.generation = control.ticket;
        bool ended = !s->status.loop && command.frame == s->status.loop_end;
        s->status.state = ended ? NOVA_STREAM_ENDED : NOVA_STREAM_PAUSED;
        s->status.gain = 0; s->ramp_frames = 0;
        request_read(s, ended);
    } else if (command.type == NOVA_STREAM_RESUME) {
        if (s->status.state == NOVA_STREAM_CANCELLED || s->status.state == NOVA_STREAM_ENDED) return NOVA_AUDIO_CONTROL_BUSY;
        if (s->status.state != NOVA_STREAM_PLAYING) {
            s->status.state = NOVA_STREAM_PLAYING;
            ramp(s, 1, command.fade_frames);
        }
    } else {
        s->transition_ticket = control.ticket;
        bool playing = s->status.state == NOVA_STREAM_PLAYING;
        if (command.type == NOVA_STREAM_PAUSE && !playing) {
            s->status.completed_command = control.ticket;
            return NOVA_AUDIO_CONTROL_OK;
        }
        s->status.state = command.type == NOVA_STREAM_CANCEL ? NOVA_STREAM_CANCELLING : NOVA_STREAM_PAUSING;
        ramp(s, 0, playing ? command.fade_frames : 0);
        if (!s->ramp_frames) finish_transition(s);
    }
    if (s->status.state != NOVA_STREAM_PAUSING && s->status.state != NOVA_STREAM_CANCELLING)
        s->status.completed_command = control.ticket;
    return NOVA_AUDIO_CONTROL_OK;
}

static void commands(NovaAudioStream *s)
{
    unsigned read = atomic_load_explicit(&s->command_read, memory_order_relaxed);
    unsigned end = atomic_load_explicit(&s->command_write, memory_order_acquire);
    unsigned write = atomic_load_explicit(&s->receipt_write, memory_order_relaxed);
    while (read != end) {
        if (write - atomic_load_explicit(&s->receipt_read, memory_order_acquire) == NOVA_AUDIO_COMMAND_CAPACITY) break;
        Control control = s->commands[read % NOVA_AUDIO_COMMAND_CAPACITY];
        NovaAudioControlResult result = apply(s, control);
        s->status.last_command = control.ticket;
        s->receipts[write % NOVA_AUDIO_COMMAND_CAPACITY] = (NovaAudioStreamReceipt){
            control.ticket, s->status.generation, control.command.type, result};
        atomic_store_explicit(&s->receipt_write, ++write, memory_order_release);
        atomic_store_explicit(&s->command_read, ++read, memory_order_release);
    }
}

static void pop(NovaAudioStream *s, unsigned read)
{
    s->block_offset = 0;
    atomic_store_explicit(&s->data_read, read + 1, memory_order_release);
}

static void discard_stale(NovaAudioStream *s)
{
    unsigned read = atomic_load_explicit(&s->data_read, memory_order_relaxed);
    unsigned end = atomic_load_explicit(&s->data_write, memory_order_acquire);
    while (read != end && s->blocks[read % NOVA_AUDIO_STREAM_BLOCKS].generation != s->status.generation) {
        pop(s, read++); ++s->status.stale_blocks;
    }
}

static void observe_fault(NovaAudioStream *s)
{
    unsigned read = atomic_load_explicit(&s->data_read, memory_order_relaxed);
    unsigned end = atomic_load_explicit(&s->data_write, memory_order_acquire);
    for (unsigned index = read; index != end; ++index) {
        DecodeBlock *block = &s->blocks[index % NOVA_AUDIO_STREAM_BLOCKS];
        if (block->generation == s->status.generation && block->fault && !s->status.fault) {
            s->status.fault = block->fault; s->status.fault_frame = block->fault_frame;
            s->status.system_error = block->system_error;
            s->status.state = NOVA_STREAM_FAULTED; s->status.gain = 0;
        }
    }
}

static bool playing(const NovaAudioStream *s)
{
    return s->status.state == NOVA_STREAM_PLAYING || s->status.state == NOVA_STREAM_PAUSING ||
        s->status.state == NOVA_STREAM_CANCELLING;
}

static void finish_source(NovaAudioStream *s)
{
    if (s->status.state == NOVA_STREAM_CANCELLED) return;
    if (s->status.state == NOVA_STREAM_CANCELLING) finish_transition(s);
    else {
        if (s->status.state == NOVA_STREAM_PAUSING) s->status.completed_command = s->transition_ticket;
        s->status.state = NOVA_STREAM_ENDED; s->status.gain = 0; s->ramp_frames = 0;
    }
}

NovaAudioStreamRenderResult nova_audio_stream_render(NovaAudioStream *s, float *stereo, size_t frames)
{
    if (!s || (frames && !stereo) || frames > NOVA_AUDIO_MAX_BLOCK) return NOVA_STREAM_RENDER_INVALID;
    commands(s);
    discard_stale(s);
    observe_fault(s);
    if (frames > UINT64_MAX - s->status.output_frames) {
        s->status.fault = NOVA_STREAM_CLOCK_OVERFLOW; s->status.state = NOVA_STREAM_FAULTED;
    } else s->status.output_frames += frames;
    if (frames) memset(stereo, 0, frames * 2 * sizeof(float));
    bool starved = false;
    for (size_t frame = 0; frame < frames && playing(s); ++frame) {
        discard_stale(s);
        unsigned read = atomic_load_explicit(&s->data_read, memory_order_relaxed);
        unsigned end = atomic_load_explicit(&s->data_write, memory_order_acquire);
        if (read == end) {
            if (!s->status.starved) ++s->status.underrun_episodes;
            s->status.starved = starved = true;
            s->status.underrun_frames += frames - frame;
            if (s->status.state != NOVA_STREAM_PLAYING) finish_transition(s);
            break;
        }
        DecodeBlock *block = &s->blocks[read % NOVA_AUDIO_STREAM_BLOCKS];
        if (block->generation != s->status.generation) {
            /* A producer may publish one obsolete read after discard_stale's
             * snapshot. Leave it for the next bounded callback, never play it. */
            if (!s->status.starved) ++s->status.underrun_episodes;
            s->status.starved = starved = true;
            s->status.underrun_frames += frames - frame;
            if (s->status.state != NOVA_STREAM_PLAYING) finish_transition(s);
            break;
        }
        if (block->fault) { observe_fault(s); break; }
        if (!block->frames) {
            finish_source(s); pop(s, read); break;
        }
        s->status.starved = false;
        for (unsigned channel = 0; channel < 2; ++channel) {
            float value = block->samples[s->block_offset * 2 + channel] * s->status.gain;
            stereo[frame * 2 + channel] = value;
            s->status.peak[channel] = fmaxf(s->status.peak[channel], fabsf(value));
        }
        if (fabsf(stereo[frame * 2]) > 1 || fabsf(stereo[frame * 2 + 1]) > 1) ++s->status.over_frames;
        ++s->status.position; ++s->status.rendered_frames; ++s->block_offset;
        bool ended = false;
        if (s->block_offset == block->frames) { ended = block->end; pop(s, read); }
        if (s->status.loop && s->status.position == s->status.loop_end) {
            s->status.position = s->status.loop_begin; ++s->status.loops;
        }
        if (s->ramp_position < s->ramp_frames) {
            ++s->ramp_position;
            s->status.gain = s->ramp_start + (s->ramp_end - s->ramp_start) *
                ((float)s->ramp_position / s->ramp_frames);
            if (s->ramp_position == s->ramp_frames && s->status.state != NOVA_STREAM_PLAYING) finish_transition(s);
        }
        if (ended) finish_source(s);
    }
    if (!playing(s)) s->status.starved = false;
    publish(s);
    if (s->status.fault) return NOVA_STREAM_RENDER_FAULT;
    if (starved) return NOVA_STREAM_RENDER_STARVED;
    switch (s->status.state) {
    case NOVA_STREAM_PAUSED: return NOVA_STREAM_RENDER_PAUSED;
    case NOVA_STREAM_CANCELLED: return NOVA_STREAM_RENDER_CANCELLED;
    case NOVA_STREAM_ENDED: return NOVA_STREAM_RENDER_ENDED;
    default: return NOVA_STREAM_RENDER_OK;
    }
}

const char *nova_audio_stream_fault_message(NovaAudioStreamFault fault)
{
    switch (fault) {
    case NOVA_STREAM_NO_FAULT: return "no disk stream fault";
    case NOVA_STREAM_READ_FAILED: return "disk audio read/stat failed or ended unexpectedly; inspect system error and source frame";
    case NOVA_STREAM_SOURCE_CHANGED: return "disk audio source changed after opening; close/reopen explicitly";
    case NOVA_STREAM_INVALID_PCM: return "disk audio contains nonfinite or out-of-budget float PCM; no clipping was applied";
    case NOVA_STREAM_CLOCK_OVERFLOW: return "disk audio output clock exhausted";
    }
    return "unknown disk stream fault";
}
