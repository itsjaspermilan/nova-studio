#include "render.hpp"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QThread>
#include <algorithm>
#include <new>

namespace nova::sound {
namespace {

bool cancelled(const std::atomic_bool *flag) { return flag && flag->load(std::memory_order_relaxed); }
bool fail(QString &error, const QString &message) { error = message; return false; }

struct SampleDeleter {
    void operator()(NovaAudioSample *sample) const { nova_audio_sample_release(sample); }
};
using SamplePtr = std::unique_ptr<NovaAudioSample, SampleDeleter>;

struct Sink {
    QByteArray bytes;
    const std::atomic_bool *cancel = nullptr;
    bool full = false;
    static bool write(void *context, const void *bytes, size_t count)
    {
        auto &sink = *static_cast<Sink *>(context);
        if (cancelled(sink.cancel)) return false;
        if (count > size_t(MaxWavBytes - sink.bytes.size())) { sink.full = true; return false; }
        sink.bytes.append(static_cast<const char *>(bytes), qsizetype(count));
        return true;
    }
};

} // namespace

bool compile(const State &state, ProgramPtr &program, QString &error, const std::atomic_bool *cancel)
{
    if (!validate(state, error)) return false;
    if (cancelled(cancel)) return fail(error, QStringLiteral("Sound preparation cancelled."));
    double sampleSeconds = 0;
    int enabled = 0;
    for (const Layer &layer : state.layers) {
        if (!layer.enabled) continue;
        ++enabled;
        if (layer.source == NOVA_AUDIO_SAMPLER) {
            const auto info = findMedia(state, layer.media)->data->info().sample;
            sampleSeconds += double(layer.end - layer.begin) / info.sample_rate;
        }
    }
    if (!enabled) return fail(error, QStringLiteral("Add or enable a layer before rendering or auditioning."));
    if (sampleSeconds > NOVA_AUDIO_TOTAL_SAMPLE_SECONDS)
        return fail(error, QStringLiteral("Prepared sample layers exceed the engine's 120-second aggregate (including repeated edited regions). Reduce layered regions; originals remain intact."));

    std::vector<SamplePtr> owners;
    std::vector<NovaAudioSample *> samples;
    std::vector<NovaAudioPatch> patches;
    std::vector<NovaAudioEvent> events;
    char diagnostic[512]{};
    for (const Layer &layer : state.layers) {
        if (!layer.enabled) continue;
        if (cancelled(cancel)) return fail(error, QStringLiteral("Sound preparation cancelled."));
        NovaAudioPatch patch{};
        patch.source = layer.source;
        patch.envelope = {layer.attack, layer.decay, layer.release, float(layer.sustain)};
        patch.lowpass_hz = layer.lowpass;
        if (layer.source == NOVA_AUDIO_SAMPLER) {
            const auto &original = *findMedia(state, layer.media)->data;
            NovaAudioSampleInfo info = original.info().sample;
            info.frames = layer.end - layer.begin;
            std::vector<float> edited(size_t(info.frames) * info.channels);
            for (quint32 frame = 0; frame < info.frames; ++frame) {
                if ((frame & 4095u) == 0 && cancelled(cancel))
                    return fail(error, QStringLiteral("Sound preparation cancelled."));
                const quint32 from = layer.reverse ? layer.end - 1 - frame : layer.begin + frame;
                double gain = 1;
                if (frame < layer.fadeIn)
                    gain *= double(frame) / std::max(1u, layer.fadeIn - 1);
                if (layer.fadeOut && frame >= info.frames - layer.fadeOut)
                    gain *= double(info.frames - 1 - frame) / std::max(1u, layer.fadeOut - 1);
                for (quint32 channel = 0; channel < info.channels; ++channel)
                    edited[size_t(frame) * info.channels + channel] =
                        float(original.pcm()[size_t(from) * info.channels + channel] * gain);
            }
            NovaAudioSample *sample = nullptr;
            if (!nova_audio_sample_create(edited.data(), info, &sample, diagnostic, sizeof(diagnostic)))
                return fail(error, QString::fromUtf8(diagnostic));
            owners.emplace_back(sample);
            patch.sample = quint32(samples.size());
            samples.push_back(sample);
            patch.sample_start = 0;
            patch.sample_end = info.frames;
            patch.sample_root_hz = 440;
            patch.sample_max_ratio = 1;
        }
        const quint32 patchIndex = quint32(patches.size());
        patches.push_back(patch);
        const quint32 frames = layerFrames(state, layer);
        NovaAudioEvent on{};
        on.frame = layer.start;
        on.type = NOVA_AUDIO_NOTE_ON;
        on.target = layer.id;
        on.note = {patchIndex, 0, layer.frequency, float(layer.gain), float(layer.pan), layer.seed};
        events.push_back(on);
        if (layer.sweep) {
            NovaAudioEvent pitch{};
            pitch.frame = layer.start;
            pitch.type = NOVA_AUDIO_VOICE_PITCH;
            pitch.target = layer.id;
            pitch.value = layer.endFrequency;
            pitch.ramp_frames = frames - layer.release;
            events.push_back(pitch);
        }
        NovaAudioEvent off{};
        off.frame = quint64(layer.start) + frames - layer.release;
        off.type = NOVA_AUDIO_NOTE_OFF;
        off.target = layer.id;
        events.push_back(off);
    }
    std::stable_sort(events.begin(), events.end(), [](const NovaAudioEvent &a, const NovaAudioEvent &b) { return a.frame < b.frame; });
    NovaAudioBus master{NOVA_AUDIO_NO_BUS, float(state.masterGain), 0};
    NovaAudioProgramDesc description{};
    description.sample_rate = state.rate;
    description.voice_limit = MaxLayers;
    description.length_frames = lengthFrames(state);
    description.samples = samples.data(); description.sample_count = samples.size();
    description.patches = patches.data(); description.patch_count = patches.size();
    description.buses = &master; description.bus_count = 1;
    description.events = events.data(); description.event_count = events.size();
    NovaAudioProgram *prepared = nullptr;
    if (!nova_audio_program_create(&description, &prepared, diagnostic, sizeof(diagnostic)))
        return fail(error, QString::fromUtf8(diagnostic));
    ProgramPtr candidate(prepared);
    if (cancelled(cancel)) return fail(error, QStringLiteral("Sound preparation cancelled."));
    program = std::move(candidate);
    error.clear();
    return true;
}

ExportValue::ExportValue(SourcePtr sourceValue, QByteArray audio, QByteArray information,
                         ExportSettings options, NovaAudioExportResult result,
                         std::shared_ptr<const WaveData> wave)
    : source(std::move(sourceValue)), wav(std::move(audio)), metadata(std::move(information)), settings(options),
      rate(wave->info().sample.sample_rate), frames(wave->info().sample.frames),
      peak{result.peak[0], result.peak[1]}, overFrames(result.over_frames), waveform(std::move(wave)) {}

ExportPtr render(SnapshotPtr snapshot, ExportSettings settings, QString &error, const std::atomic_bool *cancel)
{
    if (!snapshot) { fail(error, QStringLiteral("An immutable sound snapshot is required.")); return {}; }
    if (settings.format < NOVA_AUDIO_WAV_PCM16 || settings.format > NOVA_AUDIO_WAV_FLOAT32 ||
        (settings.dither && (!settings.seed || settings.format == NOVA_AUDIO_WAV_FLOAT32))) {
        fail(error, QStringLiteral("Choose PCM16/PCM24 with optional seeded dither, or undithered float32."));
        return {};
    }
    ProgramPtr program;
    if (!compile(*snapshot->state, program, error, cancel)) return {};
    SourcePtr source = sourceValue(snapshot, error);
    if (!source) return {};
    Sink sink;
    sink.cancel = cancel;
    const quint32 frames = lengthFrames(*snapshot->state);
    const quint32 stride = settings.format == NOVA_AUDIO_WAV_PCM16 ? 4 : settings.format == NOVA_AUDIO_WAV_PCM24 ? 6 : 8;
    const quint64 expectedBytes = quint64(frames) * stride + (settings.format == NOVA_AUDIO_WAV_FLOAT32 ? 56 : 44);
    if (expectedBytes > quint64(MaxWavBytes)) { fail(error, QStringLiteral("Derived WAV exceeds 16 MiB.")); return {}; }
    sink.bytes.reserve(qsizetype(expectedBytes));
    NovaAudioExport options{frames, settings.format, settings.dither, settings.seed};
    NovaAudioExportResult result{};
    char diagnostic[512]{};
    if (!nova_audio_write_wav(program.get(), options, &Sink::write, &sink, &result, diagnostic, sizeof(diagnostic))) {
        fail(error, cancelled(cancel) ? QStringLiteral("Sound render cancelled; no output published.") :
             sink.full ? QStringLiteral("Derived WAV exceeds 16 MiB; no output published.") : QString::fromUtf8(diagnostic));
        return {};
    }
    if (!result.complete || result.frames_written != frames || result.bytes_written != expectedBytes) {
        fail(error, QStringLiteral("Sound renderer returned an incomplete output; candidate discarded."));
        return {};
    }
    if (cancelled(cancel)) { fail(error, QStringLiteral("Sound render cancelled; no output published.")); return {}; }
    auto waveform = WaveData::fromWav(sink.bytes, error);
    if (!waveform) {
        error = QStringLiteral("Generated audio is outside the runtime WAV profile: %1").arg(error);
        return {};
    }
    QJsonObject metadata{
        {QStringLiteral("format"), QStringLiteral("nova-sound-render")},
        {QStringLiteral("version"), 1},
        {QStringLiteral("document"), snapshot->state->uuid},
        {QStringLiteral("source_sha256"), QString::fromLatin1(source->sha256.toHex())},
        {QStringLiteral("sample_rate"), int(snapshot->state->rate)},
        {QStringLiteral("channels"), 2},
        {QStringLiteral("frames"), int(frames)},
        {QStringLiteral("encoding"), settings.format == NOVA_AUDIO_WAV_PCM16 ? QStringLiteral("pcm16") :
                                    settings.format == NOVA_AUDIO_WAV_PCM24 ? QStringLiteral("pcm24") : QStringLiteral("float32")},
        {QStringLiteral("dither"), settings.dither},
        {QStringLiteral("dither_seed"), double(settings.seed)},
        {QStringLiteral("peak"), QJsonArray{result.peak[0], result.peak[1]}},
        {QStringLiteral("over_range_frames"), double(result.over_frames)},
        {QStringLiteral("loop"), false},
        {QStringLiteral("length_policy"), QStringLiteral("start-inclusive, end-exclusive; includes release tails")}
    };
    QByteArray bytes = QJsonDocument(metadata).toJson(QJsonDocument::Compact);
    if (bytes.size() > MaxMetadataBytes) { fail(error, QStringLiteral("Sound metadata exceeds 64 KiB.")); return {}; }
    if (cancelled(cancel)) { fail(error, QStringLiteral("Sound render cancelled; no output published.")); return {}; }
    error.clear();
    return ExportPtr(new ExportValue(std::move(source), std::move(sink.bytes), std::move(bytes),
                                     settings, result, std::move(waveform)));
}

struct RenderJob::Work {
    std::atomic_bool cancel{false};
    Result result;
};

RenderJob::RenderJob(QObject *parent) : QObject(parent) {}

RenderJob::~RenderJob()
{
    if (thread_) {
        disconnect(thread_, nullptr, this, nullptr);
        cancel();
        thread_->wait();
        delete thread_;
    }
}

bool RenderJob::start(SnapshotPtr snapshot, Kind kind, ExportSettings settings, QString &error)
{
    if (busy()) return fail(error, tr("A sound job is already running. Cancel it or wait for completion."));
    if (!snapshot) return fail(error, tr("An immutable sound snapshot is required."));
    if (kind != Kind::Export && kind != Kind::PrepareAudition) return fail(error, tr("Unknown sound job kind."));
    result_ = {};
    auto work = std::make_shared<Work>();
    work->result.snapshot = std::move(snapshot);
    work_ = work;
    thread_ = QThread::create([work, kind, settings] {
        try {
            bool ok;
            if (kind == Kind::PrepareAudition)
                ok = compile(*work->result.snapshot->state, work->result.program, work->result.error, &work->cancel);
            else {
                work->result.output = render(work->result.snapshot, settings, work->result.error, &work->cancel);
                ok = bool(work->result.output);
            }
            work->result.status = work->cancel.load(std::memory_order_relaxed) ? Status::Cancelled :
                                  ok ? Status::Succeeded : Status::Failed;
        } catch (const std::bad_alloc &) {
            work->result.status = Status::Failed;
            work->result.error = QStringLiteral("Sound preparation ran out of memory; source and prior output were retained.");
        }
        if (work->result.status != Status::Succeeded) {
            work->result.program.reset();
            work->result.output.reset();
        }
    });
    connect(thread_, &QThread::finished, this, [this, work] {
        QThread *completed = thread_;
        completed->wait();
        // Join transfers sole native ownership before GUI-side refcount changes.
        result_ = std::move(work->result);
        if (work->cancel.load(std::memory_order_relaxed)) {
            result_.status = Status::Cancelled;
            result_.program.reset();
            result_.output.reset();
            result_.error = tr("Sound job cancelled; no output published.");
        }
        thread_ = nullptr;
        work_.reset();
        completed->deleteLater();
        emit finished();
    });
    thread_->setObjectName(QStringLiteral("NovaSoundOffline"));
    thread_->start();
    error.clear();
    return true;
}

void RenderJob::cancel()
{
    if (work_) work_->cancel.store(true, std::memory_order_relaxed);
}

RenderJob::Result RenderJob::takeResult() { return std::move(result_); }

} // namespace nova::sound
