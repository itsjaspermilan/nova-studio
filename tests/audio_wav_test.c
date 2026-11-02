#include "audio.h"
#include "assets.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #c); exit(1); } } while (0)

typedef struct {
    unsigned char *data;
    size_t size, capacity, calls, fail_call;
} Sink;

static char error[1024];

static bool memory_write(void *context, const void *bytes, size_t size)
{
    Sink *sink = context;
    ++sink->calls;
    if (sink->calls == sink->fail_call) return false;
    CHECK(size <= sink->capacity - sink->size);
    memcpy(sink->data + sink->size, bytes, size);
    sink->size += size;
    return true;
}

static bool count_write(void *context, const void *bytes, size_t size)
{
    (void)bytes;
    uint64_t *total = context;
    *total += size;
    return true;
}

static NovaAudioProgram *constant_program(uint32_t rate, uint64_t length, float left, float right)
{
    float data[] = {left, right, left, right, left, right, left, right};
    NovaAudioSample *sample = NULL;
    CHECK(nova_audio_sample_create(data, (NovaAudioSampleInfo){rate, 2, 4}, &sample, error, sizeof(error)));
    NovaAudioPatch patch = {.source = NOVA_AUDIO_SAMPLER, .envelope = {1, 0, 1, 1},
        .sample_end = 4, .sample_loop = true, .sample_root_hz = 440, .sample_max_ratio = 1};
    NovaAudioBus master = {NOVA_AUDIO_NO_BUS, 1, 0};
    NovaAudioEvent events[] = {
        {.type = NOVA_AUDIO_NOTE_ON, .target = 1, .note = {.frequency = 440, .gain = 1}},
        {.frame = length - 1, .type = NOVA_AUDIO_NOTE_OFF, .target = 1}
    };
    NovaAudioProgramDesc desc = {.sample_rate = rate, .voice_limit = 1, .length_frames = length,
        .samples = &sample, .sample_count = 1, .patches = &patch, .patch_count = 1,
        .buses = &master, .bus_count = 1, .events = events, .event_count = 2};
    NovaAudioProgram *program = NULL;
    CHECK(nova_audio_program_create(&desc, &program, error, sizeof(error)));
    nova_audio_sample_release(sample);
    return program;
}

static uint32_t u32(const unsigned char *bytes)
{
    return bytes[0] | ((uint32_t)bytes[1] << 8) | ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

static void put32(unsigned char *bytes, uint32_t value)
{
    for (unsigned i = 0; i < 4; ++i) bytes[i] = (unsigned char)(value >> (i * 8));
}

static void native_roundtrip(uint32_t rate, NovaAudioWavFormat format)
{
    const uint64_t frames = 2000;
    float left = format == NOVA_AUDIO_WAV_PCM16 ? 0.25f : 0.25f + 1.0f / 8388608;
    float right = -left * 2;
    if (format == NOVA_AUDIO_WAV_FLOAT32) { left = 1.25f; right = -2.5f; }
    NovaAudioProgram *program = constant_program(rate, frames, left, right);
    unsigned char bytes[2000 * 8 + 56];
    Sink sink = {.data = bytes, .capacity = sizeof(bytes)};
    NovaAudioExportResult result;
    CHECK(nova_audio_write_wav(program, (NovaAudioExport){.frames = frames, .format = format},
        memory_write, &sink, &result, error, sizeof(error)));
    CHECK(result.complete && result.frames_written == frames && result.bytes_written == sink.size);
    unsigned bits = format == NOVA_AUDIO_WAV_PCM16 ? 16 : format == NOVA_AUDIO_WAV_PCM24 ? 24 : 32;
    unsigned header = format == NOVA_AUDIO_WAV_FLOAT32 ? 56 : 44;
    CHECK(sink.size == header + frames * 2 * bits / 8);
    CHECK(u32(bytes + 4) + 8 == sink.size && u32(bytes + 24) == rate);
    CHECK(u32(bytes + 28) == rate * 2 * bits / 8);
    if (header == 56) CHECK(!memcmp(bytes + 36, "fact", 4) && u32(bytes + 44) == frames);
    NovaAudioWavInfo info;
    CHECK(nova_audio_wav_inspect(bytes, sink.size, &info, error, sizeof(error)));
    CHECK(info.sample.sample_rate == rate && info.sample.frames == frames &&
        info.sample.channels == 2 && info.bits == bits && info.data_offset == header);
    NovaAudioSample *sample = NULL;
    CHECK(nova_audio_sample_from_wav(bytes, sink.size, &sample, error, sizeof(error)));
    const float *decoded = nova_audio_sample_data(sample);
    CHECK(decoded[0] == 0 && decoded[1] == 0);
    CHECK(decoded[2] == left && decoded[3] == right);
    CHECK(nova_audio_sample_info(sample).sample_rate == rate);
    nova_audio_sample_release(sample);
    Wave wave = {0};
    CHECK(!IsAudioDeviceReady());
    CHECK(nova_decode_wav(bytes, (int)sink.size, &wave, error, sizeof(error)));
    CHECK(wave.frameCount == frames && wave.channels == 2 && wave.sampleRate == rate);
    CHECK(wave.sampleSize == (format == NOVA_AUDIO_WAV_PCM16 ? 16u : 32u));
    if (wave.sampleSize == 32) {
        CHECK(((float *)wave.data)[2] == left && ((float *)wave.data)[3] == right);
        if (format == NOVA_AUDIO_WAV_PCM24) CHECK(bytes[44 + 6] == 1);
        else CHECK(result.over_frames && result.peak[1] == 2.5f);
    } else CHECK(((short *)wave.data)[2] == 8192 && ((short *)wave.data)[3] == -16384);
    UnloadWave(wave);
    CHECK(!IsAudioDeviceReady());
    nova_audio_program_release(program);
}

static void dither_and_failure(void)
{
    const uint64_t frames = 16384;
    NovaAudioProgram *program = constant_program(48000, frames, 0, 0);
    unsigned char *first = malloc(frames * 8 + 56), *second = malloc(frames * 8 + 56);
    CHECK(first && second);
    Sink a = {.data = first, .capacity = frames * 8 + 56};
    Sink b = {.data = second, .capacity = frames * 8 + 56};
    NovaAudioExport options = {.frames = frames, .format = NOVA_AUDIO_WAV_PCM24, .dither = true, .seed = 5231};
    NovaAudioExportResult result;
    CHECK(nova_audio_write_wav(program, options, memory_write, &a, &result, error, sizeof(error)));
    CHECK(nova_audio_write_wav(program, options, memory_write, &b, &result, error, sizeof(error)));
    CHECK(a.size == b.size && !memcmp(first, second, a.size));
    options.seed = 9832; b.size = 0;
    CHECK(nova_audio_write_wav(program, options, memory_write, &b, &result, error, sizeof(error)));
    CHECK(memcmp(first, second, a.size));
    NovaAudioSample *decoded = NULL;
    CHECK(nova_audio_sample_from_wav(first, a.size, &decoded, error, sizeof(error)));
    const float *data = nova_audio_sample_data(decoded);
    double mean = 0, energy = 0;
    for (size_t i = 0; i < frames * 2; ++i) {
        double value = data[i] * 8388608.0;
        CHECK(value == -1 || value == 0 || value == 1);
        mean += value; energy += value * value;
    }
    CHECK(fabs(mean / (frames * 2)) < 0.03);
    CHECK(energy / (frames * 2) > 0.22 && energy / (frames * 2) < 0.28);
    nova_audio_sample_release(decoded);
    options.seed = 0; b.size = 0;
    CHECK(!nova_audio_write_wav(program, options, memory_write, &b, &result, error, sizeof(error)));
    CHECK(!b.size && !result.complete && strstr(error, "seed"));
    options.seed = 1; options.format = NOVA_AUDIO_WAV_FLOAT32;
    CHECK(!nova_audio_write_wav(program, options, memory_write, &b, &result, error, sizeof(error)) && !b.size);
    options.dither = false;
    for (size_t failure = 1; failure <= 3; ++failure) {
        b = (Sink){.data = second, .capacity = frames * 8 + 56, .fail_call = failure};
        CHECK(!nova_audio_write_wav(program, options, memory_write, &b, &result, error, sizeof(error)));
        CHECK(!result.complete && result.bytes_written == b.size && strstr(error, "writer failed"));
        CHECK(result.frames_written == (failure > 2 ? 512u : 0u));
    }
    nova_audio_program_release(program);
    program = constant_program(48000, 2000, 1.25f, -2.5f);
    options = (NovaAudioExport){.frames = 2000, .format = NOVA_AUDIO_WAV_PCM24};
    b = (Sink){.data = second, .capacity = frames * 8 + 56};
    CHECK(!nova_audio_write_wav(program, options, memory_write, &b, &result, error, sizeof(error)));
    CHECK(strstr(error, "clip") && result.frames_written == 0 && !result.complete && b.size == 44);
    CHECK(result.peak[1] == 2.5f);
    nova_audio_program_release(program);
    free(first); free(second);
}

static void malformed_inputs(void)
{
    NovaAudioProgram *program = constant_program(48000, 64, 0.5f, -0.5f);
    unsigned char bytes[56 + 64 * 8], changed[sizeof(bytes)];
    Sink sink = {.data = bytes, .capacity = sizeof(bytes)};
    NovaAudioExportResult result;
    CHECK(nova_audio_write_wav(program, (NovaAudioExport){.frames = 64, .format = NOVA_AUDIO_WAV_FLOAT32},
        memory_write, &sink, &result, error, sizeof(error)));
    NovaAudioWavInfo info, preserved;
    CHECK(nova_audio_wav_inspect(bytes, sizeof(bytes), &info, error, sizeof(error)));
    preserved = info;
    const size_t positions[] = {0, 4, 8, 12, 16, 20, 22, 24, 28, 32, 34, 36, 40, 44, 48, 52};
    for (size_t i = 0; i < sizeof(positions) / sizeof(*positions); ++i) {
        memcpy(changed, bytes, sizeof(bytes)); changed[positions[i]] ^= 4;
        CHECK(!nova_audio_wav_inspect(changed, sizeof(changed), &info, error, sizeof(error)));
        CHECK(!memcmp(&info, &preserved, sizeof(info)) && *error);
        Wave wave = {0};
        CHECK(!nova_decode_wav(changed, sizeof(changed), &wave, error, sizeof(error)) && !wave.data);
    }
    const uint32_t invalid_floats[] = {0x7fc00000, 0x7f800000, 0xff800000, 0x41880000};
    for (size_t i = 0; i < sizeof(invalid_floats) / sizeof(*invalid_floats); ++i) {
        memcpy(changed, bytes, sizeof(bytes)); put32(changed + 56, invalid_floats[i]);
        CHECK(!nova_audio_wav_inspect(changed, sizeof(changed), &info, error, sizeof(error)));
        CHECK(strstr(error, "finite"));
        Wave wave = {0};
        CHECK(!nova_decode_wav(changed, sizeof(changed), &wave, error, sizeof(error)) && !wave.data);
    }
    CHECK(!nova_audio_wav_inspect(bytes, 43, &info, error, sizeof(error)));
    CHECK(!nova_audio_wav_inspect(bytes, 55, &info, error, sizeof(error)));
    CHECK(!nova_audio_wav_inspect(bytes, sizeof(bytes) - 1, &info, error, sizeof(error)));
    CHECK(!nova_audio_wav_inspect(bytes, NOVA_AUDIO_WAV_INPUT_LIMIT + 1, &info, error, sizeof(error)));
    float sentinel = 12;
    CHECK(!nova_audio_wav_read(bytes, sizeof(bytes), &sentinel, 1, error, sizeof(error)) && sentinel == 12);
    CHECK(!nova_audio_wav_inspect(NULL, sizeof(bytes), &info, error, sizeof(error)));
    CHECK(!nova_decode_wav(bytes, -1, &(Wave){0}, error, sizeof(error)));
    nova_audio_program_release(program);

    unsigned char pcm24[48] = {0};
    memcpy(pcm24, "RIFF", 4); put32(pcm24 + 4, 40); memcpy(pcm24 + 8, "WAVEfmt ", 8);
    put32(pcm24 + 16, 16); pcm24[20] = 1; pcm24[22] = 1;
    put32(pcm24 + 24, 44100); put32(pcm24 + 28, 44100 * 3);
    pcm24[32] = 3; pcm24[34] = 24; memcpy(pcm24 + 36, "data", 4); put32(pcm24 + 40, 3);
    pcm24[46] = 128;
    CHECK(nova_audio_wav_inspect(pcm24, sizeof(pcm24), &info, error, sizeof(error)));
    CHECK(nova_audio_wav_read(pcm24, sizeof(pcm24), &sentinel, 1, error, sizeof(error)) && sentinel == -1);
    pcm24[47] = 1;
    CHECK(!nova_audio_wav_inspect(pcm24, sizeof(pcm24), &info, error, sizeof(error)));
    CHECK(!IsAudioDeviceReady());
}

static void full_length_render(void)
{
    NovaAudioBus master = {NOVA_AUDIO_NO_BUS, 1, 0};
    NovaAudioProgramDesc desc = {.sample_rate = 44100, .voice_limit = 1,
        .length_frames = 44100 * 61, .buses = &master, .bus_count = 1};
    NovaAudioProgram *program = NULL;
    CHECK(nova_audio_program_create(&desc, &program, error, sizeof(error)));
    uint64_t bytes = 0;
    NovaAudioExportResult result;
    CHECK(nova_audio_write_wav(program, (NovaAudioExport){.frames = desc.length_frames, .format = NOVA_AUDIO_WAV_FLOAT32},
        count_write, &bytes, &result, error, sizeof(error)));
    CHECK(result.complete && result.frames_written == 44100 * 61 && bytes == 56 + UINT64_C(44100) * 61 * 8);
    CHECK(result.peak[0] == 0 && result.peak[1] == 0);
    nova_audio_program_release(program);
}

static void write_file(const char *path, const void *bytes, size_t length)
{
    FILE *file = fopen(path, "wb");
    CHECK(file && fwrite(bytes, 1, length, file) == length && !fclose(file));
}

static void native_project(bool device)
{
    char directory[] = NOVA_TEST_DIRECTORY "/audio-master.XXXXXX";
    CHECK(mkdtemp(directory));
    char manifest[4096], script[4096], asset[4096];
    snprintf(manifest, sizeof(manifest), "%s/nova.project", directory);
    snprintf(script, sizeof(script), "%s/main.lua", directory);
    snprintf(asset, sizeof(asset), "%s/master.wav", directory);
    const char *declarations = "nova-project 2\nidentity AudioMasterTest\nentry main.lua\n"
        "audio master master.wav\naudio alias master.wav\n";
    const char *scene = "nova.play(nova.asset('master'),0,true); function update() end";
    write_file(manifest, declarations, strlen(declarations));
    write_file(script, scene, strlen(scene));
    NovaEngine *engine = NULL;
    NovaResources resources = {0};
    for (unsigned format = NOVA_AUDIO_WAV_PCM24; format <= NOVA_AUDIO_WAV_FLOAT32; ++format) {
        NovaAudioProgram *program = constant_program(44100, 2000, 0.25f + 1.0f / 8388608, -0.5f);
        unsigned char bytes[2000 * 8 + 56];
        Sink sink = {.data = bytes, .capacity = sizeof(bytes)};
        NovaAudioExportResult result;
        CHECK(nova_audio_write_wav(program, (NovaAudioExport){.frames = 2000, .format = (NovaAudioWavFormat)format},
            memory_write, &sink, &result, error, sizeof(error)));
        nova_audio_program_release(program);
        write_file(asset, bytes, sink.size);
        NovaProjectValidation validation;
        CHECK(nova_validate_project(manifest, &validation, error, sizeof(error)));
        CHECK(validation.assets[0].sample_frames == 2000 && validation.assets[0].sample_rate == 44100);
        CHECK(validation.assets[0].channels == 2 && validation.assets[1].resource_index == 0);
        if (device) {
            CHECK(nova_open_scene(&engine, &resources, manifest, true, error, sizeof(error)));
            CHECK(IsAudioDeviceReady() && IsSoundValid(resources.resources[0].sound));
            CHECK(IsSoundPlaying(resources.resources[0].sound) && !resources.resources[1].owned);
            nova_pause_services(&resources, true);
            CHECK(!IsSoundPlaying(resources.resources[0].sound));
            nova_pause_services(&resources, false);
            CHECK(IsSoundPlaying(resources.resources[0].sound));
        } else CHECK(!IsAudioDeviceReady());
        NovaProjectValidation retained = validation;
        if (format == NOVA_AUDIO_WAV_FLOAT32) put32(bytes + 56, 0x7fc00000);
        else bytes[32] = 1;
        write_file(asset, bytes, sink.size);
        CHECK(!nova_validate_project(manifest, &validation, error, sizeof(error)));
        CHECK(!memcmp(&validation, &retained, sizeof(validation)));
        if (device) {
            NovaEngine *old = engine;
            void *buffer = resources.resources[0].sound.stream.buffer;
            CHECK(!nova_open_scene(&engine, &resources, manifest, true, error, sizeof(error)));
            CHECK(engine == old && resources.resources[0].sound.stream.buffer == buffer);
        }
    }
    nova_destroy(engine); nova_unload_resources(&resources);
    if (device) nova_shutdown_audio();
    CHECK(!IsAudioDeviceReady());
    CHECK(!unlink(asset) && !unlink(script) && !unlink(manifest) && !rmdir(directory));
}

int main(int argc, char **argv)
{
    bool device = argc == 2 && !strcmp(argv[1], "--audio");
    CHECK(argc == 1 || device);
    for (unsigned rate = 44100; rate <= 48000; rate += 3900)
        for (NovaAudioWavFormat format = NOVA_AUDIO_WAV_PCM16; format <= NOVA_AUDIO_WAV_FLOAT32; ++format)
            native_roundtrip(rate, format);
    dither_and_failure();
    malformed_inputs();
    full_length_render();
    native_project(device);
    puts("Nova lossless WAV, float headroom, native decoder/project round trips and render failures passed.");
    return 0;
}
