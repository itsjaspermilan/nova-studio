#include "style.h"
#include "presentation.h"
#include <stdio.h>
#include <stdlib.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr,"UI typography: %s (%s)\n",#c,nova_ui_style_error()); exit(1); } } while (0)

int main(void)
{
    char error[256];
    SetConfigFlags(FLAG_WINDOW_HIGHDPI);
    InitWindow(480,180,"Nova system typography");
    CHECK(IsWindowReady() && nova_ui_style_open(error,sizeof(error)));
    CHECK(nova_ui_code_cell() >= 6 && nova_ui_code_cell() <= 12);
    BeginDrawing();
    ClearBackground(BLACK);
    for (int i=0;i<400;++i) {
        char line[256];
        snprintf(line,sizeof(line),"System text cache %d: smooth platform typography and bounded native resources",i);
        nova_ui_draw_text(line,10,10,440,false,WHITE);
    }
    EndDrawing();
    BeginDrawing();
    ClearBackground(BLACK);
    nova_ui_draw_text("Smooth system typography",20,20,440,false,WHITE);
    nova_ui_draw_text("local model = nova.asset('gem')",20,65,440,true,WHITE);
    nova_ui_draw_text("F",20,110,60,false,WHITE);
    CHECK(!nova_ui_style_error()[0]);
    CHECK(nova_capture_native(NOVA_TEST_DIRECTORY "/ui-typography.png",GetRenderWidth(),GetRenderHeight()));
    Image image=LoadImageFromScreen();
    CHECK(IsImageValid(image) && image.width==GetRenderWidth() && image.height==GetRenderHeight());
    bool levels[256]={0};
    int covered=0, distinct=0;
    for (int y=0;y<image.height;++y) for (int x=0;x<image.width;++x) {
        Color pixel=GetImageColor(image,x,y);
        if (pixel.r && pixel.r<255 && pixel.r==pixel.g && pixel.g==pixel.b) {
            levels[pixel.r]=true; ++covered;
        }
    }
    for (int i=1;i<255;++i) if (levels[i]) ++distinct;
    CHECK(covered>100 && distinct>=16);
    float dx=(float)image.width/GetScreenWidth(), dy=(float)image.height/GetScreenHeight();
    int top=image.height, bottom=-1;
    for (int y=(int)(110*dy);y<(int)(140*dy);++y)
        for (int x=(int)(20*dx);x<(int)(45*dx);++x) {
            if (GetImageColor(image,x,y).r>32) {
                if (y<top) top=y;
                if (y>bottom) bottom=y;
            }
        }
    CHECK(bottom>top);
    int upper=0, lower=0, band=(bottom-top+1)/3;
    for (int y=top;y<=bottom;++y) for (int x=(int)(20*dx);x<(int)(45*dx);++x)
        if (GetImageColor(image,x,y).r>32) {
            if (y<top+band) ++upper;
            if (y>bottom-band) ++lower;
        }
    CHECK(upper>lower);
    printf("NOVA_UI_TYPOGRAPHY native=%dx%d antialiased-levels=%d covered=%d\n",
        image.width,image.height,distinct,covered);
    UnloadImage(image);
    EndDrawing();
    nova_ui_style_close();
    CloseWindow();
    return 0;
}
