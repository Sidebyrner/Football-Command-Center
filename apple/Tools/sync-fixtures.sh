#!/usr/bin/env bash
# Copies the real nflverse-derived data files into the FCCore test bundle.
#
# The tests assert against these files rather than mocks, because mocks would
# have passed while the dialect mismatches in docs/IOS_PORT_BRIEF.md §3.2 sailed
# through. Re-run this whenever `npm run preprocess-nflverse` regenerates them.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
src="$root/public/data"
dst="$root/apple/Packages/FCCore/Tests/FCCoreTests/Fixtures"

mkdir -p "$dst"
cp "$src/weekly/2025.json"      "$dst/weekly-2025.json"
cp "$src/weekly/index.json"     "$dst/weekly-index.json"
cp "$src/schedule-2025.json"    "$dst/schedule-2025.json"
cp "$src/schedule-2026.json"    "$dst/schedule-2026.json"

echo "Synced fixtures into $dst"
ls -la "$dst"
