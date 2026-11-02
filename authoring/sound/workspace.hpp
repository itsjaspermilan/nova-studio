#pragma once

#include "audition.hpp"
#include "waveform.hpp"
#include <QPointer>
#include <QSet>
#include <QWidget>

class QAction;
class QCheckBox;
class QComboBox;
class QDialog;
class QDoubleSpinBox;
class QLabel;
class QLineEdit;
class QListWidget;
class QProgressBar;
class QPushButton;
class QScrollBar;
class QSpinBox;
class QSplitter;
class QToolButton;

namespace nova::sound {

// Document and optional host outlive the workspace. No file pickers or writes.
class Workspace final : public QWidget {
    Q_OBJECT
public:
    Workspace(Document &document, AuditionHost *host = nullptr, QWidget *parent = nullptr);
    ~Workspace() override;
    Waveform *waveform() const { return wave_; }
    Audition *audition() const { return audition_.get(); }
    bool hasPendingEdits() const { return !edited_.isEmpty() || !settingsDialog_.isNull(); }
    SnapshotPtr prepareSnapshot(QString &error);
    bool importWav(const QByteArray &bytes, const QString &name, QString &error);
    bool requestExport(ExportSettings settings, QString &error);
    void cancelExport();
    ExportPtr preview() const { return preview_; }
    void setHostActions(QAction *save, QAction *importAudio, QAction *exportAudio);
    void setDarkTheme(bool dark);
    QSize minimumSizeHint() const override { return {720, 400}; }
signals:
    void problem(const QString &message);
    void pendingEditsChanged(bool pending);
    void exportReady(nova::sound::ExportPtr output);
    void exportFinished(bool delivered, const QString &message);
protected:
    bool event(QEvent *event) override;
private:
    void buildUi();
    void refresh();
    void refreshLists();
    void refreshFields();
    void refreshWave();
    void refreshStatus();
    void selectLayer(Id id);
    void selectOriginal(Id id);
    void watch(QWidget *field);
    void markPending(QWidget *field);
    bool requireApplied();
    void applyFields();
    void resetFields();
    void updateFieldVisibility();
    void showProblem(const QString &message);
    void soundSettings();
    void schedulePreview();
    void startPreview();
    void finishPreview();
    void finishExport();
    void updateSelectionFields();
    void applySelectionFields();
    void addSelectedRegion();
    void trimSelection();
    void showMix(bool mix);
    Document &document_;
    std::unique_ptr<Audition> audition_;
    RenderJob previewJob_, exportJob_;
    QTimer previewTimer_;
    ExportPtr preview_;
    Id layer_ = 0, original_ = 0;
    Revision shownRevision_;
    QSet<QWidget *> edited_;
    QPointer<QDialog> settingsDialog_;
    bool refreshing_ = false, mixView_ = true, previewNeeded_ = false, closing_ = false, dark_ = false;
    QSplitter *splitter_ = nullptr;
    QListWidget *layers_ = nullptr, *originals_ = nullptr;
    Waveform *wave_ = nullptr;
    QScrollBar *pan_ = nullptr;
    QWidget *inspectorFields_ = nullptr, *synthFields_ = nullptr, *sampleFields_ = nullptr;
    QLabel *title_ = nullptr, *saveState_ = nullptr, *waveTitle_ = nullptr, *waveHint_ = nullptr;
    QLabel *status_ = nullptr, *problemLabel_ = nullptr, *pendingLabel_ = nullptr, *profile_ = nullptr;
    QLabel *layerCount_ = nullptr, *originalCount_ = nullptr, *meterLabel_ = nullptr;
    QLabel *timeHint_ = nullptr, *emptyInspector_ = nullptr;
    QToolButton *saveHost_ = nullptr, *importHost_ = nullptr, *exportHost_ = nullptr, *viewMix_ = nullptr;
    QToolButton *play_ = nullptr, *stop_ = nullptr, *undo_ = nullptr, *redo_ = nullptr;
    QToolButton *trim_ = nullptr, *addRegion_ = nullptr, *removeOriginal_ = nullptr;
    QPushButton *apply_ = nullptr, *reset_ = nullptr, *cancelExport_ = nullptr;
    QLineEdit *name_ = nullptr, *seed_ = nullptr;
    QComboBox *instrument_ = nullptr;
    QCheckBox *enabled_ = nullptr, *sweep_ = nullptr, *reverse_ = nullptr;
    QDoubleSpinBox *start_ = nullptr, *duration_ = nullptr, *gain_ = nullptr, *balance_ = nullptr;
    QDoubleSpinBox *frequency_ = nullptr, *endFrequency_ = nullptr, *attack_ = nullptr;
    QDoubleSpinBox *decay_ = nullptr, *release_ = nullptr, *sustain_ = nullptr, *lowpass_ = nullptr;
    QSpinBox *begin_ = nullptr, *end_ = nullptr, *fadeIn_ = nullptr, *fadeOut_ = nullptr;
    QSpinBox *selectionBegin_ = nullptr, *selectionEnd_ = nullptr;
    QProgressBar *leftMeter_ = nullptr, *rightMeter_ = nullptr;
};

} // namespace nova::sound
