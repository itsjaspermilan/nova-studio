#!/bin/bash
# Moving Day's Kenney models and sounds, from the Kenney Game Assets All-in-1 bundle (CC0): the Furniture Kit (converted by scripts/kenney.mjs, each
# piece fitted to the cells it takes on the 1 m grid, its origin the middle of its first cell, the rest of it to +x and to -z), the Mini Characters,
# the Nintendo Switch input prompts and sounds. The editable .model.json files are made afterwards by the studio's importer (scripts/moving-day/editable.sh).
#   KENNEY="/path/to/Kenney Game Assets All-in-1 3.8.0" scripts/moving-day/assets.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
K="${KENNEY:?set KENNEY to the folder of the Kenney Game Assets All-in-1 bundle}"
P=examples/moving-day
N="scripts/env.sh node scripts/kenney.mjs"
F="$K/3D assets/Furniture Kit"; C="$K/3D assets/Mini Characters"

# furniture (what the mover pushes): one cell, or two across (moved half a metre to +x), or two by two (and half a metre to -z)
one() { $N "$F" $P "$1" --as "$2" --fit "$3" --centre "${@:4}"; }
wide() { $N "$F" $P "$1" --as "$2" --fit "$3" --centre --move x=0.5 "${@:4}"; }
big() { $N "$F" $P "$1" --as "$2" --fit "$3" --centre --move x=0.5,z=-0.5 "${@:4}"; }
wide loungeSofa sofa x=1.9
one loungeChair armchair x=0.94
wide cabinetTelevision tv_stand x=1.86   # (with tv_screen, made one model by scripts/moving-day/tv.mjs)
$N "$F" $P televisionModern --as tv_screen --fit x=1.3 --centre
big bedDouble bed x=1.9
one pottedPlant plant y=1.05
wide bookcaseClosedWide bookcase x=1.86
one lampRoundFloor lamp y=1.45
one kitchenFridgeLarge fridge x=0.9
one kitchenStove stove x=0.9
wide desk desk x=1.9
one chairDesk desk_chair y=0.98
wide table table x=1.9
one chair chair y=1.0
one cardboardBoxClosed box x=0.78
wide bathtub bathtub x=1.9
one washer washer x=0.86
one sideTable side_table x=0.9
one tableCoffee coffee_table x=0.95
# the flat (fixed): floors in four colours, walls on a cell's north side (turned for the others), rugs
FLOOR="--fit x=1 --centre"
$N "$F" $P floorFull --as floor_wood $FLOOR
$N "$F" $P floorFull --as floor_carpet $FLOOR --material-srgb wood=214,150,160
$N "$F" $P floorFull --as floor_tile $FLOOR --material-srgb wood=236,226,200
$N "$F" $P floorFull --as floor_bath $FLOOR --material-srgb wood=170,206,222
WALL="--fit x=1 --centre --move z=-0.47"
$N "$F" $P wall --as wall $WALL
$N "$F" $P wallWindow --as window $WALL
$N "$F" $P wallDoorway --as doorway $WALL
$N "$F" $P rugRectangle --as rug --stretch x=2.8,z=1.8 --centre --move x=1,z=-0.5
$N "$F" $P rugRound --as rug_round --stretch x=1.8,z=1.8 --centre --move x=0.5,z=-0.5
# people: the mover and the clients
$N "$C" $P character-male-e character-female-a character-female-b character-female-c character-female-d character-female-e character-female-f character-male-a character-male-b character-male-c character-male-d character-male-f

# the pad glyphs (Kenney Input Prompts, Nintendo Switch)
U=$P/sprites/ui
SW="$K/Icons/Input Prompts/Nintendo Switch/Default"
for n in a b x y l r zl zr plus minus; do cp "$SW/switch_button_$n.png" "$U/pad_$n.png"; done
cp "$SW/switch_dpad.png" "$U/pad_dpad.png"; cp "$SW/switch_stick_l.png" "$U/pad_stick_l.png"

# the editable models (the studio's importer; characters and the plant keep the kit's file: studio/src/tools/keep-original.txt), the TV made of two
# kit pieces, and a check of every model against the kit's (scripts/moving-day/check-models.sh)
(cd studio && NOVA_MAKE_EDITABLE=1 NOVA_MAKE_EDITABLE_PROJECT=moving-day ../scripts/env.sh npx vitest run src/tools/make-editable.test.ts)
scripts/env.sh node scripts/moving-day/tv.mjs
(cd studio && NOVA_EXPORT_ALL=1 NOVA_MAKE_EDITABLE_PROJECT=moving-day ../scripts/env.sh npx vitest run src/tools/make-editable.test.ts)
