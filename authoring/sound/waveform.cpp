#include "waveform.hpp"

#include <QFocusEvent>
#include <QKeyEvent>
#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>
#include <QWheelEvent>
#include <algorithm>
#include <cmath>

namespace nova::sound {
namespace { constexpr quint32 PeakBlock = 256; }

Waveform::Waveform(QWidget *parent) : QWidget(parent)
{
    setObjectName(QStringLiteral("soundWaveform"));
    setAccessibleName(tr("Sound waveform"));
    setAccessibleDescription(tr("Select a start-inclusive, end-exclusive frame range. Arrow keys move one frame; Shift extends the end. Exact frame fields are below."));
    setFocusPolicy(Qt::StrongFocus);
    setMouseTracking(true);
    setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Expanding);
    emptyText_ = tr("Add an instrument or import a WAV.\nOriginals are preserved; Play is always explicit.");
}

QRectF Waveform::plotRect() const { return QRectF(36, 27, std::max(1, width() - 48), std::max(1, height() - 53)); }

void Waveform::setWave(std::shared_ptr<const WaveData> wave)
{
    if (wave_ == wave) return;
    cancelDrag();
    wave_ = std::move(wave);
    peaks_.clear();
    amplitude_ = 1;
    begin_ = end_ = first_ = visible_ = regionBegin_ = regionEnd_ = fadeIn_ = fadeOut_ = 0;
    if (wave_) {
        const auto info = wave_->info().sample;
        peaks_.resize((info.frames + PeakBlock - 1) / PeakBlock);
        for (quint32 frame = 0; frame < info.frames; ++frame) {
            for (quint32 channel = 0; channel < info.channels; ++channel) {
                const float value = wave_->pcm()[size_t(frame) * info.channels + channel];
                Peak &p = peaks_[frame / PeakBlock][channel];
                if (frame % PeakBlock == 0) p.low = p.high = value;
                else { p.low = std::min(p.low, value); p.high = std::max(p.high, value); }
                amplitude_ = std::max(amplitude_, std::abs(value));
            }
        }
        end_ = visible_ = regionEnd_ = info.frames;
    }
    emit viewChanged();
    emit selectionChanged(begin_, end_);
    update();
}

void Waveform::setEmptyText(const QString &text) { emptyText_ = text; update(); }

void Waveform::setSelection(quint32 begin, quint32 end)
{
    if (!wave_ || begin >= end || end > wave_->info().sample.frames) return;
    if (begin_ == begin && end_ == end) return;
    begin_ = begin; end_ = end;
    emit selectionChanged(begin_, end_);
    update();
}

void Waveform::setRegion(quint32 begin, quint32 end, quint32 fadeIn, quint32 fadeOut, bool reverse)
{
    regionBegin_ = begin; regionEnd_ = end; fadeIn_ = fadeIn; fadeOut_ = fadeOut; reverse_ = reverse;
    update();
}

void Waveform::fit()
{
    if (!wave_) return;
    first_ = 0; visible_ = wave_->info().sample.frames;
    emit viewChanged(); update();
}

void Waveform::zoomSelection()
{
    if (!wave_ || begin_ >= end_) return;
    first_ = begin_; visible_ = end_ - begin_;
    emit viewChanged(); update();
}

void Waveform::zoom(double factor, double anchor)
{
    if (!wave_ || !std::isfinite(factor) || factor <= 0) return;
    const quint32 count = wave_->info().sample.frames;
    anchor = std::clamp(anchor, 0.0, 1.0);
    const double fixed = first_ + visible_ * anchor;
    visible_ = quint32(std::clamp(std::round(visible_ / factor), 1.0, double(count)));
    first_ = quint32(std::clamp(std::round(fixed - visible_ * anchor), 0.0, double(count - visible_)));
    emit viewChanged(); update();
}

void Waveform::panTo(quint32 first)
{
    if (!wave_) return;
    first_ = std::min(first, wave_->info().sample.frames - visible_);
    emit viewChanged(); update();
}

QPointF Waveform::pointForFrame(quint32 frame) const
{
    const QRectF plot = plotRect();
    return {plot.left() + (double(frame) - first_) / std::max(1u, visible_) * plot.width(), plot.center().y()};
}

quint32 Waveform::frameAt(double x) const
{
    if (!wave_) return 0;
    const QRectF plot = plotRect();
    return quint32(std::clamp(std::round(first_ + (x - plot.left()) / plot.width() * visible_),
                             0.0, double(wave_->info().sample.frames)));
}

Waveform::Peak Waveform::peak(quint32 from, quint32 to, quint32 channel) const
{
    const auto info = wave_->info().sample;
    to = std::min(to, info.frames);
    from = std::min(from, to - 1);
    const float initial = wave_->pcm()[size_t(from) * info.channels + channel];
    Peak result{initial, initial};
    while (from < to) {
        Peak value;
        if (from % PeakBlock == 0 && to - from >= PeakBlock) {
            value = peaks_[from / PeakBlock][channel];
            from += PeakBlock;
        } else {
            value.low = value.high = wave_->pcm()[size_t(from) * info.channels + channel];
            ++from;
        }
        result.low = std::min(result.low, value.low);
        result.high = std::max(result.high, value.high);
    }
    return result;
}

void Waveform::paintEvent(QPaintEvent *)
{
    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing);
    const QColor base = palette().color(QPalette::Base), text = palette().color(QPalette::Text);
    const QColor muted = palette().color(QPalette::PlaceholderText);
    const QColor accent = palette().color(QPalette::Highlight);
    painter.fillRect(rect(), base);
    if (!wave_) {
        painter.setPen(muted);
        painter.drawText(rect().adjusted(20, 20, -20, -20), Qt::AlignCenter | Qt::TextWordWrap, emptyText_);
        return;
    }
    const auto info = wave_->info().sample;
    const QRectF plot = plotRect();
    QFont small = font();
    small.setPointSizeF(std::max(9.0, font().pointSizeF() - 1));
    painter.setFont(small);
    for (int tick = 0; tick <= 4; ++tick) {
        const double x = plot.left() + plot.width() * tick / 4;
        const double seconds = double(first_ + quint64(visible_) * tick / 4) / info.sample_rate;
        painter.setPen(palette().color(QPalette::Mid));
        painter.drawLine(QPointF(x, plot.top()), QPointF(x, plot.bottom()));
        painter.setPen(muted);
        const QString label = tr("%1 s").arg(seconds, 0, 'f', visible_ < info.sample_rate / 10 ? 4 : 2);
        painter.drawText(QRectF(x - 40, 4, 80, 18), Qt::AlignCenter, label);
    }
    painter.save();
    painter.setClipRect(plot);
    const auto x = [&](quint32 frame) { return pointForFrame(frame).x(); };
    QColor selection = accent;
    selection.setAlpha(38);
    painter.fillRect(QRectF(x(begin_), plot.top(), x(end_) - x(begin_), plot.height()), selection);
    for (quint32 channel = 0; channel < info.channels; ++channel) {
        const double h = plot.height() / info.channels;
        const double middle = plot.top() + h * (channel + .5);
        const double scale = h * .41 / amplitude_;
        painter.setPen(palette().color(QPalette::Mid));
        painter.drawLine(QPointF(plot.left(), middle), QPointF(plot.right(), middle));
        painter.setPen(QPen(accent, 1.25));
        const int columns = std::max(1, int(plot.width()));
        if (visible_ <= quint32(columns)) {
            QPainterPath path;
            bool first = true;
            for (quint32 frame = first_; frame < std::min(info.frames, first_ + visible_ + 1); ++frame) {
                const double y = middle - wave_->pcm()[size_t(frame) * info.channels + channel] * scale;
                const QPointF point(x(frame), y);
                if (first) { path.moveTo(point); first = false; }
                else path.lineTo(point);
                if (visible_ < quint32(columns / 4)) {
                    painter.setBrush(accent);
                    painter.drawEllipse(point, 2, 2);
                }
            }
            painter.drawPath(path);
        } else {
            for (int column = 0; column < columns; ++column) {
                const quint32 from = first_ + quint32(quint64(visible_) * column / columns);
                const quint32 to = std::max(from + 1, first_ + quint32(quint64(visible_) * (column + 1) / columns));
                const Peak value = peak(from, to, channel);
                painter.drawLine(QPointF(plot.left() + column, middle - value.low * scale),
                                 QPointF(plot.left() + column, middle - value.high * scale));
            }
        }
    }
    QColor hidden = base;
    hidden.setAlpha(175);
    painter.fillRect(QRectF(plot.left(), plot.top(), x(regionBegin_) - plot.left(), plot.height()), hidden);
    painter.fillRect(QRectF(x(regionEnd_), plot.top(), plot.right() - x(regionEnd_), plot.height()), hidden);
    if (fadeIn_ || fadeOut_) {
        painter.setPen(QPen(muted, 1, Qt::DashLine));
        const quint32 leftFade = reverse_ ? fadeOut_ : fadeIn_, rightFade = reverse_ ? fadeIn_ : fadeOut_;
        if (leftFade) painter.drawLine(QPointF(x(regionBegin_), plot.bottom()), QPointF(x(regionBegin_ + leftFade), plot.top()));
        if (rightFade) painter.drawLine(QPointF(x(regionEnd_ - rightFade), plot.top()), QPointF(x(regionEnd_), plot.bottom()));
    }
    painter.setPen(QPen(accent, 1.5));
    painter.drawLine(QPointF(x(begin_), plot.top()), QPointF(x(begin_), plot.bottom()));
    painter.drawLine(QPointF(x(end_), plot.top()), QPointF(x(end_), plot.bottom()));
    painter.restore();
    painter.setPen(muted);
    painter.drawText(QRectF(1, plot.top(), 32, 18), Qt::AlignCenter, QString::number(amplitude_, 'g', 2));
    painter.drawText(QRectF(1, plot.center().y() - 9, 32, 18), Qt::AlignCenter, info.channels == 2 ? tr("L/R") : tr("M"));
    painter.setPen(text);
    painter.drawText(QRectF(12, height() - 23, width() - 24, 20), Qt::AlignLeft | Qt::AlignVCenter,
                     tr("%1 Hz  |  %2  |  %3 frames%4")
                         .arg(info.sample_rate).arg(info.channels == 2 ? tr("stereo") : tr("mono")).arg(info.frames)
                         .arg(reverse_ ? tr("  |  reverse playback") : QString()));
    if (hasFocus()) {
        painter.setPen(QPen(accent, 2)); painter.setBrush(Qt::NoBrush);
        painter.drawRoundedRect(rect().adjusted(1, 1, -2, -2), 5, 5);
    }
}

void Waveform::mousePressEvent(QMouseEvent *event)
{
    if (event->button() != Qt::LeftButton || !wave_ || !plotRect().contains(event->position())) {
        QWidget::mousePressEvent(event); return;
    }
    setFocus(Qt::MouseFocusReason);
    dragging_ = true;
    beforeBegin_ = begin_; beforeEnd_ = end_;
    anchor_ = std::min(frameAt(event->position().x()), wave_->info().sample.frames - 1);
    updateDrag(event->position().x());
    event->accept();
}

void Waveform::updateDrag(double x)
{
    const quint32 frame = frameAt(x);
    setSelection(std::min(anchor_, frame), std::max(anchor_ + 1, frame));
}

void Waveform::mouseMoveEvent(QMouseEvent *event)
{
    if (dragging_) { updateDrag(event->position().x()); event->accept(); }
    else QWidget::mouseMoveEvent(event);
}

void Waveform::mouseReleaseEvent(QMouseEvent *event)
{
    if (dragging_ && event->button() == Qt::LeftButton) {
        updateDrag(event->position().x()); dragging_ = false; event->accept();
    } else QWidget::mouseReleaseEvent(event);
}

void Waveform::cancelDrag()
{
    if (!dragging_) return;
    dragging_ = false;
    setSelection(beforeBegin_, beforeEnd_);
}

void Waveform::focusOutEvent(QFocusEvent *event) { cancelDrag(); QWidget::focusOutEvent(event); }

void Waveform::keyPressEvent(QKeyEvent *event)
{
    if (!wave_) { QWidget::keyPressEvent(event); return; }
    const quint32 frames = wave_->info().sample.frames;
    if (event->key() == Qt::Key_Escape) cancelDrag();
    else if (event->matches(QKeySequence::SelectAll)) setSelection(0, frames);
    else if (event->key() == Qt::Key_Home) setSelection(0, std::max(1u, end_ - begin_));
    else if (event->key() == Qt::Key_End) setSelection(frames - (end_ - begin_), frames);
    else if (event->key() == Qt::Key_Left || event->key() == Qt::Key_Right) {
        const bool right = event->key() == Qt::Key_Right;
        if (event->modifiers() & Qt::ShiftModifier) {
            if (right && end_ < frames) setSelection(begin_, end_ + 1);
            else if (!right && end_ > begin_ + 1) setSelection(begin_, end_ - 1);
        } else if (right && end_ < frames) setSelection(begin_ + 1, end_ + 1);
        else if (!right && begin_) setSelection(begin_ - 1, end_ - 1);
    } else { QWidget::keyPressEvent(event); return; }
    event->accept();
}

void Waveform::wheelEvent(QWheelEvent *event)
{
    if (!wave_ || event->angleDelta().isNull()) { QWidget::wheelEvent(event); return; }
    if (event->modifiers() & Qt::ShiftModifier) {
        const qint64 first = qint64(first_) - qint64(event->angleDelta().y()) * std::max(1u, visible_ / 8) / 120;
        panTo(quint32(std::clamp<qint64>(first, 0, wave_->info().sample.frames - visible_)));
    } else zoom(event->angleDelta().y() > 0 ? 1.5 : 1 / 1.5, (event->position().x() - plotRect().left()) / plotRect().width());
    event->accept();
}

} // namespace nova::sound
