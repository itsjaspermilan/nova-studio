#include "game_ui.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static Vector2 mouse = {-100,-100};
static bool pressed, released;
static int key;
static bool command;
static const char *characters;
static float wheel;
static bool capture_next;
Vector2 nova_game_test_mouse(void) { return mouse; }
bool nova_game_test_press(int button) { return button == MOUSE_BUTTON_LEFT && pressed; }
bool nova_game_test_release(int button) { return button == MOUSE_BUTTON_LEFT && released; }
bool nova_game_test_key(int code) { return code == key; }
bool nova_game_test_down(int code) { return command && code == KEY_LEFT_CONTROL; }
int nova_game_test_char(void) { return characters && *characters ? (unsigned char)*characters++ : 0; }
float nova_game_test_wheel(void) { return wheel; }
bool nova_game_test_focus(void) { return true; }

#define CHECK(x) do { if (!(x)) { fprintf(stderr,"%d: %s: %s\n",__LINE__,#x,ui->message); exit(1); } } while (0)

static void draw(NovaGameUI *ui)
{
    char capture[sizeof(ui->capture)];
    snprintf(capture,sizeof(capture),"%s",ui->capture);
    if (!capture_next) ui->capture[0] = 0;
    CHECK(nova_game_ui_draw(ui,false));
    snprintf(ui->capture,sizeof(ui->capture),"%s",capture);
    capture_next = false;
    pressed = released = false;
    key = 0; wheel = 0;
}

static void click(NovaGameUI *ui, float x, float y)
{
    mouse = (Vector2){x,y}; pressed = true;
    draw(ui); mouse = (Vector2){-100,-100};
}

static void select_id(NovaGameUI *ui, uint32_t id)
{
    ui->selected = id;
    CHECK(nova_game_ui_action(ui,NOVA_GAME_SELECT));
}

static void type_field(NovaGameUI *ui, float x, float y, const char *text)
{
    click(ui,x,y);
    command = true; key = KEY_A; draw(ui); command = false;
    characters = text; draw(ui);
    CHECK(!*characters);
    characters = NULL;
}

static void evidence(NovaGameUI *ui, const char *name)
{
    capture_next = true;
    draw(ui);
    Image image = LoadImage(ui->capture);
    CHECK(IsImageValid(image));
    char path[4096];
    snprintf(path,sizeof(path),"%s/%s.png",NOVA_GAME_TEST_DIRECTORY,name);
    CHECK(ExportImage(image,path)); UnloadImage(image);
}

static void choose_file(NovaGameUI *ui, const char *name, bool importing)
{
    int row = 0;
    for (unsigned i = 0; i < ui->files.count; ++i) {
        const char *path = ui->files.paths[i];
        bool dir = DirectoryExists(path);
        bool game = !strcmp(GetFileName(path),NOVA_GAME_FILE);
        bool asset = IsFileExtension(path,ui->new_mode == NOVA_2D ? ".png" : ".glb");
        if (!dir && !(importing ? asset : game)) continue;
        if (!strcmp(GetFileName(path),name)) {
            float x = importing ? GetScreenWidth()/2-350 : (GetScreenWidth()-880)/2+50;
            float y = importing ? GetScreenHeight()/2+(-305+24+154+70+16) : 421;
            click(ui,x,y+row*30);
            return;
        }
        ++row;
    }
    CHECK(false);
}

static void add_room(NovaGameUI *ui, const char *name, NovaMode mode)
{
    /* Resources has seven initial visible rows: Sprites, appearance, Models,
     * appearance (3D), Objects, player, Rooms. Find the Rooms header row. */
    const NovaGame *g = &ui->project.data;
    int row = 3+(int)g->resources+(int)g->objects;
    click(ui,188,(float)(118+row*28));
    CHECK(ui->sheet == NOVA_GAME_SHEET_ROOM);
    int x = GetScreenWidth()/2-390+24, y = GetScreenHeight()/2-305+24;
    type_field(ui,x+130,y+114,name);
    click(ui,x+(mode == NOVA_2D ? 450 : 610),y+114);
    evidence(ui,mode == NOVA_2D ? "ux-create-room-2d" : "ux-create-room-3d");
    click(ui,GetScreenWidth()/2+250,GetScreenHeight()/2+262);
    CHECK(ui->sheet == NOVA_GAME_SHEET_NONE && !strcmp(nova_game_room(g,ui->room)->name,name));
}

static size_t pixels(NovaGameUI *ui, Color color)
{
    capture_next = true; draw(ui);
    Image image = LoadImage(ui->capture);
    CHECK(IsImageValid(image));
    Color *colors = LoadImageColors(image);
    CHECK(colors);
    size_t count = 0;
    for (int i = 0; i < image.width*image.height; ++i)
        if (colors[i].r == color.r && colors[i].g == color.g && colors[i].b == color.b) ++count;
    UnloadImageColors(colors); UnloadImage(image);
    return count;
}

static void write_file(NovaGameUI *ui, const char *name, const char *bytes, size_t length, bool binary)
{
    NovaDocument doc = {0};
    CHECK(nova_document_open_output(&doc,ui->project.authored.root,name,NOVA_ASSET_FILE_LIMIT,binary,
        ui->message,sizeof(ui->message)));
    CHECK(nova_document_replace(&doc,0,doc.length,bytes,length,ui->message,sizeof(ui->message)));
    CHECK(nova_document_save(&doc,false,ui->message,sizeof(ui->message)));
    nova_document_close(&doc);
}

static void remove_game(NovaGameUI *ui)
{
    char path[4096];
    for (size_t i = 0; i < ui->project.data.resources; ++i) {
        CHECK(nova_project_resolve(ui->project.authored.root,ui->project.data.resource[i].path,path,ui->message,sizeof(ui->message)));
        CHECK(!unlink(path));
    }
    const char *files[] = {NOVA_GAME_FILE,NOVA_GAME_MANIFEST,NOVA_GAME_LUA};
    for (size_t i = 0; i < 3; ++i) {
        CHECK(nova_project_resolve(ui->project.authored.root,files[i],path,ui->message,sizeof(ui->message)));
        CHECK(!unlink(path));
    }
    snprintf(path,sizeof(path),"%s/resource_1.glb.nova-model",ui->project.authored.root);
    if (FileExists(path)) CHECK(!unlink(path));
    strcpy(path,ui->project.authored.root);
    nova_game_close(&ui->project);
    CHECK(!rmdir(path));
}

static void standalone(NovaGameUI *ui, const char *editor, const char *runtime)
{
    char manifest[4096], source[4096], capture[4096];
    CHECK(nova_project_resolve(ui->project.authored.root,NOVA_GAME_MANIFEST,manifest,ui->message,sizeof(ui->message)));
    CHECK(nova_project_resolve(ui->project.authored.root,NOVA_GAME_FILE,source,ui->message,sizeof(ui->message)));
    for (int i = 0; i < 2; ++i) {
        snprintf(capture,sizeof(capture),"%s/%s",ui->fixture,i ? "runtime.png" : "reopened.png");
        pid_t child = fork();
        CHECK(child >= 0);
        if (!child) {
            if (i) execl(runtime,runtime,"--project",manifest,"--frames","2","--capture",capture,(char *)NULL);
            else execl(editor,editor,"--game",source,"--frames","2","--capture",capture,(char *)NULL);
            _exit(127);
        }
        int status;
        CHECK(waitpid(child,&status,0) == child && WIFEXITED(status) && WEXITSTATUS(status) == 0);
        Image image = LoadImage(capture);
        CHECK(IsImageValid(image));
        Color *colors = LoadImageColors(image);
        CHECK(colors);
        size_t count = 0;
        Color expected = ui->project.data.room[0].mode == NOVA_2D ? (Color){77,225,201,255} : (Color){80,190,230,255};
        for (int p = 0; p < image.width*image.height; ++p)
            if (colors[p].r == expected.r && colors[p].g == expected.g && colors[p].b == expected.b) ++count;
        CHECK(count > 100);
        UnloadImageColors(colors); UnloadImage(image);
    }
}

int main(int argc, char **argv)
{
    if (argc != 3) { fprintf(stderr,"Requires editor and runtime paths\n"); return 2; }
    SetTraceLogLevel(LOG_WARNING);
    SetConfigFlags(FLAG_WINDOW_HIDDEN);
    InitWindow(1200,780,"Private Nova workflow test");
    char error[1024] = {0};
    if (!IsWindowReady() || !nova_ui_style_open(error,sizeof(error))) {
        fprintf(stderr,"%s\n",error); return 1;
    }
    char parent[] = "/tmp/nova-game-ui-test-XXXXXX";
    if (!mkdtemp(parent)) return 1;
    NovaGameUI *ui = calloc(1,sizeof(*ui));
    CHECK(ui);
    CHECK(nova_game_ui_open(ui,parent,ui->message,sizeof(ui->message)));
    snprintf(ui->capture,sizeof(ui->capture),"%s/native.png",ui->fixture);
    evidence(ui,"ux-welcome");
    for (int mode = NOVA_2D; mode <= NOVA_3D; ++mode) {
        SetWindowSize(1200,780);
        snprintf(ui->location,sizeof(ui->location),"%s",parent);
        ui->sheet = NOVA_GAME_SHEET_NEW;
        int w = GetScreenWidth(), h = GetScreenHeight();
        int px = (w-880)/2;
        type_field(ui,px+160,264,mode == NOVA_2D ? "Game2D" : "Game3D");
        click(ui,px+(mode == NOVA_2D ? 500 : 680),264);
        CHECK(ui->new_mode == (NovaMode)mode);
        click(ui,px+740,(float)h-108);
        CHECK(ui->project.data.rooms == 1 && ui->project.data.instances == 1 && ui->ready && !ui->stale);
        CHECK(ui->sheet == NOVA_GAME_SHEET_NONE);
        uint32_t starting = ui->project.data.start;
        draw(ui);
        CHECK(pixels(ui,mode == NOVA_2D ? (Color){77,225,201,255} : (Color){80,190,230,255}) > 100);
        CHECK(ui->preview_bounds.width >= 640 && ui->plane_bounds.height > 180);
        if (mode == NOVA_3D) {
            select_id(ui,1);
            click(ui,w-150,355);
            CHECK(ui->modeller.active && ui->modeller.model.count == 1);
            draw(ui);
            CHECK(ui->modeller.ready && !ui->modeller.stale);
            nova_model_ui_request_close(&ui->modeller); draw(ui);
            CHECK(!ui->modeller.active && !ui->quit && ui->project.data.instances == 1);
            select_id(ui,starting);
        }
        add_room(ui,"SecondRoom",(NovaMode)mode);
        uint32_t second_room = ui->room;
        CHECK(ui->project.data.rooms == 2 && ui->project.data.start == starting);
        if (mode == NOVA_3D) {
            mouse = (Vector2){(float)w-140,520}; wheel = -8; draw(ui); mouse = (Vector2){-100,-100};
        }
        click(ui,w-150,mode == NOVA_2D ? 309 : 588-ui->inspector_scroll);
        CHECK(ui->project.data.start == second_room);
        select_id(ui,starting);
        click(ui,w-130,28);
        CHECK(nova_frame(ui->play_engine)->count == 0); /* Runs start, not currently edited room. */
        click(ui,w-190,28);
        CHECK(!ui->playing && ui->room == starting);
        if (mode == NOVA_3D) {
            mouse = (Vector2){(float)w-140,520}; wheel = -8; draw(ui); mouse = (Vector2){-100,-100};
        }
        click(ui,w-150,mode == NOVA_2D ? 309 : 588-ui->inspector_scroll);
        CHECK(ui->project.data.start == starting);
        /* Contextual + on Sprites / Models opens a local import form. */
        click(ui,188,mode == NOVA_2D ? 118 : 146);
        CHECK(ui->sheet == NOVA_GAME_SHEET_IMPORT && ui->room == starting);
        int sx = w/2-390+24, sy = h/2-305+24;
        type_field(ui,sx+120,sy+114,"Appearance");
        choose_file(ui,mode == NOVA_2D ? "resource_1.png" : "resource_1.glb",true);
        CHECK(ui->project.data.resources == 1); /* Selection alone never writes. */
        evidence(ui,mode == NOVA_2D ? "ux-import-2d" : "ux-import-3d");
        click(ui,w/2+250,h/2+262);
        uint32_t appearance = ui->selected;
        CHECK(ui->sheet == NOVA_GAME_SHEET_NONE && appearance != 1 && ui->project.data.resources == 2);
        CHECK(!ui->resource_view && ui->room == starting);
        click(ui,w-375,82); /* Appearance preview is explicit; Room restores the layout. */
        CHECK(ui->resource_view);
        click(ui,w-467,82);
        CHECK(!ui->resource_view && ui->room == starting && ui->selected == appearance);
        click(ui,w-375,82);
        click(ui,95,h/2+30+56);
        CHECK(!ui->resource_view && ui->selected == starting);
        click(ui,95,118+(mode == NOVA_2D ? 2 : 3)*28);
        CHECK(ui->selected == appearance && ui->room == starting);
        click(ui,w-160,271); /* Appearance -> local Create Object prompt. */
        CHECK(ui->sheet == NOVA_GAME_SHEET_OBJECT && ui->object_appearance == appearance);
        type_field(ui,sx+120,sy+114,"ControlledObject");
        evidence(ui,mode == NOVA_2D ? "ux-create-object-2d" : "ux-create-object-3d");
        click(ui,w/2+250,h/2+262);
        uint32_t object = ui->selected;
        CHECK(nova_game_object(&ui->project.data,object)->resource == appearance);
        CHECK(!ui->resource_view && ui->room == starting);
        click(ui,w-160,334); /* Step: move with controls in contextual inspector. */
        CHECK(nova_game_object(&ui->project.data,object)->controls);
        type_field(ui,w-100,370,mode == NOVA_2D ? "120" : "4");
        CHECK(ui->values_dirty);
        CHECK(!nova_game_ui_action(ui,NOVA_GAME_SAVE));
        click(ui,w-220,h-68);
        CHECK(!ui->values_dirty && nova_game_object(&ui->project.data,object)->speed == (mode == NOVA_2D ? 120 : 4));
        evidence(ui,mode == NOVA_2D ? "ux-object-2d" : "ux-object-3d");
        click(ui,w-160,404); /* Expand Step velocity. */
        CHECK(nova_game_object(&ui->project.data,object)->step_move);
        click(ui,w-160,mode == NOVA_2D ? 548 : 582); /* Expand Create position. */
        CHECK(nova_game_object(&ui->project.data,object)->create_position);
        mouse = (Vector2){(float)w-140,520}; wheel = -20; draw(ui);
        CHECK(ui->inspector_scroll > 0);
        click(ui,w-160,632); /* Primary press toggle is reachable by inspector scroll. */
        CHECK(nova_game_object(&ui->project.data,object)->primary_move);
        mouse = (Vector2){(float)w-140,520}; wheel = -20; draw(ui);
        type_field(ui,w-100,mode == NOVA_2D ? 594 : 560,"2");
        click(ui,w-220,h-68);
        CHECK(nova_game_object(&ui->project.data,object)->primary.x == 2);
        evidence(ui,mode == NOVA_2D ? "ux-events-2d-scrolled" : "ux-events-3d-scrolled");
        /* Turn Create back off so these instances start at their placed position. */
        select_id(ui,object);
        click(ui,w-160,mode == NOVA_2D ? 548 : 582);
        CHECK(!nova_game_object(&ui->project.data,object)->create_position);
        /* Choosing the object has kept the room active. Place is adjacent to
         * the canvas; no hidden Open Layout navigation is needed. */
        click(ui,385,124);
        CHECK(ui->place_tool && ui->palette == object && !ui->resource_view);
        draw(ui);
        Rectangle plane = ui->plane_bounds;
        click(ui,plane.x+plane.width/2,plane.y+plane.height/2);
        CHECK(ui->project.data.instances == 2 && nova_game_instance(&ui->project.data,ui->selected)->object == object);
        uint32_t placed = ui->selected;
        click(ui,280,124);
        CHECK(nova_game_ui_move(ui,(NovaVec3){mode == NOVA_2D ? 193 : 1.13f,0,mode == NOVA_2D ? 0 : 1.13f}));
        const NovaGameInstance *n = nova_game_instance(&ui->project.data,placed);
        CHECK(n->position.x == (mode == NOVA_2D ? 192 : 1));
        CHECK(mode == NOVA_2D || n->position.z == 1);
        size_t undo = ui->project.undo_count;
        Vector2 point = mode == NOVA_2D ?
            (Vector2){plane.x+(n->position.x+4)*plane.width/960,plane.y+(n->position.y+4)*plane.height/540} :
            (Vector2){plane.x+(n->position.x+10)*plane.width/20,plane.y+(n->position.z+10)*plane.height/20};
        mouse = point; pressed = true; draw(ui);
        CHECK(ui->dragging && ui->project.undo_count == undo);
        mouse.x += mode == NOVA_2D ? 32*plane.width/960 : plane.width/20;
        draw(ui);
        CHECK(ui->project.undo_count == undo); /* Intermediate drag is not an undo step. */
        released = true; draw(ui);
        CHECK(!ui->dragging && ui->project.undo_count == undo+1);
        CHECK(nova_game_ui_action(ui,NOVA_GAME_UNDO_ACTION));
        CHECK(nova_game_instance(&ui->project.data,placed)->position.x == (mode == NOVA_2D ? 192 : 1));
        CHECK(nova_game_ui_action(ui,NOVA_GAME_REDO_ACTION));
        mouse = (Vector2){-100,-100};
        type_field(ui,w-100,190,"PlacedHero");
        type_field(ui,w-100,mode == NOVA_2D ? 330 : 364,"1.5");
        click(ui,w-220,h-68);
        CHECK(!ui->values_dirty);
        click(ui,w-300,28);
        NovaGame saved = ui->project.data;
        CHECK(!nova_game_dirty(&ui->project));
        /* Open uses local browser selection followed by an explicit primary
         * action, not clicking a path or a shared global field. */
        click(ui,55,28);
        CHECK(ui->sheet == NOVA_GAME_SHEET_PROJECT);
        click(ui,sx+120,sy+158);
        CHECK(ui->sheet == NOVA_GAME_SHEET_OPEN);
        choose_file(ui,NOVA_GAME_FILE,false);
        CHECK(ui->sheet == NOVA_GAME_SHEET_OPEN && !memcmp(&saved,&ui->project.data,sizeof(saved)));
        evidence(ui,mode == NOVA_2D ? "ux-open-2d" : "ux-open-3d");
        click(ui,px+740,h-108);
        CHECK(!memcmp(&saved,&ui->project.data,sizeof(saved)));
        CHECK(ui->sheet == NOVA_GAME_SHEET_NONE);
        /* Separate scene outline selects a placed instance, not a resource. */
        click(ui,95,h/2+30+76+28+12);
        CHECK(ui->selected == placed);
        click(ui,w-130,28);
        CHECK(ui->playing);
        NovaEngine *engine = ui->play_engine;
        unsigned gpu = ui->play_resources.resources[0].texture.id;
        NovaVec3 initial = nova_frame(engine)->commands[1].position;
        CHECK(nova_game_ui_tick(ui,1.0/60,(NovaInput){1,1,false}));
        CHECK(nova_frame(engine)->commands[1].position.x > initial.x);
        CHECK(mode == NOVA_2D ? nova_frame(engine)->commands[1].position.y > initial.y : nova_frame(engine)->commands[1].position.z > initial.z);
        float before_action = nova_frame(engine)->commands[1].position.x;
        CHECK(nova_game_ui_tick(ui,1.0/60,(NovaInput){0,0,true}));
        CHECK(fabsf(nova_frame(engine)->commands[1].position.x-before_action-2) < 0.001f);
        click(ui,w-190,28);
        CHECK(!ui->playing);
        CHECK(ui->selected == placed && !memcmp(&saved,&ui->project.data,sizeof(saved)));
        click(ui,w-130,28);
        CHECK(nova_game_ui_tick(ui,1.0/60,(NovaInput){1,0,false}));
        click(ui,w-65,28); /* Real Restart button resets simulation, not room edits. */
        CHECK(ui->playing);
        CHECK(nova_frame(ui->play_engine)->commands[1].position.x == initial.x);
        click(ui,w-190,28);
        draw(ui);
        CHECK(pixels(ui,mode == NOVA_2D ? (Color){77,225,201,255} : (Color){80,190,230,255}) > 100);
        standalone(ui,argv[1],argv[2]);
        evidence(ui,mode == NOVA_2D ? "ux-room-2d-minimum" : "ux-room-3d-minimum");
        SetWindowSize(1440,900);
        draw(ui);
        CHECK(ui->preview_bounds.width >= 880 && ui->plane_bounds.height > 240);
        evidence(ui,mode == NOVA_2D ? "ux-room-2d-large" : "ux-room-3d-large");
        SetWindowSize(1200,780); draw(ui);
        engine = ui->play_engine; gpu = ui->play_resources.resources[0].texture.id;
        /* Saved invalid assets abort Run and retain the actual prior engine. */
        NovaDocument original = {0};
        CHECK(nova_document_open_output(&original,ui->project.authored.root,ui->project.data.resource[0].path,
            NOVA_ASSET_FILE_LIMIT,true,ui->message,sizeof(ui->message)));
        write_file(ui,ui->project.data.resource[0].path,"bad",3,true);
        CHECK(!nova_game_ui_action(ui,NOVA_GAME_RUN));
        CHECK(ui->play_engine == engine && ui->play_resources.resources[0].texture.id == gpu && !ui->playing);
        CHECK(!memcmp(&saved,&ui->project.data,sizeof(saved)) && strstr(ui->message,"preflight failed"));
        NovaEngine *preview = ui->preview_engine;
        ui->staged.resources = NOVA_MAX_ASSETS+1;
        CHECK(!nova_game_ui_stage(ui) && ui->stale && ui->ready && ui->preview_engine == preview);
        write_file(ui,original.relative,original.text,original.length,true);
        nova_document_close(&original);
        CHECK(nova_game_ui_stage(ui) && !ui->stale);
        CHECK(nova_game_ui_action(ui,NOVA_GAME_RUN));
        CHECK(nova_game_ui_action(ui,NOVA_GAME_STOP));
        /* Bad typed values and failed reopen never discard the previous data. */
        strcpy(ui->fields[1],"NaN"); ui->values_dirty = true;
        CHECK(!nova_game_ui_action(ui,NOVA_GAME_APPLY));
        CHECK(ui->values_dirty && !memcmp(&saved,&ui->project.data,sizeof(saved)));
        CHECK(!nova_game_ui_action(ui,NOVA_GAME_SELECT));
        ui->values_dirty = false;
        select_id(ui,placed);
        strcpy(ui->path,"/missing/game.nova-game");
        CHECK(!nova_game_ui_action(ui,NOVA_GAME_OPEN));
        CHECK(!memcmp(&saved,&ui->project.data,sizeof(saved)));
        CHECK(!nova_game_ui_action(ui,NOVA_GAME_DELETE) || ui->project.data.instances == 1);
        CHECK(nova_game_ui_action(ui,NOVA_GAME_UNDO_ACTION));
        /* Setup cancel never changes the current room/selection or draft. */
        click(ui,55,28); click(ui,sx+120,sy+106);
        CHECK(ui->sheet == NOVA_GAME_SHEET_NEW);
        NovaGame before_cancel = ui->project.data;
        type_field(ui,px+160,264,"Invalid name");
        click(ui,px+740,h-108);
        CHECK(ui->sheet == NOVA_GAME_SHEET_NEW && !memcmp(&before_cancel,&ui->project.data,sizeof(before_cancel)));
        type_field(ui,px+160,264,"Cancelled");
        click(ui,px+70,h-108);
        CHECK(ui->sheet == NOVA_GAME_SHEET_NONE && !memcmp(&before_cancel,&ui->project.data,sizeof(before_cancel)));
        /* Populate bounded stress fixtures, then use real wheel/header/row
         * controls to reach entries beyond both independent panel viewports. */
        for (unsigned i = 0; i < 16; ++i) {
            char name[32]; snprintf(name,sizeof(name),"ExtraObject%u",i);
            CHECK(nova_game_add_object(&ui->project,appearance,name,ui->message,sizeof(ui->message)));
            CHECK(nova_game_place(&ui->project,ui->room,object,(NovaVec3){0},ui->message,sizeof(ui->message)));
        }
        uint32_t last = ui->project.data.instance[ui->project.data.instances-1].id;
        mouse = (Vector2){100,250}; wheel = -100; draw(ui); draw(ui);
        CHECK(ui->tree_scroll > 0 && !ui->outline_scroll);
        click(ui,70,106+7*28+12); /* Rooms group remains accessible after tree scroll. */
        CHECK(ui->collapsed[3]);
        click(ui,70,106+(3+ui->project.data.resources+ui->project.data.objects-ui->tree_scroll)*28+12);
        CHECK(!ui->collapsed[3]);
        mouse = (Vector2){100,580}; wheel = -100; draw(ui); draw(ui);
        CHECK(ui->outline_scroll > 0);
        int last_row = (int)ui->project.data.instances-1-ui->outline_scroll;
        click(ui,95,h/2+30+76+last_row*28+12);
        CHECK(ui->selected == last && ui->palette == object && !ui->resource_view);
        click(ui,95,h-70);
        CHECK(ui->dialog == NOVA_GAME_DIALOG_DELETE && nova_game_instance(&ui->project.data,last));
        click(ui,w/2-320,h/2+187);
        CHECK(ui->dialog == NOVA_GAME_DIALOG_NONE && nova_game_instance(&ui->project.data,last));
        click(ui,55,28); click(ui,sx+120,sy+106);
        click(ui,px+740,h-108);
        CHECK(ui->dialog == NOVA_GAME_DIALOG_DISCARD && strstr(ui->message,"discard unsaved"));
        click(ui,w/2-320,h/2+187);
        CHECK(ui->dialog == NOVA_GAME_DIALOG_NONE && nova_game_instance(&ui->project.data,last));
        click(ui,px+70,h-108);
        CHECK(ui->sheet == NOVA_GAME_SHEET_NONE && nova_game_dirty(&ui->project));
        remove_game(ui);
        ui->room = ui->selected = ui->palette = 0;
        ui->tree_scroll = ui->outline_scroll = 0;
    }
    nova_game_ui_close(ui);
    CHECK(!rmdir(parent));
    free(ui); nova_ui_style_close(); CloseWindow();
    puts("NOVA_GAME_UI 2d-and-3d=create-import-object-place-drag-edit-save-reopen-run-stop native-pixels=ok retained-live=ok");
    return 0;
}
