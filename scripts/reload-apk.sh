#!/usr/bin/env bash
# Build a project's debug APK, install it on every connected device and emulator (or just the serials given), and restart it there.
#   scripts/reload-apk.sh [--project examples/pine-ridge-rally] [--no-build] [serial ...]
# The Retroid is bc8565a3 and the emulator profile retroid-sim shows up as emulator-5554 (start it with
#   scripts/env.sh bash -c '$ANDROID_HOME/emulator/emulator -avd retroid-sim -no-snapshot -no-audio -gpu swiftshader_indirect' &
# and leave it running; it renders in software at a few frames a second, so it says nothing about speed).
set -euo pipefail
cd "$(dirname "$0")/.."
project=examples/pine-ridge-rally
build=1
serials=()
while [ $# -gt 0 ]; do
  case "$1" in
    --project) project="$2"; shift 2 ;;
    --no-build) build=0; shift ;;
    *) serials+=("$1"); shift ;;
  esac
done
snake=$(/usr/bin/python3 -c "import json,re; print(re.sub(r'[^a-z0-9]+', '_', json.load(open('$project/nova.json'))['name'].lower()).strip('_'))")
[ "$build" = 1 ] && scripts/build-apk.sh --project "$project" | tail -2
apk="build/android/${snake}-debug.apk"
PKG="com.nova.games.${snake}"
if [ ${#serials[@]} -eq 0 ]; then
  serials=($(scripts/env.sh adb devices | awk 'NR>1 && $2=="device" {print $1}'))
fi
for s in "${serials[@]}"; do
  echo "== $s"
  scripts/env.sh adb -s "$s" install -r "$apk" | tail -1
  scripts/env.sh adb -s "$s" shell am start -S -n "$PKG/android.app.NativeActivity" >/dev/null
done
echo "reloaded $PKG on: ${serials[*]}"
