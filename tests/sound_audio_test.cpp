#include "sound/render.hpp"
#include "sound_fixture.hpp"

#include <QElapsedTimer>
#include <QSignalSpy>
#include <QTimer>
#include <QtTest>
#include <atomic>
#include <cmath>

using namespace nova::sound;

class SoundAudioTest final : public QObject {
    Q_OBJECT
private slots:
    void nativeCompilerAndPresets();
    void sourceFrameEditsAndOneFrameEdges();
    void conversionAndIntegerFidelity();
    void failuresAndCancellation();
    void asynchronousOwnershipAndCancellation();
    void explicitAuditionReceiptsAndStop();
    void auditionFidelityAndRevisionRetention();
    void auditionErrorsAndRetirement();
};

static bool near(float actual, double expected, double tolerance = 0.000002)
{
    return std::abs(actual - expected) <= tolerance;
}

void SoundAudioTest::nativeCompilerAndPresets()
{
    QString error;
    for (Preset preset : {Preset::Confirm, Preset::Pickup, Preset::Impact, Preset::AirBrake}) {
        Document document;
        QVERIFY(document.addPreset(preset, error));
        const auto first = render(document.snapshot(), {NOVA_AUDIO_WAV_FLOAT32, false, 1}, error);
        QVERIFY2(first, qPrintable(error));
        const auto second = render(document.snapshot(), {NOVA_AUDIO_WAV_FLOAT32, false, 1}, error);
        QVERIFY(second);
        QCOMPARE(first->wav, second->wav);
        QCOMPARE(first->frames, lengthFrames(*document.state()));
        QCOMPARE(first->rate, quint32(48000));
        QVERIFY(first->peak[0] > .01f && first->peak[0] < 1);
        QCOMPARE(first->overFrames, quint64(0));
    }

    Document document;
    QVERIFY(document.addTone(NOVA_AUDIO_TRIANGLE, error));
    const Layer &layer = document.state()->layers.front();
    ProgramPtr compiled;
    QVERIFY(compile(*document.state(), compiled, error));
    NovaAudioPatch patch{};
    patch.source = layer.source;
    patch.envelope = {layer.attack, layer.decay, layer.release, float(layer.sustain)};
    NovaAudioBus bus{NOVA_AUDIO_NO_BUS, float(document.state()->masterGain), 0};
    NovaAudioEvent events[2]{};
    events[0].target = events[1].target = layer.id;
    events[0].type = NOVA_AUDIO_NOTE_ON;
    events[0].note = {0, 0, layer.frequency, float(layer.gain), float(layer.pan), layer.seed};
    events[1].type = NOVA_AUDIO_NOTE_OFF; events[1].frame = layer.duration - layer.release;
    NovaAudioProgramDesc description{};
    description.sample_rate = 48000; description.voice_limit = MaxLayers; description.length_frames = layer.duration;
    description.patches = &patch; description.patch_count = 1; description.buses = &bus; description.bus_count = 1;
    description.events = events; description.event_count = 2;
    NovaAudioProgram *direct = nullptr;
    char diagnostic[512]{};
    QVERIFY(nova_audio_program_create(&description, &direct, diagnostic, sizeof(diagnostic)));
    ProgramPtr native(direct);
    NovaAudioRenderer *a = nullptr, *b = nullptr;
    QVERIFY(nova_audio_renderer_create(compiled.get(), &a, diagnostic, sizeof(diagnostic)));
    QVERIFY(nova_audio_renderer_create(native.get(), &b, diagnostic, sizeof(diagnostic)));
    std::array<float, 1024> left{}, right{};
    for (quint32 offset = 0; offset < layer.duration; offset += 512) {
        const quint32 count = std::min(512u, layer.duration - offset);
        QCOMPARE(nova_audio_render(a, left.data(), count), NOVA_AUDIO_OK);
        QCOMPARE(nova_audio_render(b, right.data(), count), NOVA_AUDIO_OK);
        QVERIFY(std::equal(left.begin(), left.begin() + count * 2, right.begin()));
    }
    nova_audio_renderer_destroy(a); nova_audio_renderer_destroy(b);
}

void SoundAudioTest::sourceFrameEditsAndOneFrameEdges()
{
    Document document;
    QString error;
    const auto sample = [](quint32 frame, quint32 channel) {
        return channel ? float(-.2 - .0003 * frame) : float(.1 + .0007 * frame);
    };
    const QByteArray original = sound_test::wav(700, 48000, 2, 32, sample);
    Id id = 0;
    QVERIFY(document.importWav(original, QStringLiteral("Asymmetric stereo"), error, &id));
    QVERIFY(document.setSettings(document.state()->name, 48000, 1, error));
    QVERIFY(document.trim(id, 17, 617, error));
    auto output = render(document.snapshot(), {NOVA_AUDIO_WAV_FLOAT32, false, 1}, error);
    QVERIFY2(output, qPrintable(error));
    QCOMPARE(output->frames, quint32(600));
    const auto &pcm = output->waveform->pcm();
    QCOMPARE(pcm[0], 0.0f); QCOMPARE(pcm[1], 0.0f);
    for (quint32 frame = 1; frame < 600; ++frame)
        for (quint32 channel = 0; channel < 2; ++channel)
            QVERIFY2(near(pcm[size_t(frame) * 2 + channel], sample(frame + 17, channel)), "Unity sampler/source-frame correspondence changed");
    // The mandatory one-frame release does not invent an extra zero output frame.
    QVERIFY(near(pcm[1198], sample(616, 0)));
    QVERIFY(std::abs(pcm[1198]) > .1);
    QCOMPARE(output->waveform->info().sample.frames, quint32(600));
    Layer layer = *findLayer(*document.state(), id);
    layer.reverse = true; layer.fadeIn = 9; layer.fadeOut = 13; layer.gain = .5;
    QVERIFY(document.setLayer(layer, document.revision(), error));
    output = render(document.snapshot(), {NOVA_AUDIO_WAV_FLOAT32, false, 1}, error);
    QVERIFY2(output, qPrintable(error));
    for (quint32 frame = 0; frame < 600; ++frame) {
        double fade = 1;
        if (frame < 9) fade *= double(frame) / 8;
        if (frame >= 600 - 13) fade *= double(599 - frame) / 12;
        for (quint32 channel = 0; channel < 2; ++channel)
            QVERIFY(near(output->waveform->pcm()[size_t(frame) * 2 + channel], sample(616 - frame, channel) * .5 * fade));
    }
    QCOMPARE(document.state()->media.front().data->wav(), original);
    QCOMPARE(output->waveform->pcm().back(), 0.0f);
}

void SoundAudioTest::conversionAndIntegerFidelity()
{
    QString error;
    Document document;
    Id id = 0;
    QVERIFY(document.importWav(sound_test::wav(4410, 44100, 1, 24), QStringLiteral("44.1 kHz mono"), error, &id));
    const auto full = render(document.snapshot(), {NOVA_AUDIO_WAV_FLOAT32, false, 1}, error);
    QVERIFY2(full, qPrintable(error));
    QCOMPARE(full->frames, quint32(4800));
    const auto pcm24 = render(document.snapshot(), {NOVA_AUDIO_WAV_PCM24, true, 123}, error);
    QVERIFY(pcm24);
    const auto pcm16 = render(document.snapshot(), {NOVA_AUDIO_WAV_PCM16, true, 123}, error);
    QVERIFY(pcm16);
    for (size_t sample = 0; sample < full->waveform->pcm().size(); ++sample) {
        QVERIFY(near(pcm24->waveform->pcm()[sample], full->waveform->pcm()[sample], 2.0 / 8388608));
        QVERIFY(near(pcm16->waveform->pcm()[sample], full->waveform->pcm()[sample], 2.0 / 32768));
    }
    QCOMPARE(document.state()->media.front().data->info().sample.sample_rate, quint32(44100));
    const auto &signal = full->waveform->pcm();
    double measured = 0, expected = 0, cross = 0;
    for (int frame = 100; frame < 4500; ++frame) {
        const double reference = .4 * std::sin(6.283185307179586 * 311 * frame / 48000) * .8 / std::sqrt(2.0);
        const float value = signal[size_t(frame) * 2];
        measured += value * value; expected += reference * reference; cross += value * reference;
        QVERIFY(near(signal[size_t(frame) * 2], signal[size_t(frame) * 2 + 1], 0.000001));
    }
    QVERIFY(cross / std::sqrt(measured * expected) > .9999);
    QVERIFY(std::abs(std::sqrt(measured / expected) - 1) < .001);
}

void SoundAudioTest::failuresAndCancellation()
{
    QString error;
    Document document;
    QVERIFY(!render(document.snapshot(), {}, error));
    QVERIFY(error.contains(QStringLiteral("enable")));
    Id id = 0;
    QVERIFY(document.importWav(sound_test::wav(4800, 48000, 2, 32,
        [](quint32, quint32) { return .75f; }), QStringLiteral("Hot"), error, &id));
    Layer layer = document.state()->layers.front(); layer.gain = 4;
    QVERIFY(document.setLayer(layer, document.revision(), error));
    QVERIFY(!render(document.snapshot(), {NOVA_AUDIO_WAV_PCM24, false, 1}, error));
    QVERIFY(error.contains(QStringLiteral("clip")));
    const auto floating = render(document.snapshot(), {NOVA_AUDIO_WAV_FLOAT32, false, 1}, error);
    QVERIFY(floating); QVERIFY(floating->overFrames > 0);
    QVERIFY(!render(document.snapshot(), {NOVA_AUDIO_WAV_FLOAT32, true, 1}, error));
    std::atomic_bool cancel{true};
    QVERIFY(!render(document.snapshot(), {}, error, &cancel));
    QVERIFY(error.contains(QStringLiteral("cancelled")));
    ProgramPtr prepared;
    QVERIFY(compile(*document.state(), prepared, error));
    auto *previous = prepared.get();
    QVERIFY(!compile(*document.state(), prepared, error, &cancel));
    QCOMPARE(prepared.get(), previous);

    Document large;
    Id source = 0;
    QVERIFY(large.importWav(sound_test::wav(8000 * 30, 8000, 1, 8), QStringLiteral("Thirty seconds"), error, &id, &source));
    for (int i = 0; i < 4; ++i) QVERIFY(large.addSample(source, error));
    QVERIFY(!compile(*large.state(), prepared, error));
    QVERIFY(error.contains(QStringLiteral("120-second")));
    QCOMPARE(prepared.get(), previous);
}

void SoundAudioTest::asynchronousOwnershipAndCancellation()
{
    QString error;
    Document document;
    for (int i = 0; i < MaxLayers; ++i) {
        Id id = 0; QVERIFY(document.addTone(NOVA_AUDIO_SAW, error, &id));
        Layer layer = *findLayer(*document.state(), id);
        layer.duration = 48000 * 30; layer.gain = .08;
        QVERIFY(document.setLayer(layer, document.revision(), error));
    }
    RenderJob job;
    QSignalSpy finished(&job, &RenderJob::finished);
    int ticks = 0;
    QTimer heartbeat; heartbeat.setInterval(1);
    connect(&heartbeat, &QTimer::timeout, &job, [&] { ++ticks; });
    heartbeat.start();
    QVERIFY(job.start(document.snapshot(), RenderJob::Kind::Export, {NOVA_AUDIO_WAV_FLOAT32, false, 1}, error));
    QVERIFY(!job.start(document.snapshot(), RenderJob::Kind::PrepareAudition, {}, error));
    QTRY_VERIFY(ticks >= 2);
    job.cancel();
    QTRY_COMPARE_WITH_TIMEOUT(finished.count(), 1, 10000);
    auto result = job.takeResult();
    QCOMPARE(result.status, RenderJob::Status::Cancelled);
    QVERIFY(!result.output && !result.program);
    QVERIFY(!job.busy());
    const auto old = document.snapshot();
    QVERIFY(job.start(old, RenderJob::Kind::PrepareAudition, {}, error));
    QVERIFY(document.removeLayer(document.state()->layers.back().id, error));
    QTRY_COMPARE_WITH_TIMEOUT(finished.count(), 2, 10000);
    result = job.takeResult();
    QCOMPARE(result.status, RenderJob::Status::Succeeded);
    QVERIFY(result.program);
    QVERIFY(!document.isCurrent(*result.snapshot));
    QCOMPARE(nova_audio_program_length(result.program.get()), uint64_t(48000 * 30));
    // The joined worker relinquished sole native ownership; control-side use is safe.
    NovaAudioRenderer *renderer = nullptr; char diagnostic[256]{};
    QVERIFY(nova_audio_renderer_create(result.program.get(), &renderer, diagnostic, sizeof(diagnostic)));
    std::array<float, 32> frames{};
    QCOMPARE(nova_audio_render(renderer, frames.data(), 16), NOVA_AUDIO_OK);
    nova_audio_renderer_destroy(renderer);
    {
        RenderJob closing;
        QVERIFY(closing.start(document.snapshot(), RenderJob::Kind::Export, {NOVA_AUDIO_WAV_FLOAT32, false, 1}, error));
    }
}

void SoundAudioTest::explicitAuditionReceiptsAndStop()
{
    Document document;
    QString error;
    QVERIFY(document.addPreset(Preset::AirBrake, error));
    sound_test::FakeHost host;
    Audition audition(document, host);
    QCOMPARE(host.opens, 0);
    QVERIFY(document.addTone(NOVA_AUDIO_SINE, error));
    QTest::qWait(10); QCOMPARE(host.opens, 0);
    QVERIFY(audition.play(error));
    QCOMPARE(host.opens, 0);
    QTRY_COMPARE_WITH_TIMEOUT(audition.state(), AuditionState::Queued, 10000);
    QCOMPARE(host.opens, 1);
    host.suppressReceipts = true;
    QVERIFY(host.tick(512)); audition.poll();
    QCOMPARE(audition.state(), AuditionState::Queued);
    host.suppressReceipts = false;
    audition.poll();
    QCOMPARE(audition.state(), AuditionState::Playing);
    QVERIFY(audition.meters().current.position >= 512);
    QVERIFY(audition.stop(error));
    QCOMPARE(audition.state(), AuditionState::Stopping);
    QVERIFY(host.tick(512)); audition.poll();
    QCOMPARE(audition.state(), AuditionState::Stopped);
    QCOMPARE(host.closes, 0);
    QVERIFY(audition.shutdown(error)); QCOMPARE(host.closes, 1);
    QVERIFY(!audition.ownsHandle());
    QCOMPARE(audition.meters().publication, uint64_t(0));
    QVERIFY(audition.deviceDetails().isEmpty());

    QVERIFY(audition.play(error));
    QTRY_COMPARE_WITH_TIMEOUT(audition.state(), AuditionState::Queued, 10000);
    QCOMPARE(audition.meters().publication, uint64_t(0));
    QVERIFY(audition.stop(error));
    QVERIFY(host.tick(1)); audition.poll();
    QVERIFY(host.cancels >= 2);
    QVERIFY(host.tick(512)); audition.poll();
    QCOMPARE(audition.state(), AuditionState::Stopped);
}

void SoundAudioTest::auditionFidelityAndRevisionRetention()
{
    Document document;
    QString error;
    Id id = 0;
    QVERIFY(document.importWav(sound_test::wav(1024, 48000, 2, 32,
        [](quint32 frame, quint32 channel) { return float((channel ? -.3 : .5) * (1.0 - double(frame) / 2048)); }),
        QStringLiteral("Edges"), error, &id));
    QVERIFY(document.setSettings(document.state()->name, 48000, 1, error));
    const auto output = render(document.snapshot(), {NOVA_AUDIO_WAV_FLOAT32, false, 1}, error);
    QVERIFY(output);
    sound_test::FakeHost host;
    Audition audition(document, host);
    QVERIFY(audition.play(error));
    QTRY_COMPARE_WITH_TIMEOUT(audition.state(), AuditionState::Queued, 10000);
    QVERIFY(host.tick(1024)); audition.poll();
    QCOMPARE(host.rendered.size(), output->waveform->pcm().size());
    for (quint32 frame = 0; frame < 1024; ++frame) {
        const double gain = std::min(1.0, double(frame) / 240);
        for (quint32 channel = 0; channel < 2; ++channel)
            QVERIFY(near(host.rendered[size_t(frame) * 2 + channel],
                         output->waveform->pcm()[size_t(frame) * 2 + channel] * gain));
    }
    QCOMPARE(host.rendered.front(), 0.0f);
    QVERIFY(near(host.rendered.back(), output->waveform->pcm().back()));
    QCOMPARE(audition.state(), AuditionState::Finished);
    Layer layer = document.state()->layers.front(); layer.reverse = true;
    QVERIFY(document.setLayer(layer, document.revision(), error));
    QVERIFY(audition.stale());
    QVERIFY(audition.text().contains(QStringLiteral("older")));
    QVERIFY(audition.play(error));
    layer.name = QStringLiteral("Changed while preparing");
    QVERIFY(document.setLayer(layer, document.revision(), error));
    QTRY_VERIFY_WITH_TIMEOUT(!audition.preparing(), 10000);
    QCOMPARE(host.replacements, 1);
}

void SoundAudioTest::auditionErrorsAndRetirement()
{
    Document document;
    QString error;
    QVERIFY(document.addPreset(Preset::Confirm, error));
    sound_test::FakeHost host;
    {
        Audition audition(document, host);
        host.replaceResult = NOVA_AUDIO_CONTROL_QUEUE_FULL;
        QSignalSpy problems(&audition, &Audition::problem);
        QVERIFY(audition.play(error));
        QTRY_COMPARE_WITH_TIMEOUT(audition.state(), AuditionState::Failed, 10000);
        QVERIFY(!problems.isEmpty());
        QVERIFY(audition.ownsHandle());
        host.replaceResult = NOVA_AUDIO_CONTROL_OK;
        QVERIFY(audition.play(error));
        QTRY_COMPARE_WITH_TIMEOUT(audition.state(), AuditionState::Queued, 10000);
        QVERIFY(host.tick(512));
        host.pollResult = NOVA_AUDIO_CONTROL_DEVICE_UNAVAILABLE;
        audition.poll();
        QVERIFY(!audition.ownsHandle());
        QCOMPARE(audition.state(), AuditionState::Failed);
        QVERIFY(audition.text().contains(QStringLiteral("polling failed")));
    }
    sound_test::FakeHost failedOpen;
    failedOpen.openResult = NOVA_AUDIO_CONTROL_RETIREMENT_PENDING;
    failedOpen.failedOpenOwnsHandle = true;
    failedOpen.closeResult = NOVA_AUDIO_CONTROL_RETIREMENT_PENDING;
    {
        Audition audition(document, failedOpen);
        QVERIFY(audition.play(error));
        QTRY_COMPARE_WITH_TIMEOUT(audition.state(), AuditionState::RetirementPending, 10000);
        QVERIFY(audition.ownsHandle());
        const quint64 owned = audition.handle();
        QVERIFY(!audition.shutdown(error));
        QCOMPARE(audition.handle(), owned);
        QVERIFY(!audition.play(error));
        failedOpen.closeResult = NOVA_AUDIO_CONTROL_OK;
        QVERIFY(audition.shutdown(error)); QVERIFY(!audition.ownsHandle());
    }
    sound_test::FakeHost abandoned;
    abandoned.openResult = NOVA_AUDIO_CONTROL_RETIREMENT_PENDING;
    abandoned.failedOpenOwnsHandle = true;
    abandoned.closeResult = NOVA_AUDIO_CONTROL_RETIREMENT_PENDING;
    {
        Audition audition(document, abandoned);
        QVERIFY(audition.play(error));
        QTRY_COMPARE_WITH_TIMEOUT(audition.state(), AuditionState::RetirementPending, 10000);
    }
    QVERIFY(abandoned.adopted != 0);
    QCOMPARE(abandoned.adopted, abandoned.handle);
    abandoned.closeResult = NOVA_AUDIO_CONTROL_OK;
    QCOMPARE(abandoned.close(abandoned.adopted), NOVA_AUDIO_CONTROL_OK);
}

QTEST_GUILESS_MAIN(SoundAudioTest)
#include "sound_audio_test.moc"
