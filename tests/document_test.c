#include "document.h"
#include "assets.h"
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #c); exit(1); } } while (0)

static void write_file(const char *path, const char *text)
{
    FILE *file = fopen(path, "wb");
    CHECK(file && fwrite(text, 1, strlen(text), file) == strlen(text) && !fclose(file));
}

static void matches(const char *path, const char *text)
{
    char error[1024];
    int size;
    unsigned char *bytes = nova_read_file(path, NOVA_SOURCE_EDIT_LIMIT, &size, error, sizeof(error));
    CHECK(bytes && size == (int)strlen(text) && !memcmp(bytes, text, (size_t)size));
    free(bytes);
}

int main(void)
{
    char root[] = NOVA_TEST_DIRECTORY "/editor-doc-XXXXXX", manifest[4096], source[4096], other[4096];
    char error[1024] = {0};
    CHECK(mkdtemp(root));
    snprintf(manifest, sizeof(manifest), "%s/nova.project", root);
    snprintf(source, sizeof(source), "%s/main.lua", root);
    snprintf(other, sizeof(other), "%s/other.lua", root);
    const char *valid = "nova.scene('2d')\nfunction update(dt,input) nova.rectangle(10,20,30,40,50,60,70) end\n";
    const char *manifest_text = "# original authoring fixture\r\nnova-project 2\r\nidentity Editor-fixture\r\nentry main.lua\r\n";
    write_file(manifest, manifest_text);
    write_file(source, valid);
    write_file(manifest, "broken manifest\n");
    NovaAuthoringProject broken = {0};
    CHECK(nova_authoring_open(&broken, manifest, error, sizeof(error)));
    CHECK(broken.declaration.text && !broken.source.text && strstr(broken.source_error, "manifest"));
    CHECK(nova_document_replace(&broken.declaration, 0, broken.declaration.length, manifest_text,
        strlen(manifest_text), error, sizeof(error)));
    CHECK(nova_document_save(&broken.declaration, false, error, sizeof(error)));
    nova_authoring_close(&broken);
    char *oversized = malloc(NOVA_SOURCE_EDIT_LIMIT + 1);
    CHECK(oversized);
    memset(oversized, ' ', NOVA_SOURCE_EDIT_LIMIT + 1);
    FILE *large = fopen(source, "wb");
    CHECK(large && fwrite(oversized, 1, NOVA_SOURCE_EDIT_LIMIT + 1, large) == NOVA_SOURCE_EDIT_LIMIT + 1 && !fclose(large));
    free(oversized);
    CHECK(nova_authoring_open(&broken, manifest, error, sizeof(error)));
    CHECK(broken.declaration.text && !broken.source.text && strstr(broken.source_error, "bounded"));
    nova_authoring_close(&broken);
    write_file(source, valid);
    NovaAuthoringProject project = {0};
    CHECK(nova_authoring_open(&project, manifest, error, sizeof(error)));
    CHECK(!nova_document_dirty(&project.declaration) && !nova_document_dirty(&project.source));
    CHECK(nova_document_check_disk(&project.source, error, sizeof(error)));
    CHECK(nova_document_replace(&project.source, 0, 0, "-- draft\n", 9, error, sizeof(error)));
    CHECK(nova_document_dirty(&project.source));
    CHECK(!nova_document_replace(&project.source, 9, 1, "", 0, error, sizeof(error)));
    CHECK(!nova_document_replace(&project.source, 0, 0, "x", NOVA_SOURCE_EDIT_LIMIT + 1, error, sizeof(error)));
    CHECK(!nova_document_replace(&project.source, 0, 0, "\0", 1, error, sizeof(error)));
    write_file(source, "-- external\n");
    CHECK(!nova_document_check_disk(&project.source, error, sizeof(error)) && project.source.has_conflict);
    CHECK(strstr(project.source.text, "-- draft\n") == project.source.text);
    CHECK(!nova_document_save(&project.source, false, error, sizeof(error)));
    CHECK(project.source.has_conflict && !strcmp(project.source.conflict.text, "-- external\n"));
    CHECK(strstr(error, "external edit") && nova_document_dirty(&project.source));
    matches(source, "-- external\n");
    write_file(source, "-- newer external\n");
    CHECK(!nova_document_save(&project.source, true, error, sizeof(error)));
    CHECK(!strcmp(project.source.conflict.text, "-- newer external\n"));
    CHECK(nova_document_save(&project.source, true, error, sizeof(error)));
    CHECK(!nova_document_dirty(&project.source) && !project.source.has_conflict);
    matches(source, project.source.text);
    CHECK(nova_authoring_property(&project, "identity", NULL, "Edited-identity", error, sizeof(error)));
    CHECK(strstr(project.declaration.text, "# original authoring fixture\r\n"));
    CHECK(strstr(project.declaration.text, "identity Edited-identity\r\n"));
    CHECK(!nova_authoring_property(&project, "entry", NULL, "../escape.lua", error, sizeof(error)));
    CHECK(!nova_authoring_property(&project, "identity", NULL, "bad identity", error, sizeof(error)));
    CHECK(!nova_authoring_property(&project, "entry", NULL, "main.lua\nsprite x x.png", error, sizeof(error)));
    CHECK(!nova_authoring_open(&project, "/does-not-exist/nova.project", error, sizeof(error)));
    CHECK(nova_document_dirty(&project.declaration) && strstr(project.declaration.text, "Edited-identity"));
    CHECK(nova_document_save(&project.declaration, false, error, sizeof(error)));
    NovaProjectValidation validation = {0};
    CHECK(nova_validate_project(manifest, &validation, error, sizeof(error)));
    CHECK(!strcmp(validation.project.identity, "Edited-identity"));
    NovaProjectValidation before = validation;
    CHECK(nova_document_replace(&project.source, 0, project.source.length, "invalid Lua!", 12, error, sizeof(error)));
    CHECK(nova_document_save(&project.source, false, error, sizeof(error)));
    CHECK(!nova_validate_project(manifest, &validation, error, sizeof(error)));
    CHECK(!memcmp(&validation, &before, sizeof(before)));
    write_file(source, valid);
    CHECK(nova_document_reread(&project.source, error, sizeof(error)));
    CHECK(!strcmp(project.source.text, valid) && !nova_document_dirty(&project.source));
    CHECK(!chmod(source, 0444));
    CHECK(nova_document_reread(&project.source, error, sizeof(error)));
    CHECK(!nova_document_save(&project.source, false, error, sizeof(error)));
    CHECK(strstr(error, "not writable"));
    CHECK(!chmod(source, 0644));
    CHECK(nova_document_reread(&project.source, error, sizeof(error)));
    write_file(other, "other");
    CHECK(unlink(source) == 0 && symlink(other, source) == 0);
    CHECK(!nova_document_save(&project.source, false, error, sizeof(error)));
    CHECK(!nova_document_reread(&project.source, error, sizeof(error)));
    matches(other, "other");
    CHECK(!strcmp(project.source.text, valid));
    CHECK(unlink(source) == 0 && link(other, source) == 0);
    CHECK(!nova_document_save(&project.source, false, error, sizeof(error)));
    CHECK(unlink(source) == 0);
    CHECK(!nova_document_save(&project.source, true, error, sizeof(error)));
    write_file(source, valid);
    NovaDocument unsafe = {0};
    CHECK(!nova_document_open(&unsafe, root, "../other.lua", 100, error, sizeof(error)));
    CHECK(!nova_document_open(&unsafe, root, "/other.lua", 100, error, sizeof(error)));
    CHECK(!nova_document_open(&unsafe, root, "other.lua", 2, error, sizeof(error)));
    FILE *nul = fopen(other, "wb");
    CHECK(nul && fwrite("x\0y", 1, 3, nul) == 3 && !fclose(nul));
    CHECK(!nova_document_open(&unsafe, root, "other.lua", 100, error, sizeof(error)));
    char linkdir[4096], linked[4096];
    snprintf(linkdir, sizeof(linkdir), "%s/link", root);
    snprintf(linked, sizeof(linked), "%s/link/main.lua", root);
    CHECK(symlink(root, linkdir) == 0);
    CHECK(!nova_document_open(&unsafe, root, "link/main.lua", 100, error, sizeof(error)));
    CHECK(unlink(linkdir) == 0);
    NovaDocument empty = {0};
    CHECK(!nova_document_save(&empty, false, error, sizeof(error)));
    NovaDocument output = {0};
    CHECK(nova_document_open_output(&output, root, "output.glb", 100, true, error, sizeof(error)));
    const char binary[] = {'g','l','T','F',0,1,2};
    CHECK(nova_document_replace(&output, 0, 0, binary, sizeof(binary), error, sizeof(error)));
    CHECK(nova_document_save(&output, false, error, sizeof(error)));
    CHECK(output.saved.length == sizeof(binary) && !memcmp(output.saved.text, binary, sizeof(binary)));
    CHECK(!nova_document_dirty(&output));
    CHECK(nova_document_reread(&output, error, sizeof(error)));
    char exported[4096];
    snprintf(exported, sizeof(exported), "%s/output.glb", root);
    write_file(exported, "external export");
    CHECK(!nova_document_save(&output, false, error, sizeof(error)) && output.has_conflict);
    CHECK(nova_document_save(&output, true, error, sizeof(error)));
    nova_document_close(&output);
    CHECK(!unlink(exported));
    CHECK(nova_document_open_output(&output, root, "new.lua", 100, false, error, sizeof(error)));
    CHECK(nova_document_replace(&output, 0, 0, "new draft", 9, error, sizeof(error)));
    snprintf(exported, sizeof(exported), "%s/new.lua", root);
    write_file(exported, "new external");
    CHECK(!nova_document_save(&output, false, error, sizeof(error)) && output.has_conflict);
    matches(exported, "new external");
    nova_document_close(&output);
    CHECK(!unlink(exported));
    char child[4096], displaced[4096], child_file[4096], displaced_file[4096];
    snprintf(child, sizeof(child), "%s/child", root);
    snprintf(displaced, sizeof(displaced), "%s/displaced", root);
    snprintf(child_file, sizeof(child_file), "%s/child/main.lua", root);
    snprintf(displaced_file, sizeof(displaced_file), "%s/displaced/main.lua", root);
    CHECK(!mkdir(child, 0700));
    write_file(child_file, "original");
    CHECK(nova_document_open(&output, child, "main.lua", 100, error, sizeof(error)));
    CHECK(!rename(child, displaced) && !mkdir(child, 0700));
    write_file(child_file, "replaced root");
    CHECK(!nova_document_save(&output, false, error, sizeof(error)));
    CHECK(strstr(error, "root was replaced"));
    matches(child_file, "replaced root");
    matches(displaced_file, "original");
    nova_document_close(&output);
    CHECK(!unlink(child_file) && !unlink(displaced_file) && !rmdir(child) && !rmdir(displaced));
    DIR *dir = opendir(root);
    CHECK(dir);
    struct dirent *entry;
    while ((entry = readdir(dir))) CHECK(strncmp(entry->d_name, ".nova-edit-", 11));
    CHECK(!closedir(dir));
    nova_authoring_close(&project);
    CHECK(!unlink(source) && !unlink(other) && !unlink(manifest) && !rmdir(root));
    puts("NOVA_DOCUMENT checks=conflict-newer,atomic-save,copy-on-success,CRLF-property,NUL,budget,symlink,hardlink,deleted,validation-rollback status=ok");
    return 0;
}
