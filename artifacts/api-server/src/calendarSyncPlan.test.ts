import assert from "node:assert";
import { planEventUpdate, SYNC_PROVIDERS } from "./calendarSyncPlan";
import type { EventCalendarSync } from "@workspace/db";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Helper to build a sync-link row with sane defaults.
function link(partial: Partial<EventCalendarSync>): EventCalendarSync {
  return {
    id: "id",
    eventId: "evt",
    userId: "user",
    profileId: "p1",
    provider: "google",
    externalEventId: "g1",
    externalCalendarId: "primary",
    syncState: "synced",
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

console.log("planEventUpdate:");

test("first sync: all assignees get a copy per provider", () => {
  const plan = planEventUpdate([], ["p1", "p2"], true);
  assert.equal(plan.toUpdate.length, 0);
  assert.equal(plan.toDelete.length, 0);
  // 2 profiles × 2 providers = 4 new copies
  assert.equal(plan.toCreate.length, 4);
  assert.deepEqual(
    plan.toCreate.map(c => `${c.provider}:${c.profileId}`).sort(),
    ["google:p1", "google:p2", "outlook:p1", "outlook:p2"],
  );
});

test("no new copies created when sync disabled", () => {
  const plan = planEventUpdate([], ["p1"], false);
  assert.equal(plan.toCreate.length, 0);
});

test("retained assignee → update, never duplicate-create", () => {
  const existing = [link({ profileId: "p1", provider: "google", externalEventId: "g1" })];
  const plan = planEventUpdate(existing, ["p1"], true);
  assert.equal(plan.toUpdate.length, 1);
  assert.equal(plan.toUpdate[0].externalEventId, "g1");
  assert.equal(plan.toDelete.length, 0);
  // p1/google already exists, so only p1/outlook is created
  assert.deepEqual(plan.toCreate.map(c => `${c.provider}:${c.profileId}`), ["outlook:p1"]);
});

test("reassignment: drop old assignee, add new one (move = delete + create)", () => {
  const existing = [
    link({ profileId: "p1", provider: "google", externalEventId: "g1" }),
    link({ profileId: "p1", provider: "outlook", externalEventId: "o1" }),
  ];
  const plan = planEventUpdate(existing, ["p2"], true);
  // p1's copies are deleted
  assert.equal(plan.toDelete.length, 2);
  assert.deepEqual(plan.toDelete.map(l => l.profileId), ["p1", "p1"]);
  // p2 gets fresh copies on both providers
  assert.equal(plan.toUpdate.length, 0);
  assert.deepEqual(
    plan.toCreate.map(c => `${c.provider}:${c.profileId}`).sort(),
    ["google:p2", "outlook:p2"],
  );
});

test("unassign everyone: all copies deleted, none created", () => {
  const existing = [
    link({ profileId: "p1", provider: "google" }),
    link({ profileId: "p2", provider: "outlook" }),
  ];
  const plan = planEventUpdate(existing, [], true);
  assert.equal(plan.toDelete.length, 2);
  assert.equal(plan.toUpdate.length, 0);
  assert.equal(plan.toCreate.length, 0);
});

test("edits still propagate to existing copies when sync is OFF", () => {
  // Sync turned off after the event was already synced — existing copies must
  // still be updated/deleted, just no NEW copies created.
  const existing = [
    link({ profileId: "p1", provider: "google" }),
    link({ profileId: "p2", provider: "google" }),
  ];
  const plan = planEventUpdate(existing, ["p1"], false);
  assert.equal(plan.toUpdate.length, 1);
  assert.equal(plan.toUpdate[0].profileId, "p1");
  assert.equal(plan.toDelete.length, 1);
  assert.equal(plan.toDelete[0].profileId, "p2");
  assert.equal(plan.toCreate.length, 0); // sync off → no new copies
});

test("pure error rows (no external copy) are ignored, then retried via create", () => {
  const existing = [link({ profileId: "p1", provider: "google", syncState: "error", externalEventId: "" })];
  const plan = planEventUpdate(existing, ["p1"], true);
  // The error row is neither updated nor deleted...
  assert.equal(plan.toUpdate.length, 0);
  assert.equal(plan.toDelete.length, 0);
  // ...and since no live google copy exists, a fresh create is planned for it.
  assert.ok(plan.toCreate.some(c => c.provider === "google" && c.profileId === "p1"));
});

test("provider list is exactly google + outlook", () => {
  assert.deepEqual([...SYNC_PROVIDERS], ["google", "outlook"]);
});

console.log(`\n${passed} tests passed.`);
