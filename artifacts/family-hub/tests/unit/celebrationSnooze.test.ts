import { test } from "node:test";
import assert from "node:assert/strict";
import { nextCelebrationCheckpoint, loadCelebrationSnoozes } from "../../src/lib/celebrationSnooze";

// Dismissing a celebration used to hide it for the rest of the year, losing
// the day-before and day-of reminders. These pin where a dismissal lands.
test("a dismissal several days out comes back the day before", () => {
  for (const d of [7, 6, 5, 4, 3]) {
    assert.equal(nextCelebrationCheckpoint(d), 1, `dismissed ${d} days out`);
  }
});

test("a dismissal in the last two days comes back on the day", () => {
  assert.equal(nextCelebrationCheckpoint(2), 0);
  assert.equal(nextCelebrationCheckpoint(1), 0);
});

test("a dismissal on the day itself does not come back", () => {
  // -1 is below the banner's own window (daysUntil >= 0), so it stays hidden
  // for the rest of the year — there is nothing left to remind about.
  assert.equal(nextCelebrationCheckpoint(0), -1);
});

test("the threshold is always reachable from where it was set", () => {
  // A checkpoint you can never hit would silence the celebration by accident.
  for (const d of [7, 6, 5, 4, 3, 2, 1]) {
    const t = nextCelebrationCheckpoint(d);
    assert.ok(t < d, `dismissed at ${d} but told to reappear at ${t} — never reached`);
    assert.ok(t >= 0, `dismissed at ${d} produced ${t}, which hides it for the year`);
  }
});

test("an old bare-id dismissal list migrates to hidden-for-the-year", () => {
  // The pre-2026-09-08 shape. If this mapped to anything reachable, every
  // celebration a family already dismissed this year would reappear at once
  // the moment this ships — the Announcements-backlog surprise, again.
  const store: Record<string, string> = { k: JSON.stringify(["a", "b"]) };
  (globalThis as any).localStorage = { getItem: (key: string) => store[key] ?? null };
  assert.deepEqual(loadCelebrationSnoozes("k"), { a: -1, b: -1 });
});

test("a new threshold map round-trips, and junk falls back to empty", () => {
  const store: Record<string, string> = {
    good: JSON.stringify({ a: 1 }),
    junk: "{not json",
    missing: undefined as unknown as string,
  };
  (globalThis as any).localStorage = { getItem: (key: string) => store[key] ?? null };
  assert.deepEqual(loadCelebrationSnoozes("good"), { a: 1 });
  assert.deepEqual(loadCelebrationSnoozes("junk"), {});
  assert.deepEqual(loadCelebrationSnoozes("missing"), {});
});
