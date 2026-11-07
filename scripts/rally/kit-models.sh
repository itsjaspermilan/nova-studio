#!/bin/bash
# Pine Ridge Rally's cars, trees, rocks, bushes, guardrails, lamps and start arch, from Kenney kits (CC0), sized and given collision
# circles like the editor-made models they replace (see docs/probes.md). Needs the kits unzipped:
#   unzip examples/kenney_car-kit.zip -d "$KITS/kenney_car-kit"   (and the platformer and racing kits)
#   KITS=/some/folder scripts/rally/kit-models.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
KITS="${KITS:?set KITS to the folder the kits were unzipped into}"
P=examples/pine-ridge-rally
K() { scripts/env.sh node scripts/kenney.mjs "$@"; }
# One scale for all the cars, so that they keep the kit's sizes relative to each other (the first version fitted each to the same
# length, which made the hatchback a toy and the sedan a box): the kit's formula car (2.56 m long) comes out 3.5 m. Wheels are
# 0.6 m across whatever the car (the kit's are 0.8 to 0.9, huge for a car this size).
# The wheels fit the body: 0.6 m on the open-wheel cars, 0.68 and 0.66 m under the taller bodies of the sedan and the hatchback. `wheel` in lib/state.lua must say the same, for the spin.
CAR_SCALE=1.37
CAR=(--scale $CAR_SCALE --pivot-wheels --centre-axles --rename wheel-front-right=wheel_fl,wheel-front-left=wheel_fr,wheel-back-right=wheel_rl,wheel-back-left=wheel_rr)
K "$KITS/kenney_car-kit" $P race --as car --wheel-diameter 0.6 "${CAR[@]}"
# the sedan and the hatchback are smaller as a whole than the open-wheel cars (a road car beside a formula car: 3.0 and 3.3 m long
# against 3.5, 1.5 m wide against 1.64), with wheels 0.68 and 0.66 m across
K "$KITS/kenney_car-kit" $P sedan-sports --as car_blue "${CAR[@]}" --scale 1.18 --wheel-diameter 0.68 --wheels-to-body
K "$KITS/kenney_car-kit" $P hatchback-sports --as car_green "${CAR[@]}" --scale 1.15 --wheel-diameter 0.66 --wheels-to-body
K "$KITS/kenney_car-kit" $P race-future --as car_yellow --wheel-diameter 0.62 "${CAR[@]}"
PK="$KITS/kenney_platformer-kit"
for m in pine pine_dark; do K "$PK" $P tree-pine --as $m --fit y=7.25 --collider 0:0:0.9; done
K "$PK" $P tree-pine-snow --as pine_snow --fit y=7.25 --collider 0:0:0.9
for m in birch autumn_tree; do K "$PK" $P tree --as $m --fit y=5.5 --collider 0:0:0.9; done
for m in bush bush_snow; do K "$PK" $P plant --as $m --fit x=1.95; done
for m in rock rock_ice rock_red; do K "$PK" $P rocks --as $m --fit x=3.41 --collider 0:0:2.3; done
RK="$KITS/kenney_racing-kit"
K "$RK" $P rail --as guardrail --fit x=6.0 --turn 90 --centre --collider 0:-2.5:1.1 --collider 0:0:1.1 --collider 0:2.5:1.1
K "$RK" $P lightPostLarge --as lamp --fit y=6.0 --turn 90 --centre --collider 0:0:0.35
K "$RK" $P overhead --as start_arch --fit x=14.85 --centre --collider -7.2:0:0.7 --collider 7.2:0:0.7

# the road: slabs 12 m across and 6.25 m long, as the editor-made ones were (scripts/rally/tracks.mjs lays one every 5 m), with the
# kit's lines and verges; dirt and snow are the same slab in other colours
ROAD="--stretch x=12,z=6.25 --centre"
K "$RK" $P roadStraight --as road_asphalt $ROAD
K "$RK" $P roadStraight --as road_dirt $ROAD --material road=0.50,0.37,0.24 --material grey=0.78,0.66,0.48 --material grass=0.66,0.48,0.28
K "$RK" $P roadStraight --as road_snow $ROAD --material road=0.60,0.66,0.74 --material grey=0.93,0.96,0.99 --material grass=0.92,0.95,1.0
K "$RK" $P roadStartPositions --as road_start $ROAD

# the roadside (lib/roadside.lua places these from the circuit's waypoints): stands, tents, banner towers, billboards, flags,
# pylons and the rest, from the racing kit
K "$RK" $P grandStand --as grandstand --fit x=11 --centre --collider -4:0:1.8 --collider 0:0:1.8 --collider 4:0:1.8
K "$RK" $P grandStandCovered --as grandstand_covered --fit x=11 --centre --collider -4:0:1.8 --collider 0:0:1.8 --collider 4:0:1.8
K "$RK" $P tent --as tent --fit x=6 --centre --collider 0:0:2.2
K "$RK" $P tentLong --as tent_long --fit x=10 --centre --collider -3:0:1.8 --collider 3:0:1.8
K "$RK" $P bannerTowerRed --as banner_red --fit y=8 --centre --collider 0:0:0.6
K "$RK" $P bannerTowerGreen --as banner_green --fit y=8 --centre --collider 0:0:0.6
K "$RK" $P billboard --as billboard --fit x=8 --centre --collider -2.5:0:0.6 --collider 2.5:0:0.6
K "$RK" $P billboardLow --as billboard_low --fit x=6 --centre --collider 0:0:0.8
K "$RK" $P flagCheckers --as flag_checkers --fit y=6 --centre --collider 0:0:0.3
K "$RK" $P flagRed --as flag_red --fit y=6 --centre --collider 0:0:0.3
K "$RK" $P flagGreen --as flag_green --fit y=6 --centre --collider 0:0:0.3
K "$RK" $P barrierRed --as barrier_red --fit x=4 --centre --collider -1:0:0.7 --collider 1:0:0.7
K "$RK" $P barrierWhite --as barrier_white --fit x=4 --centre --collider -1:0:0.7 --collider 1:0:0.7
K "$RK" $P pylon --as pylon --fit y=1.1 --centre --collider 0:0:0.4
K "$RK" $P fenceStraight --as fence --fit x=5 --centre --collider -1.7:0:0.4 --collider 0:0:0.4 --collider 1.7:0:0.4
K "$RK" $P pitsGarage --as garage --fit x=12 --centre --collider -4:0:2 --collider 0:0:2 --collider 4:0:2

# more road cars, from the Car Kit in the Kenney All-in-1 bundle (set CARKIT to its folder: ".../3D assets/Car Kit"): one scale (1.18, the sports sedan's) for all of the road cars, so that they keep the kit's sizes relative to each other; the same scale as the
# sports cars above (the kit's road cars are wider, so a little less), wheels fitted to each body. \`--rename\` names the four wheels as
# the game's car code expects; a part the kit has beyond them (the SUV's spare wheel, the police car's grill) is left as it is.
if [ -n "${CARKIT:-}" ]; then
    ROADCAR=(--pivot-wheels --centre-axles --wheels-to-body --rename wheel-front-right=wheel_fl,wheel-front-left=wheel_fr,wheel-back-right=wheel_rl,wheel-back-left=wheel_rr)
    K "$CARKIT" $P sedan --as car_sedan --scale 1.18 --wheel-diameter 0.67 "${ROADCAR[@]}"
    K "$CARKIT" $P suv --as car_suv --scale 1.18 --wheel-diameter 0.79 "${ROADCAR[@]}"
    K "$CARKIT" $P suv-luxury --as car_suvl --scale 1.18 --wheel-diameter 0.8 "${ROADCAR[@]}"
    K "$CARKIT" $P taxi --as car_taxi --scale 1.18 --wheel-diameter 0.67 "${ROADCAR[@]}"
    K "$CARKIT" $P police --as car_police --scale 1.18 --wheel-diameter 0.75 "${ROADCAR[@]}"
    K "$CARKIT" $P van --as car_van --scale 1.18 --wheel-diameter 0.71 "${ROADCAR[@]}"
    K "$CARKIT" $P truck --as car_pickup --scale 1.18 --wheel-diameter 0.82 "${ROADCAR[@]}"
fi

# the spectators (lib/crowd.lua): eight of Kenney's Mini Characters, with their animations (the Mini Characters pack, CC0; set MINICHARS to its folder:
# ".../3D assets/Mini Characters")
if [ -n "${MINICHARS:-}" ]; then
    for c in female-a:fa female-b:fb female-c:fc female-d:fd male-a:ma male-b:mb male-c:mc male-d:md; do
        K "$MINICHARS" $P character-${c%%:*} --as crowd_${c##*:}
    done
fi

# more trees, rocks, cacti and brush so that no two circuits (and few neighbouring trees) look alike: Kenney's Nature Kit (CC0; set NATURE to
# its folder: ".../3D assets/Nature Kit"). Pines in several shapes, broad-leaved trees (some in autumn colours), cacti, rocks and stumps; the
# snow, night and desert circuits get their own colours of the same shapes (--material recolours a part of the model by its material's name).
if [ -n "${NATURE:-}" ]; then
    # (the kit's own colours read as teal and pink here, so every part is given a colour: greens, browns, autumn orange, rock grey and moss)
    BASE="--material leafsGreen=0.10,0.40,0.05 --material leafsDark=0.02,0.16,0.06 --material leafsFall=0.79,0.22,0.02 --material woodBark=0.21,0.09,0.04 --material woodBarkDark=0.15,0.07,0.035 --material woodBirch=0.8,0.78,0.7 --material dirt=0.19,0.19,0.21 --material grass=0.12,0.3,0.08"
    NK() { local model=$1; shift; K "$NATURE" $P "$model" $BASE "$@"; }
    # forest: tall, round and small pines, and the broad-leaved trees
    NK tree_pineTallA --as nk_pinetall_a --fit y=9.5 --collider 0:0:0.7
    NK tree_pineTallB --as nk_pinetall_b --fit y=10.5 --collider 0:0:0.7
    NK tree_pineTallC --as nk_pinetall_c --fit y=8.5 --collider 0:0:0.7
    NK tree_pineTallD --as nk_pinetall_d --fit y=11 --collider 0:0:0.7
    NK tree_pineRoundA --as nk_pineround_a --fit y=7 --collider 0:0:0.8
    NK tree_pineRoundC --as nk_pineround_c --fit y=6.5 --collider 0:0:0.8
    NK tree_pineRoundE --as nk_pineround_e --fit y=7.5 --collider 0:0:0.8
    NK tree_pineSmallA --as nk_pinesmall_a --fit y=4.5 --collider 0:0:0.5
    NK tree_pineSmallC --as nk_pinesmall_c --fit y=5 --collider 0:0:0.5
    NK tree_oak --as nk_oak --fit y=7 --collider 0:0:0.8
    NK tree_fat --as nk_fat --fit y=6 --collider 0:0:0.9
    NK tree_tall --as nk_tall --fit y=8.5 --collider 0:0:0.6
    NK tree_thin --as nk_thin --fit y=7 --collider 0:0:0.5
    NK tree_default --as nk_default --fit y=7.5 --collider 0:0:0.7
    NK tree_oak_fall --as nk_oak_fall --fit y=7 --collider 0:0:0.8
    NK tree_tall_fall --as nk_tall_fall --fit y=8.5 --collider 0:0:0.6
    NK tree_default_fall --as nk_default_fall --fit y=7.5 --collider 0:0:0.7
    NK stump_old --as nk_stump --fit x=1.1 --collider 0:0:0.5
    NK log --as nk_log --fit z=2.6 --collider 0:0:0.6
    # snow: the pines with white-blue needles
    SNOW="--material leafsDark=0.72,0.8,0.9"
    NK tree_pineTallA --as nk_snow_pinetall_a --fit y=9.5 --collider 0:0:0.7 $SNOW
    NK tree_pineTallC --as nk_snow_pinetall_c --fit y=8.5 --collider 0:0:0.7 $SNOW
    NK tree_pineTallD --as nk_snow_pinetall_d --fit y=11 --collider 0:0:0.7 $SNOW
    NK tree_pineRoundA --as nk_snow_pineround_a --fit y=7 --collider 0:0:0.8 $SNOW
    NK tree_pineRoundE --as nk_snow_pineround_e --fit y=7.5 --collider 0:0:0.8 $SNOW
    NK tree_pineSmallA --as nk_snow_pinesmall_a --fit y=4.5 --collider 0:0:0.5 $SNOW
    # night: the same pines dark
    DARK="--material leafsDark=0.006,0.05,0.035 --material woodBarkDark=0.05,0.03,0.02"
    NK tree_pineTallA --as nk_night_pinetall_a --fit y=9.5 --collider 0:0:0.7 $DARK
    NK tree_pineTallC --as nk_night_pinetall_c --fit y=8.5 --collider 0:0:0.7 $DARK
    NK tree_pineRoundA --as nk_night_pineround_a --fit y=7 --collider 0:0:0.8 $DARK
    NK tree_pineRoundE --as nk_night_pineround_e --fit y=7.5 --collider 0:0:0.8 $DARK
    NK tree_pineSmallA --as nk_night_pinesmall_a --fit y=4.5 --collider 0:0:0.5 $DARK
    # desert: cacti, and dead trees (a thin tree with its leaves the colour of straw)
    NK cactus_tall --as nk_cactus_tall --fit y=4.2 --collider 0:0:0.6
    NK cactus_short --as nk_cactus_short --fit y=2.4 --collider 0:0:0.5
    DEAD="--material leafsGreen=0.4,0.3,0.12 --material woodBark=0.2,0.13,0.07"
    NK tree_thin --as nk_dead_thin --fit y=6 --collider 0:0:0.5 $DEAD
    NK tree_tall --as nk_dead_tall --fit y=7.5 --collider 0:0:0.5 $DEAD
    # rocks in several shapes, in the colours of each place
    for r in largeA:3.4 largeC:3.0 largeE:3.6 tallB:2.4 tallF:2.2 tallH:2.8; do
        n=${r%%:*}; w=${r##*:}
        NK rock_$n --as nk_rock_${n} --fit x=$w --collider 0:0:$(echo "$w * 0.6" | bc -l | cut -c1-4)
        NK rock_$n --as nk_rockred_${n} --fit x=$w --collider 0:0:$(echo "$w * 0.6" | bc -l | cut -c1-4) --material dirt=0.5,0.18,0.1 --material grass=0.6,0.3,0.14
        NK rock_$n --as nk_rockice_${n} --fit x=$w --collider 0:0:$(echo "$w * 0.6" | bc -l | cut -c1-4) --material dirt=0.5,0.58,0.68 --material grass=0.88,0.93,0.98
    done
    NK plant_bushLarge --as nk_bush_large --fit x=2.4
    NK plant_bushDetailed --as nk_bush_detailed --fit x=2.0
    NK plant_bushLargeTriangle --as nk_bush_tri --fit x=2.0
fi
