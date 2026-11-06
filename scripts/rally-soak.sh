#!/bin/bash
# A thermal soak of Pine Ridge Rally on a connected device: the computer drives race after race (the game's F9 key, sent with
# `adb input`), and every 30 seconds the log line `rally: perf` (fps, the GPU's own ms, frame times) is printed with the battery
# and hottest chip temperatures, to see whether speed drops as the device warms. The device must be awake and on the rally's
# APK (scripts/build-apk.sh --project examples/pine-ridge-rally). Note: over USB the device is charging, so this is a soak on
# power, not a battery-drain test.
#
#   scripts/rally-soak.sh [minutes]      (default 40)
set -uo pipefail
cd "$(dirname "$0")/.."
ENV=scripts/env.sh
MINUTES="${1:-40}"
PKG=com.nova.games.pine_ridge_rally
KEY_ENTER=66; KEY_RIGHT=22; KEY_DOWN=20; KEY_F9=140

key() { "$ENV" adb shell input keyevent "$1"; sleep "${2:-0.4}"; }

temps() {
    local bat zones
    bat=$("$ENV" adb shell dumpsys battery | awk '/temperature/ {printf "%.1f", $2/10}')
    zones=$("$ENV" adb shell 'for z in /sys/class/thermal/thermal_zone*; do t=$(cat $z/type 2>/dev/null); v=$(cat $z/temp 2>/dev/null); echo "$t $v"; done' \
        | tr -d '\r' | awk '/cpu|gpu|skin|xo/ && $2 > 1000 {v=$2/1000; if (v > m) {m=v; n=$1}} END {printf "%.1f (%s)", m, n}')
    echo "battery ${bat}C, hottest ${zones}C"
}

start_race() {   # from a cold start of the app: title -> menu -> chooser -> START (on the circuit last chosen, stepped on by $1)
    "$ENV" adb shell am force-stop "$PKG"
    "$ENV" adb logcat -c
    "$ENV" adb shell am start -n "$PKG/android.app.NativeActivity" >/dev/null
    sleep 9
    key $KEY_ENTER; key $KEY_ENTER
    for _ in $(seq 1 "$1"); do key $KEY_RIGHT; done
    for _ in 1 2 3 4; do key $KEY_DOWN; done
    key $KEY_ENTER
    sleep 7
    key $KEY_F9
}

end=$(( $(date +%s) + MINUTES * 60 ))
echo "start: $(temps)"
cycle=0
while [ "$(date +%s)" -lt "$end" ]; do
    start_race $(( cycle % 4 == 0 ? 0 : 1 ))
    cycle=$((cycle + 1))
    # about five minutes a race: print the newest perf line twice a minute
    for _ in $(seq 1 10); do
        [ "$(date +%s)" -ge "$end" ] && break
        sleep 30
        line=$("$ENV" adb logcat -d 2>/dev/null | grep "rally: perf" | tail -1 | sed -E 's/.*rally: perf //')
        echo "$(date +%H:%M:%S)  cycle $cycle  ${line:-no perf line}  $(temps)"
    done
done
echo "end: $(temps)"
