import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { objectUrl } from "@/lib/apiBase";

/**
 * A signed URL for an uploaded object whose path this device is holding
 * locally.
 *
 * Almost nothing needs this. Uploaded-object paths arrive from the API
 * already signed, so the ~43 `objectUrl(profile.photoUrl)` call sites keep
 * working untouched. The exception is the privacy-screen background: the
 * family's chosen image is kept in this device's localStorage, per device, so
 * it never passes through an API response and has no signature on it.
 *
 * What is STORED stays the bare path. Signing happens here, at render, so a
 * seven-day-old localStorage entry is still usable.
 */

/** Strip a signature, recovering the bare path. Mirrors the server's own
 *  `stripObjectSignature` — what we persist must never carry one. */
export function bareObjectPath(url: string): string {
  if (!url.startsWith("/objects/")) return url;
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

export function isUploadedObjectPath(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith("/objects/");
}

// Signed URLs are good for a week, so one fetch per path per app run is
// plenty. Keyed on the BARE path.
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

export async function fetchSignedObjectUrl(path: string): Promise<string | null> {
  const bare = bareObjectPath(path);
  const hit = cache.get(bare);
  if (hit) return hit;

  const existing = inFlight.get(bare);
  if (existing) return existing;

  const request = (async () => {
    try {
      const res = await apiRequest("POST", "/api/objects/sign", { path: bare });
      const { url } = await res.json();
      if (typeof url === "string" && url) {
        cache.set(bare, url);
        return url;
      }
      return null;
    } catch {
      // Offline, signed out, or the object is gone. The callers here all
      // already have a no-image fallback, which is the right outcome.
      return null;
    } finally {
      inFlight.delete(bare);
    }
  })();

  inFlight.set(bare, request);
  return request;
}

/**
 * Resolve a background URL for display.
 *
 * A remote URL (every built-in background is an Unsplash link) passes
 * straight through, synchronously — only an uploaded `/objects/...` path
 * needs a round trip, and until it resolves this returns null so the caller
 * shows whatever it already shows when there is no image.
 */
export function useSignedObjectUrl(url: string | null | undefined): string | null {
  const isUpload = isUploadedObjectPath(url);
  const [signed, setSigned] = useState<string | null>(() =>
    isUpload ? cache.get(bareObjectPath(url)) ?? null : null,
  );

  useEffect(() => {
    if (!isUpload) return;
    let cancelled = false;
    fetchSignedObjectUrl(url).then((result) => {
      if (!cancelled) setSigned(result);
    });
    return () => {
      cancelled = true;
    };
  }, [url, isUpload]);

  if (!url) return null;
  if (!isUpload) return url;
  // objectUrl() puts the API origin in front on native, where a relative path
  // would otherwise resolve against capacitor://localhost and never reach the
  // backend at all. (Uploaded privacy backgrounds were broken on native for
  // exactly that reason before this went through objectUrl.)
  return signed ? objectUrl(signed) ?? null : null;
}

/** Drop a cached signature — after choosing a new image, say. */
export function forgetSignedObjectUrl(path: string): void {
  cache.delete(bareObjectPath(path));
}

/**
 * Drop every cached signature and abandon anything in flight.
 *
 * Called when the household changes: a signed URL minted for the previous
 * family stays valid for its full lifetime, so leaving them cached would let
 * the next account render the previous one's photos. In-flight requests are
 * dropped too — one that resolves after the switch would otherwise repopulate
 * the cache it just got cleared from.
 */
export function clearSignedObjectUrlCache(): void {
  cache.clear();
  inFlight.clear();
}
