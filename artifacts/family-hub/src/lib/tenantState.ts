/**
 * Everything on this device that belongs to ONE household, and how to get rid
 * of it when the household changes.
 *
 * Logging out dropped the bearer token and invalidated the auth query, and
 * stopped there. React Query still held the previous family's data, the
 * signed-object URL cache still held working URLs for their photos, and
 * localStorage still held their chosen privacy-screen image. A second account
 * signing in on the same device could render any of it before its own data
 * arrived.
 *
 * ⚠️ AND the previous family's medication reminders were still scheduled in
 * iOS. Those fire from the OS with no app involvement (see
 * localHealthReminders.ts), so signing out did not stop them — a stranger's
 * dose reminder would keep going off on your phone. That is the most
 * consequential part of this file and the easiest to overlook, because
 * nothing in the app is holding the state.
 *
 * The classification below is the whole point: a device-wide display
 * preference (theme, calendar zoom, whether this iPad shows the screensaver)
 * must SURVIVE an account switch — resetting those would be its own bug, and
 * a rather annoying one on a shared kitchen iPad.
 */



/**
 * Keys holding data that belongs to a specific household.
 *
 * Each entry says why, because "it looks family-ish" is not a reason and the
 * next person needs to be able to judge a new key correctly.
 */
export const TENANT_LOCAL_STORAGE_KEYS: readonly string[] = [
  // An uploaded /objects/ path owned by the previous household — the case the
  // 2026-09-21 review named. A stale one now 403s rather than rendering, but
  // it should not be here at all.
  "familyHub_privacyImageUrl",
  // Profile ids.
  "familyHub_profileOrder",
  "peopleTabSettings_v1",
  // Ids of that family's notes, shout-outs and announcements.
  "dismissedNoteIds",
  "dismissedShoutoutIds",
  "familyHub_announcementsSnooze",
  // That account's progress through onboarding.
  "familyHub_dismissedOnboardingSteps",
  // Event ids from that family's calendar.
  "familyHub_eventReminderShown",
  // The OS notification ids for that family's medication reminders. Cleared
  // alongside cancelling the notifications themselves — see clearTenantState.
  "localHealthReminderIds_v1",
  // "already celebrated today", keyed per profile.
  "familyHub_allDoneCelebrated",
] as const;

/**
 * Prefixes for keys that embed an id, so the exact name is not known ahead of
 * time. `familyHub_collapsedSections_<profileId>` is one per profile, and a
 * fixed list could never catch them all.
 */
export const TENANT_LOCAL_STORAGE_PREFIXES: readonly string[] = [
  "familyHub_collapsedSections_",
] as const;

/**
 * Keys that are deliberately NOT cleared, recorded so the decision is visible
 * rather than looking like an omission:
 *
 *   familyHub_themeMode            light/dark on this device
 *   familyHub_calViewMode          which calendar view this device prefers
 *   familyHub_calZoom              calendar zoom level
 *   familyHub_calMonthStyle        dots vs titles on this device
 *   familyHub_screensaver          per-device screensaver toggle
 *   familyHub_eventRemindersEnabled per-device reminder toggle
 *   familyHub_todosSort            sort order preference
 *   todayPageCardSettings_v5       card layout on this device
 *   tasksPageCardSettings_v1       card layout on this device
 *   familyHub_reviewPromptAskedAt  App Store prompt pacing, per device
 *   familyHub_reviewPromptDays     as above
 *   familyHub_featureNudgeShownAt  as above
 *
 * None of them names a profile, an item or a household.
 */
export function isTenantScopedKey(key: string): boolean {
  if (TENANT_LOCAL_STORAGE_KEYS.includes(key)) return true;
  return TENANT_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** The tenant-scoped keys actually present, given every key on the device. */
export function tenantScopedKeysIn(allKeys: readonly string[]): string[] {
  return allKeys.filter(isTenantScopedKey);
}

/**
 * Remembers which account this device last showed, so a switch can be
 * noticed even when nobody pressed Sign Out.
 *
 * Device-wide on purpose, and therefore NOT in the tenant key list: clearing
 * it during a switch would destroy the very record that detects the switch.
 */
const LAST_ACCOUNT_KEY = "familyHub_lastAccountId";

export function readLastAccountId(): string | null {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export function writeLastAccountId(accountId: string): void {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, accountId);
  } catch {
    /* private mode — the switch just goes unnoticed, same as before */
  }
}

/**
 * Whether arriving at `currentAccountId` means the household changed.
 *
 * Pure so the edge cases are testable. A FIRST sign-in on a device (no
 * previous id) is not a switch — clearing then would wipe the state the
 * account has only just loaded.
 */
export function isAccountSwitch(
  previousAccountId: string | null,
  currentAccountId: string | null,
): boolean {
  if (!currentAccountId) return false;
  if (!previousAccountId) return false;
  return previousAccountId !== currentAccountId;
}

/**
 * Clean up after an account switch, then record the new account — with the
 * cleanup bounded, and the record written no matter what.
 *
 * ⚠️ WHY THE ORDER, AND WHY IT RUNS BEFORE THE APP LOADS (2026-09-30). This
 * used to run as an effect AFTER the new account had started loading, and it
 * ended by wiping the entire query cache. Since sign-out always restarts the
 * app, the only data in that cache was the NEW account's, freshly fetched — so
 * the wipe threw it away and the app loaded a second time, competing with the
 * heavy calendar requests the first load had already started. Switching
 * accounts took about a minute; signing back into the same account did not.
 *
 * The wipe also hid a race. The same cleanup cancels the phone's scheduled
 * medication reminders so the previous family's doses stop firing — and it
 * cancelled the NEW account's too, if they had already been scheduled. The
 * wipe's forced reload happened to reschedule them. Removing the wipe alone
 * would have silently stopped the new account's reminders.
 *
 * Running the cleanup BEFORE the app loads removes both at once: nothing has
 * been fetched yet, so nothing is thrown away, and nothing has been scheduled
 * yet, so nothing of the new account's can be cancelled.
 *
 * The record is written AFTER the cleanup (so a crash mid-way retries next
 * time) but UNCONDITIONALLY — a cleanup that hangs or throws must still let the
 * app through, or the person is left on a spinner forever.
 */
export async function runAccountSwitchCleanup(opts: {
  cleanup: () => Promise<unknown>;
  recordAccount: () => void;
  timeoutMs: number;
}): Promise<void> {
  await Promise.race([
    opts.cleanup().then(() => undefined, () => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, opts.timeoutMs)),
  ]);
  opts.recordAccount();
}

/** Long enough for real cleanup on a slow phone; short enough not to feel stuck. */
export const ACCOUNT_SWITCH_CLEANUP_TIMEOUT_MS = 4000;
