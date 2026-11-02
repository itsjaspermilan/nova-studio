#include "native_host.hpp"
#include "audio_device.h"

namespace nova::sound {

NovaAudioControlResult NativeAuditionHost::open(quint32 rate, quint64 &handle, QString &error)
{
    NovaAudioTransportHandle candidate = 0;
    char diagnostic[512]{};
    const auto result = nova_audio_device_open(NOVA_AUDIO_AUDITION, rate, &candidate, diagnostic, sizeof(diagnostic));
    if (candidate) handle = candidate;
    error = QString::fromUtf8(diagnostic);
    return result;
}

NovaAudioControlResult NativeAuditionHost::replace(quint64 handle, NovaAudioProgram *program,
                                                  quint32 fadeFrames, quint64 &ticket)
{
    uint64_t candidate = 0;
    const auto result = nova_audio_device_replace(handle, program, fadeFrames, &candidate);
    if (result == NOVA_AUDIO_CONTROL_OK) ticket = candidate;
    return result;
}

NovaAudioControlResult NativeAuditionHost::cancel(quint64 handle, quint64 program,
                                                 quint32 fadeFrames, quint64 &ticket)
{
    uint64_t candidate = 0;
    const auto result = nova_audio_device_command(handle, NOVA_AUDIO_CANCEL, program, fadeFrames, &candidate);
    if (result == NOVA_AUDIO_CONTROL_OK) ticket = candidate;
    return result;
}

NovaAudioControlResult NativeAuditionHost::poll(quint64 handle, AuditionPoll &poll)
{
    const auto result = nova_audio_device_poll(handle, &poll.receipt, &poll.hasReceipt, &poll.snapshot, &poll.hasSnapshot);
    const auto info = nova_audio_device_info();
    const QString configuration = info.configuration_known
        ? QStringLiteral("%1 Hz / %2 ch; configured period %3 x %4 frames%5")
            .arg(info.backend_rate).arg(info.backend_channels).arg(info.configured_period_frames)
            .arg(info.configured_period_count).arg(info.configuration_current ? QString() : QStringLiteral(" (configuration changed)"))
        : QStringLiteral("Device configuration unavailable");
    const QString observed = info.callback_observed
        ? QStringLiteral("observed callback %1 frames").arg(info.callback_frames)
        : QStringLiteral("callback not yet observed");
    poll.deviceDetails = configuration + QStringLiteral("; ") + observed +
        QStringLiteral(". Software starvation: not applicable to prepared scores. Hardware xruns and latency: unavailable.");
    return result;
}

NovaAudioControlResult NativeAuditionHost::close(quint64 handle) { return nova_audio_device_close(handle); }
void NativeAuditionHost::retainForCloseRetry(quint64 handle) { retirement_.retainAuditionHandle(handle); }

} // namespace nova::sound
