#include "icons.hpp"
#include <QPainter>
#include <QPainterPath>

namespace nova::sound {

QIcon icon(const QString &name, const QPalette &palette)
{
    QIcon result;
    for (int density : {1, 2, 3}) {
        for (auto mode : {QIcon::Normal, QIcon::Disabled}) {
            QPixmap image(24 * density, 24 * density);
            image.setDevicePixelRatio(density);
            image.fill(Qt::transparent);
            QPainter p(&image);
            p.setRenderHint(QPainter::Antialiasing);
            QColor color = palette.color(mode == QIcon::Disabled ? QPalette::Disabled : QPalette::Active, QPalette::Text);
            if (mode == QIcon::Normal && name == QStringLiteral("play")) color = palette.color(QPalette::Highlight);
            p.setPen(QPen(color, 1.7, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));
            const auto line = [&](int x, int y, int toX, int toY) { p.drawLine(x, y, toX, toY); };
            if (name == QStringLiteral("play")) {
                QPainterPath shape; shape.moveTo(7, 4); shape.lineTo(20, 12); shape.lineTo(7, 20); shape.closeSubpath();
                p.setBrush(color); p.drawPath(shape);
            } else if (name == QStringLiteral("stop")) {
                p.setBrush(color); p.drawRoundedRect(QRectF(5, 5, 14, 14), 2, 2);
            } else if (name == QStringLiteral("undo") || name == QStringLiteral("redo")) {
                if (name == QStringLiteral("redo")) { p.translate(24, 0); p.scale(-1, 1); }
                QPainterPath shape; shape.moveTo(4, 8); shape.lineTo(13, 8); shape.cubicTo(22, 8, 21, 19, 13, 20);
                p.drawPath(shape); line(4, 8, 9, 3); line(4, 8, 9, 13);
            } else if (name == QStringLiteral("add") || name == QStringLiteral("remove")) {
                line(5, 12, 19, 12);
                if (name == QStringLiteral("add")) line(12, 5, 12, 19);
            } else if (name == QStringLiteral("duplicate")) {
                p.drawRoundedRect(QRectF(8, 8, 12, 12), 2, 2);
                QPainterPath back; back.moveTo(4, 16); back.lineTo(4, 4); back.lineTo(16, 4); p.drawPath(back);
            } else if (name == QStringLiteral("zoomIn") || name == QStringLiteral("zoomOut")) {
                p.drawEllipse(QRectF(3, 3, 13, 13)); line(15, 15, 21, 21); line(6, 9, 13, 9);
                if (name == QStringLiteral("zoomIn")) line(10, 6, 10, 13);
            } else if (name == QStringLiteral("fit")) {
                line(4, 5, 4, 19); line(20, 5, 20, 19); line(4, 12, 20, 12);
                line(4, 12, 8, 8); line(4, 12, 8, 16); line(20, 12, 16, 8); line(20, 12, 16, 16);
            } else if (name == QStringLiteral("trim")) {
                line(5, 3, 5, 21); line(19, 3, 19, 21); line(9, 8, 9, 16);
                line(12, 5, 12, 19); line(15, 9, 15, 15);
            } else {
                line(3, 10, 3, 14); line(7, 6, 7, 18); line(12, 3, 12, 21);
                line(17, 7, 17, 17); line(21, 10, 21, 14);
            }
            p.end();
            result.addPixmap(image, mode);
        }
    }
    return result;
}

} // namespace nova::sound
