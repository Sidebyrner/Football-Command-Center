#!/usr/bin/env bash
#
# move-to-own-repo.sh — lift this directory out into its own repository.
#
# The portfolio was built inside Football-Command-Center because the session
# that created it could not create a repository (the GitHub App lacked the
# permission). Nothing about it depends on living there.
#
# Usage:
#   1. Create an EMPTY repo on GitHub — no README, no .gitignore, no license:
#        https://github.com/new  ->  name it: project-command-center
#   2. From the root of Football-Command-Center, run:
#        bash project-command-center/scripts/move-to-own-repo.sh Sidebyrner/project-command-center
#
set -euo pipefail

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "usage: $0 <owner/repo>   e.g. $0 Sidebyrner/project-command-center" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$(mktemp -d)"

echo "==> copying ledger from $HERE"
cp -R "$HERE/." "$STAGE/"
rm -rf "$STAGE/.git"
rm -f "$STAGE/scripts/move-to-own-repo.sh"   # only meaningful while nested

echo "==> initializing $STAGE"
cd "$STAGE"
git init -q -b main
git add -A
git commit -q -m "Initial commit: project portfolio ledger, CLI, skill and session hook"

echo "==> pushing to $TARGET"
git remote add origin "https://github.com/${TARGET}.git"
git push -u origin main

cat <<EOF

Done. The portfolio now lives at https://github.com/${TARGET}

Next:
  git clone https://github.com/${TARGET}.git
  cd \$(basename "${TARGET}")
  node scripts/install.mjs          # link the skill into ~/.claude/skills
  node scripts/portfolio.mjs board

Then remove the nested copy from Football-Command-Center:
  git rm -r --cached project-command-center && rm -rf project-command-center
  git commit -m "Move portfolio ledger to its own repository"

Working copy staged at: $STAGE
EOF
