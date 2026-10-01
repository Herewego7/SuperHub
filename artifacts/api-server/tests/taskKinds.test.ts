import { test } from "node:test";
import assert from "node:assert/strict";
import { isRequiredChoreTaskType } from "../src/lib/taskKinds";

// 2026-09-11: a family with any Inspiration could never finish their day —
// the affirmation/verse row counted toward the daily checklist, so the
// confetti, the Perfect Day achievement and the per_completion bonus all
// waited on it. Only real chores make up the checklist.

test("real chores count toward the daily checklist", () => {
  assert.equal(isRequiredChoreTaskType("chore"), true);
});

test("a legacy row with no taskType counts as a real chore", () => {
  assert.equal(isRequiredChoreTaskType(null), true);
  assert.equal(isRequiredChoreTaskType(undefined), true);
});

test("to-dos do not count toward the daily checklist", () => {
  assert.equal(isRequiredChoreTaskType("todo"), false);
});

test("every Inspiration sub-type is excluded from the daily checklist", () => {
  for (const t of ["affirmation", "bible_verse", "memory_verse", "mission", "custom"]) {
    assert.equal(isRequiredChoreTaskType(t), false, `${t} should not be required`);
  }
});

test("an unrecognised taskType counts as a chore rather than blocking the day", () => {
  // Fail open: a new kind nobody taught this function about must not make a
  // day impossible to finish.
  assert.equal(isRequiredChoreTaskType("something_new"), true);
});
