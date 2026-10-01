/**
 * Crop a full-screen background to the shape of the screen showing it.
 *
 * WHY (2026-09-16). Every built-in background in `privacy-screen.tsx` is
 * requested at `w=1920&h=1080` — 16:9 landscape, with no portrait variant. On
 * a portrait phone, filling the height with a 16:9 image means the viewer sees
 * roughly the middle THIRTEENTH of the picture's width. A lavender field
 * survives that; "Cozy Fireplace" becomes an unrecognisable smear of its own
 * centre. This affects the privacy screen (which fires whenever the app is
 * backgrounded, including on phones) as much as the screensaver.
 *
 * The fix is free, because the crop lives in the query string: ask the same
 * photo for a portrait crop instead. Nothing is stored differently — only the
 * URL used to DISPLAY it changes, so a device that rotates re-requests the
 * other crop and no saved preference needs migrating.
 */

/** Hosts whose URLs carry their own sizing parameters and can be re-cropped. */
const RESIZABLE = /^https:\/\/images\.unsplash\.com\//;

/**
 * Swap a background URL's width and height to match the screen's orientation.
 *
 * Anything that isn't a resizable remote image — most importantly a family's
 * own uploaded photo at `/objects/...` — is returned untouched. That is a real
 * file at one fixed size, and appending sizing parameters to it would either
 * do nothing or produce a 404; it gets cropped by `object-fit: cover` like any
 * other image.
 */
export function orientedImageUrl(
  url: string,
  portrait: boolean,
  /**
   * Which region to keep when the crop is destructive. Left undefined the
   * image keeps its centre, which is right for most of the library — reviewed
   * one by one on 2026-09-16, the centre won 31 of the 40 judged. `entropy`
   * keeps the busiest region instead, and is set per-image for the handful
   * whose subject sits off to one side.
   *
   * ⚠️ Only applied in PORTRAIT. Landscape is the shape these photos were
   * chosen and cropped in, and nobody reviewed them that way; changing how
   * they crop there would alter pictures people have already picked, for no
   * reported problem.
   */
  portraitCrop?: "entropy",
): string {
  if (!url || !RESIZABLE.test(url)) return url;
  try {
    const u = new URL(url);
    const w = Number(u.searchParams.get("w"));
    const h = Number(u.searchParams.get("h"));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return url;
    // Keep whatever dimensions the library asked for; only decide which way
    // round they go. A square image is left alone — swapping it is a no-op
    // that would still bust the browser cache on every rotation.
    const long = Math.max(w, h);
    const short = Math.min(w, h);
    if (long === short) return url;
    u.searchParams.set("w", String(portrait ? short : long));
    u.searchParams.set("h", String(portrait ? long : short));
    if (portrait && portraitCrop) u.searchParams.set("crop", portraitCrop);
    return u.toString();
  } catch {
    return url; // not a URL we can parse — leave it exactly as it was
  }
}
