#include "model.h"
#include "transform.h"
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

static bool part_name(const char *name)
{
    size_t n = strnlen(name, 32);
    if (!n || n == 32) return false;
    for (size_t i = 0; i < n; ++i)
        if (!strchr("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_", name[i])) return false;
    return true;
}

bool nova_model_validate(const NovaModelDocument *d, char *error, size_t size)
{
    if (!d || !d->next_id || d->count > NOVA_MODEL_PRIMITIVES || d->texture_count > NOVA_MODEL_MATERIALS)
        return invalid(error, size, "model requires a next ID and at most 64 primitives");
    for (size_t i = 0; i < d->texture_count; ++i) {
        if (strnlen(d->textures[i], NOVA_MODEL_TEXTURE_PATH) == NOVA_MODEL_TEXTURE_PATH ||
            !nova_project_relative_path(d->textures[i]) || strpbrk(d->textures[i], " \t\r\n") ||
            !IsFileExtension(d->textures[i], ".png"))
            return invalid(error, size, "textures require contained project-relative .png paths");
        for (size_t j = 0; j < i; ++j) if (!strcmp(d->textures[i], d->textures[j]))
            return invalid(error, size, "duplicate texture declaration");
    }
    for (size_t i = 0; i < d->count; ++i) {
        const NovaModelPrimitive *p = &d->primitives[i];
        if (!part_name(p->name) || p->texture > d->texture_count)
            return invalid(error, size, "part requires a 1..31 ASCII letter/digit/underscore name and declared texture");
        for (size_t j = 0; j < i; ++j) if (!strcmp(p->name, d->primitives[j].name))
            return invalid(error, size, "part names must be unique");
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
    char name[32]; snprintf(name,sizeof(name),"Part_%u",d->next_id);
    for (size_t i = 0; i < d->count; ++i) if (!strcmp(name,d->primitives[i].name))
        return invalid(error,size,"default part name already used; rename that part before adding another");
    d->primitives[d->count++] = (NovaModelPrimitive){.id = d->next_id++, .shape = shape,
        .sides = shape == NOVA_SHAPE_CYLINDER ? 8 : 0,
        .scale = {1, 1, 1}, .color = {80, 190, 230}};
    strcpy(d->primitives[d->count-1].name,name);
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
    append(&text, "nova-model 2\nnext %u\n", d->next_id);
    for (size_t i = 0; i < d->texture_count; ++i) append(&text, "texture %zu %s\n", i+1, d->textures[i]);
    for (size_t i = 0; i < d->count; ++i) {
        const NovaModelPrimitive *p = &d->primitives[i];
        append(&text, "primitive %u %s %u", p->id, shape_name(p->shape), p->sides);
        for (int a = 0; a < 3; ++a) append(&text, " %.9g", (double)p->position[a]);
        for (int a = 0; a < 3; ++a) append(&text, " %.9g", (double)p->rotation[a]);
        for (int a = 0; a < 3; ++a) append(&text, " %.9g", (double)p->scale[a]);
        append(&text, " %u %u %u %s %u\n", p->color[0], p->color[1], p->color[2], p->name, p->texture);
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
    unsigned directive = 0, line = 0, version = 0;
    bool parts = false;
    bool valid = true;
    char *cursor = copy;
    while (*cursor && valid) {
        char *start = cursor;
        while (*cursor && *cursor != '\n') ++cursor;
        if (*cursor) *cursor++ = 0;
        ++line;
        char *tokens[19], *save = NULL;
        size_t count = 0;
        for (char *t = strtok_r(start, " \t\r", &save); t; t = strtok_r(NULL, " \t\r", &save)) {
            if (count == 19) { valid = false; break; }
            tokens[count++] = t;
        }
        if (!count) continue;
        if (directive == 0) {
            valid = count == 2 && !strcmp(tokens[0], "nova-model") &&
                (!strcmp(tokens[1], "1") || !strcmp(tokens[1], "2"));
            if (valid) version = (unsigned)(tokens[1][0]-'0');
        }
        else if (directive == 1) valid = count == 2 && !strcmp(tokens[0], "next") &&
            integer(tokens[1], &candidate.next_id);
        else if (version == 2 && !strcmp(tokens[0], "texture")) {
            uint32_t index;
            valid = !parts && count == 3 && candidate.texture_count < NOVA_MODEL_MATERIALS &&
                integer(tokens[1], &index) && index == candidate.texture_count+1 &&
                strlen(tokens[2]) < NOVA_MODEL_TEXTURE_PATH;
            if (valid) strcpy(candidate.textures[candidate.texture_count++], tokens[2]);
        } else {
            parts = true;
            valid = count == (version == 1 ? 16u : 18u) && !strcmp(tokens[0], "primitive") && candidate.count < NOVA_MODEL_PRIMITIVES;
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
                if (version == 1) snprintf(p->name, sizeof(p->name), "Part_%u", p->id);
                else if (valid) {
                    uint32_t texture;
                    valid = strlen(tokens[16]) < sizeof(p->name) && integer(tokens[17], &texture);
                    if (valid) { strcpy(p->name, tokens[16]); p->texture = texture; }
                }
            }
        }
        ++directive;
    }
    free(copy);
    if (!valid || directive < 2) {
        if (error && size) snprintf(error, size, "invalid nova-model 1/2 directive at line %u", line);
        return false;
    }
    if (!nova_model_validate(&candidate, error, size)) return false;
    *document = candidate;
    return true;
}

typedef struct {
    float vertices[12 * NOVA_MODEL_SIDES * 3];
    float uv[12 * NOVA_MODEL_SIDES * 2];
    size_t count;
    float min[3], max[3];
} Geometry;

static void vertex(Geometry *g, const NovaModelPrimitive *p, const float point[3])
{
    NovaVec3 transformed = nova_transform_point((NovaVec3){point[0], point[1], point[2]},
        (NovaVec3){p->position[0], p->position[1], p->position[2]},
        (NovaVec3){p->scale[0], p->scale[1], p->scale[2]},
        (NovaVec3){p->rotation[0], p->rotation[1], p->rotation[2]});
    const float v[] = {transformed.x, transformed.y, transformed.z};
    for (int a = 0; a < 3; ++a) {
        if (!g->count || v[a] < g->min[a]) g->min[a] = v[a];
        if (!g->count || v[a] > g->max[a]) g->max[a] = v[a];
        g->vertices[g->count * 3 + (size_t)a] = v[a];
    }
    ++g->count;
}

static void triangle(Geometry *g, const NovaModelPrimitive *p, const float a[3], const float b[3], const float c[3])
{
    float u[3], v[3];
    for (int i = 0; i < 3; ++i) { u[i] = b[i]-a[i]; v[i] = c[i]-a[i]; }
    float n[3] = {u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]};
    const float *points[] = {a,b,c};
    int axis = fabsf(n[0]) > fabsf(n[1]) ? 0 : 1;
    if (fabsf(n[2]) > fabsf(n[axis])) axis = 2;
    float angles[3] = {0};
    bool cylinder_side = p->shape == NOVA_SHAPE_CYLINDER && axis != 1;
    if (cylinder_side) {
        for (int i = 0; i < 3; ++i) {
            angles[i] = atan2f(points[i][2],points[i][0])/6.283185307179586f;
            if (angles[i] < 0) angles[i] += 1;
        }
        float low = fminf(angles[0],fminf(angles[1],angles[2]));
        float high = fmaxf(angles[0],fmaxf(angles[1],angles[2]));
        if (high-low > .5f) for (int i = 0; i < 3; ++i) if (angles[i] < .5f) angles[i] = 1;
    }
    for (int i = 0; i < 3; ++i) {
        size_t index = (g->count+(size_t)i)*2;
        g->uv[index] = cylinder_side ? angles[i] : points[i][axis == 0 ? 2 : 0]+.5f;
        g->uv[index+1] = axis == 1 ? points[i][2]+.5f : .5f-points[i][1];
    }
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
    return nova_model_glb_at(d, NULL, bytes, length, error, size);
}

bool nova_model_glb_at(const NovaModelDocument *d, const char *root, unsigned char **bytes, size_t *length,
    char *error, size_t size)
{
    if (!nova_model_validate(d, error, size)) return false;
    if (!d->count) return invalid(error, size, "add a primitive before GLB export");
    Text json = {.data = malloc(131072), .capacity = 131072};
    unsigned char *binary = calloc(NOVA_MODEL_GLB_BYTES, 1);
    if (!json.data || !binary) {
        free(json.data); free(binary); return invalid(error, size, "cannot allocate GLB export");
    }
    size_t offset[NOVA_MODEL_PRIMITIVES], uv_offset[NOVA_MODEL_PRIMITIVES], counts[NOVA_MODEL_PRIMITIVES], used = 0;
    size_t image_offset[NOVA_MODEL_MATERIALS], image_length[NOVA_MODEL_MATERIALS], pixels = 0;
    float bounds[NOVA_MODEL_PRIMITIVES][6];
    for (size_t i = 0; i < d->count; ++i) {
        Geometry g = geometry(&d->primitives[i]);
        offset[i] = used; counts[i] = g.count;
        memcpy(bounds[i], g.min, sizeof(g.min)); memcpy(bounds[i] + 3, g.max, sizeof(g.max));
        for (size_t j = 0; j < g.count * 3; ++j) {
            uint32_t bits; memcpy(&bits, &g.vertices[j], sizeof(bits));
            put32(binary + used, bits); used += 4;
        }
        uv_offset[i] = used;
        for (size_t j = 0; j < g.count * 2; ++j) {
            uint32_t bits; memcpy(&bits, &g.uv[j], sizeof(bits));
            put32(binary + used, bits); used += 4;
        }
    }
    for (size_t i = 0; i < d->texture_count; ++i) {
        char path[NOVA_NATIVE_PATH_CAPACITY];
        int n = 0;
        Image image = {0};
        unsigned char *png = NULL;
        bool ok = root && nova_project_resolve(root,d->textures[i],path,error,size);
        if (!root) invalid(error,size,"textured export requires the actual project root");
        if (ok) png = nova_read_file(path,NOVA_MODEL_TEXTURE_BYTES,&n,error,size);
        if (ok) ok = png && nova_decode_model_png(png,n,&image,error,size);
        if (ok) pixels += (size_t)image.width*(size_t)image.height;
        if (image.data) UnloadImage(image);
        if (ok && (pixels > NOVA_MODEL_TEXTURE_PIXELS || used+(size_t)n+4 > NOVA_MODEL_GLB_BYTES))
            ok = invalid(error,size,"model exceeds texture pixel/GLB byte budget");
        if (!ok) { UnloadFileData(png); free(binary); free(json.data); return false; }
        image_offset[i] = used; image_length[i] = (size_t)n;
        memcpy(binary+used,png,(size_t)n); used = (used+(size_t)n+3)&~(size_t)3;
        UnloadFileData(png);
    }
    append(&json, "{\"asset\":{\"version\":\"2.0\",\"generator\":\"Nova original static modeller\"},"
        "\"extensionsUsed\":[\"KHR_materials_unlit\"],\"extensionsRequired\":[\"KHR_materials_unlit\"],"
        "\"buffers\":[{\"byteLength\":%zu}],\"bufferViews\":[", used);
    for (size_t i = 0; i < d->count; ++i)
        append(&json, "%s{\"buffer\":0,\"byteOffset\":%zu,\"byteLength\":%zu},"
            "{\"buffer\":0,\"byteOffset\":%zu,\"byteLength\":%zu}",
            i ? "," : "", offset[i], counts[i]*12, uv_offset[i], counts[i]*8);
    for (size_t i = 0; i < d->texture_count; ++i)
        append(&json,",{\"buffer\":0,\"byteOffset\":%zu,\"byteLength\":%zu}",image_offset[i],image_length[i]);
    append(&json, "],\"accessors\":[");
    for (size_t i = 0; i < d->count; ++i)
        append(&json, "%s{\"bufferView\":%zu,\"componentType\":5126,\"count\":%zu,\"type\":\"VEC3\","
            "\"min\":[%.9g,%.9g,%.9g],\"max\":[%.9g,%.9g,%.9g]},"
            "{\"bufferView\":%zu,\"componentType\":5126,\"count\":%zu,\"type\":\"VEC2\"}", i ? "," : "", i*2, counts[i],
            (double)bounds[i][0], (double)bounds[i][1], (double)bounds[i][2],
            (double)bounds[i][3], (double)bounds[i][4], (double)bounds[i][5], i*2+1, counts[i]);
    if (d->texture_count) {
        append(&json,"],\"samplers\":[{\"magFilter\":9728,\"minFilter\":9728,\"wrapS\":33071,\"wrapT\":33071}],\"images\":[");
        for (size_t i = 0; i < d->texture_count; ++i)
            append(&json,"%s{\"bufferView\":%zu,\"mimeType\":\"image/png\"}",i ? "," : "",d->count*2+i);
        append(&json,"],\"textures\":[");
        for (size_t i = 0; i < d->texture_count; ++i)
            append(&json,"%s{\"sampler\":0,\"source\":%zu}",i ? "," : "",i);
    }
    append(&json, "],\"materials\":[");
    for (size_t i = 0; i < d->count; ++i) {
        const unsigned char *c = d->primitives[i].color;
        append(&json, "%s{\"extensions\":{\"KHR_materials_unlit\":{}},\"pbrMetallicRoughness\":"
            "{\"baseColorFactor\":[%.9g,%.9g,%.9g,1]", i ? "," : "",
            color_factor(c[0]), color_factor(c[1]), color_factor(c[2]));
        if (d->primitives[i].texture) append(&json,",\"baseColorTexture\":{\"index\":%u}",d->primitives[i].texture-1);
        append(&json,"}}");
    }
    append(&json, "],\"meshes\":[");
    for (size_t i = 0; i < d->count; ++i)
        append(&json, "%s{\"primitives\":[{\"attributes\":{\"POSITION\":%zu,\"TEXCOORD_0\":%zu},\"material\":%zu,\"mode\":4}]}",
            i ? "," : "", i*2, i*2+1, i);
    append(&json, "],\"nodes\":[");
    for (size_t i = 0; i < d->count; ++i)
        append(&json, "%s{\"mesh\":%zu,\"name\":\"%s\"}", i ? "," : "", i, d->primitives[i].name);
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
    nova_unload_cpu_model(&model);
    *bytes = result; *length = total;
    return true;
}
