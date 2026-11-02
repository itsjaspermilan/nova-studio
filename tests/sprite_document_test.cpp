#include "sprite/document.hpp"
#include "sprite/codec.hpp"

#include <QBuffer>
#include <QCryptographicHash>
#include <QFile>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QSignalSpy>
#include <QSaveFile>
#include <QTemporaryDir>
#include <QtTest>
#include <limits>

using namespace nova::sprite;

class SpriteDocumentTest : public QObject {
    Q_OBJECT
private slots:
    void sourceRoundTrip();
    void strictFailuresRetainDraft();
    void gestureUndoAndSaveRevision();
    void layerRulesAndComposition();
    void framesAndStableReferences();
    void resizeScaleAndSelection();
    void exportsPreservePixelsAndMetadata();
    void boundedHistoryAndDimensions();
    void maximumSourceAndDeliveryRoundTrip();
    void maximumCompositeBudget();
    void rejectsUnsupportedPrecision();
};

static void put32(QByteArray &bytes, int offset, quint32 value)
{
    for (int i = 0; i < 4; ++i) bytes[offset + i] = char((value >> (i * 8)) & 255);
}

void SpriteDocumentTest::sourceRoundTrip()
{
    Document document;
    QString error;
    QVERIFY2(document.create({5, 3}, QString::fromUtf8("Car \xc3\xa9\xe8\xbb\x8a"), RasterMode::Smooth, error), qPrintable(error));
    Id layer = document.state().layers.first().id, frame = document.state().frames.first().id;
    QImage cel = document.cel(frame, layer);
    cel.setPixel(0, 0, qRgba(17, 91, 219, 0));
    cel.setPixel(4, 2, qRgba(15, 123, 241, 97));
    QVERIFY2(document.setCel(frame, layer, cel, "Paint", error), qPrintable(error));
    Id upper = 0, next = 0;
    QVERIFY(document.addLayer("Windows", error, &upper));
    QVERIFY(document.addFrame(frame, true, error, &next));
    QVERIFY(document.setDuration(next, 239, error));
    QVERIFY(document.setMetadata(document.state().name, RasterMode::Smooth, {1, 2}, QRect(0, 0, 4, 2), error));
    QVERIFY(document.setAnimation({0, "Drive", {frame, next}, false}, error));
    QByteArray source;
    QVERIFY2(document.serialize(source, error), qPrintable(error));
    Document reopened;
    QVERIFY2(reopened.load(source, error), qPrintable(error));
    QVERIFY(reopened.state() == document.state());
    QCOMPARE(reopened.cel(frame, layer).pixel(0, 0), qRgba(17, 91, 219, 0));
    QCOMPARE(reopened.cel(frame, layer).pixel(4, 2), qRgba(15, 123, 241, 97));
    QVERIFY(!reopened.isDirty());
    QByteArray roundTrip;
    QVERIFY(reopened.serialize(roundTrip, error));
    QCOMPARE(roundTrip, source);
}

void SpriteDocumentTest::strictFailuresRetainDraft()
{
    Document document;
    QString error;
    QVERIFY(document.create({4, 4}, "Draft", RasterMode::Pixel, error));
    QVERIFY(document.addLayer("Details", error));
    QByteArray source;
    QVERIFY(document.serialize(source, error));
    const State before = document.state();
    const int history = document.undoStack()->count();
    QVector<QByteArray> invalid{QByteArray(), source.first(10), source.chopped(1), source + "unexpected"};
    for (int offset : {8, 12, 16, 20, 24, 28, 32, 36, 40, 44}) {
        QByteArray bytes = source;
        put32(bytes, offset, 0xffffffffu);
        invalid.append(bytes);
    }
    // Unknown boolean value in the first layer.
    int layerOffset = 48 + 4 + 32 + 4 + int(before.name.toUtf8().size()) + 12;
    int visibility = layerOffset + 4 + 4 + int(before.layers[0].name.toUtf8().size());
    QByteArray badBoolean = source;
    put32(badBoolean, visibility, 2);
    invalid.append(badBoolean);
    QByteArray duplicateId = source;
    int secondLayer = visibility + 12;
    put32(duplicateId, secondLayer, before.layers[0].id);
    invalid.append(duplicateId);
    QByteArray invalidUtf8 = source;
    invalidUtf8[48 + 4 + 32 + 4] = char(0xff);
    invalid.append(invalidUtf8);
    for (const QByteArray &bytes : invalid) {
        QVERIFY2(!document.load(bytes, error), "Malformed source was accepted");
        QVERIFY(!error.isEmpty());
        QVERIFY(document.state() == before);
        QCOMPARE(document.undoStack()->count(), history);
        QVERIFY(document.isDirty());
    }
    document.undoStack()->undo();
    QCOMPARE(document.state().layers.size(), 1);
    document.undoStack()->redo();
    QVERIFY(document.state() == before);
    State bad = before;
    bad.frames[0].durationMs = 0;
    QByteArray retained("sentinel");
    QVERIFY(!encodeSource(bad, retained, error));
    QCOMPARE(retained, QByteArray("sentinel"));
    QImage retainedImage(1, 1, QImage::Format_ARGB32);
    retainedImage.fill(Qt::red);
    QVERIFY(!decodePng("not a PNG", retainedImage, error));
    QCOMPARE(retainedImage.pixelColor(0, 0), QColor(Qt::red));
}

void SpriteDocumentTest::gestureUndoAndSaveRevision()
{
    Document document;
    QString error;
    QVERIFY(document.create({8, 8}, "Stroke", RasterMode::Pixel, error));
    QVERIFY(document.markSaved(document.revision()));
    Id frame = document.state().frames[0].id, layer = document.state().layers[0].id;
    const QImage original = document.cel(frame, layer);
    QSignalSpy dirty(&document, &Document::dirtyChanged);
    QVERIFY(document.beginGesture("Pencil stroke", error));
    QImage image = original;
    for (int x = 0; x < 8; ++x) {
        image.setPixelColor(x, 2, Qt::red);
        QVERIFY(document.setCel(frame, layer, image, "Ignored within gesture", error));
    }
    QVERIFY(document.isDirty());
    QCOMPARE(document.undoStack()->count(), 0);
    QByteArray output("retained");
    QVERIFY(!document.serialize(output, error));
    QCOMPARE(output, QByteArray("retained"));
    QVERIFY(!document.markSaved(document.revision()));
    QVERIFY(document.endGesture(error));
    QCOMPARE(document.undoStack()->count(), 1);
    QCOMPARE(document.undoStack()->undoText(), QString("Pencil stroke"));
    quint64 snapshotRevision = document.revision();
    document.undoStack()->undo();
    QCOMPARE(document.cel(frame, layer), original);
    QVERIFY(!document.isDirty());
    document.undoStack()->redo();
    QCOMPARE(document.cel(frame, layer), image);
    QVERIFY(!document.markSaved(snapshotRevision));
    QVERIFY(document.markSaved(document.revision()));
    QVERIFY(!document.isDirty());
    QVERIFY(document.beginGesture("Cancelled", error));
    QImage changed = image;
    changed.fill(Qt::green);
    QVERIFY(document.setCel(frame, layer, changed, "Paint", error));
    document.cancelGesture();
    QCOMPARE(document.cel(frame, layer), image);
    QVERIFY(!document.isDirty());
    QCOMPARE(document.undoStack()->count(), 1);
    QVERIFY(document.beginGesture("No-op", error));
    QVERIFY(document.endGesture(error));
    QCOMPARE(document.undoStack()->count(), 1);
    QVERIFY(dirty.count() > 0);
}

void SpriteDocumentTest::layerRulesAndComposition()
{
    Document document;
    QString error;
    QVERIFY(document.create({2, 2}, "Layers", RasterMode::Pixel, error));
    Id frame = document.state().frames[0].id, base = document.state().layers[0].id, top = 0;
    QImage blue = document.cel(frame, base);
    blue.fill(Qt::blue);
    QVERIFY(document.setCel(frame, base, blue, "Base", error));
    QVERIFY(document.addLayer("Tint", error, &top));
    QImage red = document.cel(frame, top);
    red.fill(Qt::red);
    QVERIFY(document.setCel(frame, top, red, "Tint", error));
    Layer layer = document.state().layers[1];
    layer.opacity = 128;
    QVERIFY(document.setLayer(layer, error));
    QColor color = composite(document.state(), frame).pixelColor(0, 0);
    QVERIFY(color.red() >= 127 && color.red() <= 128);
    QVERIFY(color.blue() >= 127 && color.blue() <= 128);
    QCOMPARE(color.alpha(), 255);
    layer.visible = false;
    QVERIFY(document.setLayer(layer, error));
    QCOMPARE(composite(document.state(), frame).pixelColor(0, 0), QColor(Qt::blue));
    QVERIFY(!document.setCel(frame, top, blue, "Blocked", error));
    layer.visible = true; layer.locked = true;
    QVERIFY(document.setLayer(layer, error));
    QVERIFY(!document.clearPixels(frame, top, QRect(0, 0, 1, 1), error));
    layer.locked = false; layer.opacity = 255;
    QVERIFY(document.setLayer(layer, error));
    QVERIFY(document.moveLayer(top, 0, error));
    QCOMPARE(composite(document.state(), frame).pixelColor(0, 0), QColor(Qt::blue));
    document.undoStack()->undo();
    QCOMPARE(composite(document.state(), frame).pixelColor(0, 0), QColor(Qt::red));
    QVERIFY(document.removeLayer(top, error));
    QVERIFY(!document.removeLayer(base, error));
}

void SpriteDocumentTest::framesAndStableReferences()
{
    Document document;
    QString error;
    Id a = document.state().frames[0].id, b = 0, c = 0, animation = 0;
    QVERIFY(document.addFrame(a, true, error, &b));
    QVERIFY(document.addFrame(b, false, error, &c));
    QVERIFY(document.setDuration(a, 50, error));
    QVERIFY(document.setDuration(b, 125, error));
    QVERIFY(document.setDuration(c, 200, error));
    QVERIFY(document.setAnimation({0, "Drive", {a, b, c}, true}, error, &animation));
    QCOMPARE(frameAtTime(document.state(), animation, 0), a);
    QCOMPARE(frameAtTime(document.state(), animation, 49), a);
    QCOMPARE(frameAtTime(document.state(), animation, 50), b);
    QCOMPARE(frameAtTime(document.state(), animation, 174), b);
    QCOMPARE(frameAtTime(document.state(), animation, 175), c);
    QCOMPARE(frameAtTime(document.state(), animation, 375), a);
    QCOMPARE(frameAtTime(document.state(), animation, 3750000050LL), b);
    QVERIFY(document.moveFrame(c, 0, error));
    QCOMPARE(document.state().animations[0].frames, QVector<Id>({c, a, b}));
    QCOMPARE(document.state().frames[0].durationMs, 200);
    document.undoStack()->undo();
    QCOMPARE(document.state().animations[0].frames, QVector<Id>({a, b, c}));
    QVERIFY(document.removeFrame(b, error));
    QCOMPARE(document.state().animations[0].frames, QVector<Id>({a, c}));
    document.undoStack()->undo();
    QCOMPARE(document.state().animations[0].frames, QVector<Id>({a, b, c}));
    Animation solo{animation, "Drive", {b}, false};
    QVERIFY(document.setAnimation(solo, error));
    State before = document.state();
    QVERIFY(!document.removeFrame(b, error));
    QVERIFY(document.state() == before);
    bool finished = false;
    QCOMPARE(frameAtTime(document.state(), animation, 125, &finished), b);
    QVERIFY(finished);
    QVERIFY(!document.setAnimation({0, "Bad", {a, a}, true}, error));
    QVERIFY(!document.setAnimation({0, "Bad", {100000}, true}, error));
    Id undone = 0, replacement = 0;
    QVERIFY(document.addFrame(c, true, error, &undone));
    document.undoStack()->undo();
    QVERIFY(document.addFrame(c, true, error, &replacement));
    QVERIFY(replacement > undone);
}

void SpriteDocumentTest::resizeScaleAndSelection()
{
    Document document;
    QString error;
    QVERIFY(document.create({4, 4}, "Transform", RasterMode::Pixel, error));
    Id f = document.state().frames[0].id, l = document.state().layers[0].id;
    QImage pixels = document.cel(f, l);
    pixels.setPixelColor(0, 0, Qt::red);
    pixels.setPixelColor(1, 0, Qt::blue);
    pixels.setPixelColor(0, 1, Qt::green);
    pixels.setPixelColor(1, 1, Qt::yellow);
    QVERIFY(document.setCel(f, l, pixels, "Pixels", error));
    QVERIFY(document.transformPixels(f, l, QRect(0, 0, 2, 2), QRect(2, 2, 2, 2), 0, true, false, error));
    QCOMPARE(document.cel(f, l).pixelColor(2, 2), QColor(Qt::blue));
    QCOMPARE(document.cel(f, l).pixelColor(3, 3), QColor(Qt::green));
    QCOMPARE(document.cel(f, l).pixelColor(0, 0).alpha(), 0);
    document.undoStack()->undo();
    QCOMPARE(document.cel(f, l), pixels);
    QVERIFY(document.transformPixels(f, l, QRect(0, 0, 2, 2), QRect(2, 2, 2, 2), 1, false, false, error));
    QCOMPARE(document.cel(f, l).pixelColor(2, 2), QColor(Qt::green));
    QCOMPARE(document.cel(f, l).pixelColor(3, 2), QColor(Qt::red));
    QCOMPARE(document.cel(f, l).pixelColor(2, 3), QColor(Qt::yellow));
    QCOMPARE(document.cel(f, l).pixelColor(3, 3), QColor(Qt::blue));
    document.undoStack()->undo();
    QCOMPARE(document.cel(f, l), pixels);
    QVERIFY(document.setMetadata("Transform", RasterMode::Pixel, {2, 2}, QRect(0, 0, 2, 2), error));
    QVERIFY(document.resizeCanvas({6, 6}, {1, 1}, error));
    QCOMPARE(document.state().pivot, QPoint(3, 3));
    QCOMPARE(*document.state().collision, QRect(1, 1, 2, 2));
    QCOMPARE(document.cel(f, l).pixelColor(1, 1), QColor(Qt::red));
    State before = document.state();
    QVERIFY(!document.resizeCanvas({2, 2}, {}, error));
    QVERIFY(document.state() == before);
    QVERIFY(document.scaleArtwork({12, 12}, error));
    QCOMPARE(document.state().pivot, QPoint(6, 6));
    QCOMPARE(*document.state().collision, QRect(2, 2, 4, 4));
    QCOMPARE(document.cel(f, l).pixelColor(2, 2), QColor(Qt::red));
    QCOMPARE(document.cel(f, l).pixelColor(3, 3), QColor(Qt::red));
    QVERIFY(!document.pastePixels(f, l, pixels, {11, 11}, error));
    QVERIFY(document.clearPixels(f, l, QRect(2, 2, 4, 4), error));
    QCOMPARE(document.cel(f, l).pixelColor(2, 2).alpha(), 0);
}

void SpriteDocumentTest::exportsPreservePixelsAndMetadata()
{
    Document document;
    QString error;
    QVERIFY(document.create({3, 2}, "Export", RasterMode::Pixel, error));
    Id a = document.state().frames[0].id, layer = document.state().layers[0].id, b = 0;
    QImage image = document.cel(a, layer);
    image.setPixelColor(0, 0, QColor(211, 81, 9, 127));
    image.setPixelColor(2, 1, Qt::blue);
    QVERIFY(document.setCel(a, layer, image, "Pixels", error));
    QVERIFY(document.addFrame(a, true, error, &b));
    QVERIFY(document.setDuration(a, 99, error));
    QVERIFY(document.setDuration(b, 231, error));
    QVERIFY(document.setMetadata("Export", RasterMode::Pixel, {1, 2}, QRect(1, 0, 2, 2), error));
    QVERIFY(document.setAnimation({0, "Drive", {a, b}, false}, error));
    ExportBundle bundle;
    QVERIFY2(document.exportBundle(bundle, error), qPrintable(error));
    QVERIFY(document.isDirty());
    QCOMPARE(bundle.frames.size(), 2);
    QCOMPARE(bundle.compositePixels, qint64(12));
    QCOMPARE(bundle.frameSize, QSize(3, 2));
    qint64 byteCount = 0;
    for (const ExportFrame &frame : bundle.frames) {
        QImage reopened;
        QVERIFY2(decodePng(frame.png, reopened, error), qPrintable(error));
        QCOMPARE(reopened, composite(document.state(), frame.id));
        QCOMPARE(static_cast<unsigned char>(frame.png[24]), 8);
        QCOMPARE(static_cast<unsigned char>(frame.png[25]), 6);
        QCOMPARE(static_cast<unsigned char>(frame.png[28]), 0);
        byteCount += frame.png.size();
    }
    QCOMPARE(bundle.pngBytes, byteCount);
    QJsonObject metadata = QJsonDocument::fromJson(bundle.metadata).object();
    QCOMPARE(metadata["pivot"].toArray(), QJsonArray({1, 2}));
    QCOMPARE(metadata["collision"].toObject()["width"].toInt(), 2);
    QCOMPARE(metadata["frames"].toArray()[0].toObject()["durationMs"].toInt(), 99);
    QCOMPARE(metadata["frames"].toArray()[1].toObject()["durationMs"].toInt(), 231);
    QVERIFY(!metadata["animations"].toArray()[0].toObject()["loop"].toBool());
    Document reopened;
    QVERIFY(reopened.load(bundle.source, error));
    QVERIFY(reopened.state() == document.state());
    QVERIFY(document.beginGesture("Unfinished", error));
    QByteArray originalMetadata = bundle.metadata;
    QVERIFY(!document.exportBundle(bundle, error));
    QCOMPARE(bundle.metadata, originalMetadata);
    document.cancelGesture();
}

void SpriteDocumentTest::boundedHistoryAndDimensions()
{
    Document document;
    QString error;
    QVERIFY(!document.create({2049, 1}, "Large", RasterMode::Pixel, error));
    QVERIFY(!document.create({0, 1}, "Empty", RasterMode::Pixel, error));
    QVERIFY(document.create({1024, 1024}, "Budget", RasterMode::Pixel, error));
    Id frame = document.state().frames[0].id;
    QSignalSpy trimmed(&document, &Document::historyTrimmed);
    for (int i = 0; i < 20; ++i) QVERIFY(document.setDuration(frame, 100 + i, error));
    QVERIFY(trimmed.count() >= 1);
    QVERIFY(document.historyBytes() <= MaxHistoryBytes);
    QVERIFY(document.undoStack()->canUndo());
    document.undoStack()->undo();
    QCOMPARE(document.state().frames[0].durationMs, 118);
    QVERIFY(document.create({2048, 2048}, "Pixel budget", RasterMode::Pixel, error));
    for (int i = 0; i < 3; ++i) QVERIFY(document.addLayer(QString("Layer %1").arg(i), error));
    State before = document.state();
    QVERIFY(!document.addLayer("Too many pixels", error));
    QVERIFY(document.state() == before);
    QVERIFY(!document.addFrame(document.state().frames[0].id, true, error));
    QVERIFY(document.historyBytes() <= MaxHistoryBytes);
    QVERIFY(document.create({1, 1}, "History count", RasterMode::Pixel, error));
    frame = document.state().frames[0].id;
    for (int i = 1; i <= 80; ++i) QVERIFY(document.setDuration(frame, i, error));
    QCOMPARE(document.undoStack()->count(), 64);
    for (int i = 0; i < 64; ++i) document.undoStack()->undo();
    QCOMPARE(document.state().frames[0].durationMs, 16);
    QVERIFY(!document.undoStack()->canUndo());
    for (int i = 0; i < 64; ++i) document.undoStack()->redo();
    QCOMPARE(document.state().frames[0].durationMs, 80);
}

void SpriteDocumentTest::maximumSourceAndDeliveryRoundTrip()
{
    State maximum;
    maximum.uuid = QString(32, 'a');
    maximum.name = QString(96, '"');
    maximum.size = {256, 128};
    maximum.mode = RasterMode::Smooth;
    maximum.pivot = {256, 128};
    maximum.collision = QRect(QPoint(), maximum.size);
    Id next = Id(std::numeric_limits<qint32>::max()) - MaxLayers - MaxFrames - MaxPalettes - MaxAnimations;
    auto name = [](int i) { QString suffix = QString::number(i); return QString(96 - suffix.size(), '\\') + suffix; };
    QImage cel(maximum.size, QImage::Format_ARGB32);
    for (int y = 0; y < cel.height(); ++y)
        for (int x = 0; x < cel.width(); ++x) cel.setPixel(x, y, qRgba(x, y, (x + y) & 255, (3 * x + y) & 255));
    for (int i = 0; i < MaxLayers; ++i) maximum.layers.append({next++, name(i), true, false, 255});
    QVector<Id> frameIds;
    for (int i = 0; i < MaxFrames; ++i) {
        Frame frame{next++, 60000, {}};
        for (int j = 0; j < MaxLayers; ++j) frame.cels.append(cel);
        frameIds.append(frame.id);
        maximum.frames.append(frame);
    }
    for (int i = 0; i < MaxPalettes; ++i) {
        Palette palette{next++, name(i), {}};
        for (int c = 0; c < MaxColors; ++c) palette.colors.append(QColor::fromRgba(qRgba(c * 4, c * 3, c * 2, c * 4)));
        maximum.palettes.append(palette);
    }
    for (int i = 0; i < MaxAnimations; ++i) maximum.animations.append({next++, name(i), frameIds, false});
    maximum.nextId = next;
    QString error;
    QByteArray source;
    QVERIFY2(encodeSource(maximum, source, error), qPrintable(error));
    QCOMPARE(source.size(), qsizetype(67121780));
    QVERIFY(source.size() <= MaxSourceBytes);
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    auto persist = [&](const QString &name, const QByteArray &bytes) {
        QSaveFile file(directory.filePath(name));
        return file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size() && file.commit();
    };
    QVERIFY(persist("maximum.nova-sprite", source));
    QFile file(directory.filePath("maximum.nova-sprite"));
    QVERIFY(file.open(QIODevice::ReadOnly));
    Document reopened;
    QVERIFY2(reopened.load(file.readAll(), error), qPrintable(error));
    QVERIFY(reopened.state() == maximum);
    QVERIFY(!reopened.isDirty());
    ExportBundle bundle;
    QVERIFY2(reopened.exportBundle(bundle, error), qPrintable(error));
    QCOMPARE(bundle.source, source);
    QCOMPARE(bundle.frames.size(), MaxFrames);
    QCOMPARE(bundle.compositePixels, qint64(256 * 128 * MaxFrames));
    QVERIFY(bundle.metadata.size() <= MaxExportMetadataBytes);
    QVERIFY(bundle.pngBytes <= MaxExportPngBytes);
    QVERIFY(persist("maximum.sprite-export.json", bundle.metadata));
    QFile metadata(directory.filePath("maximum.sprite-export.json"));
    QVERIFY(metadata.open(QIODevice::ReadOnly));
    QCOMPARE(metadata.readAll(), bundle.metadata);
    QJsonObject manifest = QJsonDocument::fromJson(bundle.metadata).object();
    QCOMPARE(manifest["sourceSha256"].toString(), QString::fromLatin1(
        QCryptographicHash::hash(source, QCryptographicHash::Sha256).toHex()));
    QCOMPARE(manifest["animations"].toArray().size(), MaxAnimations);
    qint64 pngBytes = 0;
    for (const ExportFrame &frame : bundle.frames) {
        QVERIFY(persist(frame.fileName, frame.png));
        QFile png(directory.filePath(frame.fileName));
        QVERIFY(png.open(QIODevice::ReadOnly));
        QByteArray bytes = png.readAll();
        QCOMPARE(bytes, frame.png);
        QImage decoded;
        QVERIFY2(decodePng(bytes, decoded, error), qPrintable(error));
        QCOMPARE(decoded, composite(maximum, frame.id));
        pngBytes += bytes.size();
    }
    QCOMPARE(pngBytes, bundle.pngBytes);
    State invalid = maximum;
    invalid.palettes[0].colors.append(Qt::red);
    QByteArray retained("retained");
    QVERIFY(!encodeSource(invalid, retained, error));
    QCOMPARE(retained, QByteArray("retained"));
    invalid = maximum;
    invalid.animations.append(maximum.animations[0]);
    QVERIFY(!encodeSource(invalid, retained, error));
    QVERIFY(!reopened.addFrame(maximum.frames[0].id, true, error));
    QVERIFY(!reopened.addLayer("Overflow", error));
    QVERIFY(!reopened.setPalette({0, "Overflow", {Qt::red}}, error));
    QVERIFY(!reopened.setAnimation({0, "Overflow", frameIds, true}, error));
    QVERIFY(reopened.state() == maximum);
    QCOMPARE(reopened.undoStack()->count(), 0);
}

void SpriteDocumentTest::maximumCompositeBudget()
{
    Document document;
    QString error;
    QVERIFY(document.create({512, 1024}, "Maximum frame payloads", RasterMode::Pixel, error));
    Id frame = document.state().frames[0].id, layer = document.state().layers[0].id;
    QImage pixels = document.cel(frame, layer);
    quint32 random = 0x9e3779b9;
    for (int y = 0; y < pixels.height(); ++y) {
        auto *row = reinterpret_cast<QRgb *>(pixels.scanLine(y));
        for (int x = 0; x < pixels.width(); ++x) {
            random ^= random << 13; random ^= random >> 17; random ^= random << 5;
            row[x] = random;
        }
    }
    QVERIFY(document.setCel(frame, layer, pixels, "High-entropy pixels", error));
    for (int i = 1; i < MaxFrames; ++i) QVERIFY(document.addFrame(frame, true, error, &frame));
    ExportBundle bundle;
    QVERIFY2(document.exportBundle(bundle, error), qPrintable(error));
    QCOMPARE(bundle.frames.size(), MaxFrames);
    QCOMPARE(bundle.compositePixels, MaxCelPixels);
    QVERIFY(bundle.pngBytes > 32 * 1024 * 1024);
    QVERIFY(bundle.pngBytes <= MaxExportPngBytes);
    for (const ExportFrame &exported : bundle.frames) {
        QVERIFY(exported.png.size() <= MaxPngBytes);
        QImage decoded;
        QVERIFY(decodePng(exported.png, decoded, error));
        QCOMPARE(decoded, composite(document.state(), exported.id));
    }
    QVERIFY(!document.addFrame(frame, false, error));
}

void SpriteDocumentTest::rejectsUnsupportedPrecision()
{
    Document document;
    QString error;
    QVERIFY(document.create({2, 2}, "RGBA8 only", RasterMode::Pixel, error));
    State before = document.state();
    Palette palette = before.palettes[0];
    palette.colors[0] = QColor::fromRgbF(0.12345, 0.23456, 0.34567, 0.45678);
    QVERIFY(!document.setPalette(palette, error));
    QImage deep(before.size, QImage::Format_RGBA64);
    deep.fill(Qt::red);
    QVERIFY(!document.setCel(before.frames[0].id, before.layers[0].id, deep, "Unsupported", error));
    QVERIFY(!document.pastePixels(before.frames[0].id, before.layers[0].id, deep, {}, error));
    QByteArray retained("retained");
    QVERIFY(!encodePng(deep, retained, error));
    QCOMPARE(retained, QByteArray("retained"));
    QVERIFY(document.state() == before);
    QCOMPARE(document.undoStack()->count(), 0);
}

QTEST_GUILESS_MAIN(SpriteDocumentTest)
#include "sprite_document_test.moc"
