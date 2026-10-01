// Regression coverage for lib/celebrations.ts — the shared "next occurrence
// / days until / age this year" math used by both the /api/celebrations
// routes and the 30/7-day push scheduler.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidMonthDay, resolveOccurrence, nextOccurrence, celebrationsWithMeta } from "../src/lib/celebrations";
import type { Celebration } from "@workspace/db";

// These cases build `from` with `new Date(y, m, d)` — i.e. midnight in the
// MACHINE's own zone — and assert against that same calendar day. Now that
// celebrationsWithMeta resolves "today" in the family's timezone (default
// America/Chicago), they have to say which zone their fixture dates are in, or
// midnight UTC would be read as the previous evening in Chicago and every
// expectation would shift by a day. Passing the machine's own zone keeps each
// test asserting exactly what it always did, on any machine.
const SERVER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

test("isValidMonthDay accepts real dates and rejects nonsense", () => {
  assert.equal(isValidMonthDay("08-30"), true);
  assert.equal(isValidMonthDay("02-29"), true, "Feb 29 is valid in the leap-year probe year");
  assert.equal(isValidMonthDay("04-31"), false, "April has no 31st");
  assert.equal(isValidMonthDay("02-30"), false, "February never has a 30th");
  assert.equal(isValidMonthDay("13-01"), false);
  assert.equal(isValidMonthDay("00-15"), false);
  assert.equal(isValidMonthDay("bogus"), false);
});

test("resolveOccurrence falls back Feb 29 → Feb 28 in a non-leap year", () => {
  const leap = resolveOccurrence(2028, "02-29");
  assert.equal(leap!.getMonth(), 1);
  assert.equal(leap!.getDate(), 29);

  const nonLeap = resolveOccurrence(2026, "02-29");
  assert.equal(nonLeap!.getMonth(), 1);
  assert.equal(nonLeap!.getDate(), 28, "should observe on Feb 28 in a non-leap year");
});

test("resolveOccurrence returns null for an invalid month-day", () => {
  assert.equal(resolveOccurrence(2026, "04-31"), null);
});

test("nextOccurrence stays this year when the date hasn't passed yet", () => {
  const from = new Date(2026, 6, 1); // July 1
  const next = nextOccurrence("08-30", from);
  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 7);
  assert.equal(next.getDate(), 30);
});

test("nextOccurrence rolls to next year once the date has already passed", () => {
  const from = new Date(2026, 8, 1); // Sept 1 — Aug 30 already passed
  const next = nextOccurrence("08-30", from);
  assert.equal(next.getFullYear(), 2027);
});

test("nextOccurrence on the exact day itself resolves to today, not next year", () => {
  const from = new Date(2026, 7, 30); // Aug 30
  const next = nextOccurrence("08-30", from);
  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getDate(), 30);
});

function celebration(partial: Partial<Celebration>): Celebration {
  return {
    id: "c1", userId: "u1", name: "Ava", monthDay: "08-30", year: 2015,
    type: "birthday", customLabel: null, profileId: null, profileIds: null,
    notes: null, showYear: true, createdAt: new Date(),
    reminder30SentYear: null, reminder7SentYear: null,
    ...partial,
  } as Celebration;
}

// This is the exact scenario from the 2026-07-19 wording fix: an
// anniversary that already passed this calendar year rolls to NEXT year's
// occurrence, so the milestone number must be phrased against that rolled
// year, not the current one — daysUntil/ageThisYear must agree with the
// actual displayed nextOccurrence, never silently disagree by one.
test("celebrationsWithMeta: a passed anniversary rolls forward and ageThisYear matches the rolled year", () => {
  const from = new Date(2026, 6, 19); // July 19 2026 — May 26 already passed this year
  const rows = celebrationsWithMeta(
    [celebration({ monthDay: "05-26", year: 2013, type: "anniversary" })],
    from,
    SERVER_TZ,
  );
  const c = rows[0]!;
  assert.equal(new Date(c.nextOccurrence).getFullYear(), 2027);
  assert.equal(c.ageThisYear, 14, "the 14th anniversary, matching the May 26 2027 occurrence");
  assert.ok(c.daysUntil > 300, "should be far out, not 'today'");
});

test("celebrationsWithMeta: an upcoming-this-year anniversary keeps this year's count", () => {
  const from = new Date(2026, 6, 19); // July 19 2026 — Dec 26 hasn't happened yet
  const rows = celebrationsWithMeta(
    [celebration({ monthDay: "12-26", year: 2013, type: "anniversary" })],
    from,
    SERVER_TZ,
  );
  const c = rows[0]!;
  assert.equal(new Date(c.nextOccurrence).getFullYear(), 2026);
  assert.equal(c.ageThisYear, 13);
});

test("celebrationsWithMeta: a birthday today has daysUntil 0", () => {
  const from = new Date(2026, 7, 30, 14, 30); // Aug 30 2026, mid-afternoon
  const rows = celebrationsWithMeta([celebration({ monthDay: "08-30", year: 2008 })], from, SERVER_TZ);
  assert.equal(rows[0]!.daysUntil, 0);
  assert.equal(rows[0]!.ageThisYear, 18);
});

test("celebrationsWithMeta: a birthday exactly a week out has daysUntil 7", () => {
  const from = new Date(2026, 7, 23); // Aug 23
  const rows = celebrationsWithMeta([celebration({ monthDay: "08-30", year: 2008 })], from, SERVER_TZ);
  assert.equal(rows[0]!.daysUntil, 7);
});

test("celebrationsWithMeta: no birth year → ageThisYear is null, not a wrong number", () => {
  const from = new Date(2026, 6, 1);
  const rows = celebrationsWithMeta([celebration({ monthDay: "08-30", year: null })], from, SERVER_TZ);
  assert.equal(rows[0]!.ageThisYear, null);
});

// ---------------------------------------------------------------------------
// Regression: "today" was whatever calendar day it was on the SERVER, which is
// UTC on Replit. From ~7pm Central onward UTC has already rolled over, so every
// celebration reported itself a day closer than it was — on the evening of
// Sep 9 a birthday on Sep 11 showed as "Tomorrow" while the app's own date
// header (computed in the browser, correctly local) still read Sep 9. The same
// function backs the 30/7-day push reminders, so those fired a day early too
// (2026-09-10).
// ---------------------------------------------------------------------------
test("celebrationsWithMeta: an evening in Chicago is still the same local day", () => {
  // 2026-09-10T02:30Z — i.e. 9:30pm on Sep 9 in Chicago. UTC has rolled over
  // to the 10th; the family has not.
  const from = new Date("2026-09-10T02:30:00Z");
  const rows = celebrationsWithMeta(
    [celebration({ monthDay: "09-11", year: 1990 })],
    from,
    "America/Chicago",
  );
  assert.equal(
    rows[0]!.daysUntil, 2,
    "a Sep 11 birthday is two days from Sep 9 — reading the server's UTC date " +
      "instead of the family's makes it claim 'Tomorrow' all evening",
  );
});

test("celebrationsWithMeta: the same instant IS tomorrow for a family already on the 10th", () => {
  const from = new Date("2026-09-10T02:30:00Z"); // already 3:30am Sep 10 in London
  const rows = celebrationsWithMeta(
    [celebration({ monthDay: "09-11", year: 1990 })],
    from,
    "Europe/London",
  );
  assert.equal(rows[0]!.daysUntil, 1);
});

test("celebrationsWithMeta: a birthday today is 0 late at night, not -1 or 1", () => {
  const from = new Date("2026-09-11T04:45:00Z"); // 11:45pm Sep 10 in Chicago
  const rows = celebrationsWithMeta(
    [celebration({ monthDay: "09-11", year: 1990 })],
    from,
    "America/Chicago",
  );
  assert.equal(rows[0]!.daysUntil, 1, "Sep 11 is still tomorrow at 11:45pm on Sep 10");
});
