/**
 * On-device scheduling for health/medication reminders.
 *
 * WHY THIS EXISTS: the backend runs on Replit Autoscale, which scales to zero
 * whenever no requests are arriving. No container means no `setInterval`, so
 * `scheduler/healthReminders.ts` only ticks while somebody happens to be using
 * the app — and its firing window is 7 minutes. Verified on a real device
 * (2026-09-18): a medication reminder set 20 minutes out, with the app closed
 * everywhere, never arrived. Server-sent medication reminders are therefore
 * not dependable, and medication is the one category where that is not an
 * acceptable failure.
 *
 * iOS schedules local notifications itself, in the OS, with no process of ours
 * running and no network. So the app hands the whole schedule to iOS while it
 * is open, and iOS fires it from then on.
 *
 * EVERY kind maps to a REPEATING calendar trigger except "once", which is a
 * single instant anyway. That matters: a repeating trigger fires forever
 * without the app being opened again, so this does not decay if the family
 * stops opening the app for a while.
 *
 * The planning half is pure and lives here so it can be tested without a
 * device; the scheduling half is at the bottom and no-ops on web.
 */


export type HealthScheduleJson =
  | { kind: "once"; at: string }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; time: string; days: number[] }
  | { kind: "monthly"; time: string; dayOfMonth: number };

export interface PlannableReminder {
  id: string;
  title: string;
  /**
   * e.g. "1 tablet". Deliberately NOT shown in the notification — see
   * notificationText. Kept on the type because callers already carry it.
   */
  dose?: string | null;
  /** "medication" | "appointment" | "refill" | anything else. Only chooses
   * which generic wording the notification uses. */
  type?: string | null;
  isPaused?: boolean | null;
  startsAt?: string | null;
  endsAt?: string | null;
  scheduleJson: HealthScheduleJson;
  /** Who it's for. Not shown in the notification — see notificationText. */
  profileName?: string | null;
}

export interface LocalHealthPlan {
  /** Deterministic, so re-planning replaces rather than duplicates. */
  id: number;
  reminderId: string;
  title: string;
  body: string;
  /** A one-off instant (kind "once"). Mutually exclusive with `on`. */
  at?: Date;
  /**
   * A repeating calendar trigger. Whichever fields are present are matched and
   * the rest are wildcards, so {hour, minute} repeats daily, adding `weekday`
   * makes it weekly and adding `day` makes it monthly.
   */
  on?: { hour: number; minute: number; weekday?: number; day?: number };
  repeats: boolean;
}

/**
 * iOS keeps at most 64 pending local notifications per app and silently drops
 * the rest, so the plan is capped below that with room for anything else the
 * app may schedule locally later.
 */
export const MAX_LOCAL_HEALTH_NOTIFICATIONS = 56;

/**
 * A stable 31-bit id from the reminder's uuid plus a slot number. Must be
 * deterministic: it is the only handle for replacing or cancelling a
 * previously-scheduled notification on a later app launch, since nothing about
 * the earlier scheduling survives in our own storage.
 */
export function localNotificationId(reminderId: string, slot: number): number {
  let h = 2166136261;
  for (let i = 0; i < reminderId.length; i++) {
    h ^= reminderId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = Math.imul(h ^ slot, 16777619);
  // Keep it positive and inside a signed 32-bit int, which is what the
  // notification id has to fit into.
  return (h >>> 1) % 2_000_000_000;
}

function parseHhmm(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Deliberately says nothing specific.
 *
 * A lock screen shows a notification to whoever is holding the phone, and on
 * iOS it is visible without unlocking. Naming the medication, the dose or even
 * the person turns a reminder into a health disclosure to anyone glancing at
 * the counter. The details are one tap away in the app, behind the device
 * passcode, which is where they belong.
 *
 * Keep this generic. If a future change wants the name back, it needs an
 * explicit per-family setting, not a quiet revert.
 */
export function notificationText(r: PlannableReminder): { title: string; body: string } {
  const title =
    r.type === "appointment" ? "Appointment reminder"
    : r.type === "refill" ? "Refill reminder"
    : r.type === "medication" ? "Medication reminder"
    : "Health reminder";
  return { title, body: "Tap to see the details." };
}

/**
 * Turn a family's reminders into the exact set of local notifications this
 * device should have pending. Pure: no device, no clock beyond `now`.
 *
 * Skips anything iOS cannot usefully hold: paused reminders, ones whose end
 * date has passed, and one-off reminders already in the past.
 */
export function planLocalHealthNotifications(
  reminders: PlannableReminder[],
  now: Date = new Date(),
  max: number = MAX_LOCAL_HEALTH_NOTIFICATIONS,
): LocalHealthPlan[] {
  const out: LocalHealthPlan[] = [];

  for (const r of reminders) {
    if (out.length >= max) break;
    if (r.isPaused) continue;
    if (r.endsAt && new Date(r.endsAt).getTime() < now.getTime()) continue;

    const sched = r.scheduleJson;
    if (!sched || typeof sched !== "object") continue;
    const { title, body } = notificationText(r);

    if (sched.kind === "once") {
      const at = new Date(sched.at);
      if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) continue;
      out.push({ id: localNotificationId(r.id, 0), reminderId: r.id, title, body, at, repeats: false });
      continue;
    }

    const hm = parseHhmm((sched as { time: string }).time ?? "");
    if (!hm) continue;

    if (sched.kind === "daily") {
      out.push({ id: localNotificationId(r.id, 0), reminderId: r.id, title, body, on: hm, repeats: true });
    } else if (sched.kind === "weekly") {
      const days = Array.isArray(sched.days) ? sched.days : [];
      days.forEach((day, i) => {
        if (out.length >= max) return;
        if (!Number.isInteger(day) || day < 0 || day > 6) return;
        out.push({
          id: localNotificationId(r.id, i),
          reminderId: r.id,
          title,
          body,
          // The app stores 0 = Sunday; iOS weekdays are 1 = Sunday.
          on: { ...hm, weekday: day + 1 },
          repeats: true,
        });
      });
    } else if (sched.kind === "monthly") {
      const day = sched.dayOfMonth;
      if (!Number.isInteger(day) || day < 1 || day > 31) continue;
      out.push({
        id: localNotificationId(r.id, 0),
        reminderId: r.id,
        title,
        body,
        on: { ...hm, day },
        repeats: true,
      });
    }
  }

  return out.slice(0, max);
}

/**
 * Should the server keep sending its own push for health reminders?
 *
 * The rule is "only go quiet once iOS has confirmed it is holding every
 * reminder we asked it to hold", and it is written here, pure, because
 * getting it wrong is invisible: the app looks fine, the reminder looks
 * saved, and nothing fires.
 *
 * Before 2026-09-28 the caller suppressed the remote push on the strength of
 * having CALLED schedule(), not on iOS having accepted anything. Scheduling
 * rejects outright without notification permission — which nothing had ever
 * requested — so the device held nothing, the server had been told to stay
 * quiet, and a medication reminder simply never arrived.
 *
 * Fail towards the noisier option deliberately. A duplicate notification is a
 * small annoyance; a missed dose is the thing this feature exists to prevent.
 */
export function shouldSuppressRemoteHealthPush(
  wanted: number,
  confirmedPending: number,
): boolean {
  if (wanted === 0) return false;
  return confirmedPending === wanted;
}

/**
 * The most recent moment this reminder was due, at or before `now`.
 *
 * Needed because the device now fires reminders itself, and the server has to
 * be told WHICH dose fired so it can be acknowledged. The notification carries
 * the reminder's id; this recovers the occasion, which is the other half of
 * the key `ensureHealthReminderEvent` uses. Getting it right is what stops two
 * devices reporting the same dose as two separate events.
 *
 * Returns null when the reminder has no occurrence at or before `now` — a
 * one-off still in the future, or a schedule we cannot parse.
 */
export function lastOccurrenceAtOrBefore(
  schedule: HealthScheduleJson,
  now: Date = new Date(),
): Date | null {
  if (!schedule || typeof schedule !== "object") return null;

  if (schedule.kind === "once") {
    const at = new Date(schedule.at);
    if (Number.isNaN(at.getTime())) return null;
    return at.getTime() <= now.getTime() ? at : null;
  }

  const hm = parseHhmm((schedule as { time: string }).time ?? "");
  if (!hm) return null;

  // Walk back day by day from today. A bounded loop rather than date
  // arithmetic per kind: a month is at most 31 days and a week 7, so 40 covers
  // every shape with room to spare, and it cannot spin.
  const candidate = new Date(now);
  candidate.setHours(hm.hour, hm.minute, 0, 0);
  for (let i = 0; i < 40; i++) {
    if (candidate.getTime() <= now.getTime()) {
      if (schedule.kind === "daily") return candidate;
      if (schedule.kind === "weekly") {
        const days = Array.isArray(schedule.days) ? schedule.days : [];
        if (days.includes(candidate.getDay())) return candidate;
      }
      if (schedule.kind === "monthly" && candidate.getDate() === schedule.dayOfMonth) {
        return candidate;
      }
    }
    candidate.setDate(candidate.getDate() - 1);
  }
  return null;
}
