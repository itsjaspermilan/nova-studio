#!/bin/bash
# Builds Nova for 64-bit ARM Linux (Retroid Pocket 6 and similar handhelds running Armada or Zaviya OS) from this Mac,
# with Zig as the C compiler and linker. Nothing is installed on the handheld besides the game folder.
#
#   scripts/build-linux-arm64.sh                       -> build/linux-arm64/nova (the engine, fast profile; --release for the optimised one)
#   scripts/build-linux-arm64.sh --project folder      -> build/linux-arm64/export/<id>/  (the engine, game.npk, play.sh): copy it to the device
#   scripts/build-linux-arm64.sh --release ...         link-time optimised build; use it for any measurement on the device
#
# Linux needs libasound (sound) and libudev (gamepads) at link time. They are not available on a Mac, so tiny stand-in
# libraries with the same names are made from the symbol lists in scripts/linux-arm64/*.syms; the binary only records the
# names (libasound.so.2, libudev.so.1) and uses the handheld's real ones at run time. If a dependency update needs more
# functions, the link says "undefined symbol: snd_..." or "udev_...": add them to the .syms file.
# Needs: Zig 0.15 (asdf), rustup target aarch64-unknown-linux-gnu (the Homebrew rustup; `scripts/env.sh rustup target add ...`).
set -euo pipefail
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
TARGET=aarch64-unknown-linux-gnu
PROFILE=fast
PROJECT=
while [ "$#" -gt 0 ]; do
    case "$1" in
        --release) PROFILE=release ;;
        --project) PROJECT="${2:?--project needs a folder}"; shift ;;
        *) echo "build-linux-arm64: unknown argument '$1'" >&2; exit 2 ;;
    esac
    shift
done

W="$ROOT/build/linux-arm64"
SYS="$W/sysroot"
mkdir -p "$SYS/lib" "$SYS/pc"
export ASDF_ZIG_VERSION="${ASDF_ZIG_VERSION:-0.15.2}"
command -v zig >/dev/null || { echo "build-linux-arm64: zig not found (asdf install zig 0.15.2)" >&2; exit 1; }

# Stand-in libraries: one empty function per listed symbol, with the real library's file name.
stub() { # name soname version-of-pc
    local name=$1 soname=$2 syms="$ROOT/scripts/linux-arm64/$3.syms" c="$SYS/$1.c"
    { echo "void nova_stub_$name(void){}"; while read -r s; do echo "void $s(void){}"; done < "$syms"; } > "$c"
    zig cc -target aarch64-linux-gnu.2.28 -shared -Wl,-soname,"$soname" -o "$SYS/lib/lib$name.so" "$c"
    printf 'Name: %s\nDescription: stand-in for linking\nVersion: 99\nLibs: -L%s -l%s\n' "$name" "$SYS/lib" "$name" > "$SYS/pc/$4"
}
stub asound libasound.so.2 asound alsa.pc
stub udev libudev.so.1 udev libudev.pc

export PKG_CONFIG_ALLOW_CROSS=1 PKG_CONFIG_PATH="$SYS/pc" PKG_CONFIG_LIBDIR="$SYS/pc"
export CC_aarch64_unknown_linux_gnu="$ROOT/scripts/linux-arm64/zig-cc"
export AR_aarch64_unknown_linux_gnu="$ROOT/scripts/linux-arm64/zig-ar"
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER="$ROOT/scripts/linux-arm64/zig-cc"
scripts/env.sh cargo build --profile "$PROFILE" -p nova-runtime --bin nova --target "$TARGET"
BIN="target/$TARGET/$PROFILE/nova"
cp "$BIN" "$W/nova"
echo "built $W/nova ($(du -h "$W/nova" | cut -f1))"

if [ -n "$PROJECT" ]; then
    # `nova export desktop` copies the running program; the packer is the host build, the program copied is the ARM one.
    scripts/env.sh cargo run -q --profile fast -p nova-runtime --bin nova -- export desktop "$PROJECT" --out "$W/export" --exe "$W/nova"
fi
