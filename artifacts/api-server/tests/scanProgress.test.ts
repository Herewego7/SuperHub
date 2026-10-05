import assert from "node:assert/strict";
import test from "node:test";
import { beginHouseholdScan, finishHouseholdScan, householdScanProgress } from "../src/ingest/scanProgress.ts";

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
