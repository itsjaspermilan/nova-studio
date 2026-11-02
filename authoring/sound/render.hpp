#pragma once

#include "document.hpp"
#include <QObject>
#include <atomic>

class QThread;

namespace nova::sound {

struct ProgramDeleter {
    void operator()(NovaAudioProgram *program) const { nova_audio_program_release(program); }
};
using ProgramPtr = std::unique_ptr<NovaAudioProgram, ProgramDeleter>;

// Each call creates independent native objects. Never share them between workers.
bool compile(const State &state, ProgramPtr &program, QString &error,
             const std::atomic_bool *cancel = nullptr);

class ExportValue final {
public:
    const SourcePtr source;
    const QByteArray wav, metadata;
    const ExportSettings settings;
    const quint32 rate, frames;
    const std::array<float, 2> peak;
    const quint64 overFrames;
    const std::shared_ptr<const WaveData> waveform;
private:
    friend ExportPtr render(SnapshotPtr, ExportSettings, QString &, const std::atomic_bool *);
    ExportValue(SourcePtr source, QByteArray wav, QByteArray metadata, ExportSettings settings,
                NovaAudioExportResult result, std::shared_ptr<const WaveData> waveform);
};

// Device-free, checked-sink render. Outputs remain private until fully successful.
ExportPtr render(SnapshotPtr snapshot, ExportSettings settings, QString &error,
                 const std::atomic_bool *cancel = nullptr);

class RenderJob final : public QObject {
    Q_OBJECT
public:
    enum class Kind { Export, PrepareAudition };
    enum class Status { Succeeded, Cancelled, Failed };
    struct Result {
        Status status = Status::Failed;
        QString error;
        SnapshotPtr snapshot;
        ExportPtr output;
        ProgramPtr program;
    };

    explicit RenderJob(QObject *parent = nullptr);
    ~RenderJob() override;
    bool start(SnapshotPtr snapshot, Kind kind, ExportSettings settings, QString &error);
    void cancel();
    bool busy() const { return thread_ != nullptr; }
    Result takeResult();
signals:
    void finished();
private:
    struct Work;
    std::shared_ptr<Work> work_;
    QThread *thread_ = nullptr;
    Result result_;
};

} // namespace nova::sound

Q_DECLARE_METATYPE(nova::sound::ExportPtr)
