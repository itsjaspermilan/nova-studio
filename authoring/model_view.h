#ifndef NOVA_MODEL_VIEW_H
#define NOVA_MODEL_VIEW_H

#include "document.h"
#include "model.h"
#include "presentation.h"

typedef struct {
    char directory[NOVA_NATIVE_PATH_CAPACITY];
    char source_root[NOVA_NATIVE_PATH_CAPACITY];
    NovaDocument output;
    NovaEngine *engine;
    NovaResources resources;
    NovaPresentation presentation;
    NovaFrame frame;
    size_t revisions;
} NovaModelView;

bool nova_model_view_open(NovaModelView *view, char *error, size_t error_size);
/* Stage only on model edits. Failed native import/upload retains the live view. */
bool nova_model_view_stage(NovaModelView *view, const NovaModelDocument *model,
    char *error, size_t error_size);
void nova_model_view_close(NovaModelView *view);

#endif
