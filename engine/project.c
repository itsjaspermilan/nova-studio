#include "project.h"

#include <stdio.h>
#include <string.h>

bool nova_asset_id_valid(const char *id)
{
    size_t length = strlen(id);
    if (!length || length >= NOVA_ASSET_ID_CAPACITY) return false;
    for (size_t i = 0; i < length; ++i) {
        char c = id[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
    }
    return true;
}

bool nova_project_relative_path(const char *path)
{
    size_t length = strlen(path);
    if (!length || length >= NOVA_PROJECT_PATH_CAPACITY) return false;
    const char *segment = path;
    for (const char *p = path; ; ++p) {
        unsigned char c = (unsigned char)*p;
        if (c && (c < 32 || c > 126 || c == '\\' || c == ':' || c == '#')) return false;
        if (!c || c == '/') {
            size_t size = (size_t)(p - segment);
            if (!size || (size == 1 && segment[0] == '.') ||
                (size == 2 && segment[0] == '.' && segment[1] == '.')) return false;
            segment = p + 1;
        }
        if (!c) return true;
    }
}

static char *token(char **cursor)
{
    char *start = *cursor;
    while (*start == ' ' || *start == '\t') start++;
    char *end = start;
    while (*end && *end != ' ' && *end != '\t') end++;
    if (*end) *end++ = '\0';
    *cursor = end;
    return start;
}

bool nova_project_parse(NovaProject *project, const char *source, size_t length,
    char *error, size_t error_size)
{
    NovaProject parsed = {0};
    const char *reason = "manifest must be nonempty text, at most 16384 bytes, without NUL";
    size_t line_number = 0;
    if (!source || !length || length > NOVA_MANIFEST_LIMIT || memchr(source, '\0', length)) goto fail;
    reason = "manifest must use printable ASCII text, tabs and LF/CRLF line endings";
    for (size_t i = 0; i < length; ++i) {
        unsigned char c = (unsigned char)source[i];
        if ((c < 32 && c != '\t' && c != '\n' && c != '\r') || c > 126) goto fail;
    }
    bool header = false;
    size_t offset = 0;
    while (offset < length) {
        char line[NOVA_PROJECT_PATH_CAPACITY + NOVA_ASSET_ID_CAPACITY + 32];
        size_t end = offset;
        while (end < length && source[end] != '\n') end++;
        size_t size = end - offset;
        line_number++;
        reason = "line is too long";
        if (size >= sizeof(line)) goto fail;
        memcpy(line, source + offset, size);
        line[size] = '\0';
        offset = end < length ? end + 1 : end;
        while (size && (line[size - 1] == '\r' || line[size - 1] == ' ' || line[size - 1] == '\t'))
            line[--size] = '\0';
        char *cursor = line;
        char *directive = token(&cursor);
        if (!*directive || *directive == '#') continue;
        if (!header) {
            reason = "first directive must be nova-project 1, 2 or 3";
            char *version = token(&cursor);
            if (strcmp(directive, "nova-project") ||
                (strcmp(version, "1") && strcmp(version, "2") && strcmp(version, "3")) || *token(&cursor)) goto fail;
            parsed.version = (unsigned)(version[0] - '0');
            header = true;
            continue;
        }
        while (*cursor == ' ' || *cursor == '\t') cursor++;
        if (!strcmp(directive, "identity") && parsed.version >= 2) {
            char *id = token(&cursor);
            reason = "v2/v3 identity must occur once and be a 1..63 ASCII identifier";
            if (*parsed.identity || !nova_asset_id_valid(id) || *token(&cursor)) goto fail;
            memcpy(parsed.identity, id, strlen(id) + 1);
        } else if (!strcmp(directive, "scene") && parsed.version == 3) {
            reason = "v3 scene must occur once and use a contained .nova-scene path";
            size_t path_size = strlen(cursor);
            if (*parsed.scene || !nova_project_relative_path(cursor) || path_size < 11 ||
                strcmp(cursor + path_size - 11, ".nova-scene")) goto fail;
            memcpy(parsed.scene, cursor, path_size + 1);
        } else if (!strcmp(directive, "entry")) {
            reason = "entry must occur once and use a contained project-relative .lua path";
            if (*parsed.entry || !nova_project_relative_path(cursor)) goto fail;
            size_t path_size = strlen(cursor);
            if (path_size < 4 || strcmp(cursor + path_size - 4, ".lua")) goto fail;
            memcpy(parsed.entry, cursor, path_size + 1);
        } else {
            NovaAssetType type;
            const char *extension;
            if (!strcmp(directive, "sprite")) { type = NOVA_ASSET_SPRITE; extension = ".png"; }
            else if (!strcmp(directive, "model")) { type = NOVA_ASSET_MODEL; extension = ".glb"; }
            else if (!strcmp(directive, "audio") && parsed.version >= 2) { type = NOVA_ASSET_AUDIO; extension = ".wav"; }
            else { reason = "unknown directive for this manifest version"; goto fail; }
            reason = "at most 32 assets may be declared";
            if (parsed.count == NOVA_MAX_ASSETS) goto fail;
            char *id = token(&cursor);
            while (*cursor == ' ' || *cursor == '\t') cursor++;
            reason = "asset ID must be 1..63 ASCII letters, digits, underscores or hyphens";
            if (!nova_asset_id_valid(id)) goto fail;
            reason = "duplicate asset identifier";
            for (size_t i = 0; i < parsed.count; ++i)
                if (!strcmp(parsed.assets[i].id, id)) goto fail;
            reason = "asset path must be contained and have the declared .png/.glb/.wav extension";
            if (!nova_project_relative_path(cursor)) goto fail;
            size_t path_size = strlen(cursor);
            if (path_size < 4 || strcmp(cursor + path_size - 4, extension)) goto fail;
            NovaAsset *asset = &parsed.assets[parsed.count++];
            asset->type = type;
            memcpy(asset->id, id, strlen(id) + 1);
            memcpy(asset->path, cursor, path_size + 1);
        }
    }
    reason = "manifest requires a supported header, exactly one entry, and identity for v2/v3";
    if (!header || !*parsed.entry) goto fail;
    if (parsed.version >= 2 && !*parsed.identity) goto fail;
    reason = "manifest v3 requires exactly one scene";
    if (parsed.version == 3 && !*parsed.scene) goto fail;
    *project = parsed;
    if (error_size) error[0] = '\0';
    return true;
fail:
    snprintf(error, error_size, "manifest line %zu: %s", line_number, reason);
    return false;
}
