// Coverage for lib/profileRole.ts's isKidProfile — the server-side mirror of
// the frontend gate used to scope Daily Brief/bedtime pushes per-kid
// (2026-08-10 batch) and drives whether a profile's own schedule is
// self-only or family-wide in those schedulers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isKidProfile } from "../src/lib/profileRole";

test("role: child is a kid", () => {
  assert.equal(isKidProfile({ role: "child" }), true);
});

test("role: adult is not a kid", () => {
  assert.equal(isKidProfile({ role: "adult" }), false);
});

test("legacy isChild (under-13 COPPA flag) counts as a kid even with role adult/unset", () => {
  assert.equal(isKidProfile({ role: null, isChild: true }), true);
  assert.equal(isKidProfile({ isChild: true }), true);
});

test("neither role nor isChild set → not a kid (adult default)", () => {
  assert.equal(isKidProfile({}), false);
});

test("null/undefined profile → not a kid, never throws", () => {
  assert.equal(isKidProfile(null), false);
  assert.equal(isKidProfile(undefined), false);
});
