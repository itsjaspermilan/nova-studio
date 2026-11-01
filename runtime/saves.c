#include "saves.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <unistd.h>

static bool io_error(char *error, size_t size, const char *operation)
{
    snprintf(error, size, "%s: %s", operation, strerror(errno));
    return false;
}

static bool invalid(char *error, size_t size, const char *message)
{
    snprintf(error, size, "%s", message);
    return false;
}

static void encode(const char *value, char *encoded)
{
    static const char hex[] = "0123456789abcdef";
    while (*value) {
        unsigned char c = (unsigned char)*value++;
        *encoded++ = hex[c >> 4];
        *encoded++ = hex[c & 15];
    }
    *encoded = 0;
}

bool nova_save_store_init(NovaSaveStore *store, const char *base, const char *identity,
    char *error, size_t error_size)
{
    NovaSaveStore candidate = {0};
    if (!base || base[0] != '/' || !identity || !nova_asset_id_valid(identity))
        return invalid(error, error_size, "save store requires an absolute OS base and valid project identity");
    if (!realpath(base, candidate.base)) return io_error(error, error_size, "resolve save app-data base");
    struct stat info;
    if (stat(candidate.base, &info) || !S_ISDIR(info.st_mode))
        return invalid(error, error_size, "save app-data base is not a directory");
    encode(identity, candidate.identity);
    *store = candidate;
    return true;
}

static int child(int parent, const char *name, bool create)
{
    if (create && mkdirat(parent, name, 0700) && errno != EEXIST) return -1;
    return openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
}

static int project_directory(const NovaSaveStore *store, bool create)
{
    int fd = open(store->base, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    const char *segments[] = {"NovaStudio", "projects", store->identity};
    for (size_t i = 0; fd >= 0 && i < sizeof(segments) / sizeof(*segments); ++i) {
        int next = child(fd, segments[i], create);
        int saved = errno;
        close(fd);
        errno = saved;
        fd = next;
    }
    return fd;
}

static bool filename(const char *key, char *name, char *error, size_t error_size)
{
    if (!key || !nova_asset_id_valid(key))
        return invalid(error, error_size, "invalid save key");
    encode(key, name);
    strcat(name, ".sav");
    return true;
}

static bool read_all(int fd, unsigned char *data, size_t size)
{
    while (size) {
        ssize_t bytes = read(fd, data, size);
        if (bytes < 0 && errno == EINTR) continue;
        if (bytes <= 0) { if (!bytes) errno = EIO; return false; }
        data += bytes;
        size -= (size_t)bytes;
    }
    return true;
}

bool nova_save_read(void *context, const char *key, unsigned char *data, size_t *length,
    bool *found, char *error, size_t error_size)
{
    NovaSaveStore *store = context;
    char name[NOVA_ASSET_ID_CAPACITY * 2 + 4];
    if (!filename(key, name, error, error_size)) return false;
    *length = 0; *found = false;
    int directory = project_directory(store, false);
    if (directory < 0) {
        if (errno == ENOENT) return true;
        return io_error(error, error_size, "open project save directory");
    }
    int fd = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    int saved = errno;
    close(directory);
    errno = saved;
    if (fd < 0) {
        if (errno == ENOENT) return true;
        return io_error(error, error_size, "open save");
    }
    unsigned char bytes[12 + NOVA_SAVE_DATA_LIMIT];
    struct stat info;
    bool success = false;
    if (fstat(fd, &info)) io_error(error, error_size, "inspect save");
    else if (!S_ISREG(info.st_mode) || info.st_nlink != 1 || info.st_size < 12 ||
        info.st_size > (off_t)sizeof(bytes)) invalid(error, error_size, "save is not a bounded regular version-1 file");
    else if (!read_all(fd, bytes, (size_t)info.st_size)) io_error(error, error_size, "read save");
    else {
        uint32_t size = (uint32_t)bytes[8] | ((uint32_t)bytes[9] << 8) |
            ((uint32_t)bytes[10] << 16) | ((uint32_t)bytes[11] << 24);
        if (memcmp(bytes, "NOVASV1\n", 8) || size > NOVA_SAVE_DATA_LIMIT || (off_t)size + 12 != info.st_size)
            invalid(error, error_size, "save has invalid version, length or trailing data");
        else {
            memcpy(data, bytes + 12, size);
            *length = size; *found = true; success = true;
        }
    }
    if (close(fd) && success) return io_error(error, error_size, "close save");
    return success;
}

static bool write_all(int fd, const unsigned char *data, size_t size)
{
    while (size) {
        ssize_t bytes = write(fd, data, size);
        if (bytes < 0 && errno == EINTR) continue;
        if (bytes <= 0) { if (!bytes) errno = EIO; return false; }
        data += bytes; size -= (size_t)bytes;
    }
    return true;
}

static bool key_budget(int directory, const char *name, char *error, size_t error_size)
{
    struct stat info;
    if (!fstatat(directory, name, &info, AT_SYMLINK_NOFOLLOW)) {
        if (!S_ISREG(info.st_mode) || info.st_nlink != 1)
            return invalid(error, error_size, "existing save must be a regular, single-link file");
        return true;
    }
    if (errno != ENOENT) return io_error(error, error_size, "inspect save destination");
    DIR *dir = fdopendir(dup(directory));
    if (!dir) return io_error(error, error_size, "enumerate save keys");
    size_t count = 0;
    errno = 0;
    struct dirent *entry;
    while ((entry = readdir(dir))) {
        size_t size = strlen(entry->d_name);
        if (size >= 4 && !strcmp(entry->d_name + size - 4, ".sav")) count++;
    }
    int saved = errno;
    closedir(dir);
    errno = saved;
    if (saved) return io_error(error, error_size, "enumerate save keys");
    if (count >= NOVA_SAVE_KEY_LIMIT)
        return invalid(error, error_size, "project exceeds 32 persistent save keys");
    return true;
}

bool nova_save_write(NovaSaveStore *store, const char *key, const unsigned char *data,
    size_t length, char *error, size_t error_size)
{
    char name[NOVA_ASSET_ID_CAPACITY * 2 + 4], temporary[64] = {0};
    if (!filename(key, name, error, error_size)) return false;
    if (length > NOVA_SAVE_DATA_LIMIT || (length && !data))
        return invalid(error, error_size, "save value exceeds 4096 bytes or has no data");
    int directory = project_directory(store, true);
    if (directory < 0) return io_error(error, error_size, "create project save directory");
    bool success = false;
    int fd = -1;
    if (flock(directory, LOCK_EX)) { io_error(error, error_size, "lock project saves"); goto done; }
    if (!key_budget(directory, name, error, error_size)) goto done;
    for (int attempt = 0; attempt < 8; ++attempt) {
        snprintf(temporary, sizeof(temporary), ".tmp-%ld-%u", (long)getpid(), ++store->temporary);
        fd = openat(directory, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
        if (fd >= 0 || errno != EEXIST) break;
    }
    if (fd < 0) { io_error(error, error_size, "create atomic save candidate"); temporary[0] = 0; goto done; }
    unsigned char bytes[12 + NOVA_SAVE_DATA_LIMIT] = "NOVASV1\n";
    for (int i = 0; i < 4; ++i) bytes[8 + i] = (unsigned char)(length >> (i * 8));
    if (length) memcpy(bytes + 12, data, length);
    if (!write_all(fd, bytes, length + 12) || fsync(fd)) {
        io_error(error, error_size, "write/sync atomic save candidate"); goto done;
    }
    if (close(fd)) { fd = -1; io_error(error, error_size, "close atomic save candidate"); goto done; }
    fd = -1;
    if (renameat(directory, temporary, directory, name)) {
        io_error(error, error_size, "commit atomic save"); goto done;
    }
    temporary[0] = 0;
    if (fsync(directory)) {
        io_error(error, error_size, "save committed, but directory durability sync failed"); goto done;
    }
    success = true;
done:
    if (fd >= 0) close(fd);
    if (*temporary) unlinkat(directory, temporary, 0);
    close(directory);
    return success;
}
