#!/usr/bin/env bash
# Turn Unsplash PAGE links into the CDN urls the background library needs.
#
#   bash scripts/resolve-backgrounds.sh <page-url> [<page-url> ...]
#
# WHY THIS EXISTS: a link like
#   https://unsplash.com/photos/foggy-mountain-summit-1Z2niiBPg5A
# carries a short id (1Z2niiBPg5A) with no relationship to the CDN path the app
# uses (https://images.unsplash.com/photo-1506905925346-21bda4d32df4). The only
# way across is the page's own og:image tag — and the sandbox these scripts are
# written in cannot reach unsplash.com at all. So this runs on a machine that
# can, and prints entries for src/lib/backgrounds.ts.
#
# The label is guessed from the link's own slug and the category is left as
# TODO, because neither can be read off the page: paste the output into the
# chat and both get set properly before anything is committed.

set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: bash scripts/resolve-backgrounds.sh <unsplash page url> [...]" >&2
  echo "  e.g. bash scripts/resolve-backgrounds.sh https://unsplash.com/photos/foggy-mountain-summit-1Z2niiBPg5A" >&2
  exit 64
fi

fail=0
echo "// Paste these into the chat — label and category get set before committing."
echo

for page in "$@"; do
  # The slug sits between /photos/ and the trailing short id; "-foggy-mountain
  # -summit-1Z2niiBPg5A" becomes "Foggy Mountain Summit". A guess, and a much
  # better starting point than nothing.
  slug=$(echo "$page" | sed -E 's#.*/photos/##; s#-[A-Za-z0-9_-]{11}$##; s#-# #g')
  label=$(echo "$slug" | awk '{for (i=1; i<=NF; i++) $i = toupper(substr($i,1,1)) substr($i,2)} 1')

  # og:image is in the page head, so a plain GET is enough — no API key, no
  # JavaScript. -L because /photos/... redirects.
  #
  # ⚠️ `head -1` is load-bearing. `grep -m1` stops after the first matching
  # LINE, not the first match, and Unsplash puts an entire srcset inside one
  # quoted attribute — the first version of this printed each path twenty-odd
  # times and swept all of it into a single unusable url.
  photo=$(curl -sL --max-time 30 "$page" \
    | tr '"' '\n' \
    | grep -oE 'https://images\.unsplash\.com/photo-[A-Za-z0-9_-]+' \
    | head -1 \
    | sed 's#.*/##')

  if [ -z "$photo" ]; then
    echo "  // !! COULD NOT RESOLVE $page" >&2
    echo "  //    Open it, right-click the photo, Copy Image Address, and paste that instead." >&2
    fail=$(( fail + 1 ))
    continue
  fi

  printf '  { id: "TODO", label: "%s", category: "TODO", url: "https://images.unsplash.com/%s?w=1920&h=1080&fit=crop&q=80" },\n' \
    "$label" "$photo"
done

echo
if [ "$fail" -gt 0 ]; then
  echo "// $fail of $# could not be resolved - see the errors above." >&2
else
  echo "// All $# resolved."
fi
