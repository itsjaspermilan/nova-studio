#include "project_document.h"
#include "sound/render.hpp"

#include <QCryptographicHash>
#include <QFile>
#include <QTemporaryDir>
#include <QtEndian>
#include <QtTest>

extern "C" {
#include "assets.h"
}

namespace {

QByteArray readFile(const QString &path)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) return {};
    return file.readAll();
}

bool captureVersions(ProjectDocument &document, StudioAssetSnapshot &snapshot, QString &error)
{
    QByteArray previous;
    if (!document.readAssetFile(snapshot.source.path, &previous, &snapshot.source.expected, &error)) return false;
    for (auto &file : snapshot.outputs)
        if (!document.readAssetFile(file.path, &previous, &file.expected, &error)) return false;
    return true;
}

} // namespace

class QtSoundHostTest final : public QObject {
    Q_OBJECT
private slots:
    void realSourceAndWavPublication_data()
    {
        QTest::addColumn<bool>("floating");
        QTest::newRow("default-pcm24") << false;
        QTest::newRow("float32") << true;
    }

    void realSourceAndWavPublication()
    {
        namespace sound = nova::sound;
        QFETCH(bool, floating);
        QVERIFY(!IsAudioDeviceReady());
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-sound-host-XXXXXX");
        QVERIFY(temporary.isValid());
        QString error, manifest;
        sound::ExportPtr output;
        sound::SourcePtr revised;
        {
            ProjectDocument project;
            QVERIFY2(project.create(temporary.path(), "Sound publication", false, NOVA_EXAMPLES, &error), qPrintable(error));
            manifest = project.path();
            sound::Document document;
            QVERIFY2(document.create("Rally brake", 48000, error), qPrintable(error));
            QVERIFY2(document.addPreset(sound::Preset::AirBrake, error), qPrintable(error));
            sound::ExportSettings settings;
            if (floating) {
                settings.format = NOVA_AUDIO_WAV_FLOAT32;
                settings.dither = false;
            }
            output = sound::render(document.snapshot(), settings, error);
            QVERIFY2(output, qPrintable(error));
            QCOMPARE(qFromLittleEndian<quint16>(output->wav.constData() + 20), quint16(floating ? 3 : 1));
            QCOMPARE(qFromLittleEndian<quint16>(output->wav.constData() + 34), quint16(floating ? 32 : 24));

            StudioAssetSnapshot snapshot;
            snapshot.id = "rally-brake"; snapshot.kind = "sound";
            snapshot.revision = output->source->snapshot->revision.number;
            snapshot.metadata = {{"document", output->source->snapshot->revision.document}};
            snapshot.source.path = "brake.nova-sound"; snapshot.source.bytes = output->source->bytes;
            StudioAssetFile wav;
            wav.path = "brake.wav"; wav.bytes = output->wav;
            wav.runtimeId = "brake"; wav.runtimeType = NOVA_ASSET_AUDIO;
            StudioAssetFile metadata;
            metadata.path = "brake.json"; metadata.bytes = output->metadata;
            snapshot.outputs = {wav, metadata};
            QVERIFY2(captureVersions(project, snapshot, error), qPrintable(error));
            QVERIFY2(project.stageAssetSnapshot(snapshot, &error), qPrintable(error));
            const auto normalized = project.assetSnapshots().front();
            const auto digest = ProjectDocument::assetSnapshotDigest(normalized);
            QVERIFY2(project.save(&error), qPrintable(error));
            QVERIFY(project.isAssetSnapshotSaved(snapshot.id, snapshot.revision, digest));
            QVERIFY2(project.runtimeAssetsReady(&error), qPrintable(error));
            QVERIFY2(document.markPersisted(*output->source, sound::SaveIntent::PublishDerived, output.get(), error), qPrintable(error));
            QVERIFY(!document.dirty());
            QVERIFY(!document.derivedStale());
            QCOMPARE(readFile(project.root() + "/" + wav.path), output->wav);
            QCOMPARE(readFile(project.root() + "/" + metadata.path), output->metadata);
            QCOMPARE(project.assetPublication(snapshot.id).sourceDigest,
                QCryptographicHash::hash(output->source->bytes, QCryptographicHash::Sha256).toHex());

            NovaProjectValidation validation{};
            char detail[1024]{};
            QVERIFY2(nova_validate_project(manifest.toUtf8().constData(), &validation, detail, sizeof(detail)), detail);
            const NovaAssetInspection *audio = nullptr;
            for (size_t i = 0; i < validation.project.count; ++i)
                if (validation.assets[i].declaration.type == NOVA_ASSET_AUDIO) audio = &validation.assets[i];
            QVERIFY(audio);
            QCOMPARE(audio->sample_rate, output->rate);
            QCOMPARE(audio->sample_frames, output->frames);
            QCOMPARE(audio->channels, 2u);
            QVERIFY(!IsAudioDeviceReady());

            QVERIFY2(document.setSettings("Revised brake", 48000, 0.6, error), qPrintable(error));
            revised = sound::sourceValue(document.snapshot(), error);
            QVERIFY2(revised, qPrintable(error));
            snapshot = project.assetSnapshots().front();
            snapshot.revision = revised->snapshot->revision.number;
            snapshot.source.bytes = revised->bytes;
            snapshot.mode = StudioAssetSnapshot::Mode::SourceOnly;
            snapshot.derivedProblem = "Current source has not been published.";
            snapshot.outputs.clear();
            QVERIFY2(project.stageAssetSnapshot(snapshot, &error), qPrintable(error));
            const auto sourceOnly = project.assetSnapshots().front();
            const auto sourceDigest = ProjectDocument::assetSnapshotDigest(sourceOnly);
            QVERIFY2(project.save(&error), qPrintable(error));
            QVERIFY(project.isAssetSnapshotSaved(snapshot.id, snapshot.revision, sourceDigest));
            QVERIFY2(document.markPersisted(*revised, sound::SaveIntent::SourceOnly, nullptr, error), qPrintable(error));
            QVERIFY(!document.dirty());
            QVERIFY(document.derivedStale());
            QVERIFY(!project.runtimeAssetsReady(&error));
            QVERIFY(!document.markPersisted(*output->source, sound::SaveIntent::PublishDerived, output.get(), error));
            QCOMPARE(readFile(project.root() + "/" + wav.path), output->wav);
            QCOMPARE(readFile(project.root() + "/" + metadata.path), output->metadata);
            QCOMPARE(project.assetPublication(snapshot.id).revision, output->source->snapshot->revision.number);
        }
        ProjectDocument reopened;
        QVERIFY2(reopened.open(manifest, &error), qPrintable(error));
        const auto restored = reopened.assetSnapshots().front();
        QCOMPARE(restored.source.bytes, revised->bytes);
        QCOMPARE(restored.outputs.size(), 2);
        QCOMPARE(restored.outputs[0].bytes, output->wav);
        QVERIFY(reopened.assetPublication(restored.id).saved);
        QVERIFY(reopened.assetPublication(restored.id).stale);
        QVERIFY(!reopened.runtimeAssetsReady(&error));
        sound::Document document;
        QVERIFY2(document.load(restored.source.bytes, error), qPrintable(error));
        QVERIFY(!document.dirty());
        QVERIFY(document.derivedStale());
        QVERIFY(!document.markPersisted(*revised, sound::SaveIntent::SourceOnly, nullptr, error));
        QVERIFY(!IsAudioDeviceReady());
    }
};

QTEST_GUILESS_MAIN(QtSoundHostTest)
#include "qt_sound_host_test.moc"
