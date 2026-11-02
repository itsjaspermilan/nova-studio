#include "audio.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PI 3.14159265358979323846
#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #c); exit(1); } } while (0)
#define NEAR(a, b, e) CHECK(fabs((double)(a) - (double)(b)) < (e))

static char error[512];
static const NovaAudioBus master = {.parent = NOVA_AUDIO_NO_BUS, .gain = 1};

static NovaAudioPatch patch(NovaAudioSource source)
{
    return (NovaAudioPatch){.source = source, .envelope = {1, 0, 4, 1},
        .sample_end = 4, .sample_loop = true, .sample_root_hz = 440, .sample_max_ratio = 1};
}

static NovaAudioEvent on(uint64_t frame, uint32_t id, uint32_t instrument)
{
    return (NovaAudioEvent){.frame = frame, .type = NOVA_AUDIO_NOTE_ON, .target = id,
        .note = {.patch = instrument, .frequency = 440, .gain = 1, .pan = -1, .seed = 1234567}};
}

static NovaAudioEvent off(uint64_t frame, uint32_t id)
{
    return (NovaAudioEvent){.frame = frame, .type = NOVA_AUDIO_NOTE_OFF, .target = id};
}

static NovaAudioProgramDesc description(uint32_t rate, uint64_t length,
    const NovaAudioPatch *patches, size_t patch_count, const NovaAudioEvent *events, size_t event_count)
{
    return (NovaAudioProgramDesc){.sample_rate = rate, .voice_limit = NOVA_AUDIO_MAX_VOICES,
        .length_frames = length, .patches = patches, .patch_count = patch_count,
        .buses = &master, .bus_count = 1, .events = events, .event_count = event_count};
}

static NovaAudioProgram *prepare(NovaAudioProgramDesc desc)
{
    NovaAudioProgram *program = NULL;
    if (!nova_audio_program_create(&desc, &program, error, sizeof(error))) {
        fprintf(stderr, "prepare: %s\n", error); exit(1);
    }
    return program;
}

static NovaAudioRenderer *renderer(NovaAudioProgram *program)
{
    NovaAudioRenderer *r = NULL;
    CHECK(nova_audio_renderer_create(program, &r, error, sizeof(error)));
    return r;
}

static void render(NovaAudioRenderer *r, float *data, size_t frames, size_t block)
{
    for (size_t position = 0; position < frames;) {
        size_t count = frames - position < block ? frames - position : block;
        CHECK(nova_audio_render(r, data + position * 2, count) == NOVA_AUDIO_OK);
        position += count;
    }
}

static NovaAudioSample *sample(const float *data, uint32_t frames, uint32_t channels, uint32_t rate)
{
    NovaAudioSample *s = NULL;
    CHECK(nova_audio_sample_create(data, (NovaAudioSampleInfo){rate, channels, frames},
        &s, error, sizeof(error)));
    return s;
}

static void exact_envelopes_and_loops(void)
{
    float data[] = {1, 1, 1, 1};
    NovaAudioSample *s = sample(data, 4, 1, 48000);
    data[0] = 0;
    CHECK(nova_audio_sample_data(s)[0] == 1);
    NovaAudioPatch p = patch(NOVA_AUDIO_SAMPLER);
    p.envelope = (NovaAudioEnvelope){4, 4, 4, 0.5f};
    NovaAudioEvent events[] = {on(5, 1, 0), off(16, 1)};
    NovaAudioProgramDesc desc = description(48000, 24, &p, 1, events, 2);
    desc.samples = &s; desc.sample_count = 1;
    NovaAudioProgram *program = prepare(desc);
    CHECK(nova_audio_program_rate(program) == 48000 && nova_audio_program_length(program) == 24);
    NovaAudioRenderer *a = renderer(program), *b = renderer(program);
    float one[64 * 2], many[64 * 2];
    render(a, one, 64, 1); render(b, many, 64, 13);
    CHECK(!memcmp(one, many, sizeof(one)));
    for (unsigned i = 0; i < 64; ++i) {
        double expected = 0;
        if (i >= 5 && i < 9) expected = (i - 5) / 4.0;
        else if (i >= 9 && i < 13) expected = 1 - (i - 9) / 8.0;
        else if (i >= 13 && i < 16) expected = 0.5;
        else if (i >= 16 && i < 20) expected = 0.5 * (1 - (i - 16) / 4.0);
        NEAR(one[i * 2], expected, 1e-6);
        CHECK(one[i * 2 + 1] == 0);
    }
    NovaAudioStatus status = nova_audio_status(a);
    CHECK(status.finished && !status.active_voices && status.clock == 64 && status.position == 24);
    NEAR(status.peak[0][0], 1, 1e-6);
    CHECK(!status.over_frames[0]);
    nova_audio_renderer_destroy(a); nova_audio_renderer_destroy(b);
    nova_audio_program_release(program);

    desc.loop = true;
    program = prepare(desc);
    a = renderer(program);
    float cycles[72 * 2];
    render(a, cycles, 72, 7);
    CHECK(!memcmp(cycles, cycles + 48, 48 * sizeof(float)));
    CHECK(!memcmp(cycles, cycles + 96, 48 * sizeof(float)));
    status = nova_audio_status(a);
    CHECK(status.clock == 72 && status.position == 0 && !status.finished && !status.active_voices);
    nova_audio_renderer_destroy(a); nova_audio_program_release(program);
    nova_audio_sample_release(s);
}

static void sampler_boundaries(uint32_t source_rate, uint32_t output_rate)
{
    uint32_t source_frames = source_rate / 100;
    float *source = malloc(source_frames * 2 * sizeof(float));
    CHECK(source);
    for (uint32_t i = 0; i < source_frames; ++i) {
        source[i * 2] = (float)(0.2 * sin(2 * PI * i * 3 / source_frames) + 0.1);
        source[i * 2 + 1] = (float)(0.3 * cos(2 * PI * i * 5 / source_frames) - 0.2);
    }
    NovaAudioSample *s = sample(source, source_frames, 2, source_rate);
    CHECK(!memcmp(nova_audio_sample_data(s), source, source_frames * 2 * sizeof(float)));
    CHECK(nova_audio_sample_info(s).sample_rate == source_rate);
    free(source);
    NovaAudioPatch p = patch(NOVA_AUDIO_SAMPLER);
    p.sample_end = source_frames;
    NovaAudioEvent events[] = {on(0, 1, 0), off(4000, 1)};
    events[0].note.pan = 0;
    NovaAudioProgramDesc desc = description(output_rate, 4004, &p, 1, events, 2);
    desc.samples = &s; desc.sample_count = 1;
    NovaAudioProgram *program = prepare(desc);
    NovaAudioRenderer *a = renderer(program), *b = renderer(program);
    float large[4004 * 2], singles[4004 * 2];
    render(a, large, 4004, 4096); render(b, singles, 4004, 1);
    CHECK(!memcmp(large, singles, sizeof(large)));
    uint32_t cycle = output_rate / 100;
    CHECK(!memcmp(large + cycle * 2, large + cycle * 4, cycle * 2 * sizeof(float)));
    CHECK(!memcmp(large + cycle * 2, large + cycle * 6, cycle * 2 * sizeof(float)));
    for (uint32_t i = cycle; i < cycle * 2; ++i) {
        NEAR(large[i * 2], 0.2 * sin(2 * PI * i * 3 / cycle) + 0.1, 0.0001);
        NEAR(large[i * 2 + 1], 0.3 * cos(2 * PI * i * 5 / cycle) - 0.2, 0.0001);
    }
    nova_audio_renderer_destroy(a); nova_audio_renderer_destroy(b);
    nova_audio_program_release(program); nova_audio_sample_release(s);
}

static void sampler_trim_and_end(void)
{
    const float source[] = {0.1f, 0.2f, 0.3f, 0.4f, 0.5f};
    NovaAudioSample *s = sample(source, 5, 1, 48000);
    NovaAudioPatch p = patch(NOVA_AUDIO_SAMPLER);
    p.sample_start = 1; p.sample_end = 4;
    NovaAudioEvent events[] = {on(0, 1, 0), off(20, 1)};
    NovaAudioProgramDesc desc = description(48000, 24, &p, 1, events, 2);
    desc.samples = &s; desc.sample_count = 1;
    NovaAudioProgram *program = prepare(desc);
    NovaAudioRenderer *r = renderer(program);
    float output[24 * 2];
    render(r, output, 24, 5);
    for (unsigned i = 1; i < 20; ++i) NEAR(output[i * 2], source[1 + i % 3], 1e-6);
    nova_audio_renderer_destroy(r); nova_audio_program_release(program); nova_audio_sample_release(s);

    float flat[100];
    for (size_t i = 0; i < 100; ++i) flat[i] = 1;
    s = sample(flat, 100, 1, 48000);
    p.sample_start = 0; p.sample_end = 100; p.sample_loop = false;
    p.envelope.release_frames = 10;
    events[1] = off(200, 1);
    desc.length_frames = 210;
    program = prepare(desc); r = renderer(program);
    float tail[210 * 2];
    render(r, tail, 210, 31);
    for (unsigned i = 1; i < 90; ++i) NEAR(tail[i * 2], 1, 1e-6);
    for (unsigned i = 90; i < 100; ++i) NEAR(tail[i * 2], (100 - i) / 10.0, 1e-6);
    for (unsigned i = 100; i < 210; ++i) CHECK(tail[i * 2] == 0 && tail[i * 2 + 1] == 0);
    CHECK(nova_audio_status(r).finished);
    nova_audio_renderer_destroy(r); nova_audio_program_release(program); nova_audio_sample_release(s);
}

static void ramps_and_cancellation(void)
{
    float flat[] = {1, 1, 1, 1};
    NovaAudioSample *s = sample(flat, 4, 1, 48000);
    NovaAudioPatch p = patch(NOVA_AUDIO_SAMPLER);
    p.envelope.release_frames = 8;
    NovaAudioEvent events[] = {
        on(0, 1, 0),
        {.frame = 4, .type = NOVA_AUDIO_VOICE_GAIN, .target = 1, .value = 0.5, .ramp_frames = 4},
        {.frame = 12, .type = NOVA_AUDIO_VOICE_PAN, .target = 1, .value = 1, .ramp_frames = 4},
        {.frame = 16, .type = NOVA_AUDIO_BUS_GAIN, .target = 0, .value = 0.25, .ramp_frames = 4},
        {.frame = 24, .type = NOVA_AUDIO_BUS_PAN, .target = 0, .value = -1, .ramp_frames = 4},
        off(32, 1)
    };
    NovaAudioProgramDesc desc = description(48000, 40, &p, 1, events, 6);
    desc.samples = &s; desc.sample_count = 1;
    NovaAudioProgram *program = prepare(desc);
    NovaAudioRenderer *a = renderer(program), *b = renderer(program);
    float output[40 * 2], alternate[40 * 2];
    render(a, output, 40, 40); render(b, alternate, 40, 3);
    CHECK(!memcmp(output, alternate, sizeof(output)));
    for (unsigned i = 4; i <= 8; ++i) NEAR(output[i * 2], 1 - (i - 4) * 0.125, 1e-6);
    for (unsigned i = 12; i <= 16; ++i) {
        NEAR(output[i * 2], 0.5 * cos((i - 12) * PI / 8), 1e-6);
        NEAR(output[i * 2 + 1], 0.5 * sin((i - 12) * PI / 8), 1e-6);
    }
    for (unsigned i = 16; i <= 20; ++i) NEAR(output[i * 2 + 1], 0.5 * (1 - (i - 16) * 0.1875), 1e-6);
    for (unsigned i = 24; i <= 28; ++i) NEAR(output[i * 2 + 1], 0.125 * cos((i - 24) * PI / 8), 1e-6);
    nova_audio_renderer_destroy(a); nova_audio_renderer_destroy(b); nova_audio_program_release(program);

    NovaAudioEvent sustained[] = {on(0, 1, 0), off(500, 1)};
    desc.events = sustained; desc.event_count = 2; desc.length_frames = 508; desc.loop = true;
    program = prepare(desc); a = renderer(program); b = renderer(program);
    float lead[16 * 2];
    render(a, lead, 16, 16); render(b, lead, 16, 16);
    CHECK(nova_audio_cancel(a, 16) == NOVA_AUDIO_OK);
    CHECK(nova_audio_cancel(a, 100) == NOVA_AUDIO_OK);
    render(a, output, 40, 7); render(b, alternate, 40, 13);
    for (unsigned i = 0; i < 40; ++i) {
        NEAR(output[i * 2], i < 16 ? 1 - i / 16.0 : 0, 1e-6);
        NEAR(alternate[i * 2], 1, 1e-6);
    }
    CHECK(nova_audio_status(a).cancelled && nova_audio_status(a).finished);
    CHECK(!nova_audio_status(b).cancelled && !nova_audio_status(b).finished);
    nova_audio_renderer_reset(a); nova_audio_renderer_reset(b);
    render(a, output, 40, 1); render(b, alternate, 40, 11);
    CHECK(!memcmp(output, alternate, sizeof(output)));
    NovaAudioStatus before = nova_audio_status(a);
    float sentinel[] = {12, 34};
    CHECK(nova_audio_render(a, sentinel, NOVA_AUDIO_MAX_BLOCK + 1) == NOVA_AUDIO_INVALID_ARGUMENT);
    CHECK(nova_audio_render(a, NULL, 1) == NOVA_AUDIO_INVALID_ARGUMENT);
    CHECK(nova_audio_render(a, NULL, 0) == NOVA_AUDIO_OK);
    CHECK(nova_audio_cancel(a, 0) == NOVA_AUDIO_INVALID_ARGUMENT);
    CHECK(nova_audio_status(a).clock == before.clock && sentinel[0] == 12 && sentinel[1] == 34);
    nova_audio_program_release(program); nova_audio_sample_release(s);
    render(b, alternate, 40, 40);
    nova_audio_renderer_destroy(a); nova_audio_renderer_destroy(b);
}

static void bus_routing_and_headroom(void)
{
    float mono[] = {1, 1, 1, 1}, stereo[] = {0.25f, -0.5f, 0.25f, -0.5f, 0.25f, -0.5f, 0.25f, -0.5f};
    NovaAudioSample *samples[] = {sample(mono, 4, 1, 48000), sample(stereo, 4, 2, 48000)};
    NovaAudioPatch patches[] = {patch(NOVA_AUDIO_SAMPLER), patch(NOVA_AUDIO_SAMPLER)};
    patches[1].sample = 1;
    NovaAudioBus buses[] = {{NOVA_AUDIO_NO_BUS, 0.5f, 0}, {0, 0.5f, 0}, {1, 2, 0}};
    NovaAudioEvent events[] = {on(0, 1, 0), on(0, 2, 1), off(16, 1), off(16, 2)};
    events[0].note.bus = 2; events[0].note.gain = 2;
    events[1].note.bus = 1; events[1].note.pan = 0;
    NovaAudioProgramDesc desc = description(48000, 20, patches, 2, events, 4);
    desc.samples = samples; desc.sample_count = 2; desc.buses = buses; desc.bus_count = 3;
    NovaAudioProgram *program = prepare(desc);
    NovaAudioRenderer *r = renderer(program);
    float output[20 * 2];
    render(r, output, 20, 17);
    NEAR(output[2], 1.0625, 1e-6);
    NEAR(output[3], -0.125, 1e-6);
    NovaAudioStatus status = nova_audio_status(r);
    NEAR(status.peak[2][0], 4, 1e-6); NEAR(status.peak[1][0], 2.125, 1e-6);
    NEAR(status.peak[0][0], 1.0625, 1e-6);
    uint64_t over = 0;
    for (unsigned i = 0; i < 20; ++i) if (fabsf(output[i * 2]) > 1 || fabsf(output[i * 2 + 1]) > 1) ++over;
    CHECK(over && status.over_frames[0] == over);
    CHECK(nova_audio_program_bus_count(program) == 3);
    nova_audio_renderer_destroy(r); nova_audio_program_release(program);
    nova_audio_sample_release(samples[0]); nova_audio_sample_release(samples[1]);
}

static double tone_amplitude(const float *data, size_t start, size_t frames, double frequency, double rate)
{
    double real = 0, imaginary = 0;
    for (size_t i = 0; i < frames; ++i) {
        double phase = 2 * PI * frequency * i / rate;
        real += data[(start + i) * 2] * cos(phase);
        imaginary += data[(start + i) * 2] * sin(phase);
    }
    return 2 * hypot(real, imaginary) / frames;
}

static double rms(const float *data, size_t start, size_t frames)
{
    double sum = 0;
    for (size_t i = 0; i < frames; ++i) sum += (double)data[(start + i) * 2] * data[(start + i) * 2];
    return sqrt(sum / frames);
}

static void oscillator_quality(uint32_t rate)
{
    const size_t count = 8192;
    for (NovaAudioSource source = NOVA_AUDIO_SINE; source <= NOVA_AUDIO_NOISE; ++source) {
        NovaAudioPatch p = patch(source);
        NovaAudioEvent events[] = {on(0, 1, 0), off(count, 1)};
        events[0].note.frequency = source == NOVA_AUDIO_NOISE ? 0 : rate * 3.0 / 16;
        NovaAudioProgramDesc desc = description(rate, count + 4, &p, 1, events, 2);
        NovaAudioProgram *program = prepare(desc);
        NovaAudioRenderer *a = renderer(program), *b = renderer(program);
        float output[(8192 + 4) * 2], other[(8192 + 4) * 2];
        render(a, output, count + 4, 127); render(b, other, count + 4, 1024);
        CHECK(!memcmp(output, other, sizeof(output)));
        for (size_t i = 0; i < count * 2; ++i) CHECK(isfinite(output[i]));
        if (source != NOVA_AUDIO_NOISE) {
            double alias = tone_amplitude(output, 4096, 4096, rate * 7.0 / 16, rate);
            CHECK(alias < 0.00001);
            CHECK(tone_amplitude(output, 4096, 4096, rate * 3.0 / 16, rate) > 0.6);
            if (source == NOVA_AUDIO_SINE)
                for (size_t i = 4096; i < 8192; ++i) NEAR(output[i * 2], sin(2 * PI * i * 3 / 16), 1e-6);
        } else CHECK(rms(output, 4096, 4096) > 0.5 && rms(output, 4096, 4096) < 0.65);
        nova_audio_renderer_destroy(a); nova_audio_renderer_destroy(b); nova_audio_program_release(program);

    }
    float naive[4096 * 2] = {0};
    for (size_t i = 0; i < 4096; ++i) naive[i * 2] = (float)(2 * fmod(i * 3.0 / 16, 1) - 1);
    CHECK(tone_amplitude(naive, 0, 4096, rate * 7.0 / 16, rate) > 0.1);

    NovaAudioPatch p = patch(NOVA_AUDIO_SAW);
    NovaAudioEvent events[] = {on(0, 1, 0),
        {.frame = 1000, .type = NOVA_AUDIO_VOICE_PITCH, .target = 1, .value = 10000, .ramp_frames = 4000},
        off(8000, 1)};
    NovaAudioProgramDesc desc = description(rate, 8004, &p, 1, events, 3);
    NovaAudioProgram *program = prepare(desc);
    NovaAudioRenderer *a = renderer(program), *b = renderer(program);
    float first[8004 * 2], second[8004 * 2];
    render(a, first, 8004, 1); render(b, second, 8004, 4096);
    CHECK(!memcmp(first, second, sizeof(first)));
    for (size_t i = 0; i < 8004 * 2; ++i) CHECK(isfinite(first[i]) && fabsf(first[i]) < 1.3f);
    nova_audio_renderer_destroy(a); nova_audio_renderer_destroy(b); nova_audio_program_release(program);

    p = patch(NOVA_AUDIO_SINE);
    events[0].note.frequency = 100;
    events[1].frame = 20; events[1].value = 1000; events[1].ramp_frames = 1000;
    desc = description(rate, 8004, &p, 1, events, 3);
    program = prepare(desc); a = renderer(program);
    render(a, first, 1200, 37);
    double phase = 0;
    for (unsigned i = 0; i < 1200; ++i) {
        double frequency = i < 20 ? 100 : i < 1020 ? 100 + (i - 20) * 0.9 : 1000;
        NEAR(first[i * 2], sin(2 * PI * phase), 2e-6);
        phase = fmod(phase + frequency / rate, 1);
    }
    nova_audio_renderer_destroy(a); nova_audio_program_release(program);
}

static double sampler_tone(uint32_t output_rate, double frequency, double ratio)
{
    float input[480];
    for (size_t i = 0; i < 480; ++i) input[i] = (float)(0.5 * sin(2 * PI * frequency * i / 48000));
    NovaAudioSample *s = sample(input, 480, 1, 48000);
    NovaAudioPatch p = patch(NOVA_AUDIO_SAMPLER);
    p.sample_end = 480; p.sample_max_ratio = ratio;
    NovaAudioEvent events[] = {on(0, 1, 0), off(8192, 1)};
    events[0].note.frequency *= ratio;
    NovaAudioProgramDesc desc = description(output_rate, 8196, &p, 1, events, 2);
    desc.samples = &s; desc.sample_count = 1;
    NovaAudioProgram *program = prepare(desc);
    NovaAudioRenderer *r = renderer(program);
    float data[8192 * 2];
    render(r, data, 8192, 512);
    double result = rms(data, 4096, 4096);
    nova_audio_renderer_destroy(r); nova_audio_program_release(program); nova_audio_sample_release(s);
    return result;
}

static void resampling_and_filter_quality(void)
{
    double wanted = sampler_tone(48000, 3000, 2);
    double rejected = sampler_tone(48000, 18000, 2);
    NEAR(wanted, sqrt(0.125), 0.0002);
    CHECK(rejected < 0.00005);
    CHECK(sampler_tone(44100, 23000, 1) < 0.0001);
    for (unsigned k = 0; k < 2; ++k) {
        double frequency = k ? 8000 : 100;
        NovaAudioPatch p = patch(NOVA_AUDIO_SINE);
        p.lowpass_hz = 1000;
        NovaAudioEvent events[] = {on(0, 1, 0), off(10000, 1)};
        events[0].note.frequency = frequency;
        NovaAudioProgram *program = prepare(description(48000, 10004, &p, 1, events, 2));
        NovaAudioRenderer *r = renderer(program);
        float data[10000 * 2];
        render(r, data, 10000, 512);
        double a = exp(-2 * PI * 1000 / 48000);
        double expected = (1 - a) / sqrt(1 + a * a - 2 * a * cos(2 * PI * frequency / 48000));
        NEAR(tone_amplitude(data, 4800, 4800, frequency, 48000), expected, 1e-5);
        nova_audio_renderer_destroy(r); nova_audio_program_release(program);
    }
    printf("Nova audio quality: 2x sampler pass RMS %.8f, rejected alias RMS %.8f\n", wanted, rejected);
}

static void fractional_wavetable_quality(void)
{
    NovaAudioPatch p = patch(NOVA_AUDIO_SAW);
    NovaAudioEvent events[] = {on(0, 1, 0), off(4096, 1)};
    double frequency = 48000 * 17.0 / 32768;
    events[0].note.frequency = frequency;
    NovaAudioProgram *program = prepare(description(48000, 4100, &p, 1, events, 2));
    NovaAudioRenderer *r = renderer(program);
    float data[4096 * 2];
    render(r, data, 4096, 101);
    double blend = (48000 * 0.45 / frequency) / 512 - 1;
    double squared_error = 0;
    for (unsigned i = 0; i < 4096; ++i) {
        double phase = fmod(i * 17.0 / 32768, 1), expected = 0;
        for (unsigned harmonic = 1; harmonic <= 512; ++harmonic)
            expected -= 2 / PI * sin(2 * PI * phase * harmonic) / harmonic *
                (harmonic <= 256 ? 1 : blend);
        double error = data[i * 2] - expected;
        squared_error += error * error;
    }
    double residual = sqrt(squared_error / 4096);
    CHECK(residual < 0.00015);
    printf("Nova audio quality: fractional-table saw residual RMS %.8f versus band-limited Fourier reference\n", residual);
    nova_audio_renderer_destroy(r); nova_audio_program_release(program);
}

static void reject(NovaAudioProgramDesc desc, const char *part)
{
    NovaAudioProgram *out = NULL;
    CHECK(!nova_audio_program_create(&desc, &out, error, sizeof(error)));
    CHECK(!out && *error);
    if (part && !strstr(error, part)) { fprintf(stderr, "expected %s in %s\n", part, error); exit(1); }
}

static void validation(void)
{
    float bad_samples[] = {NAN, INFINITY, -INFINITY, 16.01f};
    NovaAudioSample *out = NULL;
    for (size_t i = 0; i < 4; ++i)
        CHECK(!nova_audio_sample_create(bad_samples + i, (NovaAudioSampleInfo){48000, 1, 1},
            &out, error, sizeof(error)) && !out && *error);
    float zero = 0;
    CHECK(!nova_audio_sample_create(&zero, (NovaAudioSampleInfo){96000, 1, 1}, &out, error, sizeof(error)));
    CHECK(!nova_audio_sample_create(&zero, (NovaAudioSampleInfo){48000, 3, 1}, &out, error, sizeof(error)));
    CHECK(!nova_audio_sample_create(&zero, (NovaAudioSampleInfo){48000, 1, 0}, &out, error, sizeof(error)));
    CHECK(!nova_audio_sample_create(&zero, (NovaAudioSampleInfo){8000, 1, 480001}, &out, error, sizeof(error)));
    NovaAudioPatch p = patch(NOVA_AUDIO_NOISE);
    NovaAudioEvent events[] = {on(0, 1, 0), off(8, 1), on(12, 2, 0), off(20, 2)};
    events[0].note.frequency = events[2].note.frequency = 0;
    NovaAudioProgramDesc desc = description(48000, 24, &p, 1, events, 4);
    desc.voice_limit = 1;
    NovaAudioProgram *program = prepare(desc);
    NovaAudioProgram *retained = program;
    events[2].frame = 11;
    CHECK(!nova_audio_program_create(&desc, &retained, error, sizeof(error)) && retained == program);
    CHECK(strstr(error, "voice limit"));
    events[2].frame = 12;
    events[2].target = 1; reject(desc, "unique"); events[2].target = 2;
    events[3].target = 7; reject(desc, "follow"); events[3].target = 2;
    events[0].note.frequency = NAN; reject(desc, "frequency"); events[0].note.frequency = 0;
    events[0].note.pan = 2; reject(desc, "pan"); events[0].note.pan = -1;
    events[0].note.seed = 0; reject(desc, "seed"); events[0].note.seed = 123;
    events[0].note.patch = 1; reject(desc, "patch"); events[0].note.patch = 0;
    events[0].note.bus = 1; reject(desc, "bus"); events[0].note.bus = 0;
    events[0].note.gain = INFINITY; reject(desc, "gain"); events[0].note.gain = 1;
    events[1].frame = 0; reject(desc, "strictly"); events[1].frame = 8;
    events[3].frame = 21; reject(desc, "tail"); events[3].frame = 20;
    events[3].frame = 25; reject(desc, "[0,length)"); events[3].frame = 20;
    desc.event_count = 3; reject(desc, "requires an OFF"); desc.event_count = 4;
    desc.sample_rate = 96000; reject(desc, "rate"); desc.sample_rate = 48000;
    desc.length_frames = UINT64_MAX; reject(desc, "length"); desc.length_frames = 24;
    desc.voice_limit = NOVA_AUDIO_MAX_VOICES + 1; reject(desc, "capacity"); desc.voice_limit = 1;
    desc.event_count = NOVA_AUDIO_MAX_EVENTS + 1; reject(desc, "capacity"); desc.event_count = 4;
    desc.sample_count = NOVA_AUDIO_MAX_SAMPLES + 1; reject(desc, "capacity"); desc.sample_count = 0;
    desc.patch_count = NOVA_AUDIO_MAX_PATCHES + 1; reject(desc, "capacity"); desc.patch_count = 1;
    desc.bus_count = NOVA_AUDIO_MAX_BUSES + 1; reject(desc, "capacity"); desc.bus_count = 1;
    p.envelope.attack_frames = 0; reject(desc, "envelope"); p.envelope.attack_frames = 1;
    p.envelope.release_frames = 0; reject(desc, "envelope"); p.envelope.release_frames = 4;
    p.envelope.sustain = NAN; reject(desc, "envelope"); p.envelope.sustain = 1;
    p.lowpass_hz = -1; reject(desc, "low-pass"); p.lowpass_hz = 0;
    NovaAudioBus invalid_bus = {0, 1, 0};
    desc.buses = &invalid_bus; reject(desc, "routing"); desc.buses = &master;
    NovaAudioEvent automation[] = {on(0, 1, 0), off(8, 1),
        {.frame = 12, .type = NOVA_AUDIO_VOICE_GAIN, .target = 1, .value = 0, .ramp_frames = 1}};
    automation[0].note.frequency = 0;
    desc.events = automation; desc.event_count = 3;
    reject(desc, "ended");
    automation[2].frame = 10; automation[2].ramp_frames = 3; reject(desc, "beyond");
    automation[2].ramp_frames = 0; reject(desc, "ramps");
    automation[2].ramp_frames = 1; automation[2].type = (NovaAudioEventType)999; reject(desc, "unknown");
    automation[2].type = NOVA_AUDIO_VOICE_PITCH; automation[2].value = 30000; reject(desc, "parameter");
    automation[2].value = 0; reject(desc, "white noise");
    automation[2].type = NOVA_AUDIO_BUS_GAIN; automation[2].target = 2; reject(desc, "bus");
    nova_audio_program_release(program);

    float *long_sample = calloc(8000 * 60, sizeof(float));
    CHECK(long_sample);
    NovaAudioSample *samples[3];
    for (unsigned i = 0; i < 3; ++i) samples[i] = sample(long_sample, 8000 * 60, 1, 8000);
    free(long_sample);
    NovaAudioProgramDesc silence = description(44100, 44100 * 120, NULL, 0, NULL, 0);
    silence.samples = samples; silence.sample_count = 2;
    program = prepare(silence);
    nova_audio_program_release(program);
    silence.sample_count = 3; reject(silence, "120 seconds");
    NovaAudioSample *aliases[NOVA_AUDIO_MAX_SAMPLES];
    for (size_t i = 0; i < NOVA_AUDIO_MAX_SAMPLES; ++i) aliases[i] = samples[0];
    silence.samples = aliases; silence.sample_count = NOVA_AUDIO_MAX_SAMPLES;
    program = prepare(silence);
    nova_audio_program_release(program);
    for (unsigned i = 0; i < 3; ++i) nova_audio_sample_release(samples[i]);
}

static void full_capacity_and_sampler_pitch(void)
{
    float flat[] = {16, 16, 16, 16};
    NovaAudioSample *s = sample(flat, 4, 1, 48000);
    NovaAudioPatch p = patch(NOVA_AUDIO_SAMPLER);
    NovaAudioEvent events[(NOVA_AUDIO_MAX_VOICES + 1) * 2];
    NovaAudioBus buses[NOVA_AUDIO_MAX_BUSES];
    for (unsigned i = 0; i < NOVA_AUDIO_MAX_BUSES; ++i)
        buses[i] = (NovaAudioBus){i ? i - 1 : NOVA_AUDIO_NO_BUS, 4, 0};
    for (unsigned i = 0; i < NOVA_AUDIO_MAX_VOICES; ++i) {
        events[i] = on(0, i + 1, 0);
        events[i].note.gain = 4;
        events[i].note.bus = NOVA_AUDIO_MAX_BUSES - 1;
        events[NOVA_AUDIO_MAX_VOICES + i] = off(8, i + 1);
    }
    NovaAudioProgramDesc desc = description(48000, 12, &p, 1, events, NOVA_AUDIO_MAX_VOICES * 2);
    desc.samples = &s; desc.sample_count = 1; desc.buses = buses; desc.bus_count = NOVA_AUDIO_MAX_BUSES;
    NovaAudioProgram *program = prepare(desc);
    NovaAudioRenderer *r = renderer(program);
    float output[12 * 2];
    render(r, output, 12, 1);
    NEAR(output[2], 134217728.0, 8);
    CHECK(nova_audio_status(r).over_frames[0] == 11 && nova_audio_status(r).finished);
    nova_audio_renderer_destroy(r); nova_audio_program_release(program);
    for (unsigned i = 0; i < NOVA_AUDIO_MAX_VOICES + 1; ++i) {
        events[i] = on(0, i + 1, 0);
        events[NOVA_AUDIO_MAX_VOICES + 1 + i] = off(8, i + 1);
    }
    desc.event_count = (NOVA_AUDIO_MAX_VOICES + 1) * 2; reject(desc, "voice limit");
    desc.event_count = 2; events[0] = on(0, 1, 0); events[1] = off(8, 1);
    p.sample_end = 5; reject(desc, "sampler"); p.sample_end = 4;
    p.sample_max_ratio = 0; reject(desc, "sampler"); p.sample_max_ratio = 1;
    events[0].note.frequency = 441; reject(desc, "frequency"); events[0].note.frequency = 440;
    buses[1].parent = 1; reject(desc, "routing"); buses[1].parent = 0;
    nova_audio_sample_release(s);

    float source[100];
    for (unsigned i = 0; i < 100; ++i) source[i] = 1;
    s = sample(source, 100, 1, 48000);
    p.sample_end = 100; p.sample_loop = false; p.sample_max_ratio = 2;
    p.envelope.release_frames = 10;
    events[0] = on(0, 1, 0); events[1] = off(150, 1);
    desc = description(48000, 160, &p, 1, events, 2);
    desc.samples = &s; desc.sample_count = 1;
    program = prepare(desc); r = renderer(program);
    float tail[160 * 2];
    render(r, tail, 160, 23);
    for (unsigned i = 80; i < 100; ++i)
        CHECK(tail[i * 2] > 0 && tail[i * 2] < 1.2 * (100 - i) / 20.0);
    CHECK(tail[99 * 2] > 0 && tail[100 * 2] == 0);
    nova_audio_renderer_destroy(r); nova_audio_program_release(program); nova_audio_sample_release(s);
}

int main(void)
{
    exact_envelopes_and_loops();
    sampler_boundaries(44100, 48000);
    sampler_boundaries(48000, 44100);
    sampler_trim_and_end();
    ramps_and_cancellation();
    bus_routing_and_headroom();
    oscillator_quality(48000);
    oscillator_quality(44100);
    resampling_and_filter_quality();
    fractional_wavetable_quality();
    validation();
    full_capacity_and_sampler_pitch();
    puts("Nova sample-clock DSP, exact loops, ownership, smoothing, finite output and quality checks passed.");
    return 0;
}
