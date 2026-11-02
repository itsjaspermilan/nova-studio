#include "project_document.h"
#include <QCryptographicHash>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTemporaryDir>
#include <QtTest>
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

static StudioAssetSnapshot assetSnapshot(bool model = false)
{
    StudioAssetSnapshot snapshot;
    snapshot.id = "authored"; snapshot.kind = model ? "mesh" : "sprite"; snapshot.revision = 17;
    snapshot.metadata = {{"name", "Authored asset"}, {"componentVersion", 1}};
    snapshot.source.path = model ? "sources/authored.nvmesh" : "sources/authored.nvsprite";
    snapshot.source.bytes = QByteArray("component-owned\0source", 22);
    StudioAssetFile output;
    output.path = model ? "generated/authored/mesh.glb" : "generated/authored/frame-1.png";
    output.runtimeId = "authored_output";
    output.runtimeType = model ? NOVA_ASSET_MODEL : NOVA_ASSET_SPRITE;
    output.bytes = readFile(QString(NOVA_EXAMPLES) + (model ? "/assets/assets/gem.glb" : "/sprites/assets/token.png"));
    snapshot.outputs.append(output);
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
        QTest::addColumn<bool>("model");
        QTest::newRow("png") << false;
        QTest::newRow("glb") << true;
    }

    void assetPublishedRoundTrip()
    {
        QFETCH(bool, model);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-assets-XXXXXX");
        QString error, path, root;
        auto snapshot = assetSnapshot(model);
        snapshot.revision = (quint64(1) << 60) + 17;
        QVERIFY(!snapshot.outputs[0].bytes.isEmpty());
        QByteArray script, hash;
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "Assets", model, NOVA_EXAMPLES, &error));
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
        }
        ProjectDocument reopened;
        QVERIFY2(reopened.open(path, &error), qPrintable(error));
        QCOMPARE(reopened.assetSnapshots().size(), 1);
        const auto restored = reopened.assetSnapshots()[0];
        QCOMPARE(ProjectDocument::assetSnapshotDigest(restored), hash);
        QCOMPARE(restored.source.bytes, snapshot.source.bytes);
        QVERIFY(restored.source.expected.exists);
        QVERIFY(reopened.assetPublication(snapshot.id).saved);
        QVERIFY2(reopened.runtimeAssetsReady(&error), qPrintable(error));
        QVERIFY(!reopened.dirty());
    }

    void sourceOnlyRetainsPublishedGeneration()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-source-only-XXXXXX");
        QString error, path;
        QByteArray oldPng, oldScript, oldSource;
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "SourceOnly", false, NOVA_EXAMPLES, &error));
            path = document.path(); oldScript = document.draft().script;
            auto snapshot = assetSnapshot();
            QVERIFY(expectedVersions(document, &snapshot, &error));
            QVERIFY(document.stageAssetSnapshot(snapshot, &error));
            QVERIFY2(document.save(&error), qPrintable(error));
            snapshot = document.assetSnapshots()[0];
            oldPng = snapshot.outputs[0].bytes; oldSource = snapshot.source.bytes;
            snapshot.revision++;
            snapshot.source.bytes += "\neditable new source";
            snapshot.outputs[0].bytes = "not a PNG";
            QVERIFY(document.stageAssetSnapshot(snapshot, &error));
            QVERIFY(!document.save(&error));
            QVERIFY2(error.contains("publication failed"), qPrintable(error));
            QCOMPARE(readFile(document.root() + "/" + snapshot.source.path), oldSource);
            QCOMPARE(readFile(document.root() + "/" + snapshot.outputs[0].path), oldPng);
            QVERIFY(QFileInfo::exists(document.root() + "/.nova-studio-recovery"));
            QVERIFY(!QFileInfo::exists(document.root() + "/.nova-studio-journal"));
            QVERIFY(!document.runtimeAssetsReady(&error));
            QCOMPARE(document.assetPublication(snapshot.id).revision, quint64(17));
            QCOMPARE(document.assetPublication(snapshot.id).sourceDigest, sha256(oldSource));
            QCOMPARE(document.savedAssetSnapshots()[0].outputs[0].bytes, oldPng);
            snapshot.mode = StudioAssetSnapshot::Mode::SourceOnly;
            snapshot.derivedProblem = "Current source requires unsupported runtime features";
            snapshot.outputs.clear();
            QVERIFY2(document.stageAssetSnapshot(snapshot, &error), qPrintable(error));
            QVERIFY(document.editScript("function incomplete(", &error));
            QVERIFY2(document.save(&error), qPrintable(error));
            QCOMPARE(readFile(document.root() + "/" + snapshot.source.path), snapshot.source.bytes);
            QCOMPARE(readFile(document.root() + "/generated/authored/frame-1.png"), oldPng);
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
        snapshot.outputs[0].bytes = oldPng;
        QVERIFY(reopened.editScript(QString::fromUtf8(oldScript), &error));
        QVERIFY(reopened.stageAssetSnapshot(snapshot, &error));
        QVERIFY2(reopened.save(&error), qPrintable(error));
        QVERIFY(reopened.runtimeAssetsReady(&error));
        QCOMPARE(reopened.assetPublication(snapshot.id).revision, snapshot.revision);
        QCOMPARE(reopened.assetPublication(snapshot.id).sourceDigest, sha256(snapshot.source.bytes));
    }

    void sourceOnlyWithoutPreviousExport()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-unpublished-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "Unpublished", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot();
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

    void interruptedAssetCommitRetainsNewerSnapshot()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-resume-XXXXXX");
        ProjectDocument document;
        QString error;
        QVERIFY(document.create(temporary.path(), "ResumeAssets", false, NOVA_EXAMPLES, &error));
        auto snapshot = assetSnapshot();
        QVERIFY(expectedVersions(document, &snapshot, &error));
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QVERIFY(document.writeRecovery(&error));
        const auto older = snapshot;
        QVERIFY(writeFile(document.root() + "/.nova-studio-journal", readFile(document.root() + "/.nova-studio-recovery")));
        snapshot.revision++;
        snapshot.source.bytes += "\nnewer source";
        snapshot.outputs[0].bytes = readFile(QString(NOVA_EXAMPLES) + "/sprites/assets/tile.png");
        QVERIFY(document.stageAssetSnapshot(snapshot, &error));
        QSignalSpy acknowledgments(&document, &ProjectDocument::assetSnapshotSaved);
        QVERIFY2(document.resumeInterruptedSave(&error), qPrintable(error));
        QCOMPARE(readFile(document.root() + "/" + snapshot.source.path), older.source.bytes);
        QCOMPARE(readFile(document.root() + "/" + snapshot.outputs[0].path), older.outputs[0].bytes);
        QCOMPARE(document.assetSnapshots()[0].source.bytes, snapshot.source.bytes);
        QCOMPARE(document.assetSnapshots()[0].outputs[0].bytes, snapshot.outputs[0].bytes);
        QVERIFY(document.dirty());
        QCOMPARE(acknowledgments.size(), 1);
        QCOMPARE(acknowledgments[0][1].toULongLong(), older.revision);
        QVERIFY(!document.isAssetSnapshotSaved(older.id, older.revision, ProjectDocument::assetSnapshotDigest(older)));
        QVERIFY(!document.runtimeAssetsReady(&error));
        QVERIFY(document.recoveryPreview().contains(QString::fromLatin1(sha256(snapshot.source.bytes))));
        QVERIFY2(document.save(&error), qPrintable(error));
        QCOMPARE(readFile(document.root() + "/" + snapshot.source.path), snapshot.source.bytes);
        QCOMPARE(readFile(document.root() + "/" + snapshot.outputs[0].path), snapshot.outputs[0].bytes);
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

    void partialBinaryWriteReportsAndRetainsSnapshots()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-partial-XXXXXX");
        QString error, path, root;
        auto snapshot = assetSnapshot();
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
        newer.outputs[0].bytes = readFile(QString(NOVA_EXAMPLES) + "/sprites/assets/tile.png");
        QVERIFY(document.stageAssetSnapshot(newer, &error));
        QVERIFY(!document.save(&error));
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
        QTest::newRow("completed-receipt") << 1;
        QTest::newRow("interrupted-before-receipt") << 0;
        QTest::newRow("external-rewrite-after-receipt") << 2;
    }

    void committedBinaryReceiptAndAbsentConflict()
    {
        QFETCH(int, receipt);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-receipt-XXXXXX");
        QString error, root, path;
        StudioDiskVersion committed;
        auto snapshot = assetSnapshot();
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

    void restartFinishesOldCommitAndRecoversNewerAssets()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-asset-restart-XXXXXX");
        QString error, path, root;
        auto old = assetSnapshot(), newer = old;
        {
            ProjectDocument document;
            QVERIFY(document.create(temporary.path(), "Restart", false, NOVA_EXAMPLES, &error));
            path = document.path(); root = document.root();
            QVERIFY(expectedVersions(document, &old, &error));
            QVERIFY(document.stageAssetSnapshot(old, &error));
            QVERIFY(document.writeRecovery(&error));
            QVERIFY(writeFile(root + "/.nova-studio-journal", readFile(root + "/.nova-studio-recovery")));
            newer = old; newer.revision++; newer.source.bytes += "\nnew source";
            newer.outputs[0].bytes = readFile(QString(NOVA_EXAMPLES) + "/sprites/assets/tile.png");
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
        QVERIFY(document.dirty());
        QVERIFY(document.save(&error));
        QCOMPARE(readFile(root + "/" + newer.source.path), newer.source.bytes);
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
