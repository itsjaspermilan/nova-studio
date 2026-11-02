#ifndef NOVA_MESH_DOCUMENT_HPP
#define NOVA_MESH_DOCUMENT_HPP

#include <QByteArray>
#include <QString>
#include <QUuid>

#include <array>
#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <optional>
#include <vector>

namespace nova::mesh {

using Id = std::uint32_t;
constexpr std::size_t MaxObjects = 128;
constexpr std::size_t MaxGroups = 128;
constexpr std::size_t MaxMaterials = 256;
constexpr std::size_t MaxTextures = 16;
constexpr std::size_t MaxVertices = 262144;
constexpr std::size_t MaxCornersPerFace = 32;
constexpr std::size_t MaxOriginals = 8;
constexpr std::size_t MaxOriginalBytes = 16 * 1024 * 1024;
constexpr std::size_t MaxSourceBytes = 64 * 1024 * 1024;
constexpr std::size_t MaxGlbBytes = 16 * 1024 * 1024;
constexpr std::size_t MaxUndoCommands = 64;
constexpr std::size_t MaxUndoBytes = 128 * 1024 * 1024;
constexpr double CoordinateLimit = 1000000.0;

struct Vec2 {
    double x = 0, y = 0;
};
struct Vec3 {
    double x = 0, y = 0, z = 0;
};
struct Vertex {
    Id id = 0;
    Vec3 position;
};
struct Corner {
    Id vertex = 0;
    Vec2 uv;
    // A face has either authored normals on every corner, or flat normals.
    std::optional<Vec3> normal;
};
struct Face {
    Id id = 0;
    Id material = 0;
    std::vector<Corner> corners;
};
struct Object {
    Id id = 0;
    QString name;
    Id group = 0;
    Vec3 origin;
    // Kept in ascending stable-ID order, including across topology edits.
    std::vector<Vertex> vertices;
    std::vector<Face> faces;
    Id original = 0;
};
struct Group {
    Id id = 0;
    QString name;
};
struct Texture {
    Id id = 0;
    QString name;
    QByteArray png;
};
struct Material {
    Id id = 0;
    QString name;
    Vec3 color{1, 1, 1};
    Id texture = 0;
};
struct Original {
    Id id = 0;
    QString name;
    QByteArray glb;
};
struct State {
    Id nextId = 1;
    std::vector<Group> groups;
    std::vector<Texture> textures;
    std::vector<Material> materials;
    std::vector<Object> objects;
    std::vector<Original> originals;
};

struct Edge {
    Id a = 0, b = 0;
    static Edge between(Id a, Id b);
    bool operator<(const Edge &other) const;
    bool operator==(const Edge &other) const;
};
enum class SelectionMode { Object, Vertex, Edge, Face };
struct Selection {
    SelectionMode mode = SelectionMode::Object;
    Id object = 0;
    // Object mode uses object IDs. Component modes belong to one object.
    std::vector<Id> ids;
    std::vector<Edge> edges;
};
struct Bounds {
    Vec3 minimum, maximum;
};
struct Statistics {
    std::size_t objects = 0, vertices = 0, edges = 0, faces = 0, triangles = 0;
    std::optional<Bounds> bounds;
};
struct Triangle {
    Id object = 0, face = 0, material = 0;
    std::array<Id, 3> vertices{};
    std::array<Vec3, 3> positions{}, normals{};
    std::array<Vec2, 3> uvs{};
};
struct Preview {
    std::vector<Triangle> triangles;
    Statistics statistics;
};

enum class Primitive { Box, Plane, Pyramid, Cylinder, Sphere };
enum class Axis { X, Y, Z };
enum class OriginPlacement { Center, GroundCenter };
struct Transform {
    Vec3 translation;
    Vec3 rotationDegrees;
    Vec3 scale{1, 1, 1};
    Vec3 pivot;
};
struct UvTransform {
    Vec2 translation;
    Vec2 scale{1, 1};
    Vec2 pivot{0.5, 0.5};
    double rotationDegrees = 0;
};

// These functions never read or write files, create a window, or upload GPU data.
// On failure, output parameters are unchanged and error contains a diagnostic.
bool validate(const State &state, QString &error);
bool validateSelection(const State &state, const Selection &selection, QString &error);
bool serializeSource(const State &state, QByteArray &bytes, QString &error);
bool parseSource(const QByteArray &bytes, State &state, QString &error);
bool importGlb(const QByteArray &bytes, const QString &name, State &state, QString &error);
bool exportGlb(const State &state, QByteArray &bytes, QString &error);
bool preview(const State &state, Preview &preview, QString &error);
bool selectionStatistics(const State &state, const Selection &selection,
    Statistics &statistics, QString &error);

struct ByteSnapshot {
    const QUuid document;
    const std::uint64_t revision;
    const QByteArray source;
    const QByteArray sourceSha256;
    const QByteArray glb;
};

class Document {
public:
    Document();
    Document(const Document &) = delete;
    Document &operator=(const Document &) = delete;

    static std::unique_ptr<Document> open(const QByteArray &source, QString &error);
    static std::unique_ptr<Document> fromState(const State &state, QString &error);

    std::shared_ptr<const State> state() const { return state_; }
    const Selection &selection() const { return selection_; }
    std::uint64_t revision() const { return revision_; }
    bool dirty() const { return sourceHash_ != savedHash_; }
    bool canUndo() const { return !undo_.empty(); }
    bool canRedo() const { return !redo_.empty(); }
    QString undoText() const;
    QString redoText() const;
    std::size_t historyBytes() const { return historyBytes_; }

    bool select(const Selection &selection, QString &error);
    bool undo(QString &error);
    bool redo(QString &error);
    std::shared_ptr<const ByteSnapshot> snapshot(bool includeGlb, QString &error) const;
    bool markPersisted(const ByteSnapshot &snapshot, QString &error);

    // Host gestures can prepare a candidate in a temporary Document, then adopt
    // it once. The revision is checked before work and again before publication.
    bool commit(State candidate, Selection selection, std::uint64_t expectedRevision,
        const QString &label, QString &error);

    bool addPrimitive(Primitive primitive, const QString &name, unsigned sides,
        Id &object, QString &error);
    bool import(const QByteArray &glb, const QString &name, QString &error);
    bool rename(Id id, const QString &name, QString &error);
    bool transform(const Transform &transform, QString &error);
    bool snap(double increment, QString &error);
    bool duplicate(Vec3 offset, QString &error);
    bool group(const QString &name, QString &error);
    bool ungroup(QString &error);
    bool setOrigin(Vec3 worldPosition, QString &error);
    bool placeOrigin(OriginPlacement placement, QString &error);
    bool removeSelection(QString &error);
    bool mirror(Axis axis, double plane, bool duplicate, QString &error);

    bool extrude(double distance, QString &error);
    bool inset(double distance, QString &error);
    // One edge of a closed, consistently oriented convex solid. Depth is the
    // perpendicular distance of the new chamfer plane from the selected edge.
    bool bevelEdge(double depth, QString &error);
    bool splitFace(Id firstVertex, Id secondVertex, QString &error);
    bool subdivide(QString &error);
    bool triangulate(QString &error);
    bool flipFaces(QString &error);
    bool flatNormals(QString &error);
    // Exact-position weld only; UVs/normals remain per corner. Invalid topology
    // is rejected. Imported vertices are never welded implicitly.
    bool weldSelectedVertices(QString &error);

    bool setFaceUvs(Id face, const std::vector<Vec2> &uvs, QString &error);
    bool transformUvs(const UvTransform &transform, QString &error);
    bool projectUvs(Axis normalAxis, QString &error);
    bool unwrapFaces(double padding, QString &error);
    bool addTexture(const QString &name, const QByteArray &png, Id &texture, QString &error);
    bool replaceTexture(Id texture, const QByteArray &png, QString &error);
    bool addMaterial(const QString &name, Vec3 color, Id texture, Id &material, QString &error);
    bool updateMaterial(Id material, Vec3 color, Id texture, QString &error);
    bool assignMaterial(Id material, QString &error);
    bool removeMaterial(Id material, QString &error);
    bool removeTexture(Id texture, QString &error);

private:
    struct History {
        QString label;
        std::shared_ptr<const State> before, after;
        Selection beforeSelection, afterSelection;
        std::size_t bytes = 0;
    };
    bool edit(const QString &label, const std::function<void(State &, Selection &)> &operation,
        QString &error);
    bool restore(bool redo, QString &error);
    std::shared_ptr<const State> state_;
    Selection selection_;
    QUuid identity_ = QUuid::createUuid();
    std::uint64_t revision_ = 1;
    Id nextId_ = 1;
    QByteArray sourceHash_, savedHash_;
    std::deque<History> undo_, redo_;
    std::size_t historyBytes_ = 0;
};

} // namespace nova::mesh

#endif
