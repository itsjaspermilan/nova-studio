#pragma once

#include "render.hpp"
#include "transport.h"
#include <QTimer>

namespace nova::sound {

struct AuditionPoll {
    bool hasReceipt = false, hasSnapshot = false;
    NovaAudioReceipt receipt{};
    NovaAudioTransportSnapshot snapshot{};
    QString deviceDetails;
};

// Host and controller share one serialized control owner. No method is a callback.
// The host outlives the controller and owns any handle explicitly handed back.
class AuditionHost {
public:
    virtual ~AuditionHost() = default;
    virtual NovaAudioControlResult open(quint32 rate, quint64 &handle, QString &error) = 0;
    virtual NovaAudioControlResult replace(quint64 handle, NovaAudioProgram *program,
                                           quint32 fadeFrames, quint64 &ticket) = 0;
    virtual NovaAudioControlResult cancel(quint64 handle, quint64 program,
                                          quint32 fadeFrames, quint64 &ticket) = 0;
    virtual NovaAudioControlResult poll(quint64 handle, AuditionPoll &poll) = 0;
    virtual NovaAudioControlResult close(quint64 handle) = 0;
    virtual void retainForCloseRetry(quint64 handle) = 0;
};

enum class AuditionState { Stopped, Preparing, Queued, Playing, Stopping, Finished, Failed, RetirementPending };

class Audition final : public QObject {
    Q_OBJECT
public:
    Audition(Document &document, AuditionHost &host, QObject *parent = nullptr);
    ~Audition() override;
    bool play(QString &error);
    bool stop(QString &error);
    bool shutdown(QString &error);
    void poll();
    AuditionState state() const { return state_; }
    QString text() const;
    QString deviceDetails() const { return deviceDetails_; }
    bool preparing() const { return prepare_.busy(); }
    bool ownsHandle() const { return handle_ != 0; }
    quint64 handle() const { return handle_; }
    bool stale() const;
    const NovaAudioTransportSnapshot &meters() const { return meters_; }
signals:
    void changed();
    void problem(const QString &message);
private:
    void prepared();
    void report(const QString &message);
    bool closeOwned(QString &error);
    bool enqueueStop(QString &error);
    void receipt(const NovaAudioReceipt &receipt);
    Document &document_;
    AuditionHost &host_;
    RenderJob prepare_;
    QTimer timer_;
    AuditionState state_ = AuditionState::Stopped;
    quint64 handle_ = 0, program_ = 0, replacement_ = 0, cancellation_ = 0;
    quint32 rate_ = 0;
    bool stopAfterReplace_ = false, cancelledPreparation_ = false;
    SnapshotPtr active_, pending_;
    NovaAudioTransportSnapshot meters_{};
    QString detail_, deviceDetails_;
};

} // namespace nova::sound
