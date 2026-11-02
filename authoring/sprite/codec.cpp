#include "codec.hpp"

#include <cstring>

namespace nova::sprite {
namespace {

constexpr char Magic[] = "NVSPRITE";
constexpr quint32 Version = 1;

class Writer {
public:
    QByteArray bytes;
    void u32(quint32 value)
    {
        for (int shift = 0; shift < 32; shift += 8) bytes.append(char((value >> shift) & 255));
    }
    void text(const QString &value)
    {
        QByteArray utf8 = value.toUtf8();
        u32(quint32(utf8.size()));
        bytes.append(utf8);
    }
};

class Reader {
public:
    explicit Reader(const QByteArray &bytes) : bytes_(bytes) {}
    bool ok = true;
    qsizetype position = 0;
    quint32 u32()
    {
        if (!available(4)) return 0;
        quint32 value = 0;
        for (int shift = 0; shift < 32; shift += 8)
            value |= quint32(static_cast<unsigned char>(bytes_[position++])) << shift;
        return value;
    }
    bool boolean()
    {
        quint32 value = u32();
        if (value > 1) ok = false;
        return value != 0;
    }
    QString text()
    {
        quint32 length = u32();
        if (!length || length > 96 || !available(length)) { ok = false; return {}; }
        QByteArray value = bytes_.mid(position, length);
        position += length;
        QString decoded = QString::fromUtf8(value);
        if (decoded.toUtf8() != value) ok = false;
        return decoded;
    }
    bool available(qsizetype count)
    {
        if (!ok || count < 0 || count > bytes_.size() - position) { ok = false; return false; }
        return true;
    }
    bool image(QSize size, QImage &image)
    {
        qsizetype rowBytes = qsizetype(size.width()) * 4;
        if (!available(rowBytes * size.height())) return false;
        QImage rgba(size, QImage::Format_RGBA8888);
        if (rgba.isNull()) { ok = false; return false; }
        for (int y = 0; y < size.height(); ++y) {
            std::memcpy(rgba.scanLine(y), bytes_.constData() + position, size_t(rowBytes));
            position += rowBytes;
        }
        image = rgba.convertToFormat(QImage::Format_ARGB32);
        return true;
    }
private:
    const QByteArray &bytes_;
};

bool rejected(QString &error, const QString &detail)
{
    error = QStringLiteral("Cannot open sprite source: %1. The current draft was retained.").arg(detail);
    return false;
}

} // namespace

bool encodeSource(const State &state, QByteArray &bytes, QString &error)
{
    if (!validate(state, error)) return false;
    Writer w;
    qint64 rasterBytes = qint64(state.size.width()) * state.size.height() *
                        state.layers.size() * state.frames.size() * 4;
    w.bytes.reserve(qsizetype(rasterBytes + 65536));
    w.bytes.append(Magic, 8);
    w.u32(Version);
    w.u32(0); // Reserved flags must remain zero in version 1.
    w.u32(state.size.width()); w.u32(state.size.height());
    w.u32(state.layers.size()); w.u32(state.frames.size());
    w.u32(state.palettes.size()); w.u32(state.animations.size());
    w.u32(state.nextId);
    w.u32(state.mode == RasterMode::Pixel ? 0 : 1);
    w.text(state.uuid); w.text(state.name);
    w.u32(state.pivot.x()); w.u32(state.pivot.y());
    w.u32(state.collision ? 1 : 0);
    if (state.collision) {
        w.u32(state.collision->x()); w.u32(state.collision->y());
        w.u32(state.collision->width()); w.u32(state.collision->height());
    }
    for (const Layer &layer : state.layers) {
        w.u32(layer.id); w.text(layer.name);
        w.u32(layer.visible); w.u32(layer.locked); w.u32(layer.opacity);
    }
    for (const Frame &frame : state.frames) {
        w.u32(frame.id); w.u32(frame.durationMs);
        for (const QImage &cel : frame.cels) {
            QImage rgba = cel.convertToFormat(QImage::Format_RGBA8888);
            if (rgba.isNull()) {
                error = QStringLiteral("Could not allocate the source RGBA encoding buffer.");
                return false;
            }
            for (int y = 0; y < rgba.height(); ++y)
                w.bytes.append(reinterpret_cast<const char *>(rgba.constScanLine(y)), rgba.width() * 4);
        }
    }
    for (const Palette &palette : state.palettes) {
        w.u32(palette.id); w.text(palette.name); w.u32(palette.colors.size());
        for (const QColor &color : palette.colors) w.u32(color.rgba());
    }
    for (const Animation &animation : state.animations) {
        w.u32(animation.id); w.text(animation.name); w.u32(animation.loop); w.u32(animation.frames.size());
        for (Id id : animation.frames) w.u32(id);
    }
    if (w.bytes.size() > MaxSourceBytes) {
        error = QStringLiteral("Sprite source exceeds the 65 MiB file limit.");
        return false;
    }
    bytes = std::move(w.bytes);
    error.clear();
    return true;
}

bool decodeSource(const QByteArray &bytes, State &state, QString &error)
{
    if (bytes.size() < 48 || bytes.size() > MaxSourceBytes || bytes.first(8) != QByteArray(Magic, 8))
        return rejected(error, QStringLiteral("expected a bounded NVSPRITE source (at most 65 MiB)"));
    Reader r(bytes);
    r.position = 8;
    if (r.u32() != Version || r.u32() != 0)
        return rejected(error, QStringLiteral("unsupported source version or flags"));
    quint32 width = r.u32(), height = r.u32(), layers = r.u32(), frames = r.u32();
    quint32 palettes = r.u32(), animations = r.u32();
    if (!width || !height || width > MaxDimension || height > MaxDimension ||
        !layers || layers > MaxLayers || !frames || frames > MaxFrames ||
        !palettes || palettes > MaxPalettes || animations > MaxAnimations ||
        quint64(width) * height * layers * frames > quint64(MaxCelPixels))
        return rejected(error, QStringLiteral("invalid dimensions, counts or cel-pixel budget"));
    // Check the entire uncompressed raster extent before allocating any images.
    if (quint64(width) * height * layers * frames * 4 > quint64(bytes.size() - r.position))
        return rejected(error, QStringLiteral("truncated raster data"));
    State candidate;
    candidate.size = QSize(int(width), int(height));
    candidate.nextId = r.u32();
    quint32 mode = r.u32();
    if (mode > 1) return rejected(error, QStringLiteral("unknown raster mode"));
    candidate.mode = mode == 0 ? RasterMode::Pixel : RasterMode::Smooth;
    candidate.uuid = r.text(); candidate.name = r.text();
    quint32 pivotX = r.u32(), pivotY = r.u32();
    if (pivotX > width || pivotY > height) return rejected(error, QStringLiteral("invalid pivot"));
    candidate.pivot = QPoint(int(pivotX), int(pivotY));
    if (r.boolean()) {
        quint32 x = r.u32(), y = r.u32(), w = r.u32(), h = r.u32();
        if (x > width || y > height || !w || !h || w > width - x || h > height - y)
            return rejected(error, QStringLiteral("invalid collision rectangle"));
        candidate.collision = QRect(int(x), int(y), int(w), int(h));
    }
    for (quint32 i = 0; i < layers && r.ok; ++i) {
        Layer layer;
        layer.id = r.u32(); layer.name = r.text();
        layer.visible = r.boolean(); layer.locked = r.boolean();
        quint32 opacity = r.u32();
        if (opacity > 255) r.ok = false;
        layer.opacity = int(opacity);
        candidate.layers.append(layer);
    }
    for (quint32 i = 0; i < frames && r.ok; ++i) {
        Frame frame;
        frame.id = r.u32();
        quint32 duration = r.u32();
        if (!duration || duration > 60000) r.ok = false;
        frame.durationMs = int(duration);
        for (quint32 j = 0; j < layers && r.ok; ++j) {
            QImage image;
            if (r.image(candidate.size, image)) frame.cels.append(std::move(image));
        }
        candidate.frames.append(std::move(frame));
    }
    for (quint32 i = 0; i < palettes && r.ok; ++i) {
        Palette palette;
        palette.id = r.u32(); palette.name = r.text();
        quint32 count = r.u32();
        if (!count || count > MaxColors) r.ok = false;
        for (quint32 j = 0; j < count && r.ok; ++j) palette.colors.append(QColor::fromRgba(r.u32()));
        candidate.palettes.append(palette);
    }
    for (quint32 i = 0; i < animations && r.ok; ++i) {
        Animation animation;
        animation.id = r.u32(); animation.name = r.text(); animation.loop = r.boolean();
        quint32 count = r.u32();
        if (!count || count > MaxFrames) r.ok = false;
        for (quint32 j = 0; j < count && r.ok; ++j) animation.frames.append(r.u32());
        candidate.animations.append(animation);
    }
    if (!r.ok || r.position != bytes.size())
        return rejected(error, QStringLiteral("truncated, invalid or unexpected trailing data"));
    QString detail;
    if (!validate(candidate, detail)) return rejected(error, detail);
    state = std::move(candidate);
    error.clear();
    return true;
}

} // namespace nova::sprite
