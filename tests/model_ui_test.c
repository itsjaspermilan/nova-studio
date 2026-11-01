#include "model_ui.h"

#include <fcntl.h>
#include <math.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr,"%s:%d: %s (%s)\n",__FILE__,__LINE__,#c,ui->message); exit(1); } } while (0)
extern char **environ;
static NovaModelUI *ui;
static Vector2 mouse = {-100,-100};
static bool pressed, command;
static int key;
static const char *characters = "";
static const Rectangle preview = {830,106,436,245};

Vector2 nova_model_test_mouse(void) { return mouse; }
bool nova_model_test_click(int button) { return button == MOUSE_BUTTON_LEFT && pressed; }
bool nova_model_test_key(int value) { return value == key; }
bool nova_model_test_repeat(int value) { (void)value; return false; }
bool nova_model_test_down(int value) { return command && value == KEY_LEFT_CONTROL; }
int nova_model_test_char(void) { return *characters ? *characters++ : 0; }
float nova_model_test_wheel(void) { return 0; }

static void step(const char *capture)
{
    nova_model_ui_update(ui);
    BeginDrawing();
    ClearBackground((Color){19,27,39,255});
    if (ui->ready) {
        NovaPresentationLayout layout;
        int fw=GetRenderWidth(), fh=GetRenderHeight(), ww=GetScreenWidth(), wh=GetScreenHeight();
        NovaFramebufferRect region = {(int)(preview.x*fw/ww),(int)(preview.y*fh/wh),
            (int)(preview.width*fw/ww),(int)(preview.height*fh/wh)};
        CHECK(nova_presentation_layout_region(ww,wh,fw,fh,region,false,&layout));
        EndDrawing();
        nova_presentation_world(&ui->view.presentation,&ui->view.frame,&ui->view.resources);
        BeginDrawing();
        ClearBackground((Color){19,27,39,255});
        NovaCanvasState canvas=nova_begin_canvas(fw,fh);
        nova_presentation_composite(&ui->view.presentation,&ui->view.frame,&ui->view.resources,layout.viewport);
        nova_end_canvas(canvas);
    }
    if (ui->active) nova_model_ui_draw(ui,preview);
    if (capture) CHECK(nova_capture_native(capture,GetRenderWidth(),GetRenderHeight()));
    EndDrawing();
    pressed=false; key=0; command=false; characters="";
}

static void click(float x,float y)
{
    mouse=(Vector2){x,y}; pressed=true; step(NULL); step(NULL);
}

static void type_field(float x,float y,const char *text)
{
    click(x,y);
    command=true; key=KEY_A; step(NULL);
    characters=text; step(NULL);
}

static void apply(void)
{
    key=KEY_ENTER; step(NULL); step(NULL);
    CHECK(!ui->values_dirty && !ui->stale);
}

static void write_file(const char *path,const void *bytes,size_t length)
{
    FILE *file=fopen(path,"wb");
    CHECK(file && fwrite(bytes,1,length,file)==length && !fclose(file));
}

static void capture_colors(void)
{
    step(NOVA_TEST_DIRECTORY "/modeller-ui.png");
    Image image=LoadImage(NOVA_TEST_DIRECTORY "/modeller-ui.png");
    CHECK(IsImageValid(image) && image.width==GetRenderWidth() && image.height==GetRenderHeight());
    int colors[3]={0};
    for (int y=0;y<image.height;++y) for (int x=0;x<image.width;++x) {
        Color c=GetImageColor(image,x,y);
        unsigned char rgb[3]={c.r,c.g,c.b};
        for (int a=0;a<3;++a)
            if (rgb[a]==255 && !rgb[(a+1)%3] && !rgb[(a+2)%3]) {
                CHECK(x >= preview.x*image.width/GetScreenWidth() &&
                    x < (preview.x+preview.width)*image.width/GetScreenWidth());
                CHECK(y >= preview.y*image.height/GetScreenHeight() &&
                    y < (preview.y+preview.height)*image.height/GetScreenHeight());
                ++colors[a];
            }
    }
    printf("NOVA_MODELLER_UI native=%dx%d exact RGB model pixels=%d,%d,%d revisions=%zu\n",
        image.width,image.height,colors[0],colors[1],colors[2],ui->view.revisions);
    CHECK(colors[0]>100 && colors[1]>100 && colors[2]>100);
    UnloadImage(image);
}

static void real_shell(const char *editor,const char *manifest)
{
    posix_spawn_file_actions_t actions;
    CHECK(!posix_spawn_file_actions_init(&actions));
    CHECK(!posix_spawn_file_actions_addopen(&actions,STDOUT_FILENO,
        NOVA_TEST_DIRECTORY "/modeller-shell.log",O_CREAT|O_TRUNC|O_WRONLY,0600));
    CHECK(!posix_spawn_file_actions_adddup2(&actions,STDOUT_FILENO,STDERR_FILENO));
    char *args[]={(char *)editor,"--project",(char *)manifest,"--modeller","--frames","3",
        "--capture",NOVA_TEST_DIRECTORY "/modeller-shell.png",NULL};
    pid_t child;
    CHECK(!posix_spawn(&child,editor,&actions,NULL,args,environ));
    posix_spawn_file_actions_destroy(&actions);
    int status;
    CHECK(waitpid(child,&status,0)==child && WIFEXITED(status) && WEXITSTATUS(status)==0);
    Image image=LoadImage(NOVA_TEST_DIRECTORY "/modeller-shell.png");
    CHECK(IsImageValid(image) && image.width>=1280 && image.height>=800);
    int colors[3]={0};
    for (int y=0;y<image.height;++y) for (int x=0;x<image.width;++x) {
        Color c=GetImageColor(image,x,y);
        unsigned char rgb[3]={c.r,c.g,c.b};
        for (int a=0;a<3;++a) if (rgb[a]==255 && !rgb[(a+1)%3] && !rgb[(a+2)%3]) ++colors[a];
    }
    CHECK(colors[0]>100 && colors[1]>100 && colors[2]>100);
    UnloadImage(image);
    int length;
    unsigned char *log=nova_read_file(NOVA_TEST_DIRECTORY "/modeller-shell.log",65536,&length,ui->message,sizeof(ui->message));
    CHECK(log && strstr((char *)log,"preview=modeller") && strstr((char *)log,"model_primitives=3 model_vertices=198 model_revision=1 status=ok"));
    free(log);
}

int main(int argc,char **argv)
{
    ui=calloc(1,sizeof(*ui));
    CHECK(ui && argc==2);
    char directory[]="/tmp/nova-modeller-ui-XXXXXX";
    CHECK(mkdtemp(directory));
    char manifest[256],lua[256],glb[256],source[256];
    snprintf(manifest,sizeof(manifest),"%s/nova.project",directory);
    snprintf(lua,sizeof(lua),"%s/main.lua",directory);
    snprintf(glb,sizeof(glb),"%s/model.glb",directory);
    snprintf(source,sizeof(source),"%s/model.glb.nova-model",directory);
    const char *declaration="nova-project 1\nentry main.lua\nmodel authored model.glb\n";
    const char *script="nova.scene('3d')\nlocal m=nova.asset('authored')\n"
        "function update(dt,input) nova.camera(0,0,8,0,0,0,45) nova.model(m,0,0,0,1) end\n";
    write_file(manifest,declaration,strlen(declaration)); write_file(lua,script,strlen(script));
    NovaModelDocument initial;
    nova_model_init(&initial);
    CHECK(nova_model_add(&initial,NOVA_SHAPE_BOX,ui->message,sizeof(ui->message)));
    unsigned char *bytes;
    size_t length;
    CHECK(nova_model_glb(&initial,&bytes,&length,ui->message,sizeof(ui->message)));
    write_file(glb,bytes,length); free(bytes);
    SetTraceLogLevel(LOG_WARNING);
    SetConfigFlags(FLAG_WINDOW_HIGHDPI);
    InitWindow(1280,800,"Nova modeller native widget workflow");
    CHECK(IsWindowReady());
    CHECK(nova_model_ui_open(ui,manifest,directory,"model.glb",ui->message,sizeof(ui->message)));
    step(NULL);
    CHECK(ui->active && ui->ready && ui->model.count==0 && nova_document_dirty(&ui->source));
    click(280,116); click(405,116); click(525,116);
    CHECK(ui->model.count==3 && ui->model.next_id==4);
    click(90,188);
    type_field(260,212,"-2"); type_field(260,407,"255");
    type_field(370,407,"0"); type_field(485,407,"0"); apply();
    CHECK(ui->model.primitives[0].position[0]==-2 && ui->model.primitives[0].color[0]==255);
    click(90,222);
    type_field(370,277,"30"); type_field(260,407,"0");
    type_field(370,407,"255"); type_field(485,407,"0"); apply();
    click(90,256);
    type_field(260,212,"2"); type_field(370,342,"1.5");
    type_field(260,407,"0"); type_field(370,407,"0"); type_field(485,407,"255"); apply();
    type_field(455,450,"12"); apply();
    CHECK(ui->model.primitives[2].sides==12);
    type_field(260,342,"-1");
    key=KEY_ENTER; step(NULL);
    CHECK(ui->values_dirty && ui->model.primitives[2].scale[0]==1);
    click(90,188);
    CHECK(ui->selected==2 && ui->values_dirty);
    click(615,492);
    CHECK(!ui->values_dirty);
    click(90,222); click(440,449);
    CHECK(ui->model.count==2 && ui->model.next_id==4 && ui->model.primitives[1].id==3);
    click(405,116);
    CHECK(ui->model.primitives[2].id==4 && ui->model.next_id==5);
    type_field(370,277,"30"); type_field(260,407,"0");
    type_field(370,407,"255"); type_field(485,407,"0"); apply();
    size_t revisions=ui->view.revisions;
    unsigned vao=ui->view.resources.resources[0].model.meshes[0].vaoId;
    for (int i=0;i<8;++i) step(NULL);
    CHECK(ui->view.revisions==revisions && ui->view.resources.resources[0].model.meshes[0].vaoId==vao);
    NovaModelDocument invalid=ui->model;
    invalid.primitives[0].position[0]=INFINITY;
    CHECK(!nova_model_ui_apply(ui,&invalid));
    CHECK(ui->view.revisions==revisions && ui->view.resources.resources[0].model.meshes[0].vaoId==vao);
    click(885,574); click(885,574);
    CHECK(ui->view.revisions==revisions && ui->view.resources.resources[0].model.meshes[0].vaoId==vao);
    capture_colors();
    click(460,663);
    CHECK(!nova_document_dirty(&ui->source) && FileExists(source));
    write_file(source,"nova-model 1\nnext 1\n",20);
    click(460,663);
    CHECK(ui->decision==NOVA_MODEL_DECISION_SAVE_CONFLICT && ui->source.has_conflict);
    click(725,528);
    CHECK(ui->review_disk);
    click(130,764);
    CHECK(!ui->review_disk && ui->decision==NOVA_MODEL_DECISION_SAVE_CONFLICT);
    write_file(source,"nova-model 1\nnext 2\n",20);
    click(520,528);
    CHECK(ui->decision==NOVA_MODEL_DECISION_SAVE_CONFLICT);
    click(520,528);
    CHECK(ui->decision==NOVA_MODEL_DECISION_NONE && !nova_document_dirty(&ui->source));
    click(910,81);
    CHECK(ui->decision==NOVA_MODEL_DECISION_EXPORT && !ui->inspected_export);
    click(290,528);
    CHECK(ui->decision==NOVA_MODEL_DECISION_NONE && !ui->inspected_export);
    click(910,81); click(520,528);
    CHECK(ui->inspected_export && ui->exported_asset.primitives==3 && ui->exported_asset.vertices==198);
    write_file(glb,"external user GLB",17);
    click(910,81); click(520,528);
    CHECK(ui->decision==NOVA_MODEL_DECISION_EXPORT_CONFLICT && !ui->inspected_export);
    CHECK(ui->target.conflict.length==17 && !memcmp(ui->target.conflict.text,"external user GLB",17));
    click(290,528);
    CHECK(ui->decision==NOVA_MODEL_DECISION_NONE && !ui->inspected_export);
    int disk_length;
    unsigned char *disk=nova_read_file(glb,65536,&disk_length,ui->message,sizeof(ui->message));
    CHECK(disk && disk_length==17 && !memcmp(disk,"external user GLB",17));
    free(disk);
    click(910,81); click(520,528);
    CHECK(ui->decision==NOVA_MODEL_DECISION_EXPORT_CONFLICT);
    write_file(glb,"second external",16);
    click(520,528);
    CHECK(ui->decision==NOVA_MODEL_DECISION_EXPORT_CONFLICT && ui->target.conflict.length==16);
    click(520,528);
    CHECK(ui->inspected_export && ui->decision==NOVA_MODEL_DECISION_NONE);
    NovaProjectValidation validation;
    CHECK(nova_validate_project(manifest,&validation,ui->message,sizeof(ui->message)));
    CHECK(validation.assets[0].vertices==198);
    char fixture_directory[NOVA_NATIVE_PATH_CAPACITY];
    strcpy(fixture_directory,ui->view.directory);
    click(80,81);
    CHECK(!ui->active && !DirectoryExists(fixture_directory));
    CHECK(nova_model_ui_open(ui,manifest,directory,"model.glb",ui->message,sizeof(ui->message)));
    step(NULL);
    CHECK(ui->model.count==3 && ui->model.primitives[2].id==4 && !nova_document_dirty(&ui->source));
    revisions=ui->view.revisions;
    char blocked[256];
    snprintf(blocked,sizeof(blocked),"%s/blocked.nova-model",directory);
    CHECK(!symlink(source,blocked));
    type_field(280,620,"blocked.nova-model"); click(290,663);
    CHECK(ui->model.count==3 && !strcmp(ui->source.relative,"model.glb.nova-model") && ui->view.revisions==revisions);
    CHECK(!unlink(blocked));
    type_field(260,212,"123");
    click(80,81);
    CHECK(ui->decision==NOVA_MODEL_DECISION_EXIT && ui->active);
    click(290,528);
    CHECK(ui->active && ui->values_dirty);
    click(610,450);
    CHECK(!ui->values_dirty);
    type_field(280,620,"other.nova-model");
    click(290,663);
    CHECK(ui->model.count==0 && !strcmp(ui->source.relative,"other.nova-model"));
    click(95,665);
    CHECK(ui->model.count==3);
    click(80,81);
    CHECK(ui->decision==NOVA_MODEL_DECISION_EXIT);
    click(520,528);
    CHECK(!ui->active);
    CloseWindow();
    real_shell(argv[1],manifest);
    CHECK(!unlink(source) && !unlink(glb) && !unlink(lua) && !unlink(manifest) && !rmdir(directory));
    puts("Native widgets create/select/delete/finite edits, stable IDs, source save/reopen, stale consent,"
        " GLB overwrite/cancel/native preflight, typed-value guards, shared GPU cache and real shell passed");
    free(ui);
    return 0;
}
