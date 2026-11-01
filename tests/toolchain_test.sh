#!/bin/bash
set -euo pipefail
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
TEST_STATE=$(mktemp -d "$ROOT/build-toolchain-tests.XXXXXX")
export TEST_STATE
cleanup() {
    result=$?
    if [ "$result" -ne 0 ]; then
        for log in "$TEST_STATE"/*.log; do
            printf '\nTest diagnostic: %s\n' "$log" >&2
            tail -35 "$log" >&2
        done
    fi
    case "$TEST_STATE" in "$ROOT"/build-toolchain-tests.*) rm -rf -- "$TEST_STATE" ;; esac
    exit "$result"
}
trap cleanup EXIT
export HOME="$TEST_STATE/home" ASDF_DATA_DIR="$TEST_STATE/asdf"
unset JAVA_HOME ANDROID_HOME ANDROID_SDK_ROOT NOVA_SDK_OVERRIDE
mkdir -p "$TEST_STATE/bin" "$HOME" "$TEST_STATE/bash/bin" "$TEST_STATE/cmake/bin" "$TEST_STATE/ninja/bin" "$TEST_STATE/plugins"
export PATH="$TEST_STATE/bin:$PATH"
export LOG="$TEST_STATE/actions.log"
touch "$LOG"
printf 'user configuration sentinel\n' > "$HOME/.tool-versions"
cp "$HOME/.tool-versions" "$TEST_STATE/user-config-before"

cat > "$TEST_STATE/bin/asdf" <<'MOCK'
#!/bin/bash
set -eu
case "$1 $2" in
    "plugin list") ls "$TEST_STATE/plugins" ;;
    "plugin add") printf 'plugin add %s\n' "$3" >> "$LOG"; touch "$TEST_STATE/plugins/$3" ;;
    "plugin update") printf 'plugin update %s\n' "$3" >> "$LOG" ;;
    "where java"|"where cmake")
        path="$TEST_STATE/asdf/installs/$2/$3"
        [ -d "$path" ] || exit 1
        printf '%s\n' "$path" ;;
    "which cmake") printf '%s/cmake/bin/cmake\n' "$TEST_STATE" ;;
    "install java"|"install cmake")
        path="$TEST_STATE/asdf/installs/$2/$3"
        if [ ! -d "$path" ]; then
            printf 'install %s %s\n' "$2" "$3" >> "$LOG"
            mkdir -p "$path/bin"
            if [ "$2" = java ]; then
                cat > "$path/bin/java" <<'JAVA'
#!/bin/sh
printf '%s\n' 'openjdk version "17.0.21"' >&2
JAVA
                cp "$path/bin/java" "$path/bin/javac"
            else
                printf '#!/bin/sh\necho "cmake version 3.31.8"\n' > "$path/bin/cmake"
            fi
            chmod +x "$path/bin/"*
        fi ;;
    *) echo "Unexpected mock asdf command: $*" >&2; exit 1 ;;
esac
MOCK
cat > "$TEST_STATE/bin/brew" <<'MOCK'
#!/bin/sh
set -eu
[ "$1" = --prefix ] && { printf '%s/%s\n' "$TEST_STATE" "$2"; exit 0; }
echo "Unexpected mock brew command: $*" >&2
exit 1
MOCK
cat > "$TEST_STATE/bash/bin/bash" <<'MOCK'
#!/bin/sh
if [ "${1:-}" = -c ]; then echo 5; else exec /bin/bash "$@"; fi
MOCK
cat > "$TEST_STATE/cmake/bin/cmake" <<'MOCK'
#!/bin/sh
echo "cmake version 3.31.8"
MOCK
cat > "$TEST_STATE/ninja/bin/ninja" <<'MOCK'
#!/bin/sh
echo "1.13.2"
MOCK
cat > "$TEST_STATE/bin/curl" <<'MOCK'
#!/bin/sh
set -eu
printf 'download\n' >> "$LOG"
while [ "$#" -gt 0 ]; do
    if [ "$1" = --output ]; then printf 'fake archive\n' > "$2"; exit 0; fi
    shift
done
exit 1
MOCK
cat > "$TEST_STATE/bin/shasum" <<'MOCK'
#!/bin/sh
cat >/dev/null
[ "${TEST_BAD_CHECKSUM:-0}" = 0 ]
MOCK
cat > "$TEST_STATE/bin/unzip" <<'MOCK'
#!/bin/sh
set -eu
directory="$4/cmdline-tools"
mkdir -p "$directory/bin"
printf 'Pkg.Revision=19.0\n' > "$directory/source.properties"
cp "$TEST_STATE/sdkmanager" "$directory/bin/sdkmanager"
chmod +x "$directory/bin/sdkmanager"
MOCK
cat > "$TEST_STATE/sdkmanager" <<'MOCK'
#!/bin/bash
set -eu
root=${1#--sdk_root=}
shift
printf 'MOCK SDK LICENSE: type y to accept this test fixture only.\n'
read -r answer
[ "$answer" = y ] || exit 1
for package in "$@"; do
    printf 'sdk package %s\n' "$package" >> "$LOG"
    case "$package" in
        platform-tools) marker=platform-tools/adb ;;
        "platforms;android-35") marker=platforms/android-35/android.jar ;;
        "build-tools;35.0.0") marker=build-tools/35.0.0/aapt2 ;;
        "ndk;27.2.12479018") marker=ndk/27.2.12479018/build/cmake/android.toolchain.cmake ;;
        "cmake;3.22.1") marker=cmake/3.22.1/bin/cmake ;;
        *) exit 1 ;;
    esac
    mkdir -p "$root/$(dirname "$marker")"
    touch "$root/$marker"
done
MOCK
chmod +x "$TEST_STATE/bin/"* "$TEST_STATE/bash/bin/bash" "$TEST_STATE/cmake/bin/cmake" "$TEST_STATE/ninja/bin/ninja"
SDK="$TEST_STATE/sdk with spaces"
mkdir -p "$SDK/ndk/unrelated-version" "$SDK/cmdline-tools/latest"
printf 'keep\n' > "$SDK/ndk/unrelated-version/sentinel"
printf 'keep latest\n' > "$SDK/cmdline-tools/latest/sentinel"
"$ROOT/scripts/setup-toolchain.sh" --dry-run --sdk-root "$SDK" > "$TEST_STATE/plan.log"
[ ! -s "$LOG" ]
grep -q 'Nothing installed' "$TEST_STATE/plan.log"
if "$ROOT/scripts/setup-toolchain.sh" --install --sdk-root "$SDK" </dev/null > "$TEST_STATE/decline.log" 2>&1; then
    echo "Setup must fail when bootstrap license is not accepted" >&2; exit 1
fi
! grep -q '^download' "$LOG"
printf 'ACCEPT\ny\n' | "$ROOT/scripts/setup-toolchain.sh" --install --sdk-root "$SDK" > "$TEST_STATE/install.log"
grep -q 'Ready. Build APK' "$TEST_STATE/install.log"
[ "$(grep -c '^download' "$LOG")" -eq 1 ]
[ "$(grep -c '^sdk package' "$LOG")" -eq 5 ]
[ "$(grep -c '^plugin add' "$LOG")" -eq 1 ]
! grep -q '^install cmake' "$LOG"
cp "$LOG" "$TEST_STATE/actions-before-rerun"
"$ROOT/scripts/setup-toolchain.sh" --install --sdk-root "$SDK" </dev/null > "$TEST_STATE/rerun.log"
cmp "$LOG" "$TEST_STATE/actions-before-rerun"
cmp "$HOME/.tool-versions" "$TEST_STATE/user-config-before"
grep -qx keep "$SDK/ndk/unrelated-version/sentinel"
grep -qx 'keep latest' "$SDK/cmdline-tools/latest/sentinel"

export TEST_BAD_CHECKSUM=1
if printf 'ACCEPT\n' | "$ROOT/scripts/setup-toolchain.sh" --install --sdk-root "$TEST_STATE/bad-sdk" > "$TEST_STATE/checksum.log" 2>&1; then
    echo "Bad archive checksum must fail" >&2; exit 1
fi
[ ! -e "$TEST_STATE/bad-sdk/cmdline-tools/19.0" ]
unset TEST_BAD_CHECKSUM
mkdir -p "$TEST_STATE/partial-sdk/cmdline-tools/19.0"
printf 'preserve partial\n' > "$TEST_STATE/partial-sdk/cmdline-tools/19.0/sentinel"
if "$ROOT/scripts/setup-toolchain.sh" --install --sdk-root "$TEST_STATE/partial-sdk" </dev/null > "$TEST_STATE/partial.log" 2>&1; then
    echo "Partial SDK destination must not be overwritten" >&2; exit 1
fi
grep -qx 'preserve partial' "$TEST_STATE/partial-sdk/cmdline-tools/19.0/sentinel"
if ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$TEST_STATE/other" \
    "$ROOT/scripts/setup-toolchain.sh" --dry-run > "$TEST_STATE/conflict.log" 2>&1; then
    echo "Conflicting SDK variables must fail" >&2; exit 1
fi
mkdir -p "$TEST_STATE/project/android"
cp "$ROOT/.tool-versions" "$TEST_STATE/project/.tool-versions"
printf 'sdk.dir=%s\n' "$SDK" > "$TEST_STATE/project/android/local.properties"
(
    NOVA_ROOT="$TEST_STATE/project"
    source "$ROOT/scripts/toolchain-common.sh"
    [ "$(nova_sdk_root)" = "$SDK" ]
    NOVA_SDK_OVERRIDE="$TEST_STATE/different"
    if nova_sdk_root > "$TEST_STATE/local-conflict.log" 2>&1; then exit 1; fi
)
grep -q 'buildToolsVersion "35.0.0"' "$ROOT/android/app/build.gradle"
grep -q 'ndkVersion "27.2.12479018"' "$ROOT/android/app/build.gradle"
grep -q 'version "3.22.1"' "$ROOT/android/app/build.gradle"
! grep -q '^cmake ' "$ROOT/.tool-versions"
! grep -q 'asdf install cmake' "$ROOT/scripts/setup-toolchain.sh"
! grep -Eq 'xattr -|spctl --master-disable' "$ROOT/scripts/setup-toolchain.sh"
printf '%s\n' "Toolchain tests passed: dry-run, pins, license refusal, install, idempotency, checksum failure, SDK/config preservation and path conflicts."
