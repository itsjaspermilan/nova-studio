#!/bin/bash
# Checks Moving Day's editable models against the kit's files: saves the .glb each models/<name>.model.json would save (the studio's own exporter),
# draws every model twice with the game's renderer, from the kit's .glb and from the saved one, in the same grid and light, and compares them cell
# by cell (scripts/moving-day/compare.mjs). A model whose picture differs in more than 1% of its pixels belongs in studio/src/tools/keep-original.txt.
set -euo pipefail
cd "$(dirname "$0")/../.."
P=examples/moving-day
B=build/moving-day-check
rm -rf "$B" && mkdir -p "$B/kit/models" "$B/saved/models"
NAMES=$(cd $P/models && ls *.model.json | sed 's/\.model\.json$//')
LIST=$(for n in $NAMES; do printf 'moving-day/%s,' "$n"; done | sed 's/,$//')
(cd studio && NOVA_EXPORT_CHECK="$PWD/../$B/saved/models:$LIST" ../scripts/env.sh npx vitest run src/tools/make-editable.test.ts > /dev/null)
cp $P/models/*.glb "$B/kit/models/"
LUA_NAMES=$(for n in $NAMES; do printf '"%s",' "$n"; done)
for side in kit saved; do
  echo '{ "format": 1, "name": "model check", "world_height": 0 }' > "$B/$side/nova.json"
  cat > "$B/$side/main.lua" <<LUA
local NAMES = { $LUA_NAMES }
-- one cell per model, each drawn by its own camera-facing grid place: 8 across
function draw()
  nova.light { dir = { -0.4, -1, -0.6 }, color = { 255, 246, 230 }, ambient = { 140, 140, 150 } }
  nova.sky { top = { 40, 40, 50 }, horizon = { 40, 40, 50 } }
  nova.camera(14, 160, 166, 14, 0.4, 8, 10.5)
  for i, n in ipairs(NAMES) do
    local c, r = (i - 1) % 8, (i - 1) // 8
    nova.model(n, c * 4, 0, r * 4, { ry = 0.6 })
  end
end
LUA
  scripts/env.sh cargo run -q --release -p nova-runtime --bin nova -- run "$B/$side" --headless --frames 4 --size 2400x1600 --capture "$B/$side.png" > /dev/null
done
scripts/env.sh node scripts/moving-day/compare.mjs "$B/kit.png" "$B/saved.png" 8 $(echo $NAMES | wc -w) $NAMES
