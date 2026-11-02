#include "native_viewport.h"
#include "raylib_host.h"
#include <QApplication>
#include <QFocusEvent>
#include <QKeyEvent>
#include <QMouseEvent>
#include <QOpenGLContext>
#include <QOpenGLFunctions>
#include <QOpenGLPaintDevice>
#include <QPainter>
#include <QPainterPath>
#include <QWheelEvent>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <raymath.h>

extern "C" {
#include "transform.h"
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
      retained_(std::make_unique<NovaFrame>()), editingView_(std::make_unique<NovaFrame>())
{
    setObjectName("nativeViewport");
    setAccessibleName(tr("Native Scene and game viewport"));
    setAccessibleDescription(tr("Scene: W move, E rotate, R scale. F frames selection, Shift+F frames all; Home shows game view. "
        "Alt-drag or Orbit tool orbits; Alt+Shift-drag or Pan tool pans; wheel or +/- zooms. "
        "Arrow keys work with Orbit and Pan. Escape cancels. Inspector fields provide keyboard transform alternatives. "
        "While running, click for game controls; Escape releases focus."));
    setFocusPolicy(Qt::StrongFocus);
    setMouseTracking(true);
    setMinimumSize(320, 180);
    timer_.setInterval(16);
    connect(&timer_, &QTimer::timeout, this, &NativeViewport::tick);
    connect(qApp, &QGuiApplication::applicationStateChanged, this, [this] {
        keys_.clear();
        accumulator_ = 0;
        clock_.restart();
        if (QGuiApplication::applicationState() != Qt::ApplicationActive) cancelInteraction();
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
        if (path != authoringPath_) editorCameraValid_ = false;
        authoringPath_ = path;
    }
    doneCurrent();
    if (!ok) fail(QString::fromUtf8(error));
    update();
    return ok;
}

void NativeViewport::setRunning(bool running)
{
    if (running && (!ready_ || !engine_)) return;
    cancelInteraction();
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
    if (!editorCameraValid_) gameView();
    update();
}

void NativeViewport::setSelection(int index)
{
    if (selection_ != index) { hoverHandle_ = -1; activeHandle_ = -1; }
    selection_ = index;
    update();
}

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
    if (editing3D()) {
        *editingView_ = *frame;
        const auto camera = viewCamera();
        editingView_->camera_position = {camera.position.x, camera.position.y, camera.position.z};
        editingView_->camera_target = {camera.target.x, camera.target.y, camera.target.z};
        editingView_->camera_fov = camera.fovy;
        frame = editingView_.get();
    }
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
    const double nearPlane = rlGetCullDistanceNear(), farPlane = rlGetCullDistanceFar();
    if (editing3D()) {
        const auto camera = viewCamera();
        const float distance = Vector3Distance(camera.position, camera.target);
        float extent = distance;
        for (size_t i = 0; i < frame->count; ++i) {
            const auto &draw = frame->commands[i];
            if (draw.type != NOVA_CUBE && draw.type != NOVA_MODEL) continue;
            const auto box = bounds(draw);
            const auto center = Vector3Scale(Vector3Add(box.min, box.max), .5f);
            extent = std::max(extent, Vector3Distance(camera.position, center) + Vector3Distance(box.min, box.max) / 2);
        }
        rlSetClipPlanes(std::max(.001, distance * .0001), std::max(1000.0, extent * 1.1));
    }
    nova_presentation_world(&presentation_, frame, resources_.get());
    if (editing3D()) {
        BeginTextureMode(presentation_.world);
        const auto camera = viewCamera();
        BeginMode3D(camera);
        if (gridVisible_) {
            const float distance = Vector3Distance(camera.position, camera.target);
            const float step = std::pow(10.f, std::floor(std::log10(std::max(distance / 8, .01f))));
            const float x = std::round(camera.target.x / step) * step, z = std::round(camera.target.z / step) * step;
            for (int i = -20; i <= 20; ++i) {
                const float a = x + i * step, b = z + i * step;
                DrawLine3D({a, 0, z - 20 * step}, {a, 0, z + 20 * step},
                    std::abs(a) < step / 2 ? Color{81, 109, 153, 140} : Color{100, 113, 132, 35});
                DrawLine3D({x - 20 * step, 0, b}, {x + 20 * step, 0, b},
                    std::abs(b) < step / 2 ? Color{166, 96, 101, 140} : Color{100, 113, 132, 35});
            }
        }
        if (selection_ >= 0 && size_t(selection_) < frame->count) {
            const auto &draw = frame->commands[selection_];
            if (draw.type == NOVA_CUBE || draw.type == NOVA_MODEL) {
                const auto box = localBounds(draw);
                Vector3 corners[8];
                for (int i = 0; i < 8; ++i) {
                    const auto p = nova_transform_point({i & 1 ? box.max.x : box.min.x,
                        i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z},
                        draw.position, draw.size, draw.rotation);
                    corners[i] = {p.x, p.y, p.z};
                }
                for (int i = 0; i < 8; ++i) for (int bit : {1, 2, 4})
                    if (!(i & bit)) DrawLine3D(corners[i], corners[i | bit], {255, 215, 100, 255});
            }
        }
        EndMode3D();
        EndTextureMode();
    }
    rlSetClipPlanes(nearPlane, farPlane);
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
    if (!running_ && authoring_) {
        // Start Qt's paint engine only after rlgl has finished binding its own
        // vertex arrays. Qt's 2D triangle winding does not use native culling.
        gl->glDisable(GL_CULL_FACE);
        // raylib uploads tightly packed pixels; Qt's glyph rows are 4-byte aligned.
        gl->glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
        QOpenGLPaintDevice chrome(QSize(w, h));
        chrome.setDevicePixelRatio(devicePixelRatioF());
        QPainter painter(&chrome);
        paintEditorOverlay(painter);
    }
}

QPointF NativeViewport::logicalPoint(QPointF point) const
{
    const qreal density = devicePixelRatioF();
    const int w = qRound(width() * density), h = qRound(height() * density);
    NovaPresentationLayout layout{};
    Vector2 result{};
    // Use Qt's actual point scale, not a ratio changed by framebuffer rounding.
    if (!nova_presentation_layout(w, h, w, h, false, &layout) ||
        !nova_presentation_pointer(&layout, Vector2{float(point.x() * density), float(point.y() * density)}, &result))
        return {qQNaN(), qQNaN()};
    return {result.x, result.y};
}

QPointF NativeViewport::widgetPoint(QPointF logical) const
{
    const auto viewport = nova_viewport(qRound(width() * devicePixelRatioF()),
        qRound(height() * devicePixelRatioF()), false);
    return {(viewport.x + logical.x() * viewport.scale) / devicePixelRatioF(),
        (viewport.y + logical.y() * viewport.scale) / devicePixelRatioF()};
}

float NativeViewport::logicalPerPoint() const
{
    const auto viewport = nova_viewport(qRound(width() * devicePixelRatioF()),
        qRound(height() * devicePixelRatioF()), false);
    return float(devicePixelRatioF() / viewport.scale);
}

BoundingBox NativeViewport::localBounds(const NovaCommand &draw) const
{
    BoundingBox box{{-.5f, -.5f, -.5f}, {.5f, .5f, .5f}};
    if (draw.type == NOVA_MODEL && draw.asset < resources_->count) {
        const auto &info = resources_->inspection[draw.asset];
        box = {{info.bounds_min.x, info.bounds_min.y, info.bounds_min.z},
            {info.bounds_max.x, info.bounds_max.y, info.bounds_max.z}};
    }
    return box;
}

BoundingBox NativeViewport::bounds(const NovaCommand &draw) const
{
    const auto box = localBounds(draw);
    NovaVec3 minimum{}, maximum{};
    nova_transform_bounds({box.min.x, box.min.y, box.min.z}, {box.max.x, box.max.y, box.max.z},
        draw.position, draw.size, draw.rotation, &minimum, &maximum);
    return {{minimum.x, minimum.y, minimum.z}, {maximum.x, maximum.y, maximum.z}};
}

Camera3D NativeViewport::viewCamera() const
{
    if (editorCameraValid_) return editorCamera_;
    const auto *f = frame();
    if (!f) return {{7, 6, 9}, {0, 0, 0}, {0, 1, 0}, 50, CAMERA_PERSPECTIVE};
    return {{f->camera_position.x, f->camera_position.y, f->camera_position.z},
        {f->camera_target.x, f->camera_target.y, f->camera_target.z}, {0, 1, 0}, f->camera_fov, CAMERA_PERSPECTIVE};
}

bool NativeViewport::editing3D() const { return !running_ && authoring_ && authoring_->mode != NOVA_2D; }

void NativeViewport::setTool(SceneTool tool)
{
    if (running_) return;
    cancelInteraction();
    tool_ = tool;
    hoverHandle_ = -1;
    setCursor(tool == SceneTool::Orbit || tool == SceneTool::Pan ? Qt::OpenHandCursor : Qt::ArrowCursor);
    emit toolChanged();
    update();
}

SceneGizmo NativeViewport::gizmo() const
{
    if (running_ || !authoring_ || selection_ < 0 || size_t(selection_) >= authoring_->count) return {};
    return sceneGizmo(authoring_->commands[selection_], tool_, viewCamera(), logicalPerPoint());
}

int NativeViewport::gizmoHandle(QPointF point) const
{
    if (point.x() < 0 || point.y() < 0 || point.x() >= NOVA_WIDTH || point.y() >= NOVA_HEIGHT) return -1;
    return sceneGizmoHit(gizmo(), tool_, point);
}

bool NativeViewport::beginTransform(int index, int handle, QPointF point)
{
    if (running_ || !authoring_ || index < 0 || size_t(index) >= authoring_->count) return false;
    if (!gesture_.begin(authoring_->commands[index], tool_, handle, point, viewCamera(), logicalPerPoint())) {
        emit interactionHint(tr("This handle is edge-on. Orbit the view or use the Inspector."));
        return false;
    }
    activeHandle_ = handle;
    return true;
}

bool NativeViewport::transformAt(QPointF point, bool snap, double increment, NovaCommand *result) const
{
    return activeHandle_ >= 0 && gesture_.update(point, snap, increment, result);
}

void NativeViewport::frameSelection(bool all)
{
    if (!editing3D()) return;
    cancelInteraction();
    BoundingBox box{{INFINITY, INFINITY, INFINITY}, {-INFINITY, -INFINITY, -INFINITY}};
    bool found = false;
    for (size_t i = 0; i < authoring_->count; ++i) {
        const auto &draw = authoring_->commands[i];
        if ((!all && int(i) != selection_) || (draw.type != NOVA_CUBE && draw.type != NOVA_MODEL)) continue;
        const auto b = bounds(draw);
        box.min = Vector3Min(box.min, b.min); box.max = Vector3Max(box.max, b.max);
        found = true;
    }
    if (!found) { emit interactionHint(tr("Select a 3D object to frame, or use Frame all.")); return; }
    sceneFrame(editorCamera_, box);
    update();
}

void NativeViewport::gameView()
{
    if (running_ || !authoring_) return;
    cancelInteraction();
    const auto &f = *authoring_;
    editorCamera_ = {{f.camera_position.x, f.camera_position.y, f.camera_position.z},
        {f.camera_target.x, f.camera_target.y, f.camera_target.z}, {0, 1, 0}, f.camera_fov, CAMERA_PERSPECTIVE};
    editorCameraValid_ = true;
    update();
}

void NativeViewport::setGridVisible(bool visible) { gridVisible_ = visible; update(); }

void NativeViewport::zoomView(double steps)
{
    if (!editing3D()) return;
    cancelInteraction();
    sceneZoom(editorCamera_, steps);
    update();
}

int NativeViewport::pick(QPointF logical) const
{
    if (!authoring_ || !std::isfinite(logical.x()) || !std::isfinite(logical.y()) || logical.x() < 0 || logical.y() < 0 ||
        logical.x() >= NOVA_WIDTH || logical.y() >= NOVA_HEIGHT) return -1;
    const auto &frame = *authoring_;
    const Camera3D camera = viewCamera();
    const Ray ray = sceneRay(logical, camera);
    int selected = -1;
    float distance = std::numeric_limits<float>::max();
    for (size_t i = frame.count; i > 0; --i) {
        const auto &draw = frame.commands[i - 1];
        if (draw.type == NOVA_RECTANGLE || draw.type == NOVA_SPRITE) {
            if (logical.x() >= draw.position.x && logical.y() >= draw.position.y &&
                logical.x() < draw.position.x + draw.size.x && logical.y() < draw.position.y + draw.size.y)
                return int(i - 1);
        } else if (draw.type == NOVA_CUBE || draw.type == NOVA_MODEL) {
            const auto box = localBounds(draw);
            float hit;
            if (nova_ray_box({ray.position.x, ray.position.y, ray.position.z},
                {ray.direction.x, ray.direction.y, ray.direction.z},
                {box.min.x, box.min.y, box.min.z}, {box.max.x, box.max.y, box.max.z},
                draw.position, draw.size, draw.rotation, &hit) && hit < distance) {
                distance = hit; selected = int(i - 1);
            }
        }
    }
    return selected;
}

void NativeViewport::paintEditorOverlay(QPainter &painter)
{
    painter.setRenderHint(QPainter::Antialiasing);
    const QRectF area(widgetPoint({0, 0}), widgetPoint({NOVA_WIDTH, NOVA_HEIGHT}));
    painter.setClipRect(area);
    const auto shape = gizmo();
    const QColor colors[] = {QColor("#fa939b"), QColor("#8fe3b0"), QColor("#94bbff")};
    for (int a = 0; a < 3; ++a) {
        const auto &points = shape.paths[a];
        if (points.isEmpty()) continue;
        const bool active = a == (activeHandle_ >= 0 ? activeHandle_ : hoverHandle_);
        const QColor ink = active ? QColor("#ffe39b") : colors[a];
        QPainterPath path(widgetPoint(points.front()));
        for (int i = 1; i < points.size(); ++i) path.lineTo(widgetPoint(points[i]));
        painter.setBrush(Qt::NoBrush);
        painter.setPen(QPen(QColor(13, 19, 28, 220), active ? 5 : 4, Qt::SolidLine, Qt::RoundCap));
        painter.drawPath(path);
        painter.setPen(QPen(ink, active ? 3 : 2, Qt::SolidLine, Qt::RoundCap));
        painter.drawPath(path);
        const QPointF end = widgetPoint(tool_ == SceneTool::Rotate ? points[8] : points.back());
        painter.setBrush(ink);
        if (tool_ == SceneTool::Scale) painter.drawRect(QRectF(end.x() - 4, end.y() - 4, 8, 8));
        else if (tool_ == SceneTool::Move) {
            const auto d = end - widgetPoint(points.front());
            const double length = std::hypot(d.x(), d.y());
            const QPointF u = d / length, v(-u.y(), u.x());
            painter.drawPolygon(QPolygonF{end, end - 10 * u + 4 * v, end - 10 * u - 4 * v});
        }
        const QRectF label(end.x() + 6, end.y() - 22, 20, 20);
        painter.fillRect(label, QColor(13, 19, 28, 220));
        painter.setPen(ink);
        painter.drawText(label, Qt::AlignCenter, QString(QChar('X' + a)));
    }
    if (shape.visible && tool_ != SceneTool::Rotate) {
        const auto center = widgetPoint(shape.center);
        painter.setBrush(QColor(20, 28, 40, 220));
        painter.setPen(QPen((activeHandle_ == 3 || hoverHandle_ == 3) ? QColor("#ffe39b") : QColor("#eef4fa"), 2));
        painter.drawRoundedRect(QRectF(center.x() - 6, center.y() - 6, 12, 12), 2, 2);
    }
    if (editing3D()) {
        const QString label = tool_ == SceneTool::Move ? tr("Editor camera  |  Move: world axes") :
            tool_ == SceneTool::Rotate ? tr("Editor camera  |  Rotate: X then Y then Z") :
            tool_ == SceneTool::Scale ? tr("Editor camera  |  Scale: local axes") :
            tool_ == SceneTool::Orbit ? tr("Editor camera  |  Drag to orbit") : tr("Editor camera  |  Drag to pan");
        const QRectF badge(area.left() + 12, area.top() + 12, painter.fontMetrics().horizontalAdvance(label) + 20, 28);
        painter.setPen(Qt::NoPen); painter.setBrush(QColor(16, 23, 35, 220));
        painter.drawRoundedRect(badge, 5, 5);
        painter.setPen(QColor("#eaf1fa")); painter.drawText(badge, Qt::AlignCenter, label);
        // A labelled, camera-relative orientation compass is editor chrome.
        const QPointF origin(area.right() - 47, area.bottom() - 44);
        const auto camera = viewCamera();
        const auto forward = Vector3Normalize(Vector3Subtract(camera.target, camera.position));
        const auto right = Vector3Normalize(Vector3CrossProduct(forward, {0, 1, 0}));
        const auto up = Vector3CrossProduct(right, forward);
        const Vector3 axes[] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
        for (int a = 0; a < 3; ++a) {
            QPointF end = origin + QPointF(Vector3DotProduct(axes[a], right), -Vector3DotProduct(axes[a], up)) * 27;
            painter.setPen(QPen(colors[a], 2)); painter.drawLine(origin, end);
            painter.drawText(QRectF(end.x() - 8, end.y() - 18, 16, 16), Qt::AlignCenter, QString(QChar('X' + a)));
        }
    }
}

void NativeViewport::keyPressEvent(QKeyEvent *event)
{
    if (event->key() == Qt::Key_Escape) {
        keys_.clear();
        const bool interacting = dragging_ || navigationButton_ != Qt::NoButton;
        cancelInteraction();
        if (running_ || !interacting) clearFocus();
        event->accept();
    } else if (running_ && event->modifiers() == Qt::NoModifier) {
        keys_.insert(event->key());
        event->accept();
    } else if (!running_ && authoring_ && event->modifiers() == Qt::NoModifier &&
        (event->key() == Qt::Key_W || event->key() == Qt::Key_E || event->key() == Qt::Key_R)) {
        const auto desired = event->key() == Qt::Key_W ? SceneTool::Move :
            event->key() == Qt::Key_E ? SceneTool::Rotate : SceneTool::Scale;
        const bool flat = selection_ >= 0 && size_t(selection_) < authoring_->count &&
            (authoring_->commands[selection_].type == NOVA_RECTANGLE || authoring_->commands[selection_].type == NOVA_SPRITE);
        if (desired != SceneTool::Rotate || (editing3D() && !flat)) setTool(desired);
        else emit interactionHint(tr("Rotation is available for 3D objects. 2D keeps its original unrotated canvas."));
        event->accept();
    } else if (editing3D() && (event->modifiers() == Qt::NoModifier || event->modifiers() == Qt::ShiftModifier) &&
        event->key() == Qt::Key_F) {
        frameSelection(event->modifiers() == Qt::ShiftModifier); event->accept();
    } else if (editing3D() && event->modifiers() == Qt::NoModifier) {
        if (event->key() == Qt::Key_Home) gameView();
        else if (event->key() == Qt::Key_Plus || event->key() == Qt::Key_Equal) zoomView(1);
        else if (event->key() == Qt::Key_Minus) zoomView(-1);
        else if ((tool_ == SceneTool::Orbit || tool_ == SceneTool::Pan) &&
            (event->key() >= Qt::Key_Left && event->key() <= Qt::Key_Down)) {
            const QPointF delta((event->key() == Qt::Key_Right ? 1 : event->key() == Qt::Key_Left ? -1 : 0) * 12,
                (event->key() == Qt::Key_Down ? 1 : event->key() == Qt::Key_Up ? -1 : 0) * 12);
            if (tool_ == SceneTool::Orbit) sceneOrbit(editorCamera_, delta);
            else scenePan(editorCamera_, delta, NOVA_HEIGHT / logicalPerPoint());
            update();
        } else { QOpenGLWidget::keyPressEvent(event); return; }
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
    cancelInteraction();
    QOpenGLWidget::focusOutEvent(event);
}

void NativeViewport::mousePressEvent(QMouseEvent *event)
{
    setFocus(Qt::MouseFocusReason);
    if (editing3D() && (event->button() == Qt::MiddleButton || event->button() == Qt::RightButton ||
        (event->button() == Qt::LeftButton && (event->modifiers().testFlag(Qt::AltModifier) ||
            tool_ == SceneTool::Orbit || tool_ == SceneTool::Pan)))) {
        cancelInteraction();
        navigation_ = event->button() == Qt::MiddleButton || tool_ == SceneTool::Pan ||
            event->modifiers().testFlag(Qt::ShiftModifier) ? SceneTool::Pan : SceneTool::Orbit;
        navigationButton_ = event->button();
        navigationStart_ = editorCamera_; navigationPointer_ = event->position();
        setCursor(Qt::ClosedHandCursor);
        event->accept(); return;
    }
    if (!running_ && event->button() == Qt::LeftButton) {
        dragging_ = true;
        emit scenePressed(logicalPoint(event->position()), event->modifiers());
    }
    QOpenGLWidget::mousePressEvent(event);
}

void NativeViewport::mouseMoveEvent(QMouseEvent *event)
{
    if (navigationButton_ != Qt::NoButton) {
        const auto delta = event->position() - navigationPointer_;
        editorCamera_ = navigationStart_;
        if (navigation_ == SceneTool::Orbit) sceneOrbit(editorCamera_, delta);
        else scenePan(editorCamera_, delta, NOVA_HEIGHT / logicalPerPoint());
        update(); event->accept(); return;
    }
    if (dragging_) emit sceneDragged(logicalPoint(event->position()));
    else {
        const auto handle = gizmoHandle(logicalPoint(event->position()));
        if (handle != hoverHandle_) { hoverHandle_ = handle; update(); }
    }
    QOpenGLWidget::mouseMoveEvent(event);
}

void NativeViewport::mouseReleaseEvent(QMouseEvent *event)
{
    if (event->button() == navigationButton_) {
        navigationButton_ = Qt::NoButton;
        setCursor(tool_ == SceneTool::Orbit || tool_ == SceneTool::Pan ? Qt::OpenHandCursor : Qt::ArrowCursor);
        event->accept(); return;
    }
    if (dragging_ && event->button() == Qt::LeftButton) {
        dragging_ = false;
        emit sceneReleased(logicalPoint(event->position()));
        activeHandle_ = -1;
        update();
    }
    QOpenGLWidget::mouseReleaseEvent(event);
}

void NativeViewport::wheelEvent(QWheelEvent *event)
{
    if (!editing3D()) { QOpenGLWidget::wheelEvent(event); return; }
    const double steps = event->pixelDelta().isNull() ? event->angleDelta().y() / 120.0 : event->pixelDelta().y() / 40.0;
    zoomView(steps);
    event->accept();
}

void NativeViewport::cancelInteraction()
{
    if (navigationButton_ != Qt::NoButton) {
        editorCamera_ = navigationStart_; navigationButton_ = Qt::NoButton;
        setCursor(tool_ == SceneTool::Orbit || tool_ == SceneTool::Pan ? Qt::OpenHandCursor : Qt::ArrowCursor);
    }
    activeHandle_ = -1;
    if (dragging_) { dragging_ = false; emit cancelGesture(); }
    update();
}

bool NativeViewport::event(QEvent *event)
{
    if (event->type() == QEvent::WindowDeactivate || event->type() == QEvent::Hide) {
        keys_.clear();
        cancelInteraction();
    }
    return QOpenGLWidget::event(event);
}
