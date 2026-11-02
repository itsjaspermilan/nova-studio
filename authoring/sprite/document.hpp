#pragma once

#include <QByteArray>
#include <QColor>
#include <QImage>
#include <QObject>
#include <QPoint>
#include <QRect>
#include <QString>
#include <QUndoStack>
#include <QVector>
#include <functional>
#include <optional>

namespace nova::sprite {

using Id = quint32;
inline constexpr int MaxDimension = 2048;
inline constexpr int MaxLayers = 16;
inline constexpr int MaxFrames = 32;
inline constexpr int MaxPalettes = 8;
inline constexpr int MaxColors = 64;
inline constexpr int MaxAnimations = 32;
inline constexpr qint64 MaxCelPixels = 16 * 1024 * 1024;
inline constexpr qint64 MaxSourceBytes = 65 * 1024 * 1024;
inline constexpr qint64 MaxPngBytes = 16 * 1024 * 1024;
inline constexpr qint64 MaxExportPngBytes = 65 * 1024 * 1024;
inline constexpr qint64 MaxExportMetadataBytes = 64 * 1024;
inline constexpr qint64 MaxHistoryBytes = 128 * 1024 * 1024;

enum class RasterMode { Pixel, Smooth };

struct Layer {
    Id id = 0;
    QString name;
    bool visible = true;
    bool locked = false;
    int opacity = 255;
    bool operator==(const Layer &other) const;
};

struct Frame {
    Id id = 0;
    int durationMs = 125;
    QVector<QImage> cels;
    bool operator==(const Frame &other) const;
};

struct Palette {
    Id id = 0;
    QString name;
    QVector<QColor> colors;
    bool operator==(const Palette &other) const;
};

struct Animation {
    Id id = 0;
    QString name;
    QVector<Id> frames;
    bool loop = true;
    bool operator==(const Animation &other) const;
};

struct State {
    QString uuid;
    QString name;
    QSize size;
    RasterMode mode = RasterMode::Pixel;
    QVector<Layer> layers; // Bottom to top; every frame has a cel for every layer.
    QVector<Frame> frames;
    QVector<Palette> palettes;
    QVector<Animation> animations;
    QPoint pivot;
    std::optional<QRect> collision;
    Id nextId = 1;
    bool operator==(const State &other) const;
};

struct ExportFrame {
    Id id;
    QString fileName; // A leaf name, not a destination path.
    QByteArray png;
};

struct ExportBundle {
    quint64 revision = 0;
    QSize frameSize;
    qint64 compositePixels = 0;
    qint64 pngBytes = 0;
    QByteArray source;
    QByteArray metadata;
    QVector<ExportFrame> frames;
};

bool validate(const State &state, QString &error);
bool decodePng(const QByteArray &bytes, QImage &image, QString &error);
bool encodePng(const QImage &image, QByteArray &bytes, QString &error);
QImage composite(const State &state, Id frameId);
QVector<Id> playbackFrames(const State &state, Id animationId);
Id frameAtTime(const State &state, Id animationId, qint64 elapsedMs, bool *finished = nullptr);

class SnapshotCommand;

// Single GUI-thread owner. No path access, file writes, runtime mutation or autosaving.
class Document final : public QObject {
    Q_OBJECT
public:
    explicit Document(QObject *parent = nullptr);
    const State &state() const { return state_; }
    QUndoStack *undoStack() { return &undo_; }
    quint64 revision() const { return revision_; }
    bool isDirty() const;
    bool gestureActive() const { return gestureBefore_.has_value(); }
    qint64 historyBytes() const { return historyBytes_; }

    bool create(QSize size, const QString &name, RasterMode mode, QString &error);
    bool load(const QByteArray &bytes, QString &error);
    bool serialize(QByteArray &bytes, QString &error) const;
    bool exportBundle(ExportBundle &bundle, QString &error) const;
    bool markSaved(quint64 persistedRevision);

    int layerIndex(Id id) const;
    int frameIndex(Id id) const;
    const QImage &cel(Id frameId, Id layerId) const;
    bool canPaint(Id frameId, Id layerId, QString &error) const;

    bool addLayer(const QString &name, QString &error, Id *createdId = nullptr);
    bool setLayer(const Layer &layer, QString &error);
    bool moveLayer(Id id, int index, QString &error);
    bool removeLayer(Id id, QString &error);
    bool addFrame(Id after, bool duplicate, QString &error, Id *createdId = nullptr);
    bool moveFrame(Id id, int index, QString &error);
    bool removeFrame(Id id, QString &error);
    bool setDuration(Id id, int durationMs, QString &error);
    bool setMetadata(const QString &name, RasterMode mode, QPoint pivot,
                     std::optional<QRect> collision, QString &error);
    bool setPalette(Palette palette, QString &error, Id *createdId = nullptr);
    bool removePalette(Id id, QString &error);
    bool setAnimation(Animation animation, QString &error, Id *createdId = nullptr);
    bool removeAnimation(Id id, QString &error);

    bool resizeCanvas(QSize size, QPoint artworkOffset, QString &error);
    bool scaleArtwork(QSize size, QString &error);
    bool setCel(Id frameId, Id layerId, const QImage &image, const QString &label, QString &error);
    bool clearPixels(Id frameId, Id layerId, QRect selection, QString &error);
    bool pastePixels(Id frameId, Id layerId, const QImage &image, QPoint position, QString &error);
    bool transformPixels(Id frameId, Id layerId, QRect source, QRect destination,
                         int quarterTurns, bool flipX, bool flipY, QString &error);

    bool beginGesture(const QString &label, QString &error);
    bool endGesture(QString &error);
    void cancelGesture();

signals:
    void changed();
    void pixelsChanged(nova::sprite::Id frameId, nova::sprite::Id layerId);
    void dirtyChanged(bool dirty);
    void historyTrimmed(const QString &reason);

private:
    friend class SnapshotCommand;
    bool edit(const QString &label, const std::function<bool(State &, QString &)> &operation, QString &error);
    void commit(const State &before, const State &after, const QString &label);
    void applyHistory(const State &state);
    void reset(State state, bool saved);
    State state_;
    Id idHighWater_ = 1;
    quint64 revision_ = 0;
    std::optional<State> gestureBefore_;
    QString gestureLabel_;
    qint64 historyBytes_ = 0;
    QUndoStack undo_;
};

} // namespace nova::sprite
