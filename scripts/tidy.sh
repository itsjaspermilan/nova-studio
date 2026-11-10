#!/bin/bash
# Shows what takes room in the Nova tree and (with --apply) clears what is only a cache. Nothing here is source or an asset: every
# folder it removes is rebuilt by the next build or test.
#
#   scripts/tidy.sh            list the sizes and what --apply would remove
#   scripts/tidy.sh --apply    remove it
#   scripts/tidy.sh --apply --release   also remove target/release (the next `scripts/build-apk.sh` or studio build rebuilds it, a few minutes)
#
# Removed: target/debug (the test and development build), every target/*/incremental, debug APKs and per-game work folders in
# build/android that are more than 14 days old, and nova-export-out-* leftovers of finished exports in the system temp folder.
# Kept: target/release and target/aarch64-linux-android (what the studio app and the APK builds link against), build/dl, node_modules.
set -euo pipefail
cd "$(dirname "$0")/.."

apply=0; release=0
for a in "$@"; do
    case "$a" in
        --apply) apply=1 ;;
        --release) release=1 ;;
        *) echo "tidy: unknown argument '$a'" >&2; exit 2 ;;
    esac
done

size() { du -sh "$@" 2>/dev/null | awk '{print $1}' | tr '\n' ' '; }
show() { printf '  %-44s %s\n' "$1" "$(size "$1")"; }
remove() { # remove PATH...: print each, delete when --apply
    for p in "$@"; do
        [ -e "$p" ] || continue
        printf '  %s %-44s %s\n' "$([ $apply = 1 ] && echo removing || echo would remove)" "$p" "$(size "$p")"
        [ $apply = 1 ] && rm -rf "$p"
    done
    return 0
}

echo "Sizes:"
for p in target/debug target/release target/aarch64-linux-android build/android build/dl studio/node_modules .git; do show "$p"; done

echo
echo "Caches:"
remove target/debug
for d in target/*/incremental target/*/*/incremental; do remove "$d"; done
[ $release = 1 ] && remove target/release
if [ -d build/android ]; then
    while IFS= read -r f; do remove "$f"; done < <(find build/android -maxdepth 1 \( -name '*.apk' -o -type d -path 'build/android/work' \) -mtime +14 2>/dev/null)
    if [ -d build/android/work ]; then
        while IFS= read -r d; do remove "$d"; done < <(find build/android/work -mindepth 1 -maxdepth 1 -type d -mtime +14 2>/dev/null)
    fi
fi
tmp="${TMPDIR:-/tmp}"
while IFS= read -r d; do remove "$d"; done < <(find "$tmp" -maxdepth 1 -type d -name 'nova-export-out-*' -mmin +60 2>/dev/null)

echo
[ $apply = 1 ] && echo "Done." || echo "Nothing removed: run again with --apply."
