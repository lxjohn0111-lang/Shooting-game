#!/usr/bin/env bash
# Builds the CrazyGames upload package into crazygames/:
#   crazygames/game/                          the game files (index.html at the root)
#   crazygames/vanta-protocol-crazygames.zip  the zip to upload in the developer portal
# Covers and the preview video live next to them and are not touched by this script.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=crazygames
rm -rf "$OUT/game" "$OUT/vanta-protocol-crazygames.zip"
mkdir -p "$OUT/game"
cp index.html "$OUT/game/"
cp -r css js "$OUT/game/"
# nothing but the game itself: no server, docs, tests or editor files
find "$OUT/game" \( -name '.DS_Store' -o -name '*.map' -o -name '*.md' \) -delete
# sanity checks
grep -q 'crazygames-sdk-v3.js' "$OUT/game/index.html" || { echo "CrazyGames SDK script tag missing from index.html" >&2; exit 1; }
for f in js/main.js js/lib/three.min.js css/style.css; do [ -f "$OUT/game/$f" ] || { echo "missing $f" >&2; exit 1; }; done
(cd "$OUT/game" && zip -q -r -9 -X ../vanta-protocol-crazygames.zip .)
files=$(find "$OUT/game" -type f | wc -l)
size=$(du -sh "$OUT/game" | cut -f1)
zipsize=$(du -h "$OUT/vanta-protocol-crazygames.zip" | cut -f1)
echo "built $OUT/vanta-protocol-crazygames.zip ($zipsize, $files files, $size unpacked)"
