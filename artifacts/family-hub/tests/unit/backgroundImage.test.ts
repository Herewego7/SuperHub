import { test } from "node:test";
import assert from "node:assert/strict";
import { orientedImageUrl } from "../../src/lib/backgroundImage.ts";

const LANDSCAPE = "https://images.unsplash.com/photo-1490750967868-88df5691240b?w=1920&h=1080&fit=crop&q=80";

test("a portrait screen gets a portrait crop of the same photo", () => {
  const got = new URL(orientedImageUrl(LANDSCAPE, true));
  assert.equal(got.searchParams.get("w"), "1080");
  assert.equal(got.searchParams.get("h"), "1920");
  // Same photo, same quality and fit — only the shape changes.
  assert.equal(got.pathname, "/photo-1490750967868-88df5691240b");
  assert.equal(got.searchParams.get("fit"), "crop");
  assert.equal(got.searchParams.get("q"), "80");
});

test("a landscape screen keeps the library's own landscape crop", () => {
  const got = new URL(orientedImageUrl(LANDSCAPE, false));
  assert.equal(got.searchParams.get("w"), "1920");
  assert.equal(got.searchParams.get("h"), "1080");
});

test("a url already in the right shape round-trips unchanged", () => {
  const portraitUrl = orientedImageUrl(LANDSCAPE, true);
  assert.equal(orientedImageUrl(portraitUrl, true), portraitUrl);
  assert.equal(orientedImageUrl(orientedImageUrl(LANDSCAPE, false), false), LANDSCAPE);
});

/**
 * The family's own uploaded photo is a real file at one fixed size. Appending
 * sizing parameters would at best do nothing and at worst 404, so it is left
 * alone and cropped by `object-fit: cover` like any other image.
 */
test("an uploaded photo is left exactly as it is", () => {
  const uploaded = "/objects/uploads/kitchen-window.jpg";
  assert.equal(orientedImageUrl(uploaded, true), uploaded);
  assert.equal(orientedImageUrl(uploaded, false), uploaded);
});

test("anything unrecognised is returned untouched rather than mangled", () => {
  for (const url of [
    "https://example.com/photo.jpg?w=1920&h=1080",   // not a host we can resize
    "https://images.unsplash.com/photo-x",           // no sizing params at all
    "https://images.unsplash.com/photo-x?w=0&h=0",   // nonsense dimensions
    "https://images.unsplash.com/photo-x?w=abc&h=1080",
    "not a url at all",
    "",
  ]) {
    assert.equal(orientedImageUrl(url, true), url, `mangled: ${url}`);
  }
});

// A square image swapped is a no-op that still changes the string, which
// would bust the browser cache on every rotation for no visible benefit.
test("a square image is left alone in both orientations", () => {
  const square = "https://images.unsplash.com/photo-x?w=1200&h=1200&fit=crop";
  assert.equal(orientedImageUrl(square, true), square);
  assert.equal(orientedImageUrl(square, false), square);
});

// ── per-image crop region ──────────────────────────────────────────────────
// Reviewed one by one in both crops (2026-09-16): the centre won 31 of the 40
// judged, so entropy is marked on the nine whose subject sits off to one side
// rather than applied library-wide.
import { BUILTIN_IMAGES, displayBackgroundUrl } from "../../src/lib/backgrounds.ts";

const ENTROPY_WINNERS = [
  "Alpine Meadow", "Enchanted Forest", "Garden Roses", "Golden Hour Shore", "Golden Swirls",
  "Lake Reflection", "Rose Arbour", "Soft Pink Marble", "Sunflower Field",
];

test("exactly the nine reviewed winners are marked for an entropy crop", () => {
  const marked = BUILTIN_IMAGES.filter(i => i.portraitCrop === "entropy").map(i => i.label).sort();
  assert.deepEqual(marked, [...ENTROPY_WINNERS].sort());
});

test("a marked image gets crop=entropy in portrait", () => {
  const img = BUILTIN_IMAGES.find(i => i.label === "Alpine Meadow")!;
  const got = new URL(displayBackgroundUrl(img.url, true));
  assert.equal(got.searchParams.get("crop"), "entropy");
  assert.equal(got.searchParams.get("w"), "1080");
  assert.equal(got.searchParams.get("h"), "1920");
});

/**
 * Landscape is the shape these photos were chosen and cropped in, and nobody
 * reviewed them that way. Changing how they crop there would alter pictures
 * people have already picked, to fix a problem nobody reported.
 */
test("even a marked image keeps its plain landscape crop", () => {
  const img = BUILTIN_IMAGES.find(i => i.label === "Alpine Meadow")!;
  const got = new URL(displayBackgroundUrl(img.url, false));
  assert.equal(got.searchParams.get("crop"), null);
  assert.equal(got.searchParams.get("w"), "1920");
});

test("an unmarked image is left on the centre crop in both shapes", () => {
  const img = BUILTIN_IMAGES.find(i => i.label === "Calm Ocean Sunrise")!;
  assert.equal(img.portraitCrop, undefined);
  assert.equal(new URL(displayBackgroundUrl(img.url, true)).searchParams.get("crop"), null);
  assert.equal(new URL(displayBackgroundUrl(img.url, false)).searchParams.get("crop"), null);
});

// The six nobody judged keep what they do today. Naming them here means a
// later reviewer can tell "decided: centre" from "never looked at".
test("the six unreviewed backgrounds are still on the centre crop", () => {
  for (const label of ["Autumn Harvest", "Blush Tones", "Cherry Blossoms",
                       "Pink Peonies", "Pink Sunset Hills", "Wildflower Meadow"]) {
    const img = BUILTIN_IMAGES.find(i => i.label === label);
    assert.ok(img, `${label} is missing from the library`);
    assert.equal(img!.portraitCrop, undefined, `${label} was marked without being reviewed`);
  }
});

test("an uploaded photo is never given a crop region", () => {
  const uploaded = "/objects/uploads/ours.jpg";
  assert.equal(displayBackgroundUrl(uploaded, true), uploaded);
  assert.equal(displayBackgroundUrl(uploaded, false), uploaded);
});

// ── a withdrawn background ─────────────────────────────────────────────────
// Removing an entry from the library stops it being OFFERED, but a device that
// already picked it keeps the url in its own storage and would show it
// forever — no use when the reason for removing it was that it shouldn't be on
// anyone's wall.
import { isRetiredBackground } from "../../src/lib/backgrounds.ts";

test("Soft Linen Morning is gone from the library", () => {
  assert.equal(
    BUILTIN_IMAGES.find(i => i.label === "Soft Linen Morning"), undefined,
    "the withdrawn background is still being offered",
  );
});

test("a device that had picked it is treated as having no choice", () => {
  const withdrawn = "https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=1920&h=1080&fit=crop&q=80";
  assert.equal(isRetiredBackground(withdrawn), true);
  // Everything still in the library must NOT be swept up by the same list.
  for (const img of BUILTIN_IMAGES) {
    assert.equal(isRetiredBackground(img.url), false, `${img.label} is marked as withdrawn`);
  }
});

test("the library holds every background exactly once", () => {
  assert.equal(BUILTIN_IMAGES.length, 55);
  assert.equal(new Set(BUILTIN_IMAGES.map(i => i.id)).size, 55, "duplicate ids");
  assert.equal(new Set(BUILTIN_IMAGES.map(i => i.url)).size, 55, "duplicate urls");
  // Two entries pointing at the same PHOTO with different ids would show the
  // same picture twice in the picker under two names — easy to do when adding
  // in bulk, and invisible until someone scrolls the grid.
  const photos = BUILTIN_IMAGES.map(i => (/\/(photo-[^?]+)/.exec(i.url) || [])[1]);
  assert.equal(new Set(photos).size, 55, "two entries point at the same photo");
  assert.equal(photos.filter(Boolean).length, 55, "an entry has no photo path");
});

// Added 2026-09-16 from links supplied by the user. Their urls had to be
// resolved on a machine that can reach unsplash.com, so a transcription slip
// would be invisible until the background rendered black on someone's wall.
test("every background url is a well-formed Unsplash request", () => {
  for (const img of BUILTIN_IMAGES) {
    assert.match(
      img.url,
      /^https:\/\/images\.unsplash\.com\/photo-[A-Za-z0-9_-]+\?w=1920&h=1080&fit=crop&q=80$/,
      `${img.label} has a malformed url: ${img.url}`,
    );
    assert.ok(img.label.trim().length > 0 && img.category.trim().length > 0, `${img.id} is missing a label or category`);
  }
});
