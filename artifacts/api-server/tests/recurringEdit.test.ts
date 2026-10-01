// "This event", "this and all following", or the whole series — the split
// arithmetic behind editing one occurrence of a repeating event (2026-09-12).
import { test } from "node:test";
import assert from "node:assert/strict";
import { planRecurringEdit, planRecurringDelete } from "../src/lib/recurringEdit";
import { expandRecurringEvents } from "../src/lib/eventRecurrence";
import type { Event } from "@workspace/db";

// Mondays at 9am, weekly, no end date.
const MON = new Date(2026, 8, 7, 9, 0, 0);
function series(partial: Partial<Event> = {}): Event {
  return {
    id: "s1", userId: "u1", title: "Swim practice",
    startTime: MON, endTime: new Date(2026, 8, 7, 10, 0, 0),
    isAllDay: false, description: null, location: null,
    profileIds: ["p1"], recurrenceType: "weekly", recurrenceEndDate: null,
    recurrenceInterval: 1, daysOfWeek: null, excludedDates: null,
    createdAt: new Date(),
    ...partial,
  } as Event;
}

const SECOND = new Date(2026, 8, 14, 9, 0, 0); // the following Monday

test("scope 'series' just patches the series and creates nothing", () => {
  const plan = planRecurringEdit(series(), "series", SECOND, { title: "Swim" });
  assert.deepEqual(plan.seriesPatch, { title: "Swim" });
  assert.equal(plan.newEvent, null);
});

test("a non-repeating event is always a plain edit, whatever scope is asked for", () => {
  const plan = planRecurringEdit(series({ recurrenceType: null }), "occurrence", MON, { title: "x" });
  assert.equal(plan.newEvent, null);
});

test("'future' from the FIRST occurrence is a series edit, not a pointless split", () => {
  const plan = planRecurringEdit(series(), "future", MON, { title: "x" });
  assert.equal(plan.newEvent, null, "splitting at the first occurrence would leave an empty series behind");
});

test("'occurrence' excludes that date and leaves a standalone event in its place", () => {
  const moved = new Date(2026, 8, 14, 11, 0, 0);
  const plan = planRecurringEdit(series(), "occurrence", SECOND, {
    startTime: moved, endTime: new Date(2026, 8, 14, 12, 0, 0),
  });
  assert.deepEqual(plan.seriesPatch, { excludedDates: ["2026-09-14"] });
  assert.equal(plan.newEvent?.recurrenceType, null, "the detached copy must not repeat");
  assert.equal((plan.newEvent?.startTime as Date).getHours(), 11);
  assert.equal(plan.newEvent?.title, "Swim practice", "it keeps everything it wasn't asked to change");
});

test("'occurrence' keeps exclusions that were already there", () => {
  const plan = planRecurringEdit(series({ excludedDates: ["2026-09-21"] }), "occurrence", SECOND, {});
  assert.deepEqual(plan.seriesPatch.excludedDates, ["2026-09-21", "2026-09-14"]);
});

test("'future' ends the old series the day BEFORE the occurrence", () => {
  const plan = planRecurringEdit(series(), "future", SECOND, { title: "Swim team" });
  const end = plan.seriesPatch.recurrenceEndDate as Date;
  assert.equal(end.getFullYear(), 2026);
  assert.equal(end.getMonth(), 8);
  assert.equal(end.getDate(), 13, "13 Sep — the day before the 14th, so the 7th still happens and the 14th does not");
});

test("'future' starts a new series carrying the same rule", () => {
  const plan = planRecurringEdit(series({ recurrenceInterval: 2, daysOfWeek: [1, 3] }), "future", SECOND, {});
  assert.equal(plan.newEvent?.recurrenceType, "weekly");
  assert.equal(plan.newEvent?.recurrenceInterval, 2);
  assert.deepEqual(plan.newEvent?.daysOfWeek, [1, 3]);
});

test("'future' leaves exceptions on the side of the split they belong to", () => {
  const plan = planRecurringEdit(
    series({ excludedDates: ["2026-09-07", "2026-09-21"] }), "future", SECOND, {},
  );
  assert.deepEqual(plan.newEvent?.excludedDates, ["2026-09-21"], "only the tail's exceptions move");
});

// The arithmetic above is only correct if the two halves actually tile the
// original series — no duplicated week at the seam, none missing.
test("after a 'future' split the two series together cover every original date", () => {
  const original = series({ recurrenceEndDate: new Date(2026, 8, 28) });
  const before = expandRecurringEvents([original], new Date(2026, 8, 1))
    .map(o => new Date(o.startTime).getTime()).sort();

  const plan = planRecurringEdit(original, "future", SECOND, {});
  const head = { ...original, ...plan.seriesPatch } as Event;
  const tail = { ...(plan.newEvent as any), id: "s2", createdAt: new Date() } as Event;
  const after = expandRecurringEvents([head, tail], new Date(2026, 8, 1))
    .map(o => new Date(o.startTime).getTime()).sort();

  assert.deepEqual(after, before, "the split changed which days the series falls on");
});

// ── Deleting one occurrence (2026-09-13) ───────────────────────────────────

test("delete 'series' removes the row outright", () => {
  assert.equal(planRecurringDelete(series(), "series", SECOND), null);
});

test("delete 'future' from the FIRST occurrence removes the row outright", () => {
  assert.equal(planRecurringDelete(series(), "future", MON), null);
});

test("delete 'occurrence' just excludes that date", () => {
  assert.deepEqual(planRecurringDelete(series(), "occurrence", SECOND), { excludedDates: ["2026-09-14"] });
});

test("delete 'future' ends the series the day before, and drops exceptions past it", () => {
  const plan = planRecurringDelete(
    series({ excludedDates: ["2026-09-07", "2026-09-21"] }), "future", SECOND,
  )!;
  const end = plan.recurrenceEndDate as Date;
  assert.equal(end.getDate(), 13, "13 Sep — the 7th survives, the 14th does not");
  assert.deepEqual(plan.excludedDates, ["2026-09-07"], "exceptions past the new end are dead weight");
});

test("deleting one occurrence leaves every other date untouched", () => {
  const original = series({ recurrenceEndDate: new Date(2026, 8, 28) });
  const before = expandRecurringEvents([original], new Date(2026, 8, 1))
    .map(o => new Date(o.startTime).getTime());
  const patched = { ...original, ...planRecurringDelete(original, "occurrence", SECOND)! } as Event;
  const after = expandRecurringEvents([patched], new Date(2026, 8, 1))
    .map(o => new Date(o.startTime).getTime());
  assert.deepEqual(after, before.filter(t => t !== SECOND.getTime()), "exactly one date should be gone");
});
