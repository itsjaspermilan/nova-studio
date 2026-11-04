#!/bin/bash
# Bunker Run's creatures, weapons and pickups, from Kenney kits (CC0): the platformer kit's animated characters (clips idle, walk,
# sprint...), the blaster kit's guns, clips and crates, and the platformer kit's key. Needs the kits unzipped:
#   KITS=/some/folder scripts/bunker/kit-models.sh      (KITS has kenney_platformer-kit and kenney_blaster-kit_2.1 in it)
set -euo pipefail
cd "$(dirname "$0")/../.."
KITS="${KITS:?set KITS to the folder the kits were unzipped into}"
P=examples/bunker-run
K() { scripts/env.sh node scripts/kenney.mjs "$@"; }
# (the characters are skinned: they are scaled when drawn, not in the file, which would not scale their skeleton)
PK="$KITS/kenney_platformer-kit"
BK="$KITS/kenney_blaster-kit_2.1"
K "$PK" $P character-oodi --as guard
K "$PK" $P character-ooli --as brute
K "$PK" $P character-oopi --as boss
K "$BK" $P grenade-a --as drone --fit y=0.7
K "$BK" $P blaster-b --as pistol --fit z=0.42
K "$BK" $P blaster-f --as shotgun --fit z=0.72
K "$BK" $P crate-small --as health_pack --fit x=0.5
K "$BK" $P clip-large --as ammo_clip --fit y=0.4
K "$PK" $P key --as key --fit y=0.45
