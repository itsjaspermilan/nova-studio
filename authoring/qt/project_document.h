#ifndef NOVA_QT_PROJECT_DOCUMENT_H
#define NOVA_QT_PROJECT_DOCUMENT_H

#include <QByteArray>
#include <QObject>
#include <QString>
#include <QUndoStack>
#include <memory>

extern "C" {
#include "scene.h"
}

class QLockFile;
class QTimer;
class QFileSystemWatcher;

struct StudioDraft {
    QByteArray manifest, script, scene;
    QString selection;
};

class ProjectDocument final : public QObject {
    Q_OBJECT
public:
    explicit ProjectDocument(QObject *parent = nullptr);
    ~ProjectDocument() override;
    bool open(const QString &manifestPath, QString *error);
    bool create(const QString &parentDirectory, const QString &name, bool threeD,
        const QString &examples, QString *error);
    bool save(QString *error);
    bool writeRecovery(QString *error);
    bool restoreRecovery(QString *error);
    bool discardRecovery(QString *error);
    bool resumeInterruptedSave(QString *error);
    bool saveRecoveryCopy(const QString &destination, QString *error) const;
    bool checkExternal(QString *error) const;
    QString recoveryDescription() const;
    QString recoveryPreview() const;
    QString comparison() const;
    bool importAsset(const QString &source, QString *id, QString *error);
    bool editScene(const NovaScene &scene, const QString &selection,
        const QString &operation, QString *error);
    bool editScript(const QString &text, QString *error);
    void select(const QString &id);
    bool dirty() const;
    bool isOpen() const { return !path_.isEmpty(); }
    bool visual() const { return project_.version == 3; }
    bool generated() const { return generated_; }
    bool externalChanges() const { return externalChanged_; }
    QString path() const { return path_; }
    QString root() const { return root_; }
    QString selection() const { return draft_.selection; }
    const StudioDraft &draft() const { return draft_; }
    const NovaProject &project() const { return project_; }
    const NovaScene &scene() const { return scene_; }
    QUndoStack *undoStack() { return &undo_; }
    static QByteArray serialize(const NovaScene &scene);
    static bool finishInterruptedSave(const QString &manifestPath, QString *error);
    static QString interruptedSaveDescription(const QString &manifestPath);

signals:
    void changed();
    void selectionChanged();
    void problem(const QString &message);
    void externalChange(const QString &message); // Empty when the disk matches again.

private:
    friend class DraftCommand;
    struct DiskState;
    void apply(const StudioDraft &draft);
    void push(const StudioDraft &draft, const QString &operation, bool textEdit);
    void watch();
    bool parse(const StudioDraft &draft, NovaProject *project, NovaScene *scene, QString *error) const;
    std::unique_ptr<DiskState> disk_;
    std::unique_ptr<QLockFile> lock_;
    QUndoStack undo_;
    QTimer *recoveryTimer_;
    QFileSystemWatcher *watcher_;
    QString path_, root_;
    StudioDraft draft_;
    NovaProject project_{};
    NovaScene scene_{};
    bool generated_ = false, writing_ = false, recoveryPending_ = false, externalChanged_ = false;
};
#endif
