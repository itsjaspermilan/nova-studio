#include "internal.hpp"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

#include <cstring>

namespace nova::mesh::detail {

static void u32(QByteArray &bytes, std::uint32_t value)
{
    for (unsigned i = 0; i < 4; ++i) bytes.append(static_cast<char>((value >> (i * 8)) & 255));
}
static void scalar(QByteArray &bytes, double value)
{
    const float f = static_cast<float>(value);
    std::uint32_t bits;
    std::memcpy(&bits, &f, sizeof(bits));
    u32(bytes, bits);
}
static void align(QByteArray &bytes, char fill = '\0')
{
    while (bytes.size() % 4) bytes.append(fill);
}
static QJsonArray vector(Vec3 value) { return {value.x, value.y, value.z}; }

void writeGlb(const State &state, QByteArray &output)
{
    require(!state.objects.empty(), QStringLiteral("Add a mesh object before exporting a runtime GLB."));
    Preview geometry;
    QString error;
    require(preview(state, geometry, error), error);
    std::map<std::pair<Id, Id>, std::vector<const Triangle *>> batches;
    std::set<Id> usedMaterials;
    for (const auto &triangle : geometry.triangles) {
        batches[{triangle.object, triangle.material}].push_back(&triangle);
        usedMaterials.insert(triangle.material);
    }
    QJsonArray views, accessors, meshes, nodes, roots, images, textures, materials;
    QByteArray bin;
    auto view = [&](qsizetype offset, qsizetype length) {
        const auto index = views.size();
        views.append(QJsonObject{{QStringLiteral("buffer"), 0},
            {QStringLiteral("byteOffset"), static_cast<double>(offset)},
            {QStringLiteral("byteLength"), static_cast<double>(length)}});
        return index;
    };
    std::map<Id, qsizetype> textureIndices, materialIndices;
    for (const auto &texture : state.textures) {
        align(bin);
        const auto index = view(bin.size(), texture.png.size());
        bin.append(texture.png);
        textureIndices[texture.id] = images.size();
        images.append(QJsonObject{{QStringLiteral("bufferView"), static_cast<double>(index)},
            {QStringLiteral("mimeType"), QStringLiteral("image/png")}, {QStringLiteral("name"), texture.name}});
        textures.append(QJsonObject{{QStringLiteral("sampler"), 0},
            {QStringLiteral("source"), static_cast<double>(textures.size())}});
    }
    align(bin);
    for (const auto &material : state.materials) {
        if (!usedMaterials.count(material.id)) continue;
        QJsonObject base{{QStringLiteral("baseColorFactor"),
            QJsonArray{material.color.x, material.color.y, material.color.z, 1}}};
        if (material.texture)
            base.insert(QStringLiteral("baseColorTexture"),
                QJsonObject{{QStringLiteral("index"), static_cast<double>(textureIndices.at(material.texture))}});
        materialIndices[material.id] = materials.size();
        materials.append(QJsonObject{{QStringLiteral("name"), material.name},
            {QStringLiteral("extensions"), QJsonObject{{QStringLiteral("KHR_materials_unlit"), QJsonObject{}}}},
            {QStringLiteral("pbrMetallicRoughness"), base}});
    }
    for (const auto &object : state.objects) {
        QJsonArray primitives;
        for (const auto &material : state.materials) {
            const auto found = batches.find({object.id, material.id});
            if (found == batches.end()) continue;
            const auto &triangles = found->second;
            for (std::size_t start = 0; start < triangles.size(); start += 21845) {
                const std::size_t end = std::min(start + 21845, triangles.size());
                const auto count = static_cast<double>((end - start) * 3);
                const auto positionAccessor = accessors.size();
                Vec3 minimum{CoordinateLimit, CoordinateLimit, CoordinateLimit},
                    maximum{-CoordinateLimit, -CoordinateLimit, -CoordinateLimit};
                auto offset = bin.size();
                for (std::size_t t = start; t < end; ++t) for (Vec3 p : triangles[t]->positions) {
                    scalar(bin, p.x); scalar(bin, p.y); scalar(bin, p.z);
                    minimum = {std::min(minimum.x, p.x), std::min(minimum.y, p.y), std::min(minimum.z, p.z)};
                    maximum = {std::max(maximum.x, p.x), std::max(maximum.y, p.y), std::max(maximum.z, p.z)};
                }
                accessors.append(QJsonObject{{QStringLiteral("bufferView"), static_cast<double>(view(offset, bin.size() - offset))},
                    {QStringLiteral("componentType"), 5126}, {QStringLiteral("count"), count},
                    {QStringLiteral("type"), QStringLiteral("VEC3")}, {QStringLiteral("min"), vector(minimum)},
                    {QStringLiteral("max"), vector(maximum)}});
                offset = bin.size();
                for (std::size_t t = start; t < end; ++t) for (Vec3 n : triangles[t]->normals) {
                    scalar(bin, n.x); scalar(bin, n.y); scalar(bin, n.z);
                }
                accessors.append(QJsonObject{{QStringLiteral("bufferView"), static_cast<double>(view(offset, bin.size() - offset))},
                    {QStringLiteral("componentType"), 5126}, {QStringLiteral("count"), count},
                    {QStringLiteral("type"), QStringLiteral("VEC3")}});
                offset = bin.size();
                for (std::size_t t = start; t < end; ++t) for (Vec2 uv : triangles[t]->uvs) {
                    scalar(bin, uv.x); scalar(bin, uv.y);
                }
                accessors.append(QJsonObject{{QStringLiteral("bufferView"), static_cast<double>(view(offset, bin.size() - offset))},
                    {QStringLiteral("componentType"), 5126}, {QStringLiteral("count"), count},
                    {QStringLiteral("type"), QStringLiteral("VEC2")}});
                primitives.append(QJsonObject{{QStringLiteral("attributes"), QJsonObject{
                    {QStringLiteral("POSITION"), static_cast<double>(positionAccessor)},
                    {QStringLiteral("NORMAL"), static_cast<double>(positionAccessor + 1)},
                    {QStringLiteral("TEXCOORD_0"), static_cast<double>(positionAccessor + 2)}}},
                    {QStringLiteral("material"), static_cast<double>(materialIndices.at(material.id))},
                    {QStringLiteral("mode"), 4}});
                require(static_cast<std::size_t>(bin.size()) <= MaxGlbBytes,
                    QStringLiteral("GLB geometry and textures exceed 16 MiB."));
            }
        }
        roots.append(static_cast<double>(nodes.size()));
        nodes.append(QJsonObject{{QStringLiteral("mesh"), static_cast<double>(meshes.size())},
            {QStringLiteral("name"), object.name}});
        meshes.append(QJsonObject{{QStringLiteral("primitives"), primitives}, {QStringLiteral("name"), object.name}});
    }
    QJsonObject root{
        {QStringLiteral("asset"), QJsonObject{{QStringLiteral("version"), QStringLiteral("2.0")},
            {QStringLiteral("generator"), QStringLiteral("Nova editable mesh")}}},
        {QStringLiteral("extensionsUsed"), QJsonArray{QStringLiteral("KHR_materials_unlit")}},
        {QStringLiteral("extensionsRequired"), QJsonArray{QStringLiteral("KHR_materials_unlit")}},
        {QStringLiteral("buffers"), QJsonArray{QJsonObject{{QStringLiteral("byteLength"), static_cast<double>(bin.size())}}}},
        {QStringLiteral("bufferViews"), views}, {QStringLiteral("accessors"), accessors},
        {QStringLiteral("materials"), materials}, {QStringLiteral("meshes"), meshes},
        {QStringLiteral("nodes"), nodes}, {QStringLiteral("scenes"), QJsonArray{QJsonObject{{QStringLiteral("nodes"), roots}}}},
        {QStringLiteral("scene"), 0}};
    if (!textures.empty()) {
        root.insert(QStringLiteral("samplers"), QJsonArray{QJsonObject{
            {QStringLiteral("magFilter"), 9728}, {QStringLiteral("minFilter"), 9728},
            {QStringLiteral("wrapS"), 33071}, {QStringLiteral("wrapT"), 33071}}});
        root.insert(QStringLiteral("images"), images);
        root.insert(QStringLiteral("textures"), textures);
    }
    QByteArray json = QJsonDocument(root).toJson(QJsonDocument::Compact);
    align(json, ' ');
    align(bin);
    const auto size = static_cast<std::size_t>(28 + json.size() + bin.size());
    require(size <= MaxGlbBytes, QStringLiteral("GLB output exceeds the 16 MiB asset limit."));
    QByteArray result;
    result.reserve(static_cast<qsizetype>(size));
    result.append("glTF", 4); u32(result, 2); u32(result, static_cast<std::uint32_t>(size));
    u32(result, static_cast<std::uint32_t>(json.size())); result.append("JSON", 4); result.append(json);
    u32(result, static_cast<std::uint32_t>(bin.size())); result.append("BIN\0", 4); result.append(bin);
    checkNativeGlb(result);
    output = std::move(result);
}

} // namespace nova::mesh::detail

namespace nova::mesh {

bool exportGlb(const State &state, QByteArray &bytes, QString &error)
{
    return detail::checked(error, [&] { detail::writeGlb(state, bytes); });
}

} // namespace nova::mesh
