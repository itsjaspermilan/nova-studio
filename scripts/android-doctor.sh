#!/bin/sh
set -eu
NOVA_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
. "$NOVA_ROOT/scripts/toolchain-common.sh"
nova_environment
SDK=$ANDROID_HOME
failures=0
if [ -n "${JAVA_HOME:-}" ]; then JAVA="$JAVA_HOME/bin/java"; else JAVA=java; fi
if "$JAVA" -version > /dev/null 2>&1; then
    VERSION=$("$JAVA" -version 2>&1 | head -n 1)
    case "$VERSION" in
        *\"17.*) printf 'OK: %s\n' "$VERSION" ;;
        *) printf 'ERROR: Use JDK 17 via JAVA_HOME; found %s\n' "$VERSION"; failures=$((failures + 1)) ;;
    esac
else
    printf '%s\n' "ERROR: JDK 17 missing. Run ./scripts/setup-toolchain.sh --install, or set JAVA_HOME."
    failures=$((failures + 1))
fi
if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
    printf '%s\n' "ERROR: Android SDK missing. Run ./scripts/setup-toolchain.sh --install."
    failures=$((failures + 1))
else
    for component in "platforms/android-35/android.jar" "build-tools/35.0.0/aapt2" \
        "ndk/27.2.12479018/build/cmake/android.toolchain.cmake" "cmake/3.22.1/bin/cmake"; do
        if [ -f "$SDK/$component" ]; then
            printf 'OK: %s\n' "$component"
        else
            printf 'ERROR: SDK component missing: %s\n' "$component"
            failures=$((failures + 1))
        fi
    done
fi
if [ "$failures" -gt 0 ]; then
    printf '\nNova Android blocked: %s prerequisite checks failed. This check installs nothing. See README.md.\n' "$failures"
    exit 1
fi
printf '\nReady to build: %s/scripts/build-android.sh\n' "$NOVA_ROOT"
