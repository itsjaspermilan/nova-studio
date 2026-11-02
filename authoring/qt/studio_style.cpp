#include "studio_style.h"
#include <QAction>
#include <QApplication>
#include <QMainWindow>
#include <QPainter>
#include <QPainterPath>

QIcon studioIcon(const QString &name, const QPalette &palette)
{
    QIcon result;
    for (const int density : {1, 2, 3}) {
        for (const auto mode : {QIcon::Normal, QIcon::Disabled}) {
            QPixmap image(24 * density, 24 * density);
            image.setDevicePixelRatio(density);
            image.fill(Qt::transparent);
            QPainter p(&image);
            p.setRenderHint(QPainter::Antialiasing);
            QColor ink = palette.color(mode == QIcon::Disabled ? QPalette::Disabled : QPalette::Active, QPalette::Text);
            if (mode == QIcon::Normal && name == "runProject") ink = QColor("#18856d");
            if (mode == QIcon::Normal && name == "stopProject") ink = QColor("#bb4b56");
            p.setPen(QPen(ink, 1.7, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));
            const auto line = [&p](int x1, int y1, int x2, int y2) { p.drawLine(x1, y1, x2, y2); };
            const auto arrow = [&p, &line](bool right) {
                if (right) { p.translate(24, 0); p.scale(-1, 1); }
                QPainterPath path;
                path.moveTo(5, 9); path.lineTo(13, 9); path.cubicTo(20, 9, 21, 17, 15, 20);
                p.drawPath(path); line(5, 9, 10, 4); line(5, 9, 10, 14);
            };
            if (name == "application") {
                p.setPen(Qt::NoPen); p.setBrush(QColor("#147e83")); p.drawRoundedRect(QRectF(1, 1, 22, 22), 6, 6);
                p.setPen(QPen(Qt::white, 2, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));
                line(7, 17, 7, 7); line(7, 7, 17, 17); line(17, 17, 17, 7);
            } else if (name == "newProject") {
                QPainterPath page;
                page.moveTo(14, 3); page.lineTo(5, 3); page.lineTo(5, 21); page.lineTo(19, 21);
                page.lineTo(19, 8); page.lineTo(14, 3); page.lineTo(14, 8); page.lineTo(19, 8); p.drawPath(page);
                line(9, 14, 15, 14); line(12, 11, 12, 17);
            } else if (name == "openProject") {
                QPainterPath folder;
                folder.moveTo(3, 18); folder.lineTo(3, 5); folder.lineTo(9, 5); folder.lineTo(11, 8);
                folder.lineTo(21, 8); folder.lineTo(18, 19); folder.lineTo(3, 19);
                folder.lineTo(6, 11); folder.lineTo(19, 11); p.drawPath(folder);
            } else if (name == "saveProject") {
                line(12, 3, 12, 15); line(8, 11, 12, 15); line(12, 15, 16, 11);
                QPainterPath tray; tray.moveTo(4, 15); tray.lineTo(4, 21); tray.lineTo(20, 21); tray.lineTo(20, 15);
                p.drawPath(tray);
            } else if (name == "undo" || name == "redo") arrow(name == "redo");
            else if (name == "runProject") {
                p.setBrush(ink); QPainterPath triangle; triangle.moveTo(7, 4); triangle.lineTo(20, 12);
                triangle.lineTo(7, 20); triangle.closeSubpath(); p.drawPath(triangle);
            } else if (name == "stopProject") { p.setBrush(ink); p.drawRoundedRect(QRectF(5, 5, 14, 14), 2, 2); }
            else if (name == "duplicateObject") {
                p.drawRoundedRect(QRectF(8, 8, 12, 12), 2, 2);
                QPainterPath back; back.moveTo(5, 16); back.lineTo(3, 16); back.lineTo(3, 3);
                back.lineTo(16, 3); back.lineTo(16, 5); p.drawPath(back);
            } else if (name == "deleteObject") {
                line(4, 6, 20, 6); line(9, 3, 15, 3);
                QPainterPath bin; bin.moveTo(6, 6); bin.lineTo(7, 21); bin.lineTo(17, 21); bin.lineTo(18, 6);
                p.drawPath(bin); line(10, 10, 10, 17); line(14, 10, 14, 17);
            } else if (name == "importAsset") {
                p.drawRoundedRect(QRectF(3, 3, 14, 18), 2, 2);
                line(11, 12, 22, 12); line(11, 12, 15, 8); line(11, 12, 15, 16);
            } else if (name == "addObject") {
                p.drawRoundedRect(QRectF(3, 3, 18, 18), 4, 4);
                line(7, 12, 17, 12); line(12, 7, 12, 17);
            } else if (name == "scene") {
                QPolygon polygon{{12, 2}, {22, 8}, {22, 17}, {12, 23}, {2, 17}, {2, 8}};
                p.drawPolygon(polygon); line(2, 8, 12, 14); line(12, 14, 22, 8); line(12, 14, 12, 23);
            } else {
                p.drawRoundedRect(QRectF(3, 3, 18, 18), 3, 3);
                p.drawEllipse(QPointF(8, 8), 1.5, 1.5);
                QPainterPath hills; hills.moveTo(4, 18); hills.lineTo(10, 12); hills.lineTo(14, 16); hills.lineTo(18, 11); hills.lineTo(21, 14);
                p.drawPath(hills);
            }
            p.end();
            result.addPixmap(image, mode);
        }
    }
    return result;
}

void applyStudioStyle(QMainWindow *window)
{
    const QPalette palette = QApplication::palette();
    const bool dark = palette.color(QPalette::Window).lightness() < 128;
    const QString panel = dark ? "#262b32" : "#f4f6f8";
    const QString border = dark ? "#3d4652" : "#dce2e8";
    const QString muted = dark ? "#bac5d2" : "#526173";
    const QString base = palette.color(QPalette::Base).name();
    window->setStyleSheet(QString(
        "QMainWindow::separator { width: 5px; height: 5px; background: %1; }"
        "QToolBar#applicationToolbar { spacing: 6px; padding: 8px; border: 0; border-bottom: 1px solid %2; }"
        "QToolBar#applicationToolbar QToolButton { padding: 6px 9px; border-radius: 6px; }"
        "QToolBar#applicationToolbar QToolButton:hover { background: %1; }"
        "QToolBar#sceneTools { spacing: 5px; padding: 6px 10px; border: 0; border-bottom: 1px solid %2; }"
        "QToolBar#sceneTools QToolButton { padding: 5px 7px; }"
        "QDockWidget { font-weight: 600; }"
        "QDockWidget::title { padding: 8px 10px; background: %1; border-bottom: 1px solid %2; }"
        "QTreeWidget#sceneOutline, QTreeWidget#assetOutline { border: 0; background: %3; }"
        "QTreeWidget#sceneOutline::item, QTreeWidget#assetOutline::item { min-height: 28px; padding: 2px 4px; }"
        "QTreeWidget QHeaderView::section { padding: 8px; background: %3; color: %4; border: 0; }"
        "QLabel#previewState { background: %1; color: %4; padding: 3px 6px; }"
        "QLabel#projectState { color: %4; padding: 3px 8px; font-size: 12px; }"
        "QWidget#objectProperties QLineEdit, QWidget#objectProperties QDoubleSpinBox { min-height: 25px; }"
        "QWidget#objectProperties QComboBox { min-height: 28px; }"
        "QLabel#selectionHelp { color: %4; font-size: 12px; padding: 6px 0; }"
        "QTabWidget#workspaces::pane { border: 0; }"
        "QTabWidget#workspaces QTabBar { background: %1; qproperty-drawBase: 0; }"
        "QTabWidget#workspaces QTabBar::tab { min-width: 70px; padding: 9px 16px; background: %1; color: %4;"
        " border: 0; border-bottom: 2px solid transparent; }"
        "QTabWidget#workspaces QTabBar::tab:selected { background: %3; color: %5; border-bottom: 2px solid #16858a; font-weight: 600; }"
        "QTabWidget#workspaces QTabBar::tab:!selected:hover { background: %3; }"
        "QListWidget#problems { border: 1px solid %2; }"
    ).arg(panel, border, base, muted, palette.color(QPalette::Text).name()));
    for (auto *action : window->findChildren<QAction *>()) {
        if (action->property("studioIcon").toBool()) action->setIcon(studioIcon(action->objectName(), palette));
    }
    window->setWindowIcon(studioIcon("application", palette));
}
