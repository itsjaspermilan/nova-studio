#include "audio_device.h"
#include <raylib.h>

#include <stdio.h>
#include <string.h>

typedef struct {
    NovaAudioTransportHandle handle;
    NovaAudioTransport *transport;
    NovaAudioStream *file;
    AudioStream stream;
    NovaAudioResult fault;
    NovaAudioStreamFault file_fault;
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
    NativeTransport *native = &transports[role];
    float *stereo = output;
    for (unsigned position = 0; position < frames;) {
        unsigned count = frames - position > NOVA_AUDIO_MAX_BLOCK ? NOVA_AUDIO_MAX_BLOCK : frames - position;
        /* Result/fault is published by the transport, never logged on this thread. */
        if (native->file) nova_audio_stream_render(native->file, stereo + (size_t)position * 2, count);
        else nova_audio_transport_render(native->transport, stereo + (size_t)position * 2, count);
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

static void detach(NativeTransport *native)
{
    if (!native->stream.buffer) return;
    StopAudioStream(native->stream);
    SetAudioStreamCallback(native->stream, NULL);
    UnloadAudioStream(native->stream);
    native->stream = (AudioStream){0};
}

static NovaAudioControlResult activate(NovaAudioTransportRole role, uint32_t rate,
    NovaAudioTransport *transport, NovaAudioStream *file, NovaAudioTransportHandle *out,
    char *error, size_t error_size)
{
    if (!nova_audio_device_ensure(error, error_size)) return NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE;
    NovaAudioDeviceInfo info = nova_audio_device_info();
    if (info.mixer_channels != 2 || info.mixer_format != NOVA_DEVICE_FORMAT_F32) {
        if (error && error_size) snprintf(error, error_size, "native streams require the pinned stereo float mixer");
        return NOVA_AUDIO_CONTROL_BACKEND_FAILED;
    }
    AudioStream stream = LoadAudioStream(rate, 32, 2);
    if (!IsAudioStreamValid(stream)) {
        if (error && error_size) snprintf(error, error_size, "native audio stream allocation/converter initialization failed");
        return NOVA_AUDIO_CONTROL_BACKEND_FAILED;
    }
    NativeTransport *native = &transports[role];
    *native = (NativeTransport){.handle = ++next_handle, .transport = transport, .file = file, .stream = stream};
    /* raylib's fixed center-pan law is 11/16 per channel; do not attenuate a
     * stereo score a second time. This is not normalization or a user gain. */
    SetAudioStreamVolume(stream, 16.0f / 11.0f);
    SetAudioStreamCallback(stream, role == NOVA_AUDIO_AUDITION ? audition_render : game_render);
    PlayAudioStream(stream);
    if (!IsAudioStreamPlaying(stream)) {
        detach(native);
        *native = (NativeTransport){0};
        if (error && error_size) snprintf(error, error_size, "native audio stream failed to start");
        return NOVA_AUDIO_CONTROL_BACKEND_FAILED;
    }
    *out = native->handle;
    if (error && error_size) error[0] = '\0';
    return NOVA_AUDIO_CONTROL_OK;
}

NovaAudioControlResult nova_audio_device_open(NovaAudioTransportRole role, uint32_t rate,
    NovaAudioTransportHandle *out, char *error, size_t error_size)
{
    if (!out || role < NOVA_AUDIO_AUDITION || role >= NOVA_AUDIO_TRANSPORTS ||
        (rate != 44100 && rate != 48000) || next_handle == UINT64_MAX) return NOVA_AUDIO_CONTROL_INVALID;
    if (transports[role].handle) return NOVA_AUDIO_CONTROL_BUSY;
    NovaAudioTransport *transport = NULL;
    if (!nova_audio_transport_create(rate, &transport, error, error_size)) return NOVA_AUDIO_CONTROL_ALLOCATION_FAILED;
    NovaAudioControlResult result = activate(role, rate, transport, NULL, out, error, error_size);
    if (result != NOVA_AUDIO_CONTROL_OK) nova_audio_transport_destroy(transport);
    return result;
}

NovaAudioControlResult nova_audio_device_open_file(NovaAudioTransportRole role, const char *path,
    NovaAudioTransportHandle *out, NovaAudioStreamInfo *info, char *error, size_t error_size)
{
    if (!out || !info || !path || role < NOVA_AUDIO_AUDITION || role >= NOVA_AUDIO_TRANSPORTS ||
        next_handle >= UINT64_MAX - 1) return NOVA_AUDIO_CONTROL_INVALID;
    if (transports[role].handle) return NOVA_AUDIO_CONTROL_BUSY;
    NovaAudioStream *file = NULL;
    if (!nova_audio_stream_open(path, &file, error, error_size)) return NOVA_AUDIO_CONTROL_SOURCE_FAILED;
    NovaAudioStreamInfo source = nova_audio_stream_info(file);
    NovaAudioControlResult result = activate(role, source.wav.sample.sample_rate, NULL, file, out, error, error_size);
    if (result != NOVA_AUDIO_CONTROL_OK) {
        char cleanup[256];
        if (!nova_audio_stream_close(&file, cleanup, sizeof(cleanup))) {
            if (error && error_size) snprintf(error, error_size, "native stream open failed; %s", cleanup);
            if (file) {
                transports[role] = (NativeTransport){.handle = ++next_handle, .file = file};
                *out = next_handle;
                return NOVA_AUDIO_CONTROL_RETIREMENT_PENDING;
            }
            return NOVA_AUDIO_CONTROL_SOURCE_FAILED;
        }
    } else *info = source;
    return result;
}

NovaAudioControlResult nova_audio_device_close(NovaAudioTransportHandle handle)
{
    NativeTransport *native = find(handle);
    if (!native) return NOVA_AUDIO_CONTROL_STALE;
    /* Each call waits for the inherited mixer lock. Stop first, then detach:
     * after the detach barrier no callback can still read this transport. */
    detach(native);
    bool closed = true;
    if (native->file) {
        char error[256];
        closed = nova_audio_stream_close(&native->file, error, sizeof(error));
        if (!closed) fprintf(stderr, "Nova audio: %s\n", error);
        if (native->file) return NOVA_AUDIO_CONTROL_RETIREMENT_PENDING;
    }
    nova_audio_transport_destroy(native->transport);
    *native = (NativeTransport){0};
    return closed ? NOVA_AUDIO_CONTROL_OK : NOVA_AUDIO_CONTROL_SOURCE_FAILED;
}

NovaAudioControlResult nova_audio_device_replace(NovaAudioTransportHandle handle,
    NovaAudioProgram *program, uint32_t fade_frames, uint64_t *ticket)
{
    NativeTransport *native = find(handle);
    if (!native) return NOVA_AUDIO_CONTROL_STALE;
    if (!native->transport) return NOVA_AUDIO_CONTROL_INVALID;
    if (!available(nova_audio_device_info())) return NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE;
    return nova_audio_transport_replace(native->transport, program, fade_frames, ticket);
}

NovaAudioControlResult nova_audio_device_command(NovaAudioTransportHandle handle,
    NovaAudioControlType type, uint64_t program, uint32_t fade_frames, uint64_t *ticket)
{
    NativeTransport *native = find(handle);
    if (!native) return NOVA_AUDIO_CONTROL_STALE;
    if (!native->transport) return NOVA_AUDIO_CONTROL_INVALID;
    if (!available(nova_audio_device_info())) return NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE;
    return nova_audio_transport_command(native->transport, type, program, fade_frames, ticket);
}

NovaAudioControlResult nova_audio_device_poll(NovaAudioTransportHandle handle,
    NovaAudioReceipt *receipt, bool *has_receipt, NovaAudioTransportSnapshot *snapshot, bool *has_snapshot)
{
    if (!receipt || !has_receipt || !snapshot || !has_snapshot) return NOVA_AUDIO_CONTROL_INVALID;
    NativeTransport *native = find(handle);
    if (!native) return NOVA_AUDIO_CONTROL_STALE;
    if (!native->transport) return NOVA_AUDIO_CONTROL_INVALID;
    *has_receipt = nova_audio_transport_receipt(native->transport, receipt);
    *has_snapshot = nova_audio_transport_snapshot(native->transport, snapshot);
    if (*has_snapshot) native->fault = snapshot->fault;
    nova_audio_transport_collect(native->transport);
    if (!available(nova_audio_device_info())) return NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE;
    return native->fault == NOVA_AUDIO_OK ? NOVA_AUDIO_CONTROL_OK : NOVA_AUDIO_CONTROL_RENDER_FAILED;
}

NovaAudioControlResult nova_audio_device_file_command(NovaAudioTransportHandle handle,
    NovaAudioStreamCommand command, uint64_t *ticket)
{
    NativeTransport *native = find(handle);
    if (!native) return NOVA_AUDIO_CONTROL_STALE;
    if (!native->file || !native->stream.buffer) return NOVA_AUDIO_CONTROL_INVALID;
    if (!available(nova_audio_device_info())) return NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE;
    return nova_audio_stream_command(native->file, command, ticket);
}

NovaAudioControlResult nova_audio_device_file_poll(NovaAudioTransportHandle handle,
    NovaAudioStreamReceipt *receipt, bool *has_receipt, NovaAudioStreamSnapshot *snapshot, bool *has_snapshot)
{
    if (!receipt || !has_receipt || !snapshot || !has_snapshot) return NOVA_AUDIO_CONTROL_INVALID;
    NativeTransport *native = find(handle);
    if (!native) return NOVA_AUDIO_CONTROL_STALE;
    if (!native->file) return NOVA_AUDIO_CONTROL_INVALID;
    *has_receipt = nova_audio_stream_receipt(native->file, receipt);
    *has_snapshot = nova_audio_stream_snapshot(native->file, snapshot);
    if (*has_snapshot) native->file_fault = snapshot->fault;
    if (!native->stream.buffer) return NOVA_AUDIO_CONTROL_RETIREMENT_PENDING;
    if (!available(nova_audio_device_info())) return NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE;
    return native->file_fault ? NOVA_AUDIO_CONTROL_RENDER_FAILED : NOVA_AUDIO_CONTROL_OK;
}

void nova_audio_device_close_transports(void)
{
    for (unsigned i = 0; i < NOVA_AUDIO_TRANSPORTS; ++i)
        if (transports[i].handle) nova_audio_device_close(transports[i].handle);
}
