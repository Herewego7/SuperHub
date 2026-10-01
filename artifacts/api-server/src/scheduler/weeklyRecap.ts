import { eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { profiles, locationSettings } from "@workspace/db";
import { sendPushToUser } from "../lib/push";
import { buildWeeklyRecap } from "../lib/weeklyRecap";
import { localDate, localHHMM, localDayOfWeek } from "../lib/choreToday";
import { logger } from "../lib/logger";
import { createWorkGate } from "../lib/workGate";
import { DEFAULT_TIMEZONE } from "../lib/timezone";

// dedupKey = `${profileId}:${weekKey}` — set only after a successful send.
// weekKey is the local date, so this naturally fires at most once per profile
// per calendar day, and the day-of-week gate below limits that to once a week.
const sentForWeek = new Map<string, true>();
const CATCH_UP_MINUTES = 30;

function pruneSent(now: Date) {
  const cutoff = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  for (const k of sentForWeek.keys()) {
    const date = k.split(":")[1] ?? "";
    if (date < cutoff) sentForWeek.delete(k);
  }
}

function minutesSince(scheduled: string, currentHHMM: string): number {
  const [sh, sm] = scheduled.split(":").map(Number);
  const [ch, cm] = currentHHMM.split(":").map(Number);
  if ([sh, sm, ch, cm].some((n) => Number.isNaN(n))) return -1;
  return ch * 60 + cm - (sh * 60 + sm);
}

/** @returns whether anyone is set up for this — see lib/workGate.ts. */
export async function runWeeklyRecapTick(now: Date = new Date()): Promise<boolean> {
  pruneSent(now);

  const candidates = await db
    .select()
    .from(profiles)
    .where(isNotNull(profiles.weeklyRecapTime));
  if (candidates.length === 0) return false;

  const tzCache = new Map<string, string>();
  for (const p of candidates) {
    if (!p.userId || tzCache.has(p.userId)) continue;
    const loc = await db
      .select()
      .from(locationSettings)
      .where(eq(locationSettings.userId, p.userId))
      .limit(1);
    tzCache.set(p.userId, loc[0]?.timezone ?? DEFAULT_TIMEZONE);
  }

  for (const p of candidates) {
    if (!p.userId || !p.weeklyRecapTime) continue;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.weeklyRecapTime)) continue;
    const tz = tzCache.get(p.userId) ?? DEFAULT_TIMEZONE;

    // Only fire on the configured day of week.
    if (localDayOfWeek(now, tz) !== (p.weeklyRecapDay ?? 0)) continue;

    const today = localDate(now, tz);
    const dedupKey = `${p.id}:${today}`;
    if (sentForWeek.has(dedupKey)) continue;

    const elapsed = minutesSince(p.weeklyRecapTime, localHHMM(now, tz));
    if (elapsed < 0 || elapsed > CATCH_UP_MINUTES) continue;

    try {
      const recap = await buildWeeklyRecap(p.userId, now);
      const headline = recap.topPerformer
        ? `${recap.topPerformer.name} led with ${recap.topPerformer.points} stars`
        : `${recap.totalPoints} stars earned this week`;
      const result = await sendPushToUser(
        { userId: p.userId, profileId: p.id },
        {
          title: "This week's recap is ready",
          body: headline,
          url: "/",
          tag: `weekly-recap-${p.id}-${today}`,
          data: { kind: "weekly-recap", profileId: p.id },
        },
        "weeklyRecap",
      );
      sentForWeek.set(dedupKey, true);
      logger.info({ profileId: p.id, ...result, headline }, "Weekly recap dispatched");
    } catch (err) {
      logger.warn({ err, profileId: p.id }, "Weekly recap failed");
      // do not mark sent; will retry on the next tick within the window
    }
  }
  // Somebody is set up for this, whether or not anything fired just now.
  return true;
}

let timer: NodeJS.Timeout | null = null;
const gate = createWorkGate("weeklyRecap");

// Ticks every 15 minutes, and only while there is someone to notify.
//
// Two separate levers, for two separate reasons (2026-09-16):
//   - 15 minutes, not 5: the database autosuspends after 5 minutes idle, so a
//     5-minute tick sat exactly on that boundary and left no idle margin at
//     all — the 2026-08 widening from 60s to 5min therefore bought nothing.
//     Safe here because the "is this due" check below tolerates up to
//     CATCH_UP_MINUTES (30) of drift, so this is a later average delivery
//     inside an unchanged window, not a missed send.
//   - The work gate: a family with nobody set up for this stops querying
//     altogether and only looks again on a shared hourly boundary.
const TICK_MS = 15 * 60_000;

export function startWeeklyRecapScheduler(): void {
  if (timer) return;
  const align = (TICK_MS / 1000 - (Date.now() / 1000) % (TICK_MS / 1000)) * 1000;
  const run = () => {
    if (!gate.shouldRun()) return;
    runWeeklyRecapTick()
      .then((foundWork) => gate.record(foundWork))
      .catch((err) => logger.error({ err }, "Weekly recap tick failed"));
  };
  setTimeout(() => {
    run();
    timer = setInterval(run, TICK_MS);
  }, align);
  logger.info("Weekly recap scheduler started");
}
