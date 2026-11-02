#pragma once

#include "canvas.hpp"
#include "preview.hpp"
#include <QPointer>
#include <QWidget>

class QAction;
class QCheckBox;
class QComboBox;
class QLabel;
class QLineEdit;
class QListWidget;
class QPushButton;
class QSpinBox;
class QSplitter;
class QToolBox;
class QToolButton;

namespace nova::sprite {

// Embeds in the host's document tab. The Document must outlive this widget.
class Workspace final : public QWidget {
    Q_OBJECT
public:
    explicit Workspace(Document &document, QWidget *parent = nullptr);
    ~Workspace() override;
    Canvas *canvas() const { return canvas_; }
    AnimationPreview *preview() const { return preview_; }
    QAction *undoAction() const { return undo_; }
    QAction *redoAction() const { return redo_; }
    bool hasPendingEdits() const;
    bool prepareSnapshot(QString &error);
    bool importPng(const QByteArray &bytes, QString &error);
    void setHostActions(QAction *save, QAction *importImage, QAction *exportImages);
    void setDarkTheme(bool dark);
    QSize minimumSizeHint() const override { return {1280, 720}; }
signals:
    void problem(const QString &message);
    void pendingEditsChanged(bool pending);
    void saveRequested();
private:
    void buildUi();
    void refresh();
    void refreshHistory();
    void refreshSelection();
    void refreshPalette();
    void refreshAnimation();
    void refreshTitle();
    void showProblem(const QString &message);
    void markPending();
    bool requireApplied();
    void applyLayer();
    void applyMetadata();
    void applyAnimation(bool create);
    void applyPaletteName();
    void setColor(const QColor &color);
    void resizeDialog(bool scale, bool crop);
    void applySelection(bool transform);
    void selectAnimation(Id id);
    void selectPalette(Id id);
    void addLayer();
    void addFrame(bool duplicate);
    Document &document_;
    Canvas *canvas_ = nullptr;
    AnimationPreview *preview_ = nullptr;
    QAction *undo_ = nullptr, *redo_ = nullptr;
    QSplitter *splitter_ = nullptr;
    QToolBox *inspector_ = nullptr;
    QLabel *title_ = nullptr, *saved_ = nullptr, *status_ = nullptr, *problemLabel_ = nullptr;
    QLabel *dimensions_ = nullptr, *animationMembers_ = nullptr;
    QWidget *problemRow_ = nullptr;
    QListWidget *layers_ = nullptr, *frames_ = nullptr, *swatches_ = nullptr;
    QLineEdit *layerName_ = nullptr, *spriteName_ = nullptr, *paletteName_ = nullptr, *color_ = nullptr;
    QLineEdit *animationName_ = nullptr;
    QCheckBox *visible_ = nullptr, *locked_ = nullptr, *collision_ = nullptr, *loop_ = nullptr;
    QCheckBox *filled_ = nullptr, *onion_ = nullptr;
    QSpinBox *layerOpacity_ = nullptr, *brushSize_ = nullptr, *brushOpacity_ = nullptr, *duration_ = nullptr;
    QSpinBox *onionOpacity_ = nullptr, *pivotX_ = nullptr, *pivotY_ = nullptr;
    QSpinBox *collisionX_ = nullptr, *collisionY_ = nullptr, *collisionW_ = nullptr, *collisionH_ = nullptr;
    QSpinBox *selectionX_ = nullptr, *selectionY_ = nullptr, *selectionW_ = nullptr, *selectionH_ = nullptr;
    QSpinBox *animationFrom_ = nullptr, *animationTo_ = nullptr;
    QComboBox *mode_ = nullptr, *zoom_ = nullptr, *palettes_ = nullptr, *animations_ = nullptr;
    QPushButton *play_ = nullptr, *stop_ = nullptr;
    QToolButton *saveHost_ = nullptr, *importHost_ = nullptr, *exportHost_ = nullptr;
    QToolButton *colorButton_ = nullptr;
    QVector<QToolButton *> tools_;
    Id palette_ = 0, animation_ = 0;
    bool refreshing_ = false, layerPending_ = false, metadataPending_ = false;
    bool animationPending_ = false, palettePending_ = false;
    bool durationPending_ = false;
};

} // namespace nova::sprite
