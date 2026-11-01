#!/bin/bash
set -euo pipefail
NOVA_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
source "$NOVA_ROOT/scripts/toolchain-common.sh"
MODE=plan
while [ "$#" -gt 0 ]; do
    case "$1" in
        --install) MODE=install ;;
        --dry-run) MODE=plan ;;
        --sdk-root)
            [ "$#" -ge 2 ] || { nova_fail "--sdk-root requires an absolute path"; exit 2; }
            NOVA_SDK_OVERRIDE=$2
            export NOVA_SDK_OVERRIDE
            shift ;;
        --help)
            printf '%s\n' "Usage: scripts/setup-toolchain.sh [--dry-run | --install] [--sdk-root /absolute/path]"
            printf '%s\n' "Default: read-only plan. --install authorizes downloads; SDK licenses remain interactive."
            exit 0 ;;
        *) nova_fail "Unknown option: $1"; exit 2 ;;
    esac
    shift
done
ANDROID_HOME=$(nova_sdk_root)
export ANDROID_HOME
SDKMANAGER="$ANDROID_HOME/cmdline-tools/$NOVA_ANDROID_CLI_VERSION/bin/sdkmanager"
PACKAGES=("platform-tools" "platforms;android-35" "build-tools;35.0.0" "ndk;27.2.12479018" "cmake;3.22.1")

printf 'Nova toolchain %s\nSDK root: %s\n' "$MODE" "$ANDROID_HOME"
printf 'asdf JDK pin: %s; host CMake: Homebrew/system CLI %s+\n' "$NOVA_JAVA_VERSION" "$NOVA_NATIVE_CMAKE_MINIMUM"
printf 'Android command-line tools: %s (archive build %s)\n' "$NOVA_ANDROID_CLI_VERSION" "$NOVA_ANDROID_CLI_BUILD"
printf '%s\n' "Fresh setup: approximately 2-4 GB downloads and 8-12 GB disk, plus temporary extraction space."
printf '%s\n' "No shell startup files, global .tool-versions, existing plugins or unrelated SDK versions will be replaced."
if command -v asdf >/dev/null 2>&1 && nova_asdf_where java "$NOVA_JAVA_VERSION" >/dev/null 2>&1; then
    printf 'Present asdf JDK pin: %s\n' "$NOVA_JAVA_VERSION"
else
    printf 'Needed asdf JDK pin: %s\n' "$NOVA_JAVA_VERSION"
fi
if cmake_binary=$(nova_host_tool cmake 2>/dev/null); then
    printf 'Present host CMake CLI: %s\n' "$cmake_binary"
else
    printf 'Needed: Homebrew/system CMake CLI\n'
fi
if ninja_binary=$(nova_host_tool ninja 2>/dev/null); then
    printf 'Present host Ninja CLI: %s\n' "$ninja_binary"
else
    printf 'Needed: Homebrew/system Ninja 1.10+\n'
fi
for package in "${PACKAGES[@]}"; do
    marker=$(nova_component_marker "$package")
    if [ -f "$marker" ]; then printf 'Present: %s\n' "$package"; else printf 'Needed: %s\n' "$package"; fi
done
if [ "$MODE" = plan ]; then
    command -v asdf >/dev/null 2>&1 || printf '%s\n' "Needed: asdf (installed through Homebrew on macOS, if available)"
    [ -x "$SDKMANAGER" ] || printf '%s\n' "Needed: pinned Android command-line tools bootstrap"
    printf '%s\n' "Nothing installed. Run ./scripts/setup-toolchain.sh --install to proceed."
    exit 0
fi

for tool in curl unzip shasum git; do
    command -v "$tool" >/dev/null 2>&1 || { nova_fail "Missing prerequisite: $tool"; exit 1; }
done
if ! command -v asdf >/dev/null 2>&1; then
    if [ "$(uname -s)" = Darwin ] && command -v brew >/dev/null 2>&1; then
        HOMEBREW_NO_AUTO_UPDATE=1 brew install asdf
    else
        nova_fail "Install asdf 0.16+ using https://asdf-vm.com/guide/getting-started.html, then retry."
        exit 1
    fi
fi
if [ "$BASH_VERSINFO" -lt 5 ]; then
    if command -v brew >/dev/null 2>&1; then
        bash_prefix=$(brew --prefix bash)
        if [ ! -x "$bash_prefix/bin/bash" ]; then HOMEBREW_NO_AUTO_UPDATE=1 brew install bash; fi
        PATH="$bash_prefix/bin:$PATH"
        export PATH
        [ "$("$bash_prefix/bin/bash" -c 'echo "${BASH_VERSINFO[0]}"')" -ge 5 ] ||
            { nova_fail "The Java asdf plugin requires Bash 5+"; exit 1; }
    else
        nova_fail "The Java asdf plugin requires Bash 5+. Install it using your package manager."
        exit 1
    fi
fi

ensure_plugin() {
    local name=$1 url=$2 revision=$3
    local plugins
    plugins=$(asdf plugin list)
    if printf '%s\n' "$plugins" | grep -qx "$name"; then
        printf 'Reusing existing asdf plugin: %s (not updated)\n' "$name"
    else
        asdf plugin add "$name" "$url"
        asdf plugin update "$name" "$revision"
    fi
}
cd "$NOVA_ROOT"
ensure_plugin java "$NOVA_JAVA_PLUGIN" "$NOVA_JAVA_PLUGIN_REVISION"
asdf install java "$NOVA_JAVA_VERSION"
if command -v brew >/dev/null 2>&1; then
    for host_tool in cmake ninja; do
        tool_prefix=$(brew --prefix "$host_tool")
        if [ ! -x "$tool_prefix/bin/$host_tool" ]; then HOMEBREW_NO_AUTO_UPDATE=1 brew install "$host_tool"; fi
    done
fi
nova_check_host_cmake
nova_check_host_ninja
# Use the explicit project pin for installation, without rewriting the caller's JAVA_HOME.
JAVA_HOME=$(nova_asdf_where java "$NOVA_JAVA_VERSION")
export JAVA_HOME
nova_environment
if ! "$JAVA_HOME/bin/java" -version >/dev/null 2>&1; then
    nova_fail "Pinned JDK failed to execute at $JAVA_HOME; SDK installation will not proceed."
    exit 1
fi

STAGING=
cleanup() {
    if [ -n "$STAGING" ]; then
        case "$STAGING" in
            "$ANDROID_HOME"/.nova-bootstrap.*) rm -rf -- "$STAGING" ;;
            *) printf 'Nova: refusing to clean unexpected staging path: %s\n' "$STAGING" >&2 ;;
        esac
    fi
}
trap cleanup EXIT
if [ ! -x "$SDKMANAGER" ]; then
    destination="$ANDROID_HOME/cmdline-tools/$NOVA_ANDROID_CLI_VERSION"
    if [ -e "$destination" ]; then
        nova_fail "Incomplete command-line tools at $destination. Preserve/repair that installation yourself, then retry."
        exit 1
    fi
    printf '\nReview the Android SDK License Agreement before downloading/using Google tools:\n'
    printf '%s\n' "https://developer.android.com/studio/terms"
    printf '%s\n' "Type ACCEPT to acknowledge that agreement for the command-line tools bootstrap, or anything else to stop."
    if ! read -r acceptance || [ "$acceptance" != ACCEPT ]; then
        nova_fail "Android bootstrap license not accepted. Native tools remain installed; no SDK archive downloaded."
        exit 1
    fi
    case "$(uname -s)" in
        Darwin) archive_os=mac; archive_sha1=c3e06a1959762e89167d1cbaa988605f6f7c1d24 ;;
        Linux) archive_os=linux; archive_sha1=5fdcc763663eefb86a5b8879697aa6088b041e70 ;;
        *) nova_fail "Unsupported SDK bootstrap host"; exit 1 ;;
    esac
    mkdir -p "$ANDROID_HOME/cmdline-tools"
    STAGING=$(mktemp -d "$ANDROID_HOME/.nova-bootstrap.XXXXXX")
    archive="$STAGING/tools.zip"
    curl --fail --location --retry 2 --proto '=https' --tlsv1.2 \
        "https://dl.google.com/android/repository/commandlinetools-${archive_os}-${NOVA_ANDROID_CLI_BUILD}_latest.zip" \
        --output "$archive"
    # Google's repository2-1.xml publishes SHA-1 for this exact legacy CLI archive.
    printf '%s  %s\n' "$archive_sha1" "$archive" | shasum -a 1 -c -
    unzip -q "$archive" -d "$STAGING/extracted"
    [ -x "$STAGING/extracted/cmdline-tools/bin/sdkmanager" ] ||
        { nova_fail "Downloaded archive lacks sdkmanager"; exit 1; }
    grep -Eq '^Pkg.Revision[[:space:]]*=[[:space:]]*19\.0[[:space:]]*$' \
        "$STAGING/extracted/cmdline-tools/source.properties" ||
        { nova_fail "Command-line tools version does not match the pin"; exit 1; }
    [ ! -e "$destination" ] || { nova_fail "SDK destination changed concurrently; nothing overwritten"; exit 1; }
    mv "$STAGING/extracted/cmdline-tools" "$destination"
fi
grep -Eq '^Pkg.Revision[[:space:]]*=[[:space:]]*19\.0[[:space:]]*$' \
    "$ANDROID_HOME/cmdline-tools/$NOVA_ANDROID_CLI_VERSION/source.properties" ||
    { nova_fail "Existing CLI directory does not contain version $NOVA_ANDROID_CLI_VERSION; nothing overwritten"; exit 1; }

missing=()
for package in "${PACKAGES[@]}"; do
    marker=$(nova_component_marker "$package")
    [ -f "$marker" ] || missing+=("$package")
done
if [ "${#missing[@]}" -gt 0 ]; then
    printf '\nInstalling missing SDK packages; read and answer sdkmanager license prompts yourself.\n'
    printf '%s\n' "No automatic license responses are supplied."
    "$SDKMANAGER" --sdk_root="$ANDROID_HOME" "${missing[@]}"
fi
"$NOVA_ROOT/scripts/android-doctor.sh"
printf '\nReady. Build APK: ./scripts/build-android.sh\n'
printf 'Native tools without changing your shell: ./scripts/with-toolchain.sh cmake --version\n'
