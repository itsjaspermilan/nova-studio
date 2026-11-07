#!/bin/bash
# Nebula Swap's store pictures, rendered by the game itself (F11 and F12 on the title screen show them): icon.png (512 x 512, the app's icon),
# boxart.png (768 x 1024, portrait) and boxart-wide.png (1600 x 900, landscape) for launchers such as Lantern. On the handheld, Lantern reads
# /sdcard/Lantern/art/androidgames/com.nova.games.nebula_swap.png.
set -euo pipefail
cd "$(dirname "$0")/../.."
P=examples/nebula-swap
R="scripts/env.sh cargo run -q --release -p nova-runtime --bin nova -- run $P --headless --frames 80"
$R --size 512x512 --press key:F11@30 --capture $P/icon.png
$R --size 768x1024 --press key:F12@30 --capture $P/boxart.png
$R --size 1600x900 --press key:F12@30 --capture $P/boxart-wide.png
