#pragma once

#include "audio.h"

#include <QByteArray>
#include <QObject>
#include <QString>
#include <QUuid>
#include <array>
#include <deque>
#include <memory>
#include <vector>

namespace nova::sound {

using Id = quint32;
inline constexpr int MaxLayers = 8;
inline constexpr int MaxMedia = 8;
inline constexpr int MaxSeconds = 30;
inline constexpr int MaxMediaSeconds = 60;
inline constexpr qsizetype MaxWavBytes = 16 * 1024 * 1024;
inline constexpr qsizetype MaxMediaBytes = 32 * 1024 * 1024;
inline constexpr qsizetype MaxSourceBytes = 33 * 1024 * 1024;
inline constexpr qsizetype MaxMetadataBytes = 64 * 1024;
inline constexpr qsizetype MaxHistoryBytes = 128 * 1024 * 1024;
inline constexpr int MaxHistoryCommands = 64;

// Factory-owned bytes and decoded samples: never a view into an import buffer.
class WaveData final {
public:
    static std::shared_ptr<const WaveData> fromWav(const QByteArray &bytes, QString &error);
    const QByteArray &wav() const { return wav_; }
    const std::vector<float> &pcm() const { return pcm_; }
    NovaAudioWavInfo info() const { return info_; }
    qsizetype storageBytes() const;
private:
    WaveData(QByteArray bytes, std::vector<float> pcm, NovaAudioWavInfo info);
    const QByteArray wav_;
    const std::vector<float> pcm_;
    const NovaAudioWavInfo info_;
};

struct Media {
    Id id = 0;
    QString name;
    std::shared_ptr<const WaveData> data;
    bool operator==(const Media &other) const;
};

struct Layer {
    Id id = 0;
    QString name = QStringLiteral("Tone");
    NovaAudioSource source = NOVA_AUDIO_SINE;
    bool enabled = true;
    quint32 start = 0;                 // Output frames.
    quint32 duration = 24000;          // Synth only, including release.
    double gain = 0.3, pan = 0;
    double frequency = 440, endFrequency = 440;
    bool sweep = false;
    quint32 seed = 1;
    quint32 attack = 240, decay = 2400, release = 4800;
    double sustain = 0.65, lowpass = 0;
    Id media = 0;
    quint32 begin = 0, end = 0;         // Original source frames, [begin,end).
    quint32 fadeIn = 0, fadeOut = 0;    // Source frames, after reversing.
    bool reverse = false;
    bool operator==(const Layer &other) const;
};

struct State {
    QString uuid;
    QString name = QStringLiteral("Untitled sound");
    quint32 rate = 48000;
    double masterGain = 0.8;
    Id nextId = 1;
    std::vector<Media> media;
    std::vector<Layer> layers;
};

const Media *findMedia(const State &state, Id id);
const Layer *findLayer(const State &state, Id id);
quint32 layerFrames(const State &state, const Layer &layer);
quint32 lengthFrames(const State &state);
bool validate(const State &state, QString &error);
bool sameContent(const State &a, const State &b);
bool encodeSource(const State &state, QByteArray &bytes, QString &error);
bool decodeSource(const QByteArray &bytes, State &state, QString &error);

struct Revision {
    QUuid session;
    QString document;
    quint64 number = 0;
    bool operator==(const Revision &other) const;
    bool operator!=(const Revision &other) const { return !(*this == other); }
};

class Document;
class Snapshot final {
public:
    const Revision revision;
    const std::shared_ptr<const State> state;
private:
    friend class Document;
    Snapshot(Revision revision, std::shared_ptr<const State> state);
};
using SnapshotPtr = std::shared_ptr<const Snapshot>;

class SourceValue final {
public:
    const SnapshotPtr snapshot;
    const QByteArray bytes, sha256;
private:
    friend std::shared_ptr<const SourceValue> sourceValue(SnapshotPtr, QString &);
    SourceValue(SnapshotPtr snapshot, QByteArray bytes);
};
using SourcePtr = std::shared_ptr<const SourceValue>;
SourcePtr sourceValue(SnapshotPtr snapshot, QString &error);

struct ExportSettings {
    NovaAudioWavFormat format = NOVA_AUDIO_WAV_PCM24;
    bool dither = true;
    quint32 seed = 1;
};
class ExportValue;
using ExportPtr = std::shared_ptr<const ExportValue>;
enum class SaveIntent { SourceOnly, PublishDerived };
enum class Preset { Confirm, Pickup, Impact, AirBrake };

// Serialized GUI/control owner. No filesystem, device, timer or auto-save.
class Document final : public QObject {
    Q_OBJECT
public:
    explicit Document(QObject *parent = nullptr);
    std::shared_ptr<const State> state() const { return state_; }
    Revision revision() const;
    SnapshotPtr snapshot() const;
    bool isCurrent(const Snapshot &snapshot) const;
    bool dirty() const;
    bool derivedStale() const;
    bool canUndo() const { return !undo_.empty(); }
    bool canRedo() const { return !redo_.empty(); }
    QString undoText() const;
    QString redoText() const;
    qsizetype historyBytes() const;

    bool create(const QString &name, quint32 rate, QString &error);
    bool load(const QByteArray &source, QString &error);
    bool markPersisted(const SourceValue &source, SaveIntent intent,
                       const ExportValue *derived, QString &error);
    bool setSettings(const QString &name, quint32 rate, double gain, QString &error);
    bool addTone(NovaAudioSource source, QString &error, Id *created = nullptr);
    bool addPreset(Preset preset, QString &error, Id *created = nullptr);
    bool importWav(const QByteArray &bytes, const QString &name, QString &error,
                   Id *createdLayer = nullptr, Id *original = nullptr);
    bool addSample(Id media, QString &error, Id *created = nullptr);
    bool addSampleRegion(Id media, quint32 begin, quint32 end, QString &error, Id *created = nullptr);
    bool setLayer(const Layer &layer, const Revision &expectedRevision, QString &error);
    bool trim(Id layer, quint32 begin, quint32 end, QString &error);
    bool duplicate(Id layer, QString &error, Id *created = nullptr);
    bool removeLayer(Id layer, QString &error);
    bool removeMedia(Id media, QString &error);
    bool undo(QString &error);
    bool redo(QString &error);

signals:
    void changed();
    void persistenceChanged();
    void historyTrimmed(const QString &message);

private:
    struct Command {
        QString label;
        std::shared_ptr<const State> before, after;
    };
    bool commit(State candidate, const QString &label, QString &error);
    void reset(State state, bool saved);
    void trimHistory();
    bool restore(bool redo, QString &error);
    std::shared_ptr<const State> state_, saved_, derived_;
    QUuid session_ = QUuid::createUuid();
    quint64 revision_ = 1;
    Id highWater_ = 1;
    std::deque<Command> undo_, redo_;
};

} // namespace nova::sound
