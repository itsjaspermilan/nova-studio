#!/bin/bash
# Nebula Swap's Kenney art and sound, from the Kenney Game Assets All-in-1 bundle (CC0): the sci-fi UI pack, the planets and a space skybox
# (shrunk with macOS `sips`), interface, digital and sci-fi sounds, and music loops. Needs the bundle's folder:
#   KENNEY="/path/to/Kenney Game Assets All-in-1 3.8.0" scripts/nebula/assets.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
K="${KENNEY:?set KENNEY to the folder of the Kenney Game Assets All-in-1 bundle}"
P=examples/nebula-swap
U=$P/sprites/ui
B=$P/sprites/bg
S=$P/sounds
UI="$K/UI assets/UI Pack - Sci-fi/PNG"
cp "$UI/Blue/Default/bar_square_gloss_large.png" $U/btn_blue.png
cp "$UI/Yellow/Default/bar_square_gloss_large.png" $U/btn_yellow.png
cp "$UI/Grey/Default/bar_square_gloss_large.png" $U/btn_grey.png
cp "$UI/glassPanel.png" $U/glass.png
cp "$UI/metalPanel.png" $U/metal.png
cp "$UI/dotWhite.png" $U/dot.png
cp "$UI/barHorizontal_white_mid.png" $U/bar_mid.png
cp "$UI/Blue/Default/bar_round_gloss_large.png" $U/bar_blue.png
cp "$UI/Yellow/Default/bar_round_gloss_large.png" $U/bar_yellow.png
cp "$UI/Grey/Default/bar_round_gloss_large.png" $U/bar_grey.png
# the handheld's buttons (Nintendo-style labels, as the Retroid Pocket 6 has them)
SW="$K/Icons/Input Prompts/Nintendo Switch/Default"
for n in a b x y l r zl zr plus minus; do cp "$SW/switch_button_$n.png" "$U/pad_$n.png"; done
cp "$SW/switch_dpad.png" "$U/pad_dpad.png"
# space: the nebula skybox (half size) and six planets (small)
sips -z 1024 2048 "$K/2D assets/Skyboxes Space/Skyboxes/skybox-space-nebula.png" --out $B/nebula.png >/dev/null
sips -z 1024 2048 "$K/2D assets/Skyboxes Space/Skyboxes/skybox-space-galaxy.png" --out $B/galaxy.png >/dev/null
for i in 00 03 06 09; do sips -Z 320 "$K/2D assets/Planets/Planets/planet$i.png" --out $B/planet$i.png >/dev/null; done
cp "$K/2D assets/Simple Space/PNG/Default/star_small.png" $B/star_small.png
cp "$K/2D assets/Simple Space/PNG/Default/star_tiny.png" $B/star_tiny.png
cp "$K/2D assets/Simple Space/PNG/Default/star_medium.png" $B/star_medium.png
# fonts: Kenney Future, as in Pine Ridge Rally
cp examples/pine-ridge-rally/fonts/future.ttf examples/pine-ridge-rally/fonts/future_narrow.ttf $P/fonts/
# sounds
IS="$K/Audio/Interface Sounds/Audio"; DG="$K/Audio/Digital Audio/Audio"; SF="$K/Audio/Sci-Fi Sounds/Audio"; ML="$K/Audio/Music Loops/Loops"
cp "$IS/tick_002.ogg" $S/menu_move.ogg
cp "$IS/confirmation_002.ogg" $S/menu_accept.ogg
cp "$IS/back_002.ogg" $S/menu_back.ogg
cp "$IS/switch_002.ogg" $S/swap.ogg
cp "$IS/tick_001.ogg" $S/raise.ogg
cp "$IS/open_001.ogg" $S/pause.ogg
cp "$IS/error_003.ogg" $S/nope.ogg
cp "$DG/pepSound1.ogg" $S/pop.ogg
cp "$DG/phaserUp3.ogg" $S/chain.ogg
cp "$DG/powerUp7.ogg" $S/combo.ogg
cp "$DG/powerUp12.ogg" $S/win.ogg
cp "$DG/lowDown.ogg" $S/lose.ogg
cp "$DG/tone1.ogg" $S/beep.ogg
cp "$SF/impactMetal_002.ogg" $S/garbage_land.ogg
cp "$IS/glass_003.ogg" $S/garbage_break.ogg
cp "$SF/forceField_001.ogg" $S/whoosh.ogg
# music
cp "$ML/Space Cadet.ogg" $P/music/menu.ogg
cp "$ML/Infinite Descent.ogg" $P/music/play.ogg
cp "$ML/Alpha Dance.ogg" $P/music/versus.ogg
cp "$ML/Mission Plausible.ogg" $P/music/puzzle.ogg
cp "$ML/Game Over.ogg" $P/music/over.ogg
