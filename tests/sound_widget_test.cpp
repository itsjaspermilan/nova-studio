#include "sound/workspace.hpp"
#include "sound_fixture.hpp"

#include <QAbstractButton>
#include <QAccessible>
#include <QAction>
#include <QApplication>
#include <QCheckBox>
#include <QClipboard>
#include <QComboBox>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDir>
#include <QDockWidget>
#include <QDoubleSpinBox>
#include <QInputMethodEvent>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMainWindow>
#include <QMenuBar>
#include <QMouseEvent>
#include <QPushButton>
#include <QScrollArea>
#include <QScrollBar>
#include <QScopeGuard>
#include <QSignalSpy>
#include <QSpinBox>
#include <QStatusBar>
#include <QToolBar>
#include <QToolButton>
#include <QtTest>

using namespace nova::sound;

class SoundWidgetTest final : public QObject {
    Q_OBJECT
private slots:
    void actualWaveformEditsAndUndo();
    void pendingFieldsHostActionsAndStaleDraft();
    void pendingFieldsAcrossReopenAndMute();
    void settingsPrecisionAndStaleDialog();
    void longOriginalRegionAndAccessibility();
    void asynchronousExportsAndTeardown();
    void embeddedLayoutAndCaptures();
};

static void showWidget(Workspace &workspace, QSize size = {1000, 540})
{
    workspace.resize(size);
    workspace.show();
    QApplication::processEvents();
}

static bool ensureVisible(QWidget *widget)
{
    if (!widget) return false;
    for (QWidget *parent = widget->parentWidget(); parent; parent = parent->parentWidget())
        if (auto *area = qobject_cast<QScrollArea *>(parent)) area->ensureWidgetVisible(widget);
    QApplication::processEvents();
    return widget->isVisible() && widget->visibleRegion().contains(widget->rect().center());
}

static bool click(QWidget &parent, const char *name)
{
    auto *button = parent.findChild<QAbstractButton *>(QString::fromLatin1(name));
    if (!button || !button->isEnabled() || !ensureVisible(button)) return false;
    QTest::mouseClick(button, Qt::LeftButton);
    QApplication::processEvents();
    return true;
}

static bool typeNumber(QWidget &parent, const char *name, const QString &value, bool finish = true)
{
    auto *spin = parent.findChild<QAbstractSpinBox *>(QString::fromLatin1(name));
    if (!spin || !ensureVisible(spin)) return false;
    spin->setFocus(Qt::OtherFocusReason);
    QTest::keySequence(spin, QKeySequence::SelectAll);
    QTest::keyClicks(spin, value);
    if (finish) QTest::keyClick(spin, Qt::Key_Return);
    return true;
}

static bool originalView(Workspace &workspace)
{
    auto *toggle = workspace.findChild<QToolButton *>(QStringLiteral("soundViewMix"));
    if (!toggle) return false;
    if (toggle->isChecked() && !click(workspace, "soundViewMix")) return false;
    return workspace.waveform()->wave() != nullptr;
}

void SoundWidgetTest::actualWaveformEditsAndUndo()
{
    QString error;
    Document document;
    Id id = 0;
    const QByteArray original = sound_test::wav(8000, 32000, 2, 24);
    QVERIFY(document.importWav(original, QStringLiteral("Gravel"), error, &id));
    sound_test::FakeHost host;
    Workspace workspace(document, &host);
    showWidget(workspace);
    QVERIFY(originalView(workspace));
    QCOMPARE(host.opens, 0);
    QVERIFY(typeNumber(workspace, "soundSelectionBegin", QStringLiteral("17")));
    QVERIFY(typeNumber(workspace, "soundSelectionEnd", QStringLiteral("7991")));
    QCOMPARE(workspace.waveform()->selectionBegin(), quint32(17));
    QCOMPARE(workspace.waveform()->selectionEnd(), quint32(7991));
    QVERIFY(click(workspace, "soundTrim"));
    QCOMPARE(findLayer(*document.state(), id)->begin, quint32(17));
    QCOMPARE(findLayer(*document.state(), id)->end, quint32(7991));
    QVERIFY(typeNumber(workspace, "soundFadeIn", QStringLiteral("37")));
    QVERIFY(typeNumber(workspace, "soundFadeOut", QStringLiteral("53")));
    QVERIFY(click(workspace, "soundReverse"));
    QVERIFY(workspace.hasPendingEdits());
    QCOMPARE(findLayer(*document.state(), id)->fadeIn, quint32(0));
    QVERIFY(click(workspace, "soundApply"));
    QVERIFY(!workspace.hasPendingEdits());
    QCOMPARE(findLayer(*document.state(), id)->fadeIn, quint32(37));
    QCOMPARE(findLayer(*document.state(), id)->fadeOut, quint32(53));
    QVERIFY(findLayer(*document.state(), id)->reverse);
    QCOMPARE(document.state()->media.front().data->wav(), original);
    QVERIFY(click(workspace, "soundUndo"));
    QVERIFY(!findLayer(*document.state(), id)->reverse);
    QVERIFY(click(workspace, "soundRedo"));
    QVERIFY(findLayer(*document.state(), id)->reverse);
    workspace.waveform()->setSelection(100, 120);
    QVERIFY(click(workspace, "soundZoomSelection"));
    QCOMPARE(workspace.waveform()->visibleFrames(), quint32(20));
    workspace.waveform()->setFocus();
    QTest::keyClick(workspace.waveform(), Qt::Key_Right);
    QCOMPARE(workspace.waveform()->selectionBegin(), quint32(101));
    QTest::keyClick(workspace.waveform(), Qt::Key_Left, Qt::ShiftModifier);
    QCOMPARE(workspace.waveform()->selectionEnd(), quint32(120));
    const QPoint from = workspace.waveform()->pointForFrame(103).toPoint();
    const QPoint to = workspace.waveform()->pointForFrame(113).toPoint();
    QTest::mousePress(workspace.waveform(), Qt::LeftButton, Qt::NoModifier, from);
    QMouseEvent move(QEvent::MouseMove, to, workspace.waveform()->mapToGlobal(to), Qt::NoButton, Qt::LeftButton, Qt::NoModifier);
    QApplication::sendEvent(workspace.waveform(), &move);
    QTest::mouseRelease(workspace.waveform(), Qt::LeftButton, Qt::NoModifier, to);
    QCOMPARE(workspace.waveform()->selectionBegin(), quint32(103));
    QCOMPARE(workspace.waveform()->selectionEnd(), quint32(113));
    QVERIFY(click(workspace, "soundViewMix"));
    QTRY_VERIFY_WITH_TIMEOUT(workspace.preview() && document.isCurrent(*workspace.preview()->source->snapshot), 10000);
    QCOMPARE(workspace.waveform()->wave(), workspace.preview()->waveform);
    QCOMPARE(workspace.waveform()->wave()->pcm().front(), 0.0f);
    QCOMPARE(host.opens, 0);
    QVERIFY(click(workspace, "soundPlay"));
    QTRY_COMPARE_WITH_TIMEOUT(workspace.audition()->state(), AuditionState::Queued, 10000);
    QVERIFY(host.tick()); workspace.audition()->poll();
    QCOMPARE(workspace.audition()->state(), AuditionState::Playing);
    QVERIFY(click(workspace, "soundStop"));
    QVERIFY(host.tick()); workspace.audition()->poll();
    QCOMPARE(workspace.audition()->state(), AuditionState::Stopped);
}

void SoundWidgetTest::pendingFieldsHostActionsAndStaleDraft()
{
    Document document;
    QString error;
    QVERIFY(document.addPreset(Preset::Confirm, error));
    sound_test::FakeHost host;
    Workspace workspace(document, &host);
    QAction save(QStringLiteral("Save"), &workspace), import(QStringLiteral("Import WAV"), &workspace), exportAction(QStringLiteral("Export"), &workspace);
    int saves = 0, imports = 0, exports = 0;
    bool snapshotAllowed = true;
    connect(&save, &QAction::triggered, &workspace, [&] {
        ++saves; QString detail; snapshotAllowed = bool(workspace.prepareSnapshot(detail));
    });
    connect(&import, &QAction::triggered, &workspace, [&] { ++imports; });
    connect(&exportAction, &QAction::triggered, &workspace, [&] { ++exports; });
    workspace.setHostActions(&save, &import, &exportAction);
    showWidget(workspace);
    const auto before = document.state();
    QVERIFY(typeNumber(workspace, "soundGain", QStringLiteral("0.123"), false));
    QVERIFY(workspace.hasPendingEdits());
    QVERIFY(click(workspace, "soundHostSave"));
    QCOMPARE(saves, 1); QVERIFY(!snapshotAllowed);
    QVERIFY(click(workspace, "soundPlay"));
    QCOMPARE(host.opens, 0);
    QVERIFY(!workspace.requestExport({}, error));
    QVERIFY(document.state() == before);
    auto *layers = workspace.findChild<QListWidget *>(QStringLiteral("soundLayers"));
    QVERIFY(layers && layers->count() == 2);
    QTest::mouseClick(layers->viewport(), Qt::LeftButton, Qt::NoModifier, layers->visualItemRect(layers->item(1)).center());
    QCOMPARE(layers->currentRow(), 0);
    QVERIFY(workspace.hasPendingEdits());
    QVERIFY(click(workspace, "soundApply"));
    QCOMPARE(document.state()->layers.front().gain, .123);
    QVERIFY(click(workspace, "soundHostSave")); QCOMPARE(saves, 2); QVERIFY(snapshotAllowed);
    QVERIFY(click(workspace, "soundHostImport")); QVERIFY(click(workspace, "soundHostExport"));
    QCOMPARE(imports, 1); QCOMPARE(exports, 1);
    auto *name = workspace.findChild<QLineEdit *>(QStringLiteral("soundLayerName"));
    QVERIFY(ensureVisible(name));
    name->setFocus(); QTest::keySequence(name, QKeySequence::SelectAll); QTest::keyClicks(name, "Pending name");
    QVERIFY(document.addTone(NOVA_AUDIO_SINE, error));
    QVERIFY(click(workspace, "soundApply"));
    QVERIFY(workspace.hasPendingEdits());
    QCOMPARE(name->text(), QStringLiteral("Pending name"));
    QVERIFY(workspace.findChild<QLabel *>(QStringLiteral("soundPending"))->text().contains(QStringLiteral("Reset")));
    QVERIFY(click(workspace, "soundReset"));
    QVERIFY(!workspace.hasPendingEdits());
    QCOMPARE(name->text(), document.state()->layers.front().name);
    import.setEnabled(false);
    QVERIFY(!workspace.findChild<QToolButton *>(QStringLiteral("soundHostImport"))->isEnabled());
    import.setEnabled(true);
    QVERIFY(workspace.findChild<QToolButton *>(QStringLiteral("soundHostImport"))->isEnabled());
}

void SoundWidgetTest::longOriginalRegionAndAccessibility()
{
    Document document;
    sound_test::FakeHost host;
    Workspace workspace(document, &host);
    showWidget(workspace);
    QString error;
    const QByteArray original = sound_test::wav(8000 * 45, 8000, 1, 16);
    QVERIFY(workspace.importWav(original, QStringLiteral("Original ambience"), error));
    QVERIFY(document.state()->layers.empty());
    QCOMPARE(workspace.waveform()->wave()->info().sample.frames, quint32(8000 * 45));
    QVERIFY(typeNumber(workspace, "soundSelectionBegin", QStringLiteral("8001")));
    QVERIFY(typeNumber(workspace, "soundSelectionEnd", QStringLiteral("168003")));
    QVERIFY(click(workspace, "soundAddRegion"));
    QCOMPARE(document.state()->layers.size(), size_t(1));
    QCOMPARE(document.state()->layers.front().begin, quint32(8001));
    QCOMPARE(document.state()->layers.front().end, quint32(168003));
    QCOMPARE(document.state()->media.front().data->wav(), original);
    auto *name = workspace.findChild<QLineEdit *>(QStringLiteral("soundLayerName"));
    QVERIFY(ensureVisible(name));
    name->setFocus(); name->selectAll();
    QInputMethodEvent event;
    const QString unicode = QString::fromUtf8("Frein \xc3\xa9t\xc3\xa9");
    event.setCommitString(unicode);
    QApplication::sendEvent(name, &event);
    QCOMPARE(name->text(), unicode);
    auto *accessible = QAccessible::queryAccessibleInterface(name);
    QVERIFY(accessible && accessible->textInterface() && accessible->editableTextInterface());
    QCOMPARE(accessible->text(QAccessible::Value), unicode);
    auto *waveAccessible = QAccessible::queryAccessibleInterface(workspace.waveform());
    QVERIFY(waveAccessible);
    QVERIFY(waveAccessible->text(QAccessible::Name).contains(QStringLiteral("waveform")));
    auto *frameAccessible = QAccessible::queryAccessibleInterface(workspace.findChild<QSpinBox *>(QStringLiteral("soundSelectionBegin")));
    QVERIFY(frameAccessible && frameAccessible->valueInterface());
    QVERIFY(click(workspace, "soundApply"));
    QCOMPARE(document.state()->layers.front().name, unicode);
    QCOMPARE(host.opens, 0);
    QVERIFY(document.state()->layers.front().begin != 0);
}

void SoundWidgetTest::pendingFieldsAcrossReopenAndMute()
{
    Document document;
    QString error;
    QVERIFY(document.addTone(NOVA_AUDIO_SINE, error));
    const auto source = sourceValue(document.snapshot(), error);
    QVERIFY(source);
    QVERIFY(document.load(source->bytes, error));
    Workspace workspace(document);
    showWidget(workspace);
    auto *name = workspace.findChild<QLineEdit *>(QStringLiteral("soundLayerName"));
    QVERIFY(ensureVisible(name));
    name->setFocus(); name->selectAll(); QTest::keyClicks(name, "Unapplied prior open");
    const Revision old = document.revision();
    QVERIFY(document.load(source->bytes, error));
    QCOMPARE(document.revision().number, old.number);
    QVERIFY(document.revision().session != old.session);
    QVERIFY(click(workspace, "soundApply"));
    QVERIFY(workspace.hasPendingEdits());
    QCOMPARE(document.state()->layers.front().name, QStringLiteral("Tone"));
    QVERIFY(click(workspace, "soundReset"));
    auto *layers = workspace.findChild<QListWidget *>(QStringLiteral("soundLayers"));
    QVERIFY(layers);
    const QRect item = layers->visualItemRect(layers->item(0));
    QTest::mouseClick(layers->viewport(), Qt::LeftButton, Qt::NoModifier, QPoint(item.left() + 13, item.center().y()));
    QVERIFY(!document.state()->layers.front().enabled);
    QCOMPARE(layers->item(0)->checkState(), Qt::Unchecked);
    QVERIFY(click(workspace, "soundUndo"));
    QVERIFY(document.state()->layers.front().enabled);
}

void SoundWidgetTest::settingsPrecisionAndStaleDialog()
{
    Document document;
    QString error;
    QVERIFY(document.addTone(NOVA_AUDIO_SINE, error));
    QVERIFY(document.setSettings(QStringLiteral("Exact master"), 48000, .123456789, error));
    Workspace workspace(document);
    showWidget(workspace);
    const auto settings = [&](const std::function<void(QDialog *)> &inspect) {
        QTimer opened, deadline;
        bool inspected = false;
        connect(&opened, &QTimer::timeout, &workspace, [&] {
            auto *dialog = qobject_cast<QDialog *>(QApplication::activeModalWidget());
            if (!dialog || dialog->parentWidget() != &workspace) return;
            opened.stop();
            const auto close = qScopeGuard([&] { dialog->reject(); });
            inspected = true;
            inspect(dialog);
        });
        deadline.setSingleShot(true);
        connect(&deadline, &QTimer::timeout, &workspace, [&] {
            opened.stop();
            for (auto *dialog : workspace.findChildren<QDialog *>()) dialog->reject();
        });
        opened.start(5);
        deadline.start(5000);
        const bool clicked = click(workspace, "soundSettings");
        return clicked && inspected;
    };
    QVERIFY(settings([&](QDialog *dialog) {
        QVERIFY(workspace.hasPendingEdits());
        QVERIFY(!workspace.prepareSnapshot(error));
        auto *name = dialog->findChild<QLineEdit *>(QStringLiteral("soundDocumentName"));
        QVERIFY(ensureVisible(name));
        name->setFocus(); name->selectAll(); QTest::keyClicks(name, "Renamed only");
        auto *buttons = dialog->findChild<QDialogButtonBox *>();
        QVERIFY(buttons);
        QTest::mouseClick(buttons->button(QDialogButtonBox::Apply), Qt::LeftButton);
        QCOMPARE(document.state()->name, QStringLiteral("Renamed only"));
        QCOMPARE(document.state()->masterGain, .123456789);
    }));
    QVERIFY(!workspace.hasPendingEdits());

    QVERIFY(settings([&](QDialog *dialog) {
        QVERIFY(typeNumber(*dialog, "soundMasterGain", QStringLiteral("0.625"), false));
        auto *buttons = dialog->findChild<QDialogButtonBox *>();
        QVERIFY(buttons);
        QTest::mouseClick(buttons->button(QDialogButtonBox::Apply), Qt::LeftButton);
        QCOMPARE(document.state()->masterGain, .625);
    }));
    const auto source = sourceValue(document.snapshot(), error);
    QVERIFY(source);
    QVERIFY(document.load(source->bytes, error));
    QVERIFY(settings([&](QDialog *dialog) {
        QVERIFY(typeNumber(*dialog, "soundMasterGain", QStringLiteral("0.400"), false));
        const Revision old = document.revision();
        QVERIFY(document.load(source->bytes, error));
        QCOMPARE(document.revision().number, old.number);
        QVERIFY(document.revision().session != old.session);
        const auto reopened = document.state();
        auto *buttons = dialog->findChild<QDialogButtonBox *>();
        QVERIFY(buttons);
        QTest::mouseClick(buttons->button(QDialogButtonBox::Apply), Qt::LeftButton);
        QCOMPARE(document.state(), reopened);
        QVERIFY(dialog->isVisible());
        auto *diagnostic = dialog->findChild<QLabel *>(QStringLiteral("soundSettingsError"));
        QVERIFY(diagnostic && diagnostic->text().contains(QStringLiteral("changed")));
    }));
    QVERIFY(!workspace.hasPendingEdits());
}

void SoundWidgetTest::asynchronousExportsAndTeardown()
{
    Document document;
    QString error;
    QVERIFY(document.addPreset(Preset::Confirm, error));
    sound_test::FakeHost host;
    Workspace workspace(document, &host);
    showWidget(workspace);
    QSignalSpy ready(&workspace, &Workspace::exportReady);
    QSignalSpy finished(&workspace, &Workspace::exportFinished);
    QVERIFY(workspace.requestExport({NOVA_AUDIO_WAV_PCM24, true, 1949}, error));
    Layer layer = document.state()->layers.front(); layer.gain = .22;
    QVERIFY(document.setLayer(layer, document.revision(), error));
    QTRY_COMPARE_WITH_TIMEOUT(finished.count(), 1, 10000);
    QCOMPARE(ready.count(), 0);
    QVERIFY(finished.front().at(1).toString().contains(QStringLiteral("source changed")));
    QVERIFY(workspace.requestExport({NOVA_AUDIO_WAV_PCM24, true, 1949}, error));
    QTRY_COMPARE_WITH_TIMEOUT(finished.count(), 2, 10000);
    QCOMPARE(ready.count(), 1);
    const auto result = qvariant_cast<ExportPtr>(ready.front().front());
    QVERIFY(result);
    QVERIFY(document.isCurrent(*result->source->snapshot));
    QVERIFY(document.dirty());
    QVERIFY(document.markPersisted(*result->source, SaveIntent::PublishDerived, result.get(), error));
    QVERIFY(!document.dirty()); QVERIFY(!document.derivedStale());
    QCOMPARE(host.opens, 0);
    layer = document.state()->layers.front(); layer.duration = 48000 * 30;
    QVERIFY(document.setLayer(layer, document.revision(), error));
    QVERIFY(workspace.requestExport({NOVA_AUDIO_WAV_FLOAT32, false, 1}, error));
    QVERIFY(click(workspace, "soundCancelExport"));
    QTRY_COMPARE_WITH_TIMEOUT(finished.count(), 3, 10000);
    QCOMPARE(ready.count(), 1);
    QVERIFY(finished.back().at(1).toString().contains(QStringLiteral("cancelled")));
    {
        auto closing = std::make_unique<Workspace>(document, &host);
        showWidget(*closing);
        QVERIFY(closing->requestExport({NOVA_AUDIO_WAV_FLOAT32, false, 1}, error));
        QVERIFY(click(*closing, "soundPlay"));
    }
    QCOMPARE(host.opens, 0);
}

void SoundWidgetTest::embeddedLayoutAndCaptures()
{
    Document document;
    QString error;
    QVERIFY(document.create(QStringLiteral("Rally / gravel brake"), 48000, error));
    QVERIFY(document.addPreset(Preset::AirBrake, error));
    sound_test::FakeHost host;
    Workspace workspace(document, &host);
    QAction save(QStringLiteral("Save"), &workspace), import(QStringLiteral("Import WAV"), &workspace), exportAction(QStringLiteral("Export"), &workspace);
    workspace.setHostActions(&save, &import, &exportAction);
    showWidget(workspace);
    QVERIFY(workspace.importWav(sound_test::wav(16000, 32000, 2, 24,
        [](quint32 frame, quint32 channel) {
            const double envelope = std::pow(1.0 - double(frame) / 16000, 1.4);
            return float(.65 * envelope * std::sin(frame * (channel ? .11 : .083)) * (.6 + .4 * std::sin(frame * .0013)));
        }), QStringLiteral("Gravel texture"), error));
    Layer layer = document.state()->layers.back();
    layer.begin = 237; layer.end = 14983; layer.fadeIn = 800; layer.fadeOut = 2600; layer.gain = .45;
    QVERIFY(document.setLayer(layer, document.revision(), error));
    QVERIFY(originalView(workspace));
    workspace.waveform()->setSelection(237, 14983);
    QTRY_VERIFY_WITH_TIMEOUT(workspace.preview() && document.isCurrent(*workspace.preview()->source->snapshot), 10000);
    QDir directory;
    QVERIFY(directory.mkpath(QStringLiteral(NOVA_SOUND_CAPTURE_DIR)));
    for (const auto &entry : std::initializer_list<std::pair<QString, QSize>>{
             {QStringLiteral("sound-component"), {1000, 540}}, {QStringLiteral("sound-component-compact"), {900, 480}}}) {
        workspace.resize(entry.second);
        QApplication::processEvents();
        QCOMPARE(workspace.size(), entry.second);
        for (const char *name : {"soundHostSave", "soundHostImport", "soundHostExport", "soundApply", "soundReset", "soundTrim"}) {
            QWidget *control = workspace.findChild<QWidget *>(QString::fromLatin1(name));
            QVERIFY2(control && control->isVisible() && control->visibleRegion().contains(control->rect().center()), name);
            const QRect inWorkspace(control->mapTo(&workspace, QPoint(0, 0)), control->size());
            QVERIFY2(workspace.rect().contains(inWorkspace), name);
        }
        QVERIFY(workspace.waveform()->width() >= 250);
        QVERIFY(workspace.waveform()->height() >= 130);
        QVERIFY(workspace.grab().save(QStringLiteral(NOVA_SOUND_CAPTURE_DIR) + QLatin1Char('/') + entry.first + QStringLiteral("-light.png")));
        workspace.setDarkTheme(true);
        QVERIFY(workspace.grab().save(QStringLiteral(NOVA_SOUND_CAPTURE_DIR) + QLatin1Char('/') + entry.first + QStringLiteral("-dark.png")));
        workspace.setDarkTheme(false);
    }
    QVERIFY(workspace.minimumSizeHint().width() < 1000 && workspace.minimumSizeHint().height() < 540);
    workspace.hide();
    QMainWindow shell;
    shell.setWindowTitle(QStringLiteral("Nova Sound component - offscreen embedding evidence"));
    auto *embedded = new Workspace(document, &host);
    embedded->setHostActions(&save, &import, &exportAction);
    shell.setCentralWidget(embedded);
    auto *project = new QDockWidget(QStringLiteral("Project"), &shell);
    auto *files = new QListWidget; files->addItems({QStringLiteral("Rally"), QStringLiteral("Scenes"), QStringLiteral("Sprites"),
                                                  QStringLiteral("Models"), QStringLiteral("Sounds"), QStringLiteral("Lua")});
    project->setWidget(files); project->setMinimumWidth(210);
    shell.addDockWidget(Qt::LeftDockWidgetArea, project);
    shell.addToolBar(QStringLiteral("Project tools"))->addActions({&save, &import, &exportAction});
    shell.menuBar()->addMenu(QStringLiteral("File")); shell.menuBar()->addMenu(QStringLiteral("Edit"));
    shell.statusBar()->showMessage(QStringLiteral("QWidget offscreen capture; not compositor/input or audible-device qualification"));
    shell.resize(1280, 720);
    shell.show();
    QApplication::processEvents();
    QTRY_VERIFY_WITH_TIMEOUT(embedded->preview() && document.isCurrent(*embedded->preview()->source->snapshot), 10000);
    QCOMPARE(embedded->waveform()->palette().color(QPalette::Highlight), embedded->palette().color(QPalette::Highlight));
    QCOMPARE(shell.size(), QSize(1280, 720));
    QVERIFY(embedded->width() <= 1070 && embedded->width() >= 900);
    QVERIFY(shell.grab().save(QStringLiteral(NOVA_SOUND_CAPTURE_DIR) + QStringLiteral("/sound-embedded-1280x720.png")));
    QCOMPARE(host.opens, 0);
}

QTEST_MAIN(SoundWidgetTest)
#include "sound_widget_test.moc"
