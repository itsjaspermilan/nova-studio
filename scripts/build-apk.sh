#!/bin/bash
# Builds a debug-signed APK without Gradle. The work is done by `nova export android` (crates/nova-runtime/src/android.rs):
# cargo-ndk (native library, only when the runtime changed) -> aapt2 (manifest + resources) -> zip (lib, game) -> zipalign
# -> apksigner. The debug keystore is generated locally under build/android/ and is never committed.
#
#   scripts/build-apk.sh                                 the M1 benchmark scene -> build/android/nova-spike-debug.apk
#   scripts/build-apk.sh --project examples/crate-dash   a game                 -> build/android/<id>-debug.apk
#   add --debug-build for an unoptimised native library, --rebuild to build everything again
# (it builds the game as it is: --no-check skips the check `nova export android` does first)
set -euo pipefail
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

ARGS=(--benchmark)
FLAGS=()
while [ "$#" -gt 0 ]; do
    case "$1" in
        --debug-build|--rebuild) FLAGS+=("$1") ;;
        --project) ARGS=("${2:?--project needs a folder}"); shift ;;
        *) echo "build-apk: unknown argument '$1'" >&2; exit 2 ;;
    esac
    shift
done
exec scripts/env.sh cargo run -q --release -p nova-runtime --bin nova -- \
    export android "${ARGS[@]}" --out build/android --no-check ${FLAGS[@]+"${FLAGS[@]}"}
