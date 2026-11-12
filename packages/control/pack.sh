#!/usr/bin/env bash
# Build a self-contained zip for Flex Consumption zip deploy. Prints the zip path.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$(mktemp -d)"
cp -r "$HERE/dist" "$HERE/host.json" "$OUT/"
# package.json without the workspace dependency; shared is copied in as a real folder
jq 'del(.devDependencies) | .dependencies["@cloudpilot/shared"]="file:./shared"' "$HERE/package.json" > "$OUT/package.json"
mkdir -p "$OUT/shared" && cp -r "$HERE/../shared/dist" "$HERE/../shared/package.json" "$OUT/shared/"
(cd "$OUT/shared" && npm install --omit=dev --no-audit --no-fund >/dev/null)
(cd "$OUT" && npm install --omit=dev --install-links --no-audit --no-fund >/dev/null && zip -qr ../control.zip .)
echo "$(dirname "$OUT")/control.zip"
