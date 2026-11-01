#include "widgets.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #c); exit(1); } } while (0)

int main(void)
{
    char root[] = NOVA_TEST_DIRECTORY "/editor-text-XXXXXX", error[1024];
    CHECK(mkdtemp(root));
    NovaDocument document = {0};
    NovaTextEditor editor = {0};
    CHECK(!nova_ui_text_insert(&editor, &document, "x", 1, error, sizeof(error)));
    CHECK(nova_document_open_output(&document, root, "source.lua", 64, false, error, sizeof(error)));
    CHECK(nova_ui_text_insert(&editor, &document, "abc\r\n", 5, error, sizeof(error)));
    CHECK(editor.cursor == 5 && editor.anchor == 5 && document.length == 5);
    CHECK(nova_document_save(&document, false, error, sizeof(error)));
    editor.anchor = 1; editor.cursor = 2;
    const char utf8[] = "\xc3\xa9";
    CHECK(nova_ui_text_insert(&editor, &document, utf8, 2, error, sizeof(error)));
    CHECK(document.length == 6 && !memcmp(document.text, "a\xc3\xa9" "c\r\n", 6));
    CHECK(editor.cursor == 3 && editor.anchor == 3 && nova_document_dirty(&document));
    CHECK(nova_ui_text_undo(&editor, &document, error, sizeof(error)));
    CHECK(document.length == 5 && !strcmp(document.text, "abc\r\n") && !nova_document_dirty(&document));
    CHECK(nova_ui_text_undo(&editor, &document, error, sizeof(error)));
    CHECK(document.length == 6 && nova_document_dirty(&document));
    editor.anchor = editor.cursor = document.length;
    CHECK(!nova_ui_text_insert(&editor, &document, "x", 65, error, sizeof(error)));
    CHECK(document.length == 6 && !memcmp(document.text, "a\xc3\xa9" "c\r\n", 6));
    editor.cursor = document.length + 1;
    CHECK(!nova_ui_text_insert(&editor, &document, "x", 1, error, sizeof(error)));
    nova_ui_text_reset(&editor);
    CHECK(!nova_ui_text_undo(&editor, &document, error, sizeof(error)));
    nova_document_close(&document);
    char path[4096];
    snprintf(path, sizeof(path), "%s/source.lua", root);
    CHECK(!unlink(path) && !rmdir(root));
    puts("NOVA_TEXT selection=UTF8 undo-redo=one-step CRLF=preserved budget=guarded status=ok");
    return 0;
}
