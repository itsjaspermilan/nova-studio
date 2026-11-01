#ifndef NOVA_AUTHORING_GAME_H
#define NOVA_AUTHORING_GAME_H

#include "document.h"
#include <stdint.h>

#define NOVA_GAME_BYTES 65536
#define NOVA_GAME_OBJECTS 32
#define NOVA_GAME_ROOMS 8
#define NOVA_GAME_INSTANCES 128
#define NOVA_GAME_UNDO 16
#define NOVA_GAME_FILE "game.nova-game"
#define NOVA_GAME_MANIFEST "game.project"
#define NOVA_GAME_LUA "game.generated.lua"

typedef struct {
    uint32_t id;
    char name[32], path[NOVA_PROJECT_PATH_CAPACITY];
    NovaAssetType type;
} NovaGameResource;
typedef struct {
    uint32_t id, resource;
    char name[32];
    bool create_position, controls, step_move, primary_move;
    NovaVec3 create, velocity, primary;
    float speed, size;
} NovaGameObject;
typedef struct {
    uint32_t id;
    char name[32];
    NovaMode mode;
    float snap;
    NovaVec3 camera, target;
    float fov;
} NovaGameRoom;
typedef struct {
    uint32_t id, object, room;
    char name[32];
    NovaVec3 position;
    float scale;
} NovaGameInstance;
typedef struct {
    uint32_t next_id, start;
    size_t resources, objects, rooms, instances;
    NovaGameResource resource[NOVA_MAX_ASSETS];
    NovaGameObject object[NOVA_GAME_OBJECTS];
    NovaGameRoom room[NOVA_GAME_ROOMS];
    NovaGameInstance instance[NOVA_GAME_INSTANCES];
} NovaGame;
typedef struct {
    NovaGame data, saved;
    NovaGame *history;
    size_t undo_count, redo_count;
    NovaDocument authored, manifest, lua;
    bool owned_outputs;
    size_t writes;
} NovaGameProject;

bool nova_game_name(const char *name);
bool nova_game_validate(const NovaGame *game, char *error, size_t size);
bool nova_game_parse(const char *bytes, size_t length, NovaGame *game, char *error, size_t size);
bool nova_game_serialize(const NovaGame *game, char **bytes, size_t *length, char *error, size_t size);
bool nova_game_generate(const NovaGame *game, char **manifest, char **lua, char *error, size_t size);
const NovaGameResource *nova_game_resource(const NovaGame *game, uint32_t id);
const NovaGameObject *nova_game_object(const NovaGame *game, uint32_t id);
const NovaGameRoom *nova_game_room(const NovaGame *game, uint32_t id);
const NovaGameInstance *nova_game_instance(const NovaGame *game, uint32_t id);
bool nova_game_commit(NovaGameProject *project, const NovaGame *candidate, char *error, size_t size);
bool nova_game_undo(NovaGameProject *project, bool redo, char *error, size_t size);
bool nova_game_dirty(const NovaGameProject *project);
bool nova_game_add_object(NovaGameProject *project, uint32_t resource, const char *name,
    char *error, size_t size);
bool nova_game_add_room(NovaGameProject *project, NovaMode mode, const char *name, char *error, size_t size);
bool nova_game_place(NovaGameProject *project, uint32_t room, uint32_t object,
    NovaVec3 position, char *error, size_t size);
bool nova_game_delete(NovaGameProject *project, uint32_t id, char *error, size_t size);
void nova_game_close(NovaGameProject *project);
/* All opens replace the current project only on success. Unknown formats remain
 * available to the Advanced editor; they are never reconstructed by visual save. */
bool nova_game_open(NovaGameProject *project, const char *path, char *error, size_t size);
bool nova_game_new(NovaGameProject *project, const char *parent, const char *name,
    NovaMode mode, char *error, size_t size);
bool nova_game_import(NovaGameProject *project, const char *path, const char *name,
    NovaAssetType type, char *error, size_t size);
/* Saves authored source then generated Lua then manifest, each guarded separately.
 * Writes records successful files even on failure. Consent is only for authored
 * source's exact observed conflict; edited generated outputs are never overwritten. */
bool nova_game_save(NovaGameProject *project, bool overwrite, char *error, size_t size);

#endif
