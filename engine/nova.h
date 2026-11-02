#ifndef NOVA_H
#define NOVA_H

#include <stdbool.h>
#include <stddef.h>
#include "project.h"

#define NOVA_WIDTH 960
#define NOVA_HEIGHT 540
#define NOVA_MAX_COMMANDS 512
#define NOVA_TEXT_CAPACITY 192
#define NOVA_LUA_MEMORY_LIMIT (16 * 1024 * 1024)
#define NOVA_MAX_TRACKS 64
#define NOVA_MAX_EFFECTS 16
#define NOVA_MAX_SAVE_READS 16
#define NOVA_SAVE_DATA_LIMIT 4096

typedef struct NovaEngine NovaEngine;
typedef struct NovaScene NovaScene;
typedef struct { float x, y, z; } NovaVec3;
typedef struct { unsigned char r, g, b, a; } NovaColor;
typedef enum { NOVA_2D, NOVA_3D, NOVA_MIXED } NovaMode;
typedef enum { NOVA_RECTANGLE, NOVA_CUBE, NOVA_TEXT, NOVA_SPRITE, NOVA_MODEL } NovaCommandType;
typedef struct {
    NovaCommandType type;
    NovaVec3 position, size, rotation;
    NovaColor color;
    size_t asset;
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
typedef enum { NOVA_PLAY_AUDIO, NOVA_STOP_AUDIO, NOVA_WRITE_SAVE } NovaEffectType;
typedef struct {
    NovaEffectType type;
    size_t asset, length;
    float volume;
    bool loop;
    char key[NOVA_ASSET_ID_CAPACITY];
    unsigned char data[NOVA_SAVE_DATA_LIMIT];
} NovaEffect;
typedef struct {
    void *context;
    bool saves;
    bool (*read_save)(void *context, const char *key, unsigned char *data, size_t *length,
        bool *found, char *error, size_t error_size);
    bool (*effect)(void *context, const NovaEffect *effect, char *error, size_t error_size);
} NovaServiceHost;

NovaEngine *nova_create(void);
void nova_destroy(NovaEngine *engine);
void nova_set_service_host(NovaEngine *engine, NovaServiceHost host);
bool nova_dispatch_effects(NovaEngine *engine);
bool nova_load(NovaEngine *engine, const char *source, size_t length, const char *name);
bool nova_load_with_assets(NovaEngine *engine, const char *source, size_t length,
    const char *name, const NovaAsset *assets, size_t count);
bool nova_load_with_scene(NovaEngine *engine, const char *source, size_t length,
    const char *name, const NovaAsset *assets, size_t count, const NovaScene *scene);
bool nova_tick(NovaEngine *engine, double dt, NovaInput input);
const NovaFrame *nova_frame(const NovaEngine *engine);
const char *nova_error(const NovaEngine *engine);
NovaViewport nova_viewport(int width, int height, bool integer_scale);
bool nova_overlap(float ax, float ay, float aw, float ah, float bx, float by, float bw, float bh);

#endif
