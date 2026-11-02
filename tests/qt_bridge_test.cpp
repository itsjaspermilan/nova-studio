#include "native_viewport.h"
#include <QAccessible>
#include <QApplication>
#include <QClipboard>
#include <QDockWidget>
#include <QFile>
#include <QFileDialog>
#include <QInputMethodEvent>
#include <QMainWindow>
#include <QMimeData>
#include <QPlainTextEdit>
#include <QSurfaceFormat>
#include <QTemporaryDir>
#include <QtTest>

extern "C" {
#include <rlgl.h>
}

struct ClipboardGuard {
    QMimeData *original = new QMimeData;
    ClipboardGuard()
    {
        const QMimeData *current = QApplication::clipboard()->mimeData();
        if (current) for (const auto &format : current->formats()) original->setData(format, current->data(format));
    }
    ~ClipboardGuard() { QApplication::clipboard()->setMimeData(original); }
};

class BridgeTest final : public QObject {
    Q_OBJECT
private slots:
    void authoringAudioDoesNotOpenDevice()
    {
        QVERIFY(!IsAudioDeviceReady());
        QTemporaryDir temporary(QString(NOVA_TEST_DIRECTORY) + "/qt-audio-preview-XXXXXX");
        QVERIFY(temporary.isValid());
        const QString root = temporary.path();
        QVERIFY(QFile::copy(QString(NOVA_EXAMPLES) + "/services/assets/chime.wav", root + "/chime.wav"));
        QVERIFY(QFile::copy(QString(NOVA_EXAMPLES) + "/services/assets/awake.png", root + "/marker.png"));
        const QByteArray manifest =
            "nova-project 2\nidentity qt-audio-preview\nentry main.lua\n"
            "sprite marker marker.png\naudio chime chime.wav\naudio alias chime.wav\n";
        const QByteArray source =
            "nova.scene('2d')\nlocal marker = nova.asset('marker')\n"
            "nova.play(nova.asset('chime'), 0.2)\n"
            "function update() nova.sprite(marker, 20, 20, 80, 80) end\n";
        const auto write = [](const QString &path, const QByteArray &bytes) {
            QFile file(path);
            return file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size() && file.flush();
        };
        QVERIFY(write(root + "/nova.project", manifest));
        QVERIFY(write(root + "/main.lua", source));
        QFile wave(root + "/chime.wav");
        QVERIFY(wave.open(QIODevice::ReadOnly));
        const auto original = wave.readAll();
        wave.close();

        QMainWindow window;
        auto *viewport = new NativeViewport;
        window.setCentralWidget(viewport);
        window.resize(960, 620);
        window.show();
        QVERIFY(QTest::qWaitForWindowExposed(&window));
        QTRY_VERIFY_WITH_TIMEOUT(viewport->ready(), 10000);
        QVERIFY2(viewport->openAuthoring(root + "/nova.project", manifest, {}, source), qPrintable(viewport->error()));
        QCOMPARE(viewport->resources().count, size_t{3});
        const auto texture = viewport->resources().resources[0].texture.id;
        QVERIFY(texture != 0);
        QVERIFY(viewport->resources().resources[0].owned);
        for (size_t i = 1; i < 3; ++i) {
            QCOMPARE(viewport->resources().resources[i].type, NOVA_ASSET_AUDIO);
            QVERIFY(!viewport->resources().resources[i].owned);
            QCOMPARE(viewport->resources().resources[i].sound.frameCount, 0u);
            QVERIFY(viewport->resources().inspection[i].sample_frames > 0);
            QCOMPARE(viewport->resources().inspection[i].resource_index, size_t{1});
        }
        QVERIFY(viewport->resources().services->preflight);
        QVERIFY(!viewport->resources().services->initialized);
        QVERIFY(!IsAudioDeviceReady());
        QVERIFY(!viewport->grabFramebuffer().isNull());

        QVERIFY(write(root + "/chime.wav", "not a WAV"));
        QVERIFY(!viewport->openAuthoring(root + "/nova.project", manifest, {}, source));
        QCOMPARE(viewport->resources().resources[0].texture.id, texture);
        QCOMPARE(viewport->resources().count, size_t{3});
        QVERIFY(!IsAudioDeviceReady());
        QVERIFY(write(root + "/chime.wav", original));
        QVERIFY2(viewport->openAuthoring(root + "/nova.project", manifest, {}, source), qPrintable(viewport->error()));
        QVERIFY(!IsAudioDeviceReady());
    }

    void rotatedNativeCubesAndModels()
    {
        QMainWindow window;
        auto *viewport = new NativeViewport;
        window.setCentralWidget(viewport);
        window.resize(960, 620);
        window.show();
        QVERIFY(QTest::qWaitForWindowExposed(&window));
        QTRY_VERIFY_WITH_TIMEOUT(viewport->ready(), 10000);
        QVERIFY(viewport->openProject(QString(NOVA_EXAMPLES) + "/static/nova.project"));
        viewport->setGridVisible(false);
        auto frame = std::make_unique<NovaFrame>();
        frame->mode = NOVA_3D; frame->background = {18, 24, 41, 255};
        frame->camera_position = {0, 0, 12}; frame->camera_target = {0, 0, 0}; frame->camera_fov = 50;
        frame->count = 1;
        frame->commands[0].type = NOVA_CUBE;
        frame->commands[0].size = {4, 1, 1};
        frame->commands[0].color = {77, 225, 201, 255};
        const auto colouredBounds = [](const QImage &image, bool cube) {
            QRect result;
            for (int y = 0; y < image.height(); ++y)
                for (int x = 0; x < image.width(); ++x) {
                    const auto color = image.pixelColor(x, y);
                    if (cube ? color == QColor(77, 225, 201) :
                        color == QColor(63, 127, 255) || color == QColor(255, 127, 63))
                        result = result.united(QRect(x, y, 1, 1));
                }
            return result;
        };
        viewport->setAuthoringFrame(*frame);
        viewport->gameView();
        const auto cube = colouredBounds(viewport->grabFramebuffer(), true);
        QVERIFY(cube.width() > 100 && cube.width() > cube.height() * 3);
        frame->commands[0].rotation = {0, 90, 0};
        viewport->setAuthoringFrame(*frame);
        const auto turnedCube = colouredBounds(viewport->grabFramebuffer(), true);
        QVERIFY(turnedCube.width() > 30 && turnedCube.width() * 2 < cube.width());
        QCOMPARE(viewport->pick({NOVA_WIDTH / 2, NOVA_HEIGHT / 2}), 0);

        frame->commands[0].type = NOVA_MODEL;
        frame->commands[0].size = {1, 1, 1};
        frame->commands[0].rotation = {};
        viewport->setAuthoringFrame(*frame);
        const auto mesh = viewport->resources().resources[0].model.meshes[0].vaoId;
        const auto model = colouredBounds(viewport->grabFramebuffer(), false);
        QVERIFY(model.width() > model.height() * 2);
        frame->commands[0].rotation = {0, 0, 90};
        viewport->setAuthoringFrame(*frame);
        const auto image = viewport->grabFramebuffer();
        const auto turnedModel = colouredBounds(image, false);
        QVERIFY(turnedModel.height() > turnedModel.width() * 2);
        const auto origin = viewport->widgetPoint({NOVA_WIDTH / 2, NOVA_HEIGHT / 2}) * viewport->devicePixelRatioF();
        QVERIFY(turnedModel.right() <= origin.x() + 4); // +Y rotates to -X, not +X.
        const auto point = GetWorldToScreenEx({-.75f, .5f, 0}, viewport->viewCamera(), NOVA_WIDTH, NOVA_HEIGHT);
        QCOMPARE(viewport->pick({point.x, point.y}), 0);
        QCOMPARE(viewport->resources().resources[0].model.meshes[0].vaoId, mesh);
        QVERIFY(image.save(QString(NOVA_TEST_DIRECTORY) + "/qt-rotated-native-model.png"));

        const double nearPlane = rlGetCullDistanceNear(), farPlane = rlGetCullDistanceFar();
        frame->count = 2; frame->camera_fov = 10;
        frame->commands[0].type = NOVA_CUBE;
        frame->commands[0].size = {1000, 1000, 1000};
        frame->commands[0].position = {-9000, 0, 0};
        frame->commands[0].rotation = {};
        frame->commands[1] = frame->commands[0];
        frame->commands[1].position.x = 9000;
        viewport->setAuthoringFrame(*frame);
        viewport->gameView();
        viewport->frameSelection(true);
        const auto distant = viewport->grabFramebuffer();
        const auto framed = colouredBounds(distant, true);
        QVERIFY(framed.width() > distant.width() / 3 && framed.height() > 20);
        QCOMPARE(rlGetCullDistanceNear(), nearPlane);
        QCOMPARE(rlGetCullDistanceFar(), farPlane);
        for (int i = 0; i < 2; ++i) {
            const auto center = GetWorldToScreenEx({frame->commands[i].position.x, 0, 0},
                viewport->viewCamera(), NOVA_WIDTH, NOVA_HEIGHT);
            QCOMPARE(viewport->pick({center.x, center.y}), i);
        }
    }

    void disconnectApplicationBeforeChildTeardown()
    {
        bool controlChecked = false;
        bool controlConnection = false;
        {
            QWidget control;
            connect(qApp, &QGuiApplication::applicationStateChanged, &control, [] {});
            auto *child = new QObject(&control);
            connect(child, &QObject::destroyed, qApp, [&] {
                controlChecked = true;
                controlConnection = QObject::disconnect(qApp, nullptr, &control, nullptr);
            });
        }
        QVERIFY(controlChecked);
        QVERIFY(controlConnection);

        auto *viewport = new NativeViewport;
        auto *child = new QObject(viewport);
        bool checked = false;
        bool lateConnection = false;
        connect(child, &QObject::destroyed, qApp, [&] {
            checked = true;
            lateConnection = QObject::disconnect(qApp, nullptr, viewport, nullptr);
        });
        delete viewport;
        QVERIFY(checked);
        QVERIFY(!lateConnection);
    }

    void desktopAndNativeOutput()
    {
        QMainWindow window;
        auto *viewport = new NativeViewport;
        window.setCentralWidget(viewport);
        auto *dock = new QDockWidget("Lua source", &window);
        auto *text = new QPlainTextEdit(dock);
        text->setAccessibleName("Lua source");
        dock->setWidget(text);
        window.addDockWidget(Qt::RightDockWidgetArea, dock);
        window.resize(1100, 720);
        window.show();
        QVERIFY(QTest::qWaitForWindowExposed(&window));
        QTRY_VERIFY_WITH_TIMEOUT(viewport->ready(), 10000);
        QVERIFY(viewport->isValid());
        QVERIFY(viewport->defaultFramebufferObject() != 0);

        text->setFocus();
        QTest::keyClicks(text, "-- Unicode: ");
        QInputMethodEvent composition(QString::fromUtf8("\xe6\x97\xa5\xe6\x9c\xac"), {});
        QCoreApplication::sendEvent(text, &composition);
        QInputMethodEvent commit;
        commit.setCommitString(QString::fromUtf8("\xe6\x97\xa5\xe6\x9c\xac \xf0\x9f\x8c\xb2"));
        QCoreApplication::sendEvent(text, &commit);
        QVERIFY(text->toPlainText().contains(QString::fromUtf8("\xe6\x97\xa5\xe6\x9c\xac")));
        text->selectAll();
        // Keep the user's clipboard intact; these are widget-local events only.
        {
            ClipboardGuard restore;
            text->copy();
            QCOMPARE(QApplication::clipboard()->text(), text->toPlainText());
            text->moveCursor(QTextCursor::End);
            text->paste();
            QVERIFY(text->toPlainText().count(QString::fromUtf8("\xe6\x97\xa5\xe6\x9c\xac")) == 2);
        }
        auto *accessible = QAccessible::queryAccessibleInterface(text);
        QVERIFY(accessible);
        QVERIFY(accessible->textInterface());
        QCOMPARE(accessible->text(QAccessible::Name), QString("Lua source"));
        QVERIFY(text->testAttribute(Qt::WA_InputMethodEnabled));
        QFileDialog nativeDialog(&window);
        QVERIFY(!nativeDialog.testOption(QFileDialog::DontUseNativeDialog));
        nativeDialog.open();
        QTRY_VERIFY(nativeDialog.isVisible());
        nativeDialog.reject();
        QTRY_VERIFY(!nativeDialog.isVisible());

        QVERIFY2(viewport->openProject(QString(NOVA_EXAMPLES) + "/sprites/nova.project"),
            qPrintable(viewport->error()));
        auto first = viewport->grabFramebuffer();
        QCOMPARE(first.size(), QSize(qRound(viewport->width() * viewport->devicePixelRatioF()),
            qRound(viewport->height() * viewport->devicePixelRatioF())));
        QVERIFY(first.save(QString(NOVA_TEST_DIRECTORY) + "/qt-native-2d.png"));
        int coloured = 0;
        for (int y = 0; y < first.height(); ++y)
            for (int x = 0; x < first.width(); ++x) {
                QColor c = first.pixelColor(x, y);
                if (c.red() == 255 && c.green() == 170 && c.blue() == 68) ++coloured;
            }
        QVERIFY(coloured > 100);
        const float initialX = viewport->frame()->commands[61].position.x;
        viewport->setRunning(true);
        viewport->advance(1.0 / 60.0, NovaInput{1, 0, false});
        QVERIFY(viewport->frame()->commands[61].position.x > initialX);
        QVERIFY(viewport->grabFramebuffer() != first);
        viewport->setRunning(false);
        const auto texture = viewport->resources().resources[0].texture.id;
        QVERIFY(!viewport->openProject(QString(NOVA_EXAMPLES) + "/missing/nova.project"));
        QCOMPARE(viewport->resources().resources[0].texture.id, texture);

        QVERIFY2(viewport->openProject(QString(NOVA_EXAMPLES) + "/static/nova.project"),
            qPrintable(viewport->error()));
        auto model = viewport->grabFramebuffer();
        QVERIFY(model != first);
        int blue = 0, orange = 0;
        for (int y = 0; y < model.height(); ++y)
            for (int x = 0; x < model.width(); ++x) {
                const auto color = model.pixelColor(x, y);
                if (color == QColor(63, 127, 255)) ++blue;
                if (color == QColor(255, 127, 63)) ++orange;
            }
        QVERIFY(blue > 1000 && orange > 1000);
        QVERIFY(model.save(QString(NOVA_TEST_DIRECTORY) + "/qt-native-3d.png"));
        dock->setFloating(true);
        QTest::qWait(50);
        dock->setFloating(false);
        window.resize(1280, 800);
        QTest::qWait(100);
        QVERIFY(viewport->isValid());
        auto resized = viewport->grabFramebuffer();
        QCOMPARE(resized.width(), qRound(viewport->width() * viewport->devicePixelRatioF()));
        QVERIFY(resized.width() > first.width());
        QVERIFY(window.grab().save(QString(NOVA_TEST_DIRECTORY) + "/qt-native-shell.png"));
    }
};

int main(int argc, char **argv)
{
    QSurfaceFormat format;
    format.setRenderableType(QSurfaceFormat::OpenGL);
    format.setVersion(3, 3);
    format.setProfile(QSurfaceFormat::CoreProfile);
    format.setDepthBufferSize(24);
    QSurfaceFormat::setDefaultFormat(format);
    QApplication app(argc, argv);
    BridgeTest test;
    const int result = QTest::qExec(&test, argc, argv);
    nova_shutdown_audio();
    return result;
}
#include "qt_bridge_test.moc"
