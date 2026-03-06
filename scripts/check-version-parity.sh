#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

TAG_INPUT="${1:-${GITHUB_REF_NAME:-}}"

normalize_tag() {
  local t="$1"
  t="${t#refs/tags/}"
  t="${t#v}"
  echo "$t"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[version-parity] missing required command: $1" >&2
    exit 1
  }
}

need_cmd node

pkg_version="$(node -p "require('./package.json').version")"
lock_version="$(node -e "const l=require('./package-lock.json'); process.stdout.write((l.version||l.packages?.['']?.version||''));")"

if [[ -z "$pkg_version" || -z "$lock_version" ]]; then
  echo "[version-parity] FAIL: unable to read package versions" >&2
  exit 1
fi

if [[ "$pkg_version" != "$lock_version" ]]; then
  echo "[version-parity] FAIL: package.json ($pkg_version) != package-lock.json ($lock_version)" >&2
  exit 1
fi

echo "[version-parity] package.json == package-lock.json == $pkg_version"

if [[ -n "$TAG_INPUT" ]]; then
  tag_version="$(normalize_tag "$TAG_INPUT")"
  if [[ ! "$tag_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "[version-parity] FAIL: tag/input '$TAG_INPUT' is not semver-like (expected vX.Y.Z or X.Y.Z)" >&2
    exit 1
  fi

  if [[ "$tag_version" != "$pkg_version" ]]; then
    echo "[version-parity] FAIL: tag version ($tag_version) != package version ($pkg_version)" >&2
    exit 1
  fi

  echo "[version-parity] tag matches package version: $tag_version"
else
  echo "[version-parity] no tag provided; skipped tag parity check"
fi

echo "[version-parity] PASS"
