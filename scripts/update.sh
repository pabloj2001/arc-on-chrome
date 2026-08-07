#!/usr/bin/env bash
# Update the extension to the latest release: pull the default branch, install
# dependencies, and rebuild dist/. After it finishes, reload the extension in
# edge://extensions (or chrome://extensions).
set -euo pipefail

# Run from the repo root regardless of where the script is invoked from.
cd "$(dirname "$0")/.."

# The repo's default branch (main here), resolved from origin, with a fallback.
DEFAULT_BRANCH="$(git remote show origin 2>/dev/null \
  | sed -n 's/.*HEAD branch: //p')"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"

echo "==> Updating to latest origin/${DEFAULT_BRANCH}"

# 1. Pull latest.
git fetch origin --prune
git checkout "$DEFAULT_BRANCH"
git pull --ff-only origin "$DEFAULT_BRANCH"

# 2. Install dependencies (clean, reproducible install when a lockfile exists).
echo "==> Installing dependencies"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# 3. Build dist/.
echo "==> Building dist/"
npm run build

echo ""
echo "✅ Updated. Now reload the extension:"
echo "   1. Open edge://extensions (or chrome://extensions)"
echo "   2. Click the reload ↻ icon on \"Arc Search Bar\""
echo "   (First install: Load unpacked -> select the dist/ folder.)"
