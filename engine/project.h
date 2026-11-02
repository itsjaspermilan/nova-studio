#ifndef NOVA_PROJECT_H
#define NOVA_PROJECT_H

#include <stdbool.h>
#include <stddef.h>

#define NOVA_MAX_ASSETS 32
#define NOVA_ASSET_ID_CAPACITY 64
#define NOVA_PROJECT_PATH_CAPACITY 512
#define NOVA_MANIFEST_LIMIT 16384

typedef enum { NOVA_ASSET_SPRITE, NOVA_ASSET_MODEL, NOVA_ASSET_AUDIO } NovaAssetType;
typedef struct {
    char id[NOVA_ASSET_ID_CAPACITY];
    char path[NOVA_PROJECT_PATH_CAPACITY];
    NovaAssetType type;
} NovaAsset;
typedef struct {
    unsigned version;
    char identity[NOVA_ASSET_ID_CAPACITY];
    char entry[NOVA_PROJECT_PATH_CAPACITY];
    char scene[NOVA_PROJECT_PATH_CAPACITY];
    size_t count;
    NovaAsset assets[NOVA_MAX_ASSETS];
} NovaProject;

bool nova_project_parse(NovaProject *project, const char *source, size_t length,
    char *error, size_t error_size);
bool nova_project_relative_path(const char *path);
bool nova_asset_id_valid(const char *id);

#endif
