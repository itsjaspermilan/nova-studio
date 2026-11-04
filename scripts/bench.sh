#!/bin/bash
# Runs the Nova Stress benchmark (examples/stress) on an Android device or emulator and prints one line per phase:
# frames a second, the 95th percentile and worst frame time, Lua and recording time, the GPU's own time, draws, triangles, culled.
#
#   scripts/bench.sh            build, install, run and read the log (a connected device, else the running emulator)
#   scripts/bench.sh --desktop  run it headless on this machine instead (numbers lag a second; not vsynced)
#
# The first thing to run on the Retroid: `gpu=` is the GPU's own time and is the number to watch against 16.7 ms.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=scripts/env.sh

if [ "${1:-}" = "--desktop" ]; then
    RUST_LOG=info "$ENV" cargo run --release -p nova-runtime --bin nova -- run examples/stress --headless --frames 3700 2>&1 \
        | grep -E "bench:" | sed -E 's/.*bench: //'
    exit 0
fi

scripts/build-apk.sh --project examples/stress >/dev/null
APK=build/android/nova_stress-debug.apk
"$ENV" adb install -r "$APK" >/dev/null
"$ENV" adb shell am force-stop com.nova.games.nova_stress
"$ENV" adb logcat -c
"$ENV" adb shell am start -n com.nova.games.nova_stress/android.app.NativeActivity >/dev/null
echo "running on: $("$ENV" adb shell getprop ro.product.model | tr -d '\r') (about a minute)" >&2
for _ in $(seq 1 60); do
    "$ENV" adb logcat -d 2>/dev/null | grep -q "bench: done" && break
    sleep 5
done
"$ENV" adb logcat -d 2>/dev/null | grep -E "adapter:|bench:" | sed -E 's/.*(adapter:)/\1/;s/.*bench: //'
