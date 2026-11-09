#!/bin/bash
# Measures what the renderer's opt-in graphics settings cost on a device: for each setting it forces the settings (the file
# /data/local/tmp/nova-graphics.<package>, read by Quality::forced), restarts the game, lets it settle, and prints the mean fps and GPU
# milliseconds of the log's per-second lines.
#
#   scripts/graphics-bench.sh [--package com.nova.games.pine_ridge_roam] [--seconds 24] "" hdr msaa=4 "hdr,msaa=4" ...
#
# "" is the plain engine (no file). Install the APK first (scripts/build-apk.sh, adb install -r). The scene stands still: the same
# picture every time, so the numbers compare.
# (`height=N` is accepted as a spec item and forces the world picture height through the same file.)
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=scripts/env.sh
pkg=com.nova.games.pine_ridge_roam
secs=24
while [ $# -gt 0 ]; do
  case "$1" in
    --package) pkg="$2"; shift 2 ;;
    --seconds) secs="$2"; shift 2 ;;
    *) break ;;
  esac
done
measure() {
  # the log lines of this game's process only (another game on the same device logs to the same buffer), and only if it is the
  # app in front: a game that is not in front is paused or not drawing, and its numbers would be a menu's or nothing
  local pid focus
  pid=$("$ENV" adb shell pidof "$pkg" | tr -d '\r' | awk '{print $1}')
  focus=$("$ENV" adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus || true)
  if [ -z "$pid" ] || ! echo "$focus" | grep -q "$pkg"; then
    echo BUSY
    return
  fi
  "$ENV" adb logcat -d --pid="$pid" 2>/dev/null | grep -E "fps=.* gpu=" | tail -26 | head -25 | \
    sed -E 's/.*fps=([0-9.]+).*render=([0-9.]+)ms gpu=([0-9.]+)ms.*tris=([0-9]+).*/\1 \2 \3 \4/' | \
    awk '{f+=$1; r+=$2; g+=$3; t=$4; n++} END {if (n) printf "fps %.1f  render %.2f ms  gpu %.2f ms  tris %d  (%d readings)", f/n, r/n, g/n, t, n; else printf "no readings"}'
}
for spec in "$@"; do
  result=BUSY
  for attempt in 1 2 3; do
    "$ENV" adb shell am force-stop "$pkg"
    if [ -z "$spec" ]; then
      "$ENV" adb shell rm -f /data/local/tmp/nova-graphics.$pkg
    else
      "$ENV" adb shell "echo '$spec' > /data/local/tmp/nova-graphics.$pkg"
    fi
    "$ENV" adb logcat -c
    "$ENV" adb shell am start -n "$pkg/android.app.NativeActivity" >/dev/null
    sleep "$secs"
    result=$(measure)
    [ "$result" != BUSY ] && break
  done
  printf "%-40s %s\n" "${spec:-plain}" "$([ "$result" = BUSY ] && echo "device busy: another app was in front" || echo "$result")"
done
"$ENV" adb shell rm -f /data/local/tmp/nova-graphics.$pkg
"$ENV" adb shell am force-stop "$pkg"
