#include "presentation.h"
#include "transform.h"
#include <raymath.h>
#include <rlgl.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

static bool valid_resolution(NovaWorldResolution resolution)
{
    return (resolution.width == 960 && resolution.height == 540) ||
        (resolution.width == 1280 && resolution.height == 720) ||
        (resolution.width == 1920 && resolution.height == 1080);
}

NovaWorldResolution nova_world_resolution_default(void)
{
    return (NovaWorldResolution){NOVA_DEFAULT_WORLD_WIDTH, NOVA_DEFAULT_WORLD_HEIGHT};
}

bool nova_world_resolution_parse(const char *text, NovaWorldResolution *resolution)
{
    const NovaWorldResolution choices[] = {{960, 540}, {1280, 720}, {1920, 1080}};
    const char *names[] = {"960x540", "1280x720", "1920x1080"};
    if (!text || !resolution) return false;
    for (size_t i = 0; i < sizeof(choices) / sizeof(choices[0]); ++i) {
        if (!strcmp(text, names[i])) {
            *resolution = choices[i];
            return true;
        }
    }
    return false;
}

bool nova_presentation_layout(int window_width, int window_height,
    int framebuffer_width, int framebuffer_height, bool integer_scale,
    NovaPresentationLayout *layout)
{
    return nova_presentation_layout_region(window_width, window_height,
        framebuffer_width, framebuffer_height,
        (NovaFramebufferRect){0, 0, framebuffer_width, framebuffer_height}, integer_scale, layout);
}

bool nova_presentation_layout_region(int window_width, int window_height,
    int framebuffer_width, int framebuffer_height, NovaFramebufferRect region,
    bool integer_scale, NovaPresentationLayout *layout)
{
    if (!layout || window_width <= 0 || window_height <= 0 ||
        framebuffer_width <= 0 || framebuffer_height <= 0 ||
        region.x < 0 || region.y < 0 || region.x >= framebuffer_width || region.y >= framebuffer_height ||
        region.width <= 0 || region.height <= 0 ||
        region.width > framebuffer_width - region.x || region.height > framebuffer_height - region.y) return false;
    NovaViewport viewport = nova_viewport(region.width, region.height, integer_scale);
    viewport.x += region.x;
    viewport.y += region.y;
    *layout = (NovaPresentationLayout){window_width, window_height,
        framebuffer_width, framebuffer_height, region, viewport};
    return true;
}

bool nova_presentation_pointer(const NovaPresentationLayout *layout,
    Vector2 window_point, Vector2 *logical_point)
{
    if (!layout || !logical_point || layout->window_width <= 0 ||
        layout->window_height <= 0 || layout->framebuffer_width <= 0 || layout->framebuffer_height <= 0 ||
        !isfinite(layout->viewport.x) || !isfinite(layout->viewport.y) ||
        !isfinite(layout->viewport.scale) || layout->viewport.scale <= 0 ||
        !isfinite(window_point.x) || !isfinite(window_point.y)) return false;
    Vector2 candidate = {
        (window_point.x * layout->framebuffer_width / layout->window_width -
            layout->viewport.x) / layout->viewport.scale,
        (window_point.y * layout->framebuffer_height / layout->window_height -
            layout->viewport.y) / layout->viewport.scale};
    if (!isfinite(candidate.x) || !isfinite(candidate.y)) return false;
    *logical_point = candidate;
    return true;
}

static bool allocate_target(RenderTexture2D *target, int width, int height,
    char *error, size_t error_capacity)
{
    RenderTexture2D candidate = LoadRenderTexture(width, height);
    /* raylib's IsRenderTextureValid checks IDs, not framebuffer completeness. */
    if (!IsRenderTextureValid(candidate) || !rlFramebufferComplete(candidate.id)) {
        snprintf(error, error_capacity, "Could not allocate complete %dx%d GPU render target", width, height);
        TraceLog(LOG_ERROR, "NOVA: %s", error);
        UnloadRenderTexture(candidate);
        return false;
    }
    *target = candidate;
    if (error_capacity) error[0] = '\0';
    return true;
}

bool nova_presentation_configure(NovaPresentation *presentation,
    NovaWorldResolution resolution, char *error, size_t error_capacity)
{
    if (!valid_resolution(resolution)) {
        snprintf(error, error_capacity, "World resolution must be 960x540, 1280x720 or 1920x1080");
        TraceLog(LOG_ERROR, "NOVA: %s", error);
        return false;
    }
    if (presentation->world.texture.width == resolution.width &&
        presentation->world.texture.height == resolution.height && presentation->world.id) {
        if (error_capacity) error[0] = '\0';
        return true;
    }
    RenderTexture2D candidate = {0};
    if (!allocate_target(&candidate, resolution.width, resolution.height, error, error_capacity)) return false;
    Model cube = presentation->cube;
    if (!IsModelValid(cube)) {
        cube = LoadModelFromMesh(GenMeshCube(1, 1, 1));
        if (!IsModelValid(cube)) {
            snprintf(error, error_capacity, "Could not allocate native cube model");
            TraceLog(LOG_ERROR, "NOVA: %s", error);
            UnloadModel(cube);
            UnloadRenderTexture(candidate);
            return false;
        }
    }
    UnloadRenderTexture(presentation->world);
    presentation->world = candidate;
    presentation->cube = cube;
    return true;
}

void nova_presentation_destroy(NovaPresentation *presentation)
{
    UnloadRenderTexture(presentation->world);
    UnloadModel(presentation->cube);
    *presentation = (NovaPresentation){0};
}

static Color ray_color(NovaColor value) { return (Color){value.r, value.g, value.b, value.a}; }
static Vector3 ray_vector(NovaVec3 value) { return (Vector3){value.x, value.y, value.z}; }

Matrix nova_command_matrix(const NovaCommand *draw)
{
    const NovaVec3 x = nova_rotate((NovaVec3){draw->size.x, 0, 0}, draw->rotation);
    const NovaVec3 y = nova_rotate((NovaVec3){0, draw->size.y, 0}, draw->rotation);
    const NovaVec3 z = nova_rotate((NovaVec3){0, 0, draw->size.z}, draw->rotation);
    return (Matrix){.m0 = x.x, .m1 = x.y, .m2 = x.z, .m4 = y.x, .m5 = y.y, .m6 = y.z,
        .m8 = z.x, .m9 = z.y, .m10 = z.z, .m12 = draw->position.x,
        .m13 = draw->position.y, .m14 = draw->position.z, .m15 = 1};
}

void nova_presentation_world(NovaPresentation *presentation,
    const NovaFrame *frame, const NovaResources *resources)
{
    BeginTextureMode(presentation->world);
    ClearBackground(ray_color(frame->background));
    if (frame->mode != NOVA_2D) {
        Camera3D camera = {
            .position = ray_vector(frame->camera_position), .target = ray_vector(frame->camera_target),
            .up = {0, 1, 0}, .fovy = frame->camera_fov, .projection = CAMERA_PERSPECTIVE
        };
        BeginMode3D(camera);
        for (size_t i = 0; i < frame->count; ++i) {
            const NovaCommand *draw = &frame->commands[i];
            if (draw->type == NOVA_CUBE || draw->type == NOVA_MODEL) {
                Model model = draw->type == NOVA_CUBE ? presentation->cube : resources->resources[draw->asset].model;
                Matrix transform = nova_command_matrix(draw);
                model.transform = MatrixMultiply(model.transform, transform);
                DrawModel(model, (Vector3){0}, 1, draw->type == NOVA_CUBE ? ray_color(draw->color) : WHITE);
                if (draw->type == NOVA_CUBE) {
                    rlPushMatrix();
                    rlMultMatrixf(MatrixToFloat(transform));
                    DrawCubeWiresV((Vector3){0}, (Vector3){1, 1, 1}, (Color){18, 24, 41, 255});
                    rlPopMatrix();
                }
            }
        }
        EndMode3D();
    }
    EndTextureMode();
    SetTextureFilter(presentation->world.texture,
        frame->mode == NOVA_2D ? TEXTURE_FILTER_POINT : TEXTURE_FILTER_BILINEAR);
}

NovaCanvasState nova_begin_canvas(int width, int height)
{
    rlDrawRenderBatchActive();
    NovaCanvasState state = {rlGetMatrixProjection(), rlGetMatrixModelview(),
        rlGetFramebufferWidth(), rlGetFramebufferHeight()};
    rlViewport(0, 0, width, height);
    rlSetFramebufferWidth(width);
    rlSetFramebufferHeight(height);
    rlMatrixMode(RL_PROJECTION);
    rlLoadIdentity();
    rlOrtho(0, width, height, 0, 0, 1);
    rlMatrixMode(RL_MODELVIEW);
    rlLoadIdentity();
    return state;
}

void nova_end_canvas(NovaCanvasState state)
{
    rlDrawRenderBatchActive();
    rlSetMatrixProjection(state.projection);
    rlSetMatrixModelview(state.modelview);
    rlSetFramebufferWidth(state.width);
    rlSetFramebufferHeight(state.height);
    rlViewport(0, 0, rlGetActiveFramebuffer() ? state.width : GetRenderWidth(),
        rlGetActiveFramebuffer() ? state.height : GetRenderHeight());
}

Matrix nova_begin_overlay(NovaViewport viewport)
{
    Matrix previous = rlGetMatrixModelview();
    BeginMode2D((Camera2D){.offset = {viewport.x, viewport.y}, .zoom = viewport.scale});
    /* Use framebuffer pixels directly: BeginScissorMode applies platform DPI again. */
    int left = (int)ceilf(viewport.x), top = (int)ceilf(viewport.y);
    int right = (int)floorf(viewport.x + viewport.width);
    int bottom = (int)floorf(viewport.y + viewport.height);
    rlEnableScissorTest();
    rlScissor(left, rlGetFramebufferHeight() - bottom, right - left, bottom - top);
    return previous;
}

void nova_end_overlay(Matrix previous_modelview)
{
    EndMode2D();
    rlSetMatrixModelview(previous_modelview);
    rlDisableScissorTest();
}

void nova_presentation_composite(const NovaPresentation *presentation,
    const NovaFrame *frame, const NovaResources *resources, NovaViewport viewport)
{
    DrawTexturePro(presentation->world.texture,
        (Rectangle){0, 0, presentation->world.texture.width, -presentation->world.texture.height},
        (Rectangle){viewport.x, viewport.y, viewport.width, viewport.height}, (Vector2){0, 0}, 0, WHITE);
    Matrix overlay = nova_begin_overlay(viewport);
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
    nova_end_overlay(overlay);
}

bool nova_capture_target(RenderTexture2D *target, char *error, size_t error_capacity)
{
    return allocate_target(target, NOVA_WIDTH, NOVA_HEIGHT, error, error_capacity);
}

static bool export_image(Image image, const char *path)
{
    bool ok = IsImageValid(image) && ExportImage(image, path);
    if (!ok) TraceLog(LOG_ERROR, "NOVA: Could not read/export capture: %s", path);
    UnloadImage(image);
    return ok;
}

bool nova_capture_export(Texture2D texture, const char *path)
{
    Image image = LoadImageFromTexture(texture);
    if (IsImageValid(image)) ImageFlipVertical(&image);
    return export_image(image, path);
}

bool nova_capture_native(const char *path, int width, int height)
{
    if (width <= 0 || height <= 0 || width != GetRenderWidth() || height != GetRenderHeight() ||
        rlGetActiveFramebuffer() != 0) {
        TraceLog(LOG_ERROR, "NOVA: Native capture requires the current native framebuffer dimensions");
        return false;
    }
    rlDrawRenderBatchActive();
    Image image = {.data = rlReadScreenPixels(width, height), .width = width,
        .height = height, .mipmaps = 1, .format = PIXELFORMAT_UNCOMPRESSED_R8G8B8A8};
    return export_image(image, path);
}
