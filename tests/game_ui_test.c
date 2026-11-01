#include "game_ui.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static Vector2 mouse = {-100,-100};
static bool pressed, released;
Vector2 nova_game_test_mouse(void) { return mouse; }
bool nova_game_test_press(int button) { return button == MOUSE_BUTTON_LEFT && pressed; }
bool nova_game_test_release(int button) { return button == MOUSE_BUTTON_LEFT && released; }
bool nova_game_test_key(int key) { (void)key; return false; }
bool nova_game_test_down(int key) { (void)key; return false; }
int nova_game_test_char(void) { return 0; }
float nova_game_test_wheel(void) { return 0; }
bool nova_game_test_focus(void) { return true; }

#define CHECK(x) do { if (!(x)) { fprintf(stderr,"%d: %s: %s\n",__LINE__,#x,ui->message); exit(1); } } while (0)

static void draw(NovaGameUI *ui)
{
    CHECK(nova_game_ui_draw(ui,false));
    pressed = released = false;
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

static size_t pixels(NovaGameUI *ui, Color color)
{
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
    InitWindow(1280,800,"Private Nova workflow test");
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
    for (int mode = NOVA_2D; mode <= NOVA_3D; ++mode) {
        snprintf(ui->location,sizeof(ui->location),"%s",parent);
        snprintf(ui->name,sizeof(ui->name),"%s",mode == NOVA_2D ? "Game2D" : "Game3D");
        ui->new_mode = (NovaMode)mode;
        /* Actual native New Project button uses the public mutation action. */
        ui->room = 0; click(ui,300,365);
        CHECK(ui->project.data.rooms == 1 && ui->project.data.instances == 1 && ui->ready && !ui->stale);
        uint32_t starting = ui->project.data.start;
        draw(ui);
        CHECK(pixels(ui,mode == NOVA_2D ? (Color){77,225,201,255} : (Color){80,190,230,255}) > 100);
        if (mode == NOVA_3D) {
            select_id(ui,1);
            click(ui,1100,301); /* Original model keeps its genuine editable primitive source. */
            CHECK(ui->modeller.active && ui->modeller.model.count == 1);
            draw(ui);
            CHECK(ui->modeller.ready && !ui->modeller.stale);
            nova_model_ui_request_close(&ui->modeller); draw(ui);
            CHECK(!ui->modeller.active && !ui->quit && ui->project.data.instances == 1);
            select_id(ui,starting);
        }
        strcpy(ui->name,"SecondRoom");
        CHECK(nova_game_ui_action(ui,NOVA_GAME_ROOM));
        uint32_t second_room = ui->room;
        CHECK(ui->project.data.rooms == 2 && ui->project.data.start == starting);
        click(ui,1100,mode == NOVA_2D ? 265 : 482); /* Make starting room. */
        CHECK(ui->project.data.start == second_room);
        select_id(ui,starting);
        CHECK(nova_game_ui_action(ui,NOVA_GAME_RUN));
        CHECK(nova_frame(ui->play_engine)->count == 0); /* Runs start, not currently edited room. */
        CHECK(nova_game_ui_action(ui,NOVA_GAME_STOP) && ui->room == starting);
        click(ui,1100,mode == NOVA_2D ? 265 : 482);
        CHECK(ui->project.data.start == starting);
        click(ui,300,710); /* Add Sprite / Model opens the native picker, never saves. */
        CHECK(ui->room == 0 && ui->browser_import);
        unsigned visible = 0;
        bool chosen = false;
        for (unsigned i = 0; i < ui->files.count; ++i) {
            const char *file = ui->files.paths[i];
            bool sprite = IsFileExtension(file,".png"), model = IsFileExtension(file,".glb");
            if (!DirectoryExists(file) && strcmp(GetFileName(file),NOVA_GAME_FILE) && !sprite && !model) continue;
            if (sprite || model) {
                click(ui,300,(float)(450+visible*32)); chosen = true; break;
            }
            ++visible;
        }
        CHECK(chosen && ui->project.data.resources == 1); /* Selection alone never writes. */
        strcpy(ui->name,"Appearance");
        click(ui,1100,314); /* Explicit validated no-clobber import. */
        uint32_t appearance = ui->selected;
        CHECK(appearance != 1 && ui->project.data.resources == 2);
        strcpy(ui->name,"ControlledObject");
        click(ui,1100,257); /* Appearance -> Create object using this. */
        uint32_t object = ui->selected;
        CHECK(nova_game_object(&ui->project.data,object)->resource == appearance);
        click(ui,1100,551); /* Genuine Step controls toggle, not a Lua template. */
        CHECK(nova_game_object(&ui->project.data,object)->controls);
        strcpy(ui->fields[2],mode == NOVA_2D ? "120" : "4");
        ui->values_dirty = true;
        CHECK(!nova_game_ui_action(ui,NOVA_GAME_SAVE));
        click(ui,1050,650); /* Apply typed action properties. */
        CHECK(!ui->values_dirty && nova_game_object(&ui->project.data,object)->speed == (mode == NOVA_2D ? 120 : 4));
        select_id(ui,starting);
        ui->place_tool = true; ui->palette = object;
        draw(ui);
        Rectangle plane;
        if (mode == NOVA_2D) {
            int w = GetScreenWidth(), h = GetScreenHeight(), fw = GetRenderWidth(), fh = GetRenderHeight();
            Rectangle panel = {240,151,(float)w-575,(float)h-330};
            NovaPresentationLayout layout;
            NovaFramebufferRect region = {(int)lroundf(panel.x*fw/w),(int)lroundf(panel.y*fh/h),
                (int)lroundf(panel.width*fw/w),(int)lroundf(panel.height*fh/h)};
            CHECK(nova_presentation_layout_region(w,h,fw,fh,region,true,&layout));
            plane = (Rectangle){layout.viewport.x*w/fw,layout.viewport.y*h/fh,
                layout.viewport.width*w/fw,layout.viewport.height*h/fh};
        } else plane = (Rectangle){240,450,(float)GetScreenWidth()-575,(float)GetScreenHeight()-635};
        click(ui,plane.x+plane.width/2,plane.y+plane.height/2);
        CHECK(ui->project.data.instances == 2 && nova_game_instance(&ui->project.data,ui->selected)->object == object);
        uint32_t placed = ui->selected;
        ui->place_tool = false;
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
        strcpy(ui->fields[0],"PlacedHero"); strcpy(ui->fields[4],"1.5"); ui->values_dirty = true;
        CHECK(nova_game_ui_action(ui,NOVA_GAME_APPLY));
        CHECK(nova_game_ui_action(ui,NOVA_GAME_SAVE));
        NovaGame saved = ui->project.data;
        CHECK(nova_project_resolve(ui->project.authored.root,NOVA_GAME_FILE,ui->path,ui->message,sizeof(ui->message)));
        CHECK(nova_game_ui_action(ui,NOVA_GAME_OPEN));
        CHECK(!memcmp(&saved,&ui->project.data,sizeof(saved)));
        select_id(ui,placed);
        CHECK(nova_game_ui_action(ui,NOVA_GAME_RUN));
        NovaEngine *engine = ui->play_engine;
        unsigned gpu = ui->play_resources.resources[0].texture.id;
        NovaVec3 initial = nova_frame(engine)->commands[1].position;
        CHECK(nova_game_ui_tick(ui,1.0/60,(NovaInput){1,1,false}));
        CHECK(nova_frame(engine)->commands[1].position.x > initial.x);
        CHECK(mode == NOVA_2D ? nova_frame(engine)->commands[1].position.y > initial.y : nova_frame(engine)->commands[1].position.z > initial.z);
        CHECK(nova_game_ui_action(ui,NOVA_GAME_STOP));
        CHECK(ui->selected == placed && !memcmp(&saved,&ui->project.data,sizeof(saved)));
        CHECK(nova_game_ui_action(ui,NOVA_GAME_RESTART));
        CHECK(nova_frame(ui->play_engine)->commands[1].position.x == initial.x);
        CHECK(nova_game_ui_action(ui,NOVA_GAME_STOP));
        draw(ui);
        CHECK(pixels(ui,mode == NOVA_2D ? (Color){77,225,201,255} : (Color){80,190,230,255}) > 100);
        standalone(ui,argv[1],argv[2]);
        Image evidence = LoadImage(ui->capture);
        CHECK(IsImageValid(evidence));
        char evidence_path[4096];
        snprintf(evidence_path,sizeof(evidence_path),"%s/workflow-%s.png",NOVA_GAME_TEST_DIRECTORY,mode == NOVA_2D ? "2d" : "3d");
        CHECK(ExportImage(evidence,evidence_path)); UnloadImage(evidence);
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
        remove_game(ui);
        ui->room = ui->selected = ui->palette = 0;
    }
    nova_game_ui_close(ui);
    CHECK(!rmdir(parent));
    free(ui); nova_ui_style_close(); CloseWindow();
    puts("NOVA_GAME_UI 2d-and-3d=create-import-object-place-drag-edit-save-reopen-run-stop native-pixels=ok retained-live=ok");
    return 0;
}
