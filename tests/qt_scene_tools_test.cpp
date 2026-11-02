#include "scene_tools.h"
#include <QtTest>
#include <raymath.h>
#include <cmath>

namespace {
const Camera3D camera{{7, 6, 9}, {0, 0, 0}, {0, 1, 0}, 50, CAMERA_PERSPECTIVE};
QPointF projected(Vector3 point)
{
    const auto p = GetWorldToScreenEx(point, camera, NOVA_WIDTH, NOVA_HEIGHT);
    return {p.x, p.y};
}
bool close(NovaVec3 a, NovaVec3 b)
{
    return std::abs(a.x - b.x) < .001f && std::abs(a.y - b.y) < .001f && std::abs(a.z - b.z) < .001f;
}
}

class SceneToolsTest final : public QObject {
    Q_OBJECT
private slots:
    void axisMoveAndScale()
    {
        NovaCommand draw{};
        draw.type = NOVA_CUBE; draw.size = {2, 3, 4};
        for (const float logicalPerPoint : {.75f, 1.f, 2.f}) {
            const auto move = sceneGizmo(draw, SceneTool::Move, camera, logicalPerPoint);
            QVERIFY(move.visible);
            for (int a = 0; a < 3; ++a) {
                QVERIFY(!move.paths[a].isEmpty());
                const auto start = move.paths[a].back();
                QCOMPARE(sceneGizmoHit(move, SceneTool::Move, start), a);
                SceneGesture gesture;
                QVERIFY(gesture.begin(draw, SceneTool::Move, a, start, camera, logicalPerPoint));
                const auto axis = move.axes[a];
                const auto end = projected(Vector3Scale(axis, move.radius + 1.12f));
                NovaCommand result{};
                QVERIFY(gesture.update(end, true, .25, &result));
                const NovaVec3 expected{axis.x, axis.y, axis.z};
                QVERIFY(close(result.position, expected));
                QVERIFY(close(result.size, draw.size));
                QVERIFY(close(result.rotation, draw.rotation));
            }
        }
        draw.rotation = {23, -61, 117};
        const auto scale = sceneGizmo(draw, SceneTool::Scale, camera, 1);
        for (int a = 0; a < 3; ++a) {
            if (scale.paths[a].isEmpty()) continue;
            SceneGesture gesture;
            QVERIFY(gesture.begin(draw, SceneTool::Scale, a, scale.paths[a].back(), camera, 1));
            const auto end = projected(Vector3Scale(scale.axes[a], scale.radius * 1.52f));
            NovaCommand result{};
            QVERIFY(gesture.update(end, true, 10, &result));
            const float sizes[]{result.size.x, result.size.y, result.size.z};
            const float original[]{2, 3, 4};
            for (int i = 0; i < 3; ++i) QVERIFY(std::abs(sizes[i] - original[i] * (i == a ? 1.5f : 1)) < .001);
            QVERIFY(close(result.position, draw.position));
            QVERIFY(close(result.rotation, draw.rotation));
        }
    }

    void eulerRotationRings()
    {
        NovaCommand draw{};
        draw.type = NOVA_MODEL; draw.size = {1, 2, 3}; draw.rotation = {23, -61, 117};
        const auto rings = sceneGizmo(draw, SceneTool::Rotate, camera, 1);
        int exercised = 0;
        for (int a = 0; a < 3; ++a) {
            if (rings.paths[a].isEmpty()) continue;
            ++exercised;
            SceneGesture gesture;
            QVERIFY(gesture.begin(draw, SceneTool::Rotate, a, rings.paths[a][0], camera, 1));
            NovaCommand result{};
            QVERIFY(gesture.update(rings.paths[a][16], false, 15, &result));
            const float original[]{23, -61, 117}, rotated[]{result.rotation.x, result.rotation.y, result.rotation.z};
            for (int i = 0; i < 3; ++i) QVERIFY(std::abs(rotated[i] - original[i] - (i == a ? 90 : 0)) < .001);
            QVERIFY(gesture.update(rings.paths[a][16], true, 15, &result));
            const float snapped[]{result.rotation.x, result.rotation.y, result.rotation.z};
            QVERIFY(std::abs(snapped[a] - std::round((original[a] + 90) / 15) * 15) < .001);
            QVERIFY(close(result.position, draw.position) && close(result.size, draw.size));
        }
        QVERIFY(exercised >= 2);
    }

    void flatAndUniformGestures()
    {
        NovaCommand draw{};
        draw.type = NOVA_SPRITE; draw.position = {120, 140, 0}; draw.size = {64, 32, 1};
        auto gizmo = sceneGizmo(draw, SceneTool::Move, camera, 1);
        QVERIFY(gizmo.flat && gizmo.paths[2].isEmpty());
        QVERIFY(!sceneGizmo(draw, SceneTool::Rotate, camera, 1).visible);
        SceneGesture gesture;
        QVERIFY(gesture.begin(draw, SceneTool::Move, 3, gizmo.center, camera, 1));
        NovaCommand result{};
        QVERIFY(gesture.update(gizmo.center + QPointF(20, 20), true, 16, &result));
        QVERIFY(close(result.position, {144, 160, 0}));
        QVERIFY(close(result.size, draw.size));
        QVERIFY(gesture.begin(draw, SceneTool::Scale, 3, gizmo.center, camera, 1));
        QVERIFY(gesture.update(gizmo.center + QPointF(48, 0), true, 10, &result));
        QVERIFY(close(result.size, {96, 48, 1}));
        QVERIFY(gesture.update(gizmo.center + QPointF(-100000, 0), false, 10, &result));
        QVERIFY(result.size.x >= .01f && result.size.y >= .01f && result.size.z == 1);
        QVERIFY(std::abs(result.size.x / result.size.y - 2) < .001);
        QVERIFY(gesture.update(gizmo.center + QPointF(100000, 0), false, 10, &result));
        QVERIFY(close(result.size, {1000, 500, 1}));
        QVERIFY(!gesture.update({qQNaN(), 10}, false, 1, &result));
        QVERIFY(!gesture.begin(draw, SceneTool::Rotate, 0, gizmo.center, camera, 1));
    }

    void cameraNavigationAndFraming()
    {
        auto view = camera;
        sceneOrbit(view, {100, 50});
        QVERIFY(Vector3Distance(view.position, camera.position) > 1);
        QVERIFY(std::abs(Vector3Distance(view.position, view.target) -
            Vector3Distance(camera.position, camera.target)) < .001);
        sceneOrbit(view, {0, 100000});
        const auto forward = Vector3Normalize(Vector3Subtract(view.target, view.position));
        QVERIFY(std::abs(forward.y) < .999);
        const float distance = Vector3Distance(view.position, view.target);
        scenePan(view, {50, -20}, 540);
        QVERIFY(Vector3Distance(view.target, camera.target) > .1);
        QVERIFY(std::abs(Vector3Distance(view.position, view.target) - distance) < .001);
        sceneZoom(view, 1);
        QVERIFY(Vector3Distance(view.position, view.target) < distance);
        for (int i = 0; i < 20; ++i) sceneZoom(view, 100);
        QVERIFY(Vector3Distance(view.position, view.target) >= .049f);
        for (float fov : {10.f, 50.f, 120.f}) {
            view.fovy = fov;
            for (float size : {1.f, 5000.f}) {
                const BoundingBox box{{-3 * size, -2 * size, -size}, {5 * size, 6 * size, 7 * size}};
                sceneFrame(view, box);
                QVERIFY(Vector3Distance(view.target, {size, 2 * size, 3 * size}) < .001);
                for (int i = 0; i < 8; ++i) {
                    const auto screen = GetWorldToScreenEx({i & 1 ? box.max.x : box.min.x,
                        i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z}, view, NOVA_WIDTH, NOVA_HEIGHT);
                    QVERIFY(screen.x > 0 && screen.x < NOVA_WIDTH && screen.y > 0 && screen.y < NOVA_HEIGHT);
                }
            }
        }
        sceneFrame(view, {{1e9f, 1e9f, 1e9f}, {1e9f + 1024, 1e9f + 1024, 1e9f + 1024}});
        for (int i = 0; i < 20; ++i) sceneZoom(view, 100);
        sceneOrbit(view, {100, 50});
        QVERIFY(std::isfinite(view.position.x) && Vector3Distance(view.position, view.target) > 100);
        QCOMPARE(camera.position.x, 7.f);
    }
};

QTEST_GUILESS_MAIN(SceneToolsTest)
#include "qt_scene_tools_test.moc"
