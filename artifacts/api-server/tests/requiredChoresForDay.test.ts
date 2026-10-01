import { test } from "node:test";
import assert from "node:assert/strict";
import { requiredChoresForDay } from "../src/achievementService";

// 2026-09-30: a chore past its End date stayed "required" on its weekday, so a
// finished day never counted — no Perfect Day, no finished-day bonus.
const base = { isActive: true, isBonus: false, targetCount: null, taskType: "chore", recurrenceType: "weekly", daysOfWeek: [0, 1, 2, 3, 4, 5, 6] } as const;
const day = new Date(2026, 8, 30); // local midnight, as the app sends it

test("a chore that ended before this day is not required", () => {
  const ended = { ...base, endDate: new Date(2026, 8, 29, 23, 59, 59) };
  assert.equal(requiredChoresForDay([ended as any], day).length, 0);
});

test("a chore ending today is still required today", () => {
  const today = { ...base, endDate: new Date(2026, 8, 30, 23, 59, 59) };
  assert.equal(requiredChoresForDay([today as any], day).length, 1);
});

test("a chore with no end date is required", () => {
  assert.equal(requiredChoresForDay([{ ...base, endDate: null } as any], day).length, 1);
});
