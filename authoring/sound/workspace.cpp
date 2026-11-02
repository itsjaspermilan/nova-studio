#include "workspace.hpp"
#include "icons.hpp"

#include <QAction>
#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDoubleSpinBox>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMenu>
#include <QPainter>
#include <QProgressBar>
#include <QPushButton>
#include <QScopedValueRollback>
#include <QScrollArea>
#include <QScrollBar>
#include <QSignalBlocker>
#include <QSpinBox>
#include <QSplitter>
#include <QStyle>
#include <QStyledItemDelegate>
#include <QStyleOptionViewItem>
#include <QToolButton>
#include <QVBoxLayout>
#include <algorithm>
#include <cmath>

namespace nova::sound {
namespace {

class ElidedLabel final : public QLabel {
public:
    ElidedLabel() { setTextFormat(Qt::PlainText); setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Fixed); }
    QSize minimumSizeHint() const override { return {0, QLabel::minimumSizeHint().height()}; }
protected:
    void paintEvent(QPaintEvent *) override
    {
        QPainter painter(this);
        style()->drawItemText(&painter, contentsRect(), alignment(), palette(), isEnabled(),
                             fontMetrics().elidedText(text(), Qt::ElideRight, width()), foregroundRole());
    }
};

class LayerDelegate final : public QStyledItemDelegate {
public:
    using QStyledItemDelegate::QStyledItemDelegate;
    void paint(QPainter *painter, const QStyleOptionViewItem &option, const QModelIndex &index) const override
    {
        QStyledItemDelegate::paint(painter, option, index);
        QStyleOptionViewItem value(option);
        initStyleOption(&value, index);
        if (!(value.features & QStyleOptionViewItem::HasCheckIndicator)) return;
        const QStyle *style = value.widget ? value.widget->style() : QApplication::style();
        const QRect check = style->subElementRect(QStyle::SE_ItemViewItemCheckIndicator, &value, value.widget);
        const bool selected = value.state & QStyle::State_Selected;
        const QColor fill = value.palette.color(selected ? QPalette::HighlightedText : QPalette::Highlight);
        const QColor ink = value.palette.color(selected ? QPalette::Highlight : QPalette::HighlightedText);
        painter->save();
        painter->setRenderHint(QPainter::Antialiasing);
        painter->setPen(QPen(value.palette.color(QPalette::Mid), 1));
        painter->setBrush(value.checkState == Qt::Checked ? fill : value.palette.color(QPalette::Base));
        painter->drawRoundedRect(check.adjusted(0, 0, -1, -1), 2, 2);
        if (value.checkState == Qt::Checked) {
            painter->setPen(QPen(ink, 1.8, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));
            const QPointF origin = check.topLeft();
            painter->drawPolyline(QPolygonF{origin + QPointF(3, check.height() * .5),
                origin + QPointF(check.width() * .43, check.height() - 4),
                origin + QPointF(check.width() - 3, 3)});
        }
        painter->restore();
    }
};

QLabel *label(const QString &text, const char *name = "")
{
    auto *widget = new QLabel(text);
    widget->setTextFormat(Qt::PlainText);
    widget->setObjectName(QString::fromLatin1(name));
    return widget;
}

QToolButton *tool(const QString &text, const char *name, const QString &image)
{
    auto *widget = new QToolButton;
    widget->setText(text);
    widget->setObjectName(QString::fromLatin1(name));
    widget->setAccessibleName(text);
    widget->setToolTip(text);
    widget->setProperty("soundIcon", image);
    widget->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
    widget->setMinimumHeight(28);
    return widget;
}

QDoubleSpinBox *number(const char *name, double minimum, double maximum, int decimals, const QString &suffix)
{
    auto *widget = new QDoubleSpinBox;
    widget->setObjectName(QString::fromLatin1(name));
    widget->setRange(minimum, maximum);
    widget->setDecimals(decimals);
    widget->setSuffix(suffix);
    widget->setKeyboardTracking(false);
    widget->setMinimumHeight(26);
    return widget;
}

QSpinBox *frames(const char *name)
{
    auto *widget = new QSpinBox;
    widget->setObjectName(QString::fromLatin1(name));
    widget->setRange(0, 48000 * NOVA_AUDIO_SAMPLE_SECONDS);
    widget->setKeyboardTracking(false);
    widget->setMinimumHeight(26);
    return widget;
}

QWidget *row(std::initializer_list<QWidget *> widgets)
{
    auto *widget = new QWidget;
    auto *layout = new QHBoxLayout(widget);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(5);
    for (QWidget *child : widgets) layout->addWidget(child);
    return widget;
}

QLabel *heading(const QString &text)
{
    auto *widget = label(text, "soundSection");
    QFont font = widget->font(); font.setWeight(QFont::DemiBold); widget->setFont(font);
    return widget;
}

QString sourceName(NovaAudioSource source)
{
    switch (source) {
    case NOVA_AUDIO_SINE: return Workspace::tr("Sine");
    case NOVA_AUDIO_SAW: return Workspace::tr("Saw");
    case NOVA_AUDIO_SQUARE: return Workspace::tr("Square");
    case NOVA_AUDIO_TRIANGLE: return Workspace::tr("Triangle");
    case NOVA_AUDIO_NOISE: return Workspace::tr("Seeded noise");
    case NOVA_AUDIO_SAMPLER: return Workspace::tr("Original-rate sample");
    }
    return {};
}

QString peakText(float peak)
{
    return peak > 0 ? QStringLiteral("%1 dBFS").arg(20 * std::log10(peak), 0, 'f', 1) : QStringLiteral("-inf dBFS");
}

} // namespace

Workspace::Workspace(Document &document, AuditionHost *host, QWidget *parent)
    : QWidget(parent), document_(document)
{
    setObjectName(QStringLiteral("SoundWorkspace"));
    setAccessibleName(tr("Sound effects workspace"));
    if (host) audition_ = std::make_unique<Audition>(document, *host);
    buildUi();
    setDarkTheme(palette().color(QPalette::Window).lightness() < 128);
    previewTimer_.setSingleShot(true);
    previewTimer_.setInterval(160);
    connect(&previewTimer_, &QTimer::timeout, this, &Workspace::startPreview);
    connect(&previewJob_, &RenderJob::finished, this, &Workspace::finishPreview);
    connect(&exportJob_, &RenderJob::finished, this, &Workspace::finishExport);
    connect(&document_, &Document::changed, this, [this] {
        refresh();
        schedulePreview();
    });
    connect(&document_, &Document::persistenceChanged, this, &Workspace::refreshStatus);
    connect(&document_, &Document::historyTrimmed, this, &Workspace::showProblem);
    if (audition_) {
        connect(audition_.get(), &Audition::changed, this, &Workspace::refreshStatus);
        connect(audition_.get(), &Audition::problem, this, &Workspace::showProblem);
    }
    refresh();
    schedulePreview();
}

Workspace::~Workspace()
{
    closing_ = true;
    previewTimer_.stop();
    previewJob_.cancel();
    exportJob_.cancel();
    disconnect(&document_, nullptr, this, nullptr);
    disconnect(&previewJob_, nullptr, this, nullptr);
    disconnect(&exportJob_, nullptr, this, nullptr);
    if (audition_) disconnect(audition_.get(), nullptr, this, nullptr);
    for (QObject *child : findChildren<QObject *>()) disconnect(child, nullptr, this, nullptr);
}

void Workspace::buildUi()
{
    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(10, 8, 10, 7);
    layout->setSpacing(6);
    auto *top = new QHBoxLayout;
    title_ = new ElidedLabel;
    title_->setObjectName(QStringLiteral("soundTitle"));
    QFont titleFont = title_->font(); titleFont.setPointSizeF(std::max(13.0, titleFont.pointSizeF() + 1));
    titleFont.setWeight(QFont::DemiBold); title_->setFont(titleFont);
    saveState_ = label({}, "soundSaveState");
    saveHost_ = tool(tr("Save"), "soundHostSave", {});
    importHost_ = tool(tr("Import WAV"), "soundHostImport", {});
    exportHost_ = tool(tr("Export"), "soundHostExport", {});
    top->addWidget(title_, 1); top->addWidget(saveState_);
    for (auto *button : {saveHost_, importHost_, exportHost_}) { button->hide(); top->addWidget(button); }
    layout->addLayout(top);

    auto *toolbar = new QHBoxLayout;
    play_ = tool(tr("Play"), "soundPlay", QStringLiteral("play"));
    stop_ = tool(tr("Stop"), "soundStop", QStringLiteral("stop"));
    undo_ = tool(tr("Undo"), "soundUndo", QStringLiteral("undo"));
    redo_ = tool(tr("Redo"), "soundRedo", QStringLiteral("redo"));
    auto *settings = tool(tr("Sound settings"), "soundSettings", QStringLiteral("wave"));
    for (auto *button : {play_, stop_, undo_, redo_}) toolbar->addWidget(button);
    profile_ = new ElidedLabel;
    profile_->setObjectName(QStringLiteral("soundProfile"));
    toolbar->addWidget(profile_, 1); toolbar->addWidget(settings);
    layout->addLayout(toolbar);
    connect(play_, &QToolButton::clicked, this, [this] {
        if (!requireApplied() || !audition_) return;
        QString error; if (!audition_->play(error)) showProblem(error);
    });
    connect(stop_, &QToolButton::clicked, this, [this] {
        QString error; if (audition_ && !audition_->stop(error)) showProblem(error);
    });
    connect(undo_, &QToolButton::clicked, this, [this] {
        if (!requireApplied()) return;
        QString error; if (!document_.undo(error)) showProblem(error);
    });
    connect(redo_, &QToolButton::clicked, this, [this] {
        if (!requireApplied()) return;
        QString error; if (!document_.redo(error)) showProblem(error);
    });
    for (const auto &entry : std::initializer_list<std::pair<QToolButton *, QKeySequence>>{
             {undo_, QKeySequence::Undo}, {redo_, QKeySequence::Redo},
             {play_, QKeySequence(Qt::CTRL | Qt::Key_Return)}, {stop_, QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_Return)}}) {
        auto *action = new QAction(this);
        action->setShortcut(entry.second);
        action->setShortcutContext(Qt::WidgetWithChildrenShortcut);
        addAction(action);
        connect(action, &QAction::triggered, entry.first, &QToolButton::click);
    }
    connect(settings, &QToolButton::clicked, this, &Workspace::soundSettings);

    problemLabel_ = label({}, "soundProblem");
    problemLabel_->setWordWrap(true);
    problemLabel_->setTextInteractionFlags(Qt::TextSelectableByMouse);
    problemLabel_->hide();
    layout->addWidget(problemLabel_);
    splitter_ = new QSplitter(Qt::Horizontal);
    splitter_->setObjectName(QStringLiteral("soundPanels"));
    splitter_->setChildrenCollapsible(false);
    layout->addWidget(splitter_, 1);

    auto *browser = new QWidget;
    browser->setObjectName(QStringLiteral("soundBrowser"));
    browser->setMinimumWidth(140);
    auto *browse = new QVBoxLayout(browser);
    browse->setContentsMargins(8, 8, 8, 8); browse->setSpacing(6);
    layerCount_ = heading(tr("Layers"));
    browse->addWidget(layerCount_);
    auto *add = tool(tr("Add"), "soundAdd", QStringLiteral("add"));
    auto *duplicate = tool(tr("Copy"), "soundDuplicate", QStringLiteral("duplicate"));
    auto *remove = tool(tr("Remove"), "soundRemove", QStringLiteral("remove"));
    duplicate->setToolButtonStyle(Qt::ToolButtonIconOnly);
    remove->setToolButtonStyle(Qt::ToolButtonIconOnly);
    auto *menu = new QMenu(add);
    menu->addSection(tr("Editable presets"));
    for (const auto &entry : std::initializer_list<std::pair<QString, Preset>>{
             {tr("Soft confirm"), Preset::Confirm}, {tr("Bright pickup"), Preset::Pickup},
             {tr("Soft impact"), Preset::Impact}, {tr("Rally air brake"), Preset::AirBrake}}) {
        connect(menu->addAction(entry.first), &QAction::triggered, this, [this, preset = entry.second] {
            if (!requireApplied()) return;
            QString error; Id id = 0;
            if (!document_.addPreset(preset, error, &id)) showProblem(error);
            else selectLayer(id);
        });
    }
    menu->addSection(tr("Instrument layer"));
    for (int i = NOVA_AUDIO_SINE; i <= NOVA_AUDIO_NOISE; ++i) {
        connect(menu->addAction(sourceName(NovaAudioSource(i))), &QAction::triggered, this, [this, i] {
            if (!requireApplied()) return;
            QString error; Id id = 0;
            if (!document_.addTone(NovaAudioSource(i), error, &id)) showProblem(error);
            else selectLayer(id);
        });
    }
    add->setMenu(menu); add->setPopupMode(QToolButton::InstantPopup);
    browse->addWidget(row({add, duplicate, remove}));
    layers_ = new QListWidget;
    layers_->setObjectName(QStringLiteral("soundLayers"));
    layers_->setItemDelegate(new LayerDelegate(layers_));
    layers_->setAccessibleName(tr("Sound layers; check to enable, uncheck to mute"));
    layers_->setMinimumHeight(65);
    browse->addWidget(layers_, 2);
    connect(layers_, &QListWidget::currentItemChanged, this, [this](QListWidgetItem *item) {
        if (refreshing_ || !item) return;
        const Id id = item->data(Qt::UserRole).toUInt();
        if (id == layer_) return;
        if (!requireApplied()) { refreshLists(); return; }
        selectLayer(id);
    });
    connect(layers_, &QListWidget::itemChanged, this, [this](QListWidgetItem *item) {
        if (refreshing_) return;
        if (!requireApplied()) { refreshLists(); return; }
        const Layer *existing = findLayer(*document_.state(), item->data(Qt::UserRole).toUInt());
        if (!existing) return;
        Layer changed = *existing;
        changed.enabled = item->checkState() == Qt::Checked;
        QString error;
        if (!document_.setLayer(changed, document_.revision(), error)) { showProblem(error); refreshLists(); }
    });
    connect(duplicate, &QToolButton::clicked, this, [this] {
        if (!requireApplied()) return;
        QString error; Id id = 0;
        if (!document_.duplicate(layer_, error, &id)) showProblem(error);
        else selectLayer(id);
    });
    connect(remove, &QToolButton::clicked, this, [this] {
        if (!requireApplied()) return;
        QString error; if (!document_.removeLayer(layer_, error)) showProblem(error);
    });
    originalCount_ = heading(tr("Original WAVs"));
    browse->addWidget(originalCount_);
    originals_ = new QListWidget;
    originals_->setObjectName(QStringLiteral("soundOriginals"));
    originals_->setAccessibleName(tr("Preserved original WAV sources"));
    originals_->setMinimumHeight(50);
    browse->addWidget(originals_, 1);
    connect(originals_, &QListWidget::currentItemChanged, this, [this](QListWidgetItem *item) {
        if (refreshing_ || !item) return;
        if (!requireApplied()) { refreshLists(); return; }
        selectOriginal(item->data(Qt::UserRole).toUInt());
    });
    addRegion_ = tool(tr("Add region"), "soundAddRegion", QStringLiteral("add"));
    addRegion_->setToolTip(tr("Add the selected original-source frame range as a layer (at most 30 seconds)."));
    removeOriginal_ = tool(tr("Remove unused original"), "soundRemoveOriginal", QStringLiteral("remove"));
    removeOriginal_->setToolButtonStyle(Qt::ToolButtonIconOnly);
    browse->addWidget(row({addRegion_, removeOriginal_}));
    connect(addRegion_, &QToolButton::clicked, this, &Workspace::addSelectedRegion);
    connect(removeOriginal_, &QToolButton::clicked, this, [this] {
        if (!requireApplied()) return;
        QString error; if (!document_.removeMedia(original_, error)) showProblem(error);
    });
    splitter_->addWidget(browser);

    auto *center = new QWidget;
    center->setMinimumWidth(260);
    auto *surface = new QVBoxLayout(center);
    surface->setContentsMargins(8, 7, 8, 5); surface->setSpacing(5);
    auto *waveTools = new QHBoxLayout;
    waveTitle_ = new ElidedLabel;
    waveTitle_->setObjectName(QStringLiteral("soundWaveTitle"));
    waveTools->addWidget(waveTitle_, 1);
    viewMix_ = tool(tr("View mix"), "soundViewMix", QStringLiteral("wave"));
    viewMix_->setCheckable(true);
    waveTools->addWidget(viewMix_);
    connect(viewMix_, &QToolButton::clicked, this, [this](bool mix) { showMix(mix); });
    auto *fit = tool(tr("Fit waveform"), "soundFit", QStringLiteral("fit"));
    auto *zoomIn = tool(tr("Zoom in"), "soundZoomIn", QStringLiteral("zoomIn"));
    auto *zoomOut = tool(tr("Zoom out"), "soundZoomOut", QStringLiteral("zoomOut"));
    for (auto *button : {fit, zoomIn, zoomOut}) { button->setToolButtonStyle(Qt::ToolButtonIconOnly); waveTools->addWidget(button); }
    surface->addLayout(waveTools);
    wave_ = new Waveform;
    surface->addWidget(wave_, 1);
    connect(fit, &QToolButton::clicked, wave_, &Waveform::fit);
    connect(zoomIn, &QToolButton::clicked, this, [this] { wave_->zoom(2); });
    connect(zoomOut, &QToolButton::clicked, this, [this] { wave_->zoom(.5); });
    pan_ = new QScrollBar(Qt::Horizontal);
    pan_->setObjectName(QStringLiteral("soundWavePan"));
    pan_->setAccessibleName(tr("First visible waveform frame"));
    surface->addWidget(pan_);
    connect(pan_, &QScrollBar::valueChanged, this, [this](int value) { wave_->panTo(quint32(value)); });
    connect(wave_, &Waveform::viewChanged, this, [this] {
        const QSignalBlocker blocker(pan_);
        const auto wave = wave_->wave();
        pan_->setRange(0, wave ? int(wave->info().sample.frames - wave_->visibleFrames()) : 0);
        pan_->setPageStep(int(wave_->visibleFrames()));
        pan_->setValue(int(wave_->firstFrame()));
    });
    auto *selection = new QHBoxLayout;
    selection->setSpacing(5);
    auto *from = label(tr("From"));
    auto *to = label(tr("to"));
    selectionBegin_ = frames("soundSelectionBegin");
    selectionEnd_ = frames("soundSelectionEnd");
    selectionBegin_->setAccessibleName(tr("Selection begin, inclusive source frame"));
    selectionEnd_->setAccessibleName(tr("Selection end, exclusive source frame"));
    from->setBuddy(selectionBegin_); to->setBuddy(selectionEnd_);
    selection->addWidget(from); selection->addWidget(selectionBegin_, 1); selection->addWidget(to); selection->addWidget(selectionEnd_, 1);
    auto *zoomSelection = tool(tr("Zoom selection"), "soundZoomSelection", QStringLiteral("zoomIn"));
    zoomSelection->setToolButtonStyle(Qt::ToolButtonIconOnly);
    trim_ = tool(tr("Trim"), "soundTrim", QStringLiteral("trim"));
    selection->addWidget(zoomSelection); selection->addWidget(trim_);
    surface->addLayout(selection);
    connect(zoomSelection, &QToolButton::clicked, wave_, &Waveform::zoomSelection);
    connect(trim_, &QToolButton::clicked, this, &Workspace::trimSelection);
    connect(wave_, &Waveform::selectionChanged, this, &Workspace::updateSelectionFields);
    connect(selectionBegin_, &QSpinBox::editingFinished, this, &Workspace::applySelectionFields);
    connect(selectionEnd_, &QSpinBox::editingFinished, this, &Workspace::applySelectionFields);
    waveHint_ = label({}, "soundWaveHint");
    waveHint_->setWordWrap(true);
    waveHint_->setMinimumHeight(32);
    surface->addWidget(waveHint_);
    splitter_->addWidget(center);

    auto *inspector = new QWidget;
    inspector->setObjectName(QStringLiteral("soundInspector"));
    inspector->setMinimumWidth(230);
    auto *inspect = new QVBoxLayout(inspector);
    inspect->setContentsMargins(8, 8, 8, 8); inspect->setSpacing(5);
    inspect->addWidget(heading(tr("Layer properties")));
    auto *scroll = new QScrollArea;
    scroll->setObjectName(QStringLiteral("soundInspectorScroll"));
    scroll->setWidgetResizable(true); scroll->setFrameShape(QFrame::NoFrame);
    scroll->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    auto *page = new QWidget;
    auto *pageLayout = new QVBoxLayout(page);
    pageLayout->setContentsMargins(0, 0, 2, 0); pageLayout->setSpacing(8);
    emptyInspector_ = label(tr("Select a layer to shape its sound.\n\nPresets are fully editable. Imported originals stay unchanged."), "soundEmptyInspector");
    emptyInspector_->setWordWrap(true);
    pageLayout->addWidget(emptyInspector_);
    inspectorFields_ = new QWidget;
    auto *fields = new QVBoxLayout(inspectorFields_);
    fields->setContentsMargins(0, 0, 0, 0); fields->setSpacing(8);
    auto *common = new QFormLayout;
    common->setFieldGrowthPolicy(QFormLayout::AllNonFixedFieldsGrow);
    common->setHorizontalSpacing(7); common->setVerticalSpacing(6);
    name_ = new QLineEdit; name_->setObjectName(QStringLiteral("soundLayerName")); name_->setMaxLength(96);
    enabled_ = new QCheckBox(tr("Enabled")); enabled_->setObjectName(QStringLiteral("soundEnabled"));
    gain_ = number("soundGain", 0, 4, 3, tr(" x"));
    balance_ = number("soundPan", -1, 1, 2, {});
    balance_->setToolTip(tr("-1 left, 0 center, +1 right. Mono uses equal-power pan; stereo uses balance."));
    start_ = number("soundStartMs", 0, 30000, 3, tr(" ms"));
    lowpass_ = number("soundLowpass", 0, 21600, 1, tr(" Hz"));
    lowpass_->setSpecialValueText(tr("Bypassed"));
    common->addRow(tr("Name"), name_); common->addRow({}, enabled_);
    common->addRow(tr("Start"), start_); common->addRow(tr("Gain"), gain_);
    common->addRow(tr("Pan / balance"), balance_); common->addRow(tr("Low-pass"), lowpass_);
    fields->addLayout(common);
    synthFields_ = new QWidget;
    auto *synth = new QFormLayout(synthFields_);
    synth->setContentsMargins(0, 0, 0, 0);
    synth->setFieldGrowthPolicy(QFormLayout::AllNonFixedFieldsGrow);
    synth->setHorizontalSpacing(7); synth->setVerticalSpacing(6);
    instrument_ = new QComboBox; instrument_->setObjectName(QStringLiteral("soundInstrument"));
    for (int i = NOVA_AUDIO_SINE; i <= NOVA_AUDIO_NOISE; ++i) instrument_->addItem(sourceName(NovaAudioSource(i)), i);
    duration_ = number("soundDurationMs", .042, 30000, 3, tr(" ms"));
    frequency_ = number("soundFrequency", 20, 21600, 2, tr(" Hz"));
    endFrequency_ = number("soundEndFrequency", 20, 21600, 2, tr(" Hz"));
    sweep_ = new QCheckBox(tr("Linear pitch sweep")); sweep_->setObjectName(QStringLiteral("soundSweep"));
    seed_ = new QLineEdit; seed_->setObjectName(QStringLiteral("soundSeed")); seed_->setMaxLength(10);
    attack_ = number("soundAttackMs", .021, 30000, 3, tr(" ms"));
    decay_ = number("soundDecayMs", 0, 30000, 3, tr(" ms"));
    release_ = number("soundReleaseMs", .021, 30000, 3, tr(" ms"));
    sustain_ = number("soundSustain", 0, 100, 1, tr(" %"));
    synth->addRow(tr("Instrument"), instrument_); synth->addRow(tr("Duration"), duration_);
    synth->addRow(tr("Pitch"), frequency_); synth->addRow({}, sweep_); synth->addRow(tr("End pitch"), endFrequency_);
    synth->addRow(tr("Noise seed"), seed_);
    synth->addRow(heading(tr("Amplitude envelope")));
    synth->addRow(tr("Attack"), attack_); synth->addRow(tr("Decay"), decay_);
    synth->addRow(tr("Sustain"), sustain_); synth->addRow(tr("Release"), release_);
    fields->addWidget(synthFields_);
    sampleFields_ = new QWidget;
    auto *sample = new QFormLayout(sampleFields_);
    sample->setContentsMargins(0, 0, 0, 0);
    sample->setFieldGrowthPolicy(QFormLayout::AllNonFixedFieldsGrow);
    sample->setHorizontalSpacing(7); sample->setVerticalSpacing(6);
    begin_ = frames("soundTrimBegin"); end_ = frames("soundTrimEnd");
    fadeIn_ = frames("soundFadeIn"); fadeOut_ = frames("soundFadeOut");
    reverse_ = new QCheckBox(tr("Reverse playback")); reverse_->setObjectName(QStringLiteral("soundReverse"));
    sample->addRow(heading(tr("Original source frames")));
    sample->addRow(tr("Begin (inclusive)"), begin_); sample->addRow(tr("End (exclusive)"), end_);
    sample->addRow(tr("Fade in"), fadeIn_); sample->addRow(tr("Fade out"), fadeOut_);
    sample->addRow({}, reverse_);
    auto *sampleHint = label(tr("Unity-pitch sampler. Fades follow playback direction. Original bytes are never edited."), "soundSampleHint");
    sampleHint->setWordWrap(true); sample->addRow(sampleHint);
    fields->addWidget(sampleFields_);
    timeHint_ = label({}, "soundTimeHint"); timeHint_->setWordWrap(true); fields->addWidget(timeHint_);
    pageLayout->addWidget(inspectorFields_);
    pageLayout->addStretch();
    scroll->setWidget(page);
    inspect->addWidget(scroll, 1);
    pendingLabel_ = label({}, "soundPending");
    pendingLabel_->setWordWrap(true); pendingLabel_->hide();
    inspect->addWidget(pendingLabel_);
    apply_ = new QPushButton(tr("Apply")); apply_->setObjectName(QStringLiteral("soundApply")); apply_->setMinimumHeight(29);
    reset_ = new QPushButton(tr("Reset")); reset_->setObjectName(QStringLiteral("soundReset")); reset_->setMinimumHeight(29);
    inspect->addWidget(row({apply_, reset_}));
    connect(apply_, &QPushButton::clicked, this, &Workspace::applyFields);
    connect(reset_, &QPushButton::clicked, this, &Workspace::resetFields);
    for (QWidget *field : std::initializer_list<QWidget *>{name_, enabled_, gain_, balance_, start_, lowpass_,
         instrument_, duration_, frequency_, endFrequency_, sweep_, seed_, attack_, decay_, sustain_, release_,
         begin_, end_, fadeIn_, fadeOut_, reverse_}) watch(field);
    connect(instrument_, &QComboBox::currentIndexChanged, this, &Workspace::updateFieldVisibility);
    connect(sweep_, &QCheckBox::toggled, this, &Workspace::updateFieldVisibility);
    splitter_->addWidget(inspector);
    splitter_->setStretchFactor(0, 0); splitter_->setStretchFactor(1, 1); splitter_->setStretchFactor(2, 0);
    splitter_->setSizes({168, 540, 270});

    auto *footer = new QHBoxLayout;
    status_ = new ElidedLabel; status_->setObjectName(QStringLiteral("soundStatus")); footer->addWidget(status_, 1);
    cancelExport_ = new QPushButton(tr("Cancel export"));
    cancelExport_->setObjectName(QStringLiteral("soundCancelExport")); cancelExport_->hide();
    footer->addWidget(cancelExport_);
    connect(cancelExport_, &QPushButton::clicked, this, &Workspace::cancelExport);
    meterLabel_ = label(tr("Mix peaks"), "soundMeterLabel"); footer->addWidget(meterLabel_);
    leftMeter_ = new QProgressBar; rightMeter_ = new QProgressBar;
    for (auto *meter : {leftMeter_, rightMeter_}) {
        meter->setRange(0, 1000); meter->setValue(0); meter->setMaximumWidth(110); meter->setMinimumWidth(70);
        meter->setMaximumHeight(18); footer->addWidget(meter);
    }
    leftMeter_->setAccessibleName(tr("Left pre-device sample peak")); rightMeter_->setAccessibleName(tr("Right pre-device sample peak"));
    layout->addLayout(footer);
}

void Workspace::watch(QWidget *field)
{
    const auto changed = [this, field] { markPending(field); };
    if (auto *spin = qobject_cast<QDoubleSpinBox *>(field)) connect(spin, &QDoubleSpinBox::valueChanged, this, changed);
    else if (auto *spin = qobject_cast<QSpinBox *>(field)) connect(spin, &QSpinBox::valueChanged, this, changed);
    else if (auto *combo = qobject_cast<QComboBox *>(field)) connect(combo, &QComboBox::currentIndexChanged, this, changed);
    else if (auto *check = qobject_cast<QCheckBox *>(field)) connect(check, &QCheckBox::toggled, this, changed);
    if (auto *edit = qobject_cast<QLineEdit *>(field)) connect(edit, &QLineEdit::textEdited, this, changed);
    for (auto *edit : field->findChildren<QLineEdit *>()) connect(edit, &QLineEdit::textEdited, this, changed);
}

void Workspace::markPending(QWidget *field)
{
    if (refreshing_) return;
    const bool wasPending = hasPendingEdits();
    edited_.insert(field);
    if (!wasPending) emit pendingEditsChanged(true);
    refreshStatus();
}

void Workspace::showProblem(const QString &message)
{
    problemLabel_->setText(message);
    problemLabel_->setVisible(!message.isEmpty());
    if (!message.isEmpty()) emit problem(message);
}

bool Workspace::requireApplied()
{
    if (!hasPendingEdits()) return true;
    showProblem(tr("Apply or Reset pending properties before changing selection, undoing, saving, importing or playing."));
    return false;
}

SnapshotPtr Workspace::prepareSnapshot(QString &error)
{
    if (hasPendingEdits()) {
        error = tr("Sound has pending fields. Apply or Reset them before preparing a save/export snapshot.");
        showProblem(error);
        return {};
    }
    error.clear();
    return document_.snapshot();
}

void Workspace::refreshLists()
{
    const QScopedValueRollback<bool> guard(refreshing_, true);
    const auto state = document_.state();
    layers_->clear();
    for (const Layer &layer : state->layers) {
        auto *item = new QListWidgetItem(layer.name, layers_);
        item->setData(Qt::UserRole, layer.id);
        item->setFlags(item->flags() | Qt::ItemIsUserCheckable);
        item->setCheckState(layer.enabled ? Qt::Checked : Qt::Unchecked);
        item->setToolTip(tr("%1 | %2 ms | stable ID %3").arg(sourceName(layer.source))
                             .arg(double(layerFrames(*state, layer)) * 1000 / state->rate, 0, 'f', 2).arg(layer.id));
        if (layer.id == layer_) layers_->setCurrentItem(item);
    }
    originals_->clear();
    for (const Media &media : state->media) {
        auto *item = new QListWidgetItem(media.name, originals_);
        item->setData(Qt::UserRole, media.id);
        const auto info = media.data->info();
        item->setToolTip(tr("%1 Hz | %2 channel(s) | %3 bits | %4 s | %5 bytes preserved")
            .arg(info.sample.sample_rate).arg(info.sample.channels).arg(info.bits)
            .arg(double(info.sample.frames) / info.sample.sample_rate, 0, 'f', 3).arg(media.data->wav().size()));
        if (!layer_ && media.id == original_) originals_->setCurrentItem(item);
    }
    layerCount_->setText(tr("Layers  %1 / 8").arg(state->layers.size()));
    originalCount_->setText(tr("Original WAVs  %1 / 8").arg(state->media.size()));
}

void Workspace::refresh()
{
    const auto state = document_.state();
    if (edited_.isEmpty()) {
        if (!findLayer(*state, layer_)) layer_ = 0;
        if (!findMedia(*state, original_)) original_ = 0;
        if (!layer_ && !original_ && !state->layers.empty()) layer_ = state->layers.front().id;
        if (const Layer *layer = findLayer(*state, layer_)) original_ = layer->media;
    }
    refreshLists();
    if (edited_.isEmpty()) refreshFields();
    refreshWave();
    refreshStatus();
}

void Workspace::refreshFields()
{
    const QScopedValueRollback<bool> guard(refreshing_, true);
    const auto state = document_.state();
    const Layer *layer = findLayer(*state, layer_);
    inspectorFields_->setVisible(layer != nullptr);
    emptyInspector_->setVisible(layer == nullptr);
    shownRevision_ = document_.revision();
    if (!layer) return;
    name_->setText(layer->name); enabled_->setChecked(layer->enabled);
    gain_->setValue(layer->gain); balance_->setValue(layer->pan);
    start_->setValue(double(layer->start) * 1000 / state->rate);
    lowpass_->setMaximum(state->rate * .45); lowpass_->setValue(layer->lowpass);
    synthFields_->setVisible(layer->source != NOVA_AUDIO_SAMPLER);
    sampleFields_->setVisible(layer->source == NOVA_AUDIO_SAMPLER);
    if (layer->source == NOVA_AUDIO_SAMPLER) {
        const Media *media = findMedia(*state, layer->media);
        const int maxFrame = int(media->data->info().sample.frames);
        for (auto *control : {begin_, end_, fadeIn_, fadeOut_}) control->setMaximum(maxFrame);
        begin_->setValue(int(layer->begin)); end_->setValue(int(layer->end));
        fadeIn_->setValue(int(layer->fadeIn)); fadeOut_->setValue(int(layer->fadeOut)); reverse_->setChecked(layer->reverse);
    } else {
        instrument_->setCurrentIndex(int(layer->source));
        duration_->setValue(double(layer->duration) * 1000 / state->rate);
        frequency_->setMaximum(state->rate * .45); endFrequency_->setMaximum(state->rate * .45);
        frequency_->setValue(layer->frequency); endFrequency_->setValue(layer->endFrequency);
        sweep_->setChecked(layer->sweep); seed_->setText(QString::number(layer->seed));
        attack_->setValue(double(layer->attack) * 1000 / state->rate);
        decay_->setValue(double(layer->decay) * 1000 / state->rate);
        sustain_->setValue(layer->sustain * 100);
        release_->setValue(double(layer->release) * 1000 / state->rate);
    }
    timeHint_->setText(tr("%1 output frames / %2 ms at %3 Hz.\nADSR and timing use the native sample clock.")
        .arg(layerFrames(*state, *layer)).arg(double(layerFrames(*state, *layer)) * 1000 / state->rate, 0, 'f', 3).arg(state->rate));
    updateFieldVisibility();
}

void Workspace::updateFieldVisibility()
{
    const bool noise = instrument_->currentData().toInt() == NOVA_AUDIO_NOISE;
    auto *form = qobject_cast<QFormLayout *>(synthFields_->layout());
    form->setRowVisible(frequency_, !noise);
    form->setRowVisible(sweep_, !noise);
    form->setRowVisible(endFrequency_, !noise && sweep_->isChecked());
    form->setRowVisible(seed_, noise);
    frequency_->setToolTip(tr("Band-limited oscillator frequency."));
    seed_->setToolTip(tr("Nonzero 32-bit seed; renders are deterministic."));
}

void Workspace::applyFields()
{
    if (edited_.isEmpty()) return;
    if (shownRevision_ != document_.revision()) {
        showProblem(tr("These fields belong to an older document revision. Reset them before applying; your typed values were retained."));
        return;
    }
    const auto state = document_.state();
    const Layer *existing = findLayer(*state, layer_);
    if (!existing) { showProblem(tr("The selected layer no longer exists. Reset pending fields.")); return; }
    for (QWidget *field : edited_) {
        if (auto *spin = qobject_cast<QAbstractSpinBox *>(field)) {
            if (!spin->hasAcceptableInput()) { showProblem(tr("A numeric field is incomplete or outside its allowed range.")); return; }
            spin->interpretText();
        }
    }
    Layer layer = *existing;
    const auto has = [&](QWidget *field) { return edited_.contains(field); };
    const auto outputFrames = [&](QDoubleSpinBox *field) { return quint32(std::llround(field->value() * state->rate / 1000)); };
    if (has(name_)) layer.name = name_->text();
    if (has(enabled_)) layer.enabled = enabled_->isChecked();
    if (has(gain_)) layer.gain = gain_->value();
    if (has(balance_)) layer.pan = balance_->value();
    if (has(start_)) layer.start = outputFrames(start_);
    if (has(lowpass_)) layer.lowpass = lowpass_->value();
    if (layer.source == NOVA_AUDIO_SAMPLER) {
        if (has(begin_)) layer.begin = quint32(begin_->value());
        if (has(end_)) layer.end = quint32(end_->value());
        if (has(fadeIn_)) layer.fadeIn = quint32(fadeIn_->value());
        if (has(fadeOut_)) layer.fadeOut = quint32(fadeOut_->value());
        if (has(reverse_)) layer.reverse = reverse_->isChecked();
    } else {
        if (has(instrument_)) {
            layer.source = NovaAudioSource(instrument_->currentData().toInt());
            if (layer.source == NOVA_AUDIO_NOISE) { layer.frequency = layer.endFrequency = 0; layer.sweep = false; }
            else if (existing->source == NOVA_AUDIO_NOISE) layer.frequency = layer.endFrequency = 440;
        }
        if (has(duration_)) layer.duration = outputFrames(duration_);
        if (has(attack_)) layer.attack = outputFrames(attack_);
        if (has(decay_)) layer.decay = outputFrames(decay_);
        if (has(release_)) layer.release = outputFrames(release_);
        if (has(sustain_)) layer.sustain = sustain_->value() / 100;
        if (layer.source != NOVA_AUDIO_NOISE) {
            if (has(frequency_)) layer.frequency = frequency_->value();
            if (has(endFrequency_)) layer.endFrequency = endFrequency_->value();
            if (has(sweep_)) layer.sweep = sweep_->isChecked();
        } else if (has(seed_)) {
            bool ok = false;
            layer.seed = seed_->text().toUInt(&ok);
            if (!ok || !layer.seed) { showProblem(tr("Noise seed must be an integer from 1 to 4294967295.")); return; }
        }
    }
    QString error;
    if (!document_.setLayer(layer, shownRevision_, error)) { showProblem(error); return; }
    edited_.clear();
    emit pendingEditsChanged(false);
    showProblem({});
    refresh();
}

void Workspace::resetFields()
{
    edited_.clear();
    emit pendingEditsChanged(false);
    showProblem({});
    refresh();
}

void Workspace::selectLayer(Id id)
{
    layer_ = id;
    const Layer *layer = findLayer(*document_.state(), id);
    original_ = layer ? layer->media : 0;
    mixView_ = !original_;
    refresh();
    if (layer && original_) wave_->setSelection(layer->begin, layer->end);
}

void Workspace::selectOriginal(Id id)
{
    layer_ = 0; original_ = id; mixView_ = false;
    refresh();
}

void Workspace::showMix(bool mix) { mixView_ = mix; refreshWave(); }

void Workspace::refreshWave()
{
    const auto state = document_.state();
    const Media *media = findMedia(*state, original_);
    const Layer *layer = findLayer(*state, layer_);
    viewMix_->setEnabled(media != nullptr);
    const QSignalBlocker blocker(viewMix_);
    viewMix_->setChecked(mixView_ || !media);
    viewMix_->setText(mixView_ || !media ? tr("Mix") : tr("Original"));
    viewMix_->setToolTip(media ? tr("Toggle between unchanged original samples and the actual rendered composition.")
                               : tr("Select an imported sample to compare its original waveform."));
    const bool original = media && !mixView_;
    if (original) {
        const bool changed = wave_->wave() != media->data;
        wave_->setWave(media->data);
        if (layer && layer->source == NOVA_AUDIO_SAMPLER) {
            wave_->setRegion(layer->begin, layer->end, layer->fadeIn, layer->fadeOut, layer->reverse);
            if (changed) wave_->setSelection(layer->begin, layer->end);
        } else wave_->setRegion(0, media->data->info().sample.frames, 0, 0, false);
        waveTitle_->setText(tr("Original - %1").arg(media->name));
        waveHint_->setText(tr("Selection uses original source frames [from,to). Hidden trim extents remain intact. Play auditions the whole mix, not this selection."));
    } else {
        wave_->setWave(preview_ ? preview_->waveform : nullptr);
        if (preview_) wave_->setRegion(0, preview_->frames, 0, 0, false);
        const bool current = preview_ && document_.isCurrent(*preview_->source->snapshot);
        waveTitle_->setText(current ? tr("Rendered mix") : preview_ ? tr("Rendered mix - older revision") : tr("Mix waveform"));
        waveHint_->setText(tr("Actual native render, including fades, reverse and one-output-frame sample edge envelopes. Selection here is for inspection; choose Original to trim."));
    }
    trim_->setEnabled(original && layer && layer->source == NOVA_AUDIO_SAMPLER);
    trim_->setToolTip(trim_->isEnabled() ? tr("Trim the layer to this original-source selection. Fades must still fit; undo restores the region.")
                                        : tr("Select a sample layer and view its Original waveform to trim."));
    addRegion_->setEnabled(original);
    removeOriginal_->setEnabled(media && std::none_of(state->layers.begin(), state->layers.end(),
        [&](const Layer &value) { return value.media == media->id; }));
    removeOriginal_->setToolTip(removeOriginal_->isEnabled() ? tr("Remove this unused original from the document; undo retains it.")
                                                           : tr("Remove layers using this original before removing it."));
    updateSelectionFields();
}

void Workspace::updateSelectionFields()
{
    const QSignalBlocker first(selectionBegin_), last(selectionEnd_);
    const auto wave = wave_->wave();
    const int maximum = wave ? int(wave->info().sample.frames) : 0;
    selectionBegin_->setRange(0, std::max(0, maximum - 1));
    selectionEnd_->setRange(maximum ? 1 : 0, maximum);
    selectionBegin_->setValue(int(wave_->selectionBegin()));
    selectionEnd_->setValue(int(wave_->selectionEnd()));
    selectionBegin_->setEnabled(wave != nullptr); selectionEnd_->setEnabled(wave != nullptr);
    const QString units = mixView_ || !findMedia(*document_.state(), original_) ? tr("output frames") : tr("original source frames");
    selectionBegin_->setToolTip(tr("Inclusive begin in %1").arg(units));
    selectionEnd_->setToolTip(tr("Exclusive end in %1").arg(units));
}

void Workspace::applySelectionFields()
{
    if (refreshing_ || !wave_->wave()) return;
    if (!selectionBegin_->hasAcceptableInput() || !selectionEnd_->hasAcceptableInput() ||
        selectionBegin_->value() >= selectionEnd_->value()) {
        showProblem(tr("Selection needs an inclusive begin smaller than its exclusive end."));
        return;
    }
    wave_->setSelection(quint32(selectionBegin_->value()), quint32(selectionEnd_->value()));
}

void Workspace::trimSelection()
{
    if (!requireApplied()) return;
    QString error;
    if (!document_.trim(layer_, wave_->selectionBegin(), wave_->selectionEnd(), error)) showProblem(error);
    else showProblem({});
}

void Workspace::addSelectedRegion()
{
    if (!requireApplied()) return;
    QString error; Id id = 0;
    if (!document_.addSampleRegion(original_, wave_->selectionBegin(), wave_->selectionEnd(), error, &id)) showProblem(error);
    else { showProblem({}); selectLayer(id); }
}

bool Workspace::importWav(const QByteArray &bytes, const QString &name, QString &error)
{
    if (!prepareSnapshot(error)) return false;
    Id layer = 0, original = 0;
    if (!document_.importWav(bytes, name, error, &layer, &original)) { showProblem(error); return false; }
    if (layer) selectLayer(layer);
    else {
        selectOriginal(original);
        const auto info = findMedia(*document_.state(), original)->data->info().sample;
        const quint64 outputFrames = (quint64(info.frames) * document_.state()->rate + info.sample_rate - 1) / info.sample_rate;
        problemLabel_->setText(outputFrames < 2
            ? tr("Original imported intact, but it is too short for this sampler's two-output-frame minimum. No playable layer was generated.")
            : document_.state()->layers.size() == MaxLayers
            ? tr("Original imported intact. All 8 layers are occupied; remove a layer before adding a selected region.")
            : tr("Original imported intact. Select an explicit region of at most 30 seconds, then Add region. No layer or shortened source was generated."));
        problemLabel_->show();
    }
    return true;
}

void Workspace::schedulePreview()
{
    if (closing_) return;
    previewNeeded_ = true;
    if (previewJob_.busy()) previewJob_.cancel();
    if (!preview_ && !document_.state()->layers.empty())
        wave_->setEmptyText(tr("Preparing the native mix waveform...\nNo device is activated."));
    previewTimer_.start();
    refreshStatus();
}

void Workspace::startPreview()
{
    if (!previewNeeded_ || previewJob_.busy() || closing_) return;
    previewNeeded_ = false;
    const auto state = document_.state();
    if (std::none_of(state->layers.begin(), state->layers.end(), [](const Layer &layer) { return layer.enabled; })) {
        wave_->setEmptyText(tr("Add or enable a layer to render a mix.\nImported originals remain available at left."));
        refreshWave(); refreshStatus(); return;
    }
    QString error;
    if (!previewJob_.start(document_.snapshot(), RenderJob::Kind::Export, {NOVA_AUDIO_WAV_FLOAT32, false, 1}, error))
        showProblem(error);
    refreshStatus();
}

void Workspace::finishPreview()
{
    auto result = previewJob_.takeResult();
    if (result.snapshot && document_.isCurrent(*result.snapshot) && result.status == RenderJob::Status::Succeeded)
        preview_ = std::move(result.output);
    else if (result.status == RenderJob::Status::Failed && result.snapshot && document_.isCurrent(*result.snapshot))
        showProblem(result.error);
    refreshWave(); refreshStatus();
    if (previewNeeded_) previewTimer_.start();
}

bool Workspace::requestExport(ExportSettings settings, QString &error)
{
    auto snapshot = prepareSnapshot(error);
    if (!snapshot) return false;
    if (!exportJob_.start(std::move(snapshot), RenderJob::Kind::Export, settings, error)) { showProblem(error); return false; }
    cancelExport_->show();
    refreshStatus();
    return true;
}

void Workspace::cancelExport() { exportJob_.cancel(); }

void Workspace::finishExport()
{
    auto result = exportJob_.takeResult();
    cancelExport_->hide();
    if (result.status == RenderJob::Status::Succeeded && result.snapshot && document_.isCurrent(*result.snapshot)) {
        emit exportReady(result.output);
        emit exportFinished(true, tr("Rendered audio is ready for the host's guarded project transaction; nothing was written."));
    } else {
        QString message;
        if (result.status == RenderJob::Status::Cancelled) message = tr("Export cancelled; no output published.");
        else if (result.snapshot && !document_.isCurrent(*result.snapshot)) message = tr("Export discarded because the source changed; no stale completion was published.");
        else message = result.error;
        showProblem(message);
        emit exportFinished(false, message);
    }
    refreshStatus();
}

void Workspace::refreshStatus()
{
    const auto state = document_.state();
    title_->setText(state->name); title_->setToolTip(state->name);
    saveState_->setText(document_.dirty() ? tr("Unsaved") : document_.derivedStale() ? tr("Source saved / audio stale") : tr("Saved"));
    saveState_->setToolTip(tr("Source-only saves retain previous generated files. Only the host journal can acknowledge a save."));
    profile_->setText(tr("%1 kHz stereo | 30 s SFX").arg(double(state->rate) / 1000, 0, 'g', 4));
    profile_->setToolTip(tr("30-second composition/export. Originals: up to 60 seconds / 16 MiB each, 60 seconds / 32 MiB total. No recording, arrangement, MIDI or mixer yet."));
    undo_->setEnabled(document_.canUndo()); redo_->setEnabled(document_.canRedo());
    undo_->setToolTip(document_.canUndo() ? tr("Undo %1").arg(document_.undoText()) : tr("No sound edit to undo."));
    redo_->setToolTip(document_.canRedo() ? tr("Redo %1").arg(document_.redoText()) : tr("No sound edit to redo."));
    apply_->setEnabled(!edited_.isEmpty()); reset_->setEnabled(!edited_.isEmpty());
    pendingLabel_->setVisible(!edited_.isEmpty());
    pendingLabel_->setText(shownRevision_ == document_.revision() ? tr("Unapplied fields - Apply or Reset")
                                                                       : tr("Document changed - Reset stale fields"));
    play_->setEnabled(audition_ && !audition_->preparing() && audition_->state() != AuditionState::Queued &&
                      audition_->state() != AuditionState::Stopping && audition_->state() != AuditionState::RetirementPending);
    stop_->setEnabled(audition_ && (audition_->ownsHandle() || audition_->preparing()));
    play_->setToolTip(audition_ ? tr("Play the whole composition from the start using the host's Audition role, with a 5 ms fade-in/crossfade. Never plays on selection.")
                              : tr("The embedding host has not provided the native Audition interface."));
    stop_->setToolTip(tr("Stop only this audition, with a 10 ms release. A detached handle is retried rather than forgotten."));
    QString status = audition_ ? audition_->text() : tr("No audition host - waveform/export rendering is device-free");
    if (audition_ && audition_->ownsHandle() && audition_->meters().sample_rate)
        status += tr(" | %1 s rendered").arg(double(audition_->meters().current.position) / audition_->meters().sample_rate, 0, 'f', 3);
    if (exportJob_.busy()) status = tr("Rendering export; editing remains available");
    else if (previewJob_.busy() || previewNeeded_) status = tr("Rendering mix waveform") + QStringLiteral(" | ") + status;
    status_->setText(status);
    const QString availability = tr("Position is rendered score position, not an audible playhead. Software starvation: not applicable to memory scores. Hardware xruns / latency: unavailable.");
    status_->setToolTip(status + QStringLiteral("\n") + availability +
                        (audition_ ? QStringLiteral("\n") + audition_->deviceDetails() : QString()));
    std::array<float, 2> peaks{};
    quint64 over = 0;
    bool meterKnown = false;
    if (audition_ && audition_->ownsHandle()) {
        const auto &meter = audition_->meters();
        peaks = {meter.peak[0], meter.peak[1]}; over = meter.over_frames;
        meterKnown = meter.publication != 0;
        meterLabel_->setText(tr("Audition"));
        meterLabel_->setToolTip(tr("Cumulative pre-device sample peaks. Rendered position: %1 frames at %2 Hz. %3 over-range frames.")
                                   .arg(meter.current.position).arg(meter.sample_rate).arg(over));
    } else {
        if (preview_) { peaks = preview_->peak; over = preview_->overFrames; meterKnown = true; }
        meterLabel_->setText(preview_ ? tr("Mix peaks") : tr("Not rendered"));
        meterLabel_->setToolTip(tr("Native-rendered sample peaks, not true-peak or loudness. %1 over-range frames. No normalization or limiter.").arg(over));
    }
    for (int i = 0; i < 2; ++i) {
        auto *meter = i ? rightMeter_ : leftMeter_;
        const float peak = peaks[size_t(i)];
        meter->setValue(std::min(1000, int(peak * 1000)));
        meter->setFormat((i ? tr("R ") : tr("L ")) + (meterKnown ? peakText(peak) : QStringLiteral("--")));
        meter->setProperty("overRange", peak > 1);
        meter->style()->unpolish(meter); meter->style()->polish(meter);
        meter->setToolTip(tr("%1 linear sample peak; %2 over-range frames. Lower layer/master gain before integer export.")
                              .arg(peak, 0, 'g', 6).arg(over));
    }
}

void Workspace::soundSettings()
{
    if (!requireApplied()) return;
    const auto state = document_.state();
    const Revision revision = document_.revision();
    QDialog dialog(this);
    dialog.setWindowTitle(tr("Sound settings"));
    settingsDialog_ = &dialog;
    emit pendingEditsChanged(true);
    auto *layout = new QVBoxLayout(&dialog);
    auto *form = new QFormLayout;
    auto *name = new QLineEdit(state->name); name->setMaxLength(96);
    name->setObjectName(QStringLiteral("soundDocumentName"));
    auto *rate = new QComboBox;
    rate->addItem(tr("48,000 Hz"), 48000); rate->addItem(tr("44,100 Hz"), 44100);
    rate->setCurrentIndex(state->rate == 48000 ? 0 : 1);
    auto *gain = number("soundMasterGain", 0, 4, 3, tr(" x")); gain->setValue(state->masterGain);
    bool gainEdited = false;
    connect(gain, &QDoubleSpinBox::valueChanged, &dialog, [&] { gainEdited = true; });
    for (auto *edit : gain->findChildren<QLineEdit *>())
        connect(edit, &QLineEdit::textEdited, &dialog, [&] { gainEdited = true; });
    form->addRow(tr("Sound name"), name); form->addRow(tr("Output rate"), rate); form->addRow(tr("Master gain"), gain);
    layout->addLayout(form);
    auto *hint = label(tr("Changing rate preserves source frames and rounds each output-time field to the nearest new frame. No source is resampled or relabeled."));
    hint->setWordWrap(true); hint->setMaximumWidth(360); layout->addWidget(hint);
    auto *errorLabel = label({}, "soundSettingsError"); errorLabel->setWordWrap(true); layout->addWidget(errorLabel);
    auto *buttons = new QDialogButtonBox(QDialogButtonBox::Apply | QDialogButtonBox::Cancel);
    layout->addWidget(buttons);
    connect(buttons->button(QDialogButtonBox::Cancel), &QPushButton::clicked, &dialog, &QDialog::reject);
    connect(buttons->button(QDialogButtonBox::Apply), &QPushButton::clicked, &dialog, [&] {
        QString error;
        if (document_.revision() != revision) {
            errorLabel->setText(tr("The sound document changed while settings were open. Cancel and reopen settings; these values were not applied."));
            return;
        }
        if (!gain->hasAcceptableInput()) { errorLabel->setText(tr("Enter a valid master gain.")); return; }
        gain->interpretText();
        if (document_.setSettings(name->text(), rate->currentData().toUInt(), gainEdited ? gain->value() : state->masterGain, error)) dialog.accept();
        else errorLabel->setText(error);
    });
    dialog.exec();
    settingsDialog_.clear();
    emit pendingEditsChanged(false);
    refresh();
}

void Workspace::setHostActions(QAction *save, QAction *importAudio, QAction *exportAudio)
{
    for (const auto &entry : std::initializer_list<std::pair<QToolButton *, QAction *>>{
             {saveHost_, save}, {importHost_, importAudio}, {exportHost_, exportAudio}}) {
        entry.first->setDefaultAction(entry.second);
        entry.first->setVisible(entry.second != nullptr);
    }
}

void Workspace::setDarkTheme(bool dark)
{
    dark_ = dark;
    QPalette colors = QApplication::palette();
    colors.setColor(QPalette::Window, QColor(dark ? "#20262e" : "#f6f8fa"));
    colors.setColor(QPalette::Base, QColor(dark ? "#171e26" : "#ffffff"));
    colors.setColor(QPalette::AlternateBase, QColor(dark ? "#29333f" : "#eef3f6"));
    colors.setColor(QPalette::Text, QColor(dark ? "#edf2f7" : "#1d2b37"));
    colors.setColor(QPalette::WindowText, colors.color(QPalette::Text));
    colors.setColor(QPalette::Button, colors.color(QPalette::Window));
    colors.setColor(QPalette::ButtonText, colors.color(QPalette::Text));
    colors.setColor(QPalette::Mid, QColor(dark ? "#465364" : "#cfdae4"));
    colors.setColor(QPalette::PlaceholderText, QColor(dark ? "#b3c1cf" : "#566a7b"));
    colors.setColor(QPalette::Highlight, QColor(dark ? "#5fd7c9" : "#087f78"));
    colors.setColor(QPalette::HighlightedText, QColor(dark ? "#102c2a" : "#ffffff"));
    colors.setColor(QPalette::Disabled, QPalette::Text, QColor(dark ? "#8293a5" : "#778794"));
    colors.setColor(QPalette::Disabled, QPalette::ButtonText, colors.color(QPalette::Disabled, QPalette::Text));
    setPalette(colors);
    const QString border = colors.color(QPalette::Mid).name(), panel = colors.color(QPalette::Window).name();
    const QString text = colors.color(QPalette::Text).name(), muted = colors.color(QPalette::PlaceholderText).name();
    const QString base = colors.color(QPalette::Base).name(), accent = colors.color(QPalette::Highlight).name();
    setStyleSheet(QString(
        "QWidget#SoundWorkspace { background: %1; color: %2; }"
        "#SoundWorkspace QToolButton { padding: 3px 6px; border: 1px solid transparent; border-radius: 5px; }"
        "#SoundWorkspace QToolButton:hover { background: %3; border-color: %4; }"
        "#SoundWorkspace QToolButton:checked { background: %3; border-color: %6; }"
        "#SoundWorkspace QToolButton:focus, #SoundWorkspace QPushButton:focus { border: 2px solid %6; }"
        "#SoundWorkspace QPushButton { padding: 4px 10px; border: 1px solid %4; border-radius: 5px; background: %3; }"
        "#SoundWorkspace QPushButton:hover { border-color: %6; }"
        "#SoundWorkspace QLineEdit, #SoundWorkspace QSpinBox, #SoundWorkspace QDoubleSpinBox, #SoundWorkspace QComboBox"
        " { padding: 3px 4px; background: %3; color: %2; border: 1px solid %4; border-radius: 4px; min-height: 20px; }"
        "#SoundWorkspace QLineEdit:focus, #SoundWorkspace QSpinBox:focus, #SoundWorkspace QDoubleSpinBox:focus"
        " { border-color: %6; }"
        "#SoundWorkspace QListWidget { border: 1px solid %4; border-radius: 5px; background: %3; }"
        "#SoundWorkspace QListWidget::item { min-height: 25px; padding: 2px 3px; }"
        "#SoundWorkspace QListWidget::item:selected { background: %6; color: %7; }"
        "#SoundWorkspace QSplitter::handle { background: %4; width: 1px; }"
        "#SoundWorkspace QLabel#soundSection { padding: 1px 0; }"
        "#soundProfile, #soundSaveState, #soundWaveHint, #soundTimeHint, #soundSampleHint, #soundStatus, #soundMeterLabel"
        " { color: %5; font-size: 11px; }"
        "#soundPending { color: %5; font-size: 11px; padding: 3px; }"
        "#soundProblem { color: %2; background: %3; border-left: 3px solid #bc7837; padding: 5px 8px; }"
        "#SoundWorkspace QProgressBar { border: 1px solid %4; border-radius: 3px; background: %3; text-align: center; font-size: 10px; }"
        "#SoundWorkspace QProgressBar::chunk { background: %6; }"
        "#SoundWorkspace QProgressBar[overRange=true]::chunk { background: #d66b65; }")
        .arg(panel, text, base, border, muted, accent, colors.color(QPalette::HighlightedText).name()));
    for (QWidget *child : findChildren<QWidget *>()) child->setPalette(colors);
    for (auto *button : findChildren<QToolButton *>()) {
        const QString name = button->property("soundIcon").toString();
        if (!name.isEmpty()) button->setIcon(icon(name, colors));
    }
    update();
}

bool Workspace::event(QEvent *event)
{
    const bool result = QWidget::event(event);
    if (event->type() == QEvent::ParentChange && !closing_)
        QTimer::singleShot(0, this, [this] { if (!closing_) setDarkTheme(dark_); });
    return result;
}

} // namespace nova::sound
