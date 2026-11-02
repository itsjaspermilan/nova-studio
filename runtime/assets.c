#include "assets.h"
#include "audio.h"
#include "audio_device.h"
#include "scene.h"
#include <cgltf.h>

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

_Static_assert(NOVA_AUDIO_WAV_INPUT_LIMIT == NOVA_ASSET_FILE_LIMIT,
    "shared WAV input budget must match native assets");
_Static_assert(NOVA_AUDIO_TOTAL_SAMPLE_SECONDS == NOVA_AUDIO_SECONDS_LIMIT,
    "shared audio duration budget must match native assets");

#ifdef __ANDROID__
#include <android_native_app_glue.h>
extern struct android_app *GetAndroidApp(void);
#endif
#ifndef __ANDROID__
#include <sys/stat.h>
#endif

static bool error_message(char *error, size_t size, const char *message)
{
    snprintf(error, size, "%s", message);
    return false;
}

bool nova_decode_wav(const unsigned char *bytes, int length, Wave *wave,
    char *error, size_t error_size)
{
    if (!wave) return error_message(error, error_size, "native WAV output is required");
    *wave = (Wave){0};
    NovaAudioWavInfo info;
    if (length < 0 || length > NOVA_ASSET_FILE_LIMIT)
        return error_message(error, error_size, "native WAV input exceeds the bounded file size");
    if (!nova_audio_wav_inspect(bytes, (size_t)length, &info, error, error_size)) return false;
    if (info.bits == 24 || info.format == 3) {
        /* raylib 5.5's LoadWaveFromMemory always reduces WAV to PCM16. */
        size_t count = (size_t)info.sample.frames * info.sample.channels;
        float *data = MemAlloc((unsigned int)(count * sizeof(float)));
        if (!data) return error_message(error, error_size, "native float WAV allocation failed");
        if (!nova_audio_wav_read(bytes, (size_t)length, data, count, error, error_size)) {
            MemFree(data); return false;
        }
        *wave = (Wave){.frameCount = info.sample.frames, .sampleRate = info.sample.sample_rate,
            .sampleSize = 32, .channels = info.sample.channels, .data = data};
    } else *wave = LoadWaveFromMemory(".wav", bytes, length);
    if (!IsWaveValid(*wave) || wave->frameCount != info.sample.frames ||
        wave->channels != info.sample.channels || wave->sampleRate != info.sample.sample_rate) {
        UnloadWave(*wave); *wave = (Wave){0};
        return error_message(error, error_size, "native WAV decoding failed");
    }
    return true;
}

static bool save_store(NovaServices *services, char *error, size_t error_size)
{
    if (services->initialized) return true;
    char base[NOVA_SAVE_ROOT_CAPACITY];
#ifdef __ANDROID__
    struct android_app *app = GetAndroidApp();
    if (!app || !app->activity || !app->activity->internalDataPath)
        return error_message(error, error_size, "Android internal app-data location unavailable");
    snprintf(base, sizeof(base), "%s", app->activity->internalDataPath);
#else
    const char *home = getenv("HOME");
    if (!home || home[0] != '/') return error_message(error, error_size, "absolute HOME app-data location unavailable");
#ifdef __APPLE__
    int size = snprintf(base, sizeof(base), "%s/Library/Application Support", home);
#else
    const char *xdg = getenv("XDG_DATA_HOME");
    int size = xdg && *xdg ? snprintf(base, sizeof(base), "%s", xdg) :
        snprintf(base, sizeof(base), "%s/.local/share", home);
#endif
    if (size < 0 || (size_t)size >= sizeof(base))
        return error_message(error, error_size, "OS app-data location is too long");
#endif
    if (!nova_save_store_init(&services->saves, base, services->identity, error, error_size)) return false;
    services->initialized = true;
    return true;
}

static bool service_read(void *context, const char *key, unsigned char *data, size_t *length,
    bool *found, char *error, size_t error_size)
{
    NovaServices *services = context;
    if (services->preflight) { *length = 0; *found = false; return true; }
    return save_store(services, error, error_size) &&
        nova_save_read(&services->saves, key, data, length, found, error, error_size);
}

static bool service_effect(void *context, const NovaEffect *effect, char *error, size_t error_size)
{
    NovaServices *services = context;
    if (services->preflight) return error_message(error, error_size, "preflight cannot dispatch native effects");
    if (effect->type == NOVA_WRITE_SAVE)
        return save_store(services, error, error_size) && nova_save_write(&services->saves,
            effect->key, effect->data, effect->length, error, error_size);
    if (effect->type != NOVA_PLAY_AUDIO && effect->type != NOVA_STOP_AUDIO)
        return error_message(error, error_size, "unknown native service effect");
    if (effect->asset >= services->count)
        return error_message(error, error_size, "invalid native audio asset");
    size_t index = services->indices[effect->asset];
    Sound sound = services->sounds[index];
    if (!IsAudioDeviceReady() || !IsSoundValid(sound))
        return error_message(error, error_size, "native audio device/resource unavailable");
    StopSound(sound);
    services->resume[index] = false;
    services->looping[index] = effect->type == NOVA_PLAY_AUDIO && effect->loop;
    if (effect->type == NOVA_PLAY_AUDIO) {
        SetSoundVolume(sound, effect->volume);
        PlaySound(sound);
    }
    return true;
}

bool nova_tick_services(NovaEngine *engine, NovaResources *resources)
{
    if (!nova_dispatch_effects(engine)) return false;
    NovaServices *services = resources->services;
    if (services && !services->paused) {
        for (size_t i = 0; i < services->count; ++i) {
            if (services->indices[i] == i && services->looping[i] && !IsSoundPlaying(services->sounds[i]))
                PlaySound(services->sounds[i]);
        }
    }
    return true;
}

void nova_pause_services(NovaResources *resources, bool paused)
{
    NovaServices *services = resources->services;
    if (!services || services->paused == paused) return;
    services->paused = paused;
    for (size_t i = 0; i < services->count; ++i) {
        if (services->indices[i] != i || !IsSoundValid(services->sounds[i])) continue;
        if (paused) {
            services->resume[i] = IsSoundPlaying(services->sounds[i]);
            if (services->resume[i]) PauseSound(services->sounds[i]);
        } else if (services->resume[i]) {
            ResumeSound(services->sounds[i]); services->resume[i] = false;
        }
    }
}

void nova_shutdown_audio(void)
{
    nova_audio_device_close_transports();
    if (IsAudioDeviceReady()) CloseAudioDevice();
}

bool nova_project_root(const char *manifest, char *root, char *error, size_t error_size)
{
    char path[NOVA_NATIVE_PATH_CAPACITY];
#ifdef __ANDROID__
    if (!nova_project_relative_path(manifest))
        return error_message(error, error_size, "Android project must be a bundled relative manifest path");
    snprintf(path, sizeof(path), "%s", manifest);
#else
    if (!realpath(manifest, path)) {
        snprintf(error, error_size, "cannot resolve project manifest: %.700s", manifest);
        return false;
    }
#endif
    char *slash = strrchr(path, '/');
    if (slash) {
        if (slash == path) slash[1] = '\0';
        else *slash = '\0';
    } else snprintf(path, sizeof(path), ".");
    snprintf(root, NOVA_NATIVE_PATH_CAPACITY, "%s", path);
    return true;
}

bool nova_project_resolve(const char *root, const char *relative, char *path,
    char *error, size_t error_size)
{
    if (!nova_project_relative_path(relative))
        return error_message(error, error_size, "invalid project-relative path (absolute paths and dot segments are forbidden)");
    char joined[NOVA_NATIVE_PATH_CAPACITY];
    int size = snprintf(joined, sizeof(joined), "%s%s%s", root,
        root[strlen(root) - 1] == '/' ? "" : "/", relative);
    if (size < 0 || (size_t)size >= sizeof(joined))
        return error_message(error, error_size, "resolved project path is too long");
#ifdef __ANDROID__
    if (!strcmp(root, ".")) snprintf(path, NOVA_NATIVE_PATH_CAPACITY, "%s", relative);
    else snprintf(path, NOVA_NATIVE_PATH_CAPACITY, "%s", joined);
#else
    if (!realpath(joined, path)) {
        snprintf(error, error_size, "missing or unreadable project file: %.700s", joined);
        return false;
    }
    size_t root_size = strlen(root);
    if (strncmp(path, root, root_size) || (root_size > 1 && path[root_size] != '/'))
        return error_message(error, error_size, "project file escapes root through a symbolic link");
    struct stat info;
    if (stat(path, &info) || !S_ISREG(info.st_mode))
        return error_message(error, error_size, "project path must name a regular file");
#endif
    return true;
}

unsigned char *nova_read_file(const char *path, int limit, int *length,
    char *error, size_t error_size)
{
#ifndef __ANDROID__
    struct stat info;
    if (stat(path, &info) || !S_ISREG(info.st_mode) || info.st_size < 1 || info.st_size > limit) {
        snprintf(error, error_size, "cannot read %.700s: expected a regular file of 1..%d bytes", path, limit);
        return NULL;
    }
#endif
    unsigned char *bytes = LoadFileData(path, length);
    if (!bytes || *length < 1 || *length > limit) {
        UnloadFileData(bytes);
        snprintf(error, error_size, "cannot read %.700s: missing/empty file or exceeds %d bytes", path, limit);
        return NULL;
    }
    return bytes;
}

static uint32_t big_endian(const unsigned char *p)
{
    return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
}

bool nova_decode_sprite(const unsigned char *bytes, int length, Image *image,
    char *error, size_t error_size)
{
    *image = (Image){0};
    if (length < 33 || memcmp(bytes, "\x89PNG\r\n\x1a\n", 8) ||
        big_endian(bytes + 8) != 13 || memcmp(bytes + 12, "IHDR", 4))
        return error_message(error, error_size, "sprite must be a PNG with an IHDR header");
    uint32_t width = big_endian(bytes + 16), height = big_endian(bytes + 20);
    if (!width || !height || width > 2048 || height > 2048 || bytes[24] != 8 ||
        (bytes[25] != 2 && bytes[25] != 6) || bytes[26] || bytes[27] || bytes[28])
        return error_message(error, error_size, "PNG subset: 8-bit RGB/RGBA, noninterlaced, 1..2048 pixels per dimension");
    *image = LoadImageFromMemory(".png", bytes, length);
    if (!IsImageValid(*image) || image->width != (int)width || image->height != (int)height) {
        UnloadImage(*image);
        *image = (Image){0};
        return error_message(error, error_size, "PNG decoding failed or dimensions do not match IHDR");
    }
    return true;
}

static bool accessor_valid(const cgltf_accessor *a)
{
    if (!a->buffer_view || a->is_sparse || a->normalized || !a->count || a->count > NOVA_MODEL_VERTEX_LIMIT)
        return false;
    size_t element = cgltf_calc_size(a->type, a->component_type);
    size_t component = cgltf_component_size(a->component_type);
    const cgltf_buffer_view *view = a->buffer_view;
    if (!element || !component || a->stride < element || a->stride > 252 || a->offset > view->size ||
        a->offset % component || view->offset % component || a->stride % component) return false;
    size_t remaining = view->size - a->offset;
    return remaining >= element && a->count - 1 <= (remaining - element) / a->stride;
}

bool nova_decode_model_png(const unsigned char *bytes, int length, Image *image,
    char *error, size_t error_size)
{
    *image = (Image){0};
    if (length > NOVA_MODEL_TEXTURE_BYTES ||
        !nova_decode_sprite(bytes, length, image, error, error_size))
        return error_message(error, error_size, "model texture requires a valid RGB/RGBA PNG of at most 1 MiB");
    bool valid = image->width <= 1024 && image->height <= 1024;
    ImageFormat(image, PIXELFORMAT_UNCOMPRESSED_R8G8B8A8);
    if (!image->data) valid = false;
    if (valid) {
        const unsigned char *pixels = image->data;
        size_t count = (size_t)image->width * (size_t)image->height;
        for (size_t i = 0; i < count; ++i) if (pixels[i*4+3] != 255) { valid = false; break; }
    }
    if (!valid) {
        UnloadImage(*image); *image = (Image){0};
        return error_message(error, error_size, "model PNG subset: 1..1024 pixels per dimension; every pixel must be opaque");
    }
    return true;
}

static bool material_valid(const cgltf_material *m)
{
    if (!m->unlit || m->extensions_count || m->has_pbr_specular_glossiness ||
        m->has_clearcoat || m->has_transmission || m->has_volume || m->has_ior ||
        m->has_specular || m->has_sheen || m->has_emissive_strength || m->has_iridescence ||
        m->has_anisotropy || m->has_dispersion || m->double_sided ||
        m->alpha_mode != cgltf_alpha_mode_opaque || m->normal_texture.texture ||
        m->occlusion_texture.texture || m->emissive_texture.texture ||
        m->pbr_metallic_roughness.metallic_roughness_texture.texture) return false;
    const cgltf_texture_view *view = &m->pbr_metallic_roughness.base_color_texture;
    if (view->texture && (view->texcoord != 0 || view->has_transform)) return false;
    for (int i = 0; i < 3; ++i) if (m->emissive_factor[i] != 0) return false;
    for (int i = 0; i < 4; ++i) {
        float c = m->pbr_metallic_roughness.base_color_factor[i];
        if (!isfinite(c) || c < 0 || c > 1 || (i == 3 && c != 1)) return false;
    }
    return true;
}

static bool glb_subset(cgltf_data *data, char *error, size_t error_size)
{
    const char *reason = "GLB must be glTF 2.0 with exactly one embedded BIN buffer and one scene";
    if (data->file_type != cgltf_file_type_glb || !data->asset.version ||
        strcmp(data->asset.version, "2.0") || data->buffers_count != 1 ||
        data->buffers[0].uri || !data->bin || data->buffers[0].size > data->bin_size ||
        data->scenes_count != 1 || !data->nodes_count || data->nodes_count > 256 ||
        !data->meshes_count || data->meshes_count > 128 || data->asset.min_version) goto fail;
    reason = "unsupported GLB feature: only KHR_materials_unlit, static geometry and opaque base colors are supported";
    if (data->animations_count || data->skins_count ||
        data->images_count > NOVA_MODEL_TEXTURES || data->textures_count > NOVA_MODEL_TEXTURES ||
        data->samplers_count > NOVA_MODEL_TEXTURES || data->materials_count > 128 ||
        data->cameras_count || data->lights_count || data->variants_count ||
        data->data_extensions_count || data->asset.extensions_count || data->scenes[0].extensions_count ||
        data->buffers[0].extensions_count) goto fail;
    reason = "model textures require embedded PNG buffer views and nearest/clamp samplers; no URIs or texture extensions";
    for (size_t i = 0; i < data->images_count; ++i) {
        const cgltf_image *image = &data->images[i];
        if (image->uri || !image->buffer_view || !image->mime_type ||
            strcmp(image->mime_type, "image/png") || image->extensions_count ||
            image->buffer_view->size > NOVA_MODEL_TEXTURE_BYTES) goto fail;
    }
    for (size_t i = 0; i < data->samplers_count; ++i) {
        const cgltf_sampler *s = &data->samplers[i];
        if (s->extensions_count || s->mag_filter != 9728 || s->min_filter != 9728 ||
            s->wrap_s != 33071 || s->wrap_t != 33071) goto fail;
    }
    for (size_t i = 0; i < data->textures_count; ++i) {
        const cgltf_texture *t = &data->textures[i];
        if (!t->image || !t->sampler || t->extensions_count || t->has_basisu || t->has_webp) goto fail;
    }
    reason = "unsupported material/extension: only opaque unlit base color and TEXCOORD_0 PNG are supported";
    for (size_t i = 0; i < data->extensions_used_count; ++i)
        if (strcmp(data->extensions_used[i], "KHR_materials_unlit")) goto fail;
    for (size_t i = 0; i < data->extensions_required_count; ++i)
        if (strcmp(data->extensions_required[i], "KHR_materials_unlit")) goto fail;
    for (size_t i = 0; i < data->materials_count; ++i)
        if (!material_valid(&data->materials[i])) goto fail;
    reason = "invalid or unsupported GLB buffer view/accessor (sparse and compressed data are unsupported)";
    for (size_t i = 0; i < data->buffer_views_count; ++i) {
        cgltf_buffer_view *v = &data->buffer_views[i];
        if (v->buffer != &data->buffers[0] || v->extensions_count || v->has_meshopt_compression ||
            v->offset > v->buffer->size || v->size > v->buffer->size - v->offset) goto fail;
    }
    for (size_t i = 0; i < data->accessors_count; ++i)
        if (data->accessors[i].extensions_count || !accessor_valid(&data->accessors[i])) goto fail;
    reason = "GLB requires triangles, float POSITION/optional NORMAL, and float TEXCOORD_0 for textured materials";
    for (size_t i = 0; i < data->meshes_count; ++i) {
        cgltf_mesh *mesh = &data->meshes[i];
        if (!mesh->primitives_count || mesh->primitives_count > 128 || mesh->extensions_count ||
            mesh->weights_count || mesh->target_names_count) goto fail;
        for (size_t j = 0; j < mesh->primitives_count; ++j) {
            cgltf_primitive *p = &mesh->primitives[j];
            if (p->type != cgltf_primitive_type_triangles || p->targets_count ||
                p->has_draco_mesh_compression || p->extensions_count || p->mappings_count) goto fail;
            int positions = 0, normals = 0, uvs = 0;
            size_t position_count = 0, uv_count = 0;
            for (size_t k = 0; k < p->attributes_count; ++k) {
                cgltf_attribute *a = &p->attributes[k];
                if (a->data->type != (a->type == cgltf_attribute_type_texcoord ? cgltf_type_vec2 : cgltf_type_vec3) ||
                    a->data->component_type != cgltf_component_type_r_32f ||
                    a->index != 0) goto fail;
                if (a->type == cgltf_attribute_type_position) { positions++; position_count = a->data->count; }
                else if (a->type == cgltf_attribute_type_normal) normals++;
                else if (a->type == cgltf_attribute_type_texcoord) { uvs++; uv_count = a->data->count; }
                else goto fail;
            }
            if (positions != 1 || normals > 1 || uvs > 1 || (uvs && uv_count != position_count) ||
                (p->material && p->material->pbr_metallic_roughness.base_color_texture.texture && !uvs)) goto fail;
            if (p->indices && (p->indices->type != cgltf_type_scalar ||
                (p->indices->component_type != cgltf_component_type_r_8u &&
                 p->indices->component_type != cgltf_component_type_r_16u &&
                 p->indices->component_type != cgltf_component_type_r_32u))) goto fail;
        }
    }
    reason = "GLB nodes require finite affine transforms, no skins/instancing, and membership in the single scene";
    for (size_t i = 0; i < data->nodes_count; ++i) {
        cgltf_node *n = &data->nodes[i];
        if (n->skin || n->camera || n->light || n->weights_count || n->has_mesh_gpu_instancing ||
            n->extensions_count || (n->has_matrix && (n->has_translation || n->has_rotation || n->has_scale))) goto fail;
        float local[16];
        cgltf_node_transform_local(n, local);
        for (int k = 0; k < 16; ++k) if (!isfinite(local[k]) || fabsf(local[k]) > 1000000) goto fail;
        if (local[3] || local[7] || local[11] || local[15] != 1) goto fail;
        if (n->has_rotation) {
            float norm = 0;
            for (int k = 0; k < 4; ++k) norm += n->rotation[k] * n->rotation[k];
            if (!isfinite(norm) || fabsf(norm - 1) > 0.001f) goto fail;
        }
        cgltf_node *root = n;
        size_t depth = 0;
        while (root->parent && depth++ < data->nodes_count) root = root->parent;
        if (root->parent) goto fail;
        size_t membership = 0;
        for (size_t k = 0; k < data->scenes[0].nodes_count; ++k)
            membership += data->scenes[0].nodes[k] == root;
        if (membership != 1) goto fail;
    }
    return true;
fail:
    return error_message(error, error_size, reason);
}

void nova_unload_cpu_model(Model *model)
{
    if (model->meshes) {
        for (int i = 0; i < model->meshCount; ++i) {
            MemFree(model->meshes[i].vertices);
            MemFree(model->meshes[i].colors);
            MemFree(model->meshes[i].texcoords);
        }
    }
    MemFree(model->meshes);
    MemFree(model->materials);
    MemFree(model->meshMaterial);
    *model = (Model){0};
}

void nova_unload_model_images(NovaModelImages *images)
{
    for (size_t i = 0; i < images->count; ++i) {
        if (images->images[i].data) UnloadImage(images->images[i]);
        if (images->textures[i].id) UnloadTexture(images->textures[i]);
    }
    *images = (NovaModelImages){0};
}

bool nova_decode_glb_images(const unsigned char *bytes, int length, Model *model, NovaModelImages *images,
    char *error, size_t error_size)
{
    *model = (Model){0};
    *images = (NovaModelImages){0};
    for (size_t i = 0; i < 128; ++i) images->material_image[i] = -1;
    cgltf_options options = {0};
    cgltf_data *data = NULL;
    uint32_t declared = length >= 12 ? (uint32_t)bytes[8] | ((uint32_t)bytes[9] << 8) |
        ((uint32_t)bytes[10] << 16) | ((uint32_t)bytes[11] << 24) : 0;
    if (length < 20 || length > NOVA_ASSET_FILE_LIMIT || declared != (uint32_t)length ||
        cgltf_parse(&options, bytes, (size_t)length, &data) != cgltf_result_success)
        return error_message(error, error_size, "cannot parse GLB container/JSON");
    const char *reason = "invalid GLB buffer or geometry";
    bool success = false;
    if (!glb_subset(data, error, error_size)) goto done;
    // No URI loader is called: the only buffer aliases the validated embedded BIN.
    data->buffers[0].data = (void *)data->bin;
    if (cgltf_validate(data) != cgltf_result_success) goto fail;
    for (size_t i = 0; i < data->images_count; ++i) {
        const cgltf_buffer_view *v = data->images[i].buffer_view;
        images->count = i + 1;
        if (!nova_decode_model_png((const unsigned char *)data->bin + v->offset, (int)v->size,
            &images->images[i], error, error_size)) goto done;
        images->pixels += (size_t)images->images[i].width * (size_t)images->images[i].height;
        reason = "model exceeds 4 million unique texture pixels";
        if (images->pixels > NOVA_MODEL_TEXTURE_PIXELS) goto fail;
    }
    size_t primitives = 0, vertices = 0;
    for (size_t i = 0; i < data->nodes_count; ++i)
        if (data->nodes[i].mesh) primitives += data->nodes[i].mesh->primitives_count;
    reason = "GLB must have 1..128 node-instanced triangle primitives";
    if (!primitives || primitives > 128) goto fail;
    model->meshCount = (int)primitives;
    model->materialCount = (int)primitives;
    model->transform = (Matrix){.m0 = 1, .m5 = 1, .m10 = 1, .m15 = 1};
    model->meshes = MemAlloc((unsigned int)(primitives * sizeof(Mesh)));
    model->materials = MemAlloc((unsigned int)(primitives * sizeof(Material)));
    model->meshMaterial = MemAlloc((unsigned int)(primitives * sizeof(int)));
    if (model->meshes) memset(model->meshes, 0, primitives * sizeof(Mesh));
    if (model->materials) memset(model->materials, 0, primitives * sizeof(Material));
    reason = "cannot allocate native GLB model";
    if (!model->meshes || !model->materials || !model->meshMaterial) goto fail;
    size_t slot = 0;
    for (size_t i = 0; i < data->nodes_count; ++i) {
        cgltf_node *node = &data->nodes[i];
        if (!node->mesh) continue;
        float transform[16];
        cgltf_node_transform_world(node, transform);
        reason = "GLB world transform is nonfinite";
        for (int k = 0; k < 16; ++k) if (!isfinite(transform[k])) goto fail;
        double determinant = (double)transform[0] * (transform[5] * (double)transform[10] - transform[9] * (double)transform[6]) -
            (double)transform[4] * (transform[1] * (double)transform[10] - transform[9] * (double)transform[2]) +
            (double)transform[8] * (transform[1] * (double)transform[6] - transform[5] * (double)transform[2]);
        for (size_t j = 0; j < node->mesh->primitives_count; ++j, ++slot) {
            cgltf_primitive *p = &node->mesh->primitives[j];
            cgltf_accessor *position = NULL, *uv = NULL;
            for (size_t k = 0; k < p->attributes_count; ++k) {
                if (p->attributes[k].type == cgltf_attribute_type_position) position = p->attributes[k].data;
                if (p->attributes[k].type == cgltf_attribute_type_texcoord) uv = p->attributes[k].data;
            }
            size_t count = p->indices ? p->indices->count : position->count;
            reason = "GLB triangle count invalid or exceeds 65535 expanded vertices per primitive / 262144 per model";
            if (count % 3 || count > 65535 || count > NOVA_MODEL_VERTEX_LIMIT - vertices) goto fail;
            vertices += count;
            Mesh *mesh = &model->meshes[slot];
            mesh->vertexCount = (int)count;
            mesh->triangleCount = (int)(count / 3);
            mesh->vertices = MemAlloc((unsigned int)(count * 3 * sizeof(float)));
            mesh->colors = MemAlloc((unsigned int)(count * 4));
            if (uv) mesh->texcoords = MemAlloc((unsigned int)(count * 2 * sizeof(float)));
            reason = "cannot allocate GLB vertices";
            if (!mesh->vertices || !mesh->colors || (uv && !mesh->texcoords)) goto fail;
            Color base = WHITE;
            if (p->material) {
                float *c = p->material->pbr_metallic_roughness.base_color_factor;
                base = (Color){(unsigned char)(c[0] * 255), (unsigned char)(c[1] * 255),
                    (unsigned char)(c[2] * 255), 255};
                cgltf_texture *texture = p->material->pbr_metallic_roughness.base_color_texture.texture;
                if (texture) images->material_image[slot] = (int)(texture->image - data->images);
            }
            reason = "GLB contains invalid indices or nonfinite/out-of-range transformed positions";
            for (size_t k = 0; k < count; ++k) {
                memcpy(mesh->colors + k * 4, &base, 4);
                size_t index = p->indices ? cgltf_accessor_read_index(p->indices, k) : k;
                float v[3];
                if (index >= position->count || !cgltf_accessor_read_float(position, index, v, 3)) goto fail;
                if (uv) {
                    float t[2];
                    reason = "GLB UVs must be finite float TEXCOORD_0 values in 0..1";
                    if (!cgltf_accessor_read_float(uv, index, t, 2) ||
                        !isfinite(t[0]) || !isfinite(t[1]) || t[0] < 0 || t[0] > 1 || t[1] < 0 || t[1] > 1) goto fail;
                    memcpy(mesh->texcoords + k*2, t, sizeof(t));
                }
                for (int axis = 0; axis < 3; ++axis) {
                    float value = transform[axis] * v[0] + transform[4 + axis] * v[1] +
                        transform[8 + axis] * v[2] + transform[12 + axis];
                    if (!isfinite(value) || fabsf(value) > 1000000) goto fail;
                    mesh->vertices[k * 3 + (size_t)axis] = value;
                }
            }
            if (determinant < 0) {
                for (size_t k = 0; k < count; k += 3) {
                    for (int axis = 0; axis < 3; ++axis) {
                        float value = mesh->vertices[(k + 1) * 3 + (size_t)axis];
                        mesh->vertices[(k + 1) * 3 + (size_t)axis] = mesh->vertices[(k + 2) * 3 + (size_t)axis];
                        mesh->vertices[(k + 2) * 3 + (size_t)axis] = value;
                    }
                    if (uv) for (int axis = 0; axis < 2; ++axis) {
                        float value = mesh->texcoords[(k+1)*2+(size_t)axis];
                        mesh->texcoords[(k+1)*2+(size_t)axis] = mesh->texcoords[(k+2)*2+(size_t)axis];
                        mesh->texcoords[(k+2)*2+(size_t)axis] = value;
                    }
                }
            }
            model->meshMaterial[slot] = (int)slot;
        }
    }
    success = true;
    goto done;
fail:
    error_message(error, error_size, reason);
done:
    if (!success) { nova_unload_cpu_model(model); nova_unload_model_images(images); }
    cgltf_free(data);
    return success;
}

bool nova_decode_glb(const unsigned char *bytes, int length, Model *model, char *error, size_t error_size)
{
    NovaModelImages images = {0};
    bool ok = nova_decode_glb_images(bytes, length, model, &images, error, error_size);
    nova_unload_model_images(&images);
    return ok;
}

void nova_unload_resources(NovaResources *resources)
{
    for (size_t i = 0; i < resources->count; ++i) {
        NovaResource *r = &resources->resources[i];
        if (!r->owned) continue;
        if (r->type == NOVA_ASSET_SPRITE) UnloadTexture(r->texture);
        else if (r->type == NOVA_ASSET_MODEL) { UnloadModel(r->model); nova_unload_model_images(&r->images); }
        else if (IsSoundValid(r->sound)) { StopSound(r->sound); UnloadSound(r->sound); }
    }
    free(resources->services);
    *resources = (NovaResources){0};
}

NovaSceneInspection nova_inspect_scene(const NovaEngine *engine, const NovaResources *resources)
{
    bool loaded = engine && resources->source[0];
    return (NovaSceneInspection){
        .loaded = loaded, .project = loaded && resources->project,
        .manifest_version = resources->manifest_version, .identity = resources->identity,
        .source = resources->source, .root = resources->root, .entry = resources->entry,
        .relative_entry = resources->relative_entry,
        .count = loaded ? resources->count : 0,
        .assets = loaded ? resources->inspection : NULL,
        .frame = loaded ? nova_frame(engine) : NULL,
        .scene_error = nova_error(engine), .load_error = resources->load_error
    };
}

static void inspect_model(NovaAssetInspection *info, const Model *model)
{
    info->primitives = (size_t)model->meshCount;
    bool first = true;
    for (int i = 0; i < model->meshCount; ++i) {
        const Mesh *mesh = &model->meshes[i];
        info->vertices += (size_t)mesh->vertexCount;
        for (int j = 0; j < mesh->vertexCount; ++j) {
            const float *v = mesh->vertices + j * 3;
            if (first) {
                info->bounds_min = info->bounds_max = (NovaVec3){v[0], v[1], v[2]};
                first = false;
            } else {
                info->bounds_min.x = fminf(info->bounds_min.x, v[0]);
                info->bounds_min.y = fminf(info->bounds_min.y, v[1]);
                info->bounds_min.z = fminf(info->bounds_min.z, v[2]);
                info->bounds_max.x = fmaxf(info->bounds_max.x, v[0]);
                info->bounds_max.y = fmaxf(info->bounds_max.y, v[1]);
                info->bounds_max.z = fmaxf(info->bounds_max.z, v[2]);
            }
        }
    }
}

static bool upload_model(Model *model, NovaModelImages *images, char *error, size_t error_size)
{
    for (size_t i = 0; i < images->count; ++i) {
        images->textures[i] = LoadTextureFromImage(images->images[i]);
        UnloadImage(images->images[i]); images->images[i] = (Image){0};
        if (!IsTextureValid(images->textures[i]))
            return error_message(error, error_size, "GLB GPU texture upload failed");
        SetTextureFilter(images->textures[i], TEXTURE_FILTER_POINT);
        SetTextureWrap(images->textures[i], TEXTURE_WRAP_CLAMP);
    }
    bool valid = true;
    for (int i = 0; i < model->meshCount; ++i) {
        model->materials[i] = LoadMaterialDefault();
        if (!model->materials[i].maps) { valid = false; break; }
        int image = images->material_image[i];
        if (image >= 0) model->materials[i].maps[MATERIAL_MAP_DIFFUSE].texture = images->textures[image];
        UploadMesh(&model->meshes[i], false);
        if (!model->meshes[i].vboId || !model->meshes[i].vboId[0]) { valid = false; break; }
    }
    if (!valid) return error_message(error, error_size, "GLB GPU mesh/material upload failed");
    return true;
}

static bool stage_scene(NovaEngine **engine, NovaResources *resources,
    const char *path, bool project, bool gpu, const NovaProjectDraft *draft, char *error, size_t error_size)
{
    NovaProject manifest = {0};
    NovaScene authored = {0};
    NovaResources pending = {0};
    NovaEngine *candidate = NULL;
    unsigned char *bytes = NULL;
    char root[NOVA_NATIVE_PATH_CAPACITY], resolved[NOVA_NATIVE_PATH_CAPACITY];
    char detail[1024] = {0};
    int length = 0;
    bool success = false;
    size_t total_bytes = 0, total_vertices = 0, total_pixels = 0;
    double total_audio_seconds = 0;
    if (strlen(path) >= sizeof(pending.source)) {
        error_message(detail, sizeof(detail), "scene path is too long"); goto done;
    }
    if (project) {
        if (!nova_project_root(path, root, detail, sizeof(detail))) goto done;
        snprintf(pending.root, sizeof(pending.root), "%s", root);
        char journal[NOVA_NATIVE_PATH_CAPACITY + 32];
        snprintf(journal, sizeof(journal), "%s/.nova-studio-journal", root);
        if (FileExists(journal)) {
            error_message(detail, sizeof(detail),
                "interrupted Studio save: open the project in Nova Studio to review and finish recovery");
            goto done;
        }
        if (!draft) bytes = nova_read_file(path, NOVA_MANIFEST_LIMIT, &length, detail, sizeof(detail));
        if ((!draft && !bytes) || !nova_project_parse(&manifest,
            draft ? draft->manifest : (const char *)bytes,
            draft ? draft->manifest_length : (size_t)length, detail, sizeof(detail))) goto done;
        snprintf(pending.relative_entry, sizeof(pending.relative_entry), "%s", manifest.entry);
        snprintf(pending.relative_scene, sizeof(pending.relative_scene), "%s", manifest.scene);
        UnloadFileData(bytes); bytes = NULL;
        if (*manifest.scene) {
            if (!nova_project_resolve(root, manifest.scene, resolved, detail, sizeof(detail))) goto done;
            if (!draft) bytes = nova_read_file(resolved, NOVA_SCENE_LIMIT, &length, detail, sizeof(detail));
            if ((!draft && !bytes) || !nova_scene_parse(&authored,
                draft ? draft->scene : (const char *)bytes, draft ? draft->scene_length : (size_t)length,
                manifest.assets, manifest.count, detail, sizeof(detail))) goto done;
            UnloadFileData(bytes); bytes = NULL;
        }
        for (size_t i = 0; i < manifest.count; ++i) {
            NovaAsset *asset = &manifest.assets[i];
            if (!nova_project_resolve(root, asset->path, resolved, detail, sizeof(detail))) goto done;
            bool cached = false;
            for (size_t j = 0; j < i; ++j) {
                if (asset->type == manifest.assets[j].type && !strcmp(asset->path, manifest.assets[j].path)) {
                    pending.resources[pending.count] = pending.resources[j];
                    pending.inspection[pending.count] = pending.inspection[j];
                    pending.inspection[pending.count].declaration = *asset;
                    pending.resources[pending.count++].owned = false;
                    cached = true;
                    TraceLog(LOG_INFO, "NOVA_ASSET cached id=%s", asset->id);
                    break;
                }
            }
            if (cached) continue;
            bytes = nova_read_file(resolved, NOVA_ASSET_FILE_LIMIT, &length, detail, sizeof(detail));
            if (!bytes) goto done;
            total_bytes += (size_t)length;
            if (total_bytes > NOVA_PROJECT_BYTE_LIMIT) {
                error_message(detail, sizeof(detail), "project assets exceed 64 MiB input budget");
                goto done;
            }
            NovaResource *r = &pending.resources[pending.count++];
            NovaAssetInspection *info = &pending.inspection[pending.count - 1];
            info->declaration = *asset;
            info->resource_index = pending.count - 1;
            info->input_bytes = (size_t)length;
            r->type = asset->type;
            r->owned = gpu;
            if (r->type == NOVA_ASSET_SPRITE) {
                Image image = {0};
                if (!nova_decode_sprite(bytes, length, &image, detail, sizeof(detail))) goto asset_error;
                info->width = image.width;
                info->height = image.height;
                total_pixels += (size_t)image.width * (size_t)image.height;
                if (gpu && total_pixels <= NOVA_SPRITE_PIXEL_LIMIT) r->texture = LoadTextureFromImage(image);
                UnloadImage(image);
                if (total_pixels > NOVA_SPRITE_PIXEL_LIMIT || (gpu && !IsTextureValid(r->texture))) {
                    error_message(detail, sizeof(detail), "sprite GPU upload failed or project exceeds 16 million sprite pixels");
                    goto asset_error;
                }
                if (gpu) SetTextureFilter(r->texture, TEXTURE_FILTER_POINT);
            } else if (r->type == NOVA_ASSET_MODEL) {
                if (!nova_decode_glb_images(bytes, length, &r->model, &r->images, detail, sizeof(detail))) goto asset_error;
                inspect_model(info, &r->model);
                info->textures = r->images.count; info->texture_pixels = r->images.pixels;
                total_vertices += info->vertices;
                total_pixels += r->images.pixels;
                if (!gpu) { nova_unload_cpu_model(&r->model); nova_unload_model_images(&r->images); }
                if (total_pixels > NOVA_SPRITE_PIXEL_LIMIT) {
                    error_message(detail, sizeof(detail), "project exceeds 16 million sprite/model texture pixels");
                    goto asset_error;
                }
                if (total_vertices > NOVA_MODEL_VERTEX_LIMIT) {
                    error_message(detail, sizeof(detail), "project exceeds 262144 expanded model vertices");
                    goto asset_error;
                }
                if (gpu && !upload_model(&r->model, &r->images, detail, sizeof(detail))) goto asset_error;
            } else {
                Wave wave = {0};
                if (!nova_decode_wav(bytes, length, &wave, detail, sizeof(detail))) goto asset_error;
                info->sample_rate = wave.sampleRate; info->channels = wave.channels; info->sample_frames = wave.frameCount;
                total_audio_seconds += (double)wave.frameCount / wave.sampleRate;
                if (total_audio_seconds > NOVA_AUDIO_SECONDS_LIMIT) {
                    UnloadWave(wave);
                    error_message(detail, sizeof(detail), "project exceeds 120 seconds of unique decoded audio");
                    goto asset_error;
                }
                if (gpu) {
                    if (!nova_audio_device_ensure(detail, sizeof(detail))) {
                        UnloadWave(wave); goto asset_error;
                    }
                    r->sound = LoadSoundFromWave(wave);
                }
                UnloadWave(wave);
                if (gpu && (!IsAudioDeviceReady() || !IsSoundValid(r->sound))) {
                    error_message(detail, sizeof(detail), "native audio device initialization or sound upload failed");
                    goto asset_error;
                }
            }
            UnloadFileData(bytes); bytes = NULL;
            TraceLog(LOG_INFO, "NOVA_ASSET %s id=%s type=%s", gpu ? "loaded" : "validated", asset->id,
                asset->type == NOVA_ASSET_SPRITE ? "sprite" : asset->type == NOVA_ASSET_MODEL ? "model" : "audio");
            continue;
asset_error: {
                char message[1024];
                snprintf(message, sizeof(message), "asset '%s' (%.300s): %.600s", asset->id, asset->path, detail);
                snprintf(detail, sizeof(detail), "%s", message);
                goto done;
            }
        }
        if (!nova_project_resolve(root, manifest.entry, resolved, detail, sizeof(detail))) goto done;
    } else {
        snprintf(resolved, sizeof(resolved), "%s", path);
    }
    if (!draft) bytes = nova_read_file(resolved, NOVA_ASSET_FILE_LIMIT, &length, detail, sizeof(detail));
    if (!draft && !bytes) goto done;
    const char *source = draft ? draft->source : (const char *)bytes;
    size_t source_length = draft ? draft->source_length : (size_t)length;
    if (!source || source_length > NOVA_ASSET_FILE_LIMIT) {
        error_message(detail, sizeof(detail), "missing or oversized Lua source"); goto done;
    }
    if (memchr(source, '\0', source_length)) {
        error_message(detail, sizeof(detail), "entry Lua scene contains NUL"); goto done;
    }
    candidate = nova_create();
    pending.services = calloc(1, sizeof(*pending.services));
    if (!candidate || !pending.services) { error_message(detail, sizeof(detail), "native service allocation failed"); goto done; }
    pending.manifest_version = manifest.version;
    snprintf(pending.identity, sizeof(pending.identity), "%s", manifest.identity);
    NovaServices *services = pending.services;
    services->preflight = !gpu || draft; services->count = pending.count;
    snprintf(services->identity, sizeof(services->identity), "%s", manifest.identity);
    for (size_t i = 0; i < pending.count; ++i) {
        services->indices[i] = pending.inspection[i].resource_index;
        services->sounds[i] = pending.resources[i].sound;
    }
    nova_set_service_host(candidate, (NovaServiceHost){
        .context = services, .saves = manifest.version >= 2,
        .read_save = service_read, .effect = service_effect
    });
    if (!nova_load_with_scene(candidate, source, source_length, resolved,
        manifest.assets, manifest.count, *manifest.scene ? &authored : NULL) ||
        !nova_tick(candidate, 0, (NovaInput){0})) {
        snprintf(detail, sizeof(detail), "%s", nova_error(candidate)); goto done;
    }
    pending.project = project;
    snprintf(pending.source, sizeof(pending.source), "%s", path);
    snprintf(pending.entry, sizeof(pending.entry), "%s", resolved);
    *engine = candidate;
    *resources = pending;
    candidate = NULL;
    pending = (NovaResources){0};
    success = true;
    error[0] = '\0';
done:
    UnloadFileData(bytes);
    nova_destroy(candidate);
    nova_unload_resources(&pending);
    if (!success) {
        char message[1024];
        snprintf(message, sizeof(message), "%.300s: %.700s", path, detail);
        snprintf(error, error_size, "%s", message);
        TraceLog(LOG_ERROR, "NOVA: %s", error);
    }
    return success;
}

bool nova_open_scene(NovaEngine **engine, NovaResources *resources,
    const char *path, bool project, char *error, size_t error_size)
{
    NovaEngine *candidate = NULL;
    NovaResources pending = {0};
    char detail[1024];
    if (!stage_scene(&candidate, &pending, path, project, true, NULL, detail, sizeof(detail))) {
        snprintf(resources->load_error, sizeof(resources->load_error), "%s", detail);
        snprintf(error, error_size, "%s", detail);
        return false;
    }
    if (!nova_tick_services(candidate, &pending)) {
        snprintf(detail, sizeof(detail), "%s", nova_error(candidate));
        nova_destroy(candidate); nova_unload_resources(&pending);
        snprintf(resources->load_error, sizeof(resources->load_error), "%s", detail);
        snprintf(error, error_size, "%s", detail);
        TraceLog(LOG_ERROR, "NOVA: %s", detail);
        return false;
    }
    nova_destroy(*engine);
    nova_unload_resources(resources);
    *engine = candidate;
    *resources = pending;
    error[0] = '\0';
    return true;
}

bool nova_open_authoring_snapshot(NovaEngine **engine, NovaResources *resources,
    const char *path, const NovaProjectDraft *draft, char *error, size_t error_size)
{
    NovaEngine *candidate = NULL;
    NovaResources pending = {0};
    if (!draft || !stage_scene(&candidate, &pending, path, true, true, draft, error, error_size)) {
        if (!draft) error_message(error, error_size, "authoring snapshot is required");
        snprintf(resources->load_error, sizeof(resources->load_error), "%s", error);
        return false;
    }
    nova_destroy(*engine);
    nova_unload_resources(resources);
    *engine = candidate;
    *resources = pending;
    return true;
}

bool nova_validate_project(const char *path, NovaProjectValidation *validation,
    char *error, size_t error_size)
{
    NovaEngine *engine = NULL;
    NovaResources pending = {0};
    if (!stage_scene(&engine, &pending, path, true, false, NULL, error, error_size)) return false;
    *validation = (NovaProjectValidation){0};
    validation->project.count = pending.count;
    validation->project.version = pending.manifest_version;
    snprintf(validation->project.identity, sizeof(validation->project.identity), "%s", pending.identity);
    snprintf(validation->project.entry, sizeof(validation->project.entry), "%s", pending.relative_entry);
    snprintf(validation->project.scene, sizeof(validation->project.scene), "%s", pending.relative_scene);
    snprintf(validation->root, sizeof(validation->root), "%s", pending.root);
    snprintf(validation->entry, sizeof(validation->entry), "%s", pending.entry);
    for (size_t i = 0; i < pending.count; ++i) {
        validation->project.assets[i] = pending.inspection[i].declaration;
        validation->assets[i] = pending.inspection[i];
    }
    nova_destroy(engine);
    nova_unload_resources(&pending);
    error[0] = '\0';
    return true;
}
