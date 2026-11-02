#ifndef NOVA_QT_RAYLIB_HOST_H
#define NOVA_QT_RAYLIB_HOST_H

#ifdef __cplusplus
extern "C" {
#endif

/* One context-owned renderer per process. Qt owns the context, input and swaps. */
void nova_qt_graphics_init(void *loader, int width, int height);
void nova_qt_graphics_resize(int width, int height);

#ifdef __cplusplus
}
#endif
#endif
