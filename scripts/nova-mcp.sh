#!/bin/bash
# The Nova MCP server (see studio/mcp/server.ts). Bundles it to build/nova-mcp.mjs when needed, then serves on stdin/stdout.
#
#   NOVA_PROJECT=/path/to/game scripts/nova-mcp.sh
#
# The tools that run the game need `cargo build --release -p nova-runtime`; songs also need
# `cargo build --release -p nova-studio --bin nova-ogg`. Nothing is written outside the project folder.
set -euo pipefail
cd "$(dirname "$0")/.."
out=build/nova-mcp.mjs
if [ ! -f "$out" ] || [ -n "$(find studio/mcp studio/src/lib -newer "$out" -name '*.ts' 2>/dev/null | head -1)" ]; then
  mkdir -p build
  scripts/env.sh studio/node_modules/.bin/rolldown studio/mcp/server.ts --file "$out" --format esm --platform node >&2
fi
exec scripts/env.sh node "$out"
