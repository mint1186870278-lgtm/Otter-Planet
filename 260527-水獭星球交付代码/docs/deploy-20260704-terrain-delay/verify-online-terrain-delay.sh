#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-https://play.otterlantis.com}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "$BASE/" -o "$TMP_DIR/index.html"

echo "== index assets =="
grep -Eo '/assets/(index|SectionParkour)[^"]+' "$TMP_DIR/index.html" || true

if ! grep -q 'assets/index-DzNmtrFH.js?v=202607041255' "$TMP_DIR/index.html"; then
  echo "ERROR: index.html is not the 202607041255 build" >&2
  exit 1
fi

echo
echo "== required files =="
curl -fsSI "$BASE/assets/index-DzNmtrFH.js?v=202607041255" | sed -n '1,8p'
curl -fsSI "$BASE/assets/SectionParkour--w0vNVV1.js?v=202607041255" | sed -n '1,8p'

echo
echo "== dashboard hash =="
curl -fsSL "$BASE/dashboard.html" -o "$TMP_DIR/dashboard.html"
shasum -a 256 "$TMP_DIR/dashboard.html"

echo
echo "OK: online build points at the terrain-delay release."

