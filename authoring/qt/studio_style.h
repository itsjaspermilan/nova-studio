#ifndef NOVA_QT_STUDIO_STYLE_H
#define NOVA_QT_STUDIO_STYLE_H

#include <QIcon>
#include <QPalette>
#include <QString>

class QMainWindow;
QIcon studioIcon(const QString &name, const QPalette &palette);
void applyStudioStyle(QMainWindow *window);
#endif
