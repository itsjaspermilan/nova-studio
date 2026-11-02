#pragma once

#include "document.hpp"
#include <QWidget>
#include <QPointer>

class QAction;

namespace nova::sprite {

enum class Tool { Select, Move, Pencil, Brush, Eraser, Fill, Line, Rectangle, Ellipse, Eyedropper };
QString toolName(Tool tool);

struct ToolSettings {
    QColor color = QColor("#76dfc6");
    int width = 1;
    int opacity = 255;
    bool filled = false;
};

class Canvas final : public QWidget {
    Q_OBJECT
public:
    explicit Canvas(Document &document, QWidget *parent = nullptr);
    ~Canvas() override;
    void setHistoryActions(QAction *undo, QAction *redo);
    Document &document() { return document_; }
    Id frameId() const { return frame_; }
    Id layerId() const { return layer_; }
    void setFrameId(Id id);
    void setLayerId(Id id);
    Tool tool() const { return tool_; }
    void setTool(Tool tool);
    ToolSettings toolSettings() const { return settings_; }
    bool setToolSettings(const ToolSettings &settings, QString &error);
    QRect selection() const { return selection_; }
    bool setSelection(QRect selection, QString &error);
    bool transformSelection(QRect destination, int quarterTurns, bool flipX, bool flipY, QString &error);
    bool pasteImage(const QImage &image, QString &error);
    void copySelection();
    void cutSelection();
    void pasteClipboard();
    void deleteSelection();
    void cancelGesture();

    qreal zoom() const { return zoom_; }
    void setZoom(qreal zoom);
    void fitCanvas();
    void setGridVisible(bool visible);
    void setOnionSkin(bool enabled, int opacity);
    QPointF canvasOrigin() const;
    QPointF widgetPoint(QPoint pixel) const;
    QPoint imagePoint(QPointF point) const;
    QSize minimumSizeHint() const override { return {240, 240}; }

signals:
    void activeChanged();
    void selectionChanged(QRect selection);
    void viewChanged();
    void colorPicked(QColor color);
    void problem(const QString &message);
    void hintChanged(const QString &message);
    void saveRequested();

protected:
    void paintEvent(QPaintEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void mouseReleaseEvent(QMouseEvent *event) override;
    void wheelEvent(QWheelEvent *event) override;
    void keyPressEvent(QKeyEvent *event) override;
    void keyReleaseEvent(QKeyEvent *event) override;
    void focusOutEvent(QFocusEvent *event) override;
    void showEvent(QShowEvent *event) override;
    bool event(QEvent *event) override;

private:
    void synchronize();
    void announce();
    bool start(QPoint pixel);
    void drag(QPoint pixel);
    void finish();
    void paintMask(QPoint pixel);
    void applyMask();
    void fillMask(QPoint pixel);
    void movePixels(QPoint pixel);
    void zoomAt(qreal zoom, QPointF anchor);
    QPoint bounded(QPoint point) const;
    Document &document_;
    QPointer<QAction> undoAction_, redoAction_;
    Id frame_ = 0, layer_ = 0;
    Tool tool_ = Tool::Pencil;
    ToolSettings settings_;
    QRect selection_, selectionBefore_;
    QPoint cursor_, start_, last_;
    QImage base_, mask_;
    qreal zoom_ = 6;
    QPointF pan_, panStart_, panOrigin_;
    QSize previousSize_;
    bool grid_ = true, onion_ = false, drawing_ = false, panning_ = false;
    bool space_ = false, keyboardAnchor_ = false, cursorVisible_ = false, initialFit_ = false;
    int onionOpacity_ = 64;
};

void drawCheckerboard(QPainter &painter, QRectF rect, qreal cell, const QPalette &palette);
void drawSpriteMarkers(QPainter &painter, const State &state, QPointF origin, qreal scale);

} // namespace nova::sprite
