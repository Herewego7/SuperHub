// Regression coverage for lib/choreSchedule.ts — most notably the real bug
// where people-view.tsx's own copy checked "monthly" recurrence against
// day-of-MONTH instead of day-of-week like every other check in the app
// (fixed by unifying on this shared module, 2026-07-05).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isChoreScheduledForDate, isFutureDate, getPeriodProgress } from "../../src/lib/choreSchedule";
import type { Chore, ChoreCompletion } from "@workspace/shared-types";

function chore(partial: Partial<Chore>): Chore {
  return {
    id: "c1", userId: "u1", title: "Test chore", icon: "✅", points: 1,
    isActive: true, isBonus: false, targetCount: 0, taskType: "chore",
    daysOfWeek: [], recurrenceType: null, endDate: null,
    profileIds: ["p1"], displayOrder: 0, description: null,
    createdAt: new Date(),
    ...partial,
  } as Chore;
}

test("inactive chore is never scheduled", () => {
  const c = chore({ isActive: false, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
  assert.equal(isChoreScheduledForDate(c, new Date(2026, 7, 10)), false);
});

test("target-count chore is due every day regardless of daysOfWeek", () => {
  const c = chore({ targetCount: 3, daysOfWeek: [] });
  // Aug 10 2026 is a Monday.
  assert.equal(isChoreScheduledForDate(c, new Date(2026, 7, 10)), true);
  assert.equal(isChoreScheduledForDate(c, new Date(2026, 7, 11)), true);
});

test("daily recurrence is due every day regardless of daysOfWeek", () => {
  const c = chore({ recurrenceType: "daily", daysOfWeek: [] });
  assert.equal(isChoreScheduledForDate(c, new Date(2026, 7, 10)), true);
});

// The exact regression: a "monthly" chore must check day-of-WEEK (matching
// weekly's own semantics), never day-of-MONTH.
test("monthly recurrence checks day-of-week, not day-of-month", () => {
  // Aug 10 2026 is a Monday (dow 1). daysOfWeek: [1] means "every Monday."
  const c = chore({ recurrenceType: "monthly", daysOfWeek: [1] });
  assert.equal(isChoreScheduledForDate(c, new Date(2026, 7, 10)), true, "Monday should match dow 1");
  // Aug 11 2026 is a Tuesday — should NOT match, even though its day-of-month
  // (11) has nothing to do with daysOfWeek([1]) either way; the key
  // assertion is that dow-1-Tuesday(2) is excluded, proving this isn't
  // secretly keying off date-of-month at all.
  assert.equal(isChoreScheduledForDate(c, new Date(2026, 7, 11)), false, "Tuesday should not match dow 1");
});

test("weekly recurrence respects daysOfWeek", () => {
  const c = chore({ recurrenceType: "weekly", daysOfWeek: [3] }); // Wednesday
  assert.equal(isChoreScheduledForDate(c, new Date(2026, 7, 12)), true); // Aug 12 2026 is a Wednesday
  assert.equal(isChoreScheduledForDate(c, new Date(2026, 7, 13)), false);
});

test("an endDate in the past excludes the chore", () => {
  const c = chore({ recurrenceType: "daily", endDate: new Date(2026, 6, 1) });
  assert.equal(isChoreScheduledForDate(c, new Date(2026, 7, 10)), false);
});

test("isFutureDate compares calendar days only, ignoring time-of-day", () => {
  const now = new Date();
  const todayLateNight = new Date(now);
  todayLateNight.setHours(23, 59, 59, 999);
  assert.equal(isFutureDate(todayLateNight), false, "later today is not 'future'");

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  assert.equal(isFutureDate(tomorrow), true);

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  assert.equal(isFutureDate(yesterday), false);
});

function completion(partial: Partial<ChoreCompletion>): ChoreCompletion {
  return { id: "cc1", choreId: "c1", profileId: "p1", completedAt: new Date(), points: 1, ...partial } as ChoreCompletion;
}

test("getPeriodProgress: weekly period only counts completions within that Sun-Sat week", () => {
  const c = chore({ targetCount: 3, recurrenceType: "weekly" });
  // Aug 10 2026 is a Monday; that week runs Sun Aug 9 - Sat Aug 15.
  const completions = [
    completion({ completedAt: new Date(2026, 7, 9) }),  // Sunday, in-week
    completion({ completedAt: new Date(2026, 7, 11) }), // Tuesday, in-week
    completion({ completedAt: new Date(2026, 7, 8) }),  // Saturday PRIOR week — excluded
    completion({ completedAt: new Date(2026, 7, 16) }), // Sunday NEXT week — excluded
  ];
  assert.equal(getPeriodProgress(c, "p1", completions, new Date(2026, 7, 10)), 2);
});

test("getPeriodProgress: monthly period counts the whole calendar month", () => {
  const c = chore({ targetCount: 5, recurrenceType: "monthly" });
  const completions = [
    completion({ completedAt: new Date(2026, 7, 1) }),
    completion({ completedAt: new Date(2026, 7, 31) }),
    completion({ completedAt: new Date(2026, 6, 31) }), // July 31 — prior month, excluded
    completion({ completedAt: new Date(2026, 8, 1) }),  // Sept 1 — next month, excluded
  ];
  assert.equal(getPeriodProgress(c, "p1", completions, new Date(2026, 7, 15)), 2);
});

test("getPeriodProgress: only counts completions for the matching chore + profile", () => {
  const c = chore({ id: "c1", targetCount: 2, recurrenceType: "weekly" });
  const completions = [
    completion({ choreId: "c1", profileId: "p1", completedAt: new Date(2026, 7, 10) }),
    completion({ choreId: "c2", profileId: "p1", completedAt: new Date(2026, 7, 10) }), // different chore
    completion({ choreId: "c1", profileId: "p2", completedAt: new Date(2026, 7, 10) }), // different profile
  ];
  assert.equal(getPeriodProgress(c, "p1", completions, new Date(2026, 7, 10)), 1);
});

test("getPeriodProgress: a non-target chore always returns 0", () => {
  const c = chore({ targetCount: 0 });
  assert.equal(getPeriodProgress(c, "p1", [completion({ completedAt: new Date() })], new Date()), 0);
});
