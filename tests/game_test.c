#include "game.h"
#include "assets.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define CHECK(x) do { if (!(x)) { fprintf(stderr, "%d: %s: %s\n", __LINE__, #x, error); exit(1); } } while (0)

static void external(const char *root, const char *relative, const char *text)
{
    char error[1024] = {0};
    NovaDocument doc = {0};
    CHECK(nova_document_open_output(&doc, root, relative, NOVA_SOURCE_EDIT_LIMIT, false, error, sizeof(error)));
    CHECK(nova_document_replace(&doc, 0, doc.length, text, strlen(text), error, sizeof(error)));
    CHECK(nova_document_save(&doc, false, error, sizeof(error)));
    nova_document_close(&doc);
}

static void cleanup(const char *root, const NovaGame *game)
{
    char path[4096];
    for (size_t i = 0; i < game->resources; ++i) {
        snprintf(path, sizeof(path), "%s/%s", root, game->resource[i].path); unlink(path);
    }
    const char *files[] = {NOVA_GAME_FILE, NOVA_GAME_MANIFEST, NOVA_GAME_LUA,
        "resource_5.png", "resource_5.glb", "resource_1.glb.nova-model"};
    for (size_t i = 0; i < sizeof(files)/sizeof(files[0]); ++i) {
        snprintf(path, sizeof(path), "%s/%s", root, files[i]); unlink(path);
    }
    if (rmdir(root)) { perror(root); exit(1); }
}

int main(void)
{
    char error[1024] = {0}, parent[] = "/tmp/nova-game-test-XXXXXX";
    CHECK(mkdtemp(parent));
    NovaGameProject *p = calloc(1, sizeof(*p)), *q = calloc(1, sizeof(*q));
    CHECK(p && q);
    for (int mode = NOVA_2D; mode <= NOVA_3D; ++mode) {
        CHECK(nova_game_new(p, parent, mode == NOVA_2D ? "Game2D" : "Game3D", (NovaMode)mode, error, sizeof(error)));
        CHECK(!nova_game_dirty(p));
        char root[4096], path[4096];
        strcpy(root, p->authored.root);
        CHECK(!nova_game_new(q, parent, mode == NOVA_2D ? "Game2D" : "Game3D", (NovaMode)mode, error, sizeof(error)));
        char *bytes = NULL; size_t length;
        CHECK(nova_game_serialize(&p->data, &bytes, &length, error, sizeof(error)));
        NovaGame parsed = {0};
        CHECK(nova_game_parse(bytes, length, &parsed, error, sizeof(error)));
        CHECK(!memcmp(&parsed, &p->data, sizeof(parsed)));
        CHECK(!nova_game_parse("nova-game 2\n", 12, &parsed, error, sizeof(error)));
        CHECK(parsed.instances == 1);
        const char *overflow = "nova-game 1\nnext 4294967300\nstart 3\nroom 3 Room 0 16 8 7 10 0 0 0 48\n";
        CHECK(!nova_game_parse(overflow,strlen(overflow),&parsed,error,sizeof(error)));
        const char *negative = "nova-game 1\nnext -4\nstart 3\nroom 3 Room 0 16 8 7 10 0 0 0 48\n";
        CHECK(!nova_game_parse(negative,strlen(negative),&parsed,error,sizeof(error)));
        const char *unknown = "nova-game 1\nnext 4\nstart 3\nroom 3 Room 0 16 8 7 10 0 0 0 48\nfuture-data opaque\n";
        CHECK(!nova_game_parse(unknown,strlen(unknown),&parsed,error,sizeof(error)));
        free(bytes);
        CHECK(!nova_game_delete(p, 1, error, sizeof(error)));
        CHECK(!nova_game_delete(p, 2, error, sizeof(error)));
        CHECK(!nova_game_delete(p, 3, error, sizeof(error)));
        CHECK(nova_game_add_object(p, 1, "Enemy", error, sizeof(error)));
        CHECK(!nova_game_add_object(p, 1, "Enemy", error, sizeof(error)));
        uint32_t object = p->data.object[1].id;
        CHECK(nova_game_place(p, 3, object, (NovaVec3){1,2,mode == NOVA_2D ? 0 : 3}, error, sizeof(error)));
        uint32_t instance = p->data.instance[1].id;
        CHECK(nova_game_undo(p, false, error, sizeof(error)) && p->data.instances == 1);
        CHECK(nova_game_undo(p, true, error, sizeof(error)) && p->data.instances == 2);
        CHECK(nova_game_delete(p, instance, error, sizeof(error)));
        CHECK(nova_game_undo(p, false, error, sizeof(error)));
        CHECK(nova_game_instance(&p->data, instance)->object == object);
        CHECK(nova_game_delete(p, instance, error, sizeof(error)));
        CHECK(nova_game_delete(p, object, error, sizeof(error)));
        CHECK(p->data.next_id > instance);
        NovaGame g = p->data;
        g.object[0].primary_move = true;
        g.object[0].primary.x = 2;
        g.object[0].step_move = true; g.object[0].velocity.y = 1;
        CHECK(nova_game_commit(p, &g, error, sizeof(error)));
        g.instance[0].object = 9999;
        CHECK(!nova_game_commit(p, &g, error, sizeof(error)));
        g = p->data; g.object[0].speed = NAN;
        CHECK(!nova_game_commit(p, &g, error, sizeof(error)));
        g = p->data; g.room[0].mode = NOVA_3D; g.room[0].camera = (NovaVec3){0,7,0};
        CHECK(!nova_game_commit(p,&g,error,sizeof(error)));
        g = p->data; g.resource[0].id = g.object[0].id;
        CHECK(!nova_game_commit(p,&g,error,sizeof(error)));
        CHECK(nova_game_save(p, false, error, sizeof(error)));
        char *manifest = NULL, *lua = NULL;
        CHECK(nova_game_generate(&p->data, &manifest, &lua, error, sizeof(error)));
        NovaProject declarations;
        CHECK(nova_project_parse(&declarations, manifest, strlen(manifest), error, sizeof(error)));
        NovaEngine *engine = nova_create();
        CHECK(engine && nova_load_with_assets(engine, lua, strlen(lua), "generated", declarations.assets, declarations.count));
        CHECK(nova_tick(engine, 0, (NovaInput){0}));
        NovaVec3 start = nova_frame(engine)->commands[0].position;
        CHECK(nova_tick(engine, 1.0/60, (NovaInput){1,1,true}));
        NovaVec3 moved = nova_frame(engine)->commands[0].position;
        CHECK(fabsf(moved.x - start.x - p->data.object[0].speed/60 - 2) < 0.001f);
        CHECK(nova_tick(engine, 1.0/60, (NovaInput){0,0,true}));
        CHECK(fabsf(nova_frame(engine)->commands[0].position.x-moved.x) < 0.001f);
        CHECK(nova_tick(engine, 1.0/60, (NovaInput){0,0,false}));
        CHECK(nova_tick(engine, 1.0/60, (NovaInput){0,0,true}));
        CHECK(fabsf(nova_frame(engine)->commands[0].position.x-moved.x-2) < 0.001f);
        nova_destroy(engine); free(manifest); free(lua);
        CHECK(nova_project_resolve(root, NOVA_GAME_FILE, path, error, sizeof(error)));
        CHECK(nova_game_open(q, path, error, sizeof(error)));
        CHECK(!memcmp(&q->data, &p->data, sizeof(q->data)) && q->owned_outputs);
        /* Import is validated, no-clobber and uses stable fresh IDs. */
        char asset[4096]; CHECK(nova_project_resolve(root, p->data.resource[0].path, asset, error, sizeof(error)));
        CHECK(nova_game_import(p, asset, "Extra", mode == NOVA_2D ? NOVA_ASSET_SPRITE : NOVA_ASSET_MODEL, error, sizeof(error)));
        uint32_t imported[3] = {p->data.resource[1].id,0,0};
        CHECK(nova_game_undo(p, false, error, sizeof(error)));
        CHECK(nova_game_import(p, asset, "Extra", mode == NOVA_2D ? NOVA_ASSET_SPRITE : NOVA_ASSET_MODEL, error, sizeof(error)));
        imported[1] = p->data.resource[1].id;
        CHECK(imported[1] > imported[0]); /* Undo never reuses IDs or retained file destinations. */
        CHECK(nova_game_undo(p, false, error, sizeof(error)));
        imported[2] = p->data.next_id;
        NovaDocument origin = {0}, blocked = {0};
        CHECK(nova_document_open_output(&origin,root,p->data.resource[0].path,NOVA_ASSET_FILE_LIMIT,true,error,sizeof(error)));
        char destination[64];
        snprintf(destination,sizeof(destination),"resource_%u.%s",imported[2],mode == NOVA_2D ? "png" : "glb");
        CHECK(nova_document_open_output(&blocked,root,destination,NOVA_ASSET_FILE_LIMIT,true,error,sizeof(error)));
        CHECK(nova_document_replace(&blocked,0,0,origin.text,origin.length,error,sizeof(error)));
        CHECK(nova_document_save(&blocked,false,error,sizeof(error)));
        nova_document_close(&origin); nova_document_close(&blocked);
        CHECK(!nova_game_import(p, asset, "Extra", mode == NOVA_2D ? NOVA_ASSET_SPRITE : NOVA_ASSET_MODEL, error, sizeof(error)));
        CHECK(p->data.resources == 1); /* A pre-existing fresh-ID destination is never clobbered. */
        /* External authored version requires exact consent; newer edits invalidate it. */
        char *source; CHECK(nova_game_serialize(&p->data, &source, &length, error, sizeof(error)));
        external(root, NOVA_GAME_FILE, "external one\n");
        CHECK(!nova_game_save(p, false, error, sizeof(error)) && p->authored.has_conflict);
        external(root, NOVA_GAME_FILE, "external two\n");
        CHECK(!nova_game_save(p, true, error, sizeof(error)) && p->writes == 0);
        CHECK(!strcmp(p->authored.conflict.text, "external two\n"));
        CHECK(nova_game_save(p, true, error, sizeof(error)));
        free(source);
        external(root, NOVA_GAME_LUA, "-- hand-authored edit\n");
        CHECK(!nova_game_save(p, false, error, sizeof(error)) && p->writes == 0);
        CHECK(nova_game_open(q, path, error, sizeof(error)) && !q->owned_outputs);
        CHECK(!nova_game_save(q, false, error, sizeof(error)));
        NovaGame retained = q->data;
        external(root, NOVA_GAME_FILE, "nova-game 2\nunknown\n");
        CHECK(!nova_game_open(q, path, error, sizeof(error)));
        CHECK(!memcmp(&q->data, &retained, sizeof(retained)));
        NovaAuthoringProject advanced = {0};
        CHECK(nova_authoring_open(&advanced,path,error,sizeof(error)));
        CHECK(!strcmp(advanced.declaration.text,"nova-game 2\nunknown\n") && *advanced.source_error);
        CHECK(advanced.declaration.limit == NOVA_GAME_BYTES);
        nova_authoring_close(&advanced);
        NovaGame clean = p->data;
        nova_game_close(p); nova_game_close(q);
        /* The undo-retained import file also remains until explicit user cleanup. */
        for (size_t i = 0; i < 3; ++i) {
            snprintf(path, sizeof(path), "%s/resource_%u.%s", root, imported[i], mode == NOVA_2D ? "png" : "glb");
            CHECK(!unlink(path));
        }
        cleanup(root, &clean);
    }
    free(p); free(q);
    CHECK(!rmdir(parent));
    puts("NOVA_GAME both-dimensions=ok stable-refs=ok behavior=ok guarded-save=ok no-clobber=ok");
    return 0;
}
