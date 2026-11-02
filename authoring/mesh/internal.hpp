#ifndef NOVA_MESH_INTERNAL_HPP
#define NOVA_MESH_INTERNAL_HPP

#include "document.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>

namespace nova::mesh::detail {

struct Failure {
    QString message;
};
inline void require(bool condition, const QString &message)
{
    if (!condition) throw Failure{message};
}
template<class Function> bool checked(QString &error, Function operation)
{
    try {
        operation();
        error.clear();
        return true;
    } catch (const Failure &failure) {
        error = failure.message;
    } catch (const std::bad_alloc &) {
        error = QStringLiteral("Not enough memory to prepare this mesh operation; the document was retained.");
    }
    return false;
}

inline Vec3 operator+(Vec3 a, Vec3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline Vec3 operator-(Vec3 a, Vec3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 operator*(Vec3 a, double s) { return {a.x * s, a.y * s, a.z * s}; }
inline Vec3 operator/(Vec3 a, double s) { return a * (1.0 / s); }
inline Vec2 operator+(Vec2 a, Vec2 b) { return {a.x + b.x, a.y + b.y}; }
inline Vec2 operator-(Vec2 a, Vec2 b) { return {a.x - b.x, a.y - b.y}; }
inline Vec2 operator*(Vec2 a, double s) { return {a.x * s, a.y * s}; }
inline double dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 cross(Vec3 a, Vec3 b)
{
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline double length(Vec3 value) { return std::sqrt(dot(value, value)); }
inline Vec3 unit(Vec3 value)
{
    const double size = length(value);
    require(std::isfinite(size) && size > 1e-20, QStringLiteral("A zero or invalid normal cannot be used."));
    return value / size;
}
inline bool finite(Vec3 v) { return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z); }
inline bool finite(Vec2 v) { return std::isfinite(v.x) && std::isfinite(v.y); }
inline bool same(Vec3 a, Vec3 b) { return a.x == b.x && a.y == b.y && a.z == b.z; }
inline double component(Vec3 v, Axis axis)
{
    require(axis == Axis::X || axis == Axis::Y || axis == Axis::Z, QStringLiteral("Unknown axis."));
    return axis == Axis::X ? v.x : axis == Axis::Y ? v.y : v.z;
}
inline Vec3 reflected(Vec3 v, Axis axis)
{
    component(v, axis);
    if (axis == Axis::X) v.x = -v.x;
    else if (axis == Axis::Y) v.y = -v.y;
    else v.z = -v.z;
    return v;
}
inline Id allocate(State &state)
{
    require(state.nextId != 0 && state.nextId < std::numeric_limits<Id>::max(),
        QStringLiteral("The mesh document has exhausted its stable IDs."));
    return state.nextId++;
}
template<class Values> auto &find(Values &values, Id id, const QString &kind)
{
    const auto it = std::find_if(values.begin(), values.end(), [id](const auto &value) { return value.id == id; });
    require(it != values.end(), QStringLiteral("%1 ID %2 is missing.").arg(kind).arg(id));
    return *it;
}
inline const Vertex &vertex(const Object &object, Id id)
{
    const auto it = std::lower_bound(object.vertices.begin(), object.vertices.end(), id,
        [](const Vertex &value, Id wanted) { return value.id < wanted; });
    require(it != object.vertices.end() && it->id == id,
        QStringLiteral("Vertex ID %1 is missing.").arg(id));
    return *it;
}
inline Corner corner(Id id, Vec2 uv = {}) { return {id, uv, std::nullopt}; }
inline void clearNormals(Face &face)
{
    for (auto &value : face.corners) value.normal.reset();
}
inline void reverse(Face &face)
{
    std::reverse(face.corners.begin(), face.corners.end());
    for (auto &value : face.corners) if (value.normal) value.normal = *value.normal * -1;
}

struct Polygon {
    std::vector<Vec3> points;
    std::vector<Vec2> projected;
    std::vector<std::array<std::size_t, 3>> triangles;
    Vec3 normal;
    double epsilon = 0, areaEpsilon = 0, orientation = 1;
    bool convex = false;
};
struct Incident {
    Id face = 0, from = 0, to = 0;
};
using Adjacency = std::map<Edge, std::vector<Incident>>;

Polygon polygon(const std::vector<Vec3> &points);
Polygon polygon(const Object &object, const Face &face, bool nativePrecision = false);
Adjacency adjacency(const Object &object);
void orientedManifold(const Object &object, bool closed);
void convexSolid(const Object &object);
void checkState(const State &state);
void ownData(State &state);
void checkSelection(const State &state, const Selection &selection);
void checkName(const QString &name);
void checkTexture(const QByteArray &png, std::size_t &pixels);
void checkNativeGlb(const QByteArray &bytes);
void readGlb(const QByteArray &bytes, const QString &name, State &state);
void writeGlb(const State &state, QByteArray &bytes);
QByteArray sourceBytes(const State &state);
std::size_t footprint(const State &state);

std::set<Id> selectedVertices(const State &state, const Selection &selection, Id object);
std::vector<std::pair<Id, Id>> selectedFaces(const State &state, const Selection &selection);
std::vector<Id> selectedObjects(const State &state, const Selection &selection);
void clean(Object &object);
void planarUvs(Object &object, Face &face, double left = 0, double top = 0,
    double size = 1, double padding = 0);
Corner interpolate(Corner a, Corner b, double t, Id id);
Vec2 interpolatedUv(const Polygon &shape, const Face &face, Vec3 point);
void makePrimitive(State &state, Selection &selection, Primitive primitive,
    const QString &name, unsigned sides, Id &id);
void extrudeFaces(State &state, Selection &selection, double distance);
void insetFace(State &state, Selection &selection, double distance);
void bevel(State &state, Selection &selection, double depth);
void subdivideFaces(State &state, Selection &selection);

} // namespace nova::mesh::detail

#endif
