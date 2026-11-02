#include "internal.hpp"

#include <QCryptographicHash>

#include <tuple>

namespace nova::mesh {
using namespace detail;

static QByteArray hash(const QByteArray &bytes) { return QCryptographicHash::hash(bytes, QCryptographicHash::Sha256); }

Document::Document() : state_(std::make_shared<const State>())
{
    sourceHash_ = savedHash_ = hash(sourceBytes(*state_));
}

std::unique_ptr<Document> Document::fromState(const State &state, QString &error)
{
    std::unique_ptr<Document> result;
    checked(error, [&] {
        State owned = state;
        ownData(owned);
        checkState(owned);
        auto candidate = std::make_unique<Document>();
        candidate->state_ = std::make_shared<const State>(std::move(owned));
        candidate->nextId_ = candidate->state_->nextId;
        candidate->sourceHash_ = candidate->savedHash_ = hash(sourceBytes(*candidate->state_));
        result = std::move(candidate);
    });
    return result;
}

std::unique_ptr<Document> Document::open(const QByteArray &source, QString &error)
{
    State candidate;
    if (!parseSource(source, candidate, error)) return nullptr;
    return fromState(candidate, error);
}

QString Document::undoText() const { return undo_.empty() ? QString{} : undo_.back().label; }
QString Document::redoText() const { return redo_.empty() ? QString{} : redo_.back().label; }

bool Document::select(const Selection &selection, QString &error)
{
    return checked(error, [&] {
        checkSelection(*state_, selection);
        Selection copy = selection;
        selection_ = std::move(copy);
    });
}

bool Document::commit(State candidate, Selection selection, std::uint64_t expectedRevision,
    const QString &label, QString &error)
{
    return checked(error, [&] {
        require(expectedRevision == revision_, QStringLiteral("This mesh result is stale; the document changed while it was prepared."));
        require(revision_ != std::numeric_limits<std::uint64_t>::max(), QStringLiteral("The document revision counter is exhausted."));
        checkName(label);
        ownData(candidate);
        candidate.nextId = std::max(candidate.nextId, nextId_);
        for (const auto &original : state_->originals) {
            const auto &retained = find(candidate.originals, original.id, QStringLiteral("Retained original"));
            require(retained.glb == original.glb && retained.name == original.name,
                QStringLiteral("Imported originals are immutable and cannot be replaced or removed by an edit."));
        }
        checkState(candidate);
        checkSelection(candidate, selection);
        const QByteArray digest = hash(sourceBytes(candidate));
        if (digest == sourceHash_) {
            selection_ = std::move(selection);
            return;
        }
        const auto published = std::make_shared<const State>(std::move(candidate));
        const std::size_t cost = footprint(*state_) + footprint(*published);
        require(cost <= MaxUndoBytes,
            QStringLiteral("This edit exceeds the 128 MiB undo budget; it was not applied."));
        std::deque<History> history = undo_;
        std::size_t bytes = 0;
        for (const auto &entry : history) bytes += entry.bytes;
        while (!history.empty() && (history.size() >= MaxUndoCommands || bytes > MaxUndoBytes - cost)) {
            bytes -= history.front().bytes;
            history.pop_front();
        }
        history.push_back({QString(label.constData(), label.size()), state_, published, selection_, selection, cost});
        require(expectedRevision == revision_, QStringLiteral("This mesh result is stale."));
        undo_.swap(history);
        redo_.clear();
        historyBytes_ = bytes + cost;
        state_ = published;
        selection_ = std::move(selection);
        sourceHash_ = digest;
        nextId_ = state_->nextId;
        ++revision_;
    });
}

bool Document::edit(const QString &label, const std::function<void(State &, Selection &)> &operation, QString &error)
{
    return checked(error, [&] {
        const auto expected = revision_;
        State candidate = *state_;
        Selection selection = selection_;
        operation(candidate, selection);
        require(commit(std::move(candidate), std::move(selection), expected, label, error), error);
    });
}

bool Document::restore(bool forward, QString &error)
{
    return checked(error, [&] {
        const auto &source = forward ? redo_ : undo_;
        require(!source.empty(), forward ? QStringLiteral("There is no mesh edit to redo.") : QStringLiteral("There is no mesh edit to undo."));
        require(revision_ != std::numeric_limits<std::uint64_t>::max(), QStringLiteral("The document revision counter is exhausted."));
        const History entry = source.back();
        State candidate = *(forward ? entry.after : entry.before);
        candidate.nextId = nextId_;
        for (const auto &original : state_->originals) {
            const auto found = std::find_if(candidate.originals.begin(), candidate.originals.end(),
                [&](const Original &value) { return value.id == original.id; });
            if (found == candidate.originals.end()) candidate.originals.push_back(original);
        }
        Selection selection = forward ? entry.afterSelection : entry.beforeSelection;
        checkState(candidate);
        checkSelection(candidate, selection);
        const QByteArray digest = hash(sourceBytes(candidate));
        auto published = std::make_shared<const State>(std::move(candidate));
        auto undo = undo_, redo = redo_;
        if (forward) { redo.pop_back(); undo.push_back(entry); }
        else { undo.pop_back(); redo.push_back(entry); }
        undo_.swap(undo); redo_.swap(redo);
        state_ = std::move(published);
        selection_ = std::move(selection);
        sourceHash_ = digest;
        ++revision_;
    });
}

bool Document::undo(QString &error) { return restore(false, error); }
bool Document::redo(QString &error) { return restore(true, error); }

std::shared_ptr<const ByteSnapshot> Document::snapshot(bool includeGlb, QString &error) const
{
    std::shared_ptr<const ByteSnapshot> result;
    checked(error, [&] {
        const QByteArray source = sourceBytes(*state_);
        QByteArray glb;
        if (includeGlb) writeGlb(*state_, glb);
        result = std::make_shared<const ByteSnapshot>(ByteSnapshot{identity_, revision_, source, hash(source), glb});
    });
    return result;
}

bool Document::markPersisted(const ByteSnapshot &snapshot, QString &error)
{
    return checked(error, [&] {
        require(snapshot.document == identity_, QStringLiteral("This save snapshot belongs to another mesh document."));
        require(snapshot.revision == revision_ && snapshot.sourceSha256 == sourceHash_ &&
            hash(snapshot.source) == sourceHash_,
            QStringLiteral("An older mesh snapshot was saved; newer edits remain unsaved."));
        savedHash_ = snapshot.sourceSha256;
    });
}

bool Document::addPrimitive(Primitive primitive, const QString &name, unsigned sides, Id &object, QString &error)
{
    Id created = 0;
    const bool ok = edit(QStringLiteral("Add mesh object"), [&](State &state, Selection &selection) {
        makePrimitive(state, selection, primitive, name, sides, created);
    }, error);
    if (ok) object = created;
    return ok;
}

static Object duplicateObject(State &state, const Object &original, Vec3 offset)
{
    Object result = original;
    result.id = allocate(state);
    result.name += QStringLiteral(" copy");
    result.origin = result.origin + offset;
    std::map<Id, Id> vertices;
    for (auto &v : result.vertices) {
        const Id old = v.id;
        v.id = allocate(state);
        vertices[old] = v.id;
    }
    for (auto &face : result.faces) {
        face.id = allocate(state);
        for (auto &c : face.corners) c.vertex = vertices.at(c.vertex);
    }
    return result;
}

bool Document::import(const QByteArray &glb, const QString &name, QString &error)
{
    return edit(QStringLiteral("Import mesh"), [&](State &state, Selection &selection) {
        State imported;
        require(importGlb(glb, name, imported, error), error);
        const auto existing = std::find_if(state.originals.begin(), state.originals.end(),
            [&](const Original &original) { return original.glb == glb; });
        const Id original = existing != state.originals.end() ? existing->id : allocate(state);
        if (existing == state.originals.end()) state.originals.push_back({original, name, glb});
        std::map<Id, Id> textures, materials;
        for (const auto &texture : imported.textures) {
            const auto sameBytes = std::find_if(state.textures.begin(), state.textures.end(),
                [&](const Texture &value) { return value.png == texture.png; });
            if (sameBytes != state.textures.end()) textures[texture.id] = sameBytes->id;
            else {
                Texture copy = texture;
                copy.id = allocate(state);
                textures[texture.id] = copy.id;
                state.textures.push_back(std::move(copy));
            }
        }
        for (const auto &material : imported.materials) {
            Material copy = material;
            copy.id = allocate(state);
            if (copy.texture) copy.texture = textures.at(copy.texture);
            materials[material.id] = copy.id;
            state.materials.push_back(std::move(copy));
        }
        selection = {};
        for (const auto &object : imported.objects) {
            Object copy = duplicateObject(state, object, {});
            copy.name = object.name;
            copy.original = original;
            for (auto &face : copy.faces) face.material = materials.at(face.material);
            selection.ids.push_back(copy.id);
            state.objects.push_back(std::move(copy));
        }
    }, error);
}

bool Document::rename(Id id, const QString &name, QString &error)
{
    return edit(QStringLiteral("Rename mesh item"), [&](State &state, Selection &) {
        checkName(name);
        auto renameIn = [&](auto &values) {
            for (auto &value : values) if (value.id == id) { value.name = name; return true; }
            return false;
        };
        require(renameIn(state.objects) || renameIn(state.groups) || renameIn(state.materials) || renameIn(state.textures),
            QStringLiteral("This ID has no editable name; imported originals cannot be renamed."));
    }, error);
}

static Vec3 rotate(Vec3 p, Vec3 degrees)
{
    constexpr double radians = 3.14159265358979323846 / 180;
    const Vec3 a = degrees * radians;
    p = {p.x, p.y * std::cos(a.x) - p.z * std::sin(a.x), p.y * std::sin(a.x) + p.z * std::cos(a.x)};
    p = {p.x * std::cos(a.y) + p.z * std::sin(a.y), p.y, -p.x * std::sin(a.y) + p.z * std::cos(a.y)};
    return {p.x * std::cos(a.z) - p.y * std::sin(a.z), p.x * std::sin(a.z) + p.y * std::cos(a.z), p.z};
}

bool Document::transform(const Transform &t, QString &error)
{
    return edit(QStringLiteral("Transform selection"), [&](State &state, Selection &selection) {
        require(finite(t.translation) && finite(t.rotationDegrees) && finite(t.scale) && finite(t.pivot),
            QStringLiteral("Transform values must be finite."));
        require(t.scale.x > 1e-8 && t.scale.y > 1e-8 && t.scale.z > 1e-8 &&
            t.scale.x <= 1e8 && t.scale.y <= 1e8 && t.scale.z <= 1e8,
            QStringLiteral("Scale must be positive in (0.00000001, 100000000]; use Mirror for reflections."));
        require(std::abs(t.rotationDegrees.x) <= 360000 && std::abs(t.rotationDegrees.y) <= 360000 &&
            std::abs(t.rotationDegrees.z) <= 360000, QStringLiteral("Rotation must be within +/-360,000 degrees."));
        auto point = [&](Vec3 p) {
            p = p - t.pivot;
            return t.pivot + rotate({p.x * t.scale.x, p.y * t.scale.y, p.z * t.scale.z}, t.rotationDegrees) + t.translation;
        };
        bool any = false;
        for (auto &object : state.objects) {
            const auto selected = selectedVertices(state, selection, object.id);
            if (selected.empty()) continue;
            any = true;
            const Vec3 oldOrigin = object.origin;
            if (selection.mode == SelectionMode::Object) object.origin = point(oldOrigin);
            for (auto &v : object.vertices)
                if (selected.count(v.id)) v.position = point(v.position + oldOrigin) - object.origin;
            for (auto &face : object.faces) {
                std::size_t count = 0;
                for (const auto &c : face.corners) count += selected.count(c.vertex);
                if (!count) continue;
                if (count != face.corners.size()) clearNormals(face);
                else for (auto &c : face.corners) if (c.normal) {
                    const Vec3 n = *c.normal;
                    c.normal = unit(rotate({n.x / t.scale.x, n.y / t.scale.y, n.z / t.scale.z}, t.rotationDegrees));
                }
            }
        }
        require(any, QStringLiteral("Select geometry before applying a transform."));
    }, error);
}

bool Document::snap(double increment, QString &error)
{
    return edit(QStringLiteral("Snap selection"), [&](State &state, Selection &selection) {
        require(std::isfinite(increment) && increment >= 0.000001 && increment <= CoordinateLimit,
            QStringLiteral("Snap increment must be in 0.000001..1,000,000 world units."));
        auto snapped = [&](Vec3 p) {
            return Vec3{std::round(p.x / increment) * increment, std::round(p.y / increment) * increment,
                std::round(p.z / increment) * increment};
        };
        bool any = false;
        for (auto &object : state.objects) {
            const auto selected = selectedVertices(state, selection, object.id);
            if (selected.empty()) continue;
            any = true;
            if (selection.mode == SelectionMode::Object) object.origin = snapped(object.origin);
            else {
                for (auto &v : object.vertices)
                    if (selected.count(v.id)) v.position = snapped(v.position + object.origin) - object.origin;
                for (auto &face : object.faces)
                    if (std::any_of(face.corners.begin(), face.corners.end(),
                        [&](const Corner &c) { return selected.count(c.vertex); })) clearNormals(face);
            }
        }
        require(any, QStringLiteral("Select geometry before snapping."));
    }, error);
}

bool Document::duplicate(Vec3 offset, QString &error)
{
    return edit(QStringLiteral("Duplicate objects"), [&](State &state, Selection &selection) {
        require(finite(offset), QStringLiteral("Duplicate offset must be finite."));
        const auto objects = selectedObjects(state, selection);
        require(objects.size() <= MaxObjects - state.objects.size(), QStringLiteral("Duplication exceeds the 128-object limit."));
        selection.ids.clear();
        for (const Id id : objects) {
            Object copy = duplicateObject(state, find(state.objects, id, QStringLiteral("Object")), offset);
            selection.ids.push_back(copy.id);
            state.objects.push_back(std::move(copy));
        }
    }, error);
}

bool Document::group(const QString &name, QString &error)
{
    return edit(QStringLiteral("Group objects"), [&](State &state, Selection &selection) {
        const auto objects = selectedObjects(state, selection);
        checkName(name);
        require(state.groups.size() < MaxGroups, QStringLiteral("The 128-group budget is full."));
        const Id group = allocate(state);
        state.groups.push_back({group, name});
        for (const Id id : objects) find(state.objects, id, QStringLiteral("Object")).group = group;
    }, error);
}

bool Document::ungroup(QString &error)
{
    return edit(QStringLiteral("Ungroup objects"), [&](State &state, Selection &selection) {
        for (const Id id : selectedObjects(state, selection)) find(state.objects, id, QStringLiteral("Object")).group = 0;
    }, error);
}

static void origin(Object &object, Vec3 point)
{
    require(finite(point), QStringLiteral("Origin position must be finite."));
    const Vec3 delta = object.origin - point;
    for (auto &v : object.vertices) v.position = v.position + delta;
    object.origin = point;
}

bool Document::setOrigin(Vec3 worldPosition, QString &error)
{
    return edit(QStringLiteral("Set object origins"), [&](State &state, Selection &selection) {
        for (const Id id : selectedObjects(state, selection)) origin(find(state.objects, id, QStringLiteral("Object")), worldPosition);
    }, error);
}

bool Document::placeOrigin(OriginPlacement placement, QString &error)
{
    return edit(QStringLiteral("Place object origins"), [&](State &state, Selection &selection) {
        require(placement == OriginPlacement::Center || placement == OriginPlacement::GroundCenter,
            QStringLiteral("Unknown origin placement."));
        for (const Id id : selectedObjects(state, selection)) {
            Statistics stats;
            require(selectionStatistics(state, {SelectionMode::Object, 0, {id}, {}}, stats, error), error);
            require(stats.bounds.has_value(), QStringLiteral("The selected object has no bounds."));
            Vec3 point = (stats.bounds->minimum + stats.bounds->maximum) * 0.5;
            if (placement == OriginPlacement::GroundCenter) point.y = stats.bounds->minimum.y;
            origin(find(state.objects, id, QStringLiteral("Object")), point);
        }
    }, error);
}

bool Document::removeSelection(QString &error)
{
    return edit(QStringLiteral("Delete selection"), [&](State &state, Selection &selection) {
        require(!selection.ids.empty() || !selection.edges.empty(), QStringLiteral("Select something to delete."));
        const std::set<Id> ids(selection.ids.begin(), selection.ids.end());
        if (selection.mode == SelectionMode::Object)
            state.objects.erase(std::remove_if(state.objects.begin(), state.objects.end(),
                [&](const Object &object) { return ids.count(object.id); }), state.objects.end());
        else {
            Object &object = find(state.objects, selection.object, QStringLiteral("Object"));
            std::set<Id> faces;
            if (selection.mode == SelectionMode::Face) faces = ids;
            else if (selection.mode == SelectionMode::Edge) {
                const auto edges = adjacency(object);
                for (const auto &edge : selection.edges)
                    for (const auto &incident : edges.at(edge)) faces.insert(incident.face);
            } else for (const auto &face : object.faces)
                if (std::any_of(face.corners.begin(), face.corners.end(),
                    [&](const Corner &c) { return ids.count(c.vertex); })) faces.insert(face.id);
            object.faces.erase(std::remove_if(object.faces.begin(), object.faces.end(),
                [&](const Face &face) { return faces.count(face.id); }), object.faces.end());
            clean(object);
            state.objects.erase(std::remove_if(state.objects.begin(), state.objects.end(),
                [](const Object &value) { return value.faces.empty(); }), state.objects.end());
        }
        selection = {};
    }, error);
}

bool Document::mirror(Axis axis, double plane, bool makeCopy, QString &error)
{
    return edit(makeCopy ? QStringLiteral("Mirror duplicate") : QStringLiteral("Mirror objects"),
        [&](State &state, Selection &selection) {
        require(std::isfinite(plane) && std::abs(plane) <= CoordinateLimit,
            QStringLiteral("Mirror plane must be finite and within +/-1,000,000."));
        component({}, axis);
        auto objects = selectedObjects(state, selection);
        if (makeCopy) {
            require(objects.size() <= MaxObjects - state.objects.size(), QStringLiteral("Mirroring exceeds the object budget."));
            std::vector<Id> copies;
            for (const Id id : objects) {
                Object copy = duplicateObject(state, find(state.objects, id, QStringLiteral("Object")), {});
                copies.push_back(copy.id);
                state.objects.push_back(std::move(copy));
            }
            objects = std::move(copies);
            selection.ids = objects;
        }
        Vec3 offset{};
        if (axis == Axis::X) offset.x = plane * 2;
        else if (axis == Axis::Y) offset.y = plane * 2;
        else offset.z = plane * 2;
        for (const Id id : objects) {
            Object &object = find(state.objects, id, QStringLiteral("Object"));
            object.origin = reflected(object.origin, axis) + offset;
            for (auto &v : object.vertices) v.position = reflected(v.position, axis);
            for (auto &face : object.faces) {
                // Reflection changes handedness. Reverse winding, but transform
                // normals as vectors rather than negating them a second time.
                std::reverse(face.corners.begin(), face.corners.end());
                for (auto &c : face.corners) if (c.normal) c.normal = reflected(*c.normal, axis);
            }
        }
    }, error);
}

bool Document::extrude(double distance, QString &error)
{
    return edit(QStringLiteral("Extrude face region"),
        [&](State &state, Selection &selection) { extrudeFaces(state, selection, distance); }, error);
}
bool Document::inset(double distance, QString &error)
{
    return edit(QStringLiteral("Inset face"),
        [&](State &state, Selection &selection) { insetFace(state, selection, distance); }, error);
}
bool Document::bevelEdge(double depth, QString &error)
{
    return edit(QStringLiteral("Bevel edge"),
        [&](State &state, Selection &selection) { bevel(state, selection, depth); }, error);
}
bool Document::subdivide(QString &error)
{
    return edit(QStringLiteral("Subdivide faces"),
        [&](State &state, Selection &selection) { subdivideFaces(state, selection); }, error);
}

bool Document::splitFace(Id firstVertex, Id secondVertex, QString &error)
{
    return edit(QStringLiteral("Cut face"), [&](State &state, Selection &selection) {
        require(selection.mode == SelectionMode::Face && selection.ids.size() == 1,
            QStringLiteral("Select exactly one face before cutting between two of its vertices."));
        Object &object = find(state.objects, selection.object, QStringLiteral("Object"));
        const Face face = find(object.faces, selection.ids[0], QStringLiteral("Face"));
        require(polygon(object, face).convex, QStringLiteral("Diagonal cuts currently require a convex face."));
        auto index = [&](Id id) {
            const auto found = std::find_if(face.corners.begin(), face.corners.end(),
                [id](const Corner &c) { return c.vertex == id; });
            require(found != face.corners.end(), QStringLiteral("Both cut endpoints must belong to the selected face."));
            return static_cast<std::size_t>(found - face.corners.begin());
        };
        const auto a = index(firstVertex), b = index(secondVertex), count = face.corners.size();
        require(a != b && (a + 1) % count != b && (b + 1) % count != a,
            QStringLiteral("A diagonal cut needs two different, nonadjacent face vertices."));
        auto path = [&](std::size_t from, std::size_t to) {
            std::vector<Corner> corners;
            for (std::size_t i = from; ; i = (i + 1) % count) {
                corners.push_back(face.corners[i]);
                if (i == to) break;
            }
            return corners;
        };
        find(object.faces, face.id, QStringLiteral("Face")).corners = path(a, b);
        const Id id = allocate(state);
        object.faces.push_back({id, face.material, path(b, a)});
        selection.ids.push_back(id);
    }, error);
}

bool Document::triangulate(QString &error)
{
    return edit(QStringLiteral("Triangulate faces"), [&](State &state, Selection &selection) {
        const auto selected = selectedFaces(state, selection);
        std::map<Id, std::set<Id>> chosen;
        for (const auto &[object, face] : selected) chosen[object].insert(face);
        std::vector<Id> children;
        for (auto &object : state.objects) {
            const auto found = chosen.find(object.id);
            if (found == chosen.end()) continue;
            std::vector<Face> faces;
            for (const auto &face : object.faces) {
                if (!found->second.count(face.id)) { faces.push_back(face); continue; }
                const Polygon shape = polygon(object, face);
                bool first = true;
                for (const auto &triangle : shape.triangles) {
                    const Id id = first ? face.id : allocate(state);
                    first = false;
                    faces.push_back({id, face.material,
                        {face.corners[triangle[0]], face.corners[triangle[1]], face.corners[triangle[2]]}});
                    children.push_back(id);
                }
            }
            object.faces = std::move(faces);
        }
        if (selection.mode == SelectionMode::Face) selection.ids = std::move(children);
    }, error);
}

bool Document::flipFaces(QString &error)
{
    return edit(QStringLiteral("Flip face normals"), [&](State &state, Selection &selection) {
        for (const auto &[object, face] : selectedFaces(state, selection))
            reverse(find(find(state.objects, object, QStringLiteral("Object")).faces, face, QStringLiteral("Face")));
    }, error);
}

bool Document::flatNormals(QString &error)
{
    return edit(QStringLiteral("Recalculate flat normals"), [&](State &state, Selection &selection) {
        for (const auto &[object, face] : selectedFaces(state, selection))
            clearNormals(find(find(state.objects, object, QStringLiteral("Object")).faces, face, QStringLiteral("Face")));
    }, error);
}

bool Document::weldSelectedVertices(QString &error)
{
    return edit(QStringLiteral("Weld coincident vertices"), [&](State &state, Selection &selection) {
        require(selection.mode == SelectionMode::Vertex && selection.ids.size() >= 2,
            QStringLiteral("Select at least two vertices for exact-position welding."));
        Object &object = find(state.objects, selection.object, QStringLiteral("Object"));
        const std::set<Id> chosen(selection.ids.begin(), selection.ids.end());
        std::map<std::tuple<double, double, double>, Id> positions;
        std::map<Id, Id> replacements;
        for (const auto &v : object.vertices) {
            if (!chosen.count(v.id)) continue;
            auto [it, inserted] = positions.emplace(std::make_tuple(v.position.x, v.position.y, v.position.z), v.id);
            if (!inserted) replacements[v.id] = it->second;
        }
        require(!replacements.empty(), QStringLiteral("No selected vertices have exactly matching positions."));
        for (auto &face : object.faces) for (auto &c : face.corners) {
            const auto found = replacements.find(c.vertex);
            if (found != replacements.end()) c.vertex = found->second;
        }
        clean(object);
        selection.ids.clear();
        for (const auto &[position, id] : positions) { (void)position; selection.ids.push_back(id); }
    }, error);
}

bool Document::setFaceUvs(Id id, const std::vector<Vec2> &uvs, QString &error)
{
    return edit(QStringLiteral("Edit corner UVs"), [&](State &state, Selection &) {
        for (auto &object : state.objects) for (auto &face : object.faces) if (face.id == id) {
            require(uvs.size() == face.corners.size(), QStringLiteral("Supply exactly one UV for each face corner."));
            for (std::size_t i = 0; i < uvs.size(); ++i) face.corners[i].uv = uvs[i];
            return;
        }
        throw Failure{QStringLiteral("The UV face no longer exists.")};
    }, error);
}

bool Document::transformUvs(const UvTransform &t, QString &error)
{
    return edit(QStringLiteral("Transform UVs"), [&](State &state, Selection &selection) {
        require(finite(t.translation) && finite(t.scale) && finite(t.pivot) && std::isfinite(t.rotationDegrees) &&
            std::abs(t.rotationDegrees) <= 360000 && std::abs(t.scale.x) > 1e-8 && std::abs(t.scale.y) > 1e-8,
            QStringLiteral("UV transforms require finite values and nonzero scale."));
        const double a = t.rotationDegrees * 3.14159265358979323846 / 180;
        for (const auto &[object, id] : selectedFaces(state, selection)) {
            auto &face = find(find(state.objects, object, QStringLiteral("Object")).faces, id, QStringLiteral("Face"));
            for (auto &c : face.corners) {
                const Vec2 p{(c.uv.x - t.pivot.x) * t.scale.x, (c.uv.y - t.pivot.y) * t.scale.y};
                c.uv = {p.x * std::cos(a) - p.y * std::sin(a) + t.pivot.x + t.translation.x,
                    p.x * std::sin(a) + p.y * std::cos(a) + t.pivot.y + t.translation.y};
                if (std::abs(c.uv.x) < 1e-12) c.uv.x = 0;
                if (std::abs(c.uv.y) < 1e-12) c.uv.y = 0;
                if (std::abs(c.uv.x - 1) < 1e-12) c.uv.x = 1;
                if (std::abs(c.uv.y - 1) < 1e-12) c.uv.y = 1;
            }
        }
    }, error);
}

bool Document::projectUvs(Axis normalAxis, QString &error)
{
    return edit(QStringLiteral("Project UVs"), [&](State &state, Selection &selection) {
        component({}, normalAxis);
        const auto faces = selectedFaces(state, selection);
        auto projected = [&](Vec3 p) {
            return normalAxis == Axis::X ? Vec2{p.z, -p.y} :
                normalAxis == Axis::Y ? Vec2{p.x, -p.z} : Vec2{p.x, -p.y};
        };
        Vec2 minimum{CoordinateLimit, CoordinateLimit}, maximum{-CoordinateLimit, -CoordinateLimit};
        for (const auto &[id, f] : faces) {
            const Object &object = find(state.objects, id, QStringLiteral("Object"));
            for (const auto &c : find(object.faces, f, QStringLiteral("Face")).corners) {
                const Vec2 p = projected(vertex(object, c.vertex).position + object.origin);
                minimum = {std::min(minimum.x, p.x), std::min(minimum.y, p.y)};
                maximum = {std::max(maximum.x, p.x), std::max(maximum.y, p.y)};
            }
        }
        const Vec2 size = maximum - minimum;
        require(size.x > 1e-10 && size.y > 1e-10, QStringLiteral("This projection collapses the selection; choose another axis."));
        for (const auto &[id, f] : faces) {
            Object &object = find(state.objects, id, QStringLiteral("Object"));
            for (auto &c : find(object.faces, f, QStringLiteral("Face")).corners) {
                const Vec2 p = projected(vertex(object, c.vertex).position + object.origin) - minimum;
                c.uv = {p.x / size.x, p.y / size.y};
            }
        }
    }, error);
}

bool Document::unwrapFaces(double padding, QString &error)
{
    return edit(QStringLiteral("Unwrap face islands"), [&](State &state, Selection &selection) {
        require(std::isfinite(padding) && padding >= 0 && padding <= 0.25,
            QStringLiteral("UV island padding must be in 0..0.25 of each grid cell."));
        const auto faces = selectedFaces(state, selection);
        const auto columns = static_cast<std::size_t>(std::ceil(std::sqrt(static_cast<double>(faces.size()))));
        const double size = 1.0 / static_cast<double>(columns);
        for (std::size_t i = 0; i < faces.size(); ++i) {
            const auto [id, f] = faces[i];
            Object &object = find(state.objects, id, QStringLiteral("Object"));
            auto &face = find(object.faces, f, QStringLiteral("Face"));
            planarUvs(object, face, static_cast<double>(i % columns) * size,
                static_cast<double>(i / columns) * size, size, padding);
        }
    }, error);
}

bool Document::addTexture(const QString &name, const QByteArray &png, Id &texture, QString &error)
{
    Id created = 0;
    const bool ok = edit(QStringLiteral("Import texture"), [&](State &state, Selection &) {
        checkName(name);
        for (const auto &existing : state.textures) if (existing.png == png) { created = existing.id; return; }
        require(state.textures.size() < MaxTextures, QStringLiteral("The 16-texture model budget is full."));
        created = allocate(state);
        state.textures.push_back({created, name, png});
    }, error);
    if (ok) texture = created;
    return ok;
}

bool Document::replaceTexture(Id id, const QByteArray &png, QString &error)
{
    return edit(QStringLiteral("Replace texture bytes"), [&](State &state, Selection &) {
        find(state.textures, id, QStringLiteral("Texture")).png = png;
    }, error);
}

bool Document::addMaterial(const QString &name, Vec3 color, Id texture, Id &material, QString &error)
{
    Id created = 0;
    const bool ok = edit(QStringLiteral("Add material"), [&](State &state, Selection &) {
        created = allocate(state);
        state.materials.push_back({created, name, color, texture});
    }, error);
    if (ok) material = created;
    return ok;
}

bool Document::updateMaterial(Id id, Vec3 color, Id texture, QString &error)
{
    return edit(QStringLiteral("Edit material"), [&](State &state, Selection &) {
        auto &material = find(state.materials, id, QStringLiteral("Material"));
        material.color = color; material.texture = texture;
    }, error);
}

bool Document::assignMaterial(Id id, QString &error)
{
    return edit(QStringLiteral("Assign material"), [&](State &state, Selection &selection) {
        find(state.materials, id, QStringLiteral("Material"));
        for (const auto &[object, face] : selectedFaces(state, selection))
            find(find(state.objects, object, QStringLiteral("Object")).faces, face, QStringLiteral("Face")).material = id;
    }, error);
}

bool Document::removeMaterial(Id id, QString &error)
{
    return edit(QStringLiteral("Delete material"), [&](State &state, Selection &) {
        find(state.materials, id, QStringLiteral("Material"));
        for (const auto &object : state.objects) for (const auto &face : object.faces)
            require(face.material != id, QStringLiteral("Reassign all faces using this material before deleting it."));
        state.materials.erase(std::remove_if(state.materials.begin(), state.materials.end(),
            [id](const Material &value) { return value.id == id; }), state.materials.end());
    }, error);
}

bool Document::removeTexture(Id id, QString &error)
{
    return edit(QStringLiteral("Delete texture"), [&](State &state, Selection &) {
        find(state.textures, id, QStringLiteral("Texture"));
        for (const auto &material : state.materials)
            require(material.texture != id, QStringLiteral("Remove this texture from its materials before deleting it."));
        state.textures.erase(std::remove_if(state.textures.begin(), state.textures.end(),
            [id](const Texture &value) { return value.id == id; }), state.textures.end());
    }, error);
}

} // namespace nova::mesh
