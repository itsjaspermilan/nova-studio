#include "audio_device.h"
#include <raylib.h>

#include <stdio.h>
#include <string.h>

typedef struct {
    NovaAudioTransportHandle handle;
    NovaAudioTransport *transport;
    AudioStream stream;
    NovaAudioResult fault;
} NativeTransport;

static NativeTransport transports[NOVA_AUDIO_TRANSPORTS];
static uint64_t next_handle;

static bool available(NovaAudioDeviceInfo info)
{
    return info.initialized && info.started && !info.interrupted && info.configuration_current;
}

NovaAudioDeviceInfo nova_audio_device_info(void) { return nova_raylib_audio_info(); }

bool nova_audio_device_ensure(char *error, size_t error_size)
{
    if (!IsAudioDeviceReady()) InitAudioDevice();
    NovaAudioDeviceInfo info = nova_audio_device_info();
    bool ok = available(info);
    if (error && error_size) snprintf(error, error_size, "%s", ok ? "" :
        "native audio device failed to start, was interrupted/stopped, or requires reopen after reroute");
    return ok;
}

static void stream_render(NovaAudioTransportRole role, void *output, unsigned frames)
{
    NovaAudioTransport *t = transports[role].transport;
    float *stereo = output;
    for (unsigned position = 0; position < frames;) {
        unsigned count = frames - position > NOVA_AUDIO_MAX_BLOCK ? NOVA_AUDIO_MAX_BLOCK : frames - position;
        /* Result/fault is published by the transport, never logged on this thread. */
        nova_audio_transport_render(t, stereo + (size_t)position * 2, count);
        position += count;
    }
}

static void audition_render(void *output, unsigned frames) { stream_render(NOVA_AUDIO_AUDITION, output, frames); }
static void game_render(void *output, unsigned frames) { stream_render(NOVA_AUDIO_GAME, output, frames); }

static NativeTransport *find(NovaAudioTransportHandle handle)
{
    if (!handle) return NULL;
    for (unsigned i = 0; i < NOVA_AUDIO_TRANSPORTS; ++i)
        if (transports[i].handle == handle) return &transports[i];
    return NULL;
}

NovaAudioControlResult nova_audio_device_open(NovaAudioTransportRole role, uint32_t rate,
    NovaAudioTransportHandle *out, char *error, size_t error_size)
{
    if (!out || role < NOVA_AUDIO_AUDITION || role >= NOVA_AUDIO_TRANSPORTS ||
        (rate != 44100 && rate != 48000) || next_handle == UINT64_MAX) return NOVA_AUDIO_CONTROL_INVALID;
    NativeTransport *native = &transports[role];
    if (native->handle) return NOVA_AUDIO_CONTROL_BUSY;
    NovaAudioTransport *transport = NULL;
    if (!nova_audio_transport_create(rate, &transport, error, error_size)) return NOVA_AUDIO_CONTROL_ALLOCATION_FAILED;
    if (!nova_audio_device_ensure(error, error_size)) {
        nova_audio_transport_destroy(transport);
        return NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE;
    }
    NovaAudioDeviceInfo info = nova_audio_device_info();
    if (info.mixer_channels != 2 || info.mixer_format != NOVA_DEVICE_FORMAT_F32) {
        nova_audio_transport_destroy(transport);
        if (error && error_size) snprintf(error, error_size, "native score streams require the pinned stereo float mixer");
        return NOVA_AUDIO_CONTROL_BACKEND_FAILED;
    }
    AudioStream stream = LoadAudioStream(rate, 32, 2);
    if (!IsAudioStreamValid(stream)) {
        nova_audio_transport_destroy(transport);
        if (error && error_size) snprintf(error, error_size, "native audio stream allocation/converter initialization failed");
        return NOVA_AUDIO_CONTROL_BACKEND_FAILED;
    }
    *native = (NativeTransport){.handle = ++next_handle, .transport = transport, .stream = stream};
    /* raylib's fixed center-pan law is 11/16 per channel; do not attenuate a
     * stereo score a second time. This is not normalization or a user gain. */
    SetAudioStreamVolume(stream, 16.0f / 11.0f);
    SetAudioStreamCallback(stream, role == NOVA_AUDIO_AUDITION ? audition_render : game_render);
    PlayAudioStream(stream);
    if (!IsAudioStreamPlaying(stream)) {
        nova_audio_device_close(native->handle);
        if (error && error_size) snprintf(error, error_size, "native audio stream failed to start");
        return NOVA_AUDIO_CONTROL_BACKEND_FAILED;
    }
    *out = native->handle;
    if (error && error_size) error[0] = '\0';
    return NOVA_AUDIO_CONTROL_OK;
}

NovaAudioControlResult nova_audio_device_close(NovaAudioTransportHandle handle)
{
    NativeTransport *native = find(handle);
    if (!native) return NOVA_AUDIO_CONTROL_STALE;
    /* Each call waits for the inherited mixer lock. Stop first, then detach:
     * after the detach barrier no callback can still read this transport. */
    StopAudioStream(native->stream);
    SetAudioStreamCallback(native->stream, NULL);
    UnloadAudioStream(native->stream);
    nova_audio_transport_destroy(native->transport);
    *native = (NativeTransport){0};
    return NOVA_AUDIO_CONTROL_OK;
}

NovaAudioControlResult nova_audio_device_replace(NovaAudioTransportHandle handle,
    NovaAudioProgram *program, uint32_t fade_frames, uint64_t *ticket)
{
    NativeTransport *native = find(handle);
    if (!native) return NOVA_AUDIO_CONTROL_STALE;
    if (!available(nova_audio_device_info())) return NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE;
    return nova_audio_transport_replace(native->transport, program, fade_frames, ticket);
}

NovaAudioControlResult nova_audio_device_command(NovaAudioTransportHandle handle,
    NovaAudioControlType type, uint64_t program, uint32_t fade_frames, uint64_t *ticket)
{
    NativeTransport *native = find(handle);
    if (!native) return NOVA_AUDIO_CONTROL_STALE;
    if (!available(nova_audio_device_info())) return NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE;
    return nova_audio_transport_command(native->transport, type, program, fade_frames, ticket);
}

NovaAudioControlResult nova_audio_device_poll(NovaAudioTransportHandle handle,
    NovaAudioReceipt *receipt, bool *has_receipt, NovaAudioTransportSnapshot *snapshot, bool *has_snapshot)
{
    if (!receipt || !has_receipt || !snapshot || !has_snapshot) return NOVA_AUDIO_CONTROL_INVALID;
    NativeTransport *native = find(handle);
    if (!native) return NOVA_AUDIO_CONTROL_STALE;
    *has_receipt = nova_audio_transport_receipt(native->transport, receipt);
    *has_snapshot = nova_audio_transport_snapshot(native->transport, snapshot);
    if (*has_snapshot) native->fault = snapshot->fault;
    nova_audio_transport_collect(native->transport);
    if (!available(nova_audio_device_info())) return NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE;
    return native->fault == NOVA_AUDIO_OK ? NOVA_AUDIO_CONTROL_OK : NOVA_AUDIO_CONTROL_RENDER_FAILED;
}

void nova_audio_device_close_transports(void)
{
    for (unsigned i = 0; i < NOVA_AUDIO_TRANSPORTS; ++i)
        if (transports[i].handle) nova_audio_device_close(transports[i].handle);
}
