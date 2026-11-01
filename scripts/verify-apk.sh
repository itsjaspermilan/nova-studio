#!/bin/sh
set -eu
NOVA_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
. "$NOVA_ROOT/scripts/toolchain-common.sh"
nova_environment
[ "$#" -le 1 ] || { nova_fail "Usage: scripts/verify-apk.sh [APK]"; exit 2; }
APK=${1:-"$NOVA_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"}
[ -f "$APK" ] || { nova_fail "APK not found: $APK"; exit 1; }
case "$(uname -s)" in
    Darwin) host=darwin-x86_64 ;;
    Linux) host=linux-x86_64 ;;
    *) nova_fail "Unsupported APK verification host"; exit 1 ;;
esac
LLVM="$ANDROID_HOME/ndk/27.2.12479018/toolchains/llvm/prebuilt/$host/bin"
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --verbose "$APK"
mkdir -p "$NOVA_ROOT/build"
TEMP=$(mktemp "$NOVA_ROOT/build/apk-verify.XXXXXX")
trap 'rm -f -- "$TEMP"' EXIT HUP INT TERM
unzip -p "$APK" lib/arm64-v8a/libnova_runtime.so > "$TEMP"
"$LLVM/llvm-readelf" -h "$TEMP" | grep -q 'Machine:.*AArch64' ||
    { nova_fail "APK runtime is not AArch64"; exit 1; }
symbols=$("$LLVM/llvm-nm" -D --defined-only "$TEMP")
for symbol in ANativeActivity_onCreate android_main nova_tick; do
    printf '%s\n' "$symbols" | grep -Eq "[[:space:]]${symbol}$" ||
        { nova_fail "APK runtime lacks required exported symbol: $symbol"; exit 1; }
done
find "$NOVA_ROOT/examples/assets" -type f | while IFS= read -r file; do
    relative=${file#"$NOVA_ROOT/"}
    unzip -p "$APK" "assets/$relative" > "$TEMP"
    cmp "$file" "$TEMP" ||
        { nova_fail "APK project file does not match source: $relative"; exit 1; }
done
for example in 2d mixed; do
    unzip -p "$APK" "assets/examples/$example/main.lua" > "$TEMP"
    cmp "$NOVA_ROOT/examples/$example/main.lua" "$TEMP" ||
        { nova_fail "APK example does not match source: $example"; exit 1; }
done
for notice in lua.txt raylib.txt Apache-2.0.txt CC0-1.0.txt README.txt; do
    unzip -p "$APK" "assets/licenses/$notice" > "$TEMP"
    cmp "$NOVA_ROOT/licenses/$notice" "$TEMP" ||
        { nova_fail "APK license does not match source: $notice"; exit 1; }
done
printf 'APK verified: signing, ARM64 activity entry points, Lua examples, project manifest/assets and license notices.\n'
printf 'Hardware execution and lifecycle behavior are not validated by this check.\n'
