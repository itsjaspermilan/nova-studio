#include <raylib.h>
#include <stdio.h>

int main(int argc, char **argv)
{
    if (argc != 2) return 2;
    Image image = LoadImage(argv[1]);
    if (!IsImageValid(image) || image.width != 960 || image.height != 540) {
        fprintf(stderr, "Missing or invalid native project capture\n");
        UnloadImage(image);
        return 1;
    }
    Color sprite = GetImageColor(image, 72, 148);
    Color transparent = GetImageColor(image, 24, 100);
    int model_pixels = 0;
    for (int y = 120; y < 450; ++y) {
        for (int x = 150; x < 900; ++x) {
            Color c = GetImageColor(image, x, y);
            if (c.r == 77 && c.g == 224 && c.b == 200) model_pixels++;
        }
    }
    UnloadImage(image);
    if (sprite.r != 77 || sprite.g != 225 || sprite.b != 201 ||
        transparent.r != 18 || transparent.g != 24 || transparent.b != 41 ||
        model_pixels < 1000) {
        fprintf(stderr, "Native import capture mismatch: sprite=%u,%u,%u transparent=%u,%u,%u model_pixels=%d\n",
            sprite.r, sprite.g, sprite.b, transparent.r, transparent.g, transparent.b, model_pixels);
        return 1;
    }
    printf("Native PNG transparency and GLB base color verified (%d model pixels).\n", model_pixels);
    return 0;
}
