#!/usr/bin/env bash
set -euo pipefail

REPO="neiltron/bingbong"
VERSION="${BINGBONG_VERSION:-latest}"
EXPLICIT_INSTALL_DIR="${BINGBONG_INSTALL_DIR:-}"
WORKDIR=""

log() {
  printf '[bingbong-install] %s\n' "$1"
}

warn() {
  printf '[bingbong-install] WARNING: %s\n' "$1" >&2
}

die() {
  printf '[bingbong-install] ERROR: %s\n' "$1" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

cleanup() {
  if [[ -n "${WORKDIR:-}" && -d "${WORKDIR}" ]]; then
    rm -rf "${WORKDIR}"
  fi
}

normalize_version_tag() {
  if [[ "$VERSION" == "latest" ]]; then
    echo "latest"
  else
    echo "v${VERSION#v}"
  fi
}

resolve_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *)
      echo "unsupported"
      return
      ;;
  esac

  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *)
      echo "unsupported"
      return
      ;;
  esac

  echo "${os}-${arch}"
}

choose_install_dir() {
  if [[ -n "$EXPLICIT_INSTALL_DIR" ]]; then
    mkdir -p "$EXPLICIT_INSTALL_DIR" 2>/dev/null || die "Cannot create install dir: $EXPLICIT_INSTALL_DIR"
    [[ -w "$EXPLICIT_INSTALL_DIR" ]] || die "Install dir is not writable: $EXPLICIT_INSTALL_DIR"
    echo "$EXPLICIT_INSTALL_DIR"
    return
  fi

  local candidates=("$HOME/.local/bin" "/usr/local/bin")
  local dir
  for dir in "${candidates[@]}"; do
    mkdir -p "$dir" 2>/dev/null || true
    if [[ -d "$dir" && -w "$dir" ]]; then
      echo "$dir"
      return
    fi
  done

  die "No writable install directory found. Tried ~/.local/bin and /usr/local/bin.\nSet BINGBONG_INSTALL_DIR to a writable path and re-run."
}

sha256_validate() {
  local file="$1"
  local expected="$2"

  local actual
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  else
    die "Need sha256sum or shasum to verify downloads"
  fi

  [[ "$actual" == "$expected" ]] || die "Checksum mismatch for $(basename "$file")"
}

download_prebuilt() {
  local target="$1"
  local workdir="$2"
  local tag
  tag="$(normalize_version_tag)"

  local asset="bingbong-${target}.tar.gz"
  local checksums_url asset_url

  if [[ "$tag" == "latest" ]]; then
    checksums_url="https://github.com/${REPO}/releases/latest/download/checksums.txt"
    asset_url="https://github.com/${REPO}/releases/latest/download/${asset}"
  else
    checksums_url="https://github.com/${REPO}/releases/download/${tag}/checksums.txt"
    asset_url="https://github.com/${REPO}/releases/download/${tag}/${asset}"
  fi

  log "Downloading checksums..."
  curl -fsSL "$checksums_url" -o "$workdir/checksums.txt" || return 1

  local expected
  expected="$(grep " ${asset}$" "$workdir/checksums.txt" | awk '{print $1}')"
  [[ -n "$expected" ]] || die "No checksum entry found for ${asset}"

  log "Downloading prebuilt binary archive for ${target}..."
  curl -fsSL "$asset_url" -o "$workdir/${asset}" || return 1

  log "Verifying checksum..."
  sha256_validate "$workdir/${asset}" "$expected"

  tar -xzf "$workdir/${asset}" -C "$workdir"
}

install_bundle() {
  local install_dir="$1"
  local workdir="$2"

  [[ -f "$workdir/bingbong" ]] || die "Archive missing bingbong binary"

  local temp_bin="$install_dir/.bingbong.tmp.$$"
  cp "$workdir/bingbong" "$temp_bin"
  chmod +x "$temp_bin"
  mv -f "$temp_bin" "$install_dir/bingbong"
}

build_from_source() {
  local install_dir="$1"
  local workdir="$2"

  need_cmd git
  need_cmd bun

  local tag
  tag="$(normalize_version_tag)"

  log "Falling back to source build..."
  git clone --depth 1 "https://github.com/${REPO}.git" "$workdir/src"

  if [[ "$tag" != "latest" ]]; then
    (cd "$workdir/src" && git fetch --depth 1 origin "$tag" && git checkout "$tag")
  fi

  (
    cd "$workdir/src"
    bun install --frozen-lockfile || bun install
    bun build ./bin/cli.ts --compile --outfile "$workdir/bingbong"
  )

  local temp_bin="$install_dir/.bingbong.tmp.$$"
  cp "$workdir/bingbong" "$temp_bin"
  chmod +x "$temp_bin"
  mv -f "$temp_bin" "$install_dir/bingbong"

}

print_path_hint() {
  local install_dir="$1"
  case ":$PATH:" in
    *":$install_dir:"*) ;;
    *)
      printf '\nAdd this to your shell config:\n  export PATH="%s:$PATH"\n\n' "$install_dir"
      ;;
  esac
}

main() {
  need_cmd curl
  need_cmd tar

  local install_dir
  install_dir="$(choose_install_dir)"
  log "Install directory: ${install_dir}"

  local target
  target="$(resolve_target)"

  WORKDIR="$(mktemp -d)"
  trap cleanup EXIT

  if [[ "$target" == "unsupported" ]]; then
    warn "No prebuilt target for this platform."
    build_from_source "$install_dir" "$WORKDIR"
  elif ! download_prebuilt "$target" "$WORKDIR"; then
    warn "Prebuilt binary unavailable for target ${target} (${VERSION})."
    build_from_source "$install_dir" "$WORKDIR"
  else
    install_bundle "$install_dir" "$WORKDIR"
  fi

  log "Installed bingbong to ${install_dir}/bingbong"
  print_path_hint "$install_dir"

  echo
  "$install_dir/bingbong" --help >/dev/null || die "Installed binary failed smoke test"
  log "Smoke test passed: bingbong --help"
}

main "$@"
