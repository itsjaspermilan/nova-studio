#include "document.hpp"
#include "render.hpp"

#include <QCryptographicHash>
#include <QSet>
#include <algorithm>
#include <cmath>
#include <limits>
#include <tuple>
#include <utility>

namespace nova::sound {
namespace {

bool fail(QString &error, const QString &message)
{
    error = message;
    return false;
}

bool nameValid(const QString &name)
{
    const QByteArray bytes = name.toUtf8();
    if (name.trimmed().isEmpty() || bytes.size() > 96 || QString::fromUtf8(bytes) != name) return false;
    return std::none_of(name.begin(), name.end(), [](QChar c) { return c.isNull() || c.category() == QChar::Other_Control; });
}

bool range(double value, double minimum, double maximum)
{
    return std::isfinite(value) && value >= minimum && value <= maximum;
}

Layer tone(NovaAudioSource source, quint32 rate)
{
    Layer layer;
    layer.source = source;
    layer.name = source == NOVA_AUDIO_NOISE ? QStringLiteral("Noise") : QStringLiteral("Tone");
    layer.duration = rate / 2;
    layer.attack = rate / 200;
    layer.decay = rate / 20;
    layer.release = rate / 10;
    if (source == NOVA_AUDIO_NOISE) layer.frequency = layer.endFrequency = 0;
    return layer;
}

Layer sampleLayer(const Media &media)
{
    Layer layer;
    layer.name = media.name;
    layer.source = NOVA_AUDIO_SAMPLER;
    layer.media = media.id;
    layer.end = media.data->info().sample.frames;
    layer.duration = 0;
    layer.attack = layer.release = 1;
    layer.decay = 0;
    layer.sustain = 1;
    layer.gain = 1;
    return layer;
}

} // namespace

WaveData::WaveData(QByteArray bytes, std::vector<float> pcm, NovaAudioWavInfo info)
    : wav_(std::move(bytes)), pcm_(std::move(pcm)), info_(info) {}

std::shared_ptr<const WaveData> WaveData::fromWav(const QByteArray &bytes, QString &error)
{
    if (bytes.size() > MaxWavBytes) {
        fail(error, QStringLiteral("Short-SFX imports are limited to 16 MiB per WAV; use the future long-media workflow."));
        return {};
    }
    QByteArray owned(bytes.constData(), bytes.size());
    NovaAudioWavInfo info{};
    char diagnostic[512]{};
    const auto *data = reinterpret_cast<const unsigned char *>(owned.constData());
    if (!nova_audio_wav_inspect(data, size_t(owned.size()), &info, diagnostic, sizeof(diagnostic))) {
        fail(error, QString::fromUtf8(diagnostic));
        return {};
    }
    std::vector<float> pcm(size_t(info.sample.frames) * info.sample.channels);
    if (!nova_audio_wav_read(data, size_t(owned.size()), pcm.data(), pcm.size(), diagnostic, sizeof(diagnostic))) {
        fail(error, QString::fromUtf8(diagnostic));
        return {};
    }
    error.clear();
    return std::shared_ptr<const WaveData>(new WaveData(std::move(owned), std::move(pcm), info));
}

qsizetype WaveData::storageBytes() const { return wav_.size() + qsizetype(pcm_.size() * sizeof(float)); }

bool Media::operator==(const Media &other) const
{
    return id == other.id && name == other.name &&
        (data == other.data || (data && other.data && data->wav() == other.data->wav()));
}

bool Layer::operator==(const Layer &other) const
{
    return std::tie(id, name, source, enabled, start, duration, gain, pan, frequency, endFrequency,
                    sweep, seed, attack, decay, release, sustain, lowpass, media, begin, end,
                    fadeIn, fadeOut, reverse) ==
           std::tie(other.id, other.name, other.source, other.enabled, other.start, other.duration,
                    other.gain, other.pan, other.frequency, other.endFrequency, other.sweep, other.seed,
                    other.attack, other.decay, other.release, other.sustain, other.lowpass,
                    other.media, other.begin, other.end, other.fadeIn, other.fadeOut, other.reverse);
}

const Media *findMedia(const State &state, Id id)
{
    const auto it = std::find_if(state.media.begin(), state.media.end(), [id](const Media &m) { return m.id == id; });
    return it == state.media.end() ? nullptr : &*it;
}

const Layer *findLayer(const State &state, Id id)
{
    const auto it = std::find_if(state.layers.begin(), state.layers.end(), [id](const Layer &l) { return l.id == id; });
    return it == state.layers.end() ? nullptr : &*it;
}

quint32 layerFrames(const State &state, const Layer &layer)
{
    if (layer.source != NOVA_AUDIO_SAMPLER) return layer.duration;
    const Media *media = findMedia(state, layer.media);
    if (!media || !media->data || layer.end <= layer.begin) return 0;
    const quint32 rate = media->data->info().sample.sample_rate;
    return quint32((quint64(layer.end - layer.begin) * state.rate + rate - 1) / rate);
}

quint32 lengthFrames(const State &state)
{
    quint32 length = 0;
    for (const Layer &layer : state.layers) length = std::max(length, layer.start + layerFrames(state, layer));
    return length;
}

bool validate(const State &state, QString &error)
{
    const QUuid uuid(state.uuid);
    if (uuid.isNull() || uuid.toString(QUuid::WithoutBraces) != state.uuid || !nameValid(state.name))
        return fail(error, QStringLiteral("Sound needs a canonical UUID and a nonempty name of at most 96 UTF-8 bytes."));
    if ((state.rate != 44100 && state.rate != 48000) || !range(state.masterGain, 0, 4))
        return fail(error, QStringLiteral("Output rate must be 44100 or 48000 Hz; master gain must be finite, 0..4."));
    if (state.layers.size() > MaxLayers || state.media.size() > MaxMedia || !state.nextId)
        return fail(error, QStringLiteral("Sound supports at most 8 layers and 8 original WAV sources with valid identities."));
    QSet<Id> ids;
    const auto identity = [&](Id id) {
        if (!id || id >= state.nextId || ids.contains(id)) return false;
        ids.insert(id);
        return true;
    };
    qsizetype bytes = 0;
    double seconds = 0;
    for (const Media &media : state.media) {
        if (!identity(media.id) || !nameValid(media.name) || !media.data)
            return fail(error, QStringLiteral("Invalid or duplicate original-source identity, name or data."));
        bytes += media.data->wav().size();
        const auto info = media.data->info().sample;
        seconds += double(info.frames) / info.sample_rate;
    }
    if (bytes > MaxMediaBytes || seconds > MaxMediaSeconds)
        return fail(error, QStringLiteral("Original media exceeds 32 MiB or 60 seconds total; no source was discarded."));
    for (const Layer &layer : state.layers) {
        if (!identity(layer.id) || !nameValid(layer.name) ||
            layer.source < NOVA_AUDIO_SINE || layer.source > NOVA_AUDIO_SAMPLER)
            return fail(error, QStringLiteral("Invalid or duplicate layer identity, name or instrument."));
        const QString prefix = QStringLiteral("%1: ").arg(layer.name);
        if (!range(layer.gain, 0, 4) || !range(layer.pan, -1, 1) ||
            !(layer.lowpass == 0 || range(layer.lowpass, 20, state.rate * 0.45)))
            return fail(error, prefix + QStringLiteral("gain 0..4, pan -1..1 and low-pass 0 (bypass) or 20..0.45 x rate Hz are required."));
        if (layer.source == NOVA_AUDIO_SAMPLER) {
            const Media *media = findMedia(state, layer.media);
            if (!media || layer.begin >= layer.end || layer.end > media->data->info().sample.frames)
                return fail(error, prefix + QStringLiteral("trim must be a nonempty [begin,end) range in the original source."));
            if (quint64(layer.fadeIn) + layer.fadeOut > layer.end - layer.begin)
                return fail(error, prefix + QStringLiteral("source-frame fades must fit inside the trimmed region without overlap."));
            if (layer.duration || layer.attack != 1 || layer.decay || layer.release != 1 ||
                layer.sustain != 1 || layer.frequency != 440 || layer.endFrequency != 440 || layer.sweep)
                return fail(error, prefix + QStringLiteral("samples use unity pitch and one-output-frame edge envelopes in this version."));
        } else {
            if (layer.media || layer.begin || layer.end || layer.fadeIn || layer.fadeOut || layer.reverse)
                return fail(error, prefix + QStringLiteral("sample edit fields require a sample instrument."));
            if (!layer.attack || !layer.release || !range(layer.sustain, 0, 1) ||
                quint64(layer.attack) + layer.decay + layer.release > layer.duration)
                return fail(error, prefix + QStringLiteral("attack/decay/release must fit in duration; attack and release are at least one output frame."));
            if (layer.source == NOVA_AUDIO_NOISE) {
                if (!layer.seed || layer.frequency != 0 || layer.endFrequency != 0 || layer.sweep)
                    return fail(error, prefix + QStringLiteral("noise requires a nonzero seed and has no pitch control."));
            } else if (!range(layer.frequency, 20, state.rate * 0.45) ||
                       !range(layer.endFrequency, 20, state.rate * 0.45))
                return fail(error, prefix + QStringLiteral("pitch must be finite, 20..0.45 x output rate Hz."));
        }
        const quint32 frames = layerFrames(state, layer);
        if (frames < 2 || quint64(layer.start) + frames > quint64(state.rate) * MaxSeconds)
            return fail(error, prefix + QStringLiteral("layer needs at least two output frames and must end within 30 seconds."));
    }
    error.clear();
    return true;
}

bool sameContent(const State &a, const State &b)
{
    return a.uuid == b.uuid && a.name == b.name && a.rate == b.rate && a.nextId == b.nextId &&
        a.masterGain == b.masterGain && a.media == b.media && a.layers == b.layers;
}

bool Revision::operator==(const Revision &other) const
{
    return session == other.session && document == other.document && number == other.number;
}

Snapshot::Snapshot(Revision key, std::shared_ptr<const State> value) : revision(std::move(key)), state(std::move(value)) {}

SourceValue::SourceValue(SnapshotPtr value, QByteArray data)
    : snapshot(std::move(value)), bytes(std::move(data)), sha256(QCryptographicHash::hash(bytes, QCryptographicHash::Sha256)) {}

SourcePtr sourceValue(SnapshotPtr snapshot, QString &error)
{
    if (!snapshot) {
        fail(error, QStringLiteral("A live immutable sound snapshot is required."));
        return {};
    }
    QByteArray bytes;
    if (!encodeSource(*snapshot->state, bytes, error)) return {};
    return SourcePtr(new SourceValue(std::move(snapshot), std::move(bytes)));
}

Document::Document(QObject *parent) : QObject(parent)
{
    State initial;
    initial.uuid = QUuid::createUuid().toString(QUuid::WithoutBraces);
    state_ = std::make_shared<const State>(std::move(initial));
}

Revision Document::revision() const { return {session_, state_->uuid, revision_}; }
SnapshotPtr Document::snapshot() const { return SnapshotPtr(new Snapshot(revision(), state_)); }
bool Document::isCurrent(const Snapshot &value) const { return revision() == value.revision && state_ == value.state; }
bool Document::dirty() const { return !saved_ || !sameContent(*state_, *saved_); }
bool Document::derivedStale() const { return !derived_ || !sameContent(*state_, *derived_); }
QString Document::undoText() const { return canUndo() ? undo_.back().label : QString(); }
QString Document::redoText() const { return canRedo() ? redo_.back().label : QString(); }

qsizetype Document::historyBytes() const
{
    QSet<const State *> states;
    QSet<const WaveData *> waves;
    qsizetype bytes = 0;
    const auto count = [&](const std::shared_ptr<const State> &state) {
        if (!state || states.contains(state.get())) return;
        states.insert(state.get());
        bytes += 4096 + qsizetype(state->layers.size()) * 512;
        for (const Media &media : state->media) {
            if (waves.contains(media.data.get())) continue;
            waves.insert(media.data.get());
            bytes += media.data->storageBytes();
        }
    };
    count(state_); count(saved_); count(derived_);
    for (const Command &command : undo_) { count(command.before); count(command.after); }
    for (const Command &command : redo_) { count(command.before); count(command.after); }
    return bytes;
}

void Document::trimHistory()
{
    bool trimmed = false;
    while ((!undo_.empty() || !redo_.empty()) &&
           (undo_.size() + redo_.size() > MaxHistoryCommands || historyBytes() > MaxHistoryBytes)) {
        if (!undo_.empty()) undo_.pop_front();
        else redo_.pop_front();
        trimmed = true;
    }
    if (trimmed) emit historyTrimmed(tr("Oldest sound undo steps were released to keep the 64-command / 128 MiB history bound."));
}

void Document::reset(State state, bool saved)
{
    session_ = QUuid::createUuid();
    revision_ = 1;
    highWater_ = state.nextId;
    state_ = std::make_shared<const State>(std::move(state));
    saved_ = saved ? state_ : nullptr;
    derived_.reset();
    undo_.clear();
    redo_.clear();
    emit changed();
    emit persistenceChanged();
}

bool Document::create(const QString &name, quint32 rate, QString &error)
{
    State state;
    state.uuid = QUuid::createUuid().toString(QUuid::WithoutBraces);
    state.name = name;
    state.rate = rate;
    if (!validate(state, error)) return false;
    reset(std::move(state), false);
    return true;
}

bool Document::load(const QByteArray &source, QString &error)
{
    State state;
    if (!decodeSource(source, state, error)) return false;
    reset(std::move(state), true);
    return true;
}

bool Document::markPersisted(const SourceValue &source, SaveIntent intent,
                             const ExportValue *derived, QString &error)
{
    if (!source.snapshot || !isCurrent(*source.snapshot))
        return fail(error, tr("Save acknowledgement belongs to a stale revision, a prior open, or another sound document."));
    if (intent != SaveIntent::SourceOnly && intent != SaveIntent::PublishDerived)
        return fail(error, tr("Unknown sound save intent."));
    if (intent == SaveIntent::SourceOnly && derived)
        return fail(error, tr("Source-only saving must not acknowledge or replace generated audio."));
    if (intent == SaveIntent::PublishDerived &&
        (!derived || derived->source->snapshot->revision != source.snapshot->revision ||
         derived->source->sha256 != source.sha256))
        return fail(error, tr("PublishDerived requires a successful render of this exact source revision."));
    saved_ = state_;
    if (intent == SaveIntent::PublishDerived) derived_ = state_;
    trimHistory();
    error.clear();
    emit persistenceChanged();
    return true;
}

bool Document::commit(State candidate, const QString &label, QString &error)
{
    candidate.nextId = std::max(candidate.nextId, highWater_);
    if (!validate(candidate, error)) return false;
    if (sameContent(candidate, *state_)) { error.clear(); return true; }
    if (revision_ == std::numeric_limits<quint64>::max())
        return fail(error, tr("Sound revision space is exhausted; reopen a saved source before editing."));
    auto next = std::make_shared<const State>(std::move(candidate));
    // Saved/derived baselines are never evicted to make a new edit appear clean.
    const auto old = state_;
    state_ = next;
    auto oldUndo = std::exchange(undo_, {}), oldRedo = std::exchange(redo_, {});
    if (historyBytes() > MaxHistoryBytes) {
        state_ = old;
        undo_ = std::move(oldUndo); redo_ = std::move(oldRedo);
        return fail(error, tr("This edit exceeds the 128 MiB retained-media budget including saved/derived baselines."));
    }
    undo_ = std::move(oldUndo);
    undo_.push_back({label, old, next});
    highWater_ = state_->nextId;
    ++revision_;
    trimHistory();
    emit changed();
    emit persistenceChanged();
    return true;
}

bool Document::setSettings(const QString &name, quint32 rate, double gain, QString &error)
{
    State next = *state_;
    next.name = name;
    next.masterGain = gain;
    if (rate != state_->rate && rate != 44100 && rate != 48000)
        return fail(error, tr("Choose 44100 or 48000 Hz."));
    if (rate != state_->rate) {
        const auto frames = [&](quint32 value) {
            return quint32((quint64(value) * rate + state_->rate / 2) / state_->rate);
        };
        for (Layer &layer : next.layers) {
            layer.start = frames(layer.start);
            if (layer.source != NOVA_AUDIO_SAMPLER) {
                layer.duration = frames(layer.duration);
                layer.attack = std::max(1u, frames(layer.attack));
                layer.decay = frames(layer.decay);
                layer.release = std::max(1u, frames(layer.release));
            }
        }
        next.rate = rate;
    }
    return commit(std::move(next), tr("Change sound settings"), error);
}

bool Document::addTone(NovaAudioSource source, QString &error, Id *created)
{
    if (source < NOVA_AUDIO_SINE || source > NOVA_AUDIO_NOISE)
        return fail(error, tr("Choose a tonal oscillator or seeded noise; import WAVs as samples."));
    State next = *state_;
    Layer layer = tone(source, next.rate);
    layer.id = next.nextId++;
    next.layers.push_back(layer);
    if (!commit(std::move(next), tr("Add instrument layer"), error)) return false;
    if (created) *created = layer.id;
    return true;
}

bool Document::addPreset(Preset preset, QString &error, Id *created)
{
    State next = *state_;
    Layer a = tone(NOVA_AUDIO_SINE, next.rate), b = a;
    const auto f = [&](double seconds) { return quint32(std::llround(seconds * next.rate)); };
    QString label;
    switch (preset) {
    case Preset::Confirm:
        label = tr("Add Soft confirm preset");
        a.name = tr("Confirm body"); a.frequency = a.endFrequency = 660;
        a.duration = f(.18); a.attack = f(.004); a.decay = f(.035); a.release = f(.10); a.sustain = .3; a.gain = .28;
        b = a; b.name = tr("Confirm overtone"); b.start = f(.045); b.frequency = b.endFrequency = 990; b.gain = .12;
        break;
    case Preset::Pickup:
        label = tr("Add Bright pickup preset");
        a.name = tr("Rising chime"); a.source = NOVA_AUDIO_TRIANGLE;
        a.duration = f(.42); a.attack = f(.006); a.decay = f(.08); a.release = f(.22);
        a.frequency = 480; a.endFrequency = 1440; a.sweep = true; a.gain = .3; a.sustain = .35;
        b = a; b.name = tr("Chime sparkle"); b.start = f(.07); b.source = NOVA_AUDIO_SINE; b.gain = .12; b.pan = .25;
        break;
    case Preset::Impact:
        label = tr("Add Soft impact preset");
        a.name = tr("Impact body"); a.source = NOVA_AUDIO_TRIANGLE;
        a.duration = f(.32); a.attack = f(.002); a.decay = f(.04); a.release = f(.24);
        a.frequency = 160; a.endFrequency = 45; a.sweep = true; a.gain = .55; a.sustain = .4; a.lowpass = 1800;
        b = a; b.name = tr("Impact air"); b.source = NOVA_AUDIO_NOISE; b.frequency = b.endFrequency = 0;
        b.sweep = false; b.seed = 7331; b.gain = .2; b.lowpass = 3200;
        break;
    case Preset::AirBrake:
        label = tr("Add Rally air brake preset");
        a.name = tr("Brake air"); a.source = NOVA_AUDIO_NOISE; a.frequency = a.endFrequency = 0;
        a.duration = f(.65); a.attack = f(.015); a.decay = f(.12); a.release = f(.4);
        a.sustain = .35; a.gain = .3; a.seed = 1949; a.lowpass = 4200;
        b = a; b.name = tr("Brake mechanism"); b.source = NOVA_AUDIO_SAW; b.frequency = 180; b.endFrequency = 65;
        b.sweep = true; b.gain = .13; b.lowpass = 1300;
        break;
    default: return fail(error, tr("Unknown sound preset."));
    }
    a.id = next.nextId++; b.id = next.nextId++;
    next.layers.push_back(a); next.layers.push_back(b);
    if (!commit(std::move(next), label, error)) return false;
    if (created) *created = a.id;
    return true;
}

bool Document::importWav(const QByteArray &bytes, const QString &name, QString &error, Id *created, Id *original)
{
    if (state_->media.size() == MaxMedia)
        return fail(error, tr("All 8 original-source slots are occupied. Remove an unused original before importing."));
    auto data = WaveData::fromWav(bytes, error);
    if (!data) return false;
    State next = *state_;
    Media media{next.nextId++, name, std::move(data)};
    next.media.push_back(media);
    Id layerId = 0;
    const auto info = media.data->info().sample;
    const quint64 outputFrames = (quint64(info.frames) * next.rate + info.sample_rate - 1) / info.sample_rate;
    if (info.frames <= info.sample_rate * MaxSeconds && outputFrames >= 2 && next.layers.size() < MaxLayers) {
        Layer layer = sampleLayer(media);
        layer.id = next.nextId++;
        layerId = layer.id;
        next.layers.push_back(layer);
    }
    if (!commit(std::move(next), tr("Import original WAV"), error)) return false;
    if (created) *created = layerId;
    if (original) *original = media.id;
    return true;
}

bool Document::addSample(Id mediaId, QString &error, Id *created)
{
    const Media *media = findMedia(*state_, mediaId);
    if (!media) return fail(error, tr("Select an original WAV source first."));
    const auto info = media->data->info().sample;
    if (info.frames > info.sample_rate * MaxSeconds)
        return fail(error, tr("This original is longer than 30 seconds. Select an explicit region of at most 30 seconds before adding a layer."));
    return addSampleRegion(mediaId, 0, info.frames, error, created);
}

bool Document::addSampleRegion(Id mediaId, quint32 begin, quint32 end, QString &error, Id *created)
{
    const Media *media = findMedia(*state_, mediaId);
    if (!media) return fail(error, tr("Select an original WAV source first."));
    State next = *state_;
    Layer layer = sampleLayer(*media);
    layer.begin = begin;
    layer.end = end;
    layer.id = next.nextId++;
    next.layers.push_back(layer);
    if (!commit(std::move(next), tr("Add sample layer"), error)) return false;
    if (created) *created = layer.id;
    return true;
}

bool Document::setLayer(const Layer &layer, const Revision &expectedRevision, QString &error)
{
    if (revision() != expectedRevision) return fail(error, tr("The layer or document changed while fields were pending. Reset to the current revision before applying."));
    State next = *state_;
    const auto it = std::find_if(next.layers.begin(), next.layers.end(), [&](const Layer &value) { return value.id == layer.id; });
    if (it == next.layers.end()) return fail(error, tr("The edited layer no longer exists."));
    *it = layer;
    return commit(std::move(next), tr("Edit %1").arg(layer.name), error);
}

bool Document::trim(Id id, quint32 begin, quint32 end, QString &error)
{
    const Layer *existing = findLayer(*state_, id);
    if (!existing || existing->source != NOVA_AUDIO_SAMPLER) return fail(error, tr("Trim requires a sample layer."));
    Layer layer = *existing;
    layer.begin = begin; layer.end = end;
    State next = *state_;
    *std::find_if(next.layers.begin(), next.layers.end(), [id](const Layer &l) { return l.id == id; }) = layer;
    return commit(std::move(next), tr("Trim sample to selection"), error);
}

bool Document::duplicate(Id id, QString &error, Id *created)
{
    const Layer *existing = findLayer(*state_, id);
    if (!existing) return fail(error, tr("Select a layer to duplicate."));
    State next = *state_;
    Layer layer = *existing;
    layer.id = next.nextId++;
    layer.name += tr(" copy");
    next.layers.push_back(layer);
    if (!commit(std::move(next), tr("Duplicate sound layer"), error)) return false;
    if (created) *created = layer.id;
    return true;
}

bool Document::removeLayer(Id id, QString &error)
{
    State next = *state_;
    const auto it = std::find_if(next.layers.begin(), next.layers.end(), [id](const Layer &layer) { return layer.id == id; });
    if (it == next.layers.end()) return fail(error, tr("Select a layer to remove."));
    next.layers.erase(it);
    return commit(std::move(next), tr("Remove sound layer"), error);
}

bool Document::removeMedia(Id id, QString &error)
{
    if (std::any_of(state_->layers.begin(), state_->layers.end(), [id](const Layer &layer) { return layer.media == id; }))
        return fail(error, tr("This original is still used by a layer. Remove its layers first; undo retains the original."));
    State next = *state_;
    const auto it = std::find_if(next.media.begin(), next.media.end(), [id](const Media &media) { return media.id == id; });
    if (it == next.media.end()) return fail(error, tr("Select an unused original source to remove."));
    next.media.erase(it);
    return commit(std::move(next), tr("Remove unused original"), error);
}

bool Document::restore(bool forward, QString &error)
{
    auto &from = forward ? redo_ : undo_;
    auto &to = forward ? undo_ : redo_;
    if (from.empty()) return fail(error, forward ? tr("Nothing to redo.") : tr("Nothing to undo."));
    if (revision_ == std::numeric_limits<quint64>::max()) return fail(error, tr("Sound revision space is exhausted."));
    Command command = from.back();
    State restored = *(forward ? command.after : command.before);
    restored.nextId = highWater_;
    state_ = std::make_shared<const State>(std::move(restored));
    from.pop_back();
    to.push_back(std::move(command));
    ++revision_;
    trimHistory();
    error.clear();
    emit changed();
    emit persistenceChanged();
    return true;
}

bool Document::undo(QString &error) { return restore(false, error); }
bool Document::redo(QString &error) { return restore(true, error); }

} // namespace nova::sound
