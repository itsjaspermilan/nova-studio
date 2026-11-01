#include "nova.h"
#include "assets.h"
#include "presentation.h"
#include <raylib.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    const char *scene;
    const char *project;
    const char *capture;
    const char *capture_native;
    NovaWorldResolution world_resolution;
    int frames;
    bool smoke;
} Options;

static NovaInput read_input(void)
{
    NovaInput input = {
        .horizontal = (IsKeyDown(KEY_D) || IsKeyDown(KEY_RIGHT)) - (IsKeyDown(KEY_A) || IsKeyDown(KEY_LEFT)),
        .vertical = (IsKeyDown(KEY_S) || IsKeyDown(KEY_DOWN)) - (IsKeyDown(KEY_W) || IsKeyDown(KEY_UP)),
        .action = IsKeyDown(KEY_SPACE)
    };
    if (IsGamepadAvailable(0)) {
        float x = GetGamepadAxisMovement(0, GAMEPAD_AXIS_LEFT_X);
        float y = GetGamepadAxisMovement(0, GAMEPAD_AXIS_LEFT_Y);
        if (fabsf(x) > 0.18f) input.horizontal = fmaxf(-1, fminf(1, x));
        if (fabsf(y) > 0.18f) input.vertical = fmaxf(-1, fminf(1, y));
        if (IsGamepadButtonDown(0, GAMEPAD_BUTTON_LEFT_FACE_LEFT)) input.horizontal = -1;
        if (IsGamepadButtonDown(0, GAMEPAD_BUTTON_LEFT_FACE_RIGHT)) input.horizontal = 1;
        if (IsGamepadButtonDown(0, GAMEPAD_BUTTON_LEFT_FACE_UP)) input.vertical = -1;
        if (IsGamepadButtonDown(0, GAMEPAD_BUTTON_LEFT_FACE_DOWN)) input.vertical = 1;
        input.action |= IsGamepadButtonDown(0, GAMEPAD_BUTTON_RIGHT_FACE_DOWN);
    }
    return input;
}

static Vector2 logical_pointer(const NovaPresentationLayout *layout)
{
    Vector2 point = GetMousePosition();
    if (GetTouchPointCount() > 0) point = GetTouchPosition(0);
    Vector2 logical = {-1, -1};
    if (!nova_presentation_pointer(layout, point, &logical))
        TraceLog(LOG_ERROR, "NOVA: Invalid pointer/presentation layout");
    return logical;
}

static int launcher(Vector2 pointer, bool clicked)
{
    const Rectangle cards[3] = {{60, 190, 270, 190}, {345, 190, 270, 190}, {630, 190, 270, 190}};
    const char *titles[3] = {"1 / 2D playground", "2 / Mixed world", "3 / Asset project"};
    const char *details[3] = {"Movement + collision", "Generated cube meshes", "PNG sprite + static GLB"};
    DrawRectangle(0, 0, NOVA_WIDTH, NOVA_HEIGHT, (Color){18, 24, 41, 255});
    DrawText("NOVA STUDIO", 60, 55, 44, (Color){235, 243, 255, 255});
    DrawText("Native vertical slice / editable Lua examples", 60, 117, 24, (Color){175, 191, 219, 255});
    int selected = -1;
    for (int i = 0; i < 3; ++i) {
        bool hover = CheckCollisionPointRec(pointer, cards[i]);
        DrawRectangleRec(cards[i], hover ? (Color){43, 63, 86, 255} : (Color){29, 40, 61, 255});
        DrawText(titles[i], (int)cards[i].x + 16, 231, 22, (Color){77, 225, 201, 255});
        DrawText(details[i], (int)cards[i].x + 16, 296, 18, (Color){235, 243, 255, 255});
        if (clicked && hover) selected = i;
    }
    DrawText("Choose: click / tap, keys 1-3, or gamepad A-B-X", 60, 423, 22, (Color){175, 191, 219, 255});
    DrawText("F1 / Start = launcher   R = reload scene/project   Esc / Back = exit", 60, 467, 20, (Color){175, 191, 219, 255});
    return selected;
}

static void draw_error(const char *error)
{
    DrawRectangle(0, 0, NOVA_WIDTH, NOVA_HEIGHT, (Color){38, 22, 32, 255});
    DrawText("SCENE ERROR", 28, 28, 32, (Color){255, 120, 120, 255});
    for (int row = 0; *error && row < 16; ++row) {
        char line[97];
        size_t length = 0;
        while (error[length] && error[length] != '\n' && length < sizeof(line) - 1) length++;
        memcpy(line, error, length);
        line[length] = '\0';
        DrawText(line, 28, 85 + row * 23, 16, RAYWHITE);
        error += length;
        if (*error == '\n') error++;
    }
#ifdef NOVA_STANDALONE
    DrawText("R retries the game. Esc / Back exits.", 28, 495, 20, RAYWHITE);
#else
    DrawText("Fix the scene/project, then R to retry. F1 / Start opens the launcher.", 28, 495, 20, RAYWHITE);
#endif
}

static bool parse_options(int argc, char **argv, Options *options)
{
    for (int i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--smoke") == 0) options->smoke = true;
        else if (strcmp(argv[i], "--scene") == 0 && i + 1 < argc) options->scene = argv[++i];
        else if (strcmp(argv[i], "--project") == 0 && i + 1 < argc) options->project = argv[++i];
        else if (strcmp(argv[i], "--capture") == 0 && i + 1 < argc) options->capture = argv[++i];
        else if (strcmp(argv[i], "--capture-native") == 0 && i + 1 < argc) options->capture_native = argv[++i];
        else if (strcmp(argv[i], "--world-resolution") == 0 && i + 1 < argc) {
            if (!nova_world_resolution_parse(argv[++i], &options->world_resolution)) return false;
        }
        else if (strcmp(argv[i], "--frames") == 0 && i + 1 < argc) {
            char *end;
            long count = strtol(argv[++i], &end, 10);
            if (*end || count < 1 || count > 100000) return false;
            options->frames = (int)count;
        } else return false;
    }
    return (!(options->capture || options->capture_native) || options->frames > 0) &&
        !(options->capture && options->capture_native && !strcmp(options->capture, options->capture_native)) &&
        (!options->smoke || options->frames >= 2) &&
        !(options->scene && options->project) && !(options->smoke && (options->scene || options->project));
}

#ifdef NOVA_STANDALONE
const char nova_standalone_project[] = "game/nova.project";
#endif

int main(int argc, char **argv)
{
    Options options = {.world_resolution = nova_world_resolution_default()};
#ifdef NOVA_STANDALONE
    const bool standalone = true;
    options.project = nova_standalone_project;
    if (argc != 1) {
        fprintf(stderr, "Nova: standalone games do not accept launcher options\n");
        return 2;
    }
#else
    const bool standalone = false;
#endif
    if (!parse_options(argc, argv, &options)) {
        fprintf(stderr, "Usage: nova_studio [--scene script.lua | --project nova.project] [--world-resolution 960x540|1280x720|1920x1080] [--frames 1..100000] [--capture image.png] [--capture-native native.png] [--smoke --frames N>=2]\n");
        return 2;
    }
    SetConfigFlags(FLAG_WINDOW_RESIZABLE | FLAG_VSYNC_HINT | FLAG_WINDOW_HIGHDPI);
    InitWindow(NOVA_WIDTH, NOVA_HEIGHT, "Nova Studio - native foundation");
    if (!IsWindowReady()) {
        fprintf(stderr, "Nova: GPU window initialization failed\n");
        return 1;
    }
#ifndef __ANDROID__
    SetWindowMinSize(480, 270);
#endif
    SetTargetFPS(60);
    NovaPresentation presentation = {0};
    RenderTexture2D capture_target = {0};
    char error[1024] = {0};
    NovaEngine *engine = nova_create();
    if (!engine || !nova_presentation_configure(&presentation, options.world_resolution, error, sizeof(error)) ||
        (options.capture && !nova_capture_target(&capture_target, error, sizeof(error)))) {
        TraceLog(LOG_ERROR, "NOVA: Native resource allocation failed: %s", engine ? error : nova_error(engine));
        nova_destroy(engine);
        nova_presentation_destroy(&presentation);
        UnloadRenderTexture(capture_target);
        CloseWindow();
        return 1;
    }
    NovaResources resources = {0};
    char examples[3][4096];
#ifdef __ANDROID__
    snprintf(examples[0], sizeof(examples[0]), "examples/2d/main.lua");
    snprintf(examples[1], sizeof(examples[1]), "examples/mixed/main.lua");
    snprintf(examples[2], sizeof(examples[2]), "examples/assets/nova.project");
#else
    snprintf(examples[0], sizeof(examples[0]), "%sexamples/2d/main.lua", GetApplicationDirectory());
    snprintf(examples[1], sizeof(examples[1]), "%sexamples/mixed/main.lua", GetApplicationDirectory());
    snprintf(examples[2], sizeof(examples[2]), "%sexamples/assets/nova.project", GetApplicationDirectory());
#endif
    const char *active_path = options.project ? options.project : options.scene;
    bool active_project = options.project != NULL;
    bool playing = false;
    int exit_code = 0;
    int frames = 0;
    double accumulator = 0;
    int pending_selection = -1;
    if (options.smoke) active_path = examples[0];
    if (active_path) {
        playing = nova_open_scene(&engine, &resources, active_path, active_project, error, sizeof(error));
        if (!playing) {
            exit_code = 1;
        }
    }
    while (!WindowShouldClose()) {
#ifdef __ANDROID__
        if (IsKeyPressed(KEY_BACK) || IsKeyPressed(KEY_ESCAPE)) break;
#endif
        bool start = IsGamepadAvailable(0) && IsGamepadButtonPressed(0, GAMEPAD_BUTTON_MIDDLE_RIGHT);
        if (!standalone && (IsKeyPressed(KEY_F1) || start)) {
            nova_unload_resources(&resources);
            nova_destroy(engine);
            engine = nova_create();
            if (!engine) {
                TraceLog(LOG_ERROR, "NOVA: Could not allocate launcher engine");
                exit_code = 1;
                break;
            }
            active_path = NULL;
            playing = false;
            error[0] = '\0';
            accumulator = 0;
            pending_selection = -1;
        }
        int selected = standalone ? -1 : pending_selection;
        pending_selection = -1;
        if (!standalone && !playing && !error[0]) {
            if (IsKeyPressed(KEY_ONE) || (IsGamepadAvailable(0) && IsGamepadButtonPressed(0, GAMEPAD_BUTTON_RIGHT_FACE_DOWN))) selected = 0;
            if (IsKeyPressed(KEY_TWO) || (IsGamepadAvailable(0) && IsGamepadButtonPressed(0, GAMEPAD_BUTTON_RIGHT_FACE_RIGHT))) selected = 1;
            if (IsKeyPressed(KEY_THREE) || (IsGamepadAvailable(0) && IsGamepadButtonPressed(0, GAMEPAD_BUTTON_RIGHT_FACE_LEFT))) selected = 2;
        }
        if (options.smoke && frames == options.frames / 2) selected = 1;
        if (selected >= 0) {
            active_path = examples[selected];
            active_project = selected == 2;
        }
        if (selected >= 0 || (active_path && IsKeyPressed(KEY_R))) {
            playing = nova_open_scene(&engine, &resources, active_path, active_project, error, sizeof(error));
            accumulator = 0;
            if (!playing) {
                exit_code = 1;
            }
        }
        bool focused = IsWindowFocused();
        nova_pause_services(&resources, !playing || (!focused && options.frames == 0));
        if (playing && (focused || options.frames > 0)) {
            accumulator += options.frames > 0 ? 1.0 / 60 : fmin(GetFrameTime(), 5.0 / 60);
            NovaInput input = options.smoke ? (NovaInput){0.7f, 0.2f, true} : read_input();
            while (accumulator >= 1.0 / 60) {
                if (!nova_tick(engine, 1.0 / 60, input) || !nova_tick_services(engine, &resources)) {
                    snprintf(error, sizeof(error), "%s", nova_error(engine));
                    TraceLog(LOG_ERROR, "NOVA: %s", error);
                    playing = false;
                    nova_pause_services(&resources, true);
                    exit_code = 1;
                    break;
                }
                accumulator -= 1.0 / 60;
            }
        } else accumulator = 0;
        NovaPresentationLayout layout;
        if (!nova_presentation_layout(GetScreenWidth(), GetScreenHeight(),
            GetRenderWidth(), GetRenderHeight(), playing && nova_frame(engine)->mode == NOVA_2D, &layout)) {
            TraceLog(LOG_ERROR, "NOVA: Native framebuffer/window dimensions are invalid");
            exit_code = 1;
            break;
        }
        if (playing) nova_presentation_world(&presentation, nova_frame(engine), &resources);
        BeginDrawing();
        NovaCanvasState canvas = nova_begin_canvas(layout.framebuffer_width, layout.framebuffer_height);
        ClearBackground(BLACK);
        if (playing) nova_presentation_composite(&presentation, nova_frame(engine), &resources, layout.viewport);
        else {
            Matrix overlay = nova_begin_overlay(layout.viewport);
            int clicked = -1;
            if (error[0]) draw_error(error);
            else if (!standalone) clicked = launcher(logical_pointer(&layout), IsMouseButtonPressed(MOUSE_BUTTON_LEFT));
            else draw_error("Game stopped. R retries the project.");
            nova_end_overlay(overlay);
            if (clicked >= 0) {
                pending_selection = clicked;
                if (options.frames > 0 && frames < options.frames) {
                    TraceLog(LOG_ERROR, "NOVA: Run interrupted after %d of %d required frames", frames, options.frames);
                    exit_code = 1;
                }
            }
        }
        if (options.capture_native && frames + 1 >= options.frames &&
            !nova_capture_native(options.capture_native, layout.framebuffer_width, layout.framebuffer_height))
            exit_code = 1;
        nova_end_canvas(canvas);
        EndDrawing();
        frames++;
        if (options.frames > 0 && frames >= options.frames) {
            if (options.capture) {
                BeginTextureMode(capture_target);
                if (playing) nova_presentation_composite(&presentation, nova_frame(engine), &resources,
                    nova_viewport(NOVA_WIDTH, NOVA_HEIGHT, false));
                else if (error[0]) draw_error(error);
                else if (!standalone) launcher((Vector2){-1, -1}, false);
                else draw_error("Game stopped. R retries the project.");
                EndTextureMode();
                if (!nova_capture_export(capture_target.texture, options.capture)) exit_code = 1;
            }
            printf("NOVA_PRESENT world=%dx%d overlay=%dx%d overlay_target=native-framebuffer window=%dx%d logical=%dx%d\n",
                presentation.world.texture.width, presentation.world.texture.height,
                layout.framebuffer_width, layout.framebuffer_height, layout.window_width, layout.window_height,
                NOVA_WIDTH, NOVA_HEIGHT);
            printf("NOVA_RUN frames=%d mode=%d commands=%zu status=%s\n", frames,
                nova_frame(engine)->mode, nova_frame(engine)->count, exit_code ? "error" : "ok");
            break;
        }
    }
    nova_destroy(engine);
    nova_unload_resources(&resources);
    nova_shutdown_audio();
    nova_presentation_destroy(&presentation);
    UnloadRenderTexture(capture_target);
    CloseWindow();
    return exit_code;
}
