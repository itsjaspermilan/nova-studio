#include "demo_score.h"

#include <math.h>

bool nova_audio_demo_program(uint32_t rate, NovaAudioProgram **out, char *error, size_t error_size)
{
    float percussion[4000];
    for (unsigned i = 0; i < 4000; ++i) {
        double t = (double)i / 32000;
        percussion[i] = (float)(0.6 * sin(6.283185307179586 * (80 * t + 3 * (1 - exp(-35 * t)))) * exp(-30 * t));
    }
    NovaAudioSample *sample = NULL;
    if (!nova_audio_sample_create(percussion, (NovaAudioSampleInfo){32000, 1, 4000},
        &sample, error, error_size)) return false;
    NovaAudioPatch patches[] = {
        {.source = NOVA_AUDIO_SAW, .envelope = {rate / 200, rate / 8, rate / 20, 0.4f}, .lowpass_hz = 1800},
        {.source = NOVA_AUDIO_TRIANGLE, .envelope = {rate / 100, rate / 10, rate / 10, 0.6f}},
        {.source = NOVA_AUDIO_SAMPLER, .envelope = {rate / 1000, 0, rate / 100, 1},
            .sample_end = 4000, .sample_root_hz = 440, .sample_max_ratio = 1},
        {.source = NOVA_AUDIO_NOISE, .envelope = {rate / 2000, rate / 40, rate / 100, 0.05f}, .lowpass_hz = 12000}
    };
    NovaAudioBus buses[] = {{NOVA_AUDIO_NO_BUS, 0.8f, 0}, {0, 0.5f, 0}, {0, 0.5f, 0}};
    const double notes[] = {220, 261.625565, 329.627557, 293.664768, 220, 329.627557, 391.995436, 293.664768};
    NovaAudioEvent events[128];
    size_t count = 0;
    uint32_t id = 0;
    for (unsigned beat = 0; beat < 16; ++beat) {
        uint64_t frame = (uint64_t)beat * rate / 2;
        for (unsigned instrument = 0; instrument < 4; ++instrument) {
            uint64_t start = frame + (instrument == 3 ? rate / 4 : 0);
            uint64_t duration = instrument < 2 ? rate / 3 : rate / 16;
            events[count++] = (NovaAudioEvent){.frame = start, .type = NOVA_AUDIO_NOTE_ON, .target = ++id,
                .note = {.patch = instrument, .bus = instrument < 2 ? 1 : 2,
                    .frequency = instrument == 0 ? notes[(beat / 4) * 2] / 2 :
                        instrument == 1 ? notes[beat % 8] * 2 : instrument == 2 ? 440 : 0,
                    .gain = instrument == 0 ? 0.4f : instrument == 1 ? 0.25f : instrument == 2 ? 0.6f : 0.08f,
                    .pan = instrument == 1 ? 0.25f : instrument == 3 ? -0.25f : 0,
                    .seed = 1234 + beat}};
            events[count++] = (NovaAudioEvent){.frame = start + duration, .type = NOVA_AUDIO_NOTE_OFF, .target = id};
        }
    }
    for (size_t i = 1; i < count; ++i) {
        NovaAudioEvent event = events[i];
        size_t j = i;
        while (j && events[j - 1].frame > event.frame) { events[j] = events[j - 1]; --j; }
        events[j] = event;
    }
    NovaAudioProgramDesc desc = {.sample_rate = rate, .voice_limit = 16, .length_frames = (uint64_t)rate * 8,
        .loop = true, .samples = &sample, .sample_count = 1, .patches = patches, .patch_count = 4,
        .buses = buses, .bus_count = 3, .events = events, .event_count = count};
    bool ok = nova_audio_program_create(&desc, out, error, error_size);
    nova_audio_sample_release(sample);
    return ok;
}
