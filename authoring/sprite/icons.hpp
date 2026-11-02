#pragma once

#include <QColor>
#include <QIcon>

namespace nova::sprite {

enum class Icon {
    Select, Move, Pencil, Brush, Eraser, Fill, Line, Rectangle, Ellipse, Eyedropper,
    Add, Remove, Duplicate, Previous, Next, Play, Stop, Fit, Undo, Redo
};

QIcon actionIcon(Icon icon, QColor color);

} // namespace nova::sprite
