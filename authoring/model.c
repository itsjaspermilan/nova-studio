#include "model.h"
#include "assets.h"

#include <errno.h>
#include <float.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

_Static_assert(sizeof(float) == 4 && FLT_RADIX == 2 && FLT_MANT_DIG == 24,
    "GLB export requires IEEE-754 float32");

static bool invalid(char *error, size_t size, const char *message)
{
    if (error && size) snprintf(error, size, "%s", message);
    return false;
}

void nova_model_init(NovaModelDocument *document)
{
    *document = (NovaModelDocument){.next_id = 1};
}

bool nova_model_validate(const NovaModelDocument *d, char *error, size_t size)
{
    if (!d || !d->next_id || d->count > NOVA_MODEL_PRIMITIVES)
        return invalid(error, size, "model requires a next ID and at most 64 primitives");
    for (size_t i = 0; i < d->count; ++i) {
        const NovaModelPrimitive *p = &d->primitives[i];
        if (!p->id || p->id >= d->next_id || p->shape < NOVA_SHAPE_BOX ||
            p->shape > NOVA_SHAPE_CYLINDER || (p->shape == NOVA_SHAPE_CYLINDER ?
                p->sides < 3 || p->sides > NOVA_MODEL_SIDES : p->sides != 0))
            return invalid(error, size, "invalid primitive ID, shape or cylinder sides (3..32)");
        for (size_t j = 0; j < i; ++j)
            if (d->primitives[j].id == p->id) return invalid(error, size, "duplicate primitive ID");
        for (int a = 0; a < 3; ++a) {
            if (!isfinite(p->position[a]) || fabsf(p->position[a]) > 10000 ||
                !isfinite(p->rotation[a]) || fabsf(p->rotation[a]) > 360 ||
                !isfinite(p->scale[a]) || p->scale[a] < 0.01f || p->scale[a] > 1000)
                return invalid(error, size, "transforms require position +/-10000, degrees +/-360, scale 0.01..1000");
        }
    }
    return true;
}

bool nova_model_add(NovaModelDocument *d, NovaModelShape shape, char *error, size_t size)
{
    if (!nova_model_validate(d, error, size)) return false;
    if (d->count == NOVA_MODEL_PRIMITIVES || d->next_id == UINT32_MAX ||
        shape < NOVA_SHAPE_BOX || shape > NOVA_SHAPE_CYLINDER)
        return invalid(error, size, "primitive count/ID exhausted or invalid shape");
    d->primitives[d->count++] = (NovaModelPrimitive){.id = d->next_id++, .shape = shape,
        .sides = shape == NOVA_SHAPE_CYLINDER ? 8 : 0,
        .scale = {1, 1, 1}, .color = {80, 190, 230}};
    return true;
}

static const char *shape_name(NovaModelShape shape)
{
    return shape == NOVA_SHAPE_BOX ? "box" : shape == NOVA_SHAPE_PYRAMID ? "pyramid" : "cylinder";
}

typedef struct { char *data; size_t used, capacity; bool failed; } Text;
static void append(Text *text, const char *format, ...)
{
    if (text->failed) return;
    va_list args;
    va_start(args, format);
    int n = vsnprintf(text->data + text->used, text->capacity - text->used, format, args);
    va_end(args);
    if (n < 0 || (size_t)n >= text->capacity - text->used) text->failed = true;
    else text->used += (size_t)n;
}

bool nova_model_serialize(const NovaModelDocument *d, unsigned char **bytes, size_t *length,
    char *error, size_t size)
{
    if (!nova_model_validate(d, error, size)) return false;
    Text text = {.data = malloc(NOVA_MODEL_DOCUMENT_BYTES), .capacity = NOVA_MODEL_DOCUMENT_BYTES};
    if (!text.data) return invalid(error, size, "cannot allocate model document");
    append(&text, "nova-model 1\nnext %u\n", d->next_id);
    for (size_t i = 0; i < d->count; ++i) {
        const NovaModelPrimitive *p = &d->primitives[i];
        append(&text, "primitive %u %s %u", p->id, shape_name(p->shape), p->sides);
        for (int a = 0; a < 3; ++a) append(&text, " %.9g", (double)p->position[a]);
        for (int a = 0; a < 3; ++a) append(&text, " %.9g", (double)p->rotation[a]);
        for (int a = 0; a < 3; ++a) append(&text, " %.9g", (double)p->scale[a]);
        append(&text, " %u %u %u\n", p->color[0], p->color[1], p->color[2]);
    }
    if (text.failed) { free(text.data); return invalid(error, size, "model document byte limit exceeded"); }
    *bytes = (unsigned char *)text.data; *length = text.used;
    return true;
}

static bool integer(const char *token, uint32_t *value)
{
    if (!*token) return false;
    uint32_t n = 0;
    for (; *token; ++token) {
        if (*token < '0' || *token > '9' || n > (UINT32_MAX - (unsigned)(*token - '0')) / 10) return false;
        n = n * 10 + (unsigned)(*token - '0');
    }
    *value = n;
    return true;
}

static bool number(const char *token, float *value)
{
    for (const char *c = token; *c; ++c)
        if (!strchr("0123456789.eE+-", *c)) return false;
    char *end;
    errno = 0;
    float n = strtof(token, &end);
    if (end == token || *end || (errno && !(errno == ERANGE && n != 0)) || !isfinite(n)) return false;
    *value = n;
    return true;
}

bool nova_model_parse(const unsigned char *bytes, size_t length, NovaModelDocument *document,
    char *error, size_t size)
{
    if (!bytes || !length || length >= NOVA_MODEL_DOCUMENT_BYTES)
        return invalid(error, size, "model document requires 1..32767 ASCII bytes");
    for (size_t i = 0; i < length; ++i)
        if ((bytes[i] < 32 && bytes[i] != '\n' && bytes[i] != '\r' && bytes[i] != '\t') || bytes[i] > 126)
            return invalid(error, size, "model document contains non-ASCII/control bytes");
    char *copy = malloc(length + 1);
    if (!copy) return invalid(error, size, "cannot allocate document parser");
    memcpy(copy, bytes, length); copy[length] = 0;
    NovaModelDocument candidate = {0};
    unsigned directive = 0, line = 0;
    bool valid = true;
    char *cursor = copy;
    while (*cursor && valid) {
        char *start = cursor;
        while (*cursor && *cursor != '\n') ++cursor;
        if (*cursor) *cursor++ = 0;
        ++line;
        char *tokens[17], *save = NULL;
        size_t count = 0;
        for (char *t = strtok_r(start, " \t\r", &save); t; t = strtok_r(NULL, " \t\r", &save)) {
            if (count == 17) { valid = false; break; }
            tokens[count++] = t;
        }
        if (!count) continue;
        if (directive == 0) valid = count == 2 && !strcmp(tokens[0], "nova-model") && !strcmp(tokens[1], "1");
        else if (directive == 1) valid = count == 2 && !strcmp(tokens[0], "next") &&
            integer(tokens[1], &candidate.next_id);
        else {
            valid = count == 16 && !strcmp(tokens[0], "primitive") && candidate.count < NOVA_MODEL_PRIMITIVES;
            if (valid) {
                NovaModelPrimitive *p = &candidate.primitives[candidate.count++];
                uint32_t sides, color;
                valid = integer(tokens[1], &p->id) && integer(tokens[3], &sides);
                p->sides = valid ? sides : 0;
                if (!strcmp(tokens[2], "box")) p->shape = NOVA_SHAPE_BOX;
                else if (!strcmp(tokens[2], "pyramid")) p->shape = NOVA_SHAPE_PYRAMID;
                else if (!strcmp(tokens[2], "cylinder")) p->shape = NOVA_SHAPE_CYLINDER;
                else valid = false;
                for (int a = 0; a < 3 && valid; ++a)
                    valid = number(tokens[4 + a], &p->position[a]) && number(tokens[7 + a], &p->rotation[a]) &&
                        number(tokens[10 + a], &p->scale[a]);
                for (int a = 0; a < 3 && valid; ++a) {
                    valid = integer(tokens[13 + a], &color) && color <= 255;
                    if (valid) p->color[a] = (unsigned char)color;
                }
            }
        }
        ++directive;
    }
    free(copy);
    if (!valid || directive < 2) {
        if (error && size) snprintf(error, size, "invalid nova-model 1 directive at line %u", line);
        return false;
    }
    if (!nova_model_validate(&candidate, error, size)) return false;
    *document = candidate;
    return true;
}

typedef struct {
    float vertices[12 * NOVA_MODEL_SIDES * 3];
    size_t count;
    float min[3], max[3];
} Geometry;

static void vertex(Geometry *g, const NovaModelPrimitive *p, const float point[3])
{
    float v[3] = {point[0] * p->scale[0], point[1] * p->scale[1], point[2] * p->scale[2]};
    /* Authored Euler rotations apply X, then Y, then Z in right-handed space. */
    const int first[] = {1, 2, 0}, second[] = {2, 0, 1};
    for (int a = 0; a < 3; ++a) {
        float angle = p->rotation[a] * 0.017453292519943295f;
        float c = cosf(angle), s = sinf(angle), x = v[first[a]], y = v[second[a]];
        v[first[a]] = c * x - s * y; v[second[a]] = s * x + c * y;
    }
    for (int a = 0; a < 3; ++a) {
        v[a] += p->position[a];
        if (!g->count || v[a] < g->min[a]) g->min[a] = v[a];
        if (!g->count || v[a] > g->max[a]) g->max[a] = v[a];
        g->vertices[g->count * 3 + (size_t)a] = v[a];
    }
    ++g->count;
}

static void triangle(Geometry *g, const NovaModelPrimitive *p, const float a[3], const float b[3], const float c[3])
{
    vertex(g, p, a); vertex(g, p, b); vertex(g, p, c);
}

static Geometry geometry(const NovaModelPrimitive *p)
{
    Geometry g = {0};
    const float corners[8][3] = {
        {-.5f,-.5f,-.5f},{.5f,-.5f,-.5f},{.5f,-.5f,.5f},{-.5f,-.5f,.5f},
        {-.5f,.5f,-.5f},{.5f,.5f,-.5f},{.5f,.5f,.5f},{-.5f,.5f,.5f}};
    if (p->shape == NOVA_SHAPE_BOX) {
        const unsigned faces[12][3] = {{0,1,2},{0,2,3},{4,7,6},{4,6,5},
            {0,4,5},{0,5,1},{1,5,6},{1,6,2},{2,6,7},{2,7,3},{3,7,4},{3,4,0}};
        for (size_t i = 0; i < 12; ++i)
            triangle(&g, p, corners[faces[i][0]], corners[faces[i][1]], corners[faces[i][2]]);
    } else if (p->shape == NOVA_SHAPE_PYRAMID) {
        const float top[3] = {0,.5f,0};
        triangle(&g, p, corners[0], corners[1], corners[2]);
        triangle(&g, p, corners[0], corners[2], corners[3]);
        for (unsigned i = 0; i < 4; ++i) triangle(&g, p, corners[i], top, corners[(i + 1) % 4]);
    } else {
        const float bottom[3] = {0,-.5f,0}, top[3] = {0,.5f,0};
        for (unsigned i = 0; i < p->sides; ++i) {
            float a = (float)i * 6.283185307179586f / (float)p->sides;
            float b = (float)(i + 1) * 6.283185307179586f / (float)p->sides;
            float lo[3] = {.5f*cosf(a),-.5f,.5f*sinf(a)}, hi[3] = {lo[0],.5f,lo[2]};
            float nextlo[3] = {.5f*cosf(b),-.5f,.5f*sinf(b)}, nexthi[3] = {nextlo[0],.5f,nextlo[2]};
            triangle(&g,p,bottom,lo,nextlo); triangle(&g,p,top,nexthi,hi);
            triangle(&g,p,lo,hi,nexthi); triangle(&g,p,lo,nexthi,nextlo);
        }
    }
    return g;
}

static void put32(unsigned char *bytes, uint32_t value)
{
    for (int i = 0; i < 4; ++i) bytes[i] = (unsigned char)(value >> (i * 8));
}

static double color_factor(unsigned char channel)
{
    float factor = (float)channel / 255.0f;
    /* Native import truncates factor*255; select the adjacent float when needed. */
    if ((unsigned)(factor * 255.0f) < channel) factor = nextafterf(factor, 1.0f);
    return factor;
}

bool nova_model_glb(const NovaModelDocument *d, unsigned char **bytes, size_t *length,
    char *error, size_t size)
{
    if (!nova_model_validate(d, error, size)) return false;
    if (!d->count) return invalid(error, size, "add a primitive before GLB export");
    Text json = {.data = malloc(131072), .capacity = 131072};
    unsigned char *binary = malloc(294912);
    if (!json.data || !binary) {
        free(json.data); free(binary); return invalid(error, size, "cannot allocate GLB export");
    }
    size_t offset[NOVA_MODEL_PRIMITIVES], counts[NOVA_MODEL_PRIMITIVES], used = 0;
    float bounds[NOVA_MODEL_PRIMITIVES][6];
    for (size_t i = 0; i < d->count; ++i) {
        Geometry g = geometry(&d->primitives[i]);
        offset[i] = used; counts[i] = g.count;
        memcpy(bounds[i], g.min, sizeof(g.min)); memcpy(bounds[i] + 3, g.max, sizeof(g.max));
        for (size_t j = 0; j < g.count * 3; ++j) {
            uint32_t bits; memcpy(&bits, &g.vertices[j], sizeof(bits));
            put32(binary + used, bits); used += 4;
        }
    }
    append(&json, "{\"asset\":{\"version\":\"2.0\",\"generator\":\"Nova original static modeller\"},"
        "\"extensionsUsed\":[\"KHR_materials_unlit\"],\"extensionsRequired\":[\"KHR_materials_unlit\"],"
        "\"buffers\":[{\"byteLength\":%zu}],\"bufferViews\":[", used);
    for (size_t i = 0; i < d->count; ++i)
        append(&json, "%s{\"buffer\":0,\"byteOffset\":%zu,\"byteLength\":%zu}", i ? "," : "", offset[i], counts[i]*12);
    append(&json, "],\"accessors\":[");
    for (size_t i = 0; i < d->count; ++i)
        append(&json, "%s{\"bufferView\":%zu,\"componentType\":5126,\"count\":%zu,\"type\":\"VEC3\","
            "\"min\":[%.9g,%.9g,%.9g],\"max\":[%.9g,%.9g,%.9g]}", i ? "," : "", i, counts[i],
            (double)bounds[i][0], (double)bounds[i][1], (double)bounds[i][2],
            (double)bounds[i][3], (double)bounds[i][4], (double)bounds[i][5]);
    append(&json, "],\"materials\":[");
    for (size_t i = 0; i < d->count; ++i) {
        const unsigned char *c = d->primitives[i].color;
        append(&json, "%s{\"extensions\":{\"KHR_materials_unlit\":{}},\"pbrMetallicRoughness\":"
            "{\"baseColorFactor\":[%.9g,%.9g,%.9g,1]}}", i ? "," : "",
            color_factor(c[0]), color_factor(c[1]), color_factor(c[2]));
    }
    append(&json, "],\"meshes\":[");
    for (size_t i = 0; i < d->count; ++i)
        append(&json, "%s{\"primitives\":[{\"attributes\":{\"POSITION\":%zu},\"material\":%zu,\"mode\":4}]}",
            i ? "," : "", i, i);
    append(&json, "],\"nodes\":[");
    for (size_t i = 0; i < d->count; ++i)
        append(&json, "%s{\"mesh\":%zu,\"name\":\"primitive-%u\"}", i ? "," : "", i, d->primitives[i].id);
    append(&json, "],\"scenes\":[{\"nodes\":[");
    for (size_t i = 0; i < d->count; ++i) append(&json, "%s%zu", i ? "," : "", i);
    append(&json, "]}],\"scene\":0}");
    size_t padded = (json.used + 3) & ~(size_t)3, total = 28 + padded + used;
    if (json.failed || total > NOVA_MODEL_GLB_BYTES) {
        free(json.data); free(binary); return invalid(error, size, "GLB byte budget exceeded");
    }
    unsigned char *result = calloc(total, 1);
    if (!result) { free(json.data); free(binary); return invalid(error, size, "cannot allocate GLB container"); }
    memcpy(result, "glTF", 4); put32(result + 4, 2); put32(result + 8, (uint32_t)total);
    put32(result + 12, (uint32_t)padded); memcpy(result + 16, "JSON", 4);
    memset(result + 20, ' ', padded); memcpy(result + 20, json.data, json.used);
    put32(result + 20 + padded, (uint32_t)used); memcpy(result + 24 + padded, "BIN", 3);
    memcpy(result + 28 + padded, binary, used); free(json.data); free(binary);
    Model model = {0};
    if (!nova_decode_glb(result, (int)total, &model, error, size)) { free(result); return false; }
    for (int i = 0; i < model.meshCount; ++i) {
        MemFree(model.meshes[i].vertices); MemFree(model.meshes[i].colors);
    }
    MemFree(model.meshes); MemFree(model.materials); MemFree(model.meshMaterial);
    *bytes = result; *length = total;
    return true;
}
