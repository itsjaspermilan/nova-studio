#include "project_document.h"
#include <QCryptographicHash>
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
#include <QScopedValueRollback>
#include <QStringDecoder>
#include <QTimer>
#include <QTemporaryDir>
#include <QUuid>
#include <array>
#include <algorithm>
#include <cstring>
#include <map>
#include <limits>
#include <vector>
#include <cerrno>
#include <fcntl.h>
#include <unistd.h>

extern "C" {
#include "document.h"
#include "assets.h"
}

namespace {
const QString journalName = QStringLiteral(".nova-studio-journal");
const QString recoveryName = QStringLiteral(".nova-studio-recovery");
const QString indexName = QStringLiteral(".nova-studio-assets");
const QString blobDirectory = QStringLiteral(".nova-studio-snapshots");
constexpr size_t JournalLimit = 2 * 1024 * 1024;
constexpr qsizetype IndexLimit = 1024 * 1024, MetadataLimit = 64 * 1024;
constexpr qint64 RecoveryDataLimit = 2 * ProjectDocument::AssetSnapshotLimit + 4 * JournalLimit;
constexpr qint64 BlobStoreLimit = 2 * RecoveryDataLimit;
static_assert(ProjectDocument::AssetSourceLimit == NOVA_AUTHORED_SOURCE_LIMIT);
static_assert(ProjectDocument::AssetFileLimit == NOVA_ASSET_FILE_LIMIT);

bool failure(QString *error, const QString &message)
{
    if (error) *error = message;
    return false;
}

bool validPath(const QString &path)
{
    const auto bytes = path.toUtf8();
    return QString::fromUtf8(bytes) == path && !bytes.contains('\0') && nova_project_relative_path(bytes.constData());
}

QString pathKey(const QString &path)
{
    return path.normalized(QString::NormalizationForm_C).toCaseFolded();
}

bool sameRoot(const struct stat &a, const struct stat &b)
{
    return a.st_dev == b.st_dev && a.st_ino == b.st_ino;
}

enum class ParentState { Present, Missing, Error };

ParentState parents(const QString &root, const QString &relative, struct stat *identity,
    const struct stat *expected, bool create, QString *error)
{
    if (!validPath(relative)) { failure(error, "Invalid contained authoring path: " + relative); return ParentState::Error; }
    int fd = ::open(root.toUtf8().constData(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) { failure(error, "Cannot open project root: " + QString::fromLocal8Bit(std::strerror(errno))); return ParentState::Error; }
    if (fstat(fd, identity) || (expected && !sameRoot(*identity, *expected))) {
        close(fd); failure(error, "Project root was replaced; reopen explicitly."); return ParentState::Error;
    }
    const auto segments = relative.split('/');
    for (qsizetype i = 0; i + 1 < segments.size(); ++i) {
        const auto name = segments[i].toUtf8();
        int next = openat(fd, name.constData(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        if (next < 0 && errno == ENOENT && create) {
            if (mkdirat(fd, name.constData(), 0700) && errno != EEXIST) {
                close(fd); failure(error, "Cannot create contained authoring directory: " + relative); return ParentState::Error;
            }
            if (fsync(fd)) {
                close(fd); failure(error, "Created authoring directory could not be synced: " + relative); return ParentState::Error;
            }
            next = openat(fd, name.constData(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        }
        const int reason = errno;
        close(fd);
        if (next < 0) {
            if (reason == ENOENT && !create) return ParentState::Missing;
            failure(error, "Cannot traverse contained authoring directory (symlinks are refused): " + relative);
            return ParentState::Error;
        }
        fd = next;
    }
    close(fd);
    return ParentState::Present;
}

struct File {
    NovaDocument document{};
    bool missingParents = false, missingBinary = false;
    QString missingRoot, missingPath;
    struct stat missingIdentity{};
    size_t missingLimit = 0;
    QByteArray pending;
    mutable QByteArray savedHash;
    ~File() { nova_document_close(&document); }
    bool open(const QString &root, const QString &relative, size_t limit, bool output, QString *error,
        bool binary = false, bool allowMissingParents = false)
    {
        savedHash.clear();
        if (allowMissingParents && output) {
            struct stat identity{};
            const auto state = parents(root, relative, &identity, nullptr, false, error);
            if (state == ParentState::Error) return false;
            if (state == ParentState::Missing) {
                nova_document_close(&document);
                missingParents = true; missingBinary = binary; missingLimit = limit;
                missingRoot = root; missingPath = relative; missingIdentity = identity; pending.clear();
                return true;
            }
        }
        char detail[1024] = {};
        const auto r = root.toUtf8(), p = relative.toUtf8();
        bool ok = output && binary && limit > NOVA_ASSET_FILE_LIMIT ?
            nova_document_open_authored_source(&document, r.constData(), p.constData(), limit, detail, sizeof(detail)) : output ?
            nova_document_open_output(&document, r.constData(), p.constData(), limit, binary, detail, sizeof(detail)) :
            nova_document_open(&document, r.constData(), p.constData(), limit, detail, sizeof(detail));
        if (!ok) return failure(error, QString::fromUtf8(detail));
        missingParents = false;
        return true;
    }
    const struct stat &rootIdentity() const { return missingParents ? missingIdentity : document.root_info; }
    bool exists() const { return !missingParents && document.saved.info.st_ino; }
    QByteArray saved() const { return missingParents ? QByteArray() : QByteArray(document.saved.text, qsizetype(document.saved.length)); }
    QByteArray text() const { return missingParents ? pending : QByteArray(document.text, qsizetype(document.length)); }
    QByteArray savedDigest() const
    {
        if (savedHash.isEmpty())
            savedHash = QCryptographicHash::hash(missingParents ? QByteArrayView() :
                QByteArrayView(document.saved.text, qsizetype(document.saved.length)), QCryptographicHash::Sha256).toHex();
        return savedHash;
    }
    bool replace(const QByteArray &bytes, QString *error)
    {
        if (missingParents) {
            if (size_t(bytes.size()) > missingLimit || (!missingBinary && bytes.contains('\0')))
                return failure(error, "Authoring output exceeds its byte/encoding limit.");
            pending = bytes;
            return true;
        }
        char detail[1024] = {};
        if (!nova_document_replace(&document, 0, document.length, bytes.constData(), size_t(bytes.size()), detail, sizeof(detail)))
            return failure(error, QString::fromUtf8(detail));
        return true;
    }
    bool check(QString *error) const
    {
        if (missingParents) {
            File current;
            if (!current.open(missingRoot, missingPath, missingLimit, true, error, missingBinary, true)) return false;
            if (!sameRoot(current.rootIdentity(), missingIdentity) || current.exists())
                return failure(error, "Expected absent authoring output changed externally: " + missingPath);
            return true;
        }
        char detail[1024] = {};
        if (!nova_document_check_disk(const_cast<NovaDocument *>(&document), detail, sizeof(detail)))
            return failure(error, QString::fromUtf8(detail));
        return true;
    }
    bool save(QString *error)
    {
        savedHash.clear();
        if (missingParents) {
            if (!check(error)) return false;
            struct stat identity{};
            if (parents(missingRoot, missingPath, &identity, &missingIdentity, true, error) != ParentState::Present) return false;
            File output;
            if (!output.open(missingRoot, missingPath, missingLimit, true, error, missingBinary) ||
                !sameRoot(output.rootIdentity(), missingIdentity)) return failure(error, "Output root changed before commit.");
            if (output.exists()) return failure(error, "New output appeared before commit; no file was overwritten: " + missingPath);
            if (!output.replace(pending, error)) return false;
            std::swap(document, output.document);
            missingParents = false; pending.clear();
        }
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

QByteArray digest(const QByteArray &bytes)
{
    return QCryptographicHash::hash(bytes, QCryptographicHash::Sha256).toHex();
}

StudioDiskVersion version(const File &file, const QString &path)
{
    const auto &root = file.rootIdentity();
    QByteArray stamp = QByteArray::number(qulonglong(root.st_dev)) + ":" +
        QByteArray::number(qulonglong(root.st_ino)) + ":" + path.toUtf8() + ":";
    if (file.exists()) {
        const auto &info = file.document.saved.info;
        stamp += QByteArray::number(qulonglong(info.st_dev)) + ":" + QByteArray::number(qulonglong(info.st_ino)) + ":" +
            QByteArray::number(qulonglong(info.st_mode)) + ":" + QByteArray::number(qulonglong(info.st_nlink)) + ":" +
            QByteArray::number(qlonglong(info.st_size)) + ":";
#ifdef __APPLE__
        const auto modified = info.st_mtimespec, changed = info.st_ctimespec;
#else
        const auto modified = info.st_mtim, changed = info.st_ctim;
#endif
        stamp += QByteArray::number(qlonglong(modified.tv_sec)) + ":" + QByteArray::number(qlonglong(modified.tv_nsec)) + ":" +
            QByteArray::number(qlonglong(changed.tv_sec)) + ":" + QByteArray::number(qlonglong(changed.tv_nsec)) + ":" +
            file.savedDigest();
    } else stamp += "absent";
    return {file.exists(), digest(stamp)};
}

bool hashString(const QByteArray &value)
{
    if (value.size() != 64) return false;
    for (const auto c : value) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    return true;
}

bool uniqueJsonKeys(const QByteArray &bytes)
{
    // Qt accepts duplicate keys; owned index/journal records must be unambiguous.
    struct Scope { bool object, key; QSet<QString> names; };
    QVector<Scope> scopes;
    for (qsizetype i = 0; i < bytes.size(); ++i) {
        const char c = bytes[i];
        if (c == '{' || c == '[') scopes.append({c == '{', c == '{', {}});
        else if (c == '}' || c == ']') {
            if (scopes.isEmpty()) return false;
            scopes.removeLast();
        } else if (c == ',' && !scopes.isEmpty() && scopes.last().object) scopes.last().key = true;
        else if (c == '"') {
            const auto start = i++;
            while (i < bytes.size() && bytes[i] != '"') {
                if (bytes[i] == '\\') ++i;
                ++i;
            }
            if (i >= bytes.size()) return false;
            if (!scopes.isEmpty() && scopes.last().object && scopes.last().key) {
                const auto literal = QJsonDocument::fromJson("[" + bytes.mid(start, i - start + 1) + "]").array();
                if (literal.size() != 1 || !literal[0].isString() || scopes.last().names.contains(literal[0].toString()))
                    return false;
                scopes.last().names.insert(literal[0].toString());
                scopes.last().key = false;
            }
        }
    }
    return scopes.isEmpty();
}

bool assetPath(const QString &path)
{
    if (!validPath(path)) return false;
    for (const auto &part : path.split('/'))
        if (part.startsWith(".nova-studio-", Qt::CaseInsensitive) || part.startsWith(".nova-edit-", Qt::CaseInsensitive))
            return false;
    return true;
}

bool validId(const QString &id)
{
    const auto bytes = id.toUtf8();
    return !bytes.contains('\0') && nova_asset_id_valid(bytes.constData());
}

QVector<StudioAssetFile> assetFiles(const StudioAssetSnapshot &snapshot)
{
    QVector<StudioAssetFile> files{snapshot.source};
    files += snapshot.outputs;
    return files;
}

QJsonObject assetFileJson(const StudioAssetFile &file)
{
    return {{"path", file.path}, {"size", double(file.bytes.size())},
        {"sha256", QString::fromLatin1(digest(file.bytes))}, {"runtimeId", file.runtimeId},
        {"runtimeType", file.runtimeId.isEmpty() ? -1 : int(file.runtimeType)}};
}

QJsonObject assetJson(const StudioAssetSnapshot &snapshot)
{
    QJsonArray outputs;
    for (const auto &file : snapshot.outputs) outputs.append(assetFileJson(file));
    return {{"id", snapshot.id}, {"kind", snapshot.kind}, {"revision", QString::number(snapshot.revision)},
        {"metadata", snapshot.metadata}, {"source", assetFileJson(snapshot.source)}, {"outputs", outputs},
        {"mode", snapshot.mode == StudioAssetSnapshot::Mode::SourceOnly ? "source-only" : "published"},
        {"derivedProblem", snapshot.derivedProblem}};
}

QByteArray snapshotDigest(const StudioAssetSnapshot &snapshot)
{
    return digest(QJsonDocument(assetJson(snapshot)).toJson(QJsonDocument::Compact));
}

struct AssetState {
    StudioAssetSnapshot snapshot;
    StudioAssetPublication publication;
    QJsonObject description;
    QByteArray hash;
};

using AssetStates = std::map<QString, AssetState>;
using Files = std::map<QString, std::unique_ptr<File>>;
using Payloads = std::map<QString, QByteArray>;
using Bindings = std::map<QString, StudioAssetFile>;

void seal(AssetState *state)
{
    state->description = assetJson(state->snapshot);
    state->hash = digest(QJsonDocument(state->description).toJson(QJsonDocument::Compact));
}

bool validateAssets(const AssetStates &states, const NovaProject &project, const QString &manifest, QString *error)
{
    if (states.size() > ProjectDocument::MaxAssetParticipants)
        return failure(error, "At most 16 authored asset participants are supported.");
    QSet<QString> paths{pathKey(manifest), pathKey(QString::fromUtf8(project.entry))};
    if (*project.scene) paths.insert(pathKey(QString::fromUtf8(project.scene)));
    QSet<QString> ids;
    qsizetype total = 0, count = 0;
    for (const auto &pair : states) {
        const auto &snapshot = pair.second.snapshot;
        if (pair.first != snapshot.id || !validId(snapshot.id) || !validId(snapshot.kind) || !snapshot.revision ||
            (snapshot.mode != StudioAssetSnapshot::Mode::PublishDerived && snapshot.mode != StudioAssetSnapshot::Mode::SourceOnly) ||
            QJsonDocument(snapshot.metadata).toJson(QJsonDocument::Compact).size() > MetadataLimit ||
            snapshot.derivedProblem.size() > 4096 ||
            (snapshot.mode == StudioAssetSnapshot::Mode::SourceOnly && snapshot.derivedProblem.trimmed().isEmpty()) ||
            (snapshot.mode == StudioAssetSnapshot::Mode::PublishDerived && !snapshot.derivedProblem.isEmpty()))
            return failure(error, "Asset ID/kind/revision, metadata limit or explicit publication status is invalid.");
        if (!snapshot.source.runtimeId.isEmpty())
            return failure(error, "Authored source cannot also be a runtime output.");
        if (snapshot.mode == StudioAssetSnapshot::Mode::PublishDerived &&
            std::none_of(snapshot.outputs.begin(), snapshot.outputs.end(),
                [](const StudioAssetFile &file) { return !file.runtimeId.isEmpty(); }))
            return failure(error, "Publishing requires a complete runtime output set; use explicit source-only mode when export is unavailable.");
        const auto files = assetFiles(snapshot);
        for (qsizetype i = 0; i < files.size(); ++i) {
            const auto &file = files[i];
            const qsizetype limit = i == 0 ? ProjectDocument::AssetSourceLimit : ProjectDocument::AssetFileLimit;
            const auto key = pathKey(file.path);
            if (!assetPath(file.path) || paths.contains(key) || file.bytes.size() > limit ||
                ++count > ProjectDocument::MaxAssetFiles || total > ProjectDocument::AssetSnapshotLimit - file.bytes.size())
                return failure(error, "Asset paths overlap, are reserved/invalid, or exceed the source/output/project byte limits: " + file.path);
            for (const auto &path : paths)
                if (key.startsWith(path + "/") || path.startsWith(key + "/"))
                    return failure(error, "An asset file path overlaps another document's parent directory: " + file.path);
            for (size_t j = 0; j < project.count; ++j) {
                const auto &asset = project.assets[j];
                const auto runtimePath = QString::fromUtf8(asset.path), runtimeKey = pathKey(runtimePath);
                if (key != runtimeKey) {
                    if (key.startsWith(runtimeKey + "/") || runtimeKey.startsWith(key + "/"))
                        return failure(error, "An asset file path overlaps a runtime asset's parent directory: " + file.path);
                    continue;
                }
                if (!i || file.runtimeId != QString::fromUtf8(asset.id) ||
                    file.runtimeType != asset.type || file.path != runtimePath)
                    return failure(error, "Authored payload overlaps an unrelated runtime asset: " +
                        QString::fromUtf8(asset.id) + " (" + runtimePath + "). Only an exact, explicitly bound output may adopt that runtime file.");
            }
            paths.insert(key); total += file.bytes.size();
            if (!file.runtimeId.isEmpty()) {
                if (!validId(file.runtimeId) || ids.contains(file.runtimeId) ||
                    (file.runtimeType != NOVA_ASSET_SPRITE && file.runtimeType != NOVA_ASSET_MODEL &&
                        file.runtimeType != NOVA_ASSET_AUDIO) ||
                    !file.path.endsWith(file.runtimeType == NOVA_ASSET_SPRITE ? ".png" :
                        file.runtimeType == NOVA_ASSET_MODEL ? ".glb" : ".wav"))
                    return failure(error, "Generated runtime bindings require unique sprite/model/audio IDs and matching PNG/GLB/WAV paths.");
                if (file.runtimeType == NOVA_ASSET_AUDIO && project.version < 2)
                    return failure(error, "Generated WAV publication requires manifest v2 or v3; this project has not been upgraded. Save source-only or use an audio-capable project.");
                ids.insert(file.runtimeId);
                bool declared = false;
                for (size_t j = 0; j < project.count; ++j)
                    if (QString::fromUtf8(project.assets[j].id) == file.runtimeId) {
                        declared = QString::fromUtf8(project.assets[j].path) == file.path &&
                            project.assets[j].type == file.runtimeType;
                        break;
                    }
                if (!declared) return failure(error, "Authored output binding differs from the runtime manifest: " + file.runtimeId);
            } else if (i && (file.path.endsWith(".png") || file.path.endsWith(".glb") || file.path.endsWith(".wav"))) {
                return failure(error, "Generated PNG/GLB/WAV outputs require explicit runtime bindings.");
            }
        }
    }
    return true;
}

QByteArray indexBytes(const AssetStates &states, const QString &manifest)
{
    QJsonArray assets;
    for (const auto &pair : states) {
        auto json = pair.second.description;
        const auto &publication = pair.second.publication;
        json.insert("digest", QString::fromLatin1(pair.second.hash));
        json.insert("publishedRevision", QString::number(publication.revision));
        json.insert("publishedSource", QString::fromLatin1(publication.sourceDigest));
        assets.append(json);
    }
    return QJsonDocument(QJsonObject{{"format", "nova-studio-assets"}, {"version", 1},
        {"manifest", manifest}, {"assets", assets}}).toJson(QJsonDocument::Compact);
}

bool decimal(const QJsonValue &value, quint64 *number)
{
    if (!value.isString()) return false;
    bool ok = false;
    *number = value.toString().toULongLong(&ok);
    return ok && QString::number(*number) == value.toString();
}

bool readIndexFile(const QJsonValue &value, const Payloads &payloads, StudioAssetFile *file, QString *error)
{
    const auto json = value.toObject();
    if (json.size() != 5 || !json["path"].isString() || !json["size"].isDouble() ||
        !json["sha256"].isString() || !json["runtimeId"].isString() || !json["runtimeType"].isDouble())
        return failure(error, "Malformed authored asset file descriptor.");
    const auto found = payloads.find(json["path"].toString());
    if (found == payloads.end() || double(found->second.size()) != json["size"].toDouble() ||
        digest(found->second) != json["sha256"].toString().toLatin1())
        return failure(error, "Authored source/output differs from its saved association: " + json["path"].toString());
    file->path = found->first; file->bytes = found->second; file->runtimeId = json["runtimeId"].toString();
    const double type = json["runtimeType"].toDouble();
    if (file->runtimeId.isEmpty() ? type != -1 :
        (type != NOVA_ASSET_SPRITE && type != NOVA_ASSET_MODEL && type != NOVA_ASSET_AUDIO))
        return failure(error, "Unsupported runtime binding in authoring index.");
    if (!file->runtimeId.isEmpty()) file->runtimeType = NovaAssetType(int(type));
    return true;
}

bool parseIndex(const QByteArray &bytes, const QString &manifest, const NovaProject &project,
    const Payloads &payloads, AssetStates *states, QString *error)
{
    QJsonParseError detail;
    const auto document = QJsonDocument::fromJson(bytes, &detail);
    const auto json = document.object();
    if (bytes.size() > IndexLimit || detail.error != QJsonParseError::NoError || json.size() != 4 ||
        json["format"] != "nova-studio-assets" || json["version"] != 1 || json["manifest"] != manifest ||
        !json["assets"].isArray() || json["assets"].toArray().size() > ProjectDocument::MaxAssetParticipants)
        return failure(error, "Unsupported or malformed authoring asset index; it has not been replaced.");
    if (!uniqueJsonKeys(bytes)) return failure(error, "Authoring index contains duplicate JSON keys; it has been retained.");
    AssetStates parsed;
    for (const auto value : json["assets"].toArray()) {
        const auto asset = value.toObject();
        AssetState state;
        auto &snapshot = state.snapshot;
        if (asset.size() != 11 || !asset["id"].isString() || !asset["kind"].isString() ||
            !asset["metadata"].isObject() || !asset["outputs"].isArray() ||
            !asset["derivedProblem"].isString() || !asset["digest"].isString() ||
            !asset["publishedSource"].isString() || !decimal(asset["revision"], &snapshot.revision) ||
            !decimal(asset["publishedRevision"], &state.publication.revision))
            return failure(error, "Malformed authored asset association.");
        snapshot.id = asset["id"].toString(); snapshot.kind = asset["kind"].toString();
        snapshot.metadata = asset["metadata"].toObject(); snapshot.derivedProblem = asset["derivedProblem"].toString();
        if (asset["mode"] == "source-only") snapshot.mode = StudioAssetSnapshot::Mode::SourceOnly;
        else if (asset["mode"] != "published") return failure(error, "Unknown asset publication mode.");
        if (!readIndexFile(asset["source"], payloads, &snapshot.source, error)) return false;
        for (const auto output : asset["outputs"].toArray()) {
            StudioAssetFile file;
            if (!readIndexFile(output, payloads, &file, error)) return false;
            snapshot.outputs.append(std::move(file));
        }
        state.publication.stale = snapshot.mode == StudioAssetSnapshot::Mode::SourceOnly;
        state.publication.problem = snapshot.derivedProblem;
        state.publication.sourceDigest = asset["publishedSource"].toString().toLatin1();
        seal(&state);
        if (parsed.count(snapshot.id) || state.hash != asset["digest"].toString().toLatin1() ||
            (!state.publication.stale && (state.publication.revision != snapshot.revision ||
                state.publication.sourceDigest != state.description["source"].toObject()["sha256"].toString().toLatin1())) ||
            (state.publication.revision ? !hashString(state.publication.sourceDigest) :
                (!state.publication.sourceDigest.isEmpty() || !snapshot.outputs.isEmpty())))
            return failure(error, "Authored asset digest/publication ownership is inconsistent.");
        parsed.emplace(snapshot.id, std::move(state));
    }
    if (!validateAssets(parsed, project, manifest, error)) return false;
    *states = std::move(parsed);
    return true;
}

bool indexInventory(const QByteArray &bytes, const QString &manifest, std::map<QString, size_t> *paths, QString *error)
{
    const auto json = QJsonDocument::fromJson(bytes).object();
    if (bytes.size() > IndexLimit || json["format"] != "nova-studio-assets" || json["version"] != 1 ||
        json["manifest"] != manifest || !json["assets"].isArray() ||
        json["assets"].toArray().size() > ProjectDocument::MaxAssetParticipants)
        return failure(error, "Unsupported authoring asset index.");
    if (!uniqueJsonKeys(bytes)) return failure(error, "Authoring index contains duplicate JSON keys.");
    std::map<QString, size_t> result;
    QSet<QString> keys;
    qint64 total = 0;
    for (const auto item : json["assets"].toArray()) {
        const auto asset = item.toObject();
        QJsonArray files{asset["source"]};
        for (const auto file : asset["outputs"].toArray()) files.append(file);
        for (qsizetype i = 0; i < files.size(); ++i) {
            const auto file = files[i].toObject();
            const auto path = file["path"].toString();
            const auto limit = size_t(i == 0 ? ProjectDocument::AssetSourceLimit : ProjectDocument::AssetFileLimit);
            const double length = file["size"].toDouble(-1);
            if (!assetPath(path) || keys.contains(pathKey(path)) || result.size() >= ProjectDocument::MaxAssetFiles ||
                !file["size"].isDouble() || file["size"].toDouble() < 0 || file["size"].toDouble() > double(limit))
                return failure(error, "Invalid or oversized authored asset inventory.");
            if (length != double(qint64(length)) || total > ProjectDocument::AssetSnapshotLimit - qint64(length))
                return failure(error, "Authored asset inventory exceeds the aggregate payload budget.");
            total += qint64(length);
            keys.insert(pathKey(path));
            result.emplace(path, limit);
        }
    }
    *paths = std::move(result);
    return true;
}

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

struct RecoveredFile {
    QString path;
    QByteArray before, after;
    size_t limit = 0;
    StudioDiskVersion expected, committed;
    bool attempted = false;
    QByteArray beforeHash = {}, afterHash = {};
};
struct Recovery {
    QString manifest, selection, time;
    std::vector<RecoveredFile> files;
    int version = 1;
    QString store = blobDirectory;
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
        recovery.files.push_back({path, before.decoded, after.decoded, 0, {}, {}, false});
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

QJsonObject blobJson(const QByteArray &bytes, bool exists, const QByteArray &hash)
{
    return {{"exists", exists}, {"size", double(bytes.size())},
        {"sha256", exists ? QString::fromLatin1(hash) : QString()}};
}

QByteArray recordV2(const Recovery &recovery)
{
    QJsonArray files;
    for (const auto &file : recovery.files) {
        auto before = blobJson(file.before, file.expected.exists, file.beforeHash);
        before.insert("version", QString::fromLatin1(file.expected.token));
        files.append(QJsonObject{{"path", file.path}, {"limit", double(file.limit)}, {"before", before},
            {"after", blobJson(file.after, true, file.afterHash)}, {"attempted", file.attempted},
            {"committed", QString::fromLatin1(file.committed.token)}});
    }
    return QJsonDocument(QJsonObject{{"format", "nova-studio-recovery"}, {"version", 2},
        {"manifest", recovery.manifest}, {"selection", recovery.selection}, {"time", recovery.time},
        {"store", recovery.store}, {"files", files}}).toJson(QJsonDocument::Compact);
}

QSet<QByteArray> blobReferences(const QByteArray &record)
{
    QSet<QByteArray> references;
    const auto json = QJsonDocument::fromJson(record).object();
    if (json["version"] != 2) return references;
    for (const auto value : json["files"].toArray()) {
        const auto file = value.toObject();
        for (const auto &key : {"before", "after"}) {
            const auto hash = file[key].toObject()["sha256"].toString().toLatin1();
            if (hashString(hash)) references.insert(hash);
        }
    }
    return references;
}

bool parseAnyRecord(const QString &root, const QByteArray &bytes, const QString &manifest, Recovery *record, QString *error);

bool syncBlob(const QString &root, const QString &store, const QString &name,
    const struct stat &identity, QString *error)
{
    const int rootFd = ::open(root.toUtf8().constData(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (rootFd < 0) return failure(error, "Cannot open the snapshot root for durability sync.");
    struct stat rootInfo{};
    const bool matchingRoot = !fstat(rootFd, &rootInfo) && sameRoot(rootInfo, identity);
    const int directoryFd = matchingRoot ?
        openat(rootFd, store.toUtf8().constData(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC) : -1;
    const int fileFd = directoryFd >= 0 ?
        openat(directoryFd, name.toUtf8().constData(), O_RDONLY | O_NOFOLLOW | O_CLOEXEC) : -1;
    struct stat fileInfo{};
    const bool ok = fileFd >= 0 && !fstat(fileFd, &fileInfo) && S_ISREG(fileInfo.st_mode) &&
        fileInfo.st_nlink == 1 && !fsync(fileFd) && !fsync(directoryFd) && !fsync(rootFd);
    if (fileFd >= 0) close(fileFd);
    if (directoryFd >= 0) close(directoryFd);
    close(rootFd);
    return ok || failure(error, "Snapshot durability sync failed; metadata/project commit was not started.");
}

bool maintainBlobStore(const QString &root, const struct stat &identity, const QString &store,
    const Payloads &payloads, QString *error)
{
    struct stat currentRoot{};
    if (parents(root, store + "/candidate", &currentRoot, &identity, true, error) != ParentState::Present) return false;
    QSet<QByteArray> protectedBlobs;
    for (const auto &pair : payloads) protectedBlobs.insert(pair.first.toLatin1());
    if (store == blobDirectory) {
        for (const auto &name : {journalName, recoveryName}) {
            File recordFile;
            if (!recordFile.open(root, name, JournalLimit, true, error) || !sameRoot(recordFile.rootIdentity(), identity))
                return failure(error, "Cannot inspect live recovery references before maintaining snapshots.");
            if (!recordFile.saved().isEmpty()) {
                const auto json = QJsonDocument::fromJson(recordFile.saved()).object();
                if (json["format"] != "nova-studio-recovery" || (json["version"] != 1 && json["version"] != 2))
                    return failure(error, "Unknown recovery record protects the snapshot store; no blobs were removed.");
                if (json["version"] == 2 && json["store"] != store)
                    return failure(error, "Recovery references a different snapshot store; review it before saving.");
                Recovery active;
                if (!parseAnyRecord(root, recordFile.saved(), json["manifest"].toString(), &active, error))
                    return false;
                protectedBlobs.unite(blobReferences(recordFile.saved()));
            }
        }
    }
    qint64 stored = 0;
    QSet<QByteArray> existing;
    QStringList unusedNames;
    const QDir directory(QDir(root).filePath(store));
    const auto entries = directory.entryInfoList(QDir::AllEntries | QDir::Hidden | QDir::NoDotAndDotDot);
    if (entries.size() > 4096) return failure(error, "Snapshot store exceeds its file-count bound.");
    for (const auto &entry : entries) {
        const auto hash = entry.completeBaseName().toLatin1();
        if (entry.suffix() != "blob" || !hashString(hash) || entry.isSymLink() || !entry.isFile() ||
            entry.size() < 0 || entry.size() > ProjectDocument::AssetSourceLimit)
            return failure(error, "Unexpected file in the private snapshot store; it has been retained: " + entry.fileName());
        if (store == blobDirectory && !protectedBlobs.contains(hash)) {
            unusedNames.append(entry.fileName());
        } else {
            if (stored > BlobStoreLimit - entry.size()) return failure(error, "Private snapshot store exceeds its aggregate byte budget.");
            stored += entry.size(); existing.insert(hash);
        }
    }
    for (const auto &pair : payloads)
        if (!existing.contains(pair.first.toLatin1())) {
            if (stored > BlobStoreLimit - pair.second.size())
                return failure(error, "Private snapshot store has insufficient bounded capacity; recovery and project are retained.");
            stored += pair.second.size();
        }
    for (const auto &name : unusedNames) {
        File unused;
        if (!unused.open(root, store + "/" + name, ProjectDocument::AssetSourceLimit, true, error, true) ||
            !sameRoot(unused.rootIdentity(), identity) || unused.savedDigest() != name.chopped(5).toLatin1())
            return failure(error, "Snapshot store contains a changed blob; refusing cleanup.");
        if (!unused.remove(error)) return false;
    }
    for (const auto &pair : payloads) {
        File blob;
        if (!blob.open(root, store + "/" + pair.first + ".blob", ProjectDocument::AssetSourceLimit, true, error, true) ||
            !sameRoot(blob.rootIdentity(), identity)) return failure(error, "Snapshot root changed during staging.");
        if (blob.exists()) {
            if (blob.saved() != pair.second) return failure(error, "Immutable snapshot blob changed externally; no replacement was made.");
            if (!syncBlob(root, store, pair.first + ".blob", identity, error) || !blob.check(error)) return false;
        } else if (!blob.replace(pair.second, error) || !blob.save(error)) return false;
    }
    return true;
}

bool storeRecovery(const QString &root, const struct stat &identity, const Recovery &recovery, QString *error)
{
    Payloads blobs;
    qint64 total = 0;
    for (const auto &file : recovery.files) {
        if (total > RecoveryDataLimit - file.before.size() - file.after.size())
            return failure(error, "Recoverable before/after snapshots exceed their aggregate byte budget.");
        total += file.before.size() + file.after.size();
        if (file.expected.exists) blobs.emplace(QString::fromLatin1(file.beforeHash), file.before);
        blobs.emplace(QString::fromLatin1(file.afterHash), file.after);
    }
    if (recordV2(recovery).size() > qsizetype(JournalLimit))
        return failure(error, "Recovery metadata exceeds 2 MiB.");
    return maintainBlobStore(root, identity, recovery.store, blobs, error);
}

bool loadBlob(const QString &root, const QString &store, const QJsonObject &json, size_t limit,
    QByteArray *bytes, QString *error)
{
    if (!json["exists"].isBool() || !json["size"].isDouble() || !json["sha256"].isString() ||
        json["size"].toDouble() < 0 || json["size"].toDouble() > double(limit) ||
        json["size"].toDouble() != double(qint64(json["size"].toDouble())))
        return failure(error, "Invalid binary snapshot descriptor.");
    const auto hash = json["sha256"].toString().toLatin1();
    if (!json["exists"].toBool()) {
        if (json["size"] != 0 || !hash.isEmpty()) return failure(error, "An absent expected file must not contain data.");
        bytes->clear();
        return true;
    }
    if (!hashString(hash)) return failure(error, "Invalid binary snapshot digest.");
    File file;
    if (!file.open(root, store + "/" + QString::fromLatin1(hash) + ".blob",
        ProjectDocument::AssetSourceLimit, true, error, true)) return false;
    if (!file.exists() || file.saved().size() != json["size"].toDouble() || digest(file.saved()) != hash)
        return failure(error, "Recovery blob is missing or changed; no project writes started: " + QString::fromLatin1(hash));
    *bytes = file.saved();
    return true;
}

QStringList commitPaths(const NovaProject &project, const QString &manifest,
    const AssetStates &before, const AssetStates &after)
{
    QStringList paths;
    for (const auto *states : {&after, &before})
        for (const auto &pair : *states)
            for (const auto &file : assetFiles(pair.second.snapshot))
                if (!paths.contains(file.path)) paths.append(file.path);
    if (*project.scene) paths.append(QString::fromUtf8(project.scene));
    paths.append(QString::fromUtf8(project.entry));
    paths.append(indexName);
    paths.append(manifest);
    return paths;
}

bool validateCommitPaths(const QStringList &paths, QString *error)
{
    QSet<QString> keys;
    for (const auto &path : paths) {
        const auto key = pathKey(path);
        for (const auto &existing : keys)
            if (existing == key || existing.startsWith(key + "/") || key.startsWith(existing + "/"))
                return failure(error, "Previous and candidate paths overlap or alias; retain stable normalized filenames: " + path);
        keys.insert(key);
    }
    return true;
}

bool parseRecordV2(const QString &root, const QByteArray &bytes, const QString &manifest,
    Recovery *result, QString *error)
{
    QJsonParseError detail;
    const auto json = QJsonDocument::fromJson(bytes, &detail).object();
    if (bytes.size() > qsizetype(JournalLimit) || detail.error != QJsonParseError::NoError || json.size() != 7 ||
        json["format"] != "nova-studio-recovery" || json["version"] != 2 || json["manifest"] != manifest ||
        !json["selection"].isString() || !json["time"].isString() || !json["files"].isArray() ||
        json["files"].toArray().size() > ProjectDocument::MaxAssetFiles + 4)
        return failure(error, "Unsupported or malformed version-2 recovery record.");
    if (!uniqueJsonKeys(bytes)) return failure(error, "Version-2 recovery contains duplicate JSON keys; it has been retained.");
    Recovery recovery{manifest, json["selection"].toString(), json["time"].toString(), {}, 2, json["store"].toString()};
    static const QRegularExpression copyStore("^\\.nova-studio-copy-[0-9a-f-]{36}$");
    if (recovery.store != blobDirectory && !copyStore.match(recovery.store).hasMatch())
        return failure(error, "Invalid recovery snapshot-store path.");
    qint64 total = 0;
    QSet<QString> seen;
    for (const auto value : json["files"].toArray()) {
        const auto file = value.toObject(), before = file["before"].toObject(), after = file["after"].toObject();
        const auto path = file["path"].toString();
        const double limit = file["limit"].toDouble(-1);
        if (file.size() != 6 || !validPath(path) || path == journalName || path == recoveryName || path == ".nova-studio-lock" ||
            seen.contains(pathKey(path)) || limit <= 0 || limit > ProjectDocument::AssetSourceLimit ||
            limit != double(size_t(limit)) || !file["attempted"].isBool() || !file["committed"].isString() ||
            before.size() != 4 || after.size() != 3 || !before["version"].isString() || after["exists"] != true)
            return failure(error, "Invalid version-2 participant path, byte limit or commit receipt.");
        seen.insert(pathKey(path));
        for (const auto &item : {before, after}) {
            const double length = item["size"].toDouble(-1);
            if (length < 0 || length > limit || length != double(qint64(length)) ||
                total > RecoveryDataLimit - qint64(length))
                return failure(error, "Version-2 recovery exceeds its bounded binary data budget.");
            total += qint64(length);
        }
    }
    Payloads oldPayloads, newPayloads;
    for (const auto value : json["files"].toArray()) {
        const auto file = value.toObject(), before = file["before"].toObject(), after = file["after"].toObject();
        RecoveredFile entry;
        entry.path = file["path"].toString(); entry.limit = size_t(file["limit"].toDouble());
        entry.expected = {before["exists"].toBool(), before["version"].toString().toLatin1()};
        entry.committed = {true, file["committed"].toString().toLatin1()};
        entry.attempted = file["attempted"].toBool();
        if (!hashString(entry.expected.token) || (!entry.committed.token.isEmpty() && !hashString(entry.committed.token)) ||
            (!entry.committed.token.isEmpty() && !entry.attempted))
            return failure(error, "Invalid exact disk version or attempted/committed receipt.");
        if (!loadBlob(root, recovery.store, before, entry.limit, &entry.before, error) ||
            !loadBlob(root, recovery.store, after, entry.limit, &entry.after, error)) return false;
        entry.beforeHash = before["sha256"].toString().toLatin1();
        entry.afterHash = after["sha256"].toString().toLatin1();
        oldPayloads.emplace(entry.path, entry.before); newPayloads.emplace(entry.path, entry.after);
        recovery.files.push_back(std::move(entry));
    }
    if (!oldPayloads.count(manifest) || !oldPayloads.count(indexName))
        return failure(error, "Version-2 recovery requires its core documents and authoring index.");
    NovaProject before{}, after{};
    char problem[1024] = {};
    if (!nova_project_parse(&before, oldPayloads.at(manifest).constData(), size_t(oldPayloads.at(manifest).size()), problem, sizeof(problem)) ||
        !nova_project_parse(&after, newPayloads.at(manifest).constData(), size_t(newPayloads.at(manifest).size()), problem, sizeof(problem)))
        return failure(error, QString::fromUtf8(problem));
    if (pathsFor(before, manifest) != pathsFor(after, manifest))
        return failure(error, "Recovery cannot redirect the project scene or Lua entry.");
    AssetStates oldAssets, newAssets;
    if (!oldPayloads.at(indexName).isEmpty() && !parseIndex(oldPayloads.at(indexName), manifest, before, oldPayloads, &oldAssets, error))
        return false;
    if (!parseIndex(newPayloads.at(indexName), manifest, after, newPayloads, &newAssets, error)) return false;
    for (const auto &pair : newAssets) {
        const auto old = oldAssets.find(pair.first);
        const auto &snapshot = pair.second.snapshot;
        if (old != oldAssets.end() &&
            (old->second.snapshot.source.path != snapshot.source.path || old->second.snapshot.kind != snapshot.kind))
            return failure(error, "Recovery cannot redirect a registered asset's source identity.");
        if (snapshot.mode == StudioAssetSnapshot::Mode::SourceOnly) {
            const auto priorOutputs = old == oldAssets.end() ? QJsonArray() :
                old->second.description["outputs"].toArray();
            if (pair.second.description["outputs"].toArray() != priorOutputs ||
                pair.second.publication.revision != (old == oldAssets.end() ? 0 : old->second.publication.revision) ||
                pair.second.publication.sourceDigest != (old == oldAssets.end() ? QByteArray() : old->second.publication.sourceDigest))
                return failure(error, "Source-only recovery must retain the previously published generated set.");
        }
    }
    const auto expected = commitPaths(after, manifest, oldAssets, newAssets);
    if (!validateCommitPaths(expected, error)) return false;
    if (expected.size() != qsizetype(recovery.files.size()) ||
        expected.size() > ProjectDocument::MaxAssetFiles + pathsFor(after, manifest).size() + 1)
        return failure(error, "Recovery contains unrelated asset participants.");
    std::map<QString, size_t> limits;
    for (const auto *states : {&oldAssets, &newAssets})
        for (const auto &pair : *states) {
            limits[pair.second.snapshot.source.path] = ProjectDocument::AssetSourceLimit;
            for (const auto &output : pair.second.snapshot.outputs) limits.emplace(output.path, ProjectDocument::AssetFileLimit);
        }
    limits[indexName] = IndexLimit;
    for (const auto &path : pathsFor(after, manifest)) limits[path] = limitFor(path);
    for (qsizetype i = 0; i < expected.size(); ++i) {
        const auto &entry = recovery.files[size_t(i)];
        if (entry.path != expected[i] || entry.limit != limits.at(entry.path))
            return failure(error, "Recovery commit order or per-participant budget is invalid.");
        if (pathsFor(after, manifest).contains(entry.path) &&
            (!entry.expected.exists || !utf8(entry.before) || !utf8(entry.after)))
            return failure(error, "Recovery core documents must retain their text encoding and existing base.");
        if (entry.path == indexName && entry.expected.exists && entry.before.isEmpty())
            return failure(error, "An existing empty authoring index is not a valid recovery base.");
        bool active = entry.path == indexName || pathsFor(after, manifest).contains(entry.path);
        for (const auto &pair : newAssets)
            for (const auto &file : assetFiles(pair.second.snapshot))
                active = active || file.path == entry.path;
        if (!active && (!entry.expected.exists || entry.before != entry.after))
            return failure(error, "Retired generated files must be retained unchanged, never overwritten or deleted by recovery.");
    }
    if (*after.scene) {
        NovaScene scene{};
        const auto &data = newPayloads.at(QString::fromUtf8(after.scene));
        if (!nova_scene_parse(&scene, data.constData(), size_t(data.size()), after.assets, after.count, problem, sizeof(problem)))
            return failure(error, QString::fromUtf8(problem));
    }
    *result = std::move(recovery);
    return true;
}

bool parseAnyRecord(const QString &root, const QByteArray &bytes, const QString &manifest, Recovery *record, QString *error)
{
    const auto json = QJsonDocument::fromJson(bytes).object();
    if (json["version"] == 2) return parseRecordV2(root, bytes, manifest, record, error);
    return parseRecord(bytes, manifest, record, error);
}

Bindings bindings(const AssetStates &states)
{
    Bindings result;
    for (const auto &pair : states)
        for (const auto &file : pair.second.snapshot.outputs)
            if (!file.runtimeId.isEmpty()) result.emplace(file.runtimeId, file);
    return result;
}

bool normalizeManifest(StudioDraft *draft, const AssetStates &states, const Bindings &owned, QString *error)
{
    auto wanted = bindings(states);
    if (std::any_of(wanted.begin(), wanted.end(),
        [](const auto &pair) { return pair.second.runtimeType == NOVA_ASSET_AUDIO; })) {
        NovaProject project{};
        char detail[1024] = {};
        if (!nova_project_parse(&project, draft->manifest.constData(), size_t(draft->manifest.size()), detail, sizeof(detail)))
            return failure(error, QString::fromUtf8(detail));
        if (project.version < 2)
            return failure(error, "Generated WAV publication requires manifest v2 or v3; this project has not been upgraded. Save source-only or use an audio-capable project.");
    }
    Bindings managed = owned;
    for (const auto &pair : wanted) {
        const auto previous = managed.find(pair.first);
        if (previous != managed.end() &&
            (previous->second.path != pair.second.path || previous->second.runtimeType != pair.second.runtimeType))
            return failure(error, "A registered runtime ID cannot be redirected to a different file/type: " + pair.first);
        managed.emplace(pair);
    }
    if (managed.empty()) return true;
    QByteArray manifest;
    const auto lines = draft->manifest.split('\n');
    static const QRegularExpression declaration("^(sprite|model|audio)[ \\t]+([^ \\t]+)[ \\t]+(.+)$");
    for (qsizetype i = 0; i < lines.size(); ++i) {
        const auto &line = lines[i];
        const auto match = declaration.match(QString::fromUtf8(line).trimmed());
        if (match.hasMatch()) {
            const auto found = managed.find(match.captured(2));
            if (found != managed.end()) {
                const auto type = match.captured(1) == "sprite" ? NOVA_ASSET_SPRITE :
                    match.captured(1) == "model" ? NOVA_ASSET_MODEL : NOVA_ASSET_AUDIO;
                if (found->second.path != match.captured(3) || found->second.runtimeType != type)
                    return failure(error, "Runtime binding conflicts with an existing declaration: " + match.captured(2));
                continue;
            }
        }
        manifest += line;
        if (i + 1 < lines.size()) manifest += '\n';
    }
    const auto newline = draft->manifest.contains("\r\n") ? QByteArray("\r\n") : QByteArray("\n");
    if (!manifest.isEmpty() && !manifest.endsWith('\n')) manifest += newline;
    for (const auto &pair : wanted)
        manifest += QByteArray(pair.second.runtimeType == NOVA_ASSET_SPRITE ? "sprite " :
            pair.second.runtimeType == NOVA_ASSET_MODEL ? "model " : "audio ") +
            pair.first.toUtf8() + " " + pair.second.path.toUtf8() + newline;
    draft->manifest = manifest;
    return true;
}

void setVersions(AssetStates *states, const Files &files)
{
    for (auto &pair : *states) {
        auto &snapshot = pair.second.snapshot;
        snapshot.source.expected = version(*files.at(snapshot.source.path), snapshot.source.path);
        for (auto &output : snapshot.outputs) output.expected = version(*files.at(output.path), output.path);
    }
}

bool makeRecord(const QString &manifest, const StudioDraft &draft, const NovaProject &project,
    const Files &files, const AssetStates &before, const AssetStates &after, const Recovery *interrupted,
    Recovery *result, QString *error)
{
    Recovery recovery{manifest, draft.selection, QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs), {}, 2};
    Payloads payloads;
    std::map<QString, QByteArray> hashes;
    for (const auto &pair : after)
        for (const auto &file : assetFiles(pair.second.snapshot)) {
            payloads.emplace(file.path, file.bytes);
            hashes.emplace(file.path, digest(file.bytes));
        }
    payloads[indexName] = indexBytes(after, manifest);
    for (const auto &path : pathsFor(project, manifest)) payloads[path] = bytesFor(draft, project, path, manifest);
    const auto paths = commitPaths(project, manifest, before, after);
    if (!validateCommitPaths(paths, error)) return false;
    if (paths.size() > ProjectDocument::MaxAssetFiles + pathsFor(project, manifest).size() + 1)
        return failure(error, "Previous and candidate asset inventories exceed the 128-file transaction budget.");
    qint64 total = 0;
    for (const auto &path : paths) {
        const auto &file = *files.at(path);
        RecoveredFile entry{path, file.saved(), {}, path == indexName ? size_t(IndexLimit) :
            pathsFor(project, manifest).contains(path) ? limitFor(path) : file.missingParents ? file.missingLimit : file.document.limit,
            version(file, path), {}, false};
        entry.beforeHash = file.exists() ? file.savedDigest() : QByteArray();
        if (interrupted)
            for (const auto &original : interrupted->files)
                if (original.path == path) {
                    entry.before = original.before; entry.expected = original.expected;
                    entry.beforeHash = original.beforeHash;
                    break;
                }
        entry.after = payloads.count(path) ? payloads.at(path) : entry.before;
        entry.afterHash = hashes.count(path) ? hashes.at(path) :
            payloads.count(path) ? digest(entry.after) : entry.beforeHash;
        if (total > RecoveryDataLimit - entry.before.size() - entry.after.size())
            return failure(error, "Transaction exceeds its before/after byte budget; nothing has been written.");
        total += entry.before.size() + entry.after.size();
        recovery.files.push_back(std::move(entry));
    }
    if (payloads.at(indexName).size() > IndexLimit || recordV2(recovery).size() > qsizetype(JournalLimit))
        return failure(error, "Authoring index or recovery metadata exceeds its byte budget; nothing has been written.");
    *result = std::move(recovery);
    return true;
}

bool preflight(const QString &root, const QString &manifest, const Recovery &recovery,
    const AssetStates &before, const AssetStates &after, Files *runtimeFiles, QString *error)
{
    bool publishing = false;
    for (const auto &pair : after)
        if (pair.second.snapshot.mode == StudioAssetSnapshot::Mode::PublishDerived &&
            (!before.count(pair.first) || before.at(pair.first).hash != pair.second.hash))
            publishing = true;
    if (!publishing) return true;
    Payloads payloads;
    for (const auto &file : recovery.files) payloads.emplace(file.path, file.after);
    NovaProject project{};
    char detail[1024] = {};
    if (!nova_project_parse(&project, payloads.at(manifest).constData(), size_t(payloads.at(manifest).size()), detail, sizeof(detail)))
        return failure(error, QString::fromUtf8(detail));
    QTemporaryDir directory;
    if (!directory.isValid()) return failure(error, "Cannot create a private project preflight directory.");
    QStringList paths = pathsFor(project, manifest);
    for (size_t i = 0; i < project.count; ++i) paths.append(QString::fromUtf8(project.assets[i].path));
    paths.removeDuplicates();
    for (const auto &path : paths) {
        QByteArray bytes;
        if (payloads.count(path)) bytes = payloads.at(path);
        else {
            auto input = std::make_unique<File>();
            if (!input->open(root, path, ProjectDocument::AssetFileLimit, true, error, true) || !input->exists())
                return failure(error, "Whole-project preflight could not read runtime asset: " + path + (error ? "\n" + *error : QString()));
            bytes = input->saved();
            runtimeFiles->emplace(path, std::move(input));
        }
        File copy;
        const size_t limit = pathsFor(project, manifest).contains(path) ? limitFor(path) : ProjectDocument::AssetFileLimit;
        if (!copy.open(directory.path(), path, limit, true, error, true, true) ||
            !copy.replace(bytes, error) || !copy.save(error)) return false;
    }
    NovaProjectValidation validation{};
    if (!nova_validate_project(QDir(directory.path()).filePath(manifest).toUtf8().constData(), &validation, detail, sizeof(detail)))
        return failure(error, "Runtime publication failed; source and candidate remain recoverable, previous generated files are unchanged. "
            "Choose an explicit source-only save to persist editable work without publishing.\n" + QString::fromUtf8(detail));
    for (const auto &pair : *runtimeFiles) if (!pair.second->check(error)) return false;
    return true;
}

bool recordAssets(const Recovery &recovery, AssetStates *before, AssetStates *after, QString *error)
{
    Payloads oldPayloads, newPayloads;
    for (const auto &file : recovery.files) {
        oldPayloads.emplace(file.path, file.before);
        newPayloads.emplace(file.path, file.after);
    }
    NovaProject oldProject{}, newProject{};
    char detail[1024] = {};
    if (!nova_project_parse(&oldProject, oldPayloads.at(recovery.manifest).constData(),
            size_t(oldPayloads.at(recovery.manifest).size()), detail, sizeof(detail)) ||
        !nova_project_parse(&newProject, newPayloads.at(recovery.manifest).constData(),
            size_t(newPayloads.at(recovery.manifest).size()), detail, sizeof(detail)))
        return failure(error, QString::fromUtf8(detail));
    if (!oldPayloads.at(indexName).isEmpty() &&
        !parseIndex(oldPayloads.at(indexName), recovery.manifest, oldProject, oldPayloads, before, error)) return false;
    return parseIndex(newPayloads.at(indexName), recovery.manifest, newProject, newPayloads, after, error);
}

bool openRecordFiles(const QString &root, const struct stat &identity, Recovery *recovery, Files *files, QString *error)
{
    for (auto &entry : recovery->files) {
        auto file = std::make_unique<File>();
        if (!file->open(root, entry.path, entry.limit, true, error, true, true)) return false;
        if (!sameRoot(file->rootIdentity(), identity)) return failure(error, "Project root changed during recovery.");
        const auto current = version(*file, entry.path);
        const bool original = current == entry.expected && file->saved() == entry.before;
        const bool committed = !entry.committed.token.isEmpty() && current == entry.committed && file->saved() == entry.after;
        // A crash between replacement and its receipt may only accept the exact
        // intended bytes. That path is never overwritten during recovery.
        const bool unreceipted = entry.attempted && entry.committed.token.isEmpty() &&
            current.exists && file->saved() == entry.after;
        if (!original && !committed && !unreceipted)
            return failure(error, "External edits conflict with recovery: " + entry.path +
                ". Exact disk version/absence changed; no recovery writes started.");
        if (committed || unreceipted) entry.committed = current;
        files->emplace(entry.path, std::move(file));
    }
    return true;
}

bool commitRecord(File *journal, Recovery *recovery, Files *files, const Files &runtimeFiles,
    size_t *written, QString *error)
{
    *written = 0;
    for (auto &entry : recovery->files) {
        auto &file = *files->at(entry.path);
        if (!file.check(error)) return false;
        if (file.exists() && file.saved() == entry.after) continue;
        entry.attempted = true;
        if (!journal->replace(recordV2(*recovery), error) || !journal->save(error)) return false;
        if (!file.replace(entry.after, error) || !file.save(error)) return false;
        ++*written;
        entry.committed = version(file, entry.path);
        if (!journal->replace(recordV2(*recovery), error) || !journal->save(error)) return false;
    }
    for (const auto &pair : *files) if (!pair.second->check(error)) return false;
    for (const auto &pair : runtimeFiles) if (!pair.second->check(error)) return false;
    return true;
}

bool checkRecoveryBase(const QString &root, const Recovery &commit, const Files &committedFiles,
    const Recovery &pending, QString *error)
{
    for (const auto &entry : pending.files) {
        const auto original = std::find_if(commit.files.begin(), commit.files.end(),
            [&entry](const RecoveredFile &file) { return entry.path == file.path; });
        if (original != commit.files.end()) {
            const auto &current = *committedFiles.at(entry.path);
            if (!((entry.expected == original->expected && entry.before == original->before) ||
                (entry.expected == version(current, entry.path) && entry.before == original->after &&
                    current.saved() == entry.before)))
                return failure(error, "Recovery has a different saved base. Journal and both snapshots are retained.");
        } else {
            File current;
            if (!current.open(root, entry.path, entry.limit, true, error, true, true) ||
                version(current, entry.path) != entry.expected || current.saved() != entry.before)
                return failure(error, "A newer recovery output changed externally; the journal remains for review: " + entry.path);
        }
    }
    return true;
}

bool rebaseRecovery(const QString &root, const Recovery &commit, const Files &committedFiles,
    const AssetStates &committedAssets, File *recordFile, const Recovery &pending, QString *error)
{
    if (!recordFile->check(error)) return false;
    if (!recordFile->exists()) return true;
    if (!checkRecoveryBase(root, commit, committedFiles, pending, error)) return false;
    AssetStates before, after;
    if (!recordAssets(pending, &before, &after, error)) return false;
    for (auto &pair : after)
        if (pair.second.snapshot.mode == StudioAssetSnapshot::Mode::SourceOnly && committedAssets.count(pair.first)) {
            const auto &published = committedAssets.at(pair.first);
            pair.second.snapshot.outputs = published.snapshot.outputs;
            pair.second.publication = published.publication;
            pair.second.publication.stale = true;
            pair.second.publication.problem = pair.second.snapshot.derivedProblem;
            seal(&pair.second);
        }
    StudioDraft draft;
    NovaProject project{};
    char detail[1024] = {};
    for (const auto &entry : pending.files) if (entry.path == pending.manifest) draft.manifest = entry.after;
    if (!nova_project_parse(&project, draft.manifest.constData(), size_t(draft.manifest.size()), detail, sizeof(detail)))
        return failure(error, QString::fromUtf8(detail));
    for (const auto &entry : pending.files)
        if (entry.path == QString::fromUtf8(project.entry)) draft.script = entry.after;
        else if (entry.path == QString::fromUtf8(project.scene)) draft.scene = entry.after;
    draft.selection = pending.selection;
    if (!normalizeManifest(&draft, after, bindings(committedAssets), error) ||
        !nova_project_parse(&project, draft.manifest.constData(), size_t(draft.manifest.size()), detail, sizeof(detail)) ||
        !validateAssets(after, project, commit.manifest, error))
        return failure(error, "Newer recovery could not be rebased on the completed commit; it is retained.\n" +
            (error && !error->isEmpty() ? *error : QString::fromUtf8(detail)));
    Files files;
    std::map<QString, size_t> limits;
    for (const auto *states : std::array<const AssetStates *, 2>{&committedAssets, &after})
        for (const auto &pair : *states) {
            limits[pair.second.snapshot.source.path] = ProjectDocument::AssetSourceLimit;
            for (const auto &output : pair.second.snapshot.outputs) limits.emplace(output.path, ProjectDocument::AssetFileLimit);
        }
    limits[indexName] = IndexLimit;
    for (const auto &path : pathsFor(project, commit.manifest)) limits[path] = limitFor(path);
    for (const auto &path : commitPaths(project, commit.manifest, committedAssets, after)) {
        auto file = std::make_unique<File>();
        if (!file->open(root, path, limits.at(path), true, error, true, true)) return false;
        const auto committed = committedFiles.find(path);
        if (committed != committedFiles.end() && version(*file, path) != version(*committed->second, path))
            return failure(error, "A committed file changed before newer recovery could be retained: " + path);
        if (committed == committedFiles.end()) {
            const auto prior = std::find_if(pending.files.begin(), pending.files.end(),
                [&path](const RecoveredFile &entry) { return entry.path == path; });
            if (prior == pending.files.end() || version(*file, path) != prior->expected || file->saved() != prior->before)
                return failure(error, "A newer recovery output changed before rebasing: " + path);
        }
        files.emplace(path, std::move(file));
    }
    Recovery rebased;
    if (!makeRecord(commit.manifest, draft, project, files, committedAssets, after, nullptr, &rebased, error)) return false;
    rebased.time = pending.time;
    if (!storeRecovery(root, recordFile->rootIdentity(), rebased, error)) return false;
    return recordFile->replace(recordV2(rebased), error) && recordFile->save(error);
}

bool finishCommitV2(const QString &root, File *journal, Recovery *recovery, QString *error,
    std::unique_ptr<File> *updatedRecovery = nullptr)
{
    Files files, runtimeFiles;
    AssetStates before, after;
    auto recordFile = std::make_unique<File>();
    Recovery pending;
    if (!recordFile->open(root, recoveryName, JournalLimit, true, error)) return false;
    if (!sameRoot(recordFile->rootIdentity(), journal->rootIdentity()))
        return failure(error, "Project recovery root changed.");
    if (recordFile->exists() && !parseRecordV2(root, recordFile->saved(), recovery->manifest, &pending, error)) return false;
    if (!openRecordFiles(root, journal->rootIdentity(), recovery, &files, error) ||
        !recordAssets(*recovery, &before, &after, error) ||
        (recordFile->exists() && !checkRecoveryBase(root, *recovery, files, pending, error)) ||
        !preflight(root, recovery->manifest, *recovery, before, after, &runtimeFiles, error)) return false;
    if (!recordFile->check(error) || !journal->check(error) ||
        (recordFile->exists() && !checkRecoveryBase(root, *recovery, files, pending, error))) return false;
    for (const auto &pair : files) if (!pair.second->check(error)) return false;
    size_t written = 0;
    if (!commitRecord(journal, recovery, &files, runtimeFiles, &written, error)) {
        if (error) *error = QString("Recovery interrupted after %1 writes; journal and blobs retained.\n").arg(written) + *error;
        return false;
    }
    if (!rebaseRecovery(root, *recovery, files, after, recordFile.get(), pending, error) || !journal->remove(error)) return false;
    if (updatedRecovery) *updatedRecovery = std::move(recordFile);
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
    if (!parseAnyRecord(root, journal.text(), manifest, &recovery, error)) return false;
    if (recovery.version == 2) return finishCommitV2(root, &journal, &recovery, error);
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
    Files files;
    std::unique_ptr<File> recovery;
    AssetStates assets, savedAssets;
    Bindings ownedBindings;
    std::unique_ptr<Recovery> interrupted;
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
    auto index = std::make_unique<File>();
    if (!index->open(root, indexName, IndexLimit, true, error)) return false;
    if (index->exists()) {
        std::map<QString, size_t> inventory;
        if (!indexInventory(index->saved(), info.fileName(), &inventory, error)) return false;
        Payloads payloads;
        for (const auto &pair : inventory) {
            if (state->files.count(pair.first)) return failure(error, "Authored source/output overlaps a core document.");
            auto file = std::make_unique<File>();
            if (!file->open(root, pair.first, pair.second, true, error, true) || !file->exists())
                return failure(error, "Registered authored source/output is missing or unreadable: " + pair.first);
            payloads.emplace(pair.first, file->saved());
            state->files.emplace(pair.first, std::move(file));
        }
        if (!parseIndex(index->saved(), info.fileName(), project, payloads, &state->assets, error)) return false;
        setVersions(&state->assets, state->files);
        state->savedAssets = state->assets;
        state->ownedBindings = bindings(state->assets);
    }
    state->files.emplace(indexName, std::move(index));
    state->recovery = std::make_unique<File>();
    if (!state->recovery->open(root, recoveryName, JournalLimit, true, error)) return false;
    const auto &identity = state->files.at(info.fileName())->rootIdentity();
    for (const auto &pair : state->files)
        if (!sameRoot(identity, pair.second->rootIdentity())) return failure(error, "Project root changed while opening its documents.");
    if (!sameRoot(identity, state->recovery->rootIdentity())) return failure(error, "Project recovery root changed while opening.");
    if (candidateLock) lock_ = std::move(candidateLock);
    recoveryTimer_->stop();
    disk_ = std::move(state);
    path_ = path; root_ = root;
    draft_ = draft; project_ = project; scene_ = scene;
    externalChanged_ = false;
    recoveryPending_ = disk_->recovery->exists();
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
    scene.version = 1;
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
    if (disk_->interrupted) return true;
    if (QFileInfo::exists(QDir(root_).filePath(journalName))) return true;
    const auto manifest = QFileInfo(path_).fileName();
    for (const auto &path : pathsFor(project_, manifest))
        if (disk_->files.at(path)->saved() != bytesFor(draft_, project_, path, manifest)) return true;
    if ((!disk_->assets.empty() || disk_->files.at(indexName)->exists()) &&
        disk_->files.at(indexName)->saved() != indexBytes(disk_->assets, manifest)) return true;
    return false;
}

void ProjectDocument::apply(const StudioDraft &draft)
{
    StudioDraft normalized = draft;
    NovaProject project{};
    NovaScene scene{};
    QString error;
    if (!normalizeAssetManifest(&normalized, &error) || !parse(normalized, &project, &scene, &error)) { emit problem(error); return; }
    const bool selectionChanged = normalized.selection != draft_.selection;
    draft_ = normalized; project_ = project; scene_ = scene;
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

bool ProjectDocument::normalizeAssetManifest(StudioDraft *draft, QString *error) const
{
    return !disk_ || normalizeManifest(draft, disk_->assets, disk_->ownedBindings, error);
}

bool ProjectDocument::readAssetFile(const QString &relative, QByteArray *bytes, StudioDiskVersion *expected, QString *error) const
{
    if (!disk_ || !assetPath(relative) || !bytes || !expected)
        return failure(error, "Open a project and supply a contained, non-reserved asset path.");
    File file;
    if (!file.open(root_, relative, AssetSourceLimit, true, error, true, true)) return false;
    if (!sameRoot(file.rootIdentity(), disk_->files.at(QFileInfo(path_).fileName())->rootIdentity()))
        return failure(error, "Project root changed; reopen before adopting an asset snapshot.");
    *bytes = file.saved();
    *expected = version(file, relative);
    return true;
}

QVector<StudioAssetSnapshot> ProjectDocument::assetSnapshots() const
{
    QVector<StudioAssetSnapshot> result;
    if (disk_) for (const auto &pair : disk_->assets) result.append(pair.second.snapshot);
    return result;
}

QVector<StudioAssetSnapshot> ProjectDocument::savedAssetSnapshots() const
{
    QVector<StudioAssetSnapshot> result;
    if (disk_) for (const auto &pair : disk_->savedAssets) result.append(pair.second.snapshot);
    return result;
}

StudioAssetPublication ProjectDocument::assetPublication(const QString &id) const
{
    if (disk_ && disk_->assets.count(id)) {
        const auto &state = disk_->assets.at(id);
        auto publication = disk_->savedAssets.count(id) ? disk_->savedAssets.at(id).publication : StudioAssetPublication();
        publication.saved = isAssetSnapshotSaved(id, state.snapshot.revision, state.hash);
        if (!publication.saved) {
            publication.stale = true;
            publication.problem = state.snapshot.mode == StudioAssetSnapshot::Mode::SourceOnly ?
                state.snapshot.derivedProblem : "Generated candidate has not been committed.";
        }
        return publication;
    }
    return {true, 0, {}, "No asset participant with that ID is registered."};
}

bool ProjectDocument::runtimeAssetsReady(QString *error) const
{
    if (!disk_) return failure(error, "No project is open.");
    if (disk_->interrupted || QFileInfo::exists(QDir(root_).filePath(journalName)))
        return failure(error, "Finish the interrupted asset commit before running or exporting.");
    for (const auto &pair : disk_->assets) {
        const auto state = assetPublication(pair.first);
        if (!state.saved) return failure(error, "Authored snapshot has not been committed for " + pair.first + ".");
        if (state.stale)
            return failure(error, "Runtime output is stale for " + pair.first + ": " + state.problem +
                (state.revision ? ". Publish the current source, or explicitly choose the last published output." :
                    ". Publish the current source before running or exporting; no previous generated output exists."));
    }
    return checkExternal(error);
}

QByteArray ProjectDocument::assetSnapshotDigest(const StudioAssetSnapshot &snapshot)
{
    return snapshotDigest(snapshot);
}

bool ProjectDocument::isAssetSnapshotSaved(const QString &id, quint64 revision, const QByteArray &hash) const
{
    if (!disk_ || !disk_->savedAssets.count(id) || !disk_->assets.count(id)) return false;
    const auto &saved = disk_->savedAssets.at(id).snapshot;
    const auto &current = disk_->assets.at(id).snapshot;
    return saved.revision == revision && current.revision == revision &&
        disk_->savedAssets.at(id).hash == hash && disk_->assets.at(id).hash == hash;
}

bool ProjectDocument::stageAssetSnapshot(const StudioAssetSnapshot &input, QString *error)
{
    if (!disk_ || generated_ || writing_)
        return failure(error, "Open an editable, idle project before registering an asset snapshot.");
    StudioAssetSnapshot snapshot = input;
    AssetState state;
    const auto saved = disk_->savedAssets.find(snapshot.id);
    const auto registered = disk_->assets.find(snapshot.id);
    if (registered != disk_->assets.end() &&
        (registered->second.snapshot.source.path != snapshot.source.path || registered->second.snapshot.kind != snapshot.kind))
        return failure(error, "An asset participant's registered source path and kind cannot be redirected.");
    if (snapshot.mode == StudioAssetSnapshot::Mode::SourceOnly) {
        const auto retained = saved == disk_->savedAssets.end() ? QVector<StudioAssetFile>() : saved->second.snapshot.outputs;
        if (!snapshot.outputs.isEmpty()) {
            if (snapshot.outputs.size() != retained.size()) return failure(error, "Source-only saves cannot replace the last valid generated set.");
            for (qsizetype i = 0; i < retained.size(); ++i)
                if (assetFileJson(snapshot.outputs[i]) != assetFileJson(retained[i]))
                    return failure(error, "Source-only saves cannot replace the last valid generated set.");
        }
        snapshot.outputs = retained;
        if (saved != disk_->savedAssets.end()) state.publication = saved->second.publication;
        state.publication.stale = true; state.publication.problem = snapshot.derivedProblem;
    } else {
        state.publication = {false, snapshot.revision, {}, {}};
    }
    state.snapshot = snapshot;
    AssetStates candidate = disk_->assets;
    candidate[snapshot.id] = std::move(state);
    StudioDraft draft = draft_;
    NovaProject project{}; NovaScene scene{};
    if (!normalizeManifest(&draft, candidate, disk_->ownedBindings, error) || !parse(draft, &project, &scene, error) ||
        !validateAssets(candidate, project, QFileInfo(path_).fileName(), error)) return false;
    const auto ownString = [](QString &text) { text = QString(text.constData(), text.size()); };
    const auto ownFile = [&ownString](StudioAssetFile &file) {
        ownString(file.path); ownString(file.runtimeId);
        file.bytes = QByteArray(file.bytes.constData(), file.bytes.size());
        file.expected.token = QByteArray(file.expected.token.constData(), file.expected.token.size());
    };
    ownString(snapshot.id); ownString(snapshot.kind); ownString(snapshot.derivedProblem);
    ownFile(snapshot.source);
    for (auto &file : snapshot.outputs) ownFile(file);
    QJsonParseError metadataError;
    const auto metadata = QJsonDocument::fromJson(QJsonDocument(snapshot.metadata).toJson(QJsonDocument::Compact), &metadataError);
    if (metadataError.error != QJsonParseError::NoError || !metadata.isObject() || metadata.object() != snapshot.metadata)
        return failure(error, "Association metadata must round-trip losslessly as bounded JSON.");
    snapshot.metadata = metadata.object();
    candidate.at(snapshot.id).snapshot = snapshot;
    candidate.at(snapshot.id).publication.problem = snapshot.derivedProblem;
    seal(&candidate.at(snapshot.id));
    if (snapshot.mode == StudioAssetSnapshot::Mode::PublishDerived)
        candidate.at(snapshot.id).publication.sourceDigest =
            candidate.at(snapshot.id).description["source"].toObject()["sha256"].toString().toLatin1();
    const auto encodedIndex = indexBytes(candidate, QFileInfo(path_).fileName());
    if (encodedIndex.size() > IndexLimit)
        return failure(error, "Authored asset index exceeds its 1 MiB aggregate metadata budget.");
    const auto parsedIndex = QJsonDocument::fromJson(encodedIndex, &metadataError);
    if (metadataError.error != QJsonParseError::NoError || !parsedIndex.isObject())
        return failure(error, "Association metadata is too deeply nested for the authoring index.");
    Files newFiles;
    for (const auto &file : assetFiles(snapshot)) {
        if (!hashString(file.expected.token)) return failure(error, "Capture the exact disk version, including absence, before staging: " + file.path);
        const size_t limit = file.path == snapshot.source.path ? AssetSourceLimit : AssetFileLimit;
        const auto found = disk_->files.find(file.path);
        if (found != disk_->files.end()) {
            if (file.expected != version(*found->second, file.path) || !found->second->check(error))
                return failure(error, "Expected disk version changed before snapshot registration: " + file.path);
        } else {
            auto current = std::make_unique<File>();
            if (!current->open(root_, file.path, limit, true, error, true, true) ||
                file.expected != version(*current, file.path) ||
                !sameRoot(current->rootIdentity(), disk_->files.at(QFileInfo(path_).fileName())->rootIdentity()))
                return failure(error, "Expected disk version/absence changed before snapshot registration: " + file.path);
            newFiles.emplace(file.path, std::move(current));
        }
    }
    const auto needed = commitPaths(project, QFileInfo(path_).fileName(), disk_->savedAssets, candidate);
    if (!validateCommitPaths(needed, error)) return false;
    if (needed.size() > MaxAssetFiles + pathsFor(project, QFileInfo(path_).fileName()).size() + 1)
        return failure(error, "Previous and candidate outputs exceed the bounded transaction file count.");
    for (auto &pair : newFiles) disk_->files.emplace(pair.first, std::move(pair.second));
    for (auto it = disk_->files.begin(); it != disk_->files.end();)
        if (!needed.contains(it->first)) it = disk_->files.erase(it);
        else ++it;
    disk_->assets = std::move(candidate);
    for (const auto &pair : bindings(disk_->assets)) disk_->ownedBindings.emplace(pair);
    draft_ = draft; project_ = project; scene_ = scene;
    recoveryTimer_->start();
    watch();
    emit changed();
    return true;
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
    QByteArray text = "nova-scene " + QByteArray::number(scene.version) + "\nmode " +
        QByteArray(scene.mode == NOVA_2D ? "2d" : scene.mode == NOVA_3D ? "3d" : "mixed");
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
            v(object.position) + " " + v(object.size) + " " +
            (scene.version == 2 ? v(object.rotation) + " " : QByteArray()) +
            c(object.color) + " " + object.name + "\n";
    }
    return text;
}

bool ProjectDocument::editScene(const NovaScene &scene, const QString &selection, const QString &operation, QString *error)
{
    if (generated_) return failure(error, "Generated project ownership is read-only here; use the compatibility editor.");
    if (!visual()) return failure(error, "This project has no authored scene. Its Lua is not converted or regenerated.");
    char detail[1024]{};
    if (!nova_scene_validate(&scene, project_.assets, project_.count, detail, sizeof(detail)))
        return failure(error, QString::fromUtf8(detail));
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
        if (QFileInfo::exists(path)) paths << path;
        auto parent = QFileInfo(path).absolutePath();
        while (parent != root_ && !QFileInfo::exists(parent)) parent = QFileInfo(parent).absolutePath();
        paths << parent;
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
        if (!pathsFor(project_, QFileInfo(path_).fileName()).contains(entry.first)) {
            result += "\n=== " + entry.first + " ===\nSAVED BASE: " + QString::number(entry.second->saved().size()) +
                " bytes, SHA-256 " + QString::fromLatin1(entry.second->savedDigest());
            QJsonObject candidate;
            for (const auto &pair : disk_->assets) {
                if (pair.second.snapshot.source.path == entry.first) candidate = pair.second.description["source"].toObject();
                for (const auto value : pair.second.description["outputs"].toArray())
                    if (value.toObject()["path"] == entry.first) candidate = value.toObject();
            }
            if (entry.first == indexName) {
                const auto bytes = indexBytes(disk_->assets, QFileInfo(path_).fileName());
                candidate = {{"size", double(bytes.size())}, {"sha256", QString::fromLatin1(digest(bytes))}};
            }
            if (!candidate.isEmpty())
                result += "\nYOUR DRAFT: " + QString::number(qint64(candidate["size"].toDouble())) +
                    " bytes, SHA-256 " + candidate["sha256"].toString();
            else result += "\nYOUR DRAFT: Retired output retained unchanged.";
            if (current.open(root_, entry.first, AssetSourceLimit, true, &error, true, true))
                result += "\nCURRENT DISK: " + QString::number(current.saved().size()) +
                    " bytes, SHA-256 " + QString::fromLatin1(digest(current.saved()));
            else result += "\nDISK ERROR: " + error;
            continue;
        }
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
    if (!disk_->assets.empty() || disk_->files.at(indexName)->exists()) {
        Recovery recovery;
        if (!makeRecord(QFileInfo(path_).fileName(), draft_, project_, disk_->files,
            disk_->savedAssets, disk_->assets, disk_->interrupted.get(), &recovery, error)) return false;
        QScopedValueRollback<bool> writing(writing_, true);
        return storeRecovery(root_, disk_->files.at(QFileInfo(path_).fileName())->rootIdentity(), recovery, error) &&
            disk_->recovery->replace(recordV2(recovery), error) && disk_->recovery->save(error);
    }
    return disk_->recovery->replace(record(QFileInfo(path_).fileName(), draft_, project_, disk_->files), error) &&
        disk_->recovery->save(error);
}

QString ProjectDocument::recoveryDescription() const
{
    if (!disk_ || !disk_->recovery->exists()) return {};
    Recovery recovery;
    QString error;
    if (!parseAnyRecord(root_, disk_->recovery->saved(), QFileInfo(path_).fileName(), &recovery, &error)) return error;
    return "Unsaved authoring snapshot from " + recovery.time + "\n" +
        QString::number(recovery.files.size()) + " documents. " +
        (disk_->interrupted || QFileInfo::exists(QDir(root_).filePath(journalName)) ?
            "An interrupted commit may already have replaced some files; finish its journal before running/exporting." :
            "The recovery snapshot itself does not replace project files.");
}

QString ProjectDocument::recoveryPreview() const
{
    if (!disk_) return {};
    Recovery recovery;
    QString error, result;
    if (!parseAnyRecord(root_, disk_->recovery->saved(), QFileInfo(path_).fileName(), &recovery, &error)) return error;
    for (const auto &entry : recovery.files) {
        result += "=== " + entry.path + " ===\n";
        if (recovery.version == 1 || pathsFor(project_, recovery.manifest).contains(entry.path))
            result += "SAVED BASE:\n" + QString::fromUtf8(entry.before) +
                "\nRECOVERABLE DRAFT:\n" + QString::fromUtf8(entry.after) + "\n";
        else result += "SAVED BASE: " + QString::number(entry.before.size()) + " bytes, SHA-256 " +
            QString::fromLatin1(digest(entry.before)) + "\nRECOVERABLE DRAFT: " + QString::number(entry.after.size()) +
            " bytes, SHA-256 " + QString::fromLatin1(digest(entry.after)) + "\n";
    }
    return result;
}

bool ProjectDocument::saveRecoveryCopy(const QString &destination, QString *error) const
{
    if (!disk_) return failure(error, "No project is open.");
    const QFileInfo target(destination);
    if (!assetPath(target.fileName())) return failure(error, "Choose a non-reserved recovery-copy filename.");
    File copy;
    if (!copy.open(target.absolutePath(), target.fileName(), JournalLimit, true, error)) return false;
    if (copy.exists())
        return failure(error, "Choose a new recovery-copy filename. Existing files are never replaced.");
    if (!disk_->assets.empty() || disk_->files.at(indexName)->exists()) {
        Recovery recovery;
        if (!makeRecord(QFileInfo(path_).fileName(), draft_, project_, disk_->files, disk_->savedAssets, disk_->assets,
            disk_->interrupted.get(), &recovery, error)) return false;
        recovery.store = ".nova-studio-copy-" + QUuid::createUuid().toString(QUuid::WithoutBraces);
        if (!storeRecovery(target.absolutePath(), copy.rootIdentity(), recovery, error)) return false;
        return copy.replace(recordV2(recovery), error) && copy.save(error);
    }
    return copy.replace(record(QFileInfo(path_).fileName(), draft_, project_, disk_->files), error) && copy.save(error);
}

bool ProjectDocument::restoreRecovery(QString *error)
{
    if (!disk_) return failure(error, "No project is open.");
    Recovery recovery;
    if (!parseAnyRecord(root_, disk_->recovery->saved(), QFileInfo(path_).fileName(), &recovery, error)) return false;
    if (recovery.version == 2) return restoreAssetRecovery(error);
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
    if (disk_->interrupted || QFileInfo::exists(QDir(root_).filePath(journalName)))
        return failure(error, "An interrupted commit cannot be discarded; recover its recorded writes first.");
    const auto &identity = disk_->files.at(QFileInfo(path_).fileName())->rootIdentity();
    if (!sameRoot(disk_->recovery->rootIdentity(), identity))
        return failure(error, "The recovery root guard changed; reopen explicitly before discarding.");
    if (!disk_->recovery->remove(error)) return false;
    recoveryPending_ = true;
    auto recovery = std::make_unique<File>();
    if (!recovery->open(root_, recoveryName, JournalLimit, true, error)) return false;
    if (!sameRoot(recovery->rootIdentity(), identity))
        return failure(error, "Project root changed during recovery cleanup; reopen explicitly.");
    disk_->recovery = std::move(recovery);
    if (disk_->recovery->exists())
        return failure(error, "A new recovery file appeared during cleanup; it is retained for explicit review.");
    recoveryPending_ = false;
    if (QFileInfo::exists(QDir(root_).filePath(blobDirectory)))
        return maintainBlobStore(root_, identity, blobDirectory, {}, error);
    return true;
}

bool ProjectDocument::save(QString *error)
{
    if (!disk_) return failure(error, "No project is open.");
    if (generated_) return failure(error, "Legacy generated outputs are read-only here. Use the compatibility editor.");
    if (disk_->interrupted)
        return failure(error, "An interrupted commit must be resumed or explicitly reopened before starting another save.");
    if (!checkExternal(error)) return false;
    if (externalChanged_) { externalChanged_ = false; emit externalChange({}); }
    if (!dirty()) return true;
    if (!disk_->assets.empty() || disk_->files.at(indexName)->exists()) return saveAssetBatch(error);
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

bool ProjectDocument::saveAssetBatch(QString *error)
{
    if (recoveryPending_)
        return failure(error, "An older recovery snapshot needs an explicit Restore or Discard decision.");
    Recovery recovery;
    const auto manifest = QFileInfo(path_).fileName();
    if (!makeRecord(manifest, draft_, project_, disk_->files, disk_->savedAssets, disk_->assets, nullptr, &recovery, error))
        return false;
    const AssetStates committedAssets = disk_->assets;
    {
        QScopedValueRollback<bool> writing(writing_, true);
        File journal;
        if (!journal.open(root_, journalName, JournalLimit, true, error)) return false;
        if (journal.exists()) return failure(error, "An interrupted commit exists; finish it before starting a new save.");
        const auto &identity = disk_->files.at(manifest)->rootIdentity();
        if (!sameRoot(journal.rootIdentity(), identity))
            return failure(error, "Project root changed before commit; no new snapshot store was written.");
        if (!storeRecovery(root_, identity, recovery, error) ||
            !disk_->recovery->replace(recordV2(recovery), error) || !disk_->recovery->save(error)) return false;
        Files runtimeFiles;
        if (!preflight(root_, manifest, recovery, disk_->savedAssets, committedAssets, &runtimeFiles, error) ||
            !checkExternal(error)) return false;
        if (!journal.replace(recordV2(recovery), error) || !journal.save(error)) return false;
        size_t written = 0;
        const bool committed = commitRecord(&journal, &recovery, &disk_->files, runtimeFiles, &written, error);
        if (!committed || !journal.remove(error)) {
            disk_->interrupted = std::make_unique<Recovery>(std::move(recovery));
            if (error) *error = QString("Save interrupted after %1 writes; journal, source and derived snapshots retained.\n").arg(written) + *error;
            emit changed();
            return false;
        }
        disk_->savedAssets = committedAssets;
        setVersions(&disk_->savedAssets, disk_->files);
        setVersions(&disk_->assets, disk_->files);
        const auto retained = commitPaths(project_, manifest, committedAssets, committedAssets);
        for (auto it = disk_->files.begin(); it != disk_->files.end();)
            if (!retained.contains(it->first)) it = disk_->files.erase(it);
            else ++it;
        disk_->interrupted.reset();
    }
    undo_.setClean();
    watch();
    for (const auto &pair : committedAssets)
        emit assetSnapshotSaved(pair.first, pair.second.snapshot.revision, pair.second.hash);
    const bool clean = dirty() ? writeRecovery(error) : discardRecovery(error);
    if (!clean && error) *error = "Project committed, but recovery maintenance failed: " + *error;
    emit changed();
    return clean;
}

bool ProjectDocument::restoreAssetRecovery(QString *error)
{
    Recovery recovery;
    if (!parseRecordV2(root_, disk_->recovery->saved(), QFileInfo(path_).fileName(), &recovery, error)) return false;
    Files files;
    bool completeAfter = true, exactBefore = true;
    for (const auto &entry : recovery.files) {
        auto file = std::make_unique<File>();
        if (!file->open(root_, entry.path, entry.limit, true, error, true, true)) return false;
        completeAfter = completeAfter && file->exists() && file->saved() == entry.after;
        exactBefore = exactBefore && version(*file, entry.path) == entry.expected && file->saved() == entry.before;
        files.emplace(entry.path, std::move(file));
    }
    if (!completeAfter && !exactBefore)
        return failure(error, "External edits conflict with recovery. Its exact saved base/absence changed; source and derived blobs are retained.");
    AssetStates before, after;
    if (!recordAssets(recovery, &before, &after, error)) return false;
    StudioDraft next = draft_;
    for (const auto &file : recovery.files)
        if (file.path == recovery.manifest) next.manifest = file.after;
        else if (file.path == QString::fromUtf8(project_.entry)) next.script = file.after;
        else if (file.path == QString::fromUtf8(project_.scene)) next.scene = file.after;
    next.selection = recovery.selection;
    NovaProject project{}; NovaScene scene{};
    if (!parse(next, &project, &scene, error)) return false;
    setVersions(&after, files);
    disk_->files = std::move(files);
    disk_->assets = std::move(after);
    for (const auto &pair : bindings(disk_->assets)) disk_->ownedBindings.emplace(pair);
    recoveryPending_ = false;
    push(next, "Recover project and asset snapshots", false);
    watch();
    if (!dirty()) return discardRecovery(error);
    return true;
}

bool ProjectDocument::resumeAssetCommit(QString *error)
{
    File journal;
    Recovery commit;
    const auto manifest = QFileInfo(path_).fileName();
    if (!journal.open(root_, journalName, JournalLimit, true, error) ||
        !parseRecordV2(root_, journal.saved(), manifest, &commit, error)) return false;
    if (!disk_->interrupted) disk_->interrupted = std::make_unique<Recovery>(commit);
    if (!writeRecovery(error)) return false;
    AssetStates before, committedAssets;
    if (!recordAssets(commit, &before, &committedAssets, error)) return false;
    AssetStates current = disk_->assets;
    for (auto &pair : current)
        if (pair.second.snapshot.mode == StudioAssetSnapshot::Mode::SourceOnly && committedAssets.count(pair.first)) {
            const auto &published = committedAssets.at(pair.first);
            pair.second.snapshot.outputs = published.snapshot.outputs;
            pair.second.publication = published.publication;
            pair.second.publication.stale = true;
            pair.second.publication.problem = pair.second.snapshot.derivedProblem;
            seal(&pair.second);
        }
    StudioDraft draft = draft_;
    NovaProject project{}; NovaScene scene{};
    if (!normalizeManifest(&draft, current, disk_->ownedBindings, error) || !parse(draft, &project, &scene, error) ||
        !validateAssets(current, project, manifest, error)) return false;
    recoveryTimer_->stop();
    {
        QScopedValueRollback<bool> writing(writing_, true);
        std::unique_ptr<File> recovered;
        if (!finishCommitV2(root_, &journal, &commit, error, &recovered)) return false;
        Files refreshed;
        const auto paths = commitPaths(project, manifest, committedAssets, current);
        std::map<QString, size_t> limits;
        for (const auto *states : {&committedAssets, &current})
            for (const auto &pair : *states) {
                limits[pair.second.snapshot.source.path] = AssetSourceLimit;
                for (const auto &output : pair.second.snapshot.outputs) limits.emplace(output.path, AssetFileLimit);
            }
        limits[indexName] = IndexLimit;
        for (const auto &path : pathsFor(project, manifest)) limits[path] = limitFor(path);
        for (const auto &path : paths) {
            auto file = std::make_unique<File>();
            if (!file->open(root_, path, limits.at(path), true, error, true, true)) return false;
            const auto previous = std::find_if(commit.files.begin(), commit.files.end(),
                [&path](const RecoveredFile &entry) { return entry.path == path; });
            if (previous != commit.files.end()) {
                const auto &expected = previous->committed.token.isEmpty() ? previous->expected : previous->committed;
                if (!file->exists() || file->saved() != previous->after || version(*file, path) != expected)
                    return failure(error, "Commit finished but a file changed afterward. Newer drafts/recovery are retained: " + path);
            } else if (disk_->files.count(path) && version(*file, path) != version(*disk_->files.at(path), path)) {
                return failure(error, "Commit finished but a newer output's expected disk version changed: " + path);
            }
            refreshed.emplace(path, std::move(file));
        }
        setVersions(&current, refreshed);
        setVersions(&committedAssets, refreshed);
        disk_->files = std::move(refreshed);
        disk_->assets = std::move(current);
        disk_->savedAssets = committedAssets;
        disk_->interrupted.reset();
        draft_ = draft; project_ = project; scene_ = scene;
        disk_->recovery = std::move(recovered);
        recoveryPending_ = false;
    }
    for (const auto &pair : committedAssets)
        emit assetSnapshotSaved(pair.first, pair.second.snapshot.revision, pair.second.hash);
    watch();
    const bool maintained = dirty() ? writeRecovery(error) : discardRecovery(error);
    emit changed();
    return maintained;
}

QString ProjectDocument::interruptedSaveDescription(const QString &manifestPath)
{
    File file;
    QString error;
    const QFileInfo info(manifestPath);
    if (!QFileInfo::exists(QDir(info.absolutePath()).filePath(journalName))) return {};
    if (!file.open(info.absolutePath(), journalName, JournalLimit, true, &error)) return error;
    Recovery recovery;
    if (!parseAnyRecord(info.absolutePath(), file.text(), info.fileName(), &recovery, &error)) return error;
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
    File journal;
    if (!journal.open(root_, journalName, JournalLimit, true, error)) return false;
    if (!journal.exists() && disk_->interrupted) {
        const auto &identity = disk_->files.at(QFileInfo(path_).fileName())->rootIdentity();
        if (!sameRoot(journal.rootIdentity(), identity)) return failure(error, "Project root changed during commit recovery.");
        if (!storeRecovery(root_, identity, *disk_->interrupted, error) ||
            !journal.replace(recordV2(*disk_->interrupted), error) || !journal.save(error)) return false;
    }
    if (QJsonDocument::fromJson(journal.saved()).object()["version"] == 2) return resumeAssetCommit(error);
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
