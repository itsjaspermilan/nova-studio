#!/bin/bash
# Command-local build environment for Nova. Never edits shell startup files.
#
#   scripts/env.sh cargo build            run one command with the environment
#   eval "$(scripts/env.sh --print)"      export it into the current shell
#
# Rust comes from Homebrew's rustup (keg-only, so it is put first on PATH here;
# plain `cargo` elsewhere is still Homebrew's Rust, which GameStudio uses).
# Java is only for the Android SDK tools (sdkmanager, apksigner).
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
NDK_VERSION="29.0.14206865"
JAVA_PIN="temurin-17.0.21+9"

fail() { printf 'env.sh: %s\n' "$1" >&2; exit 1; }

[ -d /opt/homebrew/opt/rustup/bin ] || fail "Homebrew rustup is missing: brew install rustup"
[ -d "$ANDROID_HOME" ] || fail "Android SDK not found at $ANDROID_HOME"
[ -d "$ANDROID_HOME/ndk/$NDK_VERSION" ] || fail "NDK $NDK_VERSION missing under $ANDROID_HOME/ndk"
JAVA_HOME="$(ASDF_JAVA_VERSION=$JAVA_PIN asdf where java 2>/dev/null)" || fail "asdf Java $JAVA_PIN missing"

export ANDROID_HOME
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$NDK_VERSION"
export JAVA_HOME
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/build-tools/36.1.0:$PATH"

if [ "${1:-}" = "--print" ]; then
    for name in ANDROID_HOME ANDROID_NDK_HOME JAVA_HOME PATH; do
        printf 'export %s=%q\n' "$name" "${!name}"
    done
    exit 0
fi
[ "$#" -gt 0 ] || fail "usage: scripts/env.sh <command...> | --print"
exec "$@"
