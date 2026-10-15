#!/usr/bin/env bash
# Downloads the two font files the render template embeds (docs/ARCHITECTURE.md section 6):
#   Inter, latin subset             -> templates/fonts/inter.woff2
#   Noto Kufi Arabic, arabic subset -> templates/fonts/noto-kufi-arabic.woff2
# Both families are under the SIL Open Font License 1.1; see templates/fonts/LICENSE.md.
#
# Google Fonts serves both families as variable fonts (one file with a wght axis), so the 400 and
# 700 @font-face blocks in its CSS point at the same URL. We keep one file per family and
# src/render/fonts.ts declares it with `font-weight: 400 700`. The script checks that the two
# weights really do share a file and stops if Google ever goes back to static instances.
#
# Google Fonts only serves woff2 when the client looks like a modern browser, so the CSS is
# requested with a Chrome User-Agent. Each @font-face block in that CSS is preceded by a
# "/* subset */" comment and carries font-family, font-weight and a src url(...).
# Works with the bash 3.2 that ships with macOS.
#
# Usage: tools/fetch-fonts.sh        (overwrites the two files)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/templates/fonts"
mkdir -p "$OUT"

UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
CSS_URL='https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Noto+Kufi+Arabic:wght@400;700&display=swap'

echo "Fetching font CSS from Google Fonts"
CSS="$(curl -fsSL --max-time 30 -A "$UA" "$CSS_URL")"

# One line per @font-face block: family|weight|subset|url
INDEX="$(printf '%s\n' "$CSS" | awk '
  /^\/\* [a-z-]+ \*\//  { subset = $2; next }
  /font-family:/        { fam = $0; sub(/.*font-family: */, "", fam); gsub(/[^A-Za-z ]/, "", fam); gsub(/^ +| +$/, "", fam); next }
  /font-weight:/        { wt = $2; sub(/;/, "", wt); next }
  /src: *url\(/         { u = $0; sub(/.*url\(/, "", u); sub(/\).*/, "", u); next }
  /^}/                  { if (fam != "" && wt != "" && u != "") print fam "|" wt "|" subset "|" u; fam = ""; wt = ""; u = "" }
')"

if [ -z "$INDEX" ]; then
  echo "Could not parse any @font-face block from the Google Fonts CSS. First lines were:" >&2
  printf '%s\n' "$CSS" | head -20 >&2
  exit 1
fi

pick_url() { # family weight subset
  printf '%s\n' "$INDEX" | awk -F'|' -v f="$1" -v w="$2" -v s="$3" '$1 == f && $2 == w && $3 == s { print $4; exit }'
}

fetch_family() { # family subset filename
  local url400 url700 magic
  url400="$(pick_url "$1" 400 "$2")"
  url700="$(pick_url "$1" 700 "$2")"
  if [ -z "$url400" ] || [ -z "$url700" ]; then
    echo "No '$2' block for $1 400 and 700 in the Google Fonts CSS" >&2
    exit 1
  fi
  if [ "$url400" != "$url700" ]; then
    echo "$1: Google served different files for 400 and 700 (static instances, not a variable font)." >&2
    echo "  400: $url400" >&2
    echo "  700: $url700" >&2
    echo "src/render/fonts.ts expects one variable file per family with font-weight 400 700; adjust it before continuing." >&2
    exit 1
  fi
  case "$url400" in
    https://fonts.gstatic.com/*) ;;
    *) echo "Unexpected font URL, refusing to download: $url400" >&2; exit 1 ;;
  esac
  echo "  $1 ($2, variable, weights 400 and 700)"
  echo "    $url400"
  curl -fsSL --max-time 60 -A "$UA" -o "$OUT/$3" "$url400"
  magic="$(head -c 4 "$OUT/$3")"
  if [ "$magic" != "wOF2" ]; then
    echo "$3 does not start with the woff2 signature; removed" >&2
    rm -f "$OUT/$3"
    exit 1
  fi
}

fetch_family 'Inter' latin inter.woff2
fetch_family 'Noto Kufi Arabic' arabic noto-kufi-arabic.woff2

echo "Done:"
ls -l "$OUT"/*.woff2
