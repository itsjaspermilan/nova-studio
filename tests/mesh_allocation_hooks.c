#include <raylib.h>

#include <stdio.h>
#include <stdlib.h>

static void *buffers[2048], *images[256];
static unsigned allocated, released, loaded, unloaded, allocation_attempts, image_attempts;
static unsigned fail_allocation, fail_image;

static void check(int condition, const char *reason)
{
    if (!condition) {
        fprintf(stderr, "mesh native ownership: %s\n", reason);
        abort();
    }
}

static unsigned slot(void **entries, unsigned count, void *pointer)
{
    for (unsigned i = 0; i < count; ++i) if (entries[i] == pointer) return i;
    check(0, "missing owner or exhausted ownership table");
    return 0;
}

void *nova_mesh_test_alloc(unsigned int size)
{
    if (++allocation_attempts == fail_allocation) return NULL;
    void *result = MemAlloc(size);
    if (result) {
        buffers[slot(buffers, 2048, NULL)] = result;
        ++allocated;
    }
    return result;
}

void nova_mesh_test_free(void *pointer)
{
    if (pointer) {
        buffers[slot(buffers, 2048, pointer)] = NULL;
        ++released;
    }
    MemFree(pointer);
}

Image nova_mesh_test_load_image(const char *type, const unsigned char *data, int size)
{
    if (++image_attempts == fail_image) return (Image){0};
    Image result = LoadImageFromMemory(type, data, size);
    if (result.data) {
        images[slot(images, 256, NULL)] = result.data;
        ++loaded;
    }
    return result;
}

void nova_mesh_test_image_format(Image *image, int format)
{
    unsigned index = image->data ? slot(images, 256, image->data) : 0;
    void *previous = image->data;
    ImageFormat(image, format);
    if (previous) {
        images[index] = image->data;
        if (!image->data) ++unloaded;
    } else check(!image->data, "format conversion unexpectedly created an unowned image");
}

void nova_mesh_test_unload_image(Image image)
{
    if (image.data) {
        images[slot(images, 256, image.data)] = NULL;
        ++unloaded;
    }
    UnloadImage(image);
}

void nova_mesh_test_fail_after(unsigned allocations, unsigned image_loads)
{
    fail_allocation = allocations ? allocation_attempts + allocations : 0;
    fail_image = image_loads ? image_attempts + image_loads : 0;
}

void nova_mesh_test_balance(void)
{
    check(allocated == released, "native CPU model buffers leaked or were freed twice");
    check(loaded == unloaded, "native PNG images leaked or were freed twice");
    for (unsigned i = 0; i < 2048; ++i) check(!buffers[i], "a model allocation is still owned");
    for (unsigned i = 0; i < 256; ++i) check(!images[i], "an image allocation is still owned");
}

void nova_mesh_test_report(void)
{
    nova_mesh_test_balance();
    printf("Native mesh ownership: %u buffers and %u images acquired/released in balance.\n", allocated, loaded);
}
