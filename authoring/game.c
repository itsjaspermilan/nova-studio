#include "game.h"
#include "model.h"
#include "assets.h"

#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static bool fail(char *error, size_t size, const char *text)
{
    snprintf(error, size, "%s", text);
    return false;
}

bool nova_game_name(const char *name)
{
    if (!name || !*name || strlen(name) >= 32) return false;
    for (const char *p = name; *p; ++p)
        if (!((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') ||
            (*p >= '0' && *p <= '9') || *p == '_')) return false;
    return true;
}

#define FIND(kind, field, count, type) \
const type *nova_game_##kind(const NovaGame *g, uint32_t id) { \
    for (size_t i = 0; i < g->count; ++i) if (g->field[i].id == id) return &g->field[i]; \
    return NULL; \
}
FIND(resource, resource, resources, NovaGameResource)
FIND(object, object, objects, NovaGameObject)
FIND(room, room, rooms, NovaGameRoom)
FIND(instance, instance, instances, NovaGameInstance)
#undef FIND

static bool vector(NovaVec3 v, float bound)
{
    return isfinite(v.x) && isfinite(v.y) && isfinite(v.z) &&
        fabsf(v.x) <= bound && fabsf(v.y) <= bound && fabsf(v.z) <= bound;
}

bool nova_game_validate(const NovaGame *g, char *error, size_t size)
{
    if (!g || !g->next_id || g->next_id > 1000000 || g->resources > NOVA_MAX_ASSETS ||
        g->objects > NOVA_GAME_OBJECTS || !g->rooms || g->rooms > NOVA_GAME_ROOMS ||
        g->instances > NOVA_GAME_INSTANCES || !nova_game_room(g, g->start))
        return fail(error, size, "Game requires a starting room, bounded counts and valid next ID");
    uint32_t ids[NOVA_MAX_ASSETS + NOVA_GAME_OBJECTS + NOVA_GAME_ROOMS + NOVA_GAME_INSTANCES];
    size_t count = 0;
#define CHECK_ENTRIES(field, total) \
    for (size_t i = 0; i < g->total; ++i) { \
        if (!g->field[i].id || g->field[i].id >= g->next_id || \
            !memchr(g->field[i].name,0,sizeof(g->field[i].name)) || !nova_game_name(g->field[i].name)) \
            return fail(error, size, "Invalid stable ID or name (1..31 ASCII letters/digits/underscore)"); \
        for (size_t j = 0; j < count; ++j) if (ids[j] == g->field[i].id) \
            return fail(error, size, "Duplicate stable ID"); \
        ids[count++] = g->field[i].id; \
        for (size_t j = 0; j < i; ++j) if (!strcmp(g->field[i].name, g->field[j].name)) \
            return fail(error, size, "Duplicate name in resource category"); \
    }
    CHECK_ENTRIES(resource, resources)
    CHECK_ENTRIES(object, objects)
    CHECK_ENTRIES(room, rooms)
    CHECK_ENTRIES(instance, instances)
#undef CHECK_ENTRIES
    for (size_t i = 0; i < g->resources; ++i) {
        const NovaGameResource *r = &g->resource[i];
        if ((r->type != NOVA_ASSET_SPRITE && r->type != NOVA_ASSET_MODEL) ||
            !memchr(r->path,0,sizeof(r->path)) || !nova_project_relative_path(r->path) ||
            strchr(r->path,' ') || strchr(r->path,'\t') || strlen(r->path) < 4 ||
            strcmp(r->path+strlen(r->path)-4,r->type == NOVA_ASSET_SPRITE ? ".png" : ".glb"))
            return fail(error, size, "Appearance must be a contained PNG sprite or static GLB model");
    }
    for (size_t i = 0; i < g->objects; ++i) {
        const NovaGameObject *o = &g->object[i];
        const NovaGameResource *a = nova_game_resource(g,o->resource);
        if (!a || !vector(o->create, 10000) ||
            !vector(o->velocity, 1000) || !vector(o->primary, 1000) ||
            !isfinite(o->speed) || o->speed < 0 || o->speed > 1000 ||
            !isfinite(o->size) || o->size < 0.01f || o->size > 1000 ||
            (a->type == NOVA_ASSET_SPRITE && (o->create.z || o->velocity.z || o->primary.z)))
            return fail(error, size, "Object appearance/reference, position, movement or size is invalid");
    }
    for (size_t i = 0; i < g->rooms; ++i) {
        const NovaGameRoom *r = &g->room[i];
        NovaVec3 delta = {r->camera.x-r->target.x, r->camera.y-r->target.y, r->camera.z-r->target.z};
        if ((r->mode != NOVA_2D && r->mode != NOVA_3D) || !isfinite(r->snap) ||
            r->snap < 0.01f || r->snap > 128 || !vector(r->camera, 10000) ||
            !vector(r->target, 10000) || !isfinite(r->fov) || r->fov < 10 || r->fov > 120 ||
            (r->mode == NOVA_3D && (delta.x*delta.x+delta.y*delta.y+delta.z*delta.z < 0.01f ||
                fabsf(delta.x)+fabsf(delta.z) <= 0.001f)))
            return fail(error, size, "Room mode, snap or camera is invalid");
    }
    for (size_t i = 0; i < g->instances; ++i) {
        const NovaGameInstance *n = &g->instance[i];
        const NovaGameObject *o = nova_game_object(g, n->object);
        const NovaGameRoom *r = nova_game_room(g, n->room);
        const NovaGameResource *a = o ? nova_game_resource(g, o->resource) : NULL;
        if (!r || !a || (r->mode == NOVA_2D ? a->type != NOVA_ASSET_SPRITE : a->type != NOVA_ASSET_MODEL) ||
            !vector(n->position, 10000) || !isfinite(n->scale) || n->scale < 0.01f ||
            n->scale > 100 || o->size * n->scale > 1000 || (r->mode == NOVA_2D && n->position.z))
            return fail(error, size, "Instance reference, room/appearance dimension or transform is invalid");
    }
    return true;
}

typedef struct { char *data; size_t used, capacity; bool failed; } Text;
static void append(Text *t, const char *format, ...)
{
    if (t->failed) return;
    va_list args;
    va_start(args, format);
    int n = vsnprintf(t->data+t->used, t->capacity-t->used, format, args);
    va_end(args);
    if (n < 0 || (size_t)n >= t->capacity-t->used) t->failed = true;
    else t->used += (size_t)n;
}

bool nova_game_serialize(const NovaGame *g, char **bytes, size_t *length, char *error, size_t size)
{
    if (!nova_game_validate(g, error, size)) return false;
    Text t = {.data = malloc(NOVA_GAME_BYTES), .capacity = NOVA_GAME_BYTES};
    if (!t.data) return fail(error, size, "Out of memory serializing game");
    append(&t, "nova-game 1\nnext %u\nstart %u\n", g->next_id, g->start);
    for (size_t i = 0; i < g->resources; ++i) {
        const NovaGameResource *r = &g->resource[i];
        append(&t, "resource %u %s %u %s\n", r->id, r->name, r->type, r->path);
    }
    for (size_t i = 0; i < g->objects; ++i) {
        const NovaGameObject *o = &g->object[i];
        append(&t, "object %u %s %u %u %u %u %u %.9g %.9g %.9g %.9g %.9g %.9g %.9g %.9g %.9g %.9g %.9g\n",
            o->id, o->name, o->resource, o->create_position, o->controls, o->step_move, o->primary_move,
            (double)o->create.x, (double)o->create.y, (double)o->create.z,
            (double)o->velocity.x, (double)o->velocity.y, (double)o->velocity.z,
            (double)o->primary.x, (double)o->primary.y, (double)o->primary.z, (double)o->speed, (double)o->size);
    }
    for (size_t i = 0; i < g->rooms; ++i) {
        const NovaGameRoom *r = &g->room[i];
        append(&t, "room %u %s %u %.9g %.9g %.9g %.9g %.9g %.9g %.9g %.9g\n",
            r->id, r->name, r->mode, (double)r->snap, (double)r->camera.x, (double)r->camera.y,
            (double)r->camera.z, (double)r->target.x, (double)r->target.y, (double)r->target.z, (double)r->fov);
    }
    for (size_t i = 0; i < g->instances; ++i) {
        const NovaGameInstance *n = &g->instance[i];
        append(&t, "instance %u %s %u %u %.9g %.9g %.9g %.9g\n", n->id, n->name,
            n->object, n->room, (double)n->position.x, (double)n->position.y, (double)n->position.z, (double)n->scale);
    }
    if (t.failed) { free(t.data); return fail(error, size, "Game byte budget exceeded"); }
    *bytes = t.data; *length = t.used;
    return true;
}

static bool integer_fields(const char *line)
{
    unsigned mask = !strncmp(line,"resource ",9) ? (1u<<1)|(1u<<3) :
        !strncmp(line,"object ",7) ? (1u<<1)|(1u<<3)|(1u<<4)|(1u<<5)|(1u<<6)|(1u<<7) :
        !strncmp(line,"room ",5) ? (1u<<1)|(1u<<3) :
        !strncmp(line,"instance ",9) ? (1u<<1)|(1u<<3)|(1u<<4) :
        !strncmp(line,"next ",5) || !strncmp(line,"start ",6) ? 1u<<1 : 0;
    unsigned index = 0;
    const char *p = line;
    while (*p && index < 20) {
        while (*p == ' ' || *p == '\t') ++p;
        const char *start = p;
        while (*p && *p != ' ' && *p != '\t') ++p;
        if (mask & (1u<<index)) {
            uint32_t value = 0;
            if (p == start) return false;
            for (const char *c = start; c < p; ++c) {
                if (*c < '0' || *c > '9' || value > 100000) return false;
                value = value*10+(uint32_t)(*c-'0');
                if (value > 1000000) return false;
            }
        }
        ++index;
    }
    return true;
}

bool nova_game_parse(const char *bytes, size_t length, NovaGame *game, char *error, size_t size)
{
    if (!bytes || length > NOVA_GAME_BYTES || memchr(bytes, 0, length))
        return fail(error, size, "Invalid game bytes");
    NovaGame g = {0};
    char *text = malloc(length+1);
    if (!text) return fail(error, size, "Out of memory parsing game");
    memcpy(text, bytes, length); text[length] = 0;
    char *cursor = text;
    unsigned line = 0;
    bool ok = true, next = false, start = false;
    while (*cursor && ok) {
        char *end = strchr(cursor, '\n');
        if (end) *end = 0;
        ++line;
        int used = 0;
        if (!integer_fields(cursor)) { ok = false; break; }
        if (line == 1) ok = !strcmp(cursor, "nova-game 1");
        else if (!strncmp(cursor, "next ", 5) && !next) {
            ok = sscanf(cursor, "next %u%n", &g.next_id, &used) == 1; next = true;
        } else if (!strncmp(cursor, "start ", 6) && !start) {
            ok = sscanf(cursor, "start %u%n", &g.start, &used) == 1; start = true;
        } else if (!strncmp(cursor, "resource ", 9) && g.resources < NOVA_MAX_ASSETS) {
            NovaGameResource *r = &g.resource[g.resources++];
            unsigned type;
            ok = sscanf(cursor, "resource %u %31s %u %511s%n", &r->id, r->name, &type, r->path, &used) == 4;
            if (ok) { ok = type <= NOVA_ASSET_MODEL; r->type = (NovaAssetType)type; }
        } else if (!strncmp(cursor, "object ", 7) && g.objects < NOVA_GAME_OBJECTS) {
            NovaGameObject *o = &g.object[g.objects++];
            unsigned a, b, c, d;
            ok = sscanf(cursor, "object %u %31s %u %u %u %u %u %f %f %f %f %f %f %f %f %f %f %f%n",
                &o->id, o->name, &o->resource, &a, &b, &c, &d,
                &o->create.x, &o->create.y, &o->create.z, &o->velocity.x, &o->velocity.y, &o->velocity.z,
                &o->primary.x, &o->primary.y, &o->primary.z, &o->speed, &o->size, &used) == 18;
            if (ok) { ok = a <= 1 && b <= 1 && c <= 1 && d <= 1;
                o->create_position = a; o->controls = b; o->step_move = c; o->primary_move = d; }
        } else if (!strncmp(cursor, "room ", 5) && g.rooms < NOVA_GAME_ROOMS) {
            NovaGameRoom *r = &g.room[g.rooms++];
            unsigned mode;
            ok = sscanf(cursor, "room %u %31s %u %f %f %f %f %f %f %f %f%n", &r->id, r->name, &mode,
                &r->snap, &r->camera.x, &r->camera.y, &r->camera.z, &r->target.x, &r->target.y, &r->target.z, &r->fov, &used) == 11;
            if (ok) { ok = mode <= NOVA_3D; r->mode = (NovaMode)mode; }
        } else if (!strncmp(cursor, "instance ", 9) && g.instances < NOVA_GAME_INSTANCES) {
            NovaGameInstance *n = &g.instance[g.instances++];
            ok = sscanf(cursor, "instance %u %31s %u %u %f %f %f %f%n", &n->id, n->name, &n->object, &n->room,
                &n->position.x, &n->position.y, &n->position.z, &n->scale, &used) == 8;
        } else ok = false;
        if (line > 1 && (!used || cursor[used])) ok = false;
        cursor = end ? end+1 : cursor+strlen(cursor);
    }
    free(text);
    if (!ok || !next || !start) {
        snprintf(error, size, "Unsupported/malformed nova-game v1 directive at line %u; source not changed", line);
        return false;
    }
    if (!nova_game_validate(&g, error, size)) return false;
    *game = g;
    return true;
}

bool nova_game_generate(const NovaGame *g, char **manifest, char **lua, char *error, size_t size)
{
    if (!nova_game_validate(g, error, size)) return false;
    Text m = {.data = malloc(NOVA_MANIFEST_LIMIT), .capacity = NOVA_MANIFEST_LIMIT};
    Text t = {.data = malloc(NOVA_SOURCE_EDIT_LIMIT), .capacity = NOVA_SOURCE_EDIT_LIMIT};
    if (!m.data || !t.data) { free(m.data); free(t.data); return fail(error, size, "Out of memory generating runtime"); }
    append(&m, "nova-project 1\n# Generated by nova-game 1. Edit game.nova-game, not this file.\nentry " NOVA_GAME_LUA "\n");
    append(&t, "-- Generated by nova-game 1. Visual authoring owns this file.\nnova.scene(\"%s\")\n",
        nova_game_room(g, g->start)->mode == NOVA_2D ? "2d" : "3d");
    for (size_t i = 0; i < g->resources; ++i) {
        const NovaGameResource *r = &g->resource[i];
        append(&m, "%s r%u %s\n", r->type == NOVA_ASSET_SPRITE ? "sprite" : "model", r->id, r->path);
        append(&t, "local r%u=nova.asset(\"r%u\")\n", r->id, r->id);
    }
    append(&t, "local pressed=false\nlocal p={}\n");
    const NovaGameRoom *room = nova_game_room(g, g->start);
    for (size_t i = 0; i < g->instances; ++i) {
        const NovaGameInstance *n = &g->instance[i];
        if (n->room != g->start) continue;
        const NovaGameObject *o = nova_game_object(g, n->object);
        NovaVec3 v = o->create_position ? o->create : n->position;
        append(&t, "p[%u]={%.9g,%.9g,%.9g}\n", n->id, (double)v.x, (double)v.y, (double)v.z);
    }
    append(&t, "function update(dt,input)\n nova.background(24,30,43)\n");
    if (room->mode == NOVA_3D) append(&t, " nova.camera(%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g)\n",
        (double)room->camera.x, (double)room->camera.y, (double)room->camera.z,
        (double)room->target.x, (double)room->target.y, (double)room->target.z, (double)room->fov);
    for (size_t i = 0; i < g->instances; ++i) {
        const NovaGameInstance *n = &g->instance[i];
        if (n->room != g->start) continue;
        const NovaGameObject *o = nova_game_object(g, n->object);
        const NovaGameResource *r = nova_game_resource(g, o->resource);
        append(&t, " do local v=p[%u]\n", n->id);
        if (o->controls) append(&t, " v[1]=v[1]+input.horizontal*%.9g*dt;v[%d]=v[%d]+input.vertical*%.9g*dt\n",
            (double)o->speed, room->mode == NOVA_2D ? 2 : 3, room->mode == NOVA_2D ? 2 : 3, (double)o->speed);
        if (o->step_move) append(&t, " v[1]=v[1]+%.9g*dt;v[2]=v[2]+%.9g*dt;v[3]=v[3]+%.9g*dt\n",
            (double)o->velocity.x, (double)o->velocity.y, (double)o->velocity.z);
        if (o->primary_move) append(&t, " if input.action and not pressed then v[1]=v[1]+%.9g;v[2]=v[2]+%.9g;v[3]=v[3]+%.9g end\n",
            (double)o->primary.x, (double)o->primary.y, (double)o->primary.z);
        append(&t, " for a=1,3 do v[a]=math.max(-10000,math.min(10000,v[a])) end\n");
        if (r->type == NOVA_ASSET_SPRITE) append(&t, " nova.sprite(r%u,v[1],v[2],%.9g,%.9g)\n",
            r->id, (double)(o->size*n->scale), (double)(o->size*n->scale));
        else append(&t, " nova.model(r%u,v[1],v[2],v[3],%.9g)\n", r->id, (double)(o->size*n->scale));
        append(&t, " end\n");
    }
    append(&t, " pressed=input.action\nend\n");
    if (m.failed || t.failed) { free(m.data); free(t.data); return fail(error, size, "Generated runtime budget exceeded"); }
    *manifest = m.data; *lua = t.data;
    return true;
}

bool nova_game_dirty(const NovaGameProject *p)
{
    return p->authored.text && (!p->authored.saved.info.st_ino || memcmp(&p->data, &p->saved, sizeof(p->data)) ||
        nova_document_dirty(&p->authored) || nova_document_dirty(&p->manifest) || nova_document_dirty(&p->lua));
}

bool nova_game_commit(NovaGameProject *p, const NovaGame *candidate, char *error, size_t size)
{
    if (!nova_game_validate(candidate, error, size)) return false;
    if (!memcmp(&p->data, candidate, sizeof(*candidate))) return true;
    if (!p->history) {
        p->history = calloc(NOVA_GAME_UNDO, sizeof(NovaGame));
        if (!p->history) return fail(error, size, "Out of memory retaining undo");
    }
    if (p->undo_count == NOVA_GAME_UNDO) {
        memmove(p->history, p->history+1, (NOVA_GAME_UNDO-1)*sizeof(NovaGame));
        --p->undo_count;
    }
    p->history[p->undo_count++] = p->data;
    p->redo_count = 0;
    p->data = *candidate;
    return true;
}

bool nova_game_undo(NovaGameProject *p, bool redo, char *error, size_t size)
{
    if ((!redo && !p->undo_count) || (redo && !p->redo_count))
        return fail(error, size, redo ? "Nothing to redo" : "Nothing to undo");
    size_t index = redo ? p->undo_count++ : --p->undo_count;
    NovaGame swap = p->data;
    p->data = p->history[index]; p->history[index] = swap;
    if (p->data.next_id < swap.next_id) p->data.next_id = swap.next_id;
    if (redo) --p->redo_count; else ++p->redo_count;
    return true;
}

bool nova_game_add_object(NovaGameProject *p, uint32_t resource, const char *name, char *error, size_t size)
{
    const NovaGameResource *r = nova_game_resource(&p->data, resource);
    if (!r || !nova_game_name(name) || p->data.objects == NOVA_GAME_OBJECTS)
        return fail(error, size, "Select an appearance, enter a valid unique name; at most 32 objects");
    NovaGame g = p->data;
    NovaGameObject *o = &g.object[g.objects++];
    *o = (NovaGameObject){.id = g.next_id++, .resource = resource,
        .size = r->type == NOVA_ASSET_SPRITE ? 48 : 1, .speed = r->type == NOVA_ASSET_SPRITE ? 180 : 3};
    strcpy(o->name, name);
    return nova_game_commit(p, &g, error, size);
}

bool nova_game_add_room(NovaGameProject *p, NovaMode mode, const char *name, char *error, size_t size)
{
    if (!nova_game_name(name) || p->data.rooms == NOVA_GAME_ROOMS)
        return fail(error, size, "Enter a valid unique room name; at most 8 rooms");
    NovaGame g = p->data;
    NovaGameRoom *r = &g.room[g.rooms++];
    *r = (NovaGameRoom){.id = g.next_id++, .mode = mode, .snap = mode == NOVA_2D ? 16 : 0.5f,
        .camera = {8, 7, 10}, .target = {0, 0, 0}, .fov = 48};
    strcpy(r->name, name);
    if (!g.start) g.start = r->id;
    return nova_game_commit(p, &g, error, size);
}

bool nova_game_place(NovaGameProject *p, uint32_t room, uint32_t object, NovaVec3 v, char *error, size_t size)
{
    if (p->data.instances == NOVA_GAME_INSTANCES) return fail(error, size, "At most 128 placed instances");
    NovaGame g = p->data;
    NovaGameInstance *n = &g.instance[g.instances++];
    *n = (NovaGameInstance){.id = g.next_id++, .object = object, .room = room, .position = v, .scale = 1};
    snprintf(n->name, sizeof(n->name), "instance_%u", n->id);
    return nova_game_commit(p, &g, error, size);
}

bool nova_game_delete(NovaGameProject *p, uint32_t id, char *error, size_t size)
{
    NovaGame g = p->data;
    for (size_t i = 0; i < g.objects; ++i) if (g.object[i].resource == id)
        return fail(error, size, "Appearance is used by an object; delete/reassign that object first");
    for (size_t i = 0; i < g.instances; ++i) if (g.instance[i].object == id || g.instance[i].room == id)
        return fail(error, size, "Object/room has placed instances; delete instances first");
    if (id == g.start) return fail(error, size, "Cannot delete the starting room; designate another first");
#define REMOVE(field, count) \
    for (size_t i = 0; i < g.count; ++i) if (g.field[i].id == id) { \
        memmove(&g.field[i], &g.field[i+1], (g.count-i-1)*sizeof(g.field[0])); \
        memset(&g.field[--g.count], 0, sizeof(g.field[0])); \
        return nova_game_commit(p, &g, error, size); \
    }
    REMOVE(resource, resources)
    REMOVE(object, objects)
    REMOVE(room, rooms)
    REMOVE(instance, instances)
#undef REMOVE
    return fail(error, size, "Selected resource no longer exists");
}

void nova_game_close(NovaGameProject *p)
{
    nova_document_close(&p->authored); nova_document_close(&p->manifest); nova_document_close(&p->lua);
    free(p->history); *p = (NovaGameProject){0};
}

static bool outputs(NovaGameProject *p, char *error, size_t size)
{
    return nova_document_open_output(&p->manifest, p->authored.root, NOVA_GAME_MANIFEST,
        NOVA_MANIFEST_LIMIT, false, error, size) &&
        nova_document_open_output(&p->lua, p->authored.root, NOVA_GAME_LUA,
        NOVA_SOURCE_EDIT_LIMIT, false, error, size);
}

bool nova_game_open(NovaGameProject *p, const char *path, char *error, size_t size)
{
    NovaGameProject *c = calloc(1, sizeof(*c));
    if (!c) return fail(error, size, "Out of memory opening game");
    char root[NOVA_NATIVE_PATH_CAPACITY];
    const char *name = strrchr(path, '/'); name = name ? name+1 : path;
    bool ok = nova_project_root(path, root, error, size) &&
        !strcmp(name, NOVA_GAME_FILE) &&
        nova_document_open(&c->authored, root, name, NOVA_GAME_BYTES, error, size) &&
        nova_game_parse(c->authored.text, c->authored.length, &c->data, error, size) && outputs(c, error, size);
    if (ok) {
        char *m = NULL, *l = NULL;
        ok = nova_game_generate(&c->data, &m, &l, error, size);
        if (ok) c->owned_outputs = !strcmp(m, c->manifest.text) && !strcmp(l, c->lua.text);
        free(m); free(l);
    }
    if (ok) {
        c->saved = c->data;
        nova_game_close(p); *p = *c;
        snprintf(error, size, "%s", p->owned_outputs ? "Opened visual game; no files saved or gameplay started" :
            "Visual source opened; generated files differ/missing. Save/Run blocked; preserve edits and repair in Advanced.");
    } else {
        if (!*error) fail(error, size, "Open game.nova-game; unsupported documents belong in Advanced");
        nova_game_close(c);
    }
    free(c);
    return ok;
}

static bool new_output(NovaDocument *doc, const char *root, const char *path, size_t limit,
    bool binary, char *error, size_t size)
{
    if (!nova_document_open_output(doc, root, path, limit, binary, error, size)) return false;
    if (doc->saved.info.st_ino) return fail(error, size, "Destination already exists; refusing to clobber it");
    return true;
}

static bool write_new(const char *root, const char *path, const unsigned char *bytes, size_t length,
    char *error, size_t size)
{
    NovaDocument d = {0};
    bool ok = new_output(&d, root, path, NOVA_ASSET_FILE_LIMIT, true, error, size) &&
        nova_document_replace(&d, 0, 0, (const char *)bytes, length, error, size) &&
        nova_document_save(&d, false, error, size);
    nova_document_close(&d);
    return ok;
}

bool nova_game_import(NovaGameProject *p, const char *path, const char *name,
    NovaAssetType type, char *error, size_t size)
{
    if (!p->authored.text || !nova_game_name(name) || p->data.resources == NOVA_MAX_ASSETS ||
        (type != NOVA_ASSET_SPRITE && type != NOVA_ASSET_MODEL))
        return fail(error, size, "Import requires an open game, unique name and PNG/static GLB type (32 appearances max)");
    NovaGame g = p->data;
    NovaGameResource *r = &g.resource[g.resources++];
    *r = (NovaGameResource){.id = g.next_id++, .type = type};
    strcpy(r->name, name);
    snprintf(r->path, sizeof(r->path), "resource_%u.%s", r->id, type == NOVA_ASSET_SPRITE ? "png" : "glb");
    if (!nova_game_validate(&g, error, size)) return false;
    int length;
    unsigned char *bytes = nova_read_file(path, NOVA_ASSET_FILE_LIMIT, &length, error, size);
    if (!bytes) return false;
    bool ok;
    if (type == NOVA_ASSET_SPRITE) {
        Image image = {0}; ok = nova_decode_sprite(bytes, length, &image, error, size);
        if (ok) UnloadImage(image);
    } else {
        Model model = {0}; ok = nova_decode_glb(bytes, length, &model, error, size);
        if (ok) UnloadModel(model);
    }
    /* Retain the undo allocation before the persistent import write. */
    if (ok && !p->history) {
        p->history = calloc(NOVA_GAME_UNDO, sizeof(NovaGame));
        if (!p->history) ok = fail(error, size, "Out of memory retaining import undo");
    }
    if (ok) ok = write_new(p->authored.root, r->path, bytes, (size_t)length, error, size);
    free(bytes);
    if (ok) ok = nova_game_commit(p, &g, error, size);
    if (ok) snprintf(error, size, "Imported validated appearance; source copy written, game draft unsaved. Undo/delete retains the file.");
    return ok;
}

bool nova_game_new_model(NovaGameProject *p, const char *name, char *error, size_t size)
{
    if (!p->authored.text || !nova_game_name(name) || p->data.resources == NOVA_MAX_ASSETS)
        return fail(error,size,"New model requires an open game, unique name and available resource slot");
    NovaGame candidate = p->data;
    NovaGameResource *r = &candidate.resource[candidate.resources++];
    *r = (NovaGameResource){.id = candidate.next_id++, .type = NOVA_ASSET_MODEL};
    strcpy(r->name,name); snprintf(r->path,sizeof(r->path),"resource_%u.glb",r->id);
    if (!nova_game_validate(&candidate,error,size)) return false;
    NovaModelDocument model; nova_model_init(&model);
    unsigned char *source = NULL, *glb = NULL;
    size_t source_length = 0, glb_length = 0, writes = 0;
    char source_path[NOVA_PROJECT_PATH_CAPACITY];
    snprintf(source_path,sizeof(source_path),"%s.nova-model",r->path);
    NovaDocument a = {0}, b = {0};
    bool ok = nova_model_add(&model,NOVA_SHAPE_BOX,error,size);
    memset(model.primitives[0].color,255,3);
    if (ok) ok = nova_model_serialize(&model,&source,&source_length,error,size) &&
        nova_model_glb(&model,&glb,&glb_length,error,size) &&
        new_output(&a,p->authored.root,source_path,NOVA_MODEL_DOCUMENT_BYTES,false,error,size) &&
        new_output(&b,p->authored.root,r->path,NOVA_MODEL_GLB_BYTES,true,error,size) &&
        nova_document_replace(&a,0,0,(char *)source,source_length,error,size) &&
        nova_document_replace(&b,0,0,(char *)glb,glb_length,error,size);
    if (ok && !p->history) {
        p->history = calloc(NOVA_GAME_UNDO,sizeof(NovaGame));
        if (!p->history) ok = fail(error,size,"Cannot retain model creation undo");
    }
    if (ok) { ok = nova_document_save(&a,false,error,size); if (ok) ++writes; }
    if (ok) { ok = nova_document_save(&b,false,error,size); if (ok) ++writes; }
    if (ok) ok = nova_game_commit(p,&candidate,error,size);
    if (!ok && writes) {
        char reason[768]; snprintf(reason,sizeof(reason),"%.767s",error);
        snprintf(error,size,"PARTIAL MODEL CREATION: %zu of 2 files written (%s). Game draft retained; files kept. %s",writes,source_path,reason);
    } else if (ok) snprintf(error,size,"Editable model source and GLB created (2 guarded files). Game resource draft unsaved.");
    nova_document_close(&a); nova_document_close(&b); free(source); free(glb);
    return ok;
}

bool nova_game_save(NovaGameProject *p, bool overwrite, char *error, size_t size)
{
    p->writes = 0;
    if (!p->authored.text || !p->owned_outputs)
        return fail(error, size, "Save/Run blocked: generated files are not exactly owned. Preserve/repair them in Advanced.");
    char *m = NULL, *l = NULL, *a = NULL;
    size_t length;
    bool ok = nova_game_serialize(&p->data, &a, &length, error, size) &&
        nova_game_generate(&p->data, &m, &l, error, size);
    /* Inspect generated files before any write, but preserve exact snapshots for
     * the later guarded save. Never refresh them into assumed ownership. */
    if (ok) ok = nova_document_check_disk(&p->manifest, error, size) && nova_document_check_disk(&p->lua, error, size);
    if (ok) ok = nova_document_replace(&p->authored, 0, p->authored.length, a, length, error, size) &&
        nova_document_replace(&p->lua, 0, p->lua.length, l, strlen(l), error, size) &&
        nova_document_replace(&p->manifest, 0, p->manifest.length, m, strlen(m), error, size);
    if (ok) {
        ok = nova_document_save(&p->authored, overwrite, error, size);
        if (ok) { ++p->writes; p->saved = p->data; }
    }
    if (ok) { ok = nova_document_save(&p->lua, false, error, size); if (ok) ++p->writes; }
    if (ok) { ok = nova_document_save(&p->manifest, false, error, size); if (ok) ++p->writes; }
    if (!ok && p->writes) {
        char reason[768]; snprintf(reason, sizeof(reason), "%.767s", error);
        snprintf(error, size, "PARTIAL SAVE: %zu of 3 files written. Run aborted; drafts/live retained. %s", p->writes, reason);
    }
    free(a); free(m); free(l);
    if (ok) {
        char path[NOVA_NATIVE_PATH_CAPACITY];
        NovaProjectValidation validation;
        ok = nova_project_resolve(p->authored.root, NOVA_GAME_MANIFEST, path, error, size) &&
            nova_validate_project(path, &validation, error, size);
        if (!ok) {
            char reason[768]; snprintf(reason, sizeof(reason), "%.767s", error);
            snprintf(error, size, "3 files saved; preflight failed, Run aborted; live retained. %s", reason);
        } else snprintf(error, size, "Saved source and generated runtime (3 guarded files, not one transaction); preflight passed.");
    }
    return ok;
}

bool nova_game_new(NovaGameProject *p, const char *parent, const char *name, NovaMode mode, char *error, size_t size)
{
    if (!nova_game_name(name) || (mode != NOVA_2D && mode != NOVA_3D))
        return fail(error, size, "Project name must be 1..31 ASCII letters/digits/underscore; choose 2D or 3D");
    int fd = open(parent, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) { snprintf(error, size, "Open project location: %s", strerror(errno)); return false; }
    char root[NOVA_NATIVE_PATH_CAPACITY];
    if (snprintf(root, sizeof(root), "%s/%s", parent, name) >= (int)sizeof(root)) {
        close(fd); return fail(error, size, "Project path too long");
    }
    if (mkdirat(fd, name, 0700)) {
        close(fd); snprintf(error, size, "Create new project (existing destinations refused): %s", strerror(errno)); return false;
    }
    close(fd);
    char canonical[NOVA_NATIVE_PATH_CAPACITY];
    if (!realpath(root, canonical)) {
        snprintf(error, size, "Project directory created, but canonical path failed: %s", strerror(errno));
        return false;
    }
    strcpy(root, canonical);
    NovaGameProject *c = calloc(1, sizeof(*c));
    if (!c) return fail(error, size, "Project directory created, but out of memory; no project opened");
    bool ok = new_output(&c->authored, root, NOVA_GAME_FILE, NOVA_GAME_BYTES, false, error, size) &&
        outputs(c, error, size);
    if (ok) {
        c->owned_outputs = !c->manifest.saved.info.st_ino && !c->lua.saved.info.st_ino;
        c->data = (NovaGame){.next_id = 4, .start = 3, .resources = 1, .objects = 1, .rooms = 1, .instances = 1};
        c->data.resource[0] = (NovaGameResource){.id = 1, .type = mode == NOVA_2D ? NOVA_ASSET_SPRITE : NOVA_ASSET_MODEL};
        strcpy(c->data.resource[0].name, mode == NOVA_2D ? "PlayerSprite" : "PlayerModel");
        strcpy(c->data.resource[0].path, mode == NOVA_2D ? "resource_1.png" : "resource_1.glb");
        c->data.object[0] = (NovaGameObject){.id = 2, .resource = 1, .controls = true,
            .speed = mode == NOVA_2D ? 180 : 3, .size = mode == NOVA_2D ? 48 : 1};
        strcpy(c->data.object[0].name, "Player");
        c->data.room[0] = (NovaGameRoom){.id = 3, .mode = mode, .snap = mode == NOVA_2D ? 16 : 0.5f,
            .camera = {8,7,10}, .target = {0,0,0}, .fov = 48};
        strcpy(c->data.room[0].name, "StartingRoom");
        c->data.instance[0] = (NovaGameInstance){.id = c->data.next_id++, .object = 2, .room = 3,
            .position = {mode == NOVA_2D ? 448 : 0, mode == NOVA_2D ? 256 : 0, 0}, .scale = 1};
        strcpy(c->data.instance[0].name, "PlayerStart");
        unsigned char *bytes = NULL; size_t length = 0;
        if (mode == NOVA_2D) {
            Image image = GenImageColor(16,16,(Color){77,225,201,255});
            int n = 0; bytes = ExportImageToMemory(image, ".png", &n); UnloadImage(image);
            length = n > 0 ? (size_t)n : 0;
            if (!bytes || !length) ok = fail(error, size, "Original starter PNG generation failed");
        } else {
            NovaModelDocument model; nova_model_init(&model);
            ok = nova_model_add(&model, NOVA_SHAPE_PYRAMID, error, size) &&
                nova_model_glb(&model, &bytes, &length, error, size);
            if (ok) {
                unsigned char *source = NULL; size_t source_length = 0;
                ok = nova_model_serialize(&model,&source,&source_length,error,size) &&
                    write_new(root,"resource_1.glb.nova-model",source,source_length,error,size);
                free(source);
            }
        }
        if (ok) ok = write_new(root, c->data.resource[0].path, bytes, length, error, size);
        if (mode == NOVA_2D) MemFree(bytes); else free(bytes);
        if (ok) ok = nova_game_save(c, false, error, size);
    }
    if (ok) { nova_game_close(p); *p = *c; }
    else {
        char reason[768]; snprintf(reason, sizeof(reason), "%.767s", error);
        snprintf(error, size, "New project incomplete at %.200s; previous project retained. %s", root, reason);
        nova_game_close(c);
    }
    free(c);
    return ok;
}
