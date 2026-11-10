#!/bin/bash
# Builds a debug-signed APK without Gradle. The work is done by `nova export android` (crates/nova-runtime/src/android.rs):
# cargo-ndk (native library, only when the runtime changed) -> aapt2 (manifest + resources) -> zip (lib, game) -> zipalign
# -> apksigner. The debug keystore is generated locally under build/android/ and is never committed.
#
#   scripts/build-apk.sh                                 the M1 benchmark scene -> build/android/nova-spike-debug.apk
#   scripts/build-apk.sh --project examples/pine-ridge-rally   a game                 -> build/android/<id>-debug.apk
#   add --debug-build for an unoptimised native library, --rebuild to build everything again, --fast for a quicker engine build
#   (no link-time optimisation: a one-file engine edit takes seconds, not a minute; slightly slower on the device, so measure with the default)
#   Before building, the APKs of earlier builds and the work folders of other games (more than a week old) are deleted, so old builds do
#   not pile up; --keep leaves them.
# (it builds the game as it is: --no-check skips the check `nova export android` does first)
set -euo pipefail
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

ARGS=(--benchmark)
FLAGS=()
KEEP=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        --debug-build|--rebuild) FLAGS+=("$1") ;;
        --fast) FLAGS+=("$1") ;;
        --keep) KEEP=1 ;;
        --project) ARGS=("${2:?--project needs a folder}"); shift ;;
        *) echo "build-apk: unknown argument '$1'" >&2; exit 2 ;;
    esac
    shift
done
if [ "$KEEP" = 0 ]; then
    rm -f build/android/*.apk
    [ -d build/android/work ] && find build/android/work -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} + || true
fi
# (the host `nova` that packs the APK always uses the fast profile: packing a game needs no link-time optimisation)
exec scripts/env.sh cargo run -q --profile fast -p nova-runtime --bin nova -- \
    export android "${ARGS[@]}" --out build/android --no-check ${FLAGS[@]+"${FLAGS[@]}"}
