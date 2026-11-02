#include "transport.h"

#include <math.h>
#include <pthread.h>
#include <sched.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #c); exit(1); } } while (0)
#define NEAR(a, b) CHECK(fabs((double)(a) - (double)(b)) < 0.000002)

static char error[512];

static NovaAudioProgram *program(uint32_t rate, float level)
{
    float data[] = {level, level, level, level};
    NovaAudioSample *sample = NULL;
    CHECK(nova_audio_sample_create(data, (NovaAudioSampleInfo){rate, 1, 4}, &sample, error, sizeof(error)));
    NovaAudioPatch patch = {.source = NOVA_AUDIO_SAMPLER, .envelope = {1, 0, 16, 1},
        .sample_end = 4, .sample_loop = true, .sample_root_hz = 440, .sample_max_ratio = 1};
    NovaAudioBus bus = {NOVA_AUDIO_NO_BUS, 1, 0};
    NovaAudioEvent events[] = {
        {.type = NOVA_AUDIO_NOTE_ON, .target = 1, .note = {.frequency = 440, .gain = 1, .pan = -1}},
        {.frame = 48000, .type = NOVA_AUDIO_NOTE_OFF, .target = 1}
    };
    NovaAudioProgramDesc desc = {.sample_rate = rate, .voice_limit = 1, .length_frames = 48016,
        .samples = &sample, .sample_count = 1, .patches = &patch, .patch_count = 1,
        .buses = &bus, .bus_count = 1, .events = events, .event_count = 2, .loop = true};
    NovaAudioProgram *p = NULL;
    CHECK(nova_audio_program_create(&desc, &p, error, sizeof(error)));
    nova_audio_sample_release(sample);
    return p;
}

static NovaAudioTransport *transport(uint32_t rate)
{
    NovaAudioTransport *t = NULL;
    CHECK(nova_audio_transport_create(rate, &t, error, sizeof(error)));
    CHECK(nova_audio_transport_rate(t) == rate);
    return t;
}

static void receipt(NovaAudioTransport *t, uint64_t ticket, NovaAudioControlResult expected)
{
    NovaAudioReceipt r;
    CHECK(nova_audio_transport_receipt(t, &r));
    CHECK(r.ticket == ticket && r.result == expected);
}

static NovaAudioTransportSnapshot snapshot(NovaAudioTransport *t)
{
    NovaAudioTransportSnapshot value;
    CHECK(nova_audio_transport_snapshot(t, &value));
    return value;
}

static void independent_lifetimes(void)
{
    NovaAudioProgram *p = program(48000, 1), *other_rate = program(44100, 0.5f);
    NovaAudioTransport *a = transport(48000), *b = transport(44100);
    uint64_t first = 999, second = 999, command;
    CHECK(nova_audio_transport_replace(a, other_rate, 8, &first) == NOVA_AUDIO_CONTROL_RATE_MISMATCH && first == 999);
    CHECK(nova_audio_transport_replace(a, p, 8, &first) == NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_transport_replace(b, other_rate, 8, &second) == NOVA_AUDIO_CONTROL_OK);
    nova_audio_program_release(p); nova_audio_program_release(other_rate);
    float left[128], right[128];
    CHECK(nova_audio_transport_render(a, left, 16) == NOVA_AUDIO_OK);
    CHECK(nova_audio_transport_render(b, right, 16) == NOVA_AUDIO_OK);
    receipt(a, first, NOVA_AUDIO_CONTROL_OK); receipt(b, second, NOVA_AUDIO_CONTROL_OK);
    for (unsigned i = 0; i < 16; ++i) {
        NEAR(left[i * 2], i < 8 ? i / 8.0 : 1);
        NEAR(right[i * 2], left[i * 2] * 0.5);
        CHECK(left[i * 2 + 1] == 0 && right[i * 2 + 1] == 0);
    }
    CHECK(nova_audio_transport_command(a, NOVA_AUDIO_RESET, first, 8, &command) == NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_transport_render(a, left, 0) == NOVA_AUDIO_OK);
    receipt(a, command, NOVA_AUDIO_CONTROL_BUSY);
    CHECK(nova_audio_transport_command(a, NOVA_AUDIO_CANCEL, first, 8, &command) == NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_transport_render(a, left, 32) == NOVA_AUDIO_OK);
    receipt(a, command, NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_transport_render(b, right, 32) == NOVA_AUDIO_OK);
    for (unsigned i = 0; i < 32; ++i) {
        NEAR(left[i * 2], i < 8 ? 1 - i / 8.0 : 0);
        NEAR(right[i * 2], 0.5);
    }
    NovaAudioTransportSnapshot a_status = snapshot(a), b_status = snapshot(b);
    CHECK(a_status.current.finished && a_status.current.cancelled && !b_status.current.cancelled);
    CHECK(a_status.current.clock == 48 && b_status.current.clock == 48);
    CHECK(!nova_audio_transport_snapshot(a, &a_status));
    CHECK(nova_audio_transport_command(a, NOVA_AUDIO_RESET, first, 8, &command) == NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_transport_render(a, left, 16) == NOVA_AUDIO_OK);
    receipt(a, command, NOVA_AUDIO_CONTROL_OK);
    a_status = snapshot(a);
    CHECK(a_status.current.clock == 16 && !a_status.current.cancelled && a_status.program == first);
    CHECK(nova_audio_transport_command(a, NOVA_AUDIO_CANCEL, first + 99, 8, &command) == NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_transport_render(a, left, 0) == NOVA_AUDIO_OK);
    receipt(a, command, NOVA_AUDIO_CONTROL_STALE);
    CHECK(nova_audio_transport_command(a, NOVA_AUDIO_CANCEL, first, 0, &command) == NOVA_AUDIO_CONTROL_INVALID);
    CHECK(nova_audio_transport_render(a, left, NOVA_AUDIO_MAX_BLOCK + 1) == NOVA_AUDIO_INVALID_ARGUMENT);
    nova_audio_transport_destroy(a); nova_audio_transport_destroy(b);
}

static void replacement_and_backpressure(void)
{
    NovaAudioTransport *t = transport(48000);
    NovaAudioProgram *p = program(48000, 1), *negative = program(48000, -1);
    float data[128 * 2];
    uint64_t first, second, third, stale;
    CHECK(nova_audio_transport_replace(t, p, 8, &first) == NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_transport_render(t, data, 32) == NOVA_AUDIO_OK);
    receipt(t, first, NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_transport_replace(t, negative, 8, &second) == NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_transport_replace(t, p, 8, &third) == NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_transport_command(t, NOVA_AUDIO_CANCEL, first, 8, &stale) == NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_transport_render(t, data, 4) == NOVA_AUDIO_OK);
    receipt(t, second, NOVA_AUDIO_CONTROL_OK);
    receipt(t, third, NOVA_AUDIO_CONTROL_BUSY);
    receipt(t, stale, NOVA_AUDIO_CONTROL_STALE);
    for (unsigned i = 0; i < 4; ++i) NEAR(data[i * 2], 1 - i / 4.0);
    CHECK(nova_audio_transport_collect(t) == 1);
    CHECK(nova_audio_transport_render(t, data, 12) == NOVA_AUDIO_OK);
    CHECK(nova_audio_transport_collect(t) == 1);
    NovaAudioTransportSnapshot state = snapshot(t);
    CHECK(state.program == second && !state.retiring_program);
    CHECK(nova_audio_transport_replace(t, p, 8, &third) == NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_transport_render(t, data, 32) == NOVA_AUDIO_OK);
    receipt(t, third, NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_transport_collect(t) == 1);
    for (unsigned i = 0; i < 2 * NOVA_AUDIO_COMMAND_CAPACITY; ++i) {
        uint64_t ticket;
        CHECK(nova_audio_transport_command(t, NOVA_AUDIO_CANCEL, third + 100, 8, &ticket) == NOVA_AUDIO_CONTROL_OK);
        if (i == NOVA_AUDIO_COMMAND_CAPACITY - 1) CHECK(nova_audio_transport_render(t, data, 0) == NOVA_AUDIO_OK);
    }
    uint64_t unchanged = 234;
    CHECK(nova_audio_transport_replace(t, negative, 8, &unchanged) == NOVA_AUDIO_CONTROL_QUEUE_FULL && unchanged == 234);
    CHECK(nova_audio_transport_render(t, data, 1) == NOVA_AUDIO_OK);
    for (unsigned i = 0; i < NOVA_AUDIO_COMMAND_CAPACITY; ++i) {
        NovaAudioReceipt r;
        CHECK(nova_audio_transport_receipt(t, &r) && r.result == NOVA_AUDIO_CONTROL_STALE);
    }
    CHECK(nova_audio_transport_render(t, data, 0) == NOVA_AUDIO_OK);
    for (unsigned i = 0; i < NOVA_AUDIO_COMMAND_CAPACITY; ++i) {
        NovaAudioReceipt r;
        CHECK(nova_audio_transport_receipt(t, &r) && r.result == NOVA_AUDIO_CONTROL_STALE);
    }
    CHECK(nova_audio_transport_replace(t, negative, 8, &unchanged) == NOVA_AUDIO_CONTROL_OK);
    nova_audio_program_release(p); nova_audio_program_release(negative);
    nova_audio_transport_destroy(t);
}

static void render_split(NovaAudioTransport *t, float *output, unsigned frames, unsigned block)
{
    for (unsigned position = 0; position < frames;) {
        unsigned count = frames - position > block ? block : frames - position;
        CHECK(nova_audio_transport_render(t, output + position * 2, count) == NOVA_AUDIO_OK);
        position += count;
    }
}

static void transition_block_independence(void)
{
    NovaAudioProgram *positive = program(48000, 1), *negative = program(48000, -1);
    NovaAudioTransport *transports[] = {transport(48000), transport(48000)};
    float output[2][64 * 2];
    uint64_t publications[2];
    for (unsigned index = 0; index < 2; ++index) {
        NovaAudioTransport *t = transports[index];
        unsigned block = index ? 3 : 64;
        uint64_t first, second, command;
        CHECK(nova_audio_transport_replace(t, positive, 31, &first) == NOVA_AUDIO_CONTROL_OK);
        render_split(t, output[index], 17, block);
        CHECK(nova_audio_transport_replace(t, negative, 19, &second) == NOVA_AUDIO_CONTROL_OK);
        render_split(t, output[index] + 17 * 2, 7, block);
        for (unsigned frame = 0; frame < 7; ++frame)
            NEAR(output[index][(17 + frame) * 2], (17.0 / 31) * (1 - frame / 19.0) - frame / 19.0);
        CHECK(nova_audio_transport_command(t, NOVA_AUDIO_CANCEL, second, 5, &command) == NOVA_AUDIO_CONTROL_OK);
        CHECK(nova_audio_transport_command(t, NOVA_AUDIO_RESET, second, 13, &command) == NOVA_AUDIO_CONTROL_OK);
        render_split(t, output[index] + 24 * 2, 13, block);
        NovaAudioTransportSnapshot state = snapshot(t);
        CHECK(state.current.cancelled && state.current.finished && !state.retiring_program);
        CHECK(nova_audio_transport_collect(t) == 1);
        CHECK(nova_audio_transport_command(t, NOVA_AUDIO_RESET, second, 13, &command) == NOVA_AUDIO_CONTROL_OK);
        render_split(t, output[index] + 37 * 2, 27, block);
        for (unsigned receipt_index = 0; receipt_index < 5; ++receipt_index)
            receipt(t, receipt_index + 1, receipt_index == 3 ? NOVA_AUDIO_CONTROL_BUSY : NOVA_AUDIO_CONTROL_OK);
        state = snapshot(t);
        CHECK(state.current.clock == 27 && state.output_frames == 64 && state.program == second);
        CHECK(!state.current.cancelled && !state.current.finished);
        publications[index] = state.publication;
        CHECK(!nova_audio_transport_snapshot(t, &state));
        nova_audio_transport_destroy(t);
    }
    CHECK(!memcmp(output[0], output[1], sizeof(output[0])));
    CHECK(publications[1] > publications[0]);
    nova_audio_program_release(positive); nova_audio_program_release(negative);
}

typedef struct {
    NovaAudioTransport *transport;
    atomic_bool done;
} Threads;

static void *render_thread(void *context)
{
    Threads *threads = context;
    float output[127 * 2];
    while (!atomic_load_explicit(&threads->done, memory_order_acquire))
        CHECK(nova_audio_transport_render(threads->transport, output, 127) == NOVA_AUDIO_OK);
    return NULL;
}

static void concurrent_transfer(void)
{
    NovaAudioTransport *t = transport(48000);
    NovaAudioProgram *p = program(48000, 0.1f);
    Threads threads = {.transport = t};
    atomic_init(&threads.done, false);
    pthread_t thread;
    CHECK(!pthread_create(&thread, NULL, render_thread, &threads));
    uint64_t last_ticket = 0, received = 0, publication = 0, current_program = 0;
    for (unsigned i = 0; i < 3000;) {
        uint64_t ticket;
        NovaAudioControlResult result;
        if (i % 3 || !current_program) result = nova_audio_transport_replace(t, p, 16, &ticket);
        else result = nova_audio_transport_command(t, NOVA_AUDIO_CANCEL, current_program, 16, &ticket);
        CHECK(result == NOVA_AUDIO_CONTROL_OK || result == NOVA_AUDIO_CONTROL_QUEUE_FULL ||
            result == NOVA_AUDIO_CONTROL_RENDERERS_FULL);
        if (result == NOVA_AUDIO_CONTROL_OK) { last_ticket = ticket; ++i; }
        NovaAudioReceipt r;
        while (nova_audio_transport_receipt(t, &r)) {
            CHECK(r.ticket == ++received);
            CHECK(r.result == NOVA_AUDIO_CONTROL_OK || r.result == NOVA_AUDIO_CONTROL_BUSY || r.result == NOVA_AUDIO_CONTROL_STALE);
            if (r.type == NOVA_AUDIO_REPLACE && r.result == NOVA_AUDIO_CONTROL_OK) current_program = r.program;
        }
        NovaAudioTransportSnapshot status;
        if (nova_audio_transport_snapshot(t, &status)) {
            CHECK(status.publication > publication && status.sample_rate == 48000 && status.fault == NOVA_AUDIO_OK);
            CHECK(status.peak[0] <= 0.201f && status.peak[1] == 0);
            CHECK(status.program <= last_ticket && status.last_command <= last_ticket);
            publication = status.publication;
        }
        nova_audio_transport_collect(t);
        sched_yield();
    }
    while (received < last_ticket) {
        NovaAudioReceipt r;
        while (nova_audio_transport_receipt(t, &r)) CHECK(r.ticket == ++received);
        sched_yield();
    }
    atomic_store_explicit(&threads.done, true, memory_order_release);
    CHECK(!pthread_join(thread, NULL));
    CHECK(publication && received == 3000);
    nova_audio_program_release(p); nova_audio_transport_destroy(t);
}

int main(void)
{
    independent_lifetimes();
    replacement_and_backpressure();
    transition_block_independence();
    concurrent_transfer();
    puts("Nova bounded audio transport queues, crossfades, cancellation, stale controls and concurrent ownership passed.");
    return 0;
}
