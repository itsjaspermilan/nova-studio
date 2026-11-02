#include "document.hpp"
#include "codec.hpp"

#include <QBuffer>
#include <QCryptographicHash>
#include <QImageReader>
#include <QImageWriter>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QPainter>
#include <QRegularExpression>
#include <QSet>
#include <QUuid>
#include <algorithm>
#include <cmath>
#include <limits>

namespace nova::sprite {
namespace {

bool fail(QString &error, const QString &message)
{
    error = message;
    return false;
}

bool validName(const QString &name)
{
    if (name.isEmpty() || name.trimmed() != name || name.toUtf8().size() > 96 ||
        QString::fromUtf8(name.toUtf8()) != name)
        return false;
    for (QChar c : name) {
        if (c.category() == QChar::Other_Control || c.category() == QChar::Other_Format)
            return false;
    }
    return true;
}

template<typename T>
int indexOf(const QVector<T> &values, Id id)
{
    for (int i = 0; i < values.size(); ++i)
        if (values[i].id == id) return i;
    return -1;
}

bool dimensions(QSize size, int layers, int frames, QString &error)
{
    if (size.width() < 1 || size.height() < 1 ||
        size.width() > MaxDimension || size.height() > MaxDimension)
        return fail(error, QStringLiteral("Canvas dimensions must be 1..2048 pixels."));
    if (layers < 1 || layers > MaxLayers || frames < 1 || frames > MaxFrames ||
        qint64(size.width()) * size.height() * layers * frames > MaxCelPixels)
        return fail(error, QStringLiteral("Sprite limit: 16 layers, 32 frames and 16,777,216 total cel pixels (64 MiB)."));
    return true;
}

QImage blank(QSize size)
{
    QImage image(size, QImage::Format_ARGB32);
    image.fill(Qt::transparent);
    return image;
}

bool supportedRaster(const QImage &image, QString &error)
{
    const QPixelFormat format = image.pixelFormat();
    if (format.redSize() > 8 || format.greenSize() > 8 || format.blueSize() > 8 || format.alphaSize() > 8 ||
        format.typeInterpretation() == QPixelFormat::FloatingPoint || format.colorModel() == QPixelFormat::CMYK)
        return fail(error, QStringLiteral("Use RGB/RGBA or grayscale pixels with at most 8 bits per channel; HDR, 16-bit and CMYK conversion is not supported."));
    return true;
}

bool takeId(State &state, Id &id, QString &error)
{
    if (state.nextId >= quint32(std::numeric_limits<qint32>::max()))
        return fail(error, QStringLiteral("Sprite identity space exhausted; this document cannot create more elements."));
    id = state.nextId++;
    return true;
}

qint64 historyCost(const State &before, const State &after)
{
    // Conservatively charge both snapshots, even when QImage shares their storage.
    qint64 pixels = 0;
    for (const State *state : {&before, &after})
        pixels += qint64(state->size.width()) * state->size.height() *
                  state->layers.size() * state->frames.size();
    return pixels * 4;
}

bool contained(QRect rect, QSize size)
{
    return rect.width() > 0 && rect.height() > 0 && QRect(QPoint(), size).contains(rect);
}

void orderAnimations(State &state)
{
    for (Animation &animation : state.animations)
        std::sort(animation.frames.begin(), animation.frames.end(), [&state](Id a, Id b) {
            return indexOf(state.frames, a) < indexOf(state.frames, b);
        });
}

QJsonArray pointJson(QPoint point)
{
    return {point.x(), point.y()};
}

} // namespace

bool Layer::operator==(const Layer &o) const
{
    return id == o.id && name == o.name && visible == o.visible && locked == o.locked && opacity == o.opacity;
}
bool Frame::operator==(const Frame &o) const { return id == o.id && durationMs == o.durationMs && cels == o.cels; }
bool Palette::operator==(const Palette &o) const { return id == o.id && name == o.name && colors == o.colors; }
bool Animation::operator==(const Animation &o) const
{
    return id == o.id && name == o.name && frames == o.frames && loop == o.loop;
}
bool State::operator==(const State &o) const
{
    return uuid == o.uuid && name == o.name && size == o.size && mode == o.mode &&
           layers == o.layers && frames == o.frames && palettes == o.palettes &&
           animations == o.animations && pivot == o.pivot && collision == o.collision && nextId == o.nextId;
}

bool validate(const State &state, QString &error)
{
    error.clear();
    static const QRegularExpression uuid(QStringLiteral("^[0-9a-f]{32}$"));
    if (!uuid.match(state.uuid).hasMatch() || !validName(state.name) ||
        (state.mode != RasterMode::Pixel && state.mode != RasterMode::Smooth))
        return fail(error, QStringLiteral("Invalid sprite identity, name or raster mode."));
    if (!dimensions(state.size, state.layers.size(), state.frames.size(), error)) return false;
    if (state.palettes.isEmpty() || state.palettes.size() > MaxPalettes || state.animations.size() > MaxAnimations)
        return fail(error, QStringLiteral("A sprite requires 1..8 palettes and at most 32 named animations."));
    if (state.pivot.x() < 0 || state.pivot.y() < 0 ||
        state.pivot.x() > state.size.width() || state.pivot.y() > state.size.height())
        return fail(error, QStringLiteral("The pivot must remain inside or on the edge of the canvas."));
    if (state.collision && !contained(*state.collision, state.size))
        return fail(error, QStringLiteral("The collision rectangle must be nonempty and inside the canvas."));
    if (!state.nextId || state.nextId > quint32(std::numeric_limits<qint32>::max()))
        return fail(error, QStringLiteral("Invalid next sprite element ID."));
    QSet<Id> ids;
    QSet<QString> names;
    auto identity = [&](Id id) {
        if (!id || id >= state.nextId || ids.contains(id)) return false;
        ids.insert(id);
        return true;
    };
    auto named = [&](Id id, const QString &name) {
        if (!identity(id) || !validName(name) || names.contains(name)) return false;
        names.insert(name);
        return true;
    };
    for (const Layer &layer : state.layers)
        if (!named(layer.id, layer.name) || layer.opacity < 0 || layer.opacity > 255)
            return fail(error, QStringLiteral("Layer IDs/names must be unique; opacity must be 0..255."));
    for (const Frame &frame : state.frames) {
        if (!identity(frame.id) || frame.durationMs < 1 || frame.durationMs > 60000 ||
            frame.cels.size() != state.layers.size())
            return fail(error, QStringLiteral("Invalid frame ID, cel count or duration (1..60000 ms)."));
        for (const QImage &cel : frame.cels)
            if (cel.size() != state.size || cel.format() != QImage::Format_ARGB32 || cel.isNull())
                return fail(error, QStringLiteral("Every cel must be a full-size, straight-alpha RGBA raster."));
    }
    names.clear();
    for (const Palette &palette : state.palettes) {
        if (!named(palette.id, palette.name) || palette.colors.isEmpty() || palette.colors.size() > MaxColors)
            return fail(error, QStringLiteral("Palettes need unique IDs/names and 1..64 colors."));
        for (const QColor &color : palette.colors)
            if (!color.isValid() || color.spec() != QColor::Rgb || QColor::fromRgba(color.rgba()) != color)
                return fail(error, QStringLiteral("Palette colors must be valid 8-bit RGBA colors."));
    }
    names.clear();
    for (const Animation &animation : state.animations) {
        if (!named(animation.id, animation.name) || animation.frames.isEmpty() || animation.frames.size() > MaxFrames)
            return fail(error, QStringLiteral("Animations need unique IDs/names and 1..32 frame references."));
        QSet<Id> seen;
        for (Id frameId : animation.frames) {
            if (indexOf(state.frames, frameId) < 0 || seen.contains(frameId))
                return fail(error, QStringLiteral("Animation frames must reference distinct existing frames."));
            seen.insert(frameId);
        }
    }
    return true;
}

bool decodePng(const QByteArray &bytes, QImage &image, QString &error)
{
    if (bytes.size() < 33 || bytes.size() > MaxPngBytes || bytes.first(8) != QByteArray("\x89PNG\r\n\x1a\n", 8) ||
        bytes.mid(8, 8) != QByteArray("\0\0\0\rIHDR", 8))
        return fail(error, QStringLiteral("Import requires a PNG with an IHDR header, at most 16 MiB."));
    auto byte = [&](int n) { return static_cast<unsigned char>(bytes[n]); };
    auto u32 = [&](int n) { return quint32(byte(n)) << 24 | quint32(byte(n + 1)) << 16 |
                                  quint32(byte(n + 2)) << 8 | byte(n + 3); };
    quint32 width = u32(16), height = u32(20);
    if (!width || !height || width > MaxDimension || height > MaxDimension ||
        byte(24) != 8 || (byte(25) != 2 && byte(25) != 6) || byte(26) || byte(27) || byte(28))
        return fail(error, QStringLiteral("PNG subset: noninterlaced 8-bit RGB/RGBA, 1..2048 pixels per dimension."));
    QBuffer buffer;
    buffer.setData(bytes);
    buffer.open(QIODevice::ReadOnly);
    QImageReader reader(&buffer, "PNG");
    reader.setAutoTransform(false);
    if (reader.size() != QSize(int(width), int(height)))
        return fail(error, QStringLiteral("PNG header dimensions could not be verified."));
    QImage candidate = reader.read();
    if (candidate.isNull() || candidate.size() != QSize(int(width), int(height)))
        return fail(error, QStringLiteral("PNG decoding failed: %1").arg(reader.errorString()));
    image = candidate.convertToFormat(QImage::Format_ARGB32);
    error.clear();
    return true;
}

bool encodePng(const QImage &image, QByteArray &bytes, QString &error)
{
    if (image.isNull() || image.width() < 1 || image.height() < 1 ||
        image.width() > MaxDimension || image.height() > MaxDimension)
        return fail(error, QStringLiteral("PNG export dimensions must be 1..2048 pixels."));
    if (!supportedRaster(image, error)) return false;
    QByteArray candidate;
    QBuffer buffer(&candidate);
    buffer.open(QIODevice::WriteOnly);
    QImageWriter writer(&buffer, "PNG");
    writer.setOptimizedWrite(false);
    if (!writer.write(image.convertToFormat(QImage::Format_RGBA8888)))
        return fail(error, QStringLiteral("PNG encoding failed: %1").arg(writer.errorString()));
    QImage verified;
    if (!decodePng(candidate, verified, error)) return false;
    if (verified != image.convertToFormat(QImage::Format_ARGB32))
        return fail(error, QStringLiteral("PNG export did not preserve the rendered RGBA pixels."));
    bytes = std::move(candidate);
    error.clear();
    return true;
}

QImage composite(const State &state, Id frameId)
{
    int frame = indexOf(state.frames, frameId);
    if (frame < 0) return {};
    QImage result = blank(state.size);
    QPainter painter(&result);
    for (int i = 0; i < state.layers.size(); ++i) {
        if (!state.layers[i].visible || !state.layers[i].opacity) continue;
        painter.setOpacity(state.layers[i].opacity / 255.0);
        painter.drawImage(0, 0, state.frames[frame].cels[i]);
    }
    return result;
}

QVector<Id> playbackFrames(const State &state, Id animationId)
{
    if (animationId) {
        int index = indexOf(state.animations, animationId);
        return index < 0 ? QVector<Id>{} : state.animations[index].frames;
    }
    QVector<Id> result;
    for (const Frame &frame : state.frames) result.append(frame.id);
    return result;
}

Id frameAtTime(const State &state, Id animationId, qint64 elapsedMs, bool *finished)
{
    if (finished) *finished = false;
    QVector<Id> frames = playbackFrames(state, animationId);
    if (frames.isEmpty() || elapsedMs < 0) return 0;
    qint64 duration = 0;
    for (Id id : frames) duration += state.frames[indexOf(state.frames, id)].durationMs;
    int animation = indexOf(state.animations, animationId);
    bool loop = animation < 0 || state.animations[animation].loop;
    if (!loop && elapsedMs >= duration) {
        if (finished) *finished = true;
        return frames.last();
    }
    elapsedMs %= duration;
    for (Id id : frames) {
        int frameDuration = state.frames[indexOf(state.frames, id)].durationMs;
        if (elapsedMs < frameDuration) return id;
        elapsedMs -= frameDuration;
    }
    return frames.last();
}

class SnapshotCommand final : public QUndoCommand {
public:
    SnapshotCommand(Document *document, State before, State after, const QString &label)
        : QUndoCommand(label), document_(document), before_(std::move(before)), after_(std::move(after)),
          cost_(historyCost(before_, after_))
    {
        document_->historyBytes_ += cost_;
    }
    ~SnapshotCommand() override { document_->historyBytes_ -= cost_; }
    void undo() override { document_->applyHistory(before_); }
    void redo() override { document_->applyHistory(after_); }
private:
    Document *document_;
    State before_, after_;
    qint64 cost_;
};

Document::Document(QObject *parent) : QObject(parent)
{
    undo_.setUndoLimit(64);
    connect(&undo_, &QUndoStack::cleanChanged, this, [this] { emit dirtyChanged(isDirty()); });
    QString error;
    if (!create(QSize(64, 64), tr("Untitled sprite"), RasterMode::Pixel, error))
        qFatal("Cannot initialize sprite document: %s", qPrintable(error));
}

bool Document::create(QSize size, const QString &name, RasterMode mode, QString &error)
{
    if (!dimensions(size, 1, 1, error)) return false;
    State candidate;
    candidate.uuid = QUuid::createUuid().toString(QUuid::Id128);
    candidate.name = name;
    candidate.size = size;
    candidate.mode = mode;
    candidate.pivot = QPoint(size.width() / 2, size.height() / 2);
    candidate.layers = {{1, tr("Artwork"), true, false, 255}};
    candidate.frames = {{2, 125, {blank(size)}}};
    candidate.palettes = {{3, tr("Studio"), {
        QColor("#182c3a"), QColor("#31516a"), QColor("#3aa79e"), QColor("#76dfc6"),
        QColor("#b3f1db"), QColor("#f0fbf5"), QColor("#d3a25d"), QColor("#f3d48b"),
        QColor("#ae95ca"), QColor("#e6a3b0"), QColor("#ed735d"), QColor("#729de3")}}};
    candidate.nextId = 4;
    if (!validate(candidate, error)) return false;
    reset(std::move(candidate), false);
    return true;
}

void Document::reset(State state, bool saved)
{
    gestureBefore_.reset();
    state_ = std::move(state);
    idHighWater_ = state_.nextId;
    ++revision_;
    undo_.clear();
    if (saved) {
        undo_.setClean();
    } else {
        undo_.resetClean();
    }
    emit changed();
    emit dirtyChanged(isDirty());
}

bool Document::load(const QByteArray &bytes, QString &error)
{
    State candidate;
    if (!decodeSource(bytes, candidate, error)) return false;
    reset(std::move(candidate), true);
    return true;
}

bool Document::serialize(QByteArray &bytes, QString &error) const
{
    if (gestureActive()) return fail(error, tr("Finish or cancel the current gesture before saving."));
    return encodeSource(state_, bytes, error);
}

bool Document::markSaved(quint64 persistedRevision)
{
    if (persistedRevision != revision_ || gestureActive()) return false;
    undo_.setClean();
    emit dirtyChanged(isDirty());
    return true;
}

bool Document::isDirty() const
{
    return !undo_.isClean() || (gestureBefore_ && !(state_ == *gestureBefore_));
}

int Document::layerIndex(Id id) const { return indexOf(state_.layers, id); }
int Document::frameIndex(Id id) const { return indexOf(state_.frames, id); }

const QImage &Document::cel(Id frameId, Id layerId) const
{
    static const QImage empty;
    int frame = frameIndex(frameId), layer = layerIndex(layerId);
    return frame < 0 || layer < 0 ? empty : state_.frames[frame].cels[layer];
}

bool Document::canPaint(Id frameId, Id layerId, QString &error) const
{
    int layer = layerIndex(layerId);
    if (frameIndex(frameId) < 0 || layer < 0) return fail(error, tr("Select an existing frame and layer."));
    if (state_.layers[layer].locked) return fail(error, tr("Unlock this layer before editing its pixels."));
    if (!state_.layers[layer].visible) return fail(error, tr("Show this layer before editing its pixels."));
    error.clear();
    return true;
}

bool Document::edit(const QString &label, const std::function<bool(State &, QString &)> &operation, QString &error)
{
    if (gestureActive()) return fail(error, tr("Finish or cancel the current gesture first."));
    State candidate = state_;
    if (!operation(candidate, error) || !validate(candidate, error)) return false;
    if (!(candidate == state_)) commit(state_, candidate, label);
    error.clear();
    return true;
}

void Document::commit(const State &before, const State &after, const QString &label)
{
    State retainedBefore = before, retainedAfter = after;
    idHighWater_ = std::max(idHighWater_, after.nextId);
    qint64 cost = historyCost(before, after);
    if (historyBytes_ + cost > MaxHistoryBytes) {
        undo_.clear();
        undo_.resetClean();
        emit historyTrimmed(tr("Earlier undo steps were released at the 128 MiB history boundary. Your artwork is retained."));
    }
    undo_.push(new SnapshotCommand(this, std::move(retainedBefore), std::move(retainedAfter), label));
    emit dirtyChanged(isDirty());
}

void Document::applyHistory(const State &state)
{
    gestureBefore_.reset();
    state_ = state;
    if (state_.nextId < idHighWater_) {
        state_.nextId = idHighWater_;
        undo_.resetClean();
    }
    ++revision_;
    emit changed();
}

bool Document::addLayer(const QString &name, QString &error, Id *createdId)
{
    Id id = 0;
    bool ok = edit(tr("Add layer"), [&](State &s, QString &e) {
        if (!dimensions(s.size, s.layers.size() + 1, s.frames.size(), e) || !takeId(s, id, e)) return false;
        s.layers.append({id, name, true, false, 255});
        for (Frame &frame : s.frames) frame.cels.append(blank(s.size));
        return true;
    }, error);
    if (ok && createdId) *createdId = id;
    return ok;
}

bool Document::setLayer(const Layer &layer, QString &error)
{
    return edit(tr("Change layer"), [&](State &s, QString &e) {
        int index = indexOf(s.layers, layer.id);
        if (index < 0) return fail(e, tr("Layer no longer exists."));
        s.layers[index] = layer;
        return true;
    }, error);
}

bool Document::moveLayer(Id id, int index, QString &error)
{
    return edit(tr("Reorder layer"), [&](State &s, QString &e) {
        int from = indexOf(s.layers, id);
        if (from < 0 || index < 0 || index >= s.layers.size()) return fail(e, tr("Invalid layer destination."));
        s.layers.move(from, index);
        for (Frame &frame : s.frames) frame.cels.move(from, index);
        return true;
    }, error);
}

bool Document::removeLayer(Id id, QString &error)
{
    return edit(tr("Delete layer"), [&](State &s, QString &e) {
        int index = indexOf(s.layers, id);
        if (index < 0 || s.layers.size() == 1) return fail(e, tr("Keep at least one layer."));
        s.layers.removeAt(index);
        for (Frame &frame : s.frames) frame.cels.removeAt(index);
        return true;
    }, error);
}

bool Document::addFrame(Id after, bool duplicate, QString &error, Id *createdId)
{
    Id id = 0;
    bool ok = edit(duplicate ? tr("Duplicate frame") : tr("Add frame"), [&](State &s, QString &e) {
        int index = indexOf(s.frames, after);
        if (index < 0) return fail(e, tr("Select the frame to insert after."));
        if (!dimensions(s.size, s.layers.size(), s.frames.size() + 1, e) || !takeId(s, id, e)) return false;
        Frame frame = s.frames[index];
        frame.id = id;
        if (!duplicate) for (QImage &image : frame.cels) image = blank(s.size);
        s.frames.insert(index + 1, frame);
        return true;
    }, error);
    if (ok && createdId) *createdId = id;
    return ok;
}

bool Document::moveFrame(Id id, int index, QString &error)
{
    return edit(tr("Reorder frame"), [&](State &s, QString &e) {
        int from = indexOf(s.frames, id);
        if (from < 0 || index < 0 || index >= s.frames.size()) return fail(e, tr("Invalid frame destination."));
        s.frames.move(from, index);
        orderAnimations(s);
        return true;
    }, error);
}

bool Document::removeFrame(Id id, QString &error)
{
    return edit(tr("Delete frame"), [&](State &s, QString &e) {
        int index = indexOf(s.frames, id);
        if (index < 0 || s.frames.size() == 1) return fail(e, tr("Keep at least one frame."));
        for (Animation &animation : s.animations) {
            animation.frames.removeAll(id);
            if (animation.frames.isEmpty())
                return fail(e, tr("This is the only frame in '%1'. Delete or change that animation first.").arg(animation.name));
        }
        s.frames.removeAt(index);
        return true;
    }, error);
}

bool Document::setDuration(Id id, int durationMs, QString &error)
{
    return edit(tr("Change frame duration"), [&](State &s, QString &e) {
        int index = indexOf(s.frames, id);
        if (index < 0) return fail(e, tr("Frame no longer exists."));
        s.frames[index].durationMs = durationMs;
        return true;
    }, error);
}

bool Document::setMetadata(const QString &name, RasterMode mode, QPoint pivot,
                           std::optional<QRect> collision, QString &error)
{
    return edit(tr("Change sprite properties"), [&](State &s, QString &) {
        s.name = name; s.mode = mode; s.pivot = pivot; s.collision = collision;
        return true;
    }, error);
}

bool Document::setPalette(Palette palette, QString &error, Id *createdId)
{
    Id id = palette.id;
    bool ok = edit(tr("Change palette"), [&](State &s, QString &e) {
        if (!palette.id) {
            if (s.palettes.size() >= MaxPalettes) return fail(e, tr("A sprite supports at most eight palettes."));
            if (!takeId(s, palette.id, e)) return false;
            s.palettes.append(palette);
        } else {
            int index = indexOf(s.palettes, palette.id);
            if (index < 0) return fail(e, tr("Palette no longer exists."));
            s.palettes[index] = palette;
        }
        id = palette.id;
        return true;
    }, error);
    if (ok && createdId) *createdId = id;
    return ok;
}

bool Document::removePalette(Id id, QString &error)
{
    return edit(tr("Delete palette"), [&](State &s, QString &e) {
        int index = indexOf(s.palettes, id);
        if (index < 0 || s.palettes.size() == 1) return fail(e, tr("Keep at least one palette."));
        s.palettes.removeAt(index);
        return true;
    }, error);
}

bool Document::setAnimation(Animation animation, QString &error, Id *createdId)
{
    Id id = animation.id;
    bool ok = edit(tr("Change animation"), [&](State &s, QString &e) {
        if (!animation.id) {
            if (s.animations.size() >= MaxAnimations) return fail(e, tr("A sprite supports at most 32 animations."));
            if (!takeId(s, animation.id, e)) return false;
            s.animations.append(animation);
        } else {
            int index = indexOf(s.animations, animation.id);
            if (index < 0) return fail(e, tr("Animation no longer exists."));
            s.animations[index] = animation;
        }
        id = animation.id;
        return true;
    }, error);
    if (ok && createdId) *createdId = id;
    return ok;
}

bool Document::removeAnimation(Id id, QString &error)
{
    return edit(tr("Delete animation"), [&](State &s, QString &e) {
        int index = indexOf(s.animations, id);
        if (index < 0) return fail(e, tr("Animation no longer exists."));
        s.animations.removeAt(index);
        return true;
    }, error);
}

bool Document::resizeCanvas(QSize size, QPoint offset, QString &error)
{
    return edit(tr("Resize canvas"), [&](State &s, QString &e) {
        if (!dimensions(size, s.layers.size(), s.frames.size(), e)) return false;
        if (std::abs(qint64(offset.x())) > MaxDimension || std::abs(qint64(offset.y())) > MaxDimension)
            return fail(e, tr("Canvas offset must be within +/-2048 pixels."));
        QPoint pivot = s.pivot + offset;
        if (pivot.x() < 0 || pivot.y() < 0 || pivot.x() > size.width() || pivot.y() > size.height() ||
            (s.collision && !contained(s.collision->translated(offset), size)))
            return fail(e, tr("Resize would crop the pivot or collision bounds. Adjust them before cropping."));
        for (Frame &frame : s.frames) for (QImage &cel : frame.cels) {
            QImage image = blank(size);
            QPainter painter(&image);
            painter.setCompositionMode(QPainter::CompositionMode_Source);
            painter.drawImage(offset, cel);
            painter.end();
            cel = std::move(image);
        }
        s.size = size;
        s.pivot = pivot;
        if (s.collision) s.collision->translate(offset);
        return true;
    }, error);
}

bool Document::scaleArtwork(QSize size, QString &error)
{
    return edit(tr("Scale artwork"), [&](State &s, QString &e) {
        if (!dimensions(size, s.layers.size(), s.frames.size(), e)) return false;
        double x = double(size.width()) / s.size.width(), y = double(size.height()) / s.size.height();
        s.pivot = QPoint(qRound(s.pivot.x() * x), qRound(s.pivot.y() * y));
        if (s.collision) {
            int left = qFloor(s.collision->x() * x), top = qFloor(s.collision->y() * y);
            int right = qCeil((s.collision->x() + s.collision->width()) * x);
            int bottom = qCeil((s.collision->y() + s.collision->height()) * y);
            s.collision = QRect(left, top, right - left, bottom - top);
        }
        for (Frame &frame : s.frames) for (QImage &cel : frame.cels)
            cel = cel.scaled(size, Qt::IgnoreAspectRatio,
                s.mode == RasterMode::Pixel ? Qt::FastTransformation : Qt::SmoothTransformation)
                .convertToFormat(QImage::Format_ARGB32);
        s.size = size;
        return true;
    }, error);
}

bool Document::setCel(Id frameId, Id layerId, const QImage &image, const QString &label, QString &error)
{
    if (!canPaint(frameId, layerId, error)) return false;
    if (image.size() != state_.size || image.isNull())
        return fail(error, tr("Replacement cel must match the canvas dimensions."));
    if (!supportedRaster(image, error)) return false;
    QImage normalized = image.convertToFormat(QImage::Format_ARGB32);
    if (normalized.isNull()) return fail(error, tr("Could not allocate the replacement cel."));
    if (gestureActive()) {
        QImage &target = state_.frames[frameIndex(frameId)].cels[layerIndex(layerId)];
        if (target != normalized) {
            target = normalized;
            ++revision_;
            emit pixelsChanged(frameId, layerId);
            emit dirtyChanged(isDirty());
        }
        error.clear();
        return true;
    }
    return edit(label, [&](State &s, QString &) {
        s.frames[indexOf(s.frames, frameId)].cels[indexOf(s.layers, layerId)] = normalized;
        return true;
    }, error);
}

bool Document::clearPixels(Id frameId, Id layerId, QRect selection, QString &error)
{
    if (!canPaint(frameId, layerId, error)) return false;
    if (!contained(selection, state_.size)) return fail(error, tr("Select a nonempty area inside the canvas."));
    QImage image = cel(frameId, layerId);
    QPainter painter(&image);
    painter.setCompositionMode(QPainter::CompositionMode_Source);
    painter.fillRect(selection, Qt::transparent);
    painter.end();
    return setCel(frameId, layerId, image, tr("Clear selection"), error);
}

bool Document::pastePixels(Id frameId, Id layerId, const QImage &image, QPoint position, QString &error)
{
    if (!canPaint(frameId, layerId, error)) return false;
    if (image.isNull() || !contained(QRect(position, image.size()), state_.size))
        return fail(error, tr("The image must fit inside the canvas. Resize the canvas or scale the image explicitly."));
    if (!supportedRaster(image, error)) return false;
    QImage result = cel(frameId, layerId);
    QPainter painter(&result);
    painter.drawImage(position, image);
    painter.end();
    return setCel(frameId, layerId, result, tr("Paste pixels"), error);
}

bool Document::transformPixels(Id frameId, Id layerId, QRect source, QRect destination,
                              int quarterTurns, bool flipX, bool flipY, QString &error)
{
    if (!canPaint(frameId, layerId, error)) return false;
    if (!contained(source, state_.size) || !contained(destination, state_.size) ||
        quarterTurns < -3 || quarterTurns > 3)
        return fail(error, tr("Selection and transformed artwork must fit inside the canvas."));
    QImage result = cel(frameId, layerId);
    QImage pixels = result.copy(source);
    if (flipX || flipY) pixels = pixels.transformed(QTransform().scale(flipX ? -1 : 1, flipY ? -1 : 1));
    if (quarterTurns) pixels = pixels.transformed(QTransform().rotate(90 * quarterTurns));
    pixels = pixels.scaled(destination.size(), Qt::IgnoreAspectRatio,
        state_.mode == RasterMode::Pixel ? Qt::FastTransformation : Qt::SmoothTransformation);
    QPainter painter(&result);
    painter.setCompositionMode(QPainter::CompositionMode_Source);
    painter.fillRect(source, Qt::transparent);
    painter.setCompositionMode(QPainter::CompositionMode_SourceOver);
    painter.drawImage(destination.topLeft(), pixels);
    painter.end();
    return setCel(frameId, layerId, result, tr("Transform selection"), error);
}

bool Document::beginGesture(const QString &label, QString &error)
{
    if (gestureActive()) return fail(error, tr("A gesture is already active."));
    gestureBefore_ = state_;
    gestureLabel_ = label;
    error.clear();
    return true;
}

bool Document::endGesture(QString &error)
{
    if (!gestureActive()) return fail(error, tr("No gesture is active."));
    State before = *gestureBefore_;
    gestureBefore_.reset();
    if (!(before == state_)) commit(before, state_, gestureLabel_);
    emit dirtyChanged(isDirty());
    error.clear();
    return true;
}

void Document::cancelGesture()
{
    if (!gestureBefore_) return;
    State before = *gestureBefore_;
    gestureBefore_.reset();
    state_ = std::move(before);
    ++revision_;
    emit changed();
    emit dirtyChanged(isDirty());
}

bool Document::exportBundle(ExportBundle &bundle, QString &error) const
{
    ExportBundle candidate;
    candidate.revision = revision_;
    candidate.frameSize = state_.size;
    candidate.compositePixels = qint64(state_.size.width()) * state_.size.height() * state_.frames.size();
    if (!serialize(candidate.source, error)) return false;
    QJsonArray frames, animations;
    for (const Frame &frame : state_.frames) {
        ExportFrame exported{frame.id, QStringLiteral("frame-%1.png").arg(frame.id), {}};
        if (!encodePng(composite(state_, frame.id), exported.png, error)) return false;
        frames.append(QJsonObject{{"id", int(frame.id)}, {"file", exported.fileName}, {"durationMs", frame.durationMs},
            {"pngBytes", qint64(exported.png.size())},
            {"sha256", QString::fromLatin1(QCryptographicHash::hash(exported.png, QCryptographicHash::Sha256).toHex())}});
        candidate.pngBytes += exported.png.size();
        if (candidate.pngBytes > MaxExportPngBytes)
            return fail(error, tr("Frame PNG payloads exceed the 65 MiB delivery limit. The editable source can still be saved separately."));
        candidate.frames.append(std::move(exported));
    }
    for (const Animation &animation : state_.animations) {
        QJsonArray ids;
        for (Id id : animation.frames) ids.append(int(id));
        animations.append(QJsonObject{{"id", int(animation.id)}, {"name", animation.name},
            {"frames", ids}, {"loop", animation.loop}});
    }
    QJsonValue collision = QJsonValue::Null;
    if (state_.collision) {
        QRect r = *state_.collision;
        collision = QJsonObject{{"type", "rectangle"}, {"x", r.x()}, {"y", r.y()},
            {"width", r.width()}, {"height", r.height()}};
    }
    QJsonObject metadata{{"format", "nova-sprite-export"}, {"version", 1},
        {"document", state_.uuid}, {"name", state_.name},
        {"sourceSha256", QString::fromLatin1(QCryptographicHash::hash(candidate.source, QCryptographicHash::Sha256).toHex())},
        {"width", state_.size.width()}, {"height", state_.size.height()},
        {"rasterMode", state_.mode == RasterMode::Pixel ? "pixel" : "smooth"},
        {"pivot", pointJson(state_.pivot)}, {"collision", collision},
        {"frames", frames}, {"animations", animations},
        {"requirements", QJsonObject{{"spriteDeclarations", state_.frames.size()},
            {"compositePixels", candidate.compositePixels}, {"pngBytes", candidate.pngBytes},
            {"sourceBytes", qint64(candidate.source.size())}}},
        {"runtimeContract", "metadata-only; native scene/animation integration required"}};
    candidate.metadata = QJsonDocument(metadata).toJson(QJsonDocument::Indented);
    if (candidate.metadata.size() > MaxExportMetadataBytes)
        return fail(error, tr("Export metadata exceeds 64 KiB. The editable source can still be saved separately."));
    bundle = std::move(candidate);
    error.clear();
    return true;
}

} // namespace nova::sprite
