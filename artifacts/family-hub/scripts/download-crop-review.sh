#!/usr/bin/env bash
# Download every built-in privacy-screen background in both portrait crops, so
# they can be compared side by side in a folder (2026-09-16).
#
# WHY A SCRIPT RATHER THAN CHECKED-IN FILES: these are remote Unsplash images.
# Committing ~90 full-size photos would add tens of megabytes to the repo for
# something looked at once, and the sandbox this was written in cannot reach
# images.unsplash.com at all. Run it on a machine that can.
#
#   bash scripts/download-crop-review.sh [output-dir]
#
# Produces, for each background:
#   <name>--1-centre.jpg    the crop that ships today (centre of a 16:9 photo)
#   <name>--2-entropy.jpg   the same photo with crop=entropy
#
# Sorted so each pair sits together in the folder, which is the whole point —
# in Finder's icon view the two crops of one photo end up side by side.

set -euo pipefail

OUT="${1:-crop-review}"
mkdir -p "$OUT"

# id|filename|unsplash photo path
IMAGES=(
  "bi1|pink-peonies|photo-1490750967868-88df5691240b"
  "bi2|white-roses|photo-1525310072745-f49212b5ac6d"
  "bi3|cherry-blossoms|photo-1522383225753-aa8fe0cdfb14"
  "bi4|lavender-field|photo-1462275646964-a0e3386b89fa"
  "bi5|wildflower-meadow|photo-1490818852745-9f62b0b58e38"
  "bi6|sunflower-field|photo-1504386106331-3e4e71712b38"
  "bi7|garden-roses|photo-1502977249166-824b3a8a4d6d"
  "bi9|hydrangea-bloom|photo-1468327768560-75b778cbb551"
  "bi10|soft-magnolia|photo-1519659528534-7fd733a832a0"
  "bi11|calm-ocean-sunrise|photo-1507525428034-b723cf961d3e"
  "bi12|pastel-sunset-beach|photo-1519046904884-53103b34b206"
  "bi13|turquoise-lagoon|photo-1505118380757-91f5f5632de0"
  "bi14|lake-reflection|photo-1506905925346-21bda4d32df4"
  "bi15|misty-waterfall|photo-1494500764479-0c8f2919a3d8"
  "bi16|golden-hour-shore|photo-1439066615861-d1af74d74000"
  "bi17|seashell-beach|photo-1510414842594-a61c69b5ae57"
  "bi49|palm-tree-silhouette|photo-1520454974749-611b7248ffdb"
  "bi50|tropical-beach-cove|photo-1573790387438-4da905039392"
  "bi51|island-palms|photo-1544551763-46a013bb70d5"
  "bi52|overwater-bungalow|photo-1573843981267-be1999ff37cd"
  "bi18|enchanted-forest|photo-1448375240586-882707db888b"
  "bi20|misty-morning-trees|photo-1441974231674-7be02c33085b"
  "bi21|fern-forest-path|photo-1418065460487-3e41a6c84dc5"
  "bi22|spring-blossoms|photo-1490730141103-6cac27aaab94"
  "bi23|autumn-leaves|photo-1508739773434-c26b3d09e071"
  "bi25|alpine-meadow|photo-1501854140801-50d01698950b"
  "bi26|pink-sunset-hills|photo-1465188035479-23b8f7e53caa"
  "bi27|foggy-valley|photo-1464822759023-fed622ff2c3b"
  "bi28|rolling-green-hills|photo-1500534314209-a25ddb2bd429"
  "bi29|snow-capped-peaks|photo-1486870591958-9b9d0d1dda99"
  "bi30|dreamy-meadow|photo-1470770841072-f978cf4d019e"
  "bi31|aurora-borealis|photo-1531366936337-7c912a4589a7"
  "bi34|golden-hour-glow|photo-1495616811223-4d98c6e9c869"
  "bi35|starry-night|photo-1436891620584-47fd0e565afb"
  "bi36|soft-morning-mist|photo-1497436072909-60f360e1d4b1"
  "bi37|cozy-fireplace|photo-1512552288940-3a300922a275"
  "bi38|morning-coffee|photo-1495474472287-4d71bcdd2085"
  "bi39|warm-candlelight|photo-1481277542470-605612bd2d61"
  "bi40|autumn-harvest|photo-1476887334197-56a5f1f56f56"
  "bi42|garden-patio|photo-1416879595882-3373a0480b5b"
  "bi43|soft-pink-marble|photo-1557683316-973673baf926"
  "bi44|pastel-watercolor|photo-1541701494587-cb58502866ab"
  "bi45|golden-swirls|photo-1558618666-fcd25c85cd64"
  "bi46|blush-tones|photo-1543722530-d2c3201371e7"
  "bi48|rose-arbour|photo-1463936575829-25148e1db1b8"
)

total=$(( ${#IMAGES[@]} * 2 ))
n=0
for row in "${IMAGES[@]}"; do
  IFS="|" read -r id name photo <<< "$row"
  for variant in centre entropy; do
    n=$(( n + 1 ))
    if [ "$variant" = "centre" ]; then
      url="https://images.unsplash.com/${photo}?w=1080&h=1920&fit=crop&q=80"
      file="$OUT/${name}--1-centre.jpg"
    else
      url="https://images.unsplash.com/${photo}?w=1080&h=1920&fit=crop&crop=entropy&q=80"
      file="$OUT/${name}--2-entropy.jpg"
    fi
    printf "[%2d/%d] %s\n" "$n" "$total" "$(basename "$file")"
    # --fail so a dead photo is reported rather than leaving a 0-byte file
    # that looks like a bad crop.
    curl -sS --fail --max-time 30 -o "$file" "$url" || echo "  !! could not fetch $id ($photo)"
  done
done

echo
echo "Done - $total files in $OUT/"
echo "Each photo appears twice, next to each other: --1-centre then --2-entropy."
