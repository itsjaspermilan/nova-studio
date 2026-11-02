#include "internal.hpp"

#include <tuple>

namespace nova::mesh {

Edge Edge::between(Id a, Id b) { return a < b ? Edge{a, b} : Edge{b, a}; }
bool Edge::operator<(const Edge &other) const { return std::tie(a, b) < std::tie(other.a, other.b); }
bool Edge::operator==(const Edge &other) const { return a == other.a && b == other.b; }

namespace detail {

static double orient(Vec2 a, Vec2 b, Vec2 c)
{
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

static bool onSegment(Vec2 a, Vec2 b, Vec2 p, double distanceEpsilon, double areaEpsilon)
{
    return std::abs(orient(a, b, p)) <= areaEpsilon &&
        p.x >= std::min(a.x, b.x) - distanceEpsilon && p.x <= std::max(a.x, b.x) + distanceEpsilon &&
        p.y >= std::min(a.y, b.y) - distanceEpsilon && p.y <= std::max(a.y, b.y) + distanceEpsilon;
}

static bool intersects(Vec2 a, Vec2 b, Vec2 c, Vec2 d, double distanceEpsilon, double areaEpsilon)
{
    const double abC = orient(a, b, c), abD = orient(a, b, d);
    const double cdA = orient(c, d, a), cdB = orient(c, d, b);
    if (((abC > areaEpsilon && abD < -areaEpsilon) || (abC < -areaEpsilon && abD > areaEpsilon)) &&
        ((cdA > areaEpsilon && cdB < -areaEpsilon) || (cdA < -areaEpsilon && cdB > areaEpsilon))) return true;
    return onSegment(a, b, c, distanceEpsilon, areaEpsilon) ||
        onSegment(a, b, d, distanceEpsilon, areaEpsilon) ||
        onSegment(c, d, a, distanceEpsilon, areaEpsilon) ||
        onSegment(c, d, b, distanceEpsilon, areaEpsilon);
}

static Polygon polygonWithOrder(const std::vector<Vec3> &points, const std::vector<Id> &identities)
{
    require(points.size() >= 3 && points.size() <= MaxCornersPerFace,
        QStringLiteral("Faces require 3..32 corners."));
    Polygon result;
    result.points = points;
    Vec3 area{};
    double extent = 0;
    for (std::size_t i = 0; i < points.size(); ++i) {
        require(finite(points[i]), QStringLiteral("Face positions must be finite."));
        const Vec3 local = points[i] - points[0];
        extent = std::max(extent, length(local));
        area = area + cross(local, points[(i + 1) % points.size()] - points[0]);
    }
    result.epsilon = std::max(1e-10, extent * 1e-8);
    result.areaEpsilon = std::max(1e-20, extent * extent * 1e-10);
    require(length(area) > result.areaEpsilon, QStringLiteral("A face has zero area or overlapping edges."));
    result.normal = unit(area);
    int axis = std::abs(result.normal.x) > std::abs(result.normal.y) ? 0 : 1;
    if (std::abs(result.normal.z) > (axis == 0 ? std::abs(result.normal.x) : std::abs(result.normal.y))) axis = 2;
    for (std::size_t i = 0; i < points.size(); ++i) {
        require(length(points[i] - points[(i + 1) % points.size()]) > result.epsilon,
            QStringLiteral("A face has a collapsed edge."));
        const Vec3 p = points[i] - points[0];
        require(std::abs(dot(result.normal, p)) <= std::max(1e-9, extent * 2e-6),
            QStringLiteral("The operation makes a face non-planar. Triangulate it before moving individual corners."));
        result.projected.push_back(axis == 0 ? Vec2{p.y, p.z} : axis == 1 ? Vec2{p.x, p.z} : Vec2{p.x, p.y});
    }
    const auto &p = result.projected;
    double area2 = 0;
    for (std::size_t i = 0; i < p.size(); ++i) {
        const std::size_t next = (i + 1) % p.size();
        area2 += p[i].x * p[next].y - p[next].x * p[i].y;
        for (std::size_t j = i + 1; j < p.size(); ++j) {
            if (j == next || (j + 1) % p.size() == i) continue;
            require(!intersects(p[i], p[next], p[j], p[(j + 1) % p.size()], result.epsilon, result.areaEpsilon),
                QStringLiteral("A face crosses or touches itself."));
        }
    }
    result.orientation = area2 < 0 ? -1 : 1;
    result.convex = true;
    for (std::size_t i = 0; i < p.size(); ++i)
        if (result.orientation * orient(p[i], p[(i + 1) % p.size()], p[(i + 2) % p.size()]) <
            -result.areaEpsilon) result.convex = false;

    std::vector<std::size_t> remaining;
    for (std::size_t i = 0; i < p.size(); ++i) remaining.push_back(i);
    while (remaining.size() > 3) {
        bool clipped = false;
        std::vector<std::size_t> candidates;
        for (std::size_t i = 0; i < remaining.size(); ++i) candidates.push_back(i);
        // Stable vertex identity chooses the diagonal, not winding or world
        // coordinates. Mirroring/rotating a face must not change its UV surface.
        std::sort(candidates.begin(), candidates.end(), [&](std::size_t a, std::size_t b) {
            return identities[remaining[a]] < identities[remaining[b]];
        });
        for (const std::size_t i : candidates) {
            const auto a = remaining[(i + remaining.size() - 1) % remaining.size()];
            const auto b = remaining[i], c = remaining[(i + 1) % remaining.size()];
            if (result.orientation * orient(p[a], p[b], p[c]) <= result.areaEpsilon) continue;
            bool occupied = false;
            for (const auto other : remaining) {
                if (other == a || other == b || other == c) continue;
                if (result.orientation * orient(p[a], p[b], p[other]) >= -result.areaEpsilon &&
                    result.orientation * orient(p[b], p[c], p[other]) >= -result.areaEpsilon &&
                    result.orientation * orient(p[c], p[a], p[other]) >= -result.areaEpsilon) {
                    occupied = true;
                    break;
                }
            }
            if (occupied) continue;
            result.triangles.push_back({a, b, c});
            remaining.erase(remaining.begin() + static_cast<std::ptrdiff_t>(i));
            clipped = true;
            break;
        }
        require(clipped, QStringLiteral("This face cannot be triangulated without a degenerate triangle."));
    }
    require(result.orientation * orient(p[remaining[0]], p[remaining[1]], p[remaining[2]]) > result.areaEpsilon,
        QStringLiteral("The final face triangle is degenerate."));
    result.triangles.push_back({remaining[0], remaining[1], remaining[2]});
    return result;
}

Polygon polygon(const std::vector<Vec3> &points)
{
    std::vector<Id> identities;
    for (std::size_t i = 0; i < points.size(); ++i) identities.push_back(static_cast<Id>(i));
    return polygonWithOrder(points, identities);
}

Polygon polygon(const Object &object, const Face &face, bool nativePrecision)
{
    std::vector<Vec3> points;
    std::vector<Id> identities;
    for (const auto &value : face.corners) {
        Vec3 point = vertex(object, value.vertex).position + object.origin;
        if (nativePrecision)
            point = {static_cast<float>(point.x), static_cast<float>(point.y), static_cast<float>(point.z)};
        points.push_back(point);
        identities.push_back(value.vertex);
    }
    return polygonWithOrder(points, identities);
}

Adjacency adjacency(const Object &object)
{
    Adjacency result;
    for (const auto &face : object.faces) {
        for (std::size_t i = 0; i < face.corners.size(); ++i) {
            const Id a = face.corners[i].vertex, b = face.corners[(i + 1) % face.corners.size()].vertex;
            result[Edge::between(a, b)].push_back({face.id, a, b});
        }
    }
    return result;
}

void orientedManifold(const Object &object, bool closed)
{
    for (const auto &[edge, incident] : adjacency(object)) {
        (void)edge;
        require(incident.size() <= 2 && (!closed || incident.size() == 2),
            closed ? QStringLiteral("This operation requires a closed manifold solid; an open or non-manifold edge was found.")
                   : QStringLiteral("This operation does not support non-manifold edges."));
        require(incident.size() != 2 || incident[0].from != incident[1].from,
            QStringLiteral("Adjacent faces have inconsistent winding. Correct their face normals first."));
    }
}

void convexSolid(const Object &object)
{
    orientedManifold(object, true);
    require(object.faces.size() >= 4, QStringLiteral("Bevel requires a closed convex solid."));
    for (const auto &face : object.faces) {
        const Polygon shape = polygon(object, face);
        require(shape.convex, QStringLiteral("Bevel supports convex solids only; a concave face was found."));
        bool interior = false;
        for (const auto &value : object.vertices) {
            const double distance = dot(shape.normal, value.position + object.origin - shape.points[0]);
            require(distance <= shape.epsilon * 10,
                QStringLiteral("Bevel requires an outward-facing convex solid, without overlapping or concave parts."));
            if (distance < -shape.epsilon * 10) interior = true;
        }
        require(interior, QStringLiteral("Bevel cannot operate on a flat or zero-volume solid."));
    }
}

Corner interpolate(Corner a, Corner b, double t, Id id)
{
    Corner result{id, a.uv * (1 - t) + b.uv * t, std::nullopt};
    if (a.normal && b.normal) {
        const Vec3 normal = *a.normal * (1 - t) + *b.normal * t;
        require(length(normal) > 1e-10,
            QStringLiteral("Interpolated authored normals cancel out; recalculate flat normals before this edit."));
        result.normal = unit(normal);
    }
    return result;
}

Vec2 interpolatedUv(const Polygon &shape, const Face &face, Vec3 point)
{
    for (const auto &triangle : shape.triangles) {
        const Vec3 a = shape.points[triangle[0]], b = shape.points[triangle[1]], c = shape.points[triangle[2]];
        const Vec3 v0 = b - a, v1 = c - a, v2 = point - a;
        const double d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1);
        const double d20 = dot(v2, v0), d21 = dot(v2, v1), denominator = d00 * d11 - d01 * d01;
        const double v = (d11 * d20 - d01 * d21) / denominator;
        const double w = (d00 * d21 - d01 * d20) / denominator, u = 1 - v - w;
        if (u >= -1e-7 && v >= -1e-7 && w >= -1e-7) {
            Vec2 uv = face.corners[triangle[0]].uv * u + face.corners[triangle[1]].uv * v +
                face.corners[triangle[2]].uv * w;
            // Only remove barycentric roundoff at an existing UV boundary.
            if (uv.x > -1e-7 && uv.x < 0) uv.x = 0;
            if (uv.y > -1e-7 && uv.y < 0) uv.y = 0;
            if (uv.x < 1 + 1e-7 && uv.x > 1) uv.x = 1;
            if (uv.y < 1 + 1e-7 && uv.y > 1) uv.y = 1;
            return uv;
        }
    }
    throw Failure{QStringLiteral("Inset UV interpolation fell outside the original face.")};
}

void planarUvs(Object &object, Face &face, double left, double top, double size, double padding)
{
    const Polygon shape = polygon(object, face);
    Vec3 tangent{};
    double longest = 0;
    for (std::size_t i = 0; i < shape.points.size(); ++i) {
        const Vec3 edge = shape.points[(i + 1) % shape.points.size()] - shape.points[i];
        if (length(edge) > longest) { tangent = unit(edge); longest = length(edge); }
    }
    const Vec3 vertical = cross(shape.normal, tangent);
    std::vector<Vec2> projected;
    Vec2 minimum{std::numeric_limits<double>::max(), std::numeric_limits<double>::max()};
    Vec2 maximum{-minimum.x, -minimum.y};
    for (const auto &point : shape.points) {
        const Vec3 relative = point - shape.points[0];
        const Vec2 p{dot(relative, tangent), -dot(relative, vertical)};
        minimum.x = std::min(minimum.x, p.x); minimum.y = std::min(minimum.y, p.y);
        maximum.x = std::max(maximum.x, p.x); maximum.y = std::max(maximum.y, p.y);
        projected.push_back(p);
    }
    const double width = maximum.x - minimum.x, height = maximum.y - minimum.y;
    const double scale = size * (1 - padding * 2) / std::max(width, height);
    const double x = left + (size - width * scale) / 2, y = top + (size - height * scale) / 2;
    for (std::size_t i = 0; i < face.corners.size(); ++i) {
        const Vec2 uv{x + (projected[i].x - minimum.x) * scale, y + (projected[i].y - minimum.y) * scale};
        require(uv.x >= -1e-12 && uv.x <= 1 + 1e-12 && uv.y >= -1e-12 && uv.y <= 1 + 1e-12,
            QStringLiteral("Projected UV island lies outside the supported atlas."));
        // Planar islands are constructed inside the atlas; remove boundary roundoff only.
        face.corners[i].uv = {std::clamp(uv.x, 0.0, 1.0), std::clamp(uv.y, 0.0, 1.0)};
    }
}

void clean(Object &object)
{
    std::set<Id> used;
    for (const auto &face : object.faces) for (const auto &value : face.corners) used.insert(value.vertex);
    object.vertices.erase(std::remove_if(object.vertices.begin(), object.vertices.end(),
        [&](const Vertex &value) { return !used.count(value.id); }), object.vertices.end());
}

std::vector<Id> selectedObjects(const State &state, const Selection &selection)
{
    checkSelection(state, selection);
    require(selection.mode == SelectionMode::Object && !selection.ids.empty(),
        QStringLiteral("Select one or more objects in Object mode."));
    return selection.ids;
}

std::set<Id> selectedVertices(const State &state, const Selection &selection, Id objectId)
{
    const Object &object = find(state.objects, objectId, QStringLiteral("Object"));
    std::set<Id> result;
    if (selection.mode == SelectionMode::Object) {
        if (std::find(selection.ids.begin(), selection.ids.end(), objectId) != selection.ids.end())
            for (const auto &v : object.vertices) result.insert(v.id);
    } else if (selection.object == objectId) {
        if (selection.mode == SelectionMode::Vertex) result.insert(selection.ids.begin(), selection.ids.end());
        else if (selection.mode == SelectionMode::Edge)
            for (const auto &edge : selection.edges) { result.insert(edge.a); result.insert(edge.b); }
        else for (const auto id : selection.ids)
            for (const auto &c : find(object.faces, id, QStringLiteral("Face")).corners) result.insert(c.vertex);
    }
    return result;
}

std::vector<std::pair<Id, Id>> selectedFaces(const State &state, const Selection &selection)
{
    checkSelection(state, selection);
    std::vector<std::pair<Id, Id>> result;
    require(selection.mode == SelectionMode::Object || selection.mode == SelectionMode::Face,
        QStringLiteral("This operation requires Object or Face selection mode."));
    if (selection.mode == SelectionMode::Object) {
        for (const Id id : selection.ids)
            for (const auto &face : find(state.objects, id, QStringLiteral("Object")).faces)
                result.emplace_back(id, face.id);
    } else for (const Id id : selection.ids) result.emplace_back(selection.object, id);
    require(!result.empty(), QStringLiteral("Select at least one face."));
    return result;
}

} // namespace detail
} // namespace nova::mesh
