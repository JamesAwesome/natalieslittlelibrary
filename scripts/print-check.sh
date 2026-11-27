#!/usr/bin/env bash
# Prints the label-sheet preview to PDF and PNG so two trees can be compared.
# Usage: scripts/print-check.sh <out-dir> [source-dir]   (source-dir defaults to the repo root)
# Compare two runs page by page: magick compare -metric AE a/print-1.png b/print-1.png null:
# Needs headless Google Chrome on macOS, pdftoppm, and node_modules installed in source-dir.
# One print run covers light and dark: Chrome always prints with prefers-color-scheme: light.
set -euo pipefail

out=${1:?usage: print-check.sh <out-dir> [source-dir]}
src=${2:-$(cd "$(dirname "$0")/.." && pwd)}
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
port=5199
url="http://localhost:$port/src/client/labelsheet/preview.html?outlines"

mkdir -p "$out"
out=$(cd "$out" && pwd)
rm -f "$out"/print*.png "$out"/print.pdf "$out"/vite.log

if curl -s -o /dev/null "http://localhost:$port/"; then
  echo "Something already answers on port $port; stop it first." >&2
  exit 1
fi

cd "$src"
# Run Vite directly (not through pnpm) so $! is Vite itself and the trap really stops it.
./node_modules/.bin/vite --port "$port" --strictPort >"$out/vite.log" 2>&1 &
vite_pid=$!
trap 'kill "$vite_pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  kill -0 "$vite_pid" 2>/dev/null || { echo "Vite exited; see $out/vite.log" >&2; exit 1; }
  curl -sf "$url" >/dev/null && break
  sleep 0.5
done
curl -sf "$url" >/dev/null || { echo "Vite did not come up; see $out/vite.log" >&2; exit 1; }

# Warm Vite's dependency optimiser so the print is not a reload.
"$chrome" --headless --disable-gpu --virtual-time-budget=10000 --dump-dom "$url" >/dev/null 2>&1
"$chrome" --headless --disable-gpu --no-pdf-header-footer --virtual-time-budget=10000 \
  --print-to-pdf="$out/print.pdf" "$url" >/dev/null 2>&1
pdftoppm -r 150 -png "$out/print.pdf" "$out/print"
echo "print: $(ls "$out" | grep -c '^print-.*\.png$') page(s)"

kill "$vite_pid" 2>/dev/null || true
wait "$vite_pid" 2>/dev/null || true
if curl -s -o /dev/null "http://localhost:$port/"; then
  echo "Port $port is still in use after the run." >&2
  exit 1
fi
