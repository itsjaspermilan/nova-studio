#include "nova.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(condition) do { if (!(condition)) { \
    fprintf(stderr, "%s:%d: check failed: %s\n", __FILE__, __LINE__, #condition); exit(1); \
} } while (0)

static void load_example(NovaEngine *engine, const char *relative)
{
    char path[4096];
    snprintf(path, sizeof(path), "%s/%s/main.lua", NOVA_EXAMPLES, relative);
    FILE *file = fopen(path, "rb");
    CHECK(file);
    CHECK(fseek(file, 0, SEEK_END) == 0);
    long size = ftell(file);
    CHECK(size > 0);
    rewind(file);
    char *source = malloc((size_t)size + 1);
    CHECK(source);
    CHECK(fread(source, 1, (size_t)size, file) == (size_t)size);
    source[size] = '\0';
    CHECK(fclose(file) == 0);
    CHECK(nova_load(engine, source, (size_t)size, path));
    free(source);
}

static bool script(NovaEngine *engine, const char *source)
{
    return nova_load(engine, source, strlen(source), "test.lua");
}

int main(void)
{
    NovaEngine *engine = nova_create();
    CHECK(engine);
    load_example(engine, "2d");
    for (int i = 0; i < 120; ++i) CHECK(nova_tick(engine, 1.0 / 60, (NovaInput){1, 0, false}));
    const NovaFrame *frame = nova_frame(engine);
    CHECK(frame->mode == NOVA_2D && frame->count > 180);
    bool player_moved = false;
    for (size_t i = 0; i < frame->count; ++i)
        if (frame->commands[i].type == NOVA_RECTANGLE && frame->commands[i].size.x == 36)
            player_moved = fabsf(frame->commands[i].position.x - 680) < 0.02f;
    CHECK(player_moved);
    load_example(engine, "mixed");
    CHECK(nova_tick(engine, 1.0 / 60, (NovaInput){1, -1, true}));
    frame = nova_frame(engine);
    CHECK(frame->mode == NOVA_MIXED && frame->camera_fov == 48);
    int cubes = 0, overlays = 0;
    for (size_t i = 0; i < frame->count; ++i) {
        cubes += frame->commands[i].type == NOVA_CUBE;
        overlays += frame->commands[i].type != NOVA_CUBE;
    }
    CHECK(cubes == 6 && overlays >= 4);
    CHECK(nova_overlap(0, 0, 10, 10, 9, 9, 10, 10));
    CHECK(!nova_overlap(0, 0, 10, 10, 10, 0, 10, 10));
    NovaViewport viewport = nova_viewport(1920, 1080, true);
    CHECK(viewport.scale == 2 && viewport.x == 0 && viewport.y == 0);
    viewport = nova_viewport(1280, 800, true);
    CHECK(viewport.scale == 1 && viewport.x == 160 && viewport.y == 130);
    viewport = nova_viewport(480, 270, true);
    CHECK(viewport.scale == 0.5f && viewport.width == 480);
    viewport = nova_viewport(1000, 1000, false);
    CHECK(fabsf(viewport.width - 1000) < 0.01f && fabsf(viewport.height - 562.5f) < 0.01f);
    CHECK(nova_viewport(0, 0, false).scale == 0);
    CHECK(!script(engine, "function update("));
    CHECK(strstr(nova_error(engine), "test.lua"));
    CHECK(!script(engine, "nova.scene('invalid'); function update() end"));
    CHECK(!script(engine, "x = 1"));
    CHECK(strstr(nova_error(engine), "update"));
    CHECK(!script(engine, "while true do end"));
    CHECK(strstr(nova_error(engine), "budget"));
    CHECK(script(engine, "function update() while true do end end"));
    CHECK(!nova_tick(engine, 0.01, (NovaInput){0}));
    CHECK(strstr(nova_error(engine), "budget"));
    CHECK(script(engine, "function update() local huge = string.rep('x', 17 * 1024 * 1024) end"));
    CHECK(!nova_tick(engine, 0.01, (NovaInput){0}));
    CHECK(strstr(nova_error(engine), "memory"));
    CHECK(script(engine, "function update() nova.rectangle(0,0,-1,10,255,0,0) end"));
    CHECK(!nova_tick(engine, 0.01, (NovaInput){0}));
    CHECK(strstr(nova_error(engine), "positive"));
    CHECK(script(engine, "function update() nova.background(256,0,0) end"));
    CHECK(!nova_tick(engine, 0.01, (NovaInput){0}));
    CHECK(script(engine, "function update() nova.rectangle(0/0,0,1,1,0,0,0) end"));
    CHECK(!nova_tick(engine, 0.01, (NovaInput){0}));
    CHECK(script(engine, "function update() for i=1,513 do nova.text('x',0,0,10,0,0,0) end end"));
    CHECK(!nova_tick(engine, 0.01, (NovaInput){0}));
    CHECK(strstr(nova_error(engine), "draw commands"));
    CHECK(nova_frame(engine)->count == 0);
    CHECK(script(engine, "assert(io == nil and os == nil and package == nil and dofile == nil); function update() end"));
    CHECK(!nova_tick(engine, NAN, (NovaInput){0}));
    CHECK(script(engine, "nova.scene('3d'); function update() nova.camera(0,1,0,0,0,0,50) end"));
    CHECK(!nova_tick(engine, 0.01, (NovaInput){0}));
    load_example(engine, "2d");
    CHECK(nova_tick(engine, 0, (NovaInput){0}));
    nova_destroy(engine);
    puts("Nova core: example movement, native collision, mixed scene, viewport, errors, limits and reload passed.");
    return 0;
}
