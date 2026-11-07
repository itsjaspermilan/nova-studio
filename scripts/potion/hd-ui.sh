#!/bin/bash
# Potion Panic's interface pictures at twice their shown size, with smooth edges (scripts/potion/hd-ui.mjs): panels, buttons, discs, stars, arrows, the
# pointer, flasks, bars, and ingredient icons rendered from the game's own models by the small project in scripts/potion/icons/.
set -euo pipefail
cd "$(dirname "$0")/../.."
P=examples/potion-panic
B=build/potion-icons
rm -rf "$B" && mkdir -p "$B/project/models"
cp -R scripts/potion/icons/. "$B/project/"
cp $P/models/ing_*.glb "$B/project/models/"
R="scripts/env.sh cargo run -q --release -p nova-runtime --bin nova -- run $B/project --headless --frames 6 --size 3072x512"
$R --capture "$B/icons-black.png" > /dev/null
$R --hold white --capture "$B/icons-white.png" > /dev/null
scripts/env.sh node scripts/potion/hd-ui.mjs $P/sprites/ui "$B/icons"
