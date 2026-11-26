#!/usr/bin/env bash
# Prints the label-sheet preview to PDF and PNG, light and dark, so two trees can be compared.
# Usage: scripts/print-check.sh <out-dir> [source-dir]   (source-dir defaults to the repo root)
# Compare two runs page by page: magick compare -metric AE a/light-1.png b/light-1.png null:
# Needs headless Google Chrome on macOS, pdftoppm and a Vite install in source-dir.
set -euo pipefail

out=${1:?usage: print-check.sh <out-dir> [source-dir]}
src=${2:-$(cd "$(dirname "$0")/.." && pwd)}
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
port=5199
mkdir -p "$out"
out=$(cd "$out" && pwd)

cd "$src"
pnpm vite --port "$port" --strictPort >"$out/vite.log" 2>&1 &
vite_pid=$!
trap 'kill "$vite_pid" 2>/dev/null || true' EXIT

url="http://localhost:$port/src/client/labelsheet/preview.html?outlines"
for _ in $(seq 1 60); do
  curl -sf "$url" >/dev/null && break
  sleep 0.5
done
curl -sf "$url" >/dev/null || { echo "Vite did not start; see $out/vite.log" >&2; exit 1; }

# Warm Vite's dependency optimiser so the first print is not a reload.
"$chrome" --headless --disable-gpu --virtual-time-budget=10000 --dump-dom "$url" >/dev/null 2>&1

# --force-dark-mode does not pin light: headless Chrome follows the OS appearance, so a dark Mac would
# make the "light" run dark. blink's preferredColorScheme pins both (0 = dark, 1 = light). Probe each.
light_flag=--blink-settings=preferredColorScheme=1
dark_flag=--blink-settings=preferredColorScheme=0
probe="data:text/html,<body><script>document.body.textContent='dark='+matchMedia('(prefers-color-scheme: dark)').matches</script>"
"$chrome" --headless --disable-gpu "$light_flag" --dump-dom "$probe" 2>/dev/null | grep -q 'dark=false' || { echo "light flag did not give prefers-color-scheme: light" >&2; exit 1; }
"$chrome" --headless --disable-gpu "$dark_flag" --dump-dom "$probe" 2>/dev/null | grep -q 'dark=true' || { echo "dark flag did not give prefers-color-scheme: dark" >&2; exit 1; }

print() { # <name> <extra flags...>
  local name=$1; shift
  "$chrome" --headless --disable-gpu --no-pdf-header-footer --virtual-time-budget=10000 "$@" \
    --print-to-pdf="$out/$name.pdf" "$url" >/dev/null 2>&1
  pdftoppm -r 150 -png "$out/$name.pdf" "$out/$name"
  echo "$name: $(ls "$out" | grep -c "^$name-.*\.png$") page(s)"
}
print light "$light_flag"
print dark "$dark_flag"
