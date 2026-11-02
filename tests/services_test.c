#include "assets.h"
#include "audio_device.h"

#include <math.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/resource.h>
#include <unistd.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #c); exit(1); } } while (0)

static void put(unsigned char *p, unsigned value)
{
    for (int i = 0; i < 4; ++i) p[i] = (unsigned char)(value >> (i * 8));
}

static void wav_bytes(unsigned char *bytes, size_t size)
{
    memset(bytes, 128, size);
    memcpy(bytes, "RIFF", 4); put(bytes + 4, (unsigned)size - 8);
    memcpy(bytes + 8, "WAVEfmt ", 8); put(bytes + 16, 16);
    bytes[20] = 1; bytes[21] = 0; bytes[22] = 1; bytes[23] = 0;
    put(bytes + 24, 8000); put(bytes + 28, 8000);
    bytes[32] = 1; bytes[33] = 0; bytes[34] = 8; bytes[35] = 0;
    memcpy(bytes + 36, "data", 4); put(bytes + 40, (unsigned)size - 44);
}

static void write_file(const char *path, const void *bytes, size_t size)
{
    FILE *file = fopen(path, "wb");
    CHECK(file && fwrite(bytes, 1, size, file) == size && !fclose(file));
}

static bool missing(void *context, const char *key, unsigned char *data, size_t *length,
    bool *found, char *error, size_t error_size)
{
    (void)context; (void)key; (void)data; (void)error; (void)error_size;
    *length = 0; *found = false;
    return true;
}

typedef struct { size_t count; NovaEffect effects[NOVA_MAX_EFFECTS]; bool fail; } Effects;

static bool capture(void *context, const NovaEffect *effect, char *error, size_t error_size)
{
    Effects *effects = context;
    if (effects->fail) { snprintf(error, error_size, "injected native I/O failure"); return false; }
    CHECK(effects->count < NOVA_MAX_EFFECTS);
    effects->effects[effects->count++] = *effect;
    return true;
}

static bool load(NovaEngine *engine, const char *script, const NovaAsset *assets, size_t count)
{
    return nova_load_with_assets(engine, script, strlen(script), "service-test.lua", assets, count);
}

static void engine_services(void)
{
    NovaAsset assets[] = {
        {.id = "a", .type = NOVA_ASSET_SPRITE}, {.id = "b", .type = NOVA_ASSET_SPRITE},
        {.id = "tone", .type = NOVA_ASSET_AUDIO}, {.id = "model", .type = NOVA_ASSET_MODEL}
    };
    Effects effects = {0};
    NovaEngine *engine = nova_create();
    CHECK(engine);
    nova_set_service_host(engine, (NovaServiceHost){&effects, true, missing, capture});
    const char *script = "local a,b=nova.asset('a'),nova.asset('b')\n"
        "local timer=nova.timer(0.05,true); local once=nova.timer(0.1)\n"
        "local x=nova.tween(0,100,0.1); local y=nova.tween(100,0,0.1,'smooth')\n"
        "local f=nova.frames({a,b},0.05,true); local total=0\n"
        "function update(dt)\n"
        " total=total+dt; local expired=nova.timer_poll(timer)\n"
        " assert(expired == (total>=0.05-1e-9 and 1 or 0)); if expired==1 then total=total-0.05 end\n"
        " local vx,done=nova.tween_value(x); local vy=nova.tween_value(y)\n"
        " nova.sprite(f,vx,vy,10,10); nova.rectangle(nova.timer_poll(once),done and 1 or 0,1,1,0,0,0)\n"
        "end";
    CHECK(load(engine, script, assets, 4));
    CHECK(nova_tick(engine, 0, (NovaInput){0}));
    CHECK(nova_frame(engine)->commands[0].asset == 0);
    for (int i = 1; i <= 6; ++i) {
        CHECK(nova_tick(engine, 1.0 / 60, (NovaInput){0}));
        const NovaFrame *frame = nova_frame(engine);
        CHECK(frame->commands[0].asset == (i < 3 || i == 6 ? 0u : 1u));
        CHECK(fabsf(frame->commands[0].position.x - (float)(i * 100.0 / 6)) < 0.001f);
        CHECK(frame->commands[1].position.x == (i == 6 ? 1 : 0));
        CHECK(frame->commands[1].position.y == (i == 6 ? 1 : 0));
    }
    CHECK(nova_tick(engine, 0.05, (NovaInput){0}));
    CHECK(nova_frame(engine)->commands[0].position.x == 100);
    CHECK(nova_frame(engine)->commands[1].position.x == 0);
    CHECK(load(engine, "local t=nova.timer(1/60,true); function update(dt)"
        "assert(nova.timer_poll(t)==(dt==0 and 0 or 3)) end", assets, 4));
    CHECK(nova_tick(engine, 0, (NovaInput){0}) && nova_tick(engine, 0.05, (NovaInput){0}));
    CHECK(load(engine, "local f=nova.frames({nova.asset('a'),nova.asset('b')},0.05); "
        "function update() nova.sprite(f,0,0,1,1) end", assets, 4));
    for (int i = 0; i < 5; ++i) CHECK(nova_tick(engine, 0.05, (NovaInput){0}));
    CHECK(nova_frame(engine)->commands[0].asset == 1);
    const char *valid = "assert(nova.save_get('Score')==nil); nova.save_set('Score','a\\0b');"
        "assert(nova.save_get('Score')=='a\\0b'); nova.play(nova.asset('tone'),0.25,true);"
        "function update() nova.stop(nova.asset('tone')) end";
    CHECK(load(engine, valid, assets, 4));
    CHECK(effects.count == 0);
    CHECK(nova_tick(engine, 0, (NovaInput){0}) && nova_dispatch_effects(engine));
    CHECK(effects.count == 3 && effects.effects[0].type == NOVA_WRITE_SAVE);
    CHECK(effects.effects[0].length == 3 && effects.effects[0].data[1] == 0);
    CHECK(effects.effects[1].type == NOVA_PLAY_AUDIO && effects.effects[1].asset == 2 &&
        effects.effects[1].volume == 0.25f && effects.effects[1].loop);
    CHECK(effects.effects[2].type == NOVA_STOP_AUDIO);
    effects = (Effects){0};
    CHECK(load(engine, "nova.save_set('a','b'); function update() error('discard effects') end", assets, 4));
    CHECK(!nova_tick(engine, 0, (NovaInput){0}) && effects.count == 0);
    CHECK(!nova_dispatch_effects(engine));
    const char *invalid[] = {
        "nova.timer(0)", "nova.timer('1')", "nova.timer(0/0)", "nova.timer(3601)",
        "nova.timer(1,1)", "nova.timer(1,true,3)", "nova.tween(0,1,1,'cubic')",
        "nova.tween(0,1,1,'linear\\0bad')",
        "nova.tween(0,math.huge,1)", "nova.tween_value(nova.timer(1))",
        "nova.timer_poll(nova.tween(0,1,1))", "nova.cancel(1)",
        "local t=nova.timer(1); nova.cancel(t); nova.timer_poll(t)",
        "nova.frames({},1)", "nova.frames({nova.asset('tone')},1)",
        "nova.frames({nova.asset('a'),x=nova.asset('b')},1)",
        "nova.sprite(nova.timer(1),0,0,1,1)", "nova.play(nova.asset('a'),1)",
        "nova.play(nova.asset('tone'),1.01)", "nova.play(nova.asset('tone'),1,'true')",
        "nova.stop(nova.asset('model'))", "nova.save_get('../score')",
        "nova.save_get('a\\0b')", "nova.save_set('a',42)",
        "nova.save_set('a',string.rep('x',4097))",
        "local ts={}; for i=1,65 do ts[i]=nova.timer(1) end",
        "for i=1,17 do nova.save_set('a','b') end",
        "for i=1,17 do nova.save_get('a') end"
    };
    for (size_t i = 0; i < sizeof(invalid) / sizeof(*invalid); ++i) {
        char text[512];
        snprintf(text, sizeof(text), "%s; function update() end", invalid[i]);
        CHECK(!load(engine, text, assets, 4));
        CHECK(*nova_error(engine));
    }
    CHECK(load(engine, "local old=nova.timer(1); nova.cancel(old); local fresh=nova.timer(1);"
        "old=nil; collectgarbage(); function update() assert(nova.timer_poll(fresh)==0) end", assets, 4));
    CHECK(nova_tick(engine, 0, (NovaInput){0}));
    CHECK(load(engine, "nova.play(nova.asset('tone'),1); function update() end", assets, 4));
    effects.fail = true;
    CHECK(!nova_dispatch_effects(engine) && strstr(nova_error(engine), "injected native I/O failure"));
    nova_set_service_host(engine, (NovaServiceHost){0});
    CHECK(!load(engine, "nova.save_set('a','b'); function update() end", assets, 4));
    CHECK(strstr(nova_error(engine), "v2 project"));
    CHECK(load(engine, "local t=nova.timer(0.1); function update() assert(nova.timer_poll(t)==0) end", assets, 4));
    CHECK(nova_tick(engine, 0, (NovaInput){0}));
    nova_destroy(engine);
}

static void save_tests(void)
{
    char base[] = NOVA_TEST_DIRECTORY "/service-save.XXXXXX";
    CHECK(mkdtemp(base));
    char error[1024], path[NOVA_SAVE_ROOT_CAPACITY], lower_path[NOVA_SAVE_ROOT_CAPACITY];
    NovaSaveStore store, other;
    CHECK(nova_save_store_init(&store, base, "Case", error, sizeof(error)));
    CHECK(nova_save_store_init(&other, base, "case", error, sizeof(error)));
    CHECK(strcmp(store.identity, other.identity));
    unsigned char data[NOVA_SAVE_DATA_LIMIT], value[] = {'a', 0, 'b'};
    size_t length;
    bool found;
    CHECK(nova_save_read(&store, "Key", data, &length, &found, error, sizeof(error)) && !found);
    snprintf(path, sizeof(path), "%s/NovaStudio", base);
    CHECK(access(path, F_OK) != 0);
    CHECK(nova_save_write(&store, "Key", value, sizeof(value), error, sizeof(error)));
    CHECK(nova_save_write(&store, "key", (const unsigned char *)"lower", 5, error, sizeof(error)));
    CHECK(nova_save_write(&other, "Key", (const unsigned char *)"other", 5, error, sizeof(error)));
    CHECK(nova_save_read(&store, "Key", data, &length, &found, error, sizeof(error)));
    CHECK(found && length == 3 && !memcmp(data, value, 3));
    struct rlimit old_limit, limited;
    CHECK(!getrlimit(RLIMIT_FSIZE, &old_limit));
    limited = old_limit; limited.rlim_cur = 13;
    void (*old_signal)(int) = signal(SIGXFSZ, SIG_IGN);
    CHECK(old_signal != SIG_ERR && !setrlimit(RLIMIT_FSIZE, &limited));
    bool write_failed = !nova_save_write(&store, "Key", (const unsigned char *)"replacement", 11, error, sizeof(error));
    CHECK(!setrlimit(RLIMIT_FSIZE, &old_limit) && signal(SIGXFSZ, old_signal) != SIG_ERR);
    CHECK(write_failed && strstr(error, "write/sync"));
    CHECK(nova_save_read(&store, "Key", data, &length, &found, error, sizeof(error)));
    CHECK(found && length == 3 && !memcmp(data, value, 3));
    CHECK(nova_save_read(&store, "key", data, &length, &found, error, sizeof(error)));
    CHECK(found && length == 5 && !memcmp(data, "lower", 5));
    NovaSaveStore reload;
    CHECK(nova_save_store_init(&reload, base, "Case", error, sizeof(error)));
    CHECK(nova_save_read(&reload, "Key", data, &length, &found, error, sizeof(error)) && found);
    CHECK(nova_save_read(&other, "Key", data, &length, &found, error, sizeof(error)));
    CHECK(found && length == 5 && !memcmp(data, "other", 5));
    CHECK(!nova_save_write(&store, "../escape", value, 3, error, sizeof(error)));
    CHECK(!nova_save_write(&store, "Key", data, sizeof(data) + 1, error, sizeof(error)));
    /* Occupy all bounded candidate names: a failed write must leave the prior value. */
    unsigned first = store.temporary + 1;
    for (unsigned i = first; i < first + 8; ++i) {
        snprintf(path, sizeof(path), "%s/NovaStudio/projects/%s/.tmp-%ld-%u",
            base, store.identity, (long)getpid(), i);
        write_file(path, "", 0);
    }
    CHECK(!nova_save_write(&store, "Key", (const unsigned char *)"replacement", 11, error, sizeof(error)));
    CHECK(strstr(error, "candidate"));
    CHECK(nova_save_read(&store, "Key", data, &length, &found, error, sizeof(error)));
    CHECK(found && length == 3 && !memcmp(data, value, 3));
    for (unsigned i = first; i < first + 8; ++i) {
        snprintf(path, sizeof(path), "%s/NovaStudio/projects/%s/.tmp-%ld-%u",
            base, store.identity, (long)getpid(), i);
        CHECK(!unlink(path));
    }
    memset(data, 42, sizeof(data));
    CHECK(nova_save_write(&store, "Key", data, sizeof(data), error, sizeof(error)));
    CHECK(nova_save_read(&store, "Key", data, &length, &found, error, sizeof(error)) && length == sizeof(data));
    for (int i = 0; i < NOVA_SAVE_KEY_LIMIT - 2; ++i) {
        char key[32];
        snprintf(key, sizeof(key), "k%d", i);
        CHECK(nova_save_write(&store, key, value, 3, error, sizeof(error)));
    }
    CHECK(!nova_save_write(&store, "overflow", value, 3, error, sizeof(error)));
    CHECK(strstr(error, "32"));
    CHECK(nova_save_write(&store, "Key", NULL, 0, error, sizeof(error)));
    CHECK(nova_save_read(&store, "Key", data, &length, &found, error, sizeof(error)) && found && !length);
    snprintf(path, sizeof(path), "%s/NovaStudio/projects/%s/4b6579.sav", base, store.identity);
    write_file(path, "NOVASV2\n", 8);
    CHECK(!nova_save_read(&store, "Key", data, &length, &found, error, sizeof(error)) && *error);
    CHECK(!unlink(path));
    snprintf(lower_path, sizeof(lower_path), "%s/NovaStudio/projects/%s/6b6579.sav", base, store.identity);
    CHECK(!symlink(lower_path, path));
    CHECK(!nova_save_read(&store, "Key", data, &length, &found, error, sizeof(error)));
    CHECK(!nova_save_write(&store, "Key", value, 3, error, sizeof(error)));
    CHECK(!unlink(path));
    for (int i = 0; i < NOVA_SAVE_KEY_LIMIT - 2; ++i) {
        char key[32], encoded[64];
        snprintf(key, sizeof(key), "k%d", i);
        size_t j = 0;
        for (; key[j]; ++j) snprintf(encoded + j * 2, 3, "%02x", (unsigned char)key[j]);
        snprintf(path, sizeof(path), "%s/NovaStudio/projects/%s/%s.sav", base, store.identity, encoded);
        CHECK(!unlink(path));
    }
    CHECK(!unlink(lower_path));
    snprintf(path, sizeof(path), "%s/NovaStudio/projects/%s", base, store.identity);
    CHECK(!rmdir(path));
    snprintf(path, sizeof(path), "%s/NovaStudio/projects/%s/4b6579.sav", base, other.identity);
    CHECK(!unlink(path));
    snprintf(path, sizeof(path), "%s/NovaStudio/projects/%s", base, other.identity);
    CHECK(!rmdir(path));
    snprintf(lower_path, sizeof(lower_path), "%s/NovaStudio/projects/%s", base, store.identity);
    CHECK(!symlink(path, lower_path));
    CHECK(!nova_save_read(&store, "Key", data, &length, &found, error, sizeof(error)));
    CHECK(!nova_save_write(&store, "Key", value, 3, error, sizeof(error)));
    CHECK(!unlink(lower_path));
    snprintf(path, sizeof(path), "%s/NovaStudio/projects", base); CHECK(!rmdir(path));
    snprintf(path, sizeof(path), "%s/NovaStudio", base); CHECK(!rmdir(path));
    CHECK(!rmdir(base));
}

static void wav_tests(void)
{
    unsigned char bytes[844], changed[844];
    wav_bytes(bytes, sizeof(bytes));
    Wave wave;
    char error[1024];
    CHECK(!IsAudioDeviceReady());
    CHECK(nova_decode_wav(bytes, sizeof(bytes), &wave, error, sizeof(error)));
    CHECK(wave.sampleRate == 8000 && wave.channels == 1 && wave.frameCount == 800);
    UnloadWave(wave);
    memcpy(changed, bytes, sizeof(bytes));
    changed[22] = 2; changed[34] = 16; changed[32] = 4; put(changed + 28, 32000);
    CHECK(nova_decode_wav(changed, sizeof(changed), &wave, error, sizeof(error)));
    CHECK(wave.channels == 2 && wave.frameCount == 200 && wave.sampleSize == 16);
    UnloadWave(wave);
    const size_t positions[] = {0, 4, 8, 16, 20, 22, 24, 28, 32, 34, 36, 40};
    for (size_t i = 0; i < sizeof(positions) / sizeof(*positions); ++i) {
        memcpy(changed, bytes, sizeof(bytes)); changed[positions[i]] ^= 4;
        CHECK(!nova_decode_wav(changed, sizeof(changed), &wave, error, sizeof(error)));
        CHECK(*error && !wave.data);
    }
    CHECK(!nova_decode_wav(bytes, 43, &wave, error, sizeof(error)));
    CHECK(!nova_decode_wav(bytes, sizeof(bytes) - 1, &wave, error, sizeof(error)));
    CHECK(!IsAudioDeviceReady());
}

static NovaAudioTransportSnapshot await_native_transport(NovaAudioTransportHandle handle, uint64_t ticket, bool cancelled)
{
    bool accepted = false;
    NovaAudioTransportSnapshot latest = {0};
    for (unsigned attempt = 0; attempt < 400; ++attempt) {
        NovaAudioReceipt receipt;
        NovaAudioTransportSnapshot snapshot;
        bool has_receipt, has_snapshot;
        CHECK(nova_audio_device_poll(handle, &receipt, &has_receipt, &snapshot, &has_snapshot) == NOVA_AUDIO_CONTROL_OK);
        if (has_receipt) {
            CHECK(receipt.ticket == ticket && receipt.result == NOVA_AUDIO_CONTROL_OK);
            accepted = true;
        }
        if (has_snapshot) latest = snapshot;
        if (accepted && latest.current.clock && latest.current.cancelled == cancelled &&
            (!cancelled || latest.current.finished)) return latest;
        usleep(5000);
    }
    CHECK(false);
    return latest;
}

static NovaAudioStreamSnapshot await_native_file(NovaAudioTransportHandle handle, uint64_t ticket,
    NovaAudioStreamState expected)
{
    bool accepted = false;
    for (unsigned attempt = 0; attempt < 400; ++attempt) {
        NovaAudioStreamReceipt receipt;
        NovaAudioStreamSnapshot snapshot;
        bool has_receipt, has_snapshot;
        CHECK(nova_audio_device_file_poll(handle, &receipt, &has_receipt, &snapshot, &has_snapshot) == NOVA_AUDIO_CONTROL_OK);
        if (has_receipt) {
            CHECK(receipt.ticket == ticket && receipt.result == NOVA_AUDIO_CONTROL_OK);
            accepted = true;
        }
        if (accepted && has_snapshot && snapshot.state == expected && snapshot.buffered_frames &&
            (expected != NOVA_STREAM_PLAYING || snapshot.rendered_frames)) return snapshot;
        usleep(5000);
    }
    CHECK(false);
    return (NovaAudioStreamSnapshot){0};
}

static void native_transports(NovaAudioTransportHandle *audition, NovaAudioTransportHandle *game, const char *silent_wav)
{
    char error[512];
    CHECK(nova_audio_device_open(NOVA_AUDIO_AUDITION, 48000, audition, error, sizeof(error)) == NOVA_AUDIO_CONTROL_OK);
    CHECK(nova_audio_device_open(NOVA_AUDIO_GAME, 44100, game, error, sizeof(error)) == NOVA_AUDIO_CONTROL_OK);
    NovaAudioBus master = {NOVA_AUDIO_NO_BUS, 1, 0};
    NovaAudioProgramDesc desc = {.sample_rate = 48000, .voice_limit = 1, .length_frames = 48000,
        .loop = true, .buses = &master, .bus_count = 1};
    NovaAudioProgram *program = NULL;
    CHECK(nova_audio_program_create(&desc, &program, error, sizeof(error)));
    uint64_t first, second, cancelled;
    CHECK(nova_audio_device_replace(*audition, program, 128, &first) == NOVA_AUDIO_CONTROL_OK);
    nova_audio_program_release(program);
    desc.sample_rate = 44100; desc.length_frames = 44100;
    CHECK(nova_audio_program_create(&desc, &program, error, sizeof(error)));
    CHECK(nova_audio_device_replace(*game, program, 128, &second) == NOVA_AUDIO_CONTROL_OK);
    nova_audio_program_release(program);
    CHECK(await_native_transport(*audition, first, false).program == first);
    CHECK(await_native_transport(*game, second, false).program == second);
    CHECK(nova_audio_device_command(*audition, NOVA_AUDIO_CANCEL, first, 128, &cancelled) == NOVA_AUDIO_CONTROL_OK);
    CHECK(await_native_transport(*audition, cancelled, true).program == first);
    NovaAudioDeviceInfo info = nova_audio_device_info();
    CHECK(info.initialized && info.started && info.configuration_known && info.callback_observed);
    CHECK(info.mixer_channels == 2 && info.mixer_format == NOVA_DEVICE_FORMAT_F32 && info.mixer_rate);
    CHECK(!info.hardware_latency_known && !info.underruns_known);
    CHECK(nova_audio_device_close(*audition) == NOVA_AUDIO_CONTROL_OK);
    NovaAudioStreamInfo source;
    CHECK(nova_audio_device_open_file(NOVA_AUDIO_AUDITION, silent_wav, audition, &source,
        error, sizeof(error)) == NOVA_AUDIO_CONTROL_OK);
    CHECK(source.wav.sample.sample_rate == 8000);
    uint64_t region, resume, pause;
    CHECK(nova_audio_device_file_command(*audition, (NovaAudioStreamCommand){.type = NOVA_STREAM_REGION,
        .generation = 1, .end_frame = source.wav.sample.frames, .loop = true}, &region) == NOVA_AUDIO_CONTROL_OK);
    CHECK(await_native_file(*audition, region, NOVA_STREAM_PAUSED).position == 0);
    CHECK(nova_audio_device_file_command(*audition, (NovaAudioStreamCommand){.type = NOVA_STREAM_RESUME,
        .generation = region, .fade_frames = 16}, &resume) == NOVA_AUDIO_CONTROL_OK);
    await_native_file(*audition, resume, NOVA_STREAM_PLAYING);
    CHECK(nova_audio_device_file_command(*audition, (NovaAudioStreamCommand){.type = NOVA_STREAM_PAUSE,
        .generation = region, .fade_frames = 16}, &pause) == NOVA_AUDIO_CONTROL_OK);
    CHECK(await_native_file(*audition, pause, NOVA_STREAM_PAUSED).completed_command == pause);
}

static void project_services(bool audio)
{
    char base[] = NOVA_TEST_DIRECTORY "/service-project.XXXXXX";
    CHECK(mkdtemp(base));
    char manifest[4096], script[4096], wav[4096], path[4096], error[1024];
    snprintf(manifest, sizeof(manifest), "%s/nova.project", base);
    snprintf(script, sizeof(script), "%s/main.lua", base);
    snprintf(wav, sizeof(wav), "%s/tone.wav", base);
    unsigned char bytes[844]; wav_bytes(bytes, sizeof(bytes)); write_file(wav, bytes, sizeof(bytes));
    const char *declarations = "nova-project 2\nidentity ServiceTest\nentry main.lua\n"
        "audio tone tone.wav\naudio alias tone.wav\n";
    write_file(manifest, declarations, strlen(declarations));
    const char *preflight = "assert(nova.save_get('Score')==nil); nova.save_set('Score','preflight');"
        "assert(nova.save_get('Score')=='preflight'); nova.play(nova.asset('tone'),0,true);"
        "function update() nova.stop(nova.asset('alias')) end";
    write_file(script, preflight, strlen(preflight));
    char *old_home = getenv("HOME") ? strdup(getenv("HOME")) : NULL;
    CHECK(!setenv("HOME", base, 1));
    NovaProjectValidation validation;
    CHECK(nova_validate_project(manifest, &validation, error, sizeof(error)));
    CHECK(validation.project.version == 2 && !strcmp(validation.project.identity, "ServiceTest"));
    CHECK(validation.assets[1].resource_index == 0 && validation.assets[0].sample_frames == 800);
    CHECK(!IsAudioDeviceReady());
    snprintf(path, sizeof(path), "%s/Library", base);
    CHECK(access(path, F_OK) != 0);
    CHECK(!mkdir(path, 0700));
    snprintf(path, sizeof(path), "%s/Library/Application Support", base);
    CHECK(!mkdir(path, 0700));
    NovaSaveStore fake_live;
    CHECK(nova_save_store_init(&fake_live, path, "ServiceTest", error, sizeof(error)));
    CHECK(nova_save_write(&fake_live, "Score", (const unsigned char *)"live-save", 9, error, sizeof(error)));
    CHECK(nova_validate_project(manifest, &validation, error, sizeof(error)));
    unsigned char saved[4096];
    size_t saved_size;
    bool saved_found;
    CHECK(nova_save_read(&fake_live, "Score", saved, &saved_size, &saved_found, error, sizeof(error)));
    CHECK(saved_found && saved_size == 9 && !memcmp(saved, "live-save", 9));
    snprintf(path, sizeof(path), "%s/Library/Application Support/NovaStudio/projects/%s/53636f7265.sav",
        base, fake_live.identity);
    write_file(path, "corrupt", 7);
    CHECK(nova_validate_project(manifest, &validation, error, sizeof(error)));
    CHECK(!unlink(path));
    snprintf(path, sizeof(path), "%s/Library/Application Support/NovaStudio/projects/%s", base, fake_live.identity);
    CHECK(!rmdir(path));
    snprintf(path, sizeof(path), "%s/Library/Application Support/NovaStudio/projects", base); CHECK(!rmdir(path));
    snprintf(path, sizeof(path), "%s/Library/Application Support/NovaStudio", base); CHECK(!rmdir(path));
    snprintf(path, sizeof(path), "%s/Library/Application Support", base); CHECK(!rmdir(path));
    snprintf(path, sizeof(path), "%s/Library", base); CHECK(!rmdir(path));
    const char *bad = "nova.play(nova.asset('tone'),2); function update() end";
    write_file(script, bad, strlen(bad));
    NovaProjectValidation retained = validation;
    CHECK(!nova_validate_project(manifest, &validation, error, sizeof(error)));
    CHECK(!memcmp(&validation, &retained, sizeof(validation)) && strstr(error, "volume"));
    const char *empty = "function update() end";
    write_file(script, empty, strlen(empty));
    const size_t long_size = 44 + 60 * 8000;
    unsigned char *long_wave = malloc(long_size);
    CHECK(long_wave);
    wav_bytes(long_wave, long_size);
    snprintf(path, sizeof(path), "%s/long_a.wav", base); write_file(path, long_wave, long_size);
    snprintf(path, sizeof(path), "%s/long_b.wav", base); write_file(path, long_wave, long_size);
    free(long_wave);
    const char *over_budget = "nova-project 2\nidentity ServiceTest\nentry main.lua\n"
        "audio a long_a.wav\naudio b long_b.wav\naudio c tone.wav\n";
    write_file(manifest, over_budget, strlen(over_budget));
    CHECK(!nova_validate_project(manifest, &validation, error, sizeof(error)) && strstr(error, "120 seconds"));
    const char *cached_budget = "nova-project 2\nidentity ServiceTest\nentry main.lua\n"
        "audio a long_a.wav\naudio b long_a.wav\naudio c long_a.wav\n";
    write_file(manifest, cached_budget, strlen(cached_budget));
    CHECK(nova_validate_project(manifest, &validation, error, sizeof(error)));
    CHECK(validation.assets[2].resource_index == 0 && validation.assets[2].sample_frames == 480000);
    snprintf(path, sizeof(path), "%s/long_a.wav", base); CHECK(!unlink(path));
    snprintf(path, sizeof(path), "%s/long_b.wav", base); CHECK(!unlink(path));
    write_file(manifest, declarations, strlen(declarations));
    if (old_home) { CHECK(!setenv("HOME", old_home, 1)); free(old_home); }
    else CHECK(!unsetenv("HOME"));
    if (audio) {
        NovaAudioTransportHandle audition, game;
        native_transports(&audition, &game, wav);
        const char *playback = "nova.play(nova.asset('tone'),0,true);"
            "local t=nova.timer(1); function update() assert(nova.timer_poll(t)==0) end";
        write_file(script, playback, strlen(playback));
        NovaEngine *engine = NULL;
        NovaResources resources = {0};
        CHECK(nova_open_scene(&engine, &resources, manifest, true, error, sizeof(error)));
        CHECK(IsAudioDeviceReady() && IsSoundValid(resources.resources[0].sound));
        CHECK(!resources.resources[1].owned && resources.services->looping[0]);
        CHECK(IsSoundPlaying(resources.resources[0].sound));
        nova_pause_services(&resources, true);
        CHECK(!IsSoundPlaying(resources.resources[0].sound) && resources.services->resume[0]);
        nova_pause_services(&resources, false);
        CHECK(IsSoundPlaying(resources.resources[0].sound));
        NovaEngine *old = engine;
        void *buffer = resources.resources[0].sound.stream.buffer;
        const char *failure = "nova.play(nova.asset('tone'),0); function update() error('staging failure') end";
        write_file(script, failure, strlen(failure));
        CHECK(!nova_open_scene(&engine, &resources, manifest, true, error, sizeof(error)));
        CHECK(engine == old && resources.resources[0].sound.stream.buffer == buffer);
        CHECK(IsSoundPlaying(resources.resources[0].sound));
        const char *stop = "function update() nova.stop(nova.asset('alias')) end";
        write_file(script, stop, strlen(stop));
        CHECK(nova_open_scene(&engine, &resources, manifest, true, error, sizeof(error)));
        CHECK(!resources.services->looping[0] && !IsSoundPlaying(resources.resources[0].sound));
        CHECK(nova_tick(engine, 1.0 / 60, (NovaInput){0}) && nova_tick_services(engine, &resources));
        CHECK(nova_save_store_init(&resources.services->saves, base, "ServiceTest", error, sizeof(error)));
        resources.services->initialized = true;
        const char *save_script = "local i=0; function update() i=i+1; "
            "local old=nova.save_get('Native'); assert((i==1 and old==nil) or (i>1 and old=='saved'));"
            "nova.save_set('Native','saved') end";
        CHECK(load(engine, save_script, retained.project.assets, retained.project.count));
        CHECK(nova_tick(engine, 1.0 / 60, (NovaInput){0}) && nova_tick_services(engine, &resources));
        CHECK(nova_tick(engine, 1.0 / 60, (NovaInput){0}) && nova_tick_services(engine, &resources));
        CHECK(nova_save_read(&resources.services->saves, "Native", saved, &saved_size, &saved_found, error, sizeof(error)));
        CHECK(saved_found && saved_size == 5 && !memcmp(saved, "saved", 5));
        snprintf(path, sizeof(path), "%s/NovaStudio/projects/%s/4e6174697665.sav", base, resources.services->saves.identity);
        CHECK(!unlink(path));
        snprintf(path, sizeof(path), "%s/NovaStudio/projects/%s", base, resources.services->saves.identity);
        CHECK(!rmdir(path));
        snprintf(path, sizeof(path), "%s/NovaStudio/projects", base); CHECK(!rmdir(path));
        snprintf(path, sizeof(path), "%s/NovaStudio", base); CHECK(!rmdir(path));
        nova_destroy(engine); nova_unload_resources(&resources);
        CHECK(!resources.services && !resources.count);
        nova_shutdown_audio();
        CHECK(!IsAudioDeviceReady());
        CHECK(nova_audio_device_close(audition) == NOVA_AUDIO_CONTROL_STALE);
        CHECK(nova_audio_device_close(game) == NOVA_AUDIO_CONTROL_STALE);
    }
    CHECK(!unlink(manifest) && !unlink(script) && !unlink(wav) && !rmdir(base));
}

typedef struct {
    NovaSaveStore store;
    unsigned plays, writes;
} DemoHost;

static bool demo_read(void *context, const char *key, unsigned char *data, size_t *length,
    bool *found, char *error, size_t error_size)
{
    DemoHost *host = context;
    return nova_save_read(&host->store, key, data, length, found, error, error_size);
}

static bool demo_effect(void *context, const NovaEffect *effect, char *error, size_t error_size)
{
    DemoHost *host = context;
    if (effect->type == NOVA_WRITE_SAVE) {
        host->writes++;
        return nova_save_write(&host->store, effect->key, effect->data, effect->length, error, error_size);
    }
    CHECK(effect->type == NOVA_PLAY_AUDIO && effect->asset == 2 && effect->volume == 0.2f && !effect->loop);
    host->plays++;
    return true;
}

static void services_demo(void)
{
    char error[1024];
    NovaProjectValidation validation;
    CHECK(!IsAudioDeviceReady());
    CHECK(nova_validate_project(NOVA_EXAMPLES "/services/nova.project", &validation, error, sizeof(error)));
    CHECK(validation.project.version == 2 && !strcmp(validation.project.identity, "nova-demo-services-v1"));
    CHECK(validation.project.count == 3 && validation.assets[0].width == 24 && validation.assets[1].height == 24);
    CHECK(validation.assets[2].declaration.type == NOVA_ASSET_AUDIO &&
        validation.assets[2].sample_rate == 16000 && validation.assets[2].sample_frames == 2560);
    CHECK(!IsAudioDeviceReady());
    int script_size;
    unsigned char *script = nova_read_file(NOVA_EXAMPLES "/services/main.lua",
        NOVA_ASSET_FILE_LIMIT, &script_size, error, sizeof(error));
    CHECK(script);
    char directory[] = NOVA_TEST_DIRECTORY "/services-demo.XXXXXX";
    CHECK(mkdtemp(directory));
    DemoHost host = {0};
    CHECK(nova_save_store_init(&host.store, directory, validation.project.identity, error, sizeof(error)));
    NovaEngine *engine = nova_create();
    CHECK(engine);
    nova_set_service_host(engine, (NovaServiceHost){&host, true, demo_read, demo_effect});
    CHECK(nova_load_with_assets(engine, (const char *)script, (size_t)script_size,
        "services-demo.lua", validation.project.assets, validation.project.count));
    CHECK(nova_tick(engine, 0, (NovaInput){0}) && nova_dispatch_effects(engine));
    bool seen[2] = {false, false};
    for (int i = 0; i < 240; ++i) {
        CHECK(nova_tick(engine, 1.0 / 60, (NovaInput){0}) && nova_dispatch_effects(engine));
        const NovaFrame *frame = nova_frame(engine);
        CHECK(frame->commands[3].type == NOVA_SPRITE && frame->commands[3].asset < 2);
        seen[frame->commands[3].asset] = true;
    }
    CHECK(seen[0] && seen[1] && host.plays == 0 && host.writes == 0);
    CHECK(strstr(nova_frame(engine)->commands[4].text, "Timer: 4 seconds / Saved actions: 0"));
    CHECK(nova_frame(engine)->commands[3].position.x > 64 && nova_frame(engine)->commands[3].position.x < 800);
    char path[NOVA_SAVE_ROOT_CAPACITY];
    snprintf(path, sizeof(path), "%s/NovaStudio", directory);
    CHECK(access(path, F_OK) != 0);
    for (int i = 0; i < 10; ++i)
        CHECK(nova_tick(engine, 1.0 / 60, (NovaInput){.action = true}) && nova_dispatch_effects(engine));
    CHECK(host.plays == 1 && host.writes == 1);
    CHECK(nova_tick(engine, 1.0 / 60, (NovaInput){0}) && nova_dispatch_effects(engine));
    CHECK(nova_tick(engine, 1.0 / 60, (NovaInput){.action = true}) && nova_dispatch_effects(engine));
    CHECK(host.plays == 2 && host.writes == 2);
    CHECK(nova_load_with_assets(engine, (const char *)script, (size_t)script_size,
        "services-demo-reload.lua", validation.project.assets, validation.project.count));
    CHECK(nova_tick(engine, 0, (NovaInput){0}) && nova_dispatch_effects(engine));
    CHECK(host.plays == 2 && host.writes == 2);
    CHECK(strstr(nova_frame(engine)->commands[4].text, "Timer: 0 seconds / Saved actions: 2"));
    CHECK(nova_frame(engine)->commands[3].position.x == 64);
    CHECK(nova_save_write(&host.store, "activations", (const unsigned char *)"invalid", 7, error, sizeof(error)));
    CHECK(!nova_load_with_assets(engine, (const char *)script, (size_t)script_size,
        "services-demo-corrupt.lua", validation.project.assets, validation.project.count));
    CHECK(strstr(nova_error(engine), "demo activation save"));
    nova_destroy(engine);
    UnloadFileData(script);
    snprintf(path, sizeof(path), "%s/NovaStudio/projects/%s/61637469766174696f6e73.sav", directory, host.store.identity);
    CHECK(!unlink(path));
    snprintf(path, sizeof(path), "%s/NovaStudio/projects/%s", directory, host.store.identity); CHECK(!rmdir(path));
    snprintf(path, sizeof(path), "%s/NovaStudio/projects", directory); CHECK(!rmdir(path));
    snprintf(path, sizeof(path), "%s/NovaStudio", directory); CHECK(!rmdir(path));
    CHECK(!rmdir(directory));
    CHECK(!IsAudioDeviceReady());
}

int main(int argc, char **argv)
{
    bool audio = argc == 2 && !strcmp(argv[1], "--audio");
    CHECK(argc == 1 || audio);
    engine_services();
    save_tests();
    wav_tests();
    project_services(audio);
    services_demo();
    puts("Nova bounded timers/playback, native WAV and isolated atomic saves passed.");
    return 0;
}
