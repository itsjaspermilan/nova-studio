#ifndef NOVA_NATIVE_VIEWPORT_H
#define NOVA_NATIVE_VIEWPORT_H

#include <QElapsedTimer>
#include <QOpenGLWidget>
#include <QSet>
#include <QTimer>
#include <memory>

extern "C" {
#include "presentation.h"
}

class NativeViewport final : public QOpenGLWidget {
    Q_OBJECT
public:
    explicit NativeViewport(QWidget *parent = nullptr);
    ~NativeViewport() override;
    bool openProject(const QString &path);
    bool openAuthoring(const QString &path, const QByteArray &manifest,
        const QByteArray &scene, const QByteArray &source);
    void setRunning(bool running);
    bool running() const { return running_; }
    bool ready() const { return ready_; }
    const NovaFrame *frame() const {
        return engine_ ? (!running_ && authoring_ ? authoring_.get() : retained_.get()) : nullptr;
    }
    const NovaResources &resources() const { return *resources_; }
    QString error() const { return error_; }
    QPointF logicalPoint(QPointF point) const;
    void setAuthoringFrame(const NovaFrame &frame);
    void setSelection(int commandIndex);
    int pick(QPointF logical) const;
    QPointF groundPoint(QPointF logical, float height) const;
    void advance(double dt, NovaInput input);

signals:
    void graphicsReady();
    void problem(const QString &message);
    void runningChanged(bool running);
    void scenePressed(QPointF point, Qt::KeyboardModifiers modifiers);
    void sceneDragged(QPointF point);
    void sceneReleased(QPointF point);
    void cancelGesture();

protected:
    void initializeGL() override;
    void resizeGL(int width, int height) override;
    void paintGL() override;
    void keyPressEvent(QKeyEvent *event) override;
    void keyReleaseEvent(QKeyEvent *event) override;
    void focusOutEvent(QFocusEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void mouseReleaseEvent(QMouseEvent *event) override;
    bool event(QEvent *event) override;

private:
    void releaseGraphics();
    void tick();
    void fail(const QString &message);
    BoundingBox bounds(const NovaCommand &command) const;
    NovaEngine *engine_ = nullptr;
    std::unique_ptr<NovaResources> resources_;
    NovaPresentation presentation_{};
    std::unique_ptr<NovaFrame> authoring_, retained_;
    QTimer timer_;
    QElapsedTimer clock_;
    QSet<int> keys_;
    QString error_;
    double accumulator_ = 0;
    int selection_ = -1;
    bool ready_ = false, running_ = false, dragging_ = false;
};
#endif
