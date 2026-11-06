#!/bin/bash
# Pine Ridge Rally's menu and HUD art and its interface sounds, from the Kenney Game Assets All-in-1 bundle (CC0; the licence of each
# pack is in its folder and summarised in licenses/kenney-ui.txt). Needs the bundle's folder:
#   KENNEY="/path/to/Kenney Game Assets All-in-1 3.8.0" scripts/rally/kenney-ui.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
K="${KENNEY:?set KENNEY to the folder of the Kenney Game Assets All-in-1 bundle}"
P=examples/pine-ridge-rally
U="$P/sprites/ui"
mkdir -p "$U"

UIP="$K/UI assets/UI Pack/PNG"
ADV="$K/UI assets/UI Pack - Adventure/PNG/Default"
SW="$K/Icons/Input Prompts/Nintendo Switch/Default"
cp "$UIP/Yellow/Default/button_rectangle_depth_gradient.png" "$U/btn_yellow.png"
cp "$UIP/Grey/Default/button_rectangle_depth_gradient.png" "$U/btn_grey.png"
cp "$UIP/Extra/Default/divider.png" "$U/divider.png" 2>/dev/null || true
cp "$ADV/panel_grey_dark.png" "$U/panel_dark.png"
cp "$ADV/panel_border_grey.png" "$U/panel_frame.png"
cp "$ADV/progress_green.png" "$U/bar_green.png" 2>/dev/null || true
# the handheld's buttons as a Nintendo-style pad labels them (the Retroid Pocket 6), and its sticks and d-pad
for n in a b x y l r zl zr plus minus; do cp "$SW/switch_button_$n.png" "$U/pad_$n.png"; done
cp "$SW/switch_stick_l.png" "$U/pad_stick_l.png"
cp "$SW/switch_stick_r.png" "$U/pad_stick_r.png" 2>/dev/null || true
cp "$SW/switch_stick_r_press.png" "$U/pad_stick_r_press.png" 2>/dev/null || true
cp "$SW/switch_dpad.png" "$U/pad_dpad.png"

# interface sounds (the effects sit in sounds/ as Ogg: the engine reads them as they are)
IS="$K/Audio/Interface Sounds/Audio"
IM="$K/Audio/Impact Sounds/Audio"
S="$P/sounds"
cp "$IS/tick_002.ogg" "$S/menu_move.ogg"
cp "$IS/confirmation_002.ogg" "$S/menu_accept.ogg"
cp "$IS/back_002.ogg" "$S/menu_back.ogg"
cp "$IS/open_001.ogg" "$S/pause.ogg"
for f in impactMetal_heavy_000 impactPlate_heavy_000 impactGeneric_light_000; do
    if [ -f "$IM/$f.ogg" ]; then cp "$IM/$f.ogg" "$S/bump.ogg"; break; fi
done
echo "copied $(ls "$U" | wc -l | tr -d ' ') pictures and the interface sounds"

# music: Kenney's loops (the menu, results and the four circuits; the game's Options > Music style chooses them or the studio-made songs)
ML="$K/Audio/Music Loops/Loops"
cp "$ML/Swinging Pants.ogg" "$P/music/kenney_menu.ogg"
cp "$ML/Cheerful Annoyance.ogg" "$P/music/kenney_results.ogg"
cp "$ML/Time Driving.ogg" "$P/music/kenney_forest.ogg"
cp "$ML/Mission Plausible.ogg" "$P/music/kenney_desert.ogg"
cp "$ML/Flowing Rocks.ogg" "$P/music/kenney_snow.ogg"
cp "$ML/Space Cadet.ogg" "$P/music/kenney_night.ogg"
echo "copied the music loops"
