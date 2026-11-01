#include "assets.h"
#include <cgltf.h>

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef __ANDROID__
#include <sys/stat.h>
#endif

static bool error_message(char *error, size_t size, const char *message)
{
    snprintf(error, size, "%s", message);
    return false;
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

static bool material_valid(const cgltf_material *m)
{
    if (!m->unlit || m->extensions_count || m->has_pbr_specular_glossiness ||
        m->has_clearcoat || m->has_transmission || m->has_volume || m->has_ior ||
        m->has_specular || m->has_sheen || m->has_emissive_strength || m->has_iridescence ||
        m->has_anisotropy || m->has_dispersion || m->double_sided ||
        m->alpha_mode != cgltf_alpha_mode_opaque || m->normal_texture.texture ||
        m->occlusion_texture.texture || m->emissive_texture.texture ||
        m->pbr_metallic_roughness.base_color_texture.texture ||
        m->pbr_metallic_roughness.metallic_roughness_texture.texture) return false;
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
    if (data->animations_count || data->skins_count || data->images_count || data->textures_count ||
        data->samplers_count || data->cameras_count || data->lights_count || data->variants_count ||
        data->data_extensions_count || data->asset.extensions_count || data->scenes[0].extensions_count ||
        data->buffers[0].extensions_count) goto fail;
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
    reason = "GLB subset requires triangles, float POSITION and optional float NORMAL; no UVs, vertex colors or morphs";
    for (size_t i = 0; i < data->meshes_count; ++i) {
        cgltf_mesh *mesh = &data->meshes[i];
        if (!mesh->primitives_count || mesh->primitives_count > 128 || mesh->extensions_count ||
            mesh->weights_count || mesh->target_names_count) goto fail;
        for (size_t j = 0; j < mesh->primitives_count; ++j) {
            cgltf_primitive *p = &mesh->primitives[j];
            if (p->type != cgltf_primitive_type_triangles || p->targets_count ||
                p->has_draco_mesh_compression || p->extensions_count || p->mappings_count) goto fail;
            int positions = 0, normals = 0;
            for (size_t k = 0; k < p->attributes_count; ++k) {
                cgltf_attribute *a = &p->attributes[k];
                if (a->data->type != cgltf_type_vec3 || a->data->component_type != cgltf_component_type_r_32f ||
                    a->index != 0) goto fail;
                if (a->type == cgltf_attribute_type_position) positions++;
                else if (a->type == cgltf_attribute_type_normal) normals++;
                else goto fail;
            }
            if (positions != 1 || normals > 1) goto fail;
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

bool nova_decode_glb(const unsigned char *bytes, int length, Model *model,
    char *error, size_t error_size)
{
    *model = (Model){0};
    cgltf_options options = {0};
    cgltf_data *data = NULL;
    uint32_t declared = length >= 12 ? (uint32_t)bytes[8] | ((uint32_t)bytes[9] << 8) |
        ((uint32_t)bytes[10] << 16) | ((uint32_t)bytes[11] << 24) : 0;
    if (length < 20 || declared != (uint32_t)length ||
        cgltf_parse(&options, bytes, (size_t)length, &data) != cgltf_result_success)
        return error_message(error, error_size, "cannot parse GLB container/JSON");
    const char *reason = "invalid GLB buffer or geometry";
    bool success = false;
    if (!glb_subset(data, error, error_size)) goto done;
    // No URI loader is called: the only buffer aliases the validated embedded BIN.
    data->buffers[0].data = (void *)data->bin;
    if (cgltf_validate(data) != cgltf_result_success) goto fail;
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
            cgltf_accessor *position = NULL;
            for (size_t k = 0; k < p->attributes_count; ++k)
                if (p->attributes[k].type == cgltf_attribute_type_position) position = p->attributes[k].data;
            size_t count = p->indices ? p->indices->count : position->count;
            reason = "GLB triangle count invalid or exceeds 65535 expanded vertices per primitive / 262144 per model";
            if (count % 3 || count > 65535 || count > NOVA_MODEL_VERTEX_LIMIT - vertices) goto fail;
            vertices += count;
            Mesh *mesh = &model->meshes[slot];
            mesh->vertexCount = (int)count;
            mesh->triangleCount = (int)(count / 3);
            mesh->vertices = MemAlloc((unsigned int)(count * 3 * sizeof(float)));
            mesh->colors = MemAlloc((unsigned int)(count * 4));
            reason = "cannot allocate GLB vertices";
            if (!mesh->vertices || !mesh->colors) goto fail;
            Color base = WHITE;
            if (p->material) {
                float *c = p->material->pbr_metallic_roughness.base_color_factor;
                base = (Color){(unsigned char)(c[0] * 255), (unsigned char)(c[1] * 255),
                    (unsigned char)(c[2] * 255), 255};
            }
            reason = "GLB contains invalid indices or nonfinite/out-of-range transformed positions";
            for (size_t k = 0; k < count; ++k) {
                memcpy(mesh->colors + k * 4, &base, 4);
                size_t index = p->indices ? cgltf_accessor_read_index(p->indices, k) : k;
                float v[3];
                if (index >= position->count || !cgltf_accessor_read_float(position, index, v, 3)) goto fail;
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
    if (!success) {
        if (model->meshes) {
            for (int i = 0; i < model->meshCount; ++i) {
                MemFree(model->meshes[i].vertices);
                MemFree(model->meshes[i].colors);
            }
        }
        MemFree(model->meshes);
        MemFree(model->materials);
        MemFree(model->meshMaterial);
        *model = (Model){0};
    }
    cgltf_free(data);
    return success;
}

void nova_unload_resources(NovaResources *resources)
{
    for (size_t i = 0; i < resources->count; ++i) {
        NovaResource *r = &resources->resources[i];
        if (!r->owned) continue;
        if (r->type == NOVA_ASSET_SPRITE) UnloadTexture(r->texture);
        else UnloadModel(r->model);
    }
    *resources = (NovaResources){0};
}

static bool upload_model(const unsigned char *bytes, int length, Model *model,
    char *error, size_t error_size)
{
    if (!nova_decode_glb(bytes, length, model, error, error_size)) return false;
    bool valid = true;
    for (int i = 0; i < model->meshCount; ++i) {
        model->materials[i] = LoadMaterialDefault();
        if (!model->materials[i].maps) { valid = false; break; }
        UploadMesh(&model->meshes[i], false);
        if (!model->meshes[i].vboId || !model->meshes[i].vboId[0]) { valid = false; break; }
    }
    if (!valid) return error_message(error, error_size, "GLB GPU mesh/material upload failed");
    return true;
}

bool nova_open_scene(NovaEngine **engine, NovaResources *resources,
    const char *path, bool project, char *error, size_t error_size)
{
    NovaProject manifest = {0};
    NovaResources pending = {0};
    NovaEngine *candidate = NULL;
    unsigned char *bytes = NULL;
    char root[NOVA_NATIVE_PATH_CAPACITY], resolved[NOVA_NATIVE_PATH_CAPACITY];
    char detail[1024] = {0};
    int length = 0;
    bool success = false;
    size_t total_bytes = 0, total_vertices = 0, total_pixels = 0;
    if (project) {
        if (!nova_project_root(path, root, detail, sizeof(detail))) goto done;
        bytes = nova_read_file(path, NOVA_MANIFEST_LIMIT, &length, detail, sizeof(detail));
        if (!bytes || !nova_project_parse(&manifest, (const char *)bytes, (size_t)length, detail, sizeof(detail))) goto done;
        UnloadFileData(bytes); bytes = NULL;
        for (size_t i = 0; i < manifest.count; ++i) {
            NovaAsset *asset = &manifest.assets[i];
            if (!nova_project_resolve(root, asset->path, resolved, detail, sizeof(detail))) goto done;
            bool cached = false;
            for (size_t j = 0; j < i; ++j) {
                if (asset->type == manifest.assets[j].type && !strcmp(asset->path, manifest.assets[j].path)) {
                    pending.resources[pending.count] = pending.resources[j];
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
            r->type = asset->type;
            r->owned = true;
            if (r->type == NOVA_ASSET_SPRITE) {
                Image image = {0};
                if (!nova_decode_sprite(bytes, length, &image, detail, sizeof(detail))) goto asset_error;
                total_pixels += (size_t)image.width * (size_t)image.height;
                if (total_pixels <= NOVA_SPRITE_PIXEL_LIMIT) r->texture = LoadTextureFromImage(image);
                UnloadImage(image);
                if (!IsTextureValid(r->texture)) {
                    error_message(detail, sizeof(detail), "sprite GPU upload failed or project exceeds 16 million sprite pixels");
                    goto asset_error;
                }
                SetTextureFilter(r->texture, TEXTURE_FILTER_POINT);
            } else {
                if (!upload_model(bytes, length, &r->model, detail, sizeof(detail))) goto asset_error;
                for (int k = 0; k < r->model.meshCount; ++k)
                    total_vertices += (size_t)r->model.meshes[k].vertexCount;
                if (total_vertices > NOVA_MODEL_VERTEX_LIMIT) {
                    error_message(detail, sizeof(detail), "project exceeds 262144 expanded model vertices");
                    goto asset_error;
                }
            }
            UnloadFileData(bytes); bytes = NULL;
            TraceLog(LOG_INFO, "NOVA_ASSET loaded id=%s type=%s", asset->id,
                asset->type == NOVA_ASSET_SPRITE ? "sprite" : "model");
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
        if (strlen(path) >= sizeof(resolved)) {
            error_message(detail, sizeof(detail), "scene path is too long"); goto done;
        }
        snprintf(resolved, sizeof(resolved), "%s", path);
    }
    bytes = nova_read_file(resolved, NOVA_ASSET_FILE_LIMIT, &length, detail, sizeof(detail));
    if (!bytes) goto done;
    if (memchr(bytes, '\0', (size_t)length)) {
        error_message(detail, sizeof(detail), "entry Lua scene contains NUL"); goto done;
    }
    candidate = nova_create();
    if (!nova_load_with_assets(candidate, (const char *)bytes, (size_t)length, resolved,
        manifest.assets, manifest.count) || !nova_tick(candidate, 0, (NovaInput){0})) {
        snprintf(detail, sizeof(detail), "%s", nova_error(candidate)); goto done;
    }
    nova_destroy(*engine);
    nova_unload_resources(resources);
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
        snprintf(error, error_size, "%.300s: %.700s", path, detail);
        TraceLog(LOG_ERROR, "NOVA: %s", error);
    }
    return success;
}
