#!/bin/bash
# Builds a debug-signed APK without Gradle:
#   cargo-ndk (native library) -> aapt2 (manifest + assets) -> zip (lib) -> zipalign -> apksigner.
# The debug keystore is generated locally under build/android/ and is never committed.
# `nova export android <project>` checks the game and then runs this script.
#
#   scripts/build-apk.sh                       the M1 benchmark scene  -> build/android/nova-spike-debug.apk
#   scripts/build-apk.sh --project examples/crate-dash   a game      -> build/android/<id>-debug.apk
#   add --debug-build for an unoptimised native library
set -euo pipefail
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

PROFILE=release
CARGO_FLAGS=(--release)
PROJECT=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --debug-build) PROFILE=debug; CARGO_FLAGS=() ;;
        --project) PROJECT=${2:?--project needs a folder}; shift ;;
        *) echo "build-apk: unknown argument '$1'" >&2; exit 2 ;;
    esac
    shift
done

ENV="$ROOT/scripts/env.sh"
OUT="$ROOT/build/android"
ABI=arm64-v8a
mkdir -p "$OUT"

# What the game is called, from its nova.json (or the benchmark's defaults).
PACKAGE=com.nova.spike
LABEL="Nova Spike"
VERSION=0.1.0
APK_NAME=nova-spike
rm -rf "$OUT/assets" && mkdir -p "$OUT/assets"
# The licences of the software the runtime is built from travel with every APK.
cp licenses/rust-dependencies.txt "$OUT/assets/THIRD-PARTY.txt"
if [ -n "$PROJECT" ]; then
    while IFS='=' read -r key value; do
        case "$key" in
            name) LABEL=$value ;;
            version) VERSION=$value ;;
            id) PACKAGE="com.nova.games.$value"; APK_NAME=$value ;;
        esac
    done < <("$ENV" cargo run -q --release -p nova-runtime --bin nova -- info "$PROJECT")
    "$ENV" cargo run -q --release -p nova-runtime --bin nova -- pack "$PROJECT" "$OUT/assets/project.npk"
fi

"$ENV" cargo ndk -t "$ABI" --platform 26 build "${CARGO_FLAGS[@]}" -p nova-runtime --lib
LIB="$ROOT/target/aarch64-linux-android/$PROFILE/libnova_runtime.so"
[ -f "$LIB" ] || { echo "build-apk: missing $LIB" >&2; exit 1; }

JAR=$("$ENV" bash -c 'echo "$ANDROID_HOME/platforms/android-36/android.jar"')
[ -f "$JAR" ] || { echo "build-apk: missing $JAR" >&2; exit 1; }

# Fill the manifest template (XML-escaping the label).
xml_escape() { local s=$1; s=${s//&/&amp;}; s=${s//</&lt;}; s=${s//>/&gt;}; s=${s//\"/&quot;}; printf '%s' "$s"; }
MANIFEST="$OUT/AndroidManifest.xml"
sed -e "s|@PACKAGE@|$PACKAGE|" -e "s|@LABEL@|$(xml_escape "$LABEL")|" \
    crates/nova-runtime/android/AndroidManifest.xml > "$MANIFEST"

BASE="$OUT/base.apk"
"$ENV" aapt2 link -o "$BASE" --manifest "$MANIFEST" -A "$OUT/assets" \
    -I "$JAR" --min-sdk-version 26 --target-sdk-version 34 --version-code 1 --version-name "$VERSION"

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
APK="$OUT/$APK_NAME-debug.apk"
"$ENV" apksigner sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
    --ks-key-alias nova-debug --out "$APK" "$ALIGNED"
"$ENV" apksigner verify --verbose "$APK" | head -4
echo "package: $PACKAGE   label: $LABEL   version: $VERSION"
ls -l "$APK"
