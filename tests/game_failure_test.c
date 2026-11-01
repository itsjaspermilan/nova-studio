#include "game.h"
#include "assets.h"
#undef nova_document_save
extern bool nova_document_save(NovaDocument *, bool, char *, size_t);

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static unsigned call, fail_at;
bool nova_game_test_save(NovaDocument *d, bool overwrite, char *error, size_t size)
{
    if (fail_at && ++call == fail_at) {
        snprintf(error,size,"Injected per-file write failure");
        return false;
    }
    return nova_document_save(d,overwrite,error,size);
}

#define CHECK(x) do { if (!(x)) { fprintf(stderr,"%d: %s: %s\n",__LINE__,#x,error); exit(1); } } while (0)

int main(void)
{
    char error[1024] = {0}, parent[] = "/tmp/nova-game-failure-XXXXXX";
    CHECK(mkdtemp(parent));
    NovaGameProject *p = calloc(1,sizeof(*p));
    CHECK(p && nova_game_new(p,parent,"Test",NOVA_2D,error,sizeof(error)));
    NovaGame original = p->data, candidate = p->data;
    candidate.object[0].speed = 300;
    CHECK(nova_game_commit(p,&candidate,error,sizeof(error)));
    fail_at = 1; call = 0;
    CHECK(!nova_game_save(p,false,error,sizeof(error)));
    CHECK(p->writes == 0 && nova_game_dirty(p) && !memcmp(&p->saved,&original,sizeof(original)));
    fail_at = 2; call = 0;
    CHECK(!nova_game_save(p,false,error,sizeof(error)));
    CHECK(p->writes == 1 && strstr(error,"PARTIAL SAVE") && nova_game_dirty(p));
    CHECK(!memcmp(&p->data,&candidate,sizeof(candidate)) && !memcmp(&p->saved,&candidate,sizeof(candidate)));
    fail_at = 3; call = 0;
    CHECK(!nova_game_save(p,false,error,sizeof(error)));
    CHECK(p->writes == 2 && strstr(error,"PARTIAL SAVE"));
    fail_at = 0;
    CHECK(nova_game_save(p,false,error,sizeof(error)) && p->writes == 3);
    char root[4096], path[4096];
    strcpy(root,p->authored.root);
    const char *files[] = {NOVA_GAME_FILE,NOVA_GAME_MANIFEST,NOVA_GAME_LUA,"resource_1.png"};
    for (size_t i = 0; i < 4; ++i) {
        CHECK(nova_project_resolve(root,files[i],path,error,sizeof(error)));
        CHECK(!unlink(path));
    }
    nova_game_close(p); free(p);
    CHECK(!rmdir(root) && !rmdir(parent));
    puts("NOVA_GAME failed-save-draft-retention=ok partial-file-outcomes=ok retry=ok");
    return 0;
}
