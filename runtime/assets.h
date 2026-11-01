#ifndef NOVA_ASSETS_H
#define NOVA_ASSETS_H

#include "nova.h"
#include <raylib.h>

#define NOVA_NATIVE_PATH_CAPACITY 4096
#define NOVA_ASSET_FILE_LIMIT (16 * 1024 * 1024)
#define NOVA_PROJECT_BYTE_LIMIT (64 * 1024 * 1024)
#define NOVA_MODEL_VERTEX_LIMIT 262144
#define NOVA_SPRITE_PIXEL_LIMIT (16 * 1024 * 1024)

typedef struct {
    NovaAssetType type;
    bool owned;
    Texture2D texture;
    Model model;
} NovaResource;
typedef struct {
    size_t count;
    NovaResource resources[NOVA_MAX_ASSETS];
} NovaResources;

bool nova_project_root(const char *manifest, char *root, char *error, size_t error_size);
bool nova_project_resolve(const char *root, const char *relative, char *path,
    char *error, size_t error_size);
unsigned char *nova_read_file(const char *path, int limit, int *length,
    char *error, size_t error_size);
bool nova_decode_sprite(const unsigned char *bytes, int length, Image *image,
    char *error, size_t error_size);
bool nova_decode_glb(const unsigned char *bytes, int length, Model *model,
    char *error, size_t error_size);
void nova_unload_resources(NovaResources *resources);
bool nova_open_scene(NovaEngine **engine, NovaResources *resources,
    const char *path, bool project, char *error, size_t error_size);

#endif
