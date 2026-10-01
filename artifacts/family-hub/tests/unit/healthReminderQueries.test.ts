import { test } from "node:test";
import assert from "node:assert/strict";
import { isHealthReminderKey } from "../../src/lib/healthReminderQueries.ts";

// 2026-09-29. Medication reminders never reached iOS, and it took five wrong
// theories and as many rebuilds to find out why: the reminder form invalidated
// only its own query key, while the device scheduler reads a different one.
// React Query treats them as unrelated, so the scheduler kept serving a stale
// list and never learned a reminder existed.

test("every key the app actually fetches reminders with is matched", () => {
  // These are the real keys, copied from the components. If a new one appears
  // and is not matched, reminders silently stop reaching the device — which is
  // exactly the bug this guards.
  for (const key of [
    ["/api/health-reminders"],                                             // the device scheduler
    ["/api/health-reminders?includePaused=true"],                          // the Home inbox
    ["/api/health-reminders?profileId=abc&includePaused=true"],            // a person's card
  ]) {
    assert.equal(isHealthReminderKey(key), true, `${key[0]} must be matched`);
  }
});

test("the events endpoint is left alone", () => {
  // Acknowledging a dose changes the event, not the schedule. Matching it here
  // would refetch the whole reminder list on every acknowledgement for nothing.
  assert.equal(isHealthReminderKey(["/api/health-reminder-events?unack=true"]), false);
  assert.equal(isHealthReminderKey(["/api/health-reminder-events"]), false);
});

test("unrelated queries are never matched", () => {
  for (const key of [
    ["/api/profiles"],
    ["/api/chores"],
    ["/api/health"],
    [],
    [undefined],
    [42],
  ]) {
    assert.equal(isHealthReminderKey(key), false, `${JSON.stringify(key)} must not match`);
  }
});
