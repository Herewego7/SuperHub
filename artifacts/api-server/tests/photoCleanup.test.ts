// Regression coverage for the 2026-08-28 storage-cost fix: replacing or
// clearing a photo field (profile photo, wishlist item photo) previously
// left the OLD upload permanently orphaned in Postgres (every upload is
// base64 in a DB row, not real object storage — see objectStorage.ts's own
// module comment), since nothing ever deleted the row it replaced. See
// src/lib/photoCleanup.ts for the full writeup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldDeleteOldPhoto } from "../src/lib/photoCleanup";

test("a genuinely replaced photo should be cleaned up", () => {
  assert.equal(shouldDeleteOldPhoto("/objects/uploads/old-id", "/objects/uploads/new-id"), true);
});

test("a cleared photo (new value null) should be cleaned up", () => {
  assert.equal(shouldDeleteOldPhoto("/objects/uploads/old-id", null), true);
});

test("no old photo at all — nothing to clean up", () => {
  assert.equal(shouldDeleteOldPhoto(null, "/objects/uploads/new-id"), false);
  assert.equal(shouldDeleteOldPhoto(undefined, "/objects/uploads/new-id"), false);
});

test("the exact same value (no real change) is left alone — it's still in use", () => {
  assert.equal(shouldDeleteOldPhoto("/objects/uploads/same-id", "/objects/uploads/same-id"), false);
});

test("both old and new are null/empty — nothing to do either way", () => {
  assert.equal(shouldDeleteOldPhoto(null, null), false);
  assert.equal(shouldDeleteOldPhoto(undefined, undefined), false);
});
