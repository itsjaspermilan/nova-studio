#!/bin/bash
# Pine Ridge Rally's store pictures, rendered by the game itself (F12 and F11 on the title screen show them): icon.png (512 x 512, the app's
# icon) and boxart.png (768 x 1024, the cover for launchers such as Lantern).
set -euo pipefail
cd "$(dirname "$0")/../.."
P=examples/pine-ridge-rally
scripts/env.sh cargo run -q --release -p nova-runtime --bin nova -- run $P --headless --frames 80 --size 768x1024 --press key:F12@30 --capture $P/boxart.png
scripts/env.sh cargo run -q --release -p nova-runtime --bin nova -- run $P --headless --frames 80 --size 512x512 --press key:F11@30 --capture $P/icon.png
# the landscape cover (1600 x 900), for Lantern's cards on the handheld: copy it to /sdcard/Lantern/art/androidgames/com.nova.games.pine_ridge_rally.png
scripts/env.sh cargo run -q --release -p nova-runtime --bin nova -- run $P --headless --frames 80 --size 1600x900 --press key:F12@30 --capture $P/boxart-wide.png
