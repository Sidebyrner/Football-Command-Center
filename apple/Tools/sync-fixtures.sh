#!/usr/bin/env bash
# Copies the real nflverse-derived data files into the FCCore and FCData test
# bundles.
#
# The tests assert against these files rather than mocks, because mocks would
# have passed while the dialect mismatches in docs/IOS_PORT_BRIEF.md §3.2 sailed
# through. Re-run this whenever `npm run preprocess-nflverse` regenerates them.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
src="$root/public/data"
core="$root/apple/Packages/FCCore/Tests/FCCoreTests/Fixtures"
data="$root/apple/Packages/FCData/Tests/FCDataTests/Fixtures"

mkdir -p "$core" "$data"

# FCCore: the algorithms are tested against production rows and the schedule.
cp "$src/weekly/2025.json"      "$core/weekly-2025.json"
cp "$src/weekly/index.json"     "$core/weekly-index.json"
cp "$src/schedule-2025.json"    "$core/schedule-2025.json"
cp "$src/schedule-2026.json"    "$core/schedule-2026.json"

# FCData: the store decodes the same files, and the crosswalk's whole reason to
# exist is the dialect of player-ids.json — which only the real file shows.
cp "$src/player-ids.json"       "$data/player-ids.json"
cp "$src/weekly/2025.json"      "$data/weekly-2025.json"
cp "$src/schedule-2025.json"    "$data/schedule-2025.json"

echo "Synced fixtures into:"
echo "  $core"
echo "  $data"
