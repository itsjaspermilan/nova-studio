#include "studio_window.h"
#include "code_editor.h"
#include "native_viewport.h"
#include <QAccessible>
#include <QAbstractItemView>
#include <QAction>
#include <QApplication>
#include <QComboBox>
#include <QCompleter>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDir>
#include <QDoubleSpinBox>
#include <QFile>
#include <QFileDialog>
#include <QInputMethodEvent>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QPushButton>
#include <QSurfaceFormat>
#include <QStatusBar>
#include <QTabWidget>
#include <QTemporaryDir>
#include <QTextBlock>
#include <QTextLayout>
#include <QTreeWidget>
#include <QtTest>

namespace {
QByteArray readFile(const QString &path)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) return {};
    return file.readAll();
}

bool writeFile(const QString &path, const QByteArray &bytes)
{
    QFile file(path);
    return file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size() && file.flush();
}

QPoint canvasPoint(NativeViewport *viewport, QPointF point)
{
    const double scale = std::min(viewport->width() / 960.0, viewport->height() / 540.0);
    return QPoint(qRound((viewport->width() - 960 * scale) / 2 + point.x() * scale),
        qRound((viewport->height() - 540 * scale) / 2 + point.y() * scale));
}

QPoint objectPoint(ProjectDocument *document, NativeViewport *viewport)
{
    const auto &scene = document->scene();
    const auto &object = scene.objects[0];
    if (scene.mode == NOVA_2D)
        return canvasPoint(viewport, {object.position.x + object.size.x / 2, object.position.y + object.size.y / 2});
    const Camera3D camera{{scene.camera_position.x, scene.camera_position.y, scene.camera_position.z},
        {scene.camera_target.x, scene.camera_target.y, scene.camera_target.z}, {0, 1, 0}, scene.camera_fov, CAMERA_PERSPECTIVE};
    const auto bounds = viewport->resources().inspection[0];
    const Vector3 center{object.position.x + (bounds.bounds_min.x + bounds.bounds_max.x) / 2 * object.size.x,
        object.position.y + (bounds.bounds_min.y + bounds.bounds_max.y) / 2 * object.size.y,
        object.position.z + (bounds.bounds_min.z + bounds.bounds_max.z) / 2 * object.size.z};
    const Vector2 screen = GetWorldToScreenEx(center, camera, NOVA_WIDTH, NOVA_HEIGHT);
    return canvasPoint(viewport, {screen.x, screen.y});
}

void typeNumber(QDoubleSpinBox *field, const QString &value)
{
    QTest::mouseClick(field, Qt::LeftButton);
    QTest::keyClick(field, Qt::Key_A, Qt::ControlModifier);
    QTest::keyClicks(field, value);
    QTest::keyClick(field, Qt::Key_Return);
}

}

class WorkspaceTest final : public QObject {
    Q_OBJECT
private slots:
    void authoringLoop_data()
    {
        QTest::addColumn<bool>("threeD");
        QTest::newRow("2d") << false;
        QTest::newRow("3d") << true;
    }

    void authoringLoop()
    {
        QFETCH(bool, threeD);
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-workspace-XXXXXX");
        QVERIFY(temporary.isValid());
        StudioWindow window(NOVA_EXAMPLES, false, [](QFileDialog *dialog) {
            dialog->setOption(QFileDialog::DontUseNativeDialog);
        });
        window.show();
        QVERIFY(QTest::qWaitForWindowExposed(&window));
        auto *viewport = window.viewport();
        auto *document = window.projectDocument();
        auto *editor = window.codeEditor();
        auto *tabs = window.findChild<QTabWidget *>("workspaces");
        auto *tree = window.findChild<QTreeWidget *>("sceneOutline");
        auto *problems = window.findChild<QListWidget *>("problems");
        QVERIFY(tabs && tree && problems);
        QTimer deadline;
        deadline.setInterval(5000);
        connect(&deadline, &QTimer::timeout, &window, [] {
            if (auto *dialog = qobject_cast<QDialog *>(QApplication::activeModalWidget())) dialog->reject();
        });
        deadline.start();
        bool newDriven = false;
        QTimer::singleShot(50, &window, [&] {
            auto *dialog = window.findChild<QDialog *>("newProjectDialog");
            if (!dialog) return;
            auto *name = dialog->findChild<QLineEdit *>("newName");
            auto *location = dialog->findChild<QLineEdit *>("newLocation");
            auto *dimension = dialog->findChild<QComboBox *>("newDimension");
            auto *create = dialog->findChild<QPushButton *>("createProjectButton");
            if (!name || !location || !dimension || !create) { dialog->reject(); return; }
            name->setFocus(); name->selectAll(); QTest::keyClicks(name, threeD ? "Forest 3D" : "Forest 2D");
            location->setFocus(); location->selectAll(); QTest::keyClicks(location, temporary.path());
            if (threeD) { dimension->setFocus(); QTest::keyClick(dimension, Qt::Key_Down); }
            newDriven = true;
            QTest::mouseClick(create, Qt::LeftButton);
        });
        QTest::mouseClick(window.findChild<QPushButton *>("welcomeNew"), Qt::LeftButton);
        deadline.stop();
        QVERIFY(newDriven);
        QVERIFY2(document->isOpen(), qPrintable(problems->count() ? problems->item(0)->text() : "New did not create a project"));
        QCOMPARE(document->scene().mode, threeD ? NOVA_3D : NOVA_2D);
        QTRY_VERIFY_WITH_TIMEOUT(viewport->ready(), 10000);
        QTRY_COMPARE(viewport->resources().count, size_t(1));
        const auto originalLua = document->draft().script;
        const auto originalScene = document->draft().scene;
        const auto texture = viewport->resources().resources[0].texture.id;
        auto *player = tree->topLevelItem(0)->child(0);
        QTest::mouseClick(tree->viewport(), Qt::LeftButton, Qt::NoModifier, tree->visualItemRect(player).center());
        QCOMPARE(document->selection(), QString("player"));
        auto *x = window.findChild<QDoubleSpinBox *>("transform0");
        QVERIFY(x && x->isVisible());
        const float initialX = document->scene().objects[0].position.x;
        typeNumber(x, threeD ? "1.25" : "512");
        QCOMPARE(document->scene().objects[0].position.x, threeD ? 1.25f : 512.f);
        QCOMPARE(document->draft().script, originalLua);
        QCOMPARE(viewport->resources().resources[0].texture.id, texture);
        window.findChild<QAction *>("undo")->trigger();
        QCOMPARE(document->scene().objects[0].position.x, initialX);
        QCOMPARE(document->draft().scene, originalScene);
        window.findChild<QAction *>("redo")->trigger();
        QCOMPARE(document->scene().objects[0].position.x, threeD ? 1.25f : 512.f);
        auto *name = window.findChild<QLineEdit *>("objectName");
        name->setFocus(); name->selectAll();
        QInputMethodEvent unicode;
        unicode.setCommitString(QString::fromUtf8("Cr\xc3\xa9" "ature \xe6\xa3\xae"));
        QCoreApplication::sendEvent(name, &unicode);
        QTest::keyClick(name, Qt::Key_Return);
        QCOMPARE(QString::fromUtf8(document->scene().objects[0].name), QString::fromUtf8("Cr\xc3\xa9" "ature \xe6\xa3\xae"));
        QCOMPARE(document->draft().script, originalLua);

        const int undoCount = document->undoStack()->count();
        const QPoint point = objectPoint(document, viewport);
        QTest::mouseClick(viewport, Qt::LeftButton, Qt::NoModifier, point);
        QCOMPARE(document->selection(), QString("player"));
        QCOMPARE(document->undoStack()->count(), undoCount); // Selecting must not snap/move.
        const auto beforeDrag = document->draft().scene;
        QTest::mousePress(viewport, Qt::LeftButton, Qt::NoModifier, point);
        QTest::mouseMove(viewport, point + QPoint(40, 20));
        QTest::mouseRelease(viewport, Qt::LeftButton, Qt::NoModifier, point + QPoint(40, 20));
        QVERIFY(document->draft().scene != beforeDrag);
        QCOMPARE(document->undoStack()->count(), undoCount + 1);
        QCOMPARE(document->draft().script, originalLua);
        window.findChild<QAction *>("undo")->trigger();
        QCOMPARE(document->draft().scene, beforeDrag);
        QTest::mousePress(viewport, Qt::LeftButton, Qt::NoModifier, point);
        QTest::mouseMove(viewport, point + QPoint(50, 20));
        QTest::keyClick(viewport, Qt::Key_Escape);
        QTest::mouseRelease(viewport, Qt::LeftButton, Qt::NoModifier, point + QPoint(50, 20));
        QCOMPARE(document->draft().scene, beforeDrag);

        tabs->setCurrentIndex(1);
        editor->setFocus();
        editor->moveCursor(QTextCursor::End);
        QTest::keyClick(editor, Qt::Key_Return);
        QTest::keyClicks(editor, "-- My gameplay: ");
        QInputMethodEvent commit;
        commit.setCommitString(QString::fromUtf8("\xe6\x97\xa5\xe6\x9c\xac"));
        QCoreApplication::sendEvent(editor, &commit);
        const auto authored = document->draft().script;
        QVERIFY(authored.endsWith("\xe6\x97\xa5\xe6\x9c\xac"));
        QTest::keyClick(editor, Qt::Key_Return);
        QTest::keyClicks(editor, "local broken = ");
        editor->checkSyntax();
        QVERIFY(problems->count() > 0);
        auto *problem = problems->item(problems->count() - 1);
        QVERIFY(problem->data(Qt::UserRole + 1).toInt() > 0);
        QTest::mouseDClick(problems->viewport(), Qt::LeftButton, Qt::NoModifier, problems->visualItemRect(problem).center());
        QCOMPARE(tabs->currentIndex(), 1);
        QCOMPARE(editor->textCursor().blockNumber() + 1, problem->data(Qt::UserRole + 1).toInt());
        editor->moveCursor(QTextCursor::End); QTest::keyClicks(editor, "1"); QTest::keyClick(editor, Qt::Key_Return);
        editor->checkSyntax();
        QCOMPARE(problems->count(), 0);
        QVERIFY(QAccessible::queryAccessibleInterface(editor)->textInterface());
        QTRY_VERIFY(window.statusBar()->geometry().top() -
            editor->mapTo(&window, QPoint(0, editor->height())).y() < 12);
        auto *projectState = window.findChild<QLabel *>("projectState");
        QTRY_VERIFY(projectState->width() >= projectState->sizeHint().width());
        QVERIFY(window.grab().save(QString(NOVA_TEST_DIRECTORY) + (threeD ? "/qt-studio-code-3d.png" : "/qt-studio-code-2d.png")));
        window.findChild<QAction *>("saveProject")->trigger();
        QVERIFY(!document->dirty());
        const QString path = document->path();
        const auto savedLua = document->draft().script;
        QCOMPARE(readFile(document->root() + "/main.lua"), savedLua);
        tabs->setCurrentIndex(0);
        window.findChild<QAction *>("runProject")->trigger();
        QVERIFY2(viewport->running(), qPrintable(viewport->error()));
        QVERIFY(editor->isReadOnly());
        const float start = viewport->frame()->commands[0].position.x;
        window.activateWindow(); viewport->setFocus();
        QTRY_VERIFY(window.isActiveWindow() && viewport->hasFocus());
        QTest::keyPress(viewport, Qt::Key_Right);
        QTest::qWait(70);
        QTest::keyRelease(viewport, Qt::Key_Right);
        QVERIFY(viewport->frame()->commands[0].position.x > start);
        QCOMPARE(document->draft().scene, beforeDrag);
        QTest::keyClick(viewport, Qt::Key_Escape);
        QVERIFY(window.isVisible());
        QVERIFY(!viewport->hasFocus());
        window.findChild<QAction *>("stopProject")->trigger();
        QVERIFY(!viewport->running());
        QVERIFY(!editor->isReadOnly());
        QCOMPARE(document->draft().script, savedLua);
        const auto image = viewport->grabFramebuffer();
        QCOMPARE(image.width(), qRound(viewport->width() * viewport->devicePixelRatioF()));
        int content = 0;
        for (int y = 0; y < image.height(); ++y)
            for (int x = 0; x < image.width(); ++x) {
                const auto color = image.pixelColor(x, y);
                if (color.red() > 80 || color.green() > 80 || color.blue() > 80) ++content;
            }
        QVERIFY(content > 100);
        QVERIFY(window.grab().save(QString(NOVA_TEST_DIRECTORY) + (threeD ? "/qt-studio-3d.png" : "/qt-studio-2d.png")));
        window.resize(1100, 740);
        QTest::qWait(50);
        QCOMPARE(window.minimumSize(), QSize(1100, 740));
        QCOMPARE(window.size(), QSize(1100, 740));
        QVERIFY(window.grab().save(QString(NOVA_TEST_DIRECTORY) + (threeD ? "/qt-studio-3d-min.png" : "/qt-studio-2d-min.png")));

        QSignalSpy opened(document, &ProjectDocument::changed);
        {
            window.findChild<QAction *>("openProject")->trigger();
            auto *dialog = window.findChild<QFileDialog *>("openProjectDialog");
            QVERIFY(dialog);
            QVERIFY(QTest::qWaitForWindowExposed(dialog));
            QSignalSpy accepted(dialog, &QDialog::accepted);
            auto *filename = dialog->findChild<QLineEdit *>("fileNameEdit");
            QVERIFY(filename);
            QVERIFY(filename->isVisible());
            filename->setFocus(); filename->selectAll(); QTest::keyClicks(filename, QFileInfo(path).fileName());
            QCOMPARE(filename->text(), QFileInfo(path).fileName());
            QCOMPARE(dialog->selectedFiles(), QStringList{path});
            auto *buttons = dialog->findChild<QDialogButtonBox *>();
            QVERIFY(buttons && buttons->button(QDialogButtonBox::Open));
            QTRY_VERIFY(buttons->button(QDialogButtonBox::Open)->isEnabled());
            auto *openButton = buttons->button(QDialogButtonBox::Open);
            QVERIFY(openButton->isVisible());
            QSignalSpy clicked(openButton, &QPushButton::clicked);
            openButton->setFocus();
            QTest::keyClick(openButton, Qt::Key_Space);
            QCOMPARE(clicked.count(), 1);
            QTRY_VERIFY2(opened.count() > 0, qPrintable(QString("Dialog accepted %1; project problems: %2")
                .arg(accepted.count()).arg(problems->count() ? problems->item(problems->count() - 1)->text() : "none")));
        }
        QCOMPARE(document->path(), path);
        QCOMPARE(document->draft().script, savedLua);
        QVERIFY(!document->dirty());

        window.findChild<QAction *>("importAsset")->trigger();
        auto *importDialog = window.findChild<QFileDialog *>("importAssetDialog");
        QVERIFY(importDialog);
        QVERIFY(QTest::qWaitForWindowExposed(importDialog));
        importDialog->setDirectory(QString(NOVA_EXAMPLES) + (threeD ? "/assets/assets" : "/sprites/assets"));
        auto *importName = importDialog->findChild<QLineEdit *>("fileNameEdit");
        QVERIFY(importName);
        importName->setFocus(); importName->selectAll(); QTest::keyClicks(importName, threeD ? "gem.glb" : "tile.png");
        auto *importButtons = importDialog->findChild<QDialogButtonBox *>();
        QVERIFY(importButtons && importButtons->button(QDialogButtonBox::Open));
        importButtons->button(QDialogButtonBox::Open)->setFocus();
        QTest::keyClick(importButtons->button(QDialogButtonBox::Open), Qt::Key_Space);
        QTRY_COMPARE(document->project().count, size_t(2));
        QCOMPARE(viewport->resources().count, size_t(2));
        const QString imported = document->root() + "/" + QString::fromUtf8(document->project().assets[1].path);
        auto *place = window.findChild<QPushButton *>("placeAsset");
        QVERIFY(place && place->isEnabled());
        QTest::mouseClick(place, Qt::LeftButton);
        QCOMPARE(document->scene().count, size_t(2));
        QCOMPARE(document->draft().script, savedLua);
        window.findChild<QAction *>("undo")->trigger();
        QCOMPARE(document->scene().count, size_t(1));
        window.findChild<QAction *>("undo")->trigger();
        QCOMPARE(document->project().count, size_t(1));
        QVERIFY(QFileInfo::exists(imported));
        window.findChild<QAction *>("redo")->trigger();
        QCOMPARE(document->project().count, size_t(2));

        const auto retainedResource = viewport->resources().resources[0];
        const auto retainedFrame = std::make_unique<NovaFrame>(*viewport->frame());
        QVERIFY(QFile::rename(imported, imported + ".held"));
        window.findChild<QAction *>("reloadPreview")->trigger();
        QVERIFY(!viewport->error().isEmpty());
        QCOMPARE(viewport->resources().resources[0].texture.id, retainedResource.texture.id);
        QCOMPARE(viewport->resources().resources[0].model.meshes, retainedResource.model.meshes);
        QCOMPARE(viewport->frame()->count, retainedFrame->count);
        QCOMPARE(viewport->frame()->commands[0].position.x, retainedFrame->commands[0].position.x);
        QVERIFY(window.findChild<QLabel *>("previewState")->text().contains("retained"));
        QVERIFY(QFile::rename(imported + ".held", imported));
        window.findChild<QAction *>("reloadPreview")->trigger();
        QVERIFY(viewport->error().isEmpty());
        window.findChild<QAction *>("saveProject")->trigger();
        QVERIFY(!document->dirty());

        player = tree->topLevelItem(0)->child(0);
        QTest::mouseClick(tree->viewport(), Qt::LeftButton, Qt::NoModifier, tree->visualItemRect(player).center());
        window.findChild<QAction *>("deleteObject")->trigger();
        QCOMPARE(document->scene().count, size_t(0));
        QCOMPARE(document->draft().script, savedLua);
        window.findChild<QAction *>("runProject")->trigger();
        QVERIFY(!viewport->running());
        QVERIFY(viewport->error().contains("unknown scene object"));
        QVERIFY(window.findChild<QAction *>("stopProject")->isEnabled());
        window.findChild<QAction *>("stopProject")->trigger();
        window.findChild<QAction *>("undo")->trigger();
        QCOMPARE(document->scene().count, size_t(1));
        QCOMPARE(QByteArray(document->scene().objects[0].id), QByteArray("player"));
        window.findChild<QAction *>("saveProject")->trigger();
        QVERIFY(!document->dirty());

        const QString generated = temporary.path() + "/Generated";
        QVERIFY(QDir().mkdir(generated));
        QVERIFY(writeFile(generated + "/game.project", "nova-project 1\nentry game.generated.lua\n"));
        QVERIFY(writeFile(generated + "/game.generated.lua", "nova.scene('2d')\nfunction update() nova.rectangle(5,5,20,20,255,255,255) end\n"));
        QVERIFY(window.openProject(generated + "/game.project", false));
        QVERIFY(editor->isReadOnly());
        QVERIFY(!window.findChild<QAction *>("saveProject")->isEnabled());
        window.findChild<QAction *>("runProject")->trigger();
        QVERIFY2(viewport->running(), qPrintable(viewport->error()));
        window.findChild<QAction *>("stopProject")->trigger();
        QVERIFY(window.findChild<QListWidget *>("luaReference")->isEnabled());
        QVERIFY(window.openProject(path, false));
        player = tree->topLevelItem(0)->child(0);
        QTest::mouseClick(tree->viewport(), Qt::LeftButton, Qt::NoModifier, tree->visualItemRect(player).center());
        QVERIFY(x->isEnabled());
        QVERIFY(!editor->isReadOnly());

        const QByteArray external = document->draft().script + "-- changed by another editor\n";
        QVERIFY(writeFile(document->root() + "/main.lua", external));
        QTRY_VERIFY(document->externalChanges());
        QCOMPARE(projectState->text(), QString("External changes"));
        window.findChild<QAction *>("saveProject")->trigger();
        QCOMPARE(readFile(document->root() + "/main.lua"), external);
        QVERIFY(document->draft().script != external);
        QVERIFY(window.openProject(path, false));
        QCOMPARE(document->draft().script, external);
        QCOMPARE(projectState->text(), QString("Saved"));
        QVERIFY(window.close());
    }

    void codeTools()
    {
        CodeEditor editor;
        editor.resize(720, 480);
        editor.setProjectNames({"player"}, {"starter"});
        editor.show();
        QVERIFY(QTest::qWaitForWindowExposed(&editor));
        editor.setFocus();
        QTest::keyClicks(&editor, "nova.pos");
        QTRY_VERIFY(editor.completer()->popup()->isVisible());
        QTest::keyClick(editor.completer()->popup(), Qt::Key_Escape);
        QTRY_VERIFY(!editor.completer()->popup()->isVisible());
        QTest::keySequence(&editor, CodeEditor::completionShortcut());
        QTRY_VERIFY(editor.completer()->popup()->isVisible());
        QTest::keyClick(editor.completer()->popup(), Qt::Key_Down);
        QTest::keyClick(editor.completer()->popup(), Qt::Key_Return);
        QCOMPARE(editor.toPlainText(), QString("nova.position"));
        QTest::keyClicks(&editor, "(player)");
        QSignalSpy syntax(&editor, &CodeEditor::syntaxResult);
        editor.checkSyntax();
        QCOMPARE(syntax.last()[0].toInt(), 0);
        QCOMPARE(syntax.last()[1].toString(), QString());
        const auto text = editor.toPlainText();
        editor.setReadOnly(true);
        QTest::keyClick(&editor, Qt::Key_Tab);
        QTest::keySequence(&editor, CodeEditor::completionShortcut());
        QVERIFY(!editor.completer()->popup()->isVisible());
        QVERIFY(QMetaObject::invokeMethod(editor.completer(), "activated", Q_ARG(QString, "nova.object")));
        QCOMPARE(editor.toPlainText(), text);

        editor.setReadOnly(false);
        editor.setSource("local text = [=[first\nnova.object('not code')\nlast]=]\n"
            "--[==[note\nlocal nope = 2\n]==]\nlocal answer = 42\n");
        const auto ink = [&editor](int line) {
            const auto formats = editor.document()->findBlockByNumber(line).layout()->formats();
            return formats.isEmpty() ? QColor() : formats.front().format.foreground().color();
        };
        const bool dark = qApp->palette().color(QPalette::Base).lightness() < 128;
        QTRY_COMPARE(ink(1), QColor(dark ? "#e6c482" : "#835400"));
        QCOMPARE(ink(4), QColor(dark ? "#a4b5c8" : "#546674"));
        editor.checkSyntax();
        QCOMPARE(syntax.last()[1].toString(), QString());
        struct PaletteRestore {
            QPalette original = qApp->palette();
            ~PaletteRestore() { qApp->setPalette(original); }
        } restore;
        QPalette alternate = restore.original;
        alternate.setColor(QPalette::Base, dark ? Qt::white : Qt::black);
        qApp->setPalette(alternate);
        QTRY_COMPARE(ink(1), QColor(dark ? "#835400" : "#e6c482"));
        QCOMPARE(ink(4), QColor(dark ? "#546674" : "#a4b5c8"));
    }
};

int main(int argc, char **argv)
{
    QSurfaceFormat format;
    format.setRenderableType(QSurfaceFormat::OpenGL);
    format.setVersion(3, 3); format.setProfile(QSurfaceFormat::CoreProfile); format.setDepthBufferSize(24);
    QSurfaceFormat::setDefaultFormat(format);
    QApplication app(argc, argv);
    WorkspaceTest test;
    return QTest::qExec(&test, argc, argv);
}
#include "qt_workspace_test.moc"
