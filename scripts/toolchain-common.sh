#!/bin/sh

NOVA_JAVA_VERSION=$(awk '$1 == "java" {print $2}' "$NOVA_ROOT/.tool-versions")
NOVA_NATIVE_CMAKE_MINIMUM=3.22
NOVA_ANDROID_CLI_VERSION=19.0
NOVA_ANDROID_CLI_BUILD=13114758
NOVA_JAVA_PLUGIN=https://github.com/halcyon/asdf-java.git
NOVA_JAVA_PLUGIN_REVISION=34713d732277981ac48169412c89943e1c47e372

nova_fail() {
    printf 'Nova toolchain: %s\n' "$*" >&2
    return 1
}

nova_absolute_path() {
    case "$1" in /*) ;; *) nova_fail "SDK paths must be absolute: $1"; return 1 ;; esac
    if [ -d "$1" ]; then
        (CDPATH='' cd -- "$1" && pwd -P)
    else
        printf '%s\n' "$1" | sed 's:/*$::'
    fi
}

nova_sdk_root() {
    local_sdk=
    if [ -f "$NOVA_ROOT/android/local.properties" ]; then
        local_sdk=$(sed -n 's/^[[:space:]]*sdk\.dir[[:space:]]*=[[:space:]]*//p' "$NOVA_ROOT/android/local.properties")
        if [ -n "$local_sdk" ]; then
            case "$local_sdk" in *'
'*) nova_fail "Multiple sdk.dir entries in android/local.properties"; return 1 ;; esac
            local_sdk=$(printf '%s\n' "$local_sdk" | sed 's/\\ / /g; s/\\:/:/g; s/\\\\/\\/g')
            local_sdk=$(nova_absolute_path "$local_sdk") || return 1
        fi
    fi
    if [ -n "${ANDROID_HOME:-}" ] && [ -n "${ANDROID_SDK_ROOT:-}" ]; then
        home_sdk=$(nova_absolute_path "$ANDROID_HOME") || return 1
        root_sdk=$(nova_absolute_path "$ANDROID_SDK_ROOT") || return 1
        [ "$home_sdk" = "$root_sdk" ] || {
            nova_fail "ANDROID_HOME and ANDROID_SDK_ROOT disagree; select one SDK before continuing."
            return 1
        }
    fi
    selected_sdk=${NOVA_SDK_OVERRIDE:-${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$local_sdk}}}
    if [ -z "$selected_sdk" ]; then
        case "$(uname -s)" in
            Darwin) selected_sdk="$HOME/Library/Android/sdk" ;;
            Linux) selected_sdk="$HOME/Android/Sdk" ;;
            *) nova_fail "Setup supports macOS and Linux; use Android Studio on other hosts."; return 1 ;;
        esac
    fi
    selected_sdk=$(nova_absolute_path "$selected_sdk") || return 1
    if [ -n "$local_sdk" ] && [ "$local_sdk" != "$selected_sdk" ]; then
        nova_fail "Selected SDK ($selected_sdk) conflicts with android/local.properties ($local_sdk). No file was changed; align the paths yourself."
        return 1
    fi
    case "$selected_sdk" in
        ""|/|"$HOME"|"$NOVA_ROOT") nova_fail "Refusing a broad directory as the SDK root: $selected_sdk"; return 1 ;;
    esac
    printf '%s\n' "$selected_sdk"
}

nova_asdf_where() {
    (CDPATH='' cd -- "$NOVA_ROOT" && asdf where "$1" "$2")
}

nova_host_tool() {
    tool=$1
    if command -v brew >/dev/null 2>&1; then
        if tool_prefix=$(brew --prefix "$tool" 2>/dev/null) && [ -x "$tool_prefix/bin/$tool" ]; then
            printf '%s/bin/%s\n' "$tool_prefix" "$tool"
            return 0
        fi
    fi
    if command -v asdf >/dev/null 2>&1; then
        if system_tool=$(CDPATH='' cd -- "$NOVA_ROOT" && asdf which "$tool" 2>/dev/null); then
            case "$system_tool" in
                */CMake.app/*|*/.asdf/installs/cmake/*) nova_fail "Refusing an asdf/app-bundle CMake; use the Homebrew CLI."; return 1 ;;
            esac
            printf '%s\n' "$system_tool"
            return 0
        fi
    fi
    if system_tool=$(command -v "$tool"); then
        case "$system_tool" in
            */CMake.app/*|*/shims/*) nova_fail "No usable system $tool CLI; install it through your package manager."; return 1 ;;
        esac
        printf '%s\n' "$system_tool"
        return 0
    fi
    nova_fail "Host CLI tool is missing: $tool"
}

nova_check_host_cmake() {
    cmake_binary=$(nova_host_tool cmake) || return 1
    cmake_output=$("$cmake_binary" --version) || {
        nova_fail "CMake CLI failed to execute: $cmake_binary"
        return 1
    }
    cmake_version=$(printf '%s\n' "$cmake_output" | awk 'NR == 1 {print $3}')
    if ! awk -v v="$cmake_version" 'BEGIN {
        split(v, parts, ".")
        exit !(v ~ /^[0-9]+\.[0-9]+\.[0-9]+$/ && (parts[1] > 3 || (parts[1] == 3 && parts[2] >= 22)))
    }'; then
        nova_fail "CMake $NOVA_NATIVE_CMAKE_MINIMUM+ required; found $cmake_version at $cmake_binary"
        return 1
    fi
    printf 'OK: CMake CLI %s (%s)\n' "$cmake_version" "$cmake_binary"
}

nova_check_host_ninja() {
    ninja_binary=$(nova_host_tool ninja) || return 1
    ninja_version=$("$ninja_binary" --version) || {
        nova_fail "Ninja failed to execute: $ninja_binary"
        return 1
    }
    if ! awk -v v="$ninja_version" 'BEGIN {
        split(v, parts, ".")
        exit !(v ~ /^[0-9]+\.[0-9]+\.[0-9]+$/ && (parts[1] > 1 || (parts[1] == 1 && parts[2] >= 10)))
    }'; then
        nova_fail "Ninja 1.10+ required; found $ninja_version"
        return 1
    fi
    printf 'OK: Ninja %s (%s)\n' "$ninja_version" "$ninja_binary"
}

nova_environment() {
    ANDROID_HOME=$(nova_sdk_root) || return 1
    ANDROID_SDK_ROOT=$ANDROID_HOME
    export ANDROID_HOME ANDROID_SDK_ROOT
    if [ -z "${JAVA_HOME:-}" ] && command -v asdf >/dev/null 2>&1; then
        if managed_java=$(nova_asdf_where java "$NOVA_JAVA_VERSION" 2>/dev/null); then
            JAVA_HOME=$managed_java
        fi
    fi
    if [ -z "${JAVA_HOME:-}" ] && [ "$(uname -s)" = Darwin ]; then
        if system_java=$(/usr/libexec/java_home -v 17 2>/dev/null); then JAVA_HOME=$system_java; fi
    fi
    if [ -n "${JAVA_HOME:-}" ]; then
        export JAVA_HOME
        PATH="$JAVA_HOME/bin:$PATH"
    fi
    if cmake_binary=$(nova_host_tool cmake 2>/dev/null); then
        PATH="$(dirname "$cmake_binary"):$PATH"
    fi
    if ninja_binary=$(nova_host_tool ninja 2>/dev/null); then
        PATH="$(dirname "$ninja_binary"):$PATH"
    fi
    PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/$NOVA_ANDROID_CLI_VERSION/bin:$PATH"
    export PATH
}

nova_component_marker() {
    case "$1" in
        platform-tools) printf '%s/platform-tools/adb\n' "$ANDROID_HOME" ;;
        "platforms;android-35") printf '%s/platforms/android-35/android.jar\n' "$ANDROID_HOME" ;;
        "build-tools;35.0.0") printf '%s/build-tools/35.0.0/aapt2\n' "$ANDROID_HOME" ;;
        "ndk;27.2.12479018") printf '%s/ndk/27.2.12479018/build/cmake/android.toolchain.cmake\n' "$ANDROID_HOME" ;;
        "cmake;3.22.1") printf '%s/cmake/3.22.1/bin/cmake\n' "$ANDROID_HOME" ;;
        *) nova_fail "Unknown SDK component: $1"; return 1 ;;
    esac
}
