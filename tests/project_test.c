#include "nova.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #c); exit(1); } } while (0)

static bool parse(NovaProject *project, const char *text, char *error)
{
    return nova_project_parse(project, text, strlen(text), error, 1024);
}

int main(void)
{
    NovaProject project = {0};
    char error[1024];
    CHECK(parse(&project, "# test\r\nnova-project 1\r\nentry scripts/main scene.lua\r\n"
        "sprite badge art/badge.png\nmodel gem models/gem.glb\n", error));
    CHECK(project.count == 2 && !strcmp(project.entry, "scripts/main scene.lua"));
    CHECK(project.assets[0].type == NOVA_ASSET_SPRITE && project.assets[1].type == NOVA_ASSET_MODEL);
    CHECK(project.version == 1 && !*project.identity);
    NovaProject retained = project;
    const char *invalid[] = {
        "", "nova-project 2\nentry main.lua", "entry main.lua",
        "nova-project 1", "nova-project 1\nentry main.lua\nentry other.lua",
        "nova-project 1\nentry /main.lua", "nova-project 1\nentry ../main.lua",
        "nova-project 1\nentry dir/../main.lua", "nova-project 1\nentry dir//main.lua",
        "nova-project 1\nentry ./main.lua", "nova-project 1\nentry C:\\main.lua",
        "nova-project 1\nentry main.lua\nsprite a a.png\nmodel a a.glb",
        "nova-project 1\nentry main.lua\nsprite a.b a.png",
        "nova-project 1\nentry main.lua\nsprite a a.jpg",
        "nova-project 1\nentry main.lua\nmodel a a.gltf",
        "nova-project 1\nentry main.lua\nunknown a a.png",
        "nova-project 1 extra\nentry main.lua",
        "nova-project 1\nentry main.txt",
        "nova-project 1\nentry main.lua\nidentity Sample",
        "nova-project 1\nentry main.lua\naudio tone tone.wav",
        "nova-project 2\nidentity A\nidentity B\nentry main.lua",
        "nova-project 2\nidentity ../A\nentry main.lua",
        "nova-project 2\nidentity A extra\nentry main.lua",
        "nova-project 2\nidentity A\nentry main.lua\naudio tone tone.mp3",
        "nova-project 2\nidentity A\nentry main.lua\naudio tone tone.wav\nsprite tone image.png",
        "# \xc3\xa9\nnova-project 1\nentry main.lua",
    };
    for (size_t i = 0; i < sizeof(invalid) / sizeof(*invalid); ++i) {
        CHECK(!parse(&project, invalid[i], error));
        CHECK(strstr(error, "manifest line"));
        CHECK(!memcmp(&project, &retained, sizeof(project)));
    }
    const char nul[] = "nova-project 1\0\nentry main.lua";
    CHECK(!nova_project_parse(&project, nul, sizeof(nul) - 1, error, sizeof(error)));
    char large[NOVA_MANIFEST_LIMIT + 2];
    memset(large, 'x', sizeof(large));
    CHECK(!nova_project_parse(&project, large, sizeof(large), error, sizeof(error)));
    char declarations[4096] = "nova-project 1\nentry main.lua\n";
    for (int i = 0; i < NOVA_MAX_ASSETS + 1; ++i) {
        char line[64];
        snprintf(line, sizeof(line), "sprite a%d a.png\n", i);
        strcat(declarations, line);
    }
    CHECK(!parse(&project, declarations, error));
    CHECK(strstr(error, "at most 32"));
    char *last = strstr(declarations, "sprite a32 ");
    CHECK(last);
    *last = '\0';
    CHECK(parse(&project, declarations, error) && project.count == NOVA_MAX_ASSETS);
    CHECK(parse(&project, "nova-project 1\nentry main.lua\nsprite Badge a.png\nsprite badge a.png", error));
    CHECK(project.count == 2 && strcmp(project.assets[0].id, project.assets[1].id));
    char id[NOVA_ASSET_ID_CAPACITY + 1];
    memset(id, 'a', sizeof(id));
    id[NOVA_ASSET_ID_CAPACITY - 1] = '\0';
    CHECK(nova_asset_id_valid(id));
    id[NOVA_ASSET_ID_CAPACITY - 1] = 'a';
    id[NOVA_ASSET_ID_CAPACITY] = '\0';
    CHECK(!nova_asset_id_valid(id));
    CHECK(nova_project_relative_path("folder with spaces/asset.png"));
    CHECK(!nova_project_relative_path("folder/"));
    CHECK(!nova_project_relative_path("https://example/image.png"));
    CHECK(!nova_project_relative_path("folder/\x01.png"));
    NovaProject services;
    CHECK(parse(&services, "nova-project 2\nidentity CaseSensitive\nentry main.lua\n"
        "audio Tone sound/tone.wav\nsprite Image image.png\nmodel Model model.glb\n", error));
    CHECK(services.version == 2 && services.count == 3 && !strcmp(services.identity, "CaseSensitive") &&
        services.assets[0].type == NOVA_ASSET_AUDIO);
    NovaEngine *engine = nova_create();
    CHECK(engine);
    const char *scene = "nova.scene('mixed'); local s=nova.asset('badge'); local m=nova.asset('gem');"
        "assert(getmetatable(s)=='protected asset handle');"
        "function update() nova.sprite(s,1,2,3,4); nova.model(m,5,6,7,2) end";
    CHECK(nova_load_with_assets(engine, scene, strlen(scene), "assets.lua", retained.assets, retained.count));
    CHECK(nova_tick(engine, 0, (NovaInput){0}));
    const NovaFrame *frame = nova_frame(engine);
    CHECK(frame->count == 2 && frame->commands[0].type == NOVA_SPRITE &&
        frame->commands[1].type == NOVA_MODEL && frame->commands[1].asset == 1 &&
        frame->commands[1].size.x == 2);
    const char *wrong[] = {
        "local m=nova.asset('gem'); function update() nova.sprite(m,0,0,1,1) end",
        "function update() nova.sprite(1,0,0,1,1) end",
        "local m=nova.asset('gem'); function update() nova.model(m,0,0,0,1) end",
        "local s=nova.asset('badge'); function update() nova.sprite(s,0,0,-1,1) end",
        "local s=nova.asset('badge'); function update() nova.model(s,0,0,0,1) end",
        "local m=nova.asset('gem'); nova.scene('3d'); function update() nova.model(m,0,0,0,0) end",
    };
    for (size_t i = 0; i < sizeof(wrong) / sizeof(*wrong); ++i) {
        CHECK(nova_load_with_assets(engine, wrong[i], strlen(wrong[i]), "wrong.lua", retained.assets, retained.count));
        CHECK(!nova_tick(engine, 0, (NovaInput){0}));
        CHECK(nova_frame(engine)->count == 0 && *nova_error(engine));
    }
    CHECK(!nova_load(engine, scene, strlen(scene), "direct.lua"));
    CHECK(strstr(nova_error(engine), "undeclared asset"));
    const char *missing = "nova.asset('absent'); function update() end";
    CHECK(!nova_load_with_assets(engine, missing, strlen(missing), "missing.lua", retained.assets, retained.count));
    const char *clean = "assert(old == nil); function update() end";
    CHECK(nova_load_with_assets(engine, clean, strlen(clean), "reload.lua", retained.assets, retained.count));
    CHECK(nova_tick(engine, 0, (NovaInput){0}));
    NovaAsset reordered[] = {retained.assets[1], retained.assets[0]};
    CHECK(nova_load_with_assets(engine, scene, strlen(scene), "reordered.lua", reordered, 2));
    CHECK(nova_tick(engine, 0, (NovaInput){0}));
    CHECK(nova_frame(engine)->commands[0].asset == 1 && nova_frame(engine)->commands[1].asset == 0);
    const char *nul_id = "nova.asset('badge\\0other'); function update() end";
    CHECK(!nova_load_with_assets(engine, nul_id, strlen(nul_id), "nul-id.lua", retained.assets, 2));
    CHECK(strstr(nova_error(engine), "undeclared asset"));
    nova_destroy(engine);
    puts("Nova manifest and Lua asset handles passed.");
    return 0;
}
