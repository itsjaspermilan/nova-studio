#ifndef NOVA_AUDIO_DEVICE_H
#define NOVA_AUDIO_DEVICE_H

#include "transport.h"
#include "raylib_audio.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    NOVA_AUDIO_AUDITION,
    NOVA_AUDIO_GAME,
    NOVA_AUDIO_TRANSPORTS
} NovaAudioTransportRole;

typedef uint64_t NovaAudioTransportHandle;

/* All calls belong to the same serialized control thread as legacy raylib
 * audio resources and core program/sample reference mutations. This module has
 * unresolved raylib symbols: link exactly ONE caller-selected patched host.
 * Opening is explicit device activation; normal tests substitute a fake backend. */
bool nova_audio_device_ensure(char *error, size_t error_size);
NovaAudioDeviceInfo nova_audio_device_info(void);
NovaAudioControlResult nova_audio_device_open(NovaAudioTransportRole role, uint32_t rate,
    NovaAudioTransportHandle *out, char *error, size_t error_size);
NovaAudioControlResult nova_audio_device_close(NovaAudioTransportHandle handle);
NovaAudioControlResult nova_audio_device_replace(NovaAudioTransportHandle handle,
    NovaAudioProgram *program, uint32_t fade_frames, uint64_t *ticket);
NovaAudioControlResult nova_audio_device_command(NovaAudioTransportHandle handle,
    NovaAudioControlType type, uint64_t program, uint32_t fade_frames, uint64_t *ticket);
/* Poll drains one receipt, coalesces snapshots and retires renderers even when
 * returning DEVICE_UNAVAILABLE or RENDER_FAILED. A render fault stays latched
 * until the transport is closed/reopened. Close remains allowed on failure. */
NovaAudioControlResult nova_audio_device_poll(NovaAudioTransportHandle handle,
    NovaAudioReceipt *receipt, bool *has_receipt, NovaAudioTransportSnapshot *snapshot, bool *has_snapshot);

/* Quiesces and destroys both new transports, invalidating their handles. Does
 * not close the shared device or free legacy WAV resources. Existing
 * nova_shutdown_audio calls this before CloseAudioDevice; legacy resources must
 * still be unloaded first. The inherited mixer mutex is the detach barrier.
 * No close/shutdown operation may run from a callback. */
void nova_audio_device_close_transports(void);

#ifdef __cplusplus
}
#endif
#endif
