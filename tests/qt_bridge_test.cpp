#include "native_viewport.h"
#include <QAccessible>
#include <QApplication>
#include <QClipboard>
#include <QDockWidget>
#include <QFileDialog>
#include <QInputMethodEvent>
#include <QMainWindow>
#include <QMimeData>
#include <QPlainTextEdit>
#include <QSurfaceFormat>
#include <QtTest>

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
