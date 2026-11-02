#include "audio.h"

#include <array>
#include <cstdio>

int main()
{
    NovaAudioBus master{NOVA_AUDIO_NO_BUS, 1, 0};
    NovaAudioProgramDesc desc{};
    desc.sample_rate = NOVA_AUDIO_DEFAULT_RATE;
    desc.voice_limit = 1;
    desc.length_frames = 16;
    desc.buses = &master;
    desc.bus_count = 1;
    NovaAudioProgram *program = nullptr;
    NovaAudioRenderer *renderer = nullptr;
    char error[512]{};
    if (!nova_audio_program_create(&desc, &program, error, sizeof(error))) {
        std::fprintf(stderr, "%s\n", error);
        return 1;
    }
    bool ready = nova_audio_renderer_create(program, &renderer, error, sizeof(error));
    nova_audio_program_release(program);
    if (!ready) {
        std::fprintf(stderr, "%s\n", error);
        return 1;
    }
    std::array<float, 32> output{};
    bool ok = nova_audio_render(renderer, output.data(), 16) == NOVA_AUDIO_OK &&
        nova_audio_status(renderer).finished;
    nova_audio_renderer_destroy(renderer);
    return ok ? 0 : 1;
}
