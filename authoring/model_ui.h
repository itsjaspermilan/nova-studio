#ifndef NOVA_MODEL_UI_H
#define NOVA_MODEL_UI_H

#include "model_view.h"
#include "widgets.h"

typedef enum {
    NOVA_MODEL_DECISION_NONE, NOVA_MODEL_DECISION_EXIT, NOVA_MODEL_DECISION_OPEN,
    NOVA_MODEL_DECISION_SAVE_CONFLICT, NOVA_MODEL_DECISION_EXPORT,
    NOVA_MODEL_DECISION_EXPORT_CONFLICT
} NovaModelDecision;

typedef struct {
    bool active, ready, refresh, save, export_glb, overwrite, close, reopen, exported;
    bool source_focus, field_focus[13], stale, values_dirty, view_attempted;
    NovaModelDecision summarized_decision;
    char disk_summary[256];
    bool review_disk;
    bool check_export;
    NovaTextEditor disk_editor;
    size_t selected;
    int scroll;
    char manifest[NOVA_NATIVE_PATH_CAPACITY], source_path[NOVA_PROJECT_PATH_CAPACITY];
    char fields[13][32], message[1024];
    NovaModelDocument model;
    NovaDocument source, target;
    NovaModelView view;
    NovaModelDecision decision;
    NovaAssetInspection exported_asset;
    bool inspected_export;
} NovaModelUI;

bool nova_model_ui_open(NovaModelUI *ui, const char *manifest, const char *root,
    const char *model_path, char *error, size_t error_size);
/* IO/GPU staging runs outside drawing; widgets only queue work or change drafts. */
void nova_model_ui_update(NovaModelUI *ui);
void nova_model_ui_draw(NovaModelUI *ui, Rectangle preview);
void nova_model_ui_request_close(NovaModelUI *ui);
void nova_model_ui_close(NovaModelUI *ui);
bool nova_model_ui_apply(NovaModelUI *ui, const NovaModelDocument *candidate);

#endif
