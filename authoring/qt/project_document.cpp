#include "project_document.h"
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QFileSystemWatcher>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLockFile>
#include <QRegularExpression>
#include <QSet>
#include <QStringDecoder>
#include <QTimer>
#include <QUuid>
#include <array>
#include <algorithm>
#include <cstring>
#include <map>
#include <vector>

extern "C" {
#include "document.h"
#include "assets.h"
}

namespace {
const QString journalName = QStringLiteral(".nova-studio-journal");
const QString recoveryName = QStringLiteral(".nova-studio-recovery");
constexpr size_t JournalLimit = 2 * 1024 * 1024;

bool failure(QString *error, const QString &message)
{
    if (error) *error = message;
    return false;
}

struct File {
    NovaDocument document{};
    ~File() { nova_document_close(&document); }
    bool open(const QString &root, const QString &relative, size_t limit, bool output, QString *error, bool binary = false)
    {
        char detail[1024] = {};
        const auto r = root.toUtf8(), p = relative.toUtf8();
        bool ok = output ?
            nova_document_open_output(&document, r.constData(), p.constData(), limit, binary, detail, sizeof(detail)) :
            nova_document_open(&document, r.constData(), p.constData(), limit, detail, sizeof(detail));
        if (!ok) return failure(error, QString::fromUtf8(detail));
        return true;
    }
    QByteArray saved() const { return {document.saved.text, qsizetype(document.saved.length)}; }
    QByteArray text() const { return {document.text, qsizetype(document.length)}; }
    bool replace(const QByteArray &bytes, QString *error)
    {
        char detail[1024] = {};
        if (!nova_document_replace(&document, 0, document.length, bytes.constData(), size_t(bytes.size()), detail, sizeof(detail)))
            return failure(error, QString::fromUtf8(detail));
        return true;
    }
    bool check(QString *error) const
    {
        char detail[1024] = {};
        if (!nova_document_check_disk(const_cast<NovaDocument *>(&document), detail, sizeof(detail)))
            return failure(error, QString::fromUtf8(detail));
        return true;
    }
    bool save(QString *error)
    {
        char detail[1024] = {};
        if (!nova_document_save(&document, false, detail, sizeof(detail)))
            return failure(error, QString::fromUtf8(detail));
        return true;
    }
    bool remove(QString *error)
    {
        char detail[1024] = {};
        if (!nova_document_remove(&document, detail, sizeof(detail)))
            return failure(error, QString::fromUtf8(detail));
        return true;
    }
};

bool utf8(const QByteArray &bytes)
{
    QStringDecoder decoder(QStringDecoder::Utf8);
    decoder.decode(bytes);
    return !decoder.hasError() && !bytes.contains('\0');
}

size_t limitFor(const QString &path)
{
    return path.endsWith(".lua") ? NOVA_SOURCE_EDIT_LIMIT :
        path.endsWith(".nova-scene") ? NOVA_SCENE_LIMIT : NOVA_MANIFEST_LIMIT;
}

QStringList pathsFor(const NovaProject &project, const QString &manifest)
{
    QStringList paths;
    if (*project.scene) paths << QString::fromUtf8(project.scene);
    paths << QString::fromUtf8(project.entry) << manifest;
    return paths;
}

QByteArray bytesFor(const StudioDraft &draft, const NovaProject &project, const QString &path, const QString &manifest)
{
    if (path == manifest) return draft.manifest;
    if (path == QString::fromUtf8(project.entry)) return draft.script;
    return draft.scene;
}

QByteArray record(const QString &manifest, const StudioDraft &draft, const NovaProject &project,
    const std::map<QString, std::unique_ptr<File>> &files)
{
    QJsonArray entries;
    for (const QString &path : pathsFor(project, manifest))
        entries.append(QJsonObject{{"path", path},
            {"before", QString::fromLatin1(files.at(path)->saved().toBase64())},
            {"after", QString::fromLatin1(bytesFor(draft, project, path, manifest).toBase64())}});
    return QJsonDocument(QJsonObject{{"format", "nova-studio-recovery"}, {"version", 1},
        {"manifest", manifest}, {"selection", draft.selection},
        {"time", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)}, {"files", entries}}).toJson();
}

struct RecoveredFile { QString path; QByteArray before, after; };
struct Recovery {
    QString manifest, selection, time;
    std::vector<RecoveredFile> files;
};

bool parseRecord(const QByteArray &bytes, const QString &manifest, Recovery *result, QString *error)
{
    QJsonParseError jsonError;
    const QJsonDocument parsed = QJsonDocument::fromJson(bytes, &jsonError);
    if (jsonError.error != QJsonParseError::NoError || !parsed.isObject())
        return failure(error, "Recovery is not valid JSON: " + jsonError.errorString());
    const auto json = parsed.object();
    if (json.size() != 6 || json.value("format") != "nova-studio-recovery" ||
        !json.value("version").isDouble() || json.value("version").toDouble() != 1 ||
        json.value("manifest") != manifest || !json.value("files").isArray() ||
        !json.value("selection").isString() || !json.value("time").isString())
        return failure(error, "Unsupported recovery format or project identity; file retained.");
    Recovery recovery{manifest, json.value("selection").toString(), json.value("time").toString(), {}};
    QSet<QString> seen;
    for (const auto value : json.value("files").toArray()) {
        const auto entry = value.toObject();
        const auto path = entry.value("path").toString();
        const auto encoded = path.toUtf8();
        if (entry.size() != 3 || !entry.value("before").isString() || !entry.value("after").isString() ||
            !nova_project_relative_path(encoded.constData()) || path == journalName ||
            path == recoveryName || path == ".nova-studio-lock" ||
            seen.contains(path) || recovery.files.size() >= 3)
            return failure(error, "Recovery contains invalid or duplicate document paths; file retained.");
        seen.insert(path);
        const auto before = QByteArray::fromBase64Encoding(entry.value("before").toString().toLatin1(), QByteArray::AbortOnBase64DecodingErrors);
        const auto after = QByteArray::fromBase64Encoding(entry.value("after").toString().toLatin1(), QByteArray::AbortOnBase64DecodingErrors);
        if (!before || !after || size_t(before.decoded.size()) > limitFor(path) ||
            size_t(after.decoded.size()) > limitFor(path) || !utf8(before.decoded) || !utf8(after.decoded))
            return failure(error, "Recovery contains invalid or oversized document data; file retained.");
        recovery.files.push_back({path, before.decoded, after.decoded});
    }
    const auto found = std::find_if(recovery.files.begin(), recovery.files.end(),
        [&manifest](const RecoveredFile &file) { return file.path == manifest; });
    if (found == recovery.files.end()) return failure(error, "Recovery manifest is missing.");
    NovaProject project{}, base{};
    char detail[1024] = {};
    if (!nova_project_parse(&project, found->after.constData(), size_t(found->after.size()), detail, sizeof(detail)) ||
        !nova_project_parse(&base, found->before.constData(), size_t(found->before.size()), detail, sizeof(detail)))
        return failure(error, QString::fromUtf8(detail));
    const auto expected = pathsFor(project, manifest);
    if (expected != pathsFor(base, manifest) || seen != QSet<QString>(expected.begin(), expected.end()) ||
        expected.size() != qsizetype(recovery.files.size()))
        return failure(error, "Recovery may not redirect script/scene paths or add unrelated documents.");
    for (qsizetype i = 0; i < expected.size(); ++i)
        if (recovery.files[size_t(i)].path != expected[i])
            return failure(error, "Recovery document commit order is invalid.");
    if (*project.scene) {
        NovaScene scene{};
        const auto &data = recovery.files.front().after;
        if (!nova_scene_parse(&scene, data.constData(), size_t(data.size()), project.assets,
            project.count, detail, sizeof(detail))) return failure(error, QString::fromUtf8(detail));
    }
    *result = std::move(recovery);
    return true;
}

bool lockRoot(const QString &root, std::unique_ptr<QLockFile> *lock, QString *error)
{
    if (!QFileInfo(root).isDir() || QFileInfo(root).isSymLink())
        return failure(error, "Project root must be a real directory, not a symlink.");
    const QString path = QDir(root).filePath(".nova-studio-lock");
    if (QFileInfo(path).isSymLink()) return failure(error, "Project lock must not be a symlink.");
    auto candidate = std::make_unique<QLockFile>(path);
    candidate->setStaleLockTime(0);
    if (!candidate->tryLock()) return failure(error, "This project is locked by another Studio session, or the directory is not writable.");
    *lock = std::move(candidate);
    return true;
}

bool finishCommit(const QString &root, const QString &manifest, QString *error)
{
    File journal;
    if (!journal.open(root, journalName, JournalLimit, true, error)) return false;
    Recovery recovery;
    if (!parseRecord(journal.text(), manifest, &recovery, error)) return false;
    std::vector<std::unique_ptr<File>> files;
    for (const auto &entry : recovery.files) {
        auto file = std::make_unique<File>();
        if (!file->open(root, entry.path, limitFor(entry.path), false, error)) return false;
        if (file->saved() != entry.before && file->saved() != entry.after)
            return failure(error, "Recovery refused: " + entry.path + " was edited externally. No recovery writes started; journal retained.");
        files.push_back(std::move(file));
    }
    for (size_t i = 0; i < files.size(); ++i)
        if (files[i]->saved() != recovery.files[i].after &&
            (!files[i]->replace(recovery.files[i].after, error) || !files[i]->save(error))) return false;
    for (const auto &file : files) if (!file->check(error)) return false;
    return journal.remove(error);
}
}

struct ProjectDocument::DiskState {
    std::map<QString, std::unique_ptr<File>> files;
    std::unique_ptr<File> recovery;
};

class DraftCommand final : public QUndoCommand {
public:
    DraftCommand(ProjectDocument *owner, StudioDraft before, StudioDraft after, const QString &name, bool textEdit)
        : owner_(owner), before_(std::move(before)), after_(std::move(after)), textEdit_(textEdit),
          time_(QDateTime::currentMSecsSinceEpoch()) { setText(name); }
    void undo() override { owner_->apply(before_); }
    void redo() override { owner_->apply(after_); }
    int id() const override { return textEdit_ ? 1 : -1; }
    bool mergeWith(const QUndoCommand *command) override
    {
        const auto *next = dynamic_cast<const DraftCommand *>(command);
        if (!next || next->owner_ != owner_ || next->time_ - time_ > 750 ||
            after_.script != next->before_.script || after_.selection != next->after_.selection) return false;
        after_ = next->after_;
        time_ = next->time_;
        return true;
    }
private:
    ProjectDocument *owner_;
    StudioDraft before_, after_;
    bool textEdit_;
    qint64 time_;
};

ProjectDocument::ProjectDocument(QObject *parent)
    : QObject(parent), recoveryTimer_(new QTimer(this)), watcher_(new QFileSystemWatcher(this))
{
    undo_.setUndoLimit(256);
    recoveryTimer_->setSingleShot(true);
    recoveryTimer_->setInterval(600);
    connect(recoveryTimer_, &QTimer::timeout, this, [this] {
        QString error;
        if (dirty() && !writeRecovery(&error)) emit problem("Recovery could not be written: " + error);
    });
    const auto observe = [this] {
        if (writing_) return;
        QString error;
        const bool previous = externalChanged_;
        externalChanged_ = !checkExternal(&error);
        if (externalChanged_ || previous) emit externalChange(error);
        watch();
    };
    connect(watcher_, &QFileSystemWatcher::fileChanged, this, observe);
    connect(watcher_, &QFileSystemWatcher::directoryChanged, this, observe);
}

ProjectDocument::~ProjectDocument() = default;

bool ProjectDocument::parse(const StudioDraft &draft, NovaProject *project, NovaScene *scene, QString *error) const
{
    char detail[1024] = {};
    if (!nova_project_parse(project, draft.manifest.constData(), size_t(draft.manifest.size()), detail, sizeof(detail)))
        return failure(error, QString::fromUtf8(detail));
    if (!utf8(draft.script) || draft.script.size() > NOVA_SOURCE_EDIT_LIMIT)
        return failure(error, "Lua must be valid UTF-8 without NUL and at most 256 KiB.");
    if (project->version == 3 &&
        !nova_scene_parse(scene, draft.scene.constData(), size_t(draft.scene.size()),
            project->assets, project->count, detail, sizeof(detail)))
        return failure(error, QString::fromUtf8(detail));
    return true;
}

bool ProjectDocument::open(const QString &manifestPath, QString *error)
{
    const QFileInfo info(manifestPath);
    if (info.isSymLink() || !info.isFile() || !info.fileName().endsWith(".project"))
        return failure(error, "Choose a regular .project manifest. Legacy .nova-game projects belong in the compatibility editor.");
    const QString root = info.absolutePath(), path = info.absoluteFilePath();
    if (QFileInfo::exists(QDir(root).filePath(journalName)))
        return failure(error, "Interrupted save requires recovery before opening this project.");
    std::unique_ptr<QLockFile> candidateLock;
    if (path != path_ && !lockRoot(root, &candidateLock, error)) return false;
    auto state = std::make_unique<DiskState>();
    auto manifest = std::make_unique<File>();
    if (!manifest->open(root, info.fileName(), NOVA_MANIFEST_LIMIT, false, error)) return false;
    StudioDraft draft;
    draft.manifest = manifest->text();
    state->files.emplace(info.fileName(), std::move(manifest));
    NovaProject project{};
    NovaScene scene{};
    char detail[1024] = {};
    if (!nova_project_parse(&project, draft.manifest.constData(), size_t(draft.manifest.size()), detail, sizeof(detail)))
        return failure(error, QString::fromUtf8(detail));
    for (const QString &relative : pathsFor(project, info.fileName())) {
        if (relative == info.fileName()) continue;
        auto file = std::make_unique<File>();
        if (!file->open(root, relative, limitFor(relative), false, error)) return false;
        if (relative == QString::fromUtf8(project.entry)) draft.script = file->text();
        else draft.scene = file->text();
        state->files.emplace(relative, std::move(file));
    }
    if (!parse(draft, &project, &scene, error)) return false;
    state->recovery = std::make_unique<File>();
    if (!state->recovery->open(root, recoveryName, JournalLimit, true, error)) return false;
    if (candidateLock) lock_ = std::move(candidateLock);
    recoveryTimer_->stop();
    disk_ = std::move(state);
    path_ = path; root_ = root;
    draft_ = draft; project_ = project; scene_ = scene;
    externalChanged_ = false;
    recoveryPending_ = !disk_->recovery->saved().isEmpty();
    generated_ = QString::fromUtf8(project.entry) == "game.generated.lua" ||
        (info.fileName() == "game.project" && QFileInfo::exists(QDir(root).filePath("game.nova-game")));
    undo_.clear();
    watch();
    emit changed();
    return true;
}

bool ProjectDocument::create(const QString &parentDirectory, const QString &name, bool threeD,
    const QString &examples, QString *error)
{
    if (name.trimmed().isEmpty() || name == "." || name == ".." || name.contains('/') ||
        name.contains('\\') || name.contains(QChar::Null))
        return failure(error, "Use a nonempty project folder name without path separators.");
    QDir parent(parentDirectory);
    if (!parent.exists() || !parent.mkdir(name))
        return failure(error, "Could not exclusively create the new project directory; choose a fresh name and writable location.");
    const QString root = parent.filePath(name);
    const QString assetName = threeD ? "starter.glb" : "starter.png";
    const QString original = QDir(examples).filePath(threeD ? "assets/assets/gem.glb" : "sprites/assets/token.png");
    QFile source(original);
    if (!source.open(QIODevice::ReadOnly))
        return failure(error, "Starter asset is unavailable. The incomplete project directory is retained: " + root);
    const QByteArray asset = source.readAll();
    NovaScene scene{};
    scene.mode = threeD ? NOVA_3D : NOVA_2D;
    scene.background = {18, 24, 41, 255};
    scene.camera_position = {7, 6, 9}; scene.camera_target = {0, 0, 0}; scene.camera_fov = 50;
    scene.count = 1;
    auto &object = scene.objects[0];
    std::strcpy(object.id, "player"); std::strcpy(object.name, "Player");
    std::strcpy(object.asset, "starter");
    object.type = threeD ? NOVA_MODEL : NOVA_SPRITE;
    object.position = threeD ? NovaVec3{0, 0, 0} : NovaVec3{448, 238, 0};
    object.size = threeD ? NovaVec3{1, 1, 1} : NovaVec3{64, 64, 1};
    object.color = {255, 255, 255, 255};
    const QByteArray manifest = "nova-project 3\nidentity " +
        QUuid::createUuid().toString(QUuid::WithoutBraces).toLatin1() +
        "\nentry main.lua\nscene start.nova-scene\n" +
        (threeD ? "model" : "sprite") + QByteArray(" starter ") + assetName.toLatin1() + "\n";
    const QByteArray script = "-- Scene layout belongs to start.nova-scene. This is your editable gameplay.\n"
        "local player = nova.object(\"player\")\n\n"
        "function update(dt, input)\n"
        "    local x, y, z = nova.position(player)\n" +
        (threeD ? QByteArray("    x = x + input.horizontal * 3 * dt\n    z = z + input.vertical * 3 * dt\n") :
                  QByteArray("    x = x + input.horizontal * 180 * dt\n    y = y + input.vertical * 180 * dt\n")) +
        "    nova.set_position(player, x, y, z)\nend\n";
    const std::array<std::pair<QString, QByteArray>, 5> outputs{{
        {assetName, asset}, {"start.nova-scene", serialize(scene)}, {"main.lua", script},
        {"NOTICE.txt", "Starter art: original Nova Studio samples, CC0. Gameplay source: MIT.\n"},
        {"nova.project", manifest}}};
    for (const auto &output : outputs) {
        File file;
        if (!file.open(root, output.first, NOVA_ASSET_FILE_LIMIT, true, error, true) ||
            file.document.saved.info.st_ino || !file.replace(output.second, error) || !file.save(error)) {
            if (error) *error += "\nCreation is incomplete; files are retained in " + root;
            return false;
        }
    }
    return open(QDir(root).filePath("nova.project"), error);
}

bool ProjectDocument::dirty() const
{
    if (!disk_) return false;
    if (QFileInfo::exists(QDir(root_).filePath(journalName))) return true;
    for (const auto &file : disk_->files)
        if (file.second->saved() != bytesFor(draft_, project_, file.first, QFileInfo(path_).fileName())) return true;
    return false;
}

void ProjectDocument::apply(const StudioDraft &draft)
{
    NovaProject project{};
    NovaScene scene{};
    QString error;
    if (!parse(draft, &project, &scene, &error)) { emit problem(error); return; }
    const bool selectionChanged = draft.selection != draft_.selection;
    draft_ = draft; project_ = project; scene_ = scene;
    recoveryTimer_->start();
    emit changed();
    if (selectionChanged) emit this->selectionChanged();
}

void ProjectDocument::push(const StudioDraft &draft, const QString &operation, bool textEdit)
{
    undo_.push(new DraftCommand(this, draft_, draft, operation, textEdit));
}

void ProjectDocument::select(const QString &id)
{
    if (draft_.selection == id) return;
    draft_.selection = id;
    emit selectionChanged();
}

bool ProjectDocument::editScript(const QString &text, QString *error)
{
    if (generated_) return failure(error, "This Lua file is owned by a legacy generated project; use its compatibility editor.");
    StudioDraft next = draft_;
    next.script = text.toUtf8();
    if (draft_.script.contains("\r\n")) next.script.replace("\n", "\r\n");
    NovaProject parsed{};
    NovaScene scene{};
    if (!parse(next, &parsed, &scene, error)) return false;
    if (next.script != draft_.script) push(next, "Edit Lua", true);
    return true;
}

QByteArray ProjectDocument::serialize(const NovaScene &scene)
{
    QByteArray text = "nova-scene 1\nmode " + QByteArray(scene.mode == NOVA_2D ? "2d" : scene.mode == NOVA_3D ? "3d" : "mixed");
    const auto n = [](float value) { return QByteArray::number(double(value), 'g', 9); };
    const auto v = [&n](NovaVec3 value) { return n(value.x) + " " + n(value.y) + " " + n(value.z); };
    const auto c = [](NovaColor value) { return QByteArray::number(value.r) + " " + QByteArray::number(value.g) + " " + QByteArray::number(value.b); };
    text += "\nbackground " + c(scene.background) + "\ncamera " + v(scene.camera_position) + " " +
        v(scene.camera_target) + " " + n(scene.camera_fov) + "\n";
    for (size_t i = 0; i < scene.count; ++i) {
        const auto &object = scene.objects[i];
        const char *type = object.type == NOVA_RECTANGLE ? "rectangle" : object.type == NOVA_CUBE ? "cube" :
            object.type == NOVA_SPRITE ? "sprite" : "model";
        text += "object " + QByteArray(object.id) + " " + type + " " +
            (*object.asset ? QByteArray(object.asset) : QByteArray("-")) + " " +
            v(object.position) + " " + v(object.size) + " " + c(object.color) + " " + object.name + "\n";
    }
    return text;
}

bool ProjectDocument::editScene(const NovaScene &scene, const QString &selection, const QString &operation, QString *error)
{
    if (generated_) return failure(error, "Generated project ownership is read-only here; use the compatibility editor.");
    if (!visual()) return failure(error, "This project has no authored scene. Its Lua is not converted or regenerated.");
    StudioDraft next = draft_;
    next.scene = serialize(scene); next.selection = selection;
    NovaProject parsed{};
    NovaScene parsedScene{};
    if (!parse(next, &parsed, &parsedScene, error)) return false;
    if (next.scene != draft_.scene) push(next, operation, false);
    else select(selection);
    return true;
}

void ProjectDocument::watch()
{
    if (!watcher_->files().isEmpty()) watcher_->removePaths(watcher_->files());
    if (!watcher_->directories().isEmpty()) watcher_->removePaths(watcher_->directories());
    if (!disk_) return;
    QStringList paths{root_};
    for (const auto &entry : disk_->files) {
        const auto path = QDir(root_).filePath(entry.first);
        paths << path << QFileInfo(path).absolutePath();
    }
    paths.removeDuplicates();
    watcher_->addPaths(paths);
}

bool ProjectDocument::checkExternal(QString *error) const
{
    if (!disk_) return true;
    for (const auto &entry : disk_->files)
        if (!entry.second->check(error)) {
            if (error) *error = entry.first + ": " + *error;
            return false;
        }
    return true;
}

QString ProjectDocument::comparison() const
{
    QString result;
    if (!disk_) return result;
    for (const auto &entry : disk_->files) {
        File current;
        QString error;
        result += "\n=== " + entry.first + " ===\nSAVED BASE:\n" + QString::fromUtf8(entry.second->saved()) +
            "\nYOUR DRAFT:\n" + QString::fromUtf8(bytesFor(draft_, project_, entry.first, QFileInfo(path_).fileName()));
        if (current.open(root_, entry.first, limitFor(entry.first), false, &error))
            result += "\nCURRENT DISK:\n" + QString::fromUtf8(current.text());
        else result += "\nDISK ERROR: " + error;
    }
    return result;
}

bool ProjectDocument::writeRecovery(QString *error)
{
    if (!disk_ || !dirty()) return true;
    if (recoveryPending_)
        return failure(error, "An older recovery snapshot needs an explicit Restore or Discard decision; it has not been overwritten.");
    return disk_->recovery->replace(record(QFileInfo(path_).fileName(), draft_, project_, disk_->files), error) &&
        disk_->recovery->save(error);
}

QString ProjectDocument::recoveryDescription() const
{
    if (!disk_ || disk_->recovery->saved().isEmpty()) return {};
    Recovery recovery;
    QString error;
    if (!parseRecord(disk_->recovery->saved(), QFileInfo(path_).fileName(), &recovery, &error)) return error;
    return "Unsaved authoring snapshot from " + recovery.time + "\n" +
        QString::number(recovery.files.size()) + " documents. Saved project files have not been replaced.";
}

QString ProjectDocument::recoveryPreview() const
{
    if (!disk_) return {};
    Recovery recovery;
    QString error, result;
    if (!parseRecord(disk_->recovery->saved(), QFileInfo(path_).fileName(), &recovery, &error)) return error;
    for (const auto &entry : recovery.files)
        result += "=== " + entry.path + " ===\nSAVED BASE:\n" + QString::fromUtf8(entry.before) +
            "\nRECOVERABLE DRAFT:\n" + QString::fromUtf8(entry.after) + "\n";
    return result;
}

bool ProjectDocument::saveRecoveryCopy(const QString &destination, QString *error) const
{
    if (!disk_) return failure(error, "No project is open.");
    const QFileInfo target(destination);
    File copy;
    if (!copy.open(target.absolutePath(), target.fileName(), JournalLimit, true, error)) return false;
    if (copy.document.saved.info.st_ino)
        return failure(error, "Choose a new recovery-copy filename. Existing files are never replaced.");
    return copy.replace(record(QFileInfo(path_).fileName(), draft_, project_, disk_->files), error) && copy.save(error);
}

bool ProjectDocument::restoreRecovery(QString *error)
{
    if (!disk_) return failure(error, "No project is open.");
    Recovery recovery;
    if (!parseRecord(disk_->recovery->saved(), QFileInfo(path_).fileName(), &recovery, error)) return false;
    StudioDraft next = draft_;
    for (const auto &entry : recovery.files) {
        const auto &file = disk_->files.at(entry.path);
        if (!file->check(error)) return false;
        if (file->saved() != entry.before && file->saved() != entry.after)
            return failure(error, "External edits conflict with recovery: " + entry.path + ". Recovery is retained; compare or save a separate copy.");
        if (entry.path == QFileInfo(path_).fileName()) next.manifest = entry.after;
        else if (entry.path == QString::fromUtf8(project_.entry)) next.script = entry.after;
        else next.scene = entry.after;
    }
    next.selection = recovery.selection;
    recoveryPending_ = false;
    push(next, "Recover authoring draft", false);
    return true;
}

bool ProjectDocument::discardRecovery(QString *error)
{
    recoveryTimer_->stop();
    if (!disk_) return true;
    if (!disk_->recovery->remove(error)) return false;
    recoveryPending_ = false;
    disk_->recovery = std::make_unique<File>();
    return disk_->recovery->open(root_, recoveryName, JournalLimit, true, error);
}

bool ProjectDocument::save(QString *error)
{
    if (!disk_) return failure(error, "No project is open.");
    if (generated_) return failure(error, "Legacy generated outputs are read-only here. Use the compatibility editor.");
    if (!checkExternal(error)) return false;
    if (externalChanged_) { externalChanged_ = false; emit externalChange({}); }
    if (!dirty()) return true;
    if (!writeRecovery(error)) return false;
    File journal;
    if (!journal.open(root_, journalName, JournalLimit, true, error)) return false;
    if (journal.document.saved.info.st_ino)
        return failure(error, "An interrupted commit exists. Reopen to review recovery; no new files were overwritten.");
    if (!journal.replace(record(QFileInfo(path_).fileName(), draft_, project_, disk_->files), error) || !journal.save(error))
        return false;
    writing_ = true;
    size_t written = 0;
    bool ok = true;
    for (const QString &path : pathsFor(project_, QFileInfo(path_).fileName())) {
        auto &file = disk_->files.at(path);
        const auto bytes = bytesFor(draft_, project_, path, QFileInfo(path_).fileName());
        if (file->saved() != bytes) {
            if (!file->replace(bytes, error) || !file->save(error)) { ok = false; break; }
            ++written;
        }
    }
    if (ok) ok = checkExternal(error);
    if (ok) ok = journal.remove(error);
    writing_ = false;
    watch();
    if (!ok) {
        if (error) *error = QString("Save interrupted after %1 writes. Journal and draft retained; reopen to finish recovery.\n").arg(written) + *error;
        emit changed();
        return false;
    }
    undo_.setClean();
    if (!discardRecovery(error)) {
        if (error) *error = "Project committed, but recovery cleanup failed: " + *error;
        emit changed();
        return false;
    }
    emit changed();
    return true;
}

QString ProjectDocument::interruptedSaveDescription(const QString &manifestPath)
{
    File file;
    QString error;
    const QFileInfo info(manifestPath);
    if (!QFileInfo::exists(QDir(info.absolutePath()).filePath(journalName))) return {};
    if (!file.open(info.absolutePath(), journalName, JournalLimit, true, &error)) return error;
    Recovery recovery;
    if (!parseRecord(file.text(), info.fileName(), &recovery, &error)) return error;
    return "Interrupted save from " + recovery.time + ".\nFinish the recorded project snapshot only if every file still matches its recorded old or new version.";
}

bool ProjectDocument::finishInterruptedSave(const QString &manifestPath, QString *error)
{
    const QFileInfo info(manifestPath);
    const QString root = info.absolutePath();
    std::unique_ptr<QLockFile> lock;
    if (!lockRoot(root, &lock, error)) return false;
    return finishCommit(root, info.fileName(), error);
}

bool ProjectDocument::resumeInterruptedSave(QString *error)
{
    if (!disk_ || !lock_) return failure(error, "No locked project is open.");
    const StudioDraft current = draft_;
    if (!writeRecovery(error)) return false;
    const QByteArray recoveryBytes = disk_->recovery->saved();
    recoveryTimer_->stop();
    writing_ = true;
    const bool finished = finishCommit(root_, QFileInfo(path_).fileName(), error);
    writing_ = false;
    if (!finished) { watch(); return false; }
    if (!open(path_, error)) return false;
    if (current.manifest != draft_.manifest || current.scene != draft_.scene || current.script != draft_.script) {
        push(current, "Retain edits after interrupted save", false);
    } else select(current.selection);
    if (disk_->recovery->saved() != recoveryBytes)
        return failure(error, "Recorded commit completed, but the recovery file changed externally. Your newer draft and that recovery are both retained.");
    recoveryPending_ = false;
    return dirty() ? writeRecovery(error) : discardRecovery(error);
}

bool ProjectDocument::importAsset(const QString &source, QString *id, QString *error)
{
    if (!disk_ || generated_) return failure(error, "Open an editable project before importing.");
    if (!checkExternal(error)) return false;
    if (project_.count >= NOVA_MAX_ASSETS) return failure(error, "The project already has 32 assets.");
    QFile input(source);
    if (!input.open(QIODevice::ReadOnly) || input.size() <= 0 || input.size() > NOVA_ASSET_FILE_LIMIT)
        return failure(error, "Import requires a readable file of at most 16 MiB.");
    const QByteArray bytes = input.read(NOVA_ASSET_FILE_LIMIT + 1);
    if (bytes.size() > NOVA_ASSET_FILE_LIMIT || bytes.size() != input.size())
        return failure(error, "The import file changed size or exceeds 16 MiB.");
    char detail[1024] = {};
    const QString suffix = QFileInfo(source).suffix().toLower();
    QString type;
    bool valid = false;
    if (suffix == "png") {
        Image image{};
        valid = nova_decode_sprite(reinterpret_cast<const unsigned char *>(bytes.constData()), int(bytes.size()), &image, detail, sizeof(detail));
        UnloadImage(image); type = "sprite";
    } else if (suffix == "glb") {
        Model model{};
        NovaModelImages images{};
        valid = nova_decode_glb_images(reinterpret_cast<const unsigned char *>(bytes.constData()), int(bytes.size()), &model, &images, detail, sizeof(detail));
        nova_unload_cpu_model(&model); nova_unload_model_images(&images); type = "model";
    } else return failure(error, "This slice imports PNG sprites and the documented static GLB subset only.");
    if (!valid) return failure(error, QString::fromUtf8(detail));
    QString base = QFileInfo(source).completeBaseName().left(40);
    base.replace(QRegularExpression("[^A-Za-z0-9_-]"), "_");
    if (base.isEmpty()) base = "asset";
    QString identity = base;
    for (unsigned suffix = 2;; ++suffix) {
        bool used = false;
        for (size_t i = 0; i < project_.count; ++i)
            if (identity == QString::fromUtf8(project_.assets[i].id)) used = true;
        if (!used) break;
        identity = base + "-" + QString::number(suffix);
    }
    const QString relative = "assets/asset-" + QUuid::createUuid().toString(QUuid::WithoutBraces) + "." + suffix;
    if (!QDir(root_).exists("assets") && !QDir(root_).mkdir("assets"))
        return failure(error, "Could not create the contained assets directory.");
    File copy;
    if (!copy.open(root_, relative, NOVA_ASSET_FILE_LIMIT, true, error, true)) return false;
    const auto &rootInfo = disk_->files.at(QFileInfo(path_).fileName())->document.root_info;
    if (copy.document.root_info.st_dev != rootInfo.st_dev || copy.document.root_info.st_ino != rootInfo.st_ino)
        return failure(error, "The project root changed during import; no asset was copied.");
    if (copy.document.saved.info.st_ino) return failure(error, "Import destination already exists; no files overwritten.");
    StudioDraft next = draft_;
    if (!next.manifest.endsWith('\n')) next.manifest += '\n';
    next.manifest += (type + " " + identity + " " + relative + "\n").toLatin1();
    NovaProject project{};
    NovaScene scene{};
    if (!parse(next, &project, &scene, error)) return false;
    if (!copy.replace(bytes, error) || !copy.save(error)) return false;
    push(next, "Register imported " + type, false);
    *id = identity;
    return true;
}
