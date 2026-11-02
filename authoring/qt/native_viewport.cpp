#include "native_viewport.h"
#include "raylib_host.h"
#include <QApplication>
#include <QFocusEvent>
#include <QKeyEvent>
#include <QMouseEvent>
#include <QOpenGLContext>
#include <QOpenGLFunctions>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>

extern "C" {
#include <rlgl.h>
}

static NativeViewport *graphicsOwner;

static void *resolveGL(const char *name)
{
    const auto function = QOpenGLContext::currentContext()->getProcAddress(name);
    void *result = nullptr;
    static_assert(sizeof(result) == sizeof(function));
    std::memcpy(&result, &function, sizeof(result));
    return result;
}

NativeViewport::NativeViewport(QWidget *parent)
    : QOpenGLWidget(parent), resources_(std::make_unique<NovaResources>()),
      retained_(std::make_unique<NovaFrame>())
{
    setObjectName("nativeViewport");
    setAccessibleName(tr("Native game viewport"));
    setAccessibleDescription(tr("Click to select. While running, click to give the game keyboard focus. Escape releases focus."));
    setFocusPolicy(Qt::StrongFocus);
    setMinimumSize(320, 180);
    timer_.setInterval(16);
    connect(&timer_, &QTimer::timeout, this, &NativeViewport::tick);
    connect(qApp, &QGuiApplication::applicationStateChanged, this, [this] {
        keys_.clear();
        accumulator_ = 0;
        clock_.restart();
        if (ready_) nova_pause_services(resources_.get(), !isActiveWindow());
    });
}

NativeViewport::~NativeViewport()
{
    // Parent-owned actions may already be gone during QWidget child teardown.
    disconnect(this, nullptr, nullptr, nullptr);
    disconnect(qApp, nullptr, this, nullptr);
    releaseGraphics();
}

void NativeViewport::initializeGL()
{
    if (graphicsOwner && graphicsOwner != this) {
        fail(tr("The shared native renderer supports one context-owned viewport per application process."));
        return;
    }
    if (QOpenGLContext::currentContext()->isOpenGLES() ||
        format().majorVersion() < 3 || (format().majorVersion() == 3 && format().minorVersion() < 3)) {
        fail(tr("The native preview requires desktop OpenGL 3.3 or later."));
        return;
    }
    auto loader = &resolveGL;
    void *loaderPointer = nullptr;
    static_assert(sizeof(loader) == sizeof(loaderPointer));
    std::memcpy(&loaderPointer, &loader, sizeof(loader));
    nova_qt_graphics_init(loaderPointer, qRound(width() * devicePixelRatioF()),
        qRound(height() * devicePixelRatioF()));
    char error[1024] = {};
    if (!nova_presentation_configure(&presentation_, nova_world_resolution_default(), error, sizeof(error))) {
        CloseWindow();
        fail(QString::fromUtf8(error));
        return;
    }
    ready_ = true;
    graphicsOwner = this;
    connect(context(), &QOpenGLContext::aboutToBeDestroyed, this,
        &NativeViewport::releaseGraphics, Qt::DirectConnection);
    clock_.start();
    timer_.start();
    emit graphicsReady();
}

void NativeViewport::releaseGraphics()
{
    timer_.stop();
    if (context()) disconnect(context(), &QOpenGLContext::aboutToBeDestroyed,
        this, &NativeViewport::releaseGraphics);
    if (!ready_) return;
    makeCurrent();
    nova_destroy(engine_);
    engine_ = nullptr;
    nova_unload_resources(resources_.get());
    nova_presentation_destroy(&presentation_);
    CloseWindow();
    ready_ = false;
    graphicsOwner = nullptr;
    running_ = false;
    authoring_.reset();
    emit runningChanged(false);
    doneCurrent();
}

void NativeViewport::resizeGL(int, int)
{
    if (ready_) nova_qt_graphics_resize(qRound(width() * devicePixelRatioF()),
        qRound(height() * devicePixelRatioF()));
}

void NativeViewport::fail(const QString &message)
{
    error_ = message;
    setRunning(false);
    emit problem(message);
    update();
}

bool NativeViewport::openProject(const QString &path)
{
    if (!ready_) {
        fail(tr("The native viewport is not ready yet."));
        return false;
    }
    makeCurrent();
    char error[1024] = {};
    const QByteArray nativePath = path.toUtf8();
    const bool ok = nova_open_scene(&engine_, resources_.get(), nativePath.constData(), true, error, sizeof(error));
    if (ok) {
        error_.clear();
        authoring_.reset();
        *retained_ = *nova_frame(engine_);
    }
    doneCurrent();
    if (!ok) fail(QString::fromUtf8(error));
    update();
    return ok;
}

bool NativeViewport::openAuthoring(const QString &path, const QByteArray &manifest,
    const QByteArray &scene, const QByteArray &source)
{
    if (!ready_) return false;
    makeCurrent();
    char error[1024] = {};
    const NovaProjectDraft draft{manifest.constData(), source.constData(), scene.constData(),
        size_t(manifest.size()), size_t(source.size()), size_t(scene.size())};
    const bool ok = nova_open_authoring_snapshot(&engine_, resources_.get(), path.toUtf8().constData(),
        &draft, error, sizeof(error));
    if (ok) {
        *retained_ = *nova_frame(engine_);
        authoring_.reset();
        error_.clear();
    }
    doneCurrent();
    if (!ok) fail(QString::fromUtf8(error));
    update();
    return ok;
}

void NativeViewport::setRunning(bool running)
{
    if (running && (!ready_ || !engine_)) return;
    running_ = running;
    if (running) authoring_.reset();
    keys_.clear();
    accumulator_ = 0;
    clock_.restart();
    if (ready_) nova_pause_services(resources_.get(), !running);
    emit runningChanged(running);
    update();
}

void NativeViewport::setAuthoringFrame(const NovaFrame &frame)
{
    if (frame.count > NOVA_MAX_COMMANDS) {
        fail(tr("Authoring frame exceeds the shared draw-command budget."));
        return;
    }
    for (size_t i = 0; i < frame.count; ++i) {
        const auto &draw = frame.commands[i];
        if ((draw.type == NOVA_SPRITE || draw.type == NOVA_MODEL) &&
            (draw.asset >= resources_->count || resources_->resources[draw.asset].type !=
                (draw.type == NOVA_SPRITE ? NOVA_ASSET_SPRITE : NOVA_ASSET_MODEL))) {
            fail(tr("Draft assets are not loaded. The previous native preview is retained."));
            return;
        }
    }
    if (!authoring_) authoring_ = std::make_unique<NovaFrame>();
    *authoring_ = frame;
    update();
}

void NativeViewport::setSelection(int index) { selection_ = index; update(); }

void NativeViewport::advance(double dt, NovaInput input)
{
    if (!ready_ || !engine_) return;
    if (!nova_tick(engine_, dt, input) || !nova_tick_services(engine_, resources_.get())) {
        fail(QString::fromUtf8(nova_error(engine_)));
        return;
    }
    *retained_ = *nova_frame(engine_);
    update();
}

void NativeViewport::tick()
{
    const double elapsed = std::min(clock_.restart() / 1000.0, 0.1);
    const bool active = running_ && isVisible() && isActiveWindow() && hasFocus() &&
        !QApplication::activeModalWidget();
    if (ready_) nova_pause_services(resources_.get(), !active);
    if (!active) { accumulator_ = 0; keys_.clear(); return; }
    NovaInput input{};
    input.horizontal = (keys_.contains(Qt::Key_D) || keys_.contains(Qt::Key_Right)) -
        (keys_.contains(Qt::Key_A) || keys_.contains(Qt::Key_Left));
    input.vertical = (keys_.contains(Qt::Key_S) || keys_.contains(Qt::Key_Down)) -
        (keys_.contains(Qt::Key_W) || keys_.contains(Qt::Key_Up));
    input.action = keys_.contains(Qt::Key_Space);
    accumulator_ += elapsed;
    while (accumulator_ >= 1.0 / 60.0 && running_) {
        advance(1.0 / 60.0, input);
        accumulator_ -= 1.0 / 60.0;
    }
}

void NativeViewport::paintGL()
{
    if (!ready_) return;
    const int w = qRound(width() * devicePixelRatioF()), h = qRound(height() * devicePixelRatioF());
    const NovaFrame *frame = !running_ && authoring_ ? authoring_.get() : retained_.get();
    // Qt may change GL state while compositing its widgets. Re-establish the
    // public rlgl baseline on every paint; the current context is Qt-owned.
    rlEnableDepthMask();
    rlDisableDepthTest();
    rlDisableScissorTest();
    rlEnableBackfaceCulling();
    rlEnableColorBlend();
    rlSetBlendMode(BLEND_ALPHA);
    rlActiveTextureSlot(0);
    auto *gl = context()->functions();
    gl->glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    gl->glBlendEquation(GL_FUNC_ADD);
    gl->glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
    gl->glDepthFunc(GL_LEQUAL);
    gl->glFrontFace(GL_CCW);
    gl->glCullFace(GL_BACK);
    nova_qt_graphics_resize(w, h);
    nova_presentation_world(&presentation_, frame, resources_.get());
    if (!running_ && selection_ >= 0 && static_cast<size_t>(selection_) < frame->count &&
        (frame->commands[selection_].type == NOVA_CUBE || frame->commands[selection_].type == NOVA_MODEL)) {
        BeginTextureMode(presentation_.world);
        BeginMode3D(Camera3D{{frame->camera_position.x, frame->camera_position.y, frame->camera_position.z},
            {frame->camera_target.x, frame->camera_target.y, frame->camera_target.z}, {0, 1, 0},
            frame->camera_fov, CAMERA_PERSPECTIVE});
        DrawBoundingBox(bounds(frame->commands[selection_]), Color{255, 215, 100, 255});
        EndMode3D();
        EndTextureMode();
    }
    // EndTextureMode restores raylib's default 0. The destination here is
    // Qt's real (nonzero, resize-dependent) framebuffer, never a CPU image.
    rlEnableFramebuffer(defaultFramebufferObject());
    NovaCanvasState canvas = nova_begin_canvas(w, h);
    ClearBackground(Color{20, 24, 36, 255});
    const NovaViewport viewport = nova_viewport(w, h, false);
    nova_presentation_composite(&presentation_, frame, resources_.get(), viewport);
    if (!running_ && selection_ >= 0 && static_cast<size_t>(selection_) < frame->count) {
        const NovaCommand &draw = frame->commands[selection_];
        if (draw.type == NOVA_RECTANGLE || draw.type == NOVA_SPRITE) {
            const Matrix previous = nova_begin_overlay(viewport);
            DrawRectangleLinesEx(Rectangle{draw.position.x - 2, draw.position.y - 2,
                draw.size.x + 4, draw.size.y + 4}, 2, Color{255, 215, 100, 255});
            nova_end_overlay(previous);
        }
    }
    nova_end_canvas(canvas);
    rlDrawRenderBatchActive();
}

QPointF NativeViewport::logicalPoint(QPointF point) const
{
    NovaPresentationLayout layout{};
    Vector2 result{};
    if (!nova_presentation_layout(width(), height(), qRound(width() * devicePixelRatioF()),
        qRound(height() * devicePixelRatioF()), false, &layout) ||
        !nova_presentation_pointer(&layout, Vector2{float(point.x()), float(point.y())}, &result))
        return {qQNaN(), qQNaN()};
    return {result.x, result.y};
}

BoundingBox NativeViewport::bounds(const NovaCommand &draw) const
{
    BoundingBox box{{-.5f, -.5f, -.5f}, {.5f, .5f, .5f}};
    if (draw.type == NOVA_MODEL && draw.asset < resources_->count) {
        const auto &info = resources_->inspection[draw.asset];
        box = {{info.bounds_min.x, info.bounds_min.y, info.bounds_min.z},
            {info.bounds_max.x, info.bounds_max.y, info.bounds_max.z}};
    }
    box.min = {box.min.x * draw.size.x + draw.position.x, box.min.y * draw.size.y + draw.position.y,
        box.min.z * draw.size.z + draw.position.z};
    box.max = {box.max.x * draw.size.x + draw.position.x, box.max.y * draw.size.y + draw.position.y,
        box.max.z * draw.size.z + draw.position.z};
    return box;
}

int NativeViewport::pick(QPointF logical) const
{
    if (!authoring_ || !std::isfinite(logical.x()) || !std::isfinite(logical.y()) || logical.x() < 0 || logical.y() < 0 ||
        logical.x() >= NOVA_WIDTH || logical.y() >= NOVA_HEIGHT) return -1;
    const auto &frame = *authoring_;
    const Camera3D camera{{frame.camera_position.x, frame.camera_position.y, frame.camera_position.z},
        {frame.camera_target.x, frame.camera_target.y, frame.camera_target.z}, {0, 1, 0},
        frame.camera_fov, CAMERA_PERSPECTIVE};
    const Ray ray = GetScreenToWorldRayEx({float(logical.x()), float(logical.y())}, camera, NOVA_WIDTH, NOVA_HEIGHT);
    int selected = -1;
    float distance = std::numeric_limits<float>::max();
    for (size_t i = frame.count; i > 0; --i) {
        const auto &draw = frame.commands[i - 1];
        if (draw.type == NOVA_RECTANGLE || draw.type == NOVA_SPRITE) {
            if (logical.x() >= draw.position.x && logical.y() >= draw.position.y &&
                logical.x() < draw.position.x + draw.size.x && logical.y() < draw.position.y + draw.size.y)
                return int(i - 1);
        } else if (draw.type == NOVA_CUBE || draw.type == NOVA_MODEL) {
            const auto hit = GetRayCollisionBox(ray, bounds(draw));
            if (hit.hit && hit.distance < distance) { distance = hit.distance; selected = int(i - 1); }
        }
    }
    return selected;
}

QPointF NativeViewport::groundPoint(QPointF logical, float height) const
{
    if (!authoring_) return {};
    const auto &frame = *authoring_;
    const Camera3D camera{{frame.camera_position.x, frame.camera_position.y, frame.camera_position.z},
        {frame.camera_target.x, frame.camera_target.y, frame.camera_target.z}, {0, 1, 0},
        frame.camera_fov, CAMERA_PERSPECTIVE};
    const Ray ray = GetScreenToWorldRayEx({float(logical.x()), float(logical.y())}, camera, NOVA_WIDTH, NOVA_HEIGHT);
    if (std::abs(ray.direction.y) < 0.00001f) return {qQNaN(), qQNaN()};
    const float t = (height - ray.position.y) / ray.direction.y;
    if (t <= 0) return {qQNaN(), qQNaN()};
    return {ray.position.x + t * ray.direction.x, ray.position.z + t * ray.direction.z};
}

void NativeViewport::keyPressEvent(QKeyEvent *event)
{
    if (event->key() == Qt::Key_Escape) {
        keys_.clear();
        dragging_ = false;
        emit cancelGesture();
        clearFocus();
        event->accept();
    } else if (running_ && event->modifiers() == Qt::NoModifier) {
        keys_.insert(event->key());
        event->accept();
    } else QOpenGLWidget::keyPressEvent(event);
}

void NativeViewport::keyReleaseEvent(QKeyEvent *event)
{
    if (!event->isAutoRepeat()) keys_.remove(event->key());
    QOpenGLWidget::keyReleaseEvent(event);
}

void NativeViewport::focusOutEvent(QFocusEvent *event)
{
    keys_.clear();
    if (dragging_) { dragging_ = false; emit cancelGesture(); }
    QOpenGLWidget::focusOutEvent(event);
}

void NativeViewport::mousePressEvent(QMouseEvent *event)
{
    setFocus(Qt::MouseFocusReason);
    if (!running_ && event->button() == Qt::LeftButton) {
        dragging_ = true;
        emit scenePressed(logicalPoint(event->position()), event->modifiers());
    }
    QOpenGLWidget::mousePressEvent(event);
}

void NativeViewport::mouseMoveEvent(QMouseEvent *event)
{
    if (dragging_) emit sceneDragged(logicalPoint(event->position()));
    QOpenGLWidget::mouseMoveEvent(event);
}

void NativeViewport::mouseReleaseEvent(QMouseEvent *event)
{
    if (dragging_ && event->button() == Qt::LeftButton) {
        dragging_ = false;
        emit sceneReleased(logicalPoint(event->position()));
    }
    QOpenGLWidget::mouseReleaseEvent(event);
}

bool NativeViewport::event(QEvent *event)
{
    if (event->type() == QEvent::WindowDeactivate || event->type() == QEvent::Hide) {
        keys_.clear();
        if (dragging_) { dragging_ = false; emit cancelGesture(); }
    }
    return QOpenGLWidget::event(event);
}
