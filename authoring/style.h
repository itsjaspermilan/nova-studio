#ifndef NOVA_UI_STYLE_H
#define NOVA_UI_STYLE_H

#include <raylib.h>
#include <stdbool.h>
#include <stddef.h>

typedef struct {
    Color background, panel, surface, border, ink, muted, accent;
    Color button, hover, button_border, field, selection;
} NovaUIStyle;

bool nova_ui_style_open(char *error, size_t size);
void nova_ui_style_update(void);
void nova_ui_style_close(void);
const NovaUIStyle *nova_ui_style(void);
const char *nova_ui_style_error(void);
float nova_ui_code_cell(void);
void nova_ui_draw_text(const char *text, float x, float y, float width, bool code, Color color);

#endif
