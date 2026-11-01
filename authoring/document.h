#ifndef NOVA_DOCUMENT_H
#define NOVA_DOCUMENT_H

#include "inspect.h"
#include <sys/stat.h>

#define NOVA_SOURCE_EDIT_LIMIT (256 * 1024)

typedef struct {
    char *text;
    size_t length;
    struct stat info;
} NovaDiskText;

typedef struct {
    char root[NOVA_NATIVE_PATH_CAPACITY], relative[NOVA_PROJECT_PATH_CAPACITY];
    struct stat root_info;
    char *text;
    size_t length, limit;
    NovaDiskText saved, conflict;
    bool has_conflict, binary, allow_missing;
} NovaDocument;

typedef struct {
    char manifest[NOVA_NATIVE_PATH_CAPACITY];
    char source_error[1024];
    NovaDocument declaration, source;
} NovaAuthoringProject;

void nova_document_close(NovaDocument *document);
bool nova_document_open(NovaDocument *document, const char *root, const char *relative,
    size_t limit, char *error, size_t error_size);
/* Small shared export seam: explicit contained destination, including new files.
 * Binary drafts use lengths (not strlen) and must never enter the text widget. */
bool nova_document_open_output(NovaDocument *document, const char *root, const char *relative,
    size_t limit, bool binary, char *error, size_t error_size);
bool nova_document_dirty(const NovaDocument *document);
/* Refresh observed disk conflict without replacing the draft or saved snapshot. */
bool nova_document_check_disk(NovaDocument *document, char *error, size_t error_size);
bool nova_document_replace(NovaDocument *document, size_t start, size_t end,
    const char *text, size_t length, char *error, size_t error_size);
/* Overwrite consent applies only to the exact conflict snapshot currently displayed. */
bool nova_document_save(NovaDocument *document, bool overwrite_conflict,
    char *error, size_t error_size);
bool nova_document_reread(NovaDocument *document, char *error, size_t error_size);
void nova_authoring_close(NovaAuthoringProject *project);
/* Copy-on-success opening the manifest. Broken declarations/missing entry remain
 * editable and are reported through source_error; the source document is empty.
 * The caller must obtain a dirty-discard decision before opening another project. */
bool nova_authoring_open(NovaAuthoringProject *project, const char *manifest,
    char *error, size_t error_size);
/* Parse actual draft declarations; imported geometry is not editable document state. */
bool nova_authoring_parse(const NovaAuthoringProject *project, NovaProject *parsed,
    char *error, size_t error_size);
bool nova_authoring_property(NovaAuthoringProject *project, const char *directive,
    const char *id, const char *value, char *error, size_t error_size);

#endif
