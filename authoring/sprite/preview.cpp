#include "preview.hpp"
#include "canvas.hpp"

#include <QHideEvent>
#include <QPainter>

namespace nova::sprite {

AnimationPreview::AnimationPreview(Document &document, QWidget *parent) : QWidget(parent), document_(document)
{
    setObjectName("spriteAnimationPreview");
    setAccessibleName(tr("Animation preview, editor only"));
    editingFrame_ = document_.state().frames.first().id;
    refreshImage(editingFrame_);
    timer_.setInterval(8);
    timer_.setTimerType(Qt::PreciseTimer);
    connect(&timer_, &QTimer::timeout, this, &AnimationPreview::tick);
    connect(&document_, &Document::changed, this, [this] {
        stop();
        if (document_.frameIndex(editingFrame_) < 0) editingFrame_ = document_.state().frames.first().id;
        if (playbackFrames(document_.state(), animation_).isEmpty()) animation_ = 0;
        refreshImage(editingFrame_);
    });
    connect(&document_, &Document::pixelsChanged, this, [this](Id id, Id) {
        if (isPlaying()) stop();
        if (id == editingFrame_) refreshImage(id);
    });
}

AnimationPreview::~AnimationPreview()
{
    timer_.stop();
    disconnect(&document_, nullptr, this, nullptr);
}

void AnimationPreview::refreshImage(Id id)
{
    displayedFrame_ = id;
    image_ = composite(document_.state(), id);
    update();
}

void AnimationPreview::setEditingFrame(Id id)
{
    editingFrame_ = id;
    if (!isPlaying()) refreshImage(id);
}

void AnimationPreview::setAnimation(Id id)
{
    stop();
    animation_ = id;
}

void AnimationPreview::start()
{
    if (playbackFrames(document_.state(), animation_).isEmpty() || document_.gestureActive()) return;
    clock_.restart();
    timer_.start();
    tick();
    emit playbackChanged(true);
}

void AnimationPreview::stop()
{
    bool wasPlaying = isPlaying();
    timer_.stop();
    if (document_.frameIndex(editingFrame_) >= 0) refreshImage(editingFrame_);
    if (wasPlaying) emit playbackChanged(false);
}

void AnimationPreview::tick()
{
    bool finished = false;
    Id frame = frameAtTime(document_.state(), animation_, clock_.elapsed(), &finished);
    if (frame != displayedFrame_) refreshImage(frame);
    if (finished) {
        timer_.stop();
        emit playbackChanged(false);
    }
}

void AnimationPreview::paintEvent(QPaintEvent *)
{
    QPainter painter(this);
    QRectF area = QRectF(rect()).adjusted(12, 12, -12, -30);
    qreal scale = std::min(area.width() / document_.state().size.width(),
                           area.height() / document_.state().size.height());
    QSizeF size = QSizeF(document_.state().size) * scale;
    QRectF target(area.center() - QPointF(size.width() / 2, size.height() / 2), size);
    drawCheckerboard(painter, target, 8, palette());
    painter.setRenderHint(QPainter::SmoothPixmapTransform, document_.state().mode == RasterMode::Smooth);
    painter.drawImage(target, image_);
    drawSpriteMarkers(painter, document_.state(), target.topLeft(), scale);
    painter.setPen(palette().color(QPalette::Text));
    painter.drawText(rect().adjusted(4, 4, -4, -6), Qt::AlignBottom | Qt::AlignHCenter,
        tr("Preview / frame %1").arg(document_.frameIndex(displayedFrame_) + 1));
}

void AnimationPreview::hideEvent(QHideEvent *event)
{
    stop();
    QWidget::hideEvent(event);
}

} // namespace nova::sprite
