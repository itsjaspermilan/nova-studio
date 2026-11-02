#include "raylib_audio.h"
#include <stdatomic.h>

_Static_assert(ATOMIC_INT_LOCK_FREE == 2, "Nova audio observations require lock-free unsigned atomics");

static NovaAudioDeviceInfo nova_audio_config = {.inherited_mixer_mutex = true, .notifications_supported = true};
static atomic_uint nova_audio_callbacks, nova_audio_callback_frames, nova_audio_notifications;
static atomic_uint nova_audio_observed, nova_audio_interrupted, nova_audio_configuration_stale;

static void nova_raylib_audio_reset(void)
{
    nova_audio_config = (NovaAudioDeviceInfo){.inherited_mixer_mutex = true, .notifications_supported = true};
    atomic_store_explicit(&nova_audio_callbacks, 0, memory_order_relaxed);
    atomic_store_explicit(&nova_audio_callback_frames, 0, memory_order_relaxed);
    atomic_store_explicit(&nova_audio_observed, 0, memory_order_relaxed);
    atomic_store_explicit(&nova_audio_notifications, 0, memory_order_relaxed);
    atomic_store_explicit(&nova_audio_interrupted, 0, memory_order_relaxed);
    atomic_store_explicit(&nova_audio_configuration_stale, 0, memory_order_relaxed);
}

static NovaAudioDeviceFormat nova_raylib_audio_format(ma_format format)
{
    switch (format) {
    case ma_format_u8: return NOVA_DEVICE_FORMAT_U8;
    case ma_format_s16: return NOVA_DEVICE_FORMAT_S16;
    case ma_format_s24: return NOVA_DEVICE_FORMAT_S24;
    case ma_format_s32: return NOVA_DEVICE_FORMAT_S32;
    case ma_format_f32: return NOVA_DEVICE_FORMAT_F32;
    default: return NOVA_DEVICE_FORMAT_UNKNOWN;
    }
}

static void nova_raylib_audio_configured(void)
{
    const ma_device *device = &AUDIO.System.device;
    nova_audio_config.configuration_known = true;
    nova_audio_config.mixer_rate = device->sampleRate;
    nova_audio_config.mixer_channels = device->playback.channels;
    nova_audio_config.mixer_format = nova_raylib_audio_format(device->playback.format);
    nova_audio_config.backend_rate = device->playback.internalSampleRate;
    nova_audio_config.backend_channels = device->playback.internalChannels;
    nova_audio_config.backend_format = nova_raylib_audio_format(device->playback.internalFormat);
    nova_audio_config.configured_period_frames = device->playback.internalPeriodSizeInFrames;
    nova_audio_config.configured_period_count = device->playback.internalPeriods;
    nova_audio_config.inherited_output_clipping = !device->noClip;
    const char *backend = ma_get_backend_name(AUDIO.System.context.backend);
    size_t i = 0;
    while (backend[i] && i + 1 < sizeof(nova_audio_config.backend)) {
        nova_audio_config.backend[i] = backend[i]; ++i;
    }
    nova_audio_config.backend[i] = '\0';
}

static void nova_raylib_audio_notification(const ma_device_notification *notification)
{
    unsigned flag = 0;
    switch (notification->type) {
    case ma_device_notification_type_started: flag = NOVA_DEVICE_STARTED; break;
    case ma_device_notification_type_stopped: flag = NOVA_DEVICE_STOPPED; break;
    case ma_device_notification_type_rerouted:
        flag = NOVA_DEVICE_REROUTED;
        atomic_store_explicit(&nova_audio_configuration_stale, 1, memory_order_relaxed);
        break;
    case ma_device_notification_type_interruption_began:
        flag = NOVA_DEVICE_INTERRUPTION_BEGAN;
        atomic_store_explicit(&nova_audio_interrupted, 1, memory_order_relaxed);
        break;
    case ma_device_notification_type_interruption_ended:
        flag = NOVA_DEVICE_INTERRUPTION_ENDED;
        atomic_store_explicit(&nova_audio_interrupted, 0, memory_order_relaxed);
        break;
    case ma_device_notification_type_unlocked: flag = NOVA_DEVICE_UNLOCKED; break;
    }
    atomic_fetch_or_explicit(&nova_audio_notifications, flag, memory_order_release);
}

static void nova_raylib_audio_observe(unsigned frames)
{
    atomic_store_explicit(&nova_audio_callback_frames, frames, memory_order_relaxed);
    atomic_fetch_add_explicit(&nova_audio_callbacks, 1, memory_order_release);
    atomic_store_explicit(&nova_audio_observed, 1, memory_order_release);
}

NovaAudioDeviceInfo nova_raylib_audio_info(void)
{
    NovaAudioDeviceInfo info = nova_audio_config;
    info.initialized = AUDIO.System.isReady;
    info.started = info.initialized && ma_device_is_started(&AUDIO.System.device);
    info.callback_count = atomic_load_explicit(&nova_audio_callbacks, memory_order_acquire);
    info.callback_frames = atomic_load_explicit(&nova_audio_callback_frames, memory_order_relaxed);
    info.callback_observed = atomic_load_explicit(&nova_audio_observed, memory_order_acquire) != 0;
    info.notifications = atomic_load_explicit(&nova_audio_notifications, memory_order_acquire);
    info.interrupted = atomic_load_explicit(&nova_audio_interrupted, memory_order_relaxed) != 0;
    info.configuration_current = info.initialized && info.configuration_known &&
        !atomic_load_explicit(&nova_audio_configuration_stale, memory_order_relaxed);
    return info;
}
