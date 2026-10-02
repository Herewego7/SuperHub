import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { behaviourIncidents } from "@workspace/db";
import { sendPushToUser } from "../lib/push";
import { getFamilyMemberAccountIds } from "../familyService";
import { logger } from "../lib/logger";
import { createWorkGate } from "../lib/workGate";

// Unlike the daily-brief/bedtime schedulers (which fire at an absolute local
// time), this fires relative to each incident's own timerEndsAt — so instead
// of an in-memory dedup map keyed by day, dedup is persisted on the incident
// row itself (reminderFiredAt / timerExpiredPushFiredAt). This is important
// because incidents are created and resolved continuously throughout the day
// (not once daily), so an in-memory-only map would double-send across a
// process restart in a way the absolute-time schedulers don't risk.
const FIVE_MIN_MS = 5 * 60 * 1000;
const TOLERANCE_MS = 60_000; // one tick's worth of slack around the 5-min mark

async function claimReminder(id: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(behaviourIncidents)
    .set({ reminderFiredAt: now })
    .where(and(eq(behaviourIncidents.id, id), isNull(behaviourIncidents.reminderFiredAt)))
    .returning({ id: behaviourIncidents.id });
  return rows.length > 0;
}

async function releaseReminder(id: string, now: Date): Promise<void> {
  await db
    .update(behaviourIncidents)
    .set({ reminderFiredAt: null })
    .where(and(eq(behaviourIncidents.id, id), eq(behaviourIncidents.reminderFiredAt, now)));
}

async function claimExpired(id: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(behaviourIncidents)
    .set({ timerExpiredPushFiredAt: now })
    .where(and(eq(behaviourIncidents.id, id), isNull(behaviourIncidents.timerExpiredPushFiredAt)))
    .returning({ id: behaviourIncidents.id });
  return rows.length > 0;
}

async function releaseExpired(id: string, now: Date): Promise<void> {
  await db
    .update(behaviourIncidents)
    .set({ timerExpiredPushFiredAt: null })
    .where(and(eq(behaviourIncidents.id, id), eq(behaviourIncidents.timerExpiredPushFiredAt, now)));
}

/**
 * @returns whether there was anything pending — the work gate uses this to
 * decide whether to keep ticking every minute or go quiet until the next
 * hourly boundary.
 */
export async function runBehaviourTimerTick(now: Date = new Date()): Promise<boolean> {
  const active = await db
    .select()
    .from(behaviourIncidents)
    .where(eq(behaviourIncidents.status, "positive_pending"));
  if (active.length === 0) return false;

  for (const incident of active) {
    const remaining = new Date(incident.timerEndsAt).getTime() - now.getTime();

    // 5-minutes-remaining reminder — fires once, within a 1-minute tolerance
    // window around the 5-minute mark (this tick runs every 60s).
    if (
      !incident.reminderFiredAt &&
      remaining > 0 &&
      remaining <= FIVE_MIN_MS + TOLERANCE_MS
    ) {
      let claimed = false;
      try {
        claimed = await claimReminder(incident.id, now);
      } catch (err) {
        logger.warn({ err, incidentId: incident.id }, "Behaviour 5-min claim failed");
      }
      if (claimed) {
        try {
          await sendPushToUser(
            { userId: incident.userId, profileId: incident.profileId },
            {
              title: "⏱ 5 minutes left",
              body: `Finish "${incident.positiveConsequence}" to resolve`,
              url: "/",
              tag: `behaviour-timer-5min-${incident.id}`,
              data: { kind: "behaviour-timer-5min", incidentId: incident.id, profileId: incident.profileId },
            },
            "behaviourTimer",
          );
        } catch (err) {
          await releaseReminder(incident.id, now);
          logger.warn({ err, incidentId: incident.id }, "Behaviour 5-min reminder failed");
        }
      }
    }

    // Timer expired — notify the profile AND every parent, since the parent
    // needs to actually enforce the consequence.
    if (!incident.timerExpiredPushFiredAt && remaining <= 0) {
      let claimed = false;
      try {
        claimed = await claimExpired(incident.id, now);
      } catch (err) {
        logger.warn({ err, incidentId: incident.id }, "Behaviour timer-expired claim failed");
      }
      if (claimed) {
        try {
          const memberIds = await getFamilyMemberAccountIds(incident.userId);
          const payload = {
            title: "⏱ Time's up!",
            body: `Apply consequence: ${incident.negativeConsequence}`,
            url: "/",
            tag: `behaviour-timer-expired-${incident.id}`,
            data: { kind: "behaviour-timer-expired", incidentId: incident.id, profileId: incident.profileId },
          };
          await Promise.all([
            sendPushToUser({ userId: incident.userId, profileId: incident.profileId }, payload, "behaviourTimer"),
            ...memberIds.map((memberId) => sendPushToUser({ userId: memberId }, payload, "behaviourTimer")),
          ]);
        } catch (err) {
          await releaseExpired(incident.id, now);
          logger.warn({ err, incidentId: incident.id }, "Behaviour timer-expired notification failed");
        }
      }
    }
  }
  return true;
}

let timer: NodeJS.Timeout | null = null;
const gate = createWorkGate("behaviourTimers");

/**
 * ⚠️ This ticks every SIXTY SECONDS while a timer is running, and that is
 * correct — a "5 minutes left" warning has to land within a minute of the
 * five-minute mark. What was wrong was doing it around the clock for families
 * with no incident open, which is nearly all of them nearly all of the time:
 * one query a minute is enough on its own to stop the database ever
 * suspending, which is what made the 2026-08 widening of the OTHER four
 * schedulers change nothing at all.
 *
 * With the gate, a family that never opens an incident never polls: the first
 * tick finds nothing, and the next look is an hour later. Creating an
 * incident marks the gate dirty, so the minute-by-minute cadence resumes on
 * the next tick rather than waiting for that boundary.
 */
export function startBehaviourTimerScheduler(): void {
  if (timer) return;
  const run = () => {
    if (!gate.shouldRun()) return;
    runBehaviourTimerTick()
      .then((foundWork) => gate.record(foundWork))
      .catch((err) => logger.error({ err }, "Behaviour timer tick failed"));
  };
  const align = (60 - (Date.now() / 1000) % 60) * 1000;
  setTimeout(() => {
    run();
    timer = setInterval(run, 60_000);
  }, align);
  logger.info("Behaviour timer scheduler started");
}
