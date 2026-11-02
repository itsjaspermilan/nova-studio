#include "project_document.h"
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTemporaryDir>
#include <QtTest>

extern "C" {
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
};

QTEST_GUILESS_MAIN(DocumentTest)
#include "qt_document_test.moc"
