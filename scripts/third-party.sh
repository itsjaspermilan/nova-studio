#!/bin/bash
# Writes licences/rust-dependencies.txt from the crates the runtime is built from; with --check, fails on a licence outside the allow-list.
set -euo pipefail
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
"$ROOT/scripts/env.sh" cargo metadata --format-version 1 --locked | ASDF_PYTHON_VERSION=3.11.0 python3 -I "$ROOT/scripts/third_party.py" "$@"
