import { eq } from "drizzle-orm";
import { db } from "../db";
import { locationSettings } from "@workspace/db";
import { storage } from "../storage";
import { sendPushToUser } from "../lib/push";
import { expandOccurrences, healthDispatchSticks } from "../lib/healthSchedule";
import { logger } from "../lib/logger";
import { DEFAULT_TIMEZONE } from "../lib/timezone";
import { createWorkGate } from "../lib/workGate";

/**
 * The dispatcher does two things every tick:
 *   1. Walk active reminders, expand the rolling firing window in their tz,
 *      idempotently insert event rows, send push, mark fired.
 *   2. Walk snoozed events whose snoozeUntil has elapsed, re-fire them.
 *      Mark missed if older than reminder.snoozeMinutes * 4 with no ack.
 */

// Was 60s / a 5-minute window — widened to a 5-minute tick (2026-08) for the
// same reason as the other schedulers in this directory: every tick touches
// the database regardless of whether anything's due, which was preventing
// Neon's own 5-minute autosuspend from ever kicking in. FIRE_WINDOW_MINUTES
// was widened too, not just left at 5 — a 5-minute tick against an
// unchanged 5-minute window would leave ZERO safety margin (a tick landing
// even a few seconds later than exactly 5 minutes after the last one could
// miss an occurrence entirely), which matters more here than in the other
// schedulers since this one fires medication reminders. 7 minutes restores
// a real margin above the new tick interval.
const TICK_MS = 5 * 60_000;
// Catch-up window: fire if scheduled time is within the past N minutes.
// Survives short restarts and drift without re-firing the same event.
const FIRE_WINDOW_MINUTES = 7;
// Lookahead window: tiny, just covers clock skew between expansion and now.
const LOOKAHEAD_SECONDS = 30;
// After this many minutes past scheduledAt with no ack, mark missed.
const MISSED_MULTIPLIER = 4;

async function tzFor(userId: string, cache: Map<string, string>): Promise<string> {
  const hit = cache.get(userId);
  if (hit) return hit;
  const [loc] = await db
    .select()
    .from(locationSettings)
    .where(eq(locationSettings.userId, userId))
    .limit(1);
  const tz = loc?.timezone ?? DEFAULT_TIMEZONE;
  cache.set(userId, tz);
  return tz;
}

async function fireEvent(
  reminderId: string,
  eventId: string,
  userId: string,
  recipientProfileIds: string[],
  payload: { title: string; body: string },
): Promise<boolean> {
  const sent = await Promise.all(
    recipientProfileIds.map((profileId) =>
      sendPushToUser(
        { userId, profileId },
        {
          title: payload.title,
          body: payload.body,
          // openProfile matters: Home's reminder card only shows reminders for
          // the profiles currently selected, so a push about one person while
          // someone else is selected opened an app with no card to spotlight
          // at all (2026-09-14). The client selects this profile first.
          url: `/?openTab=home&openAction=healthReminders&openProfile=${encodeURIComponent(profileId)}`,
          tag: `health-${reminderId}-${eventId}`,
          data: { kind: "health-reminder", reminderId, eventId },
        },
        // Lets sendNativePush skip devices that have already scheduled this
        // reminder locally — without it, a family whose server happens to be
        // awake gets every dose notified twice on iOS.
        "healthReminder",
      ).then(() => true).catch((err) => {
        logger.warn({ err, reminderId, eventId, profileId }, "health push failed");
        return false;
      }),
    ),
  );
  return healthDispatchSticks(sent.filter(Boolean).length, recipientProfileIds.length);
}

async function dispatchDose(
  fromStatus: "pending" | "snoozed",
  reminderId: string,
  eventId: string,
  userId: string,
  recipientProfileIds: string[],
  payload: { title: string; body: string },
): Promise<void> {
  const claimed = await storage.claimHealthReminderDispatch(eventId, fromStatus);
  if (!claimed) return;
  const stuck = await fireEvent(reminderId, eventId, userId, recipientProfileIds, payload);
  if (!stuck) await storage.releaseHealthReminderDispatch(eventId, fromStatus);
}

/**
 * Deliberately says nothing specific.
 *
 * A push lands on a lock screen, which on iOS is readable without unlocking,
 * so naming the medication, the dose, the clinic or even the person turns a
 * reminder into a health disclosure to anyone in the room. The details are one
 * tap away in the app, behind the device passcode.
 *
 * Kept character-for-character in step with the on-device copy in
 * family-hub/src/lib/healthReminderPlan.ts's notificationText — the two paths
 * fire the same reminder and must not read differently.
 */
function buildPayload(reminder: { type: string; title: string; dose: string | null; location: string | null }): { title: string; body: string } {
  const title =
    reminder.type === "appointment" ? "Appointment reminder"
    : reminder.type === "refill" ? "Refill reminder"
    : reminder.type === "medication" ? "Medication reminder"
    : "Health reminder";
  return { title, body: "Tap to see the details." };
}

/**
 * @returns whether this family has any active reminders — the work gate uses
 * it to decide whether to keep the 5-minute cadence or go quiet until the
 * next hourly boundary. A household with no reminders set up stops
 * touching the database entirely; one with reminders keeps the exact cadence
 * it had, because a medication reminder's timing is not worth trading for a
 * few cents.
 */
export async function runHealthReminderTick(now: Date = new Date()): Promise<boolean> {
  const reminders = await storage.getActiveHealthReminders(now);
  if (reminders.length === 0) {
    // Still sweep: an event snoozed a moment before the last reminder was
    // deleted or paused still has to be resolved rather than left hanging.
    await processSnoozedAndMissed(now);
    return false;
  }

  const tzCache = new Map<string, string>();
  const windowStart = new Date(now.getTime() - FIRE_WINDOW_MINUTES * 60_000);
  const windowEnd = new Date(now.getTime() + LOOKAHEAD_SECONDS * 1_000);

  for (const reminder of reminders) {
    try {
      const tz = await tzFor(reminder.userId, tzCache);
      const occurrences = expandOccurrences(reminder, windowStart, windowEnd, tz);
      if (occurrences.length === 0) continue;

      const recipients =
        reminder.recipientsJson && reminder.recipientsJson.length > 0
          ? reminder.recipientsJson
          : [reminder.profileId];
      const payload = buildPayload(reminder);

      for (const scheduledAt of occurrences) {
        const { event, created } = await storage.ensureHealthReminderEvent({
          reminderId: reminder.id,
          userId: reminder.userId,
          profileId: reminder.profileId,
          scheduledAt,
        });
        // Only fire fresh "pending" rows we haven't already dispatched.
        if (!created && event.status !== "pending") continue;
        await dispatchDose("pending", reminder.id, event.id, reminder.userId, recipients, payload);
        logger.info(
          { reminderId: reminder.id, eventId: event.id, profileId: reminder.profileId },
          "Health reminder dispatched",
        );
      }
    } catch (err) {
      logger.warn({ err, reminderId: reminder.id }, "Health reminder dispatch failed");
    }
  }

  await processSnoozedAndMissed(now);
  return true;
}

async function processSnoozedAndMissed(now: Date): Promise<void> {
  // Re-fire snoozed events whose snoozeUntil has elapsed; also sweep any
  // fired-but-never-acknowledged events that are old enough to be considered
  // missed.
  const reminderCache = new Map<string, Awaited<ReturnType<typeof storage.getHealthReminder>>>();
  const getReminder = async (reminderId: string, userId: string) => {
    const key = `${userId}:${reminderId}`;
    if (reminderCache.has(key)) return reminderCache.get(key)!;
    const r = await storage.getHealthReminder(reminderId, userId);
    reminderCache.set(key, r);
    return r;
  };

  const dueSnoozed = await storage.getDueHealthReminderEvents(now);
  for (const ev of dueSnoozed) {
    try {
      const reminder = await getReminder(ev.reminderId, ev.userId);
      if (!reminder) continue;
      const recipients =
        reminder.recipientsJson && reminder.recipientsJson.length > 0
          ? reminder.recipientsJson
          : [reminder.profileId];
      const payload = buildPayload(reminder);
      const ageMs = now.getTime() - ev.scheduledAt.getTime();
      if (ageMs > reminder.snoozeMinutes * MISSED_MULTIPLIER * 60_000) {
        await storage.markHealthReminderEventMissed(ev.id);
        continue;
      }
      await dispatchDose("snoozed", reminder.id, ev.id, reminder.userId, recipients, {
        ...payload,
        title: `${payload.title} (snoozed)`,
      });
    } catch (err) {
      logger.warn({ err, eventId: ev.id }, "Snoozed re-fire failed");
    }
  }

  // Sweep stale "fired" events across all users — anything with no ack and
  // older than (snoozeMinutes * MISSED_MULTIPLIER) gets flipped to "missed".
  const reminders = await storage.getActiveHealthReminders(now);
  const userIds = Array.from(new Set(reminders.map((r) => r.userId)));
  for (const userId of userIds) {
    try {
      const fired = await storage.getHealthReminderEvents(userId, { status: "fired", limit: 200 });
      for (const ev of fired) {
        const reminder = await getReminder(ev.reminderId, ev.userId);
        if (!reminder) continue;
        const ageMs = now.getTime() - ev.scheduledAt.getTime();
        if (ageMs > reminder.snoozeMinutes * MISSED_MULTIPLIER * 60_000) {
          await storage.markHealthReminderEventMissed(ev.id);
        }
      }
    } catch (err) {
      logger.warn({ err, userId }, "Stale fired sweep failed");
    }
  }
}

let timer: NodeJS.Timeout | null = null;
const gate = createWorkGate("healthReminders");

export function startHealthReminderScheduler(): void {
  if (timer) return;
  const run = () => {
    if (!gate.shouldRun()) return;
    runHealthReminderTick()
      .then((foundWork) => gate.record(foundWork))
      .catch((err) => logger.error({ err }, "Health reminder tick failed"));
  };
  const align = (TICK_MS / 1000 - (Date.now() / 1000) % (TICK_MS / 1000)) * 1000;
  setTimeout(() => {
    run();
    timer = setInterval(run, TICK_MS);
  }, align);
  logger.info("Health reminder scheduler started");
}
