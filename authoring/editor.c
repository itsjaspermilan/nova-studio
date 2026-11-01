#include "document.h"
#include "widgets.h"
#include "presentation.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

typedef enum { DECISION_NONE, DECISION_SWITCH, DECISION_CLOSE, DECISION_REREAD, DECISION_ENTRY, DECISION_CONFLICT, DECISION_DETAILS } Decision;
typedef struct {
    NovaAuthoringProject project;
    NovaEngine *engine;
    NovaResources resources;
    NovaPresentation presentation;
    NovaProjectValidation validation;
    bool validated, playing, paused, preview_focus, quit;
    unsigned long saved_generation, running_generation;
    char message[1024], reload_error[1024], pending[NOVA_NATIVE_PATH_CAPACITY];
    char open_path[NOVA_NATIVE_PATH_CAPACITY], browse[NOVA_NATIVE_PATH_CAPACITY];
    char property[NOVA_PROJECT_PATH_CAPACITY];
    bool path_focus, browse_focus, property_focus;
    FilePathList files;
    int browser_scroll, tab, selected_document, selected_asset;
    bool saved_inspector;
    NovaTextEditor text[2], disk_text;
    Decision decision;
    double accumulator;
} Editor;

static const Color ink = {226, 234, 246, 255}, muted = {153, 170, 195, 255}, accent = {77, 225, 201, 255};

static bool dirty(const Editor *editor)
{
    return nova_document_dirty(&editor->project.declaration) || nova_document_dirty(&editor->project.source);
}

static NovaDocument *document(Editor *editor)
{
    return editor->selected_document ? &editor->project.source : &editor->project.declaration;
}

static void status(Editor *editor, const char *text)
{
    snprintf(editor->message, sizeof(editor->message), "%s", text);
}

static int compare_paths(const void *a, const void *b)
{
    return strcmp(*(char *const *)a, *(char *const *)b);
}

static void browse(Editor *editor)
{
    if (!DirectoryExists(editor->browse)) { status(editor, "Browser path is not an existing directory"); return; }
    UnloadDirectoryFiles(editor->files);
    editor->files = LoadDirectoryFiles(editor->browse);
    if (editor->files.count) qsort(editor->files.paths, editor->files.count, sizeof(*editor->files.paths), compare_paths);
    editor->browser_scroll = 0;
}

static bool validate(Editor *editor)
{
    editor->validated = nova_validate_project(editor->project.manifest, &editor->validation,
        editor->message, sizeof(editor->message));
    if (editor->validated) status(editor, "Saved files pass shared headless preflight (drafts are not validated)");
    return editor->validated;
}

static bool reload(Editor *editor)
{
    editor->accumulator = 0;
    editor->preview_focus = false;
    if (!*editor->project.manifest) { status(editor, "Open a nova.project before reloading"); return false; }
    editor->playing = nova_open_scene(&editor->engine, &editor->resources,
        editor->project.manifest, true, editor->reload_error, sizeof(editor->reload_error));
    nova_pause_services(&editor->resources, !editor->playing || editor->paused);
    if (editor->playing) {
        editor->running_generation = editor->saved_generation;
        validate(editor);
        char detail[1024];
        bool declaration_matches = nova_document_check_disk(&editor->project.declaration, detail, sizeof(detail));
        bool source_matches = !editor->project.source.text ||
            nova_document_check_disk(&editor->project.source, detail, sizeof(detail));
        if (!declaration_matches || !source_matches)
            status(editor, "Reloaded DISK files, but editor snapshots differ or could not be checked. Review Disk view / explicitly reread; drafts retained.");
        else status(editor, dirty(editor) ? "Reloaded SAVED files; unsaved drafts remain untouched" : "Saved project is running; gameplay restarted");
    } else status(editor, editor->reload_error);
    return editor->playing;
}

static bool open_project(Editor *editor, const char *path)
{
    if (!nova_authoring_open(&editor->project, path, editor->message, sizeof(editor->message))) return false;
    nova_ui_text_reset(&editor->text[0]);
    nova_ui_text_reset(&editor->text[1]);
    nova_ui_text_reset(&editor->disk_text);
    editor->tab = editor->selected_document = editor->selected_asset = 0;
    editor->property[0] = 0; editor->property_focus = false;
    editor->saved_generation++;
    snprintf(editor->open_path, sizeof(editor->open_path), "%s", editor->project.manifest);
    bool running = reload(editor);
    if (*editor->project.source_error)
        snprintf(editor->message, sizeof(editor->message), "Manifest opened; Lua editing unavailable: %.960s", editor->project.source_error);
    return running;
}

static void request_open(Editor *editor, const char *path)
{
    snprintf(editor->pending, sizeof(editor->pending), "%s", path);
    if (dirty(editor)) editor->decision = DECISION_SWITCH;
    else open_project(editor, editor->pending);
}

static void save(Editor *editor, bool overwrite)
{
    NovaDocument *doc = document(editor);
    if (nova_document_save(doc, overwrite, editor->message, sizeof(editor->message))) {
        editor->saved_generation++;
        editor->validated = false;
        status(editor, "Active document saved atomically. Preview is unchanged; Reload saved to apply.");
        editor->decision = DECISION_NONE;
    } else if (doc->has_conflict) editor->decision = DECISION_CONFLICT;
}

static void open_entry(Editor *editor)
{
    NovaProject parsed;
    NovaDocument *manifest = &editor->project.declaration;
    if (!nova_document_check_disk(manifest, editor->message, sizeof(editor->message)) && !manifest->has_conflict) return;
    const NovaDiskText *disk = manifest->has_conflict ? &manifest->conflict : &manifest->saved;
    if (!nova_project_parse(&parsed, disk->text, disk->length, editor->message, sizeof(editor->message))) return;
    if (nova_document_open(&editor->project.source, editor->project.declaration.root, parsed.entry,
        NOVA_SOURCE_EDIT_LIMIT, editor->message, sizeof(editor->message))) {
        nova_ui_text_reset(&editor->text[1]);
        editor->project.source_error[0] = 0;
        editor->tab = editor->selected_document = 1;
        status(editor, "Opened entry from saved manifest; preview is unchanged");
    }
}

static void resolve(Editor *editor, Decision selected)
{
    editor->decision = DECISION_NONE;
    if (selected == DECISION_SWITCH) open_project(editor, editor->pending);
    else if (selected == DECISION_CLOSE) editor->quit = true;
    else if (selected == DECISION_ENTRY) open_entry(editor);
    else if (selected == DECISION_CONFLICT) save(editor, true);
    else if (selected == DECISION_REREAD &&
        nova_document_reread(document(editor), editor->message, sizeof(editor->message))) {
        nova_ui_text_reset(&editor->text[editor->selected_document]);
        status(editor, "Reread disk into active document; preview unchanged");
    }
}

static void browser_panel(Editor *editor, int height)
{
    nova_ui_label("PROJECT BROWSER", 12, 67, 202, accent);
    nova_ui_field_checked((Rectangle){12, 94, 206, 34}, editor->browse, sizeof(editor->browse), &editor->browse_focus,
        editor->message, sizeof(editor->message));
    if (nova_ui_button((Rectangle){12, 135, 62, 33}, "Up", true)) {
        const char *parent = GetPrevDirectoryPath(editor->browse);
        snprintf(editor->browse, sizeof(editor->browse), "%s", parent);
        browse(editor);
    }
    if (nova_ui_button((Rectangle){81, 135, 137, 33}, "List directory", true) ||
        (editor->browse_focus && IsKeyPressed(KEY_ENTER))) browse(editor);
    int row = 0, shown = 0, maximum = (height - 254) / 34;
    Rectangle list = {12, 179, 206, (float)(height - 250)};
    if (CheckCollisionPointRec(GetMousePosition(), list)) {
        editor->browser_scroll -= (int)(GetMouseWheelMove() * 3);
        if (editor->browser_scroll < 0) editor->browser_scroll = 0;
    }
    for (unsigned i = 0; i < editor->files.count; ++i) {
        const char *path = editor->files.paths[i];
        bool directory = DirectoryExists(path);
        if (!directory && !IsFileExtension(path, ".project")) continue;
        if (row++ < editor->browser_scroll) continue;
        if (shown >= maximum) continue;
        char label[256];
        snprintf(label, sizeof(label), "%s%s", directory ? "> " : "", GetFileName(path));
        if (nova_ui_button((Rectangle){12, (float)(179 + shown * 34), 206, 29}, label, true)) {
            if (strlen(path) >= sizeof(editor->browse)) status(editor, "Browser path exceeds native path budget");
            else if (directory) { snprintf(editor->browse, sizeof(editor->browse), "%s", path); browse(editor); return; }
            else request_open(editor, path);
        }
        ++shown;
    }
    if (!row) nova_ui_label("No .project files here", 12, 180, 206, muted);
    if (row > maximum) nova_ui_label("Wheel scrolls projects", 12, height - 65, 206, muted);
}

static const char *type_name(NovaAssetType type)
{
    return type == NOVA_ASSET_SPRITE ? "sprite" : type == NOVA_ASSET_MODEL ? "model" : "audio";
}

static void inspector(Editor *editor, int x, int y, int width, int height)
{
    NovaSceneInspection live = nova_inspect_scene(editor->engine, &editor->resources);
    char line[1024];
    if (nova_ui_button((Rectangle){(float)x, (float)y, 120, 31}, editor->saved_inspector ? "Saved metadata" : "Live metadata", true))
        editor->saved_inspector = !editor->saved_inspector;
    if (nova_ui_button((Rectangle){(float)x + 128, (float)y, 133, 31}, "Preflight saved", *editor->project.manifest != 0))
        validate(editor);
    y += 35;
    const NovaAssetInspection *assets = editor->saved_inspector ? editor->validation.assets : live.assets;
    size_t count = editor->saved_inspector ? (editor->validated ? editor->validation.project.count : 0) : live.count;
    snprintf(line, sizeof(line), "%s: %s", editor->saved_inspector ? "Saved identity" : "Live identity",
        editor->saved_inspector ? (editor->validated ? editor->validation.project.identity : "(preflight needed)") :
        (live.identity && *live.identity ? live.identity : "(v1 / none)"));
    nova_ui_label(line, x, y, width, muted); y += 21;
    snprintf(line, sizeof(line), "Live frame: mode=%d commands=%zu  assets=%zu",
        live.frame ? (int)live.frame->mode : -1, live.frame ? live.frame->count : 0, live.count);
    nova_ui_label(line, x, y, width, ink); y += 22;
    if (count) {
        if (editor->selected_asset < 0 || (size_t)editor->selected_asset >= count) editor->selected_asset = 0;
        if (nova_ui_button((Rectangle){(float)x, (float)y, 42, 30}, "<", true))
            editor->selected_asset = (editor->selected_asset + (int)count - 1) % (int)count;
        if (nova_ui_button((Rectangle){(float)x + 48, (float)y, 42, 30}, ">", true))
            editor->selected_asset = (editor->selected_asset + 1) % (int)count;
        const NovaAssetInspection *asset = &assets[editor->selected_asset];
        snprintf(line, sizeof(line), "%d/%zu  %s  %s", editor->selected_asset + 1, count, type_name(asset->declaration.type), asset->declaration.id);
        nova_ui_label(line, x + 102, y + 7, width - 102, accent); y += 34;
        nova_ui_label(asset->declaration.path, x, y, width, ink); y += 21;
        snprintf(line, sizeof(line), "resource=%zu bytes=%zu pixels=%dx%d", asset->resource_index, asset->input_bytes, asset->width, asset->height);
        nova_ui_label(line, x, y, width, muted); y += 21;
        snprintf(line, sizeof(line), "primitives=%zu vertices=%zu PCM=%uHz/%uch/%uf", asset->primitives, asset->vertices,
            asset->sample_rate, asset->channels, asset->sample_frames);
        nova_ui_label(line, x, y, width, muted); y += 21;
        snprintf(line, sizeof(line), "bounds (%.2f %.2f %.2f)..(%.2f %.2f %.2f)",
            asset->bounds_min.x, asset->bounds_min.y, asset->bounds_min.z,
            asset->bounds_max.x, asset->bounds_max.y, asset->bounds_max.z);
        nova_ui_label(line, x, y, width, muted); y += 23;
        if (nova_ui_button((Rectangle){(float)x, (float)y, 149, 31}, "Copy path to field", true))
            snprintf(editor->property, sizeof(editor->property), "%s", asset->declaration.path);
        if (nova_ui_button((Rectangle){(float)x + 157, (float)y, 140, 31}, "Apply draft path", *editor->property != 0)) {
            if (nova_authoring_property(&editor->project, type_name(asset->declaration.type), asset->declaration.id,
                editor->property, editor->message, sizeof(editor->message))) {
                nova_ui_text_reset(&editor->text[0]);
                status(editor, "Asset declaration path changed in Manifest draft only");
            }
        }
        y += 35;
    } else { nova_ui_label("No inspected assets in this view", x, y, width, muted); y += 30; }
    if (y + 38 < height - 72)
        nova_ui_field_checked((Rectangle){(float)x, (float)y, (float)width, 34}, editor->property, sizeof(editor->property), &editor->property_focus,
            editor->message, sizeof(editor->message));
    y += 39;
    if (y + 31 < height - 72) {
        if (nova_ui_button((Rectangle){(float)x, (float)y, 123, 31}, "Draft entry", *editor->property != 0)) {
            if (nova_authoring_property(&editor->project, "entry", NULL, editor->property, editor->message, sizeof(editor->message))) {
                nova_ui_text_reset(&editor->text[0]); status(editor, "Entry changed in Manifest draft; Save, then Open saved entry");
            }
        }
        if (nova_ui_button((Rectangle){(float)x + 131, (float)y, 126, 31}, "Draft identity", *editor->property != 0)) {
            if (nova_authoring_property(&editor->project, "identity", NULL, editor->property, editor->message, sizeof(editor->message))) {
                nova_ui_text_reset(&editor->text[0]); status(editor, "Identity changed in Manifest draft only (v2 required)");
            }
        }
    }
}

static void decision(Editor *editor, int width, int height)
{
    if (editor->decision == DECISION_NONE) return;
    DrawRectangle(0, 0, width, height, (Color){0, 0, 0, 190});
    if (editor->decision == DECISION_DETAILS) {
        int x = (width - 800) / 2, y = (height - 440) / 2;
        DrawRectangle(x, y, 800, 440, (Color){31, 43, 59, 255});
        nova_ui_label("STATUS / full diagnostic", x + 20, y + 18, 760, accent);
        const char *text = editor->message;
        for (int row = 0; *text && row < 15; ++row) {
            char line[81];
            size_t count = 0;
            while (count < sizeof(line) - 1 && text[count] && text[count] != '\n') ++count;
            memcpy(line, text, count); line[count] = 0;
            nova_ui_label(line, x + 20, y + 54 + row * 21, 760, ink);
            text += count;
            if (*text == '\n') ++text;
        }
        if (nova_ui_button((Rectangle){(float)x + 20, (float)y + 386, 160, 35}, "Close diagnostic", true))
            resolve(editor, DECISION_NONE);
        return;
    }
    int x = (width - 760) / 2, y = (height - 240) / 2;
    DrawRectangle(x, y, 760, 240, (Color){31, 43, 59, 255});
    bool conflict = editor->decision == DECISION_CONFLICT;
    nova_ui_label(conflict ? "EXTERNAL EDIT / explicit disk-version decision" : "UNSAVED DRAFTS / explicit discard decision", x + 20, y + 20, 720, accent);
    nova_ui_label(conflict ? "Your draft and the observed disk version are both retained." :
        "Cancel keeps every draft. Saving is separate from preview reload.", x + 20, y + 58, 720, ink);
    const char *action = editor->decision == DECISION_SWITCH ? "Discard + switch" :
        editor->decision == DECISION_CLOSE ? "Discard + exit" :
        editor->decision == DECISION_ENTRY ? "Discard Lua + entry" :
        conflict ? "Overwrite shown disk" : "Discard + reread";
    if (nova_ui_button((Rectangle){(float)x + 20, (float)y + 154, 160, 38}, "Keep draft / cancel", true)) {
        editor->decision = DECISION_NONE;
        return;
    }
    if (conflict && nova_ui_button((Rectangle){(float)x + 194, (float)y + 154, 148, 38}, "Review disk text", true)) {
        editor->tab = 2; nova_ui_text_reset(&editor->disk_text); editor->decision = DECISION_NONE;
        return;
    }
    if (nova_ui_button((Rectangle){(float)x + 355, (float)y + 154, 183, 38}, action, true)) {
        resolve(editor, editor->decision);
        return;
    }
    if (conflict && nova_ui_button((Rectangle){(float)x + 552, (float)y + 154, 182, 38}, "Discard + reread", true)) {
        editor->decision = DECISION_REREAD;
    }
}

static void ui(Editor *editor, Rectangle preview)
{
    int width = GetScreenWidth(), height = GetScreenHeight();
    int right = (int)preview.x;
    bool modal = editor->decision != DECISION_NONE;
    /* Underlying controls cannot consume input while a decision is displayed. */
    if (modal) {
        DrawText("NOVA / native project editor", 16, 18, 18, ink);
        decision(editor, width, height);
        return;
    }
    DrawText("NOVA / native project editor", 16, 18, 18, accent);
    nova_ui_field_checked((Rectangle){334, 10, (float)(width - 440), 35}, editor->open_path, sizeof(editor->open_path), &editor->path_focus,
        editor->message, sizeof(editor->message));
    if (nova_ui_button((Rectangle){(float)width - 98, 10, 85, 35}, "Open", true) ||
        (editor->path_focus && IsKeyPressed(KEY_ENTER))) request_open(editor, editor->open_path);
    browser_panel(editor, height);
    bool loaded = editor->project.declaration.text != NULL;
    if (nova_ui_button((Rectangle){236, 65, 107, 33}, nova_document_dirty(&editor->project.declaration) ? "Manifest *" : "Manifest", loaded))
        editor->tab = editor->selected_document = 0;
    if (nova_ui_button((Rectangle){351, 65, 87, 33}, nova_document_dirty(&editor->project.source) ? "Lua *" : "Lua", editor->project.source.text != NULL))
        editor->tab = editor->selected_document = 1;
    if (nova_ui_button((Rectangle){446, 65, 91, 33}, "Disk view", loaded)) {
        editor->tab = 2; nova_ui_text_reset(&editor->disk_text);
    }
    if (nova_ui_button((Rectangle){545, 65, 102, 33}, "Save active", loaded)) save(editor, false);
    if (nova_ui_button((Rectangle){236, 106, 137, 31}, "Reread active", loaded)) editor->decision = DECISION_REREAD;
    if (nova_ui_button((Rectangle){381, 106, 163, 31}, "Open saved entry", loaded)) {
        if (nova_document_dirty(&editor->project.source)) editor->decision = DECISION_ENTRY;
        else open_entry(editor);
    }
    NovaDocument *doc = document(editor);
    if (loaded) {
        nova_ui_label(doc->relative, 236, 146, right - 252, muted);
        Rectangle box = {236, 174, (float)(right - 252), (float)(height - 252)};
        if (editor->tab == 2) {
            NovaDiskText *disk = doc->has_conflict ? &doc->conflict : &doc->saved;
            NovaDocument view = {.text = disk->text, .length = disk->length};
            nova_ui_text(&editor->disk_text, &view, box, false, editor->message, sizeof(editor->message));
        } else nova_ui_text(&editor->text[editor->selected_document], doc, box, true, editor->message, sizeof(editor->message));
        if (nova_ui_command() && IsKeyPressed(KEY_S)) save(editor, false);
        if (nova_ui_command() && IsKeyPressed(KEY_R)) reload(editor);
    } else nova_ui_label("Open a real nova.project to edit", 236, 180, right - 252, ink);
    nova_ui_label(editor->tab == 2 ? (doc->has_conflict ? "READ ONLY: observed external conflict" : "READ ONLY: saved opening/save snapshot") :
        "Select / type / paste; Cmd/Ctrl-S save, R reload, Z one-step undo", 236, height - 65, right - 252, muted);
    if (nova_ui_button((Rectangle){preview.x, 65, 130, 33}, "Reload saved", loaded)) reload(editor);
    if (nova_ui_button((Rectangle){preview.x + 138, 65, 107, 33}, editor->paused ? "Resume" : "Pause", editor->playing))
        editor->paused = !editor->paused;
    NovaSceneInspection live = nova_inspect_scene(editor->engine, &editor->resources);
    DrawRectangleLinesEx(preview, 1, editor->preview_focus ? accent : muted);
    DrawRectangle((int)preview.x + 2, (int)preview.y + 2, (int)preview.width - 4, 28, (Color){19, 27, 39, 245});
    nova_ui_label(!live.loaded ? "NO LIVE PROJECT" : !editor->playing ? "RELOAD/SCENE FAILED: prior frame retained, paused" :
        editor->paused ? "PAUSED / saved live frame" : "RUNNING / click preview for gameplay input", (int)preview.x + 8, (int)preview.y + 8, (int)preview.width - 16,
        editor->playing ? accent : (Color){255, 140, 140, 255});
    char line[1024];
    snprintf(line, sizeof(line), "Live: %s", live.source ? live.source : "(none)");
    nova_ui_label(line, (int)preview.x, (int)(preview.y + preview.height + 8), (int)preview.width, muted);
    snprintf(line, sizeof(line), "Draft=%s disk=%s local save/live=%lu/%lu",
        dirty(editor) ? "UNSAVED" : "clean",
        editor->project.declaration.has_conflict || editor->project.source.has_conflict ? "CONFLICT" : "snapshot",
        editor->saved_generation, editor->running_generation);
    nova_ui_label(line, (int)preview.x, (int)(preview.y + preview.height + 33), (int)preview.width, ink);
    inspector(editor, (int)preview.x, (int)(preview.y + preview.height + 63), (int)preview.width, height);
    if (IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
        editor->preview_focus = CheckCollisionPointRec(GetMousePosition(), preview);
        if (editor->preview_focus) {
            editor->text[0].focused = editor->text[1].focused = editor->disk_text.focused = false;
            editor->path_focus = editor->browse_focus = editor->property_focus = false;
        }
    }
    nova_ui_label(editor->message, 12, height - 32, width - 116, *editor->reload_error ? (Color){255, 160, 150, 255} : ink);
    if (nova_ui_button((Rectangle){(float)width - 100, (float)height - 39, 88, 31}, "Details", *editor->message != 0))
        editor->decision = DECISION_DETAILS;
}

static NovaInput input(const Editor *editor)
{
    if (!editor->preview_focus || editor->decision != DECISION_NONE || nova_ui_command()) return (NovaInput){0};
    return (NovaInput){
        (IsKeyDown(KEY_D) || IsKeyDown(KEY_RIGHT)) - (IsKeyDown(KEY_A) || IsKeyDown(KEY_LEFT)),
        (IsKeyDown(KEY_S) || IsKeyDown(KEY_DOWN)) - (IsKeyDown(KEY_W) || IsKeyDown(KEY_UP)),
        IsKeyDown(KEY_SPACE)
    };
}

static const char *smoke_source(bool green)
{
    return green ?
        "-- Original native editor authoring evidence (MIT)\n"
        "nova.scene('mixed')\nlocal badge=nova.asset('badge')\nlocal alias=nova.asset('alias')\nlocal gem=nova.asset('gem')\n"
        "function update(dt,input)\n nova.background(18,24,41)\n nova.camera(0,2,6,0,0,0,55)\n"
        " nova.model(gem,0,0,0,1)\n nova.sprite(badge,24,64,48,48)\n nova.sprite(alias,80,64,48,48)\n"
        " nova.rectangle(250,210,100,80,77,225,201)\nend\n" :
        "-- Original native editor authoring evidence (MIT)\n"
        "nova.scene('mixed')\nlocal badge=nova.asset('badge')\nlocal alias=nova.asset('alias')\nlocal gem=nova.asset('gem')\n"
        "function update(dt,input)\n nova.background(18,24,41)\n nova.camera(0,2,6,0,0,0,55)\n"
        " nova.model(gem,0,0,0,1)\n nova.sprite(badge,24,64,48,48)\n nova.sprite(alias,80,64,48,48)\n"
        " nova.rectangle(250,210,100,80,80,120,220)\nend\n";
}

static bool fixture_write(const char *root, const char *relative, const char *bytes, size_t length,
    bool binary, char *error, size_t size)
{
    NovaDocument output = {0};
    bool ok = nova_document_open_output(&output, root, relative, NOVA_ASSET_FILE_LIMIT, binary, error, size) &&
        nova_document_replace(&output, 0, output.length, bytes, length, error, size) &&
        nova_document_save(&output, false, error, size);
    nova_document_close(&output);
    return ok;
}

static bool smoke_fixture(char *root, char *manifest, char *error, size_t size)
{
    strcpy(root, "/tmp/nova-editor-XXXXXX");
    if (!mkdtemp(root)) { snprintf(error, size, "Could not create isolated editor fixture"); return false; }
    char assets[NOVA_NATIVE_PATH_CAPACITY];
    snprintf(assets, sizeof(assets), "%s/assets", root);
    if (mkdir(assets, 0700)) { snprintf(error, size, "Could not create fixture assets directory"); return false; }
    const char *names[] = {"badge.png", "gem.glb"};
    for (size_t i = 0; i < 2; ++i) {
        char source[NOVA_NATIVE_PATH_CAPACITY], relative[64];
        snprintf(source, sizeof(source), "%s/examples/assets/assets/%s", GetApplicationDirectory(), names[i]);
        snprintf(relative, sizeof(relative), "assets/%s", names[i]);
        int length;
        unsigned char *bytes = nova_read_file(source, NOVA_ASSET_FILE_LIMIT, &length, error, size);
        if (!bytes) return false;
        bool ok = fixture_write(root, relative, (const char *)bytes, (size_t)length, true, error, size);
        free(bytes);
        if (!ok) return false;
    }
    const char *declarations = "nova-project 1\nentry main.lua\nsprite badge assets/badge.png\nsprite alias assets/badge.png\nmodel gem assets/gem.glb\n";
    if (!fixture_write(root, "nova.project", declarations, strlen(declarations), false, error, size) ||
        !fixture_write(root, "main.lua", smoke_source(false), strlen(smoke_source(false)), false, error, size)) return false;
    snprintf(manifest, NOVA_NATIVE_PATH_CAPACITY, "%s/nova.project", root);
    return true;
}

static bool smoke_edit(Editor *editor, const char *text)
{
    editor->selected_document = editor->tab = 1;
    editor->text[1].anchor = 0; editor->text[1].cursor = editor->project.source.length;
    return nova_ui_text_insert(&editor->text[1], &editor->project.source, text, strlen(text),
        editor->message, sizeof(editor->message));
}

static bool smoke_step(Editor *editor, int frame)
{
#define VERIFY(condition) do { if (!(condition)) { \
    snprintf(editor->message, sizeof(editor->message), "Editor smoke failed at frame %d: %s", frame, #condition); \
    return false; } } while (0)
    static NovaEngine *retained;
    static unsigned texture;
    NovaSceneInspection inspection = nova_inspect_scene(editor->engine, &editor->resources);
    if (frame == 3) {
        VERIFY(inspection.loaded && inspection.count == 3 && inspection.assets[0].resource_index == inspection.assets[1].resource_index);
        VERIFY(smoke_edit(editor, smoke_source(true)) && dirty(editor));
        VERIFY(nova_frame(editor->engine)->commands[3].color.b == 220);
        retained = editor->engine;
    } else if (frame == 5) {
        request_open(editor, "/missing/editor-smoke/nova.project");
        VERIFY(editor->decision == DECISION_SWITCH && dirty(editor));
        resolve(editor, DECISION_NONE);
        VERIFY(editor->engine == retained && dirty(editor));
    } else if (frame == 8) {
        save(editor, false);
        VERIFY(!dirty(editor) && editor->engine == retained && nova_frame(editor->engine)->commands[3].color.b == 220);
    } else if (frame == 12) {
        VERIFY(reload(editor) && nova_frame(editor->engine)->commands[3].color.g == 225);
        retained = editor->engine; texture = editor->resources.resources[0].texture.id;
    } else if (frame == 18) {
        VERIFY(smoke_edit(editor, "not valid Lua!"));
        save(editor, false);
        VERIFY(!dirty(editor) && !reload(editor));
        VERIFY(editor->engine == retained && editor->resources.resources[0].texture.id == texture);
        VERIFY(!editor->playing && *editor->reload_error);
    } else if (frame == 25) {
        VERIFY(smoke_edit(editor, smoke_source(true)));
        save(editor, false);
        VERIFY(reload(editor) && !*editor->reload_error);
    } else if (frame == 32) {
        editor->text[1].anchor = editor->text[1].cursor = editor->project.source.length;
        VERIFY(nova_ui_text_insert(&editor->text[1], &editor->project.source, "-- kept draft\n", 14,
            editor->message, sizeof(editor->message)));
        VERIFY(fixture_write(editor->project.source.root, "main.lua", "-- external version\n", 20, false,
            editor->message, sizeof(editor->message)));
        save(editor, false);
        VERIFY(editor->decision == DECISION_CONFLICT && dirty(editor) && editor->project.source.has_conflict);
    } else if (frame == 35) {
        editor->decision = DECISION_NONE; editor->tab = 2;
    } else if (frame == 40) {
        VERIFY(fixture_write(editor->project.source.root, "main.lua", "-- newer external\n", 18, false,
            editor->message, sizeof(editor->message)));
        resolve(editor, DECISION_CONFLICT);
        VERIFY(editor->decision == DECISION_CONFLICT && dirty(editor) &&
            !strcmp(editor->project.source.conflict.text, "-- newer external\n"));
    } else if (frame == 43) {
        resolve(editor, DECISION_CONFLICT);
        VERIFY(!dirty(editor) && !editor->project.source.has_conflict);
    } else if (frame == 46) {
        VERIFY(reload(editor));
    } else if (frame == 52) {
        editor->text[1].anchor = editor->text[1].cursor = editor->project.source.length;
        VERIFY(nova_ui_text_insert(&editor->text[1], &editor->project.source, "-- preserved\n", 13,
            editor->message, sizeof(editor->message)));
        retained = editor->engine;
        request_open(editor, "/missing/editor-smoke/nova.project");
        resolve(editor, DECISION_SWITCH);
        VERIFY(dirty(editor) && editor->engine == retained && strstr(editor->project.source.text, "-- preserved"));
    } else if (frame == 56) {
        resolve(editor, DECISION_REREAD);
        VERIFY(!dirty(editor));
    } else if (frame == 62) {
        editor->selected_document = editor->tab = 0;
        VERIFY(!nova_authoring_property(&editor->project, "entry", NULL, "../escape.lua", editor->message, sizeof(editor->message)));
        VERIFY(nova_authoring_property(&editor->project, "sprite", "badge", "assets/missing.png", editor->message, sizeof(editor->message)));
        save(editor, false);
        retained = editor->engine; texture = editor->resources.resources[0].texture.id;
        VERIFY(!reload(editor) && editor->engine == retained && editor->resources.resources[0].texture.id == texture);
    } else if (frame == 68) {
        VERIFY(nova_authoring_property(&editor->project, "sprite", "badge", "assets/badge.png", editor->message, sizeof(editor->message)));
        save(editor, false);
        VERIFY(reload(editor) && !dirty(editor));
        editor->selected_document = editor->tab = 1;
        status(editor, "Native smoke: draft/save/reload, Lua/import rollback, newer disk conflict and dirty-switch guards verified");
    }
    return true;
#undef VERIFY
}

static bool smoke_pixels(const NovaPresentationLayout *layout)
{
    Image image = LoadImageFromScreen();
    if (!IsImageValid(image)) return false;
    int x = (int)(layout->viewport.x + 300 * layout->viewport.scale);
    int y = (int)(layout->viewport.y + 250 * layout->viewport.scale);
    Color scene = GetImageColor(image, x, y), chrome = GetImageColor(image, 4, 4);
    bool ok = image.width == layout->framebuffer_width && image.height == layout->framebuffer_height &&
        scene.r == 77 && scene.g == 225 && scene.b == 201 && chrome.r == 19 && chrome.g == 27 && chrome.b == 39;
    UnloadImage(image);
    return ok;
}

static bool smoke_cleanup(const char *root)
{
    if (!*root) return true;
    const char *files[] = {"assets/badge.png", "assets/gem.glb", "main.lua", "nova.project"};
    char path[NOVA_NATIVE_PATH_CAPACITY];
    for (size_t i = 0; i < 4; ++i) { snprintf(path, sizeof(path), "%s/%s", root, files[i]); unlink(path); }
    snprintf(path, sizeof(path), "%s/assets", root); rmdir(path);
    if (rmdir(root)) { fprintf(stderr, "Editor fixture cleanup failed; preserved directory: %s\n", root); return false; }
    return true;
}

int main(int argc, char **argv)
{
    const char *project = NULL, *directory = NULL, *capture = NULL;
    bool smoke = false;
    int limit = 0;
    for (int i = 1; i < argc; ++i) {
        if (!strcmp(argv[i], "--smoke")) smoke = true;
        else if (!strcmp(argv[i], "--project") && i + 1 < argc) project = argv[++i];
        else if (!strcmp(argv[i], "--browse") && i + 1 < argc) directory = argv[++i];
        else if (!strcmp(argv[i], "--capture") && i + 1 < argc) capture = argv[++i];
        else if (!strcmp(argv[i], "--frames") && i + 1 < argc) {
            char *end;
            long count = strtol(argv[++i], &end, 10);
            if (*end || count < 1 || count > 100000) goto usage;
            limit = (int)count;
        } else goto usage;
    }
    if ((capture && !limit) || (smoke && (project || limit < 90))) goto usage;
    char fixture_root[NOVA_NATIVE_PATH_CAPACITY] = {0}, fixture_manifest[NOVA_NATIVE_PATH_CAPACITY];
    Editor *editor = calloc(1, sizeof(*editor));
    if (!editor) { fprintf(stderr, "Nova editor: out of memory\n"); return 1; }
    SetConfigFlags(FLAG_WINDOW_RESIZABLE | FLAG_VSYNC_HINT);
    InitWindow(1280, 800, "Nova Studio / Native project editor");
    SetWindowMinSize(1200, 780);
    SetExitKey(KEY_NULL);
    SetTargetFPS(60);
    int result = 0;
    if (!IsWindowReady() || !nova_presentation_configure(&editor->presentation, nova_world_resolution_default(),
        editor->message, sizeof(editor->message))) {
        fprintf(stderr, "Nova editor: %s\n", editor->message);
        result = 1; goto cleanup;
    }
    snprintf(editor->browse, sizeof(editor->browse), "%s", directory ? directory : TextFormat("%s/examples", GetApplicationDirectory()));
    browse(editor);
    if (smoke) {
        if (!smoke_fixture(fixture_root, fixture_manifest, editor->message, sizeof(editor->message))) {
            fprintf(stderr, "Nova editor: %s\n", editor->message);
            result = 1; goto cleanup;
        }
        project = fixture_manifest;
    }
    if (project && !open_project(editor, project)) result = 1;
    int frames = 0;
    while (!editor->quit) {
        if (smoke && !smoke_step(editor, frames)) {
            fprintf(stderr, "%s\n", editor->message); result = 1; break;
        }
        if (WindowShouldClose()) {
            if (!dirty(editor)) break;
            if (editor->decision == DECISION_NONE) editor->decision = DECISION_CLOSE;
        }
        int width = GetScreenWidth(), height = GetScreenHeight();
        int framebuffer_width = GetRenderWidth(), framebuffer_height = GetRenderHeight();
        Rectangle preview = {(float)width - 450, 106, 436, 245};
        NovaFramebufferRect region = {
            (int)lroundf(preview.x * framebuffer_width / width),
            (int)lroundf(preview.y * framebuffer_height / height),
            (int)lroundf(preview.width * framebuffer_width / width),
            (int)lroundf(preview.height * framebuffer_height / height)
        };
        NovaPresentationLayout layout;
        NovaSceneInspection live = nova_inspect_scene(editor->engine, &editor->resources);
        if (!nova_presentation_layout_region(width, height, framebuffer_width, framebuffer_height, region,
            live.frame && live.frame->mode == NOVA_2D, &layout)) {
            status(editor, "Invalid native preview framebuffer dimensions"); result = 1; break;
        }
        bool active = editor->playing && !editor->paused && !IsWindowMinimized() &&
            (IsWindowFocused() || limit) && editor->decision == DECISION_NONE;
        nova_pause_services(&editor->resources, !active);
        if (active) {
            editor->accumulator += limit ? 1.0 / 60 : fmin(GetFrameTime(), 5.0 / 60);
            while (editor->accumulator >= 1.0 / 60) {
                if (!nova_tick(editor->engine, 1.0 / 60, input(editor)) ||
                    !nova_tick_services(editor->engine, &editor->resources)) {
                    snprintf(editor->reload_error, sizeof(editor->reload_error), "%s", nova_error(editor->engine));
                    status(editor, editor->reload_error); editor->playing = false;
                    nova_pause_services(&editor->resources, true); result = 1; break;
                }
                editor->accumulator -= 1.0 / 60;
            }
        } else editor->accumulator = 0;
        live = nova_inspect_scene(editor->engine, &editor->resources);
        if (live.loaded) nova_presentation_world(&editor->presentation, live.frame, &editor->resources);
        BeginDrawing();
        ClearBackground((Color){19, 27, 39, 255});
        NovaCanvasState canvas = nova_begin_canvas(framebuffer_width, framebuffer_height);
        if (live.loaded) nova_presentation_composite(&editor->presentation, live.frame, &editor->resources, layout.viewport);
        nova_end_canvas(canvas);
        ui(editor, preview);
        Vector2 pointer;
        if (CheckCollisionPointRec(GetMousePosition(), preview) &&
            nova_presentation_pointer(&layout, GetMousePosition(), &pointer) && editor->decision == DECISION_NONE) {
            char coordinates[128];
            snprintf(coordinates, sizeof(coordinates), "Logical pointer %.0f, %.0f", pointer.x, pointer.y);
            nova_ui_label(coordinates, (int)preview.x + 8, (int)(preview.y + preview.height - 24), (int)preview.width - 16, ink);
        }
        ++frames;
        if (smoke && frames >= limit && !smoke_pixels(&layout)) {
            fprintf(stderr, "Editor smoke: exact native preview/chrome pixels failed\n"); result = 1;
        }
        if (limit && frames >= limit && capture && !nova_capture_native(capture, framebuffer_width, framebuffer_height)) result = 1;
        EndDrawing();
        if (limit && frames >= limit) {
            live = nova_inspect_scene(editor->engine, &editor->resources);
            printf("NOVA_EDITOR frames=%d preview=%s world=%dx%d native=%dx%d declarations=%zu commands=%zu draft=%s status=%s\n",
                frames, editor->playing ? "running" : "stopped", editor->presentation.world.texture.width,
                editor->presentation.world.texture.height, framebuffer_width, framebuffer_height,
                live.count, live.frame ? live.frame->count : 0, dirty(editor) ? "dirty" : "clean", result ? "error" : "ok");
            if (smoke) printf("NOVA_EDITOR_SMOKE draft-save-reload=ok lua-import-rollback=ok newer-conflict=ok dirty-switch=ok native-pixels=%s\n", result ? "error" : "ok");
            break;
        }
    }
cleanup:
    nova_destroy(editor->engine);
    nova_unload_resources(&editor->resources);
    nova_shutdown_audio();
    nova_presentation_destroy(&editor->presentation);
    nova_authoring_close(&editor->project);
    nova_ui_text_reset(&editor->text[0]); nova_ui_text_reset(&editor->text[1]); nova_ui_text_reset(&editor->disk_text);
    UnloadDirectoryFiles(editor->files);
    CloseWindow();
    free(editor);
    if (!smoke_cleanup(fixture_root)) result = 1;
    return result;
usage:
    fprintf(stderr, "Usage: nova_editor [--project nova.project] [--browse directory] [--frames 1..100000 [--capture native.png]] [--smoke --frames N>=90]\n");
    return 2;
}
