import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// The module reads localStorage at call time, so a plain in-memory stub is
// enough — and it has to be installed before the module is imported, since
// loadMap/saveMap close over the global.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

const { hasCelebratedAllDone, markCelebratedAllDone, clearCelebratedAllDone } =
  await import("../../src/lib/allDoneCelebration");

const PROFILE = "kid1";
const DAY = new Date(2026, 8, 10);

beforeEach(() => store.clear());

test("a day is celebrated once, not on every later completion", () => {
  assert.equal(hasCelebratedAllDone(PROFILE, DAY), false);
  markCelebratedAllDone(PROFILE, DAY);
  assert.equal(hasCelebratedAllDone(PROFILE, DAY), true);
});

// ---------------------------------------------------------------------------
// Regression: the flag was write-once per day and nothing ever cleared it, so
// after the first "all done" every later completion that day was silent — even
// after un-checking something and finishing again. From the user's side that
// reads as the confetti being broken, because they genuinely did just finish
// their chores and nothing happened (2026-09-10).
// ---------------------------------------------------------------------------
test("undoing a completion re-arms the celebration", () => {
  markCelebratedAllDone(PROFILE, DAY);
  clearCelebratedAllDone(PROFILE, DAY);
  assert.equal(
    hasCelebratedAllDone(PROFILE, DAY), false,
    "after un-checking a chore the day is not finished any more, so finishing " +
      "it again has to celebrate again",
  );
});

test("chores and to-dos are cleared independently", () => {
  markCelebratedAllDone(PROFILE, DAY, "chores");
  markCelebratedAllDone(PROFILE, DAY, "todos");
  clearCelebratedAllDone(PROFILE, DAY, "todos");
  assert.equal(hasCelebratedAllDone(PROFILE, DAY, "chores"), true, "chores must survive a to-do undo");
  assert.equal(hasCelebratedAllDone(PROFILE, DAY, "todos"), false);
});

test("clearing one profile or day leaves the others alone", () => {
  const other = new Date(2026, 8, 11);
  markCelebratedAllDone(PROFILE, DAY);
  markCelebratedAllDone("kid2", DAY);
  markCelebratedAllDone(PROFILE, other);
  clearCelebratedAllDone(PROFILE, DAY);
  assert.equal(hasCelebratedAllDone("kid2", DAY), true);
  assert.equal(hasCelebratedAllDone(PROFILE, other), true);
});
