// Regression tests for lib/choreToday.ts — this file backs the Daily Brief
// and bedtime-reminder push notifications, and has been the site of THREE
// separate real bugs this session:
//   1. isChoreDueOn treated an empty daysOfWeek as "due every day," wildly
//      inflating chore counts (to-dos and never-scheduled chores counted
//      as due forever). Fixed 2026-08-20.
//   2. splitRemaining silently folded Inspiration items (affirmation/verse/
//      mission) into the plain "chores" bucket, since they have no
//      targetCount and aren't excluded like to-dos/bonus chores are. Fixed
//      2026-08-22.
//   3. Target-count chores were double-counted as "remaining" past their
//      target because getTodayChoresForProfile's completion check didn't
//      account for the chore's own period window. (getTodayChoresForProfile
//      itself needs a live DB to test — see the note below — but the pure
//      isChoreDueOn/splitRemaining/describeRemaining pieces are fully
//      covered here.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { isChoreDueOn, splitRemaining, describeRemaining } from "../src/lib/choreToday";

const BASE = {
  isActive: true,
  profileIds: ["p1"],
  daysOfWeek: [] as number[],
  endDate: null as Date | null,
  taskType: "chore",
  isBonus: false,
  targetCount: null as number | null,
  recurrenceType: null as string | null,
};

// A Sunday, for day-of-week matching.
const SUNDAY = new Date("2026-08-23T18:00:00Z");
const TZ = "America/Chicago";

test("isChoreDueOn: a to-do is never due, even one that would otherwise clearly be due", () => {
  // recurrenceType: "daily" alone would make ANY regular chore due — this
  // isolates the to-do-specific exclusion from the separate "empty days"
  // guard (a to-do with empty daysOfWeek would trivially be "not due"
  // either way, which wouldn't actually prove this exclusion is in effect).
  assert.equal(isChoreDueOn({ ...BASE, taskType: "todo", recurrenceType: "daily" }, "p1", SUNDAY, TZ), false);
});

test("isChoreDueOn: a bonus chore is never due, even a daily one", () => {
  assert.equal(isChoreDueOn({ ...BASE, isBonus: true, recurrenceType: "daily" }, "p1", SUNDAY, TZ), false);
});

test("isChoreDueOn: empty daysOfWeek + not daily/target = NOT due (the inflated-count bug)", () => {
  assert.equal(isChoreDueOn({ ...BASE, daysOfWeek: [] }, "p1", SUNDAY, TZ), false);
});

test("isChoreDueOn: daily recurrence is always due", () => {
  assert.equal(isChoreDueOn({ ...BASE, recurrenceType: "daily" }, "p1", SUNDAY, TZ), true);
});

test("isChoreDueOn: target-count chore is due every day of its period", () => {
  assert.equal(isChoreDueOn({ ...BASE, targetCount: 3 }, "p1", SUNDAY, TZ), true);
});

test("isChoreDueOn: matching day-of-week is due", () => {
  // SUNDAY is a Sunday (day 0)
  assert.equal(isChoreDueOn({ ...BASE, daysOfWeek: [0] }, "p1", SUNDAY, TZ), true);
});

test("isChoreDueOn: non-matching day-of-week is not due", () => {
  assert.equal(isChoreDueOn({ ...BASE, daysOfWeek: [1, 2, 3, 4, 5] }, "p1", SUNDAY, TZ), false);
});

test("isChoreDueOn: not assigned to this profile is not due", () => {
  assert.equal(isChoreDueOn({ ...BASE, profileIds: ["someone-else"], daysOfWeek: [0] }, "p1", SUNDAY, TZ), false);
});

test("isChoreDueOn: inactive chore is never due", () => {
  assert.equal(isChoreDueOn({ ...BASE, isActive: false, daysOfWeek: [0] }, "p1", SUNDAY, TZ), false);
});

test("isChoreDueOn: past end date is not due", () => {
  assert.equal(
    isChoreDueOn({ ...BASE, daysOfWeek: [0], endDate: new Date("2020-01-01T00:00:00Z") }, "p1", SUNDAY, TZ),
    false,
  );
});

// ---- splitRemaining / describeRemaining ----

test("splitRemaining: distinguishes regular / target / inspiration (the mislabeling bug)", () => {
  const due = [
    { id: "c1", targetCount: 0, taskType: "chore" },
    { id: "c2", targetCount: 3, taskType: "chore" },
    { id: "c3", targetCount: 0, taskType: "affirmation" },
    { id: "c4", targetCount: 0, taskType: "mission" },
  ];
  const result = splitRemaining(due, new Set(["c4"])); // c4 already completed
  assert.deepEqual(result, { regular: 1, target: 1, inspiration: 1 });
});

test("splitRemaining: the exact reported scenario — only an incomplete affirmation", () => {
  const due = [{ id: "a1", targetCount: 0, taskType: "affirmation" }];
  const result = splitRemaining(due, new Set());
  assert.deepEqual(result, { regular: 0, target: 0, inspiration: 1 });
  assert.equal(describeRemaining(result.regular, result.target, result.inspiration), "1 inspiration");
});

test("describeRemaining: joins all three non-zero buckets", () => {
  assert.equal(describeRemaining(2, 1, 1), "2 chores, 1 target, 1 inspiration");
});

test("describeRemaining: singular vs. plural", () => {
  assert.equal(describeRemaining(1, 1, 1), "1 chore, 1 target, 1 inspiration");
});

test("describeRemaining: nothing remaining is an empty string", () => {
  assert.equal(describeRemaining(0, 0, 0), "");
});

// NOTE: getTodayChoresForProfile itself (the function that queries chores +
// chore_completions and applies the period-window logic for target-count
// chores) requires a live database and is NOT covered here — it's exercised
// indirectly by the scheduler/bedtimeReminders.ts and lib/dailyBrief.ts
// integration paths, which need a real Postgres instance to test properly.
// Once a staging database is available, add a live-DB test suite that seeds
// a target-count chore completed earlier in the week and confirms it's
// correctly excluded from "remaining."
