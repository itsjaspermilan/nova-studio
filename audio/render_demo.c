#include "audio.h"
#include "demo_score.h"

#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static bool file_write(void *context, const void *bytes, size_t size)
{
    return fwrite(bytes, 1, size, context) == size;
}

static bool discard(const char *candidate)
{
    if (!unlink(candidate)) return true;
    fprintf(stderr, "Could not remove private render candidate '%s': %s\n", candidate, strerror(errno));
    return false;
}

int main(int argc, char **argv)
{
    if (argc < 2 || argc > 4 || (argc >= 3 && strcmp(argv[2], "48000") && strcmp(argv[2], "44100")) ||
        (argc == 4 && strcmp(argv[3], "float32") && strcmp(argv[3], "pcm24") && strcmp(argv[3], "pcm16"))) {
        fputs("Usage: nova_audio_render NEW.wav [48000|44100] [float32|pcm24|pcm16]\n"
            "Renders an original eight-second fixture without opening an audio device. Never overwrites.\n", stderr);
        return 2;
    }
    uint32_t rate = argc >= 3 && !strcmp(argv[2], "44100") ? 44100 : 48000;
    NovaAudioWavFormat format = argc == 4 && !strcmp(argv[3], "pcm24") ? NOVA_AUDIO_WAV_PCM24 :
        argc == 4 && !strcmp(argv[3], "pcm16") ? NOVA_AUDIO_WAV_PCM16 : NOVA_AUDIO_WAV_FLOAT32;
    char candidate[4096], error[1024];
    int size = snprintf(candidate, sizeof(candidate), "%s.partial-XXXXXX", argv[1]);
    if (size < 0 || (size_t)size >= sizeof(candidate)) { fputs("Output path is too long.\n", stderr); return 1; }
    NovaAudioProgram *program = NULL;
    if (!nova_audio_demo_program(rate, &program, error, sizeof(error))) { fprintf(stderr, "%s\n", error); return 1; }
    int fd = mkstemp(candidate);
    if (fd < 0) {
        fprintf(stderr, "Cannot create render candidate: %s\n", strerror(errno));
        nova_audio_program_release(program); return 1;
    }
    FILE *file = fdopen(fd, "wb");
    if (!file) {
        fprintf(stderr, "Cannot open render writer: %s\n", strerror(errno));
        if (close(fd)) fprintf(stderr, "Closing candidate failed: %s\n", strerror(errno));
        discard(candidate); nova_audio_program_release(program); return 1;
    }
    NovaAudioExportResult result;
    NovaAudioExport options = {.frames = (uint64_t)rate * 8, .format = format,
        .dither = format != NOVA_AUDIO_WAV_FLOAT32, .seed = 34567};
    bool ok = nova_audio_write_wav(program, options, file_write, file, &result, error, sizeof(error));
    nova_audio_program_release(program);
    if (!ok) fprintf(stderr, "%s\n", error);
    if (ok && (fflush(file) || fsync(fileno(file)))) {
        fprintf(stderr, "Render candidate flush/sync failed: %s\n", strerror(errno)); ok = false;
    }
    if (fclose(file)) { fprintf(stderr, "Render candidate close failed: %s\n", strerror(errno)); ok = false; }
    if (!ok) { discard(candidate); return 1; }
    if (link(candidate, argv[1])) {
        fprintf(stderr, "Cannot publish new output (existing paths are never replaced): %s\n", strerror(errno));
        discard(candidate); return 1;
    }
    if (!discard(candidate)) { fputs("Output was written; private-candidate cleanup failed.\n", stderr); return 1; }
    printf("Rendered %llu stereo frames at %u Hz (%s), peaks %.6f / %.6f, over-range frames %llu: %s\n",
        (unsigned long long)result.frames_written, rate,
        format == NOVA_AUDIO_WAV_FLOAT32 ? "float32" : format == NOVA_AUDIO_WAV_PCM24 ? "PCM24 + TPDF" : "PCM16 + TPDF",
        result.peak[0], result.peak[1], (unsigned long long)result.over_frames, argv[1]);
    return 0;
}
