import assert from "node:assert/strict";
import test from "node:test";
import { horizonEvents } from "../../src/lib/homeDay";
import { eventSourceChip, upcomingRows } from "../../src/lib/upcoming";

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

test("a scanned flyer is labeled Scan", () => {
  assert.equal(eventSourceChip("scan"), "Scan");
  assert.equal(eventSourceChip("meal"), null);
});
