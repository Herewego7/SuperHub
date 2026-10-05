import assert from "node:assert/strict";
import test from "node:test";
import { beginHouseholdScan, catchUpPending, finishHouseholdScan, householdScanProgress, scanLockFresh, scanStatusFor } from "../src/ingest/scanProgress.ts";

test("a household scan stays quiet until the read finishes", () => {
  const userId = "scan-progress-user";
  assert.equal(householdScanProgress(userId).running, false);
  beginHouseholdScan(userId);
  assert.equal(householdScanProgress(userId).running, true);
  assert.equal(householdScanProgress(userId).finishedAt, null);
  const done = finishHouseholdScan(userId, { todos: 3, events: 1 }, 1_700_000_000_000);
  assert.equal(done.running, false);
  assert.equal(done.finishedAt, 1_700_000_000_000);
  assert.equal(done.todos, 3);
  assert.equal(householdScanProgress(userId).events, 1);
});

test("a full read stays owed until it finishes after the request", () => {
  const requested = new Date("2026-10-05T12:00:00Z");
  const earlier = new Date("2026-10-05T11:00:00Z");
  const later = new Date("2026-10-05T13:00:00Z");
  assert.equal(catchUpPending(null, null), false);
  assert.equal(catchUpPending(requested, null), true);
  assert.equal(catchUpPending(requested, earlier), true);
  assert.equal(catchUpPending(requested, later), false);
});

test("a live read keeps the lock, and a stalled one can be picked up", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  assert.equal(scanLockFresh(null, now), false);
  assert.equal(scanLockFresh(new Date(now.getTime() - 60_000), now), true);
  assert.equal(scanLockFresh(new Date(now.getTime() - 11 * 60_000), now), false);
  const started = new Date(now.getTime() - 60_000);
  assert.equal(scanLockFresh(started, now, new Date(now.getTime() - 30_000)), false);
});

test("home hears that a read finished in another process", () => {
  const requested = new Date("2026-10-05T12:00:00Z");
  const finished = new Date("2026-10-05T14:00:00Z");
  const quiet = { running: false, finishedAt: null, todos: 0, events: 0 };
  assert.deepEqual(scanStatusFor(quiet, { requestedAt: requested, finishedAt: null }), {
    running: true,
    finishedAt: null,
  });
  assert.deepEqual(scanStatusFor(quiet, { requestedAt: requested, finishedAt: finished }), {
    running: false,
    finishedAt: finished.getTime(),
  });
});
