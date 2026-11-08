#!/bin/bash
# Moving Day's sounds, from the Kenney Game Assets All-in-1 bundle (CC0): interface clicks, wooden footsteps and thuds, a stone drag for furniture
# sliding, a creak and a swish for a turn, a pizzicato jingle for a finished flat. The music is our own (scripts/moving-day/music.mjs).
#   KENNEY="/path/to/Kenney Game Assets All-in-1 3.8.0" scripts/moving-day/sounds.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
K="${KENNEY:?set KENNEY to the folder of the Kenney Game Assets All-in-1 bundle}"
S=examples/moving-day/sounds
mkdir -p $S
IS="$K/Audio/Interface Sounds/Audio"; IM="$K/Audio/Impact Sounds/Audio"; FO="$K/Audio/Foley Sounds/Audio"; RP="$K/Audio/RPG Audio/Audio"; DA="$K/Audio/Digital Audio/Audio"
cp "$IS/tick_002.ogg" $S/menu_move.ogg; cp "$IS/confirmation_002.ogg" $S/menu_accept.ogg; cp "$IS/back_002.ogg" $S/menu_back.ogg; cp "$IS/error_003.ogg" $S/nope.ogg
cp "$IM/footstep_wood_001.ogg" $S/step.ogg; cp "$FO/Rocks/stoneDrag2.ogg" $S/slide.ogg; cp "$IM/impactPlank_medium_002.ogg" $S/bump.ogg
cp "$RP/creak1.ogg" $S/turn.ogg; cp "$IS/confirmation_003.ogg" $S/snap.ogg; cp "$IS/minimize_004.ogg" $S/unsnap.ogg
cp "$IS/scroll_003.ogg" $S/undo.ogg; cp "$FO/Woosh/woosh5.ogg" $S/restart.ogg; cp "$K/Audio/Music Jingles/Audio (Pizzicato)/jingles-pizzicato_02.ogg" $S/happy.ogg
cp "$DA/threeTone1.ogg" $S/star.ogg; cp "$RP/bookFlip2.ogg" $S/page.ogg; cp "$IS/drop_002.ogg" $S/pop.ogg
