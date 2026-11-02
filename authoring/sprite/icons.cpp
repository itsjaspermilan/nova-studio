#include "icons.hpp"

#include <QIconEngine>
#include <QPainter>
#include <QPainterPath>

namespace nova::sprite {
namespace {

class VectorIcon final : public QIconEngine {
public:
    VectorIcon(Icon icon, QColor color) : icon_(icon), color_(color) {}
    QIconEngine *clone() const override { return new VectorIcon(icon_, color_); }
    void paint(QPainter *p, const QRect &rect, QIcon::Mode mode, QIcon::State) override
    {
        p->save();
        p->setRenderHint(QPainter::Antialiasing);
        p->translate(rect.center().x() - rect.width() / 2.0, rect.center().y() - rect.height() / 2.0);
        p->scale(rect.width() / 24.0, rect.height() / 24.0);
        QColor color = color_;
        if (mode == QIcon::Disabled) color.setAlpha(100);
        p->setPen(QPen(color, 1.65, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));
        p->setBrush(Qt::NoBrush);
        QPainterPath path;
        switch (icon_) {
        case Icon::Select:
            path.moveTo(5, 3); path.lineTo(19, 12); path.lineTo(12, 13);
            path.lineTo(9, 20); path.closeSubpath(); p->drawPath(path); break;
        case Icon::Move:
            p->drawLine(12, 3, 12, 21); p->drawLine(3, 12, 21, 12);
            p->drawPolyline(QPolygonF{{9, 6}, {12, 3}, {15, 6}});
            p->drawPolyline(QPolygonF{{9, 18}, {12, 21}, {15, 18}});
            p->drawPolyline(QPolygonF{{6, 9}, {3, 12}, {6, 15}});
            p->drawPolyline(QPolygonF{{18, 9}, {21, 12}, {18, 15}}); break;
        case Icon::Pencil:
        case Icon::Brush:
            path.moveTo(5, 15); path.lineTo(16, 4); path.lineTo(20, 8);
            path.lineTo(9, 19); path.closeSubpath(); p->drawPath(path);
            p->drawLine(14, 6, 18, 10);
            if (icon_ == Icon::Pencil) p->drawPolyline(QPolygonF{{5, 15}, {3, 21}, {9, 19}});
            else {
                path = QPainterPath(QPointF(6, 16));
                path.cubicTo(2, 16, 6, 21, 2, 21); path.cubicTo(7, 23, 11, 20, 8, 18);
                p->drawPath(path);
            }
            break;
        case Icon::Eraser:
            p->drawPolygon(QPolygonF{{3, 14}, {13, 4}, {21, 12}, {12, 21}, {9, 21}});
            p->drawLine(8, 9, 16, 17); p->drawLine(12, 21, 22, 21); break;
        case Icon::Fill:
            p->drawPolygon(QPolygonF{{3, 12}, {11, 4}, {20, 13}, {12, 21}});
            p->drawLine(7, 2, 12, 7); p->drawLine(3, 12, 19, 12);
            p->drawLine(21, 16, 21, 20); break;
        case Icon::Line: p->drawLine(4, 20, 20, 4); break;
        case Icon::Rectangle: p->drawRect(QRectF(4, 5, 16, 14)); break;
        case Icon::Ellipse: p->drawEllipse(QRectF(3, 5, 18, 14)); break;
        case Icon::Eyedropper:
            p->drawPolyline(QPolygonF{{13, 5}, {20, 12}, {21, 9}, {16, 4}, {13, 5}});
            p->drawPolygon(QPolygonF{{14, 7}, {4, 17}, {3, 21}, {7, 20}, {17, 10}});
            break;
        case Icon::Add: p->drawLine(12, 4, 12, 20); p->drawLine(4, 12, 20, 12); break;
        case Icon::Remove:
            p->drawLine(5, 6, 19, 6); p->drawLine(9, 3, 15, 3);
            p->drawPolyline(QPolygonF{{7, 6}, {8, 21}, {16, 21}, {17, 6}});
            p->drawLine(11, 10, 11, 17); p->drawLine(14, 10, 14, 17); break;
        case Icon::Duplicate:
            p->drawRect(QRectF(8, 8, 12, 13));
            p->drawPolyline(QPolygonF{{15, 8}, {15, 3}, {3, 3}, {3, 16}, {8, 16}}); break;
        case Icon::Previous: p->drawPolyline(QPolygonF{{15, 4}, {7, 12}, {15, 20}}); break;
        case Icon::Next: p->drawPolyline(QPolygonF{{9, 4}, {17, 12}, {9, 20}}); break;
        case Icon::Play: p->drawPolygon(QPolygonF{{7, 4}, {20, 12}, {7, 20}}); break;
        case Icon::Stop: p->drawRect(QRectF(5, 5, 14, 14)); break;
        case Icon::Fit:
            p->drawPolyline(QPolygonF{{4, 9}, {4, 4}, {9, 4}});
            p->drawPolyline(QPolygonF{{15, 4}, {20, 4}, {20, 9}});
            p->drawPolyline(QPolygonF{{4, 15}, {4, 20}, {9, 20}});
            p->drawPolyline(QPolygonF{{15, 20}, {20, 20}, {20, 15}});
            p->drawRect(QRectF(9, 9, 6, 6)); break;
        case Icon::Undo:
        case Icon::Redo:
            if (icon_ == Icon::Redo) { p->translate(24, 0); p->scale(-1, 1); }
            path.moveTo(4, 8); path.lineTo(14, 8); path.cubicTo(23, 8, 23, 20, 13, 20);
            p->drawPath(path); p->drawPolyline(QPolygonF{{9, 3}, {4, 8}, {9, 13}}); break;
        }
        p->restore();
    }
    QPixmap pixmap(const QSize &size, QIcon::Mode mode, QIcon::State state) override
    {
        QPixmap result(size);
        result.fill(Qt::transparent);
        QPainter painter(&result);
        paint(&painter, QRect(QPoint(), size), mode, state);
        return result;
    }
private:
    Icon icon_;
    QColor color_;
};

} // namespace

QIcon actionIcon(Icon icon, QColor color) { return QIcon(new VectorIcon(icon, color)); }

} // namespace nova::sprite
