#!/bin/bash
# Builds each example game as an APK, installs it on the connected device, runs it for a few seconds and reports whether it started
# (the process is alive, nothing in the log says error or panic) with a screenshot in build/smoke/. It is a smoke test for the engine
# after a change to what every game shares, not a test of any game.
#
#   scripts/device-smoke.sh [seconds] [example folder names...]     (default: 12 seconds, every example with a nova.json)
set -uo pipefail
cd "$(dirname "$0")/.."
ENV=scripts/env.sh
SECONDS_EACH="${1:-12}"
shift || true
NAMES=("$@")
if [ ${#NAMES[@]} -eq 0 ]; then
    for d in examples/*/; do [ -f "$d/nova.json" ] && NAMES+=("$(basename "$d")"); done
fi
mkdir -p build/smoke
pass=0; fail=0
for name in "${NAMES[@]}"; do
    project="examples/$name"
    out=$(scripts/build-apk.sh --project "$project" 2>&1)
    pkg=$(echo "$out" | sed -n 's/^package: \([^ ]*\) .*/\1/p' | tail -1)
    apk=$(ls -t build/android/*-debug.apk | head -1)
    if [ -z "$pkg" ]; then echo "FAIL  $name: could not build ($(echo "$out" | tail -1))"; fail=$((fail + 1)); continue; fi
    "$ENV" adb install -r "$apk" >/dev/null 2>&1
    "$ENV" adb shell am force-stop "$pkg"
    "$ENV" adb logcat -c
    "$ENV" adb shell am start -n "$pkg/android.app.NativeActivity" >/dev/null 2>&1
    sleep "$SECONDS_EACH"
    alive=$("$ENV" adb shell pidof "$pkg" | tr -d '\r')
    bad=$("$ENV" adb logcat -d 2>/dev/null | grep -iE "panicked|FATAL|lua error|runtime error|\bERROR\b.*(nova|wgpu)" | head -3)
    "$ENV" adb exec-out screencap -p > "build/smoke/$name.png"
    "$ENV" adb shell am force-stop "$pkg"
    if [ -n "$alive" ] && [ -z "$bad" ]; then echo "ok    $name"; pass=$((pass + 1));
    else echo "FAIL  $name: ${alive:+alive, }${bad:-no process}"; fail=$((fail + 1)); fi
done
echo "$pass ok, $fail failed (screenshots in build/smoke/)"
