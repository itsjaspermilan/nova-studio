#!/bin/bash
# The Nova MCP server (see studio/mcp/server.ts). Bundles it to build/nova-mcp.mjs when needed, then serves on stdin/stdout.
#
#   NOVA_PROJECT=/path/to/game scripts/nova-mcp.sh
#
# The tools that run the game need `cargo build --release -p nova-runtime`; songs also need
# `cargo build --release -p nova-studio --bin nova-ogg`. Nothing is written outside the project folder.
#
# In a git worktree with no studio/node_modules or no release build of its own, it uses the main checkout's (read only; the
# binaries only when this worktree's engine sources are the ones they were built from): scripts/lib/worktree.sh, and
# docs/agent-guide.md, "Working in a worktree". NOVA_BIN and NOVA_OGG_BIN still choose the binaries.
set -euo pipefail
cd "$(dirname "$0")/.."
repo="$PWD"
# shellcheck source=lib/worktree.sh
. scripts/lib/worktree.sh
out=build/nova-mcp.mjs
if [ ! -f "$out" ] || [ -n "$(find studio/mcp studio/src/lib scripts/lib -newer "$out" \( -name '*.ts' -o -name '*.mjs' \) 2>/dev/null | head -1)" ]; then
  nova_clone_node_modules "$repo"
  modules="$(nova_node_modules "$repo")"
  if [ -z "$modules" ]; then
    echo "nova-mcp: studio/node_modules is missing (and no main checkout has one): run \`cd studio && ../scripts/env.sh npm ci\` (a download: ask first)" >&2
    exit 1
  fi
  mkdir -p build
  # the server imports only Node's own modules, so the bundler may come from another checkout
  NOVA_NO_CLONE=1 scripts/env.sh "$modules/.bin/rolldown" studio/mcp/server.ts --file "$out" --format esm --platform node >&2
fi
if [ -z "${NOVA_BIN:-}" ]; then
  bin="$(nova_pick_bin "$repo" nova "$NOVA_RUNTIME_INPUTS")"
  export NOVA_BIN="${bin:-$repo/target/release/nova}"
fi
if [ -z "${NOVA_OGG_BIN:-}" ]; then
  ogg="$(nova_pick_bin "$repo" nova-ogg "$NOVA_OGG_INPUTS")"
  export NOVA_OGG_BIN="${ogg:-$repo/target/release/nova-ogg}"
fi
exec scripts/env.sh node "$out"
