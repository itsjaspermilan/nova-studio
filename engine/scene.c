#include "scene.h"
#include "transform.h"
#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static bool fail(char *error, size_t size, const char *message)
{
    snprintf(error, size, "%s", message);
    return false;
}

static bool bounded(NovaVec3 value, float minimum, float maximum)
{
    return isfinite(value.x) && isfinite(value.y) && isfinite(value.z) &&
        value.x >= minimum && value.x <= maximum && value.y >= minimum &&
        value.y <= maximum && value.z >= minimum && value.z <= maximum;
}

static bool valid_name(const char *text, size_t capacity)
{
    const unsigned char *p = (const unsigned char *)text;
    const unsigned char *end = memchr(text, 0, capacity);
    if (!end || end == p) return false;
    while (p < end) {
        unsigned value = *p++;
        if (value < 32 || value == 127) return false;
        if (value < 128) continue;
        unsigned remaining, minimum;
        if (value >= 0xc2 && value <= 0xdf) { value &= 31; remaining = 1; minimum = 0x80; }
        else if (value >= 0xe0 && value <= 0xef) { value &= 15; remaining = 2; minimum = 0x800; }
        else if (value >= 0xf0 && value <= 0xf4) { value &= 7; remaining = 3; minimum = 0x10000; }
        else return false;
        while (remaining--) {
            if (p == end || (*p & 0xc0) != 0x80) return false;
            value = (value << 6) | (*p++ & 63);
        }
        if (value < minimum || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return false;
    }
    return true;
}

bool nova_scene_validate(const NovaScene *scene, const NovaAsset *assets,
    size_t count, char *error, size_t size)
{
    if (!scene || (scene->version != 1 && scene->version != 2) ||
        scene->count > NOVA_MAX_OBJECTS || count > NOVA_MAX_ASSETS || (count && !assets) ||
        (scene->mode != NOVA_2D && scene->mode != NOVA_3D && scene->mode != NOVA_MIXED))
        return fail(error, size, "scene version, mode or object/asset count is invalid");
    NovaVec3 c = scene->camera_position, t = scene->camera_target;
    if (!bounded(c, -10000, 10000) || !bounded(t, -10000, 10000) ||
        !isfinite(scene->camera_fov) || scene->camera_fov < 10 || scene->camera_fov > 120 ||
        fabsf(c.x - t.x) + fabsf(c.z - t.z) <= 0.001f)
        return fail(error, size, "camera requires finite bounds, FOV 10..120 and a nonvertical view direction");
    for (size_t i = 0; i < scene->count; ++i) {
        const NovaSceneObject *object = &scene->objects[i];
        if (!memchr(object->id, 0, sizeof(object->id)) || !nova_asset_id_valid(object->id) ||
            !valid_name(object->name, sizeof(object->name)))
            return fail(error, size, "object requires a stable ASCII ID and a nonempty UTF-8 name (at most 127 bytes)");
        for (size_t j = 0; j < i; ++j)
            if (!strcmp(object->id, scene->objects[j].id)) return fail(error, size, "duplicate scene object ID");
        bool flat = object->type == NOVA_RECTANGLE || object->type == NOVA_SPRITE;
        bool solid = object->type == NOVA_CUBE || object->type == NOVA_MODEL;
        if ((!flat && !solid) || (flat && scene->mode == NOVA_3D) || (solid && scene->mode == NOVA_2D))
            return fail(error, size, "object visual type does not match the scene dimension");
        if (!bounded(object->position, -10000, 10000) || !bounded(object->size, 0.01f, 1000) ||
            (flat && (object->position.z != 0 || object->size.z != 1)))
            return fail(error, size, "object positions must be +/-10000, sizes 0.01..1000; 2D requires Z=0, depth=1");
        if (!nova_rotation_valid(object->rotation))
            return fail(error, size, "object rotation requires finite X/Y/Z degrees within +/-360");
        if ((flat || scene->version == 1) &&
            (object->rotation.x != 0 || object->rotation.y != 0 || object->rotation.z != 0))
            return fail(error, size, "rotation requires a 3D object and nova-scene 2; v1 and 2D use zero rotation");
        if (!memchr(object->asset, 0, sizeof(object->asset)))
            return fail(error, size, "unterminated object asset reference");
        if (object->type == NOVA_SPRITE || object->type == NOVA_MODEL) {
            if (object->color.r != 255 || object->color.g != 255 || object->color.b != 255)
                return fail(error, size, "sprite/model tint is not supported; asset colour must be 255 255 255");
            bool found = false;
            for (size_t j = 0; j < count; ++j)
                if (!strcmp(object->asset, assets[j].id) &&
                    assets[j].type == (flat ? NOVA_ASSET_SPRITE : NOVA_ASSET_MODEL)) found = true;
            if (!found) return fail(error, size, "object references an undeclared asset or wrong asset type");
        } else if (*object->asset) return fail(error, size, "primitive object must not reference an asset");
    }
    if (size) error[0] = 0;
    return true;
}

static char *word(char **cursor)
{
    char *start = *cursor;
    while (*start == ' ' || *start == '\t') ++start;
    char *end = start;
    while (*end && *end != ' ' && *end != '\t') ++end;
    if (*end) *end++ = 0;
    *cursor = end;
    return start;
}

static bool number(char **cursor, float *value)
{
    char *token = word(cursor), *end;
    errno = 0;
    float result = strtof(token, &end);
    if (!*token || *end || errno || !isfinite(result)) return false;
    *value = result;
    return true;
}

static bool vector(char **cursor, NovaVec3 *value)
{
    return number(cursor, &value->x) && number(cursor, &value->y) && number(cursor, &value->z);
}

static bool colour(char **cursor, NovaColor *value)
{
    NovaVec3 channels;
    if (!vector(cursor, &channels) || !bounded(channels, 0, 255) ||
        channels.x != floorf(channels.x) || channels.y != floorf(channels.y) ||
        channels.z != floorf(channels.z)) return false;
    *value = (NovaColor){(unsigned char)channels.x, (unsigned char)channels.y, (unsigned char)channels.z, 255};
    return true;
}

bool nova_scene_parse(NovaScene *scene, const char *source, size_t length,
    const NovaAsset *assets, size_t count, char *error, size_t size)
{
    if (!source || !length || length > NOVA_SCENE_LIMIT || memchr(source, 0, length))
        return fail(error, size, "scene must be nonempty text without NUL, at most 64 KiB");
    NovaScene candidate = {0};
    unsigned seen = 0;
    size_t offset = 0, line_number = 0;
    const char *reason = "invalid scene directive or arguments";
    while (offset < length) {
        size_t end = offset;
        while (end < length && source[end] != '\n') ++end;
        char line[1024];
        size_t bytes = end - offset;
        ++line_number;
        if (bytes >= sizeof(line)) { reason = "line exceeds 1023 bytes"; goto invalid; }
        memcpy(line, source + offset, bytes);
        line[bytes] = 0;
        offset = end < length ? end + 1 : end;
        if (bytes && line[bytes - 1] == '\r') line[--bytes] = 0;
        char *cursor = line;
        char *directive = word(&cursor);
        if (!*directive || *directive == '#') continue;
        if (!seen) {
            char *version = word(&cursor);
            if (strcmp(directive, "nova-scene") || (strcmp(version, "1") && strcmp(version, "2")) || *word(&cursor))
                { reason = "first directive must be nova-scene 1 or 2"; goto invalid; }
            candidate.version = !strcmp(version, "1") ? 1 : 2;
            seen = 1;
        } else if (!strcmp(directive, "mode") && !(seen & 2)) {
            char *mode = word(&cursor);
            if (!strcmp(mode, "2d")) candidate.mode = NOVA_2D;
            else if (!strcmp(mode, "3d")) candidate.mode = NOVA_3D;
            else if (!strcmp(mode, "mixed")) candidate.mode = NOVA_MIXED;
            else goto invalid;
            if (*word(&cursor)) goto invalid;
            seen |= 2;
        } else if (!strcmp(directive, "background") && !(seen & 4)) {
            if (!colour(&cursor, &candidate.background) || *word(&cursor)) goto invalid;
            seen |= 4;
        } else if (!strcmp(directive, "camera") && !(seen & 8)) {
            if (!vector(&cursor, &candidate.camera_position) || !vector(&cursor, &candidate.camera_target) ||
                !number(&cursor, &candidate.camera_fov) || *word(&cursor)) goto invalid;
            seen |= 8;
        } else if (!strcmp(directive, "object")) {
            if (candidate.count == NOVA_MAX_OBJECTS) { reason = "at most 128 scene objects"; goto invalid; }
            NovaSceneObject *object = &candidate.objects[candidate.count++];
            char *id = word(&cursor), *type = word(&cursor), *asset = word(&cursor);
            if (strlen(id) >= sizeof(object->id) || strlen(asset) >= sizeof(object->asset)) goto invalid;
            strcpy(object->id, id);
            if (strcmp(asset, "-")) strcpy(object->asset, asset);
            if (!strcmp(type, "rectangle")) object->type = NOVA_RECTANGLE;
            else if (!strcmp(type, "cube")) object->type = NOVA_CUBE;
            else if (!strcmp(type, "sprite")) object->type = NOVA_SPRITE;
            else if (!strcmp(type, "model")) object->type = NOVA_MODEL;
            else goto invalid;
            if (!vector(&cursor, &object->position) || !vector(&cursor, &object->size) ||
                (candidate.version == 2 && !vector(&cursor, &object->rotation)) ||
                !colour(&cursor, &object->color)) goto invalid;
            while (*cursor == ' ' || *cursor == '\t') ++cursor;
            if (strlen(cursor) >= sizeof(object->name)) goto invalid;
            strcpy(object->name, cursor);
        } else goto invalid;
    }
    if (seen != 15) return fail(error, size, "scene requires exactly one header, mode, background and camera");
    if (!nova_scene_validate(&candidate, assets, count, error, size)) return false;
    *scene = candidate;
    return true;
invalid:
    snprintf(error, size, "scene line %zu: %s", line_number, reason);
    return false;
}

void nova_scene_frame(const NovaScene *scene, const NovaAsset *assets, size_t count, NovaFrame *frame)
{
    *frame = (NovaFrame){.mode = scene->mode, .background = scene->background,
        .camera_position = scene->camera_position, .camera_target = scene->camera_target,
        .camera_fov = scene->camera_fov, .count = scene->count};
    for (size_t i = 0; i < scene->count; ++i) {
        const NovaSceneObject *object = &scene->objects[i];
        NovaCommand *command = &frame->commands[i];
        *command = (NovaCommand){.type = object->type, .position = object->position,
            .size = object->size, .rotation = object->rotation, .color = object->color};
        for (size_t j = 0; j < count; ++j)
            if (!strcmp(object->asset, assets[j].id)) { command->asset = j; break; }
    }
}
