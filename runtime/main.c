#include "nova.h"
#include "assets.h"
#include <raylib.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    const char *scene;
    const char *project;
    const char *capture;
    int frames;
    bool smoke;
} Options;

static Color ray_color(NovaColor value) { return (Color){value.r, value.g, value.b, value.a}; }
static Vector3 ray_vector(NovaVec3 value) { return (Vector3){value.x, value.y, value.z}; }

static void draw_frame(const NovaFrame *frame, Model cube, const NovaResources *resources)
{
    ClearBackground(ray_color(frame->background));
    if (frame->mode != NOVA_2D) {
        Camera3D camera = {
            .position = ray_vector(frame->camera_position), .target = ray_vector(frame->camera_target),
            .up = {0, 1, 0}, .fovy = frame->camera_fov, .projection = CAMERA_PERSPECTIVE
        };
        BeginMode3D(camera);
        for (size_t i = 0; i < frame->count; ++i) {
            const NovaCommand *draw = &frame->commands[i];
            if (draw->type == NOVA_CUBE) {
                DrawModelEx(cube, ray_vector(draw->position), (Vector3){0, 1, 0},
                    0, ray_vector(draw->size), ray_color(draw->color));
                DrawCubeWiresV(ray_vector(draw->position), ray_vector(draw->size), (Color){18, 24, 41, 255});
            } else if (draw->type == NOVA_MODEL) {
                DrawModelEx(resources->resources[draw->asset].model, ray_vector(draw->position),
                    (Vector3){0, 1, 0}, 0, ray_vector(draw->size), WHITE);
            }
        }
        EndMode3D();
    }
    for (size_t i = 0; i < frame->count; ++i) {
        const NovaCommand *draw = &frame->commands[i];
        if (draw->type == NOVA_RECTANGLE) {
            DrawRectangleRec((Rectangle){draw->position.x, draw->position.y, draw->size.x, draw->size.y}, ray_color(draw->color));
        } else if (draw->type == NOVA_TEXT) {
            DrawText(draw->text, (int)draw->position.x, (int)draw->position.y, (int)draw->size.x, ray_color(draw->color));
        } else if (draw->type == NOVA_SPRITE) {
            Texture2D texture = resources->resources[draw->asset].texture;
            DrawTexturePro(texture, (Rectangle){0, 0, (float)texture.width, (float)texture.height},
                (Rectangle){draw->position.x, draw->position.y, draw->size.x, draw->size.y},
                (Vector2){0, 0}, 0, WHITE);
        }
    }
}

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

static Vector2 logical_pointer(NovaViewport viewport)
{
    Vector2 point = GetMousePosition();
    if (GetTouchPointCount() > 0) point = GetTouchPosition(0);
    if (viewport.scale > 0) {
        point.x = (point.x - viewport.x) / viewport.scale;
        point.y = (point.y - viewport.y) / viewport.scale;
    }
    return point;
}

static int launcher(Vector2 pointer, bool clicked)
{
    const Rectangle cards[3] = {{60, 190, 270, 190}, {345, 190, 270, 190}, {630, 190, 270, 190}};
    const char *titles[3] = {"1 / 2D playground", "2 / Mixed world", "3 / Asset project"};
    const char *details[3] = {"Movement + collision", "Generated cube meshes", "PNG sprite + static GLB"};
    ClearBackground((Color){18, 24, 41, 255});
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
    ClearBackground((Color){38, 22, 32, 255});
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
        else if (strcmp(argv[i], "--frames") == 0 && i + 1 < argc) {
            char *end;
            long count = strtol(argv[++i], &end, 10);
            if (*end || count < 1 || count > 100000) return false;
            options->frames = (int)count;
        } else return false;
    }
    return (!options->capture || options->frames > 0) && (!options->smoke || options->frames >= 2) &&
        !(options->scene && options->project) && !(options->smoke && (options->scene || options->project));
}

#ifdef NOVA_STANDALONE
const char nova_standalone_project[] = "game/nova.project";
#endif

int main(int argc, char **argv)
{
    Options options = {0};
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
        fprintf(stderr, "Usage: nova_studio [--scene script.lua | --project nova.project] [--frames 1..100000] [--capture image.png] [--smoke --frames N>=2]\n");
        return 2;
    }
    SetConfigFlags(FLAG_WINDOW_RESIZABLE | FLAG_VSYNC_HINT);
    InitWindow(NOVA_WIDTH, NOVA_HEIGHT, "Nova Studio - native foundation");
    if (!IsWindowReady()) {
        fprintf(stderr, "Nova: GPU window initialization failed\n");
        return 1;
    }
#ifndef __ANDROID__
    SetWindowMinSize(480, 270);
#endif
    SetTargetFPS(60);
    RenderTexture2D target = LoadRenderTexture(NOVA_WIDTH, NOVA_HEIGHT);
    Model cube = LoadModelFromMesh(GenMeshCube(1, 1, 1));
    NovaEngine *engine = nova_create();
    if (!engine || !IsRenderTextureValid(target) || !IsModelValid(cube)) {
        TraceLog(LOG_ERROR, "NOVA: Native resource allocation failed");
        nova_destroy(engine);
        UnloadModel(cube);
        UnloadRenderTexture(target);
        CloseWindow();
        return 1;
    }
    SetTextureFilter(target.texture, TEXTURE_FILTER_POINT);
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
    char error[1024] = {0};
    int exit_code = 0;
    int frames = 0;
    double accumulator = 0;
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
        }
        int selected = -1;
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
        if (playing && (focused || options.frames > 0)) {
            accumulator += options.frames > 0 ? 1.0 / 60 : fmin(GetFrameTime(), 5.0 / 60);
            NovaInput input = options.smoke ? (NovaInput){0.7f, 0.2f, true} : read_input();
            while (accumulator >= 1.0 / 60) {
                if (!nova_tick(engine, 1.0 / 60, input)) {
                    snprintf(error, sizeof(error), "%s", nova_error(engine));
                    TraceLog(LOG_ERROR, "NOVA: %s", error);
                    playing = false;
                    exit_code = 1;
                    break;
                }
                accumulator -= 1.0 / 60;
            }
        } else accumulator = 0;
        NovaViewport viewport = nova_viewport(GetScreenWidth(), GetScreenHeight(),
            playing && nova_frame(engine)->mode == NOVA_2D);
        BeginTextureMode(target);
        if (playing) draw_frame(nova_frame(engine), cube, &resources);
        else if (error[0]) draw_error(error);
        else {
            int clicked = launcher(logical_pointer(viewport), IsMouseButtonPressed(MOUSE_BUTTON_LEFT));
            if (clicked >= 0) {
                active_path = examples[clicked];
                active_project = clicked == 2;
                playing = nova_open_scene(&engine, &resources, active_path, active_project, error, sizeof(error));
                if (!playing) {
                    exit_code = 1;
                }
                if (options.frames > 0 && frames < options.frames) {
                    TraceLog(LOG_ERROR, "NOVA: Run interrupted after %d of %d required frames", frames, options.frames);
                    exit_code = 1;
                }
            }
        }
        EndTextureMode();
        SetTextureFilter(target.texture, playing && nova_frame(engine)->mode == NOVA_2D ?
            TEXTURE_FILTER_POINT : TEXTURE_FILTER_BILINEAR);
        BeginDrawing();
        ClearBackground(BLACK);
        DrawTexturePro(target.texture, (Rectangle){0, 0, NOVA_WIDTH, -NOVA_HEIGHT},
            (Rectangle){viewport.x, viewport.y, viewport.width, viewport.height}, (Vector2){0, 0}, 0, WHITE);
        EndDrawing();
        frames++;
        if (options.frames > 0 && frames >= options.frames) {
            if (options.capture) {
                Image image = LoadImageFromTexture(target.texture);
                ImageFlipVertical(&image);
                if (!ExportImage(image, options.capture)) {
                    TraceLog(LOG_ERROR, "NOVA: Could not export capture: %s", options.capture);
                    exit_code = 1;
                }
                UnloadImage(image);
            }
            printf("NOVA_RUN frames=%d mode=%d commands=%zu status=%s\n", frames,
                nova_frame(engine)->mode, nova_frame(engine)->count, exit_code ? "error" : "ok");
            break;
        }
    }
    nova_destroy(engine);
    nova_unload_resources(&resources);
    UnloadModel(cube);
    UnloadRenderTexture(target);
    CloseWindow();
    return exit_code;
}
