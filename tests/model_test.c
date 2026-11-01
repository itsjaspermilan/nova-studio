#include "model.h"
#include "assets.h"

#include <math.h>
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

int main(void)
{
    SetTraceLogLevel(LOG_WARNING);
    documents(); geometry_roundtrip(); project_roundtrip();
    puts("model document, outward geometry, transformed/color GLB and native project round-trip passed");
    return 0;
}
