#!/bin/sh
# noldor binary installer (spec Unit 7).
#   curl -fsSL https://raw.githubusercontent.com/davidzoufaly/noldor/main/install.sh | sh
#   curl -fsSL … | NOLDOR_VERSION=v1.5.0 sh        # pin (env on the sh side of the pipe)
# Env: NOLDOR_VERSION (default latest), NOLDOR_INSTALL_DIR (default ~/.local/bin).
set -eu

REPO="davidzoufaly/noldor"
UNAME_S="${NOLDOR_UNAME_S:-$(uname -s)}"
UNAME_M="${NOLDOR_UNAME_M:-$(uname -m)}"

case "$UNAME_S" in
  Linux) OS=linux ;;
  Darwin) OS=darwin ;;
  *) echo "install: unsupported OS: $UNAME_S" >&2; exit 1 ;;
esac
case "$UNAME_M" in
  x86_64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "install: unsupported architecture: $UNAME_M" >&2; exit 1 ;;
esac
ASSET="noldor-$OS-$ARCH"

if [ "${1:-}" = "--map-only" ]; then echo "$ASSET"; exit 0; fi

# Checksum tool: sha256sum or shasum -a 256.
if command -v sha256sum >/dev/null 2>&1; then SHACMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then SHACMD="shasum -a 256"
else echo "install: need sha256sum or shasum" >&2; exit 1; fi

VERSION="${NOLDOR_VERSION:-latest}"
case "$VERSION" in
  latest) BASE="https://github.com/$REPO/releases/latest/download" ;;
  v*) BASE="https://github.com/$REPO/releases/download/$VERSION" ;;
  *) BASE="https://github.com/$REPO/releases/download/v$VERSION" ;;
esac
# Test seam: point the download base at a local server (integration tests).
BASE="${NOLDOR_BASE_URL:-$BASE}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

echo "install: downloading $ASSET ($VERSION)"
curl -fsSL -o "$WORK/$ASSET" "$BASE/$ASSET" || {
  echo "install: download failed — release may be incomplete; retry later or pin NOLDOR_VERSION" >&2; exit 1; }
curl -fsSL -o "$WORK/SHA256SUMS" "$BASE/SHA256SUMS" || {
  echo "install: SHA256SUMS missing — release incomplete (binaries publish after npm); retry later or pin NOLDOR_VERSION" >&2; exit 1; }

# Exactly one checksum line for this asset.
LINES="$(grep -c " $ASSET\$" "$WORK/SHA256SUMS" || true)"
[ "$LINES" = "1" ] || { echo "install: expected exactly 1 checksum line for $ASSET, found $LINES" >&2; exit 1; }
EXPECTED="$(grep " $ASSET\$" "$WORK/SHA256SUMS" | cut -d' ' -f1)"
ACTUAL="$(cd "$WORK" && $SHACMD "$ASSET" | cut -d' ' -f1)"
[ "$EXPECTED" = "$ACTUAL" ] || { echo "install: checksum mismatch for $ASSET" >&2; exit 1; }

DEST_DIR="${NOLDOR_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$DEST_DIR"
# Stage in the destination dir -> same-filesystem atomic rename; the existing
# installation survives every pre-publish failure.
STAGE="$DEST_DIR/.noldor.tmp.$$"
cp "$WORK/$ASSET" "$STAGE"
chmod 0755 "$STAGE"
mv -f "$STAGE" "$DEST_DIR/noldor"
echo "install: installed $DEST_DIR/noldor"
case ":$PATH:" in
  *":$DEST_DIR:"*) ;;
  *) echo "install: NOTE — $DEST_DIR is not on PATH" ;;
esac
