#include "presentation.h"
#include <rlgl.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

#define CHECK(condition) do { if (!(condition)) { \
    fprintf(stderr, "Presentation check failed at %s:%d: %s\n", __FILE__, __LINE__, #condition); \
    return false; } } while (0)

static bool near(float a, float b) { return fabsf(a - b) < 0.001f; }
static bool color_is(Color color, int r, int g, int b)
{
    return color.r == r && color.g == g && color.b == b;
}

static bool layouts(void)
{
    NovaWorldResolution resolution = {17, 19};
    CHECK(!nova_world_resolution_parse("1280x720junk", &resolution));
    CHECK(resolution.width == 17 && resolution.height == 19);
    CHECK(!nova_world_resolution_parse(NULL, &resolution));
    CHECK(!nova_world_resolution_parse("960x540", NULL));
    CHECK(nova_world_resolution_parse("960x540", &resolution) && resolution.width == 960 && resolution.height == 540);
    CHECK(nova_world_resolution_parse("1280x720", &resolution) && resolution.width == 1280 && resolution.height == 720);
    CHECK(nova_world_resolution_parse("1920x1080", &resolution) && resolution.width == 1920 && resolution.height == 1080);
    NovaPresentationLayout layout = {0};
    CHECK(nova_presentation_layout(960, 540, 1920, 1080, true, &layout));
    CHECK(near(layout.viewport.scale, 2) && near(layout.viewport.x, 0));
    Vector2 point;
    CHECK(nova_presentation_pointer(&layout, (Vector2){480, 270}, &point));
    CHECK(near(point.x, 480) && near(point.y, 270));
    CHECK(nova_presentation_layout(1200, 800, 2400, 1600, true, &layout));
    CHECK(near(layout.viewport.scale, 2) && near(layout.viewport.x, 240) && near(layout.viewport.y, 260));
    CHECK(nova_presentation_pointer(&layout, (Vector2){120, 130}, &point));
    CHECK(near(point.x, 0) && near(point.y, 0));
    CHECK(nova_presentation_pointer(&layout, (Vector2){0, 0}, &point));
    CHECK(point.x < 0 && point.y < 0);
    CHECK(nova_presentation_layout(1200, 800, 2400, 1600, false, &layout));
    CHECK(near(layout.viewport.scale, 2.5f) && near(layout.viewport.x, 0) && near(layout.viewport.y, 125));
    CHECK(nova_presentation_pointer(&layout, (Vector2){600, 400}, &point));
    CHECK(near(point.x, 480) && near(point.y, 270));
    CHECK(nova_presentation_layout(480, 270, 480, 270, true, &layout));
    CHECK(near(layout.viewport.scale, 0.5f));
    CHECK(nova_presentation_layout(960, 540, 1920, 1620, false, &layout));
    CHECK(nova_presentation_pointer(&layout, (Vector2){480, 270}, &point));
    CHECK(near(point.x, 480) && near(point.y, 270));
    CHECK(nova_presentation_layout_region(1200, 800, 2400, 1600,
        (NovaFramebufferRect){400, 200, 1600, 1200}, false, &layout));
    CHECK(near(layout.viewport.x, 400) && near(layout.viewport.y, 350) &&
        near(layout.viewport.width, 1600) && near(layout.viewport.height, 900));
    CHECK(nova_presentation_pointer(&layout, (Vector2){200, 175}, &point));
    CHECK(near(point.x, 0) && near(point.y, 0));
    CHECK(nova_presentation_pointer(&layout, (Vector2){600, 400}, &point));
    CHECK(near(point.x, 480) && near(point.y, 270));
    NovaPresentationLayout before = layout;
    CHECK(!nova_presentation_layout(0, 540, 1920, 1080, true, &layout));
    CHECK(!nova_presentation_layout(960, 540, 0, 1080, true, &layout));
    CHECK(!nova_presentation_layout(960, 540, 1920, -1, true, &layout));
    CHECK(!nova_presentation_layout_region(1200, 800, 2400, 1600,
        (NovaFramebufferRect){400, 200, 2400, 1600}, false, &layout));
    CHECK(!nova_presentation_layout_region(1200, 800, 2400, 1600,
        (NovaFramebufferRect){-1, 200, 400, 300}, false, &layout));
    CHECK(!memcmp(&layout, &before, sizeof(layout)));
    Vector2 previous_point = point;
    CHECK(!nova_presentation_pointer(&layout, (Vector2){NAN, 0}, &point));
    CHECK(near(point.x, previous_point.x) && near(point.y, previous_point.y));
    layout.viewport.scale = NAN;
    CHECK(!nova_presentation_pointer(&layout, (Vector2){0, 0}, &point));
    puts("World presets, high-DPI/nonuniform pointer mapping, resize, letterboxes and invalid dimensions verified.");
    return true;
}

static Image native_image(int width, int height)
{
    rlDrawRenderBatchActive();
    return (Image){.data = rlReadScreenPixels(width, height), .width = width, .height = height,
        .mipmaps = 1, .format = PIXELFORMAT_UNCOMPRESSED_R8G8B8A8};
}

static bool gpu_checks(void)
{
    NovaPresentation presentation = {0};
    NovaResources resources = {0};
    char error[256] = {0};
    NovaFrame frame = {.mode = NOVA_MIXED, .background = {18, 24, 41, 255},
        .camera_position = {0, 2, 6}, .camera_target = {0, 0, 0}, .camera_fov = 55,
        .count = 6, .commands = {
            {.type = NOVA_CUBE, .position = {0, 0, 0}, .size = {1, 1, 1}, .color = {77, 225, 201, 255}},
            {.type = NOVA_RECTANGLE, .position = {10.5f, 10, 0}, .size = {0.5f, 20, 0}, .color = {255, 0, 0, 255}},
            {.type = NOVA_RECTANGLE, .position = {-100, -100, 0}, .size = {110, 110, 0}, .color = {0, 255, 0, 255}},
            {.type = NOVA_TEXT, .position = {24, 60, 0}, .size = {24, 0, 0}, .color = {235, 243, 255, 255}, .text = "Native HUD"},
            {.type = NOVA_SPRITE, .position = {100, 100, 0}, .size = {20, 20, 0}, .asset = 0},
            {.type = NOVA_SPRITE, .position = {130, 100, 0}, .size = {20, 20, 0}, .asset = 0}
        }};
    SetConfigFlags(FLAG_WINDOW_RESIZABLE | FLAG_WINDOW_HIGHDPI);
    InitWindow(960, 540, "Nova presentation regression");
    CHECK(IsWindowReady());
    Image sprite = GenImageColor(2, 1, (Color){255, 0, 0, 128});
    CHECK(IsImageValid(sprite));
    ImageDrawPixel(&sprite, 1, 0, BLANK);
    resources.resources[0] = (NovaResource){.type = NOVA_ASSET_SPRITE, .owned = true,
        .texture = LoadTextureFromImage(sprite)};
    resources.count = 1;
    UnloadImage(sprite);
    CHECK(IsTextureValid(resources.resources[0].texture));
    SetTextureFilter(resources.resources[0].texture, TEXTURE_FILTER_POINT);
    CHECK(nova_presentation_configure(&presentation, (NovaWorldResolution){960, 540}, error, sizeof(error)));
    unsigned int original = presentation.world.id, cube = presentation.cube.meshes[0].vaoId;
    CHECK(!nova_presentation_configure(&presentation, (NovaWorldResolution){640, 360}, error, sizeof(error)));
    CHECK(strstr(error, "World resolution") && presentation.world.id == original);
    CHECK(nova_presentation_configure(&presentation, (NovaWorldResolution){960, 540}, error, sizeof(error)));
    CHECK(presentation.world.id == original && !error[0]);
    const NovaWorldResolution choices[] = {{960, 540}, {1280, 720}, {1920, 1080}, {960, 540}};
    for (size_t i = 0; i < sizeof(choices) / sizeof(choices[0]); ++i) {
        CHECK(nova_presentation_configure(&presentation, choices[i], error, sizeof(error)));
        CHECK(presentation.world.texture.width == choices[i].width && presentation.world.texture.height == choices[i].height);
        CHECK(presentation.world.depth.width == choices[i].width && presentation.world.depth.height == choices[i].height);
        CHECK(presentation.cube.meshes[0].vaoId == cube);
        CHECK(rlFramebufferComplete(presentation.world.id));
        nova_presentation_world(&presentation, &frame, &resources);
        Image world = LoadImageFromTexture(presentation.world.texture);
        CHECK(IsImageValid(world));
        ImageFlipVertical(&world);
        CHECK(color_is(GetImageColor(world, 12, 12), 18, 24, 41));
        int model_pixels = 0;
        for (int y = 0; y < world.height; ++y)
            for (int x = 0; x < world.width; ++x)
                if (color_is(GetImageColor(world, x, y), 77, 225, 201)) model_pixels++;
        CHECK(model_pixels > 1000);
        UnloadImage(world);
        BeginDrawing();
        int width = GetRenderWidth(), height = GetRenderHeight();
        NovaCanvasState canvas = nova_begin_canvas(width, height);
        ClearBackground(BLACK);
        NovaViewport viewport = nova_viewport(width, height, false);
        nova_presentation_composite(&presentation, &frame, &resources, viewport);
        CHECK(rlGetActiveFramebuffer() == 0);
        CHECK(rlGetFramebufferWidth() == width && rlGetFramebufferHeight() == height);
        Image native = native_image(width, height);
        CHECK(IsImageValid(native) && native.width == width && native.height == height);
        Color alpha = GetImageColor(native, (int)(viewport.x + 105 * viewport.scale), (int)(viewport.y + 105 * viewport.scale));
        CHECK(alpha.r >= 136 && alpha.r <= 137 && alpha.g == 12 && alpha.b == 20);
        CHECK(color_is(GetImageColor(native, (int)(viewport.x + 115 * viewport.scale),
            (int)(viewport.y + 105 * viewport.scale)), 18, 24, 41));
        Color alias = GetImageColor(native, (int)(viewport.x + 135 * viewport.scale), (int)(viewport.y + 105 * viewport.scale));
        CHECK(color_is(alias, alpha.r, alpha.g, alpha.b));
        int x = (int)ceilf(viewport.x + 10.5f * viewport.scale);
        int y = (int)(viewport.y + 15 * viewport.scale);
        if (near(viewport.scale, 2)) {
            CHECK(color_is(GetImageColor(native, x, y), 255, 0, 0));
            CHECK(color_is(GetImageColor(native, x - 1, y), 18, 24, 41));
            CHECK(color_is(GetImageColor(native, x + 1, y), 18, 24, 41));
        }
        printf("NOVA_GPU_PRESENT world=%dx%d depth=%dx%d overlay=%dx%d fbo=%u cube_pixels=%d scale=%.3f\n",
            presentation.world.texture.width, presentation.world.texture.height,
            presentation.world.depth.width, presentation.world.depth.height,
            width, height, rlGetActiveFramebuffer(), model_pixels, viewport.scale);
        UnloadImage(native);
        if (i == 0) {
            CHECK(nova_capture_native(NOVA_TEST_DIRECTORY "/presentation-native.png", width, height));
            Image exported = LoadImage(NOVA_TEST_DIRECTORY "/presentation-native.png");
            CHECK(IsImageValid(exported) && exported.width == width && exported.height == height);
            UnloadImage(exported);
        }
        CHECK(!nova_capture_native(NOVA_TEST_DIRECTORY "/invalid-native.png", width + 1, height));
        nova_end_canvas(canvas);
        EndDrawing();
    }
    RenderTexture2D capture = {0};
    CHECK(nova_capture_target(&capture, error, sizeof(error)));
    BeginTextureMode(capture);
    nova_presentation_composite(&presentation, &frame, &resources, nova_viewport(960, 540, false));
    EndTextureMode();
    CHECK(nova_capture_export(capture.texture, NOVA_TEST_DIRECTORY "/presentation-logical.png"));
    Image logical = LoadImage(NOVA_TEST_DIRECTORY "/presentation-logical.png");
    CHECK(IsImageValid(logical) && logical.width == 960 && logical.height == 540);
    CHECK(color_is(GetImageColor(logical, 5, 5), 0, 255, 0));
    Color logical_alpha = GetImageColor(logical, 105, 105);
    CHECK(logical_alpha.r >= 136 && logical_alpha.r <= 137 && logical_alpha.g == 12 && logical_alpha.b == 20);
    UnloadImage(logical);
    UnloadRenderTexture(capture);

    SetWindowSize(1200, 800);
    for (int i = 0; i < 3; ++i) { BeginDrawing(); ClearBackground(BLACK); EndDrawing(); }
    NovaPresentationLayout layout;
    CHECK(nova_presentation_layout(GetScreenWidth(), GetScreenHeight(), GetRenderWidth(), GetRenderHeight(), true, &layout));
    CHECK(layout.window_width == 1200 && layout.window_height == 800);
    frame.mode = NOVA_2D;
    nova_presentation_world(&presentation, &frame, &resources);
    BeginDrawing();
    NovaCanvasState canvas = nova_begin_canvas(layout.framebuffer_width, layout.framebuffer_height);
    ClearBackground(BLACK);
    nova_presentation_composite(&presentation, &frame, &resources, layout.viewport);
    Image resized = native_image(layout.framebuffer_width, layout.framebuffer_height);
    CHECK(IsImageValid(resized));
    CHECK(color_is(GetImageColor(resized, 0, 0), 0, 0, 0));
    CHECK(color_is(GetImageColor(resized, (int)layout.viewport.x + 1, (int)layout.viewport.y + 1), 0, 255, 0));
    CHECK(presentation.world.texture.width == 960 && presentation.world.texture.height == 540);
    printf("NOVA_GPU_RESIZE window=%dx%d overlay=%dx%d viewport=%.0f,%.0f,%.0f,%.0f scale=%.1f world=%dx%d\n",
        layout.window_width, layout.window_height, layout.framebuffer_width, layout.framebuffer_height,
        layout.viewport.x, layout.viewport.y, layout.viewport.width, layout.viewport.height, layout.viewport.scale,
        presentation.world.texture.width, presentation.world.texture.height);
    CHECK(nova_capture_native(NOVA_TEST_DIRECTORY "/presentation-resized.png", layout.framebuffer_width, layout.framebuffer_height));
    UnloadImage(resized);
    nova_end_canvas(canvas);
    EndDrawing();

    CHECK(nova_presentation_layout_region(GetScreenWidth(), GetScreenHeight(), GetRenderWidth(), GetRenderHeight(),
        (NovaFramebufferRect){GetRenderWidth() / 6, GetRenderHeight() / 8,
            GetRenderWidth() * 2 / 3, GetRenderHeight() * 3 / 4}, false, &layout));
    BeginDrawing();
    canvas = nova_begin_canvas(layout.framebuffer_width, layout.framebuffer_height);
    ClearBackground((Color){100, 0, 100, 255});
    nova_presentation_composite(&presentation, &frame, &resources, layout.viewport);
    Image panel = native_image(layout.framebuffer_width, layout.framebuffer_height);
    CHECK(IsImageValid(panel));
    CHECK(color_is(GetImageColor(panel, 0, 0), 100, 0, 100));
    int left = (int)ceilf(layout.viewport.x), top = (int)ceilf(layout.viewport.y);
    CHECK(color_is(GetImageColor(panel, layout.region.x, layout.region.y), 100, 0, 100));
    CHECK(color_is(GetImageColor(panel, left + 1, top + 1), 0, 255, 0));
    CHECK(color_is(GetImageColor(panel, left - 1, top + 1), 100, 0, 100));
    CHECK(color_is(GetImageColor(panel, (int)ceilf(layout.viewport.x + layout.viewport.width),
        (int)ceilf(layout.viewport.y + layout.viewport.height)), 100, 0, 100));
    UnloadImage(panel);
    nova_end_canvas(canvas);
    EndDrawing();
    puts("Native panel clipping, pixel-space preview placement, sprite alpha/alias/nearest filtering and capture shapes verified.");
    nova_unload_resources(&resources);
    nova_presentation_destroy(&presentation);
    CHECK(!presentation.world.id && !presentation.cube.meshCount);
    nova_presentation_destroy(&presentation);
    CloseWindow();
    return true;
}

int main(int argc, char **argv)
{
    if (!layouts()) return 1;
    if (argc == 1) return 0;
    if (argc != 2 || strcmp(argv[1], "--gpu")) return 2;
    return gpu_checks() ? 0 : 1;
}
