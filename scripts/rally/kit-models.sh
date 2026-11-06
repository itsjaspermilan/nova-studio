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
CAR_LENGTH=3.7   # metres: 4.53 made the cars 70% as wide as the road, so they were shrunk by a fifth
CAR=(--fit z=$CAR_LENGTH --pivot-wheels --centre-axles --rename wheel-front-right=wheel_fl,wheel-front-left=wheel_fr,wheel-back-right=wheel_rl,wheel-back-left=wheel_rr)
K "$KITS/kenney_car-kit" $P race --as car "${CAR[@]}"
K "$KITS/kenney_car-kit" $P sedan-sports --as car_blue "${CAR[@]}"
K "$KITS/kenney_car-kit" $P hatchback-sports --as car_green "${CAR[@]}"
K "$KITS/kenney_car-kit" $P race-future --as car_yellow "${CAR[@]}"
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
