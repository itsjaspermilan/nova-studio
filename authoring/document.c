#include "document.h"
#include "assets.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <unistd.h>

static bool fail(char *error, size_t size, const char *message)
{
    snprintf(error, size, "%s", message);
    return false;
}

static bool io_fail(char *error, size_t size, const char *operation)
{
    snprintf(error, size, "%s: %s", operation, strerror(errno));
    return false;
}

static void disk_free(NovaDiskText *disk)
{
    free(disk->text);
    *disk = (NovaDiskText){0};
}

void nova_document_close(NovaDocument *document)
{
    free(document->text);
    disk_free(&document->saved);
    disk_free(&document->conflict);
    *document = (NovaDocument){0};
}

/* Authoring deliberately rejects even contained symlinks and hard-linked files. */
static int directory(const NovaDocument *document, char *name, char *error, size_t size)
{
    if (!nova_project_relative_path(document->relative)) {
        fail(error, size, "authoring path is not a contained relative path");
        return -1;
    }
    int fd = open(document->root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) { io_fail(error, size, "open authoring root"); return -1; }
    struct stat root_info;
    if (fstat(fd, &root_info) || root_info.st_dev != document->root_info.st_dev ||
        root_info.st_ino != document->root_info.st_ino) {
        close(fd);
        fail(error, size, "authoring root was replaced; reopen the project explicitly");
        return -1;
    }
    char path[NOVA_PROJECT_PATH_CAPACITY];
    strcpy(path, document->relative);
    char *segment = path, *slash;
    while ((slash = strchr(segment, '/'))) {
        *slash = 0;
        int next = openat(fd, segment, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        int saved = errno;
        close(fd);
        errno = saved;
        if (next < 0) { io_fail(error, size, "open contained authoring directory"); return -1; }
        fd = next;
        segment = slash + 1;
    }
    strcpy(name, segment);
    return fd;
}

static bool same_stat(const struct stat *a, const struct stat *b)
{
    return a->st_dev == b->st_dev && a->st_ino == b->st_ino &&
        a->st_size == b->st_size && a->st_mode == b->st_mode &&
        a->st_nlink == b->st_nlink &&
#ifdef __APPLE__
        a->st_mtimespec.tv_sec == b->st_mtimespec.tv_sec &&
        a->st_mtimespec.tv_nsec == b->st_mtimespec.tv_nsec &&
        a->st_ctimespec.tv_sec == b->st_ctimespec.tv_sec &&
        a->st_ctimespec.tv_nsec == b->st_ctimespec.tv_nsec;
#else
        a->st_mtim.tv_sec == b->st_mtim.tv_sec && a->st_mtim.tv_nsec == b->st_mtim.tv_nsec &&
        a->st_ctim.tv_sec == b->st_ctim.tv_sec && a->st_ctim.tv_nsec == b->st_ctim.tv_nsec;
#endif
}

static bool disk_read(int directory_fd, const char *name, const NovaDocument *document, NovaDiskText *disk,
    char *error, size_t size)
{
    NovaDiskText candidate = {0};
    int fd = openat(directory_fd, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0 && errno == ENOENT && document->allow_missing) {
        candidate.text = calloc(1, 1);
        if (!candidate.text) return fail(error, size, "out of memory opening new output");
        disk_free(disk);
        *disk = candidate;
        return true;
    }
    if (fd < 0) return io_fail(error, size, "open document");
    bool ok = false;
    struct stat after, path_info;
    if (fstat(fd, &candidate.info)) io_fail(error, size, "inspect document");
    else if (!S_ISREG(candidate.info.st_mode) || candidate.info.st_nlink != 1 ||
        candidate.info.st_size < 0 || candidate.info.st_size > (off_t)document->limit)
        fail(error, size, "authoring requires a bounded regular single-link text file");
    else {
        candidate.length = (size_t)candidate.info.st_size;
        candidate.text = malloc(candidate.length + 1);
        if (!candidate.text) fail(error, size, "out of memory reading document");
        else {
            size_t offset = 0;
            while (offset < candidate.length) {
                ssize_t count = read(fd, candidate.text + offset, candidate.length - offset);
                if (count < 0 && errno == EINTR) continue;
                if (count <= 0) break;
                offset += (size_t)count;
            }
            candidate.text[candidate.length] = 0;
            if (offset != candidate.length) fail(error, size, "document changed or could not be read completely");
            else if (!document->binary && memchr(candidate.text, 0, candidate.length))
                fail(error, size, "document contains NUL bytes; not an editable text file");
            else if (fstat(fd, &after) || fstatat(directory_fd, name, &path_info, AT_SYMLINK_NOFOLLOW))
                io_fail(error, size, "recheck document");
            else if (!same_stat(&candidate.info, &after) || !same_stat(&after, &path_info))
                fail(error, size, "document changed while reading; retry");
            else ok = true;
        }
    }
    if (close(fd) && ok) { io_fail(error, size, "close document"); ok = false; }
    if (!ok) disk_free(&candidate);
    else { disk_free(disk); *disk = candidate; }
    return ok;
}

static bool same_disk(const NovaDiskText *a, const NovaDiskText *b)
{
    return a->text && b->text && same_stat(&a->info, &b->info) &&
        a->length == b->length && !memcmp(a->text, b->text, a->length);
}

static bool document_open(NovaDocument *document, const char *root, const char *relative,
    size_t limit, bool binary, bool allow_missing, char *error, size_t size)
{
    NovaDocument candidate = {.limit = limit, .binary = binary, .allow_missing = allow_missing};
    if (!root || !relative || strlen(root) >= sizeof(candidate.root) ||
        strlen(relative) >= sizeof(candidate.relative) || !nova_project_relative_path(relative) ||
        !limit || limit > (allow_missing ? NOVA_ASSET_FILE_LIMIT : NOVA_SOURCE_EDIT_LIMIT))
        return fail(error, size, "invalid authoring root, path or text budget");
    strcpy(candidate.root, root);
    strcpy(candidate.relative, relative);
    if (lstat(root, &candidate.root_info)) return io_fail(error, size, "inspect authoring root");
    if (!S_ISDIR(candidate.root_info.st_mode)) return fail(error, size, "authoring root must not be a symlink");
    char name[NOVA_PROJECT_PATH_CAPACITY];
    int fd = directory(&candidate, name, error, size);
    if (fd < 0) return false;
    bool ok = disk_read(fd, name, &candidate, &candidate.saved, error, size);
    close(fd);
    if (ok) {
        candidate.text = malloc(candidate.saved.length + 1);
        if (!candidate.text) ok = fail(error, size, "out of memory opening draft");
        else {
            memcpy(candidate.text, candidate.saved.text, candidate.saved.length + 1);
            candidate.length = candidate.saved.length;
        }
    }
    if (!ok) nova_document_close(&candidate);
    else { nova_document_close(document); *document = candidate; }
    return ok;
}

bool nova_document_open(NovaDocument *document, const char *root, const char *relative,
    size_t limit, char *error, size_t size)
{
    return document_open(document, root, relative, limit, false, false, error, size);
}

bool nova_document_open_output(NovaDocument *document, const char *root, const char *relative,
    size_t limit, bool binary, char *error, size_t size)
{
    return document_open(document, root, relative, limit, binary, true, error, size);
}

bool nova_document_dirty(const NovaDocument *document)
{
    return document->text && (document->length != document->saved.length ||
        memcmp(document->text, document->saved.text, document->length));
}

bool nova_document_check_disk(NovaDocument *document, char *error, size_t size)
{
    if (!document->text) return fail(error, size, "no authoring document is open");
    char name[NOVA_PROJECT_PATH_CAPACITY];
    int dir = directory(document, name, error, size);
    if (dir < 0) return false;
    NovaDiskText current = {0};
    bool ok = disk_read(dir, name, document, &current, error, size);
    close(dir);
    if (!ok) return false;
    if (!same_disk(&document->saved, &current)) {
        disk_free(&document->conflict);
        document->conflict = current;
        document->has_conflict = true;
        return fail(error, size, "Disk differs from the editor snapshot; draft retained. Review Disk view or explicitly reread.");
    }
    disk_free(&current);
    disk_free(&document->conflict);
    document->has_conflict = false;
    return true;
}

bool nova_document_replace(NovaDocument *document, size_t start, size_t end,
    const char *text, size_t length, char *error, size_t size)
{
    if (!document->text || start > end || end > document->length || (!text && length) ||
        length > document->limit || document->length - (end - start) > document->limit - length ||
        (!document->binary && length && memchr(text, 0, length)))
        return fail(error, size, "invalid text edit or authoring text budget exceeded");
    size_t total = document->length - (end - start) + length;
    char *candidate = malloc(total + 1);
    if (!candidate) return fail(error, size, "out of memory editing document");
    memcpy(candidate, document->text, start);
    if (length) memcpy(candidate + start, text, length);
    memcpy(candidate + start + length, document->text + end, document->length - end);
    candidate[total] = 0;
    free(document->text);
    document->text = candidate;
    document->length = total;
    return true;
}

static bool write_text(int fd, const char *text, size_t length)
{
    while (length) {
        ssize_t count = write(fd, text, length);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) return false;
        text += count;
        length -= (size_t)count;
    }
    return true;
}

bool nova_document_save(NovaDocument *document, bool overwrite, char *error, size_t size)
{
    if (!document->text) return fail(error, size, "no authoring document is open");
    char name[NOVA_PROJECT_PATH_CAPACITY], temporary[96] = {0};
    int dir = directory(document, name, error, size), fd = -1;
    if (dir < 0) return false;
    bool ok = false;
    NovaDiskText current = {0}, rechecked = {0}, committed = {0};
    if (flock(dir, LOCK_EX)) { io_fail(error, size, "lock authoring directory"); goto done; }
    if (!disk_read(dir, name, document, &current, error, size)) goto done;
    const NovaDiskText *expected = overwrite && document->has_conflict ? &document->conflict : &document->saved;
    if (!same_disk(expected, &current)) {
        disk_free(&document->conflict);
        document->conflict = current;
        current = (NovaDiskText){0};
        document->has_conflict = true;
        fail(error, size, "external edit detected: review Disk conflict; cancel, reread, or explicitly overwrite this version");
        goto done;
    }
    if (current.info.st_ino && faccessat(dir, name, W_OK, 0)) {
        io_fail(error, size, "document is not writable; refusing atomic replacement"); goto done;
    }
    static unsigned sequence;
    for (int attempt = 0; attempt < 8; ++attempt) {
        snprintf(temporary, sizeof(temporary), ".nova-edit-%ld-%u", (long)getpid(), ++sequence);
        fd = openat(dir, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
        if (fd >= 0 || errno != EEXIST) break;
    }
    if (fd < 0) { temporary[0] = 0; io_fail(error, size, "create atomic document candidate"); goto done; }
    if (!write_text(fd, document->text, document->length) ||
        fchmod(fd, current.info.st_ino ? current.info.st_mode & 0777 : 0644) || fsync(fd)) {
        io_fail(error, size, "write/sync document candidate"); goto done;
    }
    if (close(fd)) { fd = -1; io_fail(error, size, "close document candidate"); goto done; }
    fd = -1;
    if (!disk_read(dir, name, document, &rechecked, error, size)) goto done;
    if (!same_disk(&current, &rechecked)) {
        disk_free(&document->conflict);
        document->conflict = rechecked;
        rechecked = (NovaDiskText){0};
        document->has_conflict = true;
        fail(error, size, "document changed again before commit; review the new disk conflict");
        goto done;
    }
    if (!current.info.st_ino) {
        if (linkat(dir, temporary, dir, name, 0)) { io_fail(error, size, "commit new document without overwriting"); goto done; }
        if (unlinkat(dir, temporary, 0)) { io_fail(error, size, "remove linked document candidate"); goto done; }
    } else if (renameat(dir, temporary, dir, name)) { io_fail(error, size, "commit document candidate"); goto done; }
    temporary[0] = 0;
    if (!disk_read(dir, name, document, &committed, error, size)) goto done;
    if (committed.length != document->length || memcmp(committed.text, document->text, document->length)) {
        fail(error, size, "file changed immediately after save; draft retained, reread/review before retry");
        goto done;
    }
    disk_free(&document->saved);
    document->saved = committed;
    committed = (NovaDiskText){0};
    disk_free(&document->conflict);
    document->has_conflict = false;
    if (fsync(dir)) { io_fail(error, size, "document committed, but directory durability sync failed"); goto done; }
    ok = true;
done:
    disk_free(&current);
    disk_free(&rechecked);
    disk_free(&committed);
    if (fd >= 0) close(fd);
    if (*temporary) unlinkat(dir, temporary, 0);
    close(dir);
    return ok;
}

bool nova_document_reread(NovaDocument *document, char *error, size_t size)
{
    return document_open(document, document->root, document->relative, document->limit,
        document->binary, document->allow_missing, error, size);
}

bool nova_document_remove(NovaDocument *document, char *error, size_t size)
{
    if (!document->text || nova_document_dirty(document))
        return fail(error, size, "refusing to remove an unopened or dirty document");
    char name[NOVA_PROJECT_PATH_CAPACITY];
    int dir = directory(document, name, error, size);
    if (dir < 0) return false;
    NovaDiskText current = {0};
    bool ok = false;
    if (flock(dir, LOCK_EX)) io_fail(error, size, "lock journal directory");
    else if (disk_read(dir, name, document, &current, error, size)) {
        if (!same_disk(&document->saved, &current))
            fail(error, size, "journal changed externally; refusing removal");
        else if (current.info.st_ino && unlinkat(dir, name, 0))
            io_fail(error, size, "remove committed journal");
        else if (fsync(dir)) io_fail(error, size, "journal removed but directory sync failed");
        else ok = true;
    }
    disk_free(&current);
    close(dir);
    if (ok) nova_document_close(document);
    return ok;
}

void nova_authoring_close(NovaAuthoringProject *project)
{
    nova_document_close(&project->declaration);
    nova_document_close(&project->source);
    *project = (NovaAuthoringProject){0};
}

bool nova_authoring_parse(const NovaAuthoringProject *project, NovaProject *parsed,
    char *error, size_t size)
{
    return nova_project_parse(parsed, project->declaration.text, project->declaration.length, error, size);
}

bool nova_authoring_open(NovaAuthoringProject *project, const char *manifest, char *error, size_t size)
{
    NovaAuthoringProject candidate = {0};
    char root[NOVA_NATIVE_PATH_CAPACITY];
    struct stat info;
    if (!manifest) return fail(error, size, "no project manifest path supplied");
    if (lstat(manifest, &info)) return io_fail(error, size, "inspect project manifest");
    if (!S_ISREG(info.st_mode) || info.st_nlink != 1)
        return fail(error, size, "authoring manifest must be a regular single-link file, not a symlink");
    if (!realpath(manifest, candidate.manifest) || !nova_project_root(manifest, root, error, size))
        return io_fail(error, size, "resolve authoring manifest");
    const char *name = strrchr(candidate.manifest, '/') + 1;
    NovaProject parsed;
    size_t limit = !strcmp(name, "game.nova-game") ? 65536 : NOVA_MANIFEST_LIMIT;
    if (!nova_document_open(&candidate.declaration, root, name, limit, error, size)) {
        nova_authoring_close(&candidate);
        return false;
    }
    if (nova_authoring_parse(&candidate, &parsed, candidate.source_error, sizeof(candidate.source_error)))
        nova_document_open(&candidate.source, root, parsed.entry, NOVA_SOURCE_EDIT_LIMIT,
            candidate.source_error, sizeof(candidate.source_error));
    nova_authoring_close(project);
    *project = candidate;
    return true;
}

bool nova_authoring_property(NovaAuthoringProject *project, const char *directive,
    const char *id, const char *value, char *error, size_t size)
{
    NovaProject parsed;
    if (!directive) return fail(error, size, "no property directive supplied");
    if (!nova_authoring_parse(project, &parsed, error, size)) return false;
    bool entry = !strcmp(directive, "entry"), identity = !strcmp(directive, "identity");
    bool asset = !strcmp(directive, "sprite") || !strcmp(directive, "model") || !strcmp(directive, "audio");
    if ((!entry && !identity && !asset) || !value || strchr(value, '\n') || strchr(value, '\r') ||
        (asset && (!id || !nova_asset_id_valid(id))))
        return fail(error, size, "invalid property directive, ID or value");
    NovaDocument *doc = &project->declaration;
    size_t start = 0;
    while (start < doc->length) {
        size_t end = start;
        while (end < doc->length && doc->text[end] != '\n') ++end;
        size_t first = start;
        while (first < end && (doc->text[first] == ' ' || doc->text[first] == '\t')) ++first;
        size_t token = strlen(directive);
        if (end - first > token && !memcmp(doc->text + first, directive, token) &&
            (doc->text[first + token] == ' ' || doc->text[first + token] == '\t')) {
            size_t at = first + token;
            while (at < end && (doc->text[at] == ' ' || doc->text[at] == '\t')) ++at;
            bool match = !asset || (end - at > strlen(id) && !memcmp(doc->text + at, id, strlen(id)) &&
                (doc->text[at + strlen(id)] == ' ' || doc->text[at + strlen(id)] == '\t'));
            if (match) {
                char replacement[NOVA_PROJECT_PATH_CAPACITY + NOVA_ASSET_ID_CAPACITY + 32];
                int count = asset ? snprintf(replacement, sizeof(replacement), "%s %s", id, value) :
                    snprintf(replacement, sizeof(replacement), "%s", value);
                if (count < 0 || (size_t)count >= sizeof(replacement)) return fail(error, size, "property too long");
                size_t tail = end;
                if (tail > at && doc->text[tail - 1] == '\r') --tail;
                char *candidate = malloc(doc->length - (tail - at) + (size_t)count + 1);
                if (!candidate) return fail(error, size, "out of memory editing property");
                size_t total = doc->length - (tail - at) + (size_t)count;
                memcpy(candidate, doc->text, at);
                memcpy(candidate + at, replacement, (size_t)count);
                memcpy(candidate + at + count, doc->text + tail, doc->length - tail);
                candidate[total] = 0;
                bool ok = nova_project_parse(&parsed, candidate, total, error, size);
                if (ok) ok = nova_document_replace(doc, 0, doc->length, candidate, total, error, size);
                free(candidate);
                return ok;
            }
        }
        start = end + 1;
    }
    return fail(error, size, "property is absent; use Manifest text to add or rename declarations");
}
