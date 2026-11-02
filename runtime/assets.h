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
#define NOVA_MODEL_TEXTURES 16
#define NOVA_MODEL_TEXTURE_BYTES (1024 * 1024)
#define NOVA_MODEL_TEXTURE_PIXELS (4 * 1024 * 1024)

typedef struct {
    size_t count, pixels;
    Image images[NOVA_MODEL_TEXTURES];
    Texture2D textures[NOVA_MODEL_TEXTURES];
    int material_image[128];
} NovaModelImages;

typedef struct {
    NovaAssetType type;
    bool owned;
    Texture2D texture;
    Model model;
    NovaModelImages images;
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
    char relative_scene[NOVA_PROJECT_PATH_CAPACITY];
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
/* CPU-only decode. Images are unique embedded PNGs; materials borrow their indices.
 * The geometry-only compatibility entry above validates then discards images. */
bool nova_decode_glb_images(const unsigned char *bytes, int length, Model *model,
    NovaModelImages *images, char *error, size_t error_size);
void nova_unload_cpu_model(Model *model);
void nova_unload_model_images(NovaModelImages *images);
bool nova_decode_model_png(const unsigned char *bytes, int length, Image *image,
    char *error, size_t error_size);
bool nova_decode_wav(const unsigned char *bytes, int length, Wave *wave,
    char *error, size_t error_size);
bool nova_tick_services(NovaEngine *engine, NovaResources *resources);
void nova_pause_services(NovaResources *resources, bool paused);
void nova_shutdown_audio(void);
void nova_unload_resources(NovaResources *resources);
bool nova_open_scene(NovaEngine **engine, NovaResources *resources,
    const char *path, bool project, char *error, size_t error_size);

typedef struct {
    const char *manifest, *source, *scene;
    size_t manifest_length, source_length, scene_length;
} NovaProjectDraft;
/* Stage a consistent in-memory authoring snapshot against an existing project
 * root. Graphics imports use the GPU; audio is validated without device/sound
 * upload. Save reads are deterministic and effects are NOT dispatched.
 * Failed staging retains the complete prior engine/resources. */
bool nova_open_authoring_snapshot(NovaEngine **engine, NovaResources *resources,
    const char *path, const NovaProjectDraft *draft, char *error, size_t error_size);

#endif
