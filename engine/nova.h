#ifndef NOVA_H
#define NOVA_H

#include <stdbool.h>
#include <stddef.h>

#define NOVA_WIDTH 960
#define NOVA_HEIGHT 540
#define NOVA_MAX_COMMANDS 512
#define NOVA_TEXT_CAPACITY 192
#define NOVA_LUA_MEMORY_LIMIT (16 * 1024 * 1024)

typedef struct NovaEngine NovaEngine;
typedef struct { float x, y, z; } NovaVec3;
typedef struct { unsigned char r, g, b, a; } NovaColor;
typedef enum { NOVA_2D, NOVA_3D, NOVA_MIXED } NovaMode;
typedef enum { NOVA_RECTANGLE, NOVA_CUBE, NOVA_TEXT } NovaCommandType;
typedef struct {
    NovaCommandType type;
    NovaVec3 position, size;
    NovaColor color;
    char text[NOVA_TEXT_CAPACITY];
} NovaCommand;
typedef struct {
    NovaMode mode;
    NovaColor background;
    NovaVec3 camera_position, camera_target;
    float camera_fov;
    size_t count;
    NovaCommand commands[NOVA_MAX_COMMANDS];
} NovaFrame;
typedef struct { float horizontal, vertical; bool action; } NovaInput;
typedef struct { float x, y, width, height, scale; } NovaViewport;

NovaEngine *nova_create(void);
void nova_destroy(NovaEngine *engine);
bool nova_load(NovaEngine *engine, const char *source, size_t length, const char *name);
bool nova_tick(NovaEngine *engine, double dt, NovaInput input);
const NovaFrame *nova_frame(const NovaEngine *engine);
const char *nova_error(const NovaEngine *engine);
NovaViewport nova_viewport(int width, int height, bool integer_scale);
bool nova_overlap(float ax, float ay, float aw, float ah, float bx, float by, float bw, float bh);

#endif
