#include "model_ui.h"
#include "widgets.h"

#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const Color ink = {226,234,246,255}, muted = {153,170,195,255}, accent = {77,225,201,255};

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
    ui->selected = 0; ui->scroll = 0; ui->refresh = true;
    fields(ui);
    message(ui, candidate.saved.info.st_ino ? "Reopened authored source; native preview stages next frame" :
        "New unsaved source. Imported meshes are not reconstructed; add original primitives and Save source.");
    return true;
}

void nova_model_ui_close(NovaModelUI *ui)
{
    nova_ui_text_reset(&ui->disk_editor);
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
        if (count < 0 || (size_t)count >= sizeof(candidate->source_path))
            strcpy(candidate->source_path, "authored.nova-model");
        ok = nova_document_open_output(&candidate->target, root, model_path, NOVA_ASSET_FILE_LIMIT,
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
    ui->refresh = true;
    fields(ui);
    message(ui, "Authored draft changed; native resources stage once next frame. Save and Export are explicit.");
    return true;
}

void nova_model_ui_request_close(NovaModelUI *ui)
{
    if (nova_document_dirty(&ui->source) || ui->values_dirty) ui->decision = NOVA_MODEL_DECISION_EXIT;
    else ui->close = true;
}

static bool export_model(NovaModelUI *ui)
{
    ui->inspected_export = false;
    ui->exported = false;
    unsigned char *bytes = NULL;
    size_t length;
    if (!nova_model_glb(&ui->model, &bytes, &length, ui->message, sizeof(ui->message))) return false;
    bool ok = nova_document_replace(&ui->target, 0, ui->target.length, (char *)bytes, length,
        ui->message, sizeof(ui->message)) && nova_document_save(&ui->target, ui->overwrite, ui->message, sizeof(ui->message));
    free(bytes);
    if (!ok) return false;
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
    if (!*ui->view.directory && !ui->view_attempted) {
        ui->view_attempted = true;
        if (!nova_model_view_open(&ui->view, ui->message, sizeof(ui->message))) {
            ui->stale = true; ui->refresh = false;
            return;
        }
    }
    if (ui->reopen) {
        ui->reopen = false;
        source_open(ui, ui->target.root);
    }
    if (ui->refresh && *ui->view.directory) {
        ui->refresh = false;
        ui->stale = !nova_model_view_stage(&ui->view, &ui->model, ui->message, sizeof(ui->message));
        if (!ui->stale) ui->ready = true;
        else TraceLog(LOG_WARNING, "MODELLER: native preview failed, old live view retained: %s", ui->message);
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
        if (!export_model(ui) && ui->target.has_conflict) {
            ui->decision = NOVA_MODEL_DECISION_EXPORT_CONFLICT;
            ui->summarized_decision = NOVA_MODEL_DECISION_NONE;
        }
        ui->overwrite = false;
    }
}

static bool parse_fields(NovaModelUI *ui)
{
    NovaModelDocument candidate = ui->model;
    NovaModelPrimitive *p = &candidate.primitives[ui->selected];
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
    if (ui->review_disk) {
        DrawRectangle(0,0,width,height,(Color){19,27,39,255});
        nova_ui_label("READ ONLY / exact observed disk source; scroll to review",20,20,width-40,accent);
        NovaDocument disk = {.text=ui->source.conflict.text,.length=ui->source.conflict.length};
        nova_ui_text(&ui->disk_editor,&disk,(Rectangle){20,60,(float)width-40,(float)height-130},
            false,ui->message,sizeof(ui->message));
        if (nova_ui_button((Rectangle){20,(float)height-55,230,35},"Return to version decision",true)) ui->review_disk=false;
        return;
    }
    int x = (width-820)/2, y = (height-340)/2;
    DrawRectangle(0,0,width,height,(Color){0,0,0,190});
    DrawRectangle(x,y,820,340,(Color){31,43,59,255});
    bool conflict = ui->decision == NOVA_MODEL_DECISION_SAVE_CONFLICT ||
        ui->decision == NOVA_MODEL_DECISION_EXPORT_CONFLICT;
    bool binary = ui->decision == NOVA_MODEL_DECISION_EXPORT || ui->decision == NOVA_MODEL_DECISION_EXPORT_CONFLICT;
    NovaDocument *doc = binary ? &ui->target : &ui->source;
    nova_ui_label(conflict ? "EXTERNAL EDIT / exact observed disk-version decision" :
        binary ? "REPLACE EXISTING GLB / explicit overwrite decision" : "UNSAVED SOURCE / explicit discard decision",
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
                MemFree(model.meshes[i].vertices); MemFree(model.meshes[i].colors);
            }
            snprintf(ui->disk_summary,sizeof(ui->disk_summary),"Observed native GLB: %d primitives, %zu vertices. Imported meshes are not reconstructed as source.",
                model.meshCount,vertices);
            MemFree(model.meshes); MemFree(model.materials); MemFree(model.meshMaterial);
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
        ui->decision = NOVA_MODEL_DECISION_NONE; return;
    }
    const char *action = binary ? "Overwrite shown version" :
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

void nova_model_ui_draw(NovaModelUI *ui, Rectangle preview)
{
    int width = GetScreenWidth(), height = GetScreenHeight(), right = (int)preview.x;
    DrawText("NOVA / original static low-poly modeller",16,18,18,accent);
    if (ui->decision != NOVA_MODEL_DECISION_NONE) { modal(ui,width,height); return; }
    if (nova_ui_button((Rectangle){12,65,206,33},"Return to project",true)) nova_model_ui_request_close(ui);
    nova_ui_label("AUTHORED PRIMITIVES",12,113,206,accent);
    char line[512];
    snprintf(line,sizeof(line),"%zu/64  next stable ID=%u",ui->model.count,ui->model.next_id);
    nova_ui_label(line,12,141,206,muted);
    Rectangle list = {12,174,206,(float)(height-350)};
    if (CheckCollisionPointRec(GetMousePosition(),list)) {
        ui->scroll -= (int)(GetMouseWheelMove()*3);
        int maximum = (int)ui->model.count - (int)(list.height/34);
        if (ui->scroll > maximum) ui->scroll = maximum;
        if (ui->scroll < 0) ui->scroll = 0;
    }
    for (size_t i = (size_t)ui->scroll; i < ui->model.count; ++i) {
        float y = list.y + (float)(i-(size_t)ui->scroll)*34;
        if (y+31 > list.y+list.height) break;
        snprintf(line,sizeof(line),"%s #%u %s",ui->selected == i ? ">" : "",ui->model.primitives[i].id,shape(ui->model.primitives[i].shape));
        if (nova_ui_button((Rectangle){12,y,206,29},line,true)) {
            if (ui->values_dirty) message(ui,"Apply or Reset the typed values before changing selection");
            else { ui->selected=i; fields(ui); }
        }
    }
    if (nova_ui_button((Rectangle){12,(float)height-153,206,33},"Original RGB demo",ui->model.count == 0)) demo(ui);
    nova_ui_label("Source stays separate from GLB",12,height-110,206,muted);
    nova_ui_label("No skins, animation or textures",12,height-87,206,muted);
    int x=236, y=65, central=right-x-16;
    nova_ui_label("CREATE / select / delete / edit",x,y,central,accent); y+=35;
    for (int i=0;i<3;++i)
        if (nova_ui_button((Rectangle){(float)x+i*117,(float)y,109,33},shape((NovaModelShape)i),
            ui->model.count < NOVA_MODEL_PRIMITIVES && !ui->values_dirty)) add_shape(ui,(NovaModelShape)i);
    y+=45;
    if (ui->model.count) {
        NovaModelPrimitive *p=&ui->model.primitives[ui->selected];
        snprintf(line,sizeof(line),"Selected stable ID %u / %s",p->id,shape(p->shape));
        nova_ui_label(line,x,y,central,ink); y+=29;
        const char *labels[]={"Position XYZ","Rotation XYZ degrees","Scale XYZ","Opaque RGB"};
        for (int row=0;row<4;++row) {
            nova_ui_label(labels[row],x,y,central,muted); y+=23;
            for (int a=0;a<3;++a)
                if (nova_ui_field_checked((Rectangle){(float)x+a*112,(float)y,104,33},ui->fields[row*3+a],32,&ui->field_focus[row*3+a],
                    ui->message,sizeof(ui->message)))
                    ui->values_dirty = true;
            y+=42;
        }
        if (p->shape==NOVA_SHAPE_CYLINDER) {
            nova_ui_label("Cylinder sides 3..32",x,y+8,190,muted);
            if (nova_ui_field_checked((Rectangle){(float)x+195,(float)y,104,33},ui->fields[12],32,&ui->field_focus[12],
                ui->message,sizeof(ui->message)))
                ui->values_dirty = true;
            y+=42;
        }
        if (nova_ui_button((Rectangle){(float)x,(float)y,155,33},"Apply values",true) ||
            (IsKeyPressed(KEY_ENTER) && !ui->source_focus)) parse_fields(ui);
        if (nova_ui_button((Rectangle){(float)x+163,(float)y,155,33},"Delete selected",!ui->values_dirty)) {
            NovaModelDocument candidate=ui->model;
            memmove(&candidate.primitives[ui->selected],&candidate.primitives[ui->selected+1],
                (candidate.count-ui->selected-1)*sizeof(candidate.primitives[0]));
            --candidate.count;
            memset(&candidate.primitives[candidate.count],0,sizeof(candidate.primitives[0]));
            nova_model_ui_apply(ui,&candidate);
        }
        if (nova_ui_button((Rectangle){(float)x+326,(float)y,105,33},"Reset values",ui->values_dirty)) fields(ui);
    } else nova_ui_label("Create a primitive or use the original RGB demo.",x,y,central,ink);
    y=height-219;
    nova_ui_label("Editable .nova-model source (project-relative)",x,y,central,accent); y+=25;
    nova_ui_field_checked((Rectangle){(float)x,(float)y,(float)central,33},ui->source_path,sizeof(ui->source_path),&ui->source_focus,
        ui->message,sizeof(ui->message)); y+=41;
    if (nova_ui_button((Rectangle){(float)x,(float)y,155,33},"Open / new source",true)) {
        if (nova_document_dirty(&ui->source) || ui->values_dirty) ui->decision=NOVA_MODEL_DECISION_OPEN;
        else ui->reopen=true;
    }
    if (nova_ui_button((Rectangle){(float)x+163,(float)y,155,33},nova_document_dirty(&ui->source) ? "Save source *" : "Save source",!ui->values_dirty) ||
        (!ui->values_dirty && nova_ui_command() && IsKeyPressed(KEY_S))) ui->save=true;
    y+=43;
    snprintf(line,sizeof(line),"Active source: %s",ui->source.relative);
    nova_ui_label(line,x,y,central,muted);
    if (nova_ui_button((Rectangle){preview.x,65,164,33},"Export declared GLB",ui->model.count>0 && !ui->values_dirty)) {
        ui->check_export=true;
    }
    if (nova_ui_button((Rectangle){preview.x+172,65,126,33},"Retry preview",ui->stale)) {
        ui->refresh=true;
        if (!*ui->view.directory) ui->view_attempted=false;
    }
    DrawRectangleLinesEx(preview,1,ui->stale ? RED : muted);
    DrawRectangle((int)preview.x+2,(int)preview.y+2,(int)preview.width-4,28,(Color){19,27,39,245});
    nova_ui_label(ui->stale ? "PREVIEW FAILED / prior revision retained" :
        !ui->ready || ui->refresh ? "PENDING native staging" : "NATIVE MODEL PREVIEW / auto-fit draw instance",
        (int)preview.x+8,(int)preview.y+8,(int)preview.width-16,ui->stale ? RED : accent);
    y=(int)(preview.y+preview.height+12); x=(int)preview.x;
    nova_ui_label("Declared GLB destination (saved project)",x,y,(int)preview.width,accent); y+=24;
    nova_ui_label(ui->target.relative,x,y,(int)preview.width,ink); y+=28;
    NovaSceneInspection inspection=nova_inspect_scene(ui->view.engine,&ui->view.resources);
    if (inspection.count) {
        const NovaAssetInspection *asset=&inspection.assets[0];
        snprintf(line,sizeof(line),"Live native: %zu primitives / %zu vertices / %zu bytes",asset->primitives,asset->vertices,asset->input_bytes);
        nova_ui_label(line,x,y,(int)preview.width,ink); y+=24;
        snprintf(line,sizeof(line),"Authored bounds (%.2f %.2f %.2f)..(%.2f %.2f %.2f)",
            asset->bounds_min.x,asset->bounds_min.y,asset->bounds_min.z,asset->bounds_max.x,asset->bounds_max.y,asset->bounds_max.z);
        nova_ui_label(line,x,y,(int)preview.width,muted); y+=24;
    }
    snprintf(line,sizeof(line),"Native staging revision=%zu (only model edits)",ui->view.revisions);
    nova_ui_label(line,x,y,(int)preview.width,muted); y+=29;
    if (ui->inspected_export) {
        snprintf(line,sizeof(line),"Saved native export: %zu primitives / %zu vertices",ui->exported_asset.primitives,ui->exported_asset.vertices);
        nova_ui_label(line,x,y,(int)preview.width,accent); y+=24;
        snprintf(line,sizeof(line),"Saved bounds (%.2f %.2f %.2f)..(%.2f %.2f %.2f)",
            ui->exported_asset.bounds_min.x,ui->exported_asset.bounds_min.y,ui->exported_asset.bounds_min.z,
            ui->exported_asset.bounds_max.x,ui->exported_asset.bounds_max.y,ui->exported_asset.bounds_max.z);
        nova_ui_label(line,x,y,(int)preview.width,muted); y+=24;
    }
    nova_ui_label("View: front / perspective / side; wheel zoom",x,y,(int)preview.width,muted); y+=26;
    if (nova_ui_button((Rectangle){(float)x,(float)y,100,33},"Front",ui->ready)) ui->view.frame.camera_position=(NovaVec3){0,0,10};
    if (nova_ui_button((Rectangle){(float)x+108,(float)y,128,33},"Perspective",ui->ready)) ui->view.frame.camera_position=(NovaVec3){5,3,9};
    if (nova_ui_button((Rectangle){(float)x+244,(float)y,100,33},"Side",ui->ready)) ui->view.frame.camera_position=(NovaVec3){10,0,0};
    y+=40;
    if (nova_ui_button((Rectangle){(float)x,(float)y,100,33},"Zoom +",ui->ready)) zoom(ui,.8f);
    if (nova_ui_button((Rectangle){(float)x+108,(float)y,100,33},"Zoom -",ui->ready)) zoom(ui,1.25f);
    if (ui->ready && CheckCollisionPointRec(GetMousePosition(),preview)) {
        float wheel=GetMouseWheelMove();
        if (wheel) zoom(ui,expf(-wheel*.15f));
    }
    y+=50;
    const char *text=ui->message;
    for (int row=0;*text && row<6 && y+20<height-46;++row) {
        char excerpt[51];
        size_t count=0;
        while (text[count] && text[count]!='\n' && count<sizeof(excerpt)-1) ++count;
        memcpy(excerpt,text,count); excerpt[count]=0;
        nova_ui_label(excerpt,x,y,(int)preview.width,ink); y+=21;
        text+=count;
        if (*text=='\n') ++text;
    }
    nova_ui_label(ui->values_dirty ? "Unapplied typed values: Apply commits them to the source draft; Reset discards them. Save/export/selection are guarded." :
        ui->stale ? ui->message : "Static primitive source only; no arbitrary GLB reconstruction, skeletal authoring or Blender-like mesh editing.",
        12,height-32,width-24,ui->stale ? RED : muted);
}
