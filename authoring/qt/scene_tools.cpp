#include "scene_tools.h"
#include <QLineF>
#include <algorithm>
#include <cmath>
#include <limits>
#include <raymath.h>

extern "C" {
#include "transform.h"
}

namespace {
Vector3 vec(NovaVec3 v) { return {v.x, v.y, v.z}; }
QPointF screen(Vector3 point, Camera3D camera)
{
    const auto p = GetWorldToScreenEx(point, camera, NOVA_WIDTH, NOVA_HEIGHT);
    return {p.x, p.y};
}
bool finite(QPointF point) { return std::isfinite(point.x()) && std::isfinite(point.y()); }
bool planePoint(QPointF point, Camera3D camera, Vector3 origin, Vector3 normal, Vector3 *result)
{
    if (!finite(point)) return false;
    const Ray ray = sceneRay(point, camera);
    const float denominator = Vector3DotProduct(ray.direction, normal);
    if (std::abs(denominator) < .0001f) return false;
    const float t = Vector3DotProduct(Vector3Subtract(origin, ray.position), normal) / denominator;
    if (t <= 0 || !std::isfinite(t)) return false;
    *result = Vector3Add(ray.position, Vector3Scale(ray.direction, t));
    return true;
}
double segmentDistance(QPointF p, QPointF a, QPointF b)
{
    const QPointF d = b - a;
    const double squared = QPointF::dotProduct(d, d);
    const double t = squared > 0 ? std::clamp(QPointF::dotProduct(p - a, d) / squared, 0.0, 1.0) : 0;
    return QLineF(p, a + t * d).length();
}
float snapped(float value, bool snap, double step)
{
    return snap && step > 0 ? float(std::round(value / step) * step) : value;
}
float angle(float value)
{
    return std::abs(value) > 360 ? std::fmod(value, 360.f) : value;
}
float cameraMinimumDistance(Camera3D camera)
{
    // Keep eye and target distinct after float rounding at distant asset origins.
    const float magnitude = std::max({std::abs(camera.target.x), std::abs(camera.target.y), std::abs(camera.target.z)});
    return std::max(.05f, magnitude * std::numeric_limits<float>::epsilon() * 8);
}
}

Ray sceneRay(QPointF logical, Camera3D camera)
{
    const auto forward = Vector3Normalize(Vector3Subtract(camera.target, camera.position));
    const auto right = Vector3Normalize(Vector3CrossProduct(forward, camera.up));
    const auto up = Vector3CrossProduct(right, forward);
    const double halfHeight = std::tan(camera.fovy * DEG2RAD / 2);
    const float x = float((2 * logical.x() / NOVA_WIDTH - 1) * halfHeight * NOVA_WIDTH / NOVA_HEIGHT);
    const float y = float((1 - 2 * logical.y() / NOVA_HEIGHT) * halfHeight);
    return {camera.position, Vector3Normalize(Vector3Add(forward,
        Vector3Add(Vector3Scale(right, x), Vector3Scale(up, y))))};
}

SceneGizmo sceneGizmo(const NovaCommand &draw, SceneTool tool, Camera3D camera, float logicalPerPoint)
{
    SceneGizmo gizmo;
    gizmo.flat = draw.type == NOVA_RECTANGLE || draw.type == NOVA_SPRITE;
    if (tool == SceneTool::Orbit || tool == SceneTool::Pan || (gizmo.flat && tool == SceneTool::Rotate)) return gizmo;
    const auto pivot = vec(draw.position);
    const auto forward = Vector3Normalize(Vector3Subtract(camera.target, camera.position));
    const float depth = Vector3DotProduct(Vector3Subtract(pivot, camera.position), forward);
    if (!gizmo.flat && depth <= .01f) return gizmo;
    gizmo.visible = true;
    gizmo.hitRadius = 8 * logicalPerPoint;
    gizmo.radius = gizmo.flat ? 76 * logicalPerPoint :
        76 * logicalPerPoint * (2 * depth * std::tan(camera.fovy * DEG2RAD / 2)) / NOVA_HEIGHT;
    gizmo.center = gizmo.flat ? QPointF(draw.position.x + draw.size.x / 2, draw.position.y + draw.size.y / 2) :
        screen(pivot, camera);
    const NovaVec3 axes[] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
    for (int a = 0; a < (gizmo.flat ? 2 : 3); ++a) {
        NovaVec3 direction = axes[a];
        if (tool == SceneTool::Scale) direction = nova_rotate(direction, draw.rotation);
        if (tool == SceneTool::Rotate) {
            // Euler parameter axes: X follows Y/Z, Y follows Z, Z is world Z.
            NovaVec3 later = a == 0 ? NovaVec3{0, draw.rotation.y, draw.rotation.z} :
                a == 1 ? NovaVec3{0, 0, draw.rotation.z} : NovaVec3{};
            direction = nova_rotate(direction, later);
        }
        gizmo.axes[a] = vec(direction);
        if (tool == SceneTool::Rotate) {
            if (std::abs(Vector3DotProduct(forward, gizmo.axes[a])) < .1f) continue;
            Vector3 u = Vector3Normalize(Vector3CrossProduct(gizmo.axes[a],
                std::abs(direction.y) < .9f ? Vector3{0, 1, 0} : Vector3{1, 0, 0}));
            Vector3 v = Vector3CrossProduct(gizmo.axes[a], u);
            for (int i = 0; i <= 64; ++i) {
                const float t = float(i) * 2 * PI / 64;
                gizmo.paths[a].append(screen(Vector3Add(pivot, Vector3Scale(
                    Vector3Add(Vector3Scale(u, std::cos(t)), Vector3Scale(v, std::sin(t))), gizmo.radius)), camera));
            }
        } else {
            const QPointF end = gizmo.flat ? gizmo.center + QPointF(direction.x, direction.y) * gizmo.radius :
                screen(Vector3Add(pivot, Vector3Scale(gizmo.axes[a], gizmo.radius)), camera);
            if (QLineF(gizmo.center, end).length() < 18 * logicalPerPoint) continue;
            gizmo.paths[a] = {gizmo.center, end};
        }
    }
    return gizmo;
}

int sceneGizmoHit(const SceneGizmo &gizmo, SceneTool tool, QPointF point)
{
    if (!gizmo.visible || !finite(point)) return -1;
    if (tool != SceneTool::Rotate && QLineF(point, gizmo.center).length() <= gizmo.hitRadius) return 3;
    double best = gizmo.hitRadius;
    int handle = -1;
    for (int a = 0; a < 3; ++a) {
        const auto &path = gizmo.paths[a];
        for (int i = 1; i < path.size(); ++i) {
            const auto distance = segmentDistance(point, path[i - 1], path[i]);
            if (distance < best) { best = distance; handle = a; }
        }
    }
    return handle;
}

bool SceneGesture::begin(const NovaCommand &draw, SceneTool tool, int handle, QPointF pointer,
    Camera3D camera, float logicalPerPoint)
{
    if (handle < 0 || handle > 3 || !finite(pointer)) return false;
    original_ = draw; tool_ = tool; handle_ = handle; pointer_ = pointer; camera_ = camera;
    gizmo_ = sceneGizmo(draw, tool, camera, logicalPerPoint);
    if (!gizmo_.visible || (handle < 3 && gizmo_.paths[handle].isEmpty()) ||
        (handle == 3 && tool == SceneTool::Rotate)) return false;
    if (gizmo_.flat || (handle == 3 && tool == SceneTool::Scale)) return true;
    if (tool == SceneTool::Rotate) planeNormal_ = gizmo_.axes[handle];
    else if (handle == 3) planeNormal_ = {0, 1, 0};
    else {
        Vector3 forward = Vector3Normalize(Vector3Subtract(camera.target, camera.position));
        planeNormal_ = Vector3Normalize(Vector3Subtract(forward,
            Vector3Scale(gizmo_.axes[handle], Vector3DotProduct(forward, gizmo_.axes[handle]))));
    }
    if (!planePoint(pointer, camera, vec(draw.position), planeNormal_, &start_)) return false;
    if (tool == SceneTool::Rotate && Vector3Distance(start_, vec(draw.position)) < .0001f) return false;
    return true;
}

bool SceneGesture::update(QPointF pointer, bool snap, double increment, NovaCommand *result) const
{
    if (!finite(pointer) || handle_ < 0) return false;
    *result = original_;
    Vector3 current{};
    if (!gizmo_.flat && !(handle_ == 3 && tool_ == SceneTool::Scale) &&
        !planePoint(pointer, camera_, vec(original_.position), planeNormal_, &current)) return false;
    const Vector3 delta = gizmo_.flat ? Vector3{float(pointer.x() - pointer_.x()), float(pointer.y() - pointer_.y()), 0} :
        Vector3Subtract(current, start_);
    if (tool_ == SceneTool::Move) {
        Vector3 movement = handle_ == 3 ? delta :
            Vector3Scale(gizmo_.axes[handle_], Vector3DotProduct(delta, gizmo_.axes[handle_]));
        float values[] = {original_.position.x + movement.x, original_.position.y + movement.y, original_.position.z + movement.z};
        for (int a = 0; a < 3; ++a) {
            if (handle_ == a || (handle_ == 3 && (gizmo_.flat ? a != 2 : a != 1)))
                values[a] = std::clamp(snapped(values[a], snap, increment), -10000.f, 10000.f);
        }
        result->position = {values[0], values[1], values[2]};
    } else if (tool_ == SceneTool::Rotate) {
        const auto u = Vector3Normalize(Vector3Subtract(start_, vec(original_.position)));
        const auto v = Vector3Normalize(Vector3Subtract(current, vec(original_.position)));
        const float deltaAngle = std::atan2(Vector3DotProduct(planeNormal_, Vector3CrossProduct(u, v)),
            Vector3DotProduct(u, v)) * RAD2DEG;
        float values[] = {original_.rotation.x, original_.rotation.y, original_.rotation.z};
        values[handle_] = angle(snapped(values[handle_] + deltaAngle, snap, increment));
        result->rotation = {values[0], values[1], values[2]};
    } else if (tool_ == SceneTool::Scale) {
        float change = handle_ == 3 ? float((pointer.x() - pointer_.x() - pointer.y() + pointer_.y()) /
            (gizmo_.hitRadius * 12)) : Vector3DotProduct(delta, gizmo_.axes[handle_]) / gizmo_.radius;
        float factor = 1 + snapped(change, snap, increment / 100);
        const float sizes[] = {original_.size.x, original_.size.y, original_.size.z};
        float minimum = 0, maximum = std::numeric_limits<float>::max();
        for (int a = 0; a < (gizmo_.flat ? 2 : 3); ++a) if (handle_ == 3 || handle_ == a) {
            minimum = std::max(minimum, .01f / sizes[a]); maximum = std::min(maximum, 1000.f / sizes[a]);
        }
        factor = std::clamp(factor, minimum, maximum);
        float values[] = {sizes[0], sizes[1], sizes[2]};
        for (int a = 0; a < (gizmo_.flat ? 2 : 3); ++a) if (handle_ == 3 || handle_ == a)
            values[a] = std::clamp(sizes[a] * factor, .01f, 1000.f);
        result->size = {values[0], values[1], values[2]};
    } else return false;
    return true;
}

void sceneOrbit(Camera3D &camera, QPointF delta)
{
    const Vector3 offset = Vector3Subtract(camera.position, camera.target);
    const float distance = Vector3Length(offset);
    const double yaw = std::atan2(offset.x, offset.z) - delta.x() * .008;
    const double pitch = std::clamp(std::asin(std::clamp(double(offset.y / distance), -1.0, 1.0)) +
        delta.y() * .008, -1.48, 1.48);
    camera.position = Vector3Add(camera.target, {float(distance * std::cos(pitch) * std::sin(yaw)),
        float(distance * std::sin(pitch)), float(distance * std::cos(pitch) * std::cos(yaw))});
}

void scenePan(Camera3D &camera, QPointF delta, double viewportHeight)
{
    if (viewportHeight <= 0) return;
    const Vector3 forward = Vector3Normalize(Vector3Subtract(camera.target, camera.position));
    const Vector3 right = Vector3Normalize(Vector3CrossProduct(forward, camera.up));
    const Vector3 up = Vector3CrossProduct(right, forward);
    const float scale = 2 * Vector3Distance(camera.position, camera.target) * std::tan(camera.fovy * DEG2RAD / 2) /
        float(viewportHeight);
    const Vector3 change = Vector3Scale(Vector3Add(Vector3Scale(right, float(-delta.x())),
        Vector3Scale(up, float(delta.y()))), scale);
    camera.position = Vector3Add(camera.position, change);
    camera.target = Vector3Add(camera.target, change);
}

void sceneZoom(Camera3D &camera, double steps)
{
    const Vector3 offset = Vector3Subtract(camera.position, camera.target);
    const float distance = Vector3Length(offset);
    const float next = std::clamp(float(distance * std::exp(-std::clamp(steps, -20.0, 20.0) * .12)),
        cameraMinimumDistance(camera), 1e11f);
    camera.position = Vector3Add(camera.target, Vector3Scale(offset, next / distance));
}

void sceneFrame(Camera3D &camera, BoundingBox bounds)
{
    const float radius = std::max(Vector3Distance(bounds.min, bounds.max) / 2, .05f);
    const Vector3 direction = Vector3Normalize(Vector3Subtract(camera.position, camera.target));
    camera.target = Vector3Scale(Vector3Add(bounds.min, bounds.max), .5f);
    const float distance = std::max(radius / std::sin(camera.fovy * DEG2RAD / 2) * 1.25f, cameraMinimumDistance(camera));
    camera.position = Vector3Add(camera.target, Vector3Scale(direction, distance));
}
