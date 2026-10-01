import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "./logger";

/**
 * Signed URLs for uploaded objects.
 *
 * `GET /objects/*` had no authorization of any kind: anyone with a URL could
 * fetch any uploaded file — profile photos of children, celebration photos,
 * scanned documents. The URLs are random UUIDs, so this was
 * security-by-obscurity, and URLs leak through referrers, screenshots, support
 * tickets and browser history.
 *
 * Why signatures rather than `isAuthenticated` on the route: images render as
 * `<img src>`, which cannot attach an Authorization header, and on native the
 * WebView runs at capacitor://localhost so the session cookie is cross-origin
 * and will not be sent either. Requiring auth on that route would blank every
 * avatar in the app. A signature travels in the URL, so an `<img>` works
 * unchanged.
 *
 * THE INVARIANT THIS DEPENDS ON: what is stored — in the database, and in the
 * privacy screen's localStorage — is always the BARE path. Signatures are
 * added on the way out of an API response and stripped on the way in. A signed
 * URL that reaches storage would expire and leave a permanently broken image,
 * so `stripObjectSignature` runs over every request body before any route sees
 * it.
 */

/** How long a signed URL stays valid. Long enough that a screensaver left up
 *  overnight, or a tab open for a few days, does not break; short enough that
 *  a URL leaked into a log is not useful for long. */
export const OBJECT_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Matches a bare object path anywhere in a string value. */
const OBJECT_PATH = /^\/objects\/[A-Za-z0-9/_-]+$/;

let warnedAboutFallbackSecret = false;

function secret(): string {
  const dedicated = process.env.OBJECT_URL_SECRET;
  if (dedicated) return dedicated;
  const session = process.env.SESSION_SECRET;
  if (!session) {
    throw new Error("Neither OBJECT_URL_SECRET nor SESSION_SECRET is set — cannot sign object URLs");
  }
  if (!warnedAboutFallbackSecret) {
    warnedAboutFallbackSecret = true;
    logger.warn(
      "OBJECT_URL_SECRET is not set — falling back to SESSION_SECRET. Set a dedicated secret so rotating one does not sign everyone out.",
    );
  }
  return session;
}

function mac(pathname: string, exp: number, userId: string): string {
  return createHmac("sha256", secret())
    .update(`${pathname}\n${exp}\n${userId}`)
    .digest("base64url");
}

/** True for a value that looks like an object path we should sign. */
export function isObjectPath(value: unknown): value is string {
  return typeof value === "string" && OBJECT_PATH.test(value);
}

/**
 * Remove any signature from a path, recovering the bare form.
 *
 * Idempotent, and safe on a value that was never signed — which matters,
 * because it runs over every request body and most strings passing through it
 * are not object paths at all.
 */
export function stripObjectSignature(value: string): string {
  if (typeof value !== "string") return value;
  const q = value.indexOf("?");
  if (q === -1) return value;
  const base = value.slice(0, q);
  // Only strip from something that is actually an object path. A query string
  // on anything else (an Unsplash URL, say) is meaningful and must survive.
  return OBJECT_PATH.test(base) ? base : value;
}

/**
 * Sign a bare object path for `userId`.
 *
 * `userId` is the family owner id. It is inside the MAC, so a signature minted
 * for one household cannot be replayed against another's object even if the
 * path leaks.
 */
export function signObjectPath(path: string, userId: string, now: Date = new Date()): string {
  const bare = stripObjectSignature(path);
  if (!OBJECT_PATH.test(bare)) return path;
  const exp = now.getTime() + OBJECT_URL_TTL_MS;
  return `${bare}?exp=${exp}&uid=${encodeURIComponent(userId)}&sig=${mac(bare, exp, userId)}`;
}

export type ObjectSignatureResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "expired" };

/**
 * Verify the query parameters on an incoming `/objects/...` request.
 *
 * Takes the pathname and the parsed query separately, because Express has
 * already split them and re-joining would risk disagreeing with what it
 * parsed.
 */
export function verifyObjectSignature(
  pathname: string,
  query: Record<string, unknown>,
  now: Date = new Date(),
): ObjectSignatureResult {
  const expRaw = query.exp;
  const uid = query.uid;
  const sig = query.sig;

  if (typeof sig !== "string" || typeof uid !== "string" || (typeof expRaw !== "string" && typeof expRaw !== "number")) {
    // Nothing presented at all — distinct from a wrong one, so the route can
    // treat "old client" and "forgery" differently during the transition.
    return { ok: false, reason: sig === undefined ? "missing" : "malformed" };
  }

  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed" };

  let expected: string;
  try {
    expected = mac(pathname, exp, uid);
  } catch {
    return { ok: false, reason: "bad_signature" };
  }

  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  // Length is checked first: timingSafeEqual throws on a mismatch, and a
  // truncated signature must be rejected, not crash the request.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  // Expiry is checked AFTER the signature so an attacker cannot use the
  // response to learn whether a guessed signature was otherwise well-formed.
  if (exp <= now.getTime()) return { ok: false, reason: "expired" };

  return { ok: true, userId: uid };
}

// ── Walking response and request bodies ─────────────────────────────────────

const MAX_WALK_DEPTH = 12;

/**
 * Return a copy of `value` with every bare object path signed.
 *
 * Applied to outgoing JSON at one choke point rather than at each of the four
 * tables that store a path (profiles, celebration photos, wishlist items,
 * savings goals) plus everything that joins them — enumerating those by hand
 * is how one gets missed.
 */
export function signObjectPathsIn<T>(value: T, userId: string, now: Date = new Date(), depth = 0): T {
  if (depth > MAX_WALK_DEPTH) return value;
  if (isObjectPath(value)) return signObjectPath(value, userId, now) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => signObjectPathsIn(v, userId, now, depth + 1)) as unknown as T;
  }
  if (value && typeof value === "object") {
    // Dates, Buffers and the like must pass through untouched — rebuilding
    // them as plain objects would change what the client receives.
    if (value instanceof Date || Buffer.isBuffer(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = signObjectPathsIn(v, userId, now, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Strip signatures from an incoming body, IN PLACE.
 *
 * This is what keeps the database holding bare paths. A client that reads a
 * profile and writes it back — the ordinary edit-form round trip — would
 * otherwise persist a signed URL that expires in a week and leaves a
 * permanently broken image, and only some write paths call
 * `normalizeObjectEntityPath` today.
 */
export function stripObjectSignaturesIn(value: unknown, depth = 0): void {
  if (depth > MAX_WALK_DEPTH || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      if (typeof v === "string") value[i] = stripObjectSignature(v);
      else stripObjectSignaturesIn(v, depth + 1);
    }
    return;
  }
  const obj = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") obj[k] = stripObjectSignature(v);
    else stripObjectSignaturesIn(v, depth + 1);
  }
}
