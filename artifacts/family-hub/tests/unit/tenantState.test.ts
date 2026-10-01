import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTenantScopedKey,
  tenantScopedKeysIn,
  isAccountSwitch,
  TENANT_LOCAL_STORAGE_KEYS,
} from "../../src/lib/tenantState.ts";

/**
 * This classifier has two ways to be wrong and they fail in opposite
 * directions: miss a key and the previous household's data survives an
 * account switch; over-match and a shared iPad silently loses its theme and
 * calendar preferences every time someone signs in.
 */

test("data belonging to one household is cleared", () => {
  for (const key of [
    // The uploaded /objects/ path the review named.
    "familyHub_privacyImageUrl",
    // Profile ids.
    "familyHub_profileOrder",
    "peopleTabSettings_v1",
    // Ids of that family's items.
    "dismissedNoteIds",
    "dismissedShoutoutIds",
    "familyHub_announcementsSnooze",
    "familyHub_eventReminderShown",
    // OS notification ids for that family's medication reminders.
    "localHealthReminderIds_v1",
    "familyHub_allDoneCelebrated",
    "familyHub_dismissedOnboardingSteps",
  ]) {
    assert.equal(isTenantScopedKey(key), true, `${key} must be cleared`);
  }
});

test("device preferences SURVIVE an account switch", () => {
  // Resetting these would be its own bug — and an irritating one on a shared
  // kitchen iPad that has been set up deliberately.
  for (const key of [
    "familyHub_themeMode",
    "familyHub_calViewMode",
    "familyHub_calZoom",
    "familyHub_calMonthStyle",
    "familyHub_screensaver",
    "familyHub_eventRemindersEnabled",
    "familyHub_todosSort",
    "todayPageCardSettings_v5",
    "tasksPageCardSettings_v1",
    "familyHub_reviewPromptAskedAt",
    "familyHub_reviewPromptDays",
    "familyHub_featureNudgeShownAt",
  ]) {
    assert.equal(isTenantScopedKey(key), false, `${key} must be preserved`);
  }
});

test("the record of which account was last seen is never cleared", () => {
  // Clearing it would destroy the very thing that detects a switch, so the
  // next switch would go unnoticed.
  assert.equal(isTenantScopedKey("familyHub_lastAccountId"), false);
});

test("per-profile keys are matched by prefix, whatever the id", () => {
  // familyHub_collapsedSections_<profileId> is one key per profile, so a
  // fixed list could never name them all.
  assert.equal(isTenantScopedKey("familyHub_collapsedSections_abc-123"), true);
  assert.equal(isTenantScopedKey("familyHub_collapsedSections_"), true);
  assert.equal(isTenantScopedKey("familyHub_collapsedSection"), false);
});

test("an unrelated key is left alone", () => {
  for (const key of ["", "someOtherApp_token", "familyHub", "theme"]) {
    assert.equal(isTenantScopedKey(key), false, `${key} should not match`);
  }
});

test("only the keys actually present are returned", () => {
  const onDevice = [
    "familyHub_themeMode",
    "familyHub_privacyImageUrl",
    "familyHub_collapsedSections_p1",
    "familyHub_calZoom",
    "unrelated",
  ];
  assert.deepEqual(
    tenantScopedKeysIn(onDevice).sort(),
    ["familyHub_collapsedSections_p1", "familyHub_privacyImageUrl"],
  );
});

test("every listed tenant key classifies as one", () => {
  // Guards against a typo in the list silently making an entry inert.
  for (const key of TENANT_LOCAL_STORAGE_KEYS) {
    assert.equal(isTenantScopedKey(key), true, `${key} is listed but does not match`);
  }
});

test("a switch is a DIFFERENT account, not a first sign-in", () => {
  assert.equal(isAccountSwitch("account-a", "account-b"), true);
  // Same account signing in again is not a switch — clearing here would wipe
  // state the account just loaded, on every launch.
  assert.equal(isAccountSwitch("account-a", "account-a"), false);
  // First ever sign-in on this device: nothing to clear.
  assert.equal(isAccountSwitch(null, "account-a"), false);
  // Signed out: handled by the logout path, not by this.
  assert.equal(isAccountSwitch("account-a", null), false);
  assert.equal(isAccountSwitch(null, null), false);
});

// 2026-09-30: signing in as a different account took ~1 minute because the
// switch clean-up ran after the app had loaded and wiped it. The clean-up now
// runs first, gated — which only works if it always finishes.
import { runAccountSwitchCleanup } from "../../src/lib/tenantState.ts";

test("account switch: clean-up runs before the new account is recorded", async () => {
  const order: string[] = [];
  await runAccountSwitchCleanup({
    cleanup: async () => { order.push("cleanup"); },
    recordAccount: () => order.push("record"),
    timeoutMs: 1000,
  });
  assert.deepEqual(order, ["cleanup", "record"]);
});

test("account switch: a clean-up that never finishes cannot hold the app back", async () => {
  let recorded = false;
  await runAccountSwitchCleanup({
    cleanup: () => new Promise(() => {}),
    recordAccount: () => { recorded = true; },
    timeoutMs: 20,
  });
  assert.equal(recorded, true);
});

test("account switch: a failing clean-up still records the account", async () => {
  let recorded = false;
  await runAccountSwitchCleanup({
    cleanup: async () => { throw new Error("notifications unavailable"); },
    recordAccount: () => { recorded = true; },
    timeoutMs: 1000,
  });
  assert.equal(recorded, true);
});
