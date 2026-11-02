#ifndef NOVA_GAME_UI_H
#define NOVA_GAME_UI_H

#include "game.h"
#include "model_ui.h"
#include "widgets.h"

typedef enum {
    NOVA_GAME_NEW, NOVA_GAME_OPEN, NOVA_GAME_IMPORT, NOVA_GAME_OBJECT, NOVA_GAME_ROOM,
    NOVA_GAME_PLACE, NOVA_GAME_APPLY, NOVA_GAME_DELETE, NOVA_GAME_UNDO_ACTION, NOVA_GAME_REDO_ACTION,
    NOVA_GAME_SAVE, NOVA_GAME_RUN, NOVA_GAME_STOP, NOVA_GAME_RESTART, NOVA_GAME_SELECT,
    NOVA_GAME_NEW_MODEL
} NovaGameAction;
typedef enum { NOVA_GAME_DIALOG_NONE, NOVA_GAME_DIALOG_DISCARD, NOVA_GAME_DIALOG_DELETE,
    NOVA_GAME_DIALOG_CONFLICT, NOVA_GAME_DIALOG_DETAILS, NOVA_GAME_DIALOG_CLOSE } NovaGameDialog;
typedef enum { NOVA_GAME_SHEET_NONE, NOVA_GAME_SHEET_NEW, NOVA_GAME_SHEET_OPEN,
    NOVA_GAME_SHEET_IMPORT, NOVA_GAME_SHEET_OBJECT, NOVA_GAME_SHEET_ROOM,
    NOVA_GAME_SHEET_PROJECT, NOVA_GAME_SHEET_MODEL } NovaGameSheet;
typedef struct {
    NovaGameProject project;
    NovaEngine *preview_engine, *play_engine;
    NovaResources preview_resources, play_resources;
    NovaPresentation presentation;
    NovaFrame frame;
    NovaGame staged;
    NovaModelUI modeller;
    NovaGameDialog dialog;
    NovaGameAction pending;
    NovaGameAction last_action;
    bool action_failed;
    NovaGameSheet sheet;
    uint32_t object_appearance;
    bool resource_view, collapsed[4];
    int inspector_scroll, outline_scroll, choice_scroll;
    int inspector_top, inspector_bottom;
    Rectangle preview_bounds, plane_bounds;
    uint32_t selected, room, palette, browser_room;
    NovaMode new_mode;
    bool playing, play_focus, stale, ready, place_tool, snap, values_dirty, dragging, quit, advanced;
    bool browser_import;
    bool close_after_modeller;
    bool name_focus, path_focus, location_focus, field_focus[16];
    char name[32], path[NOVA_NATIVE_PATH_CAPACITY], location[NOVA_NATIVE_PATH_CAPACITY];
    char fields[16][64], message[1024], preview_error[1024], pending_path[NOVA_NATIVE_PATH_CAPACITY];
    char advanced_path[NOVA_NATIVE_PATH_CAPACITY];
    char hint[192];
    int tree_scroll, browser_scroll;
    FilePathList files;
    char fixture[NOVA_NATIVE_PATH_CAPACITY];
    char capture[NOVA_NATIVE_PATH_CAPACITY];
    NovaVec3 drag_start, drag_position;
    Vector2 drag_pointer;
    double accumulator;
    size_t revisions;
    NovaTextEditor details;
} NovaGameUI;

bool nova_game_ui_open(NovaGameUI *ui, const char *location, char *error, size_t size);
void nova_game_ui_close(NovaGameUI *ui);
bool nova_game_ui_action(NovaGameUI *ui, NovaGameAction action);
bool nova_game_ui_move(NovaGameUI *ui, NovaVec3 position);
bool nova_game_ui_stage(NovaGameUI *ui);
bool nova_game_ui_tick(NovaGameUI *ui, double dt, NovaInput input);
/* One native frame, using shared presentation. No injected OS input. */
bool nova_game_ui_draw(NovaGameUI *ui, bool bounded);
void nova_game_ui_request_close(NovaGameUI *ui);

#endif
