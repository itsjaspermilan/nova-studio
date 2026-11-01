#include "model.h"
#include "assets.h"
#include "document.h"
#include "presentation.h"

#include <math.h>
#include <float.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s (%s)\n", __FILE__, __LINE__, #c, error); exit(1); } } while (0)
static char error[1024];

static void free_cpu(Model model)
{
    for (int i = 0; i < model.meshCount; ++i) {
        MemFree(model.meshes[i].vertices); MemFree(model.meshes[i].colors);
    }
    MemFree(model.meshes); MemFree(model.materials); MemFree(model.meshMaterial);
}

static void reject(const char *text)
{
    NovaModelDocument d, before;
    nova_model_init(&d);
    CHECK(nova_model_add(&d, NOVA_SHAPE_BOX, error, sizeof(error)));
    before = d;
    CHECK(!nova_model_parse((const unsigned char *)text, strlen(text), &d, error, sizeof(error)));
    CHECK(*error && !memcmp(&d, &before, sizeof(d)));
}

static void documents(void)
{
    NovaModelDocument d, parsed;
    nova_model_init(&d);
    CHECK(nova_model_add(&d, NOVA_SHAPE_BOX, error, sizeof(error)));
    CHECK(nova_model_add(&d, NOVA_SHAPE_PYRAMID, error, sizeof(error)));
    CHECK(nova_model_add(&d, NOVA_SHAPE_CYLINDER, error, sizeof(error)));
    d.primitives[0].position[0] = -12.125f;
    d.primitives[0].position[1] = FLT_TRUE_MIN;
    d.primitives[1].rotation[2] = 73.625f;
    d.primitives[2].scale[1] = 0.01f;
    d.primitives[2].sides = 32;
    unsigned char *bytes = NULL;
    size_t length = 0;
    CHECK(nova_model_serialize(&d, &bytes, &length, error, sizeof(error)));
    CHECK(nova_model_parse(bytes, length, &parsed, error, sizeof(error)));
    CHECK(!memcmp(&d, &parsed, sizeof(d)));
    free(bytes);
    reject("nova-model 2\nnext 1\n");
    reject("nova-model 1\n");
    reject("nova-model 1\nnext 0\n");
    reject("nova-model 1\nnext 4294967296\n");
    reject("nova-model 1\nnext 2\nprimitive 1 sphere 0 0 0 0 0 0 0 1 1 1 255 0 0\n");
    reject("nova-model 1\nnext 2\nprimitive 1 box 0 nan 0 0 0 0 0 1 1 1 255 0 0\n");
    reject("nova-model 1\nnext 2\nprimitive 1 box 0 0x1 0 0 0 0 0 1 1 1 255 0 0\n");
    reject("nova-model 1\nnext 2\nprimitive 1 box 0 0 0 0 0 0 0 0 1 1 255 0 0\n");
    reject("nova-model 1\nnext 2\nprimitive 1 cylinder 33 0 0 0 0 0 0 1 1 1 255 0 0\n");
    reject("nova-model 1\nnext 2\nprimitive 1 box 0 0 0 0 0 0 0 1 1 1 256 0 0\n");
    reject("nova-model 1\nnext 2\nprimitive 2 box 0 0 0 0 0 0 0 1 1 1 255 0 0\n");
    reject("nova-model 1\nnext 2\nprimitive 1 box 0 0 0 0 0 0 0 1 1 1 255 0 0 extra\n");
    reject("nova-model 1\nnext 2\nprimitive 1 box 0 0 0 0 0 0 0 1 1 1 255 0 0\n"
        "primitive 1 box 0 0 0 0 0 0 0 1 1 1 255 0 0\n");
    reject("nova-model 1\nnext 1\nscript do_something\n");
    nova_model_init(&d);
    CHECK(!nova_model_glb(&d, &bytes, &length, error, sizeof(error)));
    for (int i = 0; i < NOVA_MODEL_PRIMITIVES; ++i)
        CHECK(nova_model_add(&d, NOVA_SHAPE_BOX, error, sizeof(error)));
    CHECK(!nova_model_add(&d, NOVA_SHAPE_BOX, error, sizeof(error)));
    d.primitives[0].position[0] = INFINITY;
    CHECK(!nova_model_validate(&d, error, sizeof(error)));
    d.primitives[0].position[0] = 10001;
    CHECK(!nova_model_validate(&d, error, sizeof(error)));
    d.primitives[0].position[0] = 0;
    d.primitives[0].rotation[0] = 361;
    CHECK(!nova_model_validate(&d, error, sizeof(error)));
    d.primitives[0].rotation[0] = 0;
    d.primitives[0].scale[0] = 1001;
    CHECK(!nova_model_validate(&d, error, sizeof(error)));
}

static void outward(const Mesh *mesh)
{
    for (int i = 0; i < mesh->vertexCount; i += 3) {
        const float *a = mesh->vertices + i*3, *b = a + 3, *c = b + 3;
        float u[3], v[3], center[3];
        for (int k = 0; k < 3; ++k) { u[k] = b[k]-a[k]; v[k] = c[k]-a[k]; center[k] = (a[k]+b[k]+c[k])/3; }
        float n[3] = {u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]};
        CHECK(n[0]*center[0] + n[1]*center[1] + n[2]*center[2] > 0);
    }
}

static void geometry_roundtrip(void)
{
    NovaModelDocument d;
    nova_model_init(&d);
    for (int shape = NOVA_SHAPE_BOX; shape <= NOVA_SHAPE_CYLINDER; ++shape)
        CHECK(nova_model_add(&d, (NovaModelShape)shape, error, sizeof(error)));
    unsigned char *bytes;
    size_t length;
    CHECK(nova_model_glb(&d, &bytes, &length, error, sizeof(error)));
    Model model;
    CHECK(nova_decode_glb(bytes, (int)length, &model, error, sizeof(error)));
    CHECK(model.meshCount == 3);
    CHECK(model.meshes[0].vertexCount == 36 && model.meshes[1].vertexCount == 18 && model.meshes[2].vertexCount == 96);
    for (int i = 0; i < 3; ++i) {
        outward(&model.meshes[i]);
        for (int k = 0; k < model.meshes[i].vertexCount; ++k) {
            CHECK(model.meshes[i].colors[k*4+3] == 255);
            for (int a = 0; a < 3; ++a) {
                CHECK(fabsf(model.meshes[i].vertices[k*3+a]) <= .500001f);
                CHECK(model.meshes[i].colors[k*4+a] == d.primitives[i].color[a]);
            }
        }
    }
    free_cpu(model); free(bytes);
    for (unsigned c = 0; c <= 255; ++c) {
        d.count = 1;
        memset(d.primitives[0].color, (int)c, 3);
        CHECK(nova_model_glb(&d, &bytes, &length, error, sizeof(error)));
        CHECK(nova_decode_glb(bytes, (int)length, &model, error, sizeof(error)));
        CHECK(model.meshes[0].colors[0] == c && model.meshes[0].colors[1] == c && model.meshes[0].colors[2] == c);
        free_cpu(model); free(bytes);
    }
    d.count = 3;
    d.primitives[0].position[0] = 3;
    d.primitives[0].position[1] = 2;
    d.primitives[0].scale[0] = 2;
    d.primitives[0].scale[1] = 4;
    d.primitives[0].rotation[2] = 90;
    CHECK(nova_model_glb(&d, &bytes, &length, error, sizeof(error)));
    CHECK(nova_decode_glb(bytes, (int)length, &model, error, sizeof(error)));
    float min[3] = {100,100,100}, max[3] = {-100,-100,-100};
    for (int i = 0; i < model.meshes[0].vertexCount; ++i)
        for (int a = 0; a < 3; ++a) {
            float v = model.meshes[0].vertices[i*3+a];
            if (v < min[a]) min[a] = v;
            if (v > max[a]) max[a] = v;
        }
    CHECK(fabsf(min[0]-1) < .00001f && fabsf(max[0]-5) < .00001f);
    CHECK(fabsf(min[1]-1) < .00001f && fabsf(max[1]-3) < .00001f);
    free_cpu(model); free(bytes);
    nova_model_init(&d);
    for (int i = 0; i < NOVA_MODEL_PRIMITIVES; ++i) {
        CHECK(nova_model_add(&d, NOVA_SHAPE_CYLINDER, error, sizeof(error)));
        d.primitives[i].sides = NOVA_MODEL_SIDES;
    }
    CHECK(nova_model_glb(&d, &bytes, &length, error, sizeof(error)));
    CHECK(length < NOVA_MODEL_GLB_BYTES);
    CHECK(nova_decode_glb(bytes, (int)length, &model, error, sizeof(error)));
    CHECK(model.meshCount == 64 && model.meshes[63].vertexCount == 384);
    free_cpu(model); free(bytes);
}

static void write_fixture(const char *path, const void *bytes, size_t length)
{
    FILE *file = fopen(path, "wb");
    CHECK(file && fwrite(bytes, 1, length, file) == length && !fclose(file));
}

static void project_roundtrip(void)
{
    char directory[] = "/tmp/nova-model-test-XXXXXX", glb[256], manifest[256], lua[256];
    CHECK(mkdtemp(directory));
    snprintf(glb, sizeof(glb), "%s/model.glb", directory);
    snprintf(manifest, sizeof(manifest), "%s/nova.project", directory);
    snprintf(lua, sizeof(lua), "%s/main.lua", directory);
    const char *project = "nova-project 1\nentry main.lua\nmodel authored model.glb\n";
    const char *script = "nova.scene('3d')\nlocal m=nova.asset('authored')\nfunction update(dt,input) nova.model(m,0,0,0,1) end\n";
    write_fixture(manifest, project, strlen(project)); write_fixture(lua, script, strlen(script));
    NovaModelDocument d;
    nova_model_init(&d);
    CHECK(nova_model_add(&d, NOVA_SHAPE_PYRAMID, error, sizeof(error)));
    d.primitives[0].position[0] = 2;
    unsigned char *bytes;
    size_t length;
    CHECK(nova_model_glb(&d, &bytes, &length, error, sizeof(error)));
    write_fixture(glb, bytes, length); free(bytes);
    NovaProjectValidation validation;
    CHECK(nova_validate_project(manifest, &validation, error, sizeof(error)));
    CHECK(validation.assets[0].primitives == 1 && validation.assets[0].vertices == 18);
    CHECK(validation.assets[0].bounds_min.x == 1.5f && validation.assets[0].bounds_max.x == 2.5f);
    CHECK(!unlink(glb) && !unlink(lua) && !unlink(manifest) && !rmdir(directory));
}

static void guarded_outputs(void)
{
    char directory[] = "/tmp/nova-model-save-XXXXXX", source[256], glb[256];
    CHECK(mkdtemp(directory));
    snprintf(source, sizeof(source), "%s/authored.nova-model", directory);
    snprintf(glb, sizeof(glb), "%s/model.glb", directory);
    NovaModelDocument d;
    nova_model_init(&d);
    CHECK(nova_model_add(&d, NOVA_SHAPE_CYLINDER, error, sizeof(error)));
    unsigned char *bytes;
    size_t length;
    NovaDocument draft = {0}, output = {0};
    CHECK(nova_document_open_output(&draft, directory, "authored.nova-model",
        NOVA_MODEL_DOCUMENT_BYTES, false, error, sizeof(error)));
    CHECK(nova_model_serialize(&d, &bytes, &length, error, sizeof(error)));
    CHECK(nova_document_replace(&draft, 0, draft.length, (char *)bytes, length, error, sizeof(error)));
    free(bytes);
    CHECK(nova_document_save(&draft, false, error, sizeof(error)));
    nova_document_close(&draft);
    CHECK(nova_document_open(&draft, directory, "authored.nova-model",
        NOVA_MODEL_DOCUMENT_BYTES, error, sizeof(error)));
    NovaModelDocument reopened;
    CHECK(nova_model_parse((unsigned char *)draft.text, draft.length, &reopened, error, sizeof(error)));
    CHECK(!memcmp(&d, &reopened, sizeof(d)));
    CHECK(nova_document_open_output(&output, directory, "model.glb",
        NOVA_MODEL_GLB_BYTES, true, error, sizeof(error)));
    CHECK(nova_model_glb(&d, &bytes, &length, error, sizeof(error)));
    CHECK(nova_document_replace(&output, 0, output.length, (char *)bytes, length, error, sizeof(error)));
    free(bytes);
    CHECK(nova_document_save(&output, false, error, sizeof(error)));
    unsigned char external[] = "external user bytes";
    write_fixture(glb, external, sizeof(external));
    CHECK(!nova_document_save(&output, false, error, sizeof(error)));
    CHECK(output.has_conflict && output.conflict.length == sizeof(external));
    CHECK(!memcmp(output.conflict.text, external, sizeof(external)));
    int disk_length;
    unsigned char *disk = nova_read_file(glb, NOVA_MODEL_GLB_BYTES, &disk_length, error, sizeof(error));
    CHECK(disk && disk_length == (int)sizeof(external) && !memcmp(disk, external, sizeof(external)));
    free(disk);
    write_fixture(glb, "another edit", 12);
    CHECK(!nova_document_save(&output, true, error, sizeof(error)));
    CHECK(output.has_conflict && output.conflict.length == 12);
    CHECK(nova_document_save(&output, true, error, sizeof(error)));
    disk = nova_read_file(glb, NOVA_MODEL_GLB_BYTES, &disk_length, error, sizeof(error));
    Model imported;
    CHECK(disk && nova_decode_glb(disk, disk_length, &imported, error, sizeof(error)));
    CHECK(imported.meshCount == 1 && imported.meshes[0].vertexCount == 96);
    free_cpu(imported); free(disk);
    nova_document_close(&draft); nova_document_close(&output);
    CHECK(!unlink(source) && !unlink(glb) && !rmdir(directory));
}

static void gpu_roundtrip(void)
{
    char directory[] = "/tmp/nova-model-gpu-XXXXXX", glb[256], manifest[256], lua[256];
    CHECK(mkdtemp(directory));
    snprintf(glb, sizeof(glb), "%s/model.glb", directory);
    snprintf(manifest, sizeof(manifest), "%s/nova.project", directory);
    snprintf(lua, sizeof(lua), "%s/main.lua", directory);
    const char *project = "nova-project 1\nentry main.lua\nmodel authored model.glb\n";
    const char *script = "nova.scene('3d')\nlocal m=nova.asset('authored')\nfunction update(dt,input)\n"
        "nova.background(18,24,41)\nnova.camera(0,0,8,0,0,0,45)\nnova.model(m,0,0,0,1)\nend\n";
    write_fixture(manifest, project, strlen(project)); write_fixture(lua, script, strlen(script));
    NovaModelDocument d;
    nova_model_init(&d);
    for (int shape = NOVA_SHAPE_BOX; shape <= NOVA_SHAPE_CYLINDER; ++shape) {
        CHECK(nova_model_add(&d, (NovaModelShape)shape, error, sizeof(error)));
        d.primitives[shape].position[0] = (float)(shape - 1) * 2;
        memset(d.primitives[shape].color, 0, 3);
        d.primitives[shape].color[shape] = 255;
    }
    d.primitives[1].rotation[1] = 30;
    d.primitives[2].scale[1] = 1.5f;
    unsigned char *bytes;
    size_t length;
    CHECK(nova_model_glb(&d, &bytes, &length, error, sizeof(error)));
    write_fixture(glb, bytes, length); free(bytes);
    SetConfigFlags(FLAG_WINDOW_HIGHDPI);
    InitWindow(960, 540, "Nova original model GPU round-trip");
    CHECK(IsWindowReady());
    NovaEngine *engine = NULL;
    NovaResources resources = {0};
    NovaPresentation presentation = {0};
    CHECK(nova_open_scene(&engine, &resources, manifest, true, error, sizeof(error)));
    CHECK(nova_presentation_configure(&presentation, (NovaWorldResolution){960,540}, error, sizeof(error)));
    NovaSceneInspection inspection = nova_inspect_scene(engine, &resources);
    CHECK(inspection.assets[0].primitives == 3 && inspection.assets[0].vertices == 150);
    nova_presentation_world(&presentation, inspection.frame, &resources);
    RenderTexture2D capture = {0};
    CHECK(nova_capture_target(&capture, error, sizeof(error)));
    BeginTextureMode(capture);
    NovaCanvasState canvas = nova_begin_canvas(960, 540);
    ClearBackground(BLACK);
    nova_presentation_composite(&presentation, inspection.frame, &resources, nova_viewport(960,540,false));
    nova_end_canvas(canvas);
    EndTextureMode();
    CHECK(nova_capture_export(capture.texture, NOVA_TEST_DIRECTORY "/model-roundtrip.png"));
    Image image = LoadImage(NOVA_TEST_DIRECTORY "/model-roundtrip.png");
    CHECK(IsImageValid(image) && image.width == 960 && image.height == 540);
    int colors[3] = {0}, min_y[3] = {540,540,540}, max_y[3] = {0};
    for (int y = 0; y < 540; ++y) for (int x = 0; x < 960; ++x) {
        Color c = GetImageColor(image,x,y);
        for (int a = 0; a < 3; ++a) {
            unsigned char rgb[3] = {c.r,c.g,c.b};
            if (rgb[a] == 255 && !rgb[(a+1)%3] && !rgb[(a+2)%3]) {
                ++colors[a];
                if (y < min_y[a]) min_y[a] = y;
                if (y > max_y[a]) max_y[a] = y;
                CHECK(x > a*155 + 240 && x < a*180 + 400);
            }
        }
    }
    CHECK(colors[0] > 5000 && colors[1] > 1500 && colors[2] > 7000);
    CHECK(max_y[2]-min_y[2] > max_y[0]-min_y[0] + 20);
    CHECK(GetImageColor(image,10,10).r == 18);
    UnloadImage(image);
    unsigned vao = resources.resources[0].model.meshes[0].vaoId;
    write_fixture(glb, "broken", 6);
    CHECK(!nova_open_scene(&engine, &resources, manifest, true, error, sizeof(error)));
    CHECK(resources.resources[0].model.meshes[0].vaoId == vao);
    CHECK(nova_inspect_scene(engine, &resources).assets[0].primitives == 3);
    UnloadRenderTexture(capture);
    nova_presentation_destroy(&presentation);
    nova_unload_resources(&resources);
    nova_destroy(engine);
    CloseWindow();
    CHECK(!unlink(glb) && !unlink(lua) && !unlink(manifest) && !rmdir(directory));
    printf("native model GPU RGB pixels=%d,%d,%d; scaled cylinder height=%d; failed staging retained VAO\n",
        colors[0],colors[1],colors[2],max_y[2]-min_y[2]);
}

int main(int argc, char **argv)
{
    SetTraceLogLevel(LOG_WARNING);
    if (argc == 2 && !strcmp(argv[1], "--gpu")) { gpu_roundtrip(); return 0; }
    if (argc != 1) return 2;
    documents(); geometry_roundtrip(); project_roundtrip(); guarded_outputs();
    puts("model document, outward geometry, transformed/color GLB and native project round-trip passed");
    return 0;
}
