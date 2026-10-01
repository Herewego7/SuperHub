// Regression test for the 2026-08-20 profile-delete bug: deleting a profile
// could mis-delete an OPEN bonus chore ("everyone can claim it") shared with
// other still-active profiles, because filtering the deleted profile's id
// out of an already-empty profileIds array is still empty, which the old
// inline code mistook for "now orphaned, delete it." See
// src/lib/profileCleanup.ts for the full writeup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideProfileIdCleanup } from "../src/lib/profileCleanup";

test("open/shared item (empty profileIds) is left untouched — the actual bug", () => {
  assert.deepEqual(decideProfileIdCleanup([], "test-profile"), { action: "skip" });
});

test("chore solely assigned to the deleted profile is deleted", () => {
  assert.deepEqual(decideProfileIdCleanup(["test-profile"], "test-profile"), { action: "delete" });
});

test("chore shared with another profile just drops the deleted profile", () => {
  assert.deepEqual(
    decideProfileIdCleanup(["test-profile", "mom"], "test-profile"),
    { action: "update", profileIds: ["mom"] },
  );
});

test("chore assigned only to other profiles is left untouched", () => {
  assert.deepEqual(decideProfileIdCleanup(["mom", "dad"], "test-profile"), { action: "skip" });
});

test("null profileIds is treated as empty and left untouched", () => {
  assert.deepEqual(decideProfileIdCleanup(null, "test-profile"), { action: "skip" });
});

test("undefined profileIds is treated as empty and left untouched", () => {
  assert.deepEqual(decideProfileIdCleanup(undefined, "test-profile"), { action: "skip" });
});

test("removing the last of several assignees still deletes (not left dangling)", () => {
  assert.deepEqual(
    decideProfileIdCleanup(["only-one-left"], "only-one-left"),
    { action: "delete" },
  );
});
