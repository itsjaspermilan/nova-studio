#include "game_ui.h"

#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define ERROR ui->message, sizeof(ui->message)
#define INK (nova_ui_style()->ink)
#define MUTED (nova_ui_style()->muted)

static void message(NovaGameUI *ui, const char *text)
{
    snprintf(ui->message, sizeof(ui->message), "%s", text);
}

static void browse(NovaGameUI *ui)
{
    if (!DirectoryExists(ui->location)) { message(ui, "Location is not an existing directory"); return; }
    UnloadDirectoryFiles(ui->files);
    ui->files = LoadDirectoryFiles(ui->location);
    ui->browser_scroll = 0;
}

static void values(NovaGameUI *ui)
{
    memset(ui->fields, 0, sizeof(ui->fields));
    memset(ui->field_focus, 0, sizeof(ui->field_focus));
    const NovaGame *g = &ui->project.data;
    const NovaGameInstance *n = nova_game_instance(g, ui->selected);
    const NovaGameObject *o = nova_game_object(g, ui->selected);
    const NovaGameRoom *r = nova_game_room(g, ui->selected);
    const NovaGameResource *a = nova_game_resource(g, ui->selected);
    const char *name = n ? n->name : o ? o->name : r ? r->name : a ? a->name : "";
    snprintf(ui->fields[0], sizeof(ui->fields[0]), "%s", name);
    float numbers[15] = {0};
    int count = 0;
    if (n) {
        numbers[0] = n->position.x; numbers[1] = n->position.y; numbers[2] = n->position.z;
        numbers[3] = n->scale; count = 4;
    } else if (o) {
        float v[] = {o->size, o->speed, o->create.x, o->create.y, o->create.z,
            o->velocity.x, o->velocity.y, o->velocity.z, o->primary.x, o->primary.y, o->primary.z};
        memcpy(numbers, v, sizeof(v)); count = 11;
    } else if (r) {
        float v[] = {r->snap, r->camera.x, r->camera.y, r->camera.z, r->target.x, r->target.y, r->target.z, r->fov};
        memcpy(numbers, v, sizeof(v)); count = 8;
    }
    for (int i = 0; i < count; ++i) snprintf(ui->fields[i+1], sizeof(ui->fields[0]), "%.9g", (double)numbers[i]);
    ui->values_dirty = false;
}

static bool clean_values(NovaGameUI *ui)
{
    if (!ui->values_dirty) return true;
    message(ui, "Apply or Reset the typed properties first; they have not been discarded or saved.");
    return false;
}

static void selection(NovaGameUI *ui, uint32_t id)
{
    ui->selected = id;
    ui->inspector_scroll = 0;
    ui->resource_view = false;
    const NovaGameRoom *room = nova_game_room(&ui->project.data, id);
    if (room) { ui->room = id; ui->place_tool = false; }
    const NovaGameInstance *instance = nova_game_instance(&ui->project.data,id);
    if (instance) { ui->room = instance->room; ui->palette = instance->object; }
    const NovaGameObject *object = nova_game_object(&ui->project.data, id);
    if (object) ui->palette = id;
    values(ui);
}

static bool apply(NovaGameUI *ui)
{
    NovaGame g = ui->project.data;
    float n[15] = {0};
    int count = nova_game_instance(&g, ui->selected) ? 4 :
        nova_game_object(&g, ui->selected) ? 11 : nova_game_room(&g, ui->selected) ? 8 : 0;
    for (int i = 0; i < count; ++i) {
        char *end;
        errno = 0;
        n[i] = strtof(ui->fields[i+1], &end);
        if (!*ui->fields[i+1] || *end || errno || !isfinite(n[i])) {
            message(ui, "Every numeric property must be a finite number; typed values retained."); return false;
        }
    }
    if (!nova_game_name(ui->fields[0])) { message(ui, "Name requires 1..31 ASCII letters/digits/underscore"); return false; }
    for (size_t i = 0; i < g.instances; ++i) if (g.instance[i].id == ui->selected) {
        NovaGameInstance *v = &g.instance[i];
        strcpy(v->name, ui->fields[0]); v->position = (NovaVec3){n[0],n[1],n[2]}; v->scale = n[3];
    }
    for (size_t i = 0; i < g.objects; ++i) if (g.object[i].id == ui->selected) {
        NovaGameObject *v = &g.object[i];
        strcpy(v->name, ui->fields[0]); v->size = n[0]; v->speed = n[1];
        v->create = (NovaVec3){n[2],n[3],n[4]}; v->velocity = (NovaVec3){n[5],n[6],n[7]};
        v->primary = (NovaVec3){n[8],n[9],n[10]};
    }
    for (size_t i = 0; i < g.rooms; ++i) if (g.room[i].id == ui->selected) {
        NovaGameRoom *v = &g.room[i];
        strcpy(v->name, ui->fields[0]); v->snap = n[0]; v->camera = (NovaVec3){n[1],n[2],n[3]};
        v->target = (NovaVec3){n[4],n[5],n[6]}; v->fov = n[7];
    }
    for (size_t i = 0; i < g.resources; ++i) if (g.resource[i].id == ui->selected)
        strcpy(g.resource[i].name, ui->fields[0]);
    if (!nova_game_commit(&ui->project, &g, ERROR)) return false;
    values(ui); message(ui, "Properties applied to draft; Undo restores the previous values. Save is explicit.");
    return true;
}

static bool fixture_write(NovaGameUI *ui, const char *name, const char *bytes, size_t length, bool binary)
{
    NovaDocument output = {0};
    bool ok = nova_document_open_output(&output, ui->fixture, name, NOVA_ASSET_FILE_LIMIT, binary, ERROR) &&
        nova_document_replace(&output, 0, output.length, bytes, length, ERROR) &&
        nova_document_save(&output, false, ERROR);
    nova_document_close(&output);
    return ok;
}

static bool fixture_cleanup(NovaGameUI *ui)
{
    if (!*ui->fixture) return true;
    bool ok = true;
    char path[NOVA_NATIVE_PATH_CAPACITY + 64];
    for (int i = 0; i < NOVA_MAX_ASSETS; ++i) {
        const char *extensions[] = {"png","glb"};
        for (size_t j = 0; j < 2; ++j) {
            snprintf(path, sizeof(path), "%s/appearance_%d.%s", ui->fixture, i,extensions[j]);
            if (unlink(path) && errno != ENOENT) ok = false;
        }
    }
    const char *files[] = {NOVA_GAME_MANIFEST, NOVA_GAME_LUA, "native.png", "runtime.png", "reopened.png"};
    for (size_t i = 0; i < 5; ++i) {
        snprintf(path, sizeof(path), "%s/%s", ui->fixture, files[i]);
        if (unlink(path) && errno != ENOENT) ok = false;
    }
    if (rmdir(ui->fixture)) ok = false;
    if (!ok) TraceLog(LOG_WARNING, "NOVA_GAME: private preview cleanup failed: %s", ui->fixture);
    else ui->fixture[0] = 0;
    return ok;
}

bool nova_game_ui_stage(NovaGameUI *ui)
{
    if (!ui->project.authored.text) return false;
    if (ui->ready && !ui->stale && ui->staged.resources == ui->project.data.resources &&
        !memcmp(ui->staged.resource, ui->project.data.resource, sizeof(ui->staged.resource))) return !ui->stale;
    char previous[sizeof(ui->message)];
    snprintf(previous,sizeof(previous),"%s",ui->message);
    NovaGame g = ui->project.data;
    for (size_t i = 0; i < g.resources; ++i) {
        char path[NOVA_NATIVE_PATH_CAPACITY];
        if (!nova_project_resolve(ui->project.authored.root, g.resource[i].path, path, ERROR)) goto failed;
        int length;
        unsigned char *bytes = nova_read_file(path, NOVA_ASSET_FILE_LIMIT, &length, ERROR);
        if (!bytes) goto failed;
        snprintf(g.resource[i].path, sizeof(g.resource[i].path), "appearance_%zu.%s", i,
            g.resource[i].type == NOVA_ASSET_SPRITE ? "png" : "glb");
        bool ok = fixture_write(ui, g.resource[i].path, (const char *)bytes, (size_t)length, true);
        free(bytes);
        if (!ok) goto failed;
    }
    char *m = NULL, *l = NULL;
    if (!nova_game_generate(&g, &m, &l, ERROR)) goto failed;
    bool written = fixture_write(ui, NOVA_GAME_LUA, l, strlen(l), false) &&
        fixture_write(ui, NOVA_GAME_MANIFEST, m, strlen(m), false);
    free(m); free(l);
    if (!written) goto failed;
    char path[NOVA_NATIVE_PATH_CAPACITY];
    if (!nova_project_resolve(ui->fixture, NOVA_GAME_MANIFEST, path, ERROR) ||
        !nova_open_scene(&ui->preview_engine, &ui->preview_resources, path, true, ERROR)) goto failed;
    ui->staged = ui->project.data; ui->ready = true; ui->stale = false;
    ui->preview_error[0] = 0; ++ui->revisions;
    snprintf(ui->message,sizeof(ui->message),"%s",previous);
    return true;
failed:
    ui->stale = true;
    snprintf(ui->preview_error, sizeof(ui->preview_error), "Preview staging failed; old resources/frame retained: %.900s", ui->message);
    message(ui,ui->preview_error);
    return false;
}

bool nova_game_ui_open(NovaGameUI *ui, const char *location, char *error, size_t size)
{
    *ui = (NovaGameUI){.new_mode = NOVA_2D, .snap = true, .sheet = NOVA_GAME_SHEET_NEW};
    snprintf(ui->name, sizeof(ui->name), "MyGame");
    snprintf(ui->location, sizeof(ui->location), "%s", location);
    strcpy(ui->fixture, "/tmp/nova-game-preview-XXXXXX");
    if (!mkdtemp(ui->fixture)) { snprintf(error, size, "Create private game preview: %s", strerror(errno)); ui->fixture[0] = 0; return false; }
    char canonical[NOVA_NATIVE_PATH_CAPACITY];
    if (!realpath(ui->fixture, canonical)) { snprintf(error, size, "Canonical preview path failed"); return false; }
    strcpy(ui->fixture, canonical);
    if (!nova_presentation_configure(&ui->presentation, nova_world_resolution_default(), error, size)) return false;
    browse(ui);
    message(ui, "Welcome. Create a game or open an existing project.");
    return true;
}

void nova_game_ui_close(NovaGameUI *ui)
{
    nova_model_ui_close(&ui->modeller);
    nova_destroy(ui->preview_engine); nova_destroy(ui->play_engine);
    nova_unload_resources(&ui->preview_resources); nova_unload_resources(&ui->play_resources);
    nova_game_close(&ui->project);
    nova_presentation_destroy(&ui->presentation);
    UnloadDirectoryFiles(ui->files);
    nova_ui_text_reset(&ui->details);
    fixture_cleanup(ui);
}

static void stop(NovaGameUI *ui)
{
    ui->playing = ui->play_focus = false; ui->accumulator = 0;
    nova_pause_services(&ui->play_resources, true);
    message(ui, "Stopped; room, selection, properties and unsaved drafts retained.");
}

bool nova_game_ui_action(NovaGameUI *ui, NovaGameAction action)
{
    ui->last_action = action;
    ui->action_failed = true;
    if (action == NOVA_GAME_STOP) { stop(ui); ui->action_failed = false; return true; }
    if (action != NOVA_GAME_APPLY && !clean_values(ui)) return false;
    bool ok = false;
    NovaGameProject *p = &ui->project;
    if (ui->playing && action != NOVA_GAME_RESTART) {
        message(ui, "Stop gameplay before changing or saving authored data."); return false;
    }
    switch (action) {
    case NOVA_GAME_NEW:
        ok = nova_game_new(p, ui->location, ui->name, ui->new_mode, ERROR);
        if (ok) { ui->staged.resources = NOVA_MAX_ASSETS+1; selection(ui, p->data.start); ui->room = p->data.start;
            ui->palette = p->data.object[0].id; ui->advanced_path[0] = 0;
            message(ui,"Your game is ready. Run to try it, or add an appearance to create another object."); }
        break;
    case NOVA_GAME_OPEN:
        ok = nova_game_open(p, ui->path, ERROR);
        if (ok) { ui->staged.resources = NOVA_MAX_ASSETS+1; selection(ui, p->data.start); ui->room = p->data.start;
            ui->palette = p->data.objects ? p->data.object[0].id : 0; ui->advanced_path[0] = 0; }
        else if (!strcmp(GetFileName(ui->path),NOVA_GAME_FILE) && FileExists(ui->path)) {
            snprintf(ui->advanced_path,sizeof(ui->advanced_path),"%s",ui->path);
            char reason[768]; snprintf(reason,sizeof(reason),"%.767s",ui->message);
            snprintf(ui->message,sizeof(ui->message),"%s. Advanced opens this source for repair; current game retained.",reason);
        }
        break;
    case NOVA_GAME_IMPORT:
        ok = nova_game_import(p, ui->path, ui->name, ui->new_mode == NOVA_2D ? NOVA_ASSET_SPRITE : NOVA_ASSET_MODEL, ERROR);
        if (ok) {
            if (!ui->room) ui->room = nova_game_room(&p->data,ui->browser_room) ? ui->browser_room : p->data.start;
            ui->browser_import = false;
            selection(ui, p->data.resource[p->data.resources-1].id);
        }
        break;
    case NOVA_GAME_NEW_MODEL:
        ok = nova_game_new_model(p,ui->name,ERROR);
        if (ok) {
            const NovaGameResource *r = &p->data.resource[p->data.resources-1];
            selection(ui,r->id);
            char manifest[NOVA_NATIVE_PATH_CAPACITY];
            if (nova_project_resolve(p->authored.root,NOVA_GAME_MANIFEST,manifest,ERROR) &&
                nova_model_ui_open(&ui->modeller,manifest,p->authored.root,r->path,ERROR)) ui->modeller.beginner = true;
            else {
                char detail[768]; snprintf(detail,sizeof(detail),"%.767s",ui->message);
                snprintf(ui->message,sizeof(ui->message),"Model files/resource created; opening modeller failed. Select model and retry. %s",detail);
            }
        }
        break;
    case NOVA_GAME_OBJECT:
        ok = nova_game_add_object(p, ui->object_appearance ? ui->object_appearance : ui->selected, ui->name, ERROR);
        if (ok) { selection(ui, p->data.object[p->data.objects-1].id); message(ui, "Object created. Add behaviors in the Inspector, then choose Place above the room."); }
        break;
    case NOVA_GAME_ROOM:
        ok = nova_game_add_room(p, ui->new_mode, ui->name, ERROR);
        if (ok) selection(ui, p->data.room[p->data.rooms-1].id);
        break;
    case NOVA_GAME_PLACE:
        ok = nova_game_place(p, ui->room, ui->palette, ui->drag_position, ERROR);
        if (ok) { selection(ui, p->data.instance[p->data.instances-1].id); message(ui, "Placed an object instance; shared object behaviors run on every instance."); }
        break;
    case NOVA_GAME_APPLY: ok = apply(ui); break;
    case NOVA_GAME_DELETE:
        ok = nova_game_delete(p, ui->selected, ERROR);
        if (ok) { selection(ui, ui->room); message(ui, "Deleted from authored draft. Referenced files retained; Undo restores stable IDs."); }
        break;
    case NOVA_GAME_UNDO_ACTION:
    case NOVA_GAME_REDO_ACTION:
        ok = nova_game_undo(p, action == NOVA_GAME_REDO_ACTION, ERROR);
        if (ok) { if (!nova_game_room(&p->data, ui->room)) ui->room = p->data.start;
            if (!nova_game_instance(&p->data, ui->selected) && !nova_game_object(&p->data, ui->selected) &&
                !nova_game_room(&p->data, ui->selected) && !nova_game_resource(&p->data, ui->selected)) ui->selected = ui->room;
            values(ui); message(ui, "Undo/redo restored authored state; saves and imported files are not undone."); }
        break;
    case NOVA_GAME_SAVE:
        ok = nova_game_save(p, false, ERROR);
        if (!ok && p->authored.has_conflict) { ui->dialog = NOVA_GAME_DIALOG_CONFLICT; ui->pending = action; }
        break;
    case NOVA_GAME_RUN:
    case NOVA_GAME_RESTART: {
        stop(ui);
        if (!nova_game_save(p, false, ERROR)) {
            if (p->authored.has_conflict) { ui->dialog = NOVA_GAME_DIALOG_CONFLICT; ui->pending = NOVA_GAME_SAVE; }
            break;
        }
        char path[NOVA_NATIVE_PATH_CAPACITY];
        ok = nova_project_resolve(p->authored.root, NOVA_GAME_MANIFEST, path, ERROR) &&
            nova_open_scene(&ui->play_engine, &ui->play_resources, path, true, ERROR);
        if (ok) {
            ui->playing = ui->play_focus = true;
            message(ui, "Running designated starting room. WASD/arrows move controlled objects; Space is primary action. Stop returns to Layout.");
        } else {
            char reason[768]; snprintf(reason,sizeof(reason),"%.767s",ui->message);
            snprintf(ui->message,sizeof(ui->message),"Run staging failed; previous gameplay resources and authored drafts retained: %s",reason);
        }
        break;
    }
    case NOVA_GAME_SELECT: selection(ui, ui->selected); ui->action_failed = false; return true;
    case NOVA_GAME_STOP: return true;
    }
    if (ok && (action == NOVA_GAME_NEW || action == NOVA_GAME_OPEN || action == NOVA_GAME_IMPORT ||
        action == NOVA_GAME_OBJECT || action == NOVA_GAME_ROOM || action == NOVA_GAME_NEW_MODEL)) {
        ui->sheet = NOVA_GAME_SHEET_NONE;
        ui->name_focus = ui->path_focus = ui->location_focus = false;
        memset(ui->field_focus,0,sizeof(ui->field_focus));
    }
    if (ok && action != NOVA_GAME_RUN && action != NOVA_GAME_RESTART && p->authored.text)
        ok = nova_game_ui_stage(ui);
    ui->action_failed = !ok;
    return ok;
}

bool nova_game_ui_move(NovaGameUI *ui, NovaVec3 position)
{
    if (!clean_values(ui) || ui->playing) return false;
    NovaGame g = ui->project.data;
    const NovaGameRoom *r = nova_game_room(&g, ui->room);
    if (!r) { message(ui, "Select a room"); return false; }
    if (ui->snap) {
        position.x = roundf(position.x/r->snap)*r->snap;
        if (r->mode == NOVA_2D) position.y = roundf(position.y/r->snap)*r->snap;
        else position.z = roundf(position.z/r->snap)*r->snap;
    }
    for (size_t i = 0; i < g.instances; ++i) if (g.instance[i].id == ui->selected) {
        g.instance[i].position = position;
        bool ok = nova_game_commit(&ui->project, &g, ERROR);
        if (ok) values(ui);
        return ok;
    }
    message(ui, "Select a placed instance to move");
    return false;
}

bool nova_game_ui_tick(NovaGameUI *ui, double dt, NovaInput input)
{
    if (!ui->playing) return true;
    bool ok = nova_tick(ui->play_engine, dt, input) && nova_tick_services(ui->play_engine, &ui->play_resources);
    if (!ok) {
        snprintf(ui->message, sizeof(ui->message), "Gameplay failed: %s", nova_error(ui->play_engine));
        ui->playing = false; ui->play_focus = false; ui->accumulator = 0;
        ui->last_action = NOVA_GAME_RUN; ui->action_failed = true;
        nova_pause_services(&ui->play_resources, true);
    }
    return ok;
}

static NovaFrame authored_frame(NovaGameUI *ui)
{
    const NovaGame *g = &ui->project.data;
    const NovaGameRoom *r = nova_game_room(g, ui->room);
    NovaFrame frame = {.mode = r ? r->mode : NOVA_2D, .background = {24,30,43,255},
        .camera_position = r ? r->camera : (NovaVec3){8,7,10},
        .camera_target = r ? r->target : (NovaVec3){0}, .camera_fov = r ? r->fov : 48};
    const NovaGameObject *selected_object = nova_game_object(g,ui->selected);
    uint32_t appearance = selected_object ? selected_object->resource :
        nova_game_resource(g,ui->selected) ? ui->selected : 0;
    if (appearance && ui->resource_view) {
        for (size_t a = 0; a < g->resources; ++a) if (g->resource[a].id == appearance) {
            bool sprite = g->resource[a].type == NOVA_ASSET_SPRITE;
            float scale = selected_object ? selected_object->size : sprite ? 128 : 1;
            frame.mode = sprite ? NOVA_2D : NOVA_3D;
            frame.camera_position = (NovaVec3){5,4,7}; frame.camera_target = (NovaVec3){0};
            frame.count = 1;
            frame.commands[0] = (NovaCommand){.type = sprite ? NOVA_SPRITE : NOVA_MODEL, .asset = a,
                .position = {sprite ? (960-scale)/2 : 0,sprite ? (540-scale)/2 : 0,0},
                .size = {scale,scale,scale}, .color = {255,255,255,255}};
            return frame;
        }
    }
    for (size_t i = 0; i < g->instances; ++i) {
        const NovaGameInstance *n = &g->instance[i];
        if (n->room != ui->room) continue;
        const NovaGameObject *o = nova_game_object(g, n->object);
        if (!o) continue;
        size_t a;
        for (a = 0; a < g->resources; ++a) if (g->resource[a].id == o->resource) break;
        if (a == g->resources) continue;
        NovaVec3 position = ui->dragging && n->id == ui->selected ? ui->drag_position : n->position;
        frame.commands[frame.count++] = (NovaCommand){.type = g->resource[a].type == NOVA_ASSET_SPRITE ? NOVA_SPRITE : NOVA_MODEL,
            .asset = a, .position = position, .size = {o->size*n->scale,o->size*n->scale,o->size*n->scale},
            .color = {255,255,255,255}};
    }
    return frame;
}

static void request(NovaGameUI *ui, NovaGameAction action)
{
    if (action != NOVA_GAME_APPLY && action != NOVA_GAME_STOP && !clean_values(ui)) return;
    if ((action == NOVA_GAME_NEW || action == NOVA_GAME_OPEN) && nova_game_dirty(&ui->project)) {
        ui->dialog = NOVA_GAME_DIALOG_DISCARD; ui->pending = action;
        snprintf(ui->pending_path, sizeof(ui->pending_path), "%s", ui->path);
        message(ui,"Opening or creating another project would discard unsaved changes in this game.\n\n"
            "Cancel to keep them. Return to the room and Save if you want to keep those changes on disk.\n"
            "Nothing is saved or discarded by opening the project screen.");
        return;
    }
    nova_game_ui_action(ui, action);
}

static bool button(Rectangle rect, const char *label, bool enabled, NovaGameUI *ui, NovaGameAction action)
{
    if (!enabled && CheckCollisionPointRec(GetMousePosition(),rect)) {
        snprintf(ui->hint,sizeof(ui->hint),"%s",ui->playing ? "Stop the game to edit or save your project." :
            action == NOVA_GAME_UNDO_ACTION ? "No earlier change to undo." :
            action == NOVA_GAME_REDO_ACTION ? "No undone change to redo." :
            action == NOVA_GAME_APPLY ? "No unapplied properties. Edit a value first." : "Select an item before using this action.");
    }
    bool clicked;
    if (action == NOVA_GAME_SAVE || action == NOVA_GAME_STOP || action == NOVA_GAME_RESTART ||
        action == NOVA_GAME_UNDO_ACTION || action == NOVA_GAME_REDO_ACTION) {
        NovaUIIcon icon=action == NOVA_GAME_SAVE ? NOVA_ICON_SAVE : action == NOVA_GAME_STOP ? NOVA_ICON_STOP :
            action == NOVA_GAME_UNDO_ACTION ? NOVA_ICON_UNDO : action == NOVA_GAME_REDO_ACTION ? NOVA_ICON_REDO : NOVA_ICON_PLAY;
        const char *hint=action == NOVA_GAME_SAVE ? "Save project changes (Ctrl/Cmd-S)" :
            action == NOVA_GAME_STOP ? "Stop and return to your unchanged room" :
            action == NOVA_GAME_RESTART ? "Restart the game from its starting room" :
            action == NOVA_GAME_UNDO_ACTION ? "Undo the last room/project change (Ctrl/Cmd-Z)" :
            "Redo the undone change (Ctrl/Cmd-Shift-Z)";
        clicked=nova_ui_icon_button(rect,label,icon,false,enabled,hint,ui->playing ?
            "Stop the game before editing or saving" : action == NOVA_GAME_UNDO_ACTION ?
            "No earlier change to undo" : "No undone change to redo");
    } else clicked=nova_ui_button(rect,label,enabled);
    if (!clicked) return false;
    request(ui, action); return true;
}

static bool row_button(Rectangle box, const char *label, bool selected, bool enabled)
{
    bool hover = CheckCollisionPointRec(GetMousePosition(),box);
    if (selected || (hover && enabled))
        DrawRectangleRounded(box,0.12f,8,selected ? nova_ui_style()->accent : nova_ui_style()->hover);
    nova_ui_label(label,(int)box.x+9,(int)box.y+5,(int)box.width-18,selected ? WHITE : enabled ? INK : MUTED);
    return enabled && hover && IsMouseButtonPressed(MOUSE_BUTTON_LEFT);
}

static void default_name(NovaGameUI *ui, const char *prefix)
{
    snprintf(ui->name,sizeof(ui->name),"%s_%u",prefix,ui->project.data.next_id);
}

static void open_sheet(NovaGameUI *ui, NovaGameSheet sheet)
{
    if (!clean_values(ui) || ui->playing) return;
    ui->sheet = sheet; ui->browser_scroll = ui->choice_scroll = 0;
    ui->name_focus = ui->path_focus = ui->location_focus = false;
    memset(ui->field_focus,0,sizeof(ui->field_focus));
    ui->path[0] = 0;
    const NovaGame *g = &ui->project.data;
    const NovaGameRoom *room = nova_game_room(g,ui->room);
    ui->new_mode = room ? room->mode : NOVA_2D;
    if (sheet == NOVA_GAME_SHEET_NEW) snprintf(ui->name,sizeof(ui->name),"MyGame");
    else if (sheet == NOVA_GAME_SHEET_ROOM) default_name(ui,"Room");
    else if (sheet == NOVA_GAME_SHEET_MODEL) default_name(ui,"Model");
    else if (sheet == NOVA_GAME_SHEET_OBJECT) {
        default_name(ui,"Object");
        const NovaGameResource *a = nova_game_resource(g,ui->selected);
        ui->object_appearance = a ? a->id : g->resources ? g->resource[0].id : 0;
    } else if (sheet == NOVA_GAME_SHEET_IMPORT) {
        default_name(ui,ui->new_mode == NOVA_2D ? "Sprite" : "Model");
        snprintf(ui->location,sizeof(ui->location),"%s",ui->project.authored.root);
    }
    if (sheet == NOVA_GAME_SHEET_NEW || sheet == NOVA_GAME_SHEET_OPEN || sheet == NOVA_GAME_SHEET_IMPORT) browse(ui);
}

static void resource_row(NovaGameUI *ui, const char *name, uint32_t id, int *row, int top, int maximum)
{
    int n = (*row)++;
    if (n < ui->tree_scroll || n >= ui->tree_scroll+maximum) return;
    if (row_button((Rectangle){18,(float)(top+(n-ui->tree_scroll)*28),190,27},name,
        ui->selected == id,!ui->playing) && clean_values(ui)) selection(ui,id);
}

static void tree(NovaGameUI *ui, int height)
{
    const NovaGame *g = &ui->project.data;
    int split = height/2+30;
    nova_ui_label("Resources",14,76,180,INK);
    Rectangle box = {8,106,206,(float)split-118};
    int maximum = (int)box.height/28, row = 0;
    if (CheckCollisionPointRec(GetMousePosition(),box)) ui->tree_scroll -= (int)(GetMouseWheelMove()*3);
    if (ui->tree_scroll < 0) ui->tree_scroll = 0;
    const char *headings[] = {"Sprites","Models","Objects","Rooms"};
    for (int group = 0; group < 4; ++group) {
        int n = row++;
        if (n >= ui->tree_scroll && n < ui->tree_scroll+maximum) {
            int y = 106+(n-ui->tree_scroll)*28;
            char label[64]; snprintf(label,sizeof(label),"%s %s",ui->collapsed[group] ? ">" : "v",headings[group]);
            if (row_button((Rectangle){8,(float)y,157,27},label,false,!ui->playing)) ui->collapsed[group] = !ui->collapsed[group];
            if (nova_ui_icon_button((Rectangle){172,(float)y,35,25},"",NOVA_ICON_ADD,false,!ui->playing,
                TextFormat("Add to %s",headings[group]),"Stop the game to add resources or rooms")) {
                open_sheet(ui,group == 0 ? NOVA_GAME_SHEET_IMPORT : group == 1 ? NOVA_GAME_SHEET_MODEL :
                    group == 2 ? NOVA_GAME_SHEET_OBJECT : NOVA_GAME_SHEET_ROOM);
                if (group < 2) {
                    ui->new_mode = group == 0 ? NOVA_2D : NOVA_3D;
                    default_name(ui,group == 0 ? "Sprite" : "Model");
                }
            }
        }
        if (ui->collapsed[group]) continue;
        if (group < 2) {
            for (size_t i = 0; i < g->resources; ++i)
                if (g->resource[i].type == (group == 0 ? NOVA_ASSET_SPRITE : NOVA_ASSET_MODEL))
                    resource_row(ui,g->resource[i].name,g->resource[i].id,&row,106,maximum);
        } else if (group == 2) {
            for (size_t i = 0; i < g->objects; ++i) resource_row(ui,g->object[i].name,g->object[i].id,&row,106,maximum);
        } else {
            for (size_t i = 0; i < g->rooms; ++i) {
                char label[64]; snprintf(label,sizeof(label),"%s%s",g->room[i].id == g->start ? "* " : "",g->room[i].name);
                resource_row(ui,label,g->room[i].id,&row,106,maximum);
            }
        }
    }
    if (ui->tree_scroll > row-maximum) ui->tree_scroll = row > maximum ? row-maximum : 0;
    DrawLine(0,split,220,split,nova_ui_style()->border);
    nova_ui_label("Room instances",14,split+15,192,INK);
    const NovaGameRoom *room = nova_game_room(g,ui->room);
    if (row_button((Rectangle){8,(float)split+43,200,28},room ? room->name : "No room",ui->selected == ui->room,!ui->playing) && clean_values(ui))
        selection(ui,ui->room);
    Rectangle outline = {8,(float)split+76,200,(float)height-split-174};
    if (CheckCollisionPointRec(GetMousePosition(),outline)) ui->outline_scroll -= (int)(GetMouseWheelMove()*3);
    if (ui->outline_scroll < 0) ui->outline_scroll = 0;
    int count = 0, visible = (int)outline.height/28;
    for (size_t i = 0; i < g->instances; ++i) if (g->instance[i].room == ui->room) {
        int index = count++;
        if (index < ui->outline_scroll || index >= ui->outline_scroll+visible) continue;
        char label[64]; snprintf(label,sizeof(label),"  %s",g->instance[i].name);
        if (row_button((Rectangle){14,outline.y+(index-ui->outline_scroll)*28,194,27},label,
            ui->selected == g->instance[i].id,!ui->playing) && clean_values(ui)) selection(ui,g->instance[i].id);
    }
    if (ui->outline_scroll > count-visible) ui->outline_scroll = count > visible ? count-visible : 0;
    if (!count) nova_ui_label("No instances yet",20,(int)outline.y+6,186,MUTED);
    if (nova_ui_icon_button((Rectangle){12,(float)height-85,196,30},"Delete selected...",NOVA_ICON_DELETE,false,ui->selected && !ui->playing,
        "Delete selected item (confirmation required)",ui->playing ? "Stop the game before deleting" : "Select an item to delete") && clean_values(ui))
        ui->dialog = NOVA_GAME_DIALOG_DELETE;
}

static void field(NovaGameUI *ui, int index, const char *label, int x, int y)
{
    if (y < ui->inspector_top || y+28 > ui->inspector_bottom) return;
    nova_ui_label(label, x, y+6, 110, MUTED);
    if (nova_ui_field_checked((Rectangle){(float)x+112,(float)y,160,28}, ui->fields[index],
        sizeof(ui->fields[index]), &ui->field_focus[index], ERROR)) ui->values_dirty = true;
}

static void toggle(NovaGameUI *ui, int event, const char *label, int x, int y)
{
    if (y < ui->inspector_top || y+28 > ui->inspector_bottom) return;
    const NovaGameObject *o = nova_game_object(&ui->project.data, ui->selected);
    if (!o) return;
    bool enabled = event == 0 ? o->create_position : event == 1 ? o->controls : event == 2 ? o->step_move : o->primary_move;
    char text[96]; snprintf(text, sizeof(text), "%s %s", enabled ? "[x]" : "[ ]", label);
    if (nova_ui_button((Rectangle){(float)x,(float)y,277,28}, text, true) && clean_values(ui)) {
        NovaGame g = ui->project.data;
        for (size_t i = 0; i < g.objects; ++i) if (g.object[i].id == ui->selected) {
            NovaGameObject *v = &g.object[i];
            if (event == 0) v->create_position = !enabled;
            else if (event == 1) v->controls = !enabled;
            else if (event == 2) v->step_move = !enabled;
            else v->primary_move = !enabled;
        }
        nova_game_commit(&ui->project, &g, ERROR);
    }
}

static void section(NovaGameUI *ui, const char *label, int x, int y)
{
    if (y < ui->inspector_top || y+22 > ui->inspector_bottom) return;
    nova_ui_label(label,x,y,277,nova_ui_style()->accent);
}

static void properties(NovaGameUI *ui, int x, int height)
{
    const NovaGame *g = &ui->project.data;
    const NovaGameInstance *n = nova_game_instance(g, ui->selected);
    const NovaGameObject *o = nova_game_object(g, ui->selected);
    const NovaGameRoom *r = nova_game_room(g, ui->selected);
    const NovaGameResource *a = nova_game_resource(g, ui->selected);
    nova_ui_label("Inspector",x,76,277,INK);
    const char *name = n ? n->name : o ? o->name : r ? r->name : a ? a->name : "Nothing selected";
    nova_ui_label(name,x,106,277,INK);
    nova_ui_label(n ? "Room / Instance" : o ? "Resources / Object" : r ? "Resources / Room" :
        a ? a->type == NOVA_ASSET_SPRITE ? "Resources / Sprite" : "Resources / Model" : "Select a resource or instance",
        x,132,277,MUTED);
    if (!n && !o && !r && !a) return;
    int content = n ? 356 : r && r->mode == NOVA_3D ? 444 : 180;
    if (o) {
        const NovaGameResource *appearance = nova_game_resource(g,o->resource);
        bool is3d = appearance && appearance->type == NOVA_ASSET_MODEL;
        content = 367+(o->controls ? 34 : 0)+(o->step_move ? is3d ? 102 : 68 : 0)+
            (o->create_position ? is3d ? 102 : 68 : 0)+(o->primary_move ? is3d ? 102 : 68 : 0);
    }
    ui->inspector_top = 171; ui->inspector_bottom = height-130;
    Rectangle scroll = {(float)x,171,278,(float)ui->inspector_bottom-171};
    if (CheckCollisionPointRec(GetMousePosition(),scroll)) ui->inspector_scroll -= (int)(GetMouseWheelMove()*44);
    int maximum = content-(ui->inspector_bottom-ui->inspector_top);
    if (maximum < 0) maximum = 0;
    if (ui->inspector_scroll > maximum) ui->inspector_scroll = maximum;
    if (ui->inspector_scroll < 0) ui->inspector_scroll = 0;
    field(ui,0,"Name",x,177-ui->inspector_scroll);
    int y = 220-ui->inspector_scroll;
    if (n) {
        const NovaGameRoom *owner_room = nova_game_room(g,n->room);
        bool is3d = owner_room && owner_room->mode == NOVA_3D;
        section(ui,"Transform",x,y); y += 30;
        field(ui,1,"Position X",x,y); y += 34;
        field(ui,2,is3d ? "Height Y" : "Position Y",x,y); y += 34;
        if (is3d) { field(ui,3,"Position Z",x,y); y += 34; }
        field(ui,4,"Scale",x,y); y += 46;
        const NovaGameObject *owner = nova_game_object(g,n->object);
        section(ui,owner ? TextFormat("Object: %s",owner->name) : "Missing object",x,y);
        if (y+62 <= ui->inspector_bottom && y+30 >= ui->inspector_top &&
            nova_ui_button((Rectangle){(float)x,(float)y+30,277,30},"Edit object behaviors",true) && clean_values(ui))
            selection(ui,n->object);
    } else if (o) {
        const NovaGameResource *appearance = nova_game_resource(g,o->resource);
        bool is3d = appearance && appearance->type == NOVA_ASSET_MODEL;
        section(ui,appearance ? TextFormat("Appearance / %s",appearance->name) : "Appearance",x,y); y += 30;
        field(ui,1,is3d ? "Model scale" : "Sprite size",x,y); y += 44;
        section(ui,"Step / movement",x,y); y += 28;
        toggle(ui,1,"Move with controls",x,y); y += 34;
        if (o->controls) { field(ui,2,"Speed / sec",x,y); y += 34; }
        toggle(ui,2,"Constant movement",x,y); y += 34;
        if (o->step_move) {
            field(ui,6,"X / sec",x,y); y += 34;
            field(ui,7,is3d ? "Height / sec" : "Y / sec",x,y); y += 34;
            if (is3d) { field(ui,8,"Z / sec",x,y); y += 34; }
        }
        y += 12; section(ui,"Create / initial position",x,y); y += 28;
        toggle(ui,0,"Override placed position",x,y); y += 34;
        if (o->create_position) {
            field(ui,3,"Position X",x,y); y += 34;
            field(ui,4,is3d ? "Height Y" : "Position Y",x,y); y += 34;
            if (is3d) { field(ui,5,"Position Z",x,y); y += 34; }
        }
        y += 12; section(ui,"Primary press / Space",x,y); y += 28;
        toggle(ui,3,"Move by offset",x,y); y += 34;
        if (o->primary_move) {
            field(ui,9,"Offset X",x,y); y += 34;
            field(ui,10,is3d ? "Height offset" : "Offset Y",x,y); y += 34;
            if (is3d) field(ui,11,"Offset Z",x,y);
        }
    } else if (r) {
        section(ui,r->mode == NOVA_2D ? "2D room / 960 x 540" : "3D room / XZ floor",x,y); y += 30;
        field(ui,1,"Snap step",x,y); y += 44;
        if (r->mode == NOVA_3D) {
            section(ui,"Camera",x,y); y += 28;
            const char *labels[] = {"Position X","Position Y","Position Z","Look at X","Look at Y","Look at Z","Field of view"};
            for (int i = 0; i < 7; ++i) { field(ui,i+2,labels[i],x,y); y += 34; }
            y += 12;
        }
        if (y >= ui->inspector_top && y+32 <= ui->inspector_bottom &&
            nova_ui_button((Rectangle){(float)x,(float)y,277,32},g->start == r->id ? "Starting room" : "Set as starting room",g->start != r->id) && clean_values(ui)) {
            NovaGame candidate = *g; candidate.start = r->id;
            nova_game_commit(&ui->project,&candidate,ERROR);
            message(ui,"Starting room changed. Run will begin here.");
        }
    } else if (a) {
        section(ui,a->type == NOVA_ASSET_SPRITE ? "PNG sprite / appearance" : "Static model / appearance",x,y); y += 34;
        if (y >= ui->inspector_top && y+34 <= ui->inspector_bottom &&
            nova_ui_button((Rectangle){(float)x,(float)y,277,34},"Create object using this...",true)) open_sheet(ui,NOVA_GAME_SHEET_OBJECT);
        y += 46;
        if (y >= ui->inspector_top && y+32 <= ui->inspector_bottom &&
            nova_ui_button((Rectangle){(float)x,(float)y,277,32},ui->resource_view ? "Return to room" : "Preview appearance",true) && clean_values(ui))
            ui->resource_view = !ui->resource_view;
        y += 44;
        if (a->type == NOVA_ASSET_MODEL && y >= ui->inspector_top && y+32 <= ui->inspector_bottom &&
            nova_ui_button((Rectangle){(float)x,(float)y,277,32},"Edit in static modeller",true) && clean_values(ui)) {
            char manifest[NOVA_NATIVE_PATH_CAPACITY];
            if (nova_project_resolve(ui->project.authored.root,NOVA_GAME_MANIFEST,manifest,ERROR) &&
                nova_model_ui_open(&ui->modeller,manifest,ui->project.authored.root,a->path,ERROR)) ui->modeller.beginner = true;
        }
    }
    if (maximum) {
        DrawRectangle(x+280,ui->inspector_top,3,ui->inspector_bottom-ui->inspector_top,nova_ui_style()->border);
        int track = ui->inspector_bottom-ui->inspector_top;
        DrawRectangle(x+280,ui->inspector_top+ui->inspector_scroll*track/(maximum+track),3,track*track/(maximum+track),nova_ui_style()->muted);
    }
    nova_ui_label(ui->values_dirty ? "Unapplied changes" : "Properties up to date",x,height-112,277,MUTED);
    button((Rectangle){(float)x,(float)height-84,132,32},"Apply",ui->values_dirty,ui,NOVA_GAME_APPLY);
    if (nova_ui_button((Rectangle){(float)x+141,(float)height-84,132,32},"Reset",ui->values_dirty)) values(ui);
}

static Vector2 plane_point(const NovaGameRoom *r, Rectangle box, NovaVec3 p)
{
    if (r->mode == NOVA_2D) return (Vector2){box.x+p.x*box.width/960,box.y+p.y*box.height/540};
    return (Vector2){box.x+(p.x+10)*box.width/20,box.y+(p.z+10)*box.height/20};
}

static NovaVec3 plane_position(const NovaGameRoom *r, Rectangle box, Vector2 p)
{
    if (r->mode == NOVA_2D) return (NovaVec3){(p.x-box.x)*960/box.width,(p.y-box.y)*540/box.height,0};
    return (NovaVec3){(p.x-box.x)*20/box.width-10,0,(p.y-box.y)*20/box.height-10};
}

static void layout(NovaGameUI *ui, Rectangle box)
{
    const NovaGame *g = &ui->project.data;
    const NovaGameRoom *r = nova_game_room(g,ui->room);
    if (!r || ui->playing || ui->stale) return;
    if (r->mode == NOVA_3D) {
        DrawRectangleRec(box,nova_ui_style()->panel);
        nova_ui_label("XZ floor plan / -10..10 / height in properties", (int)box.x+8,(int)box.y+6,(int)box.width-16,MUTED);
    }
    if (ui->snap) {
        float span = r->mode == NOVA_2D ? 960 : 20;
        float step = r->snap;
        if (span/step > 80) step *= ceilf(span/step/80);
        float origin = r->mode == NOVA_2D ? 0 : -10;
        for (float a = ceilf(origin/step)*step; a <= origin+span; a += step) {
            float x = box.x+(a-origin)/span*box.width;
            DrawLine((int)x,(int)box.y,(int)x,(int)(box.y+box.height),(Color){100,120,145,45});
        }
        span = r->mode == NOVA_2D ? 540 : 20;
        for (float a = ceilf(origin/step)*step; a <= origin+span; a += step) {
            float y = box.y+(a-origin)/span*box.height;
            DrawLine((int)box.x,(int)y,(int)(box.x+box.width),(int)y,(Color){100,120,145,45});
        }
    }
    uint32_t hit = 0;
    for (size_t i = 0; i < g->instances; ++i) {
        const NovaGameInstance *n = &g->instance[i];
        if (n->room != r->id) continue;
        const NovaGameObject *o = nova_game_object(g,n->object);
        NovaVec3 v = ui->dragging && n->id == ui->selected ? ui->drag_position : n->position;
        Vector2 p = plane_point(r,box,v);
        Rectangle bounds = r->mode == NOVA_2D ?
            (Rectangle){p.x,p.y,o->size*n->scale*box.width/960,o->size*n->scale*box.height/540} :
            (Rectangle){p.x-8,p.y-8,16,16};
        if (r->mode == NOVA_3D) DrawRectangleRec(bounds,ui->selected == n->id ? nova_ui_style()->accent : nova_ui_style()->muted);
        if (ui->selected == n->id) DrawRectangleLinesEx(bounds,2,nova_ui_style()->accent);
        if (CheckCollisionPointRec(GetMousePosition(),bounds)) hit = n->id;
    }
    if (ui->dialog != NOVA_GAME_DIALOG_NONE || ui->values_dirty) return;
    if (CheckCollisionPointRec(GetMousePosition(),box) && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
        ui->play_focus = false;
        if (ui->place_tool) {
            ui->drag_position = plane_position(r,box,GetMousePosition());
            if (ui->snap) {
                ui->drag_position.x = roundf(ui->drag_position.x/r->snap)*r->snap;
                if (r->mode == NOVA_2D) ui->drag_position.y = roundf(ui->drag_position.y/r->snap)*r->snap;
                else ui->drag_position.z = roundf(ui->drag_position.z/r->snap)*r->snap;
            }
            request(ui,NOVA_GAME_PLACE);
        } else if (hit) {
            selection(ui,hit);
            ui->dragging = true; ui->drag_start = nova_game_instance(g,hit)->position;
            ui->drag_position = ui->drag_start; ui->drag_pointer = GetMousePosition();
        } else selection(ui,r->id);
    }
    if (ui->dragging) {
        NovaVec3 current = plane_position(r,box,GetMousePosition());
        NovaVec3 initial = plane_position(r,box,ui->drag_pointer);
        ui->drag_position = (NovaVec3){ui->drag_start.x+current.x-initial.x,
            ui->drag_start.y+current.y-initial.y, ui->drag_start.z+current.z-initial.z};
        if (IsKeyPressed(KEY_ESCAPE) || !IsWindowFocused()) ui->dragging = false;
        else if (IsMouseButtonReleased(MOUSE_BUTTON_LEFT)) {
            ui->dragging = false; nova_game_ui_move(ui,ui->drag_position);
        }
    }
}

static void dimensions(NovaGameUI *ui, int x, int y, bool appearance)
{
    if (nova_ui_select_button((Rectangle){(float)x,(float)y,148,34},appearance ? "Sprite / PNG" :
        ui->sheet == NOVA_GAME_SHEET_ROOM ? "2D room" : "2D game",ui->new_mode == NOVA_2D,true)) {
        ui->new_mode = NOVA_2D;
        if (appearance) ui->path[0] = 0;
    }
    if (nova_ui_select_button((Rectangle){(float)x+158,(float)y,148,34},appearance ? "Model / GLB" :
        ui->sheet == NOVA_GAME_SHEET_ROOM ? "3D room" : "3D game",ui->new_mode == NOVA_3D,true)) {
        ui->new_mode = NOVA_3D;
        if (appearance) ui->path[0] = 0;
    }
}

static void file_browser(NovaGameUI *ui, Rectangle box, bool importing)
{
    int x = (int)box.x, y = (int)box.y, width = (int)box.width;
    bool creating = ui->sheet == NOVA_GAME_SHEET_NEW;
    nova_ui_label(importing ? "Choose an appearance file" : creating ?
        "Project location / choose an existing folder" : "Project folder / select game.nova-game",x,y,width,MUTED);
    if (nova_ui_field_checked((Rectangle){(float)x,(float)y+27,(float)width-153,32},ui->location,
        sizeof(ui->location),&ui->location_focus,ERROR)) ui->path[0] = 0;
    if (nova_ui_button((Rectangle){(float)x+width-144,(float)y+27,62,32},"Up",true)) {
        snprintf(ui->location,sizeof(ui->location),"%s",GetPrevDirectoryPath(ui->location)); browse(ui); ui->path[0] = 0;
    }
    if (nova_ui_button((Rectangle){(float)x+width-73,(float)y+27,73,32},"Browse",true) ||
        (ui->location_focus && IsKeyPressed(KEY_ENTER))) { browse(ui); ui->path[0] = 0; }
    Rectangle list = {(float)x,(float)y+70,(float)width,box.height-70};
    DrawRectangleRounded(list,0.03f,8,nova_ui_style()->field);
    int max = (int)(list.height-8)/30;
    int total = 0, shown = 0;
    if (CheckCollisionPointRec(GetMousePosition(),list)) ui->browser_scroll -= (int)(GetMouseWheelMove()*3);
    if (ui->browser_scroll < 0) ui->browser_scroll = 0;
    for (unsigned i = 0; i < ui->files.count; ++i) {
        const char *path = ui->files.paths[i];
        bool dir = DirectoryExists(path);
        bool game = !strcmp(GetFileName(path),NOVA_GAME_FILE);
        bool asset = IsFileExtension(path,ui->new_mode == NOVA_2D ? ".png" : ".glb");
        if (!dir && !(importing ? asset : !creating && game)) continue;
        if (total++ < ui->browser_scroll || shown >= max) continue;
        char label[300];
        snprintf(label,sizeof(label),"%s%s",dir ? "> " : "",GetFileName(path));
        if (row_button((Rectangle){list.x+4,list.y+4+shown*30,list.width-8,28},label,!strcmp(path,ui->path),true)) {
            if (strlen(path) >= sizeof(ui->path)) message(ui,"Path exceeds budget");
            else if (dir) { strcpy(ui->location,path); ui->path[0] = 0; browse(ui); return; }
            else { strcpy(ui->path,path); message(ui,importing ? "File selected. Import will copy it; the original stays unchanged." : "Project selected. Open when ready."); }
        }
        ++shown;
    }
    if (ui->browser_scroll > total-max) ui->browser_scroll = total > max ? total-max : 0;
    if (!total) nova_ui_label(importing ? "No matching files here. Browse another folder." :
        creating ? "No subfolders here. This location can still hold your new project." :
        "No folders or projects here.",x+12,(int)list.y+12,width-24,MUTED);
}

static void project_screen(NovaGameUI *ui, int width, int height)
{
    int x = (width-880)/2;
    nova_ui_label("Nova Studio",x,65,880,INK);
    nova_ui_label("Make a game. Start with a room, add objects, and press Run.",x,98,880,MUTED);
    bool creating = ui->sheet != NOVA_GAME_SHEET_OPEN;
    if (nova_ui_select_button((Rectangle){(float)x,146,180,38},"New project",creating,true)) open_sheet(ui,NOVA_GAME_SHEET_NEW);
    if (nova_ui_select_button((Rectangle){(float)x+190,146,180,38},"Open project",!creating,true)) open_sheet(ui,NOVA_GAME_SHEET_OPEN);
    DrawRectangleRounded((Rectangle){(float)x,201,880,(float)height-285},0.025f,8,nova_ui_style()->panel);
    if (creating) {
        nova_ui_label("Project name",x+22,221,380,MUTED);
        nova_ui_field_checked((Rectangle){(float)x+22,247,394,34},ui->name,sizeof(ui->name),&ui->name_focus,ERROR);
        nova_ui_label("Game dimension",x+450,221,380,MUTED);
        dimensions(ui,x+450,247,false);
        nova_ui_label("A new folder will be created here. Existing folders are never replaced.",x+22,300,830,MUTED);
    } else {
        nova_ui_label("Open your project folder, then select game.nova-game.",x+22,225,830,INK);
        nova_ui_label("Hand-authored manifest / Lua projects are available in Advanced.",x+22,258,830,MUTED);
    }
    file_browser(ui,(Rectangle){(float)x+22,335,836,(float)height-515},false);
    int footer = height-126;
    nova_ui_label(creating ? !nova_game_name(ui->name) ? "Name: use 1..31 letters, numbers or underscores (no spaces)." :
        "Creates a ready-to-play room with a controllable player." :
        *ui->path ? GetFileName(GetDirectoryPath(ui->path)) : "Select a project to enable Open.",x+22,footer-36,590,MUTED);
    bool can_open = *ui->path && !strcmp(GetFileName(ui->path),NOVA_GAME_FILE);
    if (nova_ui_button((Rectangle){(float)x+640,(float)footer,218,36},creating ? "Create project" : "Open project",
        creating ? nova_game_name(ui->name) : can_open)) request(ui,creating ? NOVA_GAME_NEW : NOVA_GAME_OPEN);
    if (ui->project.authored.text && nova_ui_button((Rectangle){(float)x+22,(float)footer,170,36},"Cancel / return",true))
        ui->sheet = NOVA_GAME_SHEET_NONE;
    if (nova_ui_button((Rectangle){(float)x+204,(float)footer,150,36},"Advanced...",true)) ui->advanced = true;
}

static void creation_sheet(NovaGameUI *ui, int width, int height)
{
    DrawRectangle(0,0,width,height,(Color){0,0,0,90});
    bool importing = ui->sheet == NOVA_GAME_SHEET_IMPORT;
    bool object = ui->sheet == NOVA_GAME_SHEET_OBJECT;
    bool project = ui->sheet == NOVA_GAME_SHEET_PROJECT;
    bool model = ui->sheet == NOVA_GAME_SHEET_MODEL;
    Rectangle box = {(float)width/2-390,(float)height/2-305,780,610};
    int x = (int)box.x+24, y = (int)box.y+24;
    DrawRectangleRounded(box,0.025f,8,nova_ui_style()->panel);
    const char *title = project ? "Project" : model ? "Create a model" : importing ? "Add an appearance" : object ? "Create an object" : "Add a room";
    nova_ui_label(title,x,y,732,INK);
    if (project) {
        nova_ui_label("Project setup and source tools",x,y+40,732,MUTED);
        if (nova_ui_button((Rectangle){(float)x,(float)y+88,350,40},"New project...",true)) open_sheet(ui,NOVA_GAME_SHEET_NEW);
        if (nova_ui_button((Rectangle){(float)x,(float)y+140,350,40},"Open project...",true)) open_sheet(ui,NOVA_GAME_SHEET_OPEN);
        if (nova_ui_button((Rectangle){(float)x,(float)y+220,350,40},"Advanced source editor...",true)) {
            ui->sheet = NOVA_GAME_SHEET_NONE; ui->advanced = true;
        }
        nova_ui_label("Advanced drafts stay separate. Opening this menu never saves.",x,y+282,732,MUTED);
    } else {
        nova_ui_label(model ? "Assemble named static parts, assign colours/PNGs, then create an object." :
            importing ? "Import a sprite or static model, then use it to create an object." :
            object ? "Objects share an appearance and behaviors. Place copies in rooms." :
            "Rooms hold placed instances. Choose the room's dimension here.",x,y+33,732,MUTED);
        nova_ui_label(model ? "Model name" : importing ? "Appearance name" : object ? "Object name" : "Room name",x,y+72,400,MUTED);
        nova_ui_field_checked((Rectangle){(float)x,(float)y+98,350,34},ui->name,sizeof(ui->name),&ui->name_focus,ERROR);
        if (!object && !model) dimensions(ui,x+384,y+98,importing);
        if (model) {
            nova_ui_label("New model starts with one editable box. Add boxes, pyramids or cylinders.",x,y+180,732,MUTED);
            nova_ui_label("Editable source and self-contained GLB get fresh project-local filenames.",x,y+218,732,MUTED);
            nova_ui_label("No rigging, animation or arbitrary mesh reconstruction.",x,y+256,732,MUTED);
            if (nova_ui_button((Rectangle){(float)x,(float)y+318,300,36},"Import existing GLB instead...",true)) {
                open_sheet(ui,NOVA_GAME_SHEET_IMPORT); ui->new_mode = NOVA_3D; default_name(ui,"Model");
            }
        } else if (importing) {
            file_browser(ui,(Rectangle){(float)x,(float)y+154,732,304},true);
            nova_ui_label(*ui->path ? TextFormat("Selected: %s",GetFileName(ui->path)) : "Select a file, then choose Import.",x,y+475,732,MUTED);
        } else if (object) {
            nova_ui_label("Appearance",x,y+156,732,nova_ui_style()->accent);
            int row = 0, count = 0, maximum = 8;
            Rectangle list = {(float)x,(float)y+187,732,248};
            DrawRectangleRounded(list,0.02f,8,nova_ui_style()->field);
            if (CheckCollisionPointRec(GetMousePosition(),list)) ui->choice_scroll -= (int)(GetMouseWheelMove()*3);
            if (ui->choice_scroll < 0) ui->choice_scroll = 0;
            for (size_t i = 0; i < ui->project.data.resources; ++i) {
                const NovaGameResource *a = &ui->project.data.resource[i];
                int n = count++;
                if (n < ui->choice_scroll || row >= maximum) continue;
                char label[96]; snprintf(label,sizeof(label),"%s   /   %s",a->name,a->type == NOVA_ASSET_SPRITE ? "Sprite" : "Model");
                if (row_button((Rectangle){list.x+4,list.y+4+row*30,list.width-8,28},label,ui->object_appearance == a->id,true))
                    ui->object_appearance = a->id;
                ++row;
            }
            if (ui->choice_scroll > count-maximum) ui->choice_scroll = count > maximum ? count-maximum : 0;
            if (!count) nova_ui_label("Add a sprite or model first, then create an object.",x+14,y+201,690,MUTED);
        } else {
            nova_ui_label("2D: sprite instances on an XY canvas.",x,y+188,732,MUTED);
            nova_ui_label("3D: model instances on an XZ floor, with height and a camera.",x,y+220,732,MUTED);
            nova_ui_label("Adding a room does not change the designated starting room.",x,y+276,732,MUTED);
        }
        bool enabled = nova_game_name(ui->name) && (importing ? *ui->path != 0 : !object || ui->object_appearance != 0);
        if (!nova_game_name(ui->name))
            nova_ui_label("Name: use 1..31 letters, numbers or underscores (no spaces).",x,y+502,732,MUTED);
        if (nova_ui_button((Rectangle){box.x+540,box.y+550,216,36},model ? "New model" : importing ? "Import appearance" : object ? "Create object" : "Create room",enabled))
            request(ui,model ? NOVA_GAME_NEW_MODEL : importing ? NOVA_GAME_IMPORT : object ? NOVA_GAME_OBJECT : NOVA_GAME_ROOM);
    }
    if (nova_ui_button((Rectangle){box.x+24,box.y+550,140,36},"Cancel",true)) ui->sheet = NOVA_GAME_SHEET_NONE;
}

static void dialog(NovaGameUI *ui, int width, int height)
{
    DrawRectangle(0,0,width,height,(Color){0,0,0,100});
    Rectangle box = {(float)width/2-390,(float)height/2-230,780,460};
    DrawRectangleRounded(box,0.03f,8,nova_ui_style()->panel);
    const char *title = ui->dialog == NOVA_GAME_DIALOG_CONFLICT ? "External edit: exact observed version" :
        ui->dialog == NOVA_GAME_DIALOG_DELETE ? "Delete from authored draft?" :
        ui->dialog == NOVA_GAME_DIALOG_DETAILS ? "Full diagnostic" : "Unsaved authored changes";
    nova_ui_label(title,(int)box.x+20,(int)box.y+18,740,INK);
    const char *body = ui->dialog == NOVA_GAME_DIALOG_CONFLICT && ui->project.authored.has_conflict ?
        ui->project.authored.conflict.text : ui->message;
    if (ui->dialog == NOVA_GAME_DIALOG_DETAILS && ui->modeller.active) body = ui->modeller.message;
    if (ui->dialog == NOVA_GAME_DIALOG_DELETE)
        body = TextFormat("Delete %s from this game's draft?\n\nUndo can restore it. Imported files are kept.\n"
            "Items used by objects or room instances cannot be deleted.\nThe starting room cannot be deleted.",ui->fields[0]);
    NovaDocument text = {.text = (char *)body, .length = strlen(body)};
    nova_ui_text(&ui->details,&text,(Rectangle){box.x+20,box.y+58,740,310},false,ERROR);
    if (nova_ui_button((Rectangle){box.x+20,box.y+400,120,34},"Cancel / close",true)) {
        ui->dialog = NOVA_GAME_DIALOG_NONE; nova_ui_text_reset(&ui->details);
    } else if (ui->dialog == NOVA_GAME_DIALOG_DELETE &&
        nova_ui_button((Rectangle){box.x+154,box.y+400,185,34},"Delete (Undo available)",true)) {
        ui->dialog = NOVA_GAME_DIALOG_NONE; nova_game_ui_action(ui,NOVA_GAME_DELETE);
    } else if (ui->dialog == NOVA_GAME_DIALOG_CONFLICT &&
        nova_ui_button((Rectangle){box.x+154,box.y+400,240,34},"Overwrite observed source only",true)) {
        ui->dialog = NOVA_GAME_DIALOG_NONE;
        bool saved = nova_game_save(&ui->project,true,ERROR);
        ui->last_action = NOVA_GAME_SAVE; ui->action_failed = !saved;
        if (!saved && ui->project.authored.has_conflict) ui->dialog = NOVA_GAME_DIALOG_CONFLICT;
        else if (saved) message(ui,"Source and generated files saved. Run requires a separate explicit Run action.");
    } else if ((ui->dialog == NOVA_GAME_DIALOG_CLOSE || ui->dialog == NOVA_GAME_DIALOG_DISCARD) &&
        nova_ui_button((Rectangle){box.x+154,box.y+400,200,34},"Discard unsaved changes",true)) {
        NovaGameDialog d = ui->dialog;
        ui->dialog = NOVA_GAME_DIALOG_NONE;
        ui->values_dirty = false;
        if (d == NOVA_GAME_DIALOG_CLOSE) ui->quit = true;
        else { strcpy(ui->path,ui->pending_path); nova_game_ui_action(ui,ui->pending); }
    }
}

void nova_game_ui_request_close(NovaGameUI *ui)
{
    if (ui->modeller.active) { ui->close_after_modeller = true; nova_model_ui_request_close(&ui->modeller); return; }
    if (nova_game_dirty(&ui->project) || ui->values_dirty) {
        ui->dialog = NOVA_GAME_DIALOG_CLOSE;
        message(ui,"Closing would discard unsaved visual data or unapplied properties. Cancel to keep editing.");
    } else ui->quit = true;
}

bool nova_game_ui_draw(NovaGameUI *ui, bool bounded)
{
    int width = GetScreenWidth(), height = GetScreenHeight();
    int fw = GetRenderWidth(), fh = GetRenderHeight();
    ui->hint[0] = 0;
    bool modal = ui->dialog != NOVA_GAME_DIALOG_NONE;
    if (IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
        memset(ui->field_focus,0,sizeof(ui->field_focus));
        ui->name_focus = ui->path_focus = ui->location_focus = false;
    }
    if (ui->close_after_modeller && ui->modeller.active && ui->modeller.decision == NOVA_MODEL_DECISION_NONE &&
        !ui->modeller.close) ui->close_after_modeller = false;
    nova_model_ui_update(&ui->modeller);
    if (ui->close_after_modeller && !ui->modeller.active) {
        ui->close_after_modeller = false; nova_game_ui_request_close(ui);
        modal = ui->dialog != NOVA_GAME_DIALOG_NONE;
    }
    if (ui->modeller.exported) {
        ui->modeller.exported = false; ui->staged.resources = NOVA_MAX_ASSETS+1;
        if (nova_game_ui_stage(ui))
            message(ui,"Model exported separately. Preview restaged; Run remains explicit and guarded.");
        else snprintf(ui->modeller.message,sizeof(ui->modeller.message),
            "Model saved, but project preview could not refresh. Previous project view retained. Details: %.800s",ui->message);
    }
    const NovaGameRoom *r = nova_game_room(&ui->project.data,ui->room);
    bool setup = ui->sheet == NOVA_GAME_SHEET_NEW || ui->sheet == NOVA_GAME_SHEET_OPEN || !ui->project.authored.text;
    bool sheet = ui->sheet != NOVA_GAME_SHEET_NONE;
    bool context = ui->resource_view && (nova_game_resource(&ui->project.data,ui->selected) || nova_game_object(&ui->project.data,ui->selected));
    int center_width = width-556;
    int canvas_height = height-228;
    Rectangle preview = {236,176,(float)center_width,r && r->mode == NOVA_3D && !ui->playing && !context ? canvas_height*0.57f : (float)canvas_height};
    if (ui->modeller.active) preview = nova_model_ui_preview(width,height);
    ui->preview_bounds = preview;
    NovaFramebufferRect region = {(int)lroundf(preview.x*fw/width),(int)lroundf(preview.y*fh/height),
        (int)lroundf(preview.width*fw/width),(int)lroundf(preview.height*fh/height)};
    NovaPresentationLayout present;
    const NovaFrame *frame = NULL;
    NovaPresentation *presentation = &ui->presentation;
    const NovaResources *resources = &ui->preview_resources;
    if (ui->playing) { frame = nova_frame(ui->play_engine); resources = &ui->play_resources; }
    else if (ui->ready) {
        if (!ui->stale) ui->frame = authored_frame(ui);
        frame = &ui->frame;
    }
    if (ui->modeller.active) {
        frame = ui->modeller.ready ? &ui->modeller.view.frame : NULL;
        presentation = &ui->modeller.view.presentation; resources = &ui->modeller.view.resources;
    }
    if (!nova_presentation_layout_region(width,height,fw,fh,region,false,&present)) {
        message(ui,"Invalid native game panel dimensions"); return false;
    }
    bool active = ui->playing && !modal && !sheet && !ui->modeller.active && !IsWindowMinimized() && (IsWindowFocused() || bounded);
    nova_pause_services(&ui->play_resources,!active);
    if (!active) { ui->accumulator = 0; ui->play_focus = false; }
    if (active) {
        if (IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) ui->play_focus = CheckCollisionPointRec(GetMousePosition(),preview);
        ui->accumulator += bounded ? 1.0/60 : fmin(GetFrameTime(),5.0/60);
        NovaInput input = {0};
        if (ui->play_focus) {
            input.horizontal = (IsKeyDown(KEY_D)||IsKeyDown(KEY_RIGHT))-(IsKeyDown(KEY_A)||IsKeyDown(KEY_LEFT));
            input.vertical = (IsKeyDown(KEY_S)||IsKeyDown(KEY_DOWN))-(IsKeyDown(KEY_W)||IsKeyDown(KEY_UP));
            input.action = IsKeyDown(KEY_SPACE);
        }
        while (ui->accumulator >= 1.0/60) {
            if (!nova_game_ui_tick(ui,1.0/60,input)) break;
            ui->accumulator -= 1.0/60;
        }
        frame = ui->playing ? nova_frame(ui->play_engine) : ui->ready ? &ui->frame : NULL;
    }
    if (frame) nova_presentation_world(presentation,frame,resources);
    BeginDrawing();
    nova_ui_begin_frame();
    ClearBackground(nova_ui_style()->background);
    DrawRectangle(0,0,width,58,nova_ui_style()->panel);
    if (!setup) {
        DrawRectangle(0,62,220,height-104,nova_ui_style()->panel);
        DrawRectangle(width-304,62,304,height-104,nova_ui_style()->panel);
        DrawLine(220,62,220,height-42,nova_ui_style()->border);
        DrawLine(width-304,62,width-304,height-42,nova_ui_style()->border);
    }
    if (frame && ui->project.authored.text && !setup) {
        NovaCanvasState canvas = nova_begin_canvas(fw,fh);
        nova_presentation_composite(presentation,frame,resources,present.viewport);
        nova_end_canvas(canvas);
    }
    if (ui->modeller.active) {
        nova_model_ui_draw(&ui->modeller,preview);
    } else if (setup) {
        if (!modal) project_screen(ui,width,height);
    } else if (!modal && !sheet) {
        if (nova_ui_button((Rectangle){12,11,96,34},"Project...",!ui->playing)) open_sheet(ui,NOVA_GAME_SHEET_PROJECT);
        const char *root_name = GetFileName(ui->project.authored.root);
        nova_ui_label(TextFormat("%s%s",root_name,nova_game_dirty(&ui->project) ? "  /  Unsaved" : ""),124,19,width-660,INK);
        button((Rectangle){(float)width-518,11,72,34},"Undo",!ui->playing && ui->project.undo_count,ui,NOVA_GAME_UNDO_ACTION);
        button((Rectangle){(float)width-438,11,72,34},"Redo",!ui->playing && ui->project.redo_count,ui,NOVA_GAME_REDO_ACTION);
        button((Rectangle){(float)width-346,11,92,34},"Save",!ui->playing,ui,NOVA_GAME_SAVE);
        if (ui->playing) {
            button((Rectangle){(float)width-242,11,106,34},"Stop",true,ui,NOVA_GAME_STOP);
            button((Rectangle){(float)width-126,11,112,34},"Restart",true,ui,NOVA_GAME_RESTART);
        } else {
            if (nova_ui_icon_button((Rectangle){(float)width-242,11,228,34},"Run game",NOVA_ICON_PLAY,false,true,
                "Save and run the project's starting room",NULL))
                request(ui,NOVA_GAME_RUN);
        }
        tree(ui,height);
        char title[128];
        snprintf(title,sizeof(title),"%s   /   %s",r ? r->name : "Room",r && r->mode == NOVA_3D ? "3D" : "2D");
        if (context) {
            const NovaGameResource *a = nova_game_resource(&ui->project.data,ui->selected);
            const NovaGameObject *o = nova_game_object(&ui->project.data,ui->selected);
            if (a || o) snprintf(title,sizeof(title),"%s   /   %s",a ? a->name : o->name,
                a ? a->type == NOVA_ASSET_SPRITE ? "Sprite" : "Model" : "Object");
        }
        nova_ui_label(ui->playing ? "Game / starting room" : title,236,76,center_width-196,INK);
        if (!ui->playing) {
            bool appearance = nova_game_resource(&ui->project.data,ui->selected) || nova_game_object(&ui->project.data,ui->selected);
            if (nova_ui_select_button((Rectangle){(float)width-508,69,82,30},"Room",!context,true)) ui->resource_view = false;
            if (nova_ui_select_button((Rectangle){(float)width-418,69,98,30},"Resource",context,appearance)) ui->resource_view = true;
            if (nova_ui_icon_button((Rectangle){236,110,95,30},"Select",NOVA_ICON_SELECT,!ui->place_tool,true,
                "Select an instance; drag it to move, or use arrow keys",NULL)) {
                ui->place_tool = false; ui->resource_view = false;
            }
            const NovaGameObject *palette = nova_game_object(&ui->project.data,ui->palette);
            const NovaGameResource *asset = palette ? nova_game_resource(&ui->project.data,palette->resource) : NULL;
            bool compatible = asset && r && (r->mode == NOVA_2D ? asset->type == NOVA_ASSET_SPRITE : asset->type == NOVA_ASSET_MODEL);
            if (nova_ui_icon_button((Rectangle){340,110,95,30},"Place",NOVA_ICON_ADD,ui->place_tool,compatible,
                "Click the room to place the chosen object","Choose an object matching this room's dimension")) {
                ui->place_tool = true; ui->resource_view = false;
            }
            if (nova_ui_select_button((Rectangle){444,110,110,30},"Grid / snap",ui->snap,true)) ui->snap = !ui->snap;
            if (nova_ui_button((Rectangle){563,110,103,30},"Room setup",true) && clean_values(ui)) selection(ui,ui->room);
            nova_ui_label(context ? "Appearance preview / use Room to return to layout" :
                compatible ? TextFormat("Place: %s  /  Click to place, or Select to move instances",palette->name) :
                "Choose a matching object in Resources to enable Place.",236,149,center_width,MUTED);
            Rectangle plane = r && r->mode == NOVA_3D ?
                (Rectangle){236,preview.y+preview.height+32,(float)center_width,(float)canvas_height-preview.height-32} :
                (Rectangle){present.viewport.x*width/fw,present.viewport.y*height/fh,
                    present.viewport.width*width/fw,present.viewport.height*height/fh};
            ui->plane_bounds = plane;
            if (!context) layout(ui,plane);
            if (ui->stale) nova_ui_label("Preview failed / previous frame retained. Details below.",244,184,center_width-16,RED);
            properties(ui,width-290,height);
        } else {
            nova_ui_label("Click the game to control it. WASD / arrows move; Space acts.",236,119,center_width,MUTED);
            nova_ui_label("Game is running",width-290,76,277,INK);
            nova_ui_label("Stop to return to your room.",width-290,112,277,MUTED);
        }
        bool typing = ui->name_focus || ui->path_focus || ui->location_focus;
        for (int i = 0; i < 16; ++i) typing |= ui->field_focus[i];
        if (!typing && !ui->playing && ui->sheet == NOVA_GAME_SHEET_NONE) {
            if (nova_ui_command() && IsKeyPressed(KEY_S)) request(ui,NOVA_GAME_SAVE);
            if (nova_ui_command() && IsKeyPressed(KEY_Z)) request(ui,IsKeyDown(KEY_LEFT_SHIFT)||IsKeyDown(KEY_RIGHT_SHIFT) ? NOVA_GAME_REDO_ACTION : NOVA_GAME_UNDO_ACTION);
            if (IsKeyPressed(KEY_DELETE) || IsKeyPressed(KEY_BACKSPACE)) ui->dialog = NOVA_GAME_DIALOG_DELETE;
            const NovaGameInstance *n = nova_game_instance(&ui->project.data,ui->selected);
            if (n && r) {
                int dx = IsKeyPressed(KEY_RIGHT)-IsKeyPressed(KEY_LEFT);
                int dy = IsKeyPressed(KEY_DOWN)-IsKeyPressed(KEY_UP);
                if (dx || dy) {
                    NovaVec3 p = n->position;
                    p.x += dx*r->snap;
                    if (r->mode == NOVA_2D) p.y += dy*r->snap; else p.z += dy*r->snap;
                    nova_game_ui_move(ui,p);
                }
            }
        }
    }
    if (!setup && ui->sheet != NOVA_GAME_SHEET_NONE && !modal) creation_sheet(ui,width,height);
    if (modal) dialog(ui,width,height);
    if (!ui->modeller.active) {
        DrawRectangle(0,height-42,width,42,nova_ui_style()->panel);
        const char *summary=ui->message;
        if (strstr(summary,"PARTIAL SAVE")) summary = "Save incomplete. Some files were written; Run was cancelled. Open Details before retrying.";
        else if (strstr(summary,"preflight failed")) summary = "The saved game could not be validated. Run was cancelled; your previous game is retained. Details";
        else if (ui->stale) summary = "Preview could not refresh. Your draft and previous preview are retained. Open Details.";
        else if (ui->action_failed) summary = ui->last_action == NOVA_GAME_RUN || ui->last_action == NOVA_GAME_RESTART ?
            "Run could not start. Your draft and previous game are retained. Open Details." :
            ui->last_action == NOVA_GAME_SAVE ? "Save did not finish. Your changes are retained. Open Details." :
            ui->last_action == NOVA_GAME_OPEN ? "Project could not open. Your current project is retained. Open Details." :
            "Could not complete the action. Open Details for the reason; your changes are retained.";
        else if (strlen(summary) > 140) summary = ui->playing ? "Running. Stop returns to your unchanged room." : "Action needs attention. Open Details for the full diagnostic.";
        if (*ui->hint) summary = ui->hint;
        nova_ui_label(summary,12,height-31,width-130,MUTED);
        if (!modal && nova_ui_button((Rectangle){(float)width-108,(float)height-35,94,28},"Details",true)) {
            ui->dialog = NOVA_GAME_DIALOG_DETAILS; nova_ui_text_reset(&ui->details);
        }
    }
    nova_ui_end_frame();
    if (bounded && ui->quit) message(ui,"Bounded run ended");
    bool captured = !*ui->capture || nova_capture_native(ui->capture,fw,fh);
    EndDrawing();
    return captured && !nova_ui_style_error()[0];
}
