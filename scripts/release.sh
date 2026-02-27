#!/usr/bin/env bash
set -euo pipefail

# Release helper for Bingbong binary distribution.
#
# Usage:
#   scripts/release.sh patch
#   scripts/release.sh minor
#   scripts/release.sh major
#   scripts/release.sh 0.2.0
#
# Options:
#   --skip-local-test   Skip scripts/test-local-release.sh preflight
#
# Notes:
# - Must be run from a clean git tree on main.
# - Pushes commit + tag to origin.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

BUMP="${1:-patch}"
SKIP_LOCAL_TEST=0

if [[ "${2:-}" == "--skip-local-test" || "${1:-}" == "--skip-local-test" ]]; then
  SKIP_LOCAL_TEST=1
  if [[ "${1:-}" == "--skip-local-test" ]]; then
    BUMP="patch"
  fi
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[release] missing required command: $1" >&2
    exit 1
  }
}

need_cmd git
need_cmd npm
need_cmd node

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "main" ]]; then
  echo "[release] please run this from main (current: $current_branch)" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "[release] git working tree must be clean" >&2
  git status --short >&2
  exit 1
fi

echo "[release] syncing main..."
git pull origin main

if [[ "$SKIP_LOCAL_TEST" -eq 0 ]]; then
  echo "[release] running local preflight: scripts/test-local-release.sh"
  scripts/test-local-release.sh
else
  echo "[release] skipping local preflight"
fi

if [[ "$BUMP" =~ ^(patch|minor|major)$ ]]; then
  echo "[release] bumping version: $BUMP"
  npm version "$BUMP"
elif [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "[release] setting version: $BUMP"
  npm version "$BUMP"
else
  echo "[release] invalid version argument: $BUMP" >&2
  echo "[release] use patch|minor|major or x.y.z" >&2
  exit 1
fi

new_version="$(node -p "require('./package.json').version")"
tag="v${new_version}"

echo "[release] pushing main + tag $tag"
git push origin main
git push origin "$tag"

echo "[release] done"
echo "[release] watch workflow: gh run list --workflow release-binaries.yml --limit 5"
echo "[release] check release:   gh release view $tag"
