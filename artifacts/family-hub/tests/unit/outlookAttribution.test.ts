import { test } from "node:test";
import assert from "node:assert/strict";
import { outlookEventProfileIds } from "../../src/lib/outlookAttribution.ts";

// 2026-09-30: an Outlook calendar's "Assign to:" setting was ignored, and every
// event went to whoever connected the account.
const assignments = [
  { calendarType: "outlook", calendarId: "cal-kids", profileId: "ava" },
  { calendarType: "google", calendarId: "cal-work", profileId: "mom" },
];

test("an Outlook event follows its calendar's Assign to", () => {
  assert.deepEqual(outlookEventProfileIds({ calendar: { id: "cal-kids" } }, "dad", assignments), ["ava"]);
});

test("an unassigned Outlook calendar stays with the person who connected it", () => {
  assert.deepEqual(outlookEventProfileIds({ calendar: { id: "cal-other" } }, "dad", assignments), ["dad"]);
  assert.deepEqual(outlookEventProfileIds({}, "dad", assignments), ["dad"]);
});

test("a Google assignment with the same calendar id is not used for Outlook", () => {
  assert.deepEqual(outlookEventProfileIds({ calendar: { id: "cal-work" } }, "dad", assignments), ["dad"]);
});

test("an assignment to a deleted person falls back to the connected person", () => {
  assert.deepEqual(
    outlookEventProfileIds({ calendar: { id: "cal-kids" } }, "dad", assignments, new Set(["dad", "mom"])),
    ["dad"],
  );
});
