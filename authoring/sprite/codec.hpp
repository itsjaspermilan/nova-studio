#pragma once

#include "document.hpp"

namespace nova::sprite {

bool encodeSource(const State &state, QByteArray &bytes, QString &error);
bool decodeSource(const QByteArray &bytes, State &state, QString &error);

} // namespace nova::sprite
