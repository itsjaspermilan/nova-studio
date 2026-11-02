#include "production_internal.h"

#include <float.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PI 3.14159265358979323846
enum { WET, PRIMARY, SECONDARY, PARAMETERS };

typedef struct {
    double from, to;
    uint32_t frames, position;
} Parameter;

typedef struct {
    NovaAudioInsertType type;
    double initial[PARAMETERS], k, damping, attack, release, exponent, feedback[4];
    uint32_t length[4], offset[4];
} Insert;

typedef struct {
    uint64_t frame;
    uint32_t target, parameter, frames;
    double value;
    bool send;
} Automation;

struct NovaProduction {
    NovaAudioProductionInfo info;
    uint32_t rate;
    uint64_t length;
    Insert inserts[NOVA_AUDIO_MAX_INSERTS];
    NovaAudioSend sends[NOVA_AUDIO_MAX_SENDS];
    Automation events[NOVA_AUDIO_MAX_EVENTS];
    unsigned insert_count[NOVA_AUDIO_MAX_BUSES], send_count[NOVA_AUDIO_MAX_BUSES];
    unsigned bus_inserts[NOVA_AUDIO_MAX_BUSES][NOVA_AUDIO_INSERTS_PER_BUS];
    unsigned bus_sends[NOVA_AUDIO_MAX_BUSES][NOVA_AUDIO_MAX_SENDS];
};

typedef struct {
    uint32_t position, filled;
} Line;

typedef struct {
    Parameter parameter[PARAMETERS];
    double integrator[2][2], damping[4], gain;
    Line lines[4];
} InsertState;

struct NovaProductionState {
    const NovaProduction *prepared;
    InsertState inserts[NOVA_AUDIO_MAX_INSERTS];
    Parameter sends[NOVA_AUDIO_MAX_SENDS];
    NovaAudioProductionStatus status;
    size_t event;
    uint64_t position;
    double cancel_gain;
    uint32_t cancel_frames, cancel_position;
    bool cancelled, ended;
    float buffer[];
};

static bool fail(char *error, size_t size, const char *message)
{
    if (error && size) snprintf(error, size, "%s", message);
    return false;
}

static bool indexed_fail(char *error, size_t size, const char *kind, size_t index)
{
    if (error && size) snprintf(error, size, "production %s %zu: invalid type, target, parameter, timing or capacity", kind, index);
    return false;
}

static bool range(double value, double minimum, double maximum)
{
    return isfinite(value) && value >= minimum && value <= maximum;
}

static double amplitude(double db) { return pow(10, db / 20); }
static double cutoff(double hz, uint32_t rate) { return tan(PI * hz / rate); }
static double quiet(double value) { return fabs(value) < 1e-30 ? 0 : value; }
static bool representable(double value) { return isfinite(value) && fabs(value) <= FLT_MAX; }
static Parameter constant(double value) { return (Parameter){.from = value, .to = value}; }
static double parameter(const Parameter *p)
{
    return p->position >= p->frames ? p->to : p->from + (p->to - p->from) * p->position / p->frames;
}

static bool damping_valid(double hz, uint32_t rate)
{
    return hz == 0 || range(hz, 20, rate * 0.45);
}

static double damping(double hz, uint32_t rate) { return hz == 0 ? 0 : exp(-2 * PI * hz / rate); }

static bool add_line(NovaProduction *p, Insert *insert, unsigned line, uint32_t frames)
{
    size_t bytes = (size_t)frames * sizeof(float);
    if (bytes > NOVA_AUDIO_EFFECT_BUFFER_LIMIT - p->info.buffer_bytes) return false;
    insert->offset[line] = (uint32_t)(p->info.buffer_bytes / sizeof(float));
    insert->length[line] = frames;
    p->info.buffer_bytes += bytes;
    return true;
}

static bool prepare_insert(NovaProduction *p, Insert *out, NovaAudioInsert in)
{
    uint32_t rate = p->rate;
    if (in.type < NOVA_AUDIO_LOWPASS || in.type > NOVA_AUDIO_LIMITER || !range(in.wet, 0, 1)) return false;
    out->type = in.type;
    out->initial[WET] = in.wet;
    if (in.type <= NOVA_AUDIO_BELL) {
        if (!range(in.settings.filter.frequency_hz, 20, rate * 0.4) ||
            !range(in.settings.filter.q, 0.5, 4) || !range(in.settings.filter.gain_db, -12, 12) ||
            (in.type != NOVA_AUDIO_BELL && in.settings.filter.gain_db != 0)) return false;
        out->initial[PRIMARY] = cutoff(in.settings.filter.frequency_hz, rate);
        out->initial[SECONDARY] = amplitude(in.settings.filter.gain_db);
        out->k = 1 / in.settings.filter.q;
    } else if (in.type == NOVA_AUDIO_DELAY) {
        if (!range(in.settings.delay.feedback, -0.95, 0.95) ||
            !damping_valid(in.settings.delay.damping_hz, rate)) return false;
        out->initial[PRIMARY] = in.settings.delay.feedback;
        out->damping = damping(in.settings.delay.damping_hz, rate);
        for (unsigned i = 0; i < 2; ++i) {
            uint32_t frames = in.settings.delay.frames[i];
            if (!frames || frames > rate * NOVA_AUDIO_DELAY_SECONDS || !add_line(p, out, i, frames)) return false;
        }
    } else if (in.type == NOVA_AUDIO_REVERB) {
        if (!range(in.settings.reverb.decay_seconds, 0.1, 10) ||
            !damping_valid(in.settings.reverb.damping_hz, rate)) return false;
        const uint32_t lengths[] = {1429, 1601, 1867, 2053};
        for (unsigned i = 0; i < 4; ++i) {
            uint32_t frames = (uint32_t)llround((double)lengths[i] * rate / 48000);
            if (!add_line(p, out, i, frames)) return false;
            out->feedback[i] = pow(0.001, frames / (rate * in.settings.reverb.decay_seconds));
        }
        out->damping = damping(in.settings.reverb.damping_hz, rate);
    } else if (in.type == NOVA_AUDIO_COMPRESSOR) {
        if (!range(in.settings.compressor.threshold_db, -60, 0) ||
            !range(in.settings.compressor.ratio, 1, 20) ||
            !range(in.settings.compressor.makeup_db, -24, 24) ||
            !in.settings.compressor.attack_frames || in.settings.compressor.attack_frames > rate * 10 ||
            !in.settings.compressor.release_frames || in.settings.compressor.release_frames > rate * 10) return false;
        out->initial[PRIMARY] = amplitude(in.settings.compressor.threshold_db);
        out->initial[SECONDARY] = amplitude(in.settings.compressor.makeup_db);
        out->attack = exp(-1.0 / in.settings.compressor.attack_frames);
        out->release = exp(-1.0 / in.settings.compressor.release_frames);
        out->exponent = 1 - 1 / in.settings.compressor.ratio;
    } else {
        if (!range(in.settings.limiter.ceiling_db, -24, 0) ||
            !in.settings.limiter.release_frames || in.settings.limiter.release_frames > rate * 10) return false;
        out->initial[PRIMARY] = amplitude(in.settings.limiter.ceiling_db);
        out->release = exp(-1.0 / in.settings.limiter.release_frames);
    }
    return true;
}

static bool prepare_event(const NovaProduction *p, NovaAudioProductionEvent in, Automation *out)
{
    if (in.frame >= p->length || !in.ramp_frames || in.ramp_frames > p->rate * 60 ||
        in.ramp_frames > p->length - in.frame) return false;
    *out = (Automation){.frame = in.frame, .target = in.target, .frames = in.ramp_frames, .value = in.value};
    if (in.parameter == NOVA_AUDIO_SEND_GAIN) {
        out->send = true;
        return in.target < p->info.send_count && range(in.value, 0, 2);
    }
    if (in.target >= p->info.insert_count) return false;
    NovaAudioInsertType type = p->inserts[in.target].type;
    switch (in.parameter) {
    case NOVA_AUDIO_INSERT_WET:
        out->parameter = WET;
        return range(in.value, 0, 1);
    case NOVA_AUDIO_FILTER_FREQUENCY:
        if (type > NOVA_AUDIO_BELL || !range(in.value, 20, p->rate * 0.4)) return false;
        out->parameter = PRIMARY; out->value = cutoff(in.value, p->rate);
        return true;
    case NOVA_AUDIO_BELL_GAIN_DB:
        if (type != NOVA_AUDIO_BELL || !range(in.value, -12, 12)) return false;
        out->parameter = SECONDARY; out->value = amplitude(in.value);
        return true;
    case NOVA_AUDIO_DELAY_FEEDBACK:
        out->parameter = PRIMARY;
        return type == NOVA_AUDIO_DELAY && range(in.value, -0.95, 0.95);
    case NOVA_AUDIO_COMPRESSOR_THRESHOLD_DB:
        if (type != NOVA_AUDIO_COMPRESSOR || !range(in.value, -60, 0)) return false;
        out->parameter = PRIMARY; out->value = amplitude(in.value);
        return true;
    case NOVA_AUDIO_COMPRESSOR_MAKEUP_DB:
        if (type != NOVA_AUDIO_COMPRESSOR || !range(in.value, -24, 24)) return false;
        out->parameter = SECONDARY; out->value = amplitude(in.value);
        return true;
    case NOVA_AUDIO_LIMITER_CEILING_DB:
        if (type != NOVA_AUDIO_LIMITER || !range(in.value, -24, 0)) return false;
        out->parameter = PRIMARY; out->value = amplitude(in.value);
        return true;
    default: return false;
    }
}

bool nova_production_prepare(const NovaAudioProductionDesc *desc, uint32_t rate, uint64_t length,
    size_t buses, size_t base_events, NovaProduction **out, char *error, size_t size)
{
    if (!desc) { *out = NULL; return true; }
    if (desc->insert_count > NOVA_AUDIO_MAX_INSERTS || desc->send_count > NOVA_AUDIO_MAX_SENDS ||
        desc->event_count > NOVA_AUDIO_MAX_EVENTS - base_events ||
        (desc->insert_count && !desc->inserts) || (desc->send_count && !desc->sends) ||
        (desc->event_count && !desc->events))
        return fail(error, size, "production exceeds insert/send/combined event capacity or has a missing array");
    if (desc->tail_frames > rate * NOVA_AUDIO_TAIL_SECONDS || desc->tail_frames >= length ||
        desc->tail_fade_frames > desc->tail_frames ||
        (desc->tail_frames && !desc->tail_fade_frames) ||
        (desc->insert_count && !desc->tail_frames))
        return fail(error, size, "production inserts require an explicit <=30s tail suffix and nonzero final fade within score length");
    if (!desc->insert_count && !desc->send_count && !desc->event_count && !desc->tail_frames) {
        *out = NULL; return true;
    }
    NovaProduction *p = calloc(1, sizeof(*p));
    if (!p) return fail(error, size, "production preparation allocation failed");
    p->rate = rate; p->length = length;
    p->info = (NovaAudioProductionInfo){.insert_count = desc->insert_count, .send_count = desc->send_count,
        .event_count = desc->event_count, .tail_frames = desc->tail_frames, .tail_fade_frames = desc->tail_fade_frames,
        .prepared_bytes = sizeof(*p)};
    for (size_t i = 0; i < desc->insert_count; ++i) {
        NovaAudioInsert insert = desc->inserts[i];
        if (insert.bus >= buses || p->insert_count[insert.bus] == NOVA_AUDIO_INSERTS_PER_BUS ||
            !prepare_insert(p, &p->inserts[i], insert)) {
            indexed_fail(error, size, "insert/buffer budget", i); goto failed;
        }
        p->bus_inserts[insert.bus][p->insert_count[insert.bus]++] = (unsigned)i;
    }
    for (size_t i = 0; i < desc->send_count; ++i) {
        NovaAudioSend send = desc->sends[i];
        if (send.source >= buses || send.destination >= send.source || !range(send.gain, 0, 2)) {
            indexed_fail(error, size, "acyclic send", i); goto failed;
        }
        for (size_t j = 0; j < i; ++j)
            if (p->sends[j].source == send.source && p->sends[j].destination == send.destination &&
                p->sends[j].post_fader == send.post_fader) {
                indexed_fail(error, size, "duplicate send", i); goto failed;
            }
        p->sends[i] = send;
        p->bus_sends[send.source][p->send_count[send.source]++] = (unsigned)i;
    }
    for (size_t i = 0; i < desc->event_count; ++i) {
        if ((i && desc->events[i].frame < desc->events[i - 1].frame) ||
            !prepare_event(p, desc->events[i], &p->events[i])) {
            indexed_fail(error, size, "automation", i); goto failed;
        }
    }
    p->info.state_bytes = sizeof(NovaProductionState) + p->info.buffer_bytes;
    *out = p;
    return true;
failed:
    free(p);
    return false;
}

void nova_production_destroy(NovaProduction *p) { free(p); }
NovaAudioProductionInfo nova_production_info(const NovaProduction *p)
{
    return p ? p->info : (NovaAudioProductionInfo){0};
}

NovaProductionState *nova_production_create(const NovaProduction *p, char *error, size_t size)
{
    NovaProductionState *s = calloc(1, p->info.state_bytes);
    if (!s) { fail(error, size, "production renderer state/buffer allocation failed"); return NULL; }
    s->prepared = p;
    nova_production_reset(s, true);
    return s;
}

void nova_production_free(NovaProductionState *s) { free(s); }

void nova_production_reset(NovaProductionState *s, bool meters)
{
    if (!s) return;
    s->position = 0; s->event = 0; s->cancel_frames = s->cancel_position = 0;
    s->cancel_gain = 1;
    s->cancelled = s->ended = false;
    if (meters) s->status = (NovaAudioProductionStatus){0};
    s->status.insert_count = s->prepared->info.insert_count;
    for (size_t i = 0; i < s->prepared->info.insert_count; ++i) {
        s->inserts[i] = (InsertState){.gain = 1};
        for (unsigned j = 0; j < PARAMETERS; ++j)
            s->inserts[i].parameter[j] = constant(s->prepared->inserts[i].initial[j]);
        if (meters) s->status.minimum_gain[i] = 1;
    }
    for (size_t i = 0; i < s->prepared->info.send_count; ++i)
        s->sends[i] = constant(s->prepared->sends[i].gain);
}

void nova_production_cancel(NovaProductionState *s, uint32_t frames)
{
    if (!s || s->cancelled || s->ended) return;
    s->cancel_gain = nova_production_output_gain(s);
    s->cancelled = true;
    s->cancel_frames = frames;
    s->cancel_position = 0;
}

void nova_production_begin(NovaProductionState *s, uint64_t position)
{
    if (!s) return;
    s->position = position;
    if (s->cancelled || s->ended) return;
    while (s->event < s->prepared->info.event_count && s->prepared->events[s->event].frame == position) {
        Automation e = s->prepared->events[s->event++];
        Parameter *p = e.send ? &s->sends[e.target] : &s->inserts[e.target].parameter[e.parameter];
        *p = (Parameter){.from = parameter(p), .to = e.value, .frames = e.frames};
    }
}

static double read_line(const NovaProductionState *s, unsigned effect, unsigned line)
{
    const Insert *p = &s->prepared->inserts[effect];
    const Line *state = &s->inserts[effect].lines[line];
    return state->filled < p->length[line] ? 0 : s->buffer[p->offset[line] + state->position];
}

static bool write_line(NovaProductionState *s, unsigned effect, unsigned line, double value)
{
    if (!representable(value)) return false;
    const Insert *p = &s->prepared->inserts[effect];
    Line *state = &s->inserts[effect].lines[line];
    s->buffer[p->offset[line] + state->position] = (float)quiet(value);
    if (++state->position == p->length[line]) state->position = 0;
    if (state->filled < p->length[line]) ++state->filled;
    return true;
}

static bool process(NovaProductionState *s, unsigned index, double value[2])
{
    const Insert *p = &s->prepared->inserts[index];
    InsertState *state = &s->inserts[index];
    double primary = parameter(&state->parameter[PRIMARY]), secondary = parameter(&state->parameter[SECONDARY]);
    if (p->type <= NOVA_AUDIO_BELL) {
        double g = primary, a = 1 / (1 + g * (g + p->k));
        for (unsigned c = 0; c < 2; ++c) {
            double band = a * (state->integrator[c][0] + g * (value[c] - state->integrator[c][1]));
            double low = state->integrator[c][1] + g * band;
            state->integrator[c][0] = quiet(2 * band - state->integrator[c][0]);
            state->integrator[c][1] = quiet(2 * low - state->integrator[c][1]);
            value[c] = p->type == NOVA_AUDIO_LOWPASS ? low :
                p->type == NOVA_AUDIO_HIGHPASS ? value[c] - p->k * band - low :
                value[c] + (secondary - 1) * p->k * band;
        }
    } else if (p->type == NOVA_AUDIO_DELAY) {
        for (unsigned c = 0; c < 2; ++c) {
            double delayed = read_line(s, index, c);
            state->damping[c] = quiet((1 - p->damping) * delayed + p->damping * state->damping[c]);
            if (!write_line(s, index, c, value[c] + primary * state->damping[c])) return false;
            value[c] = delayed;
        }
    } else if (p->type == NOVA_AUDIO_REVERB) {
        double taps[4], sum = 0;
        for (unsigned i = 0; i < 4; ++i) {
            taps[i] = read_line(s, index, i);
            state->damping[i] = quiet((1 - p->damping) * taps[i] + p->damping * state->damping[i]);
            sum += state->damping[i];
        }
        for (unsigned i = 0; i < 4; ++i) {
            double input = (value[0] + (i & 1 ? -value[1] : value[1])) * 0.5;
            if (!write_line(s, index, i, input + p->feedback[i] * (state->damping[i] - sum * 0.5))) return false;
        }
        value[0] = (taps[0] + taps[1] - taps[2] - taps[3]) * 0.5;
        value[1] = (taps[0] - taps[1] - taps[2] + taps[3]) * 0.5;
    } else {
        double peak = fmax(fabs(value[0]), fabs(value[1]));
        double desired = peak > primary ? (p->type == NOVA_AUDIO_LIMITER ? primary / peak :
            pow(primary / peak, p->exponent)) : 1;
        double coefficient = desired < state->gain ? p->attack : p->release;
        state->gain = desired + coefficient * (state->gain - desired);
        double gain = state->gain * (p->type == NOVA_AUDIO_COMPRESSOR ? secondary : 1);
        value[0] *= gain; value[1] *= gain;
        s->status.minimum_gain[index] = fminf(s->status.minimum_gain[index], (float)state->gain);
    }
    return representable(value[0]) && representable(value[1]);
}

bool nova_production_bus(NovaProductionState *s, uint32_t bus, double value[2])
{
    if (!s) return true;
    if (s->ended) { value[0] = value[1] = 0; return true; }
    for (unsigned i = 0; i < s->prepared->insert_count[bus]; ++i) {
        unsigned index = s->prepared->bus_inserts[bus][i];
        double dry[2] = {value[0], value[1]};
        if (!representable(dry[0]) || !representable(dry[1]) || !process(s, index, value)) return false;
        double wet = parameter(&s->inserts[index].parameter[WET]);
        for (unsigned c = 0; c < 2; ++c) {
            value[c] = wet == 0 ? dry[c] : wet == 1 ? value[c] : dry[c] + wet * (value[c] - dry[c]);
            s->status.input_peak[index][c] = fmaxf(s->status.input_peak[index][c], (float)fabs(dry[c]));
            s->status.output_peak[index][c] = fmaxf(s->status.output_peak[index][c], (float)fabs(value[c]));
        }
        if (fabs(dry[0]) > 1 || fabs(dry[1]) > 1) ++s->status.input_over_frames[index];
        if (fabs(value[0]) > 1 || fabs(value[1]) > 1) ++s->status.output_over_frames[index];
    }
    return true;
}

void nova_production_sends(NovaProductionState *s, uint32_t bus, bool post_fader,
    double buses[NOVA_AUDIO_MAX_BUSES][2])
{
    if (!s || s->ended) return;
    for (unsigned i = 0; i < s->prepared->send_count[bus]; ++i) {
        unsigned index = s->prepared->bus_sends[bus][i];
        NovaAudioSend send = s->prepared->sends[index];
        if (send.post_fader != post_fader) continue;
        double gain = parameter(&s->sends[index]);
        buses[send.destination][0] += gain * buses[bus][0];
        buses[send.destination][1] += gain * buses[bus][1];
    }
}

double nova_production_output_gain(const NovaProductionState *s)
{
    if (!s) return 1;
    if (s->ended) return 0;
    if (s->cancelled) return s->prepared->info.tail_frames ?
        s->cancel_gain * (1 - (double)s->cancel_position / s->cancel_frames) : 1;
    uint64_t remaining = s->prepared->length - s->position;
    return remaining < s->prepared->info.tail_fade_frames ?
        (double)remaining / s->prepared->info.tail_fade_frames : 1;
}

void nova_production_advance(NovaProductionState *s)
{
    if (!s || s->ended) return;
    for (size_t i = 0; i < s->prepared->info.insert_count; ++i)
        for (unsigned j = 0; j < PARAMETERS; ++j) {
            Parameter *p = &s->inserts[i].parameter[j];
            if (p->position < p->frames) ++p->position;
        }
    for (size_t i = 0; i < s->prepared->info.send_count; ++i)
        if (s->sends[i].position < s->sends[i].frames) ++s->sends[i].position;
    if (s->position < s->prepared->length) ++s->position;
    s->ended = s->cancelled ? ++s->cancel_position == s->cancel_frames : s->position == s->prepared->length;
}

bool nova_production_finished(const NovaProductionState *s)
{
    return !s || s->ended || (s->cancelled && !s->prepared->info.tail_frames);
}

NovaAudioProductionStatus nova_production_status(const NovaProductionState *s)
{
    if (!s) return (NovaAudioProductionStatus){0};
    NovaAudioProductionStatus status = s->status;
    status.ended = nova_production_finished(s);
    if (s->cancelled) {
        if (!status.ended) status.cancel_frames_remaining = s->cancel_frames - s->cancel_position;
    } else {
        uint64_t remaining = s->prepared->length - s->position;
        status.tail_active = !s->ended && remaining <= s->prepared->info.tail_frames;
        status.tail_frames_remaining = remaining < s->prepared->info.tail_frames ?
            (uint32_t)remaining : s->prepared->info.tail_frames;
    }
    for (size_t i = 0; i < s->prepared->info.insert_count; ++i) status.gain[i] = (float)s->inserts[i].gain;
    return status;
}
