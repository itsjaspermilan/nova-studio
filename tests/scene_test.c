#include "scene.h"
#include "transform.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s (%s)\n", __FILE__, __LINE__, #c, error); exit(1); } } while (0)

static bool near(NovaVec3 a, NovaVec3 b)
{
    return fabsf(a.x - b.x) < .0001f && fabsf(a.y - b.y) < .0001f && fabsf(a.z - b.z) < .0001f;
}

int main(void)
{
    char error[1024] = {0};
    CHECK(near(nova_rotate((NovaVec3){0, 1, 0}, (NovaVec3){90, 0, 0}), (NovaVec3){0, 0, 1}));
    CHECK(near(nova_rotate((NovaVec3){1, 0, 0}, (NovaVec3){0, 90, 0}), (NovaVec3){0, 0, -1}));
    CHECK(near(nova_rotate((NovaVec3){1, 0, 0}, (NovaVec3){0, 0, 90}), (NovaVec3){0, 1, 0}));
    CHECK(near(nova_transform_point((NovaVec3){1, 2, 3}, (NovaVec3){7, 11, 13},
        (NovaVec3){2, 3, 4}, (NovaVec3){90, 90, 90}), (NovaVec3){19, 17, 11}));
    const NovaVec3 position = {4, -2, 9}, scale = {2, .5f, 3}, angles = {23, -61, 117};
    const NovaVec3 point = {.3f, -1.7f, 2.8f};
    CHECK(near(nova_inverse_point(nova_transform_point(point, position, scale, angles),
        position, scale, angles), point));
    NovaVec3 minimum, maximum;
    nova_transform_bounds((NovaVec3){-1, -2, -3}, (NovaVec3){1, 2, 3},
        (NovaVec3){7, 11, 13}, (NovaVec3){2, 3, 4}, (NovaVec3){0, 90, 0}, &minimum, &maximum);
    CHECK(near(minimum, (NovaVec3){-5, 5, 11}) && near(maximum, (NovaVec3){19, 17, 15}));
    float distance = -1;
    CHECK(nova_ray_box((NovaVec3){0, 0, 10}, (NovaVec3){0, 0, -1}, (NovaVec3){-.5f, -.5f, -.5f},
        (NovaVec3){.5f, .5f, .5f}, (NovaVec3){0}, (NovaVec3){4, 1, 1}, (NovaVec3){0, 90, 0}, &distance));
    CHECK(fabsf(distance - 8) < .0001f);
    // Inside the rotated world AABB, but outside the oriented box.
    CHECK(!nova_ray_box((NovaVec3){1.7f, 0, 1.7f}, (NovaVec3){0, -1, 0}, (NovaVec3){-.5f, -.5f, -.5f},
        (NovaVec3){.5f, .5f, .5f}, (NovaVec3){0}, (NovaVec3){4, 1, 1}, (NovaVec3){0, 45, 0}, &distance));
    CHECK(!nova_rotation_valid((NovaVec3){NAN, 0, 0}) && !nova_rotation_valid((NovaVec3){0, 361, 0}));
    CHECK(nova_angle_normalize(180) == -180 && nova_angle_normalize(-180) == -180 &&
        nova_angle_normalize(1080) == 0 && nova_angle_normalize(-1081) == -1);
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
    CHECK(scene.version == 1 && scene.count == 3 && scene.objects[1].size.y == 2);
    CHECK(near(scene.objects[1].rotation, (NovaVec3){0}));
    NovaScene retained = scene;
    const char *bad[] = {
        "nova-scene 2\n",
        "nova-scene 3\nmode 3d\nbackground 18 24 41\ncamera 7 6 9 0 0 0 50\n",
        "nova-scene 2\nmode 3d\nbackground 18 24 41\ncamera 7 6 9 0 0 0 50\nobject a cube - 0 0 0 1 1 1 0 90 255 255 255 Name\n",
        "nova-scene 2\nmode 3d\nbackground 18 24 41\ncamera 7 6 9 0 0 0 50\nobject a cube - 0 0 0 1 1 1 0 361 0 255 255 255 Name\n",
        "nova-scene 2\nmode 3d\nbackground 18 24 41\ncamera 7 6 9 0 0 0 50\nobject a cube - 0 0 0 1 1 1 0 inf 0 255 255 255 Name\n",
        "nova-scene 2\nmode 2d\nbackground 18 24 41\ncamera 7 6 9 0 0 0 50\nobject a rectangle - 0 0 0 1 1 1 0 0 10 255 255 255 Name\n",
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
    const char *turn = "local p=nova.object('prop'); function update() "
        "local x,y,z=nova.rotation(p); nova.set_rotation(p,x+10,y-20,z+30); "
        "nova.cube(0,0,0,1,2,3,1,2,3); nova.cube(0,0,0,1,2,3,1,2,3,23,-61,117); "
        "nova.model(nova.asset('prop'),0,0,0,2); nova.model(nova.asset('prop'),0,0,0,2,23,-61,117) end";
    CHECK(nova_load_with_scene(engine, turn, strlen(turn), "turn.lua", project.assets, project.count, &scene));
    CHECK(nova_tick(engine, 0, (NovaInput){0}));
    CHECK(near(nova_frame(engine)->commands[1].rotation, (NovaVec3){10, -20, 30}));
    CHECK(near(nova_frame(engine)->commands[3].rotation, (NovaVec3){0}));
    CHECK(nova_frame(engine)->commands[3].color.r == 1 && nova_frame(engine)->commands[3].color.g == 2 &&
        nova_frame(engine)->commands[3].color.b == 3);
    CHECK(near(nova_frame(engine)->commands[4].rotation, angles));
    CHECK(near(nova_frame(engine)->commands[5].rotation, (NovaVec3){0}));
    CHECK(near(nova_frame(engine)->commands[6].rotation, angles));
    CHECK(near(scene.objects[1].rotation, (NovaVec3){0}) && scene.version == 1);
    const char *continuous = "local p=nova.object('prop'); local yaw=350; function update() "
        "yaw=yaw+20; nova.set_rotation(p,1e300,yaw,-yaw); local x,y,z=nova.rotation(p); "
        "assert(x>=-180 and x<180 and y>=-180 and y<180 and z>=-180 and z<180); "
        "nova.cube(0,0,0,1,1,1,1,2,3,720,yaw,0); nova.model(nova.asset('prop'),0,0,0,1,0,yaw,-720) end";
    CHECK(nova_load_with_scene(engine, continuous, strlen(continuous), "continuous.lua", project.assets, project.count, &scene));
    CHECK(nova_tick(engine, 0, (NovaInput){0}));
    CHECK(nova_frame(engine)->commands[1].rotation.y == 10 && nova_frame(engine)->commands[1].rotation.z == -10);
    CHECK(nova_frame(engine)->commands[3].rotation.x == 0 && nova_frame(engine)->commands[3].rotation.y == 10);
    CHECK(nova_frame(engine)->commands[4].rotation.y == 10 && nova_frame(engine)->commands[4].rotation.z == 0);
    for (int i = 0; i < 40; ++i) CHECK(nova_tick(engine, 0, (NovaInput){0}));
    const char *failures[] = {
        "local p=nova.object('missing'); function update() end",
        "local p=nova.object('player\\0x'); function update() end",
        "nova.scene('2d'); function update() end",
        "function update() nova.position(1) end",
        "local p=nova.asset('art'); function update() nova.position(p) end",
        "local p=nova.object('player'); function update() nova.set_position(p,0,0,1) end",
        "local p=nova.object('player'); function update() nova.set_position(p,10001,0,0) end",
        "function update() nova.set_rotation(nova.object('player'),0,0,10) end",
        "function update() nova.set_rotation(nova.asset('prop'),0,0,10) end",
        "function update() nova.set_rotation(nova.object('prop'),0,math.huge,0) end",
        "function update() nova.set_rotation(nova.object('prop'),0,0/0,0) end",
        "function update() nova.set_rotation(nova.object('prop'),0,0) end",
        "function update() nova.set_rotation(nova.object('prop'),0,0,0,0) end",
        "function update() nova.model(nova.asset('prop'),0,0,0,1,10) end",
        "function update() nova.model(nova.asset('prop'),0,0,0,1,10,20) end",
        "function update() nova.model(nova.asset('prop'),0,0,0,1,0,0/0,0) end",
        "function update() nova.cube(0,0,0,1,1,1,1,2,3,10) end",
        "function update() nova.cube(0,0,0,1,1,1,1,2,3,10,20) end",
        "function update() nova.cube(0,0,0,1,1,1,1,2,3,0,math.huge,0) end",
        "function update() for i=1,512 do nova.rectangle(0,0,1,1,1,2,3) end end",
    };
    for (size_t i = 0; i < sizeof(failures) / sizeof(*failures); ++i) {
        bool loaded = nova_load_with_scene(engine, failures[i], strlen(failures[i]), "bad.lua",
            project.assets, project.count, &scene);
        CHECK(!loaded || !nova_tick(engine, 0, (NovaInput){0}));
        CHECK(*nova_error(engine));
    }
    const char *v2 = "nova-scene 2\nmode mixed\nbackground 18 24 41\ncamera 7 6 9 0 0 0 50\n"
        "object prop model prop 1 2 3 2 3 4 23 -61 117 255 255 255 Rotated model\n"
        "object hud rectangle - 0 0 0 64 64 1 0 0 0 77 225 201 HUD\n";
    CHECK(nova_scene_parse(&scene, v2, strlen(v2), project.assets, project.count, error, sizeof(error)));
    CHECK(scene.version == 2 && near(scene.objects[0].rotation, angles));
    const char *empty = "function update() end";
    CHECK(nova_load_with_scene(engine, empty, strlen(empty), "main.lua", project.assets, project.count, &scene));
    CHECK(nova_tick(engine, 0, (NovaInput){0}));
    CHECK(near(nova_frame(engine)->commands[0].rotation, angles));
    scene.objects[0].rotation = (NovaVec3){180, -360, 360};
    CHECK(nova_load_with_scene(engine, empty, strlen(empty), "main.lua", project.assets, project.count, &scene));
    CHECK(near(nova_frame(engine)->commands[0].rotation, (NovaVec3){-180, 0, 0}));
    CHECK(near(scene.objects[0].rotation, (NovaVec3){180, -360, 360}));
    scene.version = 1;
    CHECK(!nova_scene_validate(&scene, project.assets, project.count, error, sizeof(error)));
    scene.version = 2;
    scene.objects[1].rotation.z = 20;
    CHECK(!nova_scene_validate(&scene, project.assets, project.count, error, sizeof(error)));
    scene.objects[1].rotation.z = 0;
    scene.objects[0].rotation.y = INFINITY;
    CHECK(!nova_scene_validate(&scene, project.assets, project.count, error, sizeof(error)));
    nova_destroy(engine);
    puts("Scene v1/v2, right-handed transforms, oriented picking, manifest v3 and disposable Lua object contracts passed.");
    return 0;
}
