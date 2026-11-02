#ifndef NOVA_QT_STUDIO_WINDOW_H
#define NOVA_QT_STUDIO_WINDOW_H

#include "project_document.h"
#include <QMainWindow>
#include <array>
#include <functional>

class CodeEditor;
class NativeViewport;
class QTreeWidget;
class QTreeWidgetItem;
class QTabWidget;
class QStackedWidget;
class QLineEdit;
class QDoubleSpinBox;
class QComboBox;
class QLabel;
class QListWidget;
class QDockWidget;
class QCheckBox;
class QPushButton;
class QTextBrowser;
class QFileDialog;
class QFormLayout;

class StudioWindow final : public QMainWindow {
    Q_OBJECT
public:
    using DialogSetup = std::function<void(QFileDialog *)>;
    explicit StudioWindow(QString examples, bool persistWorkspace = true,
        DialogSetup dialogSetup = {}, QWidget *parent = nullptr);
    bool openProject(const QString &path, bool decisions = true);
    ProjectDocument *projectDocument() { return &document_; }
    NativeViewport *viewport() const { return viewport_; }
    CodeEditor *codeEditor() const { return code_; }

protected:
    void closeEvent(QCloseEvent *event) override;

private:
    void newProject();
    void chooseProject();
    void saveProject();
    bool leaveProject();
    void reviewRecovery();
    void compareDisk();
    void refresh();
    void refreshProjectState();
    void refreshInspector();
    void refreshPreview(bool force = false);
    void report(const QString &message, int line = 0, bool syntax = false);
    void commitInspector();
    void addObject(const QString &asset = {});
    void duplicateObject();
    void deleteObject();
    void importAsset();
    void importFile(const QString &path);
    void runProject();
    void stopProject();
    void beginDrag(QPointF point);
    void drag(QPointF point);
    void endDrag(QPointF point);
    void cancelDrag();
    void remember();
    int selectedIndex() const;
    QString selectedAsset() const;
    void showCode();
    QFileDialog *fileDialog(QWidget *owner, const QString &title, const QString &directory,
        const QString &filter, const QString &name);

    ProjectDocument document_;
    QString examples_;
    DialogSetup dialogSetup_;
    bool persist_, refreshing_ = false, previewValid_ = false;
    NativeViewport *viewport_;
    CodeEditor *code_;
    QStackedWidget *central_, *inspectorPages_;
    QTabWidget *workspaces_;
    QTreeWidget *outline_, *assets_;
    QListWidget *problems_, *reference_;
    QTextBrowser *referenceText_;
    QLineEdit *name_;
    QFormLayout *propertiesForm_;
    QLabel *identity_, *previewState_, *projectState_, *selectionHelp_, *assetInfo_;
    QComboBox *appearance_;
    std::array<QDoubleSpinBox *, 6> transform_;
    std::array<QDoubleSpinBox *, 7> camera_;
    QCheckBox *snap_;
    QDoubleSpinBox *snapStep_;
    QPushButton *colour_, *placeAsset_;
    QDockWidget *leftDock_, *inspectorDock_, *problemsDock_;
    QAction *save_, *run_, *stop_, *add_, *duplicate_, *remove_, *import_, *insertReference_, *complete_;
    QByteArray treeScene_, treeManifest_, previewManifest_;
    QString previewPath_;
    NovaScene dragScene_{};
    QPointF dragStart_, dragPointer_;
    int dragIndex_ = -1;
    bool dragMoved_ = false;
};
#endif
