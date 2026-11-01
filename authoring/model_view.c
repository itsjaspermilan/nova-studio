#include "model_view.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static bool fail(char *error, size_t size, const char *message)
{
    snprintf(error, size, "%s", message);
    return false;
}

static bool write_fixture(const char *root, const char *name, const char *text,
    char *error, size_t size)
{
    NovaDocument document = {0};
    bool ok = nova_document_open_output(&document, root, name, NOVA_SOURCE_EDIT_LIMIT, false, error, size) &&
        nova_document_replace(&document, 0, document.length, text, strlen(text), error, size) &&
        nova_document_save(&document, false, error, size);
    nova_document_close(&document);
    return ok;
}

void nova_model_view_close(NovaModelView *view)
{
    nova_document_close(&view->output);
    nova_unload_resources(&view->resources);
    nova_destroy(view->engine);
    nova_presentation_destroy(&view->presentation);
    if (*view->directory) {
        const char *files[] = {"nova.project", "main.lua", "model.glb"};
        for (size_t i = 0; i < 3; ++i) {
            char path[NOVA_NATIVE_PATH_CAPACITY + 32];
            snprintf(path, sizeof(path), "%s/%s", view->directory, files[i]);
            if (unlink(path) && FileExists(path)) TraceLog(LOG_WARNING, "MODELLER: cannot remove fixture %s", path);
        }
        if (rmdir(view->directory)) TraceLog(LOG_WARNING, "MODELLER: cannot remove private preview directory %s", view->directory);
    }
    *view = (NovaModelView){0};
}

bool nova_model_view_open(NovaModelView *view, char *error, size_t size)
{
    NovaModelView candidate = {0};
    strcpy(candidate.directory, "/tmp/nova-modeller-XXXXXX");
    if (!mkdtemp(candidate.directory)) {
        candidate.directory[0] = 0;
        return fail(error, size, "cannot create private modeller preview directory");
    }
    bool ok = write_fixture(candidate.directory, "nova.project",
        "nova-project 1\nentry main.lua\nmodel authored model.glb\n", error, size) &&
        write_fixture(candidate.directory, "main.lua",
            "nova.scene('3d')\nlocal model=nova.asset('authored')\n"
            "function update(dt,input)\nnova.background(18,24,41)\n"
            "nova.camera(0,2,8,0,0,0,45)\nnova.model(model,0,0,0,1)\nend\n", error, size) &&
        nova_document_open_output(&candidate.output, candidate.directory, "model.glb",
            NOVA_MODEL_GLB_BYTES, true, error, size) &&
        nova_presentation_configure(&candidate.presentation, nova_world_resolution_default(), error, size);
    if (!ok) { nova_model_view_close(&candidate); return false; }
    candidate.frame = (NovaFrame){.mode = NOVA_3D, .background = {18,24,41,255},
        .camera_position = {0,2,8}, .camera_fov = 45};
    nova_model_view_close(view);
    *view = candidate;
    return true;
}

bool nova_model_view_stage(NovaModelView *view, const NovaModelDocument *model, char *error, size_t size)
{
    if (!nova_model_validate(model, error, size)) return false;
    if (!*view->directory) return fail(error, size, "modeller preview is not open");
    if (!model->count) {
        nova_unload_resources(&view->resources);
        nova_destroy(view->engine);
        view->engine = NULL;
        view->frame.count = 0;
        ++view->revisions;
        return true;
    }
    unsigned char *bytes = NULL;
    size_t length = 0;
    if (!nova_model_glb(model, &bytes, &length, error, size)) return false;
    bool written = nova_document_replace(&view->output, 0, view->output.length, (char *)bytes, length, error, size) &&
        nova_document_save(&view->output, false, error, size);
    free(bytes);
    if (!written) return false;
    char manifest[NOVA_NATIVE_PATH_CAPACITY + 32];
    snprintf(manifest, sizeof(manifest), "%s/nova.project", view->directory);
    if (!nova_open_scene(&view->engine, &view->resources, manifest, true, error, size)) return false;
    NovaSceneInspection inspection = nova_inspect_scene(view->engine, &view->resources);
    view->frame = *inspection.frame;
    const NovaAssetInspection *asset = &inspection.assets[0];
    NovaVec3 low = asset->bounds_min, high = asset->bounds_max;
    float span = fmaxf(high.x-low.x, fmaxf(high.y-low.y, high.z-low.z));
    /* Fit only the draw instance, not exported geometry; stay inside native near/far planes. */
    float scale = 4.0f / fmaxf(span, 0.01f);
    view->frame.commands[0].position = (NovaVec3){
        -(low.x+high.x)*.5f*scale, -(low.y+high.y)*.5f*scale, -(low.z+high.z)*.5f*scale};
    view->frame.commands[0].size = (NovaVec3){scale,scale,scale};
    view->frame.camera_position = (NovaVec3){5,3,9};
    view->frame.camera_target = (NovaVec3){0};
    ++view->revisions;
    return true;
}
