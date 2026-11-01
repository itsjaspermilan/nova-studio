#include "nova.h"

#include <lua.h>
#include <lauxlib.h>
#include <lualib.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct NovaEngine {
    lua_State *lua;
    NovaFrame frame;
    char error[1024];
    bool loaded;
    int remaining_instructions;
    size_t memory_used;
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
    return false;
}

bool nova_load(NovaEngine *engine, const char *source, size_t length, const char *name)
{
    if (!engine) return false;
    if (engine->lua) lua_close(engine->lua);
    engine->lua = lua_newstate(lua_memory, engine);
    engine->loaded = false;
    engine->error[0] = '\0';
    engine->frame = (NovaFrame){
        .mode = NOVA_2D, .background = {20, 24, 36, 255},
        .camera_position = {7, 6, 9}, .camera_target = {0, 0, 0}, .camera_fov = 50
    };
    if (!engine->lua) {
        snprintf(engine->error, sizeof(engine->error), "could not allocate Lua state");
        return false;
    }
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
        {"cube", cube}, {"text", text}, {"camera", camera}, {"overlap", overlap}, {NULL, NULL}
    };
    luaL_newlib(engine->lua, api);
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
        return false;
    }
    engine->frame.count = 0;
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
