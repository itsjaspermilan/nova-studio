#include "scene.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s (%s)\n", __FILE__, __LINE__, #c, error); exit(1); } } while (0)

int main(void)
{
    char error[1024] = {0};
    NovaProject project = {0};
    const char *manifest = "nova-project 3\nidentity scene-test\nentry main.lua\nscene start.nova-scene\nsprite art art.png\nmodel prop prop.glb\n";
    CHECK(nova_project_parse(&project, manifest, strlen(manifest), error, sizeof(error)));
    CHECK(project.version == 3 && !strcmp(project.scene, "start.nova-scene"));
    NovaProject retained_project = project;
    const char *bad_manifests[] = {
        "nova-project 3\nidentity A\nentry main.lua\n",
        "nova-project 3\nidentity A\nentry main.lua\nscene ../start.nova-scene\n",
        "nova-project 3\nidentity A\nentry main.lua\nscene a.nova-scene\nscene b.nova-scene\n",
        "nova-project 2\nidentity A\nentry main.lua\nscene start.nova-scene\n",
        "nova-project 4\nidentity A\nentry main.lua\nscene start.nova-scene\n",
    };
    for (size_t i = 0; i < sizeof(bad_manifests) / sizeof(*bad_manifests); ++i) {
        CHECK(!nova_project_parse(&project, bad_manifests[i], strlen(bad_manifests[i]), error, sizeof(error)));
        CHECK(!memcmp(&project, &retained_project, sizeof(project)));
    }
    const char *source = "nova-scene 1\nmode mixed\nbackground 18 24 41\ncamera 7 6 9 0 0 0 50\n"
        "object player sprite art 120 140 0 64 64 1 255 255 255 Joueur \xe6\x97\xa5\xe6\x9c\xac\n"
        "object prop model prop 0 0 0 1 2 3 255 255 255 Model\n"
        "object ground cube - 0 -1 0 10 1 10 100 180 140 Ground\n";
    NovaScene scene;
    CHECK(nova_scene_parse(&scene, source, strlen(source), project.assets, project.count, error, sizeof(error)));
    CHECK(scene.count == 3 && scene.objects[1].size.y == 2);
    NovaScene retained = scene;
    const char *bad[] = {
        "nova-scene 2\n",
        "nova-scene 1\nmode 2d\nmode 3d\n",
        "nova-scene 1\nmode 2d\nbackground 18 24 41\ncamera 7 6 9 0 0 0 50\nobject a sprite missing 0 0 0 1 1 1 1 2 3 Name\n",
        "nova-scene 1\nmode 2d\nbackground 18 24 41\ncamera 7 6 9 0 0 0 50\nobject a cube - 0 0 0 1 1 1 1 2 3 Name\n",
        "nova-scene 1\nmode 2d\nbackground 18 24 41\ncamera 7 6 9 0 0 0 50\nobject a rectangle - nan 0 0 1 1 1 1 2 3 Name\n",
        "nova-scene 1\nmode 2d\nbackground 18 24 41\ncamera 7 6 9 0 0 0 50\nobject a rectangle - 0 0 0 1 1 1 1 2 3 \xc0\xaf\n",
        "nova-scene 1\nmode 2d\nbackground 18 24 41\ncamera 0 6 0 0 0 0 50\n",
    };
    for (size_t i = 0; i < sizeof(bad) / sizeof(*bad); ++i) {
        CHECK(!nova_scene_parse(&scene, bad[i], strlen(bad[i]), project.assets, project.count, error, sizeof(error)));
        CHECK(!memcmp(&scene, &retained, sizeof(scene)));
    }
    NovaEngine *engine = nova_create();
    CHECK(engine);
    const char *lua = "local p=nova.object('player'); assert(getmetatable(p)=='protected scene object handle');"
        "function update(dt,input) local x,y,z=nova.position(p); nova.set_position(p,x+input.horizontal*60*dt,y,z);"
        "nova.text('HUD',0,0,20,255,255,255) end";
    CHECK(nova_load_with_scene(engine, lua, strlen(lua), "main.lua", project.assets, project.count, &scene));
    CHECK(nova_tick(engine, 1.0/60, (NovaInput){1,0,false}));
    CHECK(nova_frame(engine)->count == 4 && nova_frame(engine)->commands[0].position.x == 121);
    CHECK(nova_frame(engine)->commands[3].type == NOVA_TEXT);
    CHECK(scene.objects[0].position.x == 120);
    CHECK(nova_load_with_scene(engine, lua, strlen(lua), "main.lua", project.assets, project.count, &scene));
    CHECK(nova_tick(engine, 0, (NovaInput){0}));
    CHECK(nova_frame(engine)->commands[0].position.x == 120);
    const char *failures[] = {
        "local p=nova.object('missing'); function update() end",
        "local p=nova.object('player\\0x'); function update() end",
        "nova.scene('2d'); function update() end",
        "function update() nova.position(1) end",
        "local p=nova.asset('art'); function update() nova.position(p) end",
        "local p=nova.object('player'); function update() nova.set_position(p,0,0,1) end",
        "local p=nova.object('player'); function update() nova.set_position(p,10001,0,0) end",
        "function update() for i=1,512 do nova.rectangle(0,0,1,1,1,2,3) end end",
    };
    for (size_t i = 0; i < sizeof(failures) / sizeof(*failures); ++i) {
        bool loaded = nova_load_with_scene(engine, failures[i], strlen(failures[i]), "bad.lua",
            project.assets, project.count, &scene);
        CHECK(!loaded || !nova_tick(engine, 0, (NovaInput){0}));
        CHECK(*nova_error(engine));
    }
    nova_destroy(engine);
    puts("Scene v1, manifest v3, UTF-8 identity, disposable runtime and Lua object contracts passed.");
    return 0;
}
