#!/bin/bash
# Potion Panic's Kenney art, sound and music, from the Kenney Game Assets All-in-1 bundle (CC0): models from the Mini Dungeon, Food, Nature, Graveyard and Fantasy
# Town kits (converted by scripts/kenney.mjs), the UI Adventure Pack (parchment and wood), previews of the Food Kit as ingredient icons, and sounds and music.
#   KENNEY="/path/to/Kenney Game Assets All-in-1 3.8.0" scripts/potion/assets.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
K="${KENNEY:?set KENNEY to the folder of the Kenney Game Assets All-in-1 bundle}"
P=examples/potion-panic
N="scripts/env.sh node scripts/kenney.mjs"
D="$K/3D assets/Mini Dungeon"; F="$K/3D assets/Food Kit"; NK="$K/3D assets/Nature Kit"; G="$K/3D assets/Graveyard Kit"; T="$K/3D assets/Fantasy Town Kit"

# the workshop
$N "$D" $P floor wall barrel chest potion character-human coin gate banner column key
$N "$D" $P table --as table
$N "$F" $P pot-stew --as cauldron --scale 1.15
$N "$F" $P mortar-pestle --as mortar --scale 2.4
$N "$F" $P mushroom --as ing_glowcap --fit y=0.30
$N "$F" $P pumpkin --as ing_embergourd --fit x=0.36
$N "$F" $P radish --as ing_frostroot --fit y=0.36
$N "$F" $P grapes --as ing_moonberry --fit y=0.34
$N "$F" $P lemon --as ing_sunpetal --fit y=0.28
$N "$F" $P beet --as ing_bogbulb --fit y=0.32
$N "$F" $P cutting-board --as board --scale 0.9
$N "$T" $P stall --as hatch --scale 1.5
$N "$T" $P lantern --as lantern --scale 0.9
# outside: meadow
$N "$NK" $P tree_default --scale 1.5
$N "$NK" $P tree_oak --scale 1.5
$N "$NK" $P flower_redA --scale 2.4
$N "$NK" $P flower_yellowA --scale 2.4
$N "$NK" $P flower_purpleA --scale 2.4
$N "$NK" $P mushroom_redGroup --scale 2.2
$N "$NK" $P plant_bush --scale 1.8
$N "$NK" $P fence_simple
$N "$NK" $P stump_round --scale 1.6
$N "$NK" $P log --scale 1.6
# outside: frost, ember
$N "$NK" $P tree_pineTallA --scale 1.6
$N "$NK" $P tree_pineRoundA --scale 1.6
$N "$NK" $P rock_largeA --scale 1.5
$N "$NK" $P rock_tallA --scale 1.5
$N "$NK" $P stone_tallB --scale 1.5
$N "$NK" $P campfire_logs --scale 3
$N "$NK" $P cactus_tall --scale 1.5
$N "$NK" $P tent_smallClosed --scale 1.6
# outside: mire
$N "$G" $P pine --scale 0.9
$N "$G" $P gravestone-cross --scale 1.3
$N "$G" $P candle-multiple --scale 1.6
$N "$G" $P lantern-candle --scale 1.4
$N "$G" $P fire-basket --scale 1.6
$N "$G" $P pumpkin-carved --scale 1.4
$N "$G" $P character-ghost
$N "$G" $P crypt-small --scale 1.2
$N "$G" $P iron-fence

# the parchment and wood UI, and the ingredients' pictures
UI="$K/UI assets/UI Adventure Pack/PNG"
U=$P/sprites/ui
for n in buttonLong_brown buttonLong_brown_pressed buttonLong_beige buttonLong_beige_pressed buttonLong_blue panel_brown panel_beige panel_beigeLight panel_blue panelInset_brown panelInset_beige panelInset_beigeLight \
  buttonSquare_brown buttonSquare_beige iconCheck_bronze iconCheck_beige iconCross_brown iconCircle_brown arrowBrown_left arrowBrown_right arrowBeige_left arrowBeige_right \
  barBack_horizontalLeft barBack_horizontalMid barBack_horizontalRight barGreen_horizontalLeft barGreen_horizontalMid barGreen_horizontalRight barRed_horizontalLeft barRed_horizontalMid barRed_horizontalRight \
  barYellow_horizontalLeft barYellow_horizontalMid barYellow_horizontalRight cursorGauntlet_bronze; do cp "$UI/$n.png" "$U/$n.png" 2>/dev/null || echo "missing $n"; done
FP="$K/3D assets/Food Kit/Previews"
for pair in mushroom:glowcap pumpkin:embergourd radish:frostroot grapes:moonberry lemon:sunpetal beet:bogbulb; do cp "$FP/${pair%%:*}.png" "$U/ing_${pair##*:}.png"; done
SW="$K/Icons/Input Prompts/Nintendo Switch/Default"
for n in a b x y l r zl zr plus minus; do cp "$SW/switch_button_$n.png" "$U/pad_$n.png"; done
cp "$SW/switch_dpad.png" "$U/pad_dpad.png"; cp "$SW/switch_stick_l.png" "$U/pad_stick_l.png"
cp "$K/2D assets/Simple Space/PNG/Default/star_large.png" "$U/star.png"

# sounds and music
S=$P/sounds
IS="$K/Audio/Interface Sounds/Audio"; RP="$K/Audio/RPG Audio/Audio"; IM="$K/Audio/Impact Sounds/Audio"; FO="$K/Audio/Foley Sounds/Audio"; ML="$K/Audio/Music Loops/Loops"
cp "$IS/tick_002.ogg" $S/menu_move.ogg; cp "$IS/confirmation_002.ogg" $S/menu_accept.ogg; cp "$IS/back_002.ogg" $S/menu_back.ogg; cp "$IS/error_003.ogg" $S/nope.ogg
cp "$RP/bookFlip2.ogg" $S/page.ogg; cp "$RP/bookOpen.ogg" $S/book_open.ogg
cp "$RP/handleSmallLeather.ogg" $S/grab.ogg; cp "$RP/dropLeather.ogg" $S/drop.ogg
cp "$RP/chop.ogg" $S/grind.ogg; cp "$RP/metalPot2.ogg" $S/pot_add.ogg; cp "$RP/metalPot1.ogg" $S/brew_start.ogg
cp "$RP/handleCoins2.ogg" $S/coins.ogg; cp "$RP/footstep03.ogg" $S/step.ogg
cp "$IM/impactGlass_light_001.ogg" $S/bottle.ogg; cp "$IM/impactGlass_heavy_002.ogg" $S/shatter.ogg; cp "$IM/impactBell_heavy_001.ogg" $S/order.ogg
cp "$FO/Water/sinkWater2.ogg" $S/pour.ogg; cp "$FO/Water/drip2.ogg" $S/bubble.ogg; cp "$FO/Woosh/woosh3.ogg" $S/dash.ogg; cp "$FO/Woosh/woosh6.ogg" $S/whoosh.ogg
cp "$K/Audio/Digital Audio/Audio/powerUp7.ogg" $S/ding.ogg; cp "$K/Audio/Digital Audio/Audio/lowDown.ogg" $S/fail.ogg
cp "$K/Audio/Digital Audio/Audio/threeTone1.ogg" $S/star.ogg; cp "$K/Audio/Digital Audio/Audio/phaserDown2.ogg" $S/splash.ogg
cp "$K/Audio/Digital Audio/Audio/tone1.ogg" $S/beep.ogg
# (the music is our own: scripts/potion/music.mjs)
