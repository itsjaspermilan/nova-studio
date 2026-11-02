#include "workspace.hpp"
#include "icons.hpp"

#include <QAbstractButton>
#include <QAction>
#include <QCheckBox>
#include <QColorDialog>
#include <QComboBox>
#include <QDialog>
#include <QDialogButtonBox>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QPainter>
#include <QPushButton>
#include <QScopedValueRollback>
#include <QScrollArea>
#include <QSignalBlocker>
#include <QSpinBox>
#include <QSplitter>
#include <QStyle>
#include <QToolBox>
#include <QToolButton>
#include <QVBoxLayout>
#include <algorithm>

namespace nova::sprite {
namespace {

class ElidedLabel final : public QLabel {
public:
    ElidedLabel() { setTextFormat(Qt::PlainText); setSizePolicy(QSizePolicy::Preferred, QSizePolicy::Fixed); }
    QSize minimumSizeHint() const override { return {0, QLabel::minimumSizeHint().height()}; }
protected:
    void paintEvent(QPaintEvent *) override
    {
        QPainter painter(this);
        style()->drawItemText(&painter, contentsRect(), alignment(), palette(), isEnabled(),
                             fontMetrics().elidedText(text(), Qt::ElideRight, contentsRect().width()), foregroundRole());
    }
};

class CheckBox final : public QCheckBox {
public:
    explicit CheckBox(const QString &text) : QCheckBox(text) { setMinimumHeight(32); }
    QSize sizeHint() const override { return {fontMetrics().horizontalAdvance(text()) + 32, 32}; }
    QSize minimumSizeHint() const override { return sizeHint(); }
protected:
    void paintEvent(QPaintEvent *) override
    {
        QPainter p(this);
        p.setRenderHint(QPainter::Antialiasing);
        QPalette::ColorGroup group = isEnabled() ? QPalette::Active : QPalette::Disabled;
        QRect indicator = QStyle::visualRect(layoutDirection(), rect(), QRect(1, (height() - 18) / 2, 18, 18));
        QColor accent = palette().color(group, QPalette::Highlight);
        p.setPen(QPen(isChecked() ? accent : palette().color(group, QPalette::Mid), 1.5));
        p.setBrush(isChecked() ? accent : palette().color(group, QPalette::Base));
        p.drawRoundedRect(indicator, 4, 4);
        if (isChecked()) {
            p.setPen(QPen(palette().color(group, QPalette::HighlightedText), 2, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));
            QPointF at = indicator.topLeft();
            p.drawPolyline(QPolygonF{at + QPointF(4, 9), at + QPointF(8, 13), at + QPointF(14, 5)});
        }
        p.setPen(palette().color(group, QPalette::Text));
        QRect textRect = QStyle::visualRect(layoutDirection(), rect(), QRect(28, 0, width() - 28, height()));
        p.drawText(textRect, Qt::AlignVCenter | Qt::AlignLeading | Qt::TextShowMnemonic, text());
        if (hasFocus()) {
            p.setBrush(Qt::NoBrush);
            p.setPen(QPen(accent, 1));
            p.drawRoundedRect(rect().adjusted(0, 0, -1, -1), 4, 4);
        }
    }
};

QLabel *label(const QString &text, QWidget *parent = nullptr)
{
    auto *result = new QLabel(text, parent);
    result->setTextFormat(Qt::PlainText);
    return result;
}

QPushButton *button(const QString &text, const char *name, QWidget *parent = nullptr)
{
    auto *result = new QPushButton(text, parent);
    result->setObjectName(name);
    result->setAccessibleName(text);
    result->setMinimumHeight(32);
    return result;
}

QSpinBox *spin(const char *name, int min, int max, const QString &suffix = {})
{
    auto *result = new QSpinBox;
    result->setObjectName(name);
    result->setRange(min, max);
    result->setSuffix(suffix);
    result->setKeyboardTracking(false);
    result->setMinimumHeight(32);
    return result;
}

QLineEdit *text(const char *name)
{
    auto *result = new QLineEdit;
    result->setObjectName(name);
    result->setMaxLength(96);
    result->setMinimumHeight(32);
    return result;
}

QWidget *row(std::initializer_list<QWidget *> widgets)
{
    auto *result = new QWidget;
    auto *layout = new QHBoxLayout(result);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(6);
    for (QWidget *widget : widgets) layout->addWidget(widget);
    return result;
}

QScrollArea *scrollArea(QWidget *widget)
{
    auto *area = new QScrollArea;
    area->setWidget(widget);
    area->setWidgetResizable(true);
    area->setFrameShape(QFrame::NoFrame);
    area->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    return area;
}

void applyChildPalette(QWidget &widget, const QPalette &palette)
{
    // Stylesheet colors alone do not propagate to every custom surface or modal form.
    for (QWidget *child : widget.findChildren<QWidget *>()) {
        child->setPalette(palette);
        child->updateGeometry();
    }
}

QWidget *formPage(QWidget *form, QWidget *footer = nullptr)
{
    auto *page = new QWidget;
    auto *layout = new QVBoxLayout(page);
    layout->setContentsMargins(8, 8, 8, 8);
    layout->setSpacing(8);
    layout->addWidget(scrollArea(form), 1);
    if (footer) layout->addWidget(footer);
    return page;
}

template<typename T>
QString unusedName(const QVector<T> &values, const QString &base)
{
    for (int n = 1; ; ++n) {
        QString candidate = QStringLiteral("%1 %2").arg(base).arg(n);
        bool used = std::any_of(values.begin(), values.end(), [&](const T &value) { return value.name == candidate; });
        if (!used) return candidate;
    }
}

QIcon colorIcon(QColor color)
{
    QPixmap pixmap(32, 32);
    pixmap.fill(Qt::transparent);
    QPainter painter(&pixmap);
    painter.setRenderHint(QPainter::Antialiasing);
    painter.setPen(QPen(QColor("#748b9d"), 1));
    painter.setBrush(color);
    painter.drawRoundedRect(QRectF(1, 1, 30, 30), 5, 5);
    return QIcon(pixmap);
}

} // namespace

Workspace::Workspace(Document &document, QWidget *parent) : QWidget(parent), document_(document)
{
    setObjectName("SpriteWorkspace");
    setAccessibleName(tr("Sprite workspace"));
    setMinimumSize(minimumSizeHint());
    QFont system = font();
    if (system.pointSizeF() < 12) system.setPointSizeF(12);
    setFont(system);
    buildUi();
    setDarkTheme(true);
    connect(&document_, &Document::changed, this, &Workspace::refresh);
    connect(&document_, &Document::dirtyChanged, this, &Workspace::refreshTitle);
    connect(&document_, &Document::historyTrimmed, this, &Workspace::showProblem);
    connect(document_.undoStack(), &QUndoStack::indexChanged, this, &Workspace::refreshHistory);
    connect(canvas_, &Canvas::activeChanged, this, &Workspace::refresh);
    connect(canvas_, &Canvas::selectionChanged, this, &Workspace::refreshSelection);
    connect(canvas_, &Canvas::problem, this, &Workspace::showProblem);
    connect(canvas_, &Canvas::hintChanged, status_, [this](const QString &hint) {
        status_->setText(hint);
        status_->setToolTip(hint);
    });
    connect(canvas_, &Canvas::colorPicked, this, &Workspace::setColor);
    connect(canvas_, &Canvas::saveRequested, this, &Workspace::saveRequested);
    connect(canvas_, &Canvas::viewChanged, this, [this] {
        QSignalBlocker blocker(zoom_);
        zoom_->setCurrentText(tr("%1%").arg(qRound(canvas_->zoom() * 100)));
    });
    connect(preview_, &AnimationPreview::playbackChanged, this, [this](bool playing) {
        play_->setEnabled(!playing);
        stop_->setEnabled(playing);
    });
    refresh();
}

Workspace::~Workspace()
{
    canvas_->cancelGesture();
    preview_->stop();
    // Native QWidget teardown can deliver focus/hide events after the derived destructor.
    disconnect(&document_, nullptr, this, nullptr);
    disconnect(document_.undoStack(), nullptr, this, nullptr);
    for (QObject *child : findChildren<QObject *>()) disconnect(child, nullptr, this, nullptr);
}

void Workspace::buildUi()
{
    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(12, 12, 12, 8);
    layout->setSpacing(8);
    auto *heading = new QHBoxLayout;
    title_ = new ElidedLabel;
    title_->setObjectName("spriteTitle");
    saved_ = label({});
    saved_->setObjectName("spriteSaveState");
    heading->addWidget(title_);
    heading->addWidget(saved_);
    heading->addStretch();
    saveHost_ = new QToolButton;
    importHost_ = new QToolButton;
    exportHost_ = new QToolButton;
    for (auto *host : {saveHost_, importHost_, exportHost_}) {
        host->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
        host->setMinimumHeight(34);
        host->hide();
        heading->addWidget(host);
    }
    undo_ = new QAction(tr("Undo"), this);
    redo_ = new QAction(tr("Redo"), this);
    connect(undo_, &QAction::triggered, this, [this] {
        canvas_->cancelGesture();
        if (requireApplied()) document_.undoStack()->undo();
    });
    connect(redo_, &QAction::triggered, this, [this] {
        canvas_->cancelGesture();
        if (requireApplied()) document_.undoStack()->redo();
    });
    undo_->setObjectName("spriteUndoAction");
    redo_->setObjectName("spriteRedoAction");
    for (QAction *action : {undo_, redo_}) {
        auto *control = new QToolButton;
        control->setDefaultAction(action);
        control->setObjectName(action == undo_ ? "spriteUndo" : "spriteRedo");
        control->setToolButtonStyle(Qt::ToolButtonIconOnly);
        control->setFixedSize(36, 36);
        control->setAccessibleName(action == undo_ ? tr("Undo sprite edit") : tr("Redo sprite edit"));
        heading->addWidget(control);
    }
    layout->addLayout(heading);

    problemRow_ = new QWidget;
    problemRow_->setObjectName("spriteProblemRow");
    auto *problems = new QHBoxLayout(problemRow_);
    problems->setContentsMargins(10, 6, 6, 6);
    problemLabel_ = label({});
    problemLabel_->setObjectName("spriteProblem");
    problemLabel_->setAccessibleName(tr("Sprite edit problem"));
    problemLabel_->setWordWrap(true);
    problemLabel_->setTextInteractionFlags(Qt::TextSelectableByMouse | Qt::TextSelectableByKeyboard);
    problems->addWidget(problemLabel_, 1);
    auto *dismiss = button(tr("Dismiss"), "spriteDismissProblem");
    problems->addWidget(dismiss);
    connect(dismiss, &QPushButton::clicked, problemRow_, &QWidget::hide);
    problemRow_->hide();
    layout->addWidget(problemRow_);

    canvas_ = new Canvas(document_);
    canvas_->setHistoryActions(undo_, redo_);
    preview_ = new AnimationPreview(document_);
    auto *context = new QHBoxLayout;
    auto *toolLabel = label(tr("Pencil"));
    toolLabel->setMinimumWidth(84);
    toolLabel->setObjectName("spriteToolLabel");
    connect(canvas_, &Canvas::activeChanged, toolLabel, [this, toolLabel] {
        toolLabel->setText(toolName(canvas_->tool()));
    });
    context->addWidget(toolLabel);
    colorButton_ = new QToolButton;
    colorButton_->setObjectName("spriteQuickColor");
    colorButton_->setAccessibleName(tr("Choose drawing color"));
    colorButton_->setToolTip(tr("Choose drawing color. Named swatches are in Palette and color."));
    colorButton_->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
    colorButton_->setMinimumHeight(34);
    colorButton_->setIcon(colorIcon(canvas_->toolSettings().color));
    colorButton_->setText(canvas_->toolSettings().color.name());
    context->addWidget(colorButton_);
    connect(colorButton_, &QToolButton::clicked, this, [this] {
        QColor value = QColorDialog::getColor(canvas_->toolSettings().color, this, tr("Drawing color"),
                                              QColorDialog::ShowAlphaChannel);
        if (value.isValid()) setColor(value.toRgb());
    });
    context->addWidget(label(tr("Size")));
    brushSize_ = spin("spriteBrushSize", 1, 64, tr(" px"));
    brushSize_->setAccessibleName(tr("Brush size in pixels"));
    brushSize_->setToolTip(tr("Pencil is always 1 px. Brush, eraser and shape outlines use this size."));
    brushSize_->setFixedWidth(84);
    context->addWidget(brushSize_);
    context->addWidget(label(tr("Opacity")));
    brushOpacity_ = spin("spriteBrushOpacity", 1, 100, "%");
    brushOpacity_->setAccessibleName(tr("Tool opacity"));
    brushOpacity_->setValue(100);
    brushOpacity_->setFixedWidth(84);
    context->addWidget(brushOpacity_);
    filled_ = new CheckBox(tr("Filled shapes"));
    filled_->setObjectName("spriteFilledShapes");
    filled_->setToolTip(tr("Fill rectangles and ellipses. Other drawing tools do not use this setting."));
    context->addWidget(filled_);
    mode_ = new QComboBox;
    mode_->setObjectName("spriteRasterMode");
    mode_->setAccessibleName(tr("Raster workflow"));
    mode_->addItems({tr("Pixel art"), tr("Smooth raster")});
    context->addWidget(mode_);
    context->addStretch();
    auto *grid = new CheckBox(tr("Grid"));
    grid->setObjectName("spriteGrid");
    grid->setChecked(true);
    context->addWidget(grid);
    zoom_ = new QComboBox;
    zoom_->setObjectName("spriteZoom");
    zoom_->setAccessibleName(tr("Canvas zoom"));
    zoom_->setEditable(true);
    zoom_->setInsertPolicy(QComboBox::NoInsert);
    zoom_->addItems({"12.5%", "25%", "50%", "100%", "200%", "400%", "800%", "1600%", "3200%"});
    zoom_->setFixedWidth(100);
    context->addWidget(zoom_);
    auto *fit = button(tr("Fit"), "spriteFit");
    fit->setProperty("spriteIcon", int(Icon::Fit));
    fit->setToolTip(tr("Fit canvas (Home). Space-drag pans; wheel zooms."));
    context->addWidget(fit);
    layout->addLayout(context);
    connect(fit, &QPushButton::clicked, canvas_, &Canvas::fitCanvas);
    connect(grid, &QCheckBox::toggled, canvas_, &Canvas::setGridVisible);
    auto toolSettings = [this] {
        if (refreshing_) return;
        ToolSettings settings = canvas_->toolSettings();
        settings.width = brushSize_->value();
        settings.opacity = qRound(brushOpacity_->value() * 255.0 / 100);
        settings.filled = filled_->isChecked();
        QString error;
        if (!canvas_->setToolSettings(settings, error)) showProblem(error);
    };
    connect(brushSize_, &QSpinBox::valueChanged, this, toolSettings);
    connect(brushOpacity_, &QSpinBox::valueChanged, this, toolSettings);
    connect(filled_, &QCheckBox::toggled, this, toolSettings);
    connect(mode_, &QComboBox::currentIndexChanged, this, [this](int index) {
        if (refreshing_) return;
        if (!requireApplied()) { refresh(); return; }
        const State &s = document_.state();
        QString error;
        if (!document_.setMetadata(s.name, index ? RasterMode::Smooth : RasterMode::Pixel, s.pivot, s.collision, error))
            showProblem(error);
    });
    auto applyZoom = [this] {
        QString value = zoom_->currentText();
        value.remove('%');
        bool ok = false;
        double percent = value.toDouble(&ok);
        if (!ok || percent < 12.5 || percent > 3200) {
            showProblem(tr("Zoom must be 12.5..3200 percent. Pixel art uses crisp fixed zoom steps."));
            return;
        }
        canvas_->setZoom(percent / 100);
    };
    connect(zoom_, &QComboBox::activated, this, applyZoom);
    connect(zoom_->lineEdit(), &QLineEdit::editingFinished, this, applyZoom);

    splitter_ = new QSplitter(Qt::Horizontal);
    splitter_->setObjectName("spriteWorkspaceSplitter");
    splitter_->setChildrenCollapsible(false);
    auto *drawing = new QWidget;
    auto *drawingLayout = new QHBoxLayout(drawing);
    drawingLayout->setContentsMargins(0, 0, 0, 0);
    drawingLayout->setSpacing(8);
    auto *rail = new QWidget;
    auto *railLayout = new QVBoxLayout(rail);
    railLayout->setContentsMargins(2, 0, 2, 0);
    railLayout->setSpacing(5);
    const QStringList keys{"Q", "W", "P", "B", "E", "G", "L", "R", "O", "I"};
    for (int i = 0; i <= int(Tool::Eyedropper); ++i) {
        Tool tool = Tool(i);
        auto *control = new QToolButton;
        control->setObjectName(QStringLiteral("spriteTool%1").arg(i));
        control->setText(toolName(tool));
        control->setAccessibleName(toolName(tool));
        control->setToolTip(tr("%1 (%2 when canvas has focus)").arg(toolName(tool), keys[i]));
        control->setProperty("spriteIcon", i);
        control->setCheckable(true);
        control->setAutoExclusive(true);
        control->setFixedSize(40, 40);
        control->setIconSize({22, 22});
        railLayout->addWidget(control);
        tools_.append(control);
        connect(control, &QToolButton::clicked, this, [this, tool] {
            canvas_->setTool(tool);
            canvas_->setFocus(Qt::ShortcutFocusReason);
        });
    }
    railLayout->addStretch();
    auto *railScroll = scrollArea(rail);
    railScroll->setFixedWidth(56);
    drawingLayout->addWidget(railScroll);
    auto *surface = new QSplitter(Qt::Vertical);
    surface->setObjectName("spriteSurfaceSplitter");
    surface->setChildrenCollapsible(false);
    surface->addWidget(canvas_);
    auto *timeline = new QWidget;
    timeline->setObjectName("spriteTimeline");
    timeline->setMinimumHeight(222);
    auto *timelineLayout = new QHBoxLayout(timeline);
    timelineLayout->setContentsMargins(8, 8, 8, 8);
    auto *timelineMain = new QVBoxLayout;
    timelineMain->setSpacing(6);
    auto *frameCommands = new QHBoxLayout;
    auto *newFrame = button(tr("New"), "spriteNewFrame");
    newFrame->setProperty("spriteIcon", int(Icon::Add));
    auto *duplicate = button(tr("Duplicate"), "spriteDuplicateFrame");
    duplicate->setProperty("spriteIcon", int(Icon::Duplicate));
    auto *earlier = button(tr("Earlier"), "spriteFrameEarlier");
    auto *later = button(tr("Later"), "spriteFrameLater");
    auto *deleteFrame = button(tr("Delete"), "spriteDeleteFrame");
    earlier->setToolTip(tr("Move the selected frame earlier. Named animation membership is retained."));
    later->setToolTip(tr("Move the selected frame later. Named animation membership is retained."));
    for (QPushButton *control : {newFrame, duplicate, earlier, later, deleteFrame})
        frameCommands->addWidget(control);
    frameCommands->addStretch();
    duration_ = spin("spriteFrameDuration", 1, 60000, tr(" ms"));
    duration_->setAccessibleName(tr("Selected frame duration in milliseconds"));
    duration_->setToolTip(tr("Exact duration of the selected frame, not a global frames-per-second setting."));
    duration_->setFixedWidth(108);
    frameCommands->addWidget(duration_);
    timelineMain->addLayout(frameCommands);
    frames_ = new QListWidget;
    frames_->setObjectName("spriteFrames");
    frames_->setAccessibleName(tr("Animation frames"));
    frames_->setViewMode(QListView::IconMode);
    frames_->setMovement(QListView::Static);
    frames_->setFlow(QListView::LeftToRight);
    frames_->setWrapping(false);
    frames_->setIconSize({52, 52});
    frames_->setGridSize({86, 106});
    frames_->setMinimumHeight(120);
    frames_->setMaximumHeight(124);
    timelineMain->addWidget(frames_);
    auto *transport = new QHBoxLayout;
    animations_ = new QComboBox;
    animations_->setObjectName("spriteAnimations");
    animations_->setAccessibleName(tr("Animation playback range"));
    animations_->setMinimumWidth(116);
    animations_->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);
    animations_->setMinimumContentsLength(8);
    transport->addWidget(animations_, 1);
    play_ = button(tr("Preview"), "spritePlayAnimation");
    play_->setProperty("spriteIcon", int(Icon::Play));
    play_->setToolTip(tr("Preview this animation in the editor. This does not start the game."));
    stop_ = button(tr("Stop"), "spriteStopAnimation");
    stop_->setProperty("spriteIcon", int(Icon::Stop));
    stop_->setEnabled(false);
    transport->addWidget(play_);
    transport->addWidget(stop_);
    onion_ = new CheckBox(tr("Onion skin"));
    onion_->setObjectName("spriteOnionSkin");
    onion_->setToolTip(tr("Show previous/next timeline frames in rose/blue behind the current frame."));
    onionOpacity_ = spin("spriteOnionOpacity", 0, 100, "%");
    onionOpacity_->setAccessibleName(tr("Onion-skin opacity"));
    onionOpacity_->setValue(25);
    onionOpacity_->setFixedWidth(78);
    transport->addWidget(onion_);
    transport->addWidget(onionOpacity_);
    timelineMain->addLayout(transport);
    timelineLayout->addLayout(timelineMain, 1);
    preview_->setFixedWidth(152);
    timelineLayout->addWidget(preview_);
    surface->addWidget(timeline);
    surface->setStretchFactor(0, 1);
    surface->setStretchFactor(1, 0);
    surface->setSizes({500, 222});
    drawingLayout->addWidget(surface, 1);
    splitter_->addWidget(drawing);
    connect(newFrame, &QPushButton::clicked, this, [this] { addFrame(false); });
    connect(duplicate, &QPushButton::clicked, this, [this] { addFrame(true); });
    connect(earlier, &QPushButton::clicked, this, [this] {
        if (!requireApplied()) return;
        QString error;
        if (!document_.moveFrame(canvas_->frameId(), document_.frameIndex(canvas_->frameId()) - 1, error)) showProblem(error);
    });
    connect(later, &QPushButton::clicked, this, [this] {
        if (!requireApplied()) return;
        QString error;
        if (!document_.moveFrame(canvas_->frameId(), document_.frameIndex(canvas_->frameId()) + 1, error)) showProblem(error);
    });
    connect(deleteFrame, &QPushButton::clicked, this, [this] {
        if (!requireApplied()) return;
        QString error;
        if (!document_.removeFrame(canvas_->frameId(), error)) showProblem(error);
    });
    connect(duration_, &QSpinBox::editingFinished, this, [this] {
        if (refreshing_) return;
        QString error;
        if (!document_.setDuration(canvas_->frameId(), duration_->value(), error)) {
            showProblem(error);
        } else {
            durationPending_ = false;
            markPending();
        }
    });
    connect(duration_->findChild<QLineEdit *>(), &QLineEdit::textEdited, this, [this] {
        if (!refreshing_) { durationPending_ = true; markPending(); }
    });
    connect(frames_, &QListWidget::currentItemChanged, this, [this](QListWidgetItem *item) {
        if (refreshing_ || !item) return;
        if (durationPending_) { showProblem(tr("Finish editing the frame duration before selecting another frame.")); refresh(); return; }
        canvas_->setFrameId(item->data(Qt::UserRole).toUInt());
    });
    connect(animations_, &QComboBox::currentIndexChanged, this, [this] {
        if (!refreshing_) selectAnimation(animations_->currentData().toUInt());
    });
    connect(play_, &QPushButton::clicked, this, [this] {
        if (requireApplied()) preview_->start();
    });
    connect(stop_, &QPushButton::clicked, preview_, &AnimationPreview::stop);
    auto onionChanged = [this] {
        canvas_->setOnionSkin(onion_->isChecked(), qRound(onionOpacity_->value() * 255.0 / 100));
        onionOpacity_->setEnabled(onion_->isChecked());
    };
    connect(onion_, &QCheckBox::toggled, this, onionChanged);
    connect(onionOpacity_, &QSpinBox::valueChanged, this, onionChanged);
    onionChanged();

    inspector_ = new QToolBox;
    inspector_->setObjectName("spriteInspector");
    inspector_->setAccessibleName(tr("Sprite inspector sections"));
    inspector_->setMinimumWidth(270);
    inspector_->setSizePolicy(QSizePolicy::Preferred, QSizePolicy::Expanding);

    auto *layerForm = new QWidget;
    auto *layerLayout = new QVBoxLayout(layerForm);
    layerLayout->setContentsMargins(0, 0, 0, 0);
    layerLayout->setSpacing(8);
    layers_ = new QListWidget;
    layers_->setObjectName("spriteLayers");
    layers_->setAccessibleName(tr("Layers, topmost first"));
    layers_->setMinimumHeight(128);
    layers_->setMaximumHeight(144);
    layerLayout->addWidget(layers_);
    auto *add = button(tr("Add"), "spriteAddLayer");
    auto *up = button(tr("Raise"), "spriteRaiseLayer");
    auto *down = button(tr("Lower"), "spriteLowerLayer");
    auto *remove = button(tr("Delete"), "spriteDeleteLayer");
    layerLayout->addWidget(row({add, up, down, remove}));
    auto *properties = new QFormLayout;
    layerName_ = text("spriteLayerName");
    visible_ = new CheckBox(tr("Visible"));
    visible_->setObjectName("spriteLayerVisible");
    locked_ = new CheckBox(tr("Locked"));
    locked_->setObjectName("spriteLayerLocked");
    layerOpacity_ = spin("spriteLayerOpacity", 0, 100, "%");
    properties->addRow(tr("Name"), layerName_);
    properties->addRow(row({visible_, locked_}));
    properties->addRow(tr("Opacity"), layerOpacity_);
    layerLayout->addLayout(properties);
    auto *layerHint = label(tr("Every frame shares this layer stack. Hidden and locked layers cannot be painted."));
    layerHint->setWordWrap(true);
    layerLayout->addWidget(layerHint);
    layerLayout->addStretch();
    auto *applyLayer = button(tr("Apply layer"), "spriteApplyLayer");
    applyLayer->setProperty("primary", true);
    auto *resetLayer = button(tr("Reset"), "spriteResetLayer");
    inspector_->addItem(formPage(layerForm, row({applyLayer, resetLayer})), tr("Layers"));
    connect(add, &QPushButton::clicked, this, &Workspace::addLayer);
    connect(up, &QPushButton::clicked, this, [this] {
        if (!requireApplied()) return;
        QString error;
        if (!document_.moveLayer(canvas_->layerId(), document_.layerIndex(canvas_->layerId()) + 1, error)) showProblem(error);
    });
    connect(down, &QPushButton::clicked, this, [this] {
        if (!requireApplied()) return;
        QString error;
        if (!document_.moveLayer(canvas_->layerId(), document_.layerIndex(canvas_->layerId()) - 1, error)) showProblem(error);
    });
    connect(remove, &QPushButton::clicked, this, [this] {
        if (!requireApplied()) return;
        QString error;
        if (!document_.removeLayer(canvas_->layerId(), error)) showProblem(error);
    });
    connect(layers_, &QListWidget::currentItemChanged, this, [this](QListWidgetItem *item) {
        if (refreshing_ || !item) return;
        if (layerPending_) { showProblem(tr("Apply or reset the current layer properties before selecting another layer.")); refresh(); return; }
        canvas_->setLayerId(item->data(Qt::UserRole).toUInt());
    });
    auto layerEdited = [this] { if (!refreshing_) { layerPending_ = true; markPending(); } };
    connect(layerName_, &QLineEdit::textEdited, this, layerEdited);
    connect(visible_, &QCheckBox::toggled, this, layerEdited);
    connect(locked_, &QCheckBox::toggled, this, layerEdited);
    connect(layerOpacity_, &QSpinBox::valueChanged, this, layerEdited);
    connect(layerOpacity_->findChild<QLineEdit *>(), &QLineEdit::textEdited, this, layerEdited);
    connect(applyLayer, &QPushButton::clicked, this, &Workspace::applyLayer);
    connect(resetLayer, &QPushButton::clicked, this, [this] { layerPending_ = false; refresh(); markPending(); });

    auto *spriteForm = new QWidget;
    auto *spriteLayout = new QFormLayout(spriteForm);
    spriteLayout->setContentsMargins(0, 0, 0, 0);
    spriteName_ = text("spriteName");
    dimensions_ = label({});
    spriteLayout->addRow(tr("Name"), spriteName_);
    spriteLayout->addRow(tr("Canvas"), dimensions_);
    auto *resize = button(tr("Resize canvas"), "spriteResizeCanvas");
    auto *scale = button(tr("Scale artwork"), "spriteScaleArtwork");
    auto *crop = button(tr("Crop to selection"), "spriteCropCanvas");
    spriteLayout->addRow(resize);
    spriteLayout->addRow(scale);
    spriteLayout->addRow(crop);
    auto *sizeHint = label(tr("Resize changes the bounds; Scale resamples all artwork. Neither action exports a file."));
    sizeHint->setWordWrap(true);
    spriteLayout->addRow(sizeHint);
    pivotX_ = spin("spritePivotX", 0, MaxDimension, tr(" px"));
    pivotY_ = spin("spritePivotY", 0, MaxDimension, tr(" px"));
    spriteLayout->addRow(tr("Pivot X"), pivotX_);
    spriteLayout->addRow(tr("Pivot Y"), pivotY_);
    collision_ = new CheckBox(tr("Rectangle collision metadata"));
    collision_->setObjectName("spriteCollisionEnabled");
    spriteLayout->addRow(collision_);
    collisionX_ = spin("spriteCollisionX", 0, MaxDimension);
    collisionY_ = spin("spriteCollisionY", 0, MaxDimension);
    collisionW_ = spin("spriteCollisionWidth", 1, MaxDimension);
    collisionH_ = spin("spriteCollisionHeight", 1, MaxDimension);
    spriteLayout->addRow(tr("Bounds X"), collisionX_);
    spriteLayout->addRow(tr("Bounds Y"), collisionY_);
    spriteLayout->addRow(tr("Bounds width"), collisionW_);
    spriteLayout->addRow(tr("Bounds height"), collisionH_);
    auto *runtimeHint = label(tr("Pivot and collision are preserved in source/export. Scene/runtime consumption is not connected yet."));
    runtimeHint->setWordWrap(true);
    spriteLayout->addRow(runtimeHint);
    auto *applySprite = button(tr("Apply sprite"), "spriteApplyMetadata");
    applySprite->setProperty("primary", true);
    auto *resetSprite = button(tr("Reset"), "spriteResetMetadata");
    inspector_->addItem(formPage(spriteForm, row({applySprite, resetSprite})), tr("Sprite and canvas"));
    connect(resize, &QPushButton::clicked, this, [this] { resizeDialog(false, false); });
    connect(scale, &QPushButton::clicked, this, [this] { resizeDialog(true, false); });
    connect(crop, &QPushButton::clicked, this, [this] { resizeDialog(false, true); });
    auto metadataEdited = [this] { if (!refreshing_) { metadataPending_ = true; markPending(); } };
    connect(spriteName_, &QLineEdit::textEdited, this, metadataEdited);
    for (QSpinBox *control : {pivotX_, pivotY_, collisionX_, collisionY_, collisionW_, collisionH_}) {
        connect(control, &QSpinBox::valueChanged, this, metadataEdited);
        connect(control->findChild<QLineEdit *>(), &QLineEdit::textEdited, this, metadataEdited);
    }
    connect(collision_, &QCheckBox::toggled, this, [this, metadataEdited](bool enabled) {
        for (auto *control : {collisionX_, collisionY_, collisionW_, collisionH_}) control->setEnabled(enabled);
        metadataEdited();
    });
    connect(applySprite, &QPushButton::clicked, this, &Workspace::applyMetadata);
    connect(resetSprite, &QPushButton::clicked, this, [this] { metadataPending_ = false; refresh(); markPending(); });

    auto *selectionForm = new QWidget;
    auto *selectionLayout = new QFormLayout(selectionForm);
    selectionLayout->setContentsMargins(0, 0, 0, 0);
    auto *selectionHint = label(tr("Select an area, then move, resize, rotate or flip pixels on the selected layer. Other layers stay unchanged."));
    selectionHint->setWordWrap(true);
    selectionLayout->addRow(selectionHint);
    selectionX_ = spin("spriteSelectionX", 0, MaxDimension);
    selectionY_ = spin("spriteSelectionY", 0, MaxDimension);
    selectionW_ = spin("spriteSelectionWidth", 1, MaxDimension);
    selectionH_ = spin("spriteSelectionHeight", 1, MaxDimension);
    selectionLayout->addRow(tr("X"), selectionX_);
    selectionLayout->addRow(tr("Y"), selectionY_);
    selectionLayout->addRow(tr("Width"), selectionW_);
    selectionLayout->addRow(tr("Height"), selectionH_);
    auto *select = button(tr("Select area"), "spriteSelectArea");
    auto *transform = button(tr("Move / scale selection"), "spriteTransformSelection");
    auto *flipX = button(tr("Flip horizontal"), "spriteFlipHorizontal");
    auto *flipY = button(tr("Flip vertical"), "spriteFlipVertical");
    auto *rotate = button(tr("Rotate 90 degrees"), "spriteRotateSelection");
    auto *copy = button(tr("Copy"), "spriteCopy");
    auto *cut = button(tr("Cut"), "spriteCut");
    auto *paste = button(tr("Paste"), "spritePaste");
    auto *clear = button(tr("Clear selected pixels"), "spriteClearPixels");
    for (auto *control : {select, transform, flipX, flipY, rotate}) selectionLayout->addRow(control);
    selectionLayout->addRow(row({copy, cut, paste}));
    selectionLayout->addRow(clear);
    inspector_->addItem(formPage(selectionForm), tr("Selection and transforms"));
    connect(select, &QPushButton::clicked, this, [this] { applySelection(false); });
    connect(transform, &QPushButton::clicked, this, [this] { applySelection(true); });
    connect(flipX, &QPushButton::clicked, this, [this] {
        QString error;
        if (!canvas_->transformSelection(canvas_->selection(), 0, true, false, error)) showProblem(error);
    });
    connect(flipY, &QPushButton::clicked, this, [this] {
        QString error;
        if (!canvas_->transformSelection(canvas_->selection(), 0, false, true, error)) showProblem(error);
    });
    connect(rotate, &QPushButton::clicked, this, [this] {
        QRect destination(canvas_->selection().topLeft(), canvas_->selection().size().transposed());
        QString error;
        if (!canvas_->transformSelection(destination, 1, false, false, error)) showProblem(error);
    });
    connect(copy, &QPushButton::clicked, canvas_, &Canvas::copySelection);
    connect(cut, &QPushButton::clicked, canvas_, &Canvas::cutSelection);
    connect(paste, &QPushButton::clicked, canvas_, &Canvas::pasteClipboard);
    connect(clear, &QPushButton::clicked, canvas_, &Canvas::deleteSelection);

    auto *paletteForm = new QWidget;
    auto *paletteLayout = new QFormLayout(paletteForm);
    paletteLayout->setContentsMargins(0, 0, 0, 0);
    palettes_ = new QComboBox;
    palettes_->setObjectName("spritePalettes");
    palettes_->setAccessibleName(tr("Named palette"));
    paletteName_ = text("spritePaletteName");
    paletteLayout->addRow(tr("Palette"), palettes_);
    paletteLayout->addRow(tr("Name"), paletteName_);
    auto *addPalette = button(tr("New palette"), "spriteNewPalette");
    auto *removePalette = button(tr("Delete"), "spriteDeletePalette");
    paletteLayout->addRow(row({addPalette, removePalette}));
    swatches_ = new QListWidget;
    swatches_->setObjectName("spritePaletteColors");
    swatches_->setAccessibleName(tr("Palette colors"));
    swatches_->setViewMode(QListView::IconMode);
    swatches_->setMovement(QListView::Static);
    swatches_->setIconSize({32, 32});
    swatches_->setGridSize({50, 50});
    swatches_->setMinimumHeight(166);
    paletteLayout->addRow(swatches_);
    color_ = text("spriteColor");
    color_->setAccessibleName(tr("Drawing color, hexadecimal RGB or ARGB"));
    color_->setPlaceholderText("#RRGGBB or #AARRGGBB");
    color_->setText("#76dfc6");
    paletteLayout->addRow(tr("Draw color"), color_);
    auto *chooseColor = button(tr("Choose color..."), "spriteChooseColor");
    paletteLayout->addRow(chooseColor);
    auto *addColor = button(tr("Add color"), "spriteAddColor");
    auto *removeColor = button(tr("Remove color"), "spriteRemoveColor");
    paletteLayout->addRow(row({addColor, removeColor}));
    auto *applyPalette = button(tr("Apply name"), "spriteApplyPalette");
    auto *resetPalette = button(tr("Reset"), "spriteResetPalette");
    inspector_->addItem(formPage(paletteForm, row({applyPalette, resetPalette})), tr("Palette and color"));
    connect(paletteName_, &QLineEdit::textEdited, this, [this] {
        if (!refreshing_) { palettePending_ = true; markPending(); }
    });
    connect(palettes_, &QComboBox::currentIndexChanged, this, [this] {
        if (!refreshing_) selectPalette(palettes_->currentData().toUInt());
    });
    connect(applyPalette, &QPushButton::clicked, this, &Workspace::applyPaletteName);
    connect(resetPalette, &QPushButton::clicked, this, [this] { palettePending_ = false; refresh(); markPending(); });
    connect(addPalette, &QPushButton::clicked, this, [this] {
        if (!requireApplied()) return;
        QString error;
        Id created = 0;
        Palette palette{0, unusedName(document_.state().palettes, tr("Palette")), {canvas_->toolSettings().color.toRgb()}};
        if (!document_.setPalette(palette, error, &created)) showProblem(error);
        else selectPalette(created);
    });
    connect(removePalette, &QPushButton::clicked, this, [this] {
        if (!requireApplied()) return;
        QString error;
        if (!document_.removePalette(palette_, error)) showProblem(error);
    });
    connect(swatches_, &QListWidget::currentRowChanged, this, [this](int index) {
        if (refreshing_ || index < 0) return;
        for (const Palette &palette : document_.state().palettes)
            if (palette.id == palette_ && index < palette.colors.size()) setColor(palette.colors[index]);
    });
    connect(color_, &QLineEdit::editingFinished, this, [this] {
        QColor value(color_->text());
        if (!value.isValid()) { showProblem(tr("Use a valid #RRGGBB or #AARRGGBB drawing color.")); return; }
        setColor(value.toRgb());
    });
    connect(chooseColor, &QPushButton::clicked, this, [this] {
        QColor value = QColorDialog::getColor(canvas_->toolSettings().color, this, tr("Drawing color"),
                                              QColorDialog::ShowAlphaChannel);
        if (value.isValid()) setColor(value.toRgb());
    });
    connect(addColor, &QPushButton::clicked, this, [this] {
        if (palettePending_) { showProblem(tr("Apply or reset the palette name first.")); return; }
        for (Palette palette : document_.state().palettes) if (palette.id == palette_) {
            palette.colors.append(canvas_->toolSettings().color.toRgb());
            QString error;
            if (!document_.setPalette(palette, error)) showProblem(error);
            break;
        }
    });
    connect(removeColor, &QPushButton::clicked, this, [this] {
        if (palettePending_) { showProblem(tr("Apply or reset the palette name first.")); return; }
        int index = swatches_->currentRow();
        if (index < 0) { showProblem(tr("Select a palette color to remove.")); return; }
        for (Palette palette : document_.state().palettes) if (palette.id == palette_) {
            palette.colors.removeAt(index);
            QString error;
            if (!document_.setPalette(palette, error)) showProblem(error);
            break;
        }
    });

    auto *animationForm = new QWidget;
    auto *animationLayout = new QFormLayout(animationForm);
    animationLayout->setContentsMargins(0, 0, 0, 0);
    auto *animationHint = label(tr("Choose a saved animation below the canvas, or define a named range here. Durations belong to individual frames."));
    animationHint->setWordWrap(true);
    animationLayout->addRow(animationHint);
    animationName_ = text("spriteAnimationName");
    animationFrom_ = spin("spriteAnimationFrom", 1, MaxFrames);
    animationTo_ = spin("spriteAnimationTo", 1, MaxFrames);
    loop_ = new CheckBox(tr("Loop animation"));
    loop_->setObjectName("spriteAnimationLoop");
    animationLayout->addRow(tr("Name"), animationName_);
    animationLayout->addRow(tr("From frame"), animationFrom_);
    animationLayout->addRow(tr("Through frame"), animationTo_);
    animationLayout->addRow(loop_);
    animationMembers_ = label({});
    animationMembers_->setWordWrap(true);
    animationLayout->addRow(animationMembers_);
    auto *newAnimation = button(tr("Create named range"), "spriteNewAnimation");
    auto *deleteAnimation = button(tr("Delete named range"), "spriteDeleteAnimation");
    animationLayout->addRow(newAnimation);
    animationLayout->addRow(deleteAnimation);
    auto *delivery = label(tr("Editor preview uses exact milliseconds, including nonuniform durations. Export retains that timing; native playback integration is still required."));
    delivery->setWordWrap(true);
    animationLayout->addRow(delivery);
    auto *applyAnimation = button(tr("Apply range"), "spriteApplyAnimation");
    auto *resetAnimation = button(tr("Reset"), "spriteResetAnimation");
    inspector_->addItem(formPage(animationForm, row({applyAnimation, resetAnimation})), tr("Named animations"));
    auto animationEdited = [this] { if (!refreshing_) { animationPending_ = true; markPending(); } };
    connect(animationName_, &QLineEdit::textEdited, this, animationEdited);
    connect(animationFrom_, &QSpinBox::valueChanged, this, animationEdited);
    connect(animationTo_, &QSpinBox::valueChanged, this, animationEdited);
    connect(animationFrom_->findChild<QLineEdit *>(), &QLineEdit::textEdited, this, animationEdited);
    connect(animationTo_->findChild<QLineEdit *>(), &QLineEdit::textEdited, this, animationEdited);
    connect(loop_, &QCheckBox::toggled, this, animationEdited);
    connect(newAnimation, &QPushButton::clicked, this, [this] { this->applyAnimation(true); });
    connect(applyAnimation, &QPushButton::clicked, this, [this] { this->applyAnimation(false); });
    connect(resetAnimation, &QPushButton::clicked, this, [this] { animationPending_ = false; refresh(); markPending(); });
    connect(deleteAnimation, &QPushButton::clicked, this, [this] {
        if (!requireApplied()) return;
        QString error;
        if (!document_.removeAnimation(animation_, error)) showProblem(error);
    });
    splitter_->addWidget(inspector_);
    splitter_->setStretchFactor(0, 1);
    splitter_->setStretchFactor(1, 0);
    splitter_->setSizes({990, 306});
    layout->addWidget(splitter_, 1);
    status_ = new ElidedLabel;
    status_->setText(tr("Draw on the canvas. Space-drag pans; Home fits; Escape cancels."));
    status_->setObjectName("spriteStatus");
    status_->setAccessibleName(tr("Sprite editing status"));
    status_->setMinimumHeight(24);
    layout->addWidget(status_);
}

bool Workspace::hasPendingEdits() const
{
    return layerPending_ || metadataPending_ || palettePending_ || animationPending_ || durationPending_;
}

void Workspace::markPending()
{
    refreshTitle();
    refreshHistory();
    emit pendingEditsChanged(hasPendingEdits());
}

void Workspace::refreshHistory()
{
    const QUndoStack *stack = document_.undoStack();
    undo_->setText(stack->undoText().isEmpty() ? tr("Undo") : tr("Undo %1").arg(stack->undoText()));
    redo_->setText(stack->redoText().isEmpty() ? tr("Redo") : tr("Redo %1").arg(stack->redoText()));
    undo_->setEnabled(!hasPendingEdits() && stack->canUndo());
    redo_->setEnabled(!hasPendingEdits() && stack->canRedo());
    for (QAction *action : {undo_, redo_})
        action->setToolTip(hasPendingEdits() ? tr("Apply or reset inspector fields before undo or redo.") :
                           action->isEnabled() ? action->text() : tr("No further sprite history is available."));
}

bool Workspace::prepareSnapshot(QString &error)
{
    if (durationPending_) {
        error = tr("Finish editing the frame duration with Enter before saving, exporting or switching documents.");
        return false;
    }
    if (hasPendingEdits()) {
        error = tr("Apply or reset pending inspector fields before saving, exporting or switching documents.");
        return false;
    }
    if (document_.gestureActive()) {
        error = tr("Finish or cancel the current drawing gesture before saving.");
        return false;
    }
    error.clear();
    return true;
}

bool Workspace::requireApplied()
{
    QString error;
    if (!prepareSnapshot(error)) { showProblem(error); return false; }
    return true;
}

void Workspace::showProblem(const QString &message)
{
    problemLabel_->setText(tr("Attention: %1").arg(message));
    problemRow_->show();
    emit problem(message);
}

void Workspace::refreshTitle()
{
    title_->setText(document_.state().name);
    title_->setToolTip(document_.state().name);
    saved_->setText(hasPendingEdits() ? tr("Inspector changes not applied") :
                    document_.isDirty() ? tr("Unsaved changes") : tr("Saved source"));
}

void Workspace::refresh()
{
    if (refreshing_) return;
    QScopedValueRollback<bool> guard(refreshing_, true);
    const State &s = document_.state();
    refreshTitle();
    refreshHistory();
    int activeLayer = document_.layerIndex(canvas_->layerId()), activeFrame = document_.frameIndex(canvas_->frameId());
    layers_->clear();
    for (int i = int(s.layers.size()) - 1; i >= 0; --i) {
        const Layer &layer = s.layers[i];
        QString suffix = layer.locked ? tr(" [locked]") : QString();
        if (!layer.visible) suffix += tr(" [hidden]");
        auto *item = new QListWidgetItem(layer.name + suffix, layers_);
        item->setData(Qt::UserRole, layer.id);
        item->setToolTip(tr("%1 / %2% opacity").arg(layer.name).arg(qRound(layer.opacity * 100.0 / 255)));
        item->setSizeHint({160, 34});
        if (i == activeLayer) layers_->setCurrentItem(item);
    }
    if (!layerPending_) {
        const Layer &layer = s.layers[activeLayer];
        layerName_->setText(layer.name);
        visible_->setChecked(layer.visible);
        locked_->setChecked(layer.locked);
        layerOpacity_->setValue(qRound(layer.opacity * 100.0 / 255));
    }
    frames_->clear();
    for (int i = 0; i < s.frames.size(); ++i) {
        const Frame &frame = s.frames[i];
        QImage thumbnail = composite(s, frame.id).scaled({52, 52}, Qt::KeepAspectRatio,
            s.mode == RasterMode::Pixel ? Qt::FastTransformation : Qt::SmoothTransformation);
        auto *item = new QListWidgetItem(QIcon(QPixmap::fromImage(thumbnail)),
                                        tr("%1\n%2 ms").arg(i + 1).arg(frame.durationMs), frames_);
        item->setData(Qt::UserRole, frame.id);
        item->setToolTip(tr("Frame %1, stable ID %2, duration %3 ms").arg(i + 1).arg(frame.id).arg(frame.durationMs));
        if (i == activeFrame) frames_->setCurrentItem(item);
    }
    if (!durationPending_) duration_->setValue(s.frames[activeFrame].durationMs);
    frames_->scrollToItem(frames_->currentItem());
    if (!metadataPending_) {
        spriteName_->setText(s.name);
        pivotX_->setValue(s.pivot.x()); pivotY_->setValue(s.pivot.y());
        collision_->setChecked(s.collision.has_value());
        QRect bounds = s.collision.value_or(QRect(QPoint(), s.size));
        collisionX_->setValue(bounds.x()); collisionY_->setValue(bounds.y());
        collisionW_->setValue(bounds.width()); collisionH_->setValue(bounds.height());
        for (auto *control : {collisionX_, collisionY_, collisionW_, collisionH_}) control->setEnabled(s.collision.has_value());
    }
    dimensions_->setText(tr("%1 x %2 px").arg(s.size.width()).arg(s.size.height()));
    mode_->setCurrentIndex(s.mode == RasterMode::Pixel ? 0 : 1);
    Tool tool = canvas_->tool();
    const ToolSettings settings = canvas_->toolSettings();
    for (int i = 0; i < tools_.size(); ++i) tools_[i]->setChecked(i == int(tool));
    brushSize_->setValue(tool == Tool::Pencil ? 1 : settings.width);
    brushOpacity_->setValue(qRound(settings.opacity * 100.0 / 255));
    filled_->setChecked(settings.filled);
    colorButton_->setIcon(colorIcon(settings.color));
    colorButton_->setText(settings.color.name(settings.color.alpha() == 255 ? QColor::HexRgb : QColor::HexArgb));
    brushSize_->setEnabled(tool == Tool::Brush || tool == Tool::Eraser || tool == Tool::Line ||
                           tool == Tool::Rectangle || tool == Tool::Ellipse);
    brushOpacity_->setEnabled(tool != Tool::Select && tool != Tool::Move && tool != Tool::Eyedropper);
    filled_->setEnabled(tool == Tool::Rectangle || tool == Tool::Ellipse);
    auto availability = [this](const char *name, bool enabled, const QString &reason) {
        auto *control = findChild<QPushButton *>(name);
        control->setEnabled(enabled);
        control->setToolTip(enabled ? QString() : reason);
    };
    availability("spriteFrameEarlier", activeFrame > 0, tr("This is already the first frame."));
    availability("spriteFrameLater", activeFrame + 1 < s.frames.size(), tr("This is already the last frame."));
    availability("spriteDeleteFrame", s.frames.size() > 1, tr("Keep at least one frame."));
    availability("spriteDeleteLayer", s.layers.size() > 1, tr("Keep at least one layer."));
    availability("spriteRaiseLayer", activeLayer + 1 < s.layers.size(), tr("This is already the top layer."));
    availability("spriteLowerLayer", activeLayer > 0, tr("This is already the bottom layer."));
    availability("spriteNewFrame", s.frames.size() < MaxFrames, tr("A sprite supports at most 32 frames."));
    availability("spriteDuplicateFrame", s.frames.size() < MaxFrames, tr("A sprite supports at most 32 frames."));
    availability("spriteAddLayer", s.layers.size() < MaxLayers, tr("A sprite supports at most 16 layers."));
    refreshPalette();
    refreshAnimation();
    preview_->setEditingFrame(canvas_->frameId());
}

void Workspace::refreshSelection()
{
    QRect selection = canvas_->selection();
    selectionX_->setValue(selection.x()); selectionY_->setValue(selection.y());
    selectionW_->setValue(std::max(1, selection.width())); selectionH_->setValue(std::max(1, selection.height()));
}

void Workspace::refreshPalette()
{
    QScopedValueRollback<bool> guard(refreshing_, true);
    const auto &all = document_.state().palettes;
    auto found = std::find_if(all.begin(), all.end(), [this](const Palette &p) { return p.id == palette_; });
    if (found == all.end()) { palette_ = all.first().id; found = all.begin(); }
    palettes_->clear();
    for (const Palette &palette : all) {
        palettes_->addItem(palette.name, palette.id);
        if (palette.id == palette_) palettes_->setCurrentIndex(palettes_->count() - 1);
    }
    if (!palettePending_) paletteName_->setText(found->name);
    int selected = swatches_->currentRow();
    swatches_->clear();
    for (const QColor &color : found->colors) {
        auto *item = new QListWidgetItem(colorIcon(color), QString(), swatches_);
        item->setToolTip(color.name(QColor::HexArgb));
        item->setData(Qt::AccessibleTextRole, tr("Color %1").arg(color.name(QColor::HexArgb)));
    }
    if (selected >= 0) swatches_->setCurrentRow(std::min(selected, int(found->colors.size()) - 1));
}

void Workspace::refreshAnimation()
{
    QScopedValueRollback<bool> guard(refreshing_, true);
    const State &s = document_.state();
    auto found = std::find_if(s.animations.begin(), s.animations.end(), [this](const Animation &a) { return a.id == animation_; });
    if (found == s.animations.end()) animation_ = 0;
    animations_->clear();
    animations_->addItem(tr("All frames"), 0u);
    for (const Animation &animation : s.animations) {
        animations_->addItem(animation.name, animation.id);
        if (animation.id == animation_) animations_->setCurrentIndex(animations_->count() - 1);
    }
    if (!animationPending_) {
        QVector<Id> frames = playbackFrames(s, animation_);
        animationName_->setText(animation_ ? found->name : unusedName(s.animations, tr("Animation")));
        animationFrom_->setMaximum(s.frames.size()); animationTo_->setMaximum(s.frames.size());
        animationFrom_->setValue(document_.frameIndex(frames.first()) + 1);
        animationTo_->setValue(document_.frameIndex(frames.last()) + 1);
        loop_->setChecked(animation_ ? found->loop : true);
    }
    QStringList positions;
    for (Id id : playbackFrames(s, animation_)) positions.append(QString::number(document_.frameIndex(id) + 1));
    animationMembers_->setText(tr("Saved playback order: %1.\nApplying a range replaces membership with the inclusive range above.")
                               .arg(positions.join(", ")));
    findChild<QPushButton *>("spriteApplyAnimation")->setEnabled(animation_ != 0);
    findChild<QPushButton *>("spriteDeleteAnimation")->setEnabled(animation_ != 0);
}

void Workspace::applyLayer()
{
    Layer layer = document_.state().layers[document_.layerIndex(canvas_->layerId())];
    layer.name = layerName_->text();
    layer.visible = visible_->isChecked();
    layer.locked = locked_->isChecked();
    if (layerOpacity_->value() != qRound(layer.opacity * 100.0 / 255))
        layer.opacity = qRound(layerOpacity_->value() * 255.0 / 100);
    QString error;
    if (!document_.setLayer(layer, error)) { showProblem(error); return; }
    layerPending_ = false;
    refresh();
    markPending();
}

void Workspace::applyMetadata()
{
    std::optional<QRect> collision;
    if (collision_->isChecked()) collision = QRect(collisionX_->value(), collisionY_->value(), collisionW_->value(), collisionH_->value());
    QString error;
    if (!document_.setMetadata(spriteName_->text(), document_.state().mode, {pivotX_->value(), pivotY_->value()}, collision, error)) {
        showProblem(error);
        return;
    }
    metadataPending_ = false;
    refresh();
    markPending();
}

void Workspace::applyPaletteName()
{
    for (Palette palette : document_.state().palettes) if (palette.id == palette_) {
        palette.name = paletteName_->text();
        QString error;
        if (!document_.setPalette(palette, error)) { showProblem(error); return; }
        palettePending_ = false;
        refresh();
        markPending();
        return;
    }
}

void Workspace::applyAnimation(bool create)
{
    int from = animationFrom_->value() - 1, to = animationTo_->value() - 1;
    if (from > to || to >= document_.state().frames.size()) {
        showProblem(tr("Choose a valid inclusive playback range, from an earlier frame through a later frame."));
        return;
    }
    Animation animation{create ? 0 : animation_, animationName_->text(), {}, loop_->isChecked()};
    for (int i = from; i <= to; ++i) animation.frames.append(document_.state().frames[i].id);
    QString error;
    Id id = 0;
    if (!document_.setAnimation(animation, error, &id)) { showProblem(error); return; }
    animationPending_ = false;
    selectAnimation(id);
    markPending();
}

void Workspace::selectAnimation(Id id)
{
    if (animationPending_) {
        showProblem(tr("Apply or reset the named animation fields before selecting another playback range."));
        refreshAnimation();
        return;
    }
    animation_ = id;
    preview_->setAnimation(id);
    refreshAnimation();
}

void Workspace::selectPalette(Id id)
{
    if (palettePending_) {
        showProblem(tr("Apply or reset the palette name before selecting another palette."));
        refreshPalette();
        return;
    }
    palette_ = id;
    refreshPalette();
}

void Workspace::setColor(const QColor &color)
{
    ToolSettings settings = canvas_->toolSettings();
    settings.color = color.isValid() ? QColor::fromRgba(color.rgba()) : color;
    QString error;
    if (!canvas_->setToolSettings(settings, error)) { showProblem(error); return; }
    color_->setText(color.name(color.alpha() == 255 ? QColor::HexRgb : QColor::HexArgb));
    colorButton_->setIcon(colorIcon(color));
    colorButton_->setText(color_->text());
}

void Workspace::addLayer()
{
    if (!requireApplied()) return;
    QString error;
    Id id = 0;
    if (!document_.addLayer(unusedName(document_.state().layers, tr("Layer")), error, &id)) showProblem(error);
    else canvas_->setLayerId(id);
}

void Workspace::addFrame(bool duplicate)
{
    if (!requireApplied()) return;
    QString error;
    Id id = 0;
    if (!document_.addFrame(canvas_->frameId(), duplicate, error, &id)) showProblem(error);
    else canvas_->setFrameId(id);
}

void Workspace::applySelection(bool transform)
{
    QRect bounds(selectionX_->value(), selectionY_->value(), selectionW_->value(), selectionH_->value());
    QString error;
    bool ok = transform ? canvas_->transformSelection(bounds, 0, false, false, error) : canvas_->setSelection(bounds, error);
    if (!ok) showProblem(error);
}

bool Workspace::importPng(const QByteArray &bytes, QString &error)
{
    if (!prepareSnapshot(error)) return false;
    QImage image;
    if (!decodePng(bytes, image, error)) return false;
    return canvas_->pasteImage(image, error);
}

void Workspace::setHostActions(QAction *save, QAction *importImage, QAction *exportImages)
{
    const QPair<QToolButton *, QAction *> actions[]{{saveHost_, save}, {importHost_, importImage}, {exportHost_, exportImages}};
    for (const auto &action : actions) {
        action.first->setDefaultAction(action.second);
        action.first->setVisible(action.second != nullptr);
    }
}

void Workspace::setDarkTheme(bool dark)
{
    QPalette p = palette();
    QColor background(dark ? "#142131" : "#f1f5f8"), panel(dark ? "#1c2d40" : "#ffffff");
    QColor base(dark ? "#122031" : "#e9eff4"), alternate(dark ? "#25394d" : "#d8e3ec");
    QColor textColor(dark ? "#edf5fb" : "#162c40"), secondary(dark ? "#b9cbda" : "#445c70");
    QColor border(dark ? "#617c93" : "#6c8193"), accent(dark ? "#8ee5cf" : "#006c5a");
    QColor selected(dark ? "#173f42" : "#d2eee6");
    p.setColor(QPalette::Window, background); p.setColor(QPalette::WindowText, textColor);
    p.setColor(QPalette::Base, base); p.setColor(QPalette::AlternateBase, alternate);
    p.setColor(QPalette::Text, textColor); p.setColor(QPalette::Button, panel);
    p.setColor(QPalette::ButtonText, textColor); p.setColor(QPalette::Mid, border);
    p.setColor(QPalette::Highlight, accent); p.setColor(QPalette::HighlightedText, dark ? QColor("#102d2b") : QColor(Qt::white));
    p.setColor(QPalette::PlaceholderText, secondary);
    p.setColor(QPalette::Disabled, QPalette::Text, secondary);
    p.setColor(QPalette::Disabled, QPalette::ButtonText, secondary);
    setPalette(p);
    setAutoFillBackground(true);
    QString style = QStringLiteral(
        "#SpriteWorkspace { background: %1; color: %2; }"
        "#SpriteWorkspace QLabel { color: %2; background: transparent; }"
        "#SpriteWorkspace QLabel#spriteTitle { font-size: 19px; font-weight: 600; }"
        "#SpriteWorkspace QLabel#spriteSaveState, #SpriteWorkspace QLabel#spriteStatus { color: %3; }"
        "#SpriteWorkspace QLineEdit, #SpriteWorkspace QSpinBox, #SpriteWorkspace QComboBox {"
        " background: %4; color: %2; border: 1px solid %5; border-radius: 5px; padding: 5px; min-height: 20px; }"
        "#SpriteWorkspace QLineEdit:focus, #SpriteWorkspace QSpinBox:focus, #SpriteWorkspace QComboBox:focus { border: 2px solid %6; padding: 4px; }"
        "#SpriteWorkspace QPushButton, #SpriteWorkspace QToolButton {"
        " background: %7; color: %2; border: 1px solid %5; border-radius: 5px; padding: 4px 8px; }"
        "#SpriteWorkspace QPushButton:hover, #SpriteWorkspace QToolButton:hover { background: %8; }"
        "#SpriteWorkspace QPushButton:pressed, #SpriteWorkspace QToolButton:pressed { background: %4; }"
        "#SpriteWorkspace QToolButton:checked, #SpriteWorkspace QPushButton[primary=\"true\"] { background: %8; border-color: %6; }"
        "#SpriteWorkspace QPushButton:focus, #SpriteWorkspace QToolButton:focus { border: 2px solid %6; padding: 3px 7px; }"
        "#SpriteWorkspace QPushButton:disabled, #SpriteWorkspace QToolButton:disabled { color: %3; border-color: %7; }"
        "#SpriteWorkspace QListWidget { background: %4; color: %2; border: 1px solid %5; border-radius: 5px; padding: 3px; }"
        "#SpriteWorkspace QListWidget::item { padding: 3px; border-radius: 4px; }"
        "#SpriteWorkspace QListWidget::item:selected { background: %8; color: %2; border: 1px solid %6; }"
        "#SpriteWorkspace QScrollArea, #SpriteWorkspace QToolBox { background: %7; border: none; }"
        "#SpriteWorkspace QToolBox::tab { background: %7; color: %2; border: 1px solid %5; border-radius: 4px; padding: 0px 10px; min-height: 32px; }"
        "#SpriteWorkspace QToolBox::tab:selected { background: %8; border-color: %6; font-weight: 600; }"
        "#SpriteWorkspace QSplitter::handle { background: %1; }"
        "#SpriteWorkspace QCheckBox { color: %2; spacing: 6px; min-height: 28px; }"
        "#SpriteWorkspace QCheckBox:focus { outline: 1px solid %6; }")
        .arg(background.name(), textColor.name(), secondary.name(), base.name(), border.name(),
             accent.name(), panel.name(), selected.name());
    style += QStringLiteral("#SpriteWorkspace #spriteProblemRow { background: %1; border-radius: 5px; }"
                            "#SpriteWorkspace QLabel#spriteProblem { color: %2; }")
        .arg(dark ? "#432e29" : "#ffebe4", dark ? "#ffd0bb" : "#792b15");
    setStyleSheet(style);
    applyChildPalette(*this, p);
    for (auto *control : findChildren<QAbstractButton *>()) {
        QVariant kind = control->property("spriteIcon");
        if (kind.isValid()) control->setIcon(actionIcon(Icon(kind.toInt()), textColor));
    }
    undo_->setIcon(actionIcon(Icon::Undo, textColor));
    redo_->setIcon(actionIcon(Icon::Redo, textColor));
    canvas_->update();
    preview_->update();
    layout()->invalidate();
}

void Workspace::resizeDialog(bool scale, bool crop)
{
    if (!requireApplied()) return;
    if (crop && canvas_->selection().isEmpty()) { showProblem(tr("Select the canvas area to keep before cropping.")); return; }
    const State &state = document_.state();
    QDialog dialog(this);
    dialog.setObjectName("spriteSizeDialog");
    dialog.setPalette(palette());
    dialog.setFont(font());
    dialog.setAutoFillBackground(true);
    dialog.setWindowTitle(scale ? tr("Scale artwork") : crop ? tr("Crop canvas to selection") : tr("Resize canvas"));
    dialog.setMinimumWidth(420);
    auto *layout = new QVBoxLayout(&dialog);
    auto *explanation = label(scale
        ? tr("Resample every layer and frame. Pivot and collision bounds scale with the artwork.")
        : tr("Change canvas bounds without resampling. Cropped pixels are recoverable with Undo. All layers and frames are affected."));
    explanation->setWordWrap(true);
    layout->addWidget(explanation);
    auto *form = new QFormLayout;
    auto *width = spin("spriteSizeWidth", 1, MaxDimension, tr(" px"));
    auto *height = spin("spriteSizeHeight", 1, MaxDimension, tr(" px"));
    auto *offsetX = spin("spriteSizeOffsetX", -MaxDimension, MaxDimension, tr(" px"));
    auto *offsetY = spin("spriteSizeOffsetY", -MaxDimension, MaxDimension, tr(" px"));
    QSize initial = crop ? canvas_->selection().size() : state.size;
    width->setValue(initial.width()); height->setValue(initial.height());
    if (crop) { offsetX->setValue(-canvas_->selection().x()); offsetY->setValue(-canvas_->selection().y()); }
    form->addRow(tr("Width"), width); form->addRow(tr("Height"), height);
    if (!scale) { form->addRow(tr("Artwork offset X"), offsetX); form->addRow(tr("Artwork offset Y"), offsetY); }
    else { offsetX->setParent(&dialog); offsetY->setParent(&dialog); offsetX->hide(); offsetY->hide(); }
    layout->addLayout(form);
    auto *preview = label({});
    preview->setObjectName("spriteResizePreview");
    preview->setFixedSize(360, 200);
    preview->setAccessibleName(tr("Canvas resize or artwork scale preview"));
    layout->addWidget(preview, 0, Qt::AlignHCenter);
    auto *details = label({});
    details->setObjectName("spriteResizeDetails");
    details->setWordWrap(true);
    layout->addWidget(details);
    auto *buttons = new QDialogButtonBox(QDialogButtonBox::Apply | QDialogButtonBox::Cancel);
    auto *apply = buttons->button(QDialogButtonBox::Apply);
    apply->setText(scale ? tr("Scale artwork") : crop ? tr("Crop canvas") : tr("Resize canvas"));
    apply->setObjectName("spriteConfirmSize");
    layout->addWidget(buttons);
    QImage current = composite(state, canvas_->frameId());
    auto updatePreview = [&] {
        QSize size(width->value(), height->value());
        QPoint offset(offsetX->value(), offsetY->value());
        qint64 pixels = qint64(size.width()) * size.height() * state.frames.size() * state.layers.size();
        QString reason;
        if (pixels > MaxCelPixels) reason = tr("The resized layers/frames exceed 16,777,216 cel pixels.");
        else if (!scale && (state.pivot.x() + offset.x() < 0 || state.pivot.y() + offset.y() < 0 ||
                           state.pivot.x() + offset.x() > size.width() || state.pivot.y() + offset.y() > size.height() ||
                           (state.collision && !QRect(QPoint(), size).contains(state.collision->translated(offset)))))
            reason = tr("This crops the pivot or collision bounds. Cancel and adjust metadata first.");
        apply->setEnabled(reason.isEmpty());
        details->setText(reason.isEmpty() ? tr("%1 x %2 px / %3 frames / %4 layers\n%5")
            .arg(size.width()).arg(size.height()).arg(state.frames.size()).arg(state.layers.size())
            .arg(scale ? (state.mode == RasterMode::Pixel ? tr("Nearest-neighbor pixel scaling") : tr("Smooth raster resampling"))
                       : tr("Pixel sizes are unchanged; pixels outside the new bounds are cropped.")) : reason);
        QPixmap image(preview->size() * preview->devicePixelRatioF());
        image.setDevicePixelRatio(preview->devicePixelRatioF());
        image.fill(palette().color(QPalette::Window));
        QPainter p(&image);
        qreal zoom = std::min(320.0 / size.width(), 160.0 / size.height());
        QSizeF extent = QSizeF(size) * zoom;
        QPointF origin((preview->width() - extent.width()) / 2, (preview->height() - extent.height()) / 2);
        QRectF target(origin, extent);
        drawCheckerboard(p, target, 8, palette());
        p.setClipRect(target);
        p.setRenderHint(QPainter::SmoothPixmapTransform, state.mode == RasterMode::Smooth);
        if (scale) p.drawImage(target, current);
        else p.drawImage(QRectF(origin + QPointF(offset) * zoom, QSizeF(state.size) * zoom), current);
        p.setClipping(false);
        State markers = state;
        if (scale) {
            double x = double(size.width()) / state.size.width(), y = double(size.height()) / state.size.height();
            markers.pivot = {qRound(state.pivot.x() * x), qRound(state.pivot.y() * y)};
            if (markers.collision) {
                QRect r = *markers.collision;
                int left = qFloor(r.x() * x), top = qFloor(r.y() * y);
                markers.collision = QRect(left, top, qCeil((r.x() + r.width()) * x) - left, qCeil((r.y() + r.height()) * y) - top);
            }
        } else {
            markers.pivot += offset;
            if (markers.collision) markers.collision->translate(offset);
        }
        drawSpriteMarkers(p, markers, origin, zoom);
        p.end();
        preview->setPixmap(image);
    };
    for (auto *control : {width, height, offsetX, offsetY})
        connect(control, &QSpinBox::valueChanged, &dialog, updatePreview);
    connect(apply, &QPushButton::clicked, &dialog, [&] {
        QString error;
        bool ok = scale ? document_.scaleArtwork({width->value(), height->value()}, error) :
                          document_.resizeCanvas({width->value(), height->value()}, {offsetX->value(), offsetY->value()}, error);
        if (!ok) { details->setText(error); emit problem(error); return; }
        dialog.accept();
    });
    connect(buttons, &QDialogButtonBox::rejected, &dialog, &QDialog::reject);
    applyChildPalette(dialog, palette());
    updatePreview();
    dialog.exec();
}

} // namespace nova::sprite
