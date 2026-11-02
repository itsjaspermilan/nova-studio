#ifndef NOVA_PRESENTATION_H
#define NOVA_PRESENTATION_H

#include "assets.h"

typedef struct { int width, height; } NovaWorldResolution;
typedef struct { int x, y, width, height; } NovaFramebufferRect;
typedef struct {
    int window_width, window_height;
    int framebuffer_width, framebuffer_height;
    NovaFramebufferRect region;
    NovaViewport viewport;
} NovaPresentationLayout;

/* GPU-context-owned host state, not an engine or scene contract. Zero initialize. */
typedef struct {
    RenderTexture2D world;
    Model cube;
} NovaPresentation;

typedef struct {
    Matrix projection, modelview;
    int width, height;
} NovaCanvasState;

bool nova_world_resolution_parse(const char *text, NovaWorldResolution *resolution);
NovaWorldResolution nova_world_resolution_default(void);
bool nova_presentation_layout(int window_width, int window_height,
    int framebuffer_width, int framebuffer_height, bool integer_scale,
    NovaPresentationLayout *layout);
bool nova_presentation_layout_region(int window_width, int window_height,
    int framebuffer_width, int framebuffer_height, NovaFramebufferRect region,
    bool integer_scale, NovaPresentationLayout *layout);
bool nova_presentation_pointer(const NovaPresentationLayout *layout,
    Vector2 window_point, Vector2 *logical_point);

/* Call outside drawing scopes. Failed replacement retains the previous target. */
bool nova_presentation_configure(NovaPresentation *presentation,
    NovaWorldResolution resolution, char *error, size_t error_capacity);
void nova_presentation_destroy(NovaPresentation *presentation);
Matrix nova_command_matrix(const NovaCommand *command);
void nova_presentation_world(NovaPresentation *presentation,
    const NovaFrame *frame, const NovaResources *resources);

/* Caller owns the active framebuffer and BeginDrawing/BeginTextureMode scope.
 * Canvas dimensions are actual target pixels, never window points.
 * Scopes are non-nested and restore the full active target viewport; do not call
 * within another camera/scissor scope. Hosts can pass their preview rectangle
 * as the composite viewport without changing the engine. */
NovaCanvasState nova_begin_canvas(int width, int height);
void nova_end_canvas(NovaCanvasState state);
Matrix nova_begin_overlay(NovaViewport viewport);
void nova_end_overlay(Matrix previous_modelview);
void nova_presentation_composite(const NovaPresentation *presentation,
    const NovaFrame *frame, const NovaResources *resources, NovaViewport viewport);
bool nova_capture_target(RenderTexture2D *target, char *error, size_t error_capacity);
bool nova_capture_export(Texture2D texture, const char *path);
/* Call before EndDrawing, with the default framebuffer active. */
bool nova_capture_native(const char *path, int width, int height);

#endif
