#include "sprite/workspace.hpp"

#include <QAbstractButton>
#include <QAccessible>
#include <QAction>
#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDir>
#include <QFile>
#include <QInputMethodEvent>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMouseEvent>
#include <QPushButton>
#include <QSaveFile>
#include <QScrollArea>
#include <QScrollBar>
#include <QSignalSpy>
#include <QSpinBox>
#include <QTemporaryDir>
#include <QTimer>
#include <QToolBox>
#include <QToolButton>
#include <QWheelEvent>
#include <QtTest>
#include <memory>

#ifdef NOVA_SPRITE_COCOA_TEST
bool novaSpriteDesktopIsLocked();
bool novaSpriteTestWindowIsKey(QWidget *widget);
#endif

using namespace nova::sprite;

class SpriteWidgetTest : public QObject {
    Q_OBJECT
private slots:
    void canvasGesturesAndTools();
    void nativeLayerControlsAndDrafts();
    void framesAnimationAndPalette();
    void selectionClipboardAndKeyboard();
    void resizeAndScaleDialogs();
    void unicodeFocusAndAccessibility();
    void closingCancelsGesture();
    void pendingNumbersAndHostActions();
    void onionSkinIsViewOnly();
    void pointerAnchoredZoomAndPan();
    void authoredRoundTripAndCaptures();
};

static bool show(Workspace &workspace, QSize size = {1440, 900}, bool requireActive = true)
{
    workspace.setWindowTitle("Nova Sprite component verification");
    workspace.resize(size);
    workspace.show();
    if (!QTest::qWaitForWindowExposed(&workspace)) return false;
    if (requireActive) {
#ifdef NOVA_SPRITE_COCOA_TEST
        if (QGuiApplication::platformName() == "cocoa" && novaSpriteDesktopIsLocked()) {
            qWarning("Native input verification requires an unlocked desktop; the focus assertion was not bypassed.");
            return false;
        }
#endif
        workspace.raise();
        workspace.activateWindow();
        if (!QTest::qWaitForWindowActive(&workspace)) return false;
#ifdef NOVA_SPRITE_COCOA_TEST
        if (QGuiApplication::platformName() == "cocoa" && !novaSpriteTestWindowIsKey(&workspace)) return false;
#endif
        workspace.canvas()->setFocus(Qt::OtherFocusReason);
        if (!QTest::qWaitFor([&] { return workspace.isActiveWindow() && workspace.canvas()->hasFocus(); })) return false;
    }
    QApplication::processEvents();
    workspace.canvas()->fitCanvas();
    return true;
}

static bool section(Workspace &workspace, const QString &name)
{
    auto *box = workspace.findChild<QToolBox *>("spriteInspector");
    if (!box) return false;
    for (QAbstractButton *control : box->findChildren<QAbstractButton *>()) {
        if (control->text() == name && control->isVisible()) {
            QTest::mouseClick(control, Qt::LeftButton);
            QApplication::processEvents();
            return true;
        }
    }
    return false;
}

static bool click(Workspace &workspace, const char *name)
{
    auto *control = workspace.findChild<QAbstractButton *>(name);
    if (!control || !control->isEnabled()) return false;
    for (QWidget *parent = control->parentWidget(); parent; parent = parent->parentWidget())
        if (auto *scroll = qobject_cast<QScrollArea *>(parent)) scroll->ensureWidgetVisible(control);
    QApplication::processEvents();
    if (!control->isVisible()) return false;
    QTest::mouseClick(control, Qt::LeftButton);
    QApplication::processEvents();
    return true;
}

static bool type(Workspace &workspace, const char *name, const QString &value)
{
    auto *edit = workspace.findChild<QLineEdit *>(name);
    if (!edit || !edit->isVisible()) return false;
    for (QWidget *parent = edit->parentWidget(); parent; parent = parent->parentWidget())
        if (auto *scroll = qobject_cast<QScrollArea *>(parent)) scroll->ensureWidgetVisible(edit);
    QTest::mouseClick(edit, Qt::LeftButton);
    QTest::keySequence(edit, QKeySequence::SelectAll);
    QTest::keyClicks(edit, value);
    QTest::keyClick(edit, Qt::Key_Return);
    return true;
}

static bool number(QWidget &parent, const char *name, int value)
{
    auto *control = parent.findChild<QSpinBox *>(name);
    if (!control || !control->isEnabled() || !control->isVisible()) return false;
    for (QWidget *ancestor = control->parentWidget(); ancestor; ancestor = ancestor->parentWidget())
        if (auto *scroll = qobject_cast<QScrollArea *>(ancestor)) scroll->ensureWidgetVisible(control);
    control->setFocus(Qt::OtherFocusReason);
    QTest::keySequence(control, QKeySequence::SelectAll);
    QTest::keyClicks(control, QString::number(value));
    QTest::keyClick(control, qobject_cast<QDialog *>(&parent) ? Qt::Key_Tab : Qt::Key_Return);
    return control->value() == value;
}

static void drag(Canvas *canvas, QPoint from, QPoint to, bool release = true)
{
    QPoint start = canvas->widgetPoint(from).toPoint(), end = canvas->widgetPoint(to).toPoint();
    QTest::mousePress(canvas, Qt::LeftButton, Qt::NoModifier, start);
    int steps = std::max(std::abs(from.x() - to.x()), std::abs(from.y() - to.y()));
    for (int i = 1; i <= std::max(steps, 1); ++i) {
        QPointF point = QPointF(start) + QPointF(end - start) * i / std::max(steps, 1);
        QMouseEvent move(QEvent::MouseMove, point, canvas->mapToGlobal(point.toPoint()),
                         Qt::NoButton, Qt::LeftButton, Qt::NoModifier);
        QApplication::sendEvent(canvas, &move);
    }
    if (release) QTest::mouseRelease(canvas, Qt::LeftButton, Qt::NoModifier, end);
}

static bool choose(Workspace &workspace, Tool tool)
{
    auto *control = workspace.findChild<QToolButton *>(QString("spriteTool%1").arg(int(tool)));
    if (!control) return false;
    QTest::mouseClick(control, Qt::LeftButton);
    return workspace.canvas()->tool() == tool;
}

static void driveDialog(Workspace &workspace, const std::function<void(QDialog &)> &interaction)
{
    auto *timer = new QTimer(&workspace);
    timer->setInterval(10);
    QObject::connect(timer, &QTimer::timeout, &workspace, [timer, &workspace, interaction] {
        auto *dialog = workspace.findChild<QDialog *>("spriteSizeDialog");
        if (!dialog || !dialog->isVisible()) return;
        timer->stop();
        interaction(*dialog);
        if (dialog->isVisible()) dialog->reject();
        timer->deleteLater();
    });
    timer->start();
    QTimer::singleShot(3000, &workspace, [&workspace] {
        for (auto *dialog : workspace.findChildren<QDialog *>()) if (dialog->isVisible()) dialog->reject();
    });
}

void SpriteWidgetTest::canvasGesturesAndTools()
{
    Document document;
    QString error;
    QVERIFY(document.create({24, 24}, "Tools", RasterMode::Pixel, error));
    Workspace workspace(document);
    QVERIFY(show(workspace));
    Canvas *canvas = workspace.canvas();
    Id frame = canvas->frameId(), layer = canvas->layerId();
    ToolSettings settings = canvas->toolSettings();
    settings.color = QColor("#ff3300");
    QVERIFY(canvas->setToolSettings(settings, error));
    int history = document.undoStack()->count();
    QVERIFY(choose(workspace, Tool::Pencil));
    drag(canvas, {2, 2}, {18, 2});
    QCOMPARE(document.undoStack()->count(), history + 1);
    for (int x = 2; x <= 18; ++x) QCOMPARE(document.cel(frame, layer).pixelColor(x, 2), settings.color);
    QImage painted = document.cel(frame, layer);
    QTest::keySequence(canvas, QKeySequence::Undo);
    QCOMPARE(document.cel(frame, layer).pixelColor(2, 2).alpha(), 0);
    QTest::keySequence(canvas, QKeySequence::Redo);
    QCOMPARE(document.cel(frame, layer), painted);

    drag(canvas, {3, 5}, {20, 5}, false);
    QVERIFY(document.gestureActive());
    QTest::keyClick(canvas, Qt::Key_Escape);
    QVERIFY(!document.gestureActive());
    QCOMPARE(document.cel(frame, layer), painted);
    QTest::mouseRelease(canvas, Qt::LeftButton);
    drag(canvas, {3, 5}, {20, 5}, false);
    workspace.findChild<QSpinBox *>("spriteBrushOpacity")->setFocus();
    QCoreApplication::processEvents();
    QVERIFY(!document.gestureActive());
    QCOMPARE(document.cel(frame, layer), painted);
    QTest::mouseRelease(canvas, Qt::LeftButton);

    QVERIFY(choose(workspace, Tool::Brush));
    QVERIFY(number(workspace, "spriteBrushSize", 3));
    QVERIFY(number(workspace, "spriteBrushOpacity", 50));
    drag(canvas, {2, 6}, {18, 6});
    int alpha = document.cel(frame, layer).pixelColor(10, 6).alpha();
    QVERIFY(alpha >= 127 && alpha <= 128);
    QVERIFY(choose(workspace, Tool::Eraser));
    QVERIFY(number(workspace, "spriteBrushOpacity", 100));
    drag(canvas, {8, 6}, {12, 6});
    QCOMPARE(document.cel(frame, layer).pixelColor(10, 6).alpha(), 0);

    QVERIFY(choose(workspace, Tool::Rectangle));
    QVERIFY(number(workspace, "spriteBrushSize", 1));
    QVERIFY(click(workspace, "spriteFilledShapes"));
    drag(canvas, {3, 10}, {8, 14});
    QCOMPARE(document.cel(frame, layer).pixelColor(5, 12), settings.color);
    QCOMPARE(document.cel(frame, layer).pixelColor(2, 12).alpha(), 0);
    QCOMPARE(document.cel(frame, layer).pixelColor(8, 14), settings.color);
    QCOMPARE(document.cel(frame, layer).pixelColor(9, 14).alpha(), 0);
    QCOMPARE(document.cel(frame, layer).pixelColor(3, 15).alpha(), 0);
    QVERIFY(choose(workspace, Tool::Ellipse));
    drag(canvas, {12, 10}, {20, 18});
    QCOMPARE(document.cel(frame, layer).pixelColor(16, 14), settings.color);
    QCOMPARE(document.cel(frame, layer).pixelColor(12, 10).alpha(), 0);
    QVERIFY(choose(workspace, Tool::Line));
    drag(canvas, {1, 21}, {20, 21});
    QCOMPARE(document.cel(frame, layer).pixelColor(10, 21), settings.color);

    settings = canvas->toolSettings();
    settings.color = QColor("#0044ff");
    QVERIFY(canvas->setToolSettings(settings, error));
    QVERIFY(choose(workspace, Tool::Fill));
    drag(canvas, {5, 12}, {5, 12});
    QCOMPARE(document.cel(frame, layer).pixelColor(5, 12), settings.color);
    QCOMPARE(document.cel(frame, layer).pixelColor(16, 14), QColor("#ff3300"));
    QVERIFY(choose(workspace, Tool::Eyedropper));
    drag(canvas, {16, 14}, {16, 14});
    QCOMPARE(canvas->toolSettings().color, QColor("#ff3300"));

    auto *mode = workspace.findChild<QComboBox *>("spriteRasterMode");
    QVERIFY(mode);
    mode->setFocus();
    QTest::keyClick(mode, Qt::Key_Down);
    QCOMPARE(document.state().mode, RasterMode::Smooth);
    QVERIFY(choose(workspace, Tool::Ellipse));
    QVERIFY(number(workspace, "spriteBrushSize", 1));
    drag(canvas, {0, 0}, {10, 10});
    bool antialiased = false;
    for (int y = 0; y < 10; ++y) for (int x = 0; x < 10; ++x) {
        int a = document.cel(frame, layer).pixelColor(x, y).alpha();
        if (a > 0 && a < 127) antialiased = true;
    }
    QVERIFY(antialiased);
}

void SpriteWidgetTest::nativeLayerControlsAndDrafts()
{
    Document document;
    QString error;
    Workspace workspace(document);
    QVERIFY(show(workspace));
    QVERIFY(click(workspace, "spriteAddLayer"));
    QCOMPARE(document.state().layers.size(), 2);
    Id layer = workspace.canvas()->layerId();
    QVERIFY(type(workspace, "spriteLayerName", "Body"));
    QVERIFY(workspace.hasPendingEdits());
    QVERIFY(!workspace.prepareSnapshot(error));
    int pendingHistory = document.undoStack()->index();
    QVERIFY(!workspace.undoAction()->isEnabled());
    workspace.canvas()->setFocus();
    QTest::keySequence(workspace.canvas(), QKeySequence::Undo);
    QCOMPARE(document.undoStack()->index(), pendingHistory);
    QCOMPARE(document.state().layers.size(), 2);
    QCOMPARE(workspace.canvas()->layerId(), layer);
    QCOMPARE(workspace.findChild<QLineEdit *>("spriteLayerName")->text(), QString("Body"));
    QVERIFY(click(workspace, "spriteApplyLayer"));
    QVERIFY(!workspace.hasPendingEdits());
    QCOMPARE(document.state().layers[document.layerIndex(layer)].name, QString("Body"));
    QVERIFY(choose(workspace, Tool::Pencil));
    drag(workspace.canvas(), {4, 4}, {12, 4});
    QImage pixels = document.cel(workspace.canvas()->frameId(), layer);
    QVERIFY(click(workspace, "spriteLayerLocked"));
    QVERIFY(click(workspace, "spriteApplyLayer"));
    QSignalSpy problem(&workspace, &Workspace::problem);
    drag(workspace.canvas(), {4, 10}, {12, 10});
    QCOMPARE(document.cel(workspace.canvas()->frameId(), layer), pixels);
    QVERIFY(problem.count() > 0);
    QVERIFY(click(workspace, "spriteLayerLocked"));
    QVERIFY(click(workspace, "spriteLayerVisible"));
    QVERIFY(click(workspace, "spriteApplyLayer"));
    QCOMPARE(composite(document.state(), workspace.canvas()->frameId()).pixelColor(4, 4).alpha(), 0);
    QVERIFY(type(workspace, "spriteLayerName", "Artwork"));
    State before = document.state();
    QVERIFY(click(workspace, "spriteApplyLayer"));
    QVERIFY(document.state() == before);
    QVERIFY(workspace.hasPendingEdits());
    QCOMPARE(workspace.findChild<QLineEdit *>("spriteLayerName")->text(), QString("Artwork"));
    auto *list = workspace.findChild<QListWidget *>("spriteLayers");
    QVERIFY(list);
    QTest::mouseClick(list->viewport(), Qt::LeftButton, Qt::NoModifier, list->visualItemRect(list->item(1)).center());
    QCOMPARE(workspace.canvas()->layerId(), layer);
    QVERIFY(click(workspace, "spriteResetLayer"));
    QVERIFY(!workspace.hasPendingEdits());
    QVERIFY(click(workspace, "spriteLayerVisible"));
    QVERIFY(click(workspace, "spriteApplyLayer"));
    QVERIFY(click(workspace, "spriteLowerLayer"));
    QCOMPARE(document.state().layers.first().id, layer);
    QVERIFY(click(workspace, "spriteRaiseLayer"));
    QCOMPARE(document.state().layers.last().id, layer);
    QVERIFY(click(workspace, "spriteDeleteLayer"));
    QCOMPARE(document.state().layers.size(), 1);
    QVERIFY(click(workspace, "spriteUndo"));
    QCOMPARE(document.state().layers.size(), 2);
}

void SpriteWidgetTest::framesAnimationAndPalette()
{
    Document document;
    QString error;
    QVERIFY(document.create({16, 16}, "Frames", RasterMode::Pixel, error));
    Workspace workspace(document);
    QVERIFY(show(workspace));
    Id first = workspace.canvas()->frameId();
    drag(workspace.canvas(), {3, 3}, {10, 3});
    QVERIFY(click(workspace, "spriteDuplicateFrame"));
    Id second = workspace.canvas()->frameId();
    QVERIFY(first != second);
    QCOMPARE(document.cel(first, workspace.canvas()->layerId()), document.cel(second, workspace.canvas()->layerId()));
    QVERIFY(number(workspace, "spriteFrameDuration", 80));
    QCOMPARE(document.state().frames[1].durationMs, 80);
    QVERIFY(click(workspace, "spriteFrameEarlier"));
    QCOMPARE(document.state().frames[0].id, second);
    QVERIFY(click(workspace, "spriteFrameLater"));
    QCOMPARE(document.state().frames[1].id, second);
    QVERIFY(click(workspace, "spriteOnionSkin"));
    QVERIFY(number(workspace, "spriteOnionOpacity", 40));
    QVERIFY(section(workspace, "Named animations"));
    QVERIFY(type(workspace, "spriteAnimationName", "Drive"));
    QVERIFY(number(workspace, "spriteAnimationFrom", 1));
    QVERIFY(number(workspace, "spriteAnimationTo", 2));
    QVERIFY(click(workspace, "spriteNewAnimation"));
    QVERIFY(!workspace.hasPendingEdits());
    QCOMPARE(document.state().animations.size(), 1);
    QCOMPARE(document.state().animations[0].frames, QVector<Id>({first, second}));
    QVERIFY(click(workspace, "spritePlayAnimation"));
    QVERIFY(workspace.preview()->isPlaying());
    QTRY_COMPARE_WITH_TIMEOUT(workspace.preview()->displayedFrame(), first, 500);
    QTRY_COMPARE_WITH_TIMEOUT(workspace.preview()->displayedFrame(), second, 500);
    QVERIFY(click(workspace, "spriteStopAnimation"));
    QVERIFY(!workspace.preview()->isPlaying());
    QCOMPARE(workspace.canvas()->frameId(), second);
    QVERIFY(click(workspace, "spriteDeleteFrame"));
    QCOMPARE(document.state().animations[0].frames, QVector<Id>({first}));
    QVERIFY(click(workspace, "spriteUndo"));
    QCOMPARE(document.state().animations[0].frames, QVector<Id>({first, second}));
    QVERIFY(section(workspace, "Palette and color"));
    QVERIFY(type(workspace, "spriteColor", "#3366aa"));
    QCOMPARE(workspace.canvas()->toolSettings().color, QColor("#3366aa"));
    int colors = document.state().palettes[0].colors.size();
    QVERIFY(click(workspace, "spriteAddColor"));
    QCOMPARE(document.state().palettes[0].colors.size(), colors + 1);
    QVERIFY(type(workspace, "spritePaletteName", "Rally"));
    QVERIFY(click(workspace, "spriteApplyPalette"));
    QCOMPARE(document.state().palettes[0].name, QString("Rally"));
    auto *swatches = workspace.findChild<QListWidget *>("spritePaletteColors");
    QVERIFY(swatches);
    QTest::mouseClick(swatches->viewport(), Qt::LeftButton, Qt::NoModifier, swatches->visualItemRect(swatches->item(2)).center());
    QCOMPARE(workspace.canvas()->toolSettings().color, document.state().palettes[0].colors[2]);
    QVERIFY(click(workspace, "spriteRemoveColor"));
    QCOMPARE(document.state().palettes[0].colors.size(), colors);
    QVERIFY(click(workspace, "spriteNewPalette"));
    QCOMPARE(document.state().palettes.size(), 2);
    QVERIFY(click(workspace, "spriteDeletePalette"));
    QCOMPARE(document.state().palettes.size(), 1);
}

void SpriteWidgetTest::selectionClipboardAndKeyboard()
{
    Document document;
    QString error;
    QVERIFY(document.create({16, 16}, "Select", RasterMode::Pixel, error));
    Workspace workspace(document);
    QVERIFY(show(workspace));
    auto *canvas = workspace.canvas();
    QVERIFY(choose(workspace, Tool::Rectangle));
    QVERIFY(click(workspace, "spriteFilledShapes"));
    drag(canvas, {2, 2}, {5, 5});
    QVERIFY(choose(workspace, Tool::Select));
    drag(canvas, {2, 2}, {5, 5});
    QCOMPARE(canvas->selection(), QRect(2, 2, 4, 4));
    QVERIFY(choose(workspace, Tool::Move));
    int count = document.undoStack()->count();
    drag(canvas, {3, 3}, {7, 7});
    QCOMPARE(canvas->selection(), QRect(6, 6, 4, 4));
    QCOMPARE(document.undoStack()->count(), count + 1);
    QCOMPARE(document.cel(canvas->frameId(), canvas->layerId()).pixelColor(2, 2).alpha(), 0);
    QTest::keyClick(canvas, Qt::Key_Right);
    QCOMPARE(canvas->selection(), QRect(7, 6, 4, 4));
    QVERIFY(section(workspace, "Selection and transforms"));
    QVERIFY(number(workspace, "spriteSelectionX", 8));
    QVERIFY(number(workspace, "spriteSelectionY", 7));
    QVERIFY(number(workspace, "spriteSelectionWidth", 6));
    QVERIFY(number(workspace, "spriteSelectionHeight", 5));
    QVERIFY(click(workspace, "spriteTransformSelection"));
    QCOMPARE(canvas->selection(), QRect(8, 7, 6, 5));
    QVERIFY(click(workspace, "spriteFlipHorizontal"));
    QVERIFY(click(workspace, "spriteRotateSelection"));
    QCOMPARE(canvas->selection().size(), QSize(5, 6));

    if (QGuiApplication::platformName() == "offscreen") {
        // The offscreen platform's private clipboard does not replace the user's OS clipboard.
        canvas->setFocus();
        QTest::keySequence(canvas, QKeySequence::Copy);
        QTest::keySequence(canvas, QKeySequence::Cut);
        QCOMPARE(document.cel(canvas->frameId(), canvas->layerId()).pixelColor(8, 7).alpha(), 0);
        QTest::keySequence(canvas, QKeySequence::Paste);
        QVERIFY(document.cel(canvas->frameId(), canvas->layerId()).pixelColor(8, 7).alpha() > 0);
    }
    canvas->setFocus();
    QTest::keyClick(canvas, Qt::Key_Escape);
    QVERIFY(canvas->selection().isEmpty());
    QTest::keyClick(canvas, Qt::Key_P);
    for (int i = 0; i < 16; ++i) {
        QTest::keyClick(canvas, Qt::Key_Left);
        QTest::keyClick(canvas, Qt::Key_Up);
    }
    QTest::keyClick(canvas, Qt::Key_Right);
    QTest::keyClick(canvas, Qt::Key_Down);
    int before = document.undoStack()->count();
    QTest::keyClick(canvas, Qt::Key_Return);
    QCOMPARE(document.undoStack()->count(), before + 1);
    QTest::keySequence(canvas, QKeySequence::SelectAll);
    QCOMPARE(canvas->selection(), QRect(0, 0, 16, 16));
    QTest::keyClick(canvas, Qt::Key_Home);
    qreal fit = canvas->zoom();
    QTest::keyClick(canvas, Qt::Key_Minus);
    QVERIFY(canvas->zoom() <= fit);
}

void SpriteWidgetTest::resizeAndScaleDialogs()
{
    Document document;
    QString error;
    QVERIFY(document.create({16, 16}, "Resize", RasterMode::Pixel, error));
    Workspace workspace(document);
    QVERIFY(show(workspace));
    QVERIFY(section(workspace, "Sprite and canvas"));
    bool dialogSeen = false, typed = false, previewSeen = false, themed = false;
    driveDialog(workspace, [&](QDialog &dialog) {
        dialogSeen = true;
        themed = dialog.palette().color(QPalette::Window) == workspace.palette().color(QPalette::Window) &&
                 dialog.findChild<QLabel *>()->palette().color(QPalette::WindowText) == workspace.palette().color(QPalette::WindowText);
        typed = number(dialog, "spriteSizeWidth", 24) && number(dialog, "spriteSizeHeight", 20) &&
                number(dialog, "spriteSizeOffsetX", 2);
        auto *preview = dialog.findChild<QLabel *>("spriteResizePreview");
        previewSeen = preview && !preview->pixmap().isNull();
        auto *apply = dialog.findChild<QPushButton *>("spriteConfirmSize");
        if (typed && apply) QTest::mouseClick(apply, Qt::LeftButton);
        else dialog.reject();
    });
    QVERIFY(click(workspace, "spriteResizeCanvas"));
    QVERIFY2(dialogSeen, "The real resize dialog was not shown.");
    QVERIFY2(typed, "Typing width, height or offset did not reach the resize controls.");
    QVERIFY2(previewSeen, "The resize dialog did not render its artwork preview.");
    QVERIFY2(themed, "The new modal form did not inherit readable workspace colors.");
    QCOMPARE(document.state().size, QSize(24, 20));
    QCOMPARE(document.state().pivot, QPoint(10, 8));
    driveDialog(workspace, [&](QDialog &dialog) {
        number(dialog, "spriteSizeWidth", 48);
        number(dialog, "spriteSizeHeight", 40);
        QTest::mouseClick(dialog.findChild<QPushButton *>("spriteConfirmSize"), Qt::LeftButton);
    });
    QVERIFY(click(workspace, "spriteScaleArtwork"));
    QCOMPARE(document.state().size, QSize(48, 40));
    QCOMPARE(document.state().pivot, QPoint(20, 16));
    State before = document.state();
    bool invalidDisabled = false;
    driveDialog(workspace, [&](QDialog &dialog) {
        number(dialog, "spriteSizeWidth", 2);
        number(dialog, "spriteSizeHeight", 2);
        invalidDisabled = !dialog.findChild<QPushButton *>("spriteConfirmSize")->isEnabled();
        auto *box = dialog.findChild<QDialogButtonBox *>();
        QTest::mouseClick(box->button(QDialogButtonBox::Cancel), Qt::LeftButton);
    });
    QVERIFY(click(workspace, "spriteResizeCanvas"));
    QVERIFY(invalidDisabled);
    QVERIFY(document.state() == before);
    QVERIFY(click(workspace, "spriteUndo"));
    QCOMPARE(document.state().size, QSize(24, 20));
    QVERIFY(click(workspace, "spriteFit"));
    QVERIFY(choose(workspace, Tool::Pencil));
    drag(workspace.canvas(), {4, 4}, {5, 4});
    drag(workspace.canvas(), {20, 18}, {21, 18});
    QImage original = document.cel(workspace.canvas()->frameId(), workspace.canvas()->layerId());
    QVERIFY(choose(workspace, Tool::Select));
    drag(workspace.canvas(), {1, 2}, {12, 13});
    driveDialog(workspace, [&](QDialog &dialog) {
        QTest::mouseClick(dialog.findChild<QPushButton *>("spriteConfirmSize"), Qt::LeftButton);
    });
    QVERIFY(click(workspace, "spriteCropCanvas"));
    QCOMPARE(document.state().size, QSize(12, 12));
    QCOMPARE(document.state().pivot, QPoint(9, 6));
    QCOMPARE(document.cel(workspace.canvas()->frameId(), workspace.canvas()->layerId()).pixelColor(3, 2),
             original.pixelColor(4, 4));
    QVERIFY(click(workspace, "spriteUndo"));
    QCOMPARE(document.cel(workspace.canvas()->frameId(), workspace.canvas()->layerId()), original);
}

void SpriteWidgetTest::unicodeFocusAndAccessibility()
{
    Document document;
    QString error;
    Workspace workspace(document);
    QVERIFY(show(workspace));
    QVERIFY(section(workspace, "Sprite and canvas"));
    auto *name = workspace.findChild<QLineEdit *>("spriteName");
    QVERIFY(name);
    QTest::mouseClick(name, Qt::LeftButton);
    QTest::keySequence(name, QKeySequence::SelectAll);
    QString unicode = QString::fromUtf8("Rally \xe8\xbb\x8a \xc3\xa9");
    QInputMethodEvent commit;
    commit.setCommitString(unicode);
    QApplication::sendEvent(name, &commit);
    QTest::keyClick(name, Qt::Key_Tab);
    QCOMPARE(name->text(), unicode);
    QVERIFY(workspace.hasPendingEdits());
    QVERIFY(number(workspace, "spritePivotX", 12));
    QVERIFY(number(workspace, "spritePivotY", 20));
    QVERIFY(click(workspace, "spriteCollisionEnabled"));
    QVERIFY(number(workspace, "spriteCollisionX", 2));
    QVERIFY(number(workspace, "spriteCollisionY", 3));
    QVERIFY(number(workspace, "spriteCollisionWidth", 20));
    QVERIFY(number(workspace, "spriteCollisionHeight", 24));
    QVERIFY(click(workspace, "spriteApplyMetadata"));
    QCOMPARE(document.state().name, unicode);
    QCOMPARE(document.state().pivot, QPoint(12, 20));
    QCOMPARE(*document.state().collision, QRect(2, 3, 20, 24));
    State before = document.state();
    QVERIFY(number(workspace, "spriteCollisionWidth", 100));
    QVERIFY(click(workspace, "spriteApplyMetadata"));
    QVERIFY(document.state() == before);
    QCOMPARE(workspace.findChild<QSpinBox *>("spriteCollisionWidth")->value(), 100);
    QVERIFY(!workspace.prepareSnapshot(error));
    QVERIFY(click(workspace, "spriteResetMetadata"));
    QVERIFY(workspace.prepareSnapshot(error));
    QAccessibleInterface *field = QAccessible::queryAccessibleInterface(name);
    QVERIFY(field);
    QCOMPARE(field->role(), QAccessible::EditableText);
    QAccessibleInterface *canvas = QAccessible::queryAccessibleInterface(workspace.canvas());
    QVERIFY(canvas);
    QVERIFY(canvas->text(QAccessible::Name).contains("Sprite"));
    auto *layerList = workspace.findChild<QListWidget *>("spriteLayers");
    QAccessibleInterface *list = QAccessible::queryAccessibleInterface(layerList);
    QVERIFY(list);
    QCOMPARE(list->role(), QAccessible::List);
    auto *collision = workspace.findChild<QCheckBox *>("spriteCollisionEnabled");
    QAccessibleInterface *toggle = QAccessible::queryAccessibleInterface(collision);
    QVERIFY(toggle);
    QCOMPARE(toggle->role(), QAccessible::CheckBox);
    QVERIFY(toggle->state().checked);
    Tool tool = workspace.canvas()->tool();
    QTest::mouseClick(name, Qt::LeftButton);
    QTest::keyClick(name, Qt::Key_P);
    QCOMPARE(workspace.canvas()->tool(), tool);
    QVERIFY(name->text().endsWith('p'));
}

void SpriteWidgetTest::authoredRoundTripAndCaptures()
{
    Document document;
    QString error;
    QVERIFY(document.create({32, 32}, "Rally marker", RasterMode::Pixel, error));
    Workspace workspace(document);
    // This case verifies authored output and exposed-window layout, not OS input activation.
    // The other cases require an active window and, on Cocoa, an actual key window.
    QVERIFY(show(workspace, {1440, 900}, false));
    for (QWidget *surface : {static_cast<QWidget *>(workspace.canvas()), static_cast<QWidget *>(workspace.preview())}) {
        QCOMPARE(surface->palette().color(QPalette::Window), QColor("#142131"));
        QCOMPARE(surface->palette().color(QPalette::Text), QColor("#edf5fb"));
        QVERIFY(surface->palette().color(QPalette::Base) != surface->palette().color(QPalette::AlternateBase));
    }
    auto *inspector = workspace.findChild<QToolBox *>("spriteInspector");
    for (int i = 0; i < inspector->count(); ++i) {
        bool found = false;
        for (auto *header : inspector->findChildren<QAbstractButton *>()) {
            if (header->text() != inspector->itemText(i)) continue;
            found = true;
            QVERIFY2(header->height() >= header->fontMetrics().height() + 4, qPrintable(header->text()));
        }
        QVERIFY(found);
    }
    for (auto *toggle : workspace.findChildren<QCheckBox *>())
        if (toggle->isVisible()) QVERIFY(toggle->width() >= toggle->minimumSizeHint().width());
    QVERIFY(type(workspace, "spriteLayerName", "Car body"));
    QVERIFY(click(workspace, "spriteApplyLayer"));
    auto color = [&](const char *hex) {
        return section(workspace, "Palette and color") && type(workspace, "spriteColor", hex);
    };
    auto rectangle = [&](QPoint a, QPoint b) {
        if (!choose(workspace, Tool::Rectangle)) return false;
        auto *filled = workspace.findChild<QCheckBox *>("spriteFilledShapes");
        if (!filled->isChecked() && !click(workspace, "spriteFilledShapes")) return false;
        drag(workspace.canvas(), a, b);
        return true;
    };
    QVERIFY(color("#15283b"));
    for (int y : {8, 22}) {
        QVERIFY(rectangle({5, y}, {8, y + 5}));
        QVERIFY(rectangle({23, y}, {26, y + 5}));
    }
    QVERIFY(color("#72d8bd"));
    QVERIFY(rectangle({8, 4}, {23, 28}));
    QVERIFY(color("#b7f2d8"));
    QVERIFY(rectangle({10, 5}, {21, 10}));
    QVERIFY(color("#29475d"));
    QVERIFY(rectangle({10, 12}, {21, 17}));
    QVERIFY(color("#e7bd77"));
    QVERIFY(rectangle({9, 4}, {12, 5}));
    QVERIFY(rectangle({19, 4}, {22, 5}));
    QVERIFY(section(workspace, "Layers"));
    QVERIFY(click(workspace, "spriteAddLayer"));
    QVERIFY(type(workspace, "spriteLayerName", "Racing stripe"));
    QVERIFY(click(workspace, "spriteApplyLayer"));
    QVERIFY(color("#f3f8f3"));
    QVERIFY(rectangle({15, 19}, {16, 27}));
    Id first = workspace.canvas()->frameId();
    for (int i = 0; i < 3; ++i) {
        QVERIFY(click(workspace, "spriteDuplicateFrame"));
        QVERIFY(number(workspace, "spriteFrameDuration", 90 + 20 * i));
        QVERIFY(choose(workspace, Tool::Pencil));
        drag(workspace.canvas(), {14 + i, 20}, {14 + i, 25});
    }
    QVERIFY(section(workspace, "Named animations"));
    QVERIFY(type(workspace, "spriteAnimationName", "Cruise"));
    QVERIFY(number(workspace, "spriteAnimationFrom", 1));
    QVERIFY(number(workspace, "spriteAnimationTo", 4));
    QVERIFY(click(workspace, "spriteNewAnimation"));
    QVERIFY(section(workspace, "Sprite and canvas"));
    QVERIFY(number(workspace, "spritePivotX", 16));
    QVERIFY(number(workspace, "spritePivotY", 24));
    QVERIFY(click(workspace, "spriteCollisionEnabled"));
    QVERIFY(number(workspace, "spriteCollisionX", 8));
    QVERIFY(number(workspace, "spriteCollisionY", 4));
    QVERIFY(number(workspace, "spriteCollisionWidth", 16));
    QVERIFY(number(workspace, "spriteCollisionHeight", 25));
    QVERIFY(click(workspace, "spriteApplyMetadata"));
    workspace.canvas()->setFrameId(first);
    QVERIFY(section(workspace, "Layers"));
    QVERIFY(workspace.prepareSnapshot(error));
    ExportBundle bundle;
    QVERIFY2(document.exportBundle(bundle, error), qPrintable(error));
    QTemporaryDir storage;
    QVERIFY(storage.isValid());
    QSaveFile file(storage.filePath("rally-marker.nova-sprite"));
    QVERIFY(file.open(QIODevice::WriteOnly));
    QCOMPARE(file.write(bundle.source), bundle.source.size());
    QVERIFY(file.commit());
    QVERIFY(document.markSaved(bundle.revision));
    QFile saved(storage.filePath("rally-marker.nova-sprite"));
    QVERIFY(saved.open(QIODevice::ReadOnly));
    Document reopened;
    QVERIFY(reopened.load(saved.readAll(), error));
    QVERIFY(reopened.state() == document.state());
    for (const ExportFrame &frame : bundle.frames) {
        QImage image;
        QVERIFY(decodePng(frame.png, image, error));
        QCOMPARE(image, composite(document.state(), frame.id));
    }
    QString directory = qEnvironmentVariable("NOVA_SPRITE_CAPTURE_DIR");
    if (!directory.isEmpty()) {
        QVERIFY(QDir().mkpath(directory));
        auto persist = [&](const QString &name, const QByteArray &bytes) {
            QSaveFile artifact(QDir(directory).filePath(name));
            return artifact.open(QIODevice::WriteOnly) && artifact.write(bytes) == bytes.size() && artifact.commit();
        };
        QVERIFY(persist("rally-marker.nova-sprite", bundle.source));
        QVERIFY(persist("rally-marker.sprite-export.json", bundle.metadata));
        for (const ExportFrame &frame : bundle.frames) QVERIFY(persist(frame.fileName, frame.png));
        workspace.resize(1440, 900);
        QApplication::processEvents();
        workspace.canvas()->fitCanvas();
        QVERIFY(workspace.grab().save(QDir(directory).filePath("sprite-normal.png")));
        workspace.resize(workspace.minimumSizeHint());
        QApplication::processEvents();
        workspace.canvas()->fitCanvas();
        QCOMPARE(workspace.size(), QSize(1280, 720));
        QVERIFY(workspace.canvas()->width() >= 400);
        QVERIFY(workspace.canvas()->height() >= 240);
        QVERIFY(workspace.grab().save(QDir(directory).filePath("sprite-minimum.png")));
        QVERIFY(section(workspace, "Sprite and canvas"));
        for (auto *area : workspace.findChildren<QScrollArea *>()) area->verticalScrollBar()->setValue(0);
        QVERIFY(workspace.grab().save(QDir(directory).filePath("sprite-properties.png")));
        workspace.setDarkTheme(false);
        QCOMPARE(workspace.canvas()->palette().color(QPalette::Window), QColor("#f1f5f8"));
        QCOMPARE(workspace.preview()->palette().color(QPalette::Text), QColor("#162c40"));
        QVERIFY(workspace.grab().save(QDir(directory).filePath("sprite-light.png")));
        workspace.setDarkTheme(true);
        for (const char *action : {"spriteResizeCanvas", "spriteScaleArtwork"}) {
            bool captured = false;
            driveDialog(workspace, [&](QDialog &dialog) {
                captured = QTest::qWaitForWindowExposed(&dialog) &&
                    dialog.grab().save(QDir(directory).filePath(QString("%1.png").arg(action)));
                QTest::mouseClick(dialog.findChild<QDialogButtonBox *>()->button(QDialogButtonBox::Cancel), Qt::LeftButton);
            });
            QVERIFY(click(workspace, action));
            QVERIFY(captured);
        }
        qInfo("Sprite exposed-window layout capture platform=%s DPR=%.2f; input activation is verified separately.",
              qPrintable(QGuiApplication::platformName()), workspace.devicePixelRatioF());
    }
}

void SpriteWidgetTest::pendingNumbersAndHostActions()
{
    Document document;
    QString error;
    Workspace workspace(document);
    QVERIFY(show(workspace));
    State before = document.state();
    auto *opacity = workspace.findChild<QSpinBox *>("spriteLayerOpacity");
    opacity->setFocus();
    QTest::keySequence(opacity, QKeySequence::SelectAll);
    QTest::keyClicks(opacity, "75");
    QCOMPARE(opacity->value(), 100);
    QVERIFY(workspace.hasPendingEdits());
    QVERIFY(!workspace.prepareSnapshot(error));
    QVERIFY(document.state() == before);
    QVERIFY(click(workspace, "spriteResetLayer"));
    QVERIFY(!workspace.hasPendingEdits());
    QVERIFY(document.state() == before);
    QCOMPARE(opacity->value(), 100);

    auto *duration = workspace.findChild<QSpinBox *>("spriteFrameDuration");
    duration->setFocus();
    QTest::keySequence(duration, QKeySequence::SelectAll);
    QTest::keyClicks(duration, "217");
    QVERIFY(!workspace.prepareSnapshot(error));
    QCOMPARE(document.state().frames[0].durationMs, 125);
    QTest::keyClick(duration, Qt::Key_Return);
    QCOMPARE(document.state().frames[0].durationMs, 217);
    QVERIFY(workspace.prepareSnapshot(error));

    QAction save("Save sprite"), import("Import PNG"), exportImages("Export frames");
    int saved = 0, imported = 0, exported = 0;
    connect(&save, &QAction::triggered, &workspace, [&] { ++saved; });
    connect(&import, &QAction::triggered, &workspace, [&] { ++imported; });
    connect(&exportImages, &QAction::triggered, &workspace, [&] { ++exported; });
    connect(&workspace, &Workspace::saveRequested, &save, &QAction::trigger);
    workspace.setHostActions(&save, &import, &exportImages);
    QApplication::processEvents();
    for (QAction *action : {&save, &import, &exportImages}) {
        bool found = false;
        for (auto *button : workspace.findChildren<QToolButton *>()) if (button->defaultAction() == action) {
            QVERIFY(button->isVisible());
            QTest::mouseClick(button, Qt::LeftButton);
            found = true;
        }
        QVERIFY(found);
    }
    QCOMPARE(saved, 1); QCOMPARE(imported, 1); QCOMPARE(exported, 1);
    workspace.canvas()->setFocus();
    QTest::keySequence(workspace.canvas(), QKeySequence::Save);
    QCOMPARE(saved, 2);
    before = document.state();
    int history = document.undoStack()->count();
    QVERIFY(!workspace.importPng("not PNG", error));
    QVERIFY(document.state() == before);
    QCOMPARE(document.undoStack()->count(), history);
    QImage image(2, 2, QImage::Format_ARGB32);
    image.fill(Qt::red);
    image.setPixelColor(1, 1, Qt::blue);
    QByteArray bytes;
    QVERIFY(encodePng(image, bytes, error));
    QVERIFY(workspace.importPng(bytes, error));
    QCOMPARE(document.cel(workspace.canvas()->frameId(), workspace.canvas()->layerId()).pixelColor(1, 1), QColor(Qt::blue));
    QCOMPARE(document.undoStack()->count(), history + 1);
    document.undoStack()->undo();
    QVERIFY(document.state() == before);
    QVERIFY(document.setMetadata(QString(96, 'W'), RasterMode::Pixel, before.pivot, before.collision, error));
    Layer layer = document.state().layers[0];
    layer.name = QString(96, 'W');
    QVERIFY(document.setLayer(layer, error));
    workspace.resize(workspace.minimumSizeHint());
    QApplication::processEvents();
    QCOMPARE(workspace.size(), QSize(1280, 720));
    QCOMPARE(workspace.findChild<QLabel *>("spriteTitle")->toolTip(), QString(96, 'W'));
}

void SpriteWidgetTest::onionSkinIsViewOnly()
{
    Document document;
    QString error;
    QVERIFY(document.create({16, 16}, "Onion skin", RasterMode::Pixel, error));
    Workspace workspace(document);
    QVERIFY(show(workspace));
    drag(workspace.canvas(), {2, 2}, {4, 2});
    QVERIFY(click(workspace, "spriteNewFrame"));
    QVERIFY(click(workspace, "spriteGrid"));
    const State before = document.state();
    int history = document.undoStack()->count();
    auto sample = [&] {
        QPixmap capture = workspace.canvas()->grab();
        QPointF point = workspace.canvas()->widgetPoint({3, 2}) * capture.devicePixelRatio();
        return capture.toImage().pixelColor(point.toPoint());
    };
    QColor background = sample();
    QVERIFY(click(workspace, "spriteOnionSkin"));
    QVERIFY(number(workspace, "spriteOnionOpacity", 100));
    QCOMPARE(sample(), QColor("#ef9e9e"));
    QVERIFY(number(workspace, "spriteOnionOpacity", 0));
    QCOMPARE(sample(), background);
    QVERIFY(document.state() == before);
    QCOMPARE(document.undoStack()->count(), history);
}

void SpriteWidgetTest::pointerAnchoredZoomAndPan()
{
    Document document;
    Workspace workspace(document);
    QVERIFY(show(workspace));
    Canvas *canvas = workspace.canvas();
    canvas->setZoom(4);
    const quint64 revision = document.revision();
    QPointF anchor = canvas->widgetPoint({4, 6});
    QWheelEvent zoom(anchor, canvas->mapToGlobal(anchor.toPoint()), {}, {0, 120},
                     Qt::NoButton, Qt::NoModifier, Qt::NoScrollPhase, false);
    QApplication::sendEvent(canvas, &zoom);
    QCOMPARE(canvas->zoom(), 6.0);
    QVERIFY((canvas->widgetPoint({4, 6}) - anchor).manhattanLength() < 0.01);
    QWheelEvent pan(anchor, canvas->mapToGlobal(anchor.toPoint()), {24, -16}, {},
                    Qt::NoButton, Qt::NoModifier, Qt::ScrollUpdate, false);
    QApplication::sendEvent(canvas, &pan);
    QCOMPARE(canvas->widgetPoint({4, 6}), anchor + QPointF(24, -16));
    QCOMPARE(document.revision(), revision);
}

void SpriteWidgetTest::closingCancelsGesture()
{
    Document document;
    QString error;
    QVERIFY(document.create({16, 16}, "Closing", RasterMode::Pixel, error));
    State before = document.state();
    auto workspace = std::make_unique<Workspace>(document);
    QVERIFY(show(*workspace));
    drag(workspace->canvas(), {1, 1}, {14, 14}, false);
    QVERIFY(document.gestureActive());
    workspace.reset();
    QVERIFY(!document.gestureActive());
    QVERIFY(document.state() == before);
    QCOMPARE(document.undoStack()->count(), 0);
}

int main(int argc, char **argv)
{
    QApplication application(argc, argv);
    application.setQuitOnLastWindowClosed(false);
    SpriteWidgetTest tests;
    QTimer::singleShot(0, &application, [&] {
        int result = QTest::qExec(&tests, argc, argv);
        application.exit(result);
    });
    return application.exec();
}

#include "sprite_widget_test.moc"
