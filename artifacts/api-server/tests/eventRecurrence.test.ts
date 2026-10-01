// Regression coverage for lib/eventRecurrence.ts — monthly day-of-month
// overflow, annual leap-year clamping (both 2026-08-06), and the inclusive
// "Until" date handling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandRecurringEvents, resolveSeriesEventId } from "../src/lib/eventRecurrence";
import type { Event } from "@workspace/db";

function baseEvent(partial: Partial<Event>): Event {
  return {
    id: "evt1", userId: "u1", title: "Test event",
    startTime: new Date("2026-01-31T15:00:00.000Z"),
    endTime: new Date("2026-01-31T16:00:00.000Z"),
    isAllDay: false, description: null, location: null,
    profileIds: [], recurrenceType: null, recurrenceEndDate: null,
    createdAt: new Date(),
    ...partial,
  } as Event;
}

test("non-recurring event: no occurrences added", () => {
  const out = expandRecurringEvents([baseEvent({ recurrenceType: null })], new Date("2026-02-01"));
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, "evt1");
});

test("monthly recurrence on the 31st clamps to each month's real last day (no overflow into the next month)", () => {
  const out = expandRecurringEvents(
    [baseEvent({ recurrenceType: "monthly", recurrenceEndDate: new Date("2026-04-30") })],
    new Date("2026-01-01"),
  );
  const months = out.map((e) => new Date(e.startTime).getUTCMonth());
  const days = out.map((e) => new Date(e.startTime).getUTCDate());
  // Jan 31 -> Feb 28 (2026 not a leap year) -> Mar 31 -> Apr 30, never
  // spilling forward to the 1st/2nd/3rd of the following month.
  assert.deepEqual(months, [0, 1, 2, 3]);
  assert.deepEqual(days, [31, 28, 31, 30]);
});

test("annual recurrence on Feb 29 lands on Feb 28 in non-leap target years, Feb 29 in leap ones", () => {
  const leapDay = baseEvent({
    startTime: new Date("2024-02-29T12:00:00.000Z"),
    endTime: new Date("2024-02-29T13:00:00.000Z"),
    recurrenceType: "annually",
    recurrenceEndDate: new Date("2029-01-01"),
  });
  const out = expandRecurringEvents([leapDay], new Date("2024-01-01"));
  const byYear = new Map(out.map((e) => [new Date(e.startTime).getUTCFullYear(), new Date(e.startTime).getUTCDate()]));
  assert.equal(byYear.get(2025), 28, "2025 is not a leap year");
  assert.equal(byYear.get(2026), 28);
  assert.equal(byYear.get(2027), 28);
  assert.equal(byYear.get(2028), 29, "2028 is a leap year");
});

test("annual recurrence with no explicit end date gets the wide 10-year default horizon, not the plain 1-year one", () => {
  const out = expandRecurringEvents(
    [baseEvent({
      startTime: new Date("2026-08-30T12:00:00.000Z"),
      endTime: new Date("2026-08-30T13:00:00.000Z"),
      recurrenceType: "annually", recurrenceEndDate: null,
    })],
    new Date("2026-01-01"),
  );
  // A 1-year-out horizon from Jan 1 2026 would contain zero future annual
  // occurrences past the original (next one is Aug 30 2027) — the fix
  // exists specifically so this isn't the case.
  assert.ok(out.length >= 2, "should include at least one real future annual occurrence");
});

test("'Until' date is inclusive of the whole day, not cut off at midnight", () => {
  const out = expandRecurringEvents(
    [baseEvent({
      startTime: new Date("2026-07-01T14:00:00.000Z"),
      endTime: new Date("2026-07-01T15:00:00.000Z"),
      recurrenceType: "daily",
      recurrenceEndDate: new Date("2026-07-03T00:00:00.000Z"),
    })],
    new Date("2026-07-01"),
  );
  const days = out.map((e) => new Date(e.startTime).getUTCDate());
  assert.deepEqual(days, [1, 2, 3], "the Jul 3 occurrence must not be dropped just because the end date is stored as midnight");
});

test("weekly recurrence steps in 7-day increments", () => {
  const out = expandRecurringEvents(
    [baseEvent({
      startTime: new Date("2026-08-03T14:00:00.000Z"),
      endTime: new Date("2026-08-03T15:00:00.000Z"),
      recurrenceType: "weekly",
      recurrenceEndDate: new Date("2026-08-24"),
    })],
    new Date("2026-08-01"),
  );
  const days = out.map((e) => new Date(e.startTime).getUTCDate());
  assert.deepEqual(days, [3, 10, 17, 24]);
});

test("expanded occurrences preserve the event's original duration", () => {
  const out = expandRecurringEvents(
    [baseEvent({
      startTime: new Date("2026-08-03T14:00:00.000Z"),
      endTime: new Date("2026-08-03T15:30:00.000Z"), // 90 minutes
      recurrenceType: "daily",
      recurrenceEndDate: new Date("2026-08-05"),
    })],
    new Date("2026-08-01"),
  );
  for (const occ of out) {
    const dur = new Date(occ.endTime).getTime() - new Date(occ.startTime).getTime();
    assert.equal(dur, 90 * 60 * 1000);
  }
});

test("expanded occurrence ids are synthetic and each carries seriesId", () => {
  const out = expandRecurringEvents(
    [baseEvent({ id: "real-id", recurrenceType: "daily", recurrenceEndDate: new Date("2026-02-02") })],
    new Date("2026-02-01"),
  );
  const occurrence = out.find((e) => e.isRecurringInstance);
  assert.ok(occurrence);
  assert.match(occurrence!.id, /^real-id::occ::\d+$/);
  assert.equal(occurrence!.seriesId, "real-id");
});

test("resolveSeriesEventId strips the synthetic occurrence suffix", () => {
  assert.equal(resolveSeriesEventId("real-id::occ::3"), "real-id");
  assert.equal(resolveSeriesEventId("plain-id"), "plain-id", "a non-occurrence id is returned unchanged");
});

// ── Weekly on chosen days, every N weeks, and detached occurrences ──────────
// Added 2026-09-12. Outlook's model: "Weekly, every N weeks, on these days"
// (FREQ=WEEKLY;INTERVAL=N;BYDAY=…), so Mon+Tue is ONE event, not two.

/** Local YYYY-MM-DD of each expanded occurrence, in order. */
function keys(out: { startTime: Date | string }[]): string[] {
  return out.map(o => {
    const d = new Date(o.startTime);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
}

// 2026-09-07 is a Monday, so 09-08 is the Tuesday of the same week.
const MON = new Date(2026, 8, 7, 9, 0, 0);
const MON_END = new Date(2026, 8, 7, 10, 0, 0);

test("weekly on Mon+Tue produces both days each week from one event", () => {
  const out = expandRecurringEvents([baseEvent({
    startTime: MON, endTime: MON_END,
    recurrenceType: "weekly", daysOfWeek: [1, 2],
    recurrenceEndDate: new Date(2026, 8, 21),
  })], new Date(2026, 8, 1));
  assert.deepEqual(keys(out), [
    "2026-09-07", "2026-09-08",
    "2026-09-14", "2026-09-15",
    "2026-09-21",
  ]);
});

test("the stored row is the first occurrence — earlier ticked days are not back-filled", () => {
  // Starts on TUESDAY but Mon+Tue are ticked. The Monday before it must not
  // appear: the row itself is occurrence one, and a series cannot start
  // before its own start.
  const tue = new Date(2026, 8, 8, 9, 0, 0);
  const out = expandRecurringEvents([baseEvent({
    startTime: tue, endTime: new Date(2026, 8, 8, 10, 0, 0),
    recurrenceType: "weekly", daysOfWeek: [1, 2],
    recurrenceEndDate: new Date(2026, 8, 15),
  })], new Date(2026, 8, 1));
  assert.deepEqual(keys(out), ["2026-09-08", "2026-09-14", "2026-09-15"]);
});

test("every 2 weeks on Mon+Tue skips the weeks in between without drifting", () => {
  const out = expandRecurringEvents([baseEvent({
    startTime: MON, endTime: MON_END,
    recurrenceType: "weekly", daysOfWeek: [1, 2], recurrenceInterval: 2,
    recurrenceEndDate: new Date(2026, 9, 6),
  })], new Date(2026, 8, 1));
  assert.deepEqual(keys(out), [
    "2026-09-07", "2026-09-08",
    "2026-09-21", "2026-09-22",
    "2026-10-05", "2026-10-06",
  ]);
});

test("every 3 days honours the interval", () => {
  const out = expandRecurringEvents([baseEvent({
    startTime: MON, endTime: MON_END,
    recurrenceType: "daily", recurrenceInterval: 3,
    recurrenceEndDate: new Date(2026, 8, 16),
  })], new Date(2026, 8, 1));
  assert.deepEqual(keys(out), ["2026-09-07", "2026-09-10", "2026-09-13", "2026-09-16"]);
});

test("weekly with no days ticked behaves exactly as it did before", () => {
  // Every existing weekly event has no daysOfWeek, and must keep landing on
  // its own weekday.
  const out = expandRecurringEvents([baseEvent({
    startTime: MON, endTime: MON_END,
    recurrenceType: "weekly",
    recurrenceEndDate: new Date(2026, 8, 28),
  })], new Date(2026, 8, 1));
  assert.deepEqual(keys(out), ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
});

test("a null recurrenceInterval (every row predating the column) means every 1", () => {
  const out = expandRecurringEvents([baseEvent({
    startTime: MON, endTime: MON_END,
    recurrenceType: "weekly", recurrenceInterval: null,
    recurrenceEndDate: new Date(2026, 8, 21),
  })], new Date(2026, 8, 1));
  assert.deepEqual(keys(out), ["2026-09-07", "2026-09-14", "2026-09-21"]);
});

test("an excluded date is skipped — that occurrence was detached", () => {
  const out = expandRecurringEvents([baseEvent({
    startTime: MON, endTime: MON_END,
    recurrenceType: "weekly",
    excludedDates: ["2026-09-14"],
    recurrenceEndDate: new Date(2026, 8, 28),
  })], new Date(2026, 8, 1));
  assert.deepEqual(keys(out), ["2026-09-07", "2026-09-21", "2026-09-28"]);
});

test("an occurrence keeps the event's duration on every ticked day", () => {
  const out = expandRecurringEvents([baseEvent({
    startTime: MON, endTime: new Date(2026, 8, 7, 10, 30, 0),
    recurrenceType: "weekly", daysOfWeek: [1, 2],
    recurrenceEndDate: new Date(2026, 8, 8),
  })], new Date(2026, 8, 1));
  const tue = out[1]!;
  assert.equal(new Date(tue.endTime).getTime() - new Date(tue.startTime).getTime(), 90 * 60 * 1000);
  assert.equal(new Date(tue.startTime).getHours(), 9);
});

test("excluding the FIRST occurrence detaches it too — the stored row is occurrence one", () => {
  const out = expandRecurringEvents([baseEvent({
    startTime: MON, endTime: MON_END,
    recurrenceType: "weekly",
    excludedDates: ["2026-09-07"],
    recurrenceEndDate: new Date(2026, 8, 21),
  })], new Date(2026, 8, 1));
  assert.deepEqual(keys(out), ["2026-09-14", "2026-09-21"]);
});

test("a plain event is never hidden by a stray exclusion", () => {
  const out = expandRecurringEvents([baseEvent({
    startTime: MON, endTime: MON_END,
    recurrenceType: null,
    excludedDates: ["2026-09-07"],
  })], new Date(2026, 8, 1));
  assert.deepEqual(keys(out), ["2026-09-07"]);
});
