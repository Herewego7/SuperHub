// Regression coverage for computeStreak (lib/streak.ts) — most notably the
// 2026-08-10 bug where the morning after a skip day (before that day's own
// chores were done) incorrectly reported streak: 0 instead of continuing
// through to the last real completed day before the skip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStreak, previousDayKey, isoWeekKeyFromDateKey, calendarDayDiff } from "../src/lib/streak";

const TZ = "America/Chicago";

// A "now" that resolves to the given yyyy-mm-dd in America/Chicago, at a
// fixed mid-morning time so DST-boundary noon math never bites.
function nowFor(dateKey: string): Date {
  return new Date(`${dateKey}T15:00:00.000Z`);
}

test("no completions at all → streak 0", () => {
  const r = computeStreak(new Set(), new Set(), TZ, [], nowFor("2026-08-10"));
  assert.equal(r.streak, 0);
});

test("completed today only → streak 1", () => {
  const r = computeStreak(new Set(["2026-08-10"]), new Set(), TZ, [], nowFor("2026-08-10"));
  assert.equal(r.streak, 1);
});

test("completed yesterday, not yet today (morning) → streak still counts yesterday", () => {
  const r = computeStreak(new Set(["2026-08-09"]), new Set(), TZ, [], nowFor("2026-08-10"));
  assert.equal(r.streak, 1);
});

test("3-day build-up, completed every day including today → streak 3", () => {
  const r = computeStreak(new Set(["2026-08-08", "2026-08-09", "2026-08-10"]), new Set(), TZ, [], nowFor("2026-08-10"));
  assert.equal(r.streak, 3);
});

test("missed a real (non-skip) day → streak breaks to 0", () => {
  // 2026-08-07 is a Friday. Only Friday was completed; neither Monday
  // (08-10, "today") nor Sunday (08-09, "the day before") is covered, and
  // neither is a skip day, so the streak is genuinely broken.
  const r = computeStreak(new Set(["2026-08-07"]), new Set(), TZ, [], nowFor("2026-08-10"));
  assert.equal(r.streak, 0, "a genuine gap (Sat/Sun not skipped, not completed) must break the streak");
});

// ── The exact regression: Sunday is a skip day ──────────────────────────────
// 2026-08-09 is a Sunday. Truitt completed Saturday (08-08), correctly
// skipped Sunday (08-09, a skip day), and it's now Monday morning (08-10)
// before he's done Monday's chores yet.
test("skip-day bridge: Sat completed, Sun skipped (skip day), Monday morning before chores → streak continues from Saturday", () => {
  const r = computeStreak(new Set(["2026-08-08"]), new Set(), TZ, [0 /* Sunday */], nowFor("2026-08-10"));
  assert.equal(r.streak, 1, "should still show a live streak from Saturday, not reset to 0");
});

test("skip-day bridge: completing Monday afterward brings the streak to 2", () => {
  const r = computeStreak(new Set(["2026-08-08", "2026-08-10"]), new Set(), TZ, [0], nowFor("2026-08-10"));
  assert.equal(r.streak, 2);
});

test("skip-day bridge: a genuinely missed Monday (checked from Tuesday) still breaks the streak", () => {
  // Sat completed, Sun skip day, Monday NOT completed, now it's Tuesday.
  const r = computeStreak(new Set(["2026-08-08"]), new Set(), TZ, [0], nowFor("2026-08-11"));
  assert.equal(r.streak, 0, "skip-day bridging must not let a real missed day slide by unnoticed");
});

test("multi-week build-up through several Sundays", () => {
  const completions = new Set([
    "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", // Mon-Fri wk1
    // 2026-08-01 Sat, 2026-08-02 Sun (skip) both skipped over
    "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", // Mon-Fri wk2
    // 08-08 Sat, 08-09 Sun (skip) skipped
    "2026-08-10", // Mon wk3
  ]);
  const r = computeStreak(completions, new Set(), TZ, [0, 6 /* Sat+Sun both off */], nowFor("2026-08-10"));
  assert.equal(r.streak, 11, "should count every weekday across 3 weeks with weekends bridged");
});

test("a used freeze bridges a single missing day and is reported", () => {
  // Completed Fri and Sun, froze Saturday (no completion that day).
  const r = computeStreak(
    new Set(["2026-08-07", "2026-08-09"]),
    new Set(["2026-08-08"]),
    TZ, [], nowFor("2026-08-09"),
  );
  assert.equal(r.streak, 3);
  assert.deepEqual(r.frozenDatesUsed, ["2026-08-08"]);
});

test("previousDayKey rolls over month/year boundaries correctly", () => {
  assert.equal(previousDayKey("2026-03-01"), "2026-02-28");
  assert.equal(previousDayKey("2026-01-01"), "2025-12-31");
  assert.equal(previousDayKey("2028-03-01"), "2028-02-29", "2028 is a leap year");
});

test("isoWeekKeyFromDateKey resolves to that week's Monday", () => {
  // 2026-08-10 is a Monday.
  assert.equal(isoWeekKeyFromDateKey("2026-08-10"), "2026-08-10");
  // 2026-08-16 is a Sunday, same ISO week as the above Monday.
  assert.equal(isoWeekKeyFromDateKey("2026-08-16"), "2026-08-10");
});

test("calendarDayDiff counts whole calendar days regardless of time-of-day", () => {
  assert.equal(calendarDayDiff("2026-08-10", "2026-08-08"), 2);
  assert.equal(calendarDayDiff("2026-08-08", "2026-08-10"), -2);
  assert.equal(calendarDayDiff("2026-08-10", "2026-08-10"), 0);
});
