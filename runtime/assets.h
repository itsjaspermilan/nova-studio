#ifndef NOVA_ASSETS_H
#define NOVA_ASSETS_H

#include "inspect.h"
#include "saves.h"
#include <raylib.h>

#define NOVA_ASSET_FILE_LIMIT (16 * 1024 * 1024)
#define NOVA_PROJECT_BYTE_LIMIT (64 * 1024 * 1024)
#define NOVA_MODEL_VERTEX_LIMIT 262144
#define NOVA_SPRITE_PIXEL_LIMIT (16 * 1024 * 1024)
#define NOVA_AUDIO_SECONDS_LIMIT 120

typedef struct {
    NovaAssetType type;
    bool owned;
    Texture2D texture;
    Model model;
    Sound sound;
} NovaResource;
typedef struct {
    bool preflight, initialized, paused;
    NovaSaveStore saves;
    char identity[NOVA_ASSET_ID_CAPACITY];
    size_t count, indices[NOVA_MAX_ASSETS];
    Sound sounds[NOVA_MAX_ASSETS];
    bool looping[NOVA_MAX_ASSETS], resume[NOVA_MAX_ASSETS];
} NovaServices;
struct NovaResources {
    size_t count;
    NovaResource resources[NOVA_MAX_ASSETS];
    NovaAssetInspection inspection[NOVA_MAX_ASSETS];
    bool project;
    unsigned manifest_version;
    char identity[NOVA_ASSET_ID_CAPACITY];
    NovaServices *services;
    char source[NOVA_NATIVE_PATH_CAPACITY];
    char root[NOVA_NATIVE_PATH_CAPACITY];
    char entry[NOVA_NATIVE_PATH_CAPACITY];
    char relative_entry[NOVA_PROJECT_PATH_CAPACITY];
    char load_error[1024];
};

bool nova_project_root(const char *manifest, char *root, char *error, size_t error_size);
bool nova_project_resolve(const char *root, const char *relative, char *path,
    char *error, size_t error_size);
unsigned char *nova_read_file(const char *path, int limit, int *length,
    char *error, size_t error_size);
bool nova_decode_sprite(const unsigned char *bytes, int length, Image *image,
    char *error, size_t error_size);
bool nova_decode_glb(const unsigned char *bytes, int length, Model *model,
    char *error, size_t error_size);
bool nova_decode_wav(const unsigned char *bytes, int length, Wave *wave,
    char *error, size_t error_size);
bool nova_tick_services(NovaEngine *engine, NovaResources *resources);
void nova_pause_services(NovaResources *resources, bool paused);
void nova_shutdown_audio(void);
void nova_unload_resources(NovaResources *resources);
bool nova_open_scene(NovaEngine **engine, NovaResources *resources,
    const char *path, bool project, char *error, size_t error_size);

#endif
