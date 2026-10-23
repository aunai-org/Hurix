#!/bin/sh
# Renders the PNG app icons from public/favicon.svg and public/icons/maskable.svg with headless Chromium.
# Usage: sh scripts/icons.sh   (CHROME=/path/to/chrome to pick the browser)
set -eu
cd "$(dirname "$0")/.."
CHROME=${CHROME:-$(command -v chromium || command -v google-chrome || echo /opt/pw-browsers/chromium/chrome-linux64/chrome)}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
render() { # svg size out [bleed]
  printf '<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:%spx;height:%spx}</style><img src="file://%s">' "$2" "$2" "$PWD/$1" > "$tmp/page.html"
  "$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --window-size="$2,$2" --screenshot="$PWD/$3" "file://$tmp/page.html" 2>/dev/null
}
render public/favicon.svg 32 public/icons/favicon-32.png
render public/favicon.svg 192 public/icons/icon-192.png
render public/favicon.svg 512 public/icons/icon-512.png
render public/icons/maskable.svg 512 public/icons/maskable-512.png
# iOS rounds the corners itself, so the touch icon is the full-bleed square.
render public/icons/maskable.svg 180 public/icons/apple-touch-icon.png
echo "icons: $(ls public/icons)"
