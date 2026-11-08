#!/bin/bash
# Sunny Hop's sounds, from the Kenney Game Assets All-in-1 bundle (CC0): the New Platformer Pack's own effects, and a few from the Impact, Interface,
# Digital Audio, Retro Sounds 2, Music Jingles and Voiceover packs. The game's names on the left (sounds/<name>.ogg), the pack's files on the right.
#   KENNEY="/path/to/Kenney Game Assets All-in-1 3.8.0" scripts/sunny/sounds.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
K="${KENNEY:?set KENNEY to the folder of the Kenney Game Assets All-in-1 bundle}"
O=examples/sunny-hop/sounds
mkdir -p "$O"
NPP="$K/2D assets/New Platformer Pack/Sounds"
IMP="$K/Audio/Impact Sounds/Audio"
UI="$K/Audio/Interface Sounds/Audio"
DIG="$K/Audio/Digital Audio/Audio"
RET="$K/Audio/Retro Sounds 2/Audio"
JIN="$K/Audio/Music Jingles/Audio (Steeldrum)"
VOX="$K/Audio/Voiceover Pack/Audio (Female)"
while read -r name from; do
  [ -z "$name" ] && continue
  cp "$from" "$O/$name.ogg"
done <<EOF
jump $NPP/sfx_jump.ogg
jump_high $NPP/sfx_jump-high.ogg
coin $NPP/sfx_coin.ogg
gem $NPP/sfx_gem.ogg
hurt $NPP/sfx_hurt.ogg
bump $NPP/sfx_bump.ogg
magic $NPP/sfx_magic.ogg
disappear $NPP/sfx_disappear.ogg
select $NPP/sfx_select.ogg
throw $NPP/sfx_throw.ogg
splash $NPP/sfx_disappear.ogg
stomp $IMP/impactSoft_heavy_002.ogg
land $IMP/footstep_grass_000.ogg
boss_hit $IMP/impactPunch_heavy_001.ogg
unlock $IMP/impactMetal_light_002.ogg
spring $DIG/phaseJump2.ogg
key $DIG/powerUp2.ogg
heart $DIG/powerUp4.ogg
powerup $DIG/powerUp3.ogg
checkpoint $DIG/threeTone1.ogg
star $DIG/powerUp1.ogg
boss_roar $DIG/lowThreeTone.ogg
move $UI/tick_002.ogg
tick $UI/tick_001.ogg
accept $UI/confirmation_001.ogg
back $UI/back_002.ogg
nope $UI/error_004.ogg
pause $UI/open_001.ogg
switch $UI/switch_002.ogg
whoosh $UI/scroll_003.ogg
secret $RET/secret2.ogg
fall $RET/fall2.ogg
clear $JIN/jingles-steel_06.ogg
ready $VOX/ready.ogg
set $VOX/set.ogg
go $VOX/go.ogg
new_best $VOX/new_highscore.ogg
EOF
ls "$O" | wc -l
