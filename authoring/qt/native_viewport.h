#ifndef NOVA_NATIVE_VIEWPORT_H
#define NOVA_NATIVE_VIEWPORT_H

#include <QElapsedTimer>
#include <QOpenGLWidget>
#include <QSet>
#include <QTimer>
#include <memory>
#include "scene_tools.h"

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
    QPointF widgetPoint(QPointF logical) const;
    void setAuthoringFrame(const NovaFrame &frame);
    void setSelection(int commandIndex);
    int pick(QPointF logical) const;
    Camera3D viewCamera() const;
    bool editing3D() const;
    void setTool(SceneTool tool);
    SceneTool tool() const { return tool_; }
    SceneGizmo gizmo() const;
    int gizmoHandle(QPointF point) const;
    bool beginTransform(int index, int handle, QPointF point);
    bool transformAt(QPointF point, bool snap, double increment, NovaCommand *result) const;
    void frameSelection(bool all = false);
    void gameView();
    void setGridVisible(bool visible);
    void zoomView(double steps);
    void advance(double dt, NovaInput input);

signals:
    void graphicsReady();
    void problem(const QString &message);
    void runningChanged(bool running);
    void scenePressed(QPointF point, Qt::KeyboardModifiers modifiers);
    void sceneDragged(QPointF point);
    void sceneReleased(QPointF point);
    void cancelGesture();
    void toolChanged();
    void interactionHint(const QString &message);

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
    void wheelEvent(QWheelEvent *event) override;
    bool event(QEvent *event) override;

private:
    void releaseGraphics();
    void tick();
    void fail(const QString &message);
    void cancelInteraction();
    void paintEditorOverlay(QPainter &painter);
    float logicalPerPoint() const;
    BoundingBox localBounds(const NovaCommand &command) const;
    BoundingBox bounds(const NovaCommand &command) const;
    NovaEngine *engine_ = nullptr;
    std::unique_ptr<NovaResources> resources_;
    NovaPresentation presentation_{};
    std::unique_ptr<NovaFrame> authoring_, retained_, editingView_;
    QTimer timer_;
    QElapsedTimer clock_;
    QSet<int> keys_;
    QString error_, authoringPath_;
    double accumulator_ = 0;
    int selection_ = -1;
    int hoverHandle_ = -1, activeHandle_ = -1;
    SceneTool tool_ = SceneTool::Move, navigation_ = SceneTool::Orbit;
    SceneGesture gesture_;
    Camera3D editorCamera_{}, navigationStart_{};
    QPointF navigationPointer_;
    Qt::MouseButton navigationButton_ = Qt::NoButton;
    bool editorCameraValid_ = false, gridVisible_ = true;
    bool ready_ = false, running_ = false, dragging_ = false;
};
#endif
