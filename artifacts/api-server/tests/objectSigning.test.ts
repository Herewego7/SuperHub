import { test } from "node:test";
import assert from "node:assert/strict";

process.env.OBJECT_URL_SECRET ??= "test-secret-for-object-urls";

import {
  signObjectPath,
  verifyObjectSignature,
  stripObjectSignature,
  stripObjectSignaturesIn,
  signObjectPathsIn,
  isObjectPath,
  OBJECT_URL_TTL_MS,
} from "../src/lib/objectSigning.ts";

const PATH = "/objects/uploads/2c9f7f1a-0000-4444-8888-abcdefabcdef";
const OWNER = "family-owner-1";

/** Parse a signed URL the way Express would hand it to the route. */
function split(signed: string): { pathname: string; query: Record<string, string> } {
  const [pathname, qs] = signed.split("?");
  const query: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(qs ?? "")) query[k] = v;
  return { pathname, query };
}

test("a signed path verifies and names the family it was signed for", () => {
  const { pathname, query } = split(signObjectPath(PATH, OWNER));
  const result = verifyObjectSignature(pathname, query);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.userId, OWNER);
});

test("THE VULNERABILITY: an unsigned path presents no signature", () => {
  // Before 2026-09-21 this was every request, and the route served the file.
  const result = verifyObjectSignature(PATH, {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "missing");
});

test("a different object cannot reuse another's signature", () => {
  // The path is inside the MAC, so lifting a valid signature onto a guessed
  // object id must fail.
  const { query } = split(signObjectPath(PATH, OWNER));
  const other = "/objects/uploads/11111111-2222-3333-4444-555555555555";
  const result = verifyObjectSignature(other, query);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "bad_signature");
});

test("a signature cannot be replayed against another household", () => {
  // uid is inside the MAC, so editing it invalidates the signature rather
  // than granting one family access under another's name.
  const { pathname, query } = split(signObjectPath(PATH, OWNER));
  const result = verifyObjectSignature(pathname, { ...query, uid: "another-family" });
  assert.equal(result.ok, false);
});

test("extending the expiry by hand fails", () => {
  const { pathname, query } = split(signObjectPath(PATH, OWNER));
  const forged = { ...query, exp: String(Number(query.exp) + 60_000) };
  const result = verifyObjectSignature(pathname, forged);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "bad_signature");
});

test("an expired signature fails even though it is genuine", () => {
  const { pathname, query } = split(signObjectPath(PATH, OWNER));
  const result = verifyObjectSignature(pathname, query, new Date(Date.now() + OBJECT_URL_TTL_MS + 1000));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "expired");
});

test("a signature from a different secret fails", () => {
  const signed = signObjectPath(PATH, OWNER);
  const original = process.env.OBJECT_URL_SECRET;
  process.env.OBJECT_URL_SECRET = "a-different-secret";
  try {
    const { pathname, query } = split(signed);
    assert.equal(verifyObjectSignature(pathname, query).ok, false);
  } finally {
    process.env.OBJECT_URL_SECRET = original;
  }
});

test("malformed signatures are rejected, never thrown on", () => {
  const { pathname, query } = split(signObjectPath(PATH, OWNER));
  for (const bad of [{ ...query, sig: "short" }, { ...query, sig: "" }, { ...query, exp: "nonsense" }, { sig: "x" }]) {
    assert.doesNotThrow(() => verifyObjectSignature(pathname, bad as any));
    assert.equal(verifyObjectSignature(pathname, bad as any).ok, false);
  }
});

// ── The stored-data invariant ───────────────────────────────────────────────

test("stripping recovers the bare path and is idempotent", () => {
  const signed = signObjectPath(PATH, OWNER);
  assert.equal(stripObjectSignature(signed), PATH);
  assert.equal(stripObjectSignature(stripObjectSignature(signed)), PATH);
  assert.equal(stripObjectSignature(PATH), PATH);
});

test("stripping leaves non-object URLs alone, query string and all", () => {
  // An Unsplash background carries meaningful query parameters — w, h, crop.
  // Losing them would silently change which slice of the image is shown.
  const unsplash = "https://images.unsplash.com/photo-123?w=1600&h=900&crop=entropy";
  assert.equal(stripObjectSignature(unsplash), unsplash);
  assert.equal(stripObjectSignature("/api/thing?x=1"), "/api/thing?x=1");
  assert.equal(stripObjectSignature("not a url"), "not a url");
});

test("a round trip through a response and back leaves storage bare", () => {
  // The edit-form round trip: read a profile, submit the form unchanged.
  // Without the inbound strip this persists a URL that expires in a week.
  const fromDb = { id: "p1", name: "Ava", photoUrl: PATH };
  const sent = signObjectPathsIn(fromDb, OWNER);
  assert.notEqual(sent.photoUrl, PATH);

  const submittedBack = JSON.parse(JSON.stringify(sent));
  stripObjectSignaturesIn(submittedBack);
  assert.equal(submittedBack.photoUrl, PATH, "what reaches storage must be the bare path");
});

test("signing walks nested arrays and objects", () => {
  const payload = {
    profiles: [{ photoUrl: PATH }, { photoUrl: null }],
    celebration: { photos: [{ imageUrl: PATH }] },
    unrelated: "hello",
    count: 3,
  };
  const signed = signObjectPathsIn(payload, OWNER);
  assert.ok(signed.profiles[0].photoUrl.startsWith(PATH + "?"));
  assert.equal(signed.profiles[1].photoUrl, null);
  assert.ok(signed.celebration.photos[0].imageUrl.startsWith(PATH + "?"));
  assert.equal(signed.unrelated, "hello");
  assert.equal(signed.count, 3);
});

test("signing does not mutate what it was given", () => {
  // The walk runs over rows that may be shared with a cache; mutating them
  // would poison it with URLs that expire.
  const payload = { photoUrl: PATH };
  signObjectPathsIn(payload, OWNER);
  assert.equal(payload.photoUrl, PATH);
});

test("Dates survive the walk unchanged", () => {
  // Rebuilding a Date as a plain object would change every timestamp the API
  // returns — the kind of thing that passes a typecheck and breaks the app.
  const when = new Date("2026-09-21T10:00:00Z");
  const signed = signObjectPathsIn({ createdAt: when, photoUrl: PATH }, OWNER);
  assert.ok(signed.createdAt instanceof Date);
  assert.equal(signed.createdAt.toISOString(), when.toISOString());
});

test("a deeply nested or cyclic-looking structure terminates", () => {
  let deep: any = { photoUrl: PATH };
  for (let i = 0; i < 40; i++) deep = { nested: deep };
  assert.doesNotThrow(() => signObjectPathsIn(deep, OWNER));
  assert.doesNotThrow(() => stripObjectSignaturesIn(deep));
});

test("isObjectPath only matches our own paths", () => {
  assert.equal(isObjectPath(PATH), true);
  assert.equal(isObjectPath("/objects/uploads/abc"), true);
  assert.equal(isObjectPath("https://images.unsplash.com/photo-1"), false);
  assert.equal(isObjectPath("/api/profiles"), false);
  assert.equal(isObjectPath(null), false);
  assert.equal(isObjectPath(42), false);
  // Already signed: not a BARE path, so it is never double-signed.
  assert.equal(isObjectPath(signObjectPath(PATH, OWNER)), false);
});

test("signing an already-signed path does not nest signatures", () => {
  const once = signObjectPath(PATH, OWNER);
  const twice = signObjectPath(once, OWNER);
  assert.equal((twice.match(/sig=/g) ?? []).length, 1);
  const { pathname, query } = split(twice);
  assert.equal(verifyObjectSignature(pathname, query).ok, true);
});
