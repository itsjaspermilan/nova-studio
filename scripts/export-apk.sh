#!/bin/sh
set -eu
NOVA_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
exec "$NOVA_ROOT/scripts/with-toolchain.sh" /usr/bin/python3 "$NOVA_ROOT/scripts/export-apk.py" "$@"
