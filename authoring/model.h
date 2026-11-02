#ifndef NOVA_AUTHORING_MODEL_H
#define NOVA_AUTHORING_MODEL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define NOVA_MODEL_PRIMITIVES 64
#define NOVA_MODEL_SIDES 32
#define NOVA_MODEL_DOCUMENT_BYTES 32768
#define NOVA_MODEL_GLB_BYTES (16 * 1024 * 1024)
#define NOVA_MODEL_MATERIALS 16
#define NOVA_MODEL_TEXTURE_PATH 256

typedef enum { NOVA_SHAPE_BOX, NOVA_SHAPE_PYRAMID, NOVA_SHAPE_CYLINDER } NovaModelShape;
typedef struct {
    uint32_t id;
    NovaModelShape shape;
    unsigned sides;
    float position[3], rotation[3], scale[3];
    unsigned char color[3];
    char name[32];
    unsigned texture; /* 0 is plain color; otherwise declaration index + 1. */
} NovaModelPrimitive;
typedef struct {
    uint32_t next_id;
    size_t count;
    NovaModelPrimitive primitives[NOVA_MODEL_PRIMITIVES];
    size_t texture_count;
    char textures[NOVA_MODEL_MATERIALS][NOVA_MODEL_TEXTURE_PATH];
} NovaModelDocument;

void nova_model_init(NovaModelDocument *document);
bool nova_model_add(NovaModelDocument *document, NovaModelShape shape,
    char *error, size_t error_size);
bool nova_model_validate(const NovaModelDocument *document, char *error, size_t error_size);
bool nova_model_parse(const unsigned char *bytes, size_t length, NovaModelDocument *document,
    char *error, size_t error_size);
/* Successful byte outputs are malloc-owned; failures leave outputs unchanged. */
bool nova_model_serialize(const NovaModelDocument *document, unsigned char **bytes, size_t *length,
    char *error, size_t error_size);
bool nova_model_glb(const NovaModelDocument *document, unsigned char **bytes, size_t *length,
    char *error, size_t error_size);
bool nova_model_glb_at(const NovaModelDocument *document, const char *root,
    unsigned char **bytes, size_t *length, char *error, size_t error_size);

#endif
