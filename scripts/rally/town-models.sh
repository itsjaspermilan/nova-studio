#!/bin/bash
# Pine Ridge Rally's town in free roam: road tiles, street furniture and buildings from Kenney's City Kit Roads, Suburban and Commercial
# (CC0, licences/kenney-kits.txt), all at 14 times the kit's size (a road tile is 14 m: about the width of the generated roads; a house
# comes out some 18 m wide). Each building gets collision circles along its footprint, so that a car stops at its walls. Needs the kits
# unzipped: unzip examples/kenney_city-kit-roads.zip -d "$KITS/kenney_city-kit-roads" (and the suburban and commercial kits), then
#   KITS=/some/folder scripts/rally/town-models.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
KITS="${KITS:?set KITS to the folder the kits were unzipped into}"
P=examples/pine-ridge-rally
K() { scripts/env.sh node scripts/kenney.mjs "$@"; }
R="$KITS/kenney_city-kit-roads"; SU="$KITS/kenney_city-kit-suburban_20"; CO="$KITS/kenney_city-kit-commercial_2.1"
K "$R" $P road-straight --as ck_road_straight --scale 14
K "$R" $P road-crossroad --as ck_road_crossroad --scale 14
K "$R" $P road-intersection --as ck_road_intersection --scale 14
K "$R" $P road-end-round --as ck_road_end_round --scale 14
K "$R" $P road-roundabout --as ck_road_roundabout --scale 14
K "$R" $P light-curved --as ck_light_curved --scale 14
K "$R" $P traffic-light --as ck_traffic_light --scale 14
K "$R" $P sign-highway --as ck_sign_highway --scale 14
K "$R" $P electricity-pole --as ck_electricity_pole --scale 14 --collider 0:0:0.6
K "$SU" $P building-type-a --as ck_house_a --scale 14 --collider -2.3:0.0:6.8 --collider 2.3:0.0:6.8
K "$SU" $P building-type-b --as ck_house_b --scale 14 --collider -5.2:0.0:7.6 --collider 5.2:0.0:7.6
K "$SU" $P building-type-c --as ck_house_c --scale 14 --collider -2.2:0.0:6.8 --collider 2.2:0.0:6.8
K "$SU" $P building-type-d --as ck_house_d --scale 14 --collider -5.5:0.0:6.8 --collider 5.5:0.0:6.8
K "$SU" $P building-type-e --as ck_house_e --scale 14 --collider -2.3:0.0:6.8 --collider 2.3:0.0:6.8
K "$SU" $P building-type-f --as ck_house_f --scale 14 --collider 0.0:0.0:9.3
K "$SU" $P building-type-g --as ck_house_g --scale 14 --collider -2.4:0.0:7.8 --collider 2.4:0.0:7.8
K "$SU" $P building-type-h --as ck_house_h --scale 14 --collider -3.0:0.0:6.1 --collider 3.0:0.0:6.1
K "$SU" $P tree-large --as ck_tree_large --scale 14 --collider 0:0:0.8
K "$SU" $P tree-small --as ck_tree_small --scale 14 --collider 0:0:0.8
K "$CO" $P building-a --as ck_shop_a --scale 14 --collider 0.0:0.0:5.9
K "$CO" $P building-b --as ck_shop_b --scale 14 --collider 0.0:0.0:6.3
K "$CO" $P building-c --as ck_shop_c --scale 14 --collider 0.0:-1.8:5.9 --collider 0.0:1.8:5.9
K "$CO" $P building-d --as ck_shop_d --scale 14 --collider 0.0:0.0:5.6
K "$CO" $P building-e --as ck_shop_e --scale 14 --collider -4.8:0.0:6.6 --collider 4.8:0.0:6.6
K "$CO" $P building-f --as ck_shop_f --scale 14 --collider 0.0:-1.7:5.6 --collider 0.0:1.7:5.6
