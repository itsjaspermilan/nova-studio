#include "audio.h"

#include <float.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

_Static_assert(sizeof(float) == 4 && FLT_RADIX == 2 && FLT_MANT_DIG == 24 && FLT_MAX_EXP == 128,
    "Nova WAV requires IEEE 754 binary32 floats");

static bool fail(char *error, size_t size, const char *message)
{
    if (error && size) snprintf(error, size, "%s", message);
    return false;
}

static uint32_t u32(const unsigned char *bytes)
{
    return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
        ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

static uint32_t u16(const unsigned char *bytes) { return bytes[0] | ((uint32_t)bytes[1] << 8); }

static float f32(const unsigned char *bytes)
{
    uint32_t bits = u32(bytes);
    float value;
    memcpy(&value, &bits, sizeof(value));
    return value;
}

bool nova_audio_wav_inspect(const unsigned char *bytes, size_t size,
    NovaAudioWavInfo *info, char *error, size_t error_size)
{
    if (!bytes || !info || size < 44 || size > NOVA_AUDIO_WAV_INPUT_LIMIT ||
        memcmp(bytes, "RIFF", 4) || u32(bytes + 4) != size - 8 ||
        memcmp(bytes + 8, "WAVEfmt ", 8) || u32(bytes + 16) != 16)
        return fail(error, error_size, "WAV requires bounded RIFF, fmt(16) and exact chunk/file lengths");
    uint32_t format = u16(bytes + 20), channels = u16(bytes + 22);
    uint32_t rate = u32(bytes + 24), bits = u16(bytes + 34);
    size_t offset = format == 3 ? 56 : 44;
    if ((format != 1 && format != 3) ||
        (format == 1 ? (bits != 8 && bits != 16 && bits != 24) : bits != 32) ||
        (channels != 1 && channels != 2) || rate < 8000 || rate > 48000 || size < offset ||
        (format == 3 && (memcmp(bytes + 36, "fact", 4) || u32(bytes + 40) != 4)) ||
        memcmp(bytes + offset - 8, "data", 4))
        return fail(error, error_size, "WAV requires mono/stereo PCM8/16/24 or float32 with fact(4), at 8000..48000 Hz; no extra chunks");
    uint32_t alignment = channels * (bits / 8), data_size = u32(bytes + offset - 4);
    if (u16(bytes + 32) != alignment || u32(bytes + 28) != rate * alignment ||
        !data_size || data_size % alignment || data_size / alignment > rate * NOVA_AUDIO_SAMPLE_SECONDS ||
        size != offset + (size_t)data_size + (data_size & 1u) ||
        ((data_size & 1u) && bytes[size - 1] != 0) ||
        (format == 3 && u32(bytes + 44) != data_size / alignment))
        return fail(error, error_size, "WAV requires valid alignment/rate/fact/padding and 0 < duration <= 60s");
    if (format == 3)
        for (size_t i = offset; i < offset + data_size; i += 4) {
            float value = f32(bytes + i);
            if (!isfinite(value) || fabsf(value) > NOVA_AUDIO_SAMPLE_PEAK_LIMIT)
                return fail(error, error_size, "float WAV samples must be finite and within +/-16; no clipping is performed");
        }
    *info = (NovaAudioWavInfo){.sample = {rate, channels, data_size / alignment},
        .bits = bits, .format = format, .data_bytes = data_size, .data_offset = offset};
    if (error && error_size) error[0] = '\0';
    return true;
}

bool nova_audio_wav_read(const unsigned char *bytes, size_t size, float *data,
    size_t sample_capacity, char *error, size_t error_size)
{
    NovaAudioWavInfo info;
    if (!nova_audio_wav_inspect(bytes, size, &info, error, error_size)) return false;
    size_t count = (size_t)info.sample.frames * info.sample.channels;
    if (!data || sample_capacity < count) return fail(error, error_size, "WAV float output buffer is too small");
    const unsigned char *source = bytes + info.data_offset;
    for (size_t i = 0; i < count; ++i, source += info.bits / 8) {
        if (info.format == 3) data[i] = f32(source);
        else if (info.bits == 8) data[i] = ((int)source[0] - 128) / 128.0f;
        else if (info.bits == 16) {
            int32_t value = (int32_t)u16(source);
            if (value >= 32768) value -= 65536;
            data[i] = value / 32768.0f;
        } else {
            int32_t value = (int32_t)(u16(source) | ((uint32_t)source[2] << 16));
            if (value >= 8388608) value -= 16777216;
            data[i] = value / 8388608.0f;
        }
    }
    return true;
}

bool nova_audio_sample_from_wav(const unsigned char *bytes, size_t size,
    NovaAudioSample **out, char *error, size_t error_size)
{
    if (!out) return fail(error, error_size, "WAV sample requires an output pointer");
    NovaAudioWavInfo info;
    if (!nova_audio_wav_inspect(bytes, size, &info, error, error_size)) return false;
    size_t count = (size_t)info.sample.frames * info.sample.channels;
    float *data = malloc(count * sizeof(*data));
    if (!data) return fail(error, error_size, "WAV decode allocation failed");
    bool ok = nova_audio_wav_read(bytes, size, data, count, error, error_size) &&
        nova_audio_sample_create(data, info.sample, out, error, error_size);
    free(data);
    return ok;
}

static void put16(unsigned char *bytes, uint32_t value)
{
    bytes[0] = (unsigned char)value; bytes[1] = (unsigned char)(value >> 8);
}

static void put32(unsigned char *bytes, uint32_t value)
{
    for (unsigned i = 0; i < 4; ++i) bytes[i] = (unsigned char)(value >> (i * 8));
}

static double random_unit(uint32_t *state)
{
    uint32_t n = *state;
    n ^= n << 13; n ^= n >> 17; n ^= n << 5;
    *state = n;
    return (double)n / 4294967296.0;
}

static bool encode(const float *samples, size_t count, NovaAudioExport options,
    uint32_t *seed, unsigned char *bytes, char *error, size_t error_size)
{
    unsigned stride = options.format == NOVA_AUDIO_WAV_PCM16 ? 2 :
        options.format == NOVA_AUDIO_WAV_PCM24 ? 3 : 4;
    for (size_t i = 0; i < count; ++i) {
        uint32_t encoded;
        if (!isfinite(samples[i])) return fail(error, error_size, "WAV render produced nonfinite data");
        if (options.format == NOVA_AUDIO_WAV_FLOAT32) memcpy(&encoded, &samples[i], sizeof(encoded));
        else {
            int64_t scale = options.format == NOVA_AUDIO_WAV_PCM16 ? 32768 : 8388608;
            double value = (double)samples[i] * scale;
            if (options.dither) {
                double first = random_unit(seed), second = random_unit(seed);
                value += first - second;
            }
            if (value < -scale - 0.5 || value >= scale - 0.5)
                return fail(error, error_size, "integer WAV would clip; lower mix gain or export float (dither needs headroom)");
            int64_t rounded = llround(value);
            if (rounded < -scale || rounded >= scale)
                return fail(error, error_size, "integer WAV would clip; no saturation or normalization was applied");
            encoded = (uint32_t)rounded;
        }
        for (unsigned byte = 0; byte < stride; ++byte)
            bytes[i * stride + byte] = (unsigned char)(encoded >> (byte * 8));
    }
    return true;
}

bool nova_audio_write_wav(NovaAudioProgram *program, NovaAudioExport options,
    NovaAudioWrite write, void *context, NovaAudioExportResult *result,
    char *error, size_t error_size)
{
    if (result) *result = (NovaAudioExportResult){0};
    if (!program || !write || !result || !options.frames ||
        options.frames > (uint64_t)nova_audio_program_rate(program) * NOVA_AUDIO_MAX_SECONDS ||
        options.format < NOVA_AUDIO_WAV_PCM16 || options.format > NOVA_AUDIO_WAV_FLOAT32 ||
        (options.dither && (!options.seed || options.format == NOVA_AUDIO_WAV_FLOAT32)))
        return fail(error, error_size, "invalid WAV render length, format, writer or dither seed");
    unsigned bits = options.format == NOVA_AUDIO_WAV_PCM16 ? 16 :
        options.format == NOVA_AUDIO_WAV_PCM24 ? 24 : 32;
    unsigned header_size = options.format == NOVA_AUDIO_WAV_FLOAT32 ? 56 : 44;
    uint64_t data_size = options.frames * 2 * (bits / 8);
    if (data_size > UINT32_MAX - header_size + 8)
        return fail(error, error_size, "render exceeds RIFF 32-bit file length");
    NovaAudioRenderer *renderer = NULL;
    if (!nova_audio_renderer_create(program, &renderer, error, error_size)) return false;
    unsigned char header[56] = {0};
    memcpy(header, "RIFF", 4); put32(header + 4, (uint32_t)data_size + header_size - 8);
    memcpy(header + 8, "WAVEfmt ", 8); put32(header + 16, 16);
    put16(header + 20, options.format == NOVA_AUDIO_WAV_FLOAT32 ? 3 : 1);
    put16(header + 22, 2); put32(header + 24, nova_audio_program_rate(program));
    put32(header + 28, nova_audio_program_rate(program) * 2 * (bits / 8));
    put16(header + 32, 2 * (bits / 8)); put16(header + 34, bits);
    if (header_size == 56) {
        memcpy(header + 36, "fact", 4); put32(header + 40, 4); put32(header + 44, (uint32_t)options.frames);
    }
    memcpy(header + header_size - 8, "data", 4); put32(header + header_size - 4, (uint32_t)data_size);
    bool ok = write(context, header, header_size);
    if (ok) result->bytes_written = header_size;
    else fail(error, error_size, "WAV output writer failed on header; discard candidate output");
    uint32_t seed = options.seed;
    while (ok && result->frames_written < options.frames) {
        float samples[512 * 2];
        unsigned char bytes[512 * 2 * 4];
        uint64_t remaining = options.frames - result->frames_written;
        size_t frames = remaining < 512 ? (size_t)remaining : 512;
        if (nova_audio_render(renderer, samples, frames) != NOVA_AUDIO_OK) {
            ok = fail(error, error_size, "offline audio rendering failed; discard candidate output");
            break;
        }
        if (!encode(samples, frames * 2, options, &seed, bytes, error, error_size)) { ok = false; break; }
        size_t size = frames * 2 * (bits / 8);
        if (!write(context, bytes, size)) {
            ok = fail(error, error_size, "WAV output writer failed on data; discard candidate output");
            break;
        }
        result->bytes_written += size;
        result->frames_written += frames;
    }
    NovaAudioStatus status = nova_audio_status(renderer);
    result->peak[0] = status.peak[0][0]; result->peak[1] = status.peak[0][1];
    result->over_frames = status.over_frames[0];
    result->complete = ok;
    nova_audio_renderer_destroy(renderer);
    if (ok && error && error_size) error[0] = '\0';
    return ok;
}
