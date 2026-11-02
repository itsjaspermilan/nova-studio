#include "canvas.hpp"

#include <QApplication>
#include <QAction>
#include <QClipboard>
#include <QFocusEvent>
#include <QKeyEvent>
#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>
#include <QShowEvent>
#include <QWheelEvent>
#include <algorithm>
#include <cmath>

namespace nova::sprite {
namespace {

const QVector<qreal> PixelZooms{0.125, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32};

QRect pixelsBetween(QPoint a, QPoint b)
{
    return QRect(QPoint(std::min(a.x(), b.x()), std::min(a.y(), b.y())),
                 QPoint(std::max(a.x(), b.x()), std::max(a.y(), b.y())));
}

QImage emptyImage(QSize size)
{
    QImage image(size, QImage::Format_ARGB32_Premultiplied);
    image.fill(Qt::transparent);
    return image;
}

QRect contentBounds(const QImage &image)
{
    int left = image.width(), right = -1, top = image.height(), bottom = -1;
    for (int y = 0; y < image.height(); ++y) {
        const QRgb *row = reinterpret_cast<const QRgb *>(image.constScanLine(y));
        for (int x = 0; x < image.width(); ++x) if (qAlpha(row[x])) {
            left = std::min(left, x); right = std::max(right, x);
            top = std::min(top, y); bottom = std::max(bottom, y);
        }
    }
    return right < left ? QRect() : QRect(QPoint(left, top), QPoint(right, bottom));
}

} // namespace

QString toolName(Tool tool)
{
    switch (tool) {
    case Tool::Select: return Canvas::tr("Select");
    case Tool::Move: return Canvas::tr("Move");
    case Tool::Pencil: return Canvas::tr("Pencil");
    case Tool::Brush: return Canvas::tr("Brush");
    case Tool::Eraser: return Canvas::tr("Eraser");
    case Tool::Fill: return Canvas::tr("Fill");
    case Tool::Line: return Canvas::tr("Line");
    case Tool::Rectangle: return Canvas::tr("Rectangle");
    case Tool::Ellipse: return Canvas::tr("Ellipse");
    case Tool::Eyedropper: return Canvas::tr("Eyedropper");
    }
    return {};
}

void drawCheckerboard(QPainter &painter, QRectF rect, qreal cell, const QPalette &palette)
{
    painter.save();
    painter.setClipRect(rect, Qt::IntersectClip);
    QColor a = palette.color(QPalette::Base), b = palette.color(QPalette::AlternateBase);
    painter.fillRect(rect, a);
    for (int y = 0; y < int(std::ceil(rect.height() / cell)); ++y)
        for (int x = 0; x < int(std::ceil(rect.width() / cell)); ++x)
            if ((x + y) & 1)
                painter.fillRect(QRectF(rect.x() + x * cell, rect.y() + y * cell, cell, cell), b);
    painter.restore();
}

void drawSpriteMarkers(QPainter &painter, const State &state, QPointF origin, qreal scale)
{
    painter.save();
    painter.setRenderHint(QPainter::Antialiasing);
    if (state.collision) {
        const QRect &r = *state.collision;
        QRectF bounds(origin.x() + r.x() * scale, origin.y() + r.y() * scale,
                      r.width() * scale, r.height() * scale);
        painter.setBrush(Qt::NoBrush);
        painter.setPen(QPen(QColor("#091522"), 3));
        painter.drawRect(bounds);
        painter.setPen(QPen(QColor("#a8ccff"), 1.5, Qt::DashLine));
        painter.drawRect(bounds);
    }
    QPointF pivot = origin + QPointF(state.pivot) * scale;
    for (const auto &style : {QPair<QColor, qreal>{QColor("#091522"), 4},
                             QPair<QColor, qreal>{QColor("#ffce78"), 2}}) {
        painter.setPen(QPen(style.first, style.second));
        painter.drawLine(pivot + QPointF(-9, 0), pivot + QPointF(9, 0));
        painter.drawLine(pivot + QPointF(0, -9), pivot + QPointF(0, 9));
    }
    painter.restore();
}

Canvas::Canvas(Document &document, QWidget *parent) : QWidget(parent), document_(document)
{
    setObjectName("spriteCanvas");
    setFocusPolicy(Qt::StrongFocus);
    setMouseTracking(true);
    setAccessibleName(tr("Sprite drawing canvas"));
    setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Expanding);
    connect(&document_, &Document::changed, this, &Canvas::synchronize);
    connect(&document_, &Document::pixelsChanged, this, [this] { update(); });
    synchronize();
}

Canvas::~Canvas()
{
    document_.cancelGesture();
    disconnect(&document_, nullptr, this, nullptr);
}

void Canvas::setHistoryActions(QAction *undo, QAction *redo)
{
    undoAction_ = undo;
    redoAction_ = redo;
}

void Canvas::synchronize()
{
    if (!document_.gestureActive()) {
        drawing_ = false;
        keyboardAnchor_ = false;
        base_ = {};
        mask_ = {};
    }
    const State &s = document_.state();
    if (document_.frameIndex(frame_) < 0) frame_ = s.frames.first().id;
    if (document_.layerIndex(layer_) < 0) layer_ = s.layers.first().id;
    if (previousSize_ != s.size) {
        selection_ = selection_.intersected(QRect(QPoint(), s.size));
        cursor_ = bounded(cursor_);
        previousSize_ = s.size;
        emit selectionChanged(selection_);
    }
    if (s.mode == RasterMode::Pixel) setZoom(zoom_);
    emit activeChanged();
    announce();
    update();
}

void Canvas::setFrameId(Id id)
{
    if (document_.frameIndex(id) < 0 || frame_ == id) return;
    cancelGesture();
    frame_ = id;
    emit activeChanged();
    announce();
    update();
}

void Canvas::setLayerId(Id id)
{
    if (document_.layerIndex(id) < 0 || layer_ == id) return;
    cancelGesture();
    layer_ = id;
    emit activeChanged();
    announce();
    update();
}

void Canvas::setTool(Tool tool)
{
    cancelGesture();
    tool_ = tool;
    setCursor(tool == Tool::Move ? Qt::SizeAllCursor : Qt::CrossCursor);
    emit activeChanged();
    announce();
}

bool Canvas::setToolSettings(const ToolSettings &settings, QString &error)
{
    if (!settings.color.isValid() || settings.width < 1 || settings.width > 64 ||
        settings.opacity < 1 || settings.opacity > 255) {
        error = tr("Tool size must be 1..64 px and opacity 1..255, with a valid color.");
        return false;
    }
    settings_ = settings;
    error.clear();
    update();
    return true;
}

bool Canvas::setSelection(QRect selection, QString &error)
{
    if (!selection.isEmpty() && !QRect(QPoint(), document_.state().size).contains(selection)) {
        error = tr("Selection must be inside the canvas.");
        return false;
    }
    cancelGesture();
    selection_ = selection;
    emit selectionChanged(selection_);
    announce();
    update();
    error.clear();
    return true;
}

bool Canvas::transformSelection(QRect destination, int quarterTurns, bool flipX, bool flipY, QString &error)
{
    cancelGesture();
    if (!document_.transformPixels(frame_, layer_, selection_, destination, quarterTurns, flipX, flipY, error))
        return false;
    selection_ = destination;
    emit selectionChanged(selection_);
    update();
    return true;
}

bool Canvas::pasteImage(const QImage &image, QString &error)
{
    cancelGesture();
    QPoint at = selection_.isEmpty() ? QPoint() : selection_.topLeft();
    if (!document_.pastePixels(frame_, layer_, image, at, error)) return false;
    selection_ = QRect(at, image.size());
    emit selectionChanged(selection_);
    update();
    return true;
}

void Canvas::copySelection()
{
    if (selection_.isEmpty()) { emit problem(tr("Select an area to copy, or use Select all.")); return; }
    QApplication::clipboard()->setImage(document_.cel(frame_, layer_).copy(selection_));
    emit hintChanged(tr("Copied selected-layer pixels. Other layers are unchanged."));
}

void Canvas::cutSelection()
{
    QString error;
    if (!document_.canPaint(frame_, layer_, error)) { emit problem(error); return; }
    if (selection_.isEmpty()) { emit problem(tr("Select an area to cut.")); return; }
    copySelection();
    deleteSelection();
}

void Canvas::pasteClipboard()
{
    QImage image = QApplication::clipboard()->image();
    QString error;
    if (!pasteImage(image, error)) emit problem(error);
}

void Canvas::deleteSelection()
{
    cancelGesture();
    QString error;
    if (!document_.clearPixels(frame_, layer_, selection_, error)) emit problem(error);
}

void Canvas::cancelGesture()
{
    bool wasDrawing = drawing_;
    drawing_ = false;
    keyboardAnchor_ = false;
    panning_ = false;
    space_ = false;
    if (wasDrawing) {
        selection_ = selectionBefore_;
        emit selectionChanged(selection_);
    }
    document_.cancelGesture();
    base_ = {};
    mask_ = {};
    update();
}

QPointF Canvas::canvasOrigin() const
{
    return QPointF(width() / 2.0, height() / 2.0) + pan_ -
           QPointF(document_.state().size.width(), document_.state().size.height()) * (zoom_ / 2);
}

QPointF Canvas::widgetPoint(QPoint pixel) const
{
    return canvasOrigin() + (QPointF(pixel) + QPointF(0.5, 0.5)) * zoom_;
}

QPoint Canvas::imagePoint(QPointF point) const
{
    QPointF pixel = (point - canvasOrigin()) / zoom_;
    return {int(std::floor(pixel.x())), int(std::floor(pixel.y()))};
}

QPoint Canvas::bounded(QPoint point) const
{
    return {std::clamp(point.x(), 0, document_.state().size.width() - 1),
            std::clamp(point.y(), 0, document_.state().size.height() - 1)};
}

void Canvas::setZoom(qreal zoom)
{
    if (!std::isfinite(zoom)) return;
    zoom = std::clamp(zoom, qreal(0.125), qreal(32));
    if (document_.state().mode == RasterMode::Pixel)
        zoom = *std::min_element(PixelZooms.begin(), PixelZooms.end(), [zoom](qreal a, qreal b) {
            return std::abs(a - zoom) < std::abs(b - zoom);
        });
    zoom_ = zoom;
    emit viewChanged();
    update();
}

void Canvas::zoomAt(qreal zoom, QPointF anchor)
{
    QPointF pixel = (anchor - canvasOrigin()) / zoom_;
    setZoom(zoom);
    pan_ += anchor - (canvasOrigin() + pixel * zoom_);
    update();
}

void Canvas::fitCanvas()
{
    qreal fit = std::min(qreal(std::max(64, width() - 80)) / document_.state().size.width(),
                         qreal(std::max(64, height() - 80)) / document_.state().size.height());
    if (document_.state().mode == RasterMode::Pixel) {
        qreal candidate = PixelZooms.first();
        for (qreal step : PixelZooms) if (step <= fit) candidate = step;
        fit = candidate;
    }
    pan_ = {};
    setZoom(fit);
}

void Canvas::setGridVisible(bool visible) { grid_ = visible; update(); }

void Canvas::setOnionSkin(bool enabled, int opacity)
{
    onion_ = enabled;
    onionOpacity_ = std::clamp(opacity, 0, 255);
    update();
}

void Canvas::announce()
{
    QString layer = document_.state().layers[document_.layerIndex(layer_)].name;
    QString hint = tr("%1 | Frame %2 | %3 | Cursor %4, %5")
        .arg(toolName(tool_)).arg(document_.frameIndex(frame_) + 1).arg(layer).arg(cursor_.x()).arg(cursor_.y());
    setAccessibleDescription(hint + tr(". Arrow keys move the cursor; Enter draws or sets shape endpoints. Space-drag pans; Home fits. Escape cancels."));
    emit hintChanged(hint);
}

void Canvas::paintEvent(QPaintEvent *)
{
    QPainter p(this);
    p.fillRect(rect(), palette().color(QPalette::Window).darker(115));
    const State &s = document_.state();
    QPointF origin = canvasOrigin();
    QRectF imageRect(origin, QSizeF(s.size) * zoom_);
    QRectF visible = imageRect.intersected(QRectF(rect()));
    drawCheckerboard(p, visible, 12, palette());
    p.save();
    p.setClipRect(imageRect);
    p.setRenderHint(QPainter::SmoothPixmapTransform, s.mode == RasterMode::Smooth);
    if (onion_) {
        int index = document_.frameIndex(frame_);
        for (int adjacent : {index - 1, index + 1}) if (adjacent >= 0 && adjacent < s.frames.size()) {
            QImage onion = composite(s, s.frames[adjacent].id);
            QPainter tint(&onion);
            tint.setCompositionMode(QPainter::CompositionMode_SourceIn);
            tint.fillRect(onion.rect(), adjacent < index ? QColor("#ef9e9e") : QColor("#91baff"));
            tint.end();
            p.setOpacity(onionOpacity_ / 255.0);
            p.drawImage(imageRect, onion);
        }
        p.setOpacity(1);
    }
    p.drawImage(imageRect, composite(s, frame_));
    if (grid_ && zoom_ >= 4) {
        QColor grid = palette().color(QPalette::Mid);
        grid.setAlpha(100);
        p.setPen(QPen(grid, 1));
        int left = std::max(0, int((visible.left() - origin.x()) / zoom_));
        int right = std::min(s.size.width(), int((visible.right() - origin.x()) / zoom_) + 1);
        int top = std::max(0, int((visible.top() - origin.y()) / zoom_));
        int bottom = std::min(s.size.height(), int((visible.bottom() - origin.y()) / zoom_) + 1);
        for (int x = left; x <= right; ++x)
            p.drawLine(QPointF(origin.x() + x * zoom_, visible.top()), QPointF(origin.x() + x * zoom_, visible.bottom()));
        for (int y = top; y <= bottom; ++y)
            p.drawLine(QPointF(visible.left(), origin.y() + y * zoom_), QPointF(visible.right(), origin.y() + y * zoom_));
    }
    p.restore();
    p.setPen(QPen(palette().color(QPalette::Mid), 1.5));
    p.drawRect(imageRect);
    drawSpriteMarkers(p, s, origin, zoom_);
    if (!selection_.isEmpty()) {
        QRectF selected(origin + QPointF(selection_.topLeft()) * zoom_, QSizeF(selection_.size()) * zoom_);
        p.setBrush(Qt::NoBrush);
        p.setPen(QPen(Qt::black, 3));
        p.drawRect(selected);
        p.setPen(QPen(Qt::white, 1.5, Qt::DashLine));
        p.drawRect(selected);
    }
    if (cursorVisible_ && hasFocus()) {
        QPointF point = widgetPoint(cursor_);
        p.setPen(QPen(palette().color(QPalette::Highlight), 1));
        p.drawRect(QRectF(point - QPointF(zoom_ / 2, zoom_ / 2), QSizeF(zoom_, zoom_)));
    }
    if (hasFocus()) {
        p.setBrush(Qt::NoBrush);
        p.setPen(QPen(palette().color(QPalette::Highlight), 2));
        p.drawRect(rect().adjusted(1, 1, -2, -2));
    }
    p.setPen(palette().color(QPalette::Text));
    QString detail = tr("%1 x %2 px  /  %3%").arg(s.size.width()).arg(s.size.height()).arg(qRound(zoom_ * 100));
    p.drawText(rect().adjusted(12, 12, -12, -12), Qt::AlignBottom | Qt::AlignHCenter, detail);
}

bool Canvas::start(QPoint pixel)
{
    if (!QRect(QPoint(), document_.state().size).contains(pixel)) return false;
    cursor_ = pixel;
    selectionBefore_ = selection_;
    start_ = last_ = pixel;
    if (tool_ == Tool::Eyedropper) {
        emit colorPicked(composite(document_.state(), frame_).pixelColor(pixel));
        announce();
        return false;
    }
    if (tool_ == Tool::Select) {
        drawing_ = true;
        selection_ = QRect(pixel, QSize(1, 1));
        emit selectionChanged(selection_);
        update();
        return true;
    }
    QString error;
    if (!document_.canPaint(frame_, layer_, error)) { emit problem(error); return false; }
    if (tool_ == Tool::Move && selection_.isEmpty()) {
        selection_ = contentBounds(document_.cel(frame_, layer_));
        if (selection_.isEmpty()) { emit problem(tr("This layer is empty. Draw or paste pixels before moving.")); return false; }
        selectionBefore_ = selection_;
    }
    if (!document_.beginGesture(tool_ == Tool::Move ? tr("Move selection") : tr("%1 gesture").arg(toolName(tool_)), error)) {
        emit problem(error);
        return false;
    }
    base_ = document_.cel(frame_, layer_);
    mask_ = emptyImage(document_.state().size);
    drawing_ = true;
    if (tool_ == Tool::Fill) {
        fillMask(pixel);
        applyMask();
        finish();
        return false;
    }
    drag(pixel);
    return true;
}

void Canvas::drag(QPoint pixel)
{
    if (!drawing_) return;
    pixel = bounded(pixel);
    cursor_ = pixel;
    if (tool_ == Tool::Select) {
        selection_ = pixelsBetween(start_, pixel);
        emit selectionChanged(selection_);
        update();
    } else if (tool_ == Tool::Move) {
        movePixels(pixel);
    } else {
        paintMask(pixel);
        applyMask();
    }
    last_ = pixel;
    announce();
}

void Canvas::paintMask(QPoint pixel)
{
    bool shape = tool_ == Tool::Line || tool_ == Tool::Rectangle || tool_ == Tool::Ellipse;
    if (shape) mask_.fill(Qt::transparent);
    QPainter p(&mask_);
    if (!selection_.isEmpty()) p.setClipRect(selection_);
    bool smooth = document_.state().mode == RasterMode::Smooth && tool_ != Tool::Pencil;
    p.setRenderHint(QPainter::Antialiasing, smooth);
    qreal width = tool_ == Tool::Pencil ? 1 : settings_.width;
    p.setPen(QPen(Qt::white, width, Qt::SolidLine,
                  tool_ == Tool::Pencil ? Qt::SquareCap : Qt::RoundCap, Qt::RoundJoin));
    if (!shape) {
        p.drawLine(last_, pixel);
    } else if (tool_ == Tool::Line) {
        p.drawLine(start_, pixel);
    } else {
        QRect bounds = pixelsBetween(start_, pixel);
        if (settings_.filled) {
            p.setPen(Qt::NoPen);
            p.setBrush(Qt::white);
            if (tool_ == Tool::Rectangle) p.drawRect(bounds);
            else p.drawEllipse(QRectF(bounds));
        } else {
            p.setBrush(Qt::NoBrush);
            QRectF outline = QRectF(bounds).adjusted(0.5, 0.5, -0.5, -0.5);
            if (tool_ == Tool::Rectangle) p.drawRect(outline);
            else p.drawEllipse(outline);
        }
    }
}

void Canvas::applyMask()
{
    QImage overlay = mask_;
    QPainter tint(&overlay);
    tint.setCompositionMode(QPainter::CompositionMode_SourceIn);
    tint.fillRect(overlay.rect(), tool_ == Tool::Eraser ? QColor(Qt::white) : settings_.color);
    tint.end();
    QImage image = base_;
    QPainter painter(&image);
    painter.setOpacity(settings_.opacity / 255.0);
    if (tool_ == Tool::Eraser) painter.setCompositionMode(QPainter::CompositionMode_DestinationOut);
    painter.drawImage(0, 0, overlay);
    painter.end();
    QString error;
    if (!document_.setCel(frame_, layer_, image, toolName(tool_), error)) {
        cancelGesture();
        emit problem(error);
    }
}

void Canvas::fillMask(QPoint pixel)
{
    QRect area = selection_.isEmpty() ? base_.rect() : selection_;
    if (!area.contains(pixel)) return;
    QRgb target = base_.pixel(pixel);
    QVector<int> pending;
    int width = base_.width();
    auto visit = [&](int x, int y) {
        if (!area.contains(x, y) || base_.pixel(x, y) != target || mask_.pixel(x, y)) return;
        mask_.setPixel(x, y, qRgba(255, 255, 255, 255));
        pending.append(y * width + x);
    };
    visit(pixel.x(), pixel.y());
    while (!pending.isEmpty()) {
        int at = pending.takeLast(), x = at % width, y = at / width;
        visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1);
    }
}

void Canvas::movePixels(QPoint pixel)
{
    QPoint delta = pixel - start_;
    delta.setX(std::clamp(delta.x(), -selectionBefore_.x(),
                         document_.state().size.width() - selectionBefore_.x() - selectionBefore_.width()));
    delta.setY(std::clamp(delta.y(), -selectionBefore_.y(),
                         document_.state().size.height() - selectionBefore_.y() - selectionBefore_.height()));
    selection_ = selectionBefore_.translated(delta);
    QImage image = base_;
    QPainter painter(&image);
    painter.setCompositionMode(QPainter::CompositionMode_Source);
    painter.fillRect(selectionBefore_, Qt::transparent);
    painter.setCompositionMode(QPainter::CompositionMode_SourceOver);
    painter.drawImage(selection_.topLeft(), base_.copy(selectionBefore_));
    painter.end();
    QString error;
    if (!document_.setCel(frame_, layer_, image, tr("Move selection"), error)) {
        cancelGesture();
        emit problem(error);
        return;
    }
    emit selectionChanged(selection_);
    update();
}

void Canvas::finish()
{
    if (!drawing_) return;
    drawing_ = false;
    keyboardAnchor_ = false;
    if (document_.gestureActive()) {
        QString error;
        if (!document_.endGesture(error)) emit problem(error);
    }
    base_ = {};
    mask_ = {};
    announce();
    update();
}

void Canvas::mousePressEvent(QMouseEvent *event)
{
    setFocus(Qt::MouseFocusReason);
    cursorVisible_ = false;
    if (event->button() == Qt::MiddleButton || (event->button() == Qt::LeftButton && space_)) {
        panning_ = true;
        panStart_ = event->position();
        panOrigin_ = pan_;
        event->accept();
    } else if (event->button() == Qt::LeftButton) {
        start(imagePoint(event->position()));
        event->accept();
    } else QWidget::mousePressEvent(event);
}

void Canvas::mouseMoveEvent(QMouseEvent *event)
{
    if (panning_) {
        pan_ = panOrigin_ + event->position() - panStart_;
        update();
    } else if (drawing_ && !keyboardAnchor_) {
        drag(imagePoint(event->position()));
    } else {
        cursor_ = bounded(imagePoint(event->position()));
        announce();
    }
}

void Canvas::mouseReleaseEvent(QMouseEvent *event)
{
    if (panning_) { panning_ = false; return; }
    if (event->button() == Qt::LeftButton && drawing_ && !keyboardAnchor_) {
        drag(imagePoint(event->position()));
        finish();
    }
}

void Canvas::wheelEvent(QWheelEvent *event)
{
    if (!event->pixelDelta().isNull() && !(event->modifiers() & Qt::ControlModifier)) {
        pan_ += event->pixelDelta();
        update();
    } else if (event->modifiers() & Qt::ShiftModifier) {
        pan_ += QPointF(event->angleDelta().y() / 2.0, event->angleDelta().x() / 2.0);
        update();
    } else if (event->angleDelta().y() || event->pixelDelta().y()) {
        qreal next = zoom_;
        int delta = event->angleDelta().y() ? event->angleDelta().y() : event->pixelDelta().y();
        int direction = delta > 0 ? 1 : -1;
        if (document_.state().mode == RasterMode::Pixel) {
            int current = int(PixelZooms.indexOf(zoom_));
            next = PixelZooms[std::clamp(current + direction, 0, int(PixelZooms.size()) - 1)];
        } else next *= direction > 0 ? 1.2 : 1 / 1.2;
        zoomAt(next, event->position());
    }
    event->accept();
}

void Canvas::keyPressEvent(QKeyEvent *event)
{
    if (event->matches(QKeySequence::Undo) || event->matches(QKeySequence::Redo)) {
        bool redo = event->matches(QKeySequence::Redo);
        bool wasDrawing = document_.gestureActive();
        cancelGesture();
        if (wasDrawing) return;
        QAction *action = redo ? redoAction_.data() : undoAction_.data();
        if (action) {
            if (action->isEnabled()) action->trigger();
            else emit problem(action->toolTip());
        } else if (redo) document_.undoStack()->redo();
        else document_.undoStack()->undo();
        return;
    }
    if (event->matches(QKeySequence::Copy)) { copySelection(); return; }
    if (event->matches(QKeySequence::Cut)) { cutSelection(); return; }
    if (event->matches(QKeySequence::Paste)) { pasteClipboard(); return; }
    if (event->matches(QKeySequence::Save)) { finish(); emit saveRequested(); return; }
    if (event->matches(QKeySequence::SelectAll)) {
        QString error;
        setSelection(QRect(QPoint(), document_.state().size), error);
        return;
    }
    if (event->key() == Qt::Key_Escape) {
        cancelGesture();
        selection_ = {};
        emit selectionChanged(selection_);
        update();
        return;
    }
    if (event->key() == Qt::Key_Space) { space_ = true; return; }
    if (event->key() == Qt::Key_Home) { fitCanvas(); return; }
    if (event->key() == Qt::Key_Plus || event->key() == Qt::Key_Equal) { setZoom(zoom_ < 1 ? zoom_ * 2 : zoom_ + 1); return; }
    if (event->key() == Qt::Key_Minus) { setZoom(zoom_ <= 1 ? zoom_ / 2 : zoom_ - 1); return; }
    if (event->key() == Qt::Key_Delete || event->key() == Qt::Key_Backspace) { deleteSelection(); return; }
    if (event->key() == Qt::Key_Return || event->key() == Qt::Key_Enter) {
        cursorVisible_ = true;
        if (keyboardAnchor_) {
            drag(cursor_);
            finish();
        } else {
            bool started = start(cursor_);
            bool twoPoints = tool_ == Tool::Select || tool_ == Tool::Move || tool_ == Tool::Line ||
                             tool_ == Tool::Rectangle || tool_ == Tool::Ellipse;
            if (started && twoPoints) keyboardAnchor_ = true;
            else finish();
        }
        return;
    }
    QPoint delta;
    switch (event->key()) {
    case Qt::Key_Left: delta = {-1, 0}; break;
    case Qt::Key_Right: delta = {1, 0}; break;
    case Qt::Key_Up: delta = {0, -1}; break;
    case Qt::Key_Down: delta = {0, 1}; break;
    default: break;
    }
    if (!delta.isNull()) {
        int distance = event->modifiers() & Qt::ShiftModifier ? 10 : 1;
        if (event->modifiers() & Qt::AltModifier) {
            pan_ -= QPointF(delta) * 24;
        } else if (tool_ == Tool::Move && !selection_.isEmpty() && !keyboardAnchor_) {
            QString error;
            if (!transformSelection(selection_.translated(delta * distance), 0, false, false, error)) emit problem(error);
        } else {
            cursorVisible_ = true;
            cursor_ = bounded(cursor_ + delta * distance);
            if (keyboardAnchor_) drag(cursor_);
        }
        announce();
        update();
        return;
    }
    if (event->modifiers() == Qt::NoModifier) {
        switch (event->key()) {
        case Qt::Key_Q: setTool(Tool::Select); return;
        case Qt::Key_W: setTool(Tool::Move); return;
        case Qt::Key_P: setTool(Tool::Pencil); return;
        case Qt::Key_B: setTool(Tool::Brush); return;
        case Qt::Key_E: setTool(Tool::Eraser); return;
        case Qt::Key_G: setTool(Tool::Fill); return;
        case Qt::Key_L: setTool(Tool::Line); return;
        case Qt::Key_R: setTool(Tool::Rectangle); return;
        case Qt::Key_O: setTool(Tool::Ellipse); return;
        case Qt::Key_I: setTool(Tool::Eyedropper); return;
        default: break;
        }
    }
    QWidget::keyPressEvent(event);
}

void Canvas::keyReleaseEvent(QKeyEvent *event)
{
    if (event->key() == Qt::Key_Space && !event->isAutoRepeat()) space_ = false;
    else QWidget::keyReleaseEvent(event);
}

void Canvas::focusOutEvent(QFocusEvent *event)
{
    cancelGesture();
    QWidget::focusOutEvent(event);
}

void Canvas::showEvent(QShowEvent *event)
{
    QWidget::showEvent(event);
    if (!initialFit_) { initialFit_ = true; fitCanvas(); }
}

bool Canvas::event(QEvent *event)
{
    if (event->type() == QEvent::WindowDeactivate || event->type() == QEvent::Hide ||
        event->type() == QEvent::UngrabMouse)
        cancelGesture();
    return QWidget::event(event);
}

} // namespace nova::sprite
