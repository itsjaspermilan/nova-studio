#pragma once

#include "document.hpp"
#include <QElapsedTimer>
#include <QTimer>
#include <QWidget>

namespace nova::sprite {

class AnimationPreview final : public QWidget {
    Q_OBJECT
public:
    explicit AnimationPreview(Document &document, QWidget *parent = nullptr);
    ~AnimationPreview() override;
    bool isPlaying() const { return timer_.isActive(); }
    Id displayedFrame() const { return displayedFrame_; }
    void setEditingFrame(Id id);
    void setAnimation(Id id);
    void start();
    void stop();
    QSize minimumSizeHint() const override { return {144, 144}; }
signals:
    void playbackChanged(bool playing);
protected:
    void paintEvent(QPaintEvent *event) override;
    void hideEvent(QHideEvent *event) override;
private:
    void tick();
    void refreshImage(Id id);
    Document &document_;
    Id animation_ = 0, editingFrame_ = 0, displayedFrame_ = 0;
    QImage image_;
    QTimer timer_;
    QElapsedTimer clock_;
};

} // namespace nova::sprite
