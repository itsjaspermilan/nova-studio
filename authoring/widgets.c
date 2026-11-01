#include "widgets.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const Color ink = {226, 234, 246, 255}, muted = {153, 170, 195, 255};

bool nova_ui_command(void)
{
    return IsKeyDown(KEY_LEFT_CONTROL) || IsKeyDown(KEY_RIGHT_CONTROL) ||
        IsKeyDown(KEY_LEFT_SUPER) || IsKeyDown(KEY_RIGHT_SUPER);
}

bool nova_ui_button(Rectangle box, const char *label, bool enabled)
{
    bool hovered = CheckCollisionPointRec(GetMousePosition(), box);
    DrawRectangleRec(box, enabled ? (hovered ? (Color){52, 80, 94, 255} : (Color){34, 49, 66, 255}) :
        (Color){26, 32, 43, 255});
    nova_ui_label(label, (int)box.x + 8, (int)box.y + 8, (int)box.width - 16, enabled ? ink : muted);
    return enabled && hovered && IsMouseButtonPressed(MOUSE_BUTTON_LEFT);
}

void nova_ui_label(const char *text, int x, int y, int width, Color color)
{
    if (width <= 0) return;
    BeginScissorMode(x, y, width, 22);
    DrawText(text, x, y, 16, color);
    EndScissorMode();
}

bool nova_ui_field(Rectangle box, char *text, size_t capacity, bool *focused)
{
    bool changed = false;
    if (IsMouseButtonPressed(MOUSE_BUTTON_LEFT))
        *focused = CheckCollisionPointRec(GetMousePosition(), box);
    DrawRectangleRec(box, *focused ? (Color){45, 59, 74, 255} : (Color){22, 31, 44, 255});
    if (*focused) {
        if (nova_ui_command() && IsKeyPressed(KEY_A)) { text[0] = 0; changed = true; }
        if (IsKeyPressed(KEY_BACKSPACE) || IsKeyPressedRepeat(KEY_BACKSPACE)) {
            size_t length = strlen(text);
            if (length) {
                do { --length; } while (length && ((unsigned char)text[length] & 0xc0) == 0x80);
                text[length] = 0; changed = true;
            }
        }
        if (nova_ui_command() && IsKeyPressed(KEY_V)) {
            const char *paste = GetClipboardText();
            size_t length = strlen(text), extra = paste ? strlen(paste) : 0;
            if (extra && length + extra < capacity && !strchr(paste, '\n') && !strchr(paste, '\r')) {
                memcpy(text + length, paste, extra + 1); changed = true;
            }
        }
        int code;
        while ((code = GetCharPressed())) {
            if (code < 32 || nova_ui_command()) continue;
            int count;
            const char *bytes = CodepointToUTF8(code, &count);
            size_t length = strlen(text);
            if (length + (size_t)count < capacity) {
                memcpy(text + length, bytes, (size_t)count);
                text[length + (size_t)count] = 0; changed = true;
            }
        }
    }
    nova_ui_label(text, (int)box.x + 6, (int)box.y + 8, (int)box.width - 12, ink);
    return changed;
}

static size_t previous(const char *text, size_t at)
{
    if (at) { --at; while (at && ((unsigned char)text[at] & 0xc0) == 0x80) --at; }
    return at;
}

static size_t next(const char *text, size_t length, size_t at)
{
    if (at < length) { ++at; while (at < length && ((unsigned char)text[at] & 0xc0) == 0x80) ++at; }
    return at;
}

static void location(const char *text, size_t at, int *row, int *column)
{
    *row = *column = 0;
    for (size_t i = 0; i < at; i = next(text, at, i)) {
        if (text[i] == '\n') { ++*row; *column = 0; }
        else if (text[i] == '\t') *column += 4;
        else if (text[i] != '\r') ++*column;
    }
}

static size_t position(const char *text, size_t length, int row, int column)
{
    size_t at = 0;
    int r = 0, c = 0;
    while (at < length && r < row) if (text[at++] == '\n') ++r;
    while (at < length && text[at] != '\n' && c < column) {
        if (text[at] == '\t') c += 4;
        else if (text[at] != '\r') ++c;
        at = next(text, length, at);
    }
    return at;
}

void nova_ui_text_reset(NovaTextEditor *editor)
{
    free(editor->undo);
    *editor = (NovaTextEditor){0};
}

static bool edit(NovaTextEditor *editor, NovaDocument *doc, const char *text, size_t length,
    char *error, size_t size)
{
    char *undo = malloc(doc->length + 1);
    if (!undo) { snprintf(error, size, "out of memory storing one-step undo"); return false; }
    memcpy(undo, doc->text, doc->length + 1);
    size_t start = editor->cursor < editor->anchor ? editor->cursor : editor->anchor;
    size_t end = editor->cursor > editor->anchor ? editor->cursor : editor->anchor;
    size_t old_length = doc->length;
    if (!nova_document_replace(doc, start, end, text, length, error, size)) { free(undo); return false; }
    free(editor->undo);
    editor->undo = undo;
    editor->undo_length = old_length;
    editor->undo_cursor = editor->cursor; editor->undo_anchor = editor->anchor;
    editor->anchor = editor->cursor = start + length;
    return true;
}

static bool pressed(int key) { return IsKeyPressed(key) || IsKeyPressedRepeat(key); }

void nova_ui_text(NovaTextEditor *editor, NovaDocument *doc, Rectangle box,
    bool editable, char *error, size_t size)
{
    if (!doc->text) return;
    if (editor->cursor > doc->length) editor->cursor = doc->length;
    if (editor->anchor > doc->length) editor->anchor = doc->length;
    bool hover = CheckCollisionPointRec(GetMousePosition(), box);
    const int cell = 9, height = 21;
    int rows = (int)(box.height - 12) / height, columns = (int)(box.width - 12) / cell;
    if (rows < 1 || columns < 1) return;
    bool move = false;
    if (IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
        editor->focused = hover;
        if (hover) {
            Vector2 mouse = GetMousePosition();
            int row = editor->row + (int)(mouse.y - box.y - 6) / height;
            int column = editor->column + (int)(mouse.x - box.x - 6) / cell;
            editor->cursor = position(doc->text, doc->length, row, column);
            if (!IsKeyDown(KEY_LEFT_SHIFT) && !IsKeyDown(KEY_RIGHT_SHIFT)) editor->anchor = editor->cursor;
        }
    } else if (hover && editor->focused && IsMouseButtonDown(MOUSE_BUTTON_LEFT)) {
        Vector2 mouse = GetMousePosition();
        editor->cursor = position(doc->text, doc->length,
            editor->row + (int)(mouse.y - box.y - 6) / height,
            editor->column + (int)(mouse.x - box.x - 6) / cell);
    }
    if (hover) {
        Vector2 wheel = GetMouseWheelMoveV();
        editor->row -= (int)(wheel.y * 3);
        editor->column -= (int)(wheel.x * 3);
        if (editor->row < 0) editor->row = 0;
        if (editor->column < 0) editor->column = 0;
    }
    int row, column;
    location(doc->text, editor->cursor, &row, &column);
    if (editor->focused) {
        bool command = nova_ui_command();
        bool shift = IsKeyDown(KEY_LEFT_SHIFT) || IsKeyDown(KEY_RIGHT_SHIFT);
        if (command && IsKeyPressed(KEY_A)) { editor->anchor = 0; editor->cursor = doc->length; move = true; }
        if (command && (IsKeyPressed(KEY_C) || (editable && IsKeyPressed(KEY_X)))) {
            size_t start = editor->cursor < editor->anchor ? editor->cursor : editor->anchor;
            size_t end = editor->cursor > editor->anchor ? editor->cursor : editor->anchor;
            if (end > start) {
                char *copy = malloc(end - start + 1);
                if (copy) {
                    memcpy(copy, doc->text + start, end - start); copy[end - start] = 0;
                    SetClipboardText(copy); free(copy);
                    if (IsKeyPressed(KEY_X)) move = edit(editor, doc, "", 0, error, size);
                } else snprintf(error, size, "out of memory copying selection");
            }
        }
        if (editable && command && IsKeyPressed(KEY_Z) && editor->undo) {
            char *old = malloc(doc->length + 1);
            if (old) {
                memcpy(old, doc->text, doc->length + 1);
                size_t length = doc->length, cursor = editor->cursor, anchor = editor->anchor;
                if (nova_document_replace(doc, 0, doc->length, editor->undo, editor->undo_length, error, size)) {
                    editor->cursor = editor->undo_cursor; editor->anchor = editor->undo_anchor;
                    free(editor->undo); editor->undo = old; editor->undo_length = length;
                    editor->undo_cursor = cursor; editor->undo_anchor = anchor; move = true;
                } else free(old);
            } else snprintf(error, size, "out of memory restoring undo");
        }
        if (editable && command && IsKeyPressed(KEY_V)) {
            const char *paste = GetClipboardText();
            if (paste) move = edit(editor, doc, paste, strlen(paste), error, size);
        }
        size_t cursor = editor->cursor;
        if (pressed(KEY_LEFT)) { cursor = previous(doc->text, cursor); move = true; }
        if (pressed(KEY_RIGHT)) { cursor = next(doc->text, doc->length, cursor); move = true; }
        if (pressed(KEY_UP)) { cursor = position(doc->text, doc->length, row > 0 ? row - 1 : 0, column); move = true; }
        if (pressed(KEY_DOWN)) { cursor = position(doc->text, doc->length, row + 1, column); move = true; }
        if (pressed(KEY_HOME)) { cursor = command ? 0 : position(doc->text, doc->length, row, 0); move = true; }
        if (pressed(KEY_END)) { cursor = command ? doc->length : position(doc->text, doc->length, row, 1000000); move = true; }
        if (cursor != editor->cursor) { editor->cursor = cursor; if (!shift) editor->anchor = cursor; }
        if (editable && !command) {
            if (pressed(KEY_BACKSPACE)) {
                if (editor->cursor == editor->anchor) editor->anchor = previous(doc->text, editor->cursor);
                move = edit(editor, doc, "", 0, error, size);
            }
            if (pressed(KEY_DELETE)) {
                if (editor->cursor == editor->anchor) editor->anchor = next(doc->text, doc->length, editor->cursor);
                move = edit(editor, doc, "", 0, error, size);
            }
            if (IsKeyPressed(KEY_ENTER)) move = edit(editor, doc, "\n", 1, error, size);
            if (IsKeyPressed(KEY_TAB)) move = edit(editor, doc, "    ", 4, error, size);
            int code;
            while ((code = GetCharPressed())) {
                if (code < 32) continue;
                int count;
                const char *bytes = CodepointToUTF8(code, &count);
                move = edit(editor, doc, bytes, (size_t)count, error, size);
            }
        }
    }
    location(doc->text, editor->cursor, &row, &column);
    if (move) {
        if (row < editor->row) editor->row = row;
        if (row >= editor->row + rows) editor->row = row - rows + 1;
        if (column < editor->column) editor->column = column;
        if (column >= editor->column + columns) editor->column = column - columns + 1;
    }
    DrawRectangleRec(box, (Color){15, 22, 33, 255});
    BeginScissorMode((int)box.x, (int)box.y, (int)box.width, (int)box.height);
    size_t at = position(doc->text, doc->length, editor->row, 0);
    size_t low = editor->cursor < editor->anchor ? editor->cursor : editor->anchor;
    size_t high = editor->cursor > editor->anchor ? editor->cursor : editor->anchor;
    int r = 0, c = 0;
    while (at < doc->length && r < rows) {
        char byte = doc->text[at];
        float x = box.x + 6 + (c - editor->column) * cell, y = box.y + 6 + r * height;
        int count;
        int code = GetCodepointNext(doc->text + at, &count);
        if (count < 1 || (size_t)count > doc->length - at) count = 1;
        if (at >= low && at < high) DrawRectangle((int)x, (int)y, byte == '\t' ? cell * 4 : cell, height, (Color){38, 71, 95, 255});
        if (byte == '\n') { ++r; c = 0; }
        else if (byte == '\t') c += 4;
        else if (byte != '\r') {
            if (c >= editor->column && c < editor->column + columns)
                DrawTextCodepoint(GetFontDefault(), code, (Vector2){x, y}, 16, ink);
            ++c;
        }
        at += (size_t)count;
    }
    if (editor->focused && row >= editor->row && row < editor->row + rows) {
        DrawRectangle((int)box.x + 6 + (column - editor->column) * cell,
            (int)box.y + 6 + (row - editor->row) * height, 2, height, editable ? (Color){77, 225, 201, 255} : muted);
    }
    EndScissorMode();
}
