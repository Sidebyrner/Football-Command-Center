#!/bin/sh
# Runs the native and web test suites back to back, so a change on either side
# is checked against the same fixtures.
#
#   scripts/check-parity.sh          # web suites, plus the Swift packages when swift is installed
#   scripts/check-parity.sh --web    # web suites only
#
# Swift builds go to a scratch directory outside the repo, so nothing is written
# under apple/ — the web work leaves the native app untouched.
set -e
cd "$(dirname "$0")/.."

echo "== Web: node:test + Vitest (parity specs read apple/**/Fixtures in place)"
npm test --silent

if [ "$1" = "--web" ]; then exit 0; fi
if ! command -v swift >/dev/null 2>&1; then
  echo "== Swift: not installed here; skipped"
  exit 0
fi

scratch="${TMPDIR:-/tmp}/fcc-parity-swift"
for pkg in FCCore FCData FCApp; do
  echo "== Swift: $pkg"
  swift test --package-path "apple/Packages/$pkg" --scratch-path "$scratch/$pkg" --quiet
done
echo "== Both platforms pass."
