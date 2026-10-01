import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedUploadType, ALLOWED_UPLOAD_TYPES } from "../src/lib/uploadTypes.ts";

test("the types real features actually upload are allowed", () => {
  // Profile photos, celebration photos, recipe snaps, flyer scans.
  for (const t of ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]) {
    assert.equal(isAllowedUploadType(t), true, `${t} should be allowed`);
  }
});

test("SVG is rejected", () => {
  // The whole reason this module exists: an SVG can carry <script>, and
  // served from our own origin that is stored XSS.
  assert.equal(isAllowedUploadType("image/svg+xml"), false);
});

test("documents and markup are rejected", () => {
  for (const t of ["text/html", "application/javascript", "text/xml", "application/octet-stream"]) {
    assert.equal(isAllowedUploadType(t), false, `${t} should be rejected`);
  }
});

test("parameters and casing don't smuggle a type past the check", () => {
  assert.equal(isAllowedUploadType("IMAGE/JPEG"), true);
  assert.equal(isAllowedUploadType("image/jpeg; charset=binary"), true);
  // The reverse: dressing up HTML with a parameter must still fail.
  assert.equal(isAllowedUploadType("text/html; charset=utf-8"), false);
});

test("missing or empty content types are rejected, not defaulted", () => {
  assert.equal(isAllowedUploadType(undefined), false);
  assert.equal(isAllowedUploadType(null), false);
  assert.equal(isAllowedUploadType(""), false);
});

test("the allowlist contains no wildcard", () => {
  // A "image/*" entry would quietly re-admit SVG.
  assert.ok(ALLOWED_UPLOAD_TYPES.every((t) => !t.includes("*")));
});
