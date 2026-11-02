#ifndef NOVA_RAYLIB_AUDIO_H
#define NOVA_RAYLIB_AUDIO_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
    NOVA_DEVICE_STARTED = 1u << 0,
    NOVA_DEVICE_STOPPED = 1u << 1,
    NOVA_DEVICE_REROUTED = 1u << 2,
    NOVA_DEVICE_INTERRUPTION_BEGAN = 1u << 3,
    NOVA_DEVICE_INTERRUPTION_ENDED = 1u << 4,
    NOVA_DEVICE_UNLOCKED = 1u << 5
};

typedef enum {
    NOVA_DEVICE_FORMAT_UNKNOWN,
    NOVA_DEVICE_FORMAT_U8,
    NOVA_DEVICE_FORMAT_S16,
    NOVA_DEVICE_FORMAT_S24,
    NOVA_DEVICE_FORMAT_S32,
    NOVA_DEVICE_FORMAT_F32
} NovaAudioDeviceFormat;

typedef struct {
    bool initialized, started, interrupted;
    bool configuration_known, configuration_current;
    bool callback_observed, notifications_supported;
    bool underruns_known, hardware_latency_known;
    bool inherited_mixer_mutex, inherited_output_clipping;
    char backend[32];
    uint32_t mixer_rate, mixer_channels;
    NovaAudioDeviceFormat mixer_format;
    uint32_t backend_rate, backend_channels;
    NovaAudioDeviceFormat backend_format;
    uint32_t configured_period_frames, configured_period_count;
    uint32_t callback_frames, callback_count; /* Observation count wraps modulo 2^32. */
    uint32_t notifications;                 /* Sticky received events, not all backend events. */
} NovaAudioDeviceInfo;

/* Control thread only, serialized with init/close. Config fields are captured at
 * initialization, not read racily from a rerouting backend. Callback size/count
 * and notification flags are separate atomic observations, not a paired timing
 * sample. configuration_current means no reroute has been reported since init;
 * backend notifications are not comprehensive loss/reroute detection.
 * Unknown metrics remain unknown.
 * Supplied by the checked pinned-source hook, not a second miniaudio instance. */
NovaAudioDeviceInfo nova_raylib_audio_info(void);

#ifdef __cplusplus
}
#endif
#endif
