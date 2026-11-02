#include "document.hpp"

#include <QCryptographicHash>
#include <cstring>

namespace nova::sound {
namespace {

constexpr char Magic[8] = {'N', 'V', 'S', 'O', 'U', 'N', 'D', '\0'};

class Writer {
public:
    QByteArray bytes;
    void u32(quint32 value)
    {
        for (int shift = 0; shift < 32; shift += 8) bytes.append(char((value >> shift) & 255));
    }
    void real(double value)
    {
        static_assert(sizeof(double) == sizeof(quint64));
        quint64 bits = 0;
        std::memcpy(&bits, &value, sizeof(bits));
        for (int shift = 0; shift < 64; shift += 8) bytes.append(char((bits >> shift) & 255));
    }
    void blob(const QByteArray &value) { u32(quint32(value.size())); bytes.append(value); }
    void text(const QString &value) { blob(value.toUtf8()); }
};

class Reader {
public:
    explicit Reader(const QByteArray &bytes) : bytes_(bytes) {}
    bool ok = true;
    qsizetype position = 0;
    bool available(qsizetype size)
    {
        if (!ok || size < 0 || size > bytes_.size() - position) { ok = false; return false; }
        return true;
    }
    quint32 u32()
    {
        if (!available(4)) return 0;
        quint32 value = 0;
        for (int shift = 0; shift < 32; shift += 8) value |= quint32(quint8(bytes_[position++])) << shift;
        return value;
    }
    bool boolean()
    {
        const quint32 value = u32();
        if (value > 1) ok = false;
        return value != 0;
    }
    double real()
    {
        if (!available(8)) return 0;
        quint64 bits = 0;
        for (int shift = 0; shift < 64; shift += 8) bits |= quint64(quint8(bytes_[position++])) << shift;
        double value = 0;
        std::memcpy(&value, &bits, sizeof(value));
        return value;
    }
    QByteArray blob(qsizetype maximum)
    {
        const quint32 size = u32();
        if (size > maximum || !available(size)) { ok = false; return {}; }
        QByteArray result = bytes_.mid(position, size);
        position += size;
        return result;
    }
    QString text()
    {
        const QByteArray value = blob(96);
        const QString result = QString::fromUtf8(value);
        if (result.toUtf8() != value) ok = false;
        return result;
    }
private:
    const QByteArray &bytes_;
};

bool fail(QString &error, const QString &reason)
{
    error = QStringLiteral("Cannot open sound source: %1. The existing document was retained.").arg(reason);
    return false;
}

} // namespace

bool encodeSource(const State &state, QByteArray &bytes, QString &error)
{
    if (!validate(state, error)) return false;
    qsizetype mediaBytes = 0;
    for (const Media &media : state.media) mediaBytes += media.data->wav().size();
    Writer w;
    w.bytes.reserve(mediaBytes + MaxMetadataBytes);
    w.bytes.append(Magic, 8);
    w.u32(1); w.u32(0);
    w.text(state.uuid); w.text(state.name);
    w.u32(state.rate); w.real(state.masterGain); w.u32(state.nextId);
    w.u32(quint32(state.media.size())); w.u32(quint32(state.layers.size()));
    for (const Media &media : state.media) {
        w.u32(media.id); w.text(media.name); w.blob(media.data->wav());
    }
    for (const Layer &layer : state.layers) {
        w.u32(layer.id); w.text(layer.name); w.u32(quint32(layer.source)); w.u32(layer.enabled);
        w.u32(layer.start); w.u32(layer.duration); w.real(layer.gain); w.real(layer.pan);
        w.real(layer.frequency); w.real(layer.endFrequency); w.u32(layer.sweep); w.u32(layer.seed);
        w.u32(layer.attack); w.u32(layer.decay); w.u32(layer.release); w.real(layer.sustain); w.real(layer.lowpass);
        w.u32(layer.media); w.u32(layer.begin); w.u32(layer.end);
        w.u32(layer.fadeIn); w.u32(layer.fadeOut); w.u32(layer.reverse);
    }
    w.bytes.append(QCryptographicHash::hash(w.bytes, QCryptographicHash::Sha256));
    if (w.bytes.size() > MaxSourceBytes) {
        error = QStringLiteral("Sound source exceeds 33 MiB.");
        return false;
    }
    bytes = std::move(w.bytes);
    error.clear();
    return true;
}

bool decodeSource(const QByteArray &bytes, State &state, QString &error)
{
    if (bytes.size() < 80 || bytes.size() > MaxSourceBytes || bytes.first(8) != QByteArray(Magic, 8))
        return fail(error, QStringLiteral("expected NVSOUND v1, at most 33 MiB"));
    const QByteArray body = bytes.first(bytes.size() - 32);
    if (QCryptographicHash::hash(body, QCryptographicHash::Sha256) != bytes.last(32))
        return fail(error, QStringLiteral("source checksum mismatch"));
    Reader r(body);
    r.position = 8;
    if (r.u32() != 1 || r.u32() != 0)
        return fail(error, QStringLiteral("unsupported version or flags"));
    State candidate;
    candidate.uuid = r.text(); candidate.name = r.text();
    candidate.rate = r.u32(); candidate.masterGain = r.real(); candidate.nextId = r.u32();
    const quint32 mediaCount = r.u32(), layerCount = r.u32();
    if (!r.ok || mediaCount > MaxMedia || layerCount > MaxLayers)
        return fail(error, QStringLiteral("invalid source/layer count or truncated header"));
    qsizetype totalBytes = 0;
    double seconds = 0;
    for (quint32 i = 0; i < mediaCount; ++i) {
        Media media;
        media.id = r.u32(); media.name = r.text();
        QByteArray wav = r.blob(MaxWavBytes);
        totalBytes += wav.size();
        if (!r.ok || totalBytes > MaxMediaBytes)
            return fail(error, QStringLiteral("truncated original or 32 MiB media budget exceeded"));
        QString detail;
        media.data = WaveData::fromWav(wav, detail);
        if (!media.data) return fail(error, detail);
        const auto info = media.data->info().sample;
        seconds += double(info.frames) / info.sample_rate;
        if (seconds > MaxMediaSeconds) return fail(error, QStringLiteral("originals exceed 60 seconds total"));
        candidate.media.push_back(std::move(media));
    }
    for (quint32 i = 0; i < layerCount; ++i) {
        Layer layer;
        layer.id = r.u32(); layer.name = r.text();
        const quint32 source = r.u32();
        if (source > NOVA_AUDIO_SAMPLER) return fail(error, QStringLiteral("unsupported instrument"));
        layer.source = NovaAudioSource(source); layer.enabled = r.boolean();
        layer.start = r.u32(); layer.duration = r.u32(); layer.gain = r.real(); layer.pan = r.real();
        layer.frequency = r.real(); layer.endFrequency = r.real(); layer.sweep = r.boolean(); layer.seed = r.u32();
        layer.attack = r.u32(); layer.decay = r.u32(); layer.release = r.u32();
        layer.sustain = r.real(); layer.lowpass = r.real();
        layer.media = r.u32(); layer.begin = r.u32(); layer.end = r.u32();
        layer.fadeIn = r.u32(); layer.fadeOut = r.u32(); layer.reverse = r.boolean();
        if (!r.ok) return fail(error, QStringLiteral("truncated or invalid layer"));
        candidate.layers.push_back(std::move(layer));
    }
    if (!r.ok || r.position != body.size()) return fail(error, QStringLiteral("truncated data or unexpected trailing fields"));
    QString detail;
    if (!validate(candidate, detail)) return fail(error, detail);
    state = std::move(candidate);
    error.clear();
    return true;
}

} // namespace nova::sound
