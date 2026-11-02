#undef nova_audio_render
#include "audio_device.h"
#include <raylib.h>

#include <math.h>
#include <pthread.h>
#include <sched.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #c); exit(1); } } while (0)

struct rAudioBuffer {
    bool allocated, playing;
    float volume;
    AudioCallback callback;
    unsigned rate;
};

static pthread_mutex_t mixer = PTHREAD_MUTEX_INITIALIZER;
static struct rAudioBuffer buffers[NOVA_AUDIO_TRANSPORTS];
static NovaAudioDeviceInfo info;
static unsigned initializations, allocations, unloads;
static bool fail_device, fail_stream, fail_play, fail_render;
static atomic_bool in_render, hold_callback, leave_callback, stop_worker, stop_requested;
static atomic_uint callbacks;

NovaAudioResult nova_audio_test_render(NovaAudioRenderer *renderer, float *output, size_t frames)
{
    if (fail_render) {
        for (size_t i = 0; i < frames * 2; ++i) output[i] = NAN;
        return NOVA_AUDIO_NONFINITE;
    }
    return nova_audio_render(renderer, output, frames);
}

bool IsAudioDeviceReady(void) { return info.initialized; }

void InitAudioDevice(void)
{
    ++initializations;
    if (fail_device) return;
    info = (NovaAudioDeviceInfo){.initialized = true, .started = true, .configuration_known = true,
        .configuration_current = true, .inherited_mixer_mutex = true, .notifications_supported = true,
        .mixer_rate = 48000, .mixer_channels = 2, .mixer_format = NOVA_DEVICE_FORMAT_F32,
        .backend_rate = 96000, .backend_channels = 2, .backend_format = NOVA_DEVICE_FORMAT_F32,
        .configured_period_frames = 256, .configured_period_count = 2};
    snprintf(info.backend, sizeof(info.backend), "device-free test");
}

NovaAudioDeviceInfo nova_raylib_audio_info(void) { return info; }

AudioStream LoadAudioStream(unsigned rate, unsigned bits, unsigned channels)
{
    CHECK(info.initialized && bits == 32 && channels == 2);
    if (fail_stream) return (AudioStream){0};
    CHECK(!pthread_mutex_lock(&mixer));
    for (unsigned i = 0; i < NOVA_AUDIO_TRANSPORTS; ++i) {
        if (buffers[i].allocated) continue;
        buffers[i] = (struct rAudioBuffer){.allocated = true, .volume = 1, .rate = rate};
        ++allocations;
        CHECK(!pthread_mutex_unlock(&mixer));
        return (AudioStream){.buffer = &buffers[i], .sampleRate = rate, .sampleSize = bits, .channels = channels};
    }
    CHECK(false);
    return (AudioStream){0};
}

bool IsAudioStreamValid(AudioStream stream) { return stream.buffer != NULL; }

void SetAudioStreamVolume(AudioStream stream, float volume)
{
    CHECK(!pthread_mutex_lock(&mixer));
    stream.buffer->volume = volume;
    CHECK(!pthread_mutex_unlock(&mixer));
}

void SetAudioStreamCallback(AudioStream stream, AudioCallback callback)
{
    CHECK(!pthread_mutex_lock(&mixer));
    stream.buffer->callback = callback;
    CHECK(!pthread_mutex_unlock(&mixer));
}

void PlayAudioStream(AudioStream stream)
{
    CHECK(!pthread_mutex_lock(&mixer));
    stream.buffer->playing = !fail_play;
    CHECK(!pthread_mutex_unlock(&mixer));
}

bool IsAudioStreamPlaying(AudioStream stream)
{
    CHECK(!pthread_mutex_lock(&mixer));
    bool playing = stream.buffer->playing;
    CHECK(!pthread_mutex_unlock(&mixer));
    return playing;
}

void StopAudioStream(AudioStream stream)
{
    atomic_store_explicit(&stop_requested, true, memory_order_release);
    CHECK(!pthread_mutex_lock(&mixer));
    stream.buffer->playing = false;
    CHECK(!pthread_mutex_unlock(&mixer));
}

void UnloadAudioStream(AudioStream stream)
{
    CHECK(!pthread_mutex_lock(&mixer));
    CHECK(stream.buffer->allocated && !stream.buffer->playing && !stream.buffer->callback);
    *stream.buffer = (struct rAudioBuffer){0};
    ++unloads;
    CHECK(!pthread_mutex_unlock(&mixer));
}

static void pump(unsigned index, float *output, unsigned frames)
{
    CHECK(!pthread_mutex_lock(&mixer));
    struct rAudioBuffer *buffer = &buffers[index];
    if (buffer->allocated && buffer->playing && buffer->callback) {
        atomic_store_explicit(&in_render, true, memory_order_release);
        while (atomic_load_explicit(&hold_callback, memory_order_acquire) &&
            !atomic_load_explicit(&leave_callback, memory_order_acquire)) sched_yield();
        buffer->callback(output, frames);
        for (unsigned i = 0; i < frames * 2; ++i) output[i] *= buffer->volume * (11.0f / 16);
        atomic_fetch_add_explicit(&callbacks, 1, memory_order_relaxed);
        atomic_store_explicit(&in_render, false, memory_order_release);
    } else memset(output, 0, (size_t)frames * 2 * sizeof(float));
    CHECK(!pthread_mutex_unlock(&mixer));
}

static NovaAudioProgram *program(void)
{
    NovaAudioPatch patch = {.source = NOVA_AUDIO_SINE, .envelope = {48, 0, 480, 1}};
    NovaAudioBus master = {NOVA_AUDIO_NO_BUS, 1, 0};
    NovaAudioEvent events[] = {
        {.type = NOVA_AUDIO_NOTE_ON, .target = 1, .note = {.frequency = 440, .gain = 0.1f, .pan = -1}},
        {.frame = 48000, .type = NOVA_AUDIO_NOTE_OFF, .target = 1}
    };
    NovaAudioProgramDesc desc = {.sample_rate = 48000, .voice_limit = 1, .length_frames = 48480,
        .patches = &patch, .patch_count = 1, .buses = &master, .bus_count = 1, .events = events, .event_count = 2};
    NovaAudioProgram *p = NULL;
    char error[512];
    CHECK(nova_audio_program_create(&desc, &p, error, sizeof(error)));
    return p;
}

static void *worker(void *unused)
{
    (void)unused;
    float output[127 * 2];
    while (!atomic_load_explicit(&stop_worker, memory_order_acquire)) pump(0, output, 127);
    return NULL;
}

static void *release_inflight(void *unused)
{
    (void)unused;
    CHECK(atomic_load_explicit(&in_render, memory_order_acquire));
    while (!atomic_load_explicit(&stop_requested, memory_order_acquire)) sched_yield();
    CHECK(atomic_load_explicit(&in_render, memory_order_acquire));
    atomic_store_explicit(&leave_callback, true, memory_order_release);
    return NULL;
}

int main(void)
{
    atomic_init(&in_render, false); atomic_init(&hold_callback, false);
    atomic_init(&leave_callback, false); atomic_init(&stop_worker, false); atomic_init(&callbacks, 0);
    atomic_init(&stop_requested, false);
    char error[512];
    NovaAudioTransportHandle audition = 777, game = 777;
    CHECK(nova_audio_device_open(NOVA_AUDIO_AUDITION, 96000, &audition, error, sizeof(error)) == NOVA_AUDIO_CONTROL_INVALID);
    CHECK(initializations == 0 && audition == 777);
    fail_device = true;
    CHECK(nova_audio_device_open(NOVA_AUDIO_AUDITION, 48000, &audition, error, sizeof(error)) == NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE);
    CHECK(audition == 777 && !allocations && *error);
    fail_device = false; fail_stream = true;
    CHECK(nova_audio_device_open(NOVA_AUDIO_AUDITION, 48000, &audition, error, sizeof(error)) == NOVA_AUDIO_CONTROL_BACKEND_FAILED);
    CHECK(initializations == 2 && audition == 777 && *error);
    info.mixer_channels = 1;
    CHECK(nova_audio_device_open(NOVA_AUDIO_AUDITION, 48000, &audition, error, sizeof(error)) == NOVA_AUDIO_CONTROL_BACKEND_FAILED);
    CHECK(!allocations && strstr(error, "stereo float mixer"));
    info.mixer_channels = 2;
    fail_stream = false; fail_play = true;
    CHECK(nova_audio_device_open(NOVA_AUDIO_AUDITION, 48000, &audition, error, sizeof(error)) == NOVA_AUDIO_CONTROL_BACKEND_FAILED);
    CHECK(allocations == unloads && *error);
    fail_play = false;
    CHECK(nova_audio_device_open(NOVA_AUDIO_AUDITION, 48000, &audition, error, sizeof(error)) == NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_device_open(NOVA_AUDIO_GAME, 44100, &game, error, sizeof(error)) == NOVA_AUDIO_CONTROL_OK);
    CHECK(initializations == 2 && buffers[0].rate == 48000 && buffers[1].rate == 44100);
    NovaAudioTransportHandle unchanged = 999;
    CHECK(nova_audio_device_open(NOVA_AUDIO_AUDITION, 48000, &unchanged, error, sizeof(error)) == NOVA_AUDIO_CONTROL_BUSY && unchanged == 999);
    NovaAudioProgram *p = program();
    uint64_t ticket;
    CHECK(nova_audio_device_replace(game, p, 16, &ticket) == NOVA_AUDIO_CONTROL_RATE_MISMATCH);
    CHECK(nova_audio_device_replace(audition, p, 16, &ticket) == NOVA_AUDIO_CONTROL_OK);
    NovaAudioRenderer *reference = NULL;
    CHECK(nova_audio_renderer_create(p, &reference, error, sizeof(error)));
    float output[10000 * 2], expected[10000 * 2];
    pump(0, output, 10000);
    for (unsigned position = 0; position < 10000;) {
        unsigned count = 10000 - position > NOVA_AUDIO_MAX_BLOCK ? NOVA_AUDIO_MAX_BLOCK : 10000 - position;
        CHECK(nova_audio_render(reference, expected + position * 2, count) == NOVA_AUDIO_OK);
        position += count;
    }
    for (unsigned i = 0; i < 10000 * 2; ++i) {
        float fade = i / 2 < 16 ? (i / 2) / 16.0f : 1;
        CHECK(fabsf(output[i] - expected[i] * fade) < 0.000001f);
    }
    nova_audio_renderer_destroy(reference); nova_audio_program_release(p);
    NovaAudioReceipt receipt;
    NovaAudioTransportSnapshot snapshot;
    bool has_receipt, has_snapshot;
    CHECK(nova_audio_device_poll(audition, &receipt, &has_receipt, &snapshot, &has_snapshot) == NOVA_AUDIO_CONTROL_OK);
    CHECK(has_receipt && receipt.ticket == ticket && receipt.result == NOVA_AUDIO_CONTROL_OK);
    CHECK(has_snapshot && snapshot.current.clock == 10000);
    NovaAudioDeviceInfo evidence = nova_audio_device_info();
    CHECK(evidence.mixer_rate == 48000 && evidence.backend_rate == 96000 && !evidence.callback_observed);
    CHECK(evidence.configured_period_frames == 256 && !evidence.hardware_latency_known && !evidence.underruns_known);
    info.started = false;
    CHECK(nova_audio_device_command(audition, NOVA_AUDIO_CANCEL, ticket, 16, &ticket) == NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE);
    CHECK(nova_audio_device_poll(audition, &receipt, &has_receipt, &snapshot, &has_snapshot) == NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE);
    info.started = true; info.configuration_current = false; info.notifications = NOVA_DEVICE_REROUTED;
    CHECK(!nova_audio_device_ensure(error, sizeof(error)) && *error && initializations == 2);
    info.configuration_current = true; info.interrupted = true;
    CHECK(!nova_audio_device_ensure(error, sizeof(error)) && *error);
    CHECK(nova_audio_device_close(game) == NOVA_AUDIO_CONTROL_OK);
    info.interrupted = false;
    CHECK(nova_audio_device_close(game) == NOVA_AUDIO_CONTROL_STALE);
    CHECK(nova_audio_device_open(NOVA_AUDIO_GAME, 48000, &unchanged, error, sizeof(error)) == NOVA_AUDIO_CONTROL_OK && unchanged != game);

    atomic_store_explicit(&hold_callback, true, memory_order_release);
    atomic_store_explicit(&stop_requested, false, memory_order_release);
    pthread_t render, release;
    CHECK(!pthread_create(&render, NULL, worker, NULL));
    while (!atomic_load_explicit(&in_render, memory_order_acquire)) sched_yield();
    p = program();
    for (unsigned i = 0; i < NOVA_AUDIO_COMMAND_CAPACITY; ++i)
        CHECK(nova_audio_device_replace(audition, p, 16, &ticket) == NOVA_AUDIO_CONTROL_OK);
    uint64_t full_ticket = ticket;
    CHECK(nova_audio_device_replace(audition, p, 16, &ticket) == NOVA_AUDIO_CONTROL_QUEUE_FULL && ticket == full_ticket);
    nova_audio_program_release(p);
    CHECK(!pthread_create(&release, NULL, release_inflight, NULL));
    nova_audio_device_close_transports();
    CHECK(!pthread_join(release, NULL));
    atomic_store_explicit(&stop_worker, true, memory_order_release);
    CHECK(!pthread_join(render, NULL));
    CHECK(!atomic_load_explicit(&in_render, memory_order_acquire));
    CHECK(allocations == unloads && info.initialized);
    CHECK(nova_audio_device_close(audition) == NOVA_AUDIO_CONTROL_STALE);
    CHECK(nova_audio_device_poll(unchanged, &receipt, &has_receipt, &snapshot, &has_snapshot) == NOVA_AUDIO_CONTROL_STALE);

    CHECK(nova_audio_device_open(NOVA_AUDIO_AUDITION, 48000, &audition, error, sizeof(error)) == NOVA_AUDIO_CONTROL_OK);
    p = program();
    CHECK(nova_audio_device_replace(audition, p, 16, &ticket) == NOVA_AUDIO_CONTROL_OK);
    fail_render = true;
    pump(0, output, 16);
    fail_render = false;
    for (unsigned i = 0; i < 32; ++i) CHECK(output[i] == 0);
    CHECK(nova_audio_device_poll(audition, &receipt, &has_receipt, &snapshot, &has_snapshot) == NOVA_AUDIO_CONTROL_RENDER_FAILED);
    CHECK(has_snapshot && snapshot.fault == NOVA_AUDIO_NONFINITE && has_receipt && receipt.result == NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_device_replace(audition, p, 16, &ticket) == NOVA_AUDIO_CONTROL_OK);
    nova_audio_program_release(p);
    pump(0, output, 16);
    CHECK(nova_audio_device_poll(audition, &receipt, &has_receipt, &snapshot, &has_snapshot) == NOVA_AUDIO_CONTROL_RENDER_FAILED);
    CHECK(has_receipt && receipt.ticket == ticket && receipt.result == NOVA_AUDIO_CONTROL_RENDER_FAILED);
    CHECK(nova_audio_device_poll(audition, &receipt, &has_receipt, &snapshot, &has_snapshot) == NOVA_AUDIO_CONTROL_RENDER_FAILED);
    CHECK(!has_receipt && !has_snapshot);
    CHECK(nova_audio_device_close(audition) == NOVA_AUDIO_CONTROL_OK && allocations == unloads);
    CHECK(!pthread_mutex_destroy(&mixer));
    puts("Nova device-free native adapter: shared ownership, failures, telemetry, concurrent detach and retirement passed.");
    return 0;
}
