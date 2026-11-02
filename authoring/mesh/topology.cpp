#include "internal.hpp"

#include <queue>

namespace nova::mesh::detail {

static Id defaultMaterial(State &state)
{
    for (const auto &material : state.materials)
        if (material.name == QStringLiteral("Default") && !material.texture && same(material.color, {1, 1, 1}))
            return material.id;
    const Id id = allocate(state);
    state.materials.push_back({id, QStringLiteral("Default"), {1, 1, 1}, 0});
    return id;
}

void makePrimitive(State &state, Selection &selection, Primitive primitive,
    const QString &name, unsigned sides, Id &id)
{
    checkName(name);
    require(state.objects.size() < MaxObjects, QStringLiteral("The 128-object mesh budget is full."));
    require(primitive == Primitive::Box || primitive == Primitive::Plane || primitive == Primitive::Pyramid ||
        primitive == Primitive::Cylinder || primitive == Primitive::Sphere, QStringLiteral("Unknown primitive type."));
    if (primitive == Primitive::Cylinder)
        require(sides >= 3 && sides <= 32, QStringLiteral("Cylinders support 3..32 sides."));
    if (primitive == Primitive::Sphere)
        require(sides >= 8 && sides <= 32, QStringLiteral("Low-poly spheres support 8..32 longitude segments."));
    Object object;
    object.id = allocate(state); object.name = name;
    const Id material = defaultMaterial(state);
    auto addVertex = [&](Vec3 p) {
        const Id vertexId = allocate(state);
        object.vertices.push_back({vertexId, p});
        return vertexId;
    };
    auto addFace = [&](const std::vector<Id> &vertices) {
        Face face;
        face.id = allocate(state); face.material = material;
        for (const Id vertexId : vertices) face.corners.push_back(corner(vertexId));
        planarUvs(object, face);
        object.faces.push_back(std::move(face));
    };
    constexpr double pi = 3.14159265358979323846;
    if (primitive == Primitive::Box || primitive == Primitive::Pyramid || primitive == Primitive::Plane) {
        std::vector<Id> v;
        const double y = primitive == Primitive::Plane ? 0 : -0.5;
        for (Vec3 point : {Vec3{-0.5, y, -0.5}, Vec3{0.5, y, -0.5},
            Vec3{0.5, y, 0.5}, Vec3{-0.5, y, 0.5}}) v.push_back(addVertex(point));
        if (primitive == Primitive::Plane) addFace({v[0], v[3], v[2], v[1]});
        else if (primitive == Primitive::Pyramid) {
            const Id top = addVertex({0, 0.5, 0});
            addFace({v[0], v[1], v[2], v[3]});
            for (std::size_t i = 0; i < 4; ++i) addFace({v[i], top, v[(i + 1) % 4]});
        } else {
            for (Vec3 point : {Vec3{-0.5, 0.5, -0.5}, Vec3{0.5, 0.5, -0.5},
                Vec3{0.5, 0.5, 0.5}, Vec3{-0.5, 0.5, 0.5}}) v.push_back(addVertex(point));
            for (const auto &f : {std::array<unsigned, 4>{0, 1, 2, 3}, {4, 7, 6, 5},
                {0, 4, 5, 1}, {1, 5, 6, 2}, {2, 6, 7, 3}, {3, 7, 4, 0}})
                addFace({v[f[0]], v[f[1]], v[f[2]], v[f[3]]});
        }
    } else if (primitive == Primitive::Cylinder) {
        std::vector<Id> bottom, top;
        for (unsigned i = 0; i < sides; ++i) {
            const double angle = 2 * pi * i / sides;
            bottom.push_back(addVertex({0.5 * std::cos(angle), -0.5, 0.5 * std::sin(angle)}));
            top.push_back(addVertex({0.5 * std::cos(angle), 0.5, 0.5 * std::sin(angle)}));
        }
        addFace(bottom);
        auto reversedTop = top;
        std::reverse(reversedTop.begin(), reversedTop.end());
        addFace(reversedTop);
        for (unsigned i = 0; i < sides; ++i)
            addFace({bottom[i], top[i], top[(i + 1) % sides], bottom[(i + 1) % sides]});
    } else {
        const Id north = addVertex({0, 0.5, 0});
        const unsigned rings = sides / 2;
        std::vector<std::vector<Id>> latitude;
        for (unsigned r = 1; r < rings; ++r) {
            std::vector<Id> ring;
            const double angle = pi * r / rings;
            for (unsigned i = 0; i < sides; ++i) {
                const double longitude = 2 * pi * i / sides;
                ring.push_back(addVertex({0.5 * std::sin(angle) * std::cos(longitude),
                    0.5 * std::cos(angle), 0.5 * std::sin(angle) * std::sin(longitude)}));
            }
            latitude.push_back(std::move(ring));
        }
        const Id south = addVertex({0, -0.5, 0});
        for (unsigned i = 0; i < sides; ++i) {
            const unsigned next = (i + 1) % sides;
            addFace({north, latitude.front()[next], latitude.front()[i]});
            for (std::size_t r = 0; r + 1 < latitude.size(); ++r)
                addFace({latitude[r][i], latitude[r][next], latitude[r + 1][next], latitude[r + 1][i]});
            addFace({south, latitude.back()[i], latitude.back()[next]});
        }
    }
    id = object.id;
    state.objects.push_back(std::move(object));
    selection = {SelectionMode::Object, 0, {id}, {}};
}

static Object &faceObject(State &state, const Selection &selection, bool single)
{
    require(selection.mode == SelectionMode::Face && !selection.ids.empty() && (!single || selection.ids.size() == 1),
        single ? QStringLiteral("Select exactly one face in Face mode.")
               : QStringLiteral("Select a connected coplanar face region in Face mode."));
    return find(state.objects, selection.object, QStringLiteral("Object"));
}

void extrudeFaces(State &state, Selection &selection, double distance)
{
    require(std::isfinite(distance) && std::abs(distance) > 1e-8 && std::abs(distance) <= CoordinateLimit,
        QStringLiteral("Extrusion distance must be finite, nonzero, and within +/-1,000,000."));
    Object &object = faceObject(state, selection, false);
    orientedManifold(object, false);
    const auto edges = adjacency(object);
    const std::set<Id> chosen(selection.ids.begin(), selection.ids.end());
    const Polygon reference = polygon(object, find(object.faces, selection.ids[0], QStringLiteral("Face")));
    std::set<Id> vertices;
    std::map<Id, std::vector<Id>> neighbors;
    std::vector<Incident> boundary;
    for (const auto &face : object.faces) {
        if (!chosen.count(face.id)) continue;
        const Polygon shape = polygon(object, face);
        require(dot(shape.normal, reference.normal) > 1 - 1e-8 &&
            std::abs(dot(reference.normal, shape.points[0] - reference.points[0])) <= reference.epsilon * 10,
            QStringLiteral("Region extrusion requires coplanar faces with the same winding."));
        for (const auto &c : face.corners) vertices.insert(c.vertex);
    }
    for (const auto &[edge, incident] : edges) {
        (void)edge;
        std::vector<Incident> selected;
        for (const auto &value : incident) if (chosen.count(value.face)) selected.push_back(value);
        if (selected.size() == 1) boundary.push_back(selected[0]);
        if (selected.size() == 2) {
            neighbors[selected[0].face].push_back(selected[1].face);
            neighbors[selected[1].face].push_back(selected[0].face);
        }
    }
    std::set<Id> connected;
    std::queue<Id> pending;
    pending.push(selection.ids[0]);
    while (!pending.empty()) {
        const Id id = pending.front(); pending.pop();
        if (!connected.insert(id).second) continue;
        for (const Id adjacent : neighbors[id]) pending.push(adjacent);
    }
    require(connected.size() == chosen.size(), QStringLiteral("Extrude one edge-connected face region at a time."));
    std::map<Id, Id> outgoing;
    std::set<Id> incoming;
    for (const auto &edge : boundary)
        require(outgoing.emplace(edge.from, edge.to).second && incoming.insert(edge.to).second,
            QStringLiteral("Extrusion requires one simple boundary, without pinched vertices."));
    require(!outgoing.empty(), QStringLiteral("This face region has no boundary to extrude."));
    Id cursor = outgoing.begin()->first;
    const Id start = cursor;
    std::size_t walked = 0;
    do {
        require(outgoing.count(cursor), QStringLiteral("The extrusion boundary is open."));
        cursor = outgoing.at(cursor);
        ++walked;
    } while (cursor != start && walked <= outgoing.size());
    require(cursor == start && walked == outgoing.size(),
        QStringLiteral("Extrusion of regions with holes or multiple boundaries is not supported."));
    std::map<Id, Id> cap;
    for (const Id original : vertices) {
        const Vec3 point = vertex(object, original).position + reference.normal * distance;
        const Id id = allocate(state);
        object.vertices.push_back({id, point});
        cap[original] = id;
    }
    for (auto &face : object.faces)
        if (chosen.count(face.id)) for (auto &c : face.corners) c.vertex = cap.at(c.vertex);
    for (const auto &edge : boundary) {
        const Id material = find(object.faces, edge.face, QStringLiteral("Face")).material;
        object.faces.push_back({allocate(state), material,
            {corner(edge.from, {0, 0}), corner(edge.to, {1, 0}),
                corner(cap.at(edge.to), {1, 1}), corner(cap.at(edge.from), {0, 1})}});
    }
    clean(object);
}

void insetFace(State &state, Selection &selection, double distance)
{
    require(std::isfinite(distance) && distance > 1e-8, QStringLiteral("Inset distance must be positive and finite."));
    Object &object = faceObject(state, selection, true);
    orientedManifold(object, false);
    const Face original = find(object.faces, selection.ids[0], QStringLiteral("Face"));
    const Polygon shape = polygon(object, original);
    require(shape.convex, QStringLiteral("Inset currently supports one convex planar face, not concave faces or regions."));
    std::vector<Vec3> inner;
    for (std::size_t i = 0; i < shape.points.size(); ++i) {
        const Vec3 p = shape.points[i];
        const Vec3 incoming = unit(p - shape.points[(i + shape.points.size() - 1) % shape.points.size()]);
        const Vec3 outgoing = unit(shape.points[(i + 1) % shape.points.size()] - p);
        const Vec3 a = cross(shape.normal, incoming), b = cross(shape.normal, outgoing);
        const double divisor = 1 + dot(a, b);
        require(divisor > 1e-8, QStringLiteral("Inset cannot offset a folded or needle-shaped corner."));
        inner.push_back(p + (a + b) * (distance / divisor));
    }
    for (std::size_t i = 0; i < inner.size(); ++i) {
        const Vec3 a = shape.points[i], b = shape.points[(i + 1) % inner.size()];
        const Vec3 inward = unit(cross(shape.normal, b - a));
        require(dot(inner[(i + 1) % inner.size()] - inner[i], b - a) > shape.areaEpsilon,
            QStringLiteral("Inset distance collapses or reverses an edge; choose a smaller distance."));
        for (const auto &p : inner)
            require(dot(inward, p - a) >= distance - shape.epsilon * 10,
                QStringLiteral("Inset distance crosses another edge; choose a smaller distance."));
    }
    require(polygon(inner).convex, QStringLiteral("Inset would create an invalid inner face."));
    Face cap = original;
    clearNormals(cap);
    for (std::size_t i = 0; i < inner.size(); ++i) {
        const Id id = allocate(state);
        object.vertices.push_back({id, inner[i] - object.origin});
        cap.corners[i] = corner(id, interpolatedUv(shape, original, inner[i]));
    }
    find(object.faces, original.id, QStringLiteral("Face")) = cap;
    for (std::size_t i = 0; i < cap.corners.size(); ++i) {
        const auto next = (i + 1) % cap.corners.size();
        Face ring{allocate(state), original.material,
            {original.corners[i], original.corners[next], cap.corners[next], cap.corners[i]}};
        clearNormals(ring);
        object.faces.push_back(std::move(ring));
    }
}

void bevel(State &state, Selection &selection, double depth)
{
    require(selection.mode == SelectionMode::Edge && selection.edges.size() == 1,
        QStringLiteral("Bevel requires exactly one edge in Edge mode."));
    require(std::isfinite(depth) && depth > 1e-8, QStringLiteral("Bevel cut depth must be positive and finite."));
    Object &object = find(state.objects, selection.object, QStringLiteral("Object"));
    require(object.vertices.size() <= 4096 && object.faces.size() <= 4096,
        QStringLiteral("The bounded convex bevel supports at most 4,096 vertices and faces per object."));
    convexSolid(object);
    const Edge edge = selection.edges[0];
    const auto incident = adjacency(object).at(edge);
    const Polygon a = polygon(object, find(object.faces, incident[0].face, QStringLiteral("Face")));
    const Polygon b = polygon(object, find(object.faces, incident[1].face, QStringLiteral("Face")));
    require(std::abs(dot(a.normal, b.normal)) < 1 - 1e-8,
        QStringLiteral("Bevel requires a sharp edge between two noncoplanar faces."));
    const Vec3 normal = unit(a.normal + b.normal);
    const double support = dot(normal, vertex(object, edge.a).position + object.origin);
    double clearance = std::numeric_limits<double>::max();
    for (const auto &v : object.vertices) {
        if (v.id == edge.a || v.id == edge.b) continue;
        clearance = std::min(clearance, support - dot(normal, v.position + object.origin));
    }
    require(clearance > 1e-8 && depth < clearance * 0.5,
        QStringLiteral("Bevel depth must be less than half the distance to the next vertex; this cut would consume another edge."));
    const double plane = support - depth;
    const Id material = find(object.faces, incident[0].face, QStringLiteral("Face")).material;
    std::map<Edge, Id> intersections;
    std::set<Id> newVertices;
    std::vector<Face> clipped;
    for (const auto &face : object.faces) {
        Face result{face.id, face.material, {}};
        for (std::size_t i = 0; i < face.corners.size(); ++i) {
            const Corner from = face.corners[i], to = face.corners[(i + 1) % face.corners.size()];
            const Vec3 p = vertex(object, from.vertex).position, q = vertex(object, to.vertex).position;
            const double dp = dot(normal, p + object.origin) - plane, dq = dot(normal, q + object.origin) - plane;
            if (dp <= 0) result.corners.push_back(from);
            if ((dp <= 0) == (dq <= 0)) continue;
            const double t = dp / (dp - dq);
            const Edge crossing = Edge::between(from.vertex, to.vertex);
            auto [it, inserted] = intersections.emplace(crossing, 0);
            if (inserted) {
                it->second = allocate(state);
                object.vertices.push_back({it->second, p + (q - p) * t});
                newVertices.insert(it->second);
            }
            result.corners.push_back(interpolate(from, to, t, it->second));
        }
        require(result.corners.size() >= 3, QStringLiteral("The bevel would remove an entire face."));
        clipped.push_back(std::move(result));
    }
    std::map<Id, Id> boundary;
    for (const auto &face : clipped) {
        for (std::size_t i = 0; i < face.corners.size(); ++i) {
            const Id from = face.corners[i].vertex, to = face.corners[(i + 1) % face.corners.size()].vertex;
            if (newVertices.count(from) && newVertices.count(to))
                require(boundary.emplace(to, from).second,
                    QStringLiteral("The bevel cap has ambiguous connectivity."));
        }
    }
    require(boundary.size() >= 3 && boundary.size() <= MaxCornersPerFace,
        QStringLiteral("The bevel cap requires 3..32 corners."));
    Face cap{allocate(state), material, {}};
    Id cursor = boundary.begin()->first;
    const Id first = cursor;
    do {
        cap.corners.push_back(corner(cursor));
        require(boundary.count(cursor), QStringLiteral("The bevel cap has an open boundary."));
        cursor = boundary.at(cursor);
    } while (cursor != first && cap.corners.size() <= boundary.size());
    require(cursor == first && cap.corners.size() == boundary.size(),
        QStringLiteral("The bevel cap is not one simple polygon."));
    planarUvs(object, cap);
    require(dot(polygon(object, cap).normal, normal) > 1 - 1e-7,
        QStringLiteral("The bevel cap winding does not match the solid."));
    selection = {SelectionMode::Face, object.id, {cap.id}, {}};
    clipped.push_back(std::move(cap));
    object.faces = std::move(clipped);
    clean(object);
    convexSolid(object);
}

void subdivideFaces(State &state, Selection &selection)
{
    const auto selected = selectedFaces(state, selection);
    std::map<Id, std::set<Id>> targets;
    for (const auto &[object, face] : selected) targets[object].insert(face);
    std::vector<Id> selectedChildren;
    for (const auto &[objectId, faces] : targets) {
        Object &object = find(state.objects, objectId, QStringLiteral("Object"));
        orientedManifold(object, false);
        std::map<Edge, Id> midpoint;
        for (const auto &face : object.faces) {
            if (!faces.count(face.id)) continue;
            require(polygon(object, face).convex,
                QStringLiteral("Subdivision supports convex planar faces. Triangulate a concave face first."));
            for (std::size_t i = 0; i < face.corners.size(); ++i) {
                const Edge edge = Edge::between(face.corners[i].vertex, face.corners[(i + 1) % face.corners.size()].vertex);
                if (midpoint.count(edge)) continue;
                const Vec3 p = (vertex(object, edge.a).position + vertex(object, edge.b).position) * 0.5;
                const Id id = allocate(state);
                object.vertices.push_back({id, p}); midpoint[edge] = id;
            }
        }
        std::vector<Face> output;
        for (const auto &face : object.faces) {
            const auto &c = face.corners;
            if (!faces.count(face.id)) {
                Face neighbor{face.id, face.material, {}};
                for (std::size_t i = 0; i < c.size(); ++i) {
                    neighbor.corners.push_back(c[i]);
                    const auto next = (i + 1) % c.size();
                    const auto found = midpoint.find(Edge::between(c[i].vertex, c[next].vertex));
                    if (found != midpoint.end())
                        neighbor.corners.push_back(interpolate(c[i], c[next], 0.5, found->second));
                }
                require(neighbor.corners.size() <= MaxCornersPerFace,
                    QStringLiteral("Subdivision would push a neighboring face past 32 corners; triangulate it first."));
                output.push_back(std::move(neighbor));
                continue;
            }
            std::vector<Corner> mid;
            for (std::size_t i = 0; i < c.size(); ++i) {
                const auto next = (i + 1) % c.size();
                mid.push_back(interpolate(c[i], c[next], 0.5, midpoint.at(Edge::between(c[i].vertex, c[next].vertex))));
            }
            bool first = true;
            auto child = [&](std::vector<Corner> corners) {
                const Id id = first ? face.id : allocate(state);
                first = false;
                output.push_back({id, face.material, std::move(corners)});
                selectedChildren.push_back(id);
            };
            if (c.size() == 3) {
                child({c[0], mid[0], mid[2]}); child({mid[0], c[1], mid[1]});
                child({mid[2], mid[1], c[2]}); child({mid[0], mid[1], mid[2]});
            } else {
                Vec3 center{}, normal{};
                Vec2 uv{};
                bool authored = true;
                for (const auto &value : c) {
                    center = center + vertex(object, value.vertex).position;
                    uv = uv + value.uv;
                    if (value.normal) normal = normal + *value.normal;
                    else authored = false;
                }
                const double count = static_cast<double>(c.size());
                const Id id = allocate(state);
                object.vertices.push_back({id, center / count});
                Corner middle = corner(id, uv * (1.0 / count));
                if (authored) {
                    require(length(normal) > 1e-10,
                        QStringLiteral("Center normals cancel out; recalculate flat normals before subdivision."));
                    middle.normal = unit(normal);
                }
                for (std::size_t i = 0; i < c.size(); ++i)
                    child({c[i], mid[i], middle, mid[(i + c.size() - 1) % c.size()]});
            }
        }
        object.faces = std::move(output);
    }
    if (selection.mode == SelectionMode::Face) selection.ids = std::move(selectedChildren);
}

} // namespace nova::mesh::detail
