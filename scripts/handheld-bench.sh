#!/bin/bash
# Measures frame pacing of a game on the Linux handheld (the Retroid Pocket 6 under Armada/gamescope, reached over SSH):
# builds the game for arm64, copies the program beside the installed game as <id>_bench (the installed game is not touched),
# runs it on the handheld's screen with a scripted input route, logs every frame (NOVA_FRAME_LOG) and summarises it here.
#
#   scripts/handheld-bench.sh [--host armada@192.168.2.91] [--project examples/mountain-post] [--scene valley]
#                             [--route scripts/bench/fernhollow-camera-turn.json] [--frames 2000] [--no-build]
#
# Read "frames whose given step differs from the previous by >2 ms": the share of frames whose world moved unevenly (it was
# 23.5% before the pacer fix of 2026-11-23, 0.5% after). Close the game in Steam first: two games fight over the screen.
set -euo pipefail
cd "$(dirname "$0")/.."
host=armada@192.168.2.91
project=examples/mountain-post
scene=valley
route=scripts/bench/fernhollow-camera-turn.json
frames=2000
build=1
while [ $# -gt 0 ]; do
  case "$1" in
    --host) host="$2"; shift 2 ;;
    --project) project="$2"; shift 2 ;;
    --scene) scene="$2"; shift 2 ;;
    --route) route="$2"; shift 2 ;;
    --frames) frames="$2"; shift 2 ;;
    --no-build) build=0; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
id=$(scripts/env.sh cargo run -q --release -p nova-runtime --bin nova -- info "$project" | awk -F= '/^id=/ {print $2}')
[ -n "$id" ] || { echo "no id for $project" >&2; exit 1; }
if [ "$build" = 1 ]; then
  scripts/build-linux-arm64.sh --release --project "$project" >/dev/null
fi
out=build/linux-arm64/export/$id
ssh -o ConnectTimeout=10 "$host" "test -f nova/$id/game.npk" || { echo "install the game on the handheld first (nova/$id)" >&2; exit 1; }
scp -q "$out/$id" "$host:nova/$id/${id}_bench"
scp -q "$out/game.npk" "$host:nova/$id/game_bench.npk"
scp -q "$route" "$host:nova/bench-route.json"
ssh "$host" "cd nova/$id && NOVA_FRAME_LOG=../bench-frames.txt DISPLAY=:0 XDG_RUNTIME_DIR=/run/user/1000 timeout 120 ./${id}_bench run --pak game_bench.npk --no-audio --start-scene $scene --input ../bench-route.json --frames $frames > ../bench-run.log 2>&1; grep -E 'windowed:|adapter:' ../bench-run.log"
mkdir -p build/bench
scp -q "$host:nova/bench-frames.txt" build/bench/frames.txt
scripts/env.sh node scripts/lib/frame-log.mjs build/bench/frames.txt
