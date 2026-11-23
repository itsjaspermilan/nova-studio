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
# Node for the studio's front end (asdf has several installed; pin one for this command only).
export ASDF_NODEJS_VERSION="${ASDF_NODEJS_VERSION:-22.17.0}"
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

# In a git worktree with no studio/node_modules, a Node tool that needs them (vitest, svelte-check, vite, npx, anything run from
# a node_modules folder) gets a copy-on-write clone of the main checkout's, made once, said in one line: scripts/lib/worktree.sh.
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -d "$repo/studio/node_modules" ] && [ -z "${NOVA_NO_CLONE:-}" ]; then
  case "$1 ${2:-}" in
    *node_modules*|npx*|*vitest*|*svelte-check*|*vite*|*rolldown*|*tsc*)
      # shellcheck source=lib/worktree.sh
      . "$repo/scripts/lib/worktree.sh"
      nova_clone_node_modules "$repo"
      ;;
  esac
fi
# In a git worktree with no target/<profile> yet, the first cargo build would compile every dependency again (a minute and
# more): it gets a copy-on-write clone of the main checkout's built dependencies first, said in one line (scripts/lib/worktree.sh).
if [ "$(basename "$1")" = cargo ] && [ -z "${CARGO_TARGET_DIR:-}" ] && [ -z "${NOVA_NO_SEED:-}" ]; then
  profile=debug
  prev=""
  for a in "$@"; do
    case "$a" in
      --release|-r) profile=release ;;
      --profile=*) profile="${a#--profile=}" ;;
    esac
    [ "$prev" = --profile ] && profile="$a"
    prev="$a"
  done
  case "$profile" in dev|test) profile=debug ;; bench) profile=release ;; esac
  if [ ! -e "$repo/target/$profile" ]; then
    # shellcheck source=lib/worktree.sh
    . "$repo/scripts/lib/worktree.sh"
    nova_seed_target "$repo" "$profile"
  fi
fi
exec "$@"
