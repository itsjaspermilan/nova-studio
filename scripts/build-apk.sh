#!/bin/bash
# Builds a debug-signed APK of the runtime spike without Gradle:
#   cargo-ndk (native library) -> aapt2 (manifest) -> zip (lib) -> zipalign -> apksigner.
# The debug keystore is generated locally under build/android/ and is never committed.
# This is the seed of the `nova export android` command (TODO M3).
#
#   scripts/build-apk.sh [--debug-build]   release build by default; output: build/android/nova-spike-debug.apk
set -euo pipefail
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

PROFILE=release
CARGO_FLAGS=(--release)
[ "${1:-}" = "--debug-build" ] && { PROFILE=debug; CARGO_FLAGS=(); }

ENV="$ROOT/scripts/env.sh"
OUT="$ROOT/build/android"
ABI=arm64-v8a
mkdir -p "$OUT"

"$ENV" cargo ndk -t "$ABI" --platform 26 build "${CARGO_FLAGS[@]}" -p nova-runtime --lib
LIB="$ROOT/target/aarch64-linux-android/$PROFILE/libnova_runtime.so"
[ -f "$LIB" ] || { echo "build-apk: missing $LIB" >&2; exit 1; }

JAR=$("$ENV" bash -c 'echo "$ANDROID_HOME/platforms/android-36/android.jar"')
[ -f "$JAR" ] || { echo "build-apk: missing $JAR" >&2; exit 1; }

BASE="$OUT/base.apk"
"$ENV" aapt2 link -o "$BASE" --manifest crates/nova-runtime/android/AndroidManifest.xml \
    -I "$JAR" --min-sdk-version 26 --target-sdk-version 34 --version-code 1 --version-name 0.1.0

# Native libraries are stored uncompressed so zipalign -p can page-align them.
STAGE="$OUT/stage"
rm -rf "$STAGE" && mkdir -p "$STAGE/lib/$ABI"
cp "$LIB" "$STAGE/lib/$ABI/libnova_runtime.so"
(cd "$STAGE" && zip -q -0 -r "$BASE" lib)

ALIGNED="$OUT/aligned.apk"
rm -f "$ALIGNED"
"$ENV" zipalign -f -p 4 "$BASE" "$ALIGNED"

KEYSTORE="$OUT/debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
    "$ENV" bash -c 'keytool -genkeypair -keystore "$0" -storepass android -keypass android \
        -alias nova-debug -keyalg RSA -keysize 2048 -validity 10000 \
        -dname "CN=Nova Debug,O=Nova Studio,C=US"' "$KEYSTORE" >/dev/null
fi
APK="$OUT/nova-spike-debug.apk"
"$ENV" apksigner sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
    --ks-key-alias nova-debug --out "$APK" "$ALIGNED"
"$ENV" apksigner verify --verbose "$APK" | head -4
ls -l "$APK"
