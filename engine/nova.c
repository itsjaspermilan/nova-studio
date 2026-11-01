#include "nova.h"

#include <lua.h>
#include <lauxlib.h>
#include <lualib.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef enum { TRACK_TIMER, TRACK_TWEEN, TRACK_FRAMES } TrackType;
typedef struct {
    bool used, loop, smooth, done;
    unsigned generation, pending;
    TrackType type;
    double elapsed, duration, from, to;
    size_t count, frames[NOVA_MAX_ASSETS];
} NovaTrack;
typedef struct { size_t index; unsigned generation; } TrackHandle;

struct NovaEngine {
    lua_State *lua;
    NovaFrame frame;
    char error[1024];
    bool loaded;
    int remaining_instructions;
    size_t memory_used;
    size_t asset_count;
    NovaAsset assets[NOVA_MAX_ASSETS];
    NovaServiceHost host;
    size_t effect_count;
    size_t save_reads;
    NovaEffect effects[NOVA_MAX_EFFECTS];
    NovaTrack tracks[NOVA_MAX_TRACKS];
};

static void *lua_memory(void *context, void *pointer, size_t old_size, size_t new_size)
{
    NovaEngine *engine = context;
    if (!pointer) old_size = 0;
    if (new_size == 0) {
        free(pointer);
        engine->memory_used -= old_size;
        return NULL;
    }
    size_t retained = engine->memory_used - old_size;
    if (new_size > NOVA_LUA_MEMORY_LIMIT - retained) return NULL;
    void *result = realloc(pointer, new_size);
    if (result) engine->memory_used = retained + new_size;
    return result;
}

static NovaEngine *get_engine(lua_State *lua)
{
    return *(NovaEngine **)lua_getextraspace(lua);
}

static void instruction_hook(lua_State *lua, lua_Debug *debug)
{
    (void)debug;
    NovaEngine *engine = get_engine(lua);
    engine->remaining_instructions -= 1000;
    if (engine->remaining_instructions <= 0) luaL_error(lua, "scene instruction budget exceeded");
}

static void begin_call(NovaEngine *engine)
{
    engine->remaining_instructions = 200000;
    lua_sethook(engine->lua, instruction_hook, LUA_MASKCOUNT, 1000);
}

static float number(lua_State *lua, int index)
{
    double value = luaL_checknumber(lua, index);
    luaL_argcheck(lua, isfinite(value) && fabs(value) <= 1000000, index, "expected a finite number within +/-1000000");
    return (float)value;
}

static float positive(lua_State *lua, int index)
{
    float value = number(lua, index);
    luaL_argcheck(lua, value > 0, index, "expected a positive size");
    return value;
}

static NovaColor color(lua_State *lua, int index)
{
    unsigned char channels[3];
    for (int i = 0; i < 3; ++i) {
        lua_Integer value = luaL_checkinteger(lua, index + i);
        luaL_argcheck(lua, value >= 0 && value <= 255, index + i, "color channel must be 0..255");
        channels[i] = (unsigned char)value;
    }
    return (NovaColor){channels[0], channels[1], channels[2], 255};
}

static NovaCommand *command(lua_State *lua, NovaCommandType type)
{
    NovaFrame *frame = &get_engine(lua)->frame;
    if (frame->count == NOVA_MAX_COMMANDS) luaL_error(lua, "frame exceeds %d draw commands", NOVA_MAX_COMMANDS);
    NovaCommand *result = &frame->commands[frame->count++];
    memset(result, 0, sizeof(*result));
    result->type = type;
    return result;
}

static int scene(lua_State *lua)
{
    const char *mode = luaL_checkstring(lua, 1);
    NovaFrame *frame = &get_engine(lua)->frame;
    if (strcmp(mode, "2d") == 0) frame->mode = NOVA_2D;
    else if (strcmp(mode, "3d") == 0) frame->mode = NOVA_3D;
    else if (strcmp(mode, "mixed") == 0) frame->mode = NOVA_MIXED;
    else return luaL_error(lua, "scene mode must be '2d', '3d' or 'mixed'");
    return 0;
}

static int background(lua_State *lua)
{
    get_engine(lua)->frame.background = color(lua, 1);
    return 0;
}

static int rectangle(lua_State *lua)
{
    NovaCommand *draw = command(lua, NOVA_RECTANGLE);
    draw->position = (NovaVec3){number(lua, 1), number(lua, 2), 0};
    draw->size = (NovaVec3){positive(lua, 3), positive(lua, 4), 0};
    draw->color = color(lua, 5);
    return 0;
}

static int cube(lua_State *lua)
{
    if (get_engine(lua)->frame.mode == NOVA_2D) return luaL_error(lua, "cube requires a 3d or mixed scene");
    NovaCommand *draw = command(lua, NOVA_CUBE);
    draw->position = (NovaVec3){number(lua, 1), number(lua, 2), number(lua, 3)};
    draw->size = (NovaVec3){positive(lua, 4), positive(lua, 5), positive(lua, 6)};
    draw->color = color(lua, 7);
    return 0;
}

static int text(lua_State *lua)
{
    size_t length;
    const char *value = luaL_checklstring(lua, 1, &length);
    luaL_argcheck(lua, length < NOVA_TEXT_CAPACITY && !memchr(value, '\0', length), 1, "text is too long or contains NUL");
    NovaCommand *draw = command(lua, NOVA_TEXT);
    memcpy(draw->text, value, length + 1);
    draw->position = (NovaVec3){number(lua, 2), number(lua, 3), 0};
    draw->size.x = positive(lua, 4);
    draw->color = color(lua, 5);
    return 0;
}

static int asset(lua_State *lua)
{
    size_t length;
    const char *id = luaL_checklstring(lua, 1, &length);
    NovaEngine *engine = get_engine(lua);
    for (size_t i = 0; i < engine->asset_count; ++i) {
        if (strlen(engine->assets[i].id) == length && !memcmp(id, engine->assets[i].id, length)) {
            size_t *handle = lua_newuserdatauv(lua, sizeof(*handle), 0);
            *handle = i;
            luaL_setmetatable(lua, "nova.asset");
            return 1;
        }
    }
    return luaL_error(lua, "undeclared asset '%s'; check the project manifest", id);
}

static size_t asset_handle(lua_State *lua, NovaAssetType type)
{
    size_t index = *(size_t *)luaL_checkudata(lua, 1, "nova.asset");
    NovaEngine *engine = get_engine(lua);
    luaL_argcheck(lua, index < engine->asset_count && engine->assets[index].type == type,
        1, "asset handle has the wrong type");
    return index;
}

static NovaTrack *track_handle(lua_State *lua, int index)
{
    TrackHandle *handle = luaL_checkudata(lua, index, "nova.track");
    NovaEngine *engine = get_engine(lua);
    luaL_argcheck(lua, handle->index < NOVA_MAX_TRACKS, index, "invalid playback handle");
    NovaTrack *track = &engine->tracks[handle->index];
    luaL_argcheck(lua, track->used && track->generation == handle->generation,
        index, "cancelled playback handle");
    return track;
}

static int sprite(lua_State *lua)
{
    size_t index;
    if (luaL_testudata(lua, 1, "nova.track")) {
        NovaTrack *track = track_handle(lua, 1);
        luaL_argcheck(lua, track->type == TRACK_FRAMES, 1, "expected sprite-frame playback");
        size_t frame = track->done ? track->count - 1 :
            (size_t)floor((track->elapsed + 1e-10) / (track->duration / (double)track->count));
        if (frame >= track->count) frame = track->count - 1;
        index = track->frames[frame];
    } else index = asset_handle(lua, NOVA_ASSET_SPRITE);
    NovaCommand *draw = command(lua, NOVA_SPRITE);
    draw->asset = index;
    draw->position = (NovaVec3){number(lua, 2), number(lua, 3), 0};
    draw->size = (NovaVec3){positive(lua, 4), positive(lua, 5), 0};
    draw->color = (NovaColor){255, 255, 255, 255};
    return 0;
}

static int model(lua_State *lua)
{
    size_t index = asset_handle(lua, NOVA_ASSET_MODEL);
    if (get_engine(lua)->frame.mode == NOVA_2D) return luaL_error(lua, "model requires a 3d or mixed scene");
    NovaCommand *draw = command(lua, NOVA_MODEL);
    draw->asset = index;
    draw->position = (NovaVec3){number(lua, 2), number(lua, 3), number(lua, 4)};
    float scale = positive(lua, 5);
    draw->size = (NovaVec3){scale, scale, scale};
    draw->color = (NovaColor){255, 255, 255, 255};
    return 0;
}

static int camera(lua_State *lua)
{
    NovaFrame *frame = &get_engine(lua)->frame;
    frame->camera_position = (NovaVec3){number(lua, 1), number(lua, 2), number(lua, 3)};
    frame->camera_target = (NovaVec3){number(lua, 4), number(lua, 5), number(lua, 6)};
    frame->camera_fov = number(lua, 7);
    NovaVec3 p = frame->camera_position, t = frame->camera_target;
    luaL_argcheck(lua, frame->camera_fov >= 10 && frame->camera_fov <= 120, 7, "camera field of view must be 10..120");
    luaL_argcheck(lua, fabsf(p.x - t.x) + fabsf(p.z - t.z) > 0.001f, 1, "camera direction must not be parallel to the Y up axis");
    return 0;
}

bool nova_overlap(float ax, float ay, float aw, float ah, float bx, float by, float bw, float bh)
{
    return aw > 0 && ah > 0 && bw > 0 && bh > 0 &&
        ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

static int overlap(lua_State *lua)
{
    float values[8];
    for (int i = 0; i < 8; ++i) values[i] = number(lua, i + 1);
    lua_pushboolean(lua, nova_overlap(values[0], values[1], values[2], values[3],
        values[4], values[5], values[6], values[7]));
    return 1;
}

static void arguments(lua_State *lua, int minimum, int maximum)
{
    if (lua_gettop(lua) < minimum || lua_gettop(lua) > maximum)
        luaL_error(lua, "expected %d..%d arguments", minimum, maximum);
}

static double service_number(lua_State *lua, int index)
{
    luaL_checktype(lua, index, LUA_TNUMBER);
    double value = lua_tonumber(lua, index);
    luaL_argcheck(lua, isfinite(value) && fabs(value) <= 1000000, index, "expected finite number within +/-1000000");
    return value;
}

static double duration(lua_State *lua, int index)
{
    double value = service_number(lua, index);
    luaL_argcheck(lua, value >= 1.0 / 60 && value <= 3600, index, "duration must be 1/60..3600 seconds");
    return value;
}

static bool optional_loop(lua_State *lua, int index)
{
    if (lua_gettop(lua) < index) return false;
    luaL_checktype(lua, index, LUA_TBOOLEAN);
    return lua_toboolean(lua, index);
}

static NovaTrack *new_track(lua_State *lua, TrackType type)
{
    NovaEngine *engine = get_engine(lua);
    for (size_t i = 0; i < NOVA_MAX_TRACKS; ++i) {
        NovaTrack *track = &engine->tracks[i];
        if (track->used) continue;
        unsigned generation = track->generation + 1;
        *track = (NovaTrack){.used = true, .type = type, .generation = generation};
        TrackHandle *handle = lua_newuserdatauv(lua, sizeof(*handle), 0);
        *handle = (TrackHandle){i, generation};
        luaL_setmetatable(lua, "nova.track");
        return track;
    }
    luaL_error(lua, "scene exceeds %d live timer/playback handles", NOVA_MAX_TRACKS);
    return NULL;
}

static int timer(lua_State *lua)
{
    arguments(lua, 1, 2);
    double seconds = duration(lua, 1);
    bool loop = optional_loop(lua, 2);
    NovaTrack *track = new_track(lua, TRACK_TIMER);
    track->duration = seconds;
    track->loop = loop;
    return 1;
}

static int timer_poll(lua_State *lua)
{
    arguments(lua, 1, 1);
    NovaTrack *track = track_handle(lua, 1);
    luaL_argcheck(lua, track->type == TRACK_TIMER, 1, "expected timer handle");
    lua_pushinteger(lua, track->pending);
    track->pending = 0;
    return 1;
}

static int cancel(lua_State *lua)
{
    arguments(lua, 1, 1);
    track_handle(lua, 1)->used = false;
    return 0;
}

static int track_gc(lua_State *lua)
{
    TrackHandle *handle = luaL_checkudata(lua, 1, "nova.track");
    NovaEngine *engine = get_engine(lua);
    if (handle->index < NOVA_MAX_TRACKS) {
        NovaTrack *track = &engine->tracks[handle->index];
        if (track->generation == handle->generation) track->used = false;
    }
    return 0;
}

static int tween(lua_State *lua)
{
    arguments(lua, 3, 4);
    double from = service_number(lua, 1), to = service_number(lua, 2), seconds = duration(lua, 3);
    bool smooth = false;
    if (lua_gettop(lua) == 4) {
        luaL_checktype(lua, 4, LUA_TSTRING);
        size_t length;
        const char *easing = lua_tolstring(lua, 4, &length);
        luaL_argcheck(lua, length == 6 && (!memcmp(easing, "linear", 6) || !memcmp(easing, "smooth", 6)),
            4, "easing must be linear or smooth");
        smooth = !strcmp(easing, "smooth");
    }
    NovaTrack *track = new_track(lua, TRACK_TWEEN);
    track->from = from; track->to = to; track->duration = seconds; track->smooth = smooth;
    return 1;
}

static int tween_value(lua_State *lua)
{
    arguments(lua, 1, 1);
    NovaTrack *track = track_handle(lua, 1);
    luaL_argcheck(lua, track->type == TRACK_TWEEN, 1, "expected numeric tween handle");
    double t = fmin(1, track->elapsed / track->duration);
    if (track->smooth) t = t * t * (3 - 2 * t);
    lua_pushnumber(lua, track->from + (track->to - track->from) * t);
    lua_pushboolean(lua, track->done);
    return 2;
}

static int frames(lua_State *lua)
{
    arguments(lua, 2, 3);
    luaL_checktype(lua, 1, LUA_TTABLE);
    size_t count = lua_rawlen(lua, 1), indices[NOVA_MAX_ASSETS];
    luaL_argcheck(lua, count > 0 && count <= NOVA_MAX_ASSETS, 1, "expected 1..32 sprite handles");
    size_t keys = 0;
    lua_pushnil(lua);
    while (lua_next(lua, 1)) {
        bool valid = lua_isinteger(lua, -2) && lua_tointeger(lua, -2) >= 1 &&
            (size_t)lua_tointeger(lua, -2) <= count;
        luaL_argcheck(lua, valid, 1, "frames must be a dense array");
        keys++;
        lua_pop(lua, 1);
    }
    luaL_argcheck(lua, keys == count, 1, "frames must be a dense array");
    for (size_t i = 0; i < count; ++i) {
        lua_rawgeti(lua, 1, (lua_Integer)i + 1);
        size_t index = *(size_t *)luaL_checkudata(lua, -1, "nova.asset");
        NovaEngine *engine = get_engine(lua);
        luaL_argcheck(lua, index < engine->asset_count && engine->assets[index].type == NOVA_ASSET_SPRITE,
            1, "frames require sprite assets");
        indices[i] = index;
        lua_pop(lua, 1);
    }
    double seconds = duration(lua, 2);
    bool loop = optional_loop(lua, 3);
    NovaTrack *track = new_track(lua, TRACK_FRAMES);
    track->count = count; track->duration = seconds * (double)count; track->loop = loop;
    memcpy(track->frames, indices, count * sizeof(*indices));
    return 1;
}

static NovaEffect *effect(lua_State *lua, NovaEffectType type)
{
    NovaEngine *engine = get_engine(lua);
    if (engine->effect_count == NOVA_MAX_EFFECTS)
        luaL_error(lua, "scene exceeds %d pending service effects; dispatch each tick", NOVA_MAX_EFFECTS);
    NovaEffect *event = &engine->effects[engine->effect_count++];
    *event = (NovaEffect){.type = type};
    return event;
}

static int play(lua_State *lua)
{
    arguments(lua, 2, 3);
    size_t index = asset_handle(lua, NOVA_ASSET_AUDIO);
    double volume = service_number(lua, 2);
    luaL_argcheck(lua, volume >= 0 && volume <= 1, 2, "volume must be 0..1");
    bool loop = optional_loop(lua, 3);
    NovaEffect *event = effect(lua, NOVA_PLAY_AUDIO);
    event->asset = index; event->volume = (float)volume; event->loop = loop;
    return 0;
}

static int stop(lua_State *lua)
{
    arguments(lua, 1, 1);
    size_t index = asset_handle(lua, NOVA_ASSET_AUDIO);
    effect(lua, NOVA_STOP_AUDIO)->asset = index;
    return 0;
}

static const char *save_key(lua_State *lua)
{
    luaL_checktype(lua, 1, LUA_TSTRING);
    size_t length;
    const char *key = lua_tolstring(lua, 1, &length);
    luaL_argcheck(lua, length < NOVA_ASSET_ID_CAPACITY && !memchr(key, 0, length) && nova_asset_id_valid(key),
        1, "save key must be a 1..63 ASCII identifier");
    if (!get_engine(lua)->host.saves) luaL_error(lua, "saves require a v2 project identity");
    return key;
}

static int save_set(lua_State *lua)
{
    arguments(lua, 2, 2);
    const char *key = save_key(lua);
    luaL_checktype(lua, 2, LUA_TSTRING);
    size_t length;
    const char *data = lua_tolstring(lua, 2, &length);
    luaL_argcheck(lua, length <= NOVA_SAVE_DATA_LIMIT, 2, "save value exceeds 4096 bytes");
    NovaEffect *event = effect(lua, NOVA_WRITE_SAVE);
    memcpy(event->key, key, strlen(key) + 1);
    event->length = length;
    memcpy(event->data, data, length);
    return 0;
}

static int save_get(lua_State *lua)
{
    arguments(lua, 1, 1);
    const char *key = save_key(lua);
    NovaEngine *engine = get_engine(lua);
    for (size_t i = engine->effect_count; i > 0; --i) {
        const NovaEffect *event = &engine->effects[i - 1];
        if (event->type == NOVA_WRITE_SAVE && !strcmp(event->key, key)) {
            lua_pushlstring(lua, (const char *)event->data, event->length);
            return 1;
        }
    }
    unsigned char data[NOVA_SAVE_DATA_LIMIT];
    size_t length = 0;
    bool found = false;
    if (engine->save_reads == NOVA_MAX_SAVE_READS)
        return luaL_error(lua, "scene exceeds %d native save reads per Lua call", NOVA_MAX_SAVE_READS);
    engine->save_reads++;
    char error[1024] = {0};
    if (!engine->host.read_save || !engine->host.read_save(engine->host.context, key, data, &length,
        &found, error, sizeof(error))) return luaL_error(lua, "save read failed: %s",
            engine->host.read_save ? error : "native save host unavailable");
    if (length > sizeof(data)) return luaL_error(lua, "invalid native save length");
    if (found) lua_pushlstring(lua, (const char *)data, length);
    else lua_pushnil(lua);
    return 1;
}

NovaEngine *nova_create(void)
{
    return calloc(1, sizeof(NovaEngine));
}

void nova_destroy(NovaEngine *engine)
{
    if (!engine) return;
    if (engine->lua) lua_close(engine->lua);
    free(engine);
}

static bool failure(NovaEngine *engine)
{
    const char *message = lua_tostring(engine->lua, -1);
    snprintf(engine->error, sizeof(engine->error), "%s", message ? message : "Lua raised a non-string error");
    lua_settop(engine->lua, 0);
    engine->loaded = false;
    engine->frame.count = 0;
    engine->effect_count = 0;
    return false;
}

bool nova_load(NovaEngine *engine, const char *source, size_t length, const char *name)
{
    return nova_load_with_assets(engine, source, length, name, NULL, 0);
}

bool nova_load_with_assets(NovaEngine *engine, const char *source, size_t length,
    const char *name, const NovaAsset *assets, size_t count)
{
    if (!engine) return false;
    if (engine->lua) lua_close(engine->lua);
    engine->lua = lua_newstate(lua_memory, engine);
    engine->loaded = false;
    engine->error[0] = '\0';
    engine->asset_count = 0;
    engine->effect_count = 0;
    memset(engine->tracks, 0, sizeof(engine->tracks));
    engine->save_reads = 0;
    engine->frame = (NovaFrame){
        .mode = NOVA_2D, .background = {20, 24, 36, 255},
        .camera_position = {7, 6, 9}, .camera_target = {0, 0, 0}, .camera_fov = 50
    };
    if (!engine->lua) {
        snprintf(engine->error, sizeof(engine->error), "could not allocate Lua state");
        return false;
    }
    if (count > NOVA_MAX_ASSETS || (count && !assets)) {
        snprintf(engine->error, sizeof(engine->error), "invalid native asset registry");
        return false;
    }
    for (size_t i = 0; i < count; ++i) {
        if (!memchr(assets[i].id, '\0', sizeof(assets[i].id)) || !nova_asset_id_valid(assets[i].id) ||
            (assets[i].type != NOVA_ASSET_SPRITE && assets[i].type != NOVA_ASSET_MODEL &&
             assets[i].type != NOVA_ASSET_AUDIO)) {
            snprintf(engine->error, sizeof(engine->error), "invalid native asset declaration");
            return false;
        }
        for (size_t j = 0; j < i; ++j) {
            if (!strcmp(assets[i].id, assets[j].id)) {
                snprintf(engine->error, sizeof(engine->error), "duplicate native asset ID: %s", assets[i].id);
                return false;
            }
        }
    }
    if (count) memcpy(engine->assets, assets, count * sizeof(*assets));
    engine->asset_count = count;
    *(NovaEngine **)lua_getextraspace(engine->lua) = engine;
    // Deliberately expose only gameplay libraries, not filesystem or process access.
    const struct { const char *name; lua_CFunction open; } libraries[] = {
        {"_G", luaopen_base}, {LUA_MATHLIBNAME, luaopen_math},
        {LUA_STRLIBNAME, luaopen_string}, {LUA_TABLIBNAME, luaopen_table}
    };
    for (size_t i = 0; i < sizeof(libraries) / sizeof(libraries[0]); ++i) {
        luaL_requiref(engine->lua, libraries[i].name, libraries[i].open, 1);
        lua_pop(engine->lua, 1);
    }
    lua_pushnil(engine->lua); lua_setglobal(engine->lua, "dofile");
    lua_pushnil(engine->lua); lua_setglobal(engine->lua, "loadfile");
    const luaL_Reg api[] = {
        {"scene", scene}, {"background", background}, {"rectangle", rectangle},
        {"cube", cube}, {"text", text}, {"camera", camera}, {"overlap", overlap},
        {"timer", timer}, {"timer_poll", timer_poll}, {"cancel", cancel},
        {"tween", tween}, {"tween_value", tween_value}, {"frames", frames},
        {"play", play}, {"stop", stop}, {"save_get", save_get}, {"save_set", save_set}, {NULL, NULL}
    };
    luaL_newmetatable(engine->lua, "nova.asset");
    lua_pushliteral(engine->lua, "protected asset handle");
    lua_setfield(engine->lua, -2, "__metatable");
    lua_pop(engine->lua, 1);
    luaL_newmetatable(engine->lua, "nova.track");
    lua_pushliteral(engine->lua, "protected timer/playback handle");
    lua_setfield(engine->lua, -2, "__metatable");
    lua_pushcfunction(engine->lua, track_gc); lua_setfield(engine->lua, -2, "__gc");
    lua_pop(engine->lua, 1);
    luaL_newlib(engine->lua, api);
    lua_pushcfunction(engine->lua, asset); lua_setfield(engine->lua, -2, "asset");
    lua_pushcfunction(engine->lua, sprite); lua_setfield(engine->lua, -2, "sprite");
    lua_pushcfunction(engine->lua, model); lua_setfield(engine->lua, -2, "model");
    lua_pushinteger(engine->lua, NOVA_WIDTH); lua_setfield(engine->lua, -2, "width");
    lua_pushinteger(engine->lua, NOVA_HEIGHT); lua_setfield(engine->lua, -2, "height");
    lua_setglobal(engine->lua, "nova");
    if (!source || !name) {
        snprintf(engine->error, sizeof(engine->error), "scene source and name are required");
        return false;
    }
    begin_call(engine);
    if (luaL_loadbufferx(engine->lua, source, length, name, "t") != LUA_OK ||
        lua_pcall(engine->lua, 0, 0, 0) != LUA_OK) return failure(engine);
    lua_getglobal(engine->lua, "update");
    bool valid = lua_isfunction(engine->lua, -1);
    lua_pop(engine->lua, 1);
    if (!valid) {
        snprintf(engine->error, sizeof(engine->error), "%s: scene must define update(dt, input)", name);
        return false;
    }
    engine->loaded = true;
    return true;
}

bool nova_tick(NovaEngine *engine, double dt, NovaInput input)
{
    if (!engine || !engine->loaded) return false;
    if (!isfinite(dt) || dt < 0 || dt > 0.05 || !isfinite(input.horizontal) ||
        !isfinite(input.vertical) || fabsf(input.horizontal) > 1 || fabsf(input.vertical) > 1) {
        snprintf(engine->error, sizeof(engine->error), "invalid timestep or input: dt must be 0..0.05, axes -1..1");
        engine->loaded = false;
        engine->frame.count = 0;
        engine->effect_count = 0;
        return false;
    }
    for (size_t i = 0; i < NOVA_MAX_TRACKS; ++i) {
        NovaTrack *track = &engine->tracks[i];
        if (!track->used || track->done || dt == 0) continue;
        track->elapsed += dt;
        if (track->elapsed + 1e-10 >= track->duration) {
            unsigned periods = track->loop ? (unsigned)floor((track->elapsed + 1e-10) / track->duration) : 1;
            if (track->type == TRACK_TIMER) {
                if (track->pending > 1000000 - periods) {
                    snprintf(engine->error, sizeof(engine->error), "timer exceeds 1000000 unpolled expirations");
                    engine->loaded = false; engine->frame.count = 0; engine->effect_count = 0;
                    return false;
                }
                track->pending += periods;
            }
            if (track->loop) track->elapsed = fmax(0, track->elapsed - periods * track->duration);
            else { track->elapsed = track->duration; track->done = true; }
        }
    }
    engine->frame.count = 0;
    engine->save_reads = 0;
    lua_State *lua = engine->lua;
    begin_call(engine);
    lua_getglobal(lua, "update");
    lua_pushnumber(lua, dt);
    lua_createtable(lua, 0, 3);
    lua_pushnumber(lua, input.horizontal); lua_setfield(lua, -2, "horizontal");
    lua_pushnumber(lua, input.vertical); lua_setfield(lua, -2, "vertical");
    lua_pushboolean(lua, input.action); lua_setfield(lua, -2, "action");
    if (lua_pcall(lua, 2, 0, 0) != LUA_OK) return failure(engine);
    return true;
}

void nova_set_service_host(NovaEngine *engine, NovaServiceHost host)
{
    if (engine) engine->host = host;
}

bool nova_dispatch_effects(NovaEngine *engine)
{
    if (!engine || !engine->loaded) return false;
    for (size_t i = 0; i < engine->effect_count; ++i) {
        char error[1024] = {0};
        if (!engine->host.effect || !engine->host.effect(engine->host.context,
            &engine->effects[i], error, sizeof(error))) {
            snprintf(engine->error, sizeof(engine->error), "native service effect failed: %.950s",
                engine->host.effect ? error : "native service host unavailable");
            engine->loaded = false; engine->frame.count = 0; engine->effect_count = 0;
            return false;
        }
    }
    engine->effect_count = 0;
    return true;
}

const NovaFrame *nova_frame(const NovaEngine *engine) { return &engine->frame; }
const char *nova_error(const NovaEngine *engine) { return engine ? engine->error : "could not allocate engine"; }

NovaViewport nova_viewport(int width, int height, bool integer_scale)
{
    if (width <= 0 || height <= 0) return (NovaViewport){0};
    float scale = fminf((float)width / NOVA_WIDTH, (float)height / NOVA_HEIGHT);
    if (integer_scale && scale >= 1) scale = floorf(scale);
    float w = NOVA_WIDTH * scale, h = NOVA_HEIGHT * scale;
    return (NovaViewport){(width - w) / 2, (height - h) / 2, w, h, scale};
}
