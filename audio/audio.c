#include "audio.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PI 3.14159265358979323846
#define TABLE_SIZE 4096
#define TABLE_LEVELS 10
#define SINC_TAPS 64
#define SINC_PHASES 256
#define PITCH_UNIT UINT64_C(16777216)

struct NovaAudioSample {
    unsigned references;
    NovaAudioSampleInfo info;
    float data[];
};

typedef struct {
    NovaAudioPatch desc;
    double filter;
    float *sinc;
} Patch;

typedef struct {
    NovaAudioEvent desc;
    uint32_t slot;
} Event;

struct NovaAudioProgram {
    unsigned references;
    uint32_t rate, voice_limit;
    uint64_t length;
    bool loop;
    size_t sample_count, patch_count, bus_count, event_count;
    NovaAudioSample *samples[NOVA_AUDIO_MAX_SAMPLES];
    Patch patches[NOVA_AUDIO_MAX_PATCHES];
    NovaAudioBus buses[NOVA_AUDIO_MAX_BUSES];
    Event events[NOVA_AUDIO_MAX_EVENTS];
    float *tables;
};

typedef struct {
    double from, to;
    uint32_t length, position;
} Ramp;

typedef struct {
    bool active, released;
    uint32_t patch, bus, noise, release_frames;
    uint64_t age, release_age, sample_position;
    double phase, release_level, filter[2];
    Ramp gain, pan, frequency;
} Voice;

struct NovaAudioRenderer {
    NovaAudioProgram *program;
    uint64_t clock, position;
    size_t event;
    bool cancelled;
    NovaAudioResult fault;
    Voice voices[NOVA_AUDIO_MAX_VOICES];
    Ramp gain[NOVA_AUDIO_MAX_BUSES], pan[NOVA_AUDIO_MAX_BUSES];
    float peak[NOVA_AUDIO_MAX_BUSES][2];
    uint64_t over_frames[NOVA_AUDIO_MAX_BUSES];
};

typedef struct {
    uint32_t id, patch, slot;
    uint64_t start, end, off;
    bool released;
} Note;

static bool fail(char *error, size_t size, const char *message)
{
    if (error && size) snprintf(error, size, "%s", message);
    return false;
}

static bool event_fail(char *error, size_t size, size_t index, const char *message)
{
    if (error && size) snprintf(error, size, "audio event %zu: %s", index, message);
    return false;
}

static bool finite_range(double value, double minimum, double maximum)
{
    return isfinite(value) && value >= minimum && value <= maximum;
}

bool nova_audio_sample_create(const float *data, NovaAudioSampleInfo info,
    NovaAudioSample **out, char *error, size_t error_size)
{
    if (!data || !out || (info.channels != 1 && info.channels != 2) ||
        info.sample_rate < 8000 || info.sample_rate > 48000 || !info.frames ||
        info.frames > info.sample_rate * NOVA_AUDIO_SAMPLE_SECONDS)
        return fail(error, error_size, "sample requires mono/stereo data at 8000..48000 Hz, 0 < duration <= 60s");
    size_t count = (size_t)info.frames * info.channels;
    for (size_t i = 0; i < count; ++i)
        if (!finite_range(data[i], -NOVA_AUDIO_SAMPLE_PEAK_LIMIT, NOVA_AUDIO_SAMPLE_PEAK_LIMIT))
            return fail(error, error_size, "sample data must be finite and within +/-16; no clipping is performed");
    NovaAudioSample *sample = malloc(sizeof(*sample) + count * sizeof(float));
    if (!sample) return fail(error, error_size, "audio sample allocation failed");
    sample->references = 1;
    sample->info = info;
    memcpy(sample->data, data, count * sizeof(float));
    *out = sample;
    if (error && error_size) error[0] = '\0';
    return true;
}

void nova_audio_sample_release(NovaAudioSample *sample)
{
    if (sample && --sample->references == 0) free(sample);
}

NovaAudioSampleInfo nova_audio_sample_info(const NovaAudioSample *sample) { return sample->info; }
const float *nova_audio_sample_data(const NovaAudioSample *sample) { return sample->data; }

static bool pitch_valid(const NovaAudioProgram *program, uint32_t patch, double frequency)
{
    const NovaAudioPatch *p = &program->patches[patch].desc;
    if (p->source == NOVA_AUDIO_NOISE) return frequency == 0;
    if (p->source == NOVA_AUDIO_SAMPLER)
        return finite_range(frequency / p->sample_root_hz, 0.25, p->sample_max_ratio);
    return finite_range(frequency, 20, program->rate * 0.45);
}

static bool patches_valid(NovaAudioProgram *program, char *error, size_t size)
{
    for (size_t i = 0; i < program->patch_count; ++i) {
        Patch *prepared = &program->patches[i];
        const NovaAudioPatch *p = &prepared->desc;
        NovaAudioEnvelope e = p->envelope;
        if (p->source < NOVA_AUDIO_SINE || p->source > NOVA_AUDIO_SAMPLER ||
            !e.attack_frames || !e.release_frames ||
            e.attack_frames > program->rate * 60 || e.decay_frames > program->rate * 60 ||
            e.release_frames > program->rate * 60 || !finite_range(e.sustain, 0, 1) ||
            !(p->lowpass_hz == 0 || finite_range(p->lowpass_hz, 20, program->rate * 0.45)))
            return fail(error, size, "invalid patch source, envelope or low-pass frequency");
        prepared->filter = p->lowpass_hz == 0 ? 0 : exp(-2 * PI * p->lowpass_hz / program->rate);
        if (p->source == NOVA_AUDIO_SAMPLER &&
            (p->sample >= program->sample_count || p->sample_start >= p->sample_end ||
             p->sample_end > program->samples[p->sample]->info.frames ||
             !finite_range(p->sample_root_hz, 20, 20000) ||
             !finite_range(p->sample_max_ratio, 0.25, 4)))
            return fail(error, size, "invalid sampler reference, [start,end) range, root Hz or maximum pitch ratio");
    }
    return true;
}

static Note *find_note(Note *notes, size_t count, uint32_t id)
{
    for (size_t i = 0; i < count; ++i)
        if (notes[i].id == id) return &notes[i];
    return NULL;
}

static bool prepare_events(NovaAudioProgram *program, char *error, size_t size)
{
    Note *notes = calloc(program->event_count ? program->event_count : 1, sizeof(*notes));
    if (!notes) return fail(error, size, "audio scheduling allocation failed");
    bool ok = false;
    size_t count = 0;
    for (size_t i = 0; i < program->event_count; ++i) {
        const NovaAudioEvent *e = &program->events[i].desc;
        const char *reason = NULL;
        if (e->frame >= program->length || (i && e->frame < program->events[i - 1].desc.frame))
            reason = "frames must be sorted and inside [0,length)";
        else if (e->type < NOVA_AUDIO_NOTE_ON || e->type > NOVA_AUDIO_BUS_PAN)
            reason = "unknown event type";
        else if (e->type == NOVA_AUDIO_NOTE_ON) {
            NovaAudioNote n = e->note;
            if (!e->target || find_note(notes, count, e->target))
                reason = "note ID must be nonzero and unique for the entire score";
            else if (n.patch >= program->patch_count || n.bus >= program->bus_count ||
                     !finite_range(n.gain, 0, 4) || !finite_range(n.pan, -1, 1) ||
                     !pitch_valid(program, n.patch, n.frequency) ||
                     (program->patches[n.patch].desc.source == NOVA_AUDIO_NOISE && !n.seed))
                reason = "invalid note patch, bus, gain, pan, frequency or noise seed";
            else notes[count++] = (Note){.id = e->target, .patch = n.patch, .start = e->frame};
        } else if (e->type == NOVA_AUDIO_BUS_GAIN || e->type == NOVA_AUDIO_BUS_PAN) {
            if (e->target >= program->bus_count ||
                !finite_range(e->value, e->type == NOVA_AUDIO_BUS_GAIN ? 0 : -1,
                    e->type == NOVA_AUDIO_BUS_GAIN ? 4 : 1))
                reason = "invalid bus target or parameter";
        } else {
            Note *note = find_note(notes, count, e->target);
            if (!note) reason = "note event must follow its NOTE_ON";
            else if (e->type == NOVA_AUDIO_NOTE_OFF) {
                if (note->released || e->frame <= note->start)
                    reason = "each note needs one OFF strictly after ON";
                else {
                    note->released = true;
                    note->off = e->frame;
                    note->end = e->frame + program->patches[note->patch].desc.envelope.release_frames;
                    if (note->end > program->length) reason = "release tail exceeds score length";
                }
            } else if ((e->type == NOVA_AUDIO_VOICE_GAIN && !finite_range(e->value, 0, 4)) ||
                       (e->type == NOVA_AUDIO_VOICE_PAN && !finite_range(e->value, -1, 1)) ||
                       (e->type == NOVA_AUDIO_VOICE_PITCH &&
                        (program->patches[note->patch].desc.source == NOVA_AUDIO_NOISE ||
                         !pitch_valid(program, note->patch, e->value))))
                reason = "invalid voice parameter (white noise has no pitch control)";
        }
        if (!reason && e->type >= NOVA_AUDIO_VOICE_GAIN &&
            (!e->ramp_frames || e->ramp_frames > program->rate * 60 ||
             e->ramp_frames > program->length - e->frame))
            reason = "ramps need 1..60 seconds of frames and must finish within score length";
        if (reason) { event_fail(error, size, i, reason); goto done; }
    }
    uint64_t available[NOVA_AUDIO_MAX_VOICES] = {0};
    for (size_t i = 0; i < count; ++i) {
        if (!notes[i].released) { fail(error, size, "every note requires an OFF, including sampler notes"); goto done; }
        uint32_t slot = 0;
        while (slot < program->voice_limit && available[slot] > notes[i].start) ++slot;
        if (slot == program->voice_limit) { fail(error, size, "score exceeds voice limit including release tails; no stealing"); goto done; }
        notes[i].slot = slot;
        available[slot] = notes[i].end;
    }
    for (size_t i = 0; i < program->event_count; ++i) {
        Event *e = &program->events[i];
        if (e->desc.type >= NOVA_AUDIO_BUS_GAIN) continue;
        Note *note = find_note(notes, count, e->desc.target);
        if (e->desc.frame >= note->end) {
            event_fail(error, size, i, "event targets an ended note"); goto done;
        }
        if (e->desc.type >= NOVA_AUDIO_VOICE_GAIN &&
            e->desc.ramp_frames > note->end - e->desc.frame) {
            event_fail(error, size, i, "voice ramp extends beyond its release tail"); goto done;
        }
        e->slot = note->slot;
    }
    ok = true;
done:
    free(notes);
    return ok;
}

static float *table_at(NovaAudioProgram *program, unsigned shape, unsigned level)
{
    return program->tables + (shape * TABLE_LEVELS + level) * (TABLE_SIZE + 1);
}

static bool prepare_tables(NovaAudioProgram *program, char *error, size_t size)
{
    bool tonal = false;
    for (size_t i = 0; i < program->patch_count; ++i)
        if (program->patches[i].desc.source <= NOVA_AUDIO_TRIANGLE) tonal = true;
    if (tonal) {
        program->tables = calloc(3 * TABLE_LEVELS * (TABLE_SIZE + 1), sizeof(float));
        if (!program->tables) return fail(error, size, "oscillator table allocation failed");
        for (unsigned phase = 0; phase < TABLE_SIZE; ++phase) {
            double saw = 0, square = 0, triangle = 0;
            unsigned level = 0;
            for (unsigned harmonic = 1; harmonic <= (1u << (TABLE_LEVELS - 1)); ++harmonic) {
                double s = sin(2 * PI * phase * harmonic / TABLE_SIZE);
                saw -= 2 / PI * s / harmonic;
                if (harmonic & 1u) {
                    square += 4 / PI * s / harmonic;
                    triangle += 8 / (PI * PI) * ((harmonic & 3u) == 1 ? 1 : -1) * s / (harmonic * harmonic);
                }
                if (harmonic == (1u << level)) {
                    table_at(program, 0, level)[phase] = (float)saw;
                    table_at(program, 1, level)[phase] = (float)square;
                    table_at(program, 2, level)[phase] = (float)triangle;
                    ++level;
                }
            }
        }
        for (unsigned shape = 0; shape < 3; ++shape)
            for (unsigned level = 0; level < TABLE_LEVELS; ++level)
                table_at(program, shape, level)[TABLE_SIZE] = table_at(program, shape, level)[0];
    }
    for (size_t i = 0; i < program->patch_count; ++i) {
        Patch *p = &program->patches[i];
        if (p->desc.source != NOVA_AUDIO_SAMPLER) continue;
        p->sinc = malloc((SINC_PHASES + 1) * SINC_TAPS * sizeof(float));
        if (!p->sinc) return fail(error, size, "sampler reconstruction table allocation failed");
        double step = (double)program->samples[p->desc.sample]->info.sample_rate /
            program->rate * p->desc.sample_max_ratio;
        double cutoff = step <= 1 ? 0.5 : 0.45 / step;
        for (unsigned phase = 0; phase <= SINC_PHASES; ++phase) {
            double coefficients[SINC_TAPS], sum = 0;
            for (unsigned tap = 0; tap < SINC_TAPS; ++tap) {
                double x = (int)tap - (SINC_TAPS / 2 - 1) - (double)phase / SINC_PHASES;
                double window = 0.42 + 0.5 * cos(PI * x / (SINC_TAPS / 2)) +
                    0.08 * cos(2 * PI * x / (SINC_TAPS / 2));
                double sinc = fabs(x) < 1e-12 ? 2 * cutoff : sin(2 * PI * cutoff * x) / (PI * x);
                coefficients[tap] = window * sinc;
                sum += coefficients[tap];
            }
            for (unsigned tap = 0; tap < SINC_TAPS; ++tap)
                p->sinc[phase * SINC_TAPS + tap] = (float)(coefficients[tap] / sum);
        }
    }
    return true;
}

bool nova_audio_program_create(const NovaAudioProgramDesc *desc,
    NovaAudioProgram **out, char *error, size_t error_size)
{
    if (!desc || !out || (desc->sample_rate != 48000 && desc->sample_rate != 44100) ||
        !desc->voice_limit || desc->voice_limit > NOVA_AUDIO_MAX_VOICES ||
        !desc->length_frames || desc->length_frames > (uint64_t)desc->sample_rate * NOVA_AUDIO_MAX_SECONDS ||
        desc->sample_count > NOVA_AUDIO_MAX_SAMPLES || desc->patch_count > NOVA_AUDIO_MAX_PATCHES ||
        !desc->bus_count || desc->bus_count > NOVA_AUDIO_MAX_BUSES || desc->event_count > NOVA_AUDIO_MAX_EVENTS ||
        (desc->sample_count && !desc->samples) || (desc->patch_count && !desc->patches) ||
        !desc->buses || (desc->event_count && !desc->events))
        return fail(error, error_size, "invalid audio score rate, length, array or capacity (44.1/48 kHz, <=1 hour)");
    NovaAudioProgram *program = calloc(1, sizeof(*program));
    if (!program) return fail(error, error_size, "audio score allocation failed");
    program->references = 1;
    program->rate = desc->sample_rate;
    program->voice_limit = desc->voice_limit;
    program->length = desc->length_frames;
    program->loop = desc->loop;
    program->patch_count = desc->patch_count;
    program->bus_count = desc->bus_count;
    program->event_count = desc->event_count;
    double seconds = 0;
    for (size_t i = 0; i < desc->sample_count; ++i) {
        NovaAudioSample *sample = desc->samples[i];
        if (!sample) { fail(error, error_size, "null sample reference"); goto failed; }
        bool alias = false;
        for (size_t j = 0; j < i; ++j) if (desc->samples[j] == sample) alias = true;
        if (!alias) seconds += (double)sample->info.frames / sample->info.sample_rate;
        if (seconds > NOVA_AUDIO_TOTAL_SAMPLE_SECONDS) {
            fail(error, error_size, "score exceeds 120 seconds of unique source samples"); goto failed;
        }
        ++sample->references;
        program->samples[program->sample_count++] = sample;
    }
    for (size_t i = 0; i < desc->patch_count; ++i) program->patches[i].desc = desc->patches[i];
    memcpy(program->buses, desc->buses, desc->bus_count * sizeof(*desc->buses));
    for (size_t i = 0; i < desc->event_count; ++i) program->events[i].desc = desc->events[i];
    for (size_t i = 0; i < program->bus_count; ++i) {
        NovaAudioBus b = program->buses[i];
        if ((i == 0 ? b.parent != NOVA_AUDIO_NO_BUS : b.parent >= i) ||
            !finite_range(b.gain, 0, 4) || !finite_range(b.pan, -1, 1)) {
            fail(error, error_size, "buses require a root, parent-before-child routing, gain 0..4 and pan -1..1");
            goto failed;
        }
    }
    if (!patches_valid(program, error, error_size) || !prepare_events(program, error, error_size) ||
        !prepare_tables(program, error, error_size)) goto failed;
    *out = program;
    if (error && error_size) error[0] = '\0';
    return true;
failed:
    nova_audio_program_release(program);
    return false;
}

void nova_audio_program_release(NovaAudioProgram *program)
{
    if (!program || --program->references != 0) return;
    for (size_t i = 0; i < program->sample_count; ++i) nova_audio_sample_release(program->samples[i]);
    for (size_t i = 0; i < program->patch_count; ++i) free(program->patches[i].sinc);
    free(program->tables);
    free(program);
}

uint32_t nova_audio_program_rate(const NovaAudioProgram *program) { return program->rate; }
uint64_t nova_audio_program_length(const NovaAudioProgram *program) { return program->length; }
size_t nova_audio_program_bus_count(const NovaAudioProgram *program) { return program->bus_count; }

static Ramp constant(double value) { return (Ramp){.from = value, .to = value}; }
static double ramp_value(const Ramp *r)
{
    return r->position >= r->length ? r->to : r->from + (r->to - r->from) * r->position / r->length;
}
static void ramp_advance(Ramp *r) { if (r->position < r->length) ++r->position; }
static void ramp_set(Ramp *r, double target, uint32_t frames)
{
    *r = (Ramp){.from = ramp_value(r), .to = target, .length = frames};
}

static void reset_cycle(NovaAudioRenderer *r)
{
    r->position = 0;
    r->event = 0;
    memset(r->voices, 0, sizeof(r->voices));
    for (size_t i = 0; i < r->program->bus_count; ++i) {
        r->gain[i] = constant(r->program->buses[i].gain);
        r->pan[i] = constant(r->program->buses[i].pan);
    }
}

void nova_audio_renderer_reset(NovaAudioRenderer *renderer)
{
    NovaAudioProgram *program = renderer->program;
    memset(renderer, 0, sizeof(*renderer));
    renderer->program = program;
    reset_cycle(renderer);
}

bool nova_audio_renderer_create(NovaAudioProgram *program,
    NovaAudioRenderer **out, char *error, size_t error_size)
{
    if (!program || !out) return fail(error, error_size, "renderer requires a prepared score and output pointer");
    NovaAudioRenderer *r = calloc(1, sizeof(*r));
    if (!r) return fail(error, error_size, "audio renderer allocation failed");
    r->program = program;
    ++program->references;
    reset_cycle(r);
    *out = r;
    if (error && error_size) error[0] = '\0';
    return true;
}

void nova_audio_renderer_destroy(NovaAudioRenderer *renderer)
{
    if (!renderer) return;
    nova_audio_program_release(renderer->program);
    free(renderer);
}

static double envelope_level(const Voice *voice, NovaAudioEnvelope e)
{
    if (voice->released)
        return voice->release_age >= voice->release_frames ? 0 :
            voice->release_level * (1 - (double)voice->release_age / voice->release_frames);
    if (voice->age < e.attack_frames) return (double)voice->age / e.attack_frames;
    uint64_t age = voice->age - e.attack_frames;
    if (age < e.decay_frames) return 1 - (1 - e.sustain) * (double)age / e.decay_frames;
    return e.sustain;
}

static void release_voice(Voice *v, NovaAudioEnvelope e, uint32_t frames)
{
    double level = envelope_level(v, e);
    if (v->released && frames > v->release_frames - v->release_age)
        frames = v->release_frames - (uint32_t)v->release_age;
    v->released = true;
    v->release_level = level;
    v->release_age = 0;
    v->release_frames = frames;
}

NovaAudioResult nova_audio_cancel(NovaAudioRenderer *r, uint32_t fade_frames)
{
    if (!r || !fade_frames || fade_frames > r->program->rate * 60) return NOVA_AUDIO_INVALID_ARGUMENT;
    if (r->cancelled) return r->fault;
    r->cancelled = true;
    for (uint32_t i = 0; i < r->program->voice_limit; ++i) {
        Voice *v = &r->voices[i];
        if (v->active) release_voice(v, r->program->patches[v->patch].desc.envelope, fade_frames);
    }
    return r->fault;
}

static void apply_event(NovaAudioRenderer *r, const Event *event)
{
    const NovaAudioEvent *e = &event->desc;
    if (e->type == NOVA_AUDIO_BUS_GAIN) ramp_set(&r->gain[e->target], e->value, e->ramp_frames);
    else if (e->type == NOVA_AUDIO_BUS_PAN) ramp_set(&r->pan[e->target], e->value, e->ramp_frames);
    else {
        Voice *v = &r->voices[event->slot];
        if (e->type == NOVA_AUDIO_NOTE_ON) {
            *v = (Voice){.active = true, .patch = e->note.patch, .bus = e->note.bus,
                .noise = e->note.seed, .gain = constant(e->note.gain),
                .pan = constant(e->note.pan), .frequency = constant(e->note.frequency)};
        } else if (e->type == NOVA_AUDIO_NOTE_OFF && v->active) {
            NovaAudioEnvelope envelope = r->program->patches[v->patch].desc.envelope;
            release_voice(v, envelope, envelope.release_frames);
        } else if (e->type == NOVA_AUDIO_VOICE_GAIN) ramp_set(&v->gain, e->value, e->ramp_frames);
        else if (e->type == NOVA_AUDIO_VOICE_PAN) ramp_set(&v->pan, e->value, e->ramp_frames);
        else if (e->type == NOVA_AUDIO_VOICE_PITCH) ramp_set(&v->frequency, e->value, e->ramp_frames);
    }
}

static double lookup(const float *table, double phase)
{
    double position = phase * TABLE_SIZE;
    unsigned index = (unsigned)position;
    double fraction = position - index;
    double previous = table[(index + TABLE_SIZE - 1) % TABLE_SIZE], current = table[index];
    double next = table[index + 1], following = table[(index + 2) % TABLE_SIZE];
    return current + 0.5 * fraction * (next - previous + fraction *
        (2 * previous - 5 * current + 4 * next - following +
         fraction * (3 * (current - next) + following - previous)));
}

static uint32_t noise_next(uint32_t *state)
{
    uint32_t n = *state;
    n ^= n << 13; n ^= n >> 17; n ^= n << 5;
    *state = n;
    return n;
}

static double oscillator(NovaAudioProgram *program, Voice *v, NovaAudioSource source, double frequency)
{
    if (source == NOVA_AUDIO_NOISE) return (double)noise_next(&v->noise) / 2147483648.0 - 1;
    double value;
    if (source == NOVA_AUDIO_SINE) value = -PI / 2 * lookup(table_at(program, 0, 0), v->phase);
    else {
        double budget = program->rate * 0.45 / frequency;
        unsigned level = 0;
        while (level + 1 < TABLE_LEVELS && (1u << (level + 1)) <= budget) ++level;
        unsigned shape = (unsigned)source - NOVA_AUDIO_SAW;
        double high = lookup(table_at(program, shape, level), v->phase);
        double low = lookup(table_at(program, shape, level ? level - 1 : 0), v->phase);
        double blend = fmin(1, budget / (1u << level) - 1);
        value = low + (high - low) * blend;
    }
    v->phase += frequency / program->rate;
    if (v->phase >= 1) v->phase -= 1;
    return value;
}

static float sample_at(const NovaAudioSample *s, const NovaAudioPatch *p, int64_t frame, unsigned channel)
{
    int64_t length = p->sample_end - p->sample_start;
    if (p->sample_loop) {
        frame %= length;
        if (frame < 0) frame += length;
    } else if (frame < 0 || frame >= length) return 0;
    return s->data[((size_t)frame + p->sample_start) * s->info.channels + channel];
}

static void sampler(NovaAudioProgram *program, Voice *v, const Patch *p, double frequency,
    double value[2], double *tail_gain)
{
    const NovaAudioSample *s = program->samples[p->desc.sample];
    uint64_t denominator = program->rate * PITCH_UNIT;
    uint64_t end = (uint64_t)(p->desc.sample_end - p->desc.sample_start) * denominator;
    if (v->sample_position >= end) { v->active = false; *tail_gain = 0; return; }
    uint64_t pitch = (uint64_t)llround(frequency / p->desc.sample_root_hz * PITCH_UNIT);
    uint64_t step = pitch * s->info.sample_rate;
    uint64_t maximum_step = (uint64_t)llround(p->desc.sample_max_ratio * PITCH_UNIT) * s->info.sample_rate;
    if (!p->desc.sample_loop)
        *tail_gain = fmin(1, (double)(end - v->sample_position) /
            ((double)maximum_step * p->desc.envelope.release_frames));
    int64_t frame = (int64_t)(v->sample_position / denominator);
    double phase = (double)(v->sample_position % denominator) / denominator * SINC_PHASES;
    unsigned index = (unsigned)phase;
    double fraction = phase - index;
    for (unsigned tap = 0; tap < SINC_TAPS; ++tap) {
        double a = p->sinc[index * SINC_TAPS + tap];
        double b = p->sinc[(index + 1) * SINC_TAPS + tap];
        double coefficient = a + (b - a) * fraction;
        int64_t source_frame = frame + (int)tap - (SINC_TAPS / 2 - 1);
        for (unsigned channel = 0; channel < s->info.channels; ++channel)
            value[channel] += sample_at(s, &p->desc, source_frame, channel) * coefficient;
    }
    v->sample_position += step;
    if (p->desc.sample_loop) v->sample_position %= end;
}

static void balance(double value[2], double pan, double gain)
{
    value[0] *= gain * (pan <= 0 ? 1 : cos(pan * PI / 2));
    value[1] *= gain * (pan >= 0 ? 1 : cos(pan * PI / 2));
}

static void voice_frame(NovaAudioRenderer *r, Voice *v, double value[2])
{
    const Patch *p = &r->program->patches[v->patch];
    double frequency = ramp_value(&v->frequency);
    double tail_gain = 1;
    unsigned channels = 1;
    if (p->desc.source == NOVA_AUDIO_SAMPLER) {
        sampler(r->program, v, p, frequency, value, &tail_gain);
        channels = r->program->samples[p->desc.sample]->info.channels;
    } else value[0] = oscillator(r->program, v, p->desc.source, frequency);
    double amplitude = envelope_level(v, p->desc.envelope) * ramp_value(&v->gain) * tail_gain;
    for (unsigned channel = 0; channel < channels; ++channel) {
        if (p->filter != 0) {
            v->filter[channel] = (1 - p->filter) * value[channel] + p->filter * v->filter[channel];
            if (fabs(v->filter[channel]) < 1e-30) v->filter[channel] = 0;
            value[channel] = v->filter[channel];
        }
        value[channel] *= amplitude;
    }
    double pan = ramp_value(&v->pan);
    if (channels == 1) {
        value[1] = value[0] * sin((pan + 1) * PI / 4);
        value[0] *= cos((pan + 1) * PI / 4);
    } else balance(value, pan, 1);
    ++v->age;
    if (v->released && ++v->release_age >= v->release_frames) v->active = false;
    ramp_advance(&v->gain); ramp_advance(&v->pan); ramp_advance(&v->frequency);
}

NovaAudioResult nova_audio_render(NovaAudioRenderer *r, float *stereo, size_t frames)
{
    if (!r || (frames && !stereo) || frames > NOVA_AUDIO_MAX_BLOCK) return NOVA_AUDIO_INVALID_ARGUMENT;
    if (frames > UINT64_MAX - r->clock) r->fault = NOVA_AUDIO_CLOCK_OVERFLOW;
    if (r->fault != NOVA_AUDIO_OK) {
        if (frames) memset(stereo, 0, frames * 2 * sizeof(float));
        return r->fault;
    }
    NovaAudioProgram *program = r->program;
    for (size_t frame = 0; frame < frames; ++frame) {
        if (!r->cancelled && r->position == program->length && program->loop) reset_cycle(r);
        if (!r->cancelled)
            while (r->event < program->event_count && program->events[r->event].desc.frame == r->position)
                apply_event(r, &program->events[r->event++]);
        double buses[NOVA_AUDIO_MAX_BUSES][2] = {{0}};
        for (uint32_t i = 0; i < program->voice_limit; ++i) {
            Voice *v = &r->voices[i];
            if (!v->active) continue;
            double value[2] = {0};
            voice_frame(r, v, value);
            buses[v->bus][0] += value[0];
            buses[v->bus][1] += value[1];
        }
        for (size_t i = program->bus_count; i-- > 0;) {
            balance(buses[i], ramp_value(&r->pan[i]), ramp_value(&r->gain[i]));
            float left = (float)buses[i][0], right = (float)buses[i][1];
            if (!isfinite(left) || !isfinite(right)) {
                r->fault = NOVA_AUDIO_NONFINITE;
                memset(stereo + frame * 2, 0, (frames - frame) * 2 * sizeof(float));
                return r->fault;
            }
            r->peak[i][0] = fmaxf(r->peak[i][0], fabsf(left));
            r->peak[i][1] = fmaxf(r->peak[i][1], fabsf(right));
            if (fabsf(left) > 1 || fabsf(right) > 1) ++r->over_frames[i];
            if (i) {
                uint32_t parent = program->buses[i].parent;
                buses[parent][0] += buses[i][0];
                buses[parent][1] += buses[i][1];
            }
            ramp_advance(&r->gain[i]); ramp_advance(&r->pan[i]);
        }
        stereo[frame * 2] = (float)buses[0][0];
        stereo[frame * 2 + 1] = (float)buses[0][1];
        ++r->clock;
        if (r->position < program->length) ++r->position;
        if (!r->cancelled && program->loop && r->position == program->length) reset_cycle(r);
    }
    return NOVA_AUDIO_OK;
}

NovaAudioStatus nova_audio_status(const NovaAudioRenderer *r)
{
    NovaAudioStatus status = {.clock = r->clock, .position = r->position,
        .cancelled = r->cancelled, .fault = r->fault};
    for (uint32_t i = 0; i < r->program->voice_limit; ++i)
        if (r->voices[i].active) ++status.active_voices;
    status.finished = !status.active_voices &&
        (r->cancelled || (!r->program->loop && r->position == r->program->length));
    memcpy(status.peak, r->peak, sizeof(status.peak));
    memcpy(status.over_frames, r->over_frames, sizeof(status.over_frames));
    return status;
}
