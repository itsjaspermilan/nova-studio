#include "transport.h"

#include <math.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { SLOT_FREE, SLOT_OWNED, SLOT_RECLAIM };
enum { NO_SLOT = NOVA_AUDIO_RENDERER_CAPACITY, SNAPSHOT_DIRTY = 4 };

typedef struct {
    NovaAudioRenderer *renderer;
    atomic_uint state;
} Slot;

typedef struct {
    NovaAudioReceipt receipt;
    uint32_t slot, fade;
} Command;

struct NovaAudioTransport {
    uint32_t rate;
    uint64_t next_ticket;
    Slot slots[NOVA_AUDIO_RENDERER_CAPACITY];
    Command commands[NOVA_AUDIO_COMMAND_CAPACITY];
    NovaAudioReceipt receipts[NOVA_AUDIO_COMMAND_CAPACITY];
    atomic_uint command_read, command_write, receipt_read, receipt_write;
    NovaAudioTransportSnapshot snapshots[3];
    atomic_uint middle;
    unsigned snapshot_read, snapshot_write;
    uint32_t current, tail, fade_frames, fade_position;
    float current_scale, tail_scale;
    NovaAudioTransportSnapshot status;
};

static bool fail(char *error, size_t size, const char *message)
{
    if (error && size) snprintf(error, size, "%s", message);
    return false;
}

bool nova_audio_transport_create(uint32_t rate, NovaAudioTransport **out, char *error, size_t error_size)
{
    if (!out || (rate != 44100 && rate != 48000))
        return fail(error, error_size, "audio transport requires 44100 or 48000 Hz and an output pointer");
    if (ATOMIC_INT_LOCK_FREE != 2)
        return fail(error, error_size, "audio transport requires always-lock-free unsigned atomics");
    NovaAudioTransport *t = calloc(1, sizeof(*t));
    if (!t) return fail(error, error_size, "audio transport allocation failed");
    t->rate = rate;
    t->current = t->tail = NO_SLOT;
    t->snapshot_read = 1;
    t->snapshot_write = 0;
    t->status.sample_rate = rate;
    atomic_init(&t->middle, 2);
    atomic_init(&t->command_read, 0); atomic_init(&t->command_write, 0);
    atomic_init(&t->receipt_read, 0); atomic_init(&t->receipt_write, 0);
    for (unsigned i = 0; i < NOVA_AUDIO_RENDERER_CAPACITY; ++i) atomic_init(&t->slots[i].state, SLOT_FREE);
    *out = t;
    if (error && error_size) error[0] = '\0';
    return true;
}

void nova_audio_transport_destroy(NovaAudioTransport *t)
{
    if (!t) return;
    for (unsigned i = 0; i < NOVA_AUDIO_RENDERER_CAPACITY; ++i)
        nova_audio_renderer_destroy(t->slots[i].renderer);
    free(t);
}

uint32_t nova_audio_transport_rate(const NovaAudioTransport *t) { return t->rate; }

size_t nova_audio_transport_collect(NovaAudioTransport *t)
{
    size_t count = 0;
    for (unsigned i = 0; i < NOVA_AUDIO_RENDERER_CAPACITY; ++i) {
        Slot *slot = &t->slots[i];
        if (atomic_load_explicit(&slot->state, memory_order_acquire) != SLOT_RECLAIM) continue;
        nova_audio_renderer_destroy(slot->renderer);
        slot->renderer = NULL;
        atomic_store_explicit(&slot->state, SLOT_FREE, memory_order_relaxed);
        ++count;
    }
    return count;
}

static NovaAudioControlResult can_enqueue(NovaAudioTransport *t, uint32_t fade, uint64_t *ticket)
{
    if (!t || !ticket || !fade || fade > t->rate * 60 || t->next_ticket == UINT64_MAX)
        return NOVA_AUDIO_CONTROL_INVALID;
    unsigned write = atomic_load_explicit(&t->command_write, memory_order_relaxed);
    unsigned read = atomic_load_explicit(&t->command_read, memory_order_acquire);
    return write - read == NOVA_AUDIO_COMMAND_CAPACITY ? NOVA_AUDIO_CONTROL_QUEUE_FULL : NOVA_AUDIO_CONTROL_OK;
}

static void enqueue(NovaAudioTransport *t, Command command, uint64_t *ticket)
{
    unsigned write = atomic_load_explicit(&t->command_write, memory_order_relaxed);
    command.receipt.ticket = ++t->next_ticket;
    if (command.receipt.type == NOVA_AUDIO_REPLACE) command.receipt.program = command.receipt.ticket;
    t->commands[write % NOVA_AUDIO_COMMAND_CAPACITY] = command;
    atomic_store_explicit(&t->command_write, write + 1, memory_order_release);
    *ticket = command.receipt.ticket;
}

NovaAudioControlResult nova_audio_transport_replace(NovaAudioTransport *t,
    NovaAudioProgram *program, uint32_t fade_frames, uint64_t *ticket)
{
    if (!program) return NOVA_AUDIO_CONTROL_INVALID;
    NovaAudioControlResult result = can_enqueue(t, fade_frames, ticket);
    if (result != NOVA_AUDIO_CONTROL_OK) return result;
    if (nova_audio_program_rate(program) != t->rate) return NOVA_AUDIO_CONTROL_RATE_MISMATCH;
    nova_audio_transport_collect(t);
    unsigned index = 0;
    while (index < NOVA_AUDIO_RENDERER_CAPACITY &&
        atomic_load_explicit(&t->slots[index].state, memory_order_relaxed) != SLOT_FREE) ++index;
    if (index == NOVA_AUDIO_RENDERER_CAPACITY) return NOVA_AUDIO_CONTROL_RENDERERS_FULL;
    NovaAudioRenderer *renderer = NULL;
    if (!nova_audio_renderer_create(program, &renderer, NULL, 0)) return NOVA_AUDIO_CONTROL_ALLOCATION_FAILED;
    t->slots[index].renderer = renderer;
    atomic_store_explicit(&t->slots[index].state, SLOT_OWNED, memory_order_relaxed);
    enqueue(t, (Command){.receipt.type = NOVA_AUDIO_REPLACE, .slot = index, .fade = fade_frames}, ticket);
    return NOVA_AUDIO_CONTROL_OK;
}

NovaAudioControlResult nova_audio_transport_command(NovaAudioTransport *t,
    NovaAudioControlType type, uint64_t program, uint32_t fade_frames, uint64_t *ticket)
{
    if ((type != NOVA_AUDIO_CANCEL && type != NOVA_AUDIO_RESET) || !program) return NOVA_AUDIO_CONTROL_INVALID;
    NovaAudioControlResult result = can_enqueue(t, fade_frames, ticket);
    if (result != NOVA_AUDIO_CONTROL_OK) return result;
    enqueue(t, (Command){.receipt = {.program = program, .type = type}, .fade = fade_frames}, ticket);
    return NOVA_AUDIO_CONTROL_OK;
}

bool nova_audio_transport_receipt(NovaAudioTransport *t, NovaAudioReceipt *receipt)
{
    unsigned read = atomic_load_explicit(&t->receipt_read, memory_order_relaxed);
    if (read == atomic_load_explicit(&t->receipt_write, memory_order_acquire)) return false;
    *receipt = t->receipts[read % NOVA_AUDIO_COMMAND_CAPACITY];
    atomic_store_explicit(&t->receipt_read, read + 1, memory_order_release);
    return true;
}

bool nova_audio_transport_snapshot(NovaAudioTransport *t, NovaAudioTransportSnapshot *snapshot)
{
    if (!(atomic_load_explicit(&t->middle, memory_order_acquire) & SNAPSHOT_DIRTY)) return false;
    unsigned middle = atomic_exchange_explicit(&t->middle, t->snapshot_read, memory_order_acq_rel);
    t->snapshot_read = middle & 3u;
    *snapshot = t->snapshots[t->snapshot_read];
    return true;
}

static float current_scale(const NovaAudioTransport *t)
{
    return t->fade_frames ? (float)t->fade_position / t->fade_frames : t->current_scale;
}

static void reclaim(NovaAudioTransport *t, uint32_t slot)
{
    atomic_store_explicit(&t->slots[slot].state, SLOT_RECLAIM, memory_order_release);
}

static void retire_finished_tail(NovaAudioTransport *t)
{
    if (t->tail != NO_SLOT && nova_audio_status(t->slots[t->tail].renderer).finished) {
        uint32_t slot = t->tail;
        t->tail = NO_SLOT;
        t->status.retiring_program = 0;
        reclaim(t, slot);
    }
}

static NovaAudioControlResult apply(NovaAudioTransport *t, Command command)
{
    if (t->status.fault != NOVA_AUDIO_OK) {
        if (command.receipt.type == NOVA_AUDIO_REPLACE) reclaim(t, command.slot);
        return NOVA_AUDIO_CONTROL_RENDER_FAILED;
    }
    if (command.receipt.type == NOVA_AUDIO_REPLACE) {
        if (t->tail != NO_SLOT) { reclaim(t, command.slot); return NOVA_AUDIO_CONTROL_BUSY; }
        if (t->current != NO_SLOT) {
            uint32_t previous = t->current;
            if (nova_audio_status(t->slots[previous].renderer).finished) reclaim(t, previous);
            else {
                t->tail = previous;
                t->tail_scale = current_scale(t);
                t->status.retiring_program = t->status.program;
                nova_audio_cancel(t->slots[previous].renderer, command.fade);
            }
        }
        t->current = command.slot;
        t->status.program = command.receipt.program;
        t->fade_position = 0; t->fade_frames = command.fade; t->current_scale = 1;
        return NOVA_AUDIO_CONTROL_OK;
    }
    if (t->current == NO_SLOT || t->status.program != command.receipt.program) return NOVA_AUDIO_CONTROL_STALE;
    NovaAudioRenderer *r = t->slots[t->current].renderer;
    if (command.receipt.type == NOVA_AUDIO_CANCEL) {
        t->current_scale = current_scale(t); t->fade_frames = 0;
        if (nova_audio_cancel(r, command.fade) != NOVA_AUDIO_OK) return NOVA_AUDIO_CONTROL_RENDER_FAILED;
        if (t->tail != NO_SLOT) nova_audio_cancel(t->slots[t->tail].renderer, command.fade);
    } else {
        if (t->tail != NO_SLOT || !nova_audio_status(r).finished) return NOVA_AUDIO_CONTROL_BUSY;
        nova_audio_renderer_reset(r);
        t->fade_position = 0; t->fade_frames = command.fade; t->current_scale = 1;
    }
    return NOVA_AUDIO_CONTROL_OK;
}

static void commands(NovaAudioTransport *t)
{
    unsigned read = atomic_load_explicit(&t->command_read, memory_order_relaxed);
    unsigned end = atomic_load_explicit(&t->command_write, memory_order_acquire);
    unsigned write = atomic_load_explicit(&t->receipt_write, memory_order_relaxed);
    while (read != end) {
        if (write - atomic_load_explicit(&t->receipt_read, memory_order_acquire) == NOVA_AUDIO_COMMAND_CAPACITY) break;
        Command command = t->commands[read % NOVA_AUDIO_COMMAND_CAPACITY];
        command.receipt.result = apply(t, command);
        t->status.last_command = command.receipt.ticket;
        t->receipts[write % NOVA_AUDIO_COMMAND_CAPACITY] = command.receipt;
        ++write; ++read;
        atomic_store_explicit(&t->receipt_write, write, memory_order_release);
        atomic_store_explicit(&t->command_read, read, memory_order_release);
    }
}

static void publish(NovaAudioTransport *t)
{
    t->status.current = t->current == NO_SLOT ? (NovaAudioStatus){0} : nova_audio_status(t->slots[t->current].renderer);
    t->status.retiring = t->tail == NO_SLOT ? (NovaAudioStatus){0} : nova_audio_status(t->slots[t->tail].renderer);
    ++t->status.publication;
    t->snapshots[t->snapshot_write] = t->status;
    t->snapshot_write = atomic_exchange_explicit(&t->middle, t->snapshot_write | SNAPSHOT_DIRTY, memory_order_acq_rel) & 3u;
}

NovaAudioResult nova_audio_transport_render(NovaAudioTransport *t, float *stereo, size_t frames)
{
    if (!t || (frames && !stereo) || frames > NOVA_AUDIO_MAX_BLOCK) return NOVA_AUDIO_INVALID_ARGUMENT;
    retire_finished_tail(t);
    commands(t);
    if (frames > UINT64_MAX - t->status.output_frames) t->status.fault = NOVA_AUDIO_CLOCK_OVERFLOW;
    if (frames) memset(stereo, 0, frames * 2 * sizeof(float));
    if (t->status.fault == NOVA_AUDIO_OK) {
        float current[NOVA_AUDIO_MAX_BLOCK * 2], tail[NOVA_AUDIO_MAX_BLOCK * 2];
        if (t->current != NO_SLOT)
            t->status.fault = nova_audio_render(t->slots[t->current].renderer, current, frames);
        if (t->status.fault == NOVA_AUDIO_OK && t->tail != NO_SLOT)
            t->status.fault = nova_audio_render(t->slots[t->tail].renderer, tail, frames);
        if (t->status.fault == NOVA_AUDIO_OK) {
            for (size_t frame = 0; frame < frames; ++frame) {
                float gain = current_scale(t);
                for (unsigned channel = 0; channel < 2; ++channel) {
                    size_t i = frame * 2 + channel;
                    double mixed = (t->current == NO_SLOT ? 0 : (double)current[i] * gain) +
                        (t->tail == NO_SLOT ? 0 : (double)tail[i] * t->tail_scale);
                    stereo[i] = (float)mixed;
                    if (!isfinite(stereo[i])) t->status.fault = NOVA_AUDIO_NONFINITE;
                    t->status.peak[channel] = fmaxf(t->status.peak[channel], fabsf(stereo[i]));
                }
                if (fabsf(stereo[frame * 2]) > 1 || fabsf(stereo[frame * 2 + 1]) > 1) ++t->status.over_frames;
                if (t->fade_position < t->fade_frames) ++t->fade_position;
            }
        }
        t->status.output_frames += frames;
    }
    if (t->status.fault != NOVA_AUDIO_OK && frames) memset(stereo, 0, frames * 2 * sizeof(float));
    retire_finished_tail(t);
    publish(t);
    return t->status.fault;
}

const char *nova_audio_control_message(NovaAudioControlResult result)
{
    switch (result) {
    case NOVA_AUDIO_CONTROL_OK: return "accepted";
    case NOVA_AUDIO_CONTROL_INVALID: return "invalid audio control argument or exhausted ticket counter";
    case NOVA_AUDIO_CONTROL_QUEUE_FULL: return "audio command queue full; poll receipts and retry explicitly";
    case NOVA_AUDIO_CONTROL_RENDERERS_FULL: return "audio renderer ownership capacity exhausted";
    case NOVA_AUDIO_CONTROL_RATE_MISMATCH: return "program rate does not match transport; reopen transport at the intended rate";
    case NOVA_AUDIO_CONTROL_ALLOCATION_FAILED: return "audio renderer preparation allocation failed";
    case NOVA_AUDIO_CONTROL_STALE: return "stale audio transport or program identity";
    case NOVA_AUDIO_CONTROL_BUSY: return "previous audio transition is active; cancel/await completion before reset or retry replacement";
    case NOVA_AUDIO_CONTROL_RENDER_FAILED: return "audio rendering failed; inspect snapshot fault";
    case NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE: return "shared audio device is not started or its configuration changed";
    case NOVA_AUDIO_CONTROL_BACKEND_FAILED: return "native audio backend initialization or stream allocation failed";
    }
    return "unknown audio control result";
}
