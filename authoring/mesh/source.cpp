#include "internal.hpp"

#include <QCryptographicHash>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonParseError>

namespace nova::mesh::detail {

static QJsonArray vector(Vec3 v) { return {v.x, v.y, v.z}; }

QByteArray sourceBytes(const State &state)
{
    QJsonArray groups, textures, materials, objects, originals;
    for (const auto &g : state.groups) groups.append(QJsonArray{static_cast<double>(g.id), g.name});
    for (const auto &t : state.textures)
        textures.append(QJsonArray{static_cast<double>(t.id), t.name, QString::fromLatin1(t.png.toBase64())});
    for (const auto &m : state.materials)
        materials.append(QJsonArray{static_cast<double>(m.id), m.name, m.color.x, m.color.y, m.color.z,
            static_cast<double>(m.texture)});
    for (const auto &o : state.objects) {
        QJsonArray vertices, faces;
        for (const auto &v : o.vertices)
            vertices.append(QJsonArray{static_cast<double>(v.id), v.position.x, v.position.y, v.position.z});
        for (const auto &f : o.faces) {
            QJsonArray corners;
            for (const auto &c : f.corners)
                corners.append(QJsonArray{static_cast<double>(c.vertex), c.uv.x, c.uv.y,
                    c.normal ? QJsonValue(vector(*c.normal)) : QJsonValue(QJsonValue::Null)});
            faces.append(QJsonArray{static_cast<double>(f.id), static_cast<double>(f.material), corners});
        }
        objects.append(QJsonArray{static_cast<double>(o.id), o.name, static_cast<double>(o.group),
            vector(o.origin), vertices, faces, static_cast<double>(o.original)});
    }
    for (const auto &o : state.originals)
        originals.append(QJsonArray{static_cast<double>(o.id), o.name, QString::fromLatin1(o.glb.toBase64()),
            QString::fromLatin1(QCryptographicHash::hash(o.glb, QCryptographicHash::Sha256).toHex())});
    QByteArray result = QJsonDocument(QJsonArray{QStringLiteral("nova-mesh"), 1,
        static_cast<double>(state.nextId), groups, textures, materials, objects, originals}).toJson(QJsonDocument::Compact);
    result.append('\n');
    require(static_cast<std::size_t>(result.size()) <= MaxSourceBytes,
        QStringLiteral("Editable mesh source exceeds the 64 MiB limit."));
    return result;
}

static QJsonArray array(const QJsonValue &value, qsizetype count, const QString &context)
{
    require(value.isArray(), context + QStringLiteral(" must be an array."));
    const QJsonArray result = value.toArray();
    require(result.size() == count, context + QStringLiteral(" has unknown or missing fields."));
    return result;
}

static QJsonArray list(const QJsonValue &value, std::size_t maximum, const QString &context)
{
    require(value.isArray(), context + QStringLiteral(" must be an array."));
    const QJsonArray result = value.toArray();
    require(static_cast<std::size_t>(result.size()) <= maximum, context + QStringLiteral(" exceeds its count limit."));
    return result;
}

static double number(const QJsonValue &value)
{
    require(value.isDouble() && std::isfinite(value.toDouble()), QStringLiteral("A finite JSON number is required."));
    return value.toDouble();
}

static Id identifier(const QJsonValue &value)
{
    const double n = number(value);
    require(n >= 0 && n <= std::numeric_limits<Id>::max() && std::floor(n) == n,
        QStringLiteral("Stable IDs require exact unsigned 32-bit integers."));
    return static_cast<Id>(n);
}

static QString name(const QJsonValue &value)
{
    require(value.isString(), QStringLiteral("A name must be a string."));
    const QString result = value.toString();
    checkName(result);
    return result;
}

static Vec3 vector(const QJsonValue &value)
{
    const auto v = array(value, 3, QStringLiteral("Vector"));
    return {number(v[0]), number(v[1]), number(v[2])};
}

static QByteArray binary(const QJsonValue &value, std::size_t limit)
{
    require(value.isString(), QStringLiteral("Embedded bytes must be canonical base64 strings."));
    const QString text = value.toString();
    require(static_cast<std::size_t>(text.size()) <= ((limit + 2) / 3) * 4,
        QStringLiteral("Embedded bytes exceed their size limit."));
    const QByteArray encoded = text.toLatin1();
    require(QString::fromLatin1(encoded) == text, QStringLiteral("Base64 must be ASCII."));
    auto decoded = QByteArray::fromBase64Encoding(encoded, QByteArray::AbortOnBase64DecodingErrors);
    require(static_cast<bool>(decoded) && decoded.decoded.toBase64() == encoded &&
        static_cast<std::size_t>(decoded.decoded.size()) <= limit,
        QStringLiteral("Embedded bytes contain invalid or noncanonical base64."));
    return decoded.decoded;
}

} // namespace nova::mesh::detail

namespace nova::mesh {
using namespace detail;

bool serializeSource(const State &state, QByteArray &bytes, QString &error)
{
    return checked(error, [&] {
        checkState(state);
        QByteArray result = sourceBytes(state);
        bytes = std::move(result);
    });
}

bool parseSource(const QByteArray &bytes, State &state, QString &error)
{
    return checked(error, [&] {
        require(!bytes.isEmpty() && static_cast<std::size_t>(bytes.size()) <= MaxSourceBytes,
            QStringLiteral("Editable mesh source requires 1..64 MiB of UTF-8 JSON."));
        require(!bytes.startsWith("nova-model"),
            QStringLiteral("Legacy nova-model v1/v2 is not nova-mesh. Keep its source and explicitly import its exported GLB."));
        QJsonParseError parseError;
        const QJsonDocument json = QJsonDocument::fromJson(bytes, &parseError);
        require(parseError.error == QJsonParseError::NoError,
            QStringLiteral("Invalid mesh JSON at byte %1: %2").arg(parseError.offset).arg(parseError.errorString()));
        require(json.isArray(), QStringLiteral("nova-mesh uses fixed-array records, not JSON objects."));
        const auto root = array(json.array(), 8, QStringLiteral("nova-mesh root"));
        require(root[0].isString() && root[0].toString() == QStringLiteral("nova-mesh") && number(root[1]) == 1,
            QStringLiteral("Unsupported editable mesh format or version; expected nova-mesh version 1."));
        State result;
        result.nextId = identifier(root[2]);
        for (const auto &entry : list(root[3], MaxGroups, QStringLiteral("Groups"))) {
            const auto v = array(entry, 2, QStringLiteral("Group"));
            result.groups.push_back({identifier(v[0]), name(v[1])});
        }
        for (const auto &entry : list(root[4], MaxTextures, QStringLiteral("Textures"))) {
            const auto v = array(entry, 3, QStringLiteral("Texture"));
            result.textures.push_back({identifier(v[0]), name(v[1]), binary(v[2], 1024 * 1024)});
        }
        for (const auto &entry : list(root[5], MaxMaterials, QStringLiteral("Materials"))) {
            const auto v = array(entry, 6, QStringLiteral("Material"));
            result.materials.push_back({identifier(v[0]), name(v[1]),
                {number(v[2]), number(v[3]), number(v[4])}, identifier(v[5])});
        }
        std::size_t vertexCount = 0, cornerCount = 0;
        for (const auto &entry : list(root[6], MaxObjects, QStringLiteral("Objects"))) {
            const auto v = array(entry, 7, QStringLiteral("Object"));
            Object object;
            object.id = identifier(v[0]); object.name = name(v[1]);
            object.group = identifier(v[2]); object.origin = vector(v[3]);
            object.original = identifier(v[6]);
            const auto vertices = list(v[4], MaxVertices - vertexCount, QStringLiteral("Vertices"));
            vertexCount += static_cast<std::size_t>(vertices.size());
            for (const auto &vertex : vertices) {
                const auto p = array(vertex, 4, QStringLiteral("Vertex"));
                object.vertices.push_back({identifier(p[0]), {number(p[1]), number(p[2]), number(p[3])}});
            }
            for (const auto &face : list(v[5], MaxVertices / 3, QStringLiteral("Faces"))) {
                const auto f = array(face, 3, QStringLiteral("Face"));
                Face output;
                output.id = identifier(f[0]); output.material = identifier(f[1]);
                const auto corners = list(f[2], MaxCornersPerFace, QStringLiteral("Face corners"));
                require(static_cast<std::size_t>(corners.size()) <= MaxVertices - cornerCount,
                    QStringLiteral("The total corner budget was exceeded."));
                cornerCount += static_cast<std::size_t>(corners.size());
                for (const auto &corner : corners) {
                    const auto c = array(corner, 4, QStringLiteral("Corner"));
                    output.corners.push_back({identifier(c[0]), {number(c[1]), number(c[2])},
                        c[3].isNull() ? std::nullopt : std::optional<Vec3>(vector(c[3]))});
                }
                object.faces.push_back(std::move(output));
            }
            result.objects.push_back(std::move(object));
        }
        std::size_t originalBytes = 0;
        for (const auto &entry : list(root[7], MaxOriginals, QStringLiteral("Originals"))) {
            const auto v = array(entry, 4, QStringLiteral("Original"));
            Original original{identifier(v[0]), name(v[1]), binary(v[2], MaxOriginalBytes - originalBytes)};
            originalBytes += static_cast<std::size_t>(original.glb.size());
            require(v[3].isString() && v[3].toString() ==
                QString::fromLatin1(QCryptographicHash::hash(original.glb, QCryptographicHash::Sha256).toHex()),
                QStringLiteral("An imported original's SHA-256 does not match its retained bytes."));
            result.originals.push_back(std::move(original));
        }
        checkState(result);
        state = std::move(result);
    });
}

} // namespace nova::mesh
