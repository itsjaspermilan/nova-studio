#undef calloc
#undef free
#undef open
#undef close
#undef pread
#undef fstat
#undef pthread_create
#undef pthread_join
#undef snprintf
#undef nova_wav_decode

#include "stream.h"
#include "wav_internal.h"
#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <pthread.h>
#include <sched.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #c); exit(1); } } while (0)
#include "audio_stream_fixture.h"

static _Thread_local bool rendering;
static size_t live_bytes, peak_bytes, allocations;
static void *owned;
static unsigned descriptors, workers;
static bool fail_allocation, fail_create, fail_join, fail_close;
static atomic_bool hold_next, in_read, release_read, join_requested, fail_read_once, interrupt_once, short_reads, eof_once;
static atomic_bool fail_stat_once;
static atomic_bool stop_render, close_finished;
static atomic_uint read_calls, decode_calls, render_calls;
static char error[512];

void *nova_stream_test_calloc(size_t count, size_t size)
{
    CHECK(!rendering);
    if (fail_allocation) return NULL;
    CHECK(!owned && count == 1 && size <= NOVA_AUDIO_STREAM_HEAP_LIMIT);
    owned = calloc(count, size);
    CHECK(owned);
    live_bytes = size;
    if (live_bytes > peak_bytes) peak_bytes = live_bytes;
    ++allocations;
    return owned;
}

void nova_stream_test_free(void *pointer)
{
    CHECK(!rendering);
    if (!pointer) return;
    CHECK(pointer == owned && live_bytes);
    free(pointer); owned = NULL; live_bytes = 0;
}

int nova_stream_test_open(const char *path, int flags, ...)
{
    CHECK(!rendering);
    int fd = open(path, flags);
    if (fd >= 0) ++descriptors;
    return fd;
}

int nova_stream_test_close(int fd)
{
    CHECK(!rendering && descriptors);
    int result = close(fd);
    CHECK(!result);
    --descriptors;
    if (fail_close) { errno = EIO; return -1; }
    return result;
}

ssize_t nova_stream_test_pread(int fd, void *bytes, size_t size, off_t offset)
{
    CHECK(!rendering);
    if (offset >= 56) {
        atomic_fetch_add_explicit(&read_calls, 1, memory_order_relaxed);
        if (atomic_exchange_explicit(&hold_next, false, memory_order_acq_rel)) {
            atomic_store_explicit(&in_read, true, memory_order_release);
            while (!atomic_load_explicit(&release_read, memory_order_acquire)) sched_yield();
            atomic_store_explicit(&in_read, false, memory_order_release);
        }
        if (atomic_exchange_explicit(&interrupt_once, false, memory_order_acq_rel)) { errno = EINTR; return -1; }
        if (atomic_exchange_explicit(&fail_read_once, false, memory_order_acq_rel)) { errno = EIO; return -1; }
        if (atomic_exchange_explicit(&eof_once, false, memory_order_acq_rel)) return 0;
        if (atomic_load_explicit(&short_reads, memory_order_acquire) && size > 37) size = 37;
    }
    return pread(fd, bytes, size, offset);
}

int nova_stream_test_fstat(int fd, struct stat *info)
{
    CHECK(!rendering);
    if (atomic_exchange_explicit(&fail_stat_once, false, memory_order_acq_rel)) { errno = EIO; return -1; }
    return fstat(fd, info);
}

int nova_stream_test_pthread_create(pthread_t *thread, const pthread_attr_t *attributes,
    void *(*function)(void *), void *context)
{
    CHECK(!rendering);
    if (fail_create) return EAGAIN;
    size_t stack;
    CHECK(!pthread_attr_getstacksize(attributes, &stack) && stack == NOVA_AUDIO_STREAM_WORKER_STACK);
    int result = pthread_create(thread, attributes, function, context);
    if (!result) ++workers;
    return result;
}

int nova_stream_test_pthread_join(pthread_t thread, void **result)
{
    CHECK(!rendering && workers);
    atomic_store_explicit(&join_requested, true, memory_order_release);
    if (fail_join) return EDEADLK;
    int code = pthread_join(thread, result);
    if (!code) --workers;
    return code;
}

int nova_stream_test_snprintf(char *output, size_t size, const char *format, ...)
{
    CHECK(!rendering);
    va_list arguments;
    va_start(arguments, format);
    int result = vsnprintf(output, size, format, arguments);
    va_end(arguments);
    return result;
}

bool nova_stream_test_decode(const unsigned char *bytes, size_t frames, const NovaAudioWavInfo *info,
    float *output, bool stereo, size_t *bad_frame)
{
    CHECK(!rendering);
    atomic_fetch_add_explicit(&decode_calls, 1, memory_order_relaxed);
    return nova_wav_decode(bytes, frames, info, output, stereo, bad_frame);
}

static NovaAudioStreamRenderResult render(NovaAudioStream *s, float *output, size_t frames)
{
    rendering = true;
    NovaAudioStreamRenderResult result = nova_audio_stream_render(s, output, frames);
    rendering = false;
    return result;
}

static NovaAudioStreamSnapshot state(NovaAudioStream *s)
{
    NovaAudioStreamSnapshot snapshot;
    CHECK(nova_audio_stream_snapshot(s, &snapshot));
    return snapshot;
}

static void wait_read(void)
{
    while (!atomic_load_explicit(&in_read, memory_order_acquire)) sched_yield();
}

static void hold_read(void)
{
    atomic_store_explicit(&release_read, false, memory_order_release);
    atomic_store_explicit(&hold_next, true, memory_order_release);
    atomic_store_explicit(&join_requested, false, memory_order_release);
}

static void balance(void) { CHECK(!owned && !live_bytes && !workers && !descriptors); }

static NovaAudioStream *open_file(StreamFixture file)
{
    NovaAudioStream *s = NULL;
    CHECK(nova_audio_stream_open(file.path, &s, error, sizeof(error)));
    CHECK(s && live_bytes == nova_audio_stream_info(s).instance_bytes);
    return s;
}

static NovaAudioStreamSnapshot command(NovaAudioStream *s, NovaAudioStreamCommand value,
    NovaAudioControlResult expected)
{
    uint64_t ticket;
    CHECK(nova_audio_stream_command(s, value, &ticket) == NOVA_AUDIO_CONTROL_OK);
    render(s, NULL, 0);
    NovaAudioStreamReceipt receipt;
    CHECK(nova_audio_stream_receipt(s, &receipt) && receipt.ticket == ticket && receipt.result == expected);
    return state(s);
}

static NovaAudioStreamSnapshot await_buffer(NovaAudioStream *s, unsigned frames)
{
    for (unsigned i = 0; i < 5000; ++i) {
        CHECK(render(s, NULL, 0) != NOVA_STREAM_RENDER_FAULT);
        NovaAudioStreamSnapshot snapshot = state(s);
        if (snapshot.buffered_frames >= frames) return snapshot;
        const struct timespec delay = {.tv_nsec = 1000000};
        nanosleep(&delay, NULL);
    }
    CHECK(false);
    return (NovaAudioStreamSnapshot){0};
}

static NovaAudioStreamSnapshot await_fault(NovaAudioStream *s, NovaAudioStreamFault fault)
{
    for (unsigned i = 0; i < 5000; ++i) {
        render(s, NULL, 0);
        NovaAudioStreamSnapshot snapshot = state(s);
        if (snapshot.fault) {
            CHECK(snapshot.fault == fault && snapshot.state == NOVA_STREAM_FAULTED);
            return snapshot;
        }
        const struct timespec delay = {.tv_nsec = 1000000};
        nanosleep(&delay, NULL);
    }
    CHECK(false);
    return (NovaAudioStreamSnapshot){0};
}

static void opening_and_retirement(StreamFixture file)
{
    NovaAudioStream *s = NULL;
    fail_allocation = true;
    CHECK(!nova_audio_stream_open(file.path, &s, error, sizeof(error)) && !s && *error);
    fail_allocation = false; balance();
    fail_create = true;
    CHECK(!nova_audio_stream_open(file.path, &s, error, sizeof(error)) && !s && strstr(error, "reader"));
    fail_create = false; balance();
    char missing[4096];
    CHECK(snprintf(missing, sizeof(missing), "%s.missing", file.path) < (int)sizeof(missing));
    CHECK(!nova_audio_stream_open(missing, &s, error, sizeof(error)) && !s && *error);
    balance();
    s = open_file(file);
    fail_join = true;
    CHECK(!nova_audio_stream_close(&s, error, sizeof(error)) && s && live_bytes && workers && descriptors);
    CHECK(strstr(error, "ownership retained"));
    uint64_t ticket = 123;
    CHECK(nova_audio_stream_command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = 1},
        &ticket) == NOVA_AUDIO_CONTROL_INVALID && ticket == 123);
    fail_join = false;
    CHECK(nova_audio_stream_close(&s, error, sizeof(error)) && !s);
    balance();
    s = open_file(file);
    fail_close = true;
    CHECK(!nova_audio_stream_close(&s, error, sizeof(error)) && !s && strstr(error, "descriptor close"));
    fail_close = false; balance();
}

static void starvation_and_stale_work(StreamFixture file)
{
    hold_read();
    NovaAudioStream *s = open_file(file);
    wait_read();
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = 1}, NOVA_AUDIO_CONTROL_OK);
    float output[128 * 2];
    CHECK(render(s, output, 64) == NOVA_STREAM_RENDER_STARVED);
    for (unsigned i = 0; i < 128; ++i) CHECK(output[i] == 0);
    CHECK(render(s, output, 16) == NOVA_STREAM_RENDER_STARVED);
    NovaAudioStreamSnapshot snapshot = state(s);
    CHECK(!snapshot.position && !snapshot.rendered_frames && snapshot.underrun_frames == 80 && snapshot.underrun_episodes == 1);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_PAUSE, .generation = 1, .fade_frames = 8}, NOVA_AUDIO_CONTROL_OK);
    CHECK(render(s, output, 8) == NOVA_STREAM_RENDER_STARVED);
    CHECK(state(s).state == NOVA_STREAM_PAUSED);
    snapshot = command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_SEEK, .generation = 1, .frame = 19000},
        NOVA_AUDIO_CONTROL_OK);
    atomic_store_explicit(&fail_read_once, true, memory_order_release);
    atomic_store_explicit(&release_read, true, memory_order_release);
    uint64_t generation = snapshot.generation;
    await_buffer(s, 128);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = generation}, NOVA_AUDIO_CONTROL_OK);
    CHECK(render(s, output, 128) == NOVA_STREAM_RENDER_OK);
    for (unsigned i = 0; i < 128; ++i) CHECK(output[i * 2] == stream_value(file, 19000 + i, 0));
    snapshot = state(s);
    CHECK(!snapshot.fault && snapshot.underrun_frames == 88 && snapshot.underrun_episodes == 1);
    CHECK(nova_audio_stream_close(&s, error, sizeof(error)));
    balance();
}

static void full_queues(StreamFixture file)
{
    NovaAudioStream *s = open_file(file);
    uint64_t ticket;
    for (unsigned i = 0; i < NOVA_AUDIO_COMMAND_CAPACITY; ++i)
        CHECK(nova_audio_stream_command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_PAUSE, .generation = 1},
            &ticket) == NOVA_AUDIO_CONTROL_OK);
    uint64_t unchanged = ticket;
    CHECK(nova_audio_stream_command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = 1},
        &ticket) == NOVA_AUDIO_CONTROL_QUEUE_FULL && ticket == unchanged);
    render(s, NULL, 0);
    for (unsigned i = 0; i < NOVA_AUDIO_COMMAND_CAPACITY; ++i)
        CHECK(nova_audio_stream_command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = 1},
            &ticket) == NOVA_AUDIO_CONTROL_OK);
    render(s, NULL, 0);
    CHECK(state(s).state == NOVA_STREAM_PAUSED);
    for (unsigned i = 0; i < NOVA_AUDIO_COMMAND_CAPACITY; ++i) {
        NovaAudioStreamReceipt receipt;
        CHECK(nova_audio_stream_receipt(s, &receipt) && receipt.ticket == i + 2 && receipt.result == NOVA_AUDIO_CONTROL_OK);
    }
    render(s, NULL, 0);
    CHECK(state(s).state == NOVA_STREAM_PLAYING);
    CHECK(nova_audio_stream_close(&s, error, sizeof(error)));
    balance();
}

static void failures(StreamFixture file)
{
    hold_read();
    NovaAudioStream *s = open_file(file);
    wait_read();
    atomic_store_explicit(&fail_read_once, true, memory_order_release);
    atomic_store_explicit(&release_read, true, memory_order_release);
    NovaAudioStreamSnapshot snapshot = await_fault(s, NOVA_STREAM_READ_FAILED);
    CHECK(snapshot.system_error == EIO && !snapshot.fault_frame);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = 1}, NOVA_AUDIO_CONTROL_RENDER_FAILED);
    CHECK(nova_audio_stream_close(&s, error, sizeof(error)));
    balance();
    hold_read();
    s = open_file(file);
    wait_read();
    atomic_store_explicit(&fail_stat_once, true, memory_order_release);
    atomic_store_explicit(&release_read, true, memory_order_release);
    snapshot = await_fault(s, NOVA_STREAM_READ_FAILED);
    CHECK(snapshot.system_error == EIO && !snapshot.fault_frame);
    CHECK(nova_audio_stream_close(&s, error, sizeof(error)));
    balance();
    atomic_store_explicit(&eof_once, true, memory_order_release);
    s = open_file(file);
    snapshot = await_fault(s, NOVA_STREAM_READ_FAILED);
    CHECK(!snapshot.system_error && !snapshot.fault_frame);
    CHECK(nova_audio_stream_close(&s, error, sizeof(error)));
    balance();

    StreamFixture changed = stream_fixture(48000, 2, 32, 20000);
    hold_read(); s = open_file(changed); wait_read();
    CHECK(!truncate(changed.path, 56));
    atomic_store_explicit(&release_read, true, memory_order_release);
    await_fault(s, NOVA_STREAM_SOURCE_CHANGED);
    CHECK(nova_audio_stream_close(&s, error, sizeof(error)));
    balance();
    CHECK(!unlink(changed.path));

    StreamFixture invalid = stream_fixture(48000, 2, 32, 24000);
    int fd = open(invalid.path, O_WRONLY);
    CHECK(fd >= 0);
    unsigned char nan[4] = {0, 0, 0xc0, 0x7f};
    CHECK(pwrite(fd, nan, sizeof(nan), 56 + 10000 * 8) == 4 && !close(fd));
    s = open_file(invalid);
    await_buffer(s, 8192);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = 1}, NOVA_AUDIO_CONTROL_OK);
    float output[4096 * 2];
    CHECK(render(s, output, 4096) == NOVA_STREAM_RENDER_OK);
    snapshot = await_fault(s, NOVA_STREAM_INVALID_PCM);
    CHECK(snapshot.fault_frame == 10000 && !snapshot.system_error);
    CHECK(render(s, output, 4096) == NOVA_STREAM_RENDER_FAULT);
    for (unsigned i = 0; i < 8192; ++i) CHECK(output[i] == 0);
    CHECK(nova_audio_stream_close(&s, error, sizeof(error)));
    balance();
    CHECK(!unlink(invalid.path));
}

typedef struct { NovaAudioStream *stream; bool closed; } Closing;

static void *close_worker(void *context)
{
    Closing *closing = context;
    char diagnostic[512];
    closing->closed = nova_audio_stream_close(&closing->stream, diagnostic, sizeof(diagnostic));
    atomic_store_explicit(&close_finished, true, memory_order_release);
    return NULL;
}

static void close_inflight(StreamFixture file)
{
    hold_read();
    atomic_store_explicit(&close_finished, false, memory_order_release);
    Closing closing = {.stream = open_file(file)};
    wait_read();
    for (unsigned i = 0; i < NOVA_AUDIO_COMMAND_CAPACITY; ++i) {
        uint64_t ticket;
        CHECK(nova_audio_stream_command(closing.stream, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME,
            .generation = 1}, &ticket) == NOVA_AUDIO_CONTROL_OK);
    }
    pthread_t thread;
    CHECK(!pthread_create(&thread, NULL, close_worker, &closing));
    while (!atomic_load_explicit(&join_requested, memory_order_acquire)) sched_yield();
    CHECK(atomic_load_explicit(&in_read, memory_order_acquire) && !atomic_load_explicit(&close_finished, memory_order_acquire));
    atomic_store_explicit(&release_read, true, memory_order_release);
    CHECK(!pthread_join(thread, NULL));
    CHECK(closing.closed && !closing.stream);
    balance();
}

static void *render_worker(void *context)
{
    NovaAudioStream *s = context;
    float output[127 * 2];
    while (!atomic_load_explicit(&stop_render, memory_order_acquire)) {
        NovaAudioStreamRenderResult result = render(s, output, 127);
        CHECK(result != NOVA_STREAM_RENDER_FAULT && result != NOVA_STREAM_RENDER_INVALID);
        for (unsigned i = 0; i < 254; ++i) CHECK(isfinite(output[i]));
        atomic_fetch_add_explicit(&render_calls, 1, memory_order_relaxed);
    }
    return NULL;
}

static NovaAudioStreamReceipt concurrent_command(NovaAudioStream *s, NovaAudioStreamCommand command_value)
{
    uint64_t ticket;
    CHECK(nova_audio_stream_command(s, command_value, &ticket) == NOVA_AUDIO_CONTROL_OK);
    NovaAudioStreamReceipt receipt;
    while (!nova_audio_stream_receipt(s, &receipt)) sched_yield();
    CHECK(receipt.ticket == ticket && receipt.result == NOVA_AUDIO_CONTROL_OK);
    return receipt;
}

static void concurrent_control(StreamFixture file)
{
    NovaAudioStream *s = open_file(file);
    atomic_store_explicit(&stop_render, false, memory_order_release);
    atomic_store_explicit(&short_reads, true, memory_order_release);
    atomic_store_explicit(&interrupt_once, true, memory_order_release);
    pthread_t thread;
    CHECK(!pthread_create(&thread, NULL, render_worker, s));
    uint64_t generation = 1, publication = 0;
    for (unsigned i = 0; i < 500; ++i) {
        concurrent_command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_PAUSE, .generation = generation});
        NovaAudioStreamReceipt receipt = concurrent_command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_REGION,
            .generation = generation, .frame = (i * 43) % 10000, .end_frame = 20000, .loop = true});
        generation = receipt.generation;
        concurrent_command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = generation, .fade_frames = 17});
        NovaAudioStreamSnapshot snapshot;
        if (nova_audio_stream_snapshot(s, &snapshot)) {
            CHECK(snapshot.publication > publication && !snapshot.fault && snapshot.generation <= generation);
            publication = snapshot.publication;
        }
    }
    atomic_store_explicit(&stop_render, true, memory_order_release);
    CHECK(!pthread_join(thread, NULL));
    CHECK(publication && atomic_load_explicit(&render_calls, memory_order_relaxed));
    CHECK(nova_audio_stream_close(&s, error, sizeof(error)));
    atomic_store_explicit(&short_reads, false, memory_order_release);
    balance();
}

static void bounded_long_source(void)
{
    StreamFixture file = stream_fixture(48000, 2, 32, 75 * 48000);
    size_t before = allocations;
    NovaAudioStream *s = open_file(file);
    CHECK(nova_audio_stream_info(s).instance_bytes == peak_bytes);
    NovaAudioStreamSnapshot snapshot = command(s,
        (NovaAudioStreamCommand){.type = NOVA_STREAM_SEEK, .generation = 1, .frame = file.frames - 1024}, NOVA_AUDIO_CONTROL_OK);
    await_buffer(s, 1024);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = snapshot.generation}, NOVA_AUDIO_CONTROL_OK);
    float output[1024 * 2];
    CHECK(render(s, output, 1024) == NOVA_STREAM_RENDER_ENDED);
    for (unsigned i = 0; i < 1024; ++i) CHECK(output[i * 2] == stream_value(file, file.frames - 1024 + i, 0));
    CHECK(allocations == before + 1);
    CHECK(nova_audio_stream_close(&s, error, sizeof(error)));
    balance();
    CHECK(!unlink(file.path));
}

static void partial_reads(StreamFixture file)
{
    unsigned before = atomic_load_explicit(&read_calls, memory_order_relaxed);
    atomic_store_explicit(&short_reads, true, memory_order_release);
    atomic_store_explicit(&interrupt_once, true, memory_order_release);
    NovaAudioStream *s = open_file(file);
    await_buffer(s, 4096);
    command(s, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME, .generation = 1}, NOVA_AUDIO_CONTROL_OK);
    float output[4096 * 2];
    CHECK(render(s, output, 4096) == NOVA_STREAM_RENDER_OK);
    for (unsigned i = 0; i < 4096; ++i) for (unsigned c = 0; c < 2; ++c)
        CHECK(output[i * 2 + c] == stream_value(file, i, c));
    CHECK(!atomic_load_explicit(&interrupt_once, memory_order_acquire));
    CHECK(atomic_load_explicit(&read_calls, memory_order_relaxed) - before > 100);
    CHECK(nova_audio_stream_close(&s, error, sizeof(error)));
    atomic_store_explicit(&short_reads, false, memory_order_release);
    balance();
}

int main(void)
{
    StreamFixture file = stream_fixture(48000, 2, 32, 30000);
    opening_and_retirement(file);
    starvation_and_stale_work(file);
    full_queues(file);
    failures(file);
    close_inflight(file);
    concurrent_control(file);
    partial_reads(file);
    bounded_long_source();
    CHECK(!unlink(file.path));
    CHECK(allocations && peak_bytes <= NOVA_AUDIO_STREAM_HEAP_LIMIT);
    CHECK(atomic_load_explicit(&decode_calls, memory_order_relaxed) && atomic_load_explicit(&read_calls, memory_order_relaxed));
    printf("Nova disk failures/concurrency: fixed %zu-byte heap, off-callback I/O/decode, balanced descriptors/threads/memory.\n", peak_bytes);
    return 0;
}
