#ifndef NOVA_WAV_INTERNAL_H
#define NOVA_WAV_INTERNAL_H

#include "audio.h"

/* Shared canonical header/PCM rules. Callers enforce their own whole-file or
 * streaming budgets, padding and source lifetime. This does not read files. */
bool nova_wav_header(const unsigned char *header, size_t header_size, uint64_t file_size,
    uint32_t max_seconds, NovaAudioWavInfo *info, char *error, size_t error_size);
bool nova_wav_decode(const unsigned char *bytes, size_t frames, const NovaAudioWavInfo *info,
    float *output, bool stereo, size_t *bad_frame);

#endif
