#include "widgets.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define ink (nova_ui_style()->ink)
#define muted (nova_ui_style()->muted)

static struct {
    Rectangle bounds;
    double since;
    bool hovered, visible;
    char text[256];
} tooltip;

void nova_ui_begin_frame(void) { tooltip.hovered = false; tooltip.visible = false; }

const char *nova_ui_tooltip_text(void) { return tooltip.visible ? tooltip.text : ""; }

void nova_ui_end_frame(void)
{
    if (!tooltip.hovered) { tooltip.text[0] = 0; return; }
    if (GetTime()-tooltip.since < .55) return;
    tooltip.visible = true;
    int width = (int)fminf(520,GetScreenWidth()-24);
    int x = (int)fmaxf(12,fminf(tooltip.bounds.x,GetScreenWidth()-width-12));
    int y = (int)tooltip.bounds.y+(int)tooltip.bounds.height+8;
    if (y+42 > GetScreenHeight()) y = (int)tooltip.bounds.y-46;
    DrawRectangleRounded((Rectangle){(float)x,(float)y,(float)width,38},.12f,8,nova_ui_style()->panel);
    DrawRectangleLinesEx((Rectangle){(float)x,(float)y,(float)width,38},1,nova_ui_style()->border);
    nova_ui_label(tooltip.text,x+10,y+10,width-20,ink);
}

void nova_ui_icon(NovaUIIcon icon, Vector2 p, Color c)
{
    float x=p.x, y=p.y;
    switch (icon) {
    case NOVA_ICON_SAVE:
        DrawRectangleLinesEx((Rectangle){x-7,y-7,14,14},2,c);
        DrawRectangleLinesEx((Rectangle){x-3,y+1,6,6},1,c);
        DrawLineEx((Vector2){x-3,y-5},(Vector2){x+3,y-5},2,c); break;
    case NOVA_ICON_PLAY:
        DrawTriangle((Vector2){x-5,y-7},(Vector2){x-5,y+7},(Vector2){x+7,y},c); break;
    case NOVA_ICON_STOP: DrawRectangle((int)x-6,(int)y-6,12,12,c); break;
    case NOVA_ICON_UNDO: case NOVA_ICON_REDO: {
        float s=icon==NOVA_ICON_UNDO ? 1 : -1;
        DrawLineEx((Vector2){x-6*s,y-3},(Vector2){x+5*s,y-3},2,c);
        DrawLineEx((Vector2){x+5*s,y-3},(Vector2){x+5*s,y+6},2,c);
        DrawLineEx((Vector2){x-6*s,y-3},(Vector2){x-1*s,y-8},2,c);
        DrawLineEx((Vector2){x-6*s,y-3},(Vector2){x-1*s,y+2},2,c); break;
    }
    case NOVA_ICON_ADD:
        DrawLineEx((Vector2){x-6,y},(Vector2){x+6,y},2,c);
        DrawLineEx((Vector2){x,y-6},(Vector2){x,y+6},2,c); break;
    case NOVA_ICON_DELETE:
        DrawRectangleLinesEx((Rectangle){x-5,y-3,10,10},2,c);
        DrawLineEx((Vector2){x-7,y-6},(Vector2){x+7,y-6},2,c);
        DrawLineEx((Vector2){x-2,y-8},(Vector2){x+2,y-8},2,c); break;
    case NOVA_ICON_SELECT:
        DrawLineEx((Vector2){x-5,y-7},(Vector2){x-5,y+6},2,c);
        DrawLineEx((Vector2){x-5,y-7},(Vector2){x+6,y+2},2,c);
        DrawLineEx((Vector2){x-5,y+6},(Vector2){x+6,y+2},2,c); break;
    case NOVA_ICON_MOVE:
        DrawLineEx((Vector2){x-7,y},(Vector2){x+7,y},2,c);
        DrawLineEx((Vector2){x,y-7},(Vector2){x,y+7},2,c);
        DrawLineEx((Vector2){x-7,y},(Vector2){x-3,y-4},2,c);
        DrawLineEx((Vector2){x,y-7},(Vector2){x+4,y-3},2,c); break;
    case NOVA_ICON_ROTATE:
        DrawCircleLines((int)x,(int)y,6,c);
        DrawLineEx((Vector2){x+6,y-5},(Vector2){x+6,y+1},2,c);
        DrawLineEx((Vector2){x+6,y+1},(Vector2){x,y+1},2,c); break;
    case NOVA_ICON_SCALE:
        DrawRectangleLinesEx((Rectangle){x-7,y+1,6,6},1,c);
        DrawLineEx((Vector2){x-1,y+1},(Vector2){x+6,y-6},2,c);
        DrawLineEx((Vector2){x,y-6},(Vector2){x+6,y-6},2,c);
        DrawLineEx((Vector2){x+6,y-6},(Vector2){x+6,y},2,c); break;
    }
}

bool nova_ui_icon_button(Rectangle box, const char *label, NovaUIIcon icon,
    bool selected, bool enabled, const char *hint, const char *disabled_reason)
{
    bool clicked = nova_ui_select_button(box,"",selected,enabled);
    Color color=selected ? WHITE : enabled ? ink : ColorAlpha(ink,.45f);
    nova_ui_icon(icon,(Vector2){box.x+17,box.y+box.height/2},color);
    nova_ui_label(label,(int)box.x+33,(int)(box.y+(box.height-18)/2),(int)box.width-39,color);
    if (CheckCollisionPointRec(GetMousePosition(),box)) {
        const char *text=enabled ? hint : disabled_reason;
        if (text && *text) {
            if (memcmp(&tooltip.bounds,&box,sizeof(box)) || strcmp(tooltip.text,text)) tooltip.since=GetTime();
            tooltip.bounds=box; tooltip.hovered=true;
            snprintf(tooltip.text,sizeof(tooltip.text),"%s",text);
        }
    }
    return clicked;
}

bool nova_ui_command(void)
{
    return IsKeyDown(KEY_LEFT_CONTROL) || IsKeyDown(KEY_RIGHT_CONTROL) ||
        IsKeyDown(KEY_LEFT_SUPER) || IsKeyDown(KEY_RIGHT_SUPER);
}

bool nova_ui_button(Rectangle box, const char *label, bool enabled)
{
    return nova_ui_select_button(box, label, false, enabled);
}

bool nova_ui_select_button(Rectangle box, const char *label, bool selected, bool enabled)
{
    bool hovered = CheckCollisionPointRec(GetMousePosition(), box);
    const NovaUIStyle *style = nova_ui_style();
    float radius = fminf(1, 12 / fminf(box.width, box.height));
    Color fill = selected ? style->accent : hovered && enabled ? style->hover : style->button;
    DrawRectangleRounded(box, radius, 16, enabled ? fill : ColorAlpha(fill, 0.45f));
    DrawRectangleRoundedLinesEx(box, radius, 16, 1, selected ? style->accent : style->button_border);
    nova_ui_label(label, (int)box.x + 11, (int)(box.y + (box.height - 18) / 2),
        (int)box.width - 22, selected ? WHITE : enabled ? ink : ColorAlpha(ink, 0.45f));
    return enabled && hovered && IsMouseButtonPressed(MOUSE_BUTTON_LEFT);
}

void nova_ui_label(const char *text, int x, int y, int width, Color color)
{
    if (width <= 0) return;
    BeginScissorMode(x, y, width, 22);
    nova_ui_draw_text(text, (float)x, (float)y, (float)width, false, color);
    EndScissorMode();
}

bool nova_ui_field_checked(Rectangle box, char *text, size_t capacity, bool *focused,
    char *error, size_t error_size)
{
    bool changed = false;
    if (IsMouseButtonPressed(MOUSE_BUTTON_LEFT))
        *focused = CheckCollisionPointRec(GetMousePosition(), box);
    float radius = fminf(1, 12 / fminf(box.width, box.height));
    DrawRectangleRounded(box, radius, 16, nova_ui_style()->field);
    DrawRectangleRoundedLinesEx(box, radius, 16, *focused ? 2 : 1,
        *focused ? nova_ui_style()->accent : nova_ui_style()->border);
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
            } else if (extra) {
                if (error_size) snprintf(error, error_size, "Field paste rejected: value exceeds its byte budget or contains line breaks");
                else TraceLog(LOG_WARNING, "NOVA UI: Field paste rejected (byte budget or line breaks)");
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
            } else {
                if (error_size) snprintf(error, error_size, "Field byte budget exceeded");
                else TraceLog(LOG_WARNING, "NOVA UI: Field byte budget exceeded");
            }
        }
    }
    nova_ui_label(text, (int)box.x + 6, (int)box.y + 8, (int)box.width - 12, ink);
    return changed;
}

bool nova_ui_field(Rectangle box, char *text, size_t capacity, bool *focused)
{
    return nova_ui_field_checked(box, text, capacity, focused, NULL, 0);
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

bool nova_ui_text_insert(NovaTextEditor *editor, NovaDocument *doc, const char *text, size_t length,
    char *error, size_t size)
{
    if (!doc->text || editor->cursor > doc->length || editor->anchor > doc->length) {
        snprintf(error, size, "text editor selection is outside the open document"); return false;
    }
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

bool nova_ui_text_undo(NovaTextEditor *editor, NovaDocument *doc, char *error, size_t size)
{
    if (!doc->text || !editor->undo) { snprintf(error, size, "no one-step text undo is available"); return false; }
    char *old = malloc(doc->length + 1);
    if (!old) { snprintf(error, size, "out of memory restoring undo"); return false; }
    memcpy(old, doc->text, doc->length + 1);
    size_t length = doc->length, cursor = editor->cursor, anchor = editor->anchor;
    if (!nova_document_replace(doc, 0, doc->length, editor->undo, editor->undo_length, error, size)) {
        free(old); return false;
    }
    editor->cursor = editor->undo_cursor; editor->anchor = editor->undo_anchor;
    free(editor->undo); editor->undo = old; editor->undo_length = length;
    editor->undo_cursor = cursor; editor->undo_anchor = anchor;
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
    const float cell = nova_ui_code_cell();
    const int height = 21;
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
                    if (IsKeyPressed(KEY_X)) move = nova_ui_text_insert(editor, doc, "", 0, error, size);
                } else snprintf(error, size, "out of memory copying selection");
            }
        }
        if (editable && command && IsKeyPressed(KEY_Z) && editor->undo) {
            move = nova_ui_text_undo(editor, doc, error, size);
        }
        if (editable && command && IsKeyPressed(KEY_V)) {
            const char *paste = GetClipboardText();
            if (paste) move = nova_ui_text_insert(editor, doc, paste, strlen(paste), error, size);
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
                move = nova_ui_text_insert(editor, doc, "", 0, error, size);
            }
            if (pressed(KEY_DELETE)) {
                if (editor->cursor == editor->anchor) editor->anchor = next(doc->text, doc->length, editor->cursor);
                move = nova_ui_text_insert(editor, doc, "", 0, error, size);
            }
            if (IsKeyPressed(KEY_ENTER)) move = nova_ui_text_insert(editor, doc, "\n", 1, error, size);
            if (IsKeyPressed(KEY_TAB)) move = nova_ui_text_insert(editor, doc, "    ", 4, error, size);
            int code;
            while ((code = GetCharPressed())) {
                if (code < 32) continue;
                int count;
                const char *bytes = CodepointToUTF8(code, &count);
                move = nova_ui_text_insert(editor, doc, bytes, (size_t)count, error, size);
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
    DrawRectangleRec(box, nova_ui_style()->surface);
    DrawRectangleLinesEx(box, 1, nova_ui_style()->border);
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
        if (at >= low && at < high) DrawRectangleRec((Rectangle){x,y,byte == '\t' ? cell * 4 : cell,(float)height}, nova_ui_style()->selection);
        if (byte == '\n') { ++r; c = 0; }
        else if (byte == '\t') c += 4;
        else if (byte != '\r') {
            if (c >= editor->column && c < editor->column + columns) {
                int encoded;
                const char *utf8 = CodepointToUTF8(code, &encoded);
                char glyph[8] = {0};
                if (encoded > 0 && encoded < (int)sizeof(glyph)) memcpy(glyph, utf8, (size_t)encoded);
                nova_ui_draw_text(glyph, x - 1, y, cell + 2, true, ink);
            }
            ++c;
        }
        at += (size_t)count;
    }
    if (editor->focused && row >= editor->row && row < editor->row + rows) {
        DrawRectangle((int)box.x + 6 + (column - editor->column) * cell,
            (int)box.y + 6 + (row - editor->row) * height, 1, height, editable ? nova_ui_style()->accent : muted);
    }
    EndScissorMode();
}
