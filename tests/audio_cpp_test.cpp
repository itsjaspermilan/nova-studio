#include "audio.h"
#include "production.h"
#include "transport.h"
#include "audio_device.h"

#include <array>
#include <cstdint>
#include <cstdio>

int main()
{
    NovaAudioDeviceInfo device{};
    if (device.hardware_latency_known || device.underruns_known) return 1;
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
    NovaAudioProductionDesc production{};
    if (!nova_audio_program_create_production(&desc, &production, &program, error, sizeof(error))) return 1;
    NovaAudioProductionInfo production_info = nova_audio_program_production_info(program);
    ok = ok && !production_info.state_bytes && production_info.renderer_bytes;
    nova_audio_program_release(program);
    NovaAudioTransport *transport = nullptr;
    if (!nova_audio_transport_create(NOVA_AUDIO_DEFAULT_RATE, &transport, error, sizeof(error))) {
        std::fprintf(stderr, "%s\n", error);
        return 1;
    }
    ok = ok && nova_audio_transport_render(transport, output.data(), 16) == NOVA_AUDIO_OK;
    NovaAudioTransportSnapshot snapshot{};
    ok = ok && nova_audio_transport_snapshot(transport, &snapshot) && snapshot.output_frames == 16;
    nova_audio_transport_destroy(transport);
    NovaAudioStream *file = nullptr;
    NovaAudioStreamCommand pause{};
    pause.type = NOVA_STREAM_PAUSE;
    pause.generation = 1;
    std::uint64_t ticket = 0;
    ok = ok && !nova_audio_stream_open("", &file, error, sizeof(error)) && !file && *error;
    ok = ok && nova_audio_stream_command(file, pause, &ticket) == NOVA_AUDIO_CONTROL_INVALID;
    return ok ? 0 : 1;
}
