#ifndef NOVA_SCENE_H
#define NOVA_SCENE_H

#include "nova.h"

#define NOVA_SCENE_LIMIT 65536
#define NOVA_MAX_OBJECTS 128
#define NOVA_OBJECT_NAME_CAPACITY 128

typedef struct {
    char id[NOVA_ASSET_ID_CAPACITY], name[NOVA_OBJECT_NAME_CAPACITY];
    char asset[NOVA_ASSET_ID_CAPACITY];
    NovaCommandType type;
    NovaVec3 position, size;
    NovaColor color;
} NovaSceneObject;

struct NovaScene {
    NovaMode mode;
    NovaColor background;
    NovaVec3 camera_position, camera_target;
    float camera_fov;
    size_t count;
    NovaSceneObject objects[NOVA_MAX_OBJECTS];
};

/* Copy-on-success. Scene data is independent from user-authored Lua. */
bool nova_scene_parse(NovaScene *scene, const char *source, size_t length,
    const NovaAsset *assets, size_t count, char *error, size_t error_size);
bool nova_scene_validate(const NovaScene *scene, const NovaAsset *assets,
    size_t count, char *error, size_t error_size);
void nova_scene_frame(const NovaScene *scene, const NovaAsset *assets,
    size_t count, NovaFrame *frame);

#endif
