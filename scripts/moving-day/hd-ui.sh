#!/bin/bash
# Moving Day's interface pictures at twice their shown size, with smooth edges (scripts/moving-day/hd-ui.mjs), and the wish card's icons and the
# clients' faces rendered from the game's own models by the small project in scripts/moving-day/icons/.
set -euo pipefail
cd "$(dirname "$0")/../.."
P=examples/moving-day
B=build/moving-day-icons
rm -rf "$B" && mkdir -p "$B/project/models"
cp -R scripts/moving-day/icons/. "$B/project/"
cp $P/models/*.glb "$B/project/models/"
R="scripts/env.sh cargo run -q --release -p nova-runtime --bin nova -- run $B/project --headless --frames 6"
$R --size 3600x2000 --capture "$B/icons-black.png" > /dev/null
$R --size 3600x2000 --hold white --capture "$B/icons-white.png" > /dev/null
$R --size 1536x1200 --hold faces --capture "$B/faces-black.png" > /dev/null
$R --size 1536x1200 --hold faces,white --capture "$B/faces-white.png" > /dev/null
scripts/env.sh node scripts/moving-day/hd-ui.mjs $P/sprites/ui "$B"
