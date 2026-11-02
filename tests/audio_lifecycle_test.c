#include "raylib_audio.h"

#include <stdbool.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #c); exit(1); } } while (0)
#define MA_SUCCESS 0
#define AUDIO_DEVICE_FORMAT ma_format_f32
#define AUDIO_DEVICE_CHANNELS 2
#define AUDIO_DEVICE_SAMPLE_RATE 0
#define TRACELOG(level, ...) test_log(level, __VA_ARGS__)
#define LOG_INFO 0
#define LOG_WARNING 1

typedef unsigned ma_uint32;
typedef int ma_result;
typedef int ma_mutex;
typedef enum { ma_format_unknown, ma_format_u8, ma_format_s16, ma_format_s24, ma_format_s32, ma_format_f32 } ma_format;
typedef struct { int backend; } ma_context;
typedef struct { int unused; } ma_context_config;
typedef struct { bool allowDynamicSampleRate; } ma_data_converter_config;
typedef struct { bool ready; } ma_data_converter;
typedef struct ma_device ma_device;
typedef enum {
    ma_device_notification_type_started, ma_device_notification_type_stopped,
    ma_device_notification_type_rerouted, ma_device_notification_type_interruption_began,
    ma_device_notification_type_interruption_ended, ma_device_notification_type_unlocked
} ma_device_notification_type;
typedef struct { ma_device *pDevice; ma_device_notification_type type; } ma_device_notification;
typedef void (*Notification)(const ma_device_notification *);
typedef void (*DataCallback)(ma_device *, void *, const void *, ma_uint32);
typedef struct {
    struct { void *pDeviceID; ma_format format; unsigned channels; } playback, capture;
    unsigned sampleRate;
    DataCallback dataCallback;
    Notification notificationCallback;
    void *pUserData;
} ma_device_config;
struct ma_device {
    unsigned sampleRate;
    bool noClip, started;
    struct {
        ma_format format, internalFormat;
        unsigned channels, internalChannels, internalSampleRate, internalPeriodSizeInFrames, internalPeriods;
    } playback;
    DataCallback callback;
    Notification notification;
};
enum { ma_device_type_playback, FAIL_NONE, FAIL_CONTEXT, FAIL_DEVICE, FAIL_MUTEX, FAIL_START, FAIL_CONVERTER };
typedef struct AudioBuffer {
    ma_data_converter converter;
    void *data, *callback, *processor;
    float volume, pitch, pan;
    bool playing, paused, looping, isSubBufferProcessed[2];
    int usage;
    unsigned frameCursorPos, sizeInFrames;
} AudioBuffer;
static struct {
    struct {
        ma_context context;
        ma_device device;
        ma_mutex lock;
        bool isReady;
        size_t pcmBufferSize;
        void *pcmBuffer;
    } System;
} AUDIO;
static int fail_stage;
static bool context_live, device_live, mutex_live, callback_possible;
static unsigned starts, device_closes, mutex_closes, context_closes, tracked;
static size_t live_allocations, allocation, fail_allocation;
static unsigned warnings;
static char last_warning[256];

static void test_log(int level, const char *format, ...)
{
    if (level != LOG_WARNING) return;
    ++warnings;
    va_list arguments;
    va_start(arguments, format);
    vsnprintf(last_warning, sizeof(last_warning), format, arguments);
    va_end(arguments);
}

static void *test_calloc(size_t count, size_t size)
{
    if (++allocation == fail_allocation) return NULL;
    void *p = calloc(count, size);
    CHECK(p);
    ++live_allocations;
    return p;
}

static void test_free(void *p)
{
    if (!p) return;
    CHECK(live_allocations);
    --live_allocations; free(p);
}
#define RL_CALLOC test_calloc
#define RL_FREE test_free

static void OnLog(void *context, unsigned level, const char *message) { (void)context; (void)level; (void)message; }
static ma_context_config ma_context_config_init(void) { return (ma_context_config){0}; }
static void ma_log_callback_init(void (*log)(void *, unsigned, const char *), void *context) { (void)log; (void)context; }
static int ma_context_init(void *backends, unsigned count, ma_context_config *config, ma_context *context)
{
    (void)backends; (void)count; (void)config;
    if (fail_stage == FAIL_CONTEXT) return -1;
    CHECK(!context_live); context_live = true; context->backend = 1; return MA_SUCCESS;
}
static void ma_context_uninit(ma_context *context)
{
    (void)context;
    CHECK(context_live && !device_live && !mutex_live);
    context_live = false; ++context_closes;
}
static ma_device_config ma_device_config_init(int type) { CHECK(type == ma_device_type_playback); return (ma_device_config){0}; }
static int ma_device_init(ma_context *context, ma_device_config *config, ma_device *device)
{
    (void)context;
    CHECK(context_live && config->notificationCallback);
    if (fail_stage == FAIL_DEVICE) return -1;
    CHECK(!device_live);
    *device = (ma_device){.sampleRate = 48000, .callback = config->dataCallback, .notification = config->notificationCallback,
        .playback = {.format = ma_format_f32, .internalFormat = ma_format_s16,
            .channels = 2, .internalChannels = 2, .internalSampleRate = 44100,
            .internalPeriodSizeInFrames = 256, .internalPeriods = 3}};
    device_live = true; return MA_SUCCESS;
}
static int ma_mutex_init(ma_mutex *lock)
{
    (void)lock;
    if (fail_stage == FAIL_MUTEX) return -1;
    CHECK(!mutex_live); mutex_live = true; return MA_SUCCESS;
}
static void ma_mutex_uninit(ma_mutex *lock)
{
    (void)lock;
    CHECK(mutex_live && !device_live && !callback_possible);
    mutex_live = false; ++mutex_closes;
}
static void OnSendAudioDataToDevice(ma_device *device, void *out, const void *input, ma_uint32 frames)
{
    (void)device; (void)out; (void)input;
    CHECK(mutex_live && frames == 73);
}
static int ma_device_start(ma_device *device)
{
    CHECK(device_live && mutex_live);
    ++starts; callback_possible = true;
    device->callback(device, NULL, NULL, 73);
    if (fail_stage == FAIL_START) return -1;
    device->started = true;
    device->notification(&(ma_device_notification){device, ma_device_notification_type_started});
    return MA_SUCCESS;
}
static void ma_device_uninit(ma_device *device)
{
    CHECK(device_live);
    if (callback_possible) device->callback(device, NULL, NULL, 73);
    callback_possible = false; device_live = false; device->started = false; ++device_closes;
    device->notification(&(ma_device_notification){device, ma_device_notification_type_stopped});
}
static bool ma_device_is_started(const ma_device *device) { return device->started; }
static const char *ma_get_backend_name(int backend) { CHECK(backend == 1); return "fake backend"; }
static const char *ma_get_format_name(ma_format format) { return format == ma_format_f32 ? "F32" : "S16"; }
static unsigned ma_get_bytes_per_sample(ma_format format) { CHECK(format == ma_format_f32); return 4; }
static ma_data_converter_config ma_data_converter_config_init(ma_format in, ma_format out, unsigned in_channels,
    unsigned out_channels, unsigned in_rate, unsigned out_rate)
{
    CHECK(in == ma_format_f32 && out == ma_format_f32 && in_channels == 2 && out_channels == 2);
    CHECK(in_rate == 44100 && out_rate == 48000);
    return (ma_data_converter_config){0};
}
static int ma_data_converter_init(const ma_data_converter_config *config, void *allocator, ma_data_converter *converter)
{
    (void)allocator;
    CHECK(config->allowDynamicSampleRate);
    if (fail_stage == FAIL_CONVERTER) return -1;
    converter->ready = true; return MA_SUCCESS;
}
static void ma_data_converter_uninit(ma_data_converter *converter, void *allocator)
{
    (void)allocator; CHECK(converter->ready); converter->ready = false;
}
static void TrackAudioBuffer(AudioBuffer *buffer) { CHECK(buffer && mutex_live); ++tracked; }
static void UntrackAudioBuffer(AudioBuffer *buffer) { CHECK(buffer && mutex_live && tracked); --tracked; }

#include "nova_raylib_audio.inc"
/* Generated from the fingerprint-checked pinned source, not a copied lifecycle. */
#include "nova_raylib_lifecycle.inc"

int main(void)
{
    for (int failure = FAIL_CONTEXT; failure <= FAIL_START; ++failure) {
        fail_stage = failure; warnings = 0;
        InitAudioDevice();
        CHECK(!AUDIO.System.isReady && !context_live && !device_live && !mutex_live && !callback_possible);
        CHECK(warnings == 1 && strstr(last_warning, "AUDIO: Failed"));
        CloseAudioDevice();
    }
    CHECK(context_closes == 3 && device_closes == 2 && mutex_closes == 1);
    fail_stage = FAIL_NONE;
    InitAudioDevice();
    CHECK(AUDIO.System.isReady && context_live && device_live && mutex_live && callback_possible);
    unsigned initial_starts = starts;
    InitAudioDevice();
    CHECK(starts == initial_starts);
    NovaAudioDeviceInfo info = nova_raylib_audio_info();
    CHECK(info.initialized && info.started && info.configuration_current);
    CHECK(info.mixer_rate == 48000 && info.backend_rate == 44100 && info.configured_period_frames == 256);
    CHECK(info.configured_period_count == 3 && !info.callback_observed);
    CHECK(!info.underruns_known && !info.hardware_latency_known && info.inherited_mixer_mutex && info.inherited_output_clipping);
    nova_raylib_audio_observe(73);
    nova_raylib_audio_observe(511);
    info = nova_raylib_audio_info();
    CHECK(info.callback_observed && info.callback_count == 2 && info.callback_frames == 511);
    atomic_store_explicit(&nova_audio_callbacks, UINT32_MAX, memory_order_relaxed);
    nova_raylib_audio_observe(321);
    info = nova_raylib_audio_info();
    CHECK(info.callback_observed && info.callback_count == 0 && info.callback_frames == 321);
    nova_raylib_audio_notification(&(ma_device_notification){&AUDIO.System.device, ma_device_notification_type_interruption_began});
    CHECK(nova_raylib_audio_info().interrupted);
    nova_raylib_audio_notification(&(ma_device_notification){&AUDIO.System.device, ma_device_notification_type_interruption_ended});
    CHECK(!nova_raylib_audio_info().interrupted);
    nova_raylib_audio_notification(&(ma_device_notification){&AUDIO.System.device, ma_device_notification_type_rerouted});
    info = nova_raylib_audio_info();
    CHECK(!info.configuration_current && (info.notifications & NOVA_DEVICE_REROUTED));
    CHECK(info.backend_rate == 44100);
    for (size_t i = 1; i <= 2; ++i) {
        allocation = 0; fail_allocation = i; warnings = 0;
        CHECK(!LoadAudioBuffer(ma_format_f32, 2, 44100, 512, 1));
        CHECK(!live_allocations && !tracked);
        CHECK(warnings == 1 && strstr(last_warning, i == 1 ? "memory for buffer" : "PCM buffer"));
    }
    allocation = 0; fail_allocation = 0; fail_stage = FAIL_CONVERTER; warnings = 0;
    CHECK(!LoadAudioBuffer(ma_format_f32, 2, 44100, 512, 1));
    CHECK(!live_allocations && !tracked && warnings == 1 && strstr(last_warning, "data conversion pipeline"));
    fail_stage = FAIL_NONE;
    AudioBuffer *buffer = LoadAudioBuffer(ma_format_f32, 2, 44100, 512, 1);
    CHECK(buffer && tracked == 1 && live_allocations == 2);
    UnloadAudioBuffer(buffer);
    CHECK(!live_allocations && !tracked);
    CloseAudioDevice();
    CHECK(!AUDIO.System.isReady && !mutex_live && !callback_possible && !context_live);
    CHECK(!nova_raylib_audio_info().initialized && !nova_raylib_audio_info().configuration_current);
    InitAudioDevice();
    CHECK(nova_raylib_audio_info().configuration_current && !nova_raylib_audio_info().callback_observed);
    CloseAudioDevice();
    puts("Nova actual patched lifecycle: init/device/mutex/start/stream failures, callback join order and telemetry passed.");
    return 0;
}
