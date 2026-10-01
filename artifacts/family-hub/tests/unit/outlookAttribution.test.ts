import { test } from "node:test";
import assert from "node:assert/strict";
import { outlookEventProfileIds, withoutUnwatched } from "../../src/lib/outlookAttribution.ts";

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

test("who it's for replaces the single assignee", () => {
  const scoped = [{ calendarType: "google", calendarId: "school", profileId: "dad", audienceProfileIds: ["liam"] }];
  assert.deepEqual(outlookEventProfileIds({ calendar: { id: "school" } }, "dad", scoped.map((row) => ({ ...row, calendarType: "outlook" }))), ["liam"]);
});

test("an unwatched calendar leaves Home", () => {
  const events = [
    { title: "Practice", googleCalendarId: "school" },
    { title: "Dinner", googleCalendarId: null },
  ];
  const kept = withoutUnwatched(events, [{ calendarId: "school", watched: false, isActive: true }]);
  assert.deepEqual(kept.map((event) => event.title), ["Dinner"]);
});

test("an assignment to a deleted person falls back to the connected person", () => {
  assert.deepEqual(
    outlookEventProfileIds({ calendar: { id: "cal-kids" } }, "dad", assignments, new Set(["dad", "mom"])),
    ["dad"],
  );
});
