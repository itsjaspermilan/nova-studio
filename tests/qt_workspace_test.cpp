#include "studio_window.h"
#include "code_editor.h"
#include "native_viewport.h"
#include <QAccessible>
#include <QAbstractItemView>
#include <QAction>
#include <QApplication>
#include <QBuffer>
#include <QComboBox>
#include <QCheckBox>
#include <QCompleter>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDir>
#include <QDoubleSpinBox>
#include <QFile>
#include <QFileDialog>
#include <QFocusEvent>
#include <QInputMethodEvent>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QPushButton>
#include <QSurfaceFormat>
#include <QStatusBar>
#include <QScrollArea>
#include <QTabWidget>
#include <QTemporaryDir>
#include <QTextBlock>
#include <QTextLayout>
#include <QTreeWidget>
#include <QWheelEvent>
#include <QtTest>
#include <cmath>

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

int countColor(const QImage &image, QColor colour)
{
    int count = 0;
    for (int y = 0; y < image.height(); ++y)
        for (int x = 0; x < image.width(); ++x)
            if (image.pixelColor(x, y) == colour) ++count;
    return count;
}

int paintedGizmoPoints(const QImage &image, NativeViewport *viewport, QPoint offset = {})
{
    const qreal density = viewport->devicePixelRatioF();
    const int radius = qCeil(2 * density);
    const auto gizmo = viewport->gizmo();
    int painted = 0;
    for (const auto point : gizmo.paths[0]) {
        const auto pixel = ((viewport->widgetPoint(point) + offset) * density).toPoint();
        const auto area = QRect(pixel - QPoint(radius, radius), QSize(2 * radius + 1, 2 * radius + 1)).intersected(image.rect());
        bool found = false;
        for (int y = area.top(); y <= area.bottom() && !found; ++y)
            for (int x = area.left(); x <= area.right(); ++x)
                if (image.pixelColor(x, y) == QColor("#fa939b")) { found = true; break; }
        painted += found;
    }
    return painted;
}

}

class WorkspaceTest final : public QObject {
    Q_OBJECT
private slots:
    void sourceOnlySaveBlocksRun()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-source-only-run-XXXXXX");
        QVERIFY(temporary.isValid());
        StudioWindow window(NOVA_EXAMPLES, false);
        window.show();
        QVERIFY(QTest::qWaitForWindowExposed(&window));
        auto *document = window.projectDocument();
        auto *viewport = window.viewport();
        QString error;
        QVERIFY2(document->create(temporary.path(), "Publication gate", true, NOVA_EXAMPLES, &error), qPrintable(error));
        QTRY_VERIFY_WITH_TIMEOUT(viewport->ready(), 10000);
        QTRY_COMPARE(viewport->resources().count, size_t(1));
        auto *run = window.findChild<QAction *>("runProject");
        auto *problems = window.findChild<QListWidget *>("problems");
        QVERIFY(run);
        QVERIFY(problems);
        StudioAssetSnapshot snapshot;
        snapshot.id = "marker-source"; snapshot.kind = "sprite"; snapshot.revision = 1;
        snapshot.source.path = "marker.nova-sprite";
        QByteArray previous;
        QVERIFY2(document->readAssetFile(snapshot.source.path, &previous, &snapshot.source.expected, &error), qPrintable(error));
        QVERIFY(previous.isEmpty());
        snapshot.source.bytes = "editable source retained without a generated image";
        snapshot.mode = StudioAssetSnapshot::Mode::SourceOnly;
        snapshot.derivedProblem = "The generated image has not been published.";
        QVERIFY2(document->stageAssetSnapshot(snapshot, &error), qPrintable(error));
        QVERIFY(run->isEnabled());
        run->trigger();
        QVERIFY(!viewport->running());
        QVERIFY(!document->dirty());
        QCOMPARE(readFile(document->root() + "/" + snapshot.source.path), snapshot.source.bytes);
        QCOMPARE(problems->findItems("Runtime output is stale for marker-source", Qt::MatchContains).size(), 1);
        QVERIFY(document->assetPublication(snapshot.id).saved);
        QVERIFY(document->assetPublication(snapshot.id).stale);

        QVERIFY(window.openProject(document->path(), false));
        QVERIFY(run->isEnabled());
        run->trigger();
        QVERIFY(!viewport->running());
        QVERIFY(document->assetPublication(snapshot.id).stale);

        snapshot = document->assetSnapshots().front();
        ++snapshot.revision;
        snapshot.mode = StudioAssetSnapshot::Mode::PublishDerived;
        snapshot.derivedProblem.clear();
        StudioAssetFile output;
        output.path = "marker.png"; output.runtimeId = "marker"; output.runtimeType = NOVA_ASSET_SPRITE;
        QVERIFY2(document->readAssetFile(output.path, &previous, &output.expected, &error), qPrintable(error));
        QImage image(2, 2, QImage::Format_RGBA8888);
        image.fill(Qt::green);
        QBuffer buffer(&output.bytes);
        QVERIFY(buffer.open(QIODevice::WriteOnly));
        QVERIFY(image.save(&buffer, "PNG"));
        buffer.close();
        snapshot.outputs = {output};
        QVERIFY2(document->stageAssetSnapshot(snapshot, &error), qPrintable(error));
        QVERIFY(run->isEnabled());
        run->trigger();
        QVERIFY2(viewport->running(), qPrintable(problems->count() ? problems->item(problems->count() - 1)->text() : QString()));
        QVERIFY2(document->runtimeAssetsReady(&error), qPrintable(error));
        QVERIFY(!document->assetPublication(snapshot.id).stale);
        window.findChild<QAction *>("stopProject")->trigger();
        QVERIFY(!viewport->running());
    }

    void sceneTransformsAndNavigation()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-transforms-XXXXXX");
        QVERIFY(temporary.isValid());
        StudioWindow window(NOVA_EXAMPLES, false);
        window.show();
        QVERIFY(QTest::qWaitForWindowExposed(&window));
        auto *viewport = window.viewport();
        auto *document = window.projectDocument();
        QString error;
        QVERIFY2(document->create(temporary.path(), "Scene tools", true, NOVA_EXAMPLES, &error), qPrintable(error));
        QTRY_VERIFY_WITH_TIMEOUT(viewport->ready(), 10000);
        QTRY_COMPARE(viewport->resources().count, size_t(1));
        auto scene = document->scene();
        scene.objects[0].position.x = .123456f;
        scene.objects[0].size = {2, 1, 3};
        QVERIFY(document->editScene(scene, "player", "Asymmetric model", &error));
        QVERIFY(document->save(&error));
        QVERIFY(writeFile(document->root() + "/start.nova-scene", document->draft().scene + "# Retained on a no-op edit.\n"));
        QVERIFY(window.openProject(document->path(), false));
        document->select("player");
        const auto lua = document->draft().script;
        const auto v1 = document->draft().scene;
        const auto modelMesh = viewport->resources().resources[0].model.meshes[0].vaoId;
        auto *rotationY = window.findChild<QDoubleSpinBox *>("rotation1");
        QVERIFY(rotationY);
        for (auto *scroll : window.findChildren<QScrollArea *>())
            if (scroll->isAncestorOf(rotationY)) scroll->ensureWidgetVisible(rotationY);
        QTest::keyClick(rotationY, Qt::Key_Return);
        QCOMPARE(document->draft().scene, v1);
        typeNumber(rotationY, "15");
        QCOMPARE(document->scene().version, 2u);
        QCOMPARE(document->scene().objects[0].rotation.y, 15.f);
        QCOMPARE(document->scene().objects[0].position.x, .123456f);
        QCOMPARE(document->draft().script, lua);
        document->undoStack()->undo();
        QCOMPARE(document->draft().scene, v1);
        viewport->frameSelection();
        viewport->setTool(SceneTool::Rotate);
        const auto unchangedRing = viewport->gizmo().paths[1];
        QVERIFY(unchangedRing.size() > 22);
        QCOMPARE(viewport->gizmoHandle(unchangedRing[10]), 1);
        const auto startPoint = viewport->widgetPoint(unchangedRing[10]).toPoint();
        QTest::mousePress(viewport, Qt::LeftButton, Qt::NoModifier, startPoint);
        QTest::mouseMove(viewport, viewport->widgetPoint(unchangedRing[22]).toPoint());
        QTest::mouseMove(viewport, startPoint);
        QTest::mouseRelease(viewport, Qt::LeftButton, Qt::NoModifier, startPoint);
        QCOMPARE(document->draft().scene, v1);
        QVERIFY(document->undoStack()->canRedo());
        document->undoStack()->redo();
        QTest::keyClick(rotationY, Qt::Key_Return);
        QCOMPARE(document->scene().objects[0].rotation.y, 15.f);

        const auto gesture = [viewport](QPointF start, QPointF end, bool cancel) {
            const auto a = viewport->widgetPoint(start).toPoint(), b = viewport->widgetPoint(end).toPoint();
            QTest::mousePress(viewport, Qt::LeftButton, Qt::NoModifier, a);
            QTest::mouseMove(viewport, b);
            if (cancel) QTest::keyClick(viewport, Qt::Key_Escape);
            QTest::mouseRelease(viewport, Qt::LeftButton, Qt::NoModifier, b);
        };
        window.findChild<QAction *>("frameSelection")->trigger();
        QTest::keyClick(viewport, Qt::Key_E);
        QCOMPARE(viewport->tool(), SceneTool::Rotate);
        QVERIFY(window.findChild<QAction *>("rotateTool")->isChecked());
        auto rings = viewport->gizmo();
        QVERIFY(!rings.paths[1].isEmpty());
        int start = -1;
        for (int i = 4; i < 48; ++i)
            if (viewport->gizmoHandle(rings.paths[1][i]) == 1) { start = i; break; }
        QVERIFY(start >= 0);
        auto before = document->draft().scene;
        int undo = document->undoStack()->index();
        gesture(rings.paths[1][start], rings.paths[1][start + 12], false);
        QVERIFY(document->draft().scene != before);
        QCOMPARE(document->undoStack()->index(), undo + 1);
        QCOMPARE(document->scene().objects[0].rotation.x, 0.f);
        QCOMPARE(document->scene().objects[0].rotation.z, 0.f);
        QVERIFY(std::abs(std::remainder(document->scene().objects[0].rotation.y, 15.f)) < .001f);
        QCOMPARE(document->draft().script, lua);
        QCOMPARE(viewport->resources().resources[0].model.meshes[0].vaoId, modelMesh);
        document->undoStack()->undo();
        QCOMPARE(document->draft().scene, before);
        rings = viewport->gizmo();
        gesture(rings.paths[1][start], rings.paths[1][start + 12], true);
        QCOMPARE(document->draft().scene, before);
        QCOMPARE(document->undoStack()->index(), undo);
        QCOMPARE(viewport->frame()->commands[0].rotation.y, document->scene().objects[0].rotation.y);
        auto *projectState = window.findChild<QLabel *>("projectState");
        QTRY_VERIFY(projectState->width() >= projectState->fontMetrics().horizontalAdvance(projectState->text()) + 16);
        const auto rotationImage = viewport->grabFramebuffer();
        QVERIFY(paintedGizmoPoints(rotationImage, viewport) > 48);
        QVERIFY(rotationImage.save(QString(NOVA_TEST_DIRECTORY) + "/qt-scene-rotate-viewport.png"));
        const auto rotationWindow = window.grab().toImage();
        QVERIFY(paintedGizmoPoints(rotationWindow, viewport, viewport->mapTo(&window, QPoint())) > 48);
        QVERIFY(rotationWindow.save(QString(NOVA_TEST_DIRECTORY) + "/qt-scene-rotate.png"));

        QTest::keyClick(viewport, Qt::Key_W);
        auto move = viewport->gizmo();
        QVERIFY(!move.paths[1].isEmpty());
        const auto position = document->scene().objects[0].position;
        gesture(move.paths[1].back(), move.center + (move.paths[1].back() - move.center) * 1.6, false);
        QVERIFY(document->scene().objects[0].position.y != position.y);
        QCOMPARE(document->scene().objects[0].position.x, position.x);
        QCOMPARE(document->scene().objects[0].position.z, position.z);
        QCOMPARE(document->undoStack()->index(), undo + 1);
        document->undoStack()->undo();
        QCOMPARE(document->draft().scene, before);
        move = viewport->gizmo();
        const auto press = viewport->widgetPoint(move.paths[1].back()).toPoint();
        QTest::mousePress(viewport, Qt::LeftButton, Qt::NoModifier, press);
        QTest::mouseMove(viewport, press + QPoint(0, -50));
        QFocusEvent blur(QEvent::FocusOut);
        QCoreApplication::sendEvent(viewport, &blur);
        QTest::mouseRelease(viewport, Qt::LeftButton, Qt::NoModifier, press + QPoint(0, -50));
        QCOMPARE(document->draft().scene, before);
        QCOMPARE(viewport->frame()->commands[0].position.y, position.y);

        QTest::keyClick(viewport, Qt::Key_R);
        const auto scale = viewport->gizmo();
        const auto size = document->scene().objects[0].size;
        const auto offset = viewport->logicalPoint(viewport->widgetPoint(scale.center) + QPointF(50, -20));
        gesture(scale.center, offset, false);
        QVERIFY(document->scene().objects[0].size.x > size.x);
        QVERIFY(std::abs(document->scene().objects[0].size.x / document->scene().objects[0].size.y - size.x / size.y) < .001);
        QCOMPARE(document->undoStack()->index(), undo + 1);
        document->undoStack()->undo();
        QCOMPARE(document->draft().scene, before);

        const auto gameCamera = document->scene().camera_position;
        const auto initialView = viewport->viewCamera();
        const int beforeNavigation = document->undoStack()->index();
        window.findChild<QAction *>("orbitTool")->trigger();
        const QPoint centre(viewport->width() / 2, viewport->height() / 2);
        QTest::mousePress(viewport, Qt::LeftButton, Qt::NoModifier, centre);
        QTest::mouseMove(viewport, centre + QPoint(70, 30));
        QTest::mouseRelease(viewport, Qt::LeftButton, Qt::NoModifier, centre + QPoint(70, 30));
        QVERIFY(viewport->viewCamera().position.x != initialView.position.x);
        const auto orbited = viewport->viewCamera();
        QTest::mousePress(viewport, Qt::LeftButton, Qt::NoModifier, centre);
        QTest::mouseMove(viewport, centre + QPoint(40, 20));
        QTest::keyClick(viewport, Qt::Key_Escape);
        QTest::mouseRelease(viewport, Qt::LeftButton, Qt::NoModifier, centre + QPoint(40, 20));
        QCOMPARE(viewport->viewCamera().position.x, orbited.position.x);
        window.findChild<QAction *>("panTool")->trigger();
        QTest::keyClick(viewport, Qt::Key_Right);
        QVERIFY(viewport->viewCamera().target.x != orbited.target.x);
        const auto panned = viewport->viewCamera();
        QWheelEvent wheel(centre, viewport->mapToGlobal(centre), {}, {0, 120}, Qt::NoButton,
            Qt::NoModifier, Qt::NoScrollPhase, false);
        QCoreApplication::sendEvent(viewport, &wheel);
        QVERIFY(viewport->viewCamera().position.x != panned.position.x);
        QCOMPARE(document->draft().scene, before);
        QCOMPARE(document->undoStack()->index(), beforeNavigation);
        QCOMPARE(viewport->frame()->camera_position.x, gameCamera.x);
        const auto navigated = viewport->viewCamera();
        window.findChild<QAction *>("runProject")->trigger();
        QVERIFY2(viewport->running(), qPrintable(viewport->error()));
        QCOMPARE(viewport->frame()->camera_position.x, gameCamera.x);
        QTest::keyClick(viewport, Qt::Key_E);
        QCOMPARE(viewport->tool(), SceneTool::Pan); // Game keys cannot switch authoring tools.
        window.findChild<QAction *>("stopProject")->trigger();
        QCOMPARE(viewport->viewCamera().position.x, navigated.position.x);
        QCOMPARE(document->draft().script, lua);
        QCOMPARE(document->draft().scene, before);

        auto *tabs = window.findChild<QTabWidget *>("workspaces");
        tabs->setCurrentIndex(1);
        auto *editor = window.codeEditor();
        editor->moveCursor(QTextCursor::End);
        QTest::keyClick(editor, Qt::Key_Return);
        QTest::keyClicks(editor, "-- werf");
        QVERIFY(document->draft().script.endsWith("-- werf"));
        QCOMPARE(viewport->tool(), SceneTool::Pan);
        document->undoStack()->undo();
        tabs->setCurrentIndex(0);
        window.findChild<QAction *>("gameView")->trigger();
        QCOMPARE(viewport->viewCamera().position.x, gameCamera.x);
        window.findChild<QAction *>("moveTool")->trigger();
        window.findChild<QAction *>("frameSelection")->trigger();
        QVERIFY(window.grab().save(QString(NOVA_TEST_DIRECTORY) + "/qt-scene-tools.png"));
        window.resize(1100, 740);
        QTest::qWait(50);
        QVERIFY(window.grab().save(QString(NOVA_TEST_DIRECTORY) + "/qt-scene-tools-min.png"));
        const auto logical = QPointF(417.25, 241.5);
        QVERIFY(QLineF(viewport->logicalPoint(viewport->widgetPoint(logical)), logical).length() < .001);
        QCOMPARE(viewport->grabFramebuffer().width(), qRound(viewport->width() * viewport->devicePixelRatioF()));
        viewport->setFixedSize(701, 401);
        QTest::qWait(50);
        for (const QPointF point : {QPointF(1, 1), logical, QPointF(959, 539)})
            QVERIFY(QLineF(viewport->logicalPoint(viewport->widgetPoint(point)), point).length() < .001);
        QCOMPARE(viewport->grabFramebuffer().width(), qRound(viewport->width() * viewport->devicePixelRatioF()));
        viewport->setTool(SceneTool::Rotate);
        QVERIFY(paintedGizmoPoints(viewport->grabFramebuffer(), viewport) > 48);
        QVERIFY(document->save(&error));
    }

    void flatSceneTools()
    {
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-flat-tools-XXXXXX");
        QVERIFY(temporary.isValid());
        StudioWindow window(NOVA_EXAMPLES, false);
        window.show();
        QVERIFY(QTest::qWaitForWindowExposed(&window));
        auto *viewport = window.viewport();
        auto *document = window.projectDocument();
        QString error;
        QVERIFY2(document->create(temporary.path(), "Flat tools", false, NOVA_EXAMPLES, &error), qPrintable(error));
        QTRY_VERIFY_WITH_TIMEOUT(viewport->ready(), 10000);
        QTRY_COMPARE(viewport->resources().count, size_t(1));
        const auto original = document->draft().scene, lua = document->draft().script;
        const auto object = document->scene().objects[0];
        const auto camera = viewport->viewCamera();
        const auto texture = viewport->resources().resources[0].texture.id;
        const int undo = document->undoStack()->index();
        QVERIFY(!window.findChild<QAction *>("rotateTool")->isEnabled());
        QVERIFY(!window.findChild<QAction *>("orbitTool")->isEnabled());
        QVERIFY(!window.findChild<QAction *>("frameAll")->isEnabled());
        QVERIFY(!window.findChild<QDoubleSpinBox *>("rotation0")->isVisible());
        QCOMPARE(window.findChild<QDoubleSpinBox *>("Snap increment")->value(), 16.0);
        QTest::keyClick(viewport, Qt::Key_E);
        QCOMPARE(viewport->tool(), SceneTool::Move);
        QTest::qWait(30);
        auto center = objectPoint(document, viewport);
        QTest::mouseClick(viewport, Qt::LeftButton, Qt::NoModifier, center);
        QCOMPARE(document->selection(), QString("player"));
        QCOMPARE(document->draft().scene, original);

        window.findChild<QAction *>("scaleTool")->trigger();
        QCOMPARE(viewport->tool(), SceneTool::Scale);
        QVERIFY(viewport->gizmo().visible);
        center = viewport->widgetPoint(viewport->gizmo().center).toPoint();
        QCOMPARE(viewport->gizmoHandle(viewport->logicalPoint(center)), 3);
        QTest::mousePress(viewport, Qt::LeftButton, Qt::NoModifier, center);
        QTest::mouseMove(viewport, center + QPoint(48, 0));
        QTest::mouseRelease(viewport, Qt::LeftButton, Qt::NoModifier, center + QPoint(48, 0));
        QCOMPARE(document->undoStack()->index(), undo + 1);
        QVERIFY(document->scene().objects[0].size.x > object.size.x);
        QCOMPARE(document->scene().objects[0].size.z, 1.f);
        QCOMPARE(document->scene().objects[0].position.x, object.position.x);
        QCOMPARE(document->scene().objects[0].position.y, object.position.y);
        QCOMPARE(document->scene().version, 1u);
        QCOMPARE(document->draft().script, lua);
        QCOMPARE(viewport->resources().resources[0].texture.id, texture);
        document->undoStack()->undo();
        QCOMPARE(document->draft().scene, original);

        auto *tabs = window.findChild<QTabWidget *>("workspaces");
        for (bool hide : {false, true}) {
            center = viewport->widgetPoint(viewport->gizmo().center).toPoint();
            QTest::mousePress(viewport, Qt::LeftButton, Qt::NoModifier, center);
            QTest::mouseMove(viewport, center + QPoint(48, 0));
            QVERIFY(viewport->frame()->commands[0].size.x != object.size.x);
            if (hide) tabs->setCurrentIndex(1);
            else QTest::keyClick(viewport, Qt::Key_Escape);
            QTest::mouseRelease(viewport, Qt::LeftButton, Qt::NoModifier, center + QPoint(48, 0));
            QCOMPARE(document->draft().scene, original);
            QCOMPARE(document->undoStack()->index(), undo);
            QCOMPARE(viewport->frame()->commands[0].size.x, object.size.x);
            tabs->setCurrentIndex(0);
        }
        auto *name = window.findChild<QLineEdit *>("objectName");
        name->selectAll();
        QTest::keyClicks(name, "wer frame");
        QTest::keyClick(name, Qt::Key_Return);
        QCOMPARE(QByteArray(document->scene().objects[0].name), QByteArray("wer frame"));
        QCOMPARE(viewport->tool(), SceneTool::Scale);
        document->undoStack()->undo();
        QCOMPARE(document->draft().scene, original);
        QWheelEvent wheel(center, viewport->mapToGlobal(center), {}, {0, 120}, Qt::NoButton,
            Qt::NoModifier, Qt::NoScrollPhase, false);
        QCoreApplication::sendEvent(viewport, &wheel);
        QCOMPARE(viewport->viewCamera().position.x, camera.position.x);
        QCOMPARE(viewport->viewCamera().position.y, camera.position.y);
        QCOMPARE(viewport->viewCamera().position.z, camera.position.z);
        QVERIFY(window.grab().save(QString(NOVA_TEST_DIRECTORY) + "/qt-scene-tools-2d.png"));
        QVERIFY(document->save(&error));
    }

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
    const int result = QTest::qExec(&test, argc, argv);
    nova_shutdown_audio();
    return result;
}
#include "qt_workspace_test.moc"
