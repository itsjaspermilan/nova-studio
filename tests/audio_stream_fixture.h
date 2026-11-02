#ifndef NOVA_AUDIO_STREAM_FIXTURE_H
#define NOVA_AUDIO_STREAM_FIXTURE_H

#include "stream.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct {
    char path[4096];
    uint32_t rate, channels, bits, frames;
    uint64_t bytes;
} StreamFixture;

static void stream_put(unsigned char *bytes, uint32_t value, unsigned count)
{
    for (unsigned i = 0; i < count; ++i) bytes[i] = (unsigned char)(value >> (i * 8));
}

static float stream_value(StreamFixture file, uint32_t frame, unsigned channel)
{
    if (file.bits == 32)
        return channel ? -(float)(frame % 251) / 512 : 1.25f + (float)(frame % 127) / 1024;
    unsigned scale = 1u << (file.bits - 1);
    int32_t value = (int32_t)(((uint64_t)frame * 257 + channel * 7919) % (2 * scale)) - (int32_t)scale;
    return (float)value / scale;
}

static StreamFixture stream_fixture(uint32_t rate, uint32_t channels, uint32_t bits, uint32_t frames)
{
    StreamFixture file = {.rate = rate, .channels = channels, .bits = bits, .frames = frames};
    snprintf(file.path, sizeof(file.path), "%s/disk-audio.XXXXXX", NOVA_TEST_DIRECTORY);
    int fd = mkstemp(file.path);
    CHECK(fd >= 0);
    FILE *output = fdopen(fd, "wb");
    CHECK(output);
    unsigned header_size = bits == 32 ? 56 : 44;
    uint32_t data_size = frames * channels * (bits / 8);
    file.bytes = header_size + (uint64_t)data_size + (data_size & 1);
    unsigned char header[56] = {0};
    memcpy(header, "RIFF", 4); stream_put(header + 4, (uint32_t)file.bytes - 8, 4);
    memcpy(header + 8, "WAVEfmt ", 8); stream_put(header + 16, 16, 4);
    stream_put(header + 20, bits == 32 ? 3 : 1, 2); stream_put(header + 22, channels, 2);
    stream_put(header + 24, rate, 4); stream_put(header + 28, rate * channels * (bits / 8), 4);
    stream_put(header + 32, channels * (bits / 8), 2); stream_put(header + 34, bits, 2);
    if (bits == 32) {
        memcpy(header + 36, "fact", 4); stream_put(header + 40, 4, 4); stream_put(header + 44, frames, 4);
    }
    memcpy(header + header_size - 8, "data", 4); stream_put(header + header_size - 4, data_size, 4);
    CHECK(fwrite(header, 1, header_size, output) == header_size);
    unsigned char data[1024 * 8];
    for (uint32_t position = 0; position < frames;) {
        uint32_t count = frames - position > 1024 ? 1024 : frames - position;
        for (uint32_t i = 0; i < count; ++i) for (unsigned channel = 0; channel < channels; ++channel) {
            float value = stream_value(file, position + i, channel);
            uint32_t encoded;
            if (bits == 32) memcpy(&encoded, &value, 4);
            else {
                encoded = (uint32_t)(int32_t)(value * (1u << (bits - 1)));
                if (bits == 8) encoded += 128;
            }
            stream_put(data + (i * channels + channel) * (bits / 8), encoded, bits / 8);
        }
        size_t bytes = (size_t)count * channels * (bits / 8);
        CHECK(fwrite(data, 1, bytes, output) == bytes);
        position += count;
    }
    if (data_size & 1) CHECK(fputc(0, output) == 0);
    CHECK(!fclose(output));
    return file;
}

#endif
