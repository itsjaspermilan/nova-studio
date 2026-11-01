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
    *ui = (NovaGameUI){.new_mode = NOVA_2D, .snap = true};
    snprintf(ui->name, sizeof(ui->name), "MyGame");
    snprintf(ui->location, sizeof(ui->location), "%s", location);
    strcpy(ui->fixture, "/tmp/nova-game-preview-XXXXXX");
    if (!mkdtemp(ui->fixture)) { snprintf(error, size, "Create private game preview: %s", strerror(errno)); ui->fixture[0] = 0; return false; }
    char canonical[NOVA_NATIVE_PATH_CAPACITY];
    if (!realpath(ui->fixture, canonical)) { snprintf(error, size, "Canonical preview path failed"); return false; }
    strcpy(ui->fixture, canonical);
    if (!nova_presentation_configure(&ui->presentation, nova_world_resolution_default(), error, size)) return false;
    browse(ui);
    message(ui, "Choose a location and New 2D/3D project, or open game.nova-game. Hand-authored projects are under Advanced.");
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
    if (action == NOVA_GAME_STOP) { stop(ui); return true; }
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
            ui->palette = p->data.object[0].id; ui->advanced_path[0] = 0; }
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
    case NOVA_GAME_OBJECT:
        ok = nova_game_add_object(p, ui->selected, ui->name, ERROR);
        if (ok) { selection(ui, p->data.object[p->data.objects-1].id); message(ui, "Reusable object created. Add behaviors, then select a room and place it."); }
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
    case NOVA_GAME_SELECT: selection(ui, ui->selected); return true;
    case NOVA_GAME_STOP: return true;
    }
    if (ok && action != NOVA_GAME_RUN && action != NOVA_GAME_RESTART && p->authored.text)
        ok = nova_game_ui_stage(ui);
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
    if (appearance) {
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
        return;
    }
    nova_game_ui_action(ui, action);
}

static bool button(Rectangle rect, const char *label, bool enabled, NovaGameUI *ui, NovaGameAction action)
{
    if (!nova_ui_button(rect, label, enabled)) return false;
    request(ui, action); return true;
}

static void tree_row(NovaGameUI *ui, const char *name, uint32_t id, int *row, int maximum)
{
    int n = (*row)++;
    if (n < ui->tree_scroll || n >= ui->tree_scroll+maximum) return;
    if (nova_ui_select_button((Rectangle){12, (float)(114+(n-ui->tree_scroll)*28), 200, 25}, name,
        ui->selected == id, !ui->playing) && clean_values(ui)) selection(ui, id);
}

static void tree_heading(NovaGameUI *ui, const char *name, int *row, int maximum)
{
    int n = (*row)++;
    if (n >= ui->tree_scroll && n < ui->tree_scroll+maximum)
        nova_ui_label(name, 14, 117+(n-ui->tree_scroll)*28, 194, nova_ui_style()->accent);
}

static void tree(NovaGameUI *ui, int height)
{
    nova_ui_label("RESOURCES", 14, 75, 190, INK);
    Rectangle box = {0,110,220,(float)(height-220)};
    if (CheckCollisionPointRec(GetMousePosition(), box)) {
        ui->tree_scroll -= (int)(GetMouseWheelMove()*3);
        if (ui->tree_scroll < 0) ui->tree_scroll = 0;
    }
    int row = 0, max = (height-250)/28;
    const NovaGame *g = &ui->project.data;
    tree_heading(ui, "Sprites / Models", &row, max);
    for (size_t i = 0; i < g->resources; ++i) tree_row(ui, g->resource[i].name, g->resource[i].id, &row, max);
    tree_heading(ui, "Objects", &row, max);
    for (size_t i = 0; i < g->objects; ++i) tree_row(ui, g->object[i].name, g->object[i].id, &row, max);
    tree_heading(ui, "Rooms", &row, max);
    for (size_t i = 0; i < g->rooms; ++i) {
        char label[64]; snprintf(label, sizeof(label), "%s%s", g->room[i].id == g->start ? "* " : "", g->room[i].name);
        tree_row(ui, label, g->room[i].id, &row, max);
        for (size_t j = 0; j < g->instances; ++j) if (g->instance[j].room == g->room[i].id) {
            snprintf(label, sizeof(label), "  %s", g->instance[j].name);
            tree_row(ui, label, g->instance[j].id, &row, max);
        }
    }
    if (ui->tree_scroll > row-1) ui->tree_scroll = row > 0 ? row-1 : 0;
    button((Rectangle){12,(float)height-132,95,30}, "Undo", g->rooms && !ui->playing, ui, NOVA_GAME_UNDO_ACTION);
    button((Rectangle){116,(float)height-132,96,30}, "Redo", g->rooms && !ui->playing, ui, NOVA_GAME_REDO_ACTION);
    if (nova_ui_button((Rectangle){12,(float)height-94,200,30}, "Delete selected...", ui->selected && !ui->playing) && clean_values(ui))
        ui->dialog = NOVA_GAME_DIALOG_DELETE;
}

static void field(NovaGameUI *ui, int index, const char *label, int x, int y)
{
    nova_ui_label(label, x, y+6, 132, MUTED);
    if (nova_ui_field_checked((Rectangle){(float)x+132,(float)y,145,28}, ui->fields[index],
        sizeof(ui->fields[index]), &ui->field_focus[index], ERROR)) ui->values_dirty = true;
}

static void toggle(NovaGameUI *ui, int event, const char *label, int x, int y)
{
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

static void properties(NovaGameUI *ui, int x)
{
    const NovaGame *g = &ui->project.data;
    const NovaGameInstance *n = nova_game_instance(g, ui->selected);
    const NovaGameObject *o = nova_game_object(g, ui->selected);
    const NovaGameRoom *r = nova_game_room(g, ui->selected);
    const NovaGameResource *a = nova_game_resource(g, ui->selected);
    nova_ui_label(n ? "INSTANCE PROPERTIES" : o ? "OBJECT EVENTS / ACTIONS" : r ? "ROOM PROPERTIES" : a ? "APPEARANCE" : "Select a resource or instance",
        x, 115, 280, INK);
    if (!n && !o && !r && !a) return;
    field(ui, 0, "Name", x, 145);
    int y = 181;
    if (n) {
        const char *labels[] = {"X", "Y / height", "Z (3D)", "Instance scale"};
        const NovaGameRoom *owner_room = nova_game_room(g,n->room);
        for (int i = 0; i < 4; ++i) {
            if (i == 2 && owner_room && owner_room->mode == NOVA_2D)
                nova_ui_label("Z: 3D rooms only",x,y+i*32+6,277,MUTED);
            else field(ui, i+1, labels[i], x, y+i*32);
        }
        y += 140;
        const NovaGameObject *owner = nova_game_object(g,n->object);
        nova_ui_label(owner ? TextFormat("Object: %s",owner->name) : "Missing object", x,y,277,MUTED);
        if (nova_ui_button((Rectangle){(float)x,(float)y+28,277,30}, "Edit reusable object", true) && clean_values(ui))
            selection(ui,n->object);
        y += 66;
    } else if (o) {
        const char *labels[] = {"Draw size / scale", "Controls speed", "Create X", "Create Y", "Create Z",
            "Step move X/sec", "Step move Y/sec", "Step move Z/sec", "Primary offset X", "Primary offset Y", "Primary offset Z"};
        const NovaGameResource *appearance = nova_game_resource(g,o->resource);
        for (int i = 0; i < 11; ++i) {
            if (appearance && appearance->type == NOVA_ASSET_SPRITE && (i == 4 || i == 7 || i == 10))
                nova_ui_label("Z: model objects only",x,y+i*29+6,277,MUTED);
            else field(ui,i+1,labels[i],x,y+i*29);
        }
        y += 326;
        toggle(ui,0,"Create: set position",x,y);
        toggle(ui,1,"Step: move with controls",x,y+31);
        toggle(ui,2,"Step: constant movement",x,y+62);
        toggle(ui,3,"Primary press: move by offset",x,y+93);
        y += 130;
    } else if (r) {
        const char *labels[] = {"Grid snap", "Camera X", "Camera Y", "Camera Z", "Look at X", "Look at Y", "Look at Z", "Field of view"};
        int count = r->mode == NOVA_2D ? 1 : 8;
        for (int i = 0; i < count; ++i) field(ui,i+1,labels[i],x,y+i*31);
        y += count*31+8;
        nova_ui_label(r->mode == NOVA_2D ? "2D room: logical 960 x 540" : "3D room: XZ floor, Y height", x,y,277,MUTED);
        if (nova_ui_button((Rectangle){(float)x,(float)y+30,277,30}, g->start == r->id ? "Designated starting room" : "Make starting room", true) && clean_values(ui)) {
            NovaGame candidate = *g; candidate.start = r->id;
            nova_game_commit(&ui->project,&candidate,ERROR);
        }
        y += 76;
    } else if (a) {
        nova_ui_label(a->type == NOVA_ASSET_SPRITE ? "Validated PNG sprite" : "Validated static GLB model",x,y,277,MUTED);
        nova_ui_label(a->path,x,y+27,277,MUTED);
        if (nova_ui_button((Rectangle){(float)x,(float)y+60,277,34}, "Create object using this", true))
            request(ui,NOVA_GAME_OBJECT);
        if (a->type == NOVA_ASSET_MODEL && nova_ui_button((Rectangle){(float)x,(float)y+104,277,34}, "Original static modeller", true) && clean_values(ui)) {
            char manifest[NOVA_NATIVE_PATH_CAPACITY];
            NovaProject saved;
            bool declared = false;
            if (nova_project_parse(&saved,ui->project.manifest.saved.text,ui->project.manifest.saved.length,ERROR)) {
                for (size_t i = 0; i < saved.count; ++i)
                    if (saved.assets[i].type == NOVA_ASSET_MODEL && !strcmp(saved.assets[i].path,a->path)) declared = true;
                if (!declared) message(ui,"Save the game explicitly before modelling this imported appearance; no implicit save or export occurred.");
                else if (nova_project_resolve(ui->project.authored.root,NOVA_GAME_MANIFEST,manifest,ERROR))
                    nova_model_ui_open(&ui->modeller,manifest,ui->project.authored.root,a->path,ERROR);
            }
        }
        y += 155;
    }
    button((Rectangle){(float)x,(float)y,134,31},"Apply properties",true,ui,NOVA_GAME_APPLY);
    if (nova_ui_button((Rectangle){(float)x+143,(float)y,134,31},"Reset values",true)) values(ui);
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

static void browser(NovaGameUI *ui, int width, int height)
{
    nova_ui_label(ui->browser_import ? "ADD APPEARANCE / choose PNG or static GLB" :
        "New Project -> Appearance -> Object -> Room -> Run",240,114,width-570,INK);
    nova_ui_label("Location (existing directory)",240,154,220,MUTED);
    nova_ui_field_checked((Rectangle){240,180,(float)width-575,33},ui->location,sizeof(ui->location),&ui->location_focus,ERROR);
    if (nova_ui_button((Rectangle){240,225,95,32},"Up",true)) {
        snprintf(ui->location,sizeof(ui->location),"%s",GetPrevDirectoryPath(ui->location)); browse(ui);
    }
    if (nova_ui_button((Rectangle){344,225,155,32},"List location",true)) browse(ui);
    nova_ui_label("Project / new resource name is in the Name field above.",240,280,width-575,MUTED);
    if (!ui->browser_import) button((Rectangle){240,351,132,34},"New project",true,ui,NOVA_GAME_NEW);
    nova_ui_label(ui->browser_import ? "Choose a file below, enter a unique Name, then Import selected." :
        "New opens a runnable starting room with an original player.",240,397,width-575,MUTED);
    int shown = 0, row = 0, max = (height-530)/32;
    Rectangle region = {240,440,(float)width-575,(float)height-530};
    if (CheckCollisionPointRec(GetMousePosition(),region)) {
        ui->browser_scroll -= (int)(GetMouseWheelMove()*3);
        if (ui->browser_scroll < 0) ui->browser_scroll = 0;
    }
    for (unsigned i = 0; i < ui->files.count; ++i) {
        const char *path = ui->files.paths[i];
        bool dir = DirectoryExists(path);
        bool game = !strcmp(GetFileName(path),NOVA_GAME_FILE);
        bool sprite = IsFileExtension(path,".png"), model = IsFileExtension(path,".glb");
        if (!dir && !game && !sprite && !model) continue;
        if (row++ < ui->browser_scroll || shown >= max) continue;
        char label[256]; snprintf(label,sizeof(label),"%s%s",dir ? "> " : "",GetFileName(path));
        if (nova_ui_button((Rectangle){240,(float)(440+shown*32),(float)width-575,29},label,true)) {
            if (strlen(path) >= sizeof(ui->path)) message(ui,"Path exceeds budget");
            else if (dir) { strcpy(ui->location,path); browse(ui); return; }
            else {
                strcpy(ui->path,path);
                if (game) request(ui,NOVA_GAME_OPEN);
                else {
                    ui->new_mode = sprite ? NOVA_2D : NOVA_3D;
                    message(ui,"Appearance selected. Enter a unique Name, then Import selected; the original is never changed.");
                }
            }
        }
        ++shown;
    }
    if (ui->project.authored.text) {
        button((Rectangle){(float)width-310,300,277,34},"Import selected appearance",true,ui,NOVA_GAME_IMPORT);
        if (nova_ui_button((Rectangle){(float)width-310,344,277,34},"Return to room / cancel picker",true) && clean_values(ui)) {
            selection(ui,nova_game_room(&ui->project.data,ui->browser_room) ? ui->browser_room : ui->project.data.start);
            ui->browser_import = false;
        }
    }
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
    bool modal = ui->dialog != NOVA_GAME_DIALOG_NONE;
    if (ui->close_after_modeller && ui->modeller.active && ui->modeller.decision == NOVA_MODEL_DECISION_NONE &&
        !ui->modeller.close) ui->close_after_modeller = false;
    nova_model_ui_update(&ui->modeller);
    if (ui->close_after_modeller && !ui->modeller.active) {
        ui->close_after_modeller = false; nova_game_ui_request_close(ui);
        modal = ui->dialog != NOVA_GAME_DIALOG_NONE;
    }
    if (ui->modeller.exported) {
        ui->modeller.exported = false; ui->staged.resources = NOVA_MAX_ASSETS+1;
        nova_game_ui_stage(ui);
        message(ui,"Model exported separately. Preview restaged; Run remains explicit and guarded.");
    }
    const NovaGameRoom *r = nova_game_room(&ui->project.data,ui->room);
    bool context = nova_game_resource(&ui->project.data,ui->selected) || nova_game_object(&ui->project.data,ui->selected);
    Rectangle preview = {240,151,(float)width-575, r && r->mode == NOVA_3D && !ui->playing && !context ? 285 : (float)height-330};
    if (ui->modeller.active) preview = (Rectangle){(float)width-450,106,436,245};
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
    if (!nova_presentation_layout_region(width,height,fw,fh,region,frame && frame->mode == NOVA_2D,&present)) {
        message(ui,"Invalid native game panel dimensions"); return false;
    }
    bool active = ui->playing && !modal && !ui->modeller.active && !IsWindowMinimized() && (IsWindowFocused() || bounded);
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
    ClearBackground(nova_ui_style()->background);
    DrawRectangle(0,0,width,58,nova_ui_style()->panel);
    DrawRectangle(0,62,222,height-110,nova_ui_style()->panel);
    DrawRectangle(width-312,105,312,height-153,nova_ui_style()->panel);
    if (frame && ui->project.authored.text) {
        NovaCanvasState canvas = nova_begin_canvas(fw,fh);
        nova_presentation_composite(presentation,frame,resources,present.viewport);
        nova_end_canvas(canvas);
    }
    if (ui->modeller.active) {
        nova_model_ui_draw(&ui->modeller,preview);
    } else if (!modal) {
        nova_ui_label("Nova Studio / Objects and Rooms",14,18,285,INK);
        button((Rectangle){306,10,110,35},nova_game_dirty(&ui->project) ? "Save *" : "Save",ui->project.authored.text && !ui->playing,ui,NOVA_GAME_SAVE);
        button((Rectangle){425,10,83,35},"Run",ui->project.authored.text && !ui->playing,ui,NOVA_GAME_RUN);
        button((Rectangle){516,10,83,35},"Stop",ui->playing,ui,NOVA_GAME_STOP);
        button((Rectangle){607,10,90,35},"Restart",ui->playing,ui,NOVA_GAME_RESTART);
        if (nova_ui_button((Rectangle){705,10,100,35},"Advanced",!ui->playing) && clean_values(ui)) {
            ui->advanced = true; message(ui,"Advanced preserves visual drafts. Generated edits are not adopted or overwritten by visual Save.");
        }
        if (nova_ui_button((Rectangle){814,10,115,35},"Projects / New",!ui->playing) && clean_values(ui)) {
            ui->browser_room = ui->room; ui->room = 0; ui->browser_import = false;
        }
        if (nova_ui_select_button((Rectangle){240,70,74,31},"2D",ui->new_mode == NOVA_2D,!ui->playing)) ui->new_mode = NOVA_2D;
        if (nova_ui_select_button((Rectangle){321,70,74,31},"3D",ui->new_mode == NOVA_3D,!ui->playing)) ui->new_mode = NOVA_3D;
        nova_ui_label("Name",404,77,45,MUTED);
        nova_ui_field_checked((Rectangle){451,70,220,31},ui->name,sizeof(ui->name),&ui->name_focus,ERROR);
        nova_ui_label("File",680,77,33,MUTED);
        nova_ui_field_checked((Rectangle){722,70,(float)width-859,31},ui->path,sizeof(ui->path),&ui->path_focus,ERROR);
        button((Rectangle){(float)width-127,70,113,31},"Open game",!ui->playing,ui,NOVA_GAME_OPEN);
        tree(ui,height);
        if (!ui->room) browser(ui,width,height);
        else {
            nova_ui_label(ui->playing ? "GAME / designated starting room" : context ? "APPEARANCE / reusable object preview" :
                r && r->mode == NOVA_3D ? "ROOM LAYOUT / native 3D" : "ROOM LAYOUT / native 2D",
                240,116,width-575,INK);
            if (!ui->playing) {
                Rectangle plane = r && r->mode == NOVA_3D ?
                    (Rectangle){240,450,(float)width-575,(float)height-635} :
                    (Rectangle){present.viewport.x*width/fw,present.viewport.y*height/fh,
                        present.viewport.width*width/fw,present.viewport.height*height/fh};
                if (!context) layout(ui,plane);
                else if (nova_ui_button((Rectangle){240,450,200,32},"Open room Layout",true) && clean_values(ui))
                    selection(ui,ui->room);
                if (nova_ui_select_button((Rectangle){240,(float)height-174,130,30},"Select / move",!ui->place_tool,true))
                    ui->place_tool = false;
                if (nova_ui_select_button((Rectangle){379,(float)height-174,130,30},"Place object",ui->place_tool,true))
                    ui->place_tool = true;
                if (nova_ui_select_button((Rectangle){518,(float)height-174,110,30},"Grid / snap",ui->snap,true))
                    ui->snap = !ui->snap;
                const NovaGameObject *o = nova_game_object(&ui->project.data,ui->palette);
                nova_ui_label(o ? TextFormat("Place: %s (select an object in the tree)",o->name) : "Select an object in the tree to place",
                    240,height-136,width-575,MUTED);
                if (nova_ui_button((Rectangle){240,(float)height-104,145,31},"Add Sprite / Model",true) && clean_values(ui)) {
                    ui->browser_room = ui->room; ui->room = 0; ui->browser_import = true;
                    snprintf(ui->location,sizeof(ui->location),"%s",ui->project.authored.root); browse(ui);
                    message(ui,"Choose a PNG/static GLB in the native file browser, then Import selected. No files saved by switching views.");
                }
                button((Rectangle){394,(float)height-104,135,31},"Add room",true,ui,NOVA_GAME_ROOM);
                if (ui->stale) nova_ui_label("FAILED / retained preview",240,137,width-575,RED);
            }
            if (!ui->playing) properties(ui,width-298);
        }
        bool typing = ui->name_focus || ui->path_focus || ui->location_focus;
        for (int i = 0; i < 16; ++i) typing |= ui->field_focus[i];
        if (!typing && !ui->playing) {
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
    if (modal) dialog(ui,width,height);
    DrawRectangle(0,height-46,width,46,nova_ui_style()->panel);
    nova_ui_label(ui->message,12,height-38,width-130,MUTED);
    if (!modal && nova_ui_button((Rectangle){(float)width-108,(float)height-39,94,30},"Details",true)) {
        ui->dialog = NOVA_GAME_DIALOG_DETAILS; nova_ui_text_reset(&ui->details);
    }
    if (bounded && ui->quit) message(ui,"Bounded run ended");
    bool captured = !*ui->capture || nova_capture_native(ui->capture,fw,fh);
    EndDrawing();
    return captured && !nova_ui_style_error()[0];
}
