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
app="$root/apple/Packages/FCApp/Tests/FCAppTests/Fixtures"
bundleRes="$root/apple/App/Resources"

mkdir -p "$core" "$data" "$app" "$bundleRes"

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

# FCApp: the view models are exercised against a real league context, which
# needs the same static files the store serves.
cp "$src/player-ids.json"       "$app/player-ids.json"
cp "$src/weekly/2025.json"      "$app/weekly-2025.json"
cp "$src/schedule-2025.json"    "$app/schedule-2025.json"
# 2026 schedule with no 2026 weekly file: the real shape of the app early in a
# season, which is what the stats-season tests exercise.
cp "$src/schedule-2026.json"    "$app/schedule-2026.json"
cp "$src/weekly/index.json"     "$app/weekly-index.json"

# The app bundle's own copies, so a first launch works offline before the app
# has ever refreshed (§9). Names match what StaticResource looks for.
cp "$src/weekly/2025.json"      "$bundleRes/weekly-2025.json"
cp "$src/weekly/index.json"     "$bundleRes/weekly-index.json"
cp "$src/schedule-2025.json"    "$bundleRes/schedule-2025.json"
cp "$src/schedule-2026.json"    "$bundleRes/schedule-2026.json"
cp "$src/player-ids.json"       "$bundleRes/player-ids.json"
cp "$src/adp.json"              "$bundleRes/adp.json"
cp "$src/cohorts.json"          "$bundleRes/cohorts.json"

echo "Synced fixtures into:"
echo "  $core"
echo "  $data"
echo "  $app"
echo "  $bundleRes  (app bundle)"
