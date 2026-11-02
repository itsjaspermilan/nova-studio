#include "studio_window.h"
#include "code_editor.h"
#include "native_viewport.h"
#include "studio_style.h"
#include <QAction>
#include <QApplication>
#include <QCheckBox>
#include <QCloseEvent>
#include <QColorDialog>
#include <QComboBox>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDir>
#include <QDockWidget>
#include <QDoubleSpinBox>
#include <QFileDialog>
#include <QFileInfo>
#include <QFormLayout>
#include <QGroupBox>
#include <QInputDialog>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMenuBar>
#include <QMessageBox>
#include <QProcess>
#include <QPushButton>
#include <QRegularExpression>
#include <QScrollArea>
#include <QSettings>
#include <QSignalBlocker>
#include <QSplitter>
#include <QStackedWidget>
#include <QStatusBar>
#include <QStyle>
#include <QStyleHints>
#include <QTabWidget>
#include <QTextBrowser>
#include <QToolBar>
#include <QTreeWidget>
#include <QUuid>
#include <QVBoxLayout>
#include <cmath>
#include <cstring>

namespace {
QDoubleSpinBox *numberField(const QString &name, double minimum, double maximum, QWidget *parent)
{
    auto *field = new QDoubleSpinBox(parent);
    field->setObjectName(name);
    field->setAccessibleName(name);
    field->setRange(minimum, maximum);
    field->setDecimals(3);
    field->setKeyboardTracking(false);
    field->setSingleStep(minimum < 0 ? 1 : .1);
    return field;
}

QDockWidget *dock(QMainWindow *window, const QString &name, const QString &title, QWidget *contents, Qt::DockWidgetArea area)
{
    auto *dock = new QDockWidget(title, window);
    dock->setObjectName(name);
    dock->setWidget(contents);
    window->addDockWidget(area, dock);
    return dock;
}

bool flat(const NovaSceneObject &object)
{
    return object.type == NOVA_RECTANGLE || object.type == NOVA_SPRITE;
}

void copyString(char *destination, size_t capacity, const QString &text)
{
    const QByteArray bytes = text.toUtf8();
    if (size_t(bytes.size()) < capacity) std::memcpy(destination, bytes.constData(), size_t(bytes.size()) + 1);
}
}

StudioWindow::StudioWindow(QString examples, bool persistWorkspace, DialogSetup dialogSetup, QWidget *parent)
    : QMainWindow(parent), examples_(std::move(examples)), dialogSetup_(std::move(dialogSetup)), persist_(persistWorkspace),
      viewport_(new NativeViewport(this)), code_(new CodeEditor(this))
{
    setObjectName("novaStudioWindow");
    setWindowTitle(tr("Nova Studio"));
    resize(1360, 860);
    setMinimumSize(1100, 740);
    auto *file = menuBar()->addMenu(tr("&File"));
    auto *edit = menuBar()->addMenu(tr("&Edit"));
    auto *view = menuBar()->addMenu(tr("&View"));
    auto *sceneMenu = menuBar()->addMenu(tr("&Scene"));
    auto *runMenu = menuBar()->addMenu(tr("&Run"));
    auto *help = menuBar()->addMenu(tr("&Help"));
    auto *global = addToolBar(tr("Application"));
    global->setObjectName("applicationToolbar");
    global->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
    global->setIconSize(QSize(20, 20));
    global->setMovable(false);
    const auto action = [this](const QString &name, const QString &text, const QKeySequence &shortcut) {
        auto *result = new QAction(studioIcon(name, palette()), text, this);
        result->setObjectName(name);
        result->setProperty("studioIcon", true);
        if (!shortcut.isEmpty()) result->setShortcut(shortcut);
        result->setToolTip(text + (shortcut.isEmpty() ? QString() : " (" + shortcut.toString(QKeySequence::NativeText) + ")"));
        return result;
    };
    auto *newAction = action("newProject", tr("New project..."), QKeySequence::New);
    auto *openAction = action("openProject", tr("Open project..."), QKeySequence::Open);
    save_ = action("saveProject", tr("Save project"), QKeySequence::Save);
    connect(newAction, &QAction::triggered, this, &StudioWindow::newProject);
    connect(openAction, &QAction::triggered, this, &StudioWindow::chooseProject);
    connect(save_, &QAction::triggered, this, &StudioWindow::saveProject);
    for (auto *a : {newAction, openAction, save_}) { file->addAction(a); global->addAction(a); }
    file->addSeparator();
    file->addAction(tr("Review recovery..."), this, &StudioWindow::reviewRecovery);
    file->addAction(tr("Compare with disk..."), this, &StudioWindow::compareDisk);
    file->addAction(tr("Save separate recovery copy..."), this, [this] {
        if (!document_.isOpen()) return;
        auto *dialog = fileDialog(this, tr("Save draft recovery to a new file"), document_.root(),
            tr("Nova recovery snapshots (*.json)"), "saveRecoveryCopyDialog");
        dialog->setAcceptMode(QFileDialog::AcceptSave);
        dialog->setDefaultSuffix("json");
        dialog->selectFile("nova-recovery.json");
        connect(dialog, &QDialog::accepted, this, [this, dialog] {
            if (dialog->selectedFiles().isEmpty()) return;
            QString error;
            if (!document_.saveRecoveryCopy(dialog->selectedFiles().front(), &error)) report(error);
            else statusBar()->showMessage(tr("Separate draft recovery copy saved; project files are unchanged."), 6000);
        });
        dialog->open();
    });
    file->addAction(tr("Reopen from disk..."), this, [this] {
        if (document_.isOpen() && leaveProject()) openProject(document_.path());
    });
    auto *recent = file->addMenu(tr("Recent projects"));
    if (persist_) {
        for (const auto &path : QSettings().value("recentProjects").toStringList())
            recent->addAction(QDir::toNativeSeparators(path), this, [this, path] {
                if (leaveProject()) openProject(path);
            });
    }
    file->addSeparator();
    file->addAction(tr("Open legacy Objects / Rooms editor..."), this, [this] {
        QString binary = QDir(QApplication::applicationDirPath()).filePath("nova_editor");
#ifdef Q_OS_MACOS
        if (!QFileInfo::exists(binary)) binary = QDir(QApplication::applicationDirPath()).filePath("../../../nova_editor");
#endif
        if (!QProcess::startDetached(binary, {}))
            report(tr("The compatibility editor could not be started. Build nova_editor alongside this development app."));
    });
    file->addAction(tr("Quit"), QKeySequence::Quit, this, &QWidget::close);
    auto *undo = document_.undoStack()->createUndoAction(this, tr("Undo"));
    auto *redo = document_.undoStack()->createRedoAction(this, tr("Redo"));
    undo->setShortcut(QKeySequence::Undo); redo->setShortcut(QKeySequence::Redo);
    undo->setObjectName("undo"); redo->setObjectName("redo");
    undo->setIconText(tr("Undo")); redo->setIconText(tr("Redo"));
    undo->setProperty("studioIcon", true); redo->setProperty("studioIcon", true);
    edit->addAction(undo); edit->addAction(redo);
    global->addSeparator(); global->addAction(undo); global->addAction(redo);
    edit->addAction(tr("Find in Lua..."), QKeySequence::Find, this, [this] { showCode(); code_->findText(); });
    complete_ = new QAction(tr("Complete Lua identifier"), code_);
    complete_->setObjectName("completeLua");
    complete_->setShortcut(CodeEditor::completionShortcut());
    complete_->setShortcutContext(Qt::WidgetWithChildrenShortcut);
    code_->addAction(complete_);
    edit->addAction(complete_);
    connect(complete_, &QAction::triggered, this, [this] { showCode(); code_->showCompletion(); });
    auto *space = new QWidget(global);
    space->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
    global->addWidget(space);
    projectState_ = new QLabel(tr("No project"), global);
    projectState_->setObjectName("projectState");
    projectState_->setAccessibleName(tr("Project save state"));
    global->addWidget(projectState_);
    global->addSeparator();
    run_ = action("runProject", tr("Run game"), QKeySequence(Qt::Key_F5));
    stop_ = action("stopProject", tr("Stop"), QKeySequence(Qt::SHIFT | Qt::Key_F5));
    global->addAction(run_); global->addAction(stop_);
    runMenu->addAction(run_); runMenu->addAction(stop_);
    connect(run_, &QAction::triggered, this, &StudioWindow::runProject);
    connect(stop_, &QAction::triggered, this, &StudioWindow::stopProject);

    central_ = new QStackedWidget(this);
    setCentralWidget(central_);
    auto *welcome = new QWidget(central_);
    auto *welcomeLayout = new QVBoxLayout(welcome);
    welcomeLayout->addStretch();
    auto *title = new QLabel(tr("Nova Studio"), welcome);
    auto font = title->font(); font.setPointSize(26); font.setBold(true); title->setFont(font);
    title->setAlignment(Qt::AlignCenter);
    welcomeLayout->addWidget(title);
    auto *intro = new QLabel(tr("Build a scene visually. Make it move with Lua.\n"
        "This foundation supports native 2D and 3D scenes, PNG sprites and static GLB models."), welcome);
    intro->setWordWrap(true); intro->setAlignment(Qt::AlignCenter); welcomeLayout->addWidget(intro);
    auto *newButton = new QPushButton(newAction->icon(), tr("New project..."), welcome);
    newButton->setObjectName("welcomeNew");
    auto *openButton = new QPushButton(openAction->icon(), tr("Open project..."), welcome);
    newButton->setMinimumHeight(36); openButton->setMinimumHeight(36);
    welcomeLayout->addWidget(newButton, 0, Qt::AlignCenter);
    welcomeLayout->addWidget(openButton, 0, Qt::AlignCenter);
    connect(newButton, &QPushButton::clicked, newAction, &QAction::trigger);
    connect(openButton, &QPushButton::clicked, openAction, &QAction::trigger);
    welcomeLayout->addStretch(); central_->addWidget(welcome);

    workspaces_ = new QTabWidget(central_);
    workspaces_->setObjectName("workspaces");
    workspaces_->setDocumentMode(true);
    auto *scene = new QWidget(workspaces_);
    auto *sceneLayout = new QVBoxLayout(scene);
    sceneLayout->setContentsMargins(0, 0, 0, 0); sceneLayout->setSpacing(0);
    auto *tools = new QToolBar(tr("Scene tools"), scene);
    tools->setObjectName("sceneTools");
    tools->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
    tools->setIconSize(QSize(20, 20));
    add_ = action("addObject", tr("Add shape"), {});
    duplicate_ = action("duplicateObject", tr("Duplicate"), {});
    remove_ = action("deleteObject", tr("Delete"), {});
    for (auto *a : {add_, duplicate_, remove_}) { tools->addAction(a); sceneMenu->addAction(a); }
    connect(add_, &QAction::triggered, this, [this] { addObject(); });
    connect(duplicate_, &QAction::triggered, this, &StudioWindow::duplicateObject);
    connect(remove_, &QAction::triggered, this, &StudioWindow::deleteObject);
    tools->addSeparator();
    snap_ = new QCheckBox(tr("Snap"), tools);
    snap_->setChecked(true); snap_->setObjectName("snap");
    snapStep_ = numberField("Snap increment", .01, 128, tools);
    snapStep_->setValue(16); snapStep_->setMaximumWidth(110);
    tools->addWidget(snap_); tools->addWidget(snapStep_);
    tools->addAction(tr("Scene settings"), this, [this] { document_.select({}); refreshInspector(); });
    sceneLayout->addWidget(tools);
    previewState_ = new QLabel(tr("Editing - click an object to select; drag to move"), scene);
    previewState_->setObjectName("previewState");
    previewState_->setWordWrap(true);
    previewState_->setMargin(8);
    sceneLayout->addWidget(previewState_);
    sceneLayout->addWidget(viewport_, 1);
    workspaces_->addTab(scene, tr("Scene"));
    workspaces_->addTab(code_, tr("Code"));
    central_->addWidget(workspaces_);
    connect(workspaces_, &QTabWidget::currentChanged, this, [this] { refreshInspector(); });

    auto *left = new QWidget(this);
    auto *leftLayout = new QVBoxLayout(left);
    leftLayout->setContentsMargins(8, 8, 8, 8);
    auto *split = new QSplitter(Qt::Vertical, left);
    outline_ = new QTreeWidget(split);
    outline_->setObjectName("sceneOutline"); outline_->setAccessibleName(tr("Scene outline"));
    outline_->setHeaderLabel(tr("Scene objects"));
    outline_->setMinimumWidth(180);
    auto *assetPanel = new QWidget(split);
    auto *assetLayout = new QVBoxLayout(assetPanel);
    assetLayout->setContentsMargins(0, 0, 0, 0);
    assets_ = new QTreeWidget(assetPanel);
    assets_->setObjectName("assetOutline"); assets_->setAccessibleName(tr("Declared project assets"));
    assets_->setHeaderLabel(tr("Assets"));
    assetLayout->addWidget(assets_, 1);
    import_ = action("importAsset", tr("Import PNG / GLB..."), {});
    auto *importButton = new QPushButton(import_->icon(), import_->text(), assetPanel);
    importButton->setObjectName("importAssetButton");
    connect(importButton, &QPushButton::clicked, import_, &QAction::trigger);
    connect(import_, &QAction::changed, importButton, [this, importButton] { importButton->setEnabled(import_->isEnabled()); });
    connect(import_, &QAction::triggered, this, &StudioWindow::importAsset);
    assetLayout->addWidget(importButton);
    placeAsset_ = new QPushButton(tr("Add selected asset to scene"), assetPanel);
    placeAsset_->setObjectName("placeAsset");
    connect(placeAsset_, &QPushButton::clicked, this, [this] { addObject(selectedAsset()); });
    assetLayout->addWidget(placeAsset_);
    leftLayout->addWidget(split);
    leftDock_ = dock(this, "projectDock", tr("Project"), left, Qt::LeftDockWidgetArea);
    connect(outline_, &QTreeWidget::currentItemChanged, this, [this](QTreeWidgetItem *item) {
        if (refreshing_) return;
        if (item) document_.select(item->data(0, Qt::UserRole).toString());
        refreshInspector();
    });
    connect(assets_, &QTreeWidget::currentItemChanged, this, [this] {
        if (refreshing_) return;
        if (selectedAsset().isEmpty()) return;
        inspectorPages_->setCurrentIndex(2);
        const auto id = selectedAsset();
        for (size_t i = 0; i < document_.project().count; ++i) {
            const auto &asset = document_.project().assets[i];
            if (id == QString::fromUtf8(asset.id)) {
                assetInfo_->setText(tr("Asset ID\n%1\n\nSource\n%2\n\n%3").arg(id,
                    QString::fromUtf8(asset.path),
                    asset.type == NOVA_ASSET_SPRITE ? tr("PNG sprite - nearest filtering, alpha supported") :
                    asset.type == NOVA_ASSET_MODEL ? tr("Static unlit GLB - no animation or PBR") : tr("PCM WAV runtime asset")));
            }
        }
        placeAsset_->setEnabled(document_.visual() && !document_.generated() && !viewport_->running());
    });

    inspectorPages_ = new QStackedWidget(this);
    auto *properties = new QWidget(inspectorPages_);
    properties->setObjectName("objectProperties");
    auto *propertiesLayout = new QVBoxLayout(properties);
    auto *form = propertiesForm_ = new QFormLayout;
    form->setVerticalSpacing(12);
    form->setContentsMargins(10, 10, 10, 10);
    name_ = new QLineEdit(properties); name_->setObjectName("objectName");
    form->addRow(tr("&Name"), name_);
    identity_ = new QLabel(properties); identity_->setWordWrap(true); identity_->setTextInteractionFlags(Qt::TextSelectableByMouse);
    form->addRow(tr("Stable ID"), identity_);
    appearance_ = new QComboBox(properties); appearance_->setObjectName("appearance");
    form->addRow(tr("Appearance"), appearance_);
    const QStringList labels{tr("X"), tr("Y"), tr("Z"), tr("Width / scale X"), tr("Height / scale Y"), tr("Depth / scale Z")};
    for (size_t i = 0; i < transform_.size(); ++i) {
        transform_[i] = numberField("transform" + QString::number(i), i < 3 ? -10000 : .01, i < 3 ? 10000 : 1000, properties);
        transform_[i]->setAccessibleName(labels[int(i)]);
        form->addRow(labels[int(i)], transform_[i]);
        connect(transform_[i], &QDoubleSpinBox::editingFinished, this, &StudioWindow::commitInspector);
    }
    colour_ = new QPushButton(tr("Choose colour..."), properties);
    colour_->setObjectName("objectColour"); form->addRow(tr("Primitive colour"), colour_);
    propertiesLayout->addLayout(form);
    selectionHelp_ = new QLabel(tr("Select an object in the outline or native viewport."), properties);
    selectionHelp_->setObjectName("selectionHelp");
    selectionHelp_->setWordWrap(true); propertiesLayout->addWidget(selectionHelp_);
    auto *scriptButton = new QPushButton(tr("Open gameplay Lua"), properties);
    scriptButton->setObjectName("openGameplay");
    connect(scriptButton, &QPushButton::clicked, this, &StudioWindow::showCode);
    auto *referenceButton = new QPushButton(tr("Insert selected object reference"), properties);
    referenceButton->setObjectName("insertObjectReference");
    insertReference_ = new QAction(tr("Insert selected object reference"), this);
    connect(referenceButton, &QPushButton::clicked, insertReference_, &QAction::trigger);
    connect(insertReference_, &QAction::changed, referenceButton, [this, referenceButton] {
        referenceButton->setEnabled(insertReference_->isEnabled());
    });
    connect(insertReference_, &QAction::triggered, this, [this] {
        if (selectedIndex() < 0) return;
        showCode();
        code_->insertPlainText("nova.object(\"" + document_.selection() + "\")");
    });
    propertiesLayout->addStretch();
    auto *objectPage = new QWidget(inspectorPages_);
    auto *objectLayout = new QVBoxLayout(objectPage);
    objectLayout->setContentsMargins(8, 8, 8, 8);
    auto *scroll = new QScrollArea(objectPage);
    scroll->setWidgetResizable(true); scroll->setFrameShape(QFrame::NoFrame); scroll->setWidget(properties);
    objectLayout->addWidget(scroll, 1);
    objectLayout->addWidget(scriptButton); objectLayout->addWidget(referenceButton);
    inspectorPages_->addWidget(objectPage);
    connect(name_, &QLineEdit::editingFinished, this, &StudioWindow::commitInspector);
    connect(appearance_, &QComboBox::activated, this, [this] { commitInspector(); });
    connect(colour_, &QPushButton::clicked, this, [this] {
        const int index = selectedIndex();
        if (index < 0) return;
        const auto original = document_.scene().objects[index].color;
        const QColor chosen = QColorDialog::getColor(QColor(original.r, original.g, original.b), this, tr("Object colour"));
        if (!chosen.isValid()) return;
        NovaScene scene = document_.scene();
        scene.objects[index].color = {static_cast<unsigned char>(chosen.red()), static_cast<unsigned char>(chosen.green()),
            static_cast<unsigned char>(chosen.blue()), 255};
        QString error;
        if (!document_.editScene(scene, document_.selection(), tr("Change object colour"), &error)) report(error);
    });
    auto *camera = new QWidget(inspectorPages_);
    auto *cameraLayout = new QVBoxLayout(camera);
    auto *cameraForm = new QFormLayout;
    auto *background = new QPushButton(tr("Choose background..."), camera);
    background->setObjectName("sceneBackground");
    cameraForm->addRow(tr("Background"), background);
    connect(background, &QPushButton::clicked, this, [this] {
        if (!document_.visual() || document_.generated() || viewport_->running()) return;
        const auto initial = document_.scene().background;
        const QColor chosen = QColorDialog::getColor(QColor(initial.r, initial.g, initial.b), this, tr("Scene background"));
        if (!chosen.isValid()) return;
        auto scene = document_.scene();
        scene.background = {static_cast<unsigned char>(chosen.red()), static_cast<unsigned char>(chosen.green()),
            static_cast<unsigned char>(chosen.blue()), 255};
        QString error;
        if (!document_.editScene(scene, {}, tr("Change scene background"), &error)) report(error);
    });
    const QStringList cameraLabels{tr("Camera X"), tr("Camera Y"), tr("Camera Z"),
        tr("Look at X"), tr("Look at Y"), tr("Look at Z"), tr("Field of view")};
    for (size_t i = 0; i < camera_.size(); ++i) {
        camera_[i] = numberField("camera" + QString::number(i), i == 6 ? 10 : -10000, i == 6 ? 120 : 10000, camera);
        camera_[i]->setAccessibleName(cameraLabels[int(i)]);
        cameraForm->addRow(cameraLabels[int(i)], camera_[i]);
        connect(camera_[i], &QDoubleSpinBox::editingFinished, this, [this] {
            if (refreshing_ || !document_.visual() || viewport_->running()) return;
            NovaScene scene = document_.scene();
            scene.camera_position = {float(camera_[0]->value()), float(camera_[1]->value()), float(camera_[2]->value())};
            scene.camera_target = {float(camera_[3]->value()), float(camera_[4]->value()), float(camera_[5]->value())};
            scene.camera_fov = float(camera_[6]->value());
            QString error;
            if (!document_.editScene(scene, {}, tr("Change scene camera"), &error)) { report(error); refreshInspector(); }
        });
    }
    cameraLayout->addLayout(cameraForm);
    auto *cameraHelp = new QLabel(tr("The game camera is also the editing view. +Y is up in 3D. "
        "2D uses a fixed 960 x 540 logical canvas.\n\nSelect objects to edit their position and size. "
        "Runtime behavior stays in your Lua file."), camera);
    cameraHelp->setWordWrap(true); cameraLayout->addWidget(cameraHelp); cameraLayout->addStretch();
    auto *cameraScroll = new QScrollArea(inspectorPages_);
    cameraScroll->setFrameShape(QFrame::NoFrame); cameraScroll->setWidgetResizable(true); cameraScroll->setWidget(camera);
    inspectorPages_->addWidget(cameraScroll);
    assetInfo_ = new QLabel(inspectorPages_); assetInfo_->setWordWrap(true);
    assetInfo_->setTextInteractionFlags(Qt::TextSelectableByMouse); assetInfo_->setMargin(12);
    inspectorPages_->addWidget(assetInfo_);
    auto *referencePanel = new QWidget(inspectorPages_);
    auto *referenceLayout = new QVBoxLayout(referencePanel);
    auto *referenceSearch = new QLineEdit(referencePanel);
    referenceSearch->setPlaceholderText(tr("Search offline Lua reference")); referenceSearch->setAccessibleName(tr("Search Lua API"));
    referenceLayout->addWidget(referenceSearch);
    reference_ = new QListWidget(referencePanel);
    reference_->setObjectName("luaReference");
    for (const auto &entry : CodeEditor::reference()) reference_->addItem(entry.name);
    referenceLayout->addWidget(reference_, 1);
    referenceText_ = new QTextBrowser(referencePanel);
    referenceText_->setObjectName("referenceDetails");
    referenceLayout->addWidget(referenceText_, 1);
    connect(reference_, &QListWidget::currentRowChanged, this, [this](int row) {
        if (row < 0 || row >= CodeEditor::reference().size()) return;
        const auto &entry = CodeEditor::reference()[row];
        referenceText_->setPlainText(entry.signature + "\n\n" + entry.description +
            "\n\nLifecycle: update(dt, input), 60 Hz. Scene objects are drawn after behavior updates, below Lua HUD draws. "
            "Stop discards runtime changes. " + CodeEditor::completionShortcut().toString(QKeySequence::NativeText) + " opens completion.");
    });
    connect(referenceSearch, &QLineEdit::textChanged, this, [this](const QString &text) {
        for (int i = 0; i < reference_->count(); ++i)
            reference_->item(i)->setHidden(!reference_->item(i)->text().contains(text, Qt::CaseInsensitive));
    });
    reference_->setCurrentRow(0);
    inspectorPages_->addWidget(referencePanel);
    inspectorDock_ = dock(this, "inspectorDock", tr("Inspector"), inspectorPages_, Qt::RightDockWidgetArea);
    inspectorDock_->setMinimumWidth(240);
    auto *problemPanel = new QWidget(this);
    auto *problemLayout = new QVBoxLayout(problemPanel);
    problems_ = new QListWidget(problemPanel);
    problems_->setObjectName("problems"); problems_->setAccessibleName(tr("Problems and recovery details"));
    problems_->setWordWrap(true); problemLayout->addWidget(problems_);
    auto *details = new QPushButton(tr("Open selected details"), problemPanel);
    problemLayout->addWidget(details);
    const auto openDetails = [this] {
        const auto *item = problems_->currentItem();
        if (!item) return;
        const int line = item->data(Qt::UserRole + 1).toInt();
        if (line > 0) { showCode(); code_->goToLine(line); }
        else {
            auto *dialog = new QDialog(this);
            dialog->setAttribute(Qt::WA_DeleteOnClose); dialog->setWindowTitle(tr("Problem details"));
            auto *layout = new QVBoxLayout(dialog);
            auto *text = new QPlainTextEdit(item->text(), dialog); text->setReadOnly(true);
            layout->addWidget(text); dialog->resize(720, 400); dialog->show();
        }
    };
    connect(details, &QPushButton::clicked, this, openDetails);
    connect(problems_, &QListWidget::itemDoubleClicked, this, [openDetails] { openDetails(); });
    problemsDock_ = dock(this, "problemsDock", tr("Problems"), problemPanel, Qt::BottomDockWidgetArea);
    problemsDock_->hide();
    for (auto *d : {leftDock_, inspectorDock_, problemsDock_}) view->addAction(d->toggleViewAction());
    auto *reloadPreview = view->addAction(tr("Reload native preview assets"), QKeySequence(Qt::Key_F6), this, [this] {
        if (!viewport_->running()) refreshPreview(true);
    });
    reloadPreview->setObjectName("reloadPreview");
    view->addAction(tr("Restore workspace layout"), this, [this] {
        addDockWidget(Qt::LeftDockWidgetArea, leftDock_); addDockWidget(Qt::RightDockWidgetArea, inspectorDock_);
        leftDock_->setFloating(false); inspectorDock_->setFloating(false);
        leftDock_->show(); inspectorDock_->show();
        resizeDocks({leftDock_, inspectorDock_}, {240, 280}, Qt::Horizontal);
    });
    help->addAction(tr("Lua API reference"), this, [this] { showCode(); inspectorDock_->show(); });
    help->addAction(tr("About this foundation"), this, [this] {
        QMessageBox::information(this, tr("Nova Studio foundation"), tr(
            "Native Qt 6/C++ desktop authoring, shared C11/Lua runtime.\n\n"
            "Scene and Code are implemented. PNG/static GLB import, stable scene objects, guarded project saves, "
            "recovery and native Run/Stop are available. Legacy editors remain separate.\n\n"
            "Sprite painting, mesh modelling, Sound Studio, a Lua debugger and per-object lifecycle are later milestones. "
            "This is not a finished studio or Android-device qualification.\n\n"
            "Qt Base modules are dynamically linked under LGPLv3-compatible terms; Nova source is MIT. "
            "This development app is not a redistributable/notarized installer."));
    });
    connect(&document_, &ProjectDocument::changed, this, &StudioWindow::refresh);
    connect(&document_, &ProjectDocument::selectionChanged, this, &StudioWindow::refreshInspector);
    connect(&document_, &ProjectDocument::problem, this, [this](const QString &error) { report(error); });
    connect(&document_, &ProjectDocument::externalChange, this, [this](const QString &error) {
        refreshProjectState();
        report(error);
    });
    connect(code_, &QPlainTextEdit::textChanged, this, [this] {
        if (refreshing_ || !document_.isOpen()) return;
        QString error;
        if (!document_.editScript(code_->toPlainText(), &error)) { report(error); code_->setSource(document_.draft().script); }
    });
    connect(code_, &CodeEditor::syntaxResult, this, [this](int line, const QString &message) {
        for (int i = problems_->count() - 1; i >= 0; --i)
            if (problems_->item(i)->data(Qt::UserRole).toBool()) delete problems_->takeItem(i);
        if (!message.isEmpty()) report(message, line, true);
        else if (!problems_->count()) problemsDock_->hide();
    });
    connect(code_, &CodeEditor::cursorStatus, this, [this](const QString &message) { statusBar()->showMessage(message); });
    connect(viewport_, &NativeViewport::graphicsReady, this, [this] { refreshPreview(true); });
    connect(viewport_, &NativeViewport::problem, this, [this](const QString &message) {
        previewValid_ = false;
        stop_->setEnabled(document_.isOpen());
        stop_->setToolTip(tr("Return to authoring; runtime changes are discarded."));
        previewState_->setText(tr("Preview failed - previous native output retained. See Problems."));
        report(message, QRegularExpression(":(\\d+):").match(message).captured(1).toInt());
    });
    connect(viewport_, &NativeViewport::runningChanged, this, [this, undo, redo](bool running) {
        run_->setEnabled(document_.isOpen() && !running);
        stop_->setEnabled(running);
        code_->setReadOnly(running || document_.generated());
        complete_->setEnabled(document_.isOpen() && !running && !document_.generated());
        save_->setEnabled(document_.isOpen() && !running && !document_.generated());
        add_->setEnabled(document_.visual() && !document_.generated() && !running);
        import_->setEnabled(document_.isOpen() && !running && !document_.generated());
        undo->setEnabled(!running && document_.undoStack()->canUndo());
        redo->setEnabled(!running && document_.undoStack()->canRedo());
        refreshInspector();
        if (running) previewState_->setText(tr("Running saved project - click the viewport for input. Escape releases focus. Stop discards runtime changes."));
    });
    connect(viewport_, &NativeViewport::scenePressed, this, [this](QPointF point) { beginDrag(point); });
    connect(viewport_, &NativeViewport::sceneDragged, this, &StudioWindow::drag);
    connect(viewport_, &NativeViewport::sceneReleased, this, &StudioWindow::endDrag);
    connect(viewport_, &NativeViewport::cancelGesture, this, &StudioWindow::cancelDrag);
    if (persist_) {
        QSettings settings;
        restoreGeometry(settings.value("windowGeometry").toByteArray());
        restoreState(settings.value("windowState").toByteArray());
    }
    resizeDocks({leftDock_, inspectorDock_}, {240, 290}, Qt::Horizontal);
    applyStudioStyle(this);
    connect(qApp->styleHints(), &QStyleHints::colorSchemeChanged, this, [this] { applyStudioStyle(this); });
    refresh();
}

QFileDialog *StudioWindow::fileDialog(QWidget *owner, const QString &title, const QString &directory,
    const QString &filter, const QString &name)
{
    auto *dialog = new QFileDialog(owner);
    // Production has no override: Qt uses the platform's native panel. Tests
    // may configure only this dialog, without changing application-wide flags.
    if (dialogSetup_) dialogSetup_(dialog);
    dialog->setObjectName(name);
    dialog->setWindowTitle(title);
    dialog->setDirectory(directory);
    if (!filter.isEmpty()) dialog->setNameFilter(filter);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    return dialog;
}

void StudioWindow::newProject()
{
    if (!leaveProject()) return;
    QDialog dialog(this);
    dialog.setObjectName("newProjectDialog"); dialog.setWindowTitle(tr("New project"));
    auto *layout = new QVBoxLayout(&dialog);
    auto *form = new QFormLayout;
    auto *name = new QLineEdit(tr("My game"), &dialog); name->setObjectName("newName");
    auto *location = new QLineEdit(QDir::homePath(), &dialog); location->setObjectName("newLocation");
    auto *browse = new QPushButton(tr("Choose folder..."), &dialog);
    auto *mode = new QComboBox(&dialog); mode->setObjectName("newDimension"); mode->addItems({tr("2D starter"), tr("3D starter")});
    form->addRow(tr("Project name"), name); form->addRow(tr("Parent folder"), location);
    form->addRow(QString(), browse); form->addRow(tr("Starting scene"), mode);
    layout->addLayout(form);
    auto *hint = new QLabel(tr("Creates a new folder, a visual scene and a short editable Lua movement script. Existing folders are never overwritten."), &dialog);
    hint->setWordWrap(true); layout->addWidget(hint);
    auto *buttons = new QDialogButtonBox(QDialogButtonBox::Save | QDialogButtonBox::Cancel, &dialog);
    buttons->button(QDialogButtonBox::Save)->setText(tr("Create project"));
    buttons->button(QDialogButtonBox::Save)->setObjectName("createProjectButton");
    layout->addWidget(buttons);
    connect(browse, &QPushButton::clicked, &dialog, [this, location, &dialog] {
        auto *picker = fileDialog(&dialog, tr("New project parent folder"), location->text(), {}, "projectFolderDialog");
        picker->setFileMode(QFileDialog::Directory);
        picker->setOption(QFileDialog::ShowDirsOnly);
        connect(picker, &QDialog::accepted, location, [picker, location] {
            if (!picker->selectedFiles().isEmpty()) location->setText(picker->selectedFiles().front());
        });
        picker->open();
    });
    connect(buttons, &QDialogButtonBox::rejected, &dialog, &QDialog::reject);
    connect(buttons, &QDialogButtonBox::accepted, &dialog, [this, name, location, mode, &dialog] {
        QString error;
        if (!document_.create(location->text(), name->text(), mode->currentIndex() == 1, examples_, &error)) {
            QMessageBox::warning(&dialog, tr("Project not created"), error); return;
        }
        snapStep_->setValue(mode->currentIndex() == 1 ? .25 : 16);
        workspaces_->setCurrentIndex(0);
        remember(); dialog.accept();
    });
    dialog.resize(540, 270); dialog.exec();
}

void StudioWindow::chooseProject()
{
    auto *dialog = fileDialog(this, tr("Open project"),
        document_.isOpen() ? document_.root() : QDir::homePath(),
        tr("Nova runtime / visual projects (*.project)"), "openProjectDialog");
    dialog->setFileMode(QFileDialog::ExistingFile);
    if (document_.isOpen()) dialog->selectFile(document_.path());
    connect(dialog, &QDialog::accepted, this, [this, dialog] {
        const auto files = dialog->selectedFiles();
        if (!files.isEmpty() && leaveProject()) openProject(files.front());
    });
    dialog->open();
}

bool StudioWindow::openProject(const QString &path, bool decisions)
{
    const auto interrupted = ProjectDocument::interruptedSaveDescription(path);
    if (!interrupted.isEmpty()) {
        if (!decisions) { report(interrupted); return false; }
        if (QMessageBox::question(this, tr("Finish interrupted save"), interrupted + tr("\n\nFinish this recorded commit?"),
            QMessageBox::Yes | QMessageBox::Cancel, QMessageBox::Cancel) != QMessageBox::Yes) return false;
        QString error;
        const bool same = QFileInfo(path).absoluteFilePath() == document_.path();
        if (!(same ? document_.resumeInterruptedSave(&error) : ProjectDocument::finishInterruptedSave(path, &error))) {
            report(error); return false;
        }
        if (same) { refreshPreview(true); return true; }
    }
    QString error;
    if (!document_.open(path, &error)) { report(error); return false; }
    snapStep_->setValue(document_.visual() && document_.scene().mode != NOVA_2D ? .25 : 16);
    remember();
    if (decisions && !document_.recoveryDescription().isEmpty()) reviewRecovery();
    return true;
}

bool StudioWindow::leaveProject()
{
    if (focusWidget()) focusWidget()->clearFocus();
    if (viewport_->running()) stopProject();
    if (!document_.dirty()) return true;
    QMessageBox decision(QMessageBox::Question, tr("Unsaved project"),
        tr("Save the complete authoring snapshot before leaving this project?"), QMessageBox::NoButton, this);
    auto *save = decision.addButton(tr("Save project"), QMessageBox::AcceptRole);
    auto *keep = decision.addButton(tr("Keep recovery and leave"), QMessageBox::ActionRole);
    auto *discard = decision.addButton(tr("Discard edits"), QMessageBox::DestructiveRole);
    if (!ProjectDocument::interruptedSaveDescription(document_.path()).isEmpty()) {
        discard->setEnabled(false);
        decision.setInformativeText(tr("An interrupted multi-file save cannot be discarded as if it were atomic. "
            "Finish its journal with Save project, or keep recovery and leave."));
    }
    decision.addButton(QMessageBox::Cancel);
    decision.exec();
    QString error;
    if (decision.clickedButton() == save) {
        if (ProjectDocument::interruptedSaveDescription(document_.path()).isEmpty()) {
            if (document_.save(&error)) return true;
        } else if (document_.resumeInterruptedSave(&error) && document_.save(&error)) return true;
    } else if (decision.clickedButton() == keep) {
        if (document_.writeRecovery(&error)) return true;
    } else if (decision.clickedButton() == discard) {
        if (document_.discardRecovery(&error)) return true;
    } else return false;
    report(error);
    return false;
}

void StudioWindow::saveProject()
{
    if (focusWidget()) focusWidget()->clearFocus();
    QString error;
    const auto interrupted = ProjectDocument::interruptedSaveDescription(document_.path());
    if (!interrupted.isEmpty()) {
        if (QMessageBox::question(this, tr("Finish interrupted save"), interrupted +
            tr("\n\nFinish the recorded commit first? Any newer in-memory edits will remain as an unsaved draft."),
            QMessageBox::Yes | QMessageBox::Cancel, QMessageBox::Cancel) != QMessageBox::Yes) return;
        if (!document_.resumeInterruptedSave(&error)) { report(error); return; }
    }
    if (!document_.save(&error)) { projectState_->setText(tr("Save needs attention")); report(error); }
    else statusBar()->showMessage(tr("Complete project snapshot saved"), 5000);
}

void StudioWindow::reviewRecovery()
{
    if (viewport_->running()) stopProject();
    const auto description = document_.recoveryDescription();
    if (description.isEmpty()) { statusBar()->showMessage(tr("No pending draft recovery"), 4000); return; }
    QMessageBox decision(QMessageBox::Question, tr("Recover authoring draft"), description, QMessageBox::NoButton, this);
    decision.setDetailedText(document_.recoveryPreview());
    auto *restore = decision.addButton(tr("Restore draft"), QMessageBox::AcceptRole);
    auto *discard = decision.addButton(tr("Discard recovery"), QMessageBox::DestructiveRole);
    decision.addButton(tr("Keep for later"), QMessageBox::RejectRole);
    decision.exec();
    QString error;
    if (decision.clickedButton() == restore && !document_.restoreRecovery(&error)) report(error);
    if (decision.clickedButton() == discard && !document_.discardRecovery(&error)) report(error);
    refresh();
}

void StudioWindow::compareDisk()
{
    if (!document_.isOpen()) return;
    auto *dialog = new QDialog(this); dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setWindowTitle(tr("Saved base / your draft / current disk"));
    auto *layout = new QVBoxLayout(dialog);
    auto *text = new QPlainTextEdit(document_.comparison(), dialog); text->setReadOnly(true);
    text->setFont(code_->font()); layout->addWidget(text);
    dialog->resize(960, 640); dialog->show();
}

void StudioWindow::report(const QString &message, int line, bool syntax)
{
    if (message.isEmpty()) return;
    for (int i = 0; i < problems_->count(); ++i) if (problems_->item(i)->text() == message) return;
    auto *item = new QListWidgetItem(style()->standardIcon(QStyle::SP_MessageBoxWarning), message, problems_);
    item->setData(Qt::UserRole, syntax); item->setData(Qt::UserRole + 1, line);
    item->setToolTip(message);
    problems_->setCurrentItem(item);
    problemsDock_->show();
    statusBar()->showMessage(tr("Action needs attention - see Problems"));
}

int StudioWindow::selectedIndex() const
{
    if (!document_.visual() || document_.selection().isEmpty()) return -1;
    for (size_t i = 0; i < document_.scene().count; ++i)
        if (document_.selection() == QString::fromUtf8(document_.scene().objects[i].id)) return int(i);
    return -1;
}

QString StudioWindow::selectedAsset() const
{
    const auto *item = assets_->currentItem();
    return item ? item->data(0, Qt::UserRole).toString() : QString();
}

void StudioWindow::refreshProjectState()
{
    projectState_->setText(!document_.isOpen() ? tr("No project") :
        document_.externalChanges() ? tr("External changes") :
        document_.generated() ? tr("Generated - read-only") :
        document_.dirty() ? tr("Unsaved changes") : tr("Saved"));
}

void StudioWindow::refresh()
{
    refreshing_ = true;
    const bool open = document_.isOpen();
    const bool entering = open && central_->currentIndex() == 0;
    central_->setCurrentIndex(open ? 1 : 0);
    if (!open || entering) { leftDock_->setVisible(open); inspectorDock_->setVisible(open); }
    if (viewport_->running() && document_.path() != previewPath_) viewport_->setRunning(false);
    const bool running = viewport_->running();
    save_->setEnabled(open && !running && !document_.generated());
    run_->setEnabled(open && !running); stop_->setEnabled(running);
    import_->setEnabled(open && !running && !document_.generated());
    add_->setEnabled(document_.visual() && !document_.generated() && !running);
    code_->setReadOnly(!open || running || document_.generated());
    complete_->setEnabled(open && !running && !document_.generated());
    refreshProjectState();
    if (!open) {
        refreshing_ = false; return;
    }
    save_->setToolTip(document_.generated() ? tr("Generated ownership is protected. Edit this project in the compatibility editor.") :
        tr("Save the complete scene / Lua / manifest snapshot"));
    code_->setSourceName(QString::fromUtf8(document_.project().entry));
    setWindowTitle(QFileInfo(document_.root()).fileName() + (document_.dirty() ? " *" : "") + " - Nova Studio");
    code_->setSource(document_.draft().script);
    if (treeScene_ != document_.draft().scene || treeManifest_ != document_.draft().manifest) {
        treeScene_ = document_.draft().scene; treeManifest_ = document_.draft().manifest;
        outline_->clear(); assets_->clear();
        auto *root = new QTreeWidgetItem(outline_, {document_.visual() ? QString::fromUtf8(document_.project().scene) : tr("Lua-authored scene")});
        root->setIcon(0, studioIcon("scene", palette()));
        QStringList objects, assetIds;
        for (size_t i = 0; document_.visual() && i < document_.scene().count; ++i) {
            const auto &object = document_.scene().objects[i];
            auto *item = new QTreeWidgetItem(root, {QString::fromUtf8(object.name)});
            item->setData(0, Qt::UserRole, QString::fromUtf8(object.id));
            item->setToolTip(0, QString::fromUtf8(object.id));
            item->setIcon(0, studioIcon(flat(object) ? "sprite" : "scene", palette()));
            objects << QString::fromUtf8(object.id);
        }
        root->setExpanded(true);
        std::array<QTreeWidgetItem *, 3> groups{};
        const QStringList categories{tr("Sprites"), tr("Models"), tr("Runtime audio")};
        for (size_t i = 0; i < document_.project().count; ++i) {
            const auto &asset = document_.project().assets[i];
            const size_t group = size_t(asset.type);
            if (!groups[group]) { groups[group] = new QTreeWidgetItem(assets_, {categories[int(group)]}); groups[group]->setExpanded(true); }
            auto *item = new QTreeWidgetItem(groups[group], {QString::fromUtf8(asset.id)});
            item->setData(0, Qt::UserRole, QString::fromUtf8(asset.id));
            item->setToolTip(0, QString::fromUtf8(asset.path));
            assetIds << QString::fromUtf8(asset.id);
        }
        code_->setProjectNames(objects, assetIds);
    }
    refreshing_ = false;
    refreshInspector();
    refreshPreview();
}

void StudioWindow::refreshInspector()
{
    if (!document_.isOpen()) return;
    refreshing_ = true;
    const int index = selectedIndex();
    const bool editable = document_.visual() && !document_.generated() && !viewport_->running();
    inspectorPages_->widget(0)->setEnabled(editable);
    inspectorPages_->widget(1)->setEnabled(editable);
    viewport_->setSelection(index);
    duplicate_->setEnabled(index >= 0 && editable);
    remove_->setEnabled(index >= 0 && editable);
    insertReference_->setEnabled(index >= 0 && editable);
    duplicate_->setToolTip(index < 0 ? tr("Select an object to duplicate.") : tr("Duplicate with a new stable ID."));
    remove_->setToolTip(index < 0 ? tr("Select an object to delete.") : tr("Undo restores this ID. Lua references are never rewritten."));
    placeAsset_->setEnabled(editable && !selectedAsset().isEmpty());
    if (workspaces_->currentIndex() == 1) inspectorPages_->setCurrentIndex(3);
    else if (index >= 0) {
        inspectorPages_->setCurrentIndex(0);
        const auto &object = document_.scene().objects[index];
        name_->setText(QString::fromUtf8(object.name)); identity_->setText(QString::fromUtf8(object.id));
        appearance_->clear();
        appearance_->addItem(flat(object) ? tr("Rectangle") : tr("Cube"), QString());
        for (size_t i = 0; i < document_.project().count; ++i) {
            const auto &asset = document_.project().assets[i];
            if (asset.type == (flat(object) ? NOVA_ASSET_SPRITE : NOVA_ASSET_MODEL))
                appearance_->addItem(QString::fromUtf8(asset.id), QString::fromUtf8(asset.id));
        }
        appearance_->setCurrentIndex(std::max(0, appearance_->findData(QString::fromUtf8(object.asset))));
        const float values[]{object.position.x, object.position.y, object.position.z, object.size.x, object.size.y, object.size.z};
        for (size_t i = 0; i < transform_.size(); ++i) {
            transform_[i]->setValue(values[i]);
            transform_[i]->setEnabled(!flat(object) || (i != 2 && i != 5));
            propertiesForm_->setRowVisible(transform_[i], !flat(object) || (i != 2 && i != 5));
            if (i >= 3) {
                auto *label = qobject_cast<QLabel *>(propertiesForm_->labelForField(transform_[i]));
                const QStringList sizes = object.type == NOVA_MODEL ?
                    QStringList{tr("Scale X"), tr("Scale Y"), tr("Scale Z")} :
                    QStringList{tr("Width"), tr("Height"), tr("Depth")};
                if (label) label->setText(sizes[int(i - 3)]);
            }
        }
        colour_->setEnabled(object.type == NOVA_RECTANGLE || object.type == NOVA_CUBE);
        propertiesForm_->setRowVisible(colour_, colour_->isEnabled());
        colour_->setToolTip(colour_->isEnabled() ? tr("Set RGB colour") : tr("Asset appearance comes from its source; tint is not supported."));
        selectionHelp_->setText(flat(object) ?
            tr("2D: X right, Y down, positions and size in logical pixels. Drag to move. Finish a field to apply; Undo restores it.") :
            tr("3D: +Y up. Drag on the object's horizontal XZ plane; edit Y here. GLB size fields multiply source bounds. Finish a field to apply."));
        if (auto *root = outline_->topLevelItem(0))
            for (int i = 0; i < root->childCount(); ++i)
                if (root->child(i)->data(0, Qt::UserRole).toString() == document_.selection())
                    outline_->setCurrentItem(root->child(i));
    } else {
        inspectorPages_->setCurrentIndex(document_.visual() ? 1 : 3);
        const auto &scene = document_.scene();
        const float values[]{scene.camera_position.x, scene.camera_position.y, scene.camera_position.z,
            scene.camera_target.x, scene.camera_target.y, scene.camera_target.z, scene.camera_fov};
        for (size_t i = 0; i < camera_.size(); ++i) {
            camera_[i]->setValue(values[i]);
            camera_[i]->setEnabled(document_.visual() && scene.mode != NOVA_2D);
        }
        outline_->setCurrentItem(outline_->topLevelItem(0));
    }
    refreshing_ = false;
}

void StudioWindow::refreshPreview(bool force)
{
    if (!document_.isOpen() || !viewport_->ready() || viewport_->running()) return;
    if (force || previewManifest_ != document_.draft().manifest || previewPath_ != document_.path()) {
        const QByteArray source = document_.visual() ? QByteArray("function update() end\n") : document_.draft().script;
        previewValid_ = viewport_->openAuthoring(document_.path(), document_.draft().manifest, document_.draft().scene, source);
        if (!previewValid_) return;
        previewManifest_ = document_.draft().manifest; previewPath_ = document_.path();
    }
    if (!previewValid_) return;
    if (document_.visual()) {
        auto frame = std::make_unique<NovaFrame>();
        nova_scene_frame(&document_.scene(), document_.project().assets, document_.project().count, frame.get());
        viewport_->setAuthoringFrame(*frame);
        previewState_->setText(document_.scene().mode == NOVA_2D ?
            tr("Editing 2D scene - select and drag objects; gameplay runs only with Run game.") :
            tr("Editing native 3D scene - drag in XZ; edit height and scale in the Inspector."));
    } else if (viewport_->frame()) {
        viewport_->setAuthoringFrame(*viewport_->frame());
        previewState_->setText(tr("Legacy Lua project - native initial frame. Visual objects are not reconstructed from Lua. Run restarts the saved script."));
    }
}

void StudioWindow::commitInspector()
{
    const int index = selectedIndex();
    if (refreshing_ || index < 0 || viewport_->running()) return;
    NovaScene scene = document_.scene();
    auto &object = scene.objects[index];
    if (name_->text().toUtf8().size() >= NOVA_OBJECT_NAME_CAPACITY || name_->text().isEmpty()) {
        report(tr("Object names must contain 1..127 UTF-8 bytes.")); refreshInspector(); return;
    }
    copyString(object.name, sizeof(object.name), name_->text());
    object.position = {float(transform_[0]->value()), float(transform_[1]->value()), float(transform_[2]->value())};
    object.size = {float(transform_[3]->value()), float(transform_[4]->value()), float(transform_[5]->value())};
    const bool twoD = flat(object);
    const auto asset = appearance_->currentData().toString();
    copyString(object.asset, sizeof(object.asset), asset);
    object.type = asset.isEmpty() ? (twoD ? NOVA_RECTANGLE : NOVA_CUBE) : (twoD ? NOVA_SPRITE : NOVA_MODEL);
    if (!asset.isEmpty()) object.color = {255, 255, 255, 255};
    QString error;
    if (!document_.editScene(scene, document_.selection(), tr("Edit %1").arg(name_->text()), &error)) { report(error); refreshInspector(); }
}

void StudioWindow::addObject(const QString &assetId)
{
    if (!document_.visual() || viewport_->running()) return;
    NovaScene scene = document_.scene();
    if (scene.count == NOVA_MAX_OBJECTS) { report(tr("A scene supports at most 128 objects.")); return; }
    const NovaAsset *asset = nullptr;
    for (size_t i = 0; i < document_.project().count; ++i)
        if (assetId == QString::fromUtf8(document_.project().assets[i].id)) asset = &document_.project().assets[i];
    if (!assetId.isEmpty() && (!asset || asset->type == NOVA_ASSET_AUDIO)) { report(tr("Select a sprite or model appearance.")); return; }
    const bool twoD = asset ? asset->type == NOVA_ASSET_SPRITE : scene.mode == NOVA_2D;
    if ((twoD && scene.mode == NOVA_3D) || (!twoD && scene.mode == NOVA_2D)) {
        report(tr("This asset's dimension does not match the scene. The source and project are unchanged.")); return;
    }
    auto &object = scene.objects[scene.count++];
    object = {};
    const QString id = "object-" + QUuid::createUuid().toString(QUuid::WithoutBraces);
    copyString(object.id, sizeof(object.id), id);
    copyString(object.name, sizeof(object.name), asset ? QString::fromUtf8(asset->id) : twoD ? tr("Rectangle") : tr("Cube"));
    copyString(object.asset, sizeof(object.asset), assetId);
    object.type = asset ? (twoD ? NOVA_SPRITE : NOVA_MODEL) : (twoD ? NOVA_RECTANGLE : NOVA_CUBE);
    object.position = twoD ? NovaVec3{448, 238, 0} : NovaVec3{0, 0, 0};
    object.size = twoD ? NovaVec3{64, 64, 1} : NovaVec3{1, 1, 1};
    object.color = asset ? NovaColor{255, 255, 255, 255} : NovaColor{77, 225, 201, 255};
    QString error;
    if (!document_.editScene(scene, id, tr("Add object"), &error)) report(error);
    else { name_->setFocus(); name_->selectAll(); }
}

void StudioWindow::duplicateObject()
{
    const int index = selectedIndex();
    if (index < 0 || viewport_->running()) return;
    NovaScene scene = document_.scene();
    if (scene.count == NOVA_MAX_OBJECTS) { report(tr("A scene supports at most 128 objects.")); return; }
    auto &object = scene.objects[scene.count++];
    object = scene.objects[index];
    const QString id = "object-" + QUuid::createUuid().toString(QUuid::WithoutBraces);
    copyString(object.id, sizeof(object.id), id);
    object.position.x = std::min(10000.f, object.position.x + (flat(object) ? 16.f : .25f));
    QString error;
    if (!document_.editScene(scene, id, tr("Duplicate object"), &error)) report(error);
}

void StudioWindow::deleteObject()
{
    const int index = selectedIndex();
    if (index < 0 || viewport_->running()) return;
    NovaScene scene = document_.scene();
    for (size_t i = size_t(index) + 1; i < scene.count; ++i) scene.objects[i - 1] = scene.objects[i];
    --scene.count;
    QString error;
    if (!document_.editScene(scene, {}, tr("Delete object (Lua references retained)"), &error)) report(error);
    else statusBar()->showMessage(tr("Object deleted; Undo restores its ID. Lua references were not rewritten."), 6000);
}

void StudioWindow::importAsset()
{
    auto *dialog = fileDialog(this, tr("Import supported appearance"), document_.root(),
        tr("Native sprites and static models (*.png *.glb)"), "importAssetDialog");
    dialog->setFileMode(QFileDialog::ExistingFile);
    connect(dialog, &QDialog::accepted, this, [this, dialog] {
        if (!dialog->selectedFiles().isEmpty()) importFile(dialog->selectedFiles().front());
    });
    dialog->open();
}

void StudioWindow::importFile(const QString &path)
{
    if (!document_.isOpen() || viewport_->running()) return;
    QString id, error;
    if (!document_.importAsset(path, &id, &error)) { report(error); return; }
    for (int i = 0; i < assets_->topLevelItemCount(); ++i) {
        auto *group = assets_->topLevelItem(i);
        for (int j = 0; j < group->childCount(); ++j)
            if (group->child(j)->data(0, Qt::UserRole).toString() == id) assets_->setCurrentItem(group->child(j));
    }
    statusBar()->showMessage(tr("Validated source copy retained in assets. Save registers it; undo/discard never deletes imported files."), 8000);
}

void StudioWindow::runProject()
{
    if (!document_.isOpen()) return;
    if (focusWidget()) focusWidget()->clearFocus();
    QString error;
    if ((!document_.generated() && !document_.save(&error)) || !document_.checkExternal(&error)) { report(error); return; }
    workspaces_->setCurrentIndex(0);
    if (!viewport_->openProject(document_.path())) return;
    viewport_->setRunning(true);
    viewport_->setFocus(Qt::OtherFocusReason);
}

void StudioWindow::stopProject()
{
    viewport_->setRunning(false);
    refreshPreview(true);
    refreshInspector();
    outline_->setFocus(Qt::OtherFocusReason);
}

void StudioWindow::beginDrag(QPointF point)
{
    if (!document_.visual() || !previewValid_) return;
    const int index = viewport_->pick(point);
    document_.select(index < 0 ? QString() : QString::fromUtf8(document_.scene().objects[index].id));
    if (index < 0) return;
    dragIndex_ = index; dragScene_ = document_.scene(); dragPointer_ = point; dragMoved_ = false;
    dragStart_ = flat(dragScene_.objects[index]) ? point : viewport_->groundPoint(point, dragScene_.objects[index].position.y);
    if (!std::isfinite(dragStart_.x()) || !std::isfinite(dragStart_.y())) dragIndex_ = -1;
}

void StudioWindow::drag(QPointF point)
{
    if (dragIndex_ < 0) return;
    if (!dragMoved_ && QLineF(point, dragPointer_).length() <
        QApplication::startDragDistance() * NOVA_WIDTH / double(viewport_->width())) return;
    dragMoved_ = true;
    auto &object = dragScene_.objects[dragIndex_];
    const auto &before = document_.scene().objects[dragIndex_];
    const QPointF current = flat(object) ? point : viewport_->groundPoint(point, before.position.y);
    if (!std::isfinite(current.x()) || !std::isfinite(current.y())) return;
    const QPointF delta = current - dragStart_;
    const auto snapped = [this](double value) {
        if (snap_->isChecked()) value = std::round(value / snapStep_->value()) * snapStep_->value();
        return float(std::clamp(value, -10000.0, 10000.0));
    };
    object.position.x = snapped(before.position.x + delta.x());
    if (flat(object)) object.position.y = snapped(before.position.y + delta.y());
    else object.position.z = snapped(before.position.z + delta.y());
    auto frame = std::make_unique<NovaFrame>();
    nova_scene_frame(&dragScene_, document_.project().assets, document_.project().count, frame.get());
    viewport_->setAuthoringFrame(*frame);
}

void StudioWindow::endDrag(QPointF point)
{
    if (dragIndex_ < 0) return;
    drag(point); dragIndex_ = -1;
    if (!dragMoved_) return;
    QString error;
    if (!document_.editScene(dragScene_, document_.selection(), tr("Move object"), &error)) { report(error); refreshPreview(); }
}

void StudioWindow::cancelDrag()
{
    if (dragIndex_ < 0) return;
    dragIndex_ = -1;
    refreshPreview();
}

void StudioWindow::showCode()
{
    workspaces_->setCurrentIndex(1); code_->setFocus(Qt::ShortcutFocusReason);
}

void StudioWindow::remember()
{
    if (!persist_) return;
    QSettings settings;
    auto recent = settings.value("recentProjects").toStringList();
    recent.removeAll(document_.path()); recent.prepend(document_.path());
    while (recent.size() > 8) recent.removeLast();
    settings.setValue("recentProjects", recent);
}

void StudioWindow::closeEvent(QCloseEvent *event)
{
    if (!leaveProject()) { event->ignore(); return; }
    if (persist_) {
        QSettings settings;
        settings.setValue("windowGeometry", saveGeometry()); settings.setValue("windowState", saveState());
    }
    event->accept();
}
