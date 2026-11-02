#ifndef NOVA_SCENE_TOOLS_H
#define NOVA_SCENE_TOOLS_H

#include <QPointF>
#include <QVector>
#include <array>

extern "C" {
#include "presentation.h"
}

enum class SceneTool { Move, Rotate, Scale, Orbit, Pan };

struct SceneGizmo {
    QPointF center;
    std::array<QVector<QPointF>, 3> paths;
    std::array<Vector3, 3> axes{};
    float radius = 1;
    float hitRadius = 8;
    bool visible = false, flat = false;
};

SceneGizmo sceneGizmo(const NovaCommand &draw, SceneTool tool, Camera3D camera, float logicalPerPoint);
Ray sceneRay(QPointF logical, Camera3D camera);
int sceneGizmoHit(const SceneGizmo &gizmo, SceneTool tool, QPointF point);
void sceneOrbit(Camera3D &camera, QPointF delta);
void scenePan(Camera3D &camera, QPointF delta, double viewportHeight);
void sceneZoom(Camera3D &camera, double steps);
void sceneFrame(Camera3D &camera, BoundingBox bounds);

class SceneGesture {
public:
    bool begin(const NovaCommand &draw, SceneTool tool, int handle, QPointF pointer,
        Camera3D camera, float logicalPerPoint);
    bool update(QPointF pointer, bool snap, double increment, NovaCommand *result) const;
private:
    NovaCommand original_{};
    SceneTool tool_ = SceneTool::Move;
    Camera3D camera_{};
    SceneGizmo gizmo_;
    Vector3 planeNormal_{}, start_{};
    QPointF pointer_;
    int handle_ = -1;
};

#endif
