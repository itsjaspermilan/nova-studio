#pragma once

#include "sound/audition.hpp"
#include <cmath>
#include <cstring>
#include <functional>

namespace sound_test {

inline void u16(QByteArray &bytes, quint32 value)
{
    bytes.append(char(value & 255)); bytes.append(char((value >> 8) & 255));
}
inline void u32(QByteArray &bytes, quint32 value)
{
    for (int shift = 0; shift < 32; shift += 8) bytes.append(char((value >> shift) & 255));
}

inline QByteArray wav(quint32 frames = 4800, quint32 rate = 48000, quint32 channels = 2,
                      quint32 bits = 32, std::function<float(quint32, quint32)> sample = {})
{
    const bool floating = bits == 32;
    const quint32 dataSize = frames * channels * (bits / 8);
    const quint32 header = floating ? 56 : 44;
    QByteArray bytes;
    bytes.reserve(header + dataSize + (dataSize & 1));
    bytes.append("RIFF", 4); u32(bytes, header - 8 + dataSize + (dataSize & 1));
    bytes.append("WAVEfmt ", 8); u32(bytes, 16); u16(bytes, floating ? 3 : 1);
    u16(bytes, channels); u32(bytes, rate); u32(bytes, rate * channels * (bits / 8));
    u16(bytes, channels * (bits / 8)); u16(bytes, bits);
    if (floating) { bytes.append("fact", 4); u32(bytes, 4); u32(bytes, frames); }
    bytes.append("data", 4); u32(bytes, dataSize);
    for (quint32 frame = 0; frame < frames; ++frame) {
        for (quint32 channel = 0; channel < channels; ++channel) {
            const float value = sample ? sample(frame, channel) :
                float(.4 * std::sin(6.283185307179586 * (channel ? 617 : 311) * frame / rate));
            if (floating) {
                quint32 encoded = 0; std::memcpy(&encoded, &value, sizeof(value)); u32(bytes, encoded);
            } else if (bits == 8) bytes.append(char(std::llround(value * 127 + 128)));
            else {
                const qint32 encoded = qint32(std::llround(value * (bits == 16 ? 32767 : 8388607)));
                for (quint32 byte = 0; byte < bits / 8; ++byte) bytes.append(char((quint32(encoded) >> (byte * 8)) & 255));
            }
        }
    }
    if (dataSize & 1) bytes.append('\0');
    return bytes;
}

class FakeHost final : public nova::sound::AuditionHost {
public:
    int opens = 0, replacements = 0, cancels = 0, polls = 0, closes = 0;
    quint64 handle = 0, nextHandle = 1, adopted = 0;
    quint32 rate = 0;
    NovaAudioTransport *transport = nullptr;
    NovaAudioControlResult openResult = NOVA_AUDIO_CONTROL_OK;
    NovaAudioControlResult replaceResult = NOVA_AUDIO_CONTROL_OK;
    NovaAudioControlResult cancelResult = NOVA_AUDIO_CONTROL_OK;
    NovaAudioControlResult pollResult = NOVA_AUDIO_CONTROL_OK;
    NovaAudioControlResult closeResult = NOVA_AUDIO_CONTROL_OK;
    bool failedOpenOwnsHandle = false;
    bool suppressReceipts = false;
    std::vector<float> rendered;

    ~FakeHost() override { nova_audio_transport_destroy(transport); }
    NovaAudioControlResult open(quint32 value, quint64 &out, QString &error) override
    {
        ++opens;
        if (openResult != NOVA_AUDIO_CONTROL_OK) {
            if (failedOpenOwnsHandle) out = handle = nextHandle++;
            error = QStringLiteral("Injected unavailable device / retirement.");
            return openResult;
        }
        char diagnostic[512]{};
        if (!nova_audio_transport_create(value, &transport, diagnostic, sizeof(diagnostic))) {
            error = QString::fromUtf8(diagnostic); return NOVA_AUDIO_CONTROL_ALLOCATION_FAILED;
        }
        rate = value; out = handle = nextHandle++; error.clear();
        return NOVA_AUDIO_CONTROL_OK;
    }
    NovaAudioControlResult replace(quint64 h, NovaAudioProgram *program, quint32 fade, quint64 &ticket) override
    {
        ++replacements;
        if (h != handle || !transport) return NOVA_AUDIO_CONTROL_STALE;
        if (replaceResult != NOVA_AUDIO_CONTROL_OK) return replaceResult;
        uint64_t value = 0;
        const auto result = nova_audio_transport_replace(transport, program, fade, &value);
        if (result == NOVA_AUDIO_CONTROL_OK) ticket = value;
        return result;
    }
    NovaAudioControlResult cancel(quint64 h, quint64 program, quint32 fade, quint64 &ticket) override
    {
        ++cancels;
        if (h != handle || !transport) return NOVA_AUDIO_CONTROL_STALE;
        if (cancelResult != NOVA_AUDIO_CONTROL_OK) return cancelResult;
        uint64_t value = 0;
        const auto result = nova_audio_transport_command(transport, NOVA_AUDIO_CANCEL, program, fade, &value);
        if (result == NOVA_AUDIO_CONTROL_OK) ticket = value;
        return result;
    }
    NovaAudioControlResult poll(quint64 h, nova::sound::AuditionPoll &value) override
    {
        ++polls;
        if (h != handle || !transport) return NOVA_AUDIO_CONTROL_STALE;
        value.hasReceipt = !suppressReceipts && nova_audio_transport_receipt(transport, &value.receipt);
        value.hasSnapshot = nova_audio_transport_snapshot(transport, &value.snapshot);
        nova_audio_transport_collect(transport);
        value.deviceDetails = QStringLiteral("Fake prepared-score host. Software starvation: not applicable. Hardware xruns: unavailable.");
        return pollResult;
    }
    NovaAudioControlResult close(quint64 h) override
    {
        ++closes;
        if (h != handle) return NOVA_AUDIO_CONTROL_STALE;
        if (closeResult == NOVA_AUDIO_CONTROL_RETIREMENT_PENDING) return closeResult;
        nova_audio_transport_destroy(transport); transport = nullptr; handle = 0;
        return closeResult;
    }
    void retainForCloseRetry(quint64 h) override { adopted = h; }
    bool tick(size_t count = 512)
    {
        if (!transport) return false;
        std::vector<float> output(count * 2);
        if (nova_audio_transport_render(transport, output.data(), count) != NOVA_AUDIO_OK) return false;
        rendered.insert(rendered.end(), output.begin(), output.end());
        return true;
    }
};

} // namespace sound_test
