/**
 * Shared user-facing strings.
 *
 * Everything here was duplicated across two or more files before. Keeping one
 * copy isn't only about word count: a stale pointer survived a Settings
 * refactor precisely because the same sentence existed in four places and only
 * some were updated. If a string is user-visible and appears more than once,
 * it belongs here.
 */

/** Shown under the Grown-up / Kid selector on both profile forms. */
export const KID_ROLE_EXPLAINER =
  "Kids can do chores & request rewards; adult-only actions ask for the Parent PIN on this profile.";

export const ADULT_ROLE_EXPLAINER = "Grown-ups have full access to everything.";

/** Nudge shown when a profile is marked Kid but no Parent PIN exists yet. */
export const KID_NEEDS_PIN_NUDGE =
  "Kid restrictions need a Parent PIN — set one in Settings → Rewards & Approvals.";

/** Confirm body for disconnecting a Google/Outlook calendar. */
export const DISCONNECT_CALENDAR_BODY =
  "Removes the connection, plus your sync and write-target choices. You can reconnect anytime.";

/** Why individual chores show no star value in per-completion mode. */
export const PER_DAY_STARS_EXPLAINER =
  "Stars are earned per day, not per chore. Change this in Settings → Rewards & Approvals.";

/** Confirm body for deleting any occurrence of a repeating event. */
export const DELETE_SERIES_BODY = "Every occurrence will be removed.";

/** Caption on announcement rows whose dismissal is per-device. */
export const DEVICE_SCOPE_CAPTION = "Clears on this device only.";
