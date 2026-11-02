#include "production.h"
#include "transport.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PI 3.14159265358979323846
#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #c); exit(1); } } while (0)
#define NEAR(a, b, e) do { double near_actual = (a), near_expected = (b); \
    if (!(fabs(near_actual - near_expected) < (e))) { \
        fprintf(stderr, "%s:%d: %.17g != %.17g (tolerance %.9g)\n", __FILE__, __LINE__, near_actual, near_expected, (double)(e)); \
        exit(1); \
    } } while (0)

typedef struct {
    NovaAudioSample *sample;
    NovaAudioPatch patch;
    NovaAudioBus buses[NOVA_AUDIO_MAX_BUSES];
    NovaAudioEvent events[8];
    NovaAudioProgramDesc base;
} Fixture;

static char error[512];

static void fixture(Fixture *f, uint32_t rate, const float *source, uint32_t source_frames,
    uint32_t content, uint32_t tail)
{
    memset(f, 0, sizeof(*f));
    CHECK(nova_audio_sample_create(source, (NovaAudioSampleInfo){rate, 2, source_frames},
        &f->sample, error, sizeof(error)));
    f->patch = (NovaAudioPatch){.source = NOVA_AUDIO_SAMPLER, .envelope = {1, 0, 1, 1},
        .sample_end = source_frames, .sample_loop = true, .sample_root_hz = 440, .sample_max_ratio = 1};
    f->buses[0] = (NovaAudioBus){NOVA_AUDIO_NO_BUS, 1, 0};
    f->events[0] = (NovaAudioEvent){.type = NOVA_AUDIO_NOTE_ON, .target = 1, .note = {.frequency = 440, .gain = 1}};
    f->events[1] = (NovaAudioEvent){.frame = content - 1, .type = NOVA_AUDIO_NOTE_OFF, .target = 1};
    f->base = (NovaAudioProgramDesc){.sample_rate = rate, .voice_limit = 1, .length_frames = content + tail,
        .samples = &f->sample, .sample_count = 1, .patches = &f->patch, .patch_count = 1,
        .buses = f->buses, .bus_count = 1, .events = f->events, .event_count = 2};
}

static NovaAudioProductionDesc processing(NovaAudioInsert *inserts, size_t count, uint32_t tail)
{
    return (NovaAudioProductionDesc){.inserts = inserts, .insert_count = count,
        .tail_frames = tail, .tail_fade_frames = tail < 64 ? tail : 64};
}

static NovaAudioProgram *prepare(Fixture *f, const NovaAudioProductionDesc *production)
{
    NovaAudioProgram *p = NULL;
    if (!nova_audio_program_create_production(&f->base, production, &p, error, sizeof(error))) {
        fprintf(stderr, "production prepare: %s\n", error);
        exit(1);
    }
    return p;
}

static NovaAudioRenderer *renderer(NovaAudioProgram *p)
{
    NovaAudioRenderer *r = NULL;
    CHECK(nova_audio_renderer_create(p, &r, error, sizeof(error)));
    return r;
}

static void render(NovaAudioRenderer *r, float *output, size_t frames, size_t block)
{
    for (size_t position = 0; position < frames;) {
        size_t count = frames - position < block ? frames - position : block;
        CHECK(nova_audio_render(r, output + position * 2, count) == NOVA_AUDIO_OK);
        for (size_t i = 0; i < count * 2; ++i) CHECK(isfinite(output[position * 2 + i]));
        position += count;
    }
}

static float *rendered(NovaAudioProgram *p, size_t frames, size_t block)
{
    float *output = calloc(frames * 2, sizeof(float));
    CHECK(output);
    NovaAudioRenderer *r = renderer(p);
    render(r, output, frames, block);
    nova_audio_renderer_destroy(r);
    return output;
}

static void reject(Fixture *f, const NovaAudioProductionDesc *production, const char *reason)
{
    NovaAudioProgram *retained = prepare(f, NULL), *out = retained;
    CHECK(!nova_audio_program_create_production(&f->base, production, &out, error, sizeof(error)));
    CHECK(out == retained && *error);
    if (reason && !strstr(error, reason)) { fprintf(stderr, "expected %s in %s\n", reason, error); exit(1); }
    nova_audio_program_release(retained);
}

static double tone(const float *signal, size_t start, size_t frames, double frequency, uint32_t rate, unsigned channel)
{
    double a = 0, b = 0;
    for (size_t i = 0; i < frames; ++i) {
        double phase = 2 * PI * frequency * i / rate;
        a += signal[(start + i) * 2 + channel] * cos(phase);
        b += signal[(start + i) * 2 + channel] * sin(phase);
    }
    return 2 * hypot(a, b) / frames;
}

static void identity_and_ownership(void)
{
    float data[] = {0.25f, -0.5f, 0.125f, -0.25f, 0.5f, -0.125f, -0.5f, 0.25f};
    Fixture f;
    fixture(&f, 48000, data, 4, 100, 32);
    NovaAudioProgram *legacy = NULL;
    CHECK(nova_audio_program_create(&f.base, &legacy, error, sizeof(error)));
    NovaAudioProductionDesc empty = {0};
    NovaAudioProgram *same = prepare(&f, &empty);
    NovaAudioProductionInfo info = nova_audio_program_production_info(same);
    CHECK(!info.state_bytes && !info.buffer_bytes && !info.prepared_bytes && info.renderer_bytes);
    float *original = rendered(legacy, 256, 1), *copy = rendered(same, 256, 127);
    CHECK(!memcmp(original, copy, 512 * sizeof(float)));
    NovaAudioInsert insert = {.type = NOVA_AUDIO_REVERB, .wet = 0,
        .settings.reverb = {.decay_seconds = 0.5, .damping_hz = 6000}};
    NovaAudioProductionDesc production = processing(&insert, 1, 32);
    NovaAudioProgram *dry = prepare(&f, &production);
    float *bypass = rendered(dry, 256, 13);
    CHECK(!memcmp(original, bypass, 512 * sizeof(float)));
    info = nova_audio_program_production_info(dry);
    CHECK(info.insert_count == 1 && info.buffer_bytes && info.buffer_bytes < info.state_bytes);
    CHECK(info.renderer_bytes == nova_audio_program_production_info(legacy).renderer_bytes + info.state_bytes);
    insert.wet = 1; insert.settings.reverb.decay_seconds = 10;
    production.tail_frames = 99;
    float *immutable = rendered(dry, 256, 17);
    CHECK(!memcmp(immutable, bypass, 512 * sizeof(float)));
    NovaAudioRenderer *r = renderer(dry);
    nova_audio_program_release(legacy); nova_audio_program_release(same); nova_audio_program_release(dry);
    nova_audio_sample_release(f.sample);
    render(r, copy, 256, 64);
    CHECK(!memcmp(copy, bypass, 512 * sizeof(float)));
    nova_audio_renderer_destroy(r);
    free(original); free(copy); free(bypass); free(immutable);
}

static void filters(uint32_t rate)
{
    uint32_t frames = rate / 10;
    float *source = malloc(frames * 2 * sizeof(float));
    CHECK(source);
    const double frequencies[] = {100, 1000, 8000};
    for (NovaAudioInsertType type = NOVA_AUDIO_LOWPASS; type <= NOVA_AUDIO_BELL; ++type)
        for (unsigned test = 0; test < 3; ++test) {
            double frequency = frequencies[test];
            for (unsigned i = 0; i < frames; ++i) {
                source[i * 2] = (float)(0.25 * sin(2 * PI * frequency * i / rate));
                source[i * 2 + 1] = -source[i * 2] * 0.5f;
            }
            Fixture f;
            fixture(&f, rate, source, frames, rate, rate / 10);
            NovaAudioInsert insert = {.type = type, .wet = 1,
                .settings.filter = {.frequency_hz = 1000, .q = sqrt(0.5), .gain_db = type == NOVA_AUDIO_BELL ? 6 : 0}};
            NovaAudioProductionDesc production = processing(&insert, 1, rate / 10);
            NovaAudioProgram *p = prepare(&f, &production);
            float *output = rendered(p, rate, 127);
            double w = tan(PI * frequency / rate) / tan(PI * 1000 / rate);
            double k = sqrt(2), denominator = hypot(1 - w * w, k * w);
            double expected = type == NOVA_AUDIO_LOWPASS ? 1 / denominator : w * w / denominator;
            if (type == NOVA_AUDIO_BELL) {
                double boost = pow(10, 6.0 / 20) - 1, squared = denominator * denominator;
                expected = hypot(1 + boost * k * k * w * w / squared, boost * k * w * (1 - w * w) / squared);
            }
            double measured = tone(output, rate / 2, rate / 10, frequency, rate, 0) * 4;
            NEAR(measured, expected, 0.00002);
            NEAR(tone(output, rate / 2, rate / 10, frequency, rate, 1) * 8, expected, 0.00002);
            if (frequency == 1000) printf("A3 %u Hz insert %d center gain: %.8f\n", rate, type, measured);
            free(output); nova_audio_program_release(p); nova_audio_sample_release(f.sample);
        }
    free(source);

    float impulse[32] = {0}; impulse[2] = 1;
    Fixture f;
    fixture(&f, rate, impulse, 16, 16, rate);
    NovaAudioInsert insert = {.type = NOVA_AUDIO_BELL, .wet = 1,
        .settings.filter = {.frequency_hz = 20, .q = 4, .gain_db = 12}};
    NovaAudioProductionEvent events[512];
    for (unsigned i = 0; i < 512; ++i)
        events[i] = (NovaAudioProductionEvent){.frame = i, .parameter = NOVA_AUDIO_FILTER_FREQUENCY,
            .value = i & 1 ? 20 : rate * 0.4, .ramp_frames = 1};
    NovaAudioProductionDesc production = processing(&insert, 1, rate);
    production.events = events; production.event_count = 512;
    NovaAudioProgram *p = prepare(&f, &production);
    float *output = rendered(p, 16 + rate, 1), *other = rendered(p, 16 + rate, 4096);
    CHECK(!memcmp(output, other, (16 + rate) * 2 * sizeof(float)));
    for (unsigned i = 0; i < 16 + rate; ++i) {
        CHECK(fabsf(output[i * 2]) < 10 && output[i * 2 + 1] == 0);
    }
    free(output); free(other); nova_audio_program_release(p); nova_audio_sample_release(f.sample);
}

static void delay_timing(uint32_t rate)
{
    float impulse[32] = {0};
    impulse[2] = 0.75f; impulse[3] = -0.25f;
    Fixture f;
    fixture(&f, rate, impulse, 16, 16, 512);
    NovaAudioProgram *dry = prepare(&f, NULL);
    float *input = rendered(dry, 528, 7);
    nova_audio_program_release(dry);
    for (unsigned test = 0; test < 2; ++test) {
        NovaAudioInsert insert = {.type = NOVA_AUDIO_DELAY, .wet = 1,
            .settings.delay = {.frames = {3, 7}, .feedback = test ? -0.5 : 0.5, .damping_hz = test ? 1200 : 0}};
        NovaAudioProductionDesc production = processing(&insert, 1, 512);
        NovaAudioProductionEvent changes[] = {
            {.frame = 10, .parameter = NOVA_AUDIO_DELAY_FEEDBACK, .value = 0.75, .ramp_frames = 5},
            {.frame = 15, .parameter = NOVA_AUDIO_DELAY_FEEDBACK, .value = -0.5, .ramp_frames = 7}
        };
        if (test) { production.events = changes; production.event_count = 2; }
        NovaAudioProgram *p = prepare(&f, &production);
        float *output = rendered(p, 600, 127);
        double filtered[2] = {0};
        float history[528 * 2] = {0};
        double damping = test ? exp(-2 * PI * 1200 / rate) : 0;
        for (unsigned i = 0; i < 528; ++i) for (unsigned c = 0; c < 2; ++c) {
            unsigned delay = insert.settings.delay.frames[c];
            double delayed = i >= delay ? history[(i - delay) * 2 + c] : 0;
            filtered[c] = (1 - damping) * delayed + damping * filtered[c];
            double feedback = !test ? 0.5 : i < 10 ? -0.5 : i < 15 ? -0.5 + (i - 10) * 0.25 :
                i < 22 ? 0.75 - (i - 15) * 1.25 / 7 : -0.5;
            history[i * 2 + c] = (float)(input[i * 2 + c] + feedback * filtered[c]);
            double fade = i < 464 ? 1 : (528 - i) / 64.0;
            NEAR(output[i * 2 + c], delayed * fade, 1e-7);
        }
        NEAR(output[4 * 2], 0.75, 1e-7); NEAR(output[8 * 2 + 1], -0.25, 1e-7);
        for (unsigned i = 528 * 2; i < 600 * 2; ++i) CHECK(output[i] == 0);
        free(output); nova_audio_program_release(p);
    }
    free(input); nova_audio_sample_release(f.sample);
}

static void room_decay(uint32_t rate)
{
    float impulse[32] = {0}; impulse[2] = 1;
    Fixture f;
    fixture(&f, rate, impulse, 16, 16, rate * 3);
    NovaAudioInsert insert = {.type = NOVA_AUDIO_REVERB, .wet = 1,
        .settings.reverb = {.decay_seconds = 0.5, .damping_hz = 6000}};
    NovaAudioProductionDesc production = processing(&insert, 1, rate * 3);
    NovaAudioProgram *p = prepare(&f, &production);
    NovaAudioRenderer *r = renderer(p);
    float *output = calloc((rate * 3 + 16) * 2, sizeof(float));
    CHECK(output);
    render(r, output, 16, 1);
    NovaAudioProductionStatus status = nova_audio_production_status(r);
    CHECK(status.tail_active && status.tail_frames_remaining == rate * 3);
    CHECK(!nova_audio_status(r).active_voices && !nova_audio_status(r).finished);
    render(r, output + 32, rate * 3, 4096);
    CHECK(nova_audio_status(r).finished && nova_audio_production_status(r).ended);
    double energy[6] = {0}, left = 0, right = 0, cross = 0;
    for (unsigned i = 0; i < rate * 3; ++i) {
        double a = output[i * 2], b = output[i * 2 + 1];
        energy[i / (rate / 2)] += a * a + b * b;
        left += a * a; right += b * b; cross += a * b;
    }
    CHECK(energy[0] > 0.3 && energy[0] < 2);
    for (unsigned i = 1; i < 6; ++i) CHECK(energy[i] < energy[i - 1] * 0.001);
    CHECK(energy[5] < energy[0] * 1e-20);
    CHECK(fabs(cross / sqrt(left * right)) < 0.1);
    unsigned first = (unsigned)llround(1429.0 * rate / 48000) + 1;
    for (unsigned i = 0; i < first; ++i) CHECK(fabsf(output[i * 2]) < 1e-7f);
    NEAR(output[first * 2], 0.25, 1e-7); NEAR(output[first * 2 + 1], 0.25, 1e-7);
    printf("A3 %u Hz room: early/late energy %.8g / %.8g; stereo correlation %.7f\n",
        rate, energy[0], energy[5], cross / sqrt(left * right));
    free(output); nova_audio_renderer_destroy(r); nova_audio_program_release(p); nova_audio_sample_release(f.sample);
}

static void dynamics(uint32_t rate)
{
    float source[256 * 2];
    for (unsigned i = 0; i < 256; ++i) {
        source[i * 2] = i < 128 ? 2 : 0.0625f;
        source[i * 2 + 1] = -source[i * 2] * 0.25f;
    }
    Fixture f;
    fixture(&f, rate, source, 256, 256, 64);
    NovaAudioProgram *dry = prepare(&f, NULL);
    float *input = rendered(dry, 320, 31);
    nova_audio_program_release(dry);
    NovaAudioInsert insert = {.type = NOVA_AUDIO_COMPRESSOR, .wet = 1,
        .settings.compressor = {.threshold_db = 20 * log10(0.25), .ratio = 4, .makeup_db = 20 * log10(2),
            .attack_frames = 16, .release_frames = 32}};
    NovaAudioProductionDesc production = processing(&insert, 1, 64);
    NovaAudioProductionEvent compressor_changes[] = {
        {.frame = 64, .parameter = NOVA_AUDIO_COMPRESSOR_THRESHOLD_DB, .value = 20 * log10(0.5), .ramp_frames = 16},
        {.frame = 96, .parameter = NOVA_AUDIO_COMPRESSOR_MAKEUP_DB, .value = 0, .ramp_frames = 16}
    };
    production.events = compressor_changes; production.event_count = 2;
    NovaAudioProgram *p = prepare(&f, &production);
    NovaAudioRenderer *r = renderer(p);
    float output[320 * 2];
    render(r, output, 256, 1);
    double gain = 1, minimum = 1;
    for (unsigned i = 0; i < 256; ++i) {
        double threshold = i < 64 ? 0.25 : i < 80 ? 0.25 + (i - 64) / 64.0 : 0.5;
        double makeup = i < 96 ? 2 : i < 112 ? 2 - (i - 96) / 16.0 : 1;
        double peak = fabs(input[i * 2]), desired = peak > threshold ? pow(threshold / peak, 0.75) : 1;
        double coefficient = exp(-1.0 / (desired < gain ? 16 : 32));
        gain = desired + coefficient * (gain - desired);
        minimum = fmin(minimum, gain);
        for (unsigned c = 0; c < 2; ++c) NEAR(output[i * 2 + c], (float)(input[i * 2 + c] * gain * makeup), 1e-7);
    }
    NovaAudioProductionStatus status = nova_audio_production_status(r);
    NEAR(status.gain[0], gain, 1e-7); NEAR(status.minimum_gain[0], minimum, 1e-7);
    CHECK(status.input_peak[0][0] > 1 && status.input_over_frames[0] == 127);
    CHECK(output[2] > 1); /* Compressor attack is not a limiter. */
    nova_audio_renderer_destroy(r); nova_audio_program_release(p);

    insert = (NovaAudioInsert){.type = NOVA_AUDIO_LIMITER, .wet = 1,
        .settings.limiter = {.ceiling_db = 20 * log10(0.5), .release_frames = 16}};
    NovaAudioProductionEvent ceiling_change = {.frame = 64, .parameter = NOVA_AUDIO_LIMITER_CEILING_DB,
        .value = 20 * log10(0.25), .ramp_frames = 16};
    production.events = &ceiling_change; production.event_count = 1;
    p = prepare(&f, &production); r = renderer(p);
    render(r, output, 320, 127);
    gain = 1;
    for (unsigned i = 0; i < 256; ++i) {
        double ceiling = i < 64 ? 0.5 : i < 80 ? 0.5 - (i - 64) / 64.0 : 0.25;
        double peak = fabs(input[i * 2]), desired = peak > ceiling ? ceiling / peak : 1;
        gain = desired < gain ? desired : desired + exp(-1.0 / 16) * (gain - desired);
        for (unsigned c = 0; c < 2; ++c) {
            CHECK(fabs(output[i * 2 + c]) <= ceiling + 0.00000006);
            NEAR(output[i * 2 + c], input[i * 2 + c] * gain, 1e-7);
        }
    }
    status = nova_audio_production_status(r);
    CHECK(status.output_peak[0][0] <= 0.50000006f && !status.output_over_frames[0]);
    NEAR(status.minimum_gain[0], 0.125, 1e-7);
    nova_audio_renderer_destroy(r); nova_audio_program_release(p);
    insert.wet = 0.5f;
    p = prepare(&f, &production);
    float *partial = rendered(p, 256, 64);
    CHECK(partial[2] > 1); /* An explicit dry blend is not ceiling-limited. */
    free(partial); nova_audio_program_release(p); nova_audio_sample_release(f.sample); free(input);

    production.events = NULL; production.event_count = 0;
    const double levels[] = {-30, -12, -6, -3, 0, 6};
    for (unsigned i = 0; i < sizeof(levels) / sizeof(*levels); ++i) {
        float constant[] = {(float)pow(10, levels[i] / 20), 0};
        fixture(&f, rate, constant, 1, 1024, 64);
        insert = (NovaAudioInsert){.type = NOVA_AUDIO_COMPRESSOR, .wet = 1,
            .settings.compressor = {.threshold_db = -12, .ratio = 4, .attack_frames = 8, .release_frames = 8}};
        p = prepare(&f, &production);
        float *curve = rendered(p, 1024, 127);
        double expected_db = levels[i] <= -12 ? levels[i] : -12 + (levels[i] + 12) / 4;
        NEAR(20 * log10(curve[1000 * 2]), expected_db, 0.00001);
        CHECK(curve[1000 * 2 + 1] == 0);
        free(curve); nova_audio_program_release(p); nova_audio_sample_release(f.sample);
    }
}

static void sends_and_exact_automation(void)
{
    const float source[] = {1, -0.25f};
    Fixture f;
    fixture(&f, 48000, source, 1, 64, 0);
    f.buses[1] = (NovaAudioBus){0, 0.25f, 0};
    f.buses[2] = (NovaAudioBus){0, 1, 0};
    f.base.bus_count = 3; f.events[0].note.bus = 2;
    f.events[2] = f.events[1];
    f.events[1] = (NovaAudioEvent){.frame = 4, .type = NOVA_AUDIO_BUS_GAIN, .target = 2, .value = 0, .ramp_frames = 4};
    f.base.event_count = 3;
    NovaAudioSend sends[] = {{2, 1, false, 0}, {2, 1, true, 0.5f}};
    NovaAudioProductionEvent automation[] = {
        {.frame = 4, .parameter = NOVA_AUDIO_SEND_GAIN, .value = 2, .ramp_frames = 4},
        {.frame = 6, .parameter = NOVA_AUDIO_SEND_GAIN, .value = 1, .ramp_frames = 4},
        {.frame = 6, .parameter = NOVA_AUDIO_SEND_GAIN, .value = 0.5, .ramp_frames = 2}
    };
    NovaAudioProductionDesc production = {.sends = sends, .send_count = 2, .events = automation, .event_count = 3};
    NovaAudioProgram *p = prepare(&f, &production);
    float *output = rendered(p, 64, 1), *other = rendered(p, 64, 31);
    CHECK(!memcmp(output, other, 128 * sizeof(float)));
    for (unsigned i = 1; i < 63; ++i) {
        double fader = i < 4 ? 1 : i < 8 ? 1 - (i - 4) / 4.0 : 0;
        double send = i < 4 ? 0 : i < 6 ? (i - 4) * 0.5 : i < 8 ? 1 - (i - 6) * 0.25 : 0.5;
        double expected = fader + 0.25 * (send + 0.5 * fader);
        NEAR(output[i * 2], expected, 1e-7);
        NEAR(output[i * 2 + 1], expected * -0.25, 1e-7);
    }
    NEAR(output[9 * 2], 0.125, 1e-7); /* Pre-fader aux survives a zero source fader. */
    NovaAudioRenderer *r = renderer(p);
    render(r, other, 32, 13);
    CHECK(nova_audio_cancel(r, 8) == NOVA_AUDIO_OK);
    render(r, other, 16, 1);
    for (unsigned i = 0; i < 16; ++i) NEAR(other[i * 2], i < 8 ? 0.125 * (1 - i / 8.0) : 0, 1e-7);
    CHECK(nova_audio_status(r).finished);
    nova_audio_renderer_destroy(r);
    free(output); free(other); nova_audio_program_release(p); nova_audio_sample_release(f.sample);

    fixture(&f, 48000, source, 1, 64, 32);
    NovaAudioInsert insert = {.type = NOVA_AUDIO_COMPRESSOR, .wet = 1,
        .settings.compressor = {.threshold_db = 0, .ratio = 1, .attack_frames = 1, .release_frames = 1}};
    NovaAudioProductionEvent gain_events[] = {
        {.frame = 4, .parameter = NOVA_AUDIO_COMPRESSOR_MAKEUP_DB, .value = 20 * log10(0.5), .ramp_frames = 4},
        {.frame = 6, .parameter = NOVA_AUDIO_COMPRESSOR_MAKEUP_DB, .value = 20 * log10(2), .ramp_frames = 4}
    };
    production = processing(&insert, 1, 32);
    production.events = gain_events; production.event_count = 2;
    p = prepare(&f, &production);
    output = rendered(p, 64, 7);
    for (unsigned i = 1; i < 63; ++i) {
        double expected = i < 4 ? 1 : i < 6 ? 1 - (i - 4) * 0.125 : i < 10 ? 0.75 + (i - 6) * 0.3125 : 2;
        NEAR(output[i * 2], expected, 1e-7);
    }
    free(output); nova_audio_program_release(p); nova_audio_sample_release(f.sample);
}

static void maximum_delay_and_reset(uint32_t rate)
{
    float impulse[32] = {0}; impulse[2] = 0.75f; impulse[3] = -0.5f;
    uint32_t delay = rate * NOVA_AUDIO_DELAY_SECONDS, frames = delay + 128;
    Fixture f;
    fixture(&f, rate, impulse, 16, 16, frames - 16);
    NovaAudioProgram *dry = prepare(&f, NULL);
    float *input = rendered(dry, 16, 16);
    nova_audio_program_release(dry);
    NovaAudioInsert insert = {.type = NOVA_AUDIO_DELAY, .wet = 1,
        .settings.delay = {.frames = {delay, delay - 1}, .feedback = -0.95}};
    NovaAudioProductionDesc production = processing(&insert, 1, frames - 16);
    NovaAudioProgram *p = prepare(&f, &production);
    NovaAudioRenderer *r = renderer(p);
    float *output = calloc(frames * 2, sizeof(float)), *again = calloc(frames * 2, sizeof(float));
    CHECK(output && again);
    render(r, output, frames, 4096);
    for (unsigned i = 0; i < frames; ++i)
        for (unsigned c = 0; c < 2; ++c) {
            uint32_t offset = delay - c;
            float expected = i >= offset && i < offset + 16 ? input[(i - offset) * 2 + c] : 0;
            CHECK(output[i * 2 + c] == expected);
        }
    nova_audio_renderer_reset(r);
    CHECK(!nova_audio_production_status(r).input_peak[0][0]);
    render(r, again, frames, 127);
    CHECK(!memcmp(output, again, frames * 2 * sizeof(float)));
    CHECK(nova_audio_status(r).finished);
    free(output); free(again); free(input); nova_audio_renderer_destroy(r);
    nova_audio_program_release(p); nova_audio_sample_release(f.sample);
}

static void filter_interpolation(uint32_t rate)
{
    float source[64 * 2];
    for (unsigned i = 0; i < 64; ++i) {
        source[i * 2] = i % 7 < 2 ? 0.75f : -0.25f;
        source[i * 2 + 1] = -source[i * 2] * 0.5f;
    }
    Fixture f;
    fixture(&f, rate, source, 64, 64, 32);
    NovaAudioProgram *dry = prepare(&f, NULL);
    float *input = rendered(dry, 64, 1);
    nova_audio_program_release(dry);
    for (NovaAudioInsertType type = NOVA_AUDIO_LOWPASS; type <= NOVA_AUDIO_BELL; ++type) {
        NovaAudioInsert insert = {.type = type, .wet = 0.25f, .settings.filter = {
            .frequency_hz = 200, .q = 1, .gain_db = type == NOVA_AUDIO_BELL ? 20 * log10(2) : 0}};
        NovaAudioProductionEvent events[] = {
            {.frame = 4, .parameter = NOVA_AUDIO_INSERT_WET, .value = 0.75, .ramp_frames = 4},
            {.frame = 6, .parameter = NOVA_AUDIO_INSERT_WET, .value = 1, .ramp_frames = 4},
            {.frame = 8, .parameter = NOVA_AUDIO_FILTER_FREQUENCY, .value = rate * 0.35, .ramp_frames = 16},
            {.frame = 12, .parameter = NOVA_AUDIO_FILTER_FREQUENCY, .value = 500, .ramp_frames = 8},
            {.frame = 16, .parameter = NOVA_AUDIO_BELL_GAIN_DB, .value = 20 * log10(0.5), .ramp_frames = 8}
        };
        NovaAudioProductionDesc production = processing(&insert, 1, 32);
        production.events = events; production.event_count = type == NOVA_AUDIO_BELL ? 5 : 4;
        NovaAudioProgram *p = prepare(&f, &production);
        float *output = rendered(p, 64, 17);
        double previous[2][2] = {{0}};
        double first = tan(PI * 200 / rate), second = tan(PI * 0.35), last = tan(PI * 500 / rate);
        double interrupted = first + (second - first) * 0.25;
        for (unsigned i = 0; i < 64; ++i) {
            double g = i < 8 ? first : i < 12 ? first + (second - first) * (i - 8) / 16 :
                i < 20 ? interrupted + (last - interrupted) * (i - 12) / 8 : last;
            double wet = i < 4 ? 0.25 : i < 6 ? 0.25 + (i - 4) * 0.125 :
                i < 10 ? 0.5 + (i - 6) * 0.125 : 1;
            double gain = i < 16 ? 2 : i < 24 ? 2 - (i - 16) * 1.5 / 8 : 0.5;
            double denominator = 1 + g + g * g;
            for (unsigned c = 0; c < 2; ++c) {
                double x = input[i * 2 + c], a = previous[c][0], b = previous[c][1];
                double next_a = ((1 - g - g * g) * a - 2 * g * b + 2 * g * x) / denominator;
                double next_b = (2 * g * a + (1 + g - g * g) * b + 2 * g * g * x) / denominator;
                double low = (b + next_b) * 0.5, band = (a + next_a) * 0.5;
                double filtered = type == NOVA_AUDIO_LOWPASS ? low : type == NOVA_AUDIO_HIGHPASS ? x - band - low :
                    x + (gain - 1) * band;
                NEAR(output[i * 2 + c], x + wet * (filtered - x), 1e-6);
                previous[c][0] = next_a; previous[c][1] = next_b;
            }
        }
        free(output); nova_audio_program_release(p);
    }
    free(input); nova_audio_sample_release(f.sample);
}

typedef struct { unsigned char *data; size_t size, capacity; } Output;

static bool write_bytes(void *context, const void *bytes, size_t size)
{
    Output *out = context;
    CHECK(size <= out->capacity - out->size);
    memcpy(out->data + out->size, bytes, size); out->size += size;
    return true;
}

static void automated_graph_and_export(uint32_t rate)
{
    float source[512 * 2];
    for (unsigned i = 0; i < 512; ++i) {
        source[i * 2] = (float)(0.1 * sin(2 * PI * i / 32));
        source[i * 2 + 1] = (float)(0.05 * cos(2 * PI * i / 64));
    }
    Fixture f;
    fixture(&f, rate, source, 512, 6000, 4000);
    f.buses[1] = (NovaAudioBus){0, 0.5f, 0};
    f.buses[2] = (NovaAudioBus){0, 0.5f, 0};
    f.base.bus_count = 3; f.events[0].note.bus = 2;
    NovaAudioInsert inserts[] = {
        {.bus = 2, .type = NOVA_AUDIO_LOWPASS, .wet = 0.6f, .settings.filter = {.frequency_hz = 300, .q = 1}},
        {.bus = 2, .type = NOVA_AUDIO_DELAY, .wet = 0.25f, .settings.delay = {.frames = {97, 149}, .feedback = 0.3}},
        {.bus = 1, .type = NOVA_AUDIO_REVERB, .wet = 1, .settings.reverb = {.decay_seconds = 0.3, .damping_hz = 5000}},
        {.type = NOVA_AUDIO_COMPRESSOR, .wet = 1,
            .settings.compressor = {.threshold_db = -12, .ratio = 3, .attack_frames = 48, .release_frames = 480}},
        {.type = NOVA_AUDIO_LIMITER, .wet = 1, .settings.limiter = {.ceiling_db = -1, .release_frames = 128}}
    };
    NovaAudioSend send = {2, 1, true, 0.25f};
    NovaAudioProductionEvent events[] = {
        {.frame = 32, .parameter = NOVA_AUDIO_SEND_GAIN, .value = 0.75, .ramp_frames = 128},
        {.frame = 500, .parameter = NOVA_AUDIO_INSERT_WET, .value = 0, .ramp_frames = 500},
        {.frame = 750, .parameter = NOVA_AUDIO_INSERT_WET, .value = 1, .ramp_frames = 250},
        {.frame = 1000, .parameter = NOVA_AUDIO_FILTER_FREQUENCY, .value = 4000, .ramp_frames = 2200},
        {.frame = 1111, .target = 1, .parameter = NOVA_AUDIO_DELAY_FEEDBACK, .value = -0.75, .ramp_frames = 1000},
        {.frame = 2049, .target = 2, .parameter = NOVA_AUDIO_INSERT_WET, .value = 0.5, .ramp_frames = 500},
        {.frame = 3500, .target = 3, .parameter = NOVA_AUDIO_COMPRESSOR_THRESHOLD_DB, .value = -6, .ramp_frames = 200},
        {.frame = 3700, .target = 3, .parameter = NOVA_AUDIO_COMPRESSOR_MAKEUP_DB, .value = 3, .ramp_frames = 500},
        {.frame = 4000, .target = 4, .parameter = NOVA_AUDIO_LIMITER_CEILING_DB, .value = -6, .ramp_frames = 100}
    };
    NovaAudioProductionDesc production = processing(inserts, 5, 4000);
    production.sends = &send; production.send_count = 1;
    production.events = events; production.event_count = sizeof(events) / sizeof(*events);
    NovaAudioProgram *p = prepare(&f, &production);
    float *single = rendered(p, 10000, 1), *large = rendered(p, 10000, 4096);
    CHECK(!memcmp(single, large, 20000 * sizeof(float)));
    NovaAudioRenderer *audition = renderer(p);
    float scratch[64];
    render(audition, scratch, 32, 13);
    Output wav = {.capacity = 56 + 10000 * 8};
    wav.data = malloc(wav.capacity); CHECK(wav.data);
    NovaAudioExportResult result;
    CHECK(nova_audio_write_wav(p, (NovaAudioExport){.frames = 10000, .format = NOVA_AUDIO_WAV_FLOAT32},
        write_bytes, &wav, &result, error, sizeof(error)));
    CHECK(result.complete && result.frames_written == 10000 && result.bytes_written == wav.capacity);
    CHECK(nova_audio_status(audition).clock == 32);
    NovaAudioWavInfo info;
    CHECK(nova_audio_wav_inspect(wav.data, wav.size, &info, error, sizeof(error)));
    CHECK(info.sample.sample_rate == rate && info.sample.frames == 10000 && info.bits == 32);
    CHECK(nova_audio_wav_read(wav.data, wav.size, large, 20000, error, sizeof(error)));
    CHECK(!memcmp(single, large, 20000 * sizeof(float)));
    NovaAudioTransport *live = NULL;
    CHECK(nova_audio_transport_create(rate, &live, error, sizeof(error)));
    uint64_t ticket;
    CHECK(nova_audio_transport_replace(live, p, 1, &ticket) == NOVA_AUDIO_CONTROL_OK);
    for (unsigned position = 0; position < 10000;) {
        unsigned count = 10000 - position < 257 ? 10000 - position : 257;
        CHECK(nova_audio_transport_render(live, large + position * 2, count) == NOVA_AUDIO_OK);
        position += count;
    }
    CHECK(!memcmp(single, large, 20000 * sizeof(float)));
    NovaAudioReceipt receipt;
    CHECK(nova_audio_transport_receipt(live, &receipt) && receipt.ticket == ticket && receipt.result == NOVA_AUDIO_CONTROL_OK);
    NovaAudioTransportSnapshot snapshot;
    CHECK(nova_audio_transport_snapshot(live, &snapshot) && snapshot.current.finished && snapshot.current.position == 10000);
    for (unsigned c = 0; c < 2; ++c) {
        float peak = 0;
        for (unsigned i = 0; i < 10000; ++i) peak = fmaxf(peak, fabsf(single[i * 2 + c]));
        CHECK(snapshot.peak[c] == peak && snapshot.current.peak[0][c] == peak);
    }
    nova_audio_transport_destroy(live);
    NovaAudioProductionInfo memory = nova_audio_program_production_info(p);
    printf("A3 %u Hz graph: renderer %zu, processing %zu (buffers %zu), prepared %zu bytes; float WAV/direct/transport identical.\n",
        rate, memory.renderer_bytes, memory.state_bytes, memory.buffer_bytes, memory.prepared_bytes);
    nova_audio_renderer_destroy(audition); free(wav.data); free(single); free(large);
    nova_audio_program_release(p); nova_audio_sample_release(f.sample);
}

static void tails_reset_cancel_and_transport(void)
{
    float impulse[32] = {0}; impulse[2] = 1; impulse[3] = -0.5f;
    Fixture f;
    fixture(&f, 48000, impulse, 16, 16, 128);
    NovaAudioInsert insert = {.type = NOVA_AUDIO_DELAY, .wet = 1,
        .settings.delay = {.frames = {17, 29}, .feedback = 0.9}};
    NovaAudioProductionDesc production = processing(&insert, 1, 128);
    NovaAudioProgram *p = prepare(&f, &production);
    NovaAudioRenderer *a = renderer(p), *b = renderer(p);
    float first[160 * 2], second[160 * 2];
    render(a, first, 80, 7); render(b, second, 80, 31);
    CHECK(nova_audio_production_status(a).tail_frames_remaining == 64 && !nova_audio_status(a).finished);
    CHECK(nova_audio_cancel(a, 16) == NOVA_AUDIO_OK);
    CHECK(nova_audio_cancel(a, 32) == NOVA_AUDIO_OK);
    render(a, first, 32, 1); render(b, second, 32, 13);
    for (unsigned i = 0; i < 32; ++i) for (unsigned c = 0; c < 2; ++c) {
        /* Remove the reference's independently declared natural end fade. */
        double natural = (64 - i) / 64.0;
        double expected = i < 16 ? second[i * 2 + c] / natural * (1 - i / 16.0) : 0;
        NEAR(first[i * 2 + c], expected, 1e-7);
    }
    CHECK(nova_audio_status(a).finished && nova_audio_production_status(a).cancel_frames_remaining == 0);
    nova_audio_renderer_reset(a); nova_audio_renderer_reset(b);
    render(a, first, 160, 1); render(b, second, 160, 127);
    CHECK(!memcmp(first, second, sizeof(first)));
    CHECK(nova_audio_status(a).finished && nova_audio_production_status(a).ended);
    nova_audio_renderer_destroy(a); nova_audio_renderer_destroy(b); nova_audio_program_release(p);
    f.base.loop = true; p = prepare(&f, &production); a = renderer(p);
    float cycles[144 * 6];
    render(a, cycles, 144 * 3, 13);
    CHECK(!memcmp(cycles, cycles + 288, 288 * sizeof(float)));
    CHECK(!memcmp(cycles, cycles + 576, 288 * sizeof(float)));
    CHECK(nova_audio_status(a).position == 0 && !nova_audio_status(a).finished);
    nova_audio_renderer_reset(a);
    b = renderer(p);
    render(a, cycles, 136, 13); render(b, second, 136, 13);
    render(b, second, 8, 1);
    CHECK(nova_audio_cancel(a, 16) == NOVA_AUDIO_OK);
    render(a, first, 15, 1); CHECK(!nova_audio_status(a).finished);
    for (unsigned i = 0; i < 8; ++i) for (unsigned c = 0; c < 2; ++c) {
        double natural = (8 - i) / 64.0;
        NEAR(first[i * 2 + c], second[i * 2 + c] / natural * 0.125 * (1 - i / 16.0), 1e-7);
    }
    CHECK(first[10 * 2 + 1] != 0); /* Existing tail continues past the old loop end. */
    render(a, cycles, 1, 1); CHECK(nova_audio_status(a).finished);
    CHECK(nova_audio_status(a).position == 144);
    nova_audio_renderer_destroy(a); nova_audio_renderer_destroy(b);

    NovaAudioTransport *transport = NULL;
    CHECK(nova_audio_transport_create(48000, &transport, error, sizeof(error)));
    uint64_t original, replacement;
    CHECK(nova_audio_transport_replace(transport, p, 8, &original) == NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_transport_render(transport, first, 80) == NOVA_AUDIO_OK);
    NovaAudioReceipt receipt;
    CHECK(nova_audio_transport_receipt(transport, &receipt) && receipt.ticket == original && receipt.result == NOVA_AUDIO_CONTROL_OK);
    a = renderer(p); b = renderer(p);
    render(a, first, 80, 1);
    CHECK(nova_audio_cancel(a, 8) == NOVA_AUDIO_OK);
    CHECK(nova_audio_transport_replace(transport, p, 8, &replacement) == NOVA_AUDIO_CONTROL_OK);
    nova_audio_program_release(p); nova_audio_sample_release(f.sample);
    float fresh[32 * 2], mixed[32 * 2];
    render(a, first, 32, 1); render(b, fresh, 32, 1);
    CHECK(nova_audio_transport_render(transport, mixed, 32) == NOVA_AUDIO_OK);
    CHECK(nova_audio_transport_receipt(transport, &receipt) && receipt.ticket == replacement && receipt.result == NOVA_AUDIO_CONTROL_OK);
    for (unsigned i = 0; i < 32; ++i) for (unsigned c = 0; c < 2; ++c)
        NEAR(mixed[i * 2 + c], first[i * 2 + c] + fresh[i * 2 + c] * (i < 8 ? i / 8.0 : 1), 1e-7);
    CHECK(nova_audio_transport_collect(transport) == 1);
    NovaAudioTransportSnapshot snapshot;
    CHECK(nova_audio_transport_snapshot(transport, &snapshot) && !snapshot.retiring_program);
    CHECK(snapshot.current.peak[0][0] > 0 && !snapshot.current.finished);
    nova_audio_renderer_destroy(a); nova_audio_renderer_destroy(b); nova_audio_transport_destroy(transport);
}

static void validation_and_capacity(void)
{
    const float source[] = {16, -16};
    Fixture f;
    fixture(&f, 48000, source, 1, 64, 2048);
    NovaAudioInsert inserts[NOVA_AUDIO_MAX_INSERTS + 1];
    for (unsigned i = 0; i < NOVA_AUDIO_MAX_INSERTS + 1; ++i)
        inserts[i] = (NovaAudioInsert){.bus = i / 2, .type = NOVA_AUDIO_DELAY, .wet = 1,
            .settings.delay = {.frames = {1, 1}, .feedback = 0.95}};
    NovaAudioProductionDesc good = processing(inserts, 1, 2048), invalid = good;
    invalid.insert_count = NOVA_AUDIO_MAX_INSERTS + 1; reject(&f, &invalid, "capacity");
    invalid = good; invalid.inserts = NULL; reject(&f, &invalid, "array");
    invalid = good; invalid.tail_frames = 0; invalid.tail_fade_frames = 0; reject(&f, &invalid, "tail");
    invalid = good; invalid.tail_fade_frames = 0; reject(&f, &invalid, "fade");
    invalid = good; invalid.tail_fade_frames = 2049; reject(&f, &invalid, "fade");
    invalid = good; invalid.tail_frames = 48000 * NOVA_AUDIO_TAIL_SECONDS + 1; reject(&f, &invalid, "tail");
    invalid = good; invalid.tail_frames = (uint32_t)f.base.length_frames; reject(&f, &invalid, "tail");
    invalid = good; invalid.tail_frames = 2049; reject(&f, &invalid, "content");
    inserts[0].bus = 1; reject(&f, &good, "insert"); inserts[0].bus = 0;
    inserts[0].type = (NovaAudioInsertType)99; reject(&f, &good, "insert"); inserts[0].type = NOVA_AUDIO_DELAY;
    inserts[0].wet = NAN; reject(&f, &good, "insert"); inserts[0].wet = 1;
    inserts[0].settings.delay.feedback = 1; reject(&f, &good, "insert"); inserts[0].settings.delay.feedback = 0.95;
    inserts[0].settings.delay.frames[0] = 0; reject(&f, &good, "insert");
    inserts[0].settings.delay.frames[0] = 96001; reject(&f, &good, "insert");
    inserts[0].settings.delay.frames[0] = 1;
    NovaAudioSend send = {1, 1, false, 1};
    invalid = good; invalid.sends = &send; invalid.send_count = 1; reject(&f, &invalid, "send");
    NovaAudioProductionEvent event = {.frame = 1, .parameter = NOVA_AUDIO_INSERT_WET, .value = 0.5, .ramp_frames = 1};
    invalid = good; invalid.events = &event; invalid.event_count = NOVA_AUDIO_MAX_EVENTS;
    reject(&f, &invalid, "capacity");
    invalid.event_count = 1;
    event.target = 1; reject(&f, &invalid, "automation"); event.target = 0;
    event.value = INFINITY; reject(&f, &invalid, "automation"); event.value = 0.5;
    event.ramp_frames = 0; reject(&f, &invalid, "automation"); event.ramp_frames = 1;
    event.frame = f.base.length_frames; reject(&f, &invalid, "automation"); event.frame = 1;
    event.parameter = NOVA_AUDIO_FILTER_FREQUENCY; reject(&f, &invalid, "automation");
    invalid.events = NULL; reject(&f, &invalid, "array");
    invalid = good; invalid.send_count = 1; reject(&f, &invalid, "array");
    invalid.sends = &send; invalid.send_count = NOVA_AUDIO_MAX_SENDS + 1; reject(&f, &invalid, "capacity");
    NovaAudioProductionEvent many[NOVA_AUDIO_MAX_EVENTS];
    for (unsigned i = 0; i < NOVA_AUDIO_MAX_EVENTS; ++i)
        many[i] = (NovaAudioProductionEvent){.parameter = NOVA_AUDIO_INSERT_WET, .value = i % 2, .ramp_frames = 1};
    invalid = good; invalid.events = many; invalid.event_count = NOVA_AUDIO_MAX_EVENTS - f.base.event_count;
    NovaAudioProgram *capacity = prepare(&f, &invalid);
    float *capacity_output = rendered(capacity, 2112, 1);
    CHECK(capacity_output[4] != 0 && capacity_output[4] == -capacity_output[5]);
    free(capacity_output); nova_audio_program_release(capacity);
    many[0].frame = 1; reject(&f, &invalid, "automation"); many[0].frame = 0;
    many[0].parameter = (NovaAudioProductionParameter)99; reject(&f, &invalid, "automation");
    many[0].parameter = NOVA_AUDIO_INSERT_WET;
    many[0].ramp_frames = (uint32_t)f.base.length_frames + 1; reject(&f, &invalid, "automation");
    many[0].ramp_frames = 48000 * 60 + 1; reject(&f, &invalid, "automation");
    many[0].ramp_frames = 1;

    f.base.bus_count = NOVA_AUDIO_MAX_BUSES;
    f.events[0].note.bus = NOVA_AUDIO_MAX_BUSES - 1;
    for (unsigned i = 0; i < NOVA_AUDIO_MAX_BUSES; ++i)
        f.buses[i] = (NovaAudioBus){i ? i - 1 : NOVA_AUDIO_NO_BUS, 4, 0};
    NovaAudioSend sends[NOVA_AUDIO_MAX_SENDS];
    unsigned count = 0;
    for (unsigned from = 1; from < NOVA_AUDIO_MAX_BUSES; ++from)
        for (unsigned to = 0; to < from && count < NOVA_AUDIO_MAX_SENDS; ++to)
            sends[count++] = (NovaAudioSend){from, to, true, 2};
    CHECK(count == NOVA_AUDIO_MAX_SENDS);
    good.insert_count = NOVA_AUDIO_MAX_INSERTS; good.sends = sends; good.send_count = count;
    NovaAudioProgram *p = prepare(&f, &good);
    float *output = rendered(p, 2112, 31);
    double peak = 0;
    for (unsigned i = 0; i < 4224; ++i) peak = fmax(peak, fabs(output[i]));
    CHECK(peak > 1e10 && peak < 1e38);
    free(output); nova_audio_program_release(p);
    sends[1] = sends[0]; reject(&f, &good, "duplicate");
    good.sends = NULL; good.send_count = 0;
    for (unsigned i = 0; i < 5; ++i) inserts[i].bus = 0;
    reject(&f, &good, "insert");
    for (unsigned i = 0; i < NOVA_AUDIO_MAX_INSERTS; ++i) inserts[i].bus = i / 2;
    for (unsigned i = 0; i < 3; ++i) inserts[i].settings.delay.frames[0] = inserts[i].settings.delay.frames[1] = 96000;
    reject(&f, &good, "buffer budget");
    inserts[2].settings.delay.frames[0] = inserts[2].settings.delay.frames[1] = 70144;
    good.insert_count = 3;
    p = prepare(&f, &good);
    NovaAudioProductionInfo info = nova_audio_program_production_info(p);
    CHECK(info.buffer_bytes == NOVA_AUDIO_EFFECT_BUFFER_LIMIT);
    CHECK(info.state_bytes > info.buffer_bytes);
    printf("A3 maximum storage: %zu buffer + %zu fixed processing + %zu base = %zu renderer bytes; immutable production %zu.\n",
        info.buffer_bytes, info.state_bytes - info.buffer_bytes, info.renderer_bytes - info.state_bytes,
        info.renderer_bytes, info.prepared_bytes);
    NovaAudioRenderer *r = renderer(p);
    float silent[64];
    render(r, silent, 32, 1);
    nova_audio_renderer_reset(r);
    render(r, silent, 32, 13);
    nova_audio_renderer_destroy(r);
    nova_audio_program_release(p);
    ++inserts[2].settings.delay.frames[1]; reject(&f, &good, "buffer budget");
    nova_audio_sample_release(f.sample);
}

static void parameter_rejection(void)
{
    const float source[] = {1, -0.5f};
    Fixture f;
    fixture(&f, 48000, source, 1, 16, 64);
    NovaAudioInsert insert = {.type = NOVA_AUDIO_BELL, .wet = 1,
        .settings.filter = {.frequency_hz = 1000, .q = 1, .gain_db = 6}};
    NovaAudioProductionDesc production = processing(&insert, 1, 64);
    const double invalid_frequency[] = {0, 19.99, 19200.01, NAN, INFINITY};
    for (unsigned i = 0; i < sizeof(invalid_frequency) / sizeof(*invalid_frequency); ++i) {
        insert.settings.filter.frequency_hz = invalid_frequency[i]; reject(&f, &production, "insert");
    }
    insert.settings.filter.frequency_hz = 1000;
    insert.settings.filter.q = 0.499; reject(&f, &production, "insert");
    insert.settings.filter.q = 4.001; reject(&f, &production, "insert"); insert.settings.filter.q = 1;
    insert.settings.filter.gain_db = 12.001; reject(&f, &production, "insert");
    insert.settings.filter.gain_db = -12.001; reject(&f, &production, "insert"); insert.settings.filter.gain_db = 6;
    insert.type = NOVA_AUDIO_LOWPASS; reject(&f, &production, "insert");
    insert = (NovaAudioInsert){.type = NOVA_AUDIO_DELAY, .wet = 1, .settings.delay = {.frames = {1, 1}}};
    insert.settings.delay.feedback = -0.951; reject(&f, &production, "insert"); insert.settings.delay.feedback = 0.5;
    insert.settings.delay.damping_hz = -1; reject(&f, &production, "insert");
    insert.settings.delay.damping_hz = 21601; reject(&f, &production, "insert");
    insert = (NovaAudioInsert){.type = NOVA_AUDIO_REVERB, .wet = 1, .settings.reverb = {.decay_seconds = 0.099}};
    reject(&f, &production, "insert");
    insert.settings.reverb.decay_seconds = 10.001; reject(&f, &production, "insert");
    insert.settings.reverb.decay_seconds = 1; insert.settings.reverb.damping_hz = 19; reject(&f, &production, "insert");
    insert = (NovaAudioInsert){.type = NOVA_AUDIO_COMPRESSOR, .wet = 1, .settings.compressor = {
        .threshold_db = -61, .ratio = 2, .makeup_db = 0, .attack_frames = 1, .release_frames = 1}};
    reject(&f, &production, "insert");
    insert.settings.compressor.threshold_db = 0.01; reject(&f, &production, "insert"); insert.settings.compressor.threshold_db = -6;
    insert.settings.compressor.ratio = 0.99; reject(&f, &production, "insert");
    insert.settings.compressor.ratio = 20.01; reject(&f, &production, "insert"); insert.settings.compressor.ratio = 2;
    insert.settings.compressor.makeup_db = NAN; reject(&f, &production, "insert"); insert.settings.compressor.makeup_db = 0;
    insert.settings.compressor.attack_frames = 0; reject(&f, &production, "insert"); insert.settings.compressor.attack_frames = 1;
    insert.settings.compressor.release_frames = 480001; reject(&f, &production, "insert");
    insert = (NovaAudioInsert){.type = NOVA_AUDIO_LIMITER, .wet = 1, .settings.limiter = {.ceiling_db = 0.01, .release_frames = 1}};
    reject(&f, &production, "insert");
    insert.settings.limiter.ceiling_db = -24.001; reject(&f, &production, "insert"); insert.settings.limiter.ceiling_db = -6;
    insert.settings.limiter.release_frames = 0; reject(&f, &production, "insert"); insert.settings.limiter.release_frames = 1;
    insert.wet = -0.01f; reject(&f, &production, "insert"); insert.wet = 1.01f; reject(&f, &production, "insert");
    insert.wet = 1;
    NovaAudioProductionEvent event = {.parameter = NOVA_AUDIO_LIMITER_CEILING_DB, .value = 0.01, .ramp_frames = 1};
    production.events = &event; production.event_count = 1;
    reject(&f, &production, "automation");
    event.value = -24.01; reject(&f, &production, "automation");
    event.parameter = NOVA_AUDIO_COMPRESSOR_THRESHOLD_DB; event.value = -6; reject(&f, &production, "automation");
    event.parameter = NOVA_AUDIO_BELL_GAIN_DB; reject(&f, &production, "automation");
    event.parameter = NOVA_AUDIO_DELAY_FEEDBACK; event.value = 0.5; reject(&f, &production, "automation");
    production.events = NULL; production.event_count = 0;
    f.buses[1] = (NovaAudioBus){0, 1, 0}; f.base.bus_count = 2;
    NovaAudioSend send = {1, 0, false, 1};
    production.sends = &send; production.send_count = 1;
    send.gain = -0.1f; reject(&f, &production, "send"); send.gain = 2.01f; reject(&f, &production, "send");
    send.gain = 1; send.source = 2; reject(&f, &production, "send");
    send.source = 1; send.destination = 1; reject(&f, &production, "send"); send.destination = 0;
    event = (NovaAudioProductionEvent){.parameter = NOVA_AUDIO_SEND_GAIN, .value = 2.01, .ramp_frames = 1};
    production.events = &event; production.event_count = 1; reject(&f, &production, "automation");
    event.value = 1; event.target = 1; reject(&f, &production, "automation"); event.target = 0;
    f.base.length_frames = 48000 * 61;
    production.tail_frames = 48000 * NOVA_AUDIO_TAIL_SECONDS; production.tail_fade_frames = production.tail_frames;
    event.ramp_frames = 48000 * 60;
    NovaAudioProgram *p = prepare(&f, &production);
    CHECK(nova_audio_program_production_info(p).tail_frames == 48000 * NOVA_AUDIO_TAIL_SECONDS);
    nova_audio_program_release(p); nova_audio_sample_release(f.sample);
}

int main(void)
{
    identity_and_ownership();
    for (unsigned rate = 44100; rate <= 48000; rate += 3900) {
        filters(rate);
        filter_interpolation(rate);
        delay_timing(rate);
        maximum_delay_and_reset(rate);
        room_decay(rate);
        dynamics(rate);
        automated_graph_and_export(rate);
    }
    sends_and_exact_automation();
    tails_reset_cancel_and_transport();
    validation_and_capacity();
    parameter_rejection();
    puts("Nova production DSP: stereo processing, acyclic sends, sample-clock automation, tails and offline/live equivalence passed.");
    return 0;
}
