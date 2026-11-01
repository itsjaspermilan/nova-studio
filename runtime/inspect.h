#ifndef NOVA_INSPECT_H
#define NOVA_INSPECT_H

#include "nova.h"

#define NOVA_INSPECTION_VERSION 2
#define NOVA_NATIVE_PATH_CAPACITY 4096

typedef struct NovaResources NovaResources;

typedef struct {
    NovaAsset declaration;
    size_t resource_index;
    size_t input_bytes;
    int width, height;
    size_t primitives, vertices;
    unsigned sample_rate, channels, sample_frames;
    NovaVec3 bounds_min, bounds_max;
} NovaAssetInspection;

/* Borrowed read-only views; see README for reload, frame and ownership lifetimes. */
typedef struct {
    bool loaded, project;
    unsigned manifest_version;
    const char *identity;
    const char *source, *root, *entry, *relative_entry;
    size_t count;
    const NovaAssetInspection *assets;
    const NovaFrame *frame;
    const char *scene_error, *load_error;
} NovaSceneInspection;

NovaSceneInspection nova_inspect_scene(const NovaEngine *engine, const NovaResources *resources);

typedef struct {
    NovaProject project;
    NovaAssetInspection assets[NOVA_MAX_ASSETS];
    char root[NOVA_NATIVE_PATH_CAPACITY];
    char entry[NOVA_NATIVE_PATH_CAPACITY];
} NovaProjectValidation;

/* Headless preflight; output is replaced only after imports and initial Lua update pass. */
bool nova_validate_project(const char *path, NovaProjectValidation *validation,
    char *error, size_t error_size);

#endif
