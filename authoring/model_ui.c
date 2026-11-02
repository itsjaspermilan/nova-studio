#include "model_ui.h"
#include "widgets.h"

#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define ink (nova_ui_style()->ink)
#define muted (nova_ui_style()->muted)
#define accent (nova_ui_style()->accent)

static const char *shape(NovaModelShape value)
{
    return value == NOVA_SHAPE_BOX ? "box" : value == NOVA_SHAPE_PYRAMID ? "pyramid" : "cylinder";
}

static void message(NovaModelUI *ui, const char *text)
{
    snprintf(ui->message, sizeof(ui->message), "%s", text);
}

static void fields(NovaModelUI *ui)
{
    memset(ui->field_focus, 0, sizeof(ui->field_focus));
    ui->values_dirty = false;
    if (!ui->model.count) { memset(ui->fields, 0, sizeof(ui->fields)); return; }
    if (ui->selected >= ui->model.count) ui->selected = ui->model.count - 1;
    NovaModelPrimitive *p = &ui->model.primitives[ui->selected];
    snprintf(ui->part_name, sizeof(ui->part_name), "%s", p->name);
    for (int a = 0; a < 3; ++a) {
        snprintf(ui->fields[a], 32, "%.9g", (double)p->position[a]);
        snprintf(ui->fields[3+a], 32, "%.9g", (double)p->rotation[a]);
        snprintf(ui->fields[6+a], 32, "%.9g", (double)p->scale[a]);
        snprintf(ui->fields[9+a], 32, "%u", p->color[a]);
    }
    snprintf(ui->fields[12], 32, "%u", p->sides);
}

static bool source_open(NovaModelUI *ui, const char *root)
{
    if (!IsFileExtension(ui->source_path, ".nova-model")) {
        message(ui, "Editable source must use a contained .nova-model path; GLB cannot reconstruct primitive parameters");
        return false;
    }
    NovaDocument candidate = {0};
    NovaModelDocument model;
    nova_model_init(&model);
    bool ok = nova_document_open_output(&candidate, root, ui->source_path, NOVA_MODEL_DOCUMENT_BYTES,
        false, ui->message, sizeof(ui->message));
    if (ok && candidate.saved.info.st_ino)
        ok = nova_model_parse((unsigned char *)candidate.text, candidate.length, &model, ui->message, sizeof(ui->message));
    if (ok && !candidate.saved.info.st_ino) {
        unsigned char *bytes = NULL;
        size_t length;
        ok = nova_model_serialize(&model, &bytes, &length, ui->message, sizeof(ui->message)) &&
            nova_document_replace(&candidate, 0, candidate.length, (char *)bytes, length, ui->message, sizeof(ui->message));
        free(bytes);
    }
    if (!ok) { nova_document_close(&candidate); return false; }
    nova_document_close(&ui->source);
    ui->source = candidate;
    ui->model = model;
    ui->export_pending = false;
    if (model.count) {
        unsigned char *glb = NULL; size_t length = 0;
        char detail[1024];
        ui->export_pending = !nova_model_glb_at(&model,root,&glb,&length,detail,sizeof(detail)) ||
            length != ui->target.length || memcmp(glb,ui->target.text,length);
        free(glb);
    }
    ui->selected = 0; ui->scroll = 0; ui->refresh = true;
    fields(ui);
    message(ui, candidate.saved.info.st_ino ? "Model opened. Select a part to edit, or add another part." :
        "New model. Add a part, edit its shape and texture, then Save.");
    return true;
}

void nova_model_ui_close(NovaModelUI *ui)
{
    if (ui->texture_files.paths) UnloadDirectoryFiles(ui->texture_files);
    nova_ui_text_reset(&ui->disk_editor);
    nova_ui_text_reset(&ui->details_editor);
    nova_document_close(&ui->source);
    nova_document_close(&ui->target);
    nova_model_view_close(&ui->view);
    *ui = (NovaModelUI){0};
}

bool nova_model_ui_open(NovaModelUI *ui, const char *manifest, const char *root,
    const char *model_path, char *error, size_t size)
{
    NovaModelUI *candidate = calloc(1, sizeof(*candidate));
    if (!candidate) { snprintf(error, size, "cannot allocate modeller state"); return false; }
    bool ok = manifest && strlen(manifest) < sizeof(candidate->manifest) &&
        model_path && IsFileExtension(model_path, ".glb");
    if (!ok) message(candidate, "Modeller requires an actual saved project and declared .glb model destination");
    if (ok) {
        strcpy(candidate->manifest, manifest);
        int count = snprintf(candidate->source_path, sizeof(candidate->source_path), "%s.nova-model", model_path);
        if (count < 0 || (size_t)count >= sizeof(candidate->source_path)) {
            message(candidate,"Model destination is too long for its independent .nova-model source path");
            ok = false;
        }
        if (ok) ok = nova_document_open_output(&candidate->target, root, model_path, NOVA_ASSET_FILE_LIMIT,
            true, candidate->message, sizeof(candidate->message)) && source_open(candidate, root);
    }
    if (ok) {
        candidate->active = true;
        nova_model_ui_close(ui);
        *ui = *candidate;
    } else {
        snprintf(error, size, "%s", candidate->message);
        nova_model_ui_close(candidate);
    }
    free(candidate);
    return ok;
}

bool nova_model_ui_apply(NovaModelUI *ui, const NovaModelDocument *candidate)
{
    if (!memcmp(&ui->model, candidate, sizeof(*candidate))) { fields(ui); return true; }
    unsigned char *bytes = NULL;
    size_t length;
    if (!nova_model_serialize(candidate, &bytes, &length, ui->message, sizeof(ui->message))) return false;
    bool ok = nova_document_replace(&ui->source, 0, ui->source.length, (char *)bytes, length,
        ui->message, sizeof(ui->message));
    free(bytes);
    if (!ok) return false;
    ui->model = *candidate;
    ui->export_pending = true;
    ui->refresh = true;
    fields(ui);
    message(ui, "Model changed. Save when ready, then return to your project to create an object.");
    return true;
}

bool nova_model_ui_import_texture(NovaModelUI *ui, const char *path)
{
    if (ui->values_dirty || !ui->model.count || ui->model.texture_count == NOVA_MODEL_MATERIALS) {
        message(ui,"Apply/Reset part fields first; texture import needs a selected part and fewer than 16 PNGs.");
        return false;
    }
    if (!nova_document_check_disk(&ui->source,ui->message,sizeof(ui->message)) ||
        !nova_document_check_disk(&ui->target,ui->message,sizeof(ui->message))) return false;
    int length = 0;
    unsigned char *bytes = nova_read_file(path,NOVA_MODEL_TEXTURE_BYTES,&length,ui->message,sizeof(ui->message));
    if (!bytes) return false;
    Image image = {0};
    bool ok = nova_decode_model_png(bytes,length,&image,ui->message,sizeof(ui->message));
    size_t pixels = ok ? (size_t)image.width*(size_t)image.height : 0;
    if (image.data) UnloadImage(image);
    image = (Image){0};
    for (size_t i = 0; ok && i < ui->model.texture_count; ++i) {
        char resolved[NOVA_NATIVE_PATH_CAPACITY]; int n = 0;
        unsigned char *existing = NULL;
        ok = nova_project_resolve(ui->target.root,ui->model.textures[i],resolved,ui->message,sizeof(ui->message));
        if (ok) existing = nova_read_file(resolved,NOVA_MODEL_TEXTURE_BYTES,&n,ui->message,sizeof(ui->message));
        if (ok) ok = existing && nova_decode_model_png(existing,n,&image,ui->message,sizeof(ui->message));
        if (ok) pixels += (size_t)image.width*(size_t)image.height;
        if (image.data) UnloadImage(image);
        image = (Image){0}; UnloadFileData(existing);
    }
    if (ok && pixels > NOVA_MODEL_TEXTURE_PIXELS) {
        message(ui,"Texture import exceeds 4 million unique model pixels; nothing copied."); ok = false;
    }
    NovaModelDocument candidate = ui->model;
    size_t index = candidate.texture_count;
    char name[32] = {0};
    const char *filename=GetFileName(path);
    size_t used=0;
    for (size_t i=0; filename[i] && used<sizeof(name)-1; ++i) {
        unsigned char c=(unsigned char)filename[i];
        if (c=='.') break;
        name[used++]=(c>='a' && c<='z') || (c>='A' && c<='Z') ||
            (c>='0' && c<='9') || c=='_' ? (char)c : '_';
    }
    if (!used) strcpy(name,"Texture");
    int n = snprintf(candidate.textures[index],NOVA_MODEL_TEXTURE_PATH,"%s.texture_%zu.%s.png",ui->target.relative,index+1,name);
    if (ok && (n < 0 || n >= NOVA_MODEL_TEXTURE_PATH)) {
        message(ui,"Texture destination path is too long"); ok = false;
    }
    NovaDocument output = {0};
    if (ok) ok = nova_document_open_output(&output,ui->target.root,candidate.textures[index],
        NOVA_MODEL_TEXTURE_BYTES,true,ui->message,sizeof(ui->message));
    if (ok && output.saved.info.st_ino) {
        message(ui,"Texture destination already exists. Nothing overwritten; retain it or choose a new model destination."); ok = false;
    }
    ++candidate.texture_count;
    candidate.primitives[ui->selected].texture = (unsigned)index+1;
    memset(candidate.primitives[ui->selected].color,255,3);
    unsigned char *source = NULL; size_t source_length = 0;
    if (ok) ok = nova_model_serialize(&candidate,&source,&source_length,ui->message,sizeof(ui->message));
    /* Allocate the exact source replacement before the persistent copy. */
    NovaDocument draft = {0};
    if (ok) ok = nova_document_open_output(&draft,ui->source.root,ui->source.relative,
        NOVA_MODEL_DOCUMENT_BYTES,false,ui->message,sizeof(ui->message)) &&
        nova_document_replace(&draft,0,draft.length,(char *)source,source_length,ui->message,sizeof(ui->message));
    if (ok) ok = nova_document_replace(&output,0,0,(char *)bytes,(size_t)length,ui->message,sizeof(ui->message)) &&
        nova_document_save(&output,false,ui->message,sizeof(ui->message));
    if (ok) {
        free(ui->source.text); ui->source.text = draft.text; ui->source.length = draft.length;
        draft.text = NULL;
        ui->model = candidate; ui->refresh = ui->export_pending = true; fields(ui);
        message(ui,"Texture imported and assigned. Save to finish. Discarding does not delete the copied image.");
    }
    nova_document_close(&draft); nova_document_close(&output);
    free(source); UnloadFileData(bytes);
    return ok;
}

void nova_model_ui_request_close(NovaModelUI *ui)
{
    if (nova_document_dirty(&ui->source) || ui->values_dirty || ui->export_pending) ui->decision = NOVA_MODEL_DECISION_EXIT;
    else ui->close = true;
}

static bool export_model(NovaModelUI *ui)
{
    ui->inspected_export = false;
    ui->exported = false;
    if (ui->saving_model && !nova_document_check_disk(&ui->source,ui->message,sizeof(ui->message))) return false;
    unsigned char *bytes = NULL;
    size_t length;
    if (!nova_model_glb_at(&ui->model, ui->target.root, &bytes, &length, ui->message, sizeof(ui->message))) return false;
    bool ok = nova_document_replace(&ui->target, 0, ui->target.length, (char *)bytes, length,
        ui->message, sizeof(ui->message)) && nova_document_save(&ui->target, ui->overwrite, ui->message, sizeof(ui->message));
    free(bytes);
    if (!ok) return false;
    ui->export_pending = false;
    ui->saving_model = false;
    if (ui->beginner) {
        ui->exported = true;
        message(ui, "Model saved. Return to project to create an object. Save project changes separately.");
        return true;
    }
    NovaProjectValidation *validation = calloc(1, sizeof(*validation));
    if (!validation) { message(ui, "GLB written, but cannot allocate project inspection; no verified export result"); return false; }
    ok = nova_validate_project(ui->manifest, validation, ui->message, sizeof(ui->message));
    if (ok) {
        bool found = false;
        for (size_t i = 0; i < validation->project.count; ++i)
            if (validation->assets[i].declaration.type == NOVA_ASSET_MODEL &&
                !strcmp(validation->assets[i].declaration.path, ui->target.relative)) {
                ui->exported_asset = validation->assets[i]; found = true; break;
            }
        if (!found) { message(ui, "GLB written, but saved project no longer declares this model destination; reopen the modeller"); ok = false; }
    } else {
        char detail[1024];
        snprintf(detail, sizeof(detail), "%s", ui->message);
        snprintf(ui->message, sizeof(ui->message), "GLB written/import-valid, but project preflight failed: %.900s", detail);
    }
    free(validation);
    ui->inspected_export = ok;
    if (ok) {
        ui->exported = true;
        message(ui, "GLB exported atomically and saved project passed native preflight. Source is separate; return and Reload saved to play.");
    }
    return ok;
}

void nova_model_ui_update(NovaModelUI *ui)
{
    if (!ui->active) return;
    if (ui->close) { nova_model_ui_close(ui); return; }
    if (ui->import_texture) {
        ui->import_texture = false;
        if (nova_model_ui_import_texture(ui,ui->texture_path)) ui->texture_sheet = false;
    }
    if (!*ui->view.directory && !ui->view_attempted) {
        ui->view_attempted = true;
        if (!nova_model_view_open(&ui->view, ui->message, sizeof(ui->message))) {
            ui->stale = true; ui->refresh = false;
            return;
        }
        snprintf(ui->view.source_root,sizeof(ui->view.source_root),"%s",ui->target.root);
    }
    if (ui->reopen) {
        ui->reopen = false;
        source_open(ui, ui->target.root);
    }
    if (ui->refresh && *ui->view.directory) {
        ui->refresh = false;
        char detail[1024] = {0};
        ui->stale = !nova_model_view_stage(&ui->view, &ui->model, detail, sizeof(detail));
        if (!ui->stale) ui->ready = true;
        else {
            message(ui,detail);
            TraceLog(LOG_WARNING, "MODELLER: native preview failed, old live view retained: %s", ui->message);
        }
    }
    if (ui->save) {
        ui->save = false;
        if (nova_document_save(&ui->source, ui->overwrite, ui->message, sizeof(ui->message)))
            message(ui, "Editable source saved atomically; GLB export and gameplay reload remain separate");
        else if (ui->source.has_conflict) {
            ui->decision = NOVA_MODEL_DECISION_SAVE_CONFLICT;
            ui->summarized_decision = NOVA_MODEL_DECISION_NONE;
        }
        ui->overwrite = false;
    }
    if (ui->save_model) {
        ui->save_model = false;
        if (nova_document_check_disk(&ui->source, ui->message, sizeof(ui->message)) &&
            nova_document_check_disk(&ui->target, ui->message, sizeof(ui->message))) {
            unsigned char *bytes = NULL; size_t length = 0;
            bool valid = nova_model_glb_at(&ui->model,ui->target.root,&bytes,&length,ui->message,sizeof(ui->message));
            free(bytes);
            if (valid && nova_document_save(&ui->source,false,ui->message,sizeof(ui->message))) {
                ui->saving_model = true;
                ui->check_export = true;
                message(ui,"Source saved (1 of 2 files). Confirm GLB replacement to finish Save model; these writes are not atomic together.");
            }
        } else {
            message(ui,"Save blocked: model files changed outside Nova. Open Advanced to review source/export conflicts. Your changes are retained.");
            ui->advanced = true;
        }
    }
    if (ui->check_export) {
        ui->check_export = false;
        if (nova_document_check_disk(&ui->target,ui->message,sizeof(ui->message))) {
            if (ui->target.saved.info.st_ino) ui->decision=NOVA_MODEL_DECISION_EXPORT;
            else ui->export_glb=true;
        } else if (ui->target.has_conflict) {
            ui->decision=NOVA_MODEL_DECISION_EXPORT_CONFLICT;
            ui->inspected_export=false; ui->exported=false;
        }
        ui->summarized_decision=NOVA_MODEL_DECISION_NONE;
    }
    if (ui->export_glb) {
        ui->export_glb = false;
        if (!export_model(ui)) {
            if (ui->saving_model) {
                char detail[768]; snprintf(detail,sizeof(detail),"%.767s",ui->message);
                snprintf(ui->message,sizeof(ui->message),"PARTIAL MODEL SAVE: source written (1 of 2); GLB not written. Draft/live retained. %s",detail);
            }
            if (ui->target.has_conflict) {
                ui->decision = NOVA_MODEL_DECISION_EXPORT_CONFLICT;
                ui->summarized_decision = NOVA_MODEL_DECISION_NONE;
            }
        }
        ui->overwrite = false;
    }
}

static bool parse_fields(NovaModelUI *ui)
{
    NovaModelDocument candidate = ui->model;
    NovaModelPrimitive *p = &candidate.primitives[ui->selected];
    snprintf(p->name, sizeof(p->name), "%s", ui->part_name);
    for (int i = 0; i < 13; ++i) {
        if (i == 12 && p->shape != NOVA_SHAPE_CYLINDER) continue;
        char *end;
        errno = 0;
        if (i < 9) {
            float value = strtof(ui->fields[i], &end);
            if (end == ui->fields[i] || *end || (errno && !(errno == ERANGE && value != 0)) || !isfinite(value)) {
                message(ui, "Transform field is not a finite representable number"); return false;
            }
            if (i < 3) p->position[i] = value;
            else if (i < 6) p->rotation[i-3] = value;
            else p->scale[i-6] = value;
        } else {
            long value = strtol(ui->fields[i], &end, 10);
            if (end == ui->fields[i] || *end || errno || value < 0 || value > (i == 12 ? 32 : 255)) {
                message(ui, "Color requires integer 0..255; cylinder sides require integer 3..32"); return false;
            }
            if (i == 12) p->sides = (unsigned)value;
            else p->color[i-9] = (unsigned char)value;
        }
    }
    return nova_model_ui_apply(ui, &candidate);
}

static void modal(NovaModelUI *ui, int width, int height)
{
    if (ui->decision == NOVA_MODEL_DECISION_DELETE) {
        int x=width/2-270, y=height/2-110;
        DrawRectangle(0,0,width,height,(Color){0,0,0,150});
        DrawRectangleRounded((Rectangle){(float)x,(float)y,540,220},.05f,8,nova_ui_style()->panel);
        nova_ui_label(TextFormat("Delete %s?",ui->model.primitives[ui->selected].name),x+20,y+24,500,ink);
        nova_ui_label("This removes the part. Imported textures remain available.",x+20,y+65,500,muted);
        nova_ui_label("There is no part undo. Cancel to keep it.",x+20,y+94,500,muted);
        if (nova_ui_button((Rectangle){(float)x+20,(float)y+160,160,34},"Cancel",true))
            ui->decision=NOVA_MODEL_DECISION_NONE;
        if (nova_ui_icon_button((Rectangle){(float)x+300,(float)y+160,220,34},"Delete part",NOVA_ICON_DELETE,
            false,true,"Remove this part permanently from the draft",NULL)) {
            NovaModelDocument candidate=ui->model;
            memmove(&candidate.primitives[ui->selected],&candidate.primitives[ui->selected+1],
                (candidate.count-ui->selected-1)*sizeof(candidate.primitives[0]));
            --candidate.count;
            memset(&candidate.primitives[candidate.count],0,sizeof(candidate.primitives[0]));
            if (nova_model_ui_apply(ui,&candidate)) ui->decision=NOVA_MODEL_DECISION_NONE;
        }
        return;
    }
    if (ui->review_disk) {
        DrawRectangle(0,0,width,height,nova_ui_style()->background);
        nova_ui_label("READ ONLY / exact observed disk source; scroll to review",20,20,width-40,accent);
        NovaDocument disk = {.text=ui->source.conflict.text,.length=ui->source.conflict.length};
        nova_ui_text(&ui->disk_editor,&disk,(Rectangle){20,60,(float)width-40,(float)height-130},
            false,ui->message,sizeof(ui->message));
        if (nova_ui_button((Rectangle){20,(float)height-55,230,35},"Return to version decision",true)) ui->review_disk=false;
        return;
    }
    int x = (width-820)/2, y = (height-340)/2;
    DrawRectangle(0,0,width,height,(Color){0,0,0,190});
    DrawRectangleRounded((Rectangle){(float)x,(float)y,820,340},0.07f,16,nova_ui_style()->panel);
    bool conflict = ui->decision == NOVA_MODEL_DECISION_SAVE_CONFLICT ||
        ui->decision == NOVA_MODEL_DECISION_EXPORT_CONFLICT;
    bool binary = ui->decision == NOVA_MODEL_DECISION_EXPORT || ui->decision == NOVA_MODEL_DECISION_EXPORT_CONFLICT;
    NovaDocument *doc = binary ? &ui->target : &ui->source;
    nova_ui_label(conflict ? "Files changed outside Nova / review before replacing" :
        binary ? ui->saving_model ? "Finish saving / replace the previous game model?" : "Export / replace the game model?" :
        "Unsaved model / discard these changes?",
        x+20,y+20,780,accent);
    nova_ui_label(binary ? doc->relative : ui->source.relative,x+20,y+58,780,ink);
    const NovaDiskText *disk = conflict ? &doc->conflict : &doc->saved;
    char line[256];
    snprintf(line,sizeof(line),"Observed disk: %zu bytes; inode=%llu; draft source primitives=%zu",
        disk->length,(unsigned long long)disk->info.st_ino,ui->model.count);
    nova_ui_label(line,x+20,y+88,780,muted);
    if (binary && ui->summarized_decision != ui->decision) {
        Model model = {0};
        char detail[256];
        if (disk->length && nova_decode_glb((unsigned char *)disk->text,(int)disk->length,&model,detail,sizeof(detail))) {
            size_t vertices = 0;
            for (int i = 0; i < model.meshCount; ++i) {
                vertices += (size_t)model.meshes[i].vertexCount;
            }
            snprintf(ui->disk_summary,sizeof(ui->disk_summary),"Observed native GLB: %d primitives, %zu vertices. Imported meshes are not reconstructed as source.",
                model.meshCount,vertices);
            nova_unload_cpu_model(&model);
        } else snprintf(ui->disk_summary,sizeof(ui->disk_summary),"Observed file is empty or not a supported GLB; replacement still requires explicit consent.");
        ui->summarized_decision = ui->decision;
    }
    if (binary) nova_ui_label(ui->disk_summary,x+20,y+118,780,ink);
    else if (conflict) {
        const char *text = disk->text;
        for (int row = 0; text && *text && row < 5; ++row) {
            char excerpt[85];
            size_t count = 0;
            while (text[count] && text[count] != '\n' && count < sizeof(excerpt)-1) ++count;
            memcpy(excerpt,text,count); excerpt[count] = 0;
            nova_ui_label(excerpt,x+20,y+118+row*21,780,ink);
            text += count;
            if (*text == '\n') ++text;
        }
    } else nova_ui_label("Cancel retains the draft. Save source separately before discarding.",x+20,y+118,780,ink);
    if (nova_ui_button((Rectangle){(float)x+20,(float)y+280,160,38},"Cancel / keep draft",true)) {
        if (binary && ui->saving_model) {
            message(ui,"PARTIAL MODEL SAVE: source written (1 of 2); GLB replacement cancelled. Source and export may differ; draft retained.");
            ui->saving_model = false;
        }
        ui->decision = NOVA_MODEL_DECISION_NONE; return;
    }
    const char *action = binary ? ui->saving_model && !conflict ? "Finish Save" : "Overwrite shown version" :
        conflict ? "Overwrite shown source" : ui->decision == NOVA_MODEL_DECISION_OPEN ? "Discard + open source" : "Discard + return";
    if (nova_ui_button((Rectangle){(float)x+194,(float)y+280,226,38},action,true)) {
        NovaModelDecision decision = ui->decision;
        ui->decision = NOVA_MODEL_DECISION_NONE;
        if (binary) { ui->export_glb = true; ui->overwrite = conflict; }
        else if (conflict) { ui->save = true; ui->overwrite = true; }
        else if (decision == NOVA_MODEL_DECISION_OPEN) ui->reopen = true;
        else ui->close = true;
    }
    if (conflict && !binary &&
        nova_ui_button((Rectangle){(float)x+434,(float)y+280,158,38},"Review full disk",true)) {
        nova_ui_text_reset(&ui->disk_editor); ui->review_disk=true;
    }
    if (conflict && !binary &&
        nova_ui_button((Rectangle){(float)x+606,(float)y+280,194,38},"Discard + reread source",true)) {
        snprintf(ui->source_path,sizeof(ui->source_path),"%s",ui->source.relative);
        ui->reopen = true; ui->decision = NOVA_MODEL_DECISION_NONE;
    }
}

static void add_shape(NovaModelUI *ui, NovaModelShape value)
{
    NovaModelDocument candidate = ui->model;
    if (nova_model_add(&candidate,value,ui->message,sizeof(ui->message)) && nova_model_ui_apply(ui,&candidate)) {
        ui->selected = candidate.count-1; fields(ui);
    }
}

static void demo(NovaModelUI *ui)
{
    NovaModelDocument candidate;
    nova_model_init(&candidate);
    for (int i = 0; i < 3; ++i) {
        if (!nova_model_add(&candidate,(NovaModelShape)i,ui->message,sizeof(ui->message))) return;
        candidate.primitives[i].position[0] = (float)(i-1)*2;
        memset(candidate.primitives[i].color,0,3);
        candidate.primitives[i].color[i] = 255;
    }
    candidate.primitives[1].rotation[1] = 30;
    candidate.primitives[2].scale[1] = 1.5f;
    nova_model_ui_apply(ui,&candidate);
}

static void zoom(NovaModelUI *ui, float factor)
{
    NovaVec3 p=ui->view.frame.camera_position;
    float distance=sqrtf(p.x*p.x+p.y*p.y+p.z*p.z);
    float desired=fmaxf(2.0f,fminf(30.0f,distance*factor));
    if (distance>0) {
        float scale=desired/distance;
        ui->view.frame.camera_position=(NovaVec3){p.x*scale,p.y*scale,p.z*scale};
    }
}

static bool property_visible(Rectangle box, int y, int height)
{
    return y >= box.y && y+height <= box.y+box.height;
}

static void property_label(Rectangle box, const char *text, int x, int y, int width, Color color)
{
    if (property_visible(box,y,22)) nova_ui_label(text,x,y,width,color);
}

static bool property_field(NovaModelUI *ui, Rectangle viewport, Rectangle box,
    char *text, size_t capacity, bool *focus)
{
    if (!property_visible(viewport,(int)box.y,(int)box.height)) { *focus = false; return false; }
    return nova_ui_field_checked(box,text,capacity,focus,ui->message,sizeof(ui->message));
}

static void texture_browse(NovaModelUI *ui)
{
    if (ui->texture_files.paths) UnloadDirectoryFiles(ui->texture_files);
    ui->texture_files = LoadDirectoryFiles(ui->texture_location);
    ui->texture_scroll = 0;
}

static void texture_sheet(NovaModelUI *ui, int width, int height)
{
    int x = width/2-360, y = height/2-280;
    DrawRectangle(0,0,width,height,(Color){0,0,0,140});
    DrawRectangleRounded((Rectangle){(float)x,(float)y,720,560},.03f,8,nova_ui_style()->panel);
    nova_ui_label("Import PNG / selected part material",x+20,y+20,680,ink);
    nova_ui_label("Opaque RGB/RGBA; <=1024 x 1024, 1 MiB. Copied, never linked externally.",x+20,y+56,680,muted);
    if (nova_ui_button((Rectangle){(float)x+20,(float)y+88,75,32},"Up",true)) {
        const char *parent = GetPrevDirectoryPath(ui->texture_location);
        char copy[NOVA_NATIVE_PATH_CAPACITY]; snprintf(copy,sizeof(copy),"%s",parent);
        snprintf(ui->texture_location,sizeof(ui->texture_location),"%s",copy); texture_browse(ui);
    }
    nova_ui_label(ui->texture_location,x+108,y+96,590,muted);
    Rectangle list = {(float)x+20,(float)y+132,680,240};
    if (CheckCollisionPointRec(GetMousePosition(),list)) ui->texture_scroll -= (int)(GetMouseWheelMove()*3);
    if (ui->texture_scroll < 0) ui->texture_scroll = 0;
    int count = 0, row = 0;
    for (unsigned i = 0; i < ui->texture_files.count; ++i) {
        const char *path = ui->texture_files.paths[i];
        bool dir = DirectoryExists(path);
        if (!dir && !IsFileExtension(path,".png")) continue;
        int index = count++;
        if (index < ui->texture_scroll || row == 7) continue;
        if (nova_ui_select_button((Rectangle){list.x,list.y+row*33,list.width,30},GetFileName(path),
            !strcmp(path,ui->texture_path),true)) {
            if (dir) {
                snprintf(ui->texture_location,sizeof(ui->texture_location),"%s",path);
                texture_browse(ui); break;
            }
            snprintf(ui->texture_path,sizeof(ui->texture_path),"%s",path);
        }
        ++row;
    }
    if (ui->texture_scroll > count-7) ui->texture_scroll = count > 7 ? count-7 : 0;
    nova_ui_label("Selected PNG (or type a local file path)",x+20,y+388,680,muted);
    nova_ui_field_checked((Rectangle){(float)x+20,(float)y+414,680,32},ui->texture_path,
        sizeof(ui->texture_path),&ui->texture_path_focus,ui->message,sizeof(ui->message));
    nova_ui_label(ui->message,x+20,y+458,680,ink);
    if (nova_ui_button((Rectangle){(float)x+20,(float)y+506,140,34},"Cancel",true)) ui->texture_sheet = false;
    if (nova_ui_button((Rectangle){(float)x+172,(float)y+506,120,34},"Details",true)) {
        ui->details=true; nova_ui_text_reset(&ui->details_editor);
    }
    if (nova_ui_button((Rectangle){(float)x+490,(float)y+506,210,34},"Import and assign PNG",*ui->texture_path != 0)) ui->import_texture = true;
}

Rectangle nova_model_ui_preview(int width, int height)
{
    return (Rectangle){236,148,(float)width-564,(float)height-244};
}

static const char *texture_name(const NovaModelUI *ui, unsigned index)
{
    if (!index) return "Colour only";
    const char *name=GetFileName(ui->model.textures[index-1]);
    char prefix[NOVA_PROJECT_PATH_CAPACITY+32];
    snprintf(prefix,sizeof(prefix),"%s.texture_%u.",GetFileName(ui->target.relative),index);
    if (!strncmp(name,prefix,strlen(prefix))) name+=strlen(prefix);
    if (!strcmp(name,"png")) return TextFormat("Texture %u",index);
    return name;
}

static bool swatch(const NovaModelUI *ui, unsigned index, Rectangle box, Color color)
{
    bool available=!index;
    DrawRectangleRec(box,index ? nova_ui_style()->field : color);
    if (index && !ui->stale && ui->view.resources.count &&
        index <= ui->view.resources.resources[0].images.count) {
        Texture2D texture=ui->view.resources.resources[0].images.textures[index-1];
        if (texture.id) {
            DrawTexturePro(texture,(Rectangle){0,0,(float)texture.width,(float)texture.height},box,(Vector2){0},0,WHITE);
            available=true;
        }
    }
    if (!available) DrawLineEx((Vector2){box.x+4,box.y+4},(Vector2){box.x+box.width-4,box.y+box.height-4},2,muted);
    DrawRectangleLinesEx(box,1,nova_ui_style()->border);
    return available;
}

static void material_sheet(NovaModelUI *ui, int width, int height)
{
    int x=width/2-300, y=height/2-265;
    DrawRectangle(0,0,width,height,(Color){0,0,0,150});
    DrawRectangleRounded((Rectangle){(float)x,(float)y,600,530},.04f,8,nova_ui_style()->panel);
    nova_ui_label("Choose a texture",x+20,y+20,560,ink);
    nova_ui_label("Click a named image to assign it to the selected part.",x+20,y+54,560,muted);
    Rectangle list={(float)x+20,(float)y+92,560,350};
    int count=(int)ui->model.texture_count+1;
    if (CheckCollisionPointRec(GetMousePosition(),list)) ui->material_scroll-=(int)(GetMouseWheelMove()*3);
    int maximum=count-5;
    if (ui->material_scroll>maximum) ui->material_scroll=maximum;
    if (ui->material_scroll<0) ui->material_scroll=0;
    for (int row=0;row<5 && row+ui->material_scroll<count;++row) {
        unsigned index=(unsigned)(row+ui->material_scroll);
        Rectangle box={list.x,list.y+row*68,list.width,60};
        bool selected=ui->model.primitives[ui->selected].texture==index;
        if (nova_ui_select_button(box,"",selected,true)) {
            NovaModelDocument candidate=ui->model;
            candidate.primitives[ui->selected].texture=index;
            if (nova_model_ui_apply(ui,&candidate)) ui->materials=false;
        }
        bool available=swatch(ui,index,(Rectangle){box.x+8,box.y+8,44,44},(Color){
            ui->model.primitives[ui->selected].color[0],ui->model.primitives[ui->selected].color[1],
            ui->model.primitives[ui->selected].color[2],255});
        nova_ui_label(texture_name(ui,index),(int)box.x+66,(int)box.y+12,480,selected ? WHITE : ink);
        nova_ui_label(!available ? "Thumbnail unavailable" : selected ? "Selected" : index ? "Assign this texture" : "Use the part's colour",
            (int)box.x+66,(int)box.y+34,480,selected ? WHITE : muted);
    }
    if (nova_ui_button((Rectangle){(float)x+20,(float)y+474,140,34},"Cancel",true)) ui->materials=false;
    nova_ui_label(count>5 ? "Scroll for more textures" : "Import another image from the Inspector.",x+180,y+484,400,muted);
}

static void advanced_sheet(NovaModelUI *ui, int width, int height)
{
    int x=width/2-380, y=height/2-280;
    DrawRectangle(0,0,width,height,(Color){0,0,0,150});
    DrawRectangleRounded((Rectangle){(float)x,(float)y,760,560},.04f,8,nova_ui_style()->panel);
    nova_ui_label("Advanced / model files and repair",x+20,y+20,720,ink);
    nova_ui_label("GLB is the portable 3D file used by the game. Editable parts stay in a separate source file.",x+20,y+54,720,muted);
    nova_ui_label("Editable source (project-relative)",x+20,y+92,720,muted);
    if (ui->beginner) nova_ui_label(ui->source_path,x+20,y+122,720,ink);
    else nova_ui_field_checked((Rectangle){(float)x+20,(float)y+120,720,34},
        ui->source_path,sizeof(ui->source_path),&ui->source_focus,ui->message,sizeof(ui->message));
    if (nova_ui_button((Rectangle){(float)x+20,(float)y+170,200,34},"Save source only",!ui->values_dirty)) ui->save=true;
    if (nova_ui_button((Rectangle){(float)x+232,(float)y+170,210,34},ui->beginner ? "Reopen saved parts" : "Open / new source",true)) {
        if (nova_document_dirty(&ui->source) || ui->values_dirty || ui->export_pending) ui->decision=NOVA_MODEL_DECISION_OPEN;
        else ui->reopen=true;
    }
    nova_ui_label("Game model / export destination",x+20,y+228,720,muted);
    nova_ui_label(ui->target.relative,x+20,y+256,720,ink);
    if (nova_ui_button((Rectangle){(float)x+20,(float)y+292,240,34},"Export GLB separately...",ui->model.count && !ui->values_dirty))
        ui->check_export=true;
    nova_ui_label("Separate operations can leave source and game model different until both are saved.",x+20,y+340,720,muted);
    NovaSceneInspection inspection=nova_inspect_scene(ui->view.engine,&ui->view.resources);
    if (inspection.count) {
        const NovaAssetInspection *a=&inspection.assets[0];
        nova_ui_label(TextFormat("Preview: %zu parts / %zu vertices / %zu bytes; upload revision %zu",
            a->primitives,a->vertices,a->input_bytes,ui->view.revisions),x+20,y+378,720,muted);
        nova_ui_label(TextFormat("Bounds: (%.2f, %.2f, %.2f) to (%.2f, %.2f, %.2f)",
            a->bounds_min.x,a->bounds_min.y,a->bounds_min.z,a->bounds_max.x,a->bounds_max.y,a->bounds_max.z),
            x+20,y+404,720,muted);
    }
    if (nova_ui_button((Rectangle){(float)x+20,(float)y+456,180,34},"Original colour demo",!ui->model.count)) demo(ui);
    if (nova_ui_button((Rectangle){(float)x+560,(float)y+506,180,34},"Back to model",true)) {
        ui->advanced=false; ui->source_focus=false;
    }
    nova_ui_label(ui->message,12,height-31,width-130,muted);
    if (nova_ui_button((Rectangle){(float)width-108,(float)height-35,94,28},"Details",true)) {
        ui->details=true; nova_ui_text_reset(&ui->details_editor);
    }
}

void nova_model_ui_draw(NovaModelUI *ui, Rectangle preview)
{
    int width=GetScreenWidth(), height=GetScreenHeight(), x=width-300, w=284;
    DrawRectangle(0,0,width,58,nova_ui_style()->panel);
    DrawRectangle(0,62,220,height-104,nova_ui_style()->panel);
    DrawRectangle(width-312,62,312,height-104,nova_ui_style()->panel);
    DrawLine(220,62,220,height-42,nova_ui_style()->border);
    DrawLine(width-312,62,width-312,height-42,nova_ui_style()->border);
    DrawRectangle(0,height-42,width,42,nova_ui_style()->panel);
    if (ui->decision != NOVA_MODEL_DECISION_NONE) { modal(ui,width,height); return; }
    if (ui->details) {
        DrawRectangle(0,62,width,height-104,nova_ui_style()->background);
        nova_ui_label("Model / full diagnostic",20,80,width-40,ink);
        char wrapped[1152];
        size_t length=0, column=0;
        size_t columns=(size_t)fmaxf(32,(width-64)/nova_ui_code_cell());
        for (size_t i=0;ui->message[i];++i) {
            unsigned char c=(unsigned char)ui->message[i];
            if (column>=columns && (c&0xc0)!=0x80) {
                wrapped[length++]='\n'; column=0;
            }
            wrapped[length++]=(char)c;
            column=c=='\n' ? 0 : column+1;
        }
        wrapped[length]=0;
        NovaDocument diagnostic={.text=wrapped,.length=length};
        nova_ui_text(&ui->details_editor,&diagnostic,(Rectangle){20,118,(float)width-40,(float)height-224},false,ui->message,sizeof(ui->message));
        if (nova_ui_button((Rectangle){20,(float)height-88,180,34},
            ui->texture_sheet ? "Back to import" : ui->advanced ? "Back to Advanced" : "Back to model",true)) ui->details=false;
        return;
    }
    if (ui->texture_sheet) { texture_sheet(ui,width,height); return; }
    if (ui->materials) { material_sheet(ui,width,height); return; }
    if (ui->advanced) { advanced_sheet(ui,width,height); return; }
    if (nova_ui_button((Rectangle){12,11,206,34},"Return to project",true)) nova_model_ui_request_close(ui);
    nova_ui_label(nova_document_dirty(&ui->source) || ui->export_pending || ui->values_dirty ? "Model  /  Unsaved" : "Model",236,19,width-540,ink);
    if (nova_ui_button((Rectangle){(float)width-240,11,112,34},"Advanced...",true)) ui->advanced=true;
    bool can_save=ui->model.count && !ui->values_dirty;
    if (nova_ui_icon_button((Rectangle){(float)width-116,11,102,34},"Save",NOVA_ICON_SAVE,true,can_save,
        "Save editable parts and game model (Ctrl/Cmd-S)",ui->values_dirty ? "Apply or Reset Inspector edits before saving" : "Add a part before saving"))
        ui->save_model=true;
    if (nova_ui_command() && IsKeyPressed(KEY_S)) {
        if (can_save) ui->save_model=true;
        else message(ui,ui->values_dirty ? "Apply or Reset Inspector edits before saving." : "Add a part before saving.");
    }
    nova_ui_label("Parts",12,78,206,ink);
    const char *names[]={"Box","Pyramid","Cylinder"};
    for (int i=0;i<3;++i)
        if (nova_ui_icon_button((Rectangle){12,110+(float)i*40,196,34},names[i],NOVA_ICON_ADD,false,
            ui->model.count<NOVA_MODEL_PRIMITIVES && !ui->values_dirty,
            "Add a part; edit its name and shape in the Inspector",
            ui->values_dirty ? "Apply or Reset Inspector edits before adding a part" : "A model can contain at most 64 parts"))
            add_shape(ui,(NovaModelShape)i);
    nova_ui_label(TextFormat("%zu parts",ui->model.count),12,240,196,muted);
    Rectangle list={12,270,196,(float)height-378};
    if (CheckCollisionPointRec(GetMousePosition(),list)) ui->scroll-=(int)(GetMouseWheelMove()*3);
    int maximum=(int)ui->model.count-(int)(list.height/34);
    if (ui->scroll>maximum) ui->scroll=maximum;
    if (ui->scroll<0) ui->scroll=0;
    for (size_t i=(size_t)ui->scroll;i<ui->model.count;++i) {
        float y=list.y+(i-(size_t)ui->scroll)*34;
        if (y+30>list.y+list.height) break;
        if (nova_ui_select_button((Rectangle){12,y,196,30},ui->model.primitives[i].name,ui->selected==i,true)) {
            if (ui->values_dirty) message(ui,"Apply or Reset Inspector edits before selecting another part.");
            else { ui->selected=i; fields(ui); }
        }
    }
    if (nova_ui_icon_button((Rectangle){12,(float)height-88,196,34},"Delete part...",NOVA_ICON_DELETE,false,
        ui->model.count && !ui->values_dirty,"Delete selected part (confirmation required)",
        ui->values_dirty ? "Apply or Reset Inspector edits before deleting" : "Select a part to delete"))
        ui->decision=NOVA_MODEL_DECISION_DELETE;
    nova_ui_label("Model view",236,78,(int)preview.width,ink);
    if (nova_ui_button((Rectangle){236,106,82,30},"Front",ui->ready)) ui->view.frame.camera_position=(NovaVec3){0,0,10};
    if (nova_ui_button((Rectangle){326,106,118,30},"Perspective",ui->ready)) ui->view.frame.camera_position=(NovaVec3){5,3,9};
    if (nova_ui_button((Rectangle){452,106,74,30},"Side",ui->ready)) ui->view.frame.camera_position=(NovaVec3){10,0,0};
    if (nova_ui_button((Rectangle){534,106,88,30},"Zoom +",ui->ready)) zoom(ui,.8f);
    if (nova_ui_button((Rectangle){630,106,88,30},"Zoom -",ui->ready)) zoom(ui,1.25f);
    DrawRectangleLinesEx(preview,1,ui->stale ? RED : nova_ui_style()->border);
    if (ui->stale || !ui->ready) {
        nova_ui_label(ui->stale ? "Preview could not refresh. Previous view retained." : "Add a part to see your model.",
            (int)preview.x+12,(int)preview.y+16,(int)preview.width-24,ui->stale ? RED : muted);
        if (ui->stale && nova_ui_button((Rectangle){preview.x+12,preview.y+48,160,32},"Retry preview",true)) {
            ui->refresh=true;
            if (!*ui->view.directory) ui->view_attempted=false;
        }
    }
    if (ui->ready && CheckCollisionPointRec(GetMousePosition(),preview)) {
        float wheel=GetMouseWheelMove();
        if (wheel) zoom(ui,expf(-wheel*.15f));
    }
    nova_ui_label("Add parts  >  Choose a texture  >  Save  >  Create an object in your project",
        236,height-76,(int)preview.width,muted);
    nova_ui_label("Inspector",x,78,w,ink);
    if (ui->model.count) {
        NovaModelPrimitive *p=&ui->model.primitives[ui->selected];
        Rectangle properties={(float)x,112,(float)w,(float)height-250};
        int content=578+(p->shape==NOVA_SHAPE_CYLINDER ? 48 : 0);
        if (CheckCollisionPointRec(GetMousePosition(),properties))
            ui->property_scroll-=(int)(GetMouseWheelMove()*35);
        int max=content-(int)properties.height;
        if (ui->property_scroll>max) ui->property_scroll=max;
        if (ui->property_scroll<0) ui->property_scroll=0;
        int y=112-ui->property_scroll;
        property_label(properties,"Name",x,y,w,muted); y+=24;
        if (property_field(ui,properties,(Rectangle){(float)x,(float)y,(float)w,34},
            ui->part_name,sizeof(ui->part_name),&ui->name_focus)) ui->values_dirty=true;
        y+=48;
        const char *labels[]={"Position","Rotation (degrees)","Scale","Colour (0-255)"};
        const char *axes[]={"X","Y","Z","R","G","B"};
        for (int row=0;row<4;++row) {
            int offset=row<3 ? 26 : 0;
            if (row<3 && property_visible(properties,y,22))
                nova_ui_icon(row==0 ? NOVA_ICON_MOVE : row==1 ? NOVA_ICON_ROTATE : NOVA_ICON_SCALE,
                    (Vector2){(float)x+9,(float)y+9},muted);
            property_label(properties,labels[row],x+offset,y,w-offset,muted); y+=25;
            for (int a=0;a<3;++a) {
                property_label(properties,axes[(row==3 ? 3 : 0)+a],x+a*96,y,20,muted);
                if (property_field(ui,properties,(Rectangle){(float)x+a*96+20,(float)y,72,34},
                    ui->fields[row*3+a],32,&ui->field_focus[row*3+a])) ui->values_dirty=true;
            }
            y+=49;
        }
        if (p->shape==NOVA_SHAPE_CYLINDER) {
            property_label(properties,"Cylinder sides (3-32)",x,y,w,muted);
            if (property_field(ui,properties,(Rectangle){(float)x+206,(float)y,78,34},
                ui->fields[12],32,&ui->field_focus[12])) ui->values_dirty=true;
            y+=48;
        }
        property_label(properties,"Texture",x,y,w,ink); y+=26;
        if (property_visible(properties,y,48)) {
            bool available=swatch(ui,p->texture,(Rectangle){(float)x,(float)y,44,44},(Color){p->color[0],p->color[1],p->color[2],255});
            nova_ui_label(texture_name(ui,p->texture),x+54,y+4,w-54,ink);
            nova_ui_label(!available ? "Thumbnail unavailable" : p->texture ? "Image tinted by Colour" : "No image assigned",x+54,y+25,w-54,muted);
        }
        y+=56;
        if (property_visible(properties,y,34) &&
            nova_ui_button((Rectangle){(float)x,(float)y,(float)w,34},"Choose texture...",!ui->values_dirty))
            ui->materials=true;
        y+=44;
        if (property_visible(properties,y,34) &&
            nova_ui_icon_button((Rectangle){(float)x,(float)y,(float)w,34},"Import texture...",NOVA_ICON_ADD,false,
                !ui->values_dirty && ui->model.texture_count<NOVA_MODEL_MATERIALS,
                "Copy an opaque PNG into this model and assign it",ui->values_dirty ? "Apply or Reset Inspector edits before importing" : "At most 16 textures per model")) {
            ui->texture_sheet=true; ui->texture_path[0]=0;
            snprintf(ui->texture_location,sizeof(ui->texture_location),"%s",ui->target.root); texture_browse(ui);
        }
        nova_ui_label(ui->values_dirty ? "Unapplied edits" : max>0 ? "Scroll Inspector for texture controls" : shape(p->shape),x,height-124,w,muted);
        if (nova_ui_button((Rectangle){(float)x,(float)height-88,138,34},"Apply",ui->values_dirty) ||
            (ui->values_dirty && IsKeyPressed(KEY_ENTER))) parse_fields(ui);
        if (nova_ui_button((Rectangle){(float)x+146,(float)height-88,138,34},"Reset",ui->values_dirty)) fields(ui);
    } else nova_ui_label("Add a part to start.",x,120,w,muted);
    const char *summary=ui->message;
    if (strstr(summary,"PARTIAL MODEL SAVE") || strstr(summary,"Source saved (1 of 2"))
        summary="Save incomplete: editable parts were written, but the game model was not. Open Details.";
    else if (ui->stale) summary="Preview could not refresh. Your changes and previous preview are retained. Open Details.";
    else if (ui->values_dirty) summary="Inspector edits are not applied. Apply to update the model, or Reset to discard those edits.";
    nova_ui_label(summary,12,height-31,width-130,ui->stale || strstr(ui->message,"PARTIAL MODEL SAVE") ? RED : muted);
    if (nova_ui_button((Rectangle){(float)width-108,(float)height-35,94,28},"Details",true)) {
        ui->details=true; nova_ui_text_reset(&ui->details_editor);
    }
}
