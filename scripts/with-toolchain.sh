#!/bin/sh
set -eu
NOVA_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
. "$NOVA_ROOT/scripts/toolchain-common.sh"
[ "$#" -gt 0 ] || { nova_fail "Usage: scripts/with-toolchain.sh COMMAND [ARGUMENTS...]"; exit 2; }
nova_environment
exec "$@"
