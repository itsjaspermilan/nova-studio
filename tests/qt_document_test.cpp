#include "project_document.h"
#include <QCryptographicHash>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTemporaryDir>
#include <QtEndian>
#include <QtTest>
#include <cstring>
#include <unistd.h>

extern "C" {
#include "document.h"
#include "inspect.h"
}

static QByteArray readFile(const QString &path)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) return {};
    return file.readAll();
}

static bool writeFile(const QString &path, const QByteArray &bytes)
{
    QFile file(path);
    return file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size() && file.flush();
}

static QByteArray sha256(const QByteArray &bytes)
{
    return QCryptographicHash::hash(bytes, QCryptographicHash::Sha256).toHex();
}

static bool expectedVersions(ProjectDocument &document, StudioAssetSnapshot *snapshot, QString *error)
{
    QByteArray ignored;
    if (!document.readAssetFile(snapshot->source.path, &ignored, &snapshot->source.expected, error)) return false;
    for (auto &file : snapshot->outputs)
        if (!document.readAssetFile(file.path, &ignored, &file.expected, error)) return false;
    return true;
}

static QByteArray pcmWav(quint32 frames = 240)
{
    const quint32 dataBytes = frames * 4;
    QByteArray bytes(44 + qsizetype(dataBytes), '\0');
    bytes.replace(0, 4, "RIFF");
    qToLittleEndian<quint32>(36 + dataBytes, bytes.data() + 4);
    bytes.replace(8, 8, "WAVEfmt ");
    qToLittleEndian<quint32>(16, bytes.data() + 16);
    qToLittleEndian<quint16>(1, bytes.data() + 20);
    qToLittleEndian<quint16>(2, bytes.data() + 22);
    qToLittleEndian<quint32>(48000, bytes.data() + 24);
    qToLittleEndian<quint32>(48000 * 4, bytes.data() + 28);
    qToLittleEndian<quint16>(4, bytes.data() + 32);
    qToLittleEndian<quint16>(16, bytes.data() + 34);
    bytes.replace(36, 4, "data");
    qToLittleEndian<quint32>(dataBytes, bytes.data() + 40);
    return bytes;
}

static StudioAssetSnapshot assetSnapshot(NovaAssetType type = NOVA_ASSET_SPRITE, const QString &id = "authored")
{
    StudioAssetSnapshot snapshot;
    snapshot.id = id; snapshot.kind = type == NOVA_ASSET_AUDIO ? "sound" : type == NOVA_ASSET_MODEL ? "mesh" : "sprite";
    snapshot.revision = 17;
    snapshot.metadata = {{"name", "Authored asset"}, {"componentVersion", 1}};
    snapshot.source.path = type == NOVA_ASSET_AUDIO ? "sources/authored.sound-source" :
        type == NOVA_ASSET_MODEL ? "sources/authored.nvmesh" : "sources/authored.nvsprite";
    snapshot.source.bytes = QByteArray("component-owned\0source", 22);
    StudioAssetFile output;
    output.path = type == NOVA_ASSET_AUDIO ? "generated/authored/sound.wav" :
        type == NOVA_ASSET_MODEL ? "generated/authored/mesh.glb" : "generated/authored/frame-1.png";
    output.runtimeId = "authored_output";
    output.runtimeType = type;
    output.bytes = type == NOVA_ASSET_AUDIO ? pcmWav() :
        readFile(QString(NOVA_EXAMPLES) + (type == NOVA_ASSET_MODEL ? "/assets/assets/gem.glb" : "/sprites/assets/token.png"));
    snapshot.outputs.append(output);
    if (type == NOVA_ASSET_AUDIO) {
        StudioAssetFile metadata;
        metadata.path = "generated/authored/sound.json";
        metadata.bytes = "{\"format\":\"sound-storage-fixture\",\"frames\":240}";
        snapshot.outputs.append(metadata);
    }
    snapshot.source.path.replace("authored", id);
    for (auto &file : snapshot.outputs) {
        file.path.replace("authored", id);
        file.runtimeId.replace("authored", id);
    }
    return snapshot;
}

class DocumentTest final : public QObject {
    Q_OBJECT
private slots:
    void rotationVersionUpgradeAndRecovery()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-rotation-XXXXXX");
        QVERIFY(temporary.isValid());
        QString error, path;
        QByteArray script, rotated;
        {
            ProjectDocument document;
            QVERIFY2(document.create(temporary.path(), "Rotations", true, NOVA_EXAMPLES, &error), qPrintable(error));
            path = document.path();
            script = document.draft().script;
            const auto v1 = document.draft().scene;
            QCOMPARE(document.scene().version, 1u);
            auto scene = document.scene();
            QVERIFY(document.editScene(scene, "player", "Unchanged", &error));
            QCOMPARE(document.undoStack()->count(), 0);
            QCOMPARE(document.draft().scene, v1);
            scene.objects[0].rotation = {23, -61, 117};
            QVERIFY(!document.editScene(scene, "player", "Missing explicit upgrade", &error));
            QCOMPARE(document.draft().scene, v1);
            scene.version = 2;
            QVERIFY2(document.editScene(scene, "player", "Rotate object", &error), qPrintable(error));
            rotated = document.draft().scene;
            QVERIFY(rotated.startsWith("nova-scene 2\n"));
            QCOMPARE(document.undoStack()->count(), 1);
            QCOMPARE(document.scene().objects[0].rotation.y, -61.f);
            QCOMPARE(document.draft().script, script);
            document.undoStack()->undo();
            QCOMPARE(document.draft().scene, v1);
            QCOMPARE(document.scene().version, 1u);
            document.undoStack()->redo();
            QCOMPARE(document.draft().scene, rotated);
            QVERIFY(document.writeRecovery(&error));
        }
        {
            ProjectDocument document;
            QVERIFY(document.open(path, &error));
            QCOMPARE(document.scene().version, 1u);
            QVERIFY(document.restoreRecovery(&error));
            QCOMPARE(document.draft().scene, rotated);
            QCOMPARE(document.draft().script, script);
            QVERIFY2(document.save(&error), qPrintable(error));
            NovaProjectValidation validation{};
            char detail[1024]{};
            QVERIFY2(nova_validate_project(path.toUtf8().constData(), &validation, detail, sizeof(detail)), detail);
        }
        ProjectDocument reopened;
        QVERIFY(reopened.open(path, &error));
        QCOMPARE(reopened.scene().version, 2u);
        QCOMPARE(reopened.scene().objects[0].rotation.x, 23.f);
        QCOMPARE(reopened.scene().objects[0].rotation.y, -61.f);
        QCOMPARE(reopened.scene().objects[0].rotation.z, 117.f);
        QCOMPARE(reopened.draft().script, script);
        auto scene = reopened.scene();
        scene.objects[0].rotation = {};
        QVERIFY(reopened.editScene(scene, "player", "Reset rotation", &error));
        QCOMPARE(reopened.scene().version, 2u); // No silent downgrade after a deliberate upgrade.
    }

    void sceneAndScriptOwnership_data()
    {
        QTest::addColumn<bool>("threeD");
        QTest::newRow("2d") << false;
        QTest::newRow("3d") << true;
    }

    void sceneAndScriptOwnership()
    {
        QFETCH(bool, threeD);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-doc-XXXXXX");
        QVERIFY(temporary.isValid());
        QString error, path;
        QByteArray script;
        {
            ProjectDocument document;
            QVERIFY2(document.create(temporary.path(), QString::fromUtf8("Cr\xc3\xa9" "ation"), threeD, NOVA_EXAMPLES, &error), qPrintable(error));
            path = document.path();
            script = document.draft().script;
            NovaScene scene = document.scene();
            scene.objects[0].position.x = 42;
            QVERIFY2(document.editScene(scene, "player", "Move Player", &error), qPrintable(error));
            QCOMPARE(document.draft().script, script);
            QVERIFY(document.dirty());
            document.undoStack()->undo();
            QVERIFY(!document.dirty());
            document.undoStack()->redo();
            QCOMPARE(document.scene().objects[0].position.x, 42.f);
            QVERIFY2(document.save(&error), qPrintable(error));
            QVERIFY(!document.dirty());
            QCOMPARE(readFile(document.root() + "/main.lua"), script);
            document.undoStack()->undo();
            QVERIFY(document.dirty());
            document.undoStack()->redo();
            QVERIFY(!document.dirty());
            NovaProjectValidation validation{};
            char detail[1024] = {};
            QVERIFY2(nova_validate_project(path.toUtf8().constData(), &validation, detail, sizeof(detail)), detail);
            QCOMPARE(validation.project.version, 3u);
            QCOMPARE(QByteArray(validation.project.scene), QByteArray("start.nova-scene"));
            QVERIFY(!document.create(temporary.path(), QString::fromUtf8("Cr\xc3\xa9" "ation"), threeD, NOVA_EXAMPLES, &error));
            QCOMPARE(document.path(), path);
        }
        ProjectDocument reopened;
        QVERIFY2(reopened.open(path, &error), qPrintable(error));
        QCOMPARE(reopened.scene().objects[0].position.x, 42.f);
        QCOMPARE(reopened.draft().script, script);
        QVERIFY(!QFileInfo::exists(reopened.root() + "/.nova-studio-journal"));
    }

    void externalConflictAndDraftRecovery()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-conflict-XXXXXX");
        QString error, path, root;
        QByteArray before;
        {
            ProjectDocument document;
            QVERIFY2(document.create(temporary.path(), "Recovery", false, NOVA_EXAMPLES, &error), qPrintable(error));
            path = document.path(); root = document.root();
            before = document.draft().script;
            QVERIFY(document.editScript(QString::fromUtf8(before) + "\n-- unsaved \xe6\x97\xa5\xe6\x9c\xac\n", &error));
            QVERIFY(document.writeRecovery(&error));
            QVERIFY(writeFile(root + "/main.lua", before + "-- external\n"));
            QVERIFY(!document.save(&error));
            QCOMPARE(readFile(root + "/main.lua"), before + "-- external\n");
            QVERIFY(document.dirty());
            QVERIFY(document.comparison().contains("-- unsaved"));
            QVERIFY(document.comparison().contains("-- external"));
        }
        {
            ProjectDocument reopened;
            QVERIFY(reopened.open(path, &error));
            QVERIFY(!reopened.recoveryDescription().isEmpty());
            QVERIFY(!reopened.restoreRecovery(&error));
            QVERIFY(error.contains("External edits"));
            const auto recovery = readFile(root + "/.nova-studio-recovery");
            QVERIFY(reopened.editScript(QString::fromUtf8(reopened.draft().script) + "-- new\n", &error));
            QVERIFY(!reopened.writeRecovery(&error));
            QCOMPARE(readFile(root + "/.nova-studio-recovery"), recovery);
        }
        QVERIFY(writeFile(root + "/main.lua", before));
        ProjectDocument recovered;
        QVERIFY(recovered.open(path, &error));
        QVERIFY2(recovered.restoreRecovery(&error), qPrintable(error));
        QVERIFY(recovered.draft().script.contains("-- unsaved"));
        QVERIFY(recovered.dirty());
        recovered.undoStack()->undo();
        QCOMPARE(recovered.draft().script, before);
        recovered.undoStack()->redo();
        QVERIFY2(recovered.save(&error), qPrintable(error));
        QVERIFY(!QFileInfo::exists(root + "/.nova-studio-recovery"));
    }

    void recoveryPreservesSupportedHiddenPaths()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-hidden-XXXXXX");
        QString error, root, path;
        {
            ProjectDocument initial;
            QVERIFY(initial.create(temporary.path(), "Hidden", false, NOVA_EXAMPLES, &error));
            root = initial.root();
        }
        QByteArray manifest = readFile(root + "/nova.project");
        manifest.replace("main.lua", ".nova-main.lua");
        manifest.replace("start.nova-scene", ".nova-start.nova-scene");
        path = root + "/.nova-project.project";
        QVERIFY(QFile::rename(root + "/main.lua", root + "/.nova-main.lua"));
        QVERIFY(QFile::rename(root + "/start.nova-scene", root + "/.nova-start.nova-scene"));
        QVERIFY(writeFile(path, manifest));
        {
            ProjectDocument document;
            QVERIFY2(document.open(path, &error), qPrintable(error));
            QVERIFY(document.editScript(QString::fromUtf8(document.draft().script) + "-- retained hidden source\n", &error));
            QVERIFY(document.writeRecovery(&error));
        }
        ProjectDocument reopened;
        QVERIFY(reopened.open(path, &error));
        QVERIFY2(reopened.restoreRecovery(&error), qPrintable(error));
        QVERIFY(reopened.draft().script.contains("-- retained hidden source"));
        QVERIFY2(reopened.save(&error), qPrintable(error));
        QVERIFY(readFile(root + "/.nova-main.lua").contains("-- retained hidden source"));
    }

    void interruptedSaveAndNoClobberRecovery()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-commit-XXXXXX");
        QString error, path, root;
        {
            ProjectDocument initial;
            QVERIFY(initial.create(temporary.path(), "Commit", false, NOVA_EXAMPLES, &error));
            path = initial.path(); root = initial.root();
        }
        QVERIFY(QFile::setPermissions(root + "/main.lua", QFile::ReadOwner | QFile::ReadGroup | QFile::ReadOther));
        QByteArray script;
        {
            ProjectDocument document;
            QVERIFY(document.open(path, &error));
            NovaScene scene = document.scene();
            scene.objects[0].position.x = 73;
            QVERIFY(document.editScene(scene, "player", "Move Player", &error));
            QVERIFY(document.editScript(QString::fromUtf8(document.draft().script) + "-- next\n", &error));
            script = document.draft().script;
            QVERIFY(!document.save(&error));
            QVERIFY2(error.contains("after 1 writes"), qPrintable(error));
            QVERIFY(document.dirty());
            QVERIFY(QFileInfo::exists(root + "/.nova-studio-journal"));
            NovaProjectValidation validation{};
            char detail[1024] = {};
            QVERIFY(!nova_validate_project(path.toUtf8().constData(), &validation, detail, sizeof(detail)));
            QVERIFY(QByteArray(detail).contains("interrupted Studio save"));
        }
        QVERIFY(QFile::setPermissions(root + "/main.lua", QFile::ReadOwner | QFile::WriteOwner));
        const QByteArray oldScript = readFile(root + "/main.lua");
        QVERIFY(writeFile(root + "/main.lua", "-- intervening editor\n"));
        const auto savedScene = readFile(root + "/start.nova-scene");
        QVERIFY(!ProjectDocument::finishInterruptedSave(path, &error));
        QCOMPARE(readFile(root + "/main.lua"), QByteArray("-- intervening editor\n"));
        QCOMPARE(readFile(root + "/start.nova-scene"), savedScene);
        QVERIFY(writeFile(root + "/main.lua", oldScript));
        QVERIFY2(ProjectDocument::finishInterruptedSave(path, &error), qPrintable(error));
        QCOMPARE(readFile(root + "/main.lua"), script);
        QVERIFY(!QFileInfo::exists(root + "/.nova-studio-journal"));
        ProjectDocument reopened;
        QVERIFY2(reopened.open(path, &error), qPrintable(error));
        QCOMPARE(reopened.scene().objects[0].position.x, 73.f);
    }

    void importUndoAndMalformedRecovery()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-import-XXXXXX");
        QString error, id, path, root;
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "Imports", false, NOVA_EXAMPLES, &error));
            path = document.path(); root = document.root();
            QVERIFY(document.importAsset(QString(NOVA_EXAMPLES) + "/sprites/assets/tile.png", &id, &error));
            QCOMPARE(document.project().count, size_t(2));
            const QString copy = root + "/" + QString::fromUtf8(document.project().assets[1].path);
            QVERIFY(QFileInfo::exists(copy));
            document.undoStack()->undo();
            QCOMPARE(document.project().count, size_t(1));
            QVERIFY(QFileInfo::exists(copy));
            document.undoStack()->redo();
            QVERIFY(document.writeRecovery(&error));
            ProjectDocument second;
            QVERIFY(!second.open(path, &error));
        }
        auto json = QJsonDocument::fromJson(readFile(root + "/.nova-studio-recovery")).object();
        auto entries = json["files"].toArray();
        auto entry = entries[0].toObject();
        entry["path"] = "../outside.lua";
        entries[0] = entry; json["files"] = entries;
        QVERIFY(writeFile(root + "/.nova-studio-journal", QJsonDocument(json).toJson()));
        QVERIFY(!ProjectDocument::finishInterruptedSave(path, &error));
        QVERIFY(error.contains("invalid"));
        QVERIFY(QFileInfo::exists(root + "/.nova-studio-journal"));
    }

    void resumeInPlaceRetainsNewerDraft()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-resume-XXXXXX");
        QString error, path, root;
        {
            ProjectDocument initial;
            QVERIFY(initial.create(temporary.path(), "Resume", false, NOVA_EXAMPLES, &error));
            path = initial.path(); root = initial.root();
        }
        QVERIFY(QFile::setPermissions(root + "/main.lua", QFile::ReadOwner));
        ProjectDocument document;
        QVERIFY(document.open(path, &error));
        NovaScene scene = document.scene(); scene.objects[0].position.x = 100;
        QVERIFY(document.editScene(scene, "player", "Move", &error));
        QVERIFY(document.editScript(QString::fromUtf8(document.draft().script) + "-- journal version\n", &error));
        const QByteArray committedScript = document.draft().script;
        QVERIFY(!document.save(&error));
        QVERIFY(error.contains("after 1 writes"));
        QVERIFY(document.editScript(QString::fromUtf8(committedScript) + "-- newer draft\n", &error));
        const QByteArray newest = document.draft().script;
        QVERIFY(QFile::setPermissions(root + "/main.lua", QFile::ReadOwner | QFile::WriteOwner));
        QVERIFY2(document.resumeInterruptedSave(&error), qPrintable(error));
        QCOMPARE(readFile(root + "/main.lua"), committedScript);
        QCOMPARE(document.draft().script, newest);
        QVERIFY(document.dirty());
        QVERIFY(!QFileInfo::exists(root + "/.nova-studio-journal"));
        QVERIFY(document.recoveryPreview().contains("-- newer draft"));
        QVERIFY(document.saveRecoveryCopy(temporary.path() + "/backup.json", &error));
        QVERIFY(!document.saveRecoveryCopy(temporary.path() + "/backup.json", &error));
        QVERIFY(error.contains("never replaced"));
        QVERIFY(document.save(&error));
        QCOMPARE(readFile(root + "/main.lua"), newest);
        QVERIFY(!document.dirty());
    }

    void legacyAndGeneratedOwnership()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-legacy-XXXXXX");
        const QString root = temporary.path(), path = root + "/nova.project";
        const QByteArray lua = "-- hand authored\r\nfunction update() end\r\n";
        QVERIFY(writeFile(root + "/main.lua", lua));
        QString error;
        for (const int version : {1, 2}) {
            const QByteArray manifest = "nova-project " + QByteArray::number(version) + "\nentry main.lua\n" +
                (version == 2 ? QByteArray("identity legacy\n") : QByteArray());
            QVERIFY(writeFile(path, manifest));
            ProjectDocument document;
            QVERIFY2(document.open(path, &error), qPrintable(error));
            QVERIFY(!document.visual());
            QVERIFY(!document.editScene(NovaScene{}, {}, "No conversion", &error));
            QVERIFY(document.editScript(QString::fromUtf8(lua).replace("\r\n", "\n") + "-- my change\n", &error));
            QVERIFY(document.save(&error));
            QCOMPARE(readFile(path), manifest);
            QVERIFY(readFile(root + "/main.lua").contains("-- hand authored\r\n"));
            QVERIFY(!QFileInfo::exists(root + "/start.nova-scene"));
        }
        QVERIFY(writeFile(root + "/game.generated.lua", lua));
        QVERIFY(writeFile(path, "nova-project 1\nentry game.generated.lua\n"));
        ProjectDocument generated;
        QVERIFY(generated.open(path, &error));
        QVERIFY(generated.generated());
        QVERIFY(!generated.editScript("replacement", &error));
        QVERIFY(!generated.editScene(NovaScene{}, {}, "No conversion", &error));
        QVERIFY(!generated.save(&error));
        QCOMPARE(readFile(root + "/game.generated.lua"), lua);
    }

    void authoredSourceOpenerKeepsRuntimeLimits()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-source-limit-XXXXXX");
        struct OwnedDocument {
            NovaDocument value{};
            ~OwnedDocument() { nova_document_close(&value); }
        } document;
        char error[1024] = {};
        const auto root = temporary.path().toUtf8();
        QVERIFY(nova_document_open_output(&document.value, root.constData(), "output.bin",
            ProjectDocument::AssetFileLimit, true, error, sizeof(error)));
        QVERIFY(!nova_document_open_output(&document.value, root.constData(), "output.bin",
            ProjectDocument::AssetFileLimit + 1, true, error, sizeof(error)));
        QCOMPARE(document.value.limit, size_t(ProjectDocument::AssetFileLimit));
        QVERIFY(nova_document_open_authored_source(&document.value, root.constData(), "source.bin",
            ProjectDocument::AssetSourceLimit, error, sizeof(error)));
        QVERIFY(!nova_document_open_authored_source(&document.value, root.constData(), "source.bin",
            ProjectDocument::AssetSourceLimit + 1, error, sizeof(error)));
        QCOMPARE(document.value.limit, size_t(ProjectDocument::AssetSourceLimit));
        const QByteArray binary("a\0b", 3);
        QVERIFY(nova_document_replace(&document.value, 0, 0, binary.constData(), size_t(binary.size()), error, sizeof(error)));
        QVERIFY(nova_document_save(&document.value, false, error, sizeof(error)));
        QVERIFY(nova_document_reread(&document.value, error, sizeof(error)));
        QCOMPARE(document.value.limit, size_t(ProjectDocument::AssetSourceLimit));
        QVERIFY(document.value.authored_source);
        QCOMPARE(readFile(temporary.path() + "/source.bin"), binary);
        QVERIFY(!nova_document_open_authored_source(&document.value, root.constData(), "../outside",
            ProjectDocument::AssetSourceLimit, error, sizeof(error)));
        QVERIFY(QFile::link(temporary.path() + "/source.bin", temporary.path() + "/source-link"));
        QVERIFY(!nova_document_open_authored_source(&document.value, root.constData(), "source-link",
            ProjectDocument::AssetSourceLimit, error, sizeof(error)));
        QCOMPARE(::link((temporary.path() + "/source.bin").toUtf8().constData(),
            (temporary.path() + "/hard-link").toUtf8().constData()), 0);
        QVERIFY(!nova_document_open_authored_source(&document.value, root.constData(), "hard-link",
            ProjectDocument::AssetSourceLimit, error, sizeof(error)));
        QVERIFY(!nova_document_save(&document.value, false, error, sizeof(error)));
    }

    void assetPublishedRoundTrip_data()
    {
        QTest::addColumn<int>("type");
        QTest::newRow("png") << int(NOVA_ASSET_SPRITE);
        QTest::newRow("glb") << int(NOVA_ASSET_MODEL);
        QTest::newRow("wav") << int(NOVA_ASSET_AUDIO);
    }

    void assetPublishedRoundTrip()
    {
        QFETCH(int, type);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-assets-XXXXXX");
        QString error, path, root;
        auto snapshot = assetSnapshot(NovaAssetType(type));
        snapshot.revision = (quint64(1) << 60) + 17;
        QVERIFY(!snapshot.outputs[0].bytes.isEmpty());
        QByteArray script, hash;
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "Assets", type == NOVA_ASSET_MODEL, NOVA_EXAMPLES, &error));
            path = document.path(); root = document.root(); script = document.draft().script;
            QVERIFY2(expectedVersions(document, &snapshot, &error), qPrintable(error));
            QVERIFY(!snapshot.source.expected.exists);
            QVERIFY2(document.stageAssetSnapshot(snapshot, &error), qPrintable(error));
            QCOMPARE(document.project().version, 3u);
            QCOMPARE(document.project().count, size_t(2));
            QVERIFY(!QFileInfo::exists(root + "/sources"));
            QVERIFY(!document.runtimeAssetsReady(&error));
            QVERIFY(!document.assetPublication(snapshot.id).saved);
            hash = ProjectDocument::assetSnapshotDigest(document.assetSnapshots()[0]);
            QSignalSpy acknowledgments(&document, &ProjectDocument::assetSnapshotSaved);
            QVERIFY2(document.save(&error), qPrintable(error));
            QCOMPARE(acknowledgments.size(), 1);
            QCOMPARE(acknowledgments[0][0].toString(), snapshot.id);
            QCOMPARE(acknowledgments[0][1].toULongLong(), snapshot.revision);
            QCOMPARE(acknowledgments[0][2].toByteArray(), hash);
            QVERIFY(document.isAssetSnapshotSaved(snapshot.id, snapshot.revision, hash));
            QVERIFY2(document.runtimeAssetsReady(&error), qPrintable(error));
            QVERIFY(!document.dirty());
            QCOMPARE(readFile(root + "/" + snapshot.source.path), snapshot.source.bytes);
            QCOMPARE(readFile(root + "/" + snapshot.outputs[0].path), snapshot.outputs[0].bytes);
            QCOMPARE(readFile(root + "/main.lua"), script);
            QCOMPARE(document.assetPublication(snapshot.id).sourceDigest, sha256(snapshot.source.bytes));
            QVERIFY(!document.assetPublication(snapshot.id).stale);
            const auto index = QJsonDocument::fromJson(readFile(root + "/.nova-studio-assets")).object();
            QCOMPARE(index["version"].toInt(), 1);
            QCOMPARE(index["assets"].toArray().size(), 1);
            NovaProjectValidation validation{};
            char detail[1024] = {};
            QVERIFY2(nova_validate_project(path.toUtf8().constData(), &validation, detail, sizeof(detail)), detail);
            QCOMPARE(int(validation.assets[1].declaration.type), type);
            if (type == NOVA_ASSET_AUDIO) {
                QVERIFY(document.draft().manifest.contains("audio authored_output generated/authored/sound.wav\n"));
                QCOMPARE(validation.assets[1].sample_rate, 48000u);
                QCOMPARE(validation.assets[1].channels, 2u);
                QCOMPARE(validation.assets[1].sample_frames, 240u);
            }
        }
        ProjectDocument reopened;
        QVERIFY2(reopened.open(path, &error), qPrintable(error));
        QCOMPARE(reopened.assetSnapshots().size(), 1);
        const auto restored = reopened.assetSnapshots()[0];
        QCOMPARE(ProjectDocument::assetSnapshotDigest(restored), hash);
        QCOMPARE(restored.source.bytes, snapshot.source.bytes);
        QCOMPARE(restored.outputs.size(), snapshot.outputs.size());
        for (qsizetype i = 0; i < snapshot.outputs.size(); ++i) {
            QCOMPARE(restored.outputs[i].bytes, snapshot.outputs[i].bytes);
            QCOMPARE(restored.outputs[i].runtimeId, snapshot.outputs[i].runtimeId);
            QCOMPARE(restored.outputs[i].runtimeType, snapshot.outputs[i].runtimeType);
        }
        QVERIFY(restored.source.expected.exists);
        QVERIFY(reopened.assetPublication(snapshot.id).saved);
        QVERIFY2(reopened.runtimeAssetsReady(&error), qPrintable(error));
        QVERIFY(!reopened.dirty());
    }

    void sourceOnlyRetainsPublishedGeneration_data() { assetPublishedRoundTrip_data(); }

    void sourceOnlyRetainsPublishedGeneration()
    {
        QFETCH(int, type);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-source-only-XXXXXX");
        QString error, path;
        QByteArray oldOutput, oldScript, oldSource;
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "SourceOnly", false, NOVA_EXAMPLES, &error));
            path = document.path(); oldScript = document.draft().script;
            auto snapshot = assetSnapshot(NovaAssetType(type));
            QVERIFY(expectedVersions(document, &snapshot, &error));
            QVERIFY(document.stageAssetSnapshot(snapshot, &error));
            QVERIFY2(document.save(&error), qPrintable(error));
            snapshot = document.assetSnapshots()[0];
            const auto outputPath = snapshot.outputs[0].path;
            oldOutput = snapshot.outputs[0].bytes; oldSource = snapshot.source.bytes;
            snapshot.revision++;
            snapshot.source.bytes += "\neditable new source";
            snapshot.outputs[0].bytes = "invalid native export";
            QVERIFY(document.stageAssetSnapshot(snapshot, &error));
            QVERIFY(!document.save(&error));
            QVERIFY2(error.contains("publication failed"), qPrintable(error));
            QCOMPARE(readFile(document.root() + "/" + snapshot.source.path), oldSource);
            QCOMPARE(readFile(document.root() + "/" + snapshot.outputs[0].path), oldOutput);
            QVERIFY(QFileInfo::exists(document.root() + "/.nova-studio-recovery"));
            QVERIFY(!QFileInfo::exists(document.root() + "/.nova-studio-journal"));
            QVERIFY(!document.runtimeAssetsReady(&error));
            QCOMPARE(document.assetPublication(snapshot.id).revision, quint64(17));
            QCOMPARE(document.assetPublication(snapshot.id).sourceDigest, sha256(oldSource));
            QCOMPARE(document.savedAssetSnapshots()[0].outputs[0].bytes, oldOutput);
            snapshot.mode = StudioAssetSnapshot::Mode::SourceOnly;
            snapshot.derivedProblem = "Current source requires unsupported runtime features";
            snapshot.outputs.clear();
            QVERIFY2(document.stageAssetSnapshot(snapshot, &error), qPrintable(error));
            QVERIFY(document.editScript("function incomplete(", &error));
            QVERIFY2(document.save(&error), qPrintable(error));
            QCOMPARE(readFile(document.root() + "/" + snapshot.source.path), snapshot.source.bytes);
            QCOMPARE(readFile(document.root() + "/" + outputPath), oldOutput);
            const auto retained = document.assetSnapshots()[0];
            QCOMPARE(retained.outputs[0].runtimeType, NovaAssetType(type));
            for (const auto &file : retained.outputs)
                QCOMPARE(readFile(document.root() + "/" + file.path), file.bytes);
            const auto publication = document.assetPublication(snapshot.id);
            QVERIFY(publication.saved);
            QVERIFY(publication.stale);
            QCOMPARE(publication.revision, quint64(17));
            QCOMPARE(publication.sourceDigest, sha256(oldSource));
            QVERIFY(!document.runtimeAssetsReady(&error));
            QVERIFY(error.contains("last published"));
            QVERIFY(!document.dirty());
        }
        ProjectDocument reopened;
        QVERIFY2(reopened.open(path, &error), qPrintable(error));
        QVERIFY(reopened.assetPublication("authored").stale);
        QVERIFY(reopened.assetPublication("authored").saved);
        auto snapshot = reopened.assetSnapshots()[0];
        snapshot.revision++;
        snapshot.mode = StudioAssetSnapshot::Mode::PublishDerived;
        snapshot.derivedProblem.clear();
        QCOMPARE(snapshot.outputs[0].bytes, oldOutput);
        QCOMPARE(snapshot.outputs[0].runtimeType, NovaAssetType(type));
        snapshot.outputs[0].bytes = oldOutput;
        QVERIFY(reopened.editScript(QString::fromUtf8(oldScript), &error));
        QVERIFY(reopened.stageAssetSnapshot(snapshot, &error));
        QVERIFY2(reopened.save(&error), qPrintable(error));
        QVERIFY(reopened.runtimeAssetsReady(&error));
        QCOMPARE(reopened.assetPublication(snapshot.id).revision, snapshot.revision);
        QCOMPARE(reopened.assetPublication(snapshot.id).sourceDigest, sha256(snapshot.source.bytes));
    }

    void sourceOnlyCannotOverwriteRuntimeFile_data()
    {
        QTest::addColumn<QString>("runtimeName");
        QTest::addColumn<QString>("candidateName");
        QTest::addColumn<bool>("source");
        QTest::addColumn<bool>("nativePath");
        QTest::newRow("source-exact") << QString("starter.glb") << QString("starter.glb") << true << true;
        QTest::newRow("source-case-alias") << QString("starter.glb") << QString("STARTER.GLB") << true << true;
        QTest::newRow("metadata-exact") << QString("starter.glb") << QString("starter.glb") << false << true;
        QTest::newRow("metadata-case-alias") << QString("starter.glb") << QString("STARTER.GLB") << false << true;
        QTest::newRow("non-ascii-normalized-source-alias") << QString("K.glb")
            << QString::fromUtf8("\xe2\x84\xaa.glb") << true << false;
        QTest::newRow("non-ascii-normalized-metadata-alias") << QString("K.glb")
            << QString::fromUtf8("\xe2\x84\xaa.GLB") << false << false;
    }

    void sourceOnlyCannotOverwriteRuntimeFile()
    {
        QFETCH(QString, runtimeName);
        QFETCH(QString, candidateName);
        QFETCH(bool, source);
        QFETCH(bool, nativePath);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-runtime-ownership-XXXXXX");
        QString error, root, path;
        QByteArray manifest;
        {
            ProjectDocument initial;
            QVERIFY(initial.create(temporary.path(), "RuntimeOwnership", true, NOVA_EXAMPLES, &error));
            root = initial.root(); path = initial.path(); manifest = initial.draft().manifest;
        }
        if (runtimeName != "starter.glb") {
            QVERIFY(QFile::rename(root + "/starter.glb", root + "/" + runtimeName));
            manifest.replace("starter.glb", runtimeName.toUtf8());
            QVERIFY(writeFile(path, manifest));
        }
        ProjectDocument document;
        QVERIFY2(document.open(path, &error), qPrintable(error));
        const auto runtimePath = root + "/" + runtimeName;
        const auto original = readFile(runtimePath);
        auto snapshot = assetSnapshot(NOVA_ASSET_MODEL);
        if (source) {
            snapshot.source.path = candidateName;
            snapshot.mode = StudioAssetSnapshot::Mode::SourceOnly;
            snapshot.derivedProblem = "Source must not replace the runtime model";
            snapshot.outputs.clear();
        } else {
            StudioAssetFile metadata;
            metadata.path = candidateName; metadata.bytes = "editable metadata, not a runtime model";
            snapshot.outputs.append(metadata);
        }
        QCOMPARE(expectedVersions(document, &snapshot, &error), nativePath);
        QVERIFY(!document.stageAssetSnapshot(snapshot, &error));
        QVERIFY2(error.contains(nativePath ? "unrelated runtime asset" : "invalid"), qPrintable(error));
        QCOMPARE(readFile(runtimePath), original);
        QCOMPARE(readFile(path), manifest);
        QVERIFY(!QFileInfo::exists(root + "/.nova-studio-assets"));
        QVERIFY(!QFileInfo::exists(root + "/sources"));
        QVERIFY(document.assetSnapshots().isEmpty());
    }

    void runtimeOutputAdoption_data()
    {
        QTest::addColumn<int>("type");
        QTest::addColumn<int>("claim");
        QTest::addColumn<bool>("spaces");
        for (const auto type : {NOVA_ASSET_SPRITE, NOVA_ASSET_MODEL, NOVA_ASSET_AUDIO})
            for (int claim = 0; claim < 3; ++claim) {
                const auto name = QByteArray(type == NOVA_ASSET_SPRITE ? "png" : type == NOVA_ASSET_MODEL ? "glb" : "wav") +
                    (claim == 0 ? "-explicit-adoption" : claim == 1 ? "-unrelated-id" : "-unmanaged-alias");
                QTest::newRow(name.constData()) << int(type) << claim << false;
            }
        QTest::newRow("wav-explicit-adoption-spaces") << int(NOVA_ASSET_AUDIO) << 0 << true;
    }

    void runtimeOutputAdoption()
    {
        QFETCH(int, type);
        QFETCH(int, claim);
        QFETCH(bool, spaces);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-runtime-adoption-XXXXXX");
        const auto root = temporary.path(), path = root + "/nova.project";
        auto snapshot = assetSnapshot(NovaAssetType(type));
        if (spaces) snapshot.outputs[0].path = "generated/authored/My  sound.wav";
        const auto existing = snapshot.outputs[0];
        const QByteArray directive = type == NOVA_ASSET_SPRITE ? "sprite " : type == NOVA_ASSET_MODEL ? "model " : "audio ";
        QByteArray manifest = "nova-project 2\nidentity adoption\nentry main.lua\n" +
            directive + "existing " + existing.path.toUtf8() + "\n";
        if (claim == 2) manifest += directive + "alias " + existing.path.toUtf8() + "\n";
        QVERIFY(QDir(root).mkpath("generated/authored"));
        QVERIFY(writeFile(root + "/" + existing.path, existing.bytes));
        QVERIFY(writeFile(root + "/main.lua", "function update() end\n"));
        QVERIFY(writeFile(path, manifest));
        ProjectDocument document;
        QString error;
        QVERIFY(document.open(path, &error));
        snapshot.outputs[0].runtimeId = claim == 1 ? "new_output" : "existing";
        QVERIFY(expectedVersions(document, &snapshot, &error));
        if (claim) {
            QVERIFY(!document.stageAssetSnapshot(snapshot, &error));
            QVERIFY2(error.contains("unrelated runtime asset"), qPrintable(error));
            QCOMPARE(readFile(path), manifest);
            QCOMPARE(readFile(root + "/" + existing.path), existing.bytes);
            QVERIFY(!QFileInfo::exists(root + "/" + snapshot.source.path));
            QVERIFY(!QFileInfo::exists(root + "/.nova-studio-assets"));
        } else {
            QVERIFY2(document.stageAssetSnapshot(snapshot, &error), qPrintable(error));
            QVERIFY2(document.save(&error), qPrintable(error));
            QCOMPARE(document.project().version, 2u);
            QCOMPARE(document.project().count, size_t(1));
            QVERIFY2(document.open(path, &error), qPrintable(error));
            QCOMPARE(document.assetSnapshots()[0].outputs[0].runtimeId, QString("existing"));
            QCOMPARE(document.assetSnapshots()[0].outputs[0].runtimeType, NovaAssetType(type));
            QVERIFY(document.runtimeAssetsReady(&error));
            if (spaces) {
                snapshot = document.assetSnapshots()[0];
                snapshot.revision++; snapshot.source.bytes += "\nchanged source";
                snapshot.outputs.clear(); snapshot.mode = StudioAssetSnapshot::Mode::SourceOnly;
                snapshot.derivedProblem = "Current source has not been exported";
                QVERIFY2(document.stageAssetSnapshot(snapshot, &error), qPrintable(error));
                QVERIFY2(document.save(&error), qPrintable(error));
                QVERIFY2(document.open(path, &error), qPrintable(error));
                QCOMPARE(document.assetSnapshots()[0].outputs[0].path, existing.path);
                QCOMPARE(readFile(root + "/" + existing.path), existing.bytes);
                QVERIFY(document.assetPublication(snapshot.id).stale);
            }
        }
    }

    void recoveryCannotClaimRuntimePayload_data()
    {
        QTest::addColumn<QString>("candidateName");
        QTest::addColumn<int>("claim");
        QTest::newRow("source-exact") << QString("starter.glb") << 0;
        QTest::newRow("source-case-alias") << QString("STARTER.glb") << 0;
        QTest::newRow("metadata-exact") << QString("starter.glb") << 1;
        QTest::newRow("metadata-case-alias") << QString("STARTER.glb") << 1;
        QTest::newRow("unrelated-binding-exact") << QString("starter.glb") << 2;
        QTest::newRow("unrelated-binding-case-alias") << QString("STARTER.glb") << 2;
    }

    void recoveryCannotClaimRuntimePayload()
    {
        QFETCH(QString, candidateName);
        QFETCH(int, claim);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-recovery-ownership-XXXXXX");
        QString error, root, path;
        QByteArray manifest, runtimeBytes, claimedBefore, recordBytes;
        StudioDiskVersion claimedVersion;
        auto snapshot = assetSnapshot(NOVA_ASSET_MODEL);
        if (claim == 0) {
            snapshot.mode = StudioAssetSnapshot::Mode::SourceOnly;
            snapshot.derivedProblem = "Editable source is not a runtime export";
            snapshot.outputs.clear();
        } else if (claim == 1) {
            StudioAssetFile metadata;
            metadata.path = "generated/authored/details.bin"; metadata.bytes = "component metadata";
            snapshot.outputs.append(metadata);
        }
        const auto claimedPath = claim == 0 ? snapshot.source.path : claim == 1 ?
            snapshot.outputs[1].path : snapshot.outputs[0].path;
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "RecoveryOwnership", true, NOVA_EXAMPLES, &error));
            root = document.root(); path = document.path(); manifest = document.draft().manifest;
            runtimeBytes = readFile(root + "/starter.glb");
            QVERIFY(document.readAssetFile(candidateName, &claimedBefore, &claimedVersion, &error));
            QVERIFY(expectedVersions(document, &snapshot, &error));
            QVERIFY(document.stageAssetSnapshot(snapshot, &error));
            QVERIFY(document.writeRecovery(&error));
            recordBytes = readFile(root + "/.nova-studio-recovery");
        }
        auto record = QJsonDocument::fromJson(recordBytes).object();
        auto files = record["files"].toArray();
        const auto store = root + "/.nova-studio-snapshots/";
        const auto saveBlob = [&store](const QByteArray &bytes) {
            return writeFile(store + QString::fromLatin1(sha256(bytes)) + ".blob", bytes);
        };
        auto redirected = snapshot;
        if (claim == 0) redirected.source.path = candidateName;
        else redirected.outputs[claim == 1 ? 1 : 0].path = candidateName;
        if (claimedVersion.exists) QVERIFY(saveBlob(claimedBefore));
        for (qsizetype i = 0; i < files.size(); ++i) {
            auto entry = files[i].toObject();
            if (entry["path"] == claimedPath) {
                entry["path"] = candidateName;
                entry["before"] = QJsonObject{{"exists", claimedVersion.exists}, {"size", double(claimedBefore.size())},
                    {"sha256", claimedVersion.exists ? QString::fromLatin1(sha256(claimedBefore)) : QString()},
                    {"version", QString::fromLatin1(claimedVersion.token)}};
            } else if (entry["path"] == ".nova-studio-assets") {
                auto after = entry["after"].toObject();
                auto index = QJsonDocument::fromJson(readFile(store + after["sha256"].toString() + ".blob")).object();
                auto assets = index["assets"].toArray();
                auto asset = assets[0].toObject();
                if (claim == 0) {
                    auto source = asset["source"].toObject();
                    source["path"] = candidateName; asset["source"] = source;
                } else {
                    auto outputs = asset["outputs"].toArray();
                    const int output = claim == 1 ? 1 : 0;
                    auto descriptor = outputs[output].toObject();
                    descriptor["path"] = candidateName; outputs[output] = descriptor;
                    asset["outputs"] = outputs;
                }
                asset["digest"] = QString::fromLatin1(ProjectDocument::assetSnapshotDigest(redirected));
                assets[0] = asset; index["assets"] = assets;
                const auto bytes = QJsonDocument(index).toJson(QJsonDocument::Compact);
                QVERIFY(saveBlob(bytes));
                after["sha256"] = QString::fromLatin1(sha256(bytes)); after["size"] = double(bytes.size());
                entry["after"] = after;
            } else if (claim == 2 && entry["path"] == "nova.project") {
                auto after = entry["after"].toObject();
                auto bytes = readFile(store + after["sha256"].toString() + ".blob");
                const auto declarationPath = " " + claimedPath.toUtf8() + "\n";
                QVERIFY(bytes.contains(declarationPath));
                bytes.replace(declarationPath, " " + candidateName.toUtf8() + "\n");
                QVERIFY(saveBlob(bytes));
                after["sha256"] = QString::fromLatin1(sha256(bytes)); after["size"] = double(bytes.size());
                entry["after"] = after;
            }
            files[i] = entry;
        }
        record["files"] = files;
        const auto invalid = QJsonDocument(record).toJson(QJsonDocument::Compact);
        QVERIFY(writeFile(root + "/.nova-studio-recovery", invalid));
        {
            ProjectDocument document;
            QVERIFY(document.open(path, &error));
            QVERIFY(!document.restoreRecovery(&error));
            QVERIFY2(error.contains("unrelated runtime asset"), qPrintable(error));
            QVERIFY(document.assetSnapshots().isEmpty());
        }
        QVERIFY(writeFile(root + "/.nova-studio-journal", invalid));
        QVERIFY(!ProjectDocument::finishInterruptedSave(path, &error));
        QVERIFY2(error.contains("unrelated runtime asset"), qPrintable(error));
        QCOMPARE(readFile(root + "/starter.glb"), runtimeBytes);
        QCOMPARE(readFile(path), manifest);
        QCOMPARE(readFile(root + "/.nova-studio-recovery"), invalid);
        QCOMPARE(readFile(root + "/.nova-studio-journal"), invalid);
        QVERIFY(!QFileInfo::exists(root + "/" + snapshot.source.path));
        QVERIFY(!QFileInfo::exists(root + "/.nova-studio-assets"));
    }

    void soundManifestVersionIsExplicit_data()
    {
        QTest::addColumn<int>("version");
        QTest::newRow("v1-source-only-without-upgrade") << 1;
        QTest::newRow("v2-publishes-audio") << 2;
    }

    void soundManifestVersionIsExplicit()
    {
        QFETCH(int, version);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-wav-version-XXXXXX");
        const auto root = temporary.path(), path = root + "/nova.project";
        const QByteArray manifest = "nova-project " + QByteArray::number(version) +
            "\r\nentry main.lua\r\n" + (version == 2 ? QByteArray("identity sound_version\r\n") : QByteArray());
        const QByteArray script = "-- user-authored gameplay\r\nfunction update() end\r\n";
        QVERIFY(writeFile(path, manifest));
        QVERIFY(writeFile(root + "/main.lua", script));
        QString error;
        auto snapshot = assetSnapshot(NOVA_ASSET_AUDIO);
        {
            ProjectDocument document;
            QVERIFY(document.open(path, &error));
            QVERIFY(expectedVersions(document, &snapshot, &error));
            if (version == 1) {
                QVERIFY(!document.stageAssetSnapshot(snapshot, &error));
                QVERIFY2(error.contains("requires manifest v2 or v3") && error.contains("not been upgraded"), qPrintable(error));
                QCOMPARE(document.draft().manifest, manifest);
                QVERIFY(document.assetSnapshots().isEmpty());
                snapshot.mode = StudioAssetSnapshot::Mode::SourceOnly;
                snapshot.derivedProblem = "Project format does not support audio publication";
                snapshot.outputs.clear();
            }
            QVERIFY2(document.stageAssetSnapshot(snapshot, &error), qPrintable(error));
            QVERIFY2(document.save(&error), qPrintable(error));
            QCOMPARE(document.project().version, unsigned(version));
            QCOMPARE(readFile(root + "/main.lua"), script);
            if (version == 1) {
                QCOMPARE(readFile(path), manifest);
                QVERIFY(!QFileInfo::exists(root + "/generated"));
                QVERIFY(!document.runtimeAssetsReady(&error));
            } else {
                QVERIFY(readFile(path).startsWith("nova-project 2\r\n"));
                QVERIFY(readFile(path).contains("audio authored_output generated/authored/sound.wav\r\n"));
                QVERIFY(document.runtimeAssetsReady(&error));
            }
        }
        ProjectDocument reopened;
        QVERIFY2(reopened.open(path, &error), qPrintable(error));
        QCOMPARE(reopened.project().version, unsigned(version));
        QCOMPARE(reopened.assetSnapshots()[0].source.bytes, snapshot.source.bytes);
        QCOMPARE(reopened.assetPublication(snapshot.id).stale, version == 1);
        QVERIFY(reopened.assetPublication(snapshot.id).saved);
    }

    void soundBindingConflicts_data()
    {
        QTest::addColumn<int>("conflict");
        QTest::newRow("existing-sprite-id") << 0;
        QTest::newRow("redirect-published-id") << 1;
        QTest::newRow("duplicate-participant-output-id") << 2;
        QTest::newRow("duplicate-output-path") << 3;
        QTest::newRow("wrong-extension") << 4;
        QTest::newRow("unbound-wav-sidecar") << 5;
        QTest::newRow("case-equivalent-output-path") << 6;
    }

    void soundBindingConflicts()
    {
        QFETCH(int, conflict);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-wav-bindings-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "SoundBindings", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot(NOVA_ASSET_AUDIO);
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY2(document.save(&error), qPrintable(error));
        const auto saved = document.assetSnapshots()[0];
        const auto manifest = readFile(document.path()), index = readFile(document.root() + "/.nova-studio-assets");
        snapshot = saved; snapshot.revision++;
        if (conflict == 0) snapshot.outputs[0].runtimeId = "starter";
        else if (conflict == 1) snapshot.outputs[0].path = "generated/authored/redirected.wav";
        else if (conflict == 4) {
            snapshot.outputs[0].path = "generated/authored/wrong.png";
            snapshot.outputs[0].runtimeId = "new_output";
        } else if (conflict == 5) {
            StudioAssetFile unbound;
            unbound.path = "generated/authored/unbound.wav"; unbound.bytes = pcmWav();
            snapshot.outputs.append(unbound);
        } else {
            snapshot.id = "second";
            snapshot.source.path = "sources/second.sound-source";
            snapshot.outputs[1].path = "generated/second/sound.json";
            if (conflict == 2) snapshot.outputs[0].path = "generated/second/sound.wav";
            else {
                snapshot.outputs[0].runtimeId = "second_output";
                if (conflict == 6) snapshot.outputs[0].path = "GENERATED/AUTHORED/SOUND.wav";
            }
        }
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(!document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(!error.isEmpty());
        if (conflict == 5) QVERIFY2(error.contains("explicit runtime bindings"), qPrintable(error));
        QCOMPARE(readFile(document.path()), manifest);
        QCOMPARE(readFile(document.root() + "/.nova-studio-assets"), index);
        QCOMPARE(document.assetSnapshots().size(), 1);
        QCOMPARE(ProjectDocument::assetSnapshotDigest(document.assetSnapshots()[0]), ProjectDocument::assetSnapshotDigest(saved));
        for (const auto &file : saved.outputs) QCOMPARE(readFile(document.root() + "/" + file.path), file.bytes);
        QVERIFY(!QFileInfo::exists(document.root() + "/.nova-studio-journal"));
    }

    void soundOutputStillRequiresExactDiskVersion()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-wav-exact-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "SoundExact", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot(NOVA_ASSET_AUDIO);
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(document.save(&error));
        const auto saved = document.assetSnapshots()[0];
        const auto index = readFile(document.root() + "/.nova-studio-assets");
        snapshot = saved; snapshot.revision++; snapshot.source.bytes += "\nnew source";
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(writeFile(document.root() + "/" + saved.outputs[0].path, saved.outputs[0].bytes));
        QVERIFY(!document.save(&error));
        QVERIFY2(error.contains("Disk differs"), qPrintable(error));
        snapshot.mode = StudioAssetSnapshot::Mode::SourceOnly;
        snapshot.derivedProblem = "Do not replace an externally rewritten WAV";
        snapshot.outputs.clear();
        QVERIFY(!document.stageAssetSnapshot(snapshot, &error));
        QCOMPARE(readFile(document.root() + "/" + saved.source.path), saved.source.bytes);
        QCOMPARE(readFile(document.root() + "/" + saved.outputs[0].path), saved.outputs[0].bytes);
        QCOMPARE(readFile(document.root() + "/.nova-studio-assets"), index);
        QVERIFY(!QFileInfo::exists(document.root() + "/.nova-studio-journal"));
    }

    void invalidSoundPublicationPreservesPreviousFiles_data()
    {
        QTest::addColumn<int>("invalid");
        QTest::newRow("not-wav") << 0;
        QTest::newRow("invalid-float-bit-depth") << 1;
        QTest::newRow("noncanonical-extra-chunk") << 2;
        QTest::newRow("native-duration-exceeded") << 3;
        QTest::newRow("exact-file-limit-still-needs-valid-wav") << 4;
        QTest::newRow("file-limit-exceeded") << 5;
    }

    void invalidSoundPublicationPreservesPreviousFiles()
    {
        QFETCH(int, invalid);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-wav-invalid-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "SoundInvalid", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot(NOVA_ASSET_AUDIO);
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(document.save(&error));
        const auto saved = document.assetSnapshots()[0];
        const auto manifest = readFile(document.path()), index = readFile(document.root() + "/.nova-studio-assets");
        snapshot = saved; snapshot.revision++; snapshot.source.bytes += "\neditable sound revision";
        auto &wav = snapshot.outputs[0].bytes;
        if (invalid == 0) wav = "not a WAV";
        else if (invalid == 1) qToLittleEndian<quint16>(3, wav.data() + 20);
        else if (invalid == 2) {
            wav.append("JUNK\0\0\0\0", 8);
            qToLittleEndian<quint32>(quint32(wav.size() - 8), wav.data() + 4);
        } else if (invalid == 3) wav = pcmWav(60 * 48000 + 1);
        else wav.resize(ProjectDocument::AssetFileLimit + (invalid == 5 ? 1 : 0), '\0');
        QSignalSpy acknowledgments(&document, &ProjectDocument::assetSnapshotSaved);
        if (invalid == 5) {
            QVERIFY(!document.stageAssetSnapshot(snapshot, &error));
            QVERIFY2(error.contains("limits"), qPrintable(error));
        } else {
            QVERIFY2(document.stageAssetSnapshot(snapshot, &error), qPrintable(error));
            QVERIFY(!document.save(&error));
            QVERIFY2(error.contains("publication failed") && error.contains("WAV"), qPrintable(error));
            if (invalid == 3) QVERIFY(error.contains("60s"));
            QVERIFY(QFileInfo::exists(document.root() + "/.nova-studio-recovery"));
        }
        QCOMPARE(acknowledgments.size(), 0);
        QCOMPARE(readFile(document.path()), manifest);
        QCOMPARE(readFile(document.root() + "/.nova-studio-assets"), index);
        QCOMPARE(readFile(document.root() + "/" + saved.source.path), saved.source.bytes);
        for (const auto &file : saved.outputs) QCOMPARE(readFile(document.root() + "/" + file.path), file.bytes);
        QVERIFY(!QFileInfo::exists(document.root() + "/.nova-studio-journal"));
        snapshot.mode = StudioAssetSnapshot::Mode::SourceOnly;
        snapshot.derivedProblem = "Current WAV export is invalid or exceeds its native budget";
        snapshot.outputs.clear();
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY2(document.save(&error), qPrintable(error));
        QCOMPARE(acknowledgments.size(), 1);
        QCOMPARE(readFile(document.root() + "/" + snapshot.source.path), snapshot.source.bytes);
        QCOMPARE(readFile(document.root() + "/" + saved.outputs[0].path), saved.outputs[0].bytes);
        QCOMPARE(document.assetPublication(snapshot.id).sourceDigest, sha256(saved.source.bytes));
        QVERIFY(document.assetPublication(snapshot.id).stale);
        QVERIFY(!document.runtimeAssetsReady(&error));
    }

    void soundPublicationChecksWholeProject_data()
    {
        QTest::addColumn<int>("failure");
        QTest::newRow("untouched-wav-corrupted") << 0;
        QTest::newRow("unique-project-duration-exceeded") << 1;
        QTest::newRow("initial-lua-update-fails") << 2;
    }

    void soundPublicationChecksWholeProject()
    {
        QFETCH(int, failure);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-wav-preflight-XXXXXX");
        const auto root = temporary.path(), path = root + "/nova.project";
        const auto wave = pcmWav(30 * 48000);
        QByteArray manifest = "nova-project 2\nidentity shadow_audio\nentry main.lua\n";
        const QByteArray script = "function update() end\n";
        for (int i = 0; i < (failure == 1 ? 4 : 1); ++i) {
            const auto name = "existing" + QString::number(i);
            QVERIFY(writeFile(root + "/" + name + ".wav", wave));
            manifest += "audio " + name.toUtf8() + " " + name.toUtf8() + ".wav\n";
        }
        QVERIFY(writeFile(path, manifest));
        QVERIFY(writeFile(root + "/main.lua", script));
        NovaProjectValidation validation{};
        char detail[1024] = {};
        QVERIFY2(nova_validate_project(path.toUtf8().constData(), &validation, detail, sizeof(detail)), detail);
        ProjectDocument document;
        QString error;
        QVERIFY(document.open(path, &error));
        auto snapshot = assetSnapshot(NOVA_ASSET_AUDIO);
        snapshot.outputs[0].bytes = wave;
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        if (failure == 0) QVERIFY(writeFile(root + "/existing0.wav", "externally changed WAV"));
        if (failure == 2)
            QVERIFY(document.editScript("local sound = nova.asset('authored_output')\n"
                "function update() nova.play(sound, 0.1); error('sound shadow failure') end\n", &error));
        QVERIFY(!document.save(&error));
        QVERIFY2(error.contains("publication failed"), qPrintable(error));
        QVERIFY2(error.contains(failure == 0 ? "WAV" : failure == 1 ? "120 seconds" : "sound shadow failure"), qPrintable(error));
        QCOMPARE(readFile(path), manifest);
        QCOMPARE(readFile(root + "/main.lua"), script);
        QCOMPARE(readFile(root + "/existing0.wav"), failure == 0 ? QByteArray("externally changed WAV") : wave);
        QVERIFY(!QFileInfo::exists(root + "/" + snapshot.source.path));
        QVERIFY(!QFileInfo::exists(root + "/" + snapshot.outputs[0].path));
        QVERIFY(!QFileInfo::exists(root + "/.nova-studio-assets"));
        QVERIFY(!QFileInfo::exists(root + "/.nova-studio-journal"));
        QVERIFY(QFileInfo::exists(root + "/.nova-studio-recovery"));
    }

    void soundSourceEnvelopeRoundTrip()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-sound-envelope-XXXXXX");
        QString error, root, path;
        auto snapshot = assetSnapshot(NOVA_ASSET_AUDIO);
        snapshot.kind = "sound_storage_fixture";
        snapshot.source.bytes = QByteArray(33 * 1024 * 1024, '\0');
        snapshot.source.bytes[0] = 'S';
        snapshot.outputs[0].bytes = pcmWav(30 * 48000);
        snapshot.outputs[1].bytes = "{\"format\":\"sound-storage-fixture\",\"frames\":1440000}";
        QCOMPARE(snapshot.outputs[0].bytes.size(), qsizetype(44 + 30 * 48000 * 4));
        QVERIFY(snapshot.outputs[0].bytes.size() <= ProjectDocument::AssetFileLimit);
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "SoundEnvelope", false, NOVA_EXAMPLES, &error));
            path = document.path(); root = document.root();
            QVERIFY(expectedVersions(document, &snapshot, &error));
            QVERIFY(document.stageAssetSnapshot(snapshot, &error));
            QVERIFY2(document.save(&error), qPrintable(error));
            snapshot = document.assetSnapshots()[0];
            snapshot.revision++; snapshot.source.bytes[1] = 'N';
            snapshot.outputs[0].bytes[44] = 1;
            QVERIFY(document.stageAssetSnapshot(snapshot, &error));
            QVERIFY(document.writeRecovery(&error));
        }
        ProjectDocument reopened;
        QVERIFY(reopened.open(path, &error));
        QVERIFY2(reopened.restoreRecovery(&error), qPrintable(error));
        const auto restored = reopened.assetSnapshots()[0];
        QCOMPARE(restored.source.bytes.size(), qsizetype(33 * 1024 * 1024));
        QVERIFY(restored.source.bytes == snapshot.source.bytes);
        QVERIFY(restored.outputs[0].bytes == snapshot.outputs[0].bytes);
        QCOMPARE(restored.outputs[1].bytes, snapshot.outputs[1].bytes);
        QVERIFY2(reopened.save(&error), qPrintable(error));
        QVERIFY(readFile(root + "/" + snapshot.source.path) == snapshot.source.bytes);
        for (const auto &file : restored.outputs) QVERIFY(readFile(root + "/" + file.path) == file.bytes);
        QVERIFY(reopened.runtimeAssetsReady(&error));
    }

    void sourceOnlyWithoutPreviousExport_data() { assetPublishedRoundTrip_data(); }

    void sourceOnlyWithoutPreviousExport()
    {
        QFETCH(int, type);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-unpublished-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "Unpublished", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot(NovaAssetType(type));
        snapshot.outputs.clear(); snapshot.mode = StudioAssetSnapshot::Mode::SourceOnly;
        snapshot.source.bytes.clear();
        snapshot.derivedProblem = "Export is not yet available";
        const auto manifest = document.draft().manifest;
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY2(document.save(&error), qPrintable(error));
        QCOMPARE(document.draft().manifest, manifest);
        QVERIFY(document.assetSnapshots()[0].outputs.isEmpty());
        QCOMPARE(document.assetPublication(snapshot.id).revision, quint64(0));
        QVERIFY(document.assetPublication(snapshot.id).sourceDigest.isEmpty());
        QByteArray empty; StudioDiskVersion saved;
        QVERIFY(document.readAssetFile(snapshot.source.path, &empty, &saved, &error));
        QVERIFY(saved.exists);
        QVERIFY(empty.isEmpty());
        QVERIFY(!document.runtimeAssetsReady(&error));
        QVERIFY(!QFileInfo::exists(document.root() + "/generated"));
    }

    void exactVersionsAndContainedPaths()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-guards-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "Guards", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot();
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(QDir(document.root()).mkpath("sources"));
        QVERIFY(writeFile(document.root() + "/" + snapshot.source.path, snapshot.source.bytes));
        QVERIFY(!document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(error.contains("Expected disk"));
        QVERIFY(document.assetSnapshots().isEmpty());
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        const auto base = snapshot.source.bytes;
        QVERIFY(writeFile(document.root() + "/" + snapshot.source.path, base));
        QVERIFY(!document.save(&error));
        QVERIFY(error.contains("Disk differs"));
        QCOMPARE(readFile(document.root() + "/" + snapshot.source.path), base);
        QVERIFY(!QFileInfo::exists(document.root() + "/.nova-studio-journal"));
        QByteArray bytes; StudioDiskVersion expected;
        QVERIFY(!document.readAssetFile("../outside", &bytes, &expected, &error));
        QVERIFY(!document.readAssetFile(".nova-studio-assets", &bytes, &expected, &error));
        QVERIFY(QFile::link(document.root() + "/sources", document.root() + "/linked-sources"));
        QVERIFY(!document.readAssetFile("linked-sources/new", &bytes, &expected, &error));
        auto overlap = assetSnapshot();
        overlap.id = "overlap"; overlap.source.path = "generated/OverLap";
        overlap.outputs[0].path = "generated/overlap/image.png"; overlap.outputs[0].runtimeId = "overlap_output";
        QVERIFY(expectedVersions(document, &overlap, &error));
        QVERIFY(!document.stageAssetSnapshot(overlap, &error));
        QVERIFY(error.contains("parent directory"));
        QVERIFY(!QFileInfo::exists(document.root() + "/generated"));
    }

    void binaryRecoveryAndTamperProtection()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-binary-recovery-XXXXXX");
        QString error, path, root;
        auto snapshot = assetSnapshot();
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "Recover", false, NOVA_EXAMPLES, &error));
            path = document.path(); root = document.root();
            QVERIFY(expectedVersions(document, &snapshot, &error));
            QVERIFY(document.stageAssetSnapshot(snapshot, &error));
            QVERIFY2(document.writeRecovery(&error), qPrintable(error));
            QVERIFY(!QFileInfo::exists(root + "/" + snapshot.source.path));
            QVERIFY(document.recoveryPreview().contains("SHA-256"));
            const auto record = QJsonDocument::fromJson(readFile(root + "/.nova-studio-recovery")).object();
            QCOMPARE(record["version"].toInt(), 2);
            QVERIFY(record["files"].toArray().size() > 3);
            QVERIFY(readFile(root + "/.nova-studio-recovery").size() < 16384);
        }
        const auto blob = root + "/.nova-studio-snapshots/" + QString::fromLatin1(sha256(snapshot.source.bytes)) + ".blob";
        QVERIFY(writeFile(blob, "tampered snapshot"));
        ProjectDocument reopened;
        QVERIFY(reopened.open(path, &error));
        QVERIFY(!reopened.restoreRecovery(&error));
        QVERIFY2(error.contains("missing or changed"), qPrintable(error));
        QVERIFY(!QFileInfo::exists(root + "/" + snapshot.source.path));
        QVERIFY(writeFile(blob, snapshot.source.bytes));
        QVERIFY2(reopened.restoreRecovery(&error), qPrintable(error));
        QCOMPARE(reopened.assetSnapshots()[0].source.bytes, snapshot.source.bytes);
        QCOMPARE(reopened.assetSnapshots()[0].outputs[0].bytes, snapshot.outputs[0].bytes);
        QVERIFY2(reopened.save(&error), qPrintable(error));
        QCOMPARE(readFile(root + "/" + snapshot.source.path), snapshot.source.bytes);
        QCOMPARE(readFile(root + "/" + snapshot.outputs[0].path), snapshot.outputs[0].bytes);
    }

    void interruptedAssetCommitRetainsNewerSnapshot_data()
    {
        QTest::addColumn<bool>("audio");
        QTest::newRow("png") << false;
        QTest::newRow("wav") << true;
    }

    void interruptedAssetCommitRetainsNewerSnapshot()
    {
        QFETCH(bool, audio);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-resume-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "ResumeAssets", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot(audio ? NOVA_ASSET_AUDIO : NOVA_ASSET_SPRITE);
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(document.writeRecovery(&error));
        const auto older = snapshot;
        QVERIFY(writeFile(document.root() + "/.nova-studio-journal", readFile(document.root() + "/.nova-studio-recovery")));
        snapshot.revision++;
        snapshot.source.bytes += "\nnewer source";
        snapshot.outputs[0].bytes = audio ? pcmWav(480) : readFile(QString(NOVA_EXAMPLES) + "/sprites/assets/tile.png");
        if (audio) snapshot.outputs[1].bytes = "{\"format\":\"sound-storage-fixture\",\"frames\":480}";
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QSignalSpy acknowledgments(&document, &ProjectDocument::assetSnapshotSaved);
        QVERIFY2(document.resumeInterruptedSave(&error), qPrintable(error));
        QCOMPARE(readFile(document.root() + "/" + snapshot.source.path), older.source.bytes);
        QCOMPARE(readFile(document.root() + "/" + snapshot.outputs[0].path), older.outputs[0].bytes);
        QCOMPARE(document.assetSnapshots()[0].source.bytes, snapshot.source.bytes);
        QCOMPARE(document.assetSnapshots()[0].outputs[0].bytes, snapshot.outputs[0].bytes);
        if (audio) QCOMPARE(document.assetSnapshots()[0].outputs[1].bytes, snapshot.outputs[1].bytes);
        QVERIFY(document.dirty());
        QCOMPARE(acknowledgments.size(), 1);
        QCOMPARE(acknowledgments[0][1].toULongLong(), older.revision);
        QVERIFY(!document.isAssetSnapshotSaved(older.id, older.revision, ProjectDocument::assetSnapshotDigest(older)));
        QVERIFY(!document.runtimeAssetsReady(&error));
        QVERIFY(document.recoveryPreview().contains(QString::fromLatin1(sha256(snapshot.source.bytes))));
        QVERIFY2(document.save(&error), qPrintable(error));
        QCOMPARE(readFile(document.root() + "/" + snapshot.source.path), snapshot.source.bytes);
        QCOMPARE(readFile(document.root() + "/" + snapshot.outputs[0].path), snapshot.outputs[0].bytes);
        if (audio) QCOMPARE(readFile(document.root() + "/" + snapshot.outputs[1].path), snapshot.outputs[1].bytes);
        QVERIFY(!document.dirty());
    }

    void olderAcknowledgmentCannotClearReentrantEdit()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-ack-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "Acknowledgment", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot();
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        bool staged = false;
        connect(&document, &ProjectDocument::assetSnapshotSaved, &document,
            [&](const QString &, quint64 revision, const QByteArray &) {
                if (revision != snapshot.revision) return;
                auto newer = document.assetSnapshots()[0];
                newer.revision++; newer.source.bytes += "\nnew edit after commit";
                staged = document.stageAssetSnapshot(newer, &error);
            });
        QVERIFY2(document.save(&error), qPrintable(error));
        QVERIFY2(staged, qPrintable(error));
        QVERIFY(document.dirty());
        QVERIFY(!document.isAssetSnapshotSaved(snapshot.id, snapshot.revision, ProjectDocument::assetSnapshotDigest(snapshot)));
        QCOMPARE(document.assetSnapshots()[0].revision, snapshot.revision + 1);
        QCOMPARE(readFile(document.root() + "/" + snapshot.source.path), snapshot.source.bytes);
        QVERIFY(QFileInfo::exists(document.root() + "/.nova-studio-recovery"));
        QVERIFY2(document.save(&error), qPrintable(error));
        QVERIFY(!document.dirty());
    }

    void retiredOutputsAndCoreUndo()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-retire-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "Retirement", false, NOVA_EXAMPLES, &error));
        auto scene = document.scene(); scene.objects[0].position.x += 20;
        QVERIFY(document.editScene(scene, "player", "Move", &error));
        auto snapshot = assetSnapshot();
        auto second = snapshot.outputs[0]; second.path = "generated/authored/frame-2.png"; second.runtimeId = "authored_second";
        snapshot.outputs.append(second);
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        document.undoStack()->undo();
        QCOMPARE(document.project().count, size_t(3));
        document.undoStack()->redo();
        QVERIFY(document.save(&error));
        snapshot = document.assetSnapshots()[0];
        snapshot.revision++; snapshot.source.bytes += "frame deleted";
        snapshot.outputs.removeLast();
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY2(document.save(&error), qPrintable(error));
        QCOMPARE(document.project().count, size_t(2));
        QCOMPARE(readFile(document.root() + "/" + second.path), second.bytes);
        QCOMPARE(document.assetSnapshots()[0].outputs.size(), 1);
        QVERIFY(document.runtimeAssetsReady(&error));
        QVERIFY(writeFile(document.root() + "/" + second.path, "retired output is now independent"));
        QVERIFY(document.checkExternal(&error));
        QVERIFY(document.save(&error));
    }

    void discardNewParticipantKeepsOtherDrafts_data() { assetPublishedRoundTrip_data(); }

    void discardNewParticipantKeepsOtherDrafts()
    {
        QFETCH(int, type);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-discard-new-XXXXXX");
        QString error, path, root;
        auto removed = assetSnapshot(NovaAssetType(type));
        auto retained = assetSnapshot(NOVA_ASSET_SPRITE, "other");
        QByteArray retainedDigest, scene, script;
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "DiscardNew", false, NOVA_EXAMPLES, &error));
            path = document.path(); root = document.root();
            QVERIFY(QDir(root).mkpath("sources"));
            QVERIFY(QDir(root).mkpath("generated/authored"));
            QVERIFY(writeFile(root + "/" + removed.source.path, "independent original source"));
            for (const auto &file : removed.outputs) QVERIFY(writeFile(root + "/" + file.path, file.bytes));
            QVERIFY(expectedVersions(document, &removed, &error));
            QVERIFY(expectedVersions(document, &retained, &error));
            QVERIFY(document.stageAssetSnapshot(removed, &error));
            QVERIFY(document.stageAssetSnapshot(retained, &error));
            auto moved = document.scene(); moved.objects[0].position.x += 12;
            QVERIFY(document.editScene(moved, "player", "Move independently", &error));
            QVERIFY(document.editScript(QString::fromUtf8(document.draft().script) + "\n-- keep this Lua edit\n", &error));
            scene = document.draft().scene; script = document.draft().script;
            retainedDigest = ProjectDocument::assetSnapshotDigest(document.assetSnapshots()[1]);
            const auto history = document.undoStack()->count();
            QVERIFY(document.writeRecovery(&error));
            QSignalSpy changed(&document, &ProjectDocument::changed);
            QSignalSpy acknowledged(&document, &ProjectDocument::assetSnapshotSaved);
            QVERIFY2(document.discardAssetSnapshot(removed.id, &error), qPrintable(error));
            QCOMPARE(changed.size(), 1);
            QCOMPARE(acknowledged.size(), 0);
            QCOMPARE(document.assetSnapshots().size(), 1);
            QCOMPARE(ProjectDocument::assetSnapshotDigest(document.assetSnapshots()[0]), retainedDigest);
            QCOMPARE(document.draft().scene, scene);
            QCOMPARE(document.draft().script, script);
            QCOMPARE(document.selection(), QString("player"));
            QCOMPARE(document.undoStack()->count(), history);
            QCOMPARE(document.project().count, size_t(2));
            QVERIFY(document.dirty());
            QVERIFY(!document.draft().manifest.contains("authored_output"));
            QCOMPARE(readFile(root + "/" + removed.source.path), QByteArray("independent original source"));
            for (const auto &file : removed.outputs) QCOMPARE(readFile(root + "/" + file.path), file.bytes);
            QVERIFY(writeFile(root + "/" + removed.source.path, "now independently edited"));
            QVERIFY2(document.checkExternal(&error), qPrintable(error));
            document.undoStack()->undo();
            QVERIFY(!document.draft().manifest.contains("authored_output"));
            document.undoStack()->redo();
            QCOMPARE(document.draft().script, script);
            QVERIFY(!document.draft().manifest.contains("authored_output"));
            QVERIFY(document.writeRecovery(&error));
        }
        ProjectDocument reopened;
        QVERIFY(reopened.open(path, &error));
        QVERIFY2(reopened.restoreRecovery(&error), qPrintable(error));
        QCOMPARE(reopened.assetSnapshots().size(), 1);
        QCOMPARE(ProjectDocument::assetSnapshotDigest(reopened.assetSnapshots()[0]), retainedDigest);
        QCOMPARE(reopened.draft().scene, scene);
        QCOMPARE(reopened.draft().script, script);
        QVERIFY2(reopened.save(&error), qPrintable(error));
        QCOMPARE(readFile(root + "/" + removed.source.path), QByteArray("now independently edited"));
        for (const auto &file : removed.outputs) QCOMPARE(readFile(root + "/" + file.path), file.bytes);
    }

    void discardRestoresCommittedParticipant_data()
    {
        QTest::addColumn<int>("type");
        QTest::addColumn<bool>("sourceOnly");
        for (const auto type : {NOVA_ASSET_SPRITE, NOVA_ASSET_MODEL, NOVA_ASSET_AUDIO}) {
            QTest::newRow(qPrintable(QString("published-%1").arg(int(type)))) << int(type) << false;
            QTest::newRow(qPrintable(QString("source-only-%1").arg(int(type)))) << int(type) << true;
        }
    }

    void discardRestoresCommittedParticipant()
    {
        QFETCH(int, type);
        QFETCH(bool, sourceOnly);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-discard-saved-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "DiscardSaved", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot(NovaAssetType(type));
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY2(document.save(&error), qPrintable(error));
        if (sourceOnly) {
            snapshot = document.assetSnapshots()[0];
            snapshot.revision++; snapshot.source.bytes += "\nsource saved without fresh output";
            snapshot.mode = StudioAssetSnapshot::Mode::SourceOnly;
            snapshot.derivedProblem = "Keep the old publication";
            snapshot.outputs.clear();
            QVERIFY(document.stageAssetSnapshot(snapshot, &error));
            QVERIFY(document.save(&error));
        }
        const auto saved = document.savedAssetSnapshots()[0];
        const auto publication = document.assetPublication(saved.id);
        const auto manifest = document.draft().manifest;
        const auto index = readFile(document.root() + "/.nova-studio-assets");
        auto newer = saved;
        newer.revision++; newer.source.bytes += "\ndiscard this candidate";
        newer.metadata["name"] = "Discard this name";
        newer.mode = StudioAssetSnapshot::Mode::PublishDerived; newer.derivedProblem.clear();
        newer.outputs[0].runtimeId += "_new";
        newer.outputs[0].path.replace("generated/authored/", "generated/new/");
        QVERIFY(expectedVersions(document, &newer, &error));
        QVERIFY(document.stageAssetSnapshot(newer, &error));
        QVERIFY(document.writeRecovery(&error));
        QSignalSpy acknowledgments(&document, &ProjectDocument::assetSnapshotSaved);
        QVERIFY2(document.discardAssetSnapshot(saved.id, &error), qPrintable(error));
        const auto restored = document.assetSnapshots()[0];
        QCOMPARE(ProjectDocument::assetSnapshotDigest(restored), ProjectDocument::assetSnapshotDigest(saved));
        QCOMPARE(restored.source.expected, saved.source.expected);
        for (qsizetype i = 0; i < saved.outputs.size(); ++i)
            QCOMPARE(restored.outputs[i].expected, saved.outputs[i].expected);
        QCOMPARE(document.assetPublication(saved.id).revision, publication.revision);
        QCOMPARE(document.assetPublication(saved.id).sourceDigest, publication.sourceDigest);
        QCOMPARE(document.assetPublication(saved.id).problem, publication.problem);
        QCOMPARE(document.assetPublication(saved.id).stale, publication.stale);
        QVERIFY(document.assetPublication(saved.id).saved);
        QCOMPARE(document.draft().manifest, manifest);
        QCOMPARE(readFile(document.root() + "/.nova-studio-assets"), index);
        QCOMPARE(readFile(document.root() + "/" + saved.source.path), saved.source.bytes);
        for (const auto &file : saved.outputs) QCOMPARE(readFile(document.root() + "/" + file.path), file.bytes);
        QVERIFY(!QFileInfo::exists(document.root() + "/generated/new"));
        QCOMPARE(acknowledgments.size(), 0);
        QVERIFY(!document.dirty());
        QVERIFY(!QFileInfo::exists(document.root() + "/.nova-studio-recovery"));
        QCOMPARE(document.runtimeAssetsReady(&error), !sourceOnly);
    }

    void discardAdoptionPreservesUnmanagedBinding_data()
    {
        QTest::addColumn<bool>("imported");
        QTest::addColumn<bool>("recovered");
        QTest::newRow("committed-runtime") << false << false;
        QTest::newRow("unsaved-import") << true << false;
        QTest::newRow("recovered-runtime") << false << true;
        QTest::newRow("recovered-import") << true << true;
    }

    void discardSavedKeepsOtherParticipantAndInvalidLuaDraft()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-discard-other-XXXXXX");
        QString error, path;
        QByteArray otherDigest, source, output, scene, script;
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "DiscardOther", false, NOVA_EXAMPLES, &error));
            path = document.path();
            auto first = assetSnapshot(NOVA_ASSET_AUDIO), second = assetSnapshot(NOVA_ASSET_MODEL, "other");
            QVERIFY(expectedVersions(document, &first, &error));
            QVERIFY(expectedVersions(document, &second, &error));
            QVERIFY(document.stageAssetSnapshot(first, &error));
            QVERIFY(document.stageAssetSnapshot(second, &error));
            QVERIFY(document.save(&error));
            first = document.assetSnapshots()[0]; second = document.assetSnapshots()[1];
            source = first.source.bytes; output = first.outputs[0].bytes;
            first.revision++; first.source.bytes += "\ndiscard this Sound edit"; first.outputs[0].bytes = pcmWav(480);
            second.revision++; second.source.bytes += "\nkeep this Mesh edit"; second.outputs[0].bytes = "not a publishable GLB";
            QVERIFY(document.stageAssetSnapshot(first, &error));
            QVERIFY(document.stageAssetSnapshot(second, &error));
            auto moved = document.scene(); moved.objects[0].position.x += 17;
            QVERIFY(document.editScene(moved, "player", "Keep position", &error));
            QVERIFY(document.editScript("function incomplete(", &error));
            scene = document.draft().scene; script = document.draft().script;
            otherDigest = ProjectDocument::assetSnapshotDigest(document.assetSnapshots()[1]);
            const auto history = document.undoStack()->count();
            QVERIFY(document.writeRecovery(&error));
            QVERIFY2(document.discardAssetSnapshot(first.id, &error), qPrintable(error));
            QCOMPARE(document.assetSnapshots().size(), 2);
            QVERIFY(document.assetPublication(first.id).saved);
            QVERIFY(!document.assetPublication(first.id).stale);
            QCOMPARE(document.assetSnapshots()[0].source.bytes, source);
            QCOMPARE(document.assetSnapshots()[0].outputs[0].bytes, output);
            QCOMPARE(ProjectDocument::assetSnapshotDigest(document.assetSnapshots()[1]), otherDigest);
            QCOMPARE(document.draft().scene, scene);
            QCOMPARE(document.draft().script, script);
            QCOMPARE(document.selection(), QString("player"));
            QCOMPARE(document.undoStack()->count(), history);
            QVERIFY(document.dirty());
            QVERIFY(!document.runtimeAssetsReady(&error));
        }
        ProjectDocument reopened;
        QVERIFY(reopened.open(path, &error));
        QVERIFY2(reopened.restoreRecovery(&error), qPrintable(error));
        QCOMPARE(reopened.assetSnapshots().size(), 2);
        QCOMPARE(reopened.assetSnapshots()[0].source.bytes, source);
        QCOMPARE(reopened.assetSnapshots()[0].outputs[0].bytes, output);
        QCOMPARE(ProjectDocument::assetSnapshotDigest(reopened.assetSnapshots()[1]), otherDigest);
        QCOMPARE(reopened.draft().scene, scene);
        QCOMPARE(reopened.draft().script, script);
        QVERIFY(reopened.dirty());
    }

    void discardAdoptionPreservesUnmanagedBinding()
    {
        QFETCH(bool, imported);
        QFETCH(bool, recovered);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-discard-adopt-XXXXXX");
        auto document = std::make_unique<ProjectDocument>();
        QString error;
        QVERIFY(document->create(temporary.path(), "DiscardAdoption", false, NOVA_EXAMPLES, &error));
        const auto path = document->path(), root = document->root();
        QString runtimeId = "starter";
        if (imported)
            QVERIFY(document->importAsset(QString(NOVA_EXAMPLES) + "/sprites/assets/tile.png", &runtimeId, &error));
        const auto originalManifest = document->draft().manifest;
        const auto runtimePath = QString::fromUtf8(document->project().assets[imported ? 1 : 0].path);
        const auto originalOutput = readFile(root + "/" + runtimePath);
        auto snapshot = assetSnapshot();
        QString borrowedId(runtimeId.constData(), runtimeId.size()), borrowedPath(runtimePath.constData(), runtimePath.size());
        snapshot.outputs[0].runtimeId = QString::fromRawData(borrowedId.constData(), borrowedId.size());
        snapshot.outputs[0].path = QString::fromRawData(borrowedPath.constData(), borrowedPath.size());
        QVERIFY(expectedVersions(*document, &snapshot, &error));
        QVERIFY(document->stageAssetSnapshot(snapshot, &error));
        borrowedId.fill('x'); borrowedPath.fill('x');
        QCOMPARE(document->draft().manifest, originalManifest);
        auto moved = document->scene(); moved.objects[0].position.x += 9;
        QVERIFY(document->editScene(moved, "player", "Keep this movement", &error));
        const auto scene = document->draft().scene;
        QVERIFY(document->writeRecovery(&error));
        if (imported && recovered) {
            const auto copy = temporary.path() + "/adoption-copy.json";
            QVERIFY(document->saveRecoveryCopy(copy, &error));
            const auto origins = QJsonDocument::fromJson(readFile(copy)).object()["unmanagedBindings"].toArray();
            QCOMPARE(origins.size(), 1);
            QCOMPARE(origins[0].toObject()["id"].toString(), runtimeId);
            QCOMPARE(origins[0].toObject()["path"].toString(), runtimePath);
        }
        if (recovered) {
            document.reset();
            document = std::make_unique<ProjectDocument>();
            QVERIFY(document->open(path, &error));
            QVERIFY(document->restoreRecovery(&error));
        }
        QVERIFY2(document->discardAssetSnapshot(snapshot.id, &error), qPrintable(error));
        QVERIFY(document->assetSnapshots().isEmpty());
        QCOMPARE(document->draft().manifest, originalManifest);
        QCOMPARE(document->draft().scene, scene);
        QCOMPARE(document->project().count, size_t(imported ? 2 : 1));
        QCOMPARE(readFile(root + "/" + runtimePath), originalOutput);
        QVERIFY(!QFileInfo::exists(root + "/" + snapshot.source.path));
        QSignalSpy problems(document.get(), &ProjectDocument::problem);
        document->undoStack()->undo();
        QVERIFY(document->assetSnapshots().isEmpty());
        if (!recovered) {
            QCOMPARE(document->project().count, size_t(imported ? 2 : 1));
            if (imported) {
                document->undoStack()->undo();
                QCOMPARE(document->project().count, size_t(1));
                document->undoStack()->redo();
            }
        }
        document->undoStack()->redo();
        QCOMPARE(document->draft().manifest, originalManifest);
        QCOMPARE(document->draft().scene, scene);
        QCOMPARE(problems.size(), 0);
        QVERIFY(document->writeRecovery(&error));
        document.reset();
        document = std::make_unique<ProjectDocument>();
        QVERIFY(document->open(path, &error));
        QVERIFY2(document->restoreRecovery(&error), qPrintable(error));
        QVERIFY(document->assetSnapshots().isEmpty());
        QCOMPARE(document->draft().manifest, originalManifest);
        QVERIFY(document->save(&error));
        QCOMPARE(readFile(root + "/" + runtimePath), originalOutput);
    }

    void discardLastNewParticipantClearsRecovery_data() { assetPublishedRoundTrip_data(); }

    void discardLastNewParticipantClearsRecovery()
    {
        QFETCH(int, type);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-discard-clean-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "DiscardClean", false, NOVA_EXAMPLES, &error));
        const auto manifest = document.draft().manifest;
        auto snapshot = assetSnapshot(NovaAssetType(type));
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(document.writeRecovery(&error));
        QVERIFY2(document.discardAssetSnapshot(snapshot.id, &error), qPrintable(error));
        QVERIFY(document.assetSnapshots().isEmpty());
        QCOMPARE(document.draft().manifest, manifest);
        QVERIFY(!document.dirty());
        QVERIFY(document.runtimeAssetsReady(&error));
        QVERIFY(!QFileInfo::exists(document.root() + "/sources"));
        QVERIFY(!QFileInfo::exists(document.root() + "/generated"));
        QVERIFY(!QFileInfo::exists(document.root() + "/.nova-studio-assets"));
        QVERIFY(!QFileInfo::exists(document.root() + "/.nova-studio-recovery"));
        QVERIFY(!document.discardAssetSnapshot(snapshot.id, &error));
        QVERIFY2(error.contains("registered"), qPrintable(error));
    }

    void discardRefusesUnresolvedRecoveryAndCommit()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-discard-blocked-XXXXXX");
        auto document = std::make_unique<ProjectDocument>();
        QString error;
        QVERIFY(!document->discardAssetSnapshot("authored", &error));
        QVERIFY(document->create(temporary.path(), "DiscardBlocked", false, NOVA_EXAMPLES, &error));
        const auto path = document->path(), root = document->root();
        auto snapshot = assetSnapshot();
        QVERIFY(expectedVersions(*document, &snapshot, &error));
        QVERIFY(document->stageAssetSnapshot(snapshot, &error));
        QVERIFY(document->save(&error));
        snapshot = document->assetSnapshots()[0];
        snapshot.revision++; snapshot.source.bytes += "\nnew source";
        QVERIFY(document->stageAssetSnapshot(snapshot, &error));
        QVERIFY(document->writeRecovery(&error));
        const auto recovery = readFile(root + "/.nova-studio-recovery");
        document.reset();
        document = std::make_unique<ProjectDocument>();
        QVERIFY(document->open(path, &error));
        QVERIFY(!document->discardAssetSnapshot(snapshot.id, &error));
        QVERIFY2(error.contains("recovery"), qPrintable(error));
        QCOMPARE(readFile(root + "/.nova-studio-recovery"), recovery);
        QVERIFY(document->restoreRecovery(&error));
        QVERIFY(writeFile(root + "/.nova-studio-journal", recovery));
        const auto hash = ProjectDocument::assetSnapshotDigest(document->assetSnapshots()[0]);
        QVERIFY(!document->discardAssetSnapshot(snapshot.id, &error));
        QVERIFY2(error.contains("interrupted"), qPrintable(error));
        QCOMPARE(ProjectDocument::assetSnapshotDigest(document->assetSnapshots()[0]), hash);
        QCOMPARE(readFile(root + "/.nova-studio-journal"), recovery);
        QCOMPARE(readFile(root + "/.nova-studio-recovery"), recovery);
    }

    void discardRejectsExternalChanges_data()
    {
        QTest::addColumn<QString>("changedPath");
        QTest::newRow("source") << QString("sources/authored.nvsprite");
        QTest::newRow("output") << QString("generated/authored/frame-1.png");
        QTest::newRow("index") << QString(".nova-studio-assets");
        QTest::newRow("script") << QString("main.lua");
        QTest::newRow("recovery") << QString(".nova-studio-recovery");
    }

    void discardRejectsExternalChanges()
    {
        QFETCH(QString, changedPath);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-discard-conflict-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "DiscardConflict", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot();
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(document.save(&error));
        snapshot = document.assetSnapshots()[0];
        snapshot.revision++; snapshot.source.bytes += "\nkeep on failure";
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(document.writeRecovery(&error));
        const auto recovery = readFile(document.root() + "/.nova-studio-recovery");
        const auto original = readFile(document.root() + "/" + changedPath);
        QVERIFY(writeFile(document.root() + "/" + changedPath, original));
        QSignalSpy changed(&document, &ProjectDocument::changed);
        QVERIFY(!document.discardAssetSnapshot(snapshot.id, &error));
        QVERIFY2(error.contains("Disk differs"), qPrintable(error));
        QCOMPARE(document.assetSnapshots()[0].source.bytes, snapshot.source.bytes);
        QCOMPARE(document.assetSnapshots()[0].revision, snapshot.revision);
        QCOMPARE(readFile(document.root() + "/" + changedPath), original);
        QCOMPARE(readFile(document.root() + "/.nova-studio-recovery"), recovery);
        QCOMPARE(changed.size(), 0);
        QVERIFY(document.dirty());
    }

    void discardCannotInvalidateOtherSceneDraft()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-discard-references-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "DiscardReferences", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot();
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        auto scene = document.scene();
        std::strcpy(scene.objects[0].asset, "authored_output");
        QVERIFY(document.editScene(scene, "player", "Use authored sprite", &error));
        QVERIFY(document.writeRecovery(&error));
        const auto draft = document.draft();
        const auto recovery = readFile(document.root() + "/.nova-studio-recovery");
        QVERIFY(!document.discardAssetSnapshot(snapshot.id, &error));
        QVERIFY2(!error.isEmpty(), qPrintable(error));
        QCOMPARE(document.assetSnapshots().size(), 1);
        QCOMPARE(document.draft().manifest, draft.manifest);
        QCOMPARE(document.draft().scene, draft.scene);
        QCOMPARE(document.draft().selection, draft.selection);
        QCOMPARE(readFile(document.root() + "/.nova-studio-recovery"), recovery);
    }

    void discardCannotClaimAnotherParticipant()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-discard-owner-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "DiscardOwner", false, NOVA_EXAMPLES, &error));
        auto first = assetSnapshot();
        QVERIFY(expectedVersions(document, &first, &error));
        QVERIFY(document.stageAssetSnapshot(first, &error));
        QVERIFY(document.save(&error));
        const auto saved = document.assetSnapshots()[0];
        first = saved; first.revision++; first.source.bytes += "\nnew generation";
        first.outputs[0].path = "generated/new/frame.png";
        first.outputs[0].runtimeId = "new_frame";
        QVERIFY(expectedVersions(document, &first, &error));
        QVERIFY(document.stageAssetSnapshot(first, &error));
        auto second = assetSnapshot(NOVA_ASSET_SPRITE, "other");
        second.outputs = saved.outputs;
        QVERIFY(expectedVersions(document, &second, &error));
        QVERIFY(document.stageAssetSnapshot(second, &error));
        QVERIFY(document.writeRecovery(&error));
        const auto recovery = readFile(document.root() + "/.nova-studio-recovery");
        const auto manifest = document.draft().manifest;
        QVERIFY(!document.discardAssetSnapshot(first.id, &error));
        QVERIFY2(error.contains("overlap"), qPrintable(error));
        QCOMPARE(document.assetSnapshots().size(), 2);
        QCOMPARE(document.assetSnapshots()[0].source.bytes, first.source.bytes);
        QCOMPARE(document.assetSnapshots()[1].source.bytes, second.source.bytes);
        QCOMPARE(document.draft().manifest, manifest);
        QCOMPARE(readFile(document.root() + "/.nova-studio-recovery"), recovery);
    }

    void discardRejectsNewFileAndRecoveryWriteFailure_data()
    {
        QTest::addColumn<bool>("readOnlyRecovery");
        QTest::newRow("new-output-appeared") << false;
        QTest::newRow("recovery-write-refused") << true;
    }

    void discardRejectsNewFileAndRecoveryWriteFailure()
    {
        QFETCH(bool, readOnlyRecovery);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-discard-write-XXXXXX");
        auto document = std::make_unique<ProjectDocument>();
        QString error;
        QVERIFY(document->create(temporary.path(), "DiscardWrite", false, NOVA_EXAMPLES, &error));
        const auto path = document->path(), root = document->root();
        auto snapshot = assetSnapshot(), other = assetSnapshot(NOVA_ASSET_AUDIO, "other");
        QVERIFY(expectedVersions(*document, &snapshot, &error));
        QVERIFY(expectedVersions(*document, &other, &error));
        QVERIFY(document->stageAssetSnapshot(snapshot, &error));
        QVERIFY(document->stageAssetSnapshot(other, &error));
        QVERIFY(document->writeRecovery(&error));
        const auto recovery = readFile(root + "/.nova-studio-recovery");
        if (readOnlyRecovery) {
            document.reset();
            QVERIFY(QFile::setPermissions(root + "/.nova-studio-recovery", QFile::ReadOwner));
            document = std::make_unique<ProjectDocument>();
            QVERIFY(document->open(path, &error));
            QVERIFY(document->restoreRecovery(&error));
        } else {
            QVERIFY(QDir(root).mkpath("generated/authored"));
            QVERIFY(writeFile(root + "/" + snapshot.outputs[0].path, snapshot.outputs[0].bytes));
        }
        const auto manifest = document->draft().manifest;
        const auto history = document->undoStack()->count();
        QSignalSpy changes(document.get(), &ProjectDocument::changed);
        QVERIFY(!document->discardAssetSnapshot(snapshot.id, &error));
        QVERIFY2(!error.isEmpty(), qPrintable(error));
        QCOMPARE(document->assetSnapshots().size(), 2);
        QCOMPARE(document->assetSnapshots()[0].source.bytes, snapshot.source.bytes);
        QCOMPARE(document->assetSnapshots()[1].source.bytes, other.source.bytes);
        QCOMPARE(document->draft().manifest, manifest);
        QCOMPARE(document->undoStack()->count(), history);
        QCOMPARE(changes.size(), 0);
        QCOMPARE(readFile(root + "/.nova-studio-recovery"), recovery);
        QVERIFY(!QFileInfo::exists(root + "/" + snapshot.source.path));
        if (!readOnlyRecovery) QCOMPARE(readFile(root + "/" + snapshot.outputs[0].path), snapshot.outputs[0].bytes);
    }

    void legacyRecoveryBindingOrigins_data()
    {
        QTest::addColumn<int>("origin");
        QTest::newRow("committed-unmanaged") << 0;
        QTest::newRow("absent-new-output") << 1;
        QTest::newRow("ambiguous-existing-output") << 2;
        QTest::newRow("ambiguous-unsaved-import") << 3;
    }

    void maximumUnmanagedBindingsRoundTrip()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-discard-origin-limit-XXXXXX");
        QString error, path, root;
        {
            ProjectDocument starter;
            QVERIFY(starter.create(temporary.path(), "MaximumOrigins", false, NOVA_EXAMPLES, &error));
            path = starter.path(); root = starter.root();
        }
        QByteArray manifest = readFile(path);
        const auto png = readFile(root + "/starter.png");
        for (int i = 1; i < NOVA_MAX_ASSETS; ++i) {
            const auto leaf = QString("original-%1.png").arg(i);
            QVERIFY(writeFile(root + "/" + leaf, png));
            manifest += "sprite original_" + QByteArray::number(i) + " " + leaf.toUtf8() + "\n";
        }
        QVERIFY(writeFile(path, manifest));
        {
            ProjectDocument document;
            QVERIFY(document.open(path, &error));
            auto snapshot = assetSnapshot();
            snapshot.outputs.clear();
            for (size_t i = 0; i < document.project().count; ++i) {
                StudioAssetFile file;
                file.path = QString::fromUtf8(document.project().assets[i].path);
                file.runtimeId = QString::fromUtf8(document.project().assets[i].id);
                file.bytes = png;
                snapshot.outputs.append(file);
            }
            QCOMPARE(snapshot.outputs.size(), qsizetype(NOVA_MAX_ASSETS));
            QVERIFY(expectedVersions(document, &snapshot, &error));
            QVERIFY2(document.stageAssetSnapshot(snapshot, &error), qPrintable(error));
            QVERIFY2(document.writeRecovery(&error), qPrintable(error));
            const auto record = QJsonDocument::fromJson(readFile(root + "/.nova-studio-recovery")).object();
            QCOMPARE(record["unmanagedBindings"].toArray().size(), qsizetype(NOVA_MAX_ASSETS));
        }
        ProjectDocument reopened;
        QVERIFY(reopened.open(path, &error));
        QVERIFY2(reopened.restoreRecovery(&error), qPrintable(error));
        QVERIFY2(reopened.discardAssetSnapshot("authored", &error), qPrintable(error));
        QVERIFY(reopened.assetSnapshots().isEmpty());
        QCOMPARE(reopened.draft().manifest, manifest);
        QCOMPARE(reopened.project().count, size_t(NOVA_MAX_ASSETS));
        QVERIFY(!reopened.dirty());
        QVERIFY(!QFileInfo::exists(root + "/.nova-studio-recovery"));
        for (size_t i = 0; i < reopened.project().count; ++i)
            QCOMPARE(readFile(root + "/" + QString::fromUtf8(reopened.project().assets[i].path)), png);
    }

    void legacyRecoveryBindingOrigins()
    {
        QFETCH(int, origin);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-discard-old-XXXXXX");
        QString error, path, root;
        auto snapshot = assetSnapshot();
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "OldOrigins", false, NOVA_EXAMPLES, &error));
            path = document.path(); root = document.root();
            if (origin == 0) {
                snapshot.outputs[0].runtimeId = "starter";
                snapshot.outputs[0].path = "starter.png";
            } else if (origin == 2) {
                QVERIFY(QDir(root).mkpath("generated/authored"));
                QVERIFY(writeFile(root + "/" + snapshot.outputs[0].path, snapshot.outputs[0].bytes));
            } else if (origin == 3) {
                QString id;
                QVERIFY(document.importAsset(QString(NOVA_EXAMPLES) + "/sprites/assets/tile.png", &id, &error));
                snapshot.outputs[0].runtimeId = id;
                snapshot.outputs[0].path = QString::fromUtf8(document.project().assets[1].path);
            }
            QVERIFY(expectedVersions(document, &snapshot, &error));
            QVERIFY(document.stageAssetSnapshot(snapshot, &error));
            QVERIFY(document.writeRecovery(&error));
        }
        auto legacy = QJsonDocument::fromJson(readFile(root + "/.nova-studio-recovery")).object();
        QVERIFY(legacy.contains("unmanagedBindings"));
        legacy.remove("unmanagedBindings");
        const auto bytes = QJsonDocument(legacy).toJson();
        QVERIFY(writeFile(root + "/.nova-studio-recovery", bytes));
        ProjectDocument reopened;
        QVERIFY(reopened.open(path, &error));
        QVERIFY2(reopened.restoreRecovery(&error), qPrintable(error));
        if (origin >= 2) {
            const auto draft = reopened.draft();
            QVERIFY(!reopened.discardAssetSnapshot(snapshot.id, &error));
            QVERIFY2(error.contains("ambiguous"), qPrintable(error));
            QCOMPARE(reopened.assetSnapshots().size(), 1);
            QCOMPARE(reopened.draft().manifest, draft.manifest);
            QCOMPARE(readFile(root + "/.nova-studio-recovery"), bytes);
            auto sourceOnly = reopened.assetSnapshots()[0];
            sourceOnly.mode = StudioAssetSnapshot::Mode::SourceOnly;
            sourceOnly.derivedProblem = "Do not guess original declaration ownership";
            sourceOnly.outputs.clear();
            QVERIFY(!reopened.stageAssetSnapshot(sourceOnly, &error));
            QVERIFY(error.contains("ambiguous"));
            QVERIFY2(reopened.save(&error), qPrintable(error));
            snapshot = reopened.assetSnapshots()[0];
            const auto source = snapshot.source.bytes;
            snapshot.revision++; snapshot.source.bytes += "\nnew edit after explicit commit";
            QVERIFY(reopened.stageAssetSnapshot(snapshot, &error));
            QVERIFY(reopened.discardAssetSnapshot(snapshot.id, &error));
            QCOMPARE(reopened.assetSnapshots()[0].source.bytes, source);
            QVERIFY(!reopened.dirty());
        } else {
            QVERIFY2(reopened.discardAssetSnapshot(snapshot.id, &error), qPrintable(error));
            QVERIFY(reopened.assetSnapshots().isEmpty());
            QCOMPARE(reopened.project().count, size_t(1));
            QVERIFY(!reopened.dirty());
            QVERIFY(!QFileInfo::exists(root + "/.nova-studio-recovery"));
        }
    }

    void malformedBindingProvenanceIsRetained_data()
    {
        QTest::addColumn<int>("damage");
        QTest::newRow("not-array") << 0;
        QTest::newRow("duplicate-id") << 1;
        QTest::newRow("wrong-native-type") << 2;
        QTest::newRow("unknown-type") << 3;
        QTest::newRow("escaping-path") << 4;
        QTest::newRow("case-alias") << 5;
        QTest::newRow("unrelated-id") << 6;
        QTest::newRow("unknown-field") << 7;
        QTest::newRow("source-path") << 8;
        QTest::newRow("invented-existing-output") << 9;
        QTest::newRow("committed-owner-is-not-unmanaged") << 10;
        QTest::newRow("too-many-declarations") << 11;
        QTest::newRow("duplicate-json-key") << 12;
        QTest::newRow("omitted-committed-origin") << 13;
    }

    void discardAdoptionAfterOlderCommit_data()
    {
        QTest::addColumn<bool>("restart");
        QTest::newRow("resume-in-place") << false;
        QTest::newRow("finish-and-restore") << true;
    }

    void discardAdoptionAfterOlderCommit()
    {
        QFETCH(bool, restart);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-discard-rebase-XXXXXX");
        auto document = std::make_unique<ProjectDocument>();
        QString error, importedId;
        QVERIFY(document->create(temporary.path(), "DiscardRebased", false, NOVA_EXAMPLES, &error));
        const auto path = document->path(), root = document->root();
        auto first = assetSnapshot();
        QVERIFY(expectedVersions(*document, &first, &error));
        QVERIFY(document->stageAssetSnapshot(first, &error));
        QVERIFY(document->writeRecovery(&error));
        QVERIFY(writeFile(root + "/.nova-studio-journal", readFile(root + "/.nova-studio-recovery")));
        QVERIFY(document->importAsset(QString(NOVA_EXAMPLES) + "/sprites/assets/tile.png", &importedId, &error));
        auto second = assetSnapshot(NOVA_ASSET_SPRITE, "other");
        second.outputs[0].runtimeId = importedId;
        second.outputs[0].path = QString::fromUtf8(document->project().assets[2].path);
        const auto importedBytes = readFile(root + "/" + second.outputs[0].path);
        QVERIFY(expectedVersions(*document, &second, &error));
        QVERIFY(document->stageAssetSnapshot(second, &error));
        const auto manifest = document->draft().manifest;
        QVERIFY(document->editScript(QString::fromUtf8(document->draft().script) + "\n-- newer independent Lua\n", &error));
        const auto script = document->draft().script;
        QVERIFY(document->writeRecovery(&error));
        if (restart) {
            document.reset();
            QVERIFY2(ProjectDocument::finishInterruptedSave(path, &error), qPrintable(error));
            document = std::make_unique<ProjectDocument>();
            QVERIFY(document->open(path, &error));
            QVERIFY2(document->restoreRecovery(&error), qPrintable(error));
        } else QVERIFY2(document->resumeInterruptedSave(&error), qPrintable(error));
        QCOMPARE(document->savedAssetSnapshots().size(), 1);
        QCOMPARE(document->assetSnapshots().size(), 2);
        QVERIFY2(document->discardAssetSnapshot(second.id, &error), qPrintable(error));
        QCOMPARE(document->assetSnapshots().size(), 1);
        QVERIFY(document->assetPublication(first.id).saved);
        QCOMPARE(document->draft().manifest, manifest);
        QCOMPARE(document->draft().script, script);
        QCOMPARE(document->project().count, size_t(3));
        QCOMPARE(readFile(root + "/" + second.outputs[0].path), importedBytes);
        QVERIFY(!QFileInfo::exists(root + "/" + second.source.path));
        QVERIFY(document->save(&error));
        QVERIFY(!document->dirty());
        QCOMPARE(readFile(path), manifest);
        QCOMPARE(readFile(root + "/main.lua"), script);
    }

    void malformedBindingProvenanceIsRetained()
    {
        QFETCH(int, damage);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-discard-provenance-XXXXXX");
        QString error, path, root;
        QByteArray manifest, script, scene, source;
        auto snapshot = assetSnapshot();
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "Provenance", false, NOVA_EXAMPLES, &error));
            path = document.path(); root = document.root();
            if (damage == 13) {
                snapshot.outputs[0].runtimeId = "starter"; snapshot.outputs[0].path = "starter.png";
            } else if (damage != 9 && damage != 10) {
                QString id;
                QVERIFY(document.importAsset(QString(NOVA_EXAMPLES) + "/sprites/assets/tile.png", &id, &error));
                snapshot.outputs[0].runtimeId = id;
                snapshot.outputs[0].path = QString::fromUtf8(document.project().assets[1].path);
            }
            QVERIFY(expectedVersions(document, &snapshot, &error));
            QVERIFY(document.stageAssetSnapshot(snapshot, &error));
            if (damage == 10) {
                QVERIFY(document.save(&error));
                snapshot = document.assetSnapshots()[0];
                snapshot.revision++; snapshot.source.bytes += "\npending edit";
                QVERIFY(document.stageAssetSnapshot(snapshot, &error));
            }
            QVERIFY(document.writeRecovery(&error));
            manifest = readFile(path); script = readFile(root + "/main.lua");
            scene = readFile(root + "/start.nova-scene"); source = readFile(root + "/" + snapshot.source.path);
        }
        auto record = QJsonDocument::fromJson(readFile(root + "/.nova-studio-recovery")).object();
        QJsonObject origin{{"id", snapshot.outputs[0].runtimeId}, {"path", snapshot.outputs[0].path},
            {"type", int(snapshot.outputs[0].runtimeType)}};
        if (damage == 2) origin["type"] = int(NOVA_ASSET_MODEL);
        if (damage == 3) origin["type"] = 99;
        if (damage == 4) origin["path"] = "../outside.png";
        if (damage == 5) origin["path"] = snapshot.outputs[0].path.toUpper();
        if (damage == 6) origin["id"] = "unrelated";
        if (damage == 7) origin["invented"] = true;
        if (damage == 8) origin["path"] = snapshot.source.path;
        QJsonArray origins{origin};
        if (damage == 1) origins.append(origin);
        if (damage == 11) while (origins.size() <= NOVA_MAX_ASSETS) origins.append(origin);
        if (damage == 13) origins = {};
        record["unmanagedBindings"] = damage == 0 ? QJsonValue("not an array") : QJsonValue(origins);
        auto malformed = QJsonDocument(record).toJson(QJsonDocument::Compact);
        if (damage == 12) malformed.replace("\"type\":0", "\"type\":0,\"type\":0");
        QVERIFY(writeFile(root + "/.nova-studio-recovery", malformed));
        {
            ProjectDocument reopened;
            QVERIFY(reopened.open(path, &error));
            QSignalSpy changed(&reopened, &ProjectDocument::changed);
            QVERIFY(!reopened.restoreRecovery(&error));
            QVERIFY2(!error.isEmpty(), qPrintable(error));
            QCOMPARE(changed.size(), 0);
            QCOMPARE(reopened.draft().manifest, manifest);
            QCOMPARE(readFile(root + "/.nova-studio-recovery"), malformed);
        }
        QVERIFY(writeFile(root + "/.nova-studio-journal", malformed));
        QVERIFY(!ProjectDocument::finishInterruptedSave(path, &error));
        QVERIFY2(!error.isEmpty(), qPrintable(error));
        QCOMPARE(readFile(root + "/.nova-studio-journal"), malformed);
        QCOMPARE(readFile(root + "/.nova-studio-recovery"), malformed);
        QCOMPARE(readFile(path), manifest);
        QCOMPARE(readFile(root + "/main.lua"), script);
        QCOMPARE(readFile(root + "/start.nova-scene"), scene);
        QCOMPARE(readFile(root + "/" + snapshot.source.path), source);
    }

    void binaryRecoveryCopyIsSelfContained()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-copy-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "Copy", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot();
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        const auto destination = temporary.path() + "/asset-recovery.json";
        QVERIFY2(document.saveRecoveryCopy(destination, &error), qPrintable(error));
        const auto savedCopy = readFile(destination);
        const auto record = QJsonDocument::fromJson(savedCopy).object();
        QCOMPARE(record["version"].toInt(), 2);
        const auto store = temporary.path() + "/" + record["store"].toString();
        for (const auto value : record["files"].toArray())
            for (const auto &key : {"before", "after"}) {
                const auto descriptor = value.toObject()[key].toObject();
                if (!descriptor["exists"].toBool()) continue;
                const auto bytes = readFile(store + "/" + descriptor["sha256"].toString() + ".blob");
                QCOMPARE(sha256(bytes), descriptor["sha256"].toString().toLatin1());
                QCOMPARE(bytes.size(), qsizetype(descriptor["size"].toDouble()));
            }
        QVERIFY(!document.saveRecoveryCopy(destination, &error));
        QCOMPARE(readFile(destination), savedCopy);
        QVERIFY(document.save(&error));
        QCOMPARE(readFile(store + "/" + QString::fromLatin1(sha256(snapshot.source.bytes)) + ".blob"), snapshot.source.bytes);
    }

    void borrowedComponentBuffersAreFrozen()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-owned-snapshot-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "Owned", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot();
        const auto expectedSource = snapshot.source.bytes, expectedOutput = snapshot.outputs[0].bytes;
        QByteArray source = expectedSource, output = expectedOutput;
        source.detach(); output.detach();
        snapshot.source.bytes = QByteArray::fromRawData(source.constData(), source.size());
        snapshot.outputs[0].bytes = QByteArray::fromRawData(output.constData(), output.size());
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        source.fill('x'); output.fill('y');
        source.clear(); output.clear();
        QCOMPARE(document.assetSnapshots()[0].source.bytes, expectedSource);
        QCOMPARE(document.assetSnapshots()[0].outputs[0].bytes, expectedOutput);
        QVERIFY2(document.save(&error), qPrintable(error));
        QCOMPARE(readFile(document.root() + "/" + snapshot.source.path), expectedSource);
        QCOMPARE(readFile(document.root() + "/" + snapshot.outputs[0].path), expectedOutput);
    }

    void partialBinaryWriteReportsAndRetainsSnapshots_data() { interruptedAssetCommitRetainsNewerSnapshot_data(); }

    void partialBinaryWriteReportsAndRetainsSnapshots()
    {
        QFETCH(bool, audio);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-partial-XXXXXX");
        QString error, path, root;
        auto snapshot = assetSnapshot(audio ? NOVA_ASSET_AUDIO : NOVA_ASSET_SPRITE);
        {
            ProjectDocument initial;
            QVERIFY(initial.create(temporary.path(), "Partial", false, NOVA_EXAMPLES, &error));
            path = initial.path(); root = initial.root();
            QVERIFY(expectedVersions(initial, &snapshot, &error));
            QVERIFY(initial.stageAssetSnapshot(snapshot, &error));
            QVERIFY(initial.save(&error));
        }
        QVERIFY(QFile::setPermissions(root + "/" + snapshot.outputs[0].path, QFile::ReadOwner));
        ProjectDocument document;
        QVERIFY(document.open(path, &error));
        auto newer = document.assetSnapshots()[0];
        newer.revision++; newer.source.bytes += "\nchanged source";
        newer.outputs[0].bytes = audio ? pcmWav(480) : readFile(QString(NOVA_EXAMPLES) + "/sprites/assets/tile.png");
        QVERIFY(document.stageAssetSnapshot(newer, &error));
        bool busyDiscardRefused = false, attemptedDiscard = false;
        connect(&document, &ProjectDocument::changed, &document, [&] {
            if (attemptedDiscard) return;
            attemptedDiscard = true;
            QString detail;
            const bool discarded = document.discardAssetSnapshot(snapshot.id, &detail);
            busyDiscardRefused = !discarded && detail.contains("write is in progress");
        });
        QVERIFY(!document.save(&error));
        QVERIFY(busyDiscardRefused);
        QVERIFY2(error.contains("after 1 writes"), qPrintable(error));
        QCOMPARE(readFile(root + "/" + snapshot.source.path), newer.source.bytes);
        QCOMPARE(readFile(root + "/" + snapshot.outputs[0].path), snapshot.outputs[0].bytes);
        QVERIFY(document.dirty());
        QVERIFY(document.recoveryPreview().contains(QString::fromLatin1(sha256(newer.outputs[0].bytes))));
        const auto journal = QJsonDocument::fromJson(readFile(root + "/.nova-studio-journal")).object();
        const auto first = journal["files"].toArray()[0].toObject();
        QVERIFY(first["attempted"].toBool());
        QVERIFY(!first["committed"].toString().isEmpty());
        QVERIFY(!document.discardRecovery(&error));
        const auto pendingSource = document.assetSnapshots()[0].source.bytes;
        QVERIFY(!document.discardAssetSnapshot(snapshot.id, &error));
        QVERIFY2(error.contains("interrupted"), qPrintable(error));
        QCOMPARE(document.assetSnapshots()[0].source.bytes, pendingSource);
        QVERIFY(!document.runtimeAssetsReady(&error));
        NovaProjectValidation validation{};
        char detail[1024] = {};
        QVERIFY(!nova_validate_project(path.toUtf8().constData(), &validation, detail, sizeof(detail)));
        QVERIFY(QByteArray(detail).contains("interrupted Studio save"));
        QVERIFY(document.saveRecoveryCopy(temporary.path() + "/partial-copy.json", &error));
    }

    void committedBinaryReceiptAndAbsentConflict_data()
    {
        QTest::addColumn<int>("receipt");
        QTest::addColumn<bool>("audio");
        QTest::newRow("completed-receipt") << 1 << false;
        QTest::newRow("interrupted-before-receipt") << 0 << false;
        QTest::newRow("external-rewrite-after-receipt") << 2 << false;
        QTest::newRow("wav-completed-receipt") << 1 << true;
        QTest::newRow("wav-interrupted-before-receipt") << 0 << true;
        QTest::newRow("wav-external-rewrite-after-receipt") << 2 << true;
    }

    void committedBinaryReceiptAndAbsentConflict()
    {
        QFETCH(int, receipt);
        QFETCH(bool, audio);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-receipt-XXXXXX");
        QString error, root, path;
        StudioDiskVersion committed;
        auto snapshot = assetSnapshot(audio ? NOVA_ASSET_AUDIO : NOVA_ASSET_SPRITE);
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "Receipt", false, NOVA_EXAMPLES, &error));
            root = document.root(); path = document.path();
            QVERIFY(expectedVersions(document, &snapshot, &error));
            QVERIFY(document.stageAssetSnapshot(snapshot, &error));
            QVERIFY(document.writeRecovery(&error));
            auto journal = QJsonDocument::fromJson(readFile(root + "/.nova-studio-recovery")).object();
            auto entries = journal["files"].toArray();
            auto sourceEntry = entries[0].toObject();
            QVERIFY(QDir(root).mkpath("sources"));
            QVERIFY(writeFile(root + "/" + snapshot.source.path, snapshot.source.bytes));
            QByteArray bytes;
            QVERIFY(document.readAssetFile(snapshot.source.path, &bytes, &committed, &error));
            sourceEntry["attempted"] = true;
            sourceEntry["committed"] = receipt ? QString::fromLatin1(committed.token) : QString();
            entries[0] = sourceEntry; journal["files"] = entries;
            QVERIFY(writeFile(root + "/.nova-studio-journal", QJsonDocument(journal).toJson()));
        }
        QVERIFY(QDir(root).mkpath("generated/authored"));
        QVERIFY(writeFile(root + "/" + snapshot.outputs[0].path, snapshot.outputs[0].bytes));
        QVERIFY(!ProjectDocument::finishInterruptedSave(path, &error));
        QVERIFY2(error.contains("Exact disk version/absence"), qPrintable(error));
        QCOMPARE(readFile(root + "/" + snapshot.source.path), snapshot.source.bytes);
        QVERIFY(!QFileInfo::exists(root + "/.nova-studio-assets"));
        QVERIFY(QFile::remove(root + "/" + snapshot.outputs[0].path));
        if (receipt == 2) {
            QVERIFY(writeFile(root + "/" + snapshot.source.path, snapshot.source.bytes));
            QVERIFY(!ProjectDocument::finishInterruptedSave(path, &error));
            QVERIFY(error.contains("Exact disk version/absence"));
            QVERIFY(QFileInfo::exists(root + "/.nova-studio-journal"));
            QVERIFY(!QFileInfo::exists(root + "/.nova-studio-assets"));
            return;
        }
        QVERIFY2(ProjectDocument::finishInterruptedSave(path, &error), qPrintable(error));
        ProjectDocument reopened;
        QVERIFY(reopened.open(path, &error));
        QVERIFY(reopened.restoreRecovery(&error));
        QVERIFY(reopened.runtimeAssetsReady(&error));
        QCOMPARE(reopened.assetSnapshots()[0].source.bytes, snapshot.source.bytes);
        QCOMPARE(reopened.assetSnapshots()[0].source.expected, committed);
    }

    void restartFinishesOldCommitAndRecoversNewerAssets_data() { interruptedAssetCommitRetainsNewerSnapshot_data(); }

    void restartFinishesOldCommitAndRecoversNewerAssets()
    {
        QFETCH(bool, audio);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-restart-XXXXXX");
        QString error, path, root;
        auto old = assetSnapshot(audio ? NOVA_ASSET_AUDIO : NOVA_ASSET_SPRITE), newer = old;
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "Restart", false, NOVA_EXAMPLES, &error));
            path = document.path(); root = document.root();
            QVERIFY(expectedVersions(document, &old, &error));
            QVERIFY(document.stageAssetSnapshot(old, &error));
            QVERIFY(document.writeRecovery(&error));
            QVERIFY(writeFile(root + "/.nova-studio-journal", readFile(root + "/.nova-studio-recovery")));
            newer = old; newer.revision++; newer.source.bytes += "\nnew source";
            newer.outputs[0].bytes = audio ? pcmWav(480) : readFile(QString(NOVA_EXAMPLES) + "/sprites/assets/tile.png");
            if (audio) newer.outputs[1].bytes = "{\"format\":\"sound-storage-fixture\",\"frames\":480}";
            QVERIFY(document.stageAssetSnapshot(newer, &error));
            QVERIFY(document.writeRecovery(&error));
        }
        QVERIFY2(ProjectDocument::finishInterruptedSave(path, &error), qPrintable(error));
        QCOMPARE(readFile(root + "/" + old.source.path), old.source.bytes);
        ProjectDocument document;
        QVERIFY(document.open(path, &error));
        QVERIFY2(document.restoreRecovery(&error), qPrintable(error));
        QCOMPARE(document.assetSnapshots()[0].source.bytes, newer.source.bytes);
        QCOMPARE(document.assetSnapshots()[0].outputs[0].bytes, newer.outputs[0].bytes);
        if (audio) QCOMPARE(document.assetSnapshots()[0].outputs[1].bytes, newer.outputs[1].bytes);
        QVERIFY(document.dirty());
        QVERIFY(document.save(&error));
        QCOMPARE(readFile(root + "/" + newer.source.path), newer.source.bytes);
        if (audio) QCOMPARE(readFile(root + "/" + newer.outputs[1].path), newer.outputs[1].bytes);
    }

    void newerRecoveryIsValidatedBeforeCommit_data()
    {
        QTest::addColumn<int>("damage");
        QTest::addColumn<QString>("diagnostic");
        QTest::newRow("malformed-metadata") << 0 << QString("malformed");
        QTest::newRow("missing-newer-source-blob") << 1 << QString("missing or changed");
        QTest::newRow("duplicate-escaped-key") << 2 << QString("duplicate JSON keys");
        QTest::newRow("conflicting-recovery-base") << 3 << QString("different saved base");
        QTest::newRow("newer-output-appeared") << 4 << QString("changed externally");
    }

    void newerRecoveryIsValidatedBeforeCommit()
    {
        QFETCH(int, damage);
        QFETCH(QString, diagnostic);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-newer-recovery-XXXXXX");
        QString error, root, path;
        auto old = assetSnapshot(), newer = old;
        QByteArray manifest, script, scene, recovery, journal;
        const QString extraPath = "generated/authored/newer-metadata.bin";
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "NewerRecovery", false, NOVA_EXAMPLES, &error));
            root = document.root(); path = document.path();
            manifest = document.draft().manifest; script = document.draft().script; scene = document.draft().scene;
            QVERIFY(expectedVersions(document, &old, &error));
            QVERIFY(document.stageAssetSnapshot(old, &error));
            QVERIFY(document.writeRecovery(&error));
            journal = readFile(root + "/.nova-studio-recovery");
            QVERIFY(writeFile(root + "/.nova-studio-journal", journal));
            newer = old; newer.revision++; newer.source.bytes += "\nnewer source";
            if (damage == 4) {
                StudioAssetFile extra;
                extra.path = extraPath; extra.bytes = "newer metadata";
                newer.outputs.append(extra);
                QVERIFY(expectedVersions(document, &newer, &error));
            }
            QVERIFY(document.stageAssetSnapshot(newer, &error));
            QVERIFY(document.writeRecovery(&error));
            recovery = readFile(root + "/.nova-studio-recovery");
        }
        const QString blob = root + "/.nova-studio-snapshots/" + QString::fromLatin1(sha256(newer.source.bytes)) + ".blob";
        if (damage == 0) QVERIFY(writeFile(root + "/.nova-studio-recovery", "{invalid"));
        else if (damage == 1) QVERIFY(QFile::remove(blob));
        else if (damage == 2) {
            QVERIFY(recovery.startsWith('{'));
            QVERIFY(writeFile(root + "/.nova-studio-recovery", "{\"\\u0076ersion\":2," + recovery.mid(1)));
        } else if (damage == 3) {
            auto record = QJsonDocument::fromJson(recovery).object();
            auto entries = record["files"].toArray();
            auto entry = entries[0].toObject(), before = entry["before"].toObject();
            before["version"] = QString(64, '0');
            entry["before"] = before; entries[0] = entry; record["files"] = entries;
            QVERIFY(writeFile(root + "/.nova-studio-recovery", QJsonDocument(record).toJson()));
        } else {
            QVERIFY(QDir(root).mkpath("generated/authored"));
            QVERIFY(writeFile(root + "/" + extraPath, "external data"));
        }
        const auto damagedRecovery = readFile(root + "/.nova-studio-recovery");
        QVERIFY(!ProjectDocument::finishInterruptedSave(path, &error));
        QVERIFY2(error.contains(diagnostic), qPrintable(error));
        QVERIFY(!QFileInfo::exists(root + "/" + old.source.path));
        QVERIFY(!QFileInfo::exists(root + "/" + old.outputs[0].path));
        QVERIFY(!QFileInfo::exists(root + "/.nova-studio-assets"));
        QCOMPARE(readFile(path), manifest);
        QCOMPARE(readFile(root + "/main.lua"), script);
        QCOMPARE(readFile(root + "/start.nova-scene"), scene);
        QCOMPARE(readFile(root + "/.nova-studio-journal"), journal);
        QCOMPARE(readFile(root + "/.nova-studio-recovery"), damagedRecovery);
        if (damage == 1) QVERIFY(writeFile(blob, newer.source.bytes));
        if (damage == 4) {
            QCOMPARE(readFile(root + "/" + extraPath), QByteArray("external data"));
            QVERIFY(QFile::remove(root + "/" + extraPath));
        }
        QVERIFY(writeFile(root + "/.nova-studio-recovery", recovery));
        QVERIFY2(ProjectDocument::finishInterruptedSave(path, &error), qPrintable(error));
        QCOMPARE(readFile(root + "/" + old.source.path), old.source.bytes);
        ProjectDocument reopened;
        QVERIFY(reopened.open(path, &error));
        QVERIFY2(reopened.restoreRecovery(&error), qPrintable(error));
        QCOMPARE(reopened.assetSnapshots()[0].source.bytes, newer.source.bytes);
        QVERIFY(reopened.dirty());
        QVERIFY2(reopened.save(&error), qPrintable(error));
        QCOMPARE(readFile(root + "/" + newer.source.path), newer.source.bytes);
    }

    void duplicateIndexKeysAreRetained()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-index-keys-XXXXXX");
        QString error, root, path;
        auto snapshot = assetSnapshot();
        snapshot.metadata = {{"quoted\"key", "\\value, [brackets]"},
            {"nested", QJsonArray{QJsonObject{{"same", 1}}, QJsonObject{{"same", 2}}}}};
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "IndexKeys", false, NOVA_EXAMPLES, &error));
            root = document.root(); path = document.path();
            QVERIFY(expectedVersions(document, &snapshot, &error));
            QVERIFY(document.stageAssetSnapshot(snapshot, &error));
            QVERIFY2(document.save(&error), qPrintable(error));
        }
        const auto index = readFile(root + "/.nova-studio-assets");
        QVERIFY(index.startsWith('{'));
        const auto duplicate = "{\"\\u0076ersion\":1," + index.mid(1);
        QVERIFY(writeFile(root + "/.nova-studio-assets", duplicate));
        ProjectDocument reopened;
        QVERIFY(!reopened.open(path, &error));
        QVERIFY2(error.contains("duplicate JSON keys"), qPrintable(error));
        QCOMPARE(readFile(root + "/.nova-studio-assets"), duplicate);
        QCOMPARE(readFile(root + "/" + snapshot.source.path), snapshot.source.bytes);
        QCOMPARE(readFile(root + "/" + snapshot.outputs[0].path), snapshot.outputs[0].bytes);
        QVERIFY(writeFile(root + "/.nova-studio-assets", index));
        QVERIFY2(reopened.open(path, &error), qPrintable(error));
        QCOMPARE(reopened.assetSnapshots()[0].metadata, snapshot.metadata);
    }

    void unknownRecoveryRequiresExplicitDiscard_data()
    {
        QTest::addColumn<QByteArray>("bytes");
        QTest::newRow("empty-existing-file") << QByteArray();
        QTest::newRow("unknown-record") << QByteArray("{\"format\":\"nova-studio-recovery\",\"version\":99}");
    }

    void unknownRecoveryRequiresExplicitDiscard()
    {
        QFETCH(QByteArray, bytes);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-unknown-recovery-XXXXXX");
        QString error, root, path;
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "UnknownRecovery", false, NOVA_EXAMPLES, &error));
            root = document.root(); path = document.path();
        }
        QVERIFY(writeFile(root + "/.nova-studio-recovery", bytes));
        ProjectDocument reopened;
        QVERIFY(reopened.open(path, &error));
        QVERIFY(!reopened.recoveryDescription().isEmpty());
        auto snapshot = assetSnapshot();
        QVERIFY(expectedVersions(reopened, &snapshot, &error));
        QVERIFY(reopened.stageAssetSnapshot(snapshot, &error));
        QVERIFY(!reopened.save(&error));
        QVERIFY2(error.contains("explicit Restore or Discard"), qPrintable(error));
        QVERIFY(!reopened.writeRecovery(&error));
        QCOMPARE(readFile(root + "/.nova-studio-recovery"), bytes);
        QVERIFY(QFileInfo::exists(root + "/.nova-studio-recovery"));
        QVERIFY(!QFileInfo::exists(root + "/" + snapshot.source.path));
        QVERIFY(!QFileInfo::exists(root + "/.nova-studio-assets"));
        QVERIFY2(reopened.discardRecovery(&error), qPrintable(error));
        QVERIFY(reopened.recoveryDescription().isEmpty());
        QVERIFY2(reopened.save(&error), qPrintable(error));
        QCOMPARE(readFile(root + "/" + snapshot.source.path), snapshot.source.bytes);
        QVERIFY(reopened.runtimeAssetsReady(&error));
    }

    void boundsRejectBeforePersistentMutation()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-bounds-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "Bounds", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot();
        QVERIFY(expectedVersions(document, &snapshot, &error));
        auto invalid = snapshot;
        invalid.outputs[0].bytes = QByteArray(ProjectDocument::AssetFileLimit + 1, '\0');
        QVERIFY(!document.stageAssetSnapshot(invalid, &error));
        QVERIFY(error.contains("limits"));
        invalid.outputs.clear();
        invalid.mode = StudioAssetSnapshot::Mode::SourceOnly;
        invalid.derivedProblem = "Over-budget source";
        invalid.source.bytes = QByteArray(ProjectDocument::AssetSourceLimit + 1, '\0');
        QVERIFY(!document.stageAssetSnapshot(invalid, &error));
        QVERIFY(error.contains("limits"));
        invalid = snapshot;
        invalid.metadata = {{"oversized", QString(64 * 1024, 'x')}};
        QVERIFY(!document.stageAssetSnapshot(invalid, &error));
        QVERIFY(error.contains("metadata"));
        invalid.metadata = {};
        for (int i = 0; i < 1100; ++i) invalid.metadata = {{"nested", invalid.metadata}};
        QVERIFY(!document.stageAssetSnapshot(invalid, &error));
        QVERIFY(error.contains("metadata"));
        invalid = snapshot; invalid.outputs.clear();
        QVERIFY(!document.stageAssetSnapshot(invalid, &error));
        QVERIFY(error.contains("source-only"));
        invalid = snapshot; invalid.mode = static_cast<StudioAssetSnapshot::Mode>(-1);
        QVERIFY(!document.stageAssetSnapshot(invalid, &error));
        QVERIFY(error.contains("publication"));
        QVERIFY(document.assetSnapshots().isEmpty());
        QVERIFY(!QFileInfo::exists(document.root() + "/sources"));
        QVERIFY(!QFileInfo::exists(document.root() + "/.nova-studio-assets"));
        QVERIFY(!QFileInfo::exists(document.root() + "/.nova-studio-snapshots"));
    }

    void aggregateAndInventoryBounds()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-aggregate-bounds-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "Aggregate", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot();
        snapshot.mode = StudioAssetSnapshot::Mode::SourceOnly;
        snapshot.derivedProblem = "Source preserved independently";
        snapshot.outputs.clear();
        snapshot.source.bytes = QByteArray(ProjectDocument::AssetSourceLimit, '\0');
        for (int i = 0; i < 3; ++i) {
            snapshot.id = "participant" + QString::number(i);
            snapshot.source.path = "sources/source" + QString::number(i) + ".bin";
            QVERIFY(expectedVersions(document, &snapshot, &error));
            QVERIFY2(document.stageAssetSnapshot(snapshot, &error), qPrintable(error));
        }
        snapshot.id = "participant3"; snapshot.source.path = "sources/source3.bin";
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(!document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(error.contains("limits"));
        snapshot.source.bytes.resize(61 * 1024 * 1024);
        QVERIFY2(document.stageAssetSnapshot(snapshot, &error), qPrintable(error));
        snapshot.source.bytes.append('\0');
        QVERIFY(!document.stageAssetSnapshot(snapshot, &error));
        QCOMPARE(document.assetSnapshots().size(), 4);
        QVERIFY(!QFileInfo::exists(document.root() + "/sources"));
        QVERIFY(!QFileInfo::exists(document.root() + "/.nova-studio-snapshots"));
    }

    void participantAndMetadataBounds()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-metadata-bounds-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "Metadata", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot();
        snapshot.mode = StudioAssetSnapshot::Mode::SourceOnly;
        snapshot.derivedProblem = "Source only";
        snapshot.outputs.clear();
        snapshot.metadata = {{"x", QString(64 * 1024 - 8, 'x')}};
        QCOMPARE(QJsonDocument(snapshot.metadata).toJson(QJsonDocument::Compact).size(), qsizetype(64 * 1024));
        for (int i = 0; i < 16; ++i) {
            snapshot.id = "participant" + QString::number(i);
            snapshot.source.path = "sources/source" + QString::number(i) + ".bin";
            QVERIFY(expectedVersions(document, &snapshot, &error));
            if (i < 15) QVERIFY2(document.stageAssetSnapshot(snapshot, &error), qPrintable(error));
            else {
                QVERIFY(!document.stageAssetSnapshot(snapshot, &error));
                QVERIFY(error.contains("1 MiB"));
                snapshot.metadata = {};
                QVERIFY(document.stageAssetSnapshot(snapshot, &error));
            }
        }
        snapshot.id = "participant16"; snapshot.source.path = "sources/source16.bin";
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(!document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(error.contains("16 authored"));
        QCOMPARE(document.assetSnapshots().size(), 16);
        QVERIFY(!QFileInfo::exists(document.root() + "/.nova-studio-assets"));
    }

    void transactionInventoryAliasesAreRejected()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-inventory-alias-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "Inventory", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot();
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(document.save(&error));
        snapshot = document.assetSnapshots()[0];
        snapshot.revision++;
        snapshot.outputs[0].path = "generated/authored/FRAME-1.png";
        snapshot.outputs[0].runtimeId = "renamed_output";
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(!document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(error.contains("alias"));
        snapshot = document.assetSnapshots()[0];
        for (int i = 0; i < 127; ++i) {
            StudioAssetFile file;
            file.path = QString("generated/authored/extra-%1.bin").arg(i);
            file.bytes = "x";
            snapshot.outputs.append(file);
        }
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(!document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(error.contains("limits"));
        snapshot.outputs.removeLast();
        QVERIFY2(document.stageAssetSnapshot(snapshot, &error), qPrintable(error));
        QCOMPARE(document.assetSnapshots()[0].outputs.size() + 1, ProjectDocument::MaxAssetFiles);
        QVERIFY(!QFileInfo::exists(document.root() + "/generated/authored/extra-0.bin"));
    }

    void wholeProjectPreflightIncludesUntouchedAssets()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-whole-preflight-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "WholeProject", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot();
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(document.save(&error));
        snapshot = document.assetSnapshots()[0];
        const auto oldSource = snapshot.source.bytes;
        snapshot.revision++; snapshot.source.bytes += "\nnew source";
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(writeFile(document.root() + "/starter.png", "external invalid untouched asset"));
        QVERIFY(!document.save(&error));
        QVERIFY2(error.contains("publication failed"), qPrintable(error));
        QCOMPARE(readFile(document.root() + "/" + snapshot.source.path), oldSource);
        QCOMPARE(readFile(document.root() + "/starter.png"), QByteArray("external invalid untouched asset"));
        QVERIFY(!QFileInfo::exists(document.root() + "/.nova-studio-journal"));
    }

    void legacyTransactionInventoryBudget_data()
    {
        QTest::addColumn<int>("version");
        QTest::newRow("v1") << 1;
        QTest::newRow("v2") << 2;
    }

    void legacyTransactionInventoryBudget()
    {
        QFETCH(int, version);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-legacy-inventory-XXXXXX");
        const auto root = temporary.path(), path = root + "/nova.project";
        const QByteArray manifest = "nova-project " + QByteArray::number(version) +
            "\nentry main.lua\n" + (version == 2 ? QByteArray("identity inventory\n") : QByteArray());
        QVERIFY(writeFile(path, manifest));
        QVERIFY(writeFile(root + "/main.lua", "function update() end\n"));
        ProjectDocument document;
        QString error;
        QVERIFY(document.open(path, &error));
        auto snapshot = assetSnapshot();
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(document.save(&error));
        const auto original = snapshot.outputs[0];
        snapshot = document.assetSnapshots()[0];
        snapshot.revision++;
        snapshot.outputs[0].path = "generated/authored/replacement.png";
        snapshot.outputs[0].runtimeId = "replacement_output";
        for (int i = 0; i < 126; ++i) {
            StudioAssetFile file;
            file.path = QString("generated/authored/sidecar-%1.bin").arg(i); file.bytes = "x";
            snapshot.outputs.append(file);
        }
        QCOMPARE(snapshot.outputs.size() + 1, ProjectDocument::MaxAssetFiles);
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(!document.stageAssetSnapshot(snapshot, &error));
        QVERIFY2(error.contains("transaction file count"), qPrintable(error));
        snapshot.outputs.removeLast();
        QVERIFY2(document.stageAssetSnapshot(snapshot, &error), qPrintable(error));
        QCOMPARE(readFile(root + "/" + original.path), original.bytes);
        QVERIFY(!QFileInfo::exists(root + "/" + snapshot.outputs[0].path));
        QVERIFY(!QFileInfo::exists(root + "/.nova-studio-journal"));
    }

    void assetRegistrationPreservesLegacyManifestVersions()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-legacy-XXXXXX");
        QString error;
        const QByteArray script = "-- hand-authored bytes\r\nfunction update() end\r\n";
        for (const int version : {1, 2}) {
            const auto directory = "legacy" + QString::number(version);
            QVERIFY(QDir(temporary.path()).mkdir(directory));
            const auto root = temporary.path() + "/" + directory;
            const auto path = root + "/.nova-project.project";
            QVERIFY(writeFile(root + "/.nova-studio-main.lua", script));
            const QByteArray manifest = "nova-project " + QByteArray::number(version) +
                "\nentry .nova-studio-main.lua\n" + (version == 2 ? QByteArray("identity legacy\n") : QByteArray());
            QVERIFY(writeFile(path, manifest));
            {
                ProjectDocument document;
                QVERIFY(document.open(path, &error));
                auto snapshot = assetSnapshot();
                QVERIFY(expectedVersions(document, &snapshot, &error));
                QVERIFY(document.stageAssetSnapshot(snapshot, &error));
                QVERIFY2(document.writeRecovery(&error), qPrintable(error));
            }
            ProjectDocument reopened;
            QVERIFY(reopened.open(path, &error));
            QVERIFY2(reopened.restoreRecovery(&error), qPrintable(error));
            QVERIFY2(reopened.save(&error), qPrintable(error));
            QCOMPARE(reopened.project().version, unsigned(version));
            QCOMPARE(readFile(root + "/.nova-studio-main.lua"), script);
            QVERIFY(!QFileInfo::exists(root + "/start.nova-scene"));
            QVERIFY(reopened.runtimeAssetsReady(&error));
        }
    }

    void maximumComponentPayloadEnvelope()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-envelope-XXXXXX");
        QString error, path, root;
        auto snapshot = assetSnapshot();
        snapshot.kind = "storage_fixture";
        snapshot.source.bytes = QByteArray(ProjectDocument::AssetSourceLimit, '\0');
        snapshot.source.bytes[0] = 'S';
        const qsizetype pngBytes = snapshot.outputs[0].bytes.size();
        for (int i = 0; i < 5; ++i) {
            StudioAssetFile file;
            file.path = QString("generated/authored/payload-%1.bin").arg(i);
            const qsizetype size = i == 4 ? 1024 * 1024 : ProjectDocument::AssetFileLimit - (i == 0 ? pngBytes : 0);
            file.bytes = QByteArray(size, char('a' + i));
            snapshot.outputs.append(file);
        }
        StudioAssetFile metadata;
        metadata.path = "generated/authored/metadata.bin";
        metadata.bytes = QByteArray(64 * 1024, 'm');
        snapshot.outputs.append(metadata);
        qsizetype outputs = 0;
        for (const auto &file : snapshot.outputs) outputs += file.bytes.size();
        QCOMPARE(outputs, 65 * qsizetype(1024 * 1024) + 64 * 1024);
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "MaximumEnvelope", false, NOVA_EXAMPLES, &error));
            path = document.path(); root = document.root();
            QVERIFY(expectedVersions(document, &snapshot, &error));
            QVERIFY2(document.stageAssetSnapshot(snapshot, &error), qPrintable(error));
            QVERIFY2(document.save(&error), qPrintable(error));
            QVERIFY(readFile(root + "/" + snapshot.source.path) == snapshot.source.bytes);
            auto next = document.assetSnapshots()[0];
            next.revision++; next.source.bytes[1] = 'N';
            next.outputs[1].bytes[0] = 'z';
            QVERIFY(document.stageAssetSnapshot(next, &error));
            QVERIFY2(document.writeRecovery(&error), qPrintable(error));
            QVERIFY(readFile(root + "/.nova-studio-recovery").size() < 16384);
        }
        ProjectDocument reopened;
        QVERIFY2(reopened.open(path, &error), qPrintable(error));
        QVERIFY2(reopened.restoreRecovery(&error), qPrintable(error));
        QCOMPARE(reopened.assetSnapshots()[0].source.bytes.size(), ProjectDocument::AssetSourceLimit);
        QCOMPARE(reopened.assetSnapshots()[0].source.bytes[1], 'N');
        QCOMPARE(reopened.assetSnapshots()[0].outputs[1].bytes[0], 'z');
        QVERIFY2(reopened.save(&error), qPrintable(error));
        QVERIFY(!reopened.dirty());
        QCOMPARE(readFile(root + "/" + snapshot.source.path).size(), ProjectDocument::AssetSourceLimit);
        const auto persisted = reopened.assetSnapshots();
        for (const auto &file : persisted[0].outputs)
            QVERIFY(readFile(root + "/" + file.path) == file.bytes);
    }
};

QTEST_GUILESS_MAIN(DocumentTest)
#include "qt_document_test.moc"
