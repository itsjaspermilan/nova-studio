#include "mesh/document.hpp"

#include <QBuffer>
#include <QImage>
#include <QtTest>

extern "C" {
#include "assets.h"
}

namespace {

struct CpuModel {
    Model model{};
    NovaModelImages images{};
    ~CpuModel()
    {
        nova_unload_cpu_model(&model);
        nova_unload_model_images(&images);
    }
};

} // namespace

class QtMeshHostTest final : public QObject {
    Q_OBJECT
private slots:
    void texturedSnapshotsUseSelectedHost();
};

void QtMeshHostTest::texturedSnapshotsUseSelectedHost()
{
    using namespace nova::mesh;
    QVERIFY(!IsAudioDeviceReady());
    QImage image(2, 2, QImage::Format_RGBA8888);
    image.setPixelColor(0, 0, QColor(211, 37, 19));
    image.setPixelColor(1, 0, QColor(17, 179, 61));
    image.setPixelColor(0, 1, QColor(41, 73, 223));
    image.setPixelColor(1, 1, QColor(239, 191, 23));
    QByteArray png;
    QBuffer buffer(&png);
    QVERIFY(buffer.open(QIODevice::WriteOnly));
    QVERIFY(image.save(&buffer, "PNG"));
    buffer.close();

    Document document;
    QString error;
    Id object = 0, texture = 0, material = 0;
    QVERIFY2(document.addPrimitive(Primitive::Box, "Body", 12, object, error), qPrintable(error));
    QVERIFY2(document.addTexture("Livery", png, texture, error), qPrintable(error));
    QVERIFY2(document.addMaterial("Paint", {0.25, 0.5, 0.75}, texture, material, error), qPrintable(error));
    QVERIFY2(document.select({SelectionMode::Object, 0, {object}, {}}, error), qPrintable(error));
    QVERIFY2(document.assignMaterial(material, error), qPrintable(error));
    const auto snapshot = document.snapshot(true, error);
    QVERIFY2(snapshot, qPrintable(error));
    QVERIFY(!snapshot->source.isEmpty());
    QVERIFY(!snapshot->glb.isEmpty());

    CpuModel decoded;
    char nativeError[1024]{};
    QVERIFY2(nova_decode_glb_images(
        reinterpret_cast<const unsigned char *>(snapshot->glb.constData()),
        static_cast<int>(snapshot->glb.size()), &decoded.model, &decoded.images,
        nativeError, sizeof(nativeError)), nativeError);
    QVERIFY(decoded.model.meshCount > 0);
    QCOMPARE(decoded.images.count, size_t{1});
    const Image &nativeImage = decoded.images.images[0];
    QCOMPARE(nativeImage.width, image.width());
    QCOMPARE(nativeImage.height, image.height());
    for (int y = 0; y < image.height(); ++y) {
        for (int x = 0; x < image.width(); ++x) {
            const Color actual = GetImageColor(nativeImage, x, y);
            const QColor expected = image.pixelColor(x, y);
            QCOMPARE(int(actual.r), expected.red());
            QCOMPARE(int(actual.g), expected.green());
            QCOMPARE(int(actual.b), expected.blue());
            QCOMPARE(int(actual.a), expected.alpha());
        }
    }
    int triangles = 0;
    for (int index = 0; index < decoded.model.meshCount; ++index) {
        const Mesh &mesh = decoded.model.meshes[index];
        QVERIFY(mesh.vertices);
        QVERIFY(mesh.colors);
        QVERIFY(mesh.texcoords);
        triangles += mesh.triangleCount;
    }
    QCOMPARE(triangles, 12);

    Document imported;
    QVERIFY2(imported.import(snapshot->glb, "Round trip", error), qPrintable(error));
    QCOMPARE(imported.state()->originals.size(), size_t{1});
    QCOMPARE(imported.state()->originals[0].glb, snapshot->glb);
    Preview preview;
    QVERIFY2(nova::mesh::preview(*imported.state(), preview, error), qPrintable(error));
    QCOMPARE(preview.triangles.size(), size_t{12});
    const auto reopened = Document::open(snapshot->source, error);
    QVERIFY2(reopened, qPrintable(error));
    QVERIFY(!reopened->dirty());
    QVERIFY2(document.markPersisted(*snapshot, error), qPrintable(error));
    QVERIFY(!document.dirty());
    QVERIFY(!IsAudioDeviceReady());
}

QTEST_GUILESS_MAIN(QtMeshHostTest)
#include "qt_mesh_host_test.moc"
