#include "sprite/document.hpp"

extern "C" {
#include "assets.h"
}

#include <QtTest>

using namespace nova::sprite;

class SpriteRuntimePngTest : public QObject {
    Q_OBJECT
private slots:
    void exactNativePixels();
};

void SpriteRuntimePngTest::exactNativePixels()
{
    Document document;
    QString error;
    QVERIFY(document.create({7, 5}, "Native PNG", RasterMode::Pixel, error));
    Id frame = document.state().frames[0].id, layer = document.state().layers[0].id;
    QImage cel = document.cel(frame, layer);
    for (int y = 0; y < cel.height(); ++y)
        for (int x = 0; x < cel.width(); ++x)
            cel.setPixel(x, y, qRgba(x * 37, y * 49, 255 - x * 29, (x + y) * 23));
    QVERIFY(document.setCel(frame, layer, cel, "Asymmetric pixels", error));
    ExportBundle bundle;
    QVERIFY2(document.exportBundle(bundle, error), qPrintable(error));
    QImage expected = composite(document.state(), frame);
    Image native{};
    char detail[512]{};
    const QByteArray &png = bundle.frames[0].png;
    QVERIFY2(nova_decode_sprite(reinterpret_cast<const unsigned char *>(png.constData()), int(png.size()),
                              &native, detail, sizeof(detail)), detail);
    QCOMPARE(native.width, 7);
    QCOMPARE(native.height, 5);
    for (int y = 0; y < native.height; ++y) for (int x = 0; x < native.width; ++x) {
        Color pixel = GetImageColor(native, x, y);
        QColor color = expected.pixelColor(x, y);
        QCOMPARE(int(pixel.r), color.red()); QCOMPARE(int(pixel.g), color.green());
        QCOMPARE(int(pixel.b), color.blue()); QCOMPARE(int(pixel.a), color.alpha());
    }
    UnloadImage(native);
}

QTEST_GUILESS_MAIN(SpriteRuntimePngTest)
#include "sprite_runtime_png_test.moc"
