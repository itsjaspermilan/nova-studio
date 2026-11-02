#include "model.h"
#include "document.h"
#include "presentation.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static char error[1024];
#define CHECK(x) do { if (!(x)) { fprintf(stderr,"%d: %s: %s\n",__LINE__,#x,error); exit(1); } } while (0)

#ifdef NOVA_TEXTURE_LIFETIME_TEST
#undef LoadTextureFromImage
#undef UnloadTexture
extern Texture2D LoadTextureFromImage(Image image);
extern void UnloadTexture(Texture2D texture);
static unsigned uploads, releases, attempts, fail_upload, live[32];
Texture2D nova_test_load_texture(Image image)
{
    if (++attempts == fail_upload) return (Texture2D){0};
    Texture2D texture = LoadTextureFromImage(image);
    CHECK(texture.id);
    size_t i = 0;
    while (i < 32 && live[i]) ++i;
    CHECK(i < 32); live[i] = texture.id; ++uploads;
    return texture;
}
void nova_test_unload_texture(Texture2D texture)
{
    size_t i = 0;
    while (i < 32 && live[i] != texture.id) ++i;
    CHECK(i < 32 && texture.id); live[i] = 0; ++releases;
    UnloadTexture(texture);
}
#endif

static void write_file(const char *root, const char *path, const void *bytes, size_t length)
{
    NovaDocument d = {0};
    CHECK(nova_document_open_output(&d,root,path,NOVA_MODEL_GLB_BYTES,true,error,sizeof(error)));
    CHECK(nova_document_replace(&d,0,d.length,bytes,length,error,sizeof(error)));
    CHECK(nova_document_save(&d,false,error,sizeof(error)));
    nova_document_close(&d);
}

static uint32_t get32(const unsigned char *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1]<<8) | ((uint32_t)p[2]<<16) | ((uint32_t)p[3]<<24);
}

static void put32(unsigned char *p, uint32_t n)
{
    for (unsigned i = 0; i < 4; ++i) p[i] = (unsigned char)(n>>(8*i));
}

static unsigned char *replace_json(const unsigned char *bytes, size_t length, const char *needle,
    const char *replacement, size_t *result_length)
{
    size_t json_size = get32(bytes+12);
    char *json = calloc(json_size+1,1);
    CHECK(json); memcpy(json,bytes+20,json_size);
    char *found = strstr(json,needle);
    CHECK(found);
    size_t before = (size_t)(found-json), after = json_size-before-strlen(needle);
    size_t size = (before+strlen(replacement)+after+3)&~(size_t)3;
    size_t total = length-json_size+size;
    unsigned char *bad = calloc(total,1);
    CHECK(bad);
    memcpy(bad,bytes,20); put32(bad+8,(uint32_t)total); put32(bad+12,(uint32_t)size);
    memset(bad+20,' ',size); memcpy(bad+20,json,before);
    memcpy(bad+20+before,replacement,strlen(replacement));
    memcpy(bad+20+before+strlen(replacement),found+strlen(needle),after);
    memcpy(bad+20+size,bytes+20+json_size,length-20-json_size);
    free(json); *result_length = total;
    return bad;
}

static void bad_json(const unsigned char *bytes, size_t length, const char *needle, const char *replacement)
{
    size_t total;
    unsigned char *bad = replace_json(bytes,length,needle,replacement,&total);
    Model model; NovaModelImages images;
    CHECK(!nova_decode_glb_images(bad,(int)total,&model,&images,error,sizeof(error)));
    CHECK(!model.meshCount && !images.count && *error);
    free(bad);
}

static void uv_correspondence(const unsigned char *bytes, size_t length)
{
    Model original; NovaModelImages original_images;
    CHECK(nova_decode_glb_images(bytes,(int)length,&original,&original_images,error,sizeof(error)));
    /* Each node has a different primitive, including each primitive's final triangle. */
    for (int i = 0; i < original.meshCount; ++i) {
        const Mesh *mesh = &original.meshes[i];
        for (int v = 0; v < mesh->vertexCount; ++v) {
            CHECK(mesh->texcoords[v*2] >= 0 && mesh->texcoords[v*2] <= 1);
            CHECK(mesh->texcoords[v*2+1] >= 0 && mesh->texcoords[v*2+1] <= 1);
        }
    }
    /* All twelve triangles of the untransformed box retain object-axis UVs. */
    const Mesh *box = &original.meshes[0];
    for (int t = 0; t < box->triangleCount; ++t) {
        const float *a = box->vertices+t*9, *b = a+3, *c = b+3;
        float u[3], v[3]; for (int i = 0; i < 3; ++i) { u[i] = b[i]-a[i]; v[i] = c[i]-a[i]; }
        float n[3] = {u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]};
        int axis = fabsf(n[0]) > fabsf(n[1]) ? 0 : 1;
        if (fabsf(n[2]) > fabsf(n[axis])) axis = 2;
        for (int k = 0; k < 3; ++k) {
            const float *point = a+k*3, *uv = box->texcoords+(t*3+k)*2;
            CHECK(uv[0] == point[axis == 0 ? 2 : 0]+.5f);
            CHECK(uv[1] == (axis == 1 ? point[2]+.5f : .5f-point[1]));
        }
    }
    for (int mirrored = 0; mirrored < 2; ++mirrored) {
        /* Node alias references mesh 0. Reflection must reorder positions AND UVs together. */
        size_t changed_length;
        unsigned char *changed = replace_json(bytes,length,"\"mesh\":1",
            mirrored ? "\"mesh\":0,\"scale\":[-1,1,1]" : "\"mesh\":0",&changed_length);
        Model decoded; NovaModelImages images;
        CHECK(nova_decode_glb_images(changed,(int)changed_length,&decoded,&images,error,sizeof(error)));
        CHECK(decoded.meshCount == 3 && images.count == original_images.count &&
            images.material_image[0] == images.material_image[1]);
        const Mesh *alias = &decoded.meshes[1];
        CHECK(alias->vertexCount == box->vertexCount);
        for (int t = 0; t < box->triangleCount; ++t) for (int k = 0; k < 3; ++k) {
            int from = t*3+(mirrored && k ? 3-k : k), to = t*3+k;
            for (int axis = 0; axis < 3; ++axis)
                CHECK(alias->vertices[to*3+axis] == box->vertices[from*3+axis]*(mirrored && axis == 0 ? -1 : 1));
            for (int axis = 0; axis < 2; ++axis)
                CHECK(alias->texcoords[to*2+axis] == box->texcoords[from*2+axis]);
        }
        nova_unload_cpu_model(&decoded); nova_unload_model_images(&images); free(changed);
    }
    nova_unload_cpu_model(&original); nova_unload_model_images(&original_images);
}

static void source_reject(const char *text)
{
    NovaModelDocument d, before;
    nova_model_init(&d); before = d;
    CHECK(!nova_model_parse((const unsigned char *)text,strlen(text),&d,error,sizeof(error)));
    CHECK(!memcmp(&d,&before,sizeof(d)));
}

static Image checker(void)
{
    Image image = GenImageColor(32,32,WHITE);
    for (int y = 0; y < 32; ++y) for (int x = 0; x < 32; ++x)
        ImageDrawPixel(&image,x,y,y < 16 ? x < 8 ? RED : GREEN : x < 8 ? BLUE : YELLOW);
    return image;
}

static void budgets(const char *root)
{
    Image large = GenImageColor(1024,1024,WHITE);
    int length;
    unsigned char *png = ExportImageToMemory(large,".png",&length);
    UnloadImage(large); CHECK(png);
    NovaModelDocument d; nova_model_init(&d);
    CHECK(nova_model_add(&d,NOVA_SHAPE_BOX,error,sizeof(error)));
    for (size_t i = 0; i < 5; ++i) {
        snprintf(d.textures[i],NOVA_MODEL_TEXTURE_PATH,"budget_%zu.png",i);
        write_file(root,d.textures[i],png,(size_t)length);
    }
    MemFree(png);
    d.texture_count = 4;
    unsigned char *bytes = NULL; size_t size = 0;
    CHECK(nova_model_glb_at(&d,root,&bytes,&size,error,sizeof(error)));
    Model model; NovaModelImages images;
    CHECK(nova_decode_glb_images(bytes,(int)size,&model,&images,error,sizeof(error)));
    CHECK(images.pixels == NOVA_MODEL_TEXTURE_PIXELS && images.count == 4);
    nova_unload_cpu_model(&model); nova_unload_model_images(&images); free(bytes);
    CHECK(nova_model_glb_at(&d,root,&bytes,&size,error,sizeof(error)));
    for (size_t i = 0; i < 5; ++i) write_file(root,TextFormat("budget_model_%zu.glb",i),bytes,size);
    free(bytes);
    const char *script = "nova.scene('3d')\nfunction update(dt,input) end\n";
    write_file(root,"budget.lua",script,strlen(script));
    char manifest[1024] = "nova-project 1\nentry budget.lua\n";
    for (size_t i = 0; i < 4; ++i) strcat(manifest,TextFormat("model r%zu budget_model_%zu.glb\n",i,i));
    write_file(root,"budget.project",manifest,strlen(manifest));
    char path[4096]; CHECK(nova_project_resolve(root,"budget.project",path,error,sizeof(error)));
    NovaProjectValidation validation;
    CHECK(nova_validate_project(path,&validation,error,sizeof(error)));
    strcat(manifest,"model r4 budget_model_4.glb\n"); write_file(root,"budget.project",manifest,strlen(manifest));
    CHECK(!nova_validate_project(path,&validation,error,sizeof(error)));
    CHECK(strstr(error,"16 million sprite/model texture pixels"));
    CHECK(!unlink(TextFormat("%s/budget.lua",root)) && !unlink(TextFormat("%s/budget.project",root)));
    for (size_t i = 0; i < 5; ++i) CHECK(!unlink(TextFormat("%s/budget_model_%zu.glb",root,i)));
    d.texture_count = 5; bytes = NULL;
    CHECK(!nova_model_glb_at(&d,root,&bytes,&size,error,sizeof(error)) && !bytes);
    for (size_t i = 0; i < 5; ++i) CHECK(!unlink(TextFormat("%s/%s",root,d.textures[i])));
    large = GenImageColor(1025,1,WHITE);
    png = ExportImageToMemory(large,".png",&length); UnloadImage(large); CHECK(png);
    CHECK(!nova_decode_model_png(png,length,&large,error,sizeof(error)) && !large.data); MemFree(png);
    unsigned char *oversized = calloc(NOVA_MODEL_TEXTURE_BYTES+1,1); CHECK(oversized);
    Image tiny = checker();
    png = ExportImageToMemory(tiny,".png",&length); UnloadImage(tiny); CHECK(png);
    memcpy(oversized,png,(size_t)length); MemFree(png);
    CHECK(nova_decode_model_png(oversized,NOVA_MODEL_TEXTURE_BYTES,&large,error,sizeof(error)));
    UnloadImage(large);
    CHECK(!nova_decode_model_png(oversized,NOVA_MODEL_TEXTURE_BYTES+1,&large,error,sizeof(error)));
    free(oversized);
}

static void gpu(const char *root, const char *manifest, const unsigned char *glb, size_t length,
    const NovaModelDocument *document)
{
    SetConfigFlags(FLAG_WINDOW_HIDDEN);
    InitWindow(960,540,"Private textured model native pixels");
    CHECK(IsWindowReady());
    NovaResources resources = {0}; NovaEngine *engine = NULL;
    CHECK(nova_open_scene(&engine,&resources,manifest,true,error,sizeof(error)));
    CHECK(resources.count == 2 && resources.resources[0].owned && !resources.resources[1].owned);
    NovaResource *r = &resources.resources[0];
    CHECK(r->images.count == 1 && r->images.textures[0].id);
    CHECK(r->model.meshCount == 3 && resources.resources[1].model.meshes == r->model.meshes);
    for (int i = 0; i < 3; ++i)
        CHECK(r->model.materials[i].maps[MATERIAL_MAP_DIFFUSE].texture.id == r->images.textures[0].id);
    NovaPresentation p = {0};
    CHECK(nova_presentation_configure(&p,nova_world_resolution_default(),error,sizeof(error)));
    nova_presentation_world(&p,nova_frame(engine),&resources);
    RenderTexture2D target = {0}; CHECK(nova_capture_target(&target,error,sizeof(error)));
    BeginTextureMode(target);
    NovaCanvasState canvas = nova_begin_canvas(960,540);
    nova_presentation_composite(&p,nova_frame(engine),&resources,nova_viewport(960,540,false));
    nova_end_canvas(canvas); EndTextureMode();
    CHECK(nova_capture_export(target.texture,NOVA_TEST_DIRECTORY "/textured-native.png"));
    Image image = LoadImage(NOVA_TEST_DIRECTORY "/textured-native.png");
    CHECK(IsImageValid(image));
    Color expected[] = {RED,GREEN,BLUE,YELLOW};
    int counts[4] = {0}, minx[4] = {960,960,960,960}, miny[4] = {540,540,540,540};
    int maxx[4] = {0}, maxy[4] = {0};
    for (int y = 0; y < image.height; ++y) for (int x = 0; x < image.width; ++x) {
        Color c = GetImageColor(image,x,y);
        for (int a = 0; a < 4; ++a) if (!memcmp(&c,&expected[a],4)) {
            ++counts[a];
            if (x < minx[a]) minx[a] = x; if (x > maxx[a]) maxx[a] = x;
            if (y < miny[a]) miny[a] = y; if (y > maxy[a]) maxy[a] = y;
        }
    }
    for (int a = 0; a < 4; ++a) CHECK(counts[a] > 300);
    CHECK(maxx[0] < minx[1] && maxx[2] < minx[3] && maxy[0] < miny[2] && maxy[1] < miny[3]);
    CHECK(counts[1] > counts[0]*2 && counts[3] > counts[2]*2);
    UnloadImage(image); UnloadRenderTexture(target);
    NovaEngine *retained = engine;
    unsigned texture = r->images.textures[0].id, vao = r->model.meshes[0].vaoId;
    unsigned char *bad = malloc(length); CHECK(bad); memcpy(bad,glb,length);
    size_t bin = 28+get32(bad+12);
    /* First UV follows the box's 36 float3 positions. */
    put32(bad+bin+36*12,0x7fc00000);
    write_file(root,"model.glb",bad,length); free(bad);
    CHECK(!nova_open_scene(&engine,&resources,manifest,true,error,sizeof(error)));
    CHECK(engine == retained && r->images.textures[0].id == texture && r->model.meshes[0].vaoId == vao);
#ifdef NOVA_TEXTURE_LIFETIME_TEST
    int png_length;
    unsigned char *png = nova_read_file(TextFormat("%s/checker.png",root),NOVA_MODEL_TEXTURE_BYTES,&png_length,error,sizeof(error));
    CHECK(png); write_file(root,"checker2.png",png,(size_t)png_length); UnloadFileData(png);
    NovaModelDocument candidate = *document;
    candidate.texture_count = 2; strcpy(candidate.textures[1],"checker2.png");
    candidate.primitives[1].texture = 2;
    unsigned char *two = NULL; size_t two_length;
    CHECK(nova_model_glb_at(&candidate,root,&two,&two_length,error,sizeof(error)));
    write_file(root,"model.glb",two,two_length); free(two);
    unsigned previous_uploads = uploads, previous_releases = releases;
    fail_upload = attempts+2;
    CHECK(!nova_open_scene(&engine,&resources,manifest,true,error,sizeof(error)));
    CHECK(engine == retained && r->images.textures[0].id == texture && r->model.meshes[0].vaoId == vao);
    CHECK(uploads == previous_uploads+1 && releases == previous_releases+1);
    fail_upload = 0;
    CHECK(!unlink(TextFormat("%s/checker2.png",root)));
#else
    (void)document;
#endif
    write_file(root,"model.glb",glb,length);
    for (int i = 0; i < 20; ++i) {
        CHECK(nova_open_scene(&engine,&resources,manifest,true,error,sizeof(error)));
        CHECK(resources.resources[0].images.count == 1 && !resources.resources[1].owned);
    }
    nova_presentation_destroy(&p); nova_unload_resources(&resources); nova_destroy(engine); CloseWindow();
#ifdef NOVA_TEXTURE_LIFETIME_TEST
    CHECK(uploads == releases);
    printf("Texture allocation seam: %u successful uploads/releases, no alias double free; second-upload failure retained live\n",uploads);
#endif
    printf("Textured native UV orientation: pixels=%d,%d,%d,%d; one shared texture; retained-live and 20 replacements passed\n",
        counts[0],counts[1],counts[2],counts[3]);
}

int main(int argc, char **argv)
{
    SetTraceLogLevel(LOG_WARNING);
    bool graphical = argc == 2 && !strcmp(argv[1],"--gpu");
    CHECK(argc == 1 || graphical);
    char temporary[] = "/tmp/nova-textured-model-XXXXXX", root[4096];
    CHECK(mkdtemp(temporary) && realpath(temporary,root));
    budgets(root);
    Image image = checker();
    int png_length; unsigned char *png = ExportImageToMemory(image,".png",&png_length);
    CHECK(png && png_length > 0);
    write_file(root,"checker.png",png,(size_t)png_length);
    UnloadImage(image); MemFree(png);
    NovaModelDocument d; nova_model_init(&d);
    for (int i = 0; i < 3; ++i) {
        CHECK(nova_model_add(&d,(NovaModelShape)i,error,sizeof(error)));
        memset(d.primitives[i].color,255,3); d.primitives[i].position[0] = i == 0 ? 0 : (float)i*100;
    }
    d.texture_count = 1; strcpy(d.textures[0],"checker.png");
    for (int i = 0; i < 3; ++i) d.primitives[i].texture = 1;
    strcpy(d.primitives[0].name,"CharacterBody");
    unsigned char *source = NULL, *glb = NULL; size_t source_length, length;
    CHECK(nova_model_serialize(&d,&source,&source_length,error,sizeof(error)));
    NovaModelDocument parsed;
    CHECK(nova_model_parse(source,source_length,&parsed,error,sizeof(error)) && !memcmp(&d,&parsed,sizeof(d)));
    free(source);
    const char *v1 = "nova-model 1\nnext 2\nprimitive 1 box 0 0 0 0 0 0 0 1 1 1 255 255 255\n";
    CHECK(nova_model_parse((const unsigned char *)v1,strlen(v1),&parsed,error,sizeof(error)));
    CHECK(!strcmp(parsed.primitives[0].name,"Part_1") && !parsed.texture_count);
    CHECK(nova_model_serialize(&parsed,&source,&source_length,error,sizeof(error)));
    CHECK(nova_model_parse(source,source_length,&parsed,error,sizeof(error))); free(source);
    source_reject("nova-model 2\nnext 1\ntexture 1 ../bad.png\n");
    source_reject("nova-model 2\nnext 1\ntexture 1 /bad.png\n");
    source_reject("nova-model 2\nnext 1\ntexture 2 bad.png\n");
    source_reject("nova-model 2\nnext 2\nprimitive 1 box 0 0 0 0 0 0 0 1 1 1 255 255 255 Body 1\n");
    CHECK(nova_model_glb_at(&d,root,&glb,&length,error,sizeof(error)));
    uv_correspondence(glb,length);
    /* The same UV/last-triangle path also runs for models with no texture declarations. */
    NovaModelDocument plain = d;
    plain.texture_count = 0;
    memset(plain.textures,0,sizeof(plain.textures));
    for (size_t i = 0; i < plain.count; ++i) plain.primitives[i].texture = 0;
    unsigned char *plain_glb = NULL; size_t plain_length;
    CHECK(nova_model_glb(&plain,&plain_glb,&plain_length,error,sizeof(error)));
    uv_correspondence(plain_glb,plain_length); free(plain_glb);
    Model model; NovaModelImages images;
    CHECK(nova_decode_glb_images(glb,(int)length,&model,&images,error,sizeof(error)));
    CHECK(images.count == 1 && images.pixels == 1024 && model.meshCount == 3);
    for (int i = 0; i < 3; ++i) CHECK(model.meshes[i].texcoords && images.material_image[i] == 0);
    nova_unload_cpu_model(&model); nova_unload_model_images(&images);
    bad_json(glb,length,"\"minFilter\":9728","\"minFilter\":9729");
    bad_json(glb,length,"\"mimeType\":\"image/png\"","\"uri\":\"file:///tmp/no.png\"");
    bad_json(glb,length,"\"mimeType\":\"image/png\"","\"mimeType\":\"image/jpeg\"");
    bad_json(glb,length,"\"TEXCOORD_0\":1","\"TEXCOORD_1\":1");
    bad_json(glb,length,"\"KHR_materials_unlit\":{}}","\"KHR_materials_unlit\":{}},\"alphaMode\":\"BLEND\"");
    bad_json(glb,length,"\"baseColorTexture\":{\"index\":0}","\"baseColorTexture\":{\"index\":0,\"texCoord\":1}");
    unsigned char *invalid_uv = malloc(length); CHECK(invalid_uv); memcpy(invalid_uv,glb,length);
    put32(invalid_uv+28+get32(glb+12)+36*12,0x7fc00000);
    CHECK(!nova_decode_glb_images(invalid_uv,(int)length,&model,&images,error,sizeof(error)) && !model.meshCount);
    free(invalid_uv);
    d.texture_count = 17; CHECK(!nova_model_validate(&d,error,sizeof(error))); d.texture_count = 1;
    strcpy(d.textures[0],"escape.png");
    CHECK(!symlink("/etc/hosts",TextFormat("%s/escape.png",root)));
    unsigned char *unchanged = glb; size_t unchanged_length = length;
    CHECK(!nova_model_glb_at(&d,root,&unchanged,&unchanged_length,error,sizeof(error)));
    CHECK(unchanged == glb && unchanged_length == length);
    CHECK(!unlink(TextFormat("%s/escape.png",root))); strcpy(d.textures[0],"checker.png");
    image = GenImageColor(2,2,(Color){255,0,0,128});
    png = ExportImageToMemory(image,".png",&png_length); UnloadImage(image);
    Image decoded;
    CHECK(!nova_decode_model_png(png,png_length,&decoded,error,sizeof(error)) && !decoded.data); MemFree(png);
    write_file(root,"model.glb",glb,length);
    const char *manifest = "nova-project 1\nentry main.lua\nmodel a model.glb\nmodel alias model.glb\n";
    const char *lua = "nova.scene('3d')\nlocal a=nova.asset('a')\nfunction update(dt,input) nova.camera(0,0,4,0,0,0,45) nova.model(a,0,0,0,1) end\n";
    write_file(root,"nova.project",manifest,strlen(manifest)); write_file(root,"main.lua",lua,strlen(lua));
    char path[4096]; CHECK(nova_project_resolve(root,"nova.project",path,error,sizeof(error)));
    NovaProjectValidation validation;
    CHECK(nova_validate_project(path,&validation,error,sizeof(error)) && validation.assets[1].resource_index == 0);
    if (graphical) gpu(root,path,glb,length,&d);
    free(glb);
    const char *files[] = {"checker.png","model.glb","nova.project","main.lua"};
    for (size_t i = 0; i < 4; ++i) CHECK(!unlink(TextFormat("%s/%s",root,files[i])));
    CHECK(!rmdir(root));
    puts("Named v1/v2 sources, embedded PNG/UV GLB, strict bad material/image/UV/path checks and headless preflight passed");
    return 0;
}
