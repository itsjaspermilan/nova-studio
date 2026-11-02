#include "internal.hpp"

extern "C" {
#include "assets.h"
}
#include <cgltf.h>
#include <cstring>

namespace nova::mesh::detail {

static_assert(MaxVertices == NOVA_MODEL_VERTEX_LIMIT);
static_assert(MaxGlbBytes == NOVA_ASSET_FILE_LIMIT);
static_assert(MaxTextures == NOVA_MODEL_TEXTURES);

struct NativeModel {
    ::Model model{};
    NovaModelImages images{};
    NativeModel() = default;
    NativeModel(const NativeModel &) = delete;
    NativeModel &operator=(const NativeModel &) = delete;
    ~NativeModel() { nova_unload_cpu_model(&model); nova_unload_model_images(&images); }
    void decode(const QByteArray &bytes)
    {
        require(!bytes.isEmpty() && static_cast<std::size_t>(bytes.size()) <= MaxGlbBytes,
            QStringLiteral("A static GLB must contain 1..16 MiB."));
        char error[1024]{};
        const bool ok = nova_decode_glb_images(reinterpret_cast<const unsigned char *>(bytes.constData()),
            static_cast<int>(bytes.size()), &model, &images, error, sizeof(error));
        require(ok, QStringLiteral("Native GLB decoder: %1").arg(QString::fromUtf8(error)));
    }
};

void checkNativeGlb(const QByteArray &bytes)
{
    NativeModel model;
    model.decode(bytes);
}

void checkTexture(const QByteArray &png, std::size_t &pixels)
{
    require(!png.isEmpty() && png.size() <= NOVA_MODEL_TEXTURE_BYTES,
        QStringLiteral("Model textures require an opaque PNG of at most 1 MiB."));
    Image image{};
    char error[1024]{};
    const bool ok = nova_decode_model_png(reinterpret_cast<const unsigned char *>(png.constData()),
        static_cast<int>(png.size()), &image, error, sizeof(error));
    if (ok) pixels += static_cast<std::size_t>(image.width) * static_cast<std::size_t>(image.height);
    if (image.data) UnloadImage(image);
    require(ok, QStringLiteral("Native texture decoder: %1").arg(QString::fromUtf8(error)));
}

static Vec3 normalTransform(Vec3 normal, const float *matrix)
{
    const Vec3 a{matrix[0], matrix[1], matrix[2]}, b{matrix[4], matrix[5], matrix[6]},
        c{matrix[8], matrix[9], matrix[10]};
    const double determinant = dot(a, cross(b, c));
    require(std::isfinite(determinant) && std::abs(determinant) > 1e-20,
        QStringLiteral("A singular node transform cannot preserve authored normals."));
    return unit((cross(b, c) * normal.x + cross(c, a) * normal.y + cross(a, b) * normal.z) / determinant);
}

static QString importedName(const char *text, const QString &fallback)
{
    if (!text) return fallback;
    require(std::strlen(text) <= 512, QStringLiteral("An imported name exceeds 512 UTF-8 bytes."));
    const QString name = QString::fromUtf8(text);
    require(name.toUtf8() == QByteArray(text), QStringLiteral("An imported name contains invalid UTF-8."));
    checkName(name);
    return name;
}

void readGlb(const QByteArray &bytes, const QString &name, State &output)
{
    checkName(name);
    NativeModel native;
    native.decode(bytes);
    cgltf_options options{};
    cgltf_data *raw = nullptr;
    require(cgltf_parse(&options, bytes.constData(), static_cast<std::size_t>(bytes.size()), &raw) == cgltf_result_success,
        QStringLiteral("Cannot allocate the validated GLB metadata."));
    const std::unique_ptr<cgltf_data, decltype(&cgltf_free)> data(raw, cgltf_free);
    data->buffers[0].data = const_cast<void *>(data->bin);
    State result;
    std::vector<Id> textures, materials;
    for (std::size_t i = 0; i < data->images_count; ++i) {
        const auto &image = data->images[i];
        const QString label = importedName(image.name, QStringLiteral("Texture %1").arg(i + 1));
        checkName(label);
        const Id id = allocate(result);
        result.textures.push_back({id, label, QByteArray(static_cast<const char *>(data->bin) +
            image.buffer_view->offset, static_cast<qsizetype>(image.buffer_view->size))});
        textures.push_back(id);
    }
    for (std::size_t i = 0; i < data->materials_count; ++i) {
        const auto &material = data->materials[i];
        const auto &base = material.pbr_metallic_roughness;
        const QString label = importedName(material.name, QStringLiteral("Material %1").arg(i + 1));
        checkName(label);
        const Id id = allocate(result);
        const Id texture = base.base_color_texture.texture ?
            textures.at(static_cast<std::size_t>(base.base_color_texture.texture->image - data->images)) : 0;
        result.materials.push_back({id, label,
            {base.base_color_factor[0], base.base_color_factor[1], base.base_color_factor[2]}, texture});
        materials.push_back(id);
    }
    Id defaultMaterial = 0;
    std::size_t slot = 0;
    for (std::size_t nodeIndex = 0; nodeIndex < data->nodes_count; ++nodeIndex) {
        const cgltf_node &node = data->nodes[nodeIndex];
        if (!node.mesh) continue;
        float matrix[16];
        cgltf_node_transform_world(&node, matrix);
        const Vec3 a{matrix[0], matrix[1], matrix[2]}, b{matrix[4], matrix[5], matrix[6]},
            c{matrix[8], matrix[9], matrix[10]};
        const bool mirrored = dot(a, cross(b, c)) < 0;
        for (std::size_t primitiveIndex = 0; primitiveIndex < node.mesh->primitives_count; ++primitiveIndex, ++slot) {
            const auto &primitive = node.mesh->primitives[primitiveIndex];
            const auto &decoded = native.model.meshes[slot];
            Object object;
            object.id = allocate(result);
            object.name = importedName(node.name ? node.name : node.mesh->name, QStringLiteral("Mesh %1").arg(slot + 1));
            if (node.mesh->primitives_count > 1) object.name += QStringLiteral(" / %1").arg(primitiveIndex + 1);
            checkName(object.name);
            const cgltf_accessor *normal = nullptr;
            for (std::size_t i = 0; i < primitive.attributes_count; ++i)
                if (primitive.attributes[i].type == cgltf_attribute_type_normal) normal = primitive.attributes[i].data;
            Id material;
            if (primitive.material) material = materials.at(static_cast<std::size_t>(primitive.material - data->materials));
            else {
                if (!defaultMaterial) {
                    defaultMaterial = allocate(result);
                    result.materials.push_back({defaultMaterial, QStringLiteral("Default"), {1, 1, 1}, 0});
                }
                material = defaultMaterial;
            }
            std::map<std::size_t, Id> indices;
            for (int triangle = 0; triangle < decoded.triangleCount; ++triangle) {
                Face face;
                face.id = allocate(result); face.material = material;
                for (int k = 0; k < 3; ++k) {
                    const auto destination = static_cast<std::size_t>(triangle * 3 + k);
                    const auto source = static_cast<std::size_t>(triangle * 3 + (mirrored && k ? 3 - k : k));
                    const auto index = primitive.indices ? cgltf_accessor_read_index(primitive.indices, source) : source;
                    auto [it, inserted] = indices.emplace(index, 0);
                    if (inserted) {
                        it->second = allocate(result);
                        object.vertices.push_back({it->second, {decoded.vertices[destination * 3],
                            decoded.vertices[destination * 3 + 1], decoded.vertices[destination * 3 + 2]}});
                    }
                    Corner value = corner(it->second);
                    if (decoded.texcoords) value.uv = {decoded.texcoords[destination * 2], decoded.texcoords[destination * 2 + 1]};
                    if (normal) {
                        float v[3];
                        require(index < normal->count && cgltf_accessor_read_float(normal, index, v, 3),
                            QStringLiteral("The authored NORMAL accessor does not cover every referenced vertex."));
                        value.normal = normalTransform({v[0], v[1], v[2]}, matrix);
                    }
                    face.corners.push_back(value);
                }
                object.faces.push_back(std::move(face));
            }
            result.objects.push_back(std::move(object));
        }
    }
    output = std::move(result);
}

} // namespace nova::mesh::detail

namespace nova::mesh {
using namespace detail;

bool importGlb(const QByteArray &bytes, const QString &name, State &state, QString &error)
{
    return checked(error, [&] {
        State result;
        readGlb(bytes, name, result);
        const Id original = allocate(result);
        result.originals.push_back({original, name, bytes});
        for (auto &object : result.objects) object.original = original;
        ownData(result);
        checkState(result);
        state = std::move(result);
    });
}

} // namespace nova::mesh
