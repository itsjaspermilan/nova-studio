#ifndef NOVA_AUDIO_DEMO_SCORE_H
#define NOVA_AUDIO_DEMO_SCORE_H

#include "audio.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Original eight-second, four-instrument, three-bus looping fixture used by the
 * offline render command, the tests and the runtime's audio spike. `rate` must be
 * a rate the core accepts (44100 or 48000). Release with nova_audio_program_release. */
bool nova_audio_demo_program(uint32_t rate, NovaAudioProgram **out, char *error, size_t error_size);

#ifdef __cplusplus
}
#endif

#endif
