#!/bin/sh
set -eu
NOVA_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
. "$NOVA_ROOT/scripts/toolchain-common.sh"
nova_environment
sh "$NOVA_ROOT/scripts/android-doctor.sh"
cd "$NOVA_ROOT/android"
./gradlew :app:assembleDebug
sh "$NOVA_ROOT/scripts/verify-apk.sh"
printf '\nAPK: %s/android/app/build/outputs/apk/debug/app-debug.apk\n' "$NOVA_ROOT"
