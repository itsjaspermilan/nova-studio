#!/bin/bash
# Builds the Nova Studio macOS app with the `nova` game runtime and the example projects inside it.
#
#   scripts/build-studio-app.sh            build target/release/bundle/macos/Nova Studio.app
#   scripts/build-studio-app.sh --install  ...and copy it to /Applications (replacing an older copy)
#
# The app is signed ad hoc (no Apple developer identity): it runs on the Mac that built it, and on another Mac
# macOS will ask for approval the first time. Notarisation and a developer signature are the project owner's to set up.
set -euo pipefail
cd "$(dirname "$0")/.."

triple="$(scripts/env.sh rustc -vV | sed -n 's/^host: //p')"
mkdir -p studio/src-tauri/binaries
scripts/env.sh cargo build --release -p nova-runtime --bin nova
cp target/release/nova "studio/src-tauri/binaries/nova-$triple"

[ -d studio/node_modules ] || scripts/env.sh bash -c 'cd studio && npm ci --silent'
scripts/env.sh bash -c 'cd studio && npx tauri build --config src-tauri/tauri.bundle.conf.json --bundles app'

app="target/release/bundle/macos/Nova Studio.app"
[ -d "$app" ] || { echo "build-studio-app: $app was not produced" >&2; exit 1; }
# Seal the whole bundle (the runtime inside it too) with an ad-hoc signature so macOS sees one consistent app.
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
echo "built: $app"

if [ "${1:-}" = "--install" ]; then
    dest="/Applications/Nova Studio.app"
    [ -e "$dest" ] && rm -rf "$dest"
    cp -R "$app" "$dest"
    echo "installed: $dest"
fi
