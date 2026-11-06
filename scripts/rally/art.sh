#!/bin/bash
# Pine Ridge Rally's store pictures, rendered by the game itself (F12 and F11 on the title screen show them): icon.png (512 x 512, the app's
# icon) and boxart.png (768 x 1024, the cover for launchers such as Lantern).
set -euo pipefail
cd "$(dirname "$0")/../.."
P=examples/pine-ridge-rally
scripts/env.sh cargo run -q --release -p nova-runtime --bin nova -- run $P --headless --frames 80 --size 768x1024 --press key:F12@30 --capture $P/boxart.png
scripts/env.sh cargo run -q --release -p nova-runtime --bin nova -- run $P --headless --frames 80 --size 512x512 --press key:F11@30 --capture $P/icon.png
