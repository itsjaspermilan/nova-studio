#include "sound/document.hpp"
#include "sound/render.hpp"
#include "sound_fixture.hpp"

#include <QCryptographicHash>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QtTest>
#include <limits>

using namespace nova::sound;

class SoundDocumentTest final : public QObject {
    Q_OBJECT
private slots:
    void editsUndoAndIdentities();
    void originalsRegionsAndSourceRoundTrip();
    void longOriginalRequiresExplicitRegion();
    void strictSourceAndBudgets();
    void snapshotsAndSaveAcknowledgements();
    void boundedHistoryAndRetainedOwnership();
    void sourceAndDerivedDiskRoundTrip();
};

void SoundDocumentTest::editsUndoAndIdentities()
{
    Document document;
    QString error;
    QVERIFY(document.create(QStringLiteral("Rally FX"), 48000, error));
    Id first = 0;
    QVERIFY(document.addPreset(Preset::Impact, error, &first));
    QCOMPARE(document.state()->layers.size(), size_t(2));
    QCOMPARE(document.undoText(), QStringLiteral("Add Soft impact preset"));
    const Revision revision = document.revision();
    Layer layer = *findLayer(*document.state(), first);
    const Layer original = layer;
    layer.name = QString::fromUtf8("Brake \xc3\xa9" "cho");
    layer.gain = .123456789;
    QVERIFY(document.setLayer(layer, revision, error));
    QVERIFY(document.revision().number > revision.number);
    QVERIFY(!document.setLayer(original, revision, error));
    QVERIFY(error.contains(QStringLiteral("pending")));
    QCOMPARE(findLayer(*document.state(), first)->gain, .123456789);
    QVERIFY(document.undo(error));
    QVERIFY(*findLayer(*document.state(), first) == original);
    QVERIFY(document.redo(error));
    QCOMPARE(findLayer(*document.state(), first)->name, layer.name);
    Id duplicate = 0;
    QVERIFY(document.duplicate(first, error, &duplicate));
    QVERIFY(document.undo(error));
    Id later = 0;
    QVERIFY(document.addTone(NOVA_AUDIO_NOISE, error, &later));
    QVERIFY(later > duplicate);
    QVERIFY(!document.canRedo());
    const auto key = document.revision();
    layer = *findLayer(*document.state(), first);
    QVERIFY(document.setLayer(layer, key, error));
    QCOMPARE(document.revision().number, key.number);
    const auto state = document.state();
    QVERIFY(!document.setSettings(QStringLiteral(""), 48000, 1, error));
    QCOMPARE(document.state(), state);
    QVERIFY(document.setSettings(QStringLiteral("Rally FX"), 44100, .8, error));
    QCOMPARE(document.state()->rate, quint32(44100));
    QVERIFY(validate(*document.state(), error));
}

void SoundDocumentTest::originalsRegionsAndSourceRoundTrip()
{
    QString error;
    Document document;
    QByteArray original = sound_test::wav(8000, 32000, 2, 24);
    const QByteArray expected = original;
    Id id = 0, media = 0;
    QVERIFY2(document.importWav(QByteArray::fromRawData(original.constData(), original.size()),
                               QStringLiteral("Gravel"), error, &id, &media), qPrintable(error));
    original.fill('x');
    QCOMPARE(findMedia(*document.state(), media)->data->wav(), expected);
    QVERIFY(document.trim(id, 17, 7991, error));
    Layer layer = *findLayer(*document.state(), id);
    layer.fadeIn = 37; layer.fadeOut = 53; layer.reverse = true; layer.gain = .37;
    QVERIFY(document.setLayer(layer, document.revision(), error));
    const auto edited = document.state();
    QByteArray source;
    QVERIFY(encodeSource(*edited, source, error));
    Document reopened;
    QVERIFY2(reopened.load(source, error), qPrintable(error));
    QVERIFY(sameContent(*edited, *reopened.state()));
    QCOMPARE(reopened.state()->uuid, document.state()->uuid);
    QCOMPARE(reopened.state()->nextId, document.state()->nextId);
    QCOMPARE(reopened.state()->media.front().data->wav(), expected);
    QByteArray again;
    QVERIFY(encodeSource(*reopened.state(), again, error));
    QCOMPARE(source, again);
    QVERIFY(document.undo(error));
    QVERIFY(!findLayer(*document.state(), id)->reverse);
    QVERIFY(document.undo(error));
    QCOMPARE(findLayer(*document.state(), id)->begin, quint32(0));
    QCOMPARE(findLayer(*document.state(), id)->end, quint32(8000));
    QCOMPARE(document.state()->media.front().data->wav(), expected);
    QVERIFY(document.redo(error)); QVERIFY(document.redo(error));
    QVERIFY(sameContent(*edited, *document.state()));
    QVERIFY(!document.removeMedia(media, error));
    QVERIFY(document.removeLayer(id, error));
    QVERIFY(document.removeMedia(media, error));
    QVERIFY(document.undo(error));
    QCOMPARE(document.state()->media.front().data->wav(), expected);
}

void SoundDocumentTest::longOriginalRequiresExplicitRegion()
{
    Document document;
    QString error;
    const QByteArray original = sound_test::wav(8000 * 60, 8000, 1, 16);
    Id layer = 999, media = 0;
    QVERIFY(document.importWav(original, QStringLiteral("Long short-effect original"), error, &layer, &media));
    QCOMPARE(layer, Id(0));
    QVERIFY(document.state()->layers.empty());
    QCOMPARE(document.state()->media.front().data->wav(), original);
    QVERIFY(!document.addSample(media, error));
    QVERIFY(error.contains(QStringLiteral("explicit region")));
    QVERIFY(!document.addSampleRegion(media, 0, 8000 * 30 + 1, error));
    QVERIFY(document.state()->layers.empty());
    QVERIFY(document.addSampleRegion(media, 8001, 8000 * 30 + 8001, error, &layer));
    QCOMPARE(layerFrames(*document.state(), document.state()->layers.front()), quint32(48000 * 30));
    QCOMPARE(document.state()->layers.front().begin, quint32(8001));
    const auto source = sourceValue(document.snapshot(), error);
    QVERIFY(source);
    Document reopened;
    QVERIFY(reopened.load(source->bytes, error));
    QCOMPARE(reopened.state()->media.front().data->wav(), original);
    QCOMPARE(reopened.state()->layers.front().begin, quint32(8001));
    QCOMPARE(reopened.state()->layers.front().end, quint32(248001));
    QVERIFY(document.undo(error));
    QCOMPARE(document.state()->media.front().data->wav(), original);
    const auto retained = document.state();
    QVERIFY(!document.importWav(sound_test::wav(1, 8000, 1, 16), QStringLiteral("Over aggregate"), error));
    QCOMPARE(document.state(), retained);
    QVERIFY(!document.importWav(sound_test::wav(8000 * 60 + 1, 8000, 1, 16), QStringLiteral("Too long"), error));
    Document tiny;
    const QByteArray oneFrame = sound_test::wav(1, 48000, 1, 16);
    QVERIFY(tiny.importWav(oneFrame, QStringLiteral("One valid original frame"), error, &layer, &media));
    QCOMPARE(layer, Id(0));
    QCOMPARE(tiny.state()->media.front().data->wav(), oneFrame);
    QVERIFY(!tiny.addSample(media, error));
    QVERIFY(error.contains(QStringLiteral("two output frames")));
}

static void rewriteU32(QByteArray &bytes, qsizetype at, quint32 value)
{
    for (int byte = 0; byte < 4; ++byte) bytes[at + byte] = char((value >> (byte * 8)) & 255);
    const QByteArray checksum = QCryptographicHash::hash(bytes.first(bytes.size() - 32), QCryptographicHash::Sha256);
    bytes.replace(bytes.size() - 32, 32, checksum);
}

void SoundDocumentTest::strictSourceAndBudgets()
{
    Document document;
    QString error;
    QVERIFY(document.addTone(NOVA_AUDIO_SINE, error));
    QByteArray source;
    QVERIFY(encodeSource(*document.state(), source, error));
    const auto before = document.state();
    for (qsizetype length : {qsizetype(0), qsizetype(8), qsizetype(39), source.size() - 1}) {
        QVERIFY(!document.load(source.first(length), error));
        QVERIFY(!error.isEmpty()); QCOMPARE(document.state(), before);
    }
    QByteArray corrupt = source;
    corrupt[20] = char(corrupt[20] ^ 1);
    QVERIFY(!document.load(corrupt, error));
    corrupt = source; rewriteU32(corrupt, 8, 2);
    QVERIFY(!document.load(corrupt, error));
    corrupt = source; rewriteU32(corrupt, 12, 1);
    QVERIFY(!document.load(corrupt, error));
    const qsizetype rateAt = 16 + 4 + before->uuid.toUtf8().size() + 4 + before->name.toUtf8().size();
    corrupt = source; rewriteU32(corrupt, rateAt, 96000);
    QVERIFY(!document.load(corrupt, error));
    corrupt = source; rewriteU32(corrupt, rateAt + 16, 0xffffffffu);
    QVERIFY(!document.load(corrupt, error));
    QByteArray oversized(MaxSourceBytes + 1, '\0');
    QVERIFY(!document.load(oversized, error));
    State bad = *before;
    bad.layers.front().gain = std::numeric_limits<double>::quiet_NaN();
    QByteArray output("retained");
    QVERIFY(!encodeSource(bad, output, error)); QCOMPARE(output, QByteArray("retained"));
    bad = *before; bad.layers.front().attack = bad.layers.front().duration;
    QVERIFY(!validate(bad, error));
    bad = *before; bad.layers.push_back(bad.layers.front());
    QVERIFY(!validate(bad, error));
    for (int i = 1; i < MaxLayers; ++i) QVERIFY(document.addTone(NOVA_AUDIO_NOISE, error));
    const auto atCapacity = document.state();
    QVERIFY(!document.addTone(NOVA_AUDIO_SINE, error)); QCOMPARE(document.state(), atCapacity);
    QVERIFY(!document.addPreset(Preset::Impact, error)); QCOMPARE(document.state(), atCapacity);
    QVERIFY(!WaveData::fromWav(QByteArray(MaxWavBytes + 1, '\0'), error));
    QVERIFY(!WaveData::fromWav(sound_test::wav(4, 48000, 1, 32, [](quint32, quint32) { return 17.0f; }), error));
    Document first, second;
    QVERIFY(first.addTone(NOVA_AUDIO_SINE, error));
    QVERIFY(second.addTone(NOVA_AUDIO_SINE, error));
    Layer foreign = first.state()->layers.front();
    foreign.gain = .6;
    QVERIFY(!second.setLayer(foreign, first.revision(), error));
    QVERIFY(encodeSource(*first.state(), source, error));
    QVERIFY(first.load(source, error));
    const Revision beforeReopen = first.revision();
    QVERIFY(first.load(source, error));
    QCOMPARE(first.revision().number, beforeReopen.number);
    QVERIFY(!first.setLayer(foreign, beforeReopen, error));
}

void SoundDocumentTest::snapshotsAndSaveAcknowledgements()
{
    QString error;
    SnapshotPtr retained;
    SourcePtr saved;
    {
        Document document;
        QVERIFY(document.addPreset(Preset::Confirm, error));
        retained = document.snapshot();
        saved = sourceValue(retained, error);
        QVERIFY(saved);
        QVERIFY(document.markPersisted(*saved, SaveIntent::SourceOnly, nullptr, error));
        QVERIFY(!document.dirty()); QVERIFY(document.derivedStale());
        const auto derived = render(retained, {NOVA_AUDIO_WAV_FLOAT32, false, 1}, error);
        QVERIFY2(derived, qPrintable(error));
        QVERIFY(!document.markPersisted(*saved, SaveIntent::SourceOnly, derived.get(), error));
        QVERIFY(document.markPersisted(*saved, SaveIntent::PublishDerived, derived.get(), error));
        QVERIFY(!document.derivedStale());
        Layer renamed = document.state()->layers.front();
        renamed.name = QStringLiteral("Temporary name");
        QVERIFY(document.setLayer(renamed, document.revision(), error));
        QVERIFY(document.undo(error));
        QVERIFY(!document.dirty()); QVERIFY(!document.derivedStale());
        Id id = 0;
        QVERIFY(document.addTone(NOVA_AUDIO_NOISE, error, &id));
        QVERIFY(!document.markPersisted(*saved, SaveIntent::SourceOnly, nullptr, error));
        QVERIFY(document.dirty()); QVERIFY(document.derivedStale());
        const auto newer = sourceValue(document.snapshot(), error);
        QVERIFY(newer);
        QVERIFY(!document.markPersisted(*newer, SaveIntent::PublishDerived, derived.get(), error));
        QVERIFY(document.markPersisted(*newer, SaveIntent::SourceOnly, nullptr, error));
        QVERIFY(!document.dirty()); QVERIFY(document.derivedStale());
        QVERIFY(document.undo(error));
        // Reserved stable IDs remain advanced after undo, so source metadata is stale.
        QVERIFY(document.derivedStale());
        QVERIFY(document.dirty());
        QVERIFY(document.load(saved->bytes, error));
        QVERIFY(!document.markPersisted(*saved, SaveIntent::SourceOnly, nullptr, error));
        QVERIFY(!document.dirty());
    }
    QVERIFY(retained);
    QCOMPARE(retained->state->layers.size(), size_t(2));
    const auto rendered = render(retained, {NOVA_AUDIO_WAV_PCM24, true, 1949}, error);
    QVERIFY2(rendered, qPrintable(error));
    Document foreign;
    QVERIFY(foreign.load(saved->bytes, error));
    QVERIFY(!foreign.markPersisted(*saved, SaveIntent::PublishDerived, rendered.get(), error));
}

void SoundDocumentTest::boundedHistoryAndRetainedOwnership()
{
    Document document;
    QString error;
    QSignalSpy trimmed(&document, &Document::historyTrimmed);
    const QByteArray original = sound_test::wav(48000 * 12);
    SnapshotPtr old;
    for (int i = 0; i < 15; ++i) {
        Id layer = 0, media = 0;
        QVERIFY2(document.importWav(original, QStringLiteral("Original %1").arg(i), error, &layer, &media), qPrintable(error));
        if (i == 0) old = document.snapshot();
        QVERIFY(document.removeLayer(layer, error));
        QVERIFY(document.removeMedia(media, error));
        QVERIFY(document.historyBytes() <= MaxHistoryBytes);
    }
    QVERIFY(!trimmed.isEmpty());
    QCOMPARE(old->state->media.front().data->wav(), original);
    const quint32 fillerFrames = quint32((MaxHistoryBytes - document.historyBytes() - 8192) / 16);
    QVERIFY(fillerFrames > 0 && fillerFrames < 48000 * MaxSeconds);
    QVERIFY(document.importWav(sound_test::wav(fillerFrames), QStringLiteral("Near history bound"), error));
    QVERIFY(document.historyBytes() <= MaxHistoryBytes);
    QVERIFY(MaxHistoryBytes - document.historyBytes() < 4096);
    QVERIFY(document.undo(error));
    QVERIFY(document.historyBytes() <= MaxHistoryBytes);
    int undos = 0;
    while (document.canUndo()) {
        QVERIFY(document.undo(error));
        QVERIFY(document.historyBytes() <= MaxHistoryBytes);
        ++undos;
    }
    QVERIFY(undos <= MaxHistoryCommands);
    while (document.canRedo()) {
        QVERIFY(document.redo(error));
        QVERIFY(document.historyBytes() <= MaxHistoryBytes);
    }
    Document small;
    QVERIFY(small.addTone(NOVA_AUDIO_SINE, error));
    for (int i = 0; i < 90; ++i) {
        Layer layer = small.state()->layers.front();
        layer.name = QStringLiteral("Tone %1").arg(i);
        QVERIFY(small.setLayer(layer, small.revision(), error));
    }
    undos = 0;
    while (small.canUndo()) { QVERIFY(small.undo(error)); ++undos; }
    QCOMPARE(undos, MaxHistoryCommands);
}

void SoundDocumentTest::sourceAndDerivedDiskRoundTrip()
{
    QString error;
    Document document;
    Id id = 0;
    QVERIFY(document.importWav(sound_test::wav(4410, 44100, 1, 24), QStringLiteral("Mono original"), error, &id));
    Layer layer = *findLayer(*document.state(), id);
    layer.begin = 81; layer.end = 4399; layer.reverse = true; layer.fadeIn = 100; layer.fadeOut = 401;
    QVERIFY(document.setLayer(layer, document.revision(), error));
    const auto output = render(document.snapshot(), {NOVA_AUDIO_WAV_PCM24, true, 7331}, error);
    QVERIFY2(output, qPrintable(error));
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    for (const auto &entry : std::initializer_list<std::pair<QString, QByteArray>>{
             {QStringLiteral("effect.nova-sound"), output->source->bytes},
             {QStringLiteral("effect.wav"), output->wav}, {QStringLiteral("effect.json"), output->metadata}}) {
        QSaveFile file(directory.filePath(entry.first));
        QVERIFY(file.open(QIODevice::WriteOnly)); QCOMPARE(file.write(entry.second), entry.second.size()); QVERIFY(file.commit());
    }
    QFile source(directory.filePath(QStringLiteral("effect.nova-sound")));
    QVERIFY(source.open(QIODevice::ReadOnly));
    Document reopened;
    QVERIFY(reopened.load(source.readAll(), error));
    const auto again = render(reopened.snapshot(), output->settings, error);
    QVERIFY2(again, qPrintable(error));
    QCOMPARE(again->wav, output->wav);
    const auto metadata = QJsonDocument::fromJson(again->metadata).object();
    QCOMPARE(metadata.value(QStringLiteral("source_sha256")).toString(), QString::fromLatin1(again->source->sha256.toHex()));
    QCOMPARE(metadata.value(QStringLiteral("frames")).toInt(), int(again->frames));
    QCOMPARE(again->waveform->info().bits, quint32(24));
    QCOMPARE(again->waveform->info().sample.channels, quint32(2));
}

QTEST_GUILESS_MAIN(SoundDocumentTest)
#include "sound_document_test.moc"
