#include "internal.hpp"

#include <queue>

namespace nova::mesh::detail {

void ownData(State &state)
{
    require(state.objects.size() <= MaxObjects && state.groups.size() <= MaxGroups &&
        state.materials.size() <= MaxMaterials && state.textures.size() <= MaxTextures &&
        state.originals.size() <= MaxOriginals, QStringLiteral("The mesh document exceeds an item-count budget."));
    auto name = [](QString &value) { checkName(value); value = QString(value.constData(), value.size()); };
    auto bytes = [](QByteArray &value) { value = QByteArray(value.constData(), value.size()); };
    for (auto &group : state.groups) name(group.name);
    for (auto &texture : state.textures) {
        require(texture.png.size() <= 1024 * 1024, QStringLiteral("Model textures cannot exceed 1 MiB."));
        name(texture.name); bytes(texture.png);
    }
    for (auto &material : state.materials) name(material.name);
    for (auto &object : state.objects) name(object.name);
    std::size_t total = 0;
    for (auto &original : state.originals) {
        require(static_cast<std::size_t>(original.glb.size()) <= MaxOriginalBytes - total,
            QStringLiteral("Retained GLB originals exceed the combined 16 MiB budget."));
        total += static_cast<std::size_t>(original.glb.size());
        name(original.name); bytes(original.glb);
    }
}

void checkName(const QString &name)
{
    require(!name.trimmed().isEmpty() && name.size() <= 128 && name.toUtf8().size() <= 512,
        QStringLiteral("Names require 1..128 Unicode characters (at most 512 UTF-8 bytes)."));
    require(QString::fromUtf8(name.toUtf8()) == name, QStringLiteral("A name contains invalid Unicode."));
    for (const QChar value : name)
        require(!value.isNull() && value.category() != QChar::Other_Control &&
            value.category() != QChar::Separator_Line && value.category() != QChar::Separator_Paragraph,
            QStringLiteral("Names cannot contain control characters or line breaks."));
}

void checkState(const State &state)
{
    require(state.nextId != 0, QStringLiteral("The next stable ID cannot be zero."));
    require(state.objects.size() <= MaxObjects && state.groups.size() <= MaxGroups,
        QStringLiteral("A mesh document supports at most 128 objects and 128 groups."));
    require(state.materials.size() <= MaxMaterials && state.textures.size() <= MaxTextures,
        QStringLiteral("A mesh document supports at most 256 material definitions and 16 textures."));
    require(state.originals.size() <= MaxOriginals,
        QStringLiteral("A mesh document can retain at most 8 imported originals."));
    std::set<Id> identifiers;
    auto identify = [&](Id id) {
        require(id && id < state.nextId && identifiers.insert(id).second,
            QStringLiteral("Stable IDs must be unique, nonzero, and below nextId (ID %1).").arg(id));
    };
    std::set<Id> groups, textures, materials, originals;
    for (const auto &original : state.originals) originals.insert(original.id);
    for (const auto &group : state.groups) {
        identify(group.id); checkName(group.name); groups.insert(group.id);
    }
    std::size_t pixels = 0;
    for (const auto &texture : state.textures) {
        identify(texture.id); checkName(texture.name); textures.insert(texture.id);
        checkTexture(texture.png, pixels);
    }
    require(pixels <= 4 * 1024 * 1024, QStringLiteral("Model textures exceed the 4,194,304-pixel model budget."));
    for (const auto &material : state.materials) {
        identify(material.id); checkName(material.name); materials.insert(material.id);
        const Vec3 c = material.color;
        require(finite(c) && c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1 && c.z >= 0 && c.z <= 1,
            QStringLiteral("Materials support finite opaque RGB base color in 0..1, not PBR or alpha blending."));
        require(!material.texture || textures.count(material.texture),
            QStringLiteral("Material %1 refers to a missing texture.").arg(material.id));
    }
    std::size_t vertices = 0, expanded = 0, primitives = 0;
    for (const auto &object : state.objects) {
        identify(object.id); checkName(object.name);
        require(!object.group || groups.count(object.group), QStringLiteral("An object refers to a missing group."));
        require(!object.original || originals.count(object.original),
            QStringLiteral("An object refers to a missing imported original."));
        require(finite(object.origin) && std::abs(object.origin.x) <= CoordinateLimit &&
            std::abs(object.origin.y) <= CoordinateLimit && std::abs(object.origin.z) <= CoordinateLimit,
            QStringLiteral("Object origins must be finite and within +/-1,000,000."));
        require(!object.vertices.empty() && !object.faces.empty(),
            QStringLiteral("Objects must contain faces and vertices; delete an empty object instead."));
        require(object.vertices.size() <= MaxVertices - vertices,
            QStringLiteral("Mesh documents support at most 262,144 vertices."));
        vertices += object.vertices.size();
        Id previous = 0;
        for (const auto &v : object.vertices) {
            identify(v.id);
            require(v.id > previous, QStringLiteral("Object vertices must be stored in ascending stable-ID order."));
            previous = v.id;
            const Vec3 p = v.position + object.origin;
            require(finite(v.position) && finite(p) && std::abs(p.x) <= CoordinateLimit &&
                std::abs(p.y) <= CoordinateLimit && std::abs(p.z) <= CoordinateLimit,
                QStringLiteral("Vertex positions must be finite and within +/-1,000,000 in world space."));
        }
        std::set<Id> used;
        std::map<Id, std::set<Id>> vertexFaces;
        std::map<Id, std::size_t> batches;
        require(object.faces.size() <= MaxVertices / 3, QStringLiteral("The face-count budget was exceeded."));
        for (const auto &face : object.faces) {
            identify(face.id);
            require(materials.count(face.material), QStringLiteral("A face refers to a missing material."));
            require(face.corners.size() >= 3 && face.corners.size() <= MaxCornersPerFace,
                QStringLiteral("Faces require 3..32 corners."));
            std::set<Id> corners;
            for (const auto &c : face.corners) {
                vertex(object, c.vertex);
                require(corners.insert(c.vertex).second, QStringLiteral("A face repeats a vertex."));
                used.insert(c.vertex);
                vertexFaces[c.vertex].insert(face.id);
                require(c.normal.has_value() == face.corners[0].normal.has_value(),
                    QStringLiteral("A face must have authored normals on every corner, or flat normals on every corner."));
                require(finite(c.uv) && c.uv.x >= 0 && c.uv.x <= 1 && c.uv.y >= 0 && c.uv.y <= 1,
                    QStringLiteral("Object '%1', face %2: UV (%3, %4) must be finite in 0..1; the runtime uses nearest/clamp sampling.")
                        .arg(object.name).arg(face.id).arg(c.uv.x, 0, 'g', 17).arg(c.uv.y, 0, 'g', 17));
                if (c.normal) require(finite(*c.normal) && std::abs(length(*c.normal) - 1) <= 1e-5,
                    QStringLiteral("Authored corner normals must be finite unit vectors."));
            }
            polygon(object, face);
            polygon(object, face, true);
            const std::size_t count = (face.corners.size() - 2) * 3;
            require(count <= MaxVertices - expanded,
                QStringLiteral("Triangulation exceeds the native limit of 262,144 expanded vertices."));
            expanded += count;
            batches[face.material] += count;
        }
        require(used.size() == object.vertices.size(),
            QStringLiteral("Loose vertices are unsupported; every vertex must belong to a face."));
        std::map<Id, std::map<Id, std::vector<Id>>> fans;
        std::map<Id, unsigned> boundaryEdges;
        for (const auto &[edge, incident] : adjacency(object)) {
            require(incident.size() <= 2,
                QStringLiteral("Non-manifold topology is unsupported: more than two faces share an edge."));
            for (const Id v : {edge.a, edge.b}) {
                if (incident.size() == 1) ++boundaryEdges[v];
                else {
                    fans[v][incident[0].face].push_back(incident[1].face);
                    fans[v][incident[1].face].push_back(incident[0].face);
                }
            }
        }
        for (const auto &[v, incident] : vertexFaces) {
            require(boundaryEdges[v] == 0 || boundaryEdges[v] == 2,
                QStringLiteral("Non-manifold vertex: its boundary branches instead of forming one surface."));
            std::set<Id> connected;
            std::queue<Id> pending;
            pending.push(*incident.begin());
            while (!pending.empty()) {
                const Id face = pending.front(); pending.pop();
                if (!connected.insert(face).second) continue;
                for (const Id adjacent : fans[v][face]) pending.push(adjacent);
            }
            require(connected.size() == incident.size(),
                QStringLiteral("Non-manifold vertex: disconnected face fans touch at one vertex."));
        }
        for (const auto &[material, count] : batches) {
            (void)material;
            primitives += (count + 65534) / 65535;
        }
    }
    require(primitives <= 128,
        QStringLiteral("Object/material batches exceed the runtime limit of 128 triangle primitives."));
    std::size_t originalBytes = 0;
    for (const auto &original : state.originals) {
        identify(original.id); checkName(original.name);
        require(!original.glb.isEmpty() && static_cast<std::size_t>(original.glb.size()) <= MaxOriginalBytes - originalBytes,
            QStringLiteral("Retained GLB originals exceed the combined 16 MiB budget."));
        originalBytes += static_cast<std::size_t>(original.glb.size());
        checkNativeGlb(original.glb);
    }
}

void checkSelection(const State &state, const Selection &selection)
{
    require(selection.mode == SelectionMode::Object || selection.mode == SelectionMode::Vertex ||
        selection.mode == SelectionMode::Edge || selection.mode == SelectionMode::Face,
        QStringLiteral("Unknown mesh selection mode."));
    std::set<Id> unique;
    for (const Id id : selection.ids)
        require(unique.insert(id).second, QStringLiteral("A selection cannot repeat IDs."));
    if (selection.mode == SelectionMode::Object) {
        require(!selection.object && selection.edges.empty(),
            QStringLiteral("Object selections cannot contain a component target or edges."));
        for (const Id id : selection.ids) find(state.objects, id, QStringLiteral("Object"));
        return;
    }
    if (!selection.object) {
        require(selection.ids.empty() && selection.edges.empty(),
            QStringLiteral("A component selection requires an object."));
        return;
    }
    const Object &object = find(state.objects, selection.object, QStringLiteral("Object"));
    if (selection.mode == SelectionMode::Edge) {
        require(selection.ids.empty(), QStringLiteral("Edge selections use vertex pairs, not face or vertex IDs."));
        const auto edges = adjacency(object);
        std::set<Edge> uniqueEdges;
        for (const auto &edge : selection.edges)
            require(edge.a < edge.b && edges.count(edge) && uniqueEdges.insert(edge).second,
                QStringLiteral("Selected edges must exist and use unique ascending vertex-ID pairs."));
    } else {
        require(selection.edges.empty(), QStringLiteral("Only Edge mode accepts edge pairs."));
        for (const Id id : selection.ids) {
            if (selection.mode == SelectionMode::Vertex) vertex(object, id);
            else find(object.faces, id, QStringLiteral("Face"));
        }
    }
}

std::size_t footprint(const State &state)
{
    std::size_t bytes = sizeof(State);
    for (const auto &group : state.groups) bytes += sizeof(Group) + static_cast<std::size_t>(group.name.size()) * 2;
    for (const auto &texture : state.textures)
        bytes += sizeof(Texture) + static_cast<std::size_t>(texture.name.size()) * 2 +
            static_cast<std::size_t>(texture.png.size());
    for (const auto &material : state.materials)
        bytes += sizeof(Material) + static_cast<std::size_t>(material.name.size()) * 2;
    for (const auto &original : state.originals)
        bytes += sizeof(Original) + static_cast<std::size_t>(original.name.size()) * 2 +
            static_cast<std::size_t>(original.glb.size());
    for (const auto &object : state.objects) {
        bytes += sizeof(Object) + static_cast<std::size_t>(object.name.size()) * 2 +
            object.vertices.size() * sizeof(Vertex);
        for (const auto &face : object.faces) bytes += sizeof(Face) + face.corners.size() * sizeof(Corner);
    }
    return bytes;
}

static void extend(std::optional<Bounds> &bounds, Vec3 point)
{
    if (!bounds) bounds = Bounds{point, point};
    else {
        bounds->minimum = {std::min(bounds->minimum.x, point.x), std::min(bounds->minimum.y, point.y),
            std::min(bounds->minimum.z, point.z)};
        bounds->maximum = {std::max(bounds->maximum.x, point.x), std::max(bounds->maximum.y, point.y),
            std::max(bounds->maximum.z, point.z)};
    }
}

} // namespace nova::mesh::detail

namespace nova::mesh {
using namespace detail;

bool validate(const State &state, QString &error)
{
    return checked(error, [&] { checkState(state); });
}

bool validateSelection(const State &state, const Selection &selection, QString &error)
{
    return checked(error, [&] { checkSelection(state, selection); });
}

bool selectionStatistics(const State &state, const Selection &selection, Statistics &output, QString &error)
{
    return checked(error, [&] {
        checkSelection(state, selection);
        Statistics result;
        for (const auto &object : state.objects) {
            const auto vertices = selectedVertices(state, selection, object.id);
            if (vertices.empty()) continue;
            ++result.objects;
            result.vertices += vertices.size();
            for (const Id id : vertices) extend(result.bounds, vertex(object, id).position + object.origin);
            if (selection.mode == SelectionMode::Vertex) continue;
            if (selection.mode == SelectionMode::Edge) { result.edges += selection.edges.size(); continue; }
            std::set<Edge> edges;
            for (const auto &face : object.faces) {
                if (selection.mode == SelectionMode::Face &&
                    std::find(selection.ids.begin(), selection.ids.end(), face.id) == selection.ids.end()) continue;
                ++result.faces;
                result.triangles += face.corners.size() - 2;
                for (std::size_t i = 0; i < face.corners.size(); ++i)
                    edges.insert(Edge::between(face.corners[i].vertex, face.corners[(i + 1) % face.corners.size()].vertex));
            }
            result.edges += edges.size();
        }
        output = std::move(result);
    });
}

bool preview(const State &state, Preview &output, QString &error)
{
    return checked(error, [&] {
        checkState(state);
        Preview result;
        result.statistics.objects = state.objects.size();
        for (const auto &object : state.objects) {
            result.statistics.vertices += object.vertices.size();
            result.statistics.faces += object.faces.size();
            result.statistics.edges += adjacency(object).size();
            for (const auto &face : object.faces) {
                const Polygon shape = polygon(object, face, true);
                for (const auto &indices : shape.triangles) {
                    Triangle triangle;
                    triangle.object = object.id; triangle.face = face.id; triangle.material = face.material;
                    for (std::size_t k = 0; k < 3; ++k) {
                        const auto i = indices[k];
                        triangle.vertices[k] = face.corners[i].vertex;
                        triangle.positions[k] = shape.points[i];
                        triangle.normals[k] = face.corners[i].normal.value_or(shape.normal);
                        triangle.uvs[k] = face.corners[i].uv;
                        extend(result.statistics.bounds, shape.points[i]);
                    }
                    result.triangles.push_back(triangle);
                }
            }
        }
        result.statistics.triangles = result.triangles.size();
        output = std::move(result);
    });
}

} // namespace nova::mesh
