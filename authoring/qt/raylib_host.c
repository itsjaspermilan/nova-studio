/* Nova's platform backend for hash-pinned raylib 5.5, not a modified upstream file.
 * Like upstream platforms/rcore_*.c, this is compiled in rcore's translation unit.
 * No private Qt/GLFW API, foreign window, second context or readback is involved. */
#include "raylib_host.h"
#include <rcore.c>

static void *gl_loader;

void nova_qt_graphics_resize(int width, int height)
{
    CORE.Window.screen.width = CORE.Window.render.width = width;
    CORE.Window.screen.height = CORE.Window.render.height = height;
    CORE.Window.currentFbo = CORE.Window.render;
    CORE.Window.screenScale = MatrixIdentity();
    SetupViewport(width, height);
}

void nova_qt_graphics_init(void *loader, int width, int height)
{
    gl_loader = loader;
    InitWindow(width, height, "Nova Qt native viewport");
}

int InitPlatform(void)
{
    rlLoadExtensions(gl_loader);
    CORE.Window.ready = true;
    CORE.Window.render = CORE.Window.screen;
    CORE.Window.currentFbo = CORE.Window.screen;
    CORE.Window.display = CORE.Window.screen;
    InitTimer();
    return 0;
}

void ClosePlatform(void) { CORE.Window.ready = false; }
Vector2 GetWindowScaleDPI(void) { return (Vector2){1, 1}; }
void SwapScreenBuffer(void) { /* Qt composites and presents its framebuffer. */ }
void PollInputEvents(void) { /* Qt delivers events; the host passes NovaInput. */ }

double GetTime(void)
{
    struct timespec value;
    clock_gettime(CLOCK_MONOTONIC, &value);
    return (double)value.tv_sec + (double)value.tv_nsec * 1e-9;
}

void SetWindowSize(int width, int height) { nova_qt_graphics_resize(width, height); }
void SetMousePosition(int x, int y)
{
    CORE.Input.Mouse.currentPosition = (Vector2){(float)x, (float)y};
    CORE.Input.Mouse.previousPosition = CORE.Input.Mouse.currentPosition;
}
void SetWindowState(unsigned int flags)
{
    (void)flags;
    TraceLog(LOG_WARNING, "NOVA: window state belongs to the Qt host");
}
void ClearWindowState(unsigned int flags)
{
    (void)flags;
    TraceLog(LOG_WARNING, "NOVA: window state belongs to the Qt host");
}
void ToggleFullscreen(void) { TraceLog(LOG_WARNING, "NOVA: fullscreen belongs to the Qt host"); }
void MaximizeWindow(void) { TraceLog(LOG_WARNING, "NOVA: maximization belongs to the Qt host"); }
void MinimizeWindow(void) { TraceLog(LOG_WARNING, "NOVA: minimization belongs to the Qt host"); }
