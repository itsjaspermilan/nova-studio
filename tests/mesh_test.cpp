#include "mesh/document.hpp"

extern "C" {
#include "assets.h"
#include "model.h"
}

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <limits>
#include <map>
#include <set>

using namespace nova::mesh;

static QString error;
static unsigned checks;
#define CHECK(x) do { ++checks; if (!(x)) { \
    std::fprintf(stderr, "%s:%d: %s\n%s\n", __func__, __LINE__, #x, error.toUtf8().constData()); std::exit(1); \
} } while (false)

static bool near(double a, double b, double epsilon = 1e-6) { return std::abs(a - b) <= epsilon; }
static Vec3 cross(Vec3 a, Vec3 b) { return {a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x}; }
static double dot(Vec3 a, Vec3 b) { return a.x*b.x+a.y*b.y+a.z*b.z; }
static Vec3 unit(Vec3 p)
{
    const double n = std::sqrt(dot(p, p));
    return {p.x/n, p.y/n, p.z/n};
}

static QByteArray source(const Document &document)
{
    QByteArray bytes;
    CHECK(serializeSource(*document.state(), bytes, error));
    return bytes;
}

static bool sameSelection(const Selection &a, const Selection &b)
{
    return a.mode == b.mode && a.object == b.object && a.ids == b.ids && a.edges == b.edges;
}

static void unchanged(Document &document, const std::function<bool()> &operation, const QString &diagnostic = {})
{
    const auto before = document.state();
    const auto revision = document.revision();
    const auto selection = document.selection();
    const QByteArray bytes = source(document);
    const bool dirty = document.dirty();
    const QString undo = document.undoText(), redo = document.redoText();
    CHECK(!operation());
    CHECK(!error.isEmpty());
    CHECK(diagnostic.isEmpty() || error.contains(diagnostic, Qt::CaseInsensitive));
    CHECK(document.state() == before && document.revision() == revision);
    CHECK(sameSelection(document.selection(), selection) && document.dirty() == dirty);
    CHECK(document.undoText() == undo && document.redoText() == redo);
    CHECK(source(document) == bytes);
}

static Id primitive(Document &document, Primitive type = Primitive::Box, const QString &name = QStringLiteral("Body"))
{
    Id id = 0;
    const bool added = document.addPrimitive(type, name, 12, id, error);
    if (!added) error = QStringLiteral("Primitive %1: %2").arg(static_cast<int>(type)).arg(error);
    CHECK(added);
    CHECK(id != 0 && document.selection().ids == std::vector<Id>{id});
    return id;
}

static void objects(Document &document, std::vector<Id> ids)
{
    CHECK(document.select({SelectionMode::Object, 0, std::move(ids), {}}, error));
}

static void faces(Document &document, Id object, std::vector<Id> ids)
{
    CHECK(document.select({SelectionMode::Face, object, std::move(ids), {}}, error));
}

static Preview geometry(const Document &document)
{
    Preview result;
    CHECK(preview(*document.state(), result, error));
    return result;
}

static double volume(const State &state)
{
    Preview result;
    CHECK(preview(state, result, error));
    double v = 0;
    for (const auto &t : result.triangles) v += dot(t.positions[0], cross(t.positions[1], t.positions[2])) / 6;
    return v;
}

static void closed(const Object &object)
{
    std::map<Edge, std::vector<Id>> edges;
    for (const auto &face : object.faces)
        for (std::size_t i = 0; i < face.corners.size(); ++i) {
            const Id a = face.corners[i].vertex, b = face.corners[(i + 1) % face.corners.size()].vertex;
            edges[Edge::between(a, b)].push_back(a);
        }
    for (const auto &[edge, from] : edges) {
        (void)edge;
        CHECK(from.size() == 2 && from[0] != from[1]);
    }
}

static void documentOperations()
{
    Document document;
    CHECK(!document.dirty() && !document.canUndo());
    CHECK(!document.undo(error) && !error.isEmpty());
    CHECK(!document.snapshot(true, error));
    const Id body = primitive(document);
    const auto original = document.state();
    const auto model = geometry(document);
    CHECK(model.statistics.objects == 1 && model.statistics.vertices == 8 && model.statistics.edges == 12);
    CHECK(model.statistics.faces == 6 && model.statistics.triangles == 12);
    CHECK(near(volume(*document.state()), 1));
    closed(document.state()->objects[0]);
    const auto saved = document.snapshot(true, error);
    CHECK(saved && !saved->glb.isEmpty() && saved->source == source(document));
    CHECK(document.markPersisted(*saved, error) && !document.dirty());
    CHECK(document.rename(body, QString::fromUtf8("Carrosserie \xE2\x80\x94 \xE9\x9B\xAA"), error));
    CHECK(document.dirty() && document.undoText() == QStringLiteral("Rename mesh item"));
    CHECK(document.undo(error) && !document.dirty());
    CHECK(document.redo(error) && document.dirty());
    CHECK(!document.markPersisted(*saved, error) && error.contains(QStringLiteral("older")));
    CHECK(original->objects[0].name == QStringLiteral("Body"));
    CHECK(saved->source != source(document));

    const Id top = document.state()->objects[0].faces[1].id;
    faces(document, body, {top});
    CHECK(document.inset(0.1, error));
    CHECK(document.state()->objects[0].vertices.size() == 12 && document.state()->objects[0].faces.size() == 10);
    CHECK(near(volume(*document.state()), 1));
    CHECK(document.extrude(0.5, error));
    CHECK(document.state()->objects[0].vertices.size() == 16 && document.state()->objects[0].faces.size() == 14);
    CHECK(near(volume(*document.state()), 1.32));
    closed(document.state()->objects[0]);
    CHECK(document.undo(error) && near(volume(*document.state()), 1));
    CHECK(document.selection().ids == std::vector<Id>{top});
    CHECK(document.redo(error) && near(volume(*document.state()), 1.32));
    unchanged(document, [&] { return document.inset(1, error); }, QStringLiteral("Inset"));
    unchanged(document, [&] { return document.extrude(0, error); }, QStringLiteral("distance"));
    auto reopened = Document::open(source(document), error);
    CHECK(reopened && source(*reopened) == source(document) && !reopened->dirty());
    CHECK(!reopened->markPersisted(*saved, error) && error.contains(QStringLiteral("another")));

    objects(document, {body});
    const QByteArray beforeOrigin = document.snapshot(true, error)->glb;
    CHECK(document.placeOrigin(OriginPlacement::GroundCenter, error));
    CHECK(near(document.state()->objects[0].origin.y, -0.5));
    CHECK(document.snapshot(true, error)->glb == beforeOrigin);
    CHECK(document.setOrigin({0.25, 0.25, -0.25}, error));
    CHECK(document.snapshot(true, error)->glb == beforeOrigin);
    CHECK(document.group(QStringLiteral("Car"), error));
    const Id group = document.state()->objects[0].group;
    CHECK(group && document.duplicate({2, 0, 0}, error));
    const Id copy = document.selection().ids[0];
    CHECK(copy != body && document.state()->objects[1].group == group);
    CHECK(document.ungroup(error) && document.state()->objects[1].group == 0);
    CHECK(document.removeSelection(error) && document.state()->objects.size() == 1);
    CHECK(document.undo(error) && document.selection().ids == std::vector<Id>{copy});
    const Id highWater = document.state()->nextId;
    CHECK(document.undo(error));
    CHECK(document.undo(error));
    CHECK(document.state()->objects.size() == 1 && document.state()->nextId == highWater);
    CHECK(document.duplicate({0, 0, 3}, error));
    CHECK(document.selection().ids[0] >= highWater && !document.canRedo());

    State candidate = *document.state();
    candidate.objects[0].name = QStringLiteral("Prepared gesture");
    const auto revision = document.revision();
    CHECK(document.rename(body, QStringLiteral("Newer edit"), error));
    unchanged(document, [&] { return document.commit(candidate, {}, revision, QStringLiteral("Stale gesture"), error); },
        QStringLiteral("stale"));
    candidate = *document.state();
    candidate.objects[0].name = QStringLiteral("Gesture end");
    CHECK(document.commit(candidate, {}, document.revision(), QStringLiteral("Drag body"), error));
    CHECK(document.undoText() == QStringLiteral("Drag body"));
    CHECK(document.undo(error) && document.state()->objects[0].name == QStringLiteral("Newer edit"));
}

static void topologyOperations()
{
    Document document;
    const Id id = primitive(document);
    const Object original = document.state()->objects[0];
    const Face top = original.faces[1];
    faces(document, id, {top.id});
    CHECK(document.subdivide(error));
    CHECK(document.state()->objects[0].vertices.size() == 13 && document.state()->objects[0].faces.size() == 9);
    CHECK(document.selection().ids.size() == 4 && near(volume(*document.state()), 1));
    closed(document.state()->objects[0]);
    CHECK(geometry(document).statistics.triangles == 22);
    CHECK(document.undo(error));
    CHECK(document.splitFace(top.corners[0].vertex, top.corners[2].vertex, error));
    CHECK(document.selection().ids.size() == 2);
    CHECK(document.extrude(0.25, error));
    CHECK(document.state()->objects[0].faces.size() == 11 && near(volume(*document.state()), 1.25));
    closed(document.state()->objects[0]);
    CHECK(document.undo(error) && document.undo(error));
    unchanged(document, [&] { return document.splitFace(top.corners[0].vertex, top.corners[1].vertex, error); },
        QStringLiteral("nonadjacent"));
    faces(document, id, {original.faces[0].id, top.id});
    unchanged(document, [&] { return document.extrude(1, error); }, QStringLiteral("coplanar"));

    const Edge edge = Edge::between(top.corners[0].vertex, top.corners[1].vertex);
    CHECK(document.select({SelectionMode::Edge, id, {}, {edge}}, error));
    Statistics selection;
    CHECK(selectionStatistics(*document.state(), document.selection(), selection, error));
    CHECK(selection.vertices == 2 && selection.edges == 1 && selection.faces == 0);
    unchanged(document, [&] { return document.bevelEdge(0.6, error); }, QStringLiteral("depth"));
    CHECK(document.bevelEdge(0.1, error));
    CHECK(document.state()->objects[0].vertices.size() == 10 && document.state()->objects[0].faces.size() == 7);
    CHECK(near(volume(*document.state()), 0.99));
    closed(document.state()->objects[0]);
    CHECK(document.selection().mode == SelectionMode::Face && document.selection().ids.size() == 1);
    CHECK(document.undo(error) && sameSelection(document.selection(), {SelectionMode::Edge, id, {}, {edge}}));
    CHECK(document.redo(error));
    unchanged(document, [&] { return document.bevelEdge(0.1, error); }, QStringLiteral("Edge mode"));

    Document vertexEdit;
    const Id box = primitive(vertexEdit);
    const Id vertex = vertexEdit.state()->objects[0].vertices[0].id;
    CHECK(vertexEdit.select({SelectionMode::Vertex, box, {vertex}, {}}, error));
    nova::mesh::Transform move;
    move.translation = {0.1, 0.2, 0.3};
    unchanged(vertexEdit, [&] { return vertexEdit.transform(move, error); }, QStringLiteral("non-planar"));
    objects(vertexEdit, {box});
    CHECK(vertexEdit.triangulate(error) && geometry(vertexEdit).statistics.faces == 12);
    CHECK(vertexEdit.select({SelectionMode::Vertex, box, {vertex}, {}}, error));
    CHECK(vertexEdit.transform(move, error));
    CHECK(vertexEdit.snap(0.1, error));
    CHECK(vertexEdit.undo(error));
    CHECK(vertexEdit.removeSelection(error));
    CHECK(vertexEdit.state()->objects[0].faces.size() < 12);
    CHECK(vertexEdit.undo(error));

    Document plane;
    const Id planeId = primitive(plane, Primitive::Plane);
    const Face face = plane.state()->objects[0].faces[0];
    CHECK(plane.select({SelectionMode::Edge, planeId, {}, {Edge::between(face.corners[0].vertex, face.corners[1].vertex)}}, error));
    unchanged(plane, [&] { return plane.bevelEdge(0.1, error); }, QStringLiteral("closed"));
    faces(plane, planeId, {face.id});
    CHECK(plane.flipFaces(error));
    CHECK(geometry(plane).triangles[0].normals[0].y < -0.99);
    CHECK(plane.flipFaces(error));
    CHECK(geometry(plane).triangles[0].normals[0].y > 0.99);

    for (Primitive type : {Primitive::Pyramid, Primitive::Cylinder, Primitive::Sphere}) {
        Document shape;
        primitive(shape, type);
        CHECK(validate(*shape.state(), error) && volume(*shape.state()) > 0);
        closed(shape.state()->objects[0]);
        CHECK(shape.snapshot(true, error));
    }
}

static QByteArray png(int width = 4, int height = 4, unsigned tint = 0, bool transparent = false)
{
    Image image = GenImageColor(width, height, WHITE);
    CHECK(image.data);
    for (int y = 0; y < height; ++y) for (int x = 0; x < width; ++x) {
        Color c = y < height / 2 ? (x < std::max(1, width / 4) ? RED : GREEN) :
            (x < std::max(1, width / 4) ? BLUE : YELLOW);
        c.r = static_cast<unsigned char>(c.r ^ tint);
        if (transparent && x == 0 && y == 0) c.a = 254;
        ImageDrawPixel(&image, x, y, c);
    }
    int size = 0;
    unsigned char *bytes = ExportImageToMemory(image, ".png", &size);
    UnloadImage(image);
    CHECK(bytes && size > 0);
    QByteArray result(reinterpret_cast<const char *>(bytes), size);
    MemFree(bytes);
    return result;
}

static void materialsAndUvs()
{
    Document document;
    const Id object = primitive(document, Primitive::Plane);
    const Id face = document.state()->objects[0].faces[0].id;
    Id texture = 0, material = 0, duplicate = 0;
    const QByteArray image = png();
    CHECK(document.addTexture(QStringLiteral("Asymmetric"), image, texture, error));
    const auto revision = document.revision();
    CHECK(document.addTexture(QStringLiteral("Same bytes"), image, duplicate, error));
    CHECK(duplicate == texture && document.revision() == revision && document.state()->textures.size() == 1);
    CHECK(document.addMaterial(QStringLiteral("Paint"), {0.25, 0.5, 1}, texture, material, error));
    CHECK(document.assignMaterial(material, error));
    unchanged(document, [&] { return document.removeMaterial(material, error); }, QStringLiteral("Reassign"));
    unchanged(document, [&] { return document.removeTexture(texture, error); }, QStringLiteral("materials"));
    unchanged(document, [&] { return document.replaceTexture(texture, png(4, 4, 0, true), error); }, QStringLiteral("opaque"));
    unchanged(document, [&] { return document.updateMaterial(material, {1, 0, 2}, texture, error); }, QStringLiteral("0..1"));
    faces(document, object, {face});
    CHECK(document.projectUvs(Axis::Y, error));
    const auto &plane = document.state()->objects[0];
    for (const auto &c : plane.faces[0].corners) {
        const auto v = std::find_if(plane.vertices.begin(), plane.vertices.end(), [&](const Vertex &value) { return value.id == c.vertex; });
        CHECK(v != plane.vertices.end());
        CHECK(near(c.uv.x, v->position.x + 0.5) && near(c.uv.y, 0.5 - v->position.z));
    }
    CHECK(document.setFaceUvs(face, {{0.125, 0.125}, {0.125, 0.875}, {0.875, 0.875}, {0.875, 0.125}}, error));
    UvTransform uv;
    uv.scale = {-1, 1};
    CHECK(document.transformUvs(uv, error));
    CHECK(near(document.state()->objects[0].faces[0].corners[0].uv.x, 0.875));
    uv.translation = {1, 0};
    unchanged(document, [&] { return document.transformUvs(uv, error); }, QStringLiteral("UV"));
    CHECK(document.inset(0.1, error));
    for (const auto &f : document.state()->objects[0].faces)
        for (const auto &c : f.corners) CHECK(c.uv.x >= 0.125 - 1e-7 && c.uv.x <= 0.875 + 1e-7);
    objects(document, {object});
    CHECK(document.unwrapFaces(0.05, error));
    std::set<std::pair<int, int>> cells;
    for (const auto &f : document.state()->objects[0].faces) {
        Vec2 middle;
        for (const auto &c : f.corners) { middle.x += c.uv.x; middle.y += c.uv.y; }
        middle.x /= static_cast<double>(f.corners.size()); middle.y /= static_cast<double>(f.corners.size());
        CHECK(cells.emplace(static_cast<int>(middle.x * 3), static_cast<int>(middle.y * 3)).second);
    }
    CHECK(document.snapshot(true, error));
    CHECK(document.updateMaterial(material, {1, 1, 1}, 0, error));
    CHECK(document.removeTexture(texture, error));
    CHECK(document.undo(error) && document.state()->textures[0].png == image);
}

static void badSource(const QByteArray &bad, const State &existing)
{
    State output = existing;
    QByteArray before, after;
    CHECK(serializeSource(output, before, error));
    CHECK(!parseSource(bad, output, error) && !error.isEmpty());
    CHECK(serializeSource(output, after, error) && before == after);
}

static void sourceContracts()
{
    Document document;
    primitive(document);
    const QByteArray bytes = source(document);
    State parsed;
    CHECK(parseSource(bytes, parsed, error));
    QByteArray roundTrip;
    CHECK(serializeSource(parsed, roundTrip, error) && roundTrip == bytes);
    badSource("nova-model 2\n", parsed);
    badSource(bytes + "garbage", parsed);
    badSource("{\"format\":\"nova-mesh\",\"format\":\"future\"}", parsed);
    auto root = QJsonDocument::fromJson(bytes).array();
    auto bad = root; bad[1] = 2; badSource(QJsonDocument(bad).toJson(), parsed);
    bad = root; bad.append(0); badSource(QJsonDocument(bad).toJson(), parsed);
    bad = root; bad[2] = 1.5; badSource(QJsonDocument(bad).toJson(), parsed);
    bad = root; bad[2] = 0; badSource(QJsonDocument(bad).toJson(), parsed);
    auto objectList = root[6].toArray();
    auto object = objectList[0].toArray();
    auto vertices = object[4].toArray();
    auto vertex = vertices[0].toArray();
    vertex[0] = vertices[1].toArray()[0];
    vertices[0] = vertex; object[4] = vertices; objectList[0] = object;
    bad = root; bad[6] = objectList; badSource(QJsonDocument(bad).toJson(), parsed);
    objectList = root[6].toArray(); object = objectList[0].toArray();
    object[1] = QStringLiteral("bad\nname"); objectList[0] = object;
    bad = root; bad[6] = objectList; badSource(QJsonDocument(bad).toJson(), parsed);
    objectList = root[6].toArray(); object = objectList[0].toArray();
    auto faces = object[5].toArray(); auto face = faces[0].toArray(); auto corners = face[2].toArray();
    auto corner = corners[0].toArray(); corner[1] = 1.001;
    corners[0] = corner; face[2] = corners; faces[0] = face; object[5] = faces; objectList[0] = object;
    bad = root; bad[6] = objectList; badSource(QJsonDocument(bad).toJson(), parsed);

    State invalid = parsed;
    invalid.objects[0].vertices[0].position.x = std::numeric_limits<double>::quiet_NaN();
    QByteArray retained = "unchanged";
    CHECK(!serializeSource(invalid, retained, error) && retained == "unchanged");
    CHECK(!exportGlb(invalid, retained, error) && retained == "unchanged");
    Preview previewOutput;
    previewOutput.statistics.faces = 123;
    CHECK(!preview(invalid, previewOutput, error) && previewOutput.statistics.faces == 123);
    invalid = parsed;
    invalid.objects[0].vertices[0].id = invalid.objects[0].vertices[1].id;
    unchanged(document, [&] { return document.commit(invalid, {}, document.revision(), QStringLiteral("Invalid"), error); });
    Selection invalidSelection{SelectionMode::Vertex, parsed.objects[0].id, {999999}, {}};
    unchanged(document, [&] { return document.select(invalidSelection, error); }, QStringLiteral("missing"));
}

static void put32(QByteArray &bytes, std::uint32_t value)
{
    for (unsigned i = 0; i < 4; ++i) bytes.append(static_cast<char>((value >> (i * 8)) & 255));
}
static void putFloat(QByteArray &bytes, float value)
{
    std::uint32_t bits; std::memcpy(&bits, &value, 4); put32(bytes, bits);
}
static std::uint32_t get32(const QByteArray &bytes, qsizetype offset)
{
    const auto *p = reinterpret_cast<const unsigned char *>(bytes.constData() + offset);
    return p[0] | (std::uint32_t(p[1]) << 8) | (std::uint32_t(p[2]) << 16) | (std::uint32_t(p[3]) << 24);
}
static void align(QByteArray &bytes, char fill = '\0') { while (bytes.size() % 4) bytes.append(fill); }

static QByteArray pack(QJsonObject json, QByteArray bin)
{
    align(bin);
    json[QStringLiteral("buffers")] = QJsonArray{QJsonObject{{QStringLiteral("byteLength"), static_cast<double>(bin.size())}}};
    QByteArray text = QJsonDocument(json).toJson(QJsonDocument::Compact);
    align(text, ' ');
    QByteArray result("glTF", 4);
    put32(result, 2); put32(result, static_cast<std::uint32_t>(28 + text.size() + bin.size()));
    put32(result, static_cast<std::uint32_t>(text.size())); result.append("JSON", 4); result.append(text);
    put32(result, static_cast<std::uint32_t>(bin.size())); result.append("BIN\0", 4); result.append(bin);
    return result;
}

static QByteArray altered(const QByteArray &glb, const std::function<void(QJsonObject &, QByteArray &)> &edit)
{
    const auto length = static_cast<qsizetype>(get32(glb, 12));
    QJsonObject json = QJsonDocument::fromJson(glb.mid(20, length)).object();
    QByteArray bin = glb.mid(28 + length);
    edit(json, bin);
    return pack(json, bin);
}

static QByteArray externalFixture()
{
    QByteArray bin;
    const float s = std::sqrt(0.5f);
    const float vertices[4][8] = {
        {-0.5f,-0.5f,0, s,0,s, 0.125f,0.125f},
        {0.5f,-0.5f,0, 0,s,s, 0.875f,0.125f},
        {0.5f,0.5f,0, -s,0,s, 0.875f,0.875f},
        {-0.5f,0.5f,0, 0,-s,s, 0.125f,0.875f}};
    for (const auto &vertex : vertices) for (float value : vertex) putFloat(bin, value);
    const auto indicesOffset = bin.size();
    for (unsigned index : {0, 1, 2, 0, 2, 3}) { bin.append(static_cast<char>(index)); bin.append('\0'); }
    align(bin);
    const auto pngOffset = bin.size();
    const QByteArray image = png();
    bin.append(image);
    QJsonArray views{
        QJsonObject{{"buffer",0},{"byteOffset",0},{"byteLength",128},{"byteStride",32}},
        QJsonObject{{"buffer",0},{"byteOffset",static_cast<double>(indicesOffset)},{"byteLength",12}},
        QJsonObject{{"buffer",0},{"byteOffset",static_cast<double>(pngOffset)},{"byteLength",image.size()}}};
    QJsonArray accessors{
        QJsonObject{{"bufferView",0},{"byteOffset",0},{"componentType",5126},{"count",4},{"type","VEC3"}},
        QJsonObject{{"bufferView",0},{"byteOffset",12},{"componentType",5126},{"count",4},{"type","VEC3"}},
        QJsonObject{{"bufferView",0},{"byteOffset",24},{"componentType",5126},{"count",4},{"type","VEC2"}},
        QJsonObject{{"bufferView",1},{"componentType",5123},{"count",6},{"type","SCALAR"}}};
    QJsonObject textured{{"name","Paint"},{"extensions",QJsonObject{{"KHR_materials_unlit",QJsonObject{}}}},
        {"pbrMetallicRoughness",QJsonObject{{"baseColorFactor",QJsonArray{0.25,0.5,1,1}},
            {"baseColorTexture",QJsonObject{{"index",0}}}}}};
    QJsonObject plain{{"name","Trim"},{"extensions",QJsonObject{{"KHR_materials_unlit",QJsonObject{}}}},
        {"pbrMetallicRoughness",QJsonObject{{"baseColorFactor",QJsonArray{1,0.25,0.5,1}}}}};
    QJsonArray primitives;
    for (int material = 0; material < 2; ++material)
        primitives.append(QJsonObject{{"attributes",QJsonObject{{"POSITION",0},{"NORMAL",1},{"TEXCOORD_0",2}}},
            {"indices",3},{"material",material},{"mode",4}});
    const double angle = 3.14159265358979323846 / 8;
    QJsonObject root{{"asset",QJsonObject{{"version","2.0"}}},
        {"extensionsUsed",QJsonArray{"KHR_materials_unlit"}},{"bufferViews",views},{"accessors",accessors},
        {"samplers",QJsonArray{QJsonObject{{"magFilter",9728},{"minFilter",9728},{"wrapS",33071},{"wrapT",33071}}}},
        {"images",QJsonArray{QJsonObject{{"bufferView",2},{"mimeType","image/png"},{"name","Original pixels"}}}},
        {"textures",QJsonArray{QJsonObject{{"sampler",0},{"source",0}}}},
        {"materials",QJsonArray{textured,plain}},{"meshes",QJsonArray{QJsonObject{{"primitives",primitives}}}},
        {"nodes",QJsonArray{
            QJsonObject{{"children",QJsonArray{1,2}},{"translation",QJsonArray{2,1,-1}}},
            QJsonObject{{"mesh",0},{"name","Mirrored instance"},{"translation",QJsonArray{1,-2,3}},
                {"scale",QJsonArray{-2,3,0.5}},{"rotation",QJsonArray{0,std::sin(angle),0,std::cos(angle)}}},
            QJsonObject{{"mesh",0},{"name","Ordinary instance"},{"translation",QJsonArray{-2,0,-4}},
                {"scale",QJsonArray{1,0.5,2}}}}},
        {"scenes",QJsonArray{QJsonObject{{"nodes",QJsonArray{0}}}}},{"scene",0}};
    return pack(root, bin);
}

struct Native {
    ::Model model{};
    NovaModelImages images{};
    explicit Native(const QByteArray &bytes)
    {
        char diagnostic[1024]{};
        const bool ok = nova_decode_glb_images(reinterpret_cast<const unsigned char *>(bytes.constData()),
            static_cast<int>(bytes.size()), &model, &images, diagnostic, sizeof(diagnostic));
        error = QString::fromUtf8(diagnostic);
        CHECK(ok);
    }
    Native(const Native &) = delete;
    Native &operator=(const Native &) = delete;
    ~Native() { nova_unload_cpu_model(&model); nova_unload_model_images(&images); }
};

static std::uint32_t bits(float value)
{
    std::uint32_t result;
    if (value == 0) value = 0;
    std::memcpy(&result, &value, 4);
    return result;
}

static std::vector<std::vector<std::uint32_t>> signature(const Native &native)
{
    std::vector<std::vector<std::uint32_t>> result;
    for (int i = 0; i < native.model.meshCount; ++i) {
        const ::Mesh &mesh = native.model.meshes[i];
        const int image = native.images.material_image[native.model.meshMaterial[i]];
        for (int t = 0; t < mesh.triangleCount; ++t) {
            std::array<std::vector<std::uint32_t>, 3> vertices;
            for (int k = 0; k < 3; ++k) {
                const int v = t * 3 + k;
                auto &record = vertices[static_cast<std::size_t>(k)];
                for (int axis = 0; axis < 3; ++axis) record.push_back(bits(mesh.vertices[v * 3 + axis]));
                record.push_back(mesh.texcoords ? bits(mesh.texcoords[v * 2]) : 0);
                record.push_back(mesh.texcoords ? bits(mesh.texcoords[v * 2 + 1]) : 0);
                for (int channel = 0; channel < 4; ++channel) record.push_back(mesh.colors[v * 4 + channel]);
                record.push_back(image >= 0);
                if (image >= 0) {
                    const Image &pixels = native.images.images[image];
                    const int x = std::min(pixels.width - 1, static_cast<int>(mesh.texcoords[v * 2] * pixels.width));
                    const int y = std::min(pixels.height - 1, static_cast<int>(mesh.texcoords[v * 2 + 1] * pixels.height));
                    const Color c = GetImageColor(pixels, x, y);
                    for (unsigned channel : {c.r, c.g, c.b, c.a}) record.push_back(channel);
                }
            }
            std::vector<std::uint32_t> canonical;
            for (int offset = 0; offset < 3; ++offset) {
                std::vector<std::uint32_t> ordered;
                for (int k = 0; k < 3; ++k) {
                    const auto &record = vertices[static_cast<std::size_t>((offset + k) % 3)];
                    ordered.insert(ordered.end(), record.begin(), record.end());
                }
                if (canonical.empty() || ordered < canonical) canonical = std::move(ordered);
            }
            result.push_back(std::move(canonical));
        }
    }
    std::sort(result.begin(), result.end());
    return result;
}

static void nativeRoundTrips()
{
    const QByteArray fixture = externalFixture();
    Native original(fixture);
    CHECK(original.model.meshCount == 4 && original.images.count == 1);
    CHECK(original.images.material_image[0] == 0 && original.images.material_image[1] == -1);
    State imported;
    CHECK(importGlb(fixture, QStringLiteral("Original.glb"), imported, error));
    CHECK(imported.objects.size() == 4 && imported.originals[0].glb == fixture);
    for (const auto &object : imported.objects) CHECK(object.original == imported.originals[0].id);
    CHECK(imported.objects[0].vertices.size() == 4 && imported.objects[0].faces.size() == 2);
    CHECK(imported.textures.size() == 1 && imported.textures[0].png == png());
    QByteArray exported;
    CHECK(exportGlb(imported, exported, error));
    Native roundTrip(exported);
    CHECK(signature(original) == signature(roundTrip));
    CHECK(roundTrip.images.count == 1);
    for (int y = 0; y < 4; ++y) for (int x = 0; x < 4; ++x) {
        const Color expected = GetImageColor(original.images.images[0], x, y);
        const Color actual = GetImageColor(roundTrip.images.images[0], x, y);
        CHECK(std::memcmp(&expected, &actual, sizeof(Color)) == 0);
    }
    // Every corner, including the final triangle, follows the negative-scale
    // index permutation and the inverse-transpose normal, not its position.
    const double s = std::sqrt(0.5);
    const std::array<Vec3, 4> normals{{{s,0,s},{0,s,s},{-s,0,s},{0,-s,s}}};
    const unsigned indices[6] = {0,2,1,0,3,2};
    const double angle = 3.14159265358979323846 / 4;
    for (unsigned k = 0; k < 6; ++k) {
        const Vec3 raw = normals[indices[k]];
        const Vec3 n{-raw.x / 2, raw.y / 3, raw.z * 2};
        const Vec3 expected = unit({n.x * std::cos(angle) + n.z * std::sin(angle), n.y,
            -n.x * std::sin(angle) + n.z * std::cos(angle)});
        const auto actual = imported.objects[0].faces[k / 3].corners[k % 3].normal;
        CHECK(actual && near(actual->x, expected.x) && near(actual->y, expected.y) && near(actual->z, expected.z));
        const auto uv = imported.objects[0].faces[k / 3].corners[k % 3].uv;
        CHECK(uv.x == original.model.meshes[0].texcoords[k * 2] &&
            uv.y == original.model.meshes[0].texcoords[k * 2 + 1]);
    }
    auto document = Document::fromState(imported, error);
    CHECK(document);
    const auto snapshot = document->snapshot(true, error);
    CHECK(snapshot);
    auto reopened = Document::open(snapshot->source, error);
    CHECK(reopened && source(*reopened) == snapshot->source);
    objects(*document, {imported.objects[0].id});
    CHECK(document->mirror(Axis::X, 0, false, error));
    const auto mirrored = document->state()->objects[0];
    const auto &old = imported.objects[0];
    for (std::size_t f = 0; f < old.faces.size(); ++f) for (std::size_t c = 0; c < 3; ++c) {
        const auto &before = old.faces[f].corners[2 - c], &after = mirrored.faces[f].corners[c];
        CHECK(before.vertex == after.vertex && before.uv.x == after.uv.x && before.uv.y == after.uv.y);
        CHECK(before.normal && after.normal && before.normal->x == -after.normal->x &&
            before.normal->y == after.normal->y && before.normal->z == after.normal->z);
    }
    CHECK(document->mirror(Axis::X, 0, false, error));
    Native twice(document->snapshot(true, error)->glb);
    CHECK(signature(original) == signature(twice));
    nova::mesh::Transform transform;
    transform.scale = {2, 1, 3}; transform.rotationDegrees = {0, 0, 90};
    CHECK(document->transform(transform, error));
    for (std::size_t f = 0; f < old.faces.size(); ++f) for (std::size_t c = 0; c < 3; ++c) {
        const Vec3 n = *old.faces[f].corners[c].normal;
        const Vec3 expected = unit({-n.y, n.x / 2, n.z / 3});
        const Vec3 actual = *document->state()->objects[0].faces[f].corners[c].normal;
        CHECK(near(actual.x, expected.x) && near(actual.y, expected.y) && near(actual.z, expected.z));
    }
    CHECK(document->undo(error));
    std::vector<Id> all;
    for (const auto &object : imported.objects) all.push_back(object.id);
    objects(*document, all);
    CHECK(document->removeSelection(error) && document->state()->objects.empty());
    CHECK(document->state()->originals.size() == 1 && document->state()->originals[0].glb == fixture);
    CHECK(!document->snapshot(true, error) && document->snapshot(false, error));
    CHECK(document->undo(error));

    Document appended;
    primitive(appended);
    CHECK(appended.import(fixture, QStringLiteral("Original"), error));
    CHECK(appended.state()->objects.size() == 5 && appended.state()->originals.size() == 1);
    CHECK(appended.undo(error) && appended.state()->objects.size() == 1);
    CHECK(appended.state()->originals[0].glb == fixture);
    CHECK(appended.redo(error) && appended.state()->objects.size() == 5);
    State alteredOriginal = *appended.state();
    alteredOriginal.originals.clear();
    unchanged(appended, [&] { return appended.commit(alteredOriginal, {}, appended.revision(), QStringLiteral("Drop original"), error); });

    Document weld;
    CHECK(weld.import(exported, QStringLiteral("Exported"), error));
    const auto &unindexed = weld.state()->objects[0];
    std::vector<Id> vertices;
    for (const auto &v : unindexed.vertices) vertices.push_back(v.id);
    CHECK(unindexed.vertices.size() == 6);
    CHECK(weld.select({SelectionMode::Vertex, unindexed.id, vertices, {}}, error));
    CHECK(weld.weldSelectedVertices(error) && weld.state()->objects[0].vertices.size() == 4);
    Native welded(weld.snapshot(true, error)->glb);
    CHECK(signature(roundTrip) == signature(welded));
}

static void mirrorUvSurface()
{
    Document base;
    const Id id = primitive(base, Primitive::Plane);
    const Id face = base.state()->objects[0].faces[0].id;
    Id texture = 0, material = 0;
    CHECK(base.addTexture(QStringLiteral("Quadrants"), png(), texture, error));
    CHECK(base.addMaterial(QStringLiteral("Paint"), {1, 1, 1}, texture, material, error));
    CHECK(base.assignMaterial(material, error));
    CHECK(base.setFaceUvs(face, {{0.1,0.2},{0.2,0.8},{0.9,0.65},{0.8,0.3}}, error));
    for (int concave = 0; concave < 2; ++concave) {
        if (concave) {
            State candidate = *base.state();
            auto &object = candidate.objects[0];
            object.vertices.clear();
            object.faces[0].corners.clear();
            unsigned index = 0;
            for (Vec3 point : {Vec3{0,0,0}, Vec3{0,0,2}, Vec3{1,0,2}, Vec3{1,0,1}, Vec3{2,0,1}, Vec3{2,0,0}}) {
                const Id vertex = candidate.nextId++;
                object.vertices.push_back({vertex, point});
                object.faces[0].corners.push_back({vertex, {0.1 + (index % 3) * 0.3, 0.2 + (index % 2) * 0.6}, std::nullopt});
                ++index;
            }
            CHECK(base.commit(candidate, {}, base.revision(), QStringLiteral("Concave polygon"), error));
        }
        const auto snapshot = base.snapshot(true, error);
        CHECK(snapshot);
        for (const Axis axis : {Axis::X, Axis::Y, Axis::Z}) {
            auto document = Document::open(snapshot->source, error);
            CHECK(document);
            objects(*document, {id});
            const QByteArray reflected = altered(snapshot->glb, [&](QJsonObject &root, QByteArray &) {
                auto nodes = root["nodes"].toArray();
                for (qsizetype i = 0; i < nodes.size(); ++i) {
                    auto node = nodes[i].toObject();
                    QJsonArray scale{1,1,1}, translation{0,0,0};
                    const int index = axis == Axis::X ? 0 : axis == Axis::Y ? 1 : 2;
                    scale[index] = -1; translation[index] = 4;
                    node["scale"] = scale; node["translation"] = translation; nodes[i] = node;
                }
                root["nodes"] = nodes;
            });
            CHECK(document->mirror(axis, 2, false, error));
            const auto output = document->snapshot(true, error);
            CHECK(output);
            Native expected(reflected), actual(output->glb);
            CHECK(signature(expected) == signature(actual));
        }
    }
}

static void topologyRejections()
{
    Document base;
    const Id id = primitive(base, Primitive::Plane);
    State region = *base.state();
    Object &grid = region.objects[0];
    grid.vertices.clear(); grid.faces.clear();
    Id vertices[4][4];
    for (int z = 0; z < 4; ++z) for (int x = 0; x < 4; ++x) {
        vertices[z][x] = region.nextId++;
        grid.vertices.push_back({vertices[z][x], {static_cast<double>(x), 0, static_cast<double>(z)}});
    }
    std::vector<Id> selected;
    const Id material = region.materials[0].id;
    for (int z = 0; z < 3; ++z) for (int x = 0; x < 3; ++x) {
        if (x == 1 && z == 1) continue;
        const Id face = region.nextId++;
        selected.push_back(face);
        grid.faces.push_back({face, material, {
            {vertices[z][x],{0,0},std::nullopt}, {vertices[z+1][x],{0,1},std::nullopt},
            {vertices[z+1][x+1],{1,1},std::nullopt}, {vertices[z][x+1],{1,0},std::nullopt}}});
    }
    CHECK(base.commit(region, {SelectionMode::Face, id, selected, {}}, base.revision(), QStringLiteral("Open grid"), error));
    unchanged(base, [&] { return base.extrude(1, error); }, QStringLiteral("holes"));
    faces(base, id, {selected.front(), selected.back()});
    unchanged(base, [&] { return base.extrude(1, error); }, QStringLiteral("connected"));

    State pinch;
    pinch.materials.push_back({pinch.nextId++, QStringLiteral("Plain"), {1,1,1}, 0});
    Object pair;
    pair.id = pinch.nextId++; pair.name = QStringLiteral("Separate triangles");
    for (const Vec3 p : {Vec3{0,0,0}, Vec3{1,0,0}, Vec3{0,1,0},
        Vec3{0,0,0}, Vec3{-1,0,0}, Vec3{0,-1,0}})
        pair.vertices.push_back({pinch.nextId++, p});
    for (std::size_t offset : {std::size_t(0), std::size_t(3)})
        pair.faces.push_back({pinch.nextId++, pinch.materials[0].id, {
            {pair.vertices[offset].id,{},std::nullopt}, {pair.vertices[offset+1].id,{},std::nullopt},
            {pair.vertices[offset+2].id,{},std::nullopt}}});
    const Id first = pair.vertices[0].id, other = pair.vertices[3].id;
    pinch.objects.push_back(pair);
    auto weld = Document::fromState(pinch, error);
    CHECK(weld);
    CHECK(weld->select({SelectionMode::Vertex, pair.id, {first,other}, {}}, error));
    unchanged(*weld, [&] { return weld->weldSelectedVertices(error); }, QStringLiteral("Non-manifold"));

    State normals = pinch;
    normals.objects[0].faces.resize(1);
    normals.objects[0].vertices.resize(3);
    normals.objects[0].faces[0].corners[0].normal = Vec3{1,0,0};
    normals.objects[0].faces[0].corners[1].normal = Vec3{-1,0,0};
    normals.objects[0].faces[0].corners[2].normal = Vec3{0,1,0};
    auto cancel = Document::fromState(normals, error);
    CHECK(cancel);
    objects(*cancel, {pair.id});
    unchanged(*cancel, [&] { return cancel->subdivide(error); }, QStringLiteral("normals cancel"));
    CHECK(cancel->flatNormals(error) && cancel->subdivide(error));
    normals.objects[0].faces[0].corners[2].normal.reset();
    CHECK(!validate(normals, error) && error.contains(QStringLiteral("every corner")));
}

static void rejectedImportsAndLegacy()
{
    const QByteArray fixture = externalFixture();
    Document document;
    primitive(document);
    std::vector<QByteArray> rejected;
    rejected.push_back(fixture.left(fixture.size() - 1));
    rejected.push_back(altered(fixture, [](QJsonObject &root, QByteArray &) {
        root["extensionsUsed"] = QJsonArray{"KHR_materials_unlit", "KHR_materials_clearcoat"};
    }));
    rejected.push_back(altered(fixture, [](QJsonObject &root, QByteArray &) {
        auto samplers = root["samplers"].toArray(); auto sampler = samplers[0].toObject();
        sampler["magFilter"] = 9729; samplers[0] = sampler; root["samplers"] = samplers;
    }));
    rejected.push_back(altered(fixture, [](QJsonObject &root, QByteArray &) {
        auto images = root["images"].toArray(); auto image = images[0].toObject();
        image["uri"] = "../../never-read.png"; images[0] = image; root["images"] = images;
    }));
    rejected.push_back(altered(fixture, [](QJsonObject &root, QByteArray &) {
        auto materials = root["materials"].toArray(); auto material = materials[0].toObject();
        material.remove("extensions"); materials[0] = material; root["materials"] = materials;
    }));
    rejected.push_back(altered(fixture, [](QJsonObject &, QByteArray &bin) {
        QByteArray nan; putFloat(nan, std::numeric_limits<float>::quiet_NaN());
        bin.replace(12, 4, nan);
    }));
    rejected.push_back(altered(fixture, [](QJsonObject &, QByteArray &bin) { bin.replace(32, 12, bin.left(12)); }));
    for (const auto &bad : rejected)
        unchanged(document, [&] { return document.import(bad, QStringLiteral("Bad"), error); });

    NovaModelDocument legacy;
    nova_model_init(&legacy);
    char diagnostic[1024]{};
    CHECK(nova_model_add(&legacy, NOVA_SHAPE_BOX, diagnostic, sizeof(diagnostic)));
    CHECK(nova_model_add(&legacy, NOVA_SHAPE_CYLINDER, diagnostic, sizeof(diagnostic)));
    legacy.primitives[1].position[0] = 2;
    unsigned char *bytes = nullptr; std::size_t length = 0;
    CHECK(nova_model_serialize(&legacy, &bytes, &length, diagnostic, sizeof(diagnostic)));
    const QByteArray sourceBytes(reinterpret_cast<const char *>(bytes), static_cast<qsizetype>(length));
    std::free(bytes);
    NovaModelDocument parsed;
    CHECK(nova_model_parse(reinterpret_cast<const unsigned char *>(sourceBytes.constData()),
        static_cast<std::size_t>(sourceBytes.size()), &parsed, diagnostic, sizeof(diagnostic)));
    CHECK(parsed.count == 2);
    badSource(sourceBytes, *document.state());
    CHECK(nova_model_glb(&parsed, &bytes, &length, diagnostic, sizeof(diagnostic)));
    const QByteArray glb(reinterpret_cast<const char *>(bytes), static_cast<qsizetype>(length));
    std::free(bytes);
    State converted;
    CHECK(importGlb(glb, QStringLiteral("Explicit legacy export"), converted, error));
    QByteArray output;
    CHECK(exportGlb(converted, output, error));
    Native legacyOutput(glb), convertedOutput(output);
    CHECK(signature(legacyOutput) == signature(convertedOutput));
    for (unsigned i = 0; i < 20; ++i) {
        State temporary;
        CHECK(importGlb(fixture, QStringLiteral("Lifetime"), temporary, error));
        CHECK(exportGlb(temporary, output, error));
        CHECK(!importGlb(rejected[i % rejected.size()], QStringLiteral("Invalid lifetime"), temporary, error));
    }
}

static void borrowedInputs()
{
    const QByteArray expected = externalFixture();
    std::vector<char> input(expected.constData(), expected.constData() + expected.size());
    const QByteArray borrowed = QByteArray::fromRawData(input.data(), static_cast<qsizetype>(input.size()));
    State imported;
    CHECK(importGlb(borrowed, QStringLiteral("Borrowed source"), imported, error));
    std::fill(input.begin(), input.end(), '\0');
    CHECK(imported.originals[0].glb == expected);

    const QByteArray expectedPng = png();
    std::vector<char> pixels(expectedPng.constData(), expectedPng.constData() + expectedPng.size());
    const QByteArray borrowedPng = QByteArray::fromRawData(pixels.data(), static_cast<qsizetype>(pixels.size()));
    Document document;
    Id texture = 0;
    CHECK(document.addTexture(QStringLiteral("Borrowed texture"), borrowedPng, texture, error));
    const auto snapshot = document.snapshot(false, error);
    CHECK(snapshot);
    std::fill(pixels.begin(), pixels.end(), '\0');
    CHECK(document.state()->textures[0].png == expectedPng && source(document) == snapshot->source);

    Document original;
    primitive(original);
    State external = *original.state();
    std::vector<QChar> characters{QChar('T'), QChar('e'), QChar('s'), QChar('t')};
    external.objects[0].name = QString::fromRawData(characters.data(), static_cast<qsizetype>(characters.size()));
    auto owned = Document::fromState(external, error);
    CHECK(owned);
    characters[0] = QChar('B');
    CHECK(owned->state()->objects[0].name == QStringLiteral("Test"));
    CHECK(original.commit(external, {}, original.revision(), QStringLiteral("Borrowed name"), error));
    characters[1] = QChar('x');
    CHECK(original.state()->objects[0].name == QStringLiteral("Best"));
    std::shared_ptr<const State> retainedState;
    std::shared_ptr<const ByteSnapshot> retainedBytes;
    {
        Document temporary;
        primitive(temporary);
        CHECK(temporary.addTexture(QStringLiteral("Retained pixels"), expectedPng, texture, error));
        retainedState = temporary.state();
        retainedBytes = temporary.snapshot(true, error);
        CHECK(retainedBytes);
    }
    CHECK(validate(*retainedState, error) && retainedState->textures[0].png == expectedPng);
    CHECK(Document::open(retainedBytes->source, error));
    Native retainedNative(retainedBytes->glb);
    CHECK(retainedNative.model.meshCount == 1 && retainedNative.images.count == 1);
}

#ifdef NOVA_MESH_ALLOCATION_TEST
extern "C" {
void nova_mesh_test_fail_after(unsigned allocations, unsigned images);
void nova_mesh_test_balance(void);
void nova_mesh_test_report(void);
}

static void allocationFailures()
{
    Document document;
    primitive(document);
    const QByteArray fixture = externalFixture();
    for (unsigned failure = 1; failure <= 45; ++failure) {
        nova_mesh_test_fail_after(failure, 0);
        unchanged(document, [&] { return document.import(fixture, QStringLiteral("Allocation failure"), error); });
        nova_mesh_test_fail_after(0, 0);
        nova_mesh_test_balance();
    }
    for (unsigned failure = 1; failure <= 5; ++failure) {
        nova_mesh_test_fail_after(0, failure);
        unchanged(document, [&] { return document.import(fixture, QStringLiteral("Image failure"), error); });
        nova_mesh_test_fail_after(0, 0);
        nova_mesh_test_balance();
    }
}
#endif

static void capacity()
{
    Document objectsDocument;
    for (std::size_t i = 0; i < MaxObjects; ++i) primitive(objectsDocument, Primitive::Plane);
    Id retained = 999;
    unchanged(objectsDocument, [&] {
        return objectsDocument.addPrimitive(Primitive::Box, QStringLiteral("Overflow"), 12, retained, error);
    }, QStringLiteral("128"));
    CHECK(retained == 999);
    CHECK(objectsDocument.historyBytes() <= MaxUndoBytes);
    unsigned undoCount = 0;
    while (objectsDocument.canUndo()) { CHECK(objectsDocument.undo(error)); ++undoCount; }
    CHECK(undoCount == MaxUndoCommands);
    State exhausted;
    exhausted.nextId = std::numeric_limits<Id>::max();
    auto ids = Document::fromState(exhausted, error);
    CHECK(ids);
    unchanged(*ids, [&] { return ids->addPrimitive(Primitive::Box, QStringLiteral("Overflow"), 12, retained, error); },
        QStringLiteral("exhausted"));
    {
        QByteArray boundary = source(objectsDocument);
        boundary.resize(static_cast<qsizetype>(MaxSourceBytes), ' ');
        State parsed;
        CHECK(parseSource(boundary, parsed, error));
        boundary.append(' ');
        CHECK(!parseSource(boundary, parsed, error) && error.contains(QStringLiteral("1..64 MiB")));
        QByteArray retainedSource;
        CHECK(serializeSource(parsed, retainedSource, error) && retainedSource == source(objectsDocument));
    }
    State textures;
    for (unsigned i = 0; i < 5; ++i)
        textures.textures.push_back({textures.nextId++, QStringLiteral("Large %1").arg(i), png(1024, 1024, i)});
    CHECK(!validate(textures, error) && error.contains(QStringLiteral("pixel")));
    textures.textures.pop_back();
    CHECK(validate(textures, error));
    textures.textures[0].png = png(1025, 1);
    CHECK(!validate(textures, error));

    Document largeBytes;
    primitive(largeBytes);
    State padded = *largeBytes.state();
    for (unsigned i = 0; i < 16; ++i) {
        QByteArray image = png(4, 4, i);
        image.resize(1024 * 1024, '\0');
        padded.textures.push_back({padded.nextId++, QStringLiteral("Padded %1").arg(i), image});
    }
    CHECK(validate(padded, error));
    {
        State oversized = padded;
        oversized.textures[0].png.append('\0');
        CHECK(!validate(oversized, error) && error.contains(QStringLiteral("1 MiB")));
    }
    auto limited = Document::fromState(padded, error);
    CHECK(limited);
    QByteArray output = "retained";
    CHECK(!exportGlb(padded, output, error) && output == "retained" && error.contains(QStringLiteral("16 MiB")));
    const Id id = padded.objects[0].id;
    for (int i = 0; i < 6; ++i) CHECK(limited->rename(id, QStringLiteral("Body %1").arg(i), error));
    const auto sourceOnly = limited->snapshot(false, error);
    CHECK(sourceOnly && sourceOnly->glb.isEmpty() && limited->dirty());
    CHECK(limited->markPersisted(*sourceOnly, error) && !limited->dirty());
    CHECK(!limited->snapshot(true, error) && !limited->dirty());
    CHECK(limited->historyBytes() <= MaxUndoBytes);
    undoCount = 0;
    while (limited->canUndo()) { CHECK(limited->undo(error)); ++undoCount; }
    CHECK(undoCount > 0 && undoCount < 6);

    State large;
    Object object;
    object.id = large.nextId++; object.name = QStringLiteral("Native vertex boundary");
    const Id material = large.nextId++;
    large.materials.push_back({material, QStringLiteral("Default"), {1, 1, 1}, 0});
    auto triangle = [&] {
        const double x = static_cast<double>(object.faces.size() * 2);
        Face face{large.nextId++, material, {}};
        for (Vec3 position : {Vec3{x,0,0}, Vec3{x+1,0,0}, Vec3{x,1,0}}) {
            const Id vertex = large.nextId++;
            object.vertices.push_back({vertex, position});
            face.corners.push_back({vertex, {}, std::nullopt});
        }
        object.faces.push_back(std::move(face));
    };
    for (std::size_t i = 0; i < MaxVertices / 3; ++i) triangle();
    large.objects.push_back(std::move(object));
    CHECK(validate(large, error));
    CHECK(exportGlb(large, output, error));
    {
        Native decoded(output);
        CHECK(decoded.model.meshCount == 5);
        std::size_t count = 0;
        for (int i = 0; i < decoded.model.meshCount; ++i) {
            CHECK(decoded.model.meshes[i].vertexCount <= 65535);
            count += static_cast<std::size_t>(decoded.model.meshes[i].vertexCount);
        }
        CHECK(count == 262143 && decoded.model.meshes[4].vertexCount == 3);
        CHECK(decoded.model.meshes[4].vertices[6] == 174760 && decoded.model.meshes[4].vertices[7] == 1);
    }
    object = std::move(large.objects[0]);
    triangle();
    large.objects[0] = std::move(object);
    CHECK(!validate(large, error) && error.contains(QStringLiteral("262,144")));
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    SetTraceLogLevel(LOG_NONE);
    CHECK(argc == 2);
    if (!std::strcmp(argv[1], "document")) {
        documentOperations(); topologyOperations(); topologyRejections(); materialsAndUvs(); sourceContracts();
    } else if (!std::strcmp(argv[1], "native")) {
        nativeRoundTrips(); mirrorUvSurface(); rejectedImportsAndLegacy(); borrowedInputs();
    } else if (!std::strcmp(argv[1], "capacity")) capacity();
    else CHECK(false);
#ifdef NOVA_MESH_ALLOCATION_TEST
    allocationFailures();
    nova_mesh_test_report();
#endif
    std::printf("Mesh %s: %u checks passed (CPU only).\n", argv[1], checks);
    return 0;
}
