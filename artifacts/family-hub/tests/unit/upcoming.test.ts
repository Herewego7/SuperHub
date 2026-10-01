import assert from "node:assert/strict";
import test from "node:test";
import { horizonEvents } from "../../src/lib/homeDay";
import { eventSourceChip, upcomingClock, upcomingKindForMail, upcomingRows } from "../../src/lib/upcoming";

test("horizon skips a weekly routine and keeps a one-off in the next week", () => {
  const today = new Date(2026, 9, 1);
  const rows = horizonEvents(
    [
      { id: "practice", title: "Practice", startTime: new Date(2026, 9, 3), recurrenceType: "weekly" },
      { id: "recital", title: "Recital", startTime: new Date(2026, 9, 6), recurrenceType: null },
    ],
    today,
  );
  assert.deepEqual(rows.map((row) => row.id), ["recital"]);
});

test("key dates hides timed events", () => {
  const today = new Date(2026, 9, 1);
  const rows = upcomingRows(
    [
      { id: "game", title: "Game", startTime: new Date(2026, 9, 4), isAllDay: false },
      { id: "picture", title: "Picture day", startTime: new Date(2026, 9, 8), isAllDay: true },
    ],
    "keyDates",
    today,
  );
  assert.deepEqual(rows.map((row) => row.id), ["picture"]);
});

test("the to-do chip keeps a to-do and hides a timed event", () => {
  const today = new Date(2026, 9, 1);
  const rows = upcomingRows(
    [
      { id: "slip", title: "Permission slip", startTime: today, kind: "todo" },
      { id: "game", title: "Game", startTime: new Date(2026, 9, 4), isAllDay: false },
    ],
    "todos",
    today,
  );
  assert.deepEqual(rows.map((row) => row.id), ["slip"]);
});

test("a school email is a newsletter and a plain to-do is not", () => {
  assert.equal(upcomingKindForMail("school_email"), "newsletter");
  assert.equal(upcomingKindForMail("school"), "newsletter");
  assert.equal(upcomingKindForMail("general"), "todo");
  const today = new Date(2026, 9, 1);
  const rows = upcomingRows(
    [
      { id: "slip", title: "Permission slip", startTime: today, kind: "newsletter" },
      { id: "game", title: "Game", startTime: new Date(2026, 9, 4), isAllDay: false },
    ],
    "newsletters",
    today,
  );
  assert.deepEqual(rows.map((row) => row.id), ["slip"]);
});

test("upcoming shows a clock on an event and not on a to-do", () => {
  assert.equal(upcomingClock({ startTime: new Date(2026, 9, 2, 16, 0), kind: "event" }), "4:00 PM");
  assert.equal(upcomingClock({ startTime: new Date(2026, 9, 2, 16, 0), kind: "todo" }), null);
  assert.equal(upcomingClock({ startTime: new Date(2026, 9, 2, 0, 0), kind: "event" }), null);
});

test("a scanned flyer is labeled Scan", () => {
  assert.equal(eventSourceChip("scan"), "Scan");
  assert.equal(eventSourceChip("meal"), null);
});
