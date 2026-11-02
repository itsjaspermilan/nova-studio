#include "stream.h"

#include <fcntl.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #c); exit(1); } } while (0)
#include "audio_stream_fixture.h"

static char error[512];

static NovaAudioStreamSnapshot state(NovaAudioStream *s)
{
    NovaAudioStreamSnapshot snapshot;
    CHECK(nova_audio_stream_snapshot(s, &snapshot));
    return snapshot;
}

static NovaAudioStreamSnapshot ready(NovaAudioStream *s, unsigned frames)
{
    for (unsigned i = 0; i < 5000; ++i) {
        CHECK(nova_audio_stream_render(s, NULL, 0) != NOVA_STREAM_RENDER_FAULT);
        NovaAudioStreamSnapshot snapshot = state(s);
        if (snapshot.buffered_frames >= frames) return snapshot;
        const struct timespec delay = {.tv_nsec = 1000000};
        nanosleep(&delay, NULL);
    }
    CHECK(false);
    return (NovaAudioStreamSnapshot){0};
}

static NovaAudioStreamSnapshot command(NovaAudioStream *s, NovaAudioStreamCommand value,
    NovaAudioControlResult expected)
{
    uint64_t ticket;
    CHECK(nova_audio_stream_command(s, value, &ticket) == NOVA_AUDIO_CONTROL_OK);
    nova_audio_stream_render(s, NULL, 0);
    NovaAudioStreamReceipt receipt;
    CHECK(nova_audio_stream_receipt(s, &receipt));
    CHECK(receipt.ticket == ticket && receipt.type == value.type && receipt.result == expected);
    return state(s);
}

static NovaAudioStream *open_file(StreamFixture file)
{
    NovaAudioStream *s = NULL;
    CHECK(nova_audio_stream_open(file.path, &s, error, sizeof(error)));
    NovaAudioStreamInfo info = nova_audio_stream_info(s);
    CHECK(info.wav.sample.sample_rate == file.rate && info.wav.sample.channels == file.channels);
    CHECK(info.wav.sample.frames == file.frames && info.wav.bits == file.bits && info.file_bytes == file.bytes);
    CHECK(info.instance_bytes <= NOVA_AUDIO_STREAM_HEAP_LIMIT);
    CHECK(info.decoded_buffer_bytes == 65536 && info.worker_stack_bytes == NOVA_AUDIO_STREAM_WORKER_STACK);
    CHECK(state(s).state == NOVA_STREAM_PAUSED);
    return s;
}

static void all_frames(StreamFixture file, unsigned block_size)
{
    NovaAudioStream *s = open_file(file);
    ready(s, file.frames < 4096 ? file.frames : 4096);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = 1}, NOVA_AUDIO_CONTROL_OK);
    float data[NOVA_AUDIO_MAX_BLOCK * 2];
    for (uint32_t position = 0; position < file.frames;) {
        unsigned count = file.frames - position > block_size ? block_size : file.frames - position;
        ready(s, count);
        NovaAudioStreamRenderResult result = nova_audio_stream_render(s, data, count);
        CHECK(result == (position + count == file.frames ? NOVA_STREAM_RENDER_ENDED : NOVA_STREAM_RENDER_OK));
        for (unsigned i = 0; i < count; ++i) for (unsigned channel = 0; channel < 2; ++channel)
            CHECK(data[i * 2 + channel] == stream_value(file, position + i, file.channels == 1 ? 0 : channel));
        position += count;
    }
    NovaAudioStreamSnapshot snapshot = state(s);
    CHECK(snapshot.position == file.frames && snapshot.rendered_frames == file.frames);
    CHECK(!snapshot.underrun_frames && snapshot.state == NOVA_STREAM_ENDED);
    CHECK(nova_audio_stream_render(s, data, 127) == NOVA_STREAM_RENDER_ENDED);
    for (unsigned i = 0; i < 254; ++i) CHECK(data[i] == 0);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = 1}, NOVA_AUDIO_CONTROL_BUSY);
    CHECK(nova_audio_stream_close(&s, error, sizeof(error)) && !s);
}

static void transport_controls(void)
{
    StreamFixture file = stream_fixture(44100, 2, 32, 20000);
    NovaAudioStream *s = open_file(file);
    ready(s, 4096);
    NovaAudioStreamSnapshot snapshot = command(s,
        (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = 1, .fade_frames = 8}, NOVA_AUDIO_CONTROL_OK);
    float data[256 * 2];
    CHECK(nova_audio_stream_render(s, data, 17) == NOVA_STREAM_RENDER_OK);
    for (unsigned i = 0; i < 17; ++i) for (unsigned c = 0; c < 2; ++c)
        CHECK(data[i * 2 + c] == stream_value(file, i, c) * (i < 8 ? i / 8.0f : 1));
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_SEEK, .generation = 1, .frame = 1000}, NOVA_AUDIO_CONTROL_BUSY);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_PAUSE, .generation = 1, .fade_frames = 5}, NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_stream_render(s, data, 17) == NOVA_STREAM_RENDER_PAUSED);
    for (unsigned i = 0; i < 17; ++i) for (unsigned c = 0; c < 2; ++c) {
        float expected = i < 5 ? stream_value(file, i + 17, c) * (1 - i / 5.0f) : 0;
        CHECK(data[i * 2 + c] == expected);
    }
    snapshot = state(s);
    CHECK(snapshot.position == 22 && snapshot.completed_command == snapshot.last_command);
    CHECK(nova_audio_stream_render(s, data, 17) == NOVA_STREAM_RENDER_PAUSED);
    CHECK(state(s).position == 22);
    snapshot = command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_SEEK, .generation = 1, .frame = 17000},
        NOVA_AUDIO_CONTROL_OK);
    CHECK(snapshot.position == 17000 && snapshot.generation > 1);
    uint64_t generation = snapshot.generation;
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = 1}, NOVA_AUDIO_CONTROL_STALE);
    ready(s, 256);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = generation}, NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_stream_render(s, data, 256) == NOVA_STREAM_RENDER_OK);
    for (unsigned i = 0; i < 256; ++i) CHECK(data[i * 2] == stream_value(file, i + 17000, 0));
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_CANCEL, .generation = generation, .fade_frames = 7},
        NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_stream_render(s, data, 20) == NOVA_STREAM_RENDER_CANCELLED);
    snapshot = state(s);
    CHECK(snapshot.position == 17263 && snapshot.generation > generation);
    generation = snapshot.generation;
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = generation}, NOVA_AUDIO_CONTROL_BUSY);
    snapshot = command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_REGION, .generation = generation,
        .frame = 1019, .end_frame = 1046, .loop = true}, NOVA_AUDIO_CONTROL_OK);
    generation = snapshot.generation;
    ready(s, 108);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = generation}, NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_stream_render(s, data, 108) == NOVA_STREAM_RENDER_OK);
    for (unsigned i = 0; i < 108; ++i) for (unsigned c = 0; c < 2; ++c)
        CHECK(data[i * 2 + c] == stream_value(file, 1019 + i % 27, c));
    snapshot = state(s);
    CHECK(snapshot.position == 1019 && snapshot.loops == 4 && !snapshot.underrun_frames);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_PAUSE, .generation = generation}, NOVA_AUDIO_CONTROL_OK);
    snapshot = command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_SEEK, .generation = generation, .frame = 1044},
        NOVA_AUDIO_CONTROL_OK);
    generation = snapshot.generation;
    ready(s, 256);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = generation}, NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_stream_render(s, data, 108) == NOVA_STREAM_RENDER_OK);
    for (unsigned i = 0; i < 108; ++i) for (unsigned c = 0; c < 2; ++c)
        CHECK(data[i * 2 + c] == stream_value(file, 1019 + (25 + i) % 27, c));
    snapshot = state(s);
    CHECK(snapshot.position == 1044 && snapshot.loops == 8);
    snapshot = command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_PAUSE, .generation = generation, .fade_frames = 7},
        NOVA_AUDIO_CONTROL_OK);
    uint64_t pause = snapshot.last_command;
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_CANCEL, .generation = generation, .fade_frames = 7},
        NOVA_AUDIO_CONTROL_BUSY);
    CHECK(nova_audio_stream_render(s, data, 7) == NOVA_STREAM_RENDER_PAUSED);
    snapshot = state(s);
    CHECK(snapshot.position == 1024 && snapshot.completed_command == pause && snapshot.loops == 9);
    CHECK(nova_audio_stream_close(&s, error, sizeof(error)));
    CHECK(!unlink(file.path));
}

static void full_length(void)
{
    StreamFixture file = stream_fixture(48000, 2, 32, 75 * 48000);
    CHECK(file.bytes > NOVA_AUDIO_WAV_INPUT_LIMIT && file.frames > 60 * file.rate);
    all_frames(file, 4096);
    printf("Disk source: %llu bytes, %u frames at %u Hz; heap <=%u, PCM buffer 65536 bytes.\n",
        (unsigned long long)file.bytes, file.frames, file.rate, NOVA_AUDIO_STREAM_HEAP_LIMIT);
    CHECK(!unlink(file.path));
}

static void end_and_short_loops(void)
{
    StreamFixture file = stream_fixture(48000, 2, 32, 8);
    NovaAudioStream *s = open_file(file);
    ready(s, 8);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = 1}, NOVA_AUDIO_CONTROL_OK);
    float output[NOVA_AUDIO_MAX_BLOCK * 2];
    CHECK(nova_audio_stream_render(s, output, 7) == NOVA_STREAM_RENDER_OK);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_PAUSE, .generation = 1, .fade_frames = 1}, NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_stream_render(s, output, 1) == NOVA_STREAM_RENDER_ENDED);
    NovaAudioStreamSnapshot snapshot = state(s);
    CHECK(snapshot.position == 8 && snapshot.completed_command == snapshot.last_command);
    snapshot = command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_PAUSE, .generation = 1}, NOVA_AUDIO_CONTROL_OK);
    CHECK(snapshot.state == NOVA_STREAM_ENDED);
    snapshot = command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_SEEK, .generation = 1, .frame = 8}, NOVA_AUDIO_CONTROL_OK);
    CHECK(snapshot.state == NOVA_STREAM_ENDED && snapshot.position == 8);
    snapshot = command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_SEEK, .generation = snapshot.generation, .frame = 2},
        NOVA_AUDIO_CONTROL_OK);
    ready(s, 6);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = snapshot.generation}, NOVA_AUDIO_CONTROL_OK);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_CANCEL, .generation = snapshot.generation, .fade_frames = 100},
        NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_stream_render(s, output, 64) == NOVA_STREAM_RENDER_CANCELLED);
    snapshot = state(s);
    CHECK(snapshot.position == 8 && snapshot.completed_command == snapshot.last_command);
    snapshot = command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_REGION, .generation = snapshot.generation,
        .frame = 3, .end_frame = 4, .loop = true}, NOVA_AUDIO_CONTROL_OK);
    CHECK(ready(s, 8192).buffered_frames == 8192);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = snapshot.generation}, NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_stream_render(s, output, 4096) == NOVA_STREAM_RENDER_OK);
    for (unsigned i = 0; i < 4096; ++i) for (unsigned c = 0; c < 2; ++c)
        CHECK(output[i * 2 + c] == stream_value(file, 3, c));
    snapshot = state(s);
    CHECK(snapshot.position == 3 && snapshot.loops == 4096 && !snapshot.underrun_frames);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_PAUSE, .generation = snapshot.generation}, NOVA_AUDIO_CONTROL_OK);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_SEEK, .generation = snapshot.generation, .frame = 4},
        NOVA_AUDIO_CONTROL_INVALID);
    uint64_t ticket = 123;
    CHECK(nova_audio_stream_command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_SEEK, .generation = snapshot.generation,
        .frame = 9}, &ticket) == NOVA_AUDIO_CONTROL_INVALID && ticket == 123);
    CHECK(nova_audio_stream_command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_REGION, .generation = snapshot.generation,
        .frame = 3, .end_frame = 3}, &ticket) == NOVA_AUDIO_CONTROL_INVALID && ticket == 123);
    float unchanged = 99;
    CHECK(nova_audio_stream_render(s, &unchanged, NOVA_AUDIO_MAX_BLOCK + 1) == NOVA_STREAM_RENDER_INVALID && unchanged == 99);
    CHECK(nova_audio_stream_close(&s, error, sizeof(error)) && !unlink(file.path));
}

static void looping_blocks(void)
{
    StreamFixture file = stream_fixture(44100, 2, 32, 16000);
    const unsigned blocks[] = {1, 127, 4096};
    for (unsigned test = 0; test < 3; ++test) {
        NovaAudioStream *s = open_file(file);
        NovaAudioStreamSnapshot snapshot = command(s,
            (NovaAudioStreamCommand){.type = NOVA_STREAM_REGION, .generation = 1, .frame = 13, .end_frame = 9017, .loop = true},
            NOVA_AUDIO_CONTROL_OK);
        command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = snapshot.generation}, NOVA_AUDIO_CONTROL_OK);
        float output[NOVA_AUDIO_MAX_BLOCK * 2];
        for (unsigned position = 0; position < 29000;) {
            unsigned count = 29000 - position > blocks[test] ? blocks[test] : 29000 - position;
            ready(s, count);
            CHECK(nova_audio_stream_render(s, output, count) == NOVA_STREAM_RENDER_OK);
            for (unsigned i = 0; i < count; ++i) for (unsigned c = 0; c < 2; ++c)
                CHECK(output[i * 2 + c] == stream_value(file, 13 + (position + i) % 9004, c));
            position += count;
        }
        snapshot = state(s);
        CHECK(snapshot.loops == 3 && snapshot.position == 13 + 29000 % 9004 && !snapshot.underrun_frames);
        CHECK(nova_audio_stream_close(&s, error, sizeof(error)));
    }
    CHECK(!unlink(file.path));
}

static void malformed_sources(void)
{
    StreamFixture file = stream_fixture(8000, 1, 8, 2051);
    int fd = open(file.path, O_RDWR);
    CHECK(fd >= 0);
    unsigned char original[44], changed[44];
    CHECK(pread(fd, original, 44, 0) == 44);
    const size_t offsets[] = {0, 4, 8, 12, 16, 20, 22, 24, 28, 32, 34, 36, 40};
    NovaAudioStream *s = NULL;
    for (unsigned i = 0; i < sizeof(offsets) / sizeof(*offsets); ++i) {
        memcpy(changed, original, 44); changed[offsets[i]] ^= 4;
        CHECK(pwrite(fd, changed, 44, 0) == 44);
        CHECK(!nova_audio_stream_open(file.path, &s, error, sizeof(error)) && !s && *error);
    }
    CHECK(pwrite(fd, original, 44, 0) == 44);
    unsigned char bad_pad = 7;
    CHECK(pwrite(fd, &bad_pad, 1, (off_t)file.bytes - 1) == 1);
    CHECK(!nova_audio_stream_open(file.path, &s, error, sizeof(error)) && !s && strstr(error, "padding"));
    uint32_t too_long = 8000 * NOVA_AUDIO_STREAM_MAX_SECONDS + 1;
    uint64_t total = 44 + (uint64_t)too_long + (too_long & 1);
    stream_put(original + 4, (uint32_t)total - 8, 4);
    stream_put(original + 40, too_long, 4);
    CHECK(!ftruncate(fd, (off_t)total) && pwrite(fd, original, 44, 0) == 44);
    CHECK(!nova_audio_stream_open(file.path, &s, error, sizeof(error)) && !s && strstr(error, "budget"));
    uint32_t limit = too_long - 1;
    stream_put(original + 4, limit + 36, 4); stream_put(original + 40, limit, 4);
    CHECK(!ftruncate(fd, (off_t)limit + 44) && pwrite(fd, original, 44, 0) == 44);
    CHECK(nova_audio_stream_open(file.path, &s, error, sizeof(error)));
    CHECK(nova_audio_stream_info(s).wav.sample.frames == limit);
    NovaAudioStreamSnapshot snapshot = command(s,
        (NovaAudioStreamCommand){.type = NOVA_STREAM_SEEK, .generation = 1, .frame = limit - 1}, NOVA_AUDIO_CONTROL_OK);
    ready(s, 1);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = snapshot.generation}, NOVA_AUDIO_CONTROL_OK);
    float tail[2];
    CHECK(nova_audio_stream_render(s, tail, 1) == NOVA_STREAM_RENDER_ENDED && tail[0] == -1 && tail[1] == -1);
    CHECK(state(s).position == limit && nova_audio_stream_close(&s, error, sizeof(error)));
    CHECK(!close(fd));
    char link[4096], fifo[4096];
    CHECK(snprintf(link, sizeof(link), "%s.link", file.path) < (int)sizeof(link));
    CHECK(snprintf(fifo, sizeof(fifo), "%s.fifo", file.path) < (int)sizeof(fifo));
    CHECK(!symlink(file.path, link));
    CHECK(!nova_audio_stream_open(link, &s, error, sizeof(error)) && !s && *error);
    CHECK(!mkfifo(fifo, 0600));
    CHECK(!nova_audio_stream_open(fifo, &s, error, sizeof(error)) && !s && strstr(error, "regular"));
    CHECK(!unlink(link) && !unlink(fifo) && !unlink(file.path));
}

int main(void)
{
    const unsigned rates[] = {8000, 44100, 48000, 44100};
    const unsigned bits[] = {8, 16, 24, 32};
    for (unsigned i = 0; i < 4; ++i) {
        StreamFixture file = stream_fixture(rates[i], i % 2 + 1, bits[i], 2051);
        all_frames(file, 127);
        all_frames(file, 1024);
        CHECK(!unlink(file.path));
    }
    transport_controls();
    end_and_short_loops();
    looping_blocks();
    malformed_sources();
    full_length();
    puts("Nova disk-backed original-rate PCM, exact pause/seek/loop/end and bounded long playback passed.");
    return 0;
}
