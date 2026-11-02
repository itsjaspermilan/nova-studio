#include "audition.hpp"

#include <QDebug>
#include <algorithm>

namespace nova::sound {
namespace {
QString diagnostic(NovaAudioControlResult result)
{
    return QString::fromUtf8(nova_audio_control_message(result));
}
} // namespace

Audition::Audition(Document &document, AuditionHost &host, QObject *parent)
    : QObject(parent), document_(document), host_(host)
{
    timer_.setInterval(33);
    connect(&timer_, &QTimer::timeout, this, &Audition::poll);
    connect(&prepare_, &RenderJob::finished, this, &Audition::prepared);
    connect(&document_, &Document::changed, this, [this] {
        if (prepare_.busy()) {
            cancelledPreparation_ = true;
            prepare_.cancel();
            detail_ = tr("Source changed; audition preparation cancelled. Play again for the new revision.");
        }
        emit changed();
    });
}

Audition::~Audition()
{
    disconnect(&document_, nullptr, this, nullptr);
    disconnect(&prepare_, nullptr, this, nullptr);
    QString error;
    if (!shutdown(error) && handle_) {
        qWarning().noquote() << tr("Audition cleanup handed to the host for close retry:") << error;
        host_.retainForCloseRetry(handle_);
        handle_ = 0;
    }
}

bool Audition::stale() const { return active_ && !document_.isCurrent(*active_); }

QString Audition::text() const
{
    QString value;
    switch (state_) {
    case AuditionState::Stopped: value = tr("Audition stopped"); break;
    case AuditionState::Preparing: value = program_ ? tr("Preparing; previous audition continues") : tr("Preparing audition"); break;
    case AuditionState::Queued: value = tr("Play queued; awaiting audio receipt"); break;
    case AuditionState::Playing: value = tr("Audition playing"); break;
    case AuditionState::Stopping: value = tr("Stopping; awaiting receipt / release tail"); break;
    case AuditionState::Finished: value = tr("Audition finished"); break;
    case AuditionState::Failed: value = program_ ? tr("Audition error; previous stream retained") : tr("Audition unavailable"); break;
    case AuditionState::RetirementPending: value = tr("Audition detached; close retry required"); break;
    }
    if (stale()) value += tr(" (older source revision)");
    if (!detail_.isEmpty()) value += QStringLiteral(" - ") + detail_;
    return value;
}

void Audition::report(const QString &message)
{
    detail_ = message;
    state_ = AuditionState::Failed;
    emit problem(message);
    emit changed();
}

bool Audition::play(QString &error)
{
    if (prepare_.busy() || replacement_ || cancellation_) {
        error = tr("Wait for the pending audition command, or stop it, before playing again.");
        return false;
    }
    if (state_ == AuditionState::RetirementPending) {
        error = tr("The detached audition must finish close retirement before it can reopen.");
        return false;
    }
    cancelledPreparation_ = false;
    if (!prepare_.start(document_.snapshot(), RenderJob::Kind::PrepareAudition, {}, error)) return false;
    detail_.clear();
    state_ = AuditionState::Preparing;
    emit changed();
    return true;
}

void Audition::prepared()
{
    auto result = prepare_.takeResult();
    if (cancelledPreparation_ || result.status == RenderJob::Status::Cancelled ||
        !result.snapshot || !document_.isCurrent(*result.snapshot)) {
        state_ = cancellation_ || stopAfterReplace_ ? AuditionState::Stopping :
                 replacement_ ? AuditionState::Queued :
                 program_ && !meters_.current.finished ? AuditionState::Playing :
                 program_ && !meters_.current.cancelled ? AuditionState::Finished : AuditionState::Stopped;
        if (detail_.isEmpty()) detail_ = tr("Preparation cancelled; no new audio was started.");
        emit changed();
        return;
    }
    if (result.status != RenderJob::Status::Succeeded || !result.program) {
        report(result.error);
        return;
    }
    const quint32 rate = nova_audio_program_rate(result.program.get());
    QString error;
    if (handle_ && rate_ != rate && !closeOwned(error)) { emit problem(error); return; }
    if (!handle_) {
        quint64 candidate = 0;
        const auto opened = host_.open(rate, candidate, error);
        // Even a failed open may transfer a detached handle that needs retirement.
        if (candidate) { handle_ = candidate; rate_ = rate; }
        if (opened != NOVA_AUDIO_CONTROL_OK) {
            if (error.isEmpty()) error = diagnostic(opened);
            report(error);
            if (handle_) {
                QString closeError;
                if (!closeOwned(closeError)) {
                    detail_ += QStringLiteral("; ") + closeError;
                    emit problem(closeError);
                }
            }
            if (!handle_) { state_ = AuditionState::Failed; detail_ = error; }
            emit changed();
            return;
        }
        if (!handle_) { report(tr("The audition host reported success without an owned handle.")); return; }
    }
    quint64 ticket = 0;
    const auto queued = host_.replace(handle_, result.program.get(), std::max(1u, rate / 200), ticket);
    if (queued != NOVA_AUDIO_CONTROL_OK) {
        report(tr("Play was not queued: %1").arg(diagnostic(queued)));
        timer_.start();
        return;
    }
    if (!ticket) { report(tr("The audition host returned no replacement ticket.")); return; }
    replacement_ = ticket;
    pending_ = std::move(result.snapshot);
    state_ = AuditionState::Queued;
    detail_.clear();
    timer_.start();
    emit changed();
}

bool Audition::enqueueStop(QString &error)
{
    quint64 ticket = 0;
    const auto queued = host_.cancel(handle_, program_, std::max(1u, rate_ / 100), ticket);
    if (queued != NOVA_AUDIO_CONTROL_OK) {
        error = tr("Stop was not queued: %1").arg(diagnostic(queued));
        report(error);
        return false;
    }
    if (!ticket) { error = tr("The audition host returned no cancellation ticket."); report(error); return false; }
    cancellation_ = ticket;
    state_ = AuditionState::Stopping;
    detail_.clear();
    error.clear();
    emit changed();
    return true;
}

bool Audition::stop(QString &error)
{
    if (prepare_.busy()) {
        cancelledPreparation_ = true;
        prepare_.cancel();
        detail_ = tr("Cancelling preparation.");
    }
    if (state_ == AuditionState::RetirementPending) return closeOwned(error);
    if (replacement_) {
        stopAfterReplace_ = true;
        state_ = AuditionState::Stopping;
        detail_ = tr("Stop will follow the queued replacement receipt.");
        error.clear();
        emit changed();
        return true;
    }
    if (cancellation_) { error.clear(); return true; }
    if (!handle_ || !program_) {
        if (handle_ && !closeOwned(error)) return false;
        state_ = AuditionState::Stopped;
        detail_.clear();
        error.clear();
        emit changed();
        return true;
    }
    return enqueueStop(error);
}

bool Audition::closeOwned(QString &error)
{
    if (!handle_) { error.clear(); return true; }
    const auto result = host_.close(handle_);
    if (result == NOVA_AUDIO_CONTROL_RETIREMENT_PENDING ||
        (result != NOVA_AUDIO_CONTROL_OK && result != NOVA_AUDIO_CONTROL_SOURCE_FAILED &&
         result != NOVA_AUDIO_CONTROL_STALE)) {
        state_ = AuditionState::RetirementPending;
        error = tr("Audition handle retained for close retry: %1").arg(diagnostic(result));
        detail_ = error;
        timer_.stop();
        emit changed();
        return false;
    }
    timer_.stop();
    handle_ = program_ = replacement_ = cancellation_ = 0;
    meters_ = {};
    deviceDetails_.clear();
    active_.reset(); pending_.reset();
    stopAfterReplace_ = false;
    state_ = AuditionState::Stopped;
    if (result != NOVA_AUDIO_CONTROL_OK) {
        detail_ = tr("Audition ownership closed with a diagnostic: %1").arg(diagnostic(result));
        emit problem(detail_);
    }
    error.clear();
    emit changed();
    return true;
}

bool Audition::shutdown(QString &error)
{
    cancelledPreparation_ = true;
    prepare_.cancel();
    timer_.stop();
    return closeOwned(error);
}

void Audition::receipt(const NovaAudioReceipt &value)
{
    if (value.ticket == replacement_) {
        replacement_ = 0;
        if (value.type != NOVA_AUDIO_REPLACE || value.result != NOVA_AUDIO_CONTROL_OK) {
            pending_.reset();
            report(tr("Audio rejected Play: %1").arg(diagnostic(value.result)));
            if (stopAfterReplace_ && program_) { QString error; enqueueStop(error); }
            stopAfterReplace_ = false;
            return;
        }
        program_ = value.program;
        active_ = std::move(pending_);
        state_ = AuditionState::Playing;
        detail_.clear();
        if (stopAfterReplace_) {
            stopAfterReplace_ = false;
            QString error;
            enqueueStop(error);
        }
    } else if (value.ticket == cancellation_) {
        cancellation_ = 0;
        if (value.type != NOVA_AUDIO_CANCEL || value.program != program_ || value.result != NOVA_AUDIO_CONTROL_OK) {
            report(tr("Audio rejected Stop: %1").arg(diagnostic(value.result)));
            return;
        }
        state_ = AuditionState::Stopping;
    } else {
        report(tr("Unexpected audition receipt %1; the owned stream was retained.").arg(value.ticket));
    }
}

void Audition::poll()
{
    if (!handle_ || state_ == AuditionState::RetirementPending) return;
    NovaAudioControlResult fault = NOVA_AUDIO_CONTROL_OK;
    for (int i = 0; i <= NOVA_AUDIO_COMMAND_CAPACITY; ++i) {
        AuditionPoll value;
        const auto result = host_.poll(handle_, value);
        if (!value.deviceDetails.isEmpty()) deviceDetails_ = value.deviceDetails;
        if (value.hasReceipt) receipt(value.receipt);
        if (value.hasSnapshot) {
            meters_ = value.snapshot;
            if (value.snapshot.fault != NOVA_AUDIO_OK) fault = NOVA_AUDIO_CONTROL_RENDER_FAILED;
            if (!replacement_ && !cancellation_ && !prepare_.busy() &&
                value.snapshot.program == program_ && value.snapshot.current.finished &&
                !value.snapshot.retiring_program &&
                (state_ == AuditionState::Playing || state_ == AuditionState::Stopping)) {
                state_ = value.snapshot.current.cancelled ? AuditionState::Stopped : AuditionState::Finished;
                detail_.clear();
            }
        }
        if (result != NOVA_AUDIO_CONTROL_OK) fault = result;
        if (!value.hasReceipt) break;
    }
    if (fault != NOVA_AUDIO_CONTROL_OK) {
        const QString message = tr("Audition polling failed: %1").arg(diagnostic(fault));
        QString closeError;
        closeOwned(closeError);
        if (handle_) {
            detail_ = message + QStringLiteral("; ") + closeError;
            emit problem(detail_);
        } else report(message);
    }
    emit changed();
}

} // namespace nova::sound
