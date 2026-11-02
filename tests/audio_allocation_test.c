#undef malloc
#undef calloc
#undef free
#undef snprintf

#include "audio.h"
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #c); exit(1); } } while (0)

static bool realtime;
static size_t attempts, fail_at, live;
static void *owned[128];

static void *allocation(size_t count, size_t size, bool zero)
{
    CHECK(!realtime);
    if (++attempts == fail_at) return NULL;
    void *p = zero ? calloc(count, size) : malloc(size);
    CHECK(p && live < sizeof(owned) / sizeof(*owned));
    owned[live++] = p;
    return p;
}

void *nova_audio_test_malloc(size_t size) { return allocation(1, size, false); }
void *nova_audio_test_calloc(size_t count, size_t size) { return allocation(count, size, true); }

void nova_audio_test_free(void *p)
{
    CHECK(!realtime);
    if (!p) return;
    size_t index = 0;
    while (index < live && owned[index] != p) ++index;
    CHECK(index < live);
    owned[index] = owned[--live];
    free(p);
}

int nova_audio_test_snprintf(char *output, size_t size, const char *format, ...)
{
    CHECK(!realtime);
    va_list arguments;
    va_start(arguments, format);
    int result = vsnprintf(output, size, format, arguments);
    va_end(arguments);
    return result;
}

static bool sink(void *context, const void *bytes, size_t size)
{
    (void)context; (void)bytes; (void)size;
    CHECK(!realtime);
    return true;
}

int main(void)
{
    char error[512];
    float source[] = {0, 0.25f, -0.5f, 0.25f};
    NovaAudioSample *sample = NULL;
    fail_at = 1;
    CHECK(!nova_audio_sample_create(source, (NovaAudioSampleInfo){48000, 1, 4}, &sample, error, sizeof(error)));
    CHECK(!sample && !live && *error);
    attempts = 0; fail_at = 0;
    CHECK(nova_audio_sample_create(source, (NovaAudioSampleInfo){48000, 1, 4}, &sample, error, sizeof(error)));
    CHECK(live == 1);
    NovaAudioPatch patches[] = {
        {.source = NOVA_AUDIO_SAW, .envelope = {10, 10, 10, 0.5f}},
        {.source = NOVA_AUDIO_SAMPLER, .envelope = {10, 10, 10, 0.5f},
            .sample_end = 4, .sample_loop = true, .sample_root_hz = 440, .sample_max_ratio = 2}
    };
    NovaAudioBus master = {NOVA_AUDIO_NO_BUS, 0.5f, 0};
    NovaAudioEvent events[] = {
        {.type = NOVA_AUDIO_NOTE_ON, .target = 1, .note = {.patch = 0, .frequency = 440, .gain = 1}},
        {.type = NOVA_AUDIO_NOTE_ON, .target = 2, .note = {.patch = 1, .frequency = 440, .gain = 1}},
        {.frame = 990, .type = NOVA_AUDIO_NOTE_OFF, .target = 1},
        {.frame = 990, .type = NOVA_AUDIO_NOTE_OFF, .target = 2}
    };
    NovaAudioProgramDesc desc = {.sample_rate = 48000, .voice_limit = 2, .length_frames = 1000, .loop = true,
        .samples = &sample, .sample_count = 1, .patches = patches, .patch_count = 2,
        .buses = &master, .bus_count = 1, .events = events, .event_count = 4};
    NovaAudioProgram *program = NULL;
    attempts = 0;
    CHECK(nova_audio_program_create(&desc, &program, error, sizeof(error)));
    size_t allocations = attempts;
    nova_audio_program_release(program);
    CHECK(live == 1 && allocations >= 4);
    for (size_t i = 1; i <= allocations; ++i) {
        attempts = 0; fail_at = i; program = NULL;
        CHECK(!nova_audio_program_create(&desc, &program, error, sizeof(error)));
        CHECK(!program && live == 1 && *error);
    }
    attempts = 0; fail_at = 0;
    CHECK(nova_audio_program_create(&desc, &program, error, sizeof(error)));
    size_t baseline = live;
    NovaAudioRenderer *r = NULL;
    attempts = 0; fail_at = 1;
    CHECK(!nova_audio_renderer_create(program, &r, error, sizeof(error)));
    CHECK(!r && live == baseline && *error);
    NovaAudioExportResult exported;
    attempts = 0; fail_at = 1;
    CHECK(!nova_audio_write_wav(program, (NovaAudioExport){.frames = 1000, .format = NOVA_AUDIO_WAV_FLOAT32},
        sink, NULL, &exported, error, sizeof(error)));
    CHECK(live == baseline && !exported.complete);
    attempts = 0; fail_at = 0;
    CHECK(nova_audio_renderer_create(program, &r, error, sizeof(error)));
    nova_audio_program_release(program); nova_audio_sample_release(sample);
    float output[NOVA_AUDIO_MAX_BLOCK * 2];
    realtime = true;
    for (unsigned i = 0; i < 8; ++i) CHECK(nova_audio_render(r, output, NOVA_AUDIO_MAX_BLOCK) == NOVA_AUDIO_OK);
    CHECK(nova_audio_status(r).clock == NOVA_AUDIO_MAX_BLOCK * 8);
    CHECK(nova_audio_cancel(r, 64) == NOVA_AUDIO_OK);
    CHECK(nova_audio_render(r, output, 1000) == NOVA_AUDIO_OK && nova_audio_status(r).finished);
    nova_audio_renderer_reset(r);
    CHECK(nova_audio_render(r, output, 1000) == NOVA_AUDIO_OK && !nova_audio_status(r).finished);
    realtime = false;
    nova_audio_renderer_destroy(r);
    CHECK(!live);

    unsigned char wav[] = {
        'R','I','F','F', 40,0,0,0, 'W','A','V','E', 'f','m','t',' ', 16,0,0,0,
        1,0, 1,0, 0x80,0xbb,0,0, 0x80,0xbb,0,0, 1,0, 8,0,
        'd','a','t','a', 4,0,0,0, 128,160,64,160
    };
    for (size_t i = 1; i <= 2; ++i) {
        attempts = 0; fail_at = i; sample = NULL;
        CHECK(!nova_audio_sample_from_wav(wav, sizeof(wav), &sample, error, sizeof(error)));
        CHECK(!sample && !live && *error);
    }
    attempts = 0; fail_at = 0;
    CHECK(nova_audio_sample_from_wav(wav, sizeof(wav), &sample, error, sizeof(error)));
    nova_audio_sample_release(sample);
    CHECK(!live);
    printf("Nova audio allocation failures: %zu score stages, balanced ownership, no render/control allocation or formatting.\n", allocations);
    return 0;
}
