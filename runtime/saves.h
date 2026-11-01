#ifndef NOVA_SAVES_H
#define NOVA_SAVES_H

#include "nova.h"

#define NOVA_SAVE_KEY_LIMIT 32
#define NOVA_SAVE_ROOT_CAPACITY 4096

typedef struct {
    char base[NOVA_SAVE_ROOT_CAPACITY];
    char identity[NOVA_ASSET_ID_CAPACITY * 2];
    unsigned temporary;
} NovaSaveStore;

/* base is an existing trusted OS app-data directory, never a Lua-supplied path. */
bool nova_save_store_init(NovaSaveStore *store, const char *base, const char *identity,
    char *error, size_t error_size);
bool nova_save_read(void *context, const char *key, unsigned char *data, size_t *length,
    bool *found, char *error, size_t error_size);
bool nova_save_write(NovaSaveStore *store, const char *key, const unsigned char *data,
    size_t length, char *error, size_t error_size);

#endif
