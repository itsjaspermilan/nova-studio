/* Only this test build redirects allocation/free entry points. */
#undef LoadRenderTexture
#undef UnloadRenderTexture
#include "presentation.h"
#include <rlgl.h>
#include <stdio.h>
#include <string.h>

static bool fail_allocation;
static int candidate_unloads;

RenderTexture2D nova_test_load_render_texture(int width, int height)
{
    if (!fail_allocation) return LoadRenderTexture(width, height);
    RenderTexture2D target = {.id = rlLoadFramebuffer()};
    target.depth = (Texture2D){.id = rlLoadTextureDepth(width, height, true),
        .width = width, .height = height, .format = 19, .mipmaps = 1};
    rlFramebufferAttach(target.id, target.depth.id, RL_ATTACHMENT_DEPTH, RL_ATTACHMENT_RENDERBUFFER, 0);
    return target;
}

void nova_test_unload_render_texture(RenderTexture2D target)
{
    candidate_unloads++;
    UnloadRenderTexture(target);
}

int main(void)
{
    InitWindow(480, 270, "Nova allocation rollback");
    if (!IsWindowReady()) return 1;
    NovaPresentation presentation = {0};
    char error[256] = {0};
    if (!nova_presentation_configure(&presentation, (NovaWorldResolution){960, 540}, error, sizeof(error))) return 1;
    unsigned int previous = presentation.world.id;
    unsigned int cube = presentation.cube.meshes[0].vaoId;
    candidate_unloads = 0;
    fail_allocation = true;
    bool rejected = !nova_presentation_configure(&presentation, (NovaWorldResolution){1280, 720}, error, sizeof(error));
    if (!rejected || !strstr(error, "Could not allocate complete 1280x720") ||
        candidate_unloads != 1 || presentation.world.id != previous ||
        presentation.cube.meshes[0].vaoId != cube || !rlFramebufferComplete(previous)) {
        fprintf(stderr, "Partial GPU allocation was not cleaned up with explicit error/retained presentation\n");
        return 1;
    }
    fail_allocation = false;
    if (!nova_presentation_configure(&presentation, (NovaWorldResolution){1280, 720}, error, sizeof(error)) ||
        error[0] || presentation.world.id == previous || candidate_unloads != 2 ||
        presentation.cube.meshes[0].vaoId != cube) return 1;
    nova_presentation_destroy(&presentation);
    CloseWindow();
    puts("Partial GPU allocation failure released only its candidate; retry replaced the prior target and retained cube ownership.");
    return 0;
}
