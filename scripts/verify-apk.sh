#!/bin/sh
set -eu
NOVA_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
[ "$#" -le 1 ] || { printf 'Usage: scripts/verify-apk.sh [APK]\n' >&2; exit 2; }
exec "$NOVA_ROOT/scripts/export-apk.sh" verify --apk "${1:-$NOVA_ROOT/android/app/build/outputs/apk/debug/app-debug.apk}"
