#pragma once

#include "document.hpp"
#include <QWidget>

namespace nova::sound {

class Waveform final : public QWidget {
    Q_OBJECT
public:
    explicit Waveform(QWidget *parent = nullptr);
    void setWave(std::shared_ptr<const WaveData> wave);
    std::shared_ptr<const WaveData> wave() const { return wave_; }
    void setSelection(quint32 begin, quint32 end);
    quint32 selectionBegin() const { return begin_; }
    quint32 selectionEnd() const { return end_; }
    void setRegion(quint32 begin, quint32 end, quint32 fadeIn, quint32 fadeOut, bool reverse);
    void setEmptyText(const QString &text);
    void fit();
    void zoomSelection();
    void zoom(double factor, double anchor = 0.5);
    void panTo(quint32 first);
    quint32 firstFrame() const { return first_; }
    quint32 visibleFrames() const { return visible_; }
    QPointF pointForFrame(quint32 frame) const;
    QSize minimumSizeHint() const override { return {180, 130}; }
signals:
    void selectionChanged(quint32 begin, quint32 end);
    void viewChanged();
protected:
    void paintEvent(QPaintEvent *) override;
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void mouseReleaseEvent(QMouseEvent *event) override;
    void keyPressEvent(QKeyEvent *event) override;
    void wheelEvent(QWheelEvent *event) override;
    void focusOutEvent(QFocusEvent *event) override;
private:
    struct Peak { float low = 0, high = 0; };
    QRectF plotRect() const;
    quint32 frameAt(double x) const;
    Peak peak(quint32 from, quint32 to, quint32 channel) const;
    void updateDrag(double x);
    void cancelDrag();
    std::shared_ptr<const WaveData> wave_;
    std::vector<std::array<Peak, 2>> peaks_;
    float amplitude_ = 1;
    quint32 begin_ = 0, end_ = 0, first_ = 0, visible_ = 0;
    quint32 regionBegin_ = 0, regionEnd_ = 0, fadeIn_ = 0, fadeOut_ = 0;
    quint32 anchor_ = 0, beforeBegin_ = 0, beforeEnd_ = 0;
    bool reverse_ = false, dragging_ = false;
    QString emptyText_;
};

} // namespace nova::sound
