import { eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { entitlements } from "@workspace/db";
import { sendPushToUser } from "../lib/push";
import { isEnforcementEnabled, decideTrialReminder, TrialReminderKind } from "../lib/subscriptionEntitlement";
import { logger } from "../lib/logger";

// Free-trial-then-subscribe (2026-08 launch plan): the 3 trial-countdown
// reminders the user explicitly asked for — 7 days left, 2 days left, 1 day
// left ("expires tomorrow") — each encouraging sign-up now and explicitly
// stating they won't be charged until the trial is actually over.
//
// Deliberately sent with NO NotificationCategory (see lib/push.ts's
// sendPushToUser) — these are not part of the opt-out notification-type
// checklist, per the user's explicit request that this be non-toggleable;
// a family shouldn't be able to silence "your trial is about to end" the way
// they can silence a chore-assigned push.
//
// Dedup is persisted per-account, per-kind (trial7dReminderSentAt/
// trial2dReminderSentAt/trial1dReminderSentAt on the entitlements row) — the
// same "never re-derive from the current instant, always check a persisted
// flag" pattern already used by celebrationReminders/behaviourTimers, so a
// late-running or restarted scheduler tick can never double-send.
//
// Runs even while SUBSCRIPTION_ENFORCEMENT_ENABLED is false — the reminders
// themselves are informational (and harmless either way), and keeping them
// live independent of the kill switch means the whole reminder pipeline gets
// exercised in production well before enforcement is ever flipped on, so any
// bug in the push copy/timing is caught long before it could ever gate
// anyone out of the app.

const FIELD_BY_KIND: Record<TrialReminderKind, "trial7dReminderSentAt" | "trial2dReminderSentAt" | "trial1dReminderSentAt"> = {
  "7d": "trial7dReminderSentAt",
  "2d": "trial2dReminderSentAt",
  "1d": "trial1dReminderSentAt",
};

const COPY: Record<TrialReminderKind, { title: string; body: string }> = {
  "7d": {
    title: "1 week left in your free trial",
    body: "Your Family Hub+ free trial ends in 7 days. Subscribe now to keep everything running — you won't be charged until your trial is over.",
  },
  "2d": {
    title: "2 days left in your free trial",
    body: "Your Family Hub+ free trial ends in 2 days. Subscribe now so nothing interrupts your family — you won't be charged until your trial is over.",
  },
  "1d": {
    title: "Your free trial expires tomorrow",
    body: "Your Family Hub+ free trial expires tomorrow. Subscribe now to keep going without interruption — you won't be charged until your trial is over.",
  },
};

export async function runTrialReminderTick(now: Date = new Date()): Promise<void> {
  // Only ever look at real, currently-running trials — comped and
  // already-subscribed accounts never have anything to remind them about.
  const rows = await db
    .select()
    .from(entitlements)
    .where(isNotNull(entitlements.trialEndsAt));

  for (const row of rows) {
    if (row.isComped || !row.trialEndsAt) continue;

    const kind = decideTrialReminder(row.trialEndsAt, now, {
      d7: !!row.trial7dReminderSentAt,
      d2: !!row.trial2dReminderSentAt,
      d1: !!row.trial1dReminderSentAt,
    });
    if (!kind) continue;

    const field = FIELD_BY_KIND[kind];
    try {
      const payload = {
        ...COPY[kind],
        url: "/?openTab=home&openAction=trialReminder",
        tag: `trial-reminder-${row.userId}-${kind}`,
        data: { kind: "trial-reminder", trialReminderKind: kind },
      };
      await sendPushToUser({ userId: row.userId }, payload);
      await db
        .update(entitlements)
        .set({ [field]: now, updatedAt: new Date() })
        .where(eq(entitlements.userId, row.userId));
      logger.info({ userId: row.userId, kind }, "Trial reminder dispatched");
    } catch (err) {
      logger.warn({ err, userId: row.userId, kind }, "Trial reminder failed");
      // don't mark sent — retry next tick
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startTrialReminderScheduler(): void {
  if (timer) return;
  const TICK_MS = 60 * 60 * 1000; // hourly — a day-granularity feature, same cadence as celebrationReminders
  const tick = () => runTrialReminderTick().catch((err) => logger.error({ err }, "Trial reminder tick failed"));
  tick();
  timer = setInterval(tick, TICK_MS);
  logger.info({ enforcementEnabled: isEnforcementEnabled() }, "Trial reminder scheduler started");
}
