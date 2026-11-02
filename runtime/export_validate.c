#include "assets.h"
#include "inspect.h"

#include <errno.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv)
{
    if (argc != 2 && !(argc == 4 && !strcmp(argv[2], "--files"))) {
        fprintf(stderr, "Usage: nova_export_validate <nova.project> [--files listing.txt]\n");
        return 2;
    }
    SetTraceLogLevel(LOG_NONE);
    NovaProjectValidation validation = {0};
    char error[1024] = {0};
    if (!nova_validate_project(argv[1], &validation, error, sizeof(error))) {
        fprintf(stderr, "Nova export validation: %s\n", error);
        return 1;
    }
    FILE *output = argc == 4 ? fopen(argv[3], "w") : stdout;
    if (!output) {
        fprintf(stderr, "Nova export listing: %s\n", strerror(errno));
        return 1;
    }
    fprintf(output, "%s\n", validation.project.entry);
    if (*validation.project.scene) fprintf(output, "%s\n", validation.project.scene);
    for (size_t i = 0; i < validation.project.count; ++i) {
        bool duplicate = false;
        for (size_t j = 0; j < i; ++j)
            if (!strcmp(validation.project.assets[i].path, validation.project.assets[j].path))
                duplicate = true;
        if (!duplicate) fprintf(output, "%s\n", validation.project.assets[i].path);
    }
    bool failed = ferror(output);
    if (argc == 4) failed = fclose(output) != 0 || failed;
    else failed = fflush(output) != 0 || failed;
    if (failed) fprintf(stderr, "Nova export listing: could not write required paths\n");
    return failed ? 1 : 0;
}
