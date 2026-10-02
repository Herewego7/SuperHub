import assert from "node:assert/strict";
import test from "node:test";
import { horizonEvents } from "../../src/lib/homeDay";
import { dropSchoolTodoTwins, eventSourceChip, schoolEventKind, upcomingClock, upcomingKindForMail, upcomingRows } from "../../src/lib/upcoming";

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

test("a timed school email is not also an undated newsletter row", () => {
  const kept = dropSchoolTodoTwins(
    [
      { id: "slip", title: "Picture day", category: "school_email" },
      { id: "milk", title: "Buy milk", category: null },
    ],
    [{ title: "Picture day", source: "school" }],
  );
  assert.deepEqual(kept.map((row) => row.id), ["milk"]);
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
  assert.equal(upcomingClock({ startTime: new Date(2026, 9, 1, 19, 0), kind: "event", isAllDay: true }), null);
});

test("a timed school event stays on the Events chip", () => {
  const today = new Date(2026, 9, 1);
  const rows = [
    { id: "game", title: "Soccer", startTime: new Date(2026, 9, 4, 15, 30), isAllDay: false, source: "school" as const },
    { id: "slip", title: "Picture day", startTime: new Date(2026, 9, 8), isAllDay: true, source: "school" as const },
  ].map((event) => {
    const kind = schoolEventKind(event);
    return kind ? { ...event, kind } : event;
  });
  assert.deepEqual(upcomingRows(rows, "events", today).map((row) => row.id), ["game"]);
  assert.deepEqual(upcomingRows(rows, "newsletters", today).map((row) => row.id), ["slip"]);
});

test("a scanned flyer is labeled Scan", () => {
  assert.equal(eventSourceChip("scan"), "Scan");
  assert.equal(eventSourceChip("meal"), null);
});
