#pragma once

#include "audition.hpp"

namespace nova::sound {

class AuditionRetirementOwner {
public:
    virtual ~AuditionRetirementOwner() = default;
    // Must retain ownership and retry native close on the serialized control owner.
    virtual void retainAuditionHandle(quint64 handle) = 0;
};

// Link nova_sound_native + nova_audio_native + exactly one caller-selected
// patched raylib host. Construction never activates hardware.
class NativeAuditionHost final : public AuditionHost {
public:
    explicit NativeAuditionHost(AuditionRetirementOwner &retirement) : retirement_(retirement) {}
    NovaAudioControlResult open(quint32 rate, quint64 &handle, QString &error) override;
    NovaAudioControlResult replace(quint64 handle, NovaAudioProgram *program,
                                  quint32 fadeFrames, quint64 &ticket) override;
    NovaAudioControlResult cancel(quint64 handle, quint64 program, quint32 fadeFrames, quint64 &ticket) override;
    NovaAudioControlResult poll(quint64 handle, AuditionPoll &poll) override;
    NovaAudioControlResult close(quint64 handle) override;
    void retainForCloseRetry(quint64 handle) override;
private:
    AuditionRetirementOwner &retirement_;
};

} // namespace nova::sound
