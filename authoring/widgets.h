#ifndef NOVA_WIDGETS_H
#define NOVA_WIDGETS_H

#include "document.h"
#include <raylib.h>

typedef struct {
    size_t cursor, anchor;
    int row, column;
    bool focused;
    char *undo;
    size_t undo_length, undo_cursor, undo_anchor;
} NovaTextEditor;

bool nova_ui_button(Rectangle bounds, const char *label, bool enabled);
void nova_ui_label(const char *text, int x, int y, int width, Color color);
bool nova_ui_field(Rectangle bounds, char *text, size_t capacity, bool *focused);
bool nova_ui_field_checked(Rectangle bounds, char *text, size_t capacity, bool *focused,
    char *error, size_t error_size);
void nova_ui_text(NovaTextEditor *editor, NovaDocument *document, Rectangle bounds,
    bool editable, char *error, size_t error_size);
/* Shared mutation path for typed/pasted selections and deterministic UI checks. */
bool nova_ui_text_insert(NovaTextEditor *editor, NovaDocument *document,
    const char *text, size_t length, char *error, size_t error_size);
bool nova_ui_text_undo(NovaTextEditor *editor, NovaDocument *document,
    char *error, size_t error_size);
void nova_ui_text_reset(NovaTextEditor *editor);
bool nova_ui_command(void);

#endif
