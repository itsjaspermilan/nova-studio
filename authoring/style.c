#include "style.h"
#include <rlgl.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __APPLE__
#include <CoreText/CoreText.h>
#endif

#define NOVA_UI_FONT_SIZE 13
#define NOVA_UI_TEXT_CACHE 256
#define NOVA_UI_TEXT_BYTES (16u * 1024u * 1024u)

static const NovaUIStyle dark = {
    {30,30,30,255}, {38,38,38,255}, {22,22,22,255}, {58,58,60,255},
    {245,245,247,255}, {152,152,157,255}, {10,132,255,255},
    {58,58,60,255}, {72,72,74,255}, {72,72,74,255}, {30,30,30,255}, {10,132,255,70}
};
#ifdef __APPLE__
static const NovaUIStyle light = {
    {255,255,255,255}, {245,245,247,255}, {229,229,234,255}, {210,210,215,255},
    {29,29,31,255}, {110,110,115,255}, {0,122,255,255},
    {255,255,255,255}, {232,232,237,255}, {199,199,204,255}, {255,255,255,255}, {0,122,255,60}
};
#endif
static NovaUIStyle current;
static bool opened;
static char failure[256];

#ifdef __APPLE__
typedef struct {
    char *text;
    Texture2D texture;
    float width, height, clip, dx, dy;
    bool code;
    size_t bytes;
    unsigned long used;
} TextImage;
static TextImage cache[NOVA_UI_TEXT_CACHE];
static CTFontRef fonts[2];
static unsigned long clock_tick;
static size_t cache_bytes;
static double appearance_time;
#else
static Font fonts[2];
static float font_density;
#endif

static void fail(const char *message)
{
    if (!failure[0]) {
        snprintf(failure, sizeof(failure), "%s", message);
        TraceLog(LOG_ERROR, "NOVA UI: %s", failure);
    }
}

const NovaUIStyle *nova_ui_style(void) { return &current; }
const char *nova_ui_style_error(void) { return failure; }

void nova_ui_style_update(void)
{
#ifdef __APPLE__
    double now = GetTime();
    if (now < appearance_time) return;
    appearance_time = now + 1;
    CFPreferencesSynchronize(kCFPreferencesAnyApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
    CFPropertyListRef value = CFPreferencesCopyValue(CFSTR("AppleInterfaceStyle"),
        kCFPreferencesAnyApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
    bool is_dark = value && CFGetTypeID(value) == CFStringGetTypeID() &&
        CFStringCompare(value, CFSTR("Dark"), kCFCompareCaseInsensitive) == kCFCompareEqualTo;
    current = is_dark ? dark : light;
    if (value) CFRelease(value);
#endif
}

#ifdef __APPLE__
static void release_text(TextImage *image)
{
    if (image->texture.id) {
        rlDrawRenderBatchActive();
        UnloadTexture(image->texture);
    }
    free(image->text);
    cache_bytes -= image->bytes;
    *image = (TextImage){0};
}

static TextImage *oldest(bool empty)
{
    TextImage *result = NULL;
    for (size_t i = 0; i < NOVA_UI_TEXT_CACHE; ++i) {
        if (!cache[i].text) { if (empty) return &cache[i]; else continue; }
        if (!result || cache[i].used < result->used) result = &cache[i];
    }
    return result;
}

static bool rasterize(TextImage *image, const char *text, float clip, bool code, float dx, float dy)
{
    CFStringRef string = CFStringCreateWithCString(NULL, text, kCFStringEncodingUTF8);
    if (!string) { fail("interface text is not valid UTF-8"); return false; }
    CGColorRef white = CGColorCreateGenericRGB(1, 1, 1, 1);
    const void *keys[] = {kCTFontAttributeName, kCTForegroundColorAttributeName, kCTLigatureAttributeName};
    int disabled = 0;
    CFNumberRef ligatures = CFNumberCreate(NULL, kCFNumberIntType, &disabled);
    if (!white || !ligatures) {
        if (white) CGColorRelease(white);
        if (ligatures) CFRelease(ligatures);
        CFRelease(string);
        fail("cannot allocate system text attributes"); return false;
    }
    const void *values[] = {fonts[code ? 1 : 0], white, ligatures};
    CFDictionaryRef attributes = CFDictionaryCreate(NULL, keys, values, 3,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFAttributedStringRef attributed = attributes ? CFAttributedStringCreate(NULL, string, attributes) : NULL;
    CTLineRef line = attributed ? CTLineCreateWithAttributedString(attributed) : NULL;
    if (attributes) CFRelease(attributes);
    if (attributed) CFRelease(attributed);
    if (ligatures) CFRelease(ligatures);
    if (white) CGColorRelease(white);
    CFRelease(string);
    if (!line) { fail("cannot shape system interface text"); return false; }
    CGFloat ascent, descent, leading;
    double advance = CTLineGetTypographicBounds(line, &ascent, &descent, &leading);
    CGRect bounds = CTLineGetBoundsWithOptions(line, kCTLineBoundsUseGlyphPathBounds);
    double left = fmin(0, bounds.origin.x);
    float width = fminf(clip, (float)ceil(fmax(advance, CGRectGetMaxX(bounds)) - left + 2));
    float height = (float)ceil(ascent + descent + leading + 2);
    int pixels_x = (int)ceilf(width * dx), pixels_y = (int)ceilf(height * dy);
    if (pixels_x < 1 || pixels_y < 1 || pixels_x > 8192 || pixels_y > 512) {
        CFRelease(line); fail("system text raster exceeds its bounded dimensions"); return false;
    }
    size_t bytes = (size_t)pixels_x * (size_t)pixels_y * 4;
    unsigned char *pixels = calloc(1, bytes);
    CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = pixels && space ? CGBitmapContextCreate(pixels, pixels_x, pixels_y,
        8, (size_t)pixels_x * 4, space, kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big) : NULL;
    if (space) CGColorSpaceRelease(space);
    if (!context) {
        free(pixels); CFRelease(line); fail("cannot allocate system text raster"); return false;
    }
    CGContextSetShouldAntialias(context, true);
    CGContextSetShouldSmoothFonts(context, true);
    CGContextScaleCTM(context, dx, dy);
    CGContextSetTextPosition(context, (CGFloat)(1 - left), descent + 1);
    CTLineDraw(line, context);
    CGContextRelease(context);
    CFRelease(line);
    /* Core Graphics is premultiplied; the native renderer expects straight RGBA. */
    for (size_t at = 0; at < bytes; at += 4) {
        unsigned alpha = pixels[at + 3];
        if (alpha) for (size_t channel = 0; channel < 3; ++channel)
            pixels[at + channel] = (unsigned char)fmin(255, (pixels[at + channel] * 255u + alpha / 2) / alpha);
    }
    Image bitmap = {.data = pixels, .width = pixels_x, .height = pixels_y,
        .mipmaps = 1, .format = PIXELFORMAT_UNCOMPRESSED_R8G8B8A8};
    char *copy = strdup(text);
    if (!copy || bytes > NOVA_UI_TEXT_BYTES) {
        free(copy); UnloadImage(bitmap); fail("system text cache exceeds its byte budget"); return false;
    }
    while (cache_bytes + bytes > NOVA_UI_TEXT_BYTES) release_text(oldest(false));
    rlDrawRenderBatchActive();
    Texture2D texture = LoadTextureFromImage(bitmap);
    UnloadImage(bitmap);
    if (!IsTextureValid(texture)) { free(copy); fail("cannot upload system text raster"); return false; }
    SetTextureFilter(texture, TEXTURE_FILTER_BILINEAR);
    *image = (TextImage){.text = copy, .texture = texture, .width = pixels_x / dx,
        .height = pixels_y / dy, .clip = clip, .dx = dx, .dy = dy, .code = code, .bytes = bytes};
    cache_bytes += bytes;
    return true;
}
#endif

bool nova_ui_style_open(char *error, size_t size)
{
    if (opened) return true;
    failure[0] = 0;
    current = dark;
#ifdef __APPLE__
    fonts[0] = CTFontCreateUIFontForLanguage(kCTFontUIFontSystem, NOVA_UI_FONT_SIZE, NULL);
    fonts[1] = CTFontCreateWithName(CFSTR("Menlo"), NOVA_UI_FONT_SIZE, NULL);
    if (!fonts[0] || !fonts[1]) fail("cannot resolve macOS system interface/monospace fonts");
    appearance_time = 0;
    nova_ui_style_update();
#else
    const char *paths[2][3] = {
        {"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf", "C:/Windows/Fonts/segoeui.ttf"},
        {"/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
         "/usr/share/fonts/truetype/liberation2/LiberationMono-Regular.ttf", "C:/Windows/Fonts/consola.ttf"}
    };
    font_density = fmaxf(1, (float)GetRenderHeight() / GetScreenHeight());
    for (int kind = 0; kind < 2; ++kind) {
        const char *path = NULL;
        for (int i = 0; i < 3; ++i) if (FileExists(paths[kind][i])) { path = paths[kind][i]; break; }
        if (path) fonts[kind] = LoadFontEx(path, (int)ceilf(NOVA_UI_FONT_SIZE * font_density), NULL, 0);
        if (!IsFontValid(fonts[kind]) || fonts[kind].texture.id == GetFontDefault().texture.id)
            fail("cannot load installed system interface/monospace fonts");
        else SetTextureFilter(fonts[kind].texture, TEXTURE_FILTER_BILINEAR);
    }
#endif
    if (failure[0]) {
        snprintf(error, size, "%s", failure);
        nova_ui_style_close();
        return false;
    }
    opened = true;
    return true;
}

float nova_ui_code_cell(void)
{
#ifdef __APPLE__
    if (fonts[1]) {
        UniChar character = 'M';
        CGGlyph glyph;
        CGSize advance;
        if (CTFontGetGlyphsForCharacters(fonts[1], &character, &glyph, 1)) {
            CTFontGetAdvancesForGlyphs(fonts[1], kCTFontOrientationHorizontal, &glyph, &advance, 1);
            return ceilf((float)advance.width);
        }
    }
#else
    if (opened) return ceilf(MeasureTextEx(fonts[1], "M", NOVA_UI_FONT_SIZE, 0).x);
#endif
    return 8;
}

void nova_ui_draw_text(const char *text, float x, float y, float width, bool code, Color color)
{
    if (!text || !text[0] || width <= 0 || failure[0]) return;
    if (!opened) { fail("system interface typography was not initialized"); return; }
#ifdef __APPLE__
    float dx = (float)GetRenderWidth() / GetScreenWidth();
    float dy = (float)GetRenderHeight() / GetScreenHeight();
    if (!isfinite(dx) || !isfinite(dy) || dx <= 0 || dy <= 0 || dx > 8 || dy > 8) {
        fail("invalid interface framebuffer density"); return;
    }
    width = fminf(width, 8192 / dx);
    TextImage *image = NULL;
    for (size_t i = 0; i < NOVA_UI_TEXT_CACHE; ++i)
        if (cache[i].text && cache[i].code == code && cache[i].clip == width &&
            cache[i].dx == dx && cache[i].dy == dy && !strcmp(cache[i].text, text)) { image = &cache[i]; break; }
    if (!image) {
        image = oldest(true);
        release_text(image);
        if (!rasterize(image, text, width, code, dx, dy)) return;
    }
    image->used = ++clock_tick;
    DrawTexturePro(image->texture, (Rectangle){0,0,(float)image->texture.width,(float)image->texture.height},
        (Rectangle){x,y,image->width,image->height}, (Vector2){0}, 0, color);
#else
    DrawTextEx(fonts[code ? 1 : 0], text, (Vector2){x,y}, NOVA_UI_FONT_SIZE, 0, color);
#endif
}

void nova_ui_style_close(void)
{
#ifdef __APPLE__
    for (size_t i = 0; i < NOVA_UI_TEXT_CACHE; ++i) release_text(&cache[i]);
    for (int i = 0; i < 2; ++i) if (fonts[i]) { CFRelease(fonts[i]); fonts[i] = NULL; }
    clock_tick = 0;
#else
    for (int i = 0; i < 2; ++i) {
        if (fonts[i].texture.id && fonts[i].texture.id != GetFontDefault().texture.id) UnloadFont(fonts[i]);
        fonts[i] = (Font){0};
    }
#endif
    opened = false;
}
