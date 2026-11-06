#!/bin/bash
# Runs the Nova Stress benchmark again and again on a device (default 8 runs, about 12 minutes) and prints, for each run, the
# frame rate and GPU time of a few phases with the battery and chip temperatures, to see whether speed drops as the device warms.
# The stress APK must be installed (scripts/bench.sh does that). Use ANDROID_SERIAL to pick a device.
#
#   scripts/heat-run.sh [runs]
set -uo pipefail
cd "$(dirname "$0")/.."
ENV=scripts/env.sh
RUNS="${1:-8}"
PKG=com.nova.games.nova_stress

temps() {
    # battery, then the hottest of the zones that name a cpu, gpu or skin sensor
    local bat zones
    bat=$("$ENV" adb shell dumpsys battery | awk '/temperature/ {printf "%.1f", $2/10}')
    zones=$("$ENV" adb shell 'for z in /sys/class/thermal/thermal_zone*; do t=$(cat $z/type 2>/dev/null); v=$(cat $z/temp 2>/dev/null); echo "$t $v"; done' \
        | tr -d '\r' | awk '/cpu|gpu|skin|xo/ && $2 > 1000 {v=$2/1000; if (v > m) {m=v; n=$1}} END {printf "%.1f (%s)", m, n}')
    echo "battery ${bat}C, hottest sensor ${zones}C"
}

echo "start: $(temps)"
for run in $(seq 1 "$RUNS"); do
    "$ENV" adb shell am force-stop "$PKG"
    "$ENV" adb logcat -c
    "$ENV" adb shell am start -n "$PKG/android.app.NativeActivity" >/dev/null
    for _ in $(seq 1 40); do
        sleep 3
        "$ENV" adb logcat -d 2>/dev/null | grep -q "bench: done" && break
    done
    log=$("$ENV" adb logcat -d 2>/dev/null | grep "bench: phase=" | sed -E 's/.*bench: //')
    echo "run $run  $(date +%H:%M:%S)  $(temps)"
    echo "$log" | grep -E "phase=(city 48x48|city 24 \+ shadows|worst)" | sed -E 's/phase=(.*) fps=([0-9.]+) p95=([0-9.]+) max=([0-9.]+) lua=([0-9.]+) render=([0-9.]+) gpu=([0-9.]+).*/    \1: fps \2, p95 \3, max \4, gpu \7 ms/'
done
echo "end: $(temps)"
