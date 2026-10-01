/**
 * Applies a health-reminder plan to this device. The planning half is in
 * healthReminderPlan.ts, kept import-free so it can be unit tested without a
 * browser or a Capacitor runtime.
 */

import { Capacitor } from "@capacitor/core";
import {
  scheduleLocalNotifications,
  cancelLocalNotifications,
  pendingLocalNotificationIds,
  deliveredLocalNotificationIds,
  deliveredHealthReminderIds,
  ensureLocalNotificationPermission,
  getNativePushToken,
} from "@/lib/nativeNotifications";
import { apiRequest } from "@/lib/queryClient";
import {
  planLocalHealthNotifications,
  shouldSuppressRemoteHealthPush,
  lastOccurrenceAtOrBefore,
  type PlannableReminder,
} from "@/lib/healthReminderPlan";
import { createSupersedingQueue } from "@/lib/supersedingQueue";
import { logHealthEvent } from "@/lib/localHealthLog";

export type { PlannableReminder, LocalHealthPlan, HealthScheduleJson } from "@/lib/healthReminderPlan";

// ── Applying the plan to the device ─────────────────────────────────────────

/**
 * What the last sync actually achieved, so a failure can be SEEN.
 *
 * The whole class of fault this guards against is silent: the reminder looks
 * saved, the app looks healthy, and nothing fires days later. Settings reads
 * this to say so out loud.
 */
export interface LocalHealthSyncResult {
  ok: boolean;
  /** How many iOS has actually confirmed it is holding. */
  scheduled: number;
  /** How many reminders the app was handed. Separates "the list never
   *  arrived" from "the list arrived and produced no plan". */
  seen: number;
  /** How many notifications the plan asked for. */
  planned: number;
  reason: "ok" | "no_permission" | "not_all_pending" | "error" | "not_native";
  detail?: string;
}

let lastSyncResult: LocalHealthSyncResult | null = null;

/**
 * The reminders the last sync was given, kept so Settings can re-run it on
 * demand. Diagnosing this by waiting for the next natural sync means guessing
 * about timing on top of everything else.
 */
let lastPlannable: PlannableReminder[] = [];

/** The last sync's outcome, or null if one has not run on this device yet. */
export function getLastLocalHealthSync(): LocalHealthSyncResult | null {
  return lastSyncResult;
}

/** Re-run the sync against the reminders last fetched, and report. */
export async function resyncLocalHealthReminders(): Promise<LocalHealthSyncResult> {
  return syncLocalHealthReminders(lastPlannable);
}

/**
 * Run a reminder 60 seconds out through the WHOLE production path.
 *
 * The bare probe in nativeNotifications.ts arrives; real reminders do not,
 * even though iOS reports holding correct triggers for them. The two differ in
 * everything between them — planning, the deterministic id, cancelling first,
 * scheduling an array rather than one — and in how far ahead they are aimed.
 * This holds the path fixed and changes only the distance, so the next result
 * says which of those two families of cause is live.
 *
 * ⚠️ It really does run the production sync, so it cancels the reminders
 * currently scheduled on this device — that is what makes it a faithful test.
 * The next natural sync (any app open) puts them back.
 */
export async function probeLocalHealthPipeline(minutes = 1): Promise<{
  result: LocalHealthSyncResult;
  firesAt: Date;
}> {
  const firesAt = new Date(Date.now() + minutes * 60_000);
  const synthetic: PlannableReminder = {
    // The id is part of what is under test — it decides the notification id —
    // so vary it per distance rather than reusing one, otherwise a later probe
    // silently REPLACES an earlier one still waiting to fire.
    id: `pipeline-probe-${minutes}`,
    title: "Pipeline probe",
    type: "medication",
    scheduleJson: { kind: "once", at: firesAt.toISOString() },
  };
  const result = await syncLocalHealthReminders([synthetic]);
  return { result, firesAt };
}

/** Ids this device scheduled last time, so removals can be cancelled. */
const STORAGE_KEY = "localHealthReminderIds_v1";

function readPreviousIds(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

function writeIds(ids: number[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* private mode / blocked storage — the pending-notification list below
       is the real source of truth, this is only a faster path to it. */
  }
}

/**
 * Make this device's pending local notifications match `reminders`.
 *
 * Cancels what no longer belongs (including ids left by a previous version of
 * the schedule), schedules what does, and tells the backend to stop sending
 * this device a remote health push — otherwise a family whose server happens
 * to be awake gets every medication reminder twice.
 *
 * No-op on web, where local notifications don't exist.
 */
export async function syncLocalHealthReminders(
  reminders: PlannableReminder[],
): Promise<LocalHealthSyncResult> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: true, scheduled: 0, seen: 0, planned: 0, reason: "not_native" };
  }
  // Serialise, and let a newer call supersede one that is still queued.
  return syncQueue.run(() => runSync(reminders));
}

/**
 * Only ever one sync in flight, and a superseded one never touches iOS.
 *
 * ⚠️ THIS IS THE BUG that survived four rebuilds. The caller invokes this as
 * `void syncLocalHealthReminders(...)` from an effect whose dependencies
 * include `profiles` — a fresh array on most renders — so several syncs ran
 * concurrently as a matter of course. Each one has four awaits (permission,
 * getPending, cancel, schedule) before it mutates anything, which is ample
 * room for this interleaving:
 *
 *   run A starts with the OLD reminder list   (wanted = {})
 *   run B starts with the NEW list            (wanted = {X}) and schedules X
 *   run A finally reaches its cancel step, sees X pending, X is not in ITS
 *   wanted, and cancels it
 *
 * The reminder is then gone from iOS, with nothing to show for it: the app
 * looks right, the reminder looks saved, and nothing arrives. Pressing
 * "Re-check reminders" re-schedules it, so every later inspection reported it
 * correctly held — which is exactly why "1 planned, 1 held by iOS" sat
 * alongside a notification that never fired.
 *
 * It also explains why every probe worked. A probe is followed immediately by
 * a force-quit, so no second sync ever runs to cancel it; a real reminder is
 * created in the app and then sits through many more renders.
 */
const syncQueue = createSupersedingQueue<LocalHealthSyncResult>(
  // A superseded run reports the last real outcome rather than inventing one:
  // it did nothing, so nothing about the device changed.
  () => lastSyncResult ?? { ok: true, scheduled: 0, seen: 0, planned: 0, reason: "ok" },
);

async function runSync(reminders: PlannableReminder[]): Promise<LocalHealthSyncResult> {
  // FIRST, before anything is cancelled: what has iOS actually shown? Cancel
  // removes delivered notifications as well as pending ones, so asking after
  // the fact destroys the only evidence that a reminder ever fired.
  const deliveredBefore = await deliveredLocalNotificationIds();
  const pendingBefore = await pendingLocalNotificationIds();

  lastPlannable = reminders;
  const plans = planLocalHealthNotifications(reminders);
  const wanted = new Set(plans.map((p) => p.id));
  const counts = { seen: reminders.length, planned: wanted.size };

  // Permission FIRST, before anything touches the notification centre.
  // Scheduling without it rejects, and the throw used to take the rest of this
  // function with it — including the call that tells the server to stop
  // sending its own push. See ensureLocalNotificationPermission.
  if (plans.length > 0 && !(await ensureLocalNotificationPermission())) {
    lastSyncResult = { ok: false, scheduled: 0, ...counts, reason: "no_permission" };
    // Deliberately leave the server's push enabled: if this device cannot show
    // a local reminder, a server push that sometimes arrives is far better
    // than nothing at all.
    await setRemoteHealthPushSuppressed(false);
    return lastSyncResult;
  }

  try {
    // Cancel by what the OS actually holds where possible, falling back to our
    // own record: either alone leaves orphans (the OS list includes ids from
    // other features; our record is empty after a reinstall or cleared storage).
    const known = new Set<number>([...readPreviousIds(), ...pendingBefore]);
    const stale = [...known].filter((id) => !wanted.has(id));
    if (stale.length > 0) await cancelLocalNotifications(stale);

    if (plans.length > 0) await scheduleLocalNotifications(plans);
    writeIds([...wanted]);

    // What iOS ACTUALLY holds, not what we asked for. A schedule call can
    // succeed and still leave nothing pending — iOS silently drops anything
    // past its 64-notification ceiling, and a trigger already in the past is
    // never held at all. Suppressing the server's push on the strength of a
    // request we never confirmed is how this failure stays invisible.
    const pending = new Set(await pendingLocalNotificationIds());
    const confirmed = [...wanted].filter((id) => pending.has(id)).length;

    const suppress = shouldSuppressRemoteHealthPush(wanted.size, confirmed);
    logHealthEvent("sync", {
      seen: counts.seen,
      planned: counts.planned,
      wanted: [...wanted],
      // What was already there when this sync began — the state nobody has
      // been able to see, because every previous check re-ran the sync first.
      pendingBefore,
      deliveredBefore,
      cancelled: stale,
      pendingAfter: [...pending],
      confirmed,
      suppressRemote: suppress,
    });
    lastSyncResult = {
      ok: confirmed === wanted.size,
      scheduled: confirmed,
      ...counts,
      reason: confirmed === wanted.size ? "ok" : "not_all_pending",
    };
    // Only suppress the remote push for reminders iOS has actually accepted.
    await setRemoteHealthPushSuppressed(suppress);
    // Anything iOS already showed while the app was closed still has to reach
    // the acknowledge card. Deliberately after the scheduling work, so a slow
    // or failing server cannot delay the thing that actually matters.
    void reportDeliveredDoses(reminders);
    return lastSyncResult;
  } catch (err) {
    // Never silent again. The caller invokes this as `void sync(...)`, so a
    // throw here is an unhandled rejection nobody sees — which is exactly how
    // the 2026-09-28 fault survived a device test that looked like it passed.
    lastSyncResult = {
      ok: false,
      scheduled: 0,
      ...counts,
      reason: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
    logHealthEvent("sync", { error: lastSyncResult.detail, seen: counts.seen, planned: counts.planned });
    await setRemoteHealthPushSuppressed(false);
    return lastSyncResult;
  }
}

/**
 * Tell the server about doses this device has already announced.
 *
 * ⚠️ Moving reminders onto the device quietly broke the half of the feature
 * that comes after the notification. Home's "Health reminders to acknowledge"
 * card is built from health_reminder_events, and only the server's scheduler
 * ever created those — and on Autoscale it is asleep. So the reminder fired
 * beautifully on the phone and then had nowhere to land: no card on Home,
 * nothing for the notification's deep link to point at, and no way to tick the
 * dose off (2026-09-29).
 *
 * Best-effort by design. The notification has already done its job; failing to
 * file the paperwork must never throw away the schedule.
 */
async function reportDeliveredDoses(reminders: PlannableReminder[]): Promise<void> {
  try {
    const delivered = new Set(await deliveredHealthReminderIds());
    if (delivered.size === 0) return;
    const now = new Date();
    for (const r of reminders) {
      if (!delivered.has(r.id)) continue;
      const occasion = lastOccurrenceAtOrBefore(r.scheduleJson, now);
      if (!occasion) continue;
      try {
        // Idempotent server-side on (reminderId, scheduledAt), so several
        // devices reporting the same dose produce one event, not three.
        await apiRequest("POST", "/api/health-reminder-events/ensure", {
          reminderId: r.id,
          scheduledAt: occasion.toISOString(),
        });
      } catch {
        /* offline, or the server asleep — the next sync tries again */
      }
    }
  } catch {
    /* never let bookkeeping break scheduling */
  }
}

/**
 * Tell the backend whether this device is handling health reminders itself.
 * Best-effort: a failure here means a possible duplicate notification, which
 * is much better than throwing away the local schedule we just made.
 */
async function setRemoteHealthPushSuppressed(suppressed: boolean): Promise<void> {
  const token = getNativePushToken();
  if (!token) return;
  try {
    await apiRequest("POST", "/api/push/native/local-health", { token, enabled: suppressed });
  } catch {
    /* ignore — see above */
  }
}
