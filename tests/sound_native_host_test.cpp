#include "sound/native_host.hpp"
#include "audio_device.h"
#include <QtTest>

using namespace nova::sound;

namespace {
int opens = 0, closes = 0, replaces = 0, commands = 0;
NovaAudioTransportRole role = NOVA_AUDIO_GAME;
NovaAudioControlResult closeResult = NOVA_AUDIO_CONTROL_OK;
struct Retirement final : AuditionRetirementOwner {
    quint64 retained = 0;
    void retainAuditionHandle(quint64 handle) override { retained = handle; }
};
}

extern "C" NovaAudioControlResult nova_audio_device_open(NovaAudioTransportRole value, uint32_t,
    NovaAudioTransportHandle *out, char *, size_t)
{
    ++opens; role = value; *out = 41; return NOVA_AUDIO_CONTROL_OK;
}
extern "C" NovaAudioControlResult nova_audio_device_close(NovaAudioTransportHandle)
{
    ++closes; return closeResult;
}
extern "C" NovaAudioControlResult nova_audio_device_replace(NovaAudioTransportHandle, NovaAudioProgram *, uint32_t, uint64_t *ticket)
{
    ++replaces; *ticket = 9; return NOVA_AUDIO_CONTROL_OK;
}
extern "C" NovaAudioControlResult nova_audio_device_command(NovaAudioTransportHandle, NovaAudioControlType type,
    uint64_t, uint32_t, uint64_t *ticket)
{
    ++commands; if (type != NOVA_AUDIO_CANCEL) return NOVA_AUDIO_CONTROL_INVALID;
    *ticket = 10; return NOVA_AUDIO_CONTROL_OK;
}
extern "C" NovaAudioControlResult nova_audio_device_poll(NovaAudioTransportHandle, NovaAudioReceipt *receipt,
    bool *hasReceipt, NovaAudioTransportSnapshot *snapshot, bool *hasSnapshot)
{
    *hasReceipt = *hasSnapshot = true;
    *receipt = {9, 9, NOVA_AUDIO_REPLACE, NOVA_AUDIO_CONTROL_OK};
    *snapshot = {}; snapshot->publication = 1; snapshot->program = 9; snapshot->sample_rate = 48000;
    return NOVA_AUDIO_CONTROL_OK;
}
extern "C" NovaAudioDeviceInfo nova_audio_device_info(void)
{
    NovaAudioDeviceInfo info{};
    info.configuration_known = info.configuration_current = true;
    info.backend_rate = 48000; info.backend_channels = 2;
    info.configured_period_frames = 256; info.configured_period_count = 3;
    info.callback_observed = true; info.callback_frames = 480;
    return info;
}

class SoundNativeHostTest final : public QObject {
    Q_OBJECT
private slots:
    void selectedRoleAndHonestMetrics()
    {
        Retirement retirement;
        NativeAuditionHost host(retirement);
        QCOMPARE(opens, 0);
        QString error; quint64 handle = 0, ticket = 0;
        QCOMPARE(host.open(48000, handle, error), NOVA_AUDIO_CONTROL_OK);
        QCOMPARE(role, NOVA_AUDIO_AUDITION); QCOMPARE(handle, quint64(41));
        QCOMPARE(host.replace(handle, nullptr, 240, ticket), NOVA_AUDIO_CONTROL_OK);
        QCOMPARE(ticket, quint64(9));
        QCOMPARE(host.cancel(handle, ticket, 480, ticket), NOVA_AUDIO_CONTROL_OK);
        QCOMPARE(ticket, quint64(10));
        AuditionPoll poll;
        QCOMPARE(host.poll(handle, poll), NOVA_AUDIO_CONTROL_OK);
        QVERIFY(poll.hasReceipt && poll.hasSnapshot);
        QVERIFY(poll.deviceDetails.contains(QStringLiteral("configured period 256 x 3")));
        QVERIFY(poll.deviceDetails.contains(QStringLiteral("observed callback 480")));
        QVERIFY(poll.deviceDetails.contains(QStringLiteral("Software starvation: not applicable")));
        QVERIFY(poll.deviceDetails.contains(QStringLiteral("xruns and latency: unavailable")));
        closeResult = NOVA_AUDIO_CONTROL_RETIREMENT_PENDING;
        QCOMPARE(host.close(handle), NOVA_AUDIO_CONTROL_RETIREMENT_PENDING);
        host.retainForCloseRetry(handle); QCOMPARE(retirement.retained, handle);
        closeResult = NOVA_AUDIO_CONTROL_OK;
        QCOMPARE(host.close(retirement.retained), NOVA_AUDIO_CONTROL_OK);
        QCOMPARE(opens, 1); QCOMPARE(replaces, 1); QCOMPARE(commands, 1); QCOMPARE(closes, 2);
    }
};

QTEST_GUILESS_MAIN(SoundNativeHostTest)
#include "sound_native_host_test.moc"
