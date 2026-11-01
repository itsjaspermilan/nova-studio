#include <raylib.h>
#include <stdio.h>
#include <string.h>

static int fixture_pixels(Image image, const char *kind)
{
    if (!strcmp(kind, "sprites")) {
        Color token = GetImageColor(image, 272, 272);
        Color alias = GetImageColor(image, 672, 272);
        Color transparent = GetImageColor(image, 240, 240);
        Color tile = GetImageColor(image, 30, 0);
        if (token.r != 255 || token.g != 170 || token.b != 68 ||
            alias.r != token.r || alias.g != token.g || alias.b != token.b ||
            transparent.r != 55 || transparent.g != 83 || transparent.b != 112 ||
            tile.r != 34 || tile.g != 52 || tile.b != 78) {
            fprintf(stderr, "Sprite-only native capture pixel mismatch\n");
            return 1;
        }
        puts("Native RGB tile, RGBA token/alias and transparency verified.");
        return 0;
    }
    if (strcmp(kind, "static")) return 2;
    int cube = 0, pyramid = 0;
    for (int y = 100; y < 500; ++y) {
        for (int x = 50; x < 950; ++x) {
            Color c = GetImageColor(image, x, y);
            if (c.r == 63 && c.g == 127 && c.b == 255) cube++;
            if (c.r == 255 && c.g == 127 && c.b == 63) pyramid++;
        }
    }
    if (cube < 1000 || pyramid < 1000) {
        fprintf(stderr, "Static primitive native capture mismatch: cube=%d pyramid=%d\n", cube, pyramid);
        return 1;
    }
    printf("Native instanced primitive colors verified (%d cube, %d pyramid pixels).\n", cube, pyramid);
    return 0;
}

int main(int argc, char **argv)
{
    if (argc != 2 && argc != 3) return 2;
    Image image = LoadImage(argv[1]);
    if (!IsImageValid(image) || image.width != 960 || image.height != 540) {
        fprintf(stderr, "Missing or invalid native project capture\n");
        UnloadImage(image);
        return 1;
    }
    if (argc == 3) {
        int result = fixture_pixels(image, argv[2]);
        UnloadImage(image);
        return result;
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
