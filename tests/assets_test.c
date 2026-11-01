#include "assets.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #c); exit(1); } } while (0)

static unsigned int little(const unsigned char *p)
{
    return (unsigned int)p[0] | ((unsigned int)p[1] << 8) |
        ((unsigned int)p[2] << 16) | ((unsigned int)p[3] << 24);
}

static void put(unsigned char *p, unsigned int value)
{
    for (int i = 0; i < 4; ++i) p[i] = (unsigned char)(value >> (8 * i));
}

static void free_cpu(Model model)
{
    for (int i = 0; i < model.meshCount; ++i) {
        MemFree(model.meshes[i].vertices);
        MemFree(model.meshes[i].colors);
    }
    MemFree(model.meshes);
    MemFree(model.materials);
    MemFree(model.meshMaterial);
}

static unsigned char *variant(const unsigned char *source, int length, const char *old,
    const char *replacement, int *new_length)
{
    size_t json_length = little(source + 12);
    char *text = malloc(json_length + 1);
    CHECK(text);
    memcpy(text, source + 20, json_length);
    text[json_length] = '\0';
    char *match = strstr(text, old);
    CHECK(match);
    size_t prefix = (size_t)(match - text);
    size_t replaced = json_length - strlen(old) + strlen(replacement);
    size_t padded = (replaced + 3) & ~(size_t)3;
    size_t tail = (size_t)length - 20 - json_length;
    *new_length = (int)(20 + padded + tail);
    unsigned char *bytes = malloc((size_t)*new_length);
    CHECK(bytes);
    memcpy(bytes, source, 20);
    put(bytes + 8, (unsigned int)*new_length);
    put(bytes + 12, (unsigned int)padded);
    memset(bytes + 20, ' ', padded);
    memcpy(bytes + 20, text, prefix);
    memcpy(bytes + 20 + prefix, replacement, strlen(replacement));
    memcpy(bytes + 20 + prefix + strlen(replacement), match + strlen(old),
        json_length - prefix - strlen(old));
    memcpy(bytes + 20 + padded, source + 20 + json_length, tail);
    free(text);
    return bytes;
}

static void reject_variant(const unsigned char *source, int length, const char *old, const char *replacement)
{
    int changed_length;
    unsigned char *changed = variant(source, length, old, replacement, &changed_length);
    char error[1024];
    Model model = {0};
    CHECK(!nova_decode_glb(changed, changed_length, &model, error, sizeof(error)));
    CHECK(*error && !model.meshes && !model.materials && model.meshCount == 0);
    free(changed);
}

static void copy_fixture(const char *source, const char *destination)
{
    int length;
    unsigned char *bytes = LoadFileData(source, &length);
    CHECK(bytes && SaveFileData(destination, bytes, length));
    UnloadFileData(bytes);
}

static void wide_indices(void)
{
    const unsigned int vertex_count = 70000, vertex_bytes = vertex_count * 12;
    char json[1024];
    int json_size = snprintf(json, sizeof(json),
        "{\"asset\":{\"version\":\"2.0\"},\"buffers\":[{\"byteLength\":%u}],"
        "\"bufferViews\":[{\"buffer\":0,\"byteLength\":%u},{\"buffer\":0,\"byteOffset\":%u,\"byteLength\":12}],"
        "\"accessors\":[{\"bufferView\":0,\"componentType\":5126,\"count\":%u,\"type\":\"VEC3\"},"
        "{\"bufferView\":1,\"componentType\":5125,\"count\":3,\"type\":\"SCALAR\"}],"
        "\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1}]}],"
        "\"nodes\":[{\"mesh\":0}],\"scenes\":[{\"nodes\":[0]}],\"scene\":0}",
        vertex_bytes + 12, vertex_bytes, vertex_bytes, vertex_count);
    CHECK(json_size > 0 && (size_t)json_size < sizeof(json));
    unsigned int padded = ((unsigned int)json_size + 3) & ~3u;
    unsigned int length = 20 + padded + 8 + vertex_bytes + 12;
    unsigned char *bytes = calloc(length, 1);
    CHECK(bytes);
    memcpy(bytes, "glTF", 4);
    put(bytes + 4, 2); put(bytes + 8, length); put(bytes + 12, padded);
    memcpy(bytes + 16, "JSON", 4);
    memset(bytes + 20, ' ', padded);
    memcpy(bytes + 20, json, (size_t)json_size);
    put(bytes + 20 + padded, vertex_bytes + 12);
    memcpy(bytes + 24 + padded, "BIN", 3);
    unsigned char *binary = bytes + 28 + padded;
    float last[] = {1, 2, 3};
    memcpy(binary + (vertex_count - 1) * 12, last, sizeof(last));
    put(binary + vertex_bytes, vertex_count - 1);
    put(binary + vertex_bytes + 4, 0);
    put(binary + vertex_bytes + 8, 1);
    Model model;
    char error[1024];
    CHECK(nova_decode_glb(bytes, (int)length, &model, error, sizeof(error)));
    CHECK(model.meshes[0].vertexCount == 3 && model.meshes[0].vertices[0] == 1 &&
        model.meshes[0].vertices[1] == 2 && model.meshes[0].vertices[2] == 3);
    free_cpu(model);
    put(binary + vertex_bytes, vertex_count);
    CHECK(!nova_decode_glb(bytes, (int)length, &model, error, sizeof(error)));
    free(bytes);
}

static void partial_failure(NovaEngine **engine, NovaResources *resources)
{
    char directory[] = NOVA_TEST_DIRECTORY "/asset-reload.XXXXXX";
    CHECK(mkdtemp(directory));
    char manifest[NOVA_NATIVE_PATH_CAPACITY], script[NOVA_NATIVE_PATH_CAPACITY];
    char sprite[NOVA_NATIVE_PATH_CAPACITY], model[NOVA_NATIVE_PATH_CAPACITY], error[1024];
    snprintf(manifest, sizeof(manifest), "%s/nova.project", directory);
    snprintf(script, sizeof(script), "%s/main.lua", directory);
    snprintf(sprite, sizeof(sprite), "%s/badge.png", directory);
    snprintf(model, sizeof(model), "%s/gem.glb", directory);
    char declarations[] = "nova-project 1\nentry main.lua\nsprite badge badge.png\n"
        "sprite alias badge.png\nmodel gem gem.glb\n";
    char failed[] = "function update() error('reload rejected') end";
    CHECK(SaveFileText(manifest, declarations) && SaveFileText(script, failed));
    copy_fixture(NOVA_EXAMPLES "/assets/assets/badge.png", sprite);
    copy_fixture(NOVA_EXAMPLES "/assets/assets/badge.png", model);
    NovaEngine *retained = *engine;
    unsigned int texture = resources->resources[0].texture.id;
    CHECK(!nova_open_scene(engine, resources, manifest, true, error, sizeof(error)));
    CHECK(strstr(error, "asset 'gem'") && *engine == retained &&
        resources->resources[0].texture.id == texture);
    copy_fixture(NOVA_EXAMPLES "/assets/assets/gem.glb", model);
    CHECK(!nova_open_scene(engine, resources, manifest, true, error, sizeof(error)));
    CHECK(strstr(error, "reload rejected") && *engine == retained &&
        resources->resources[0].texture.id == texture);
    CHECK(nova_tick(*engine, 0, (NovaInput){0}));
    char valid[] = "local badge=nova.asset('alias'); function update() nova.sprite(badge,0,0,32,32) end";
    CHECK(SaveFileText(script, valid));
    CHECK(nova_open_scene(engine, resources, manifest, true, error, sizeof(error)));
    CHECK(*engine != retained && resources->count == 3 &&
        resources->resources[0].texture.id == resources->resources[1].texture.id &&
        resources->resources[0].owned && !resources->resources[1].owned &&
        resources->resources[0].texture.id != texture);
    CHECK(unlink(manifest) == 0 && unlink(script) == 0 && unlink(sprite) == 0 &&
        unlink(model) == 0 && rmdir(directory) == 0);
}

int main(int argc, char **argv)
{
    bool gpu = argc == 2 && !strcmp(argv[1], "--gpu");
    char error[1024], root[NOVA_NATIVE_PATH_CAPACITY], path[NOVA_NATIVE_PATH_CAPACITY];
    CHECK(nova_project_root(NOVA_EXAMPLES "/assets/nova.project", root, error, sizeof(error)));
    CHECK(nova_project_resolve(root, "main.lua", path, error, sizeof(error)));
    CHECK(!nova_project_resolve(root, "../mixed/main.lua", path, error, sizeof(error)));
    CHECK(!nova_project_resolve(root, "missing.lua", path, error, sizeof(error)));
    CHECK(!nova_project_resolve(root, "assets", path, error, sizeof(error)));
    char temp[] = NOVA_TEST_DIRECTORY "/asset-path.XXXXXX";
    CHECK(mkdtemp(temp));
    char link[NOVA_NATIVE_PATH_CAPACITY];
    snprintf(link, sizeof(link), "%s/outside.lua", temp);
    CHECK(symlink(NOVA_EXAMPLES "/mixed/main.lua", link) == 0);
    CHECK(!nova_project_resolve(temp, "outside.lua", path, error, sizeof(error)));
    CHECK(strstr(error, "escapes root"));
    CHECK(unlink(link) == 0 && rmdir(temp) == 0);
    int length;
    unsigned char *sprite = nova_read_file(NOVA_EXAMPLES "/assets/assets/badge.png",
        NOVA_ASSET_FILE_LIMIT, &length, error, sizeof(error));
    CHECK(sprite);
    Image image;
    CHECK(nova_decode_sprite(sprite, length, &image, error, sizeof(error)));
    CHECK(image.width == 32 && image.height == 32 && image.data);
    UnloadImage(image);
    unsigned char saved = sprite[25];
    sprite[25] = 3;
    CHECK(!nova_decode_sprite(sprite, length, &image, error, sizeof(error)));
    sprite[25] = saved;
    CHECK(!nova_decode_sprite(sprite, 20, &image, error, sizeof(error)));
    sprite[16] = 1;
    CHECK(!nova_decode_sprite(sprite, length, &image, error, sizeof(error)));
    UnloadFileData(sprite);
    unsigned char *bytes = nova_read_file(NOVA_EXAMPLES "/assets/assets/gem.glb",
        NOVA_ASSET_FILE_LIMIT, &length, error, sizeof(error));
    CHECK(bytes);
    Model model;
    CHECK(nova_decode_glb(bytes, length, &model, error, sizeof(error)));
    CHECK(model.meshCount == 1 && model.meshes[0].vertexCount == 24);
    float min_y = 100, max_y = -100;
    for (int i = 0; i < model.meshes[0].vertexCount; ++i) {
        min_y = fminf(min_y, model.meshes[0].vertices[i * 3 + 1]);
        max_y = fmaxf(max_y, model.meshes[0].vertices[i * 3 + 1]);
    }
    CHECK(fabsf(min_y + 0.25f) < 0.001f && fabsf(max_y - 2.25f) < 0.001f);
    CHECK(model.meshes[0].colors[0] == 77 && model.meshes[0].colors[1] == 224);
    free_cpu(model);
    int changed_length;
    unsigned char *mirrored = variant(bytes, length, "\"scale\":[1,1.25,1]", "\"scale\":[-1,1.25,1]", &changed_length);
    CHECK(nova_decode_glb(mirrored, changed_length, &model, error, sizeof(error)));
    CHECK(model.meshes[0].vertices[3] == -0.75f && model.meshes[0].vertices[6] == 0.25f);
    free_cpu(model);
    free(mirrored);
    wide_indices();
    reject_variant(bytes, length, "\"byteLength\":168", "\"byteLength\":168,\"uri\":\"../../escape.bin\"");
    reject_variant(bytes, length, "\"KHR_materials_unlit\"", "\"KHR_materials_unknown\"");
    reject_variant(bytes, length, "\"mode\":4", "\"mode\":1");
    reject_variant(bytes, length, "\"count\":6", "\"count\":0");
    reject_variant(bytes, length, "\"byteOffset\":72", "\"byteOffset\":999999999999");
    reject_variant(bytes, length, "\"scale\":[1,1.25,1]", "\"scale\":[1e99,1,1]");
    reject_variant(bytes, length, "\"children\":[1]", "\"children\":[0]");
    reject_variant(bytes, length, "\"material\":0", "\"material\":0,\"targets\":[{\"POSITION\":0}]");
    reject_variant(bytes, length, "\"extensions\":{\"KHR_materials_unlit\":{}}", "\"doubleSided\":true");
    reject_variant(bytes, length, "\"scene\":0", "\"scene\":0,\"animations\":[{\"channels\":[],\"samplers\":[]}]");
    CHECK(!nova_decode_glb(bytes, length - 1, &model, error, sizeof(error)));
    unsigned int bin_offset = 20 + little(bytes + 12) + 8;
    put(bytes + bin_offset + 72, 100000);
    CHECK(!nova_decode_glb(bytes, length, &model, error, sizeof(error)));
    UnloadFileData(bytes);
    if (gpu) {
        InitWindow(NOVA_WIDTH, NOVA_HEIGHT, "Nova asset lifetime check");
        CHECK(IsWindowReady());
        NovaEngine *engine = nova_create();
        NovaResources resources = {0};
        for (int i = 0; i < 4; ++i) {
            CHECK(nova_open_scene(&engine, &resources, NOVA_EXAMPLES "/assets/nova.project", true, error, sizeof(error)));
            CHECK(resources.count == 2 && IsTextureValid(resources.resources[0].texture) &&
                IsModelValid(resources.resources[1].model));
            unsigned int texture = resources.resources[0].texture.id;
            NovaEngine *retained = engine;
            CHECK(!nova_open_scene(&engine, &resources, NOVA_EXAMPLES "/assets/missing.project", true, error, sizeof(error)));
            CHECK(engine == retained && resources.count == 2 && resources.resources[0].texture.id == texture);
            CHECK(nova_tick(engine, 0.01, (NovaInput){0}));
            if (i == 0) partial_failure(&engine, &resources);
            CHECK(nova_open_scene(&engine, &resources, NOVA_EXAMPLES "/2d/main.lua", false, error, sizeof(error)));
            CHECK(resources.count == 0 && nova_frame(engine)->mode == NOVA_2D);
        }
        nova_unload_resources(&resources);
        nova_unload_resources(&resources);
        nova_destroy(engine);
        CloseWindow();
    }
    puts("Nova native asset paths, import subset, transforms and resources passed.");
    return 0;
}
