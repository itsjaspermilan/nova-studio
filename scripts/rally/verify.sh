#!/bin/bash
# Makes Pine Ridge Rally's models, textures and sounds again from scratch with Nova's makers (the recipes in scripts/rally: cars.mjs,
# scenery.mjs, ground.mjs, roads.mjs, engines.mjs, audio.mjs driving) in a copy of the game whose models/, textures/ and sounds/ are
# emptied first, and checks that every file they make is byte for byte the one the game ships. The files no recipe here makes (the
# skylines, the old kit's grounds and roads, the beeps and the Kenney sounds) are listed, not compared.
#
#   scripts/rally/verify.sh            (about two minutes; the copy is build/pine-verify)
set -euo pipefail
cd "$(dirname "$0")/../.."
GAME=examples/pine-ridge-rally
COPY="$PWD/build/pine-verify"
rm -rf "$COPY"
mkdir -p build
cp -R "$GAME" "$COPY"
rm -rf "$COPY/models" "$COPY/textures" "$COPY/sounds" "$COPY/build"
mkdir -p "$COPY/models" "$COPY/textures" "$COPY/sounds"
for recipe in ground.mjs cars.mjs scenery.mjs roads.mjs engines.mjs "audio.mjs driving"; do
  echo "== $recipe" >&2
  # shellcheck disable=SC2086
  scripts/env.sh node scripts/rally/$recipe --project "$COPY" > "build/pine-verify-$(echo "$recipe" | cut -d' ' -f1).log"
done
made=0 same=0 different=0
while IFS= read -r file; do
  made=$((made + 1))
  if cmp -s "$COPY/$file" "$GAME/$file"; then same=$((same + 1)); else different=$((different + 1)); echo "DIFFERENT: $file"; fi
done < <(cd "$COPY" && find models textures sounds -type f | sort)
others=$(cd "$GAME" && find models textures sounds -type f | sort | while IFS= read -r f; do [ -e "$COPY/$f" ] || echo "$f"; done)
echo "made $made files: $same the same as the game's, $different different"
echo "not made by these recipes ($(echo "$others" | grep -c . || true)): $(echo "$others" | tr '\n' ' ' | cut -c1-600)"
[ "$different" -eq 0 ] && [ "$made" -gt 0 ]
