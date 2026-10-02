import { eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { profiles, locationSettings } from "@workspace/db";
import { sendPushToUser } from "../lib/push";
import { pushReachedSomeone } from "../lib/pushDelivery";
import { buildDailyBrief } from "../lib/dailyBrief";
import { localDate, localHHMM } from "../lib/choreToday";
import { logger } from "../lib/logger";
import { loadProfiles } from "../lib/profileRows";
import { createWorkGate } from "../lib/workGate";
import { DEFAULT_TIMEZONE } from "../lib/timezone";
import { storage } from "../storage";

// Catch-up window: fire if we're at or after the configured time but within
// this many minutes of it (handles process restarts / delayed ticks).
const CATCH_UP_MINUTES = 30;

function minutesSince(scheduled: string, currentHHMM: string): number {
  const [sh, sm] = scheduled.split(":").map(Number);
  const [ch, cm] = currentHHMM.split(":").map(Number);
  if ([sh, sm, ch, cm].some((n) => Number.isNaN(n))) return -1;
  return ch * 60 + cm - (sh * 60 + sm);
}

/** @returns whether anyone is set up for this — see lib/workGate.ts. */
export async function runDailyBriefTick(now: Date = new Date()): Promise<boolean> {
  const candidates = await loadProfiles(isNotNull(profiles.dailyBriefTime));
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
    if (!p.userId || !p.dailyBriefTime) continue;
    if (p.eveningPlanTime) continue;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.dailyBriefTime)) continue;
    const tz = tzCache.get(p.userId) ?? DEFAULT_TIMEZONE;
    const today = localDate(now, tz);
    const elapsed = minutesSince(p.dailyBriefTime, localHHMM(now, tz));
    if (elapsed < 0 || elapsed > CATCH_UP_MINUTES) continue;

    const claimKey = `${p.id}:${today}:brief`;
    let claimed = false;
    try {
      claimed = await storage.claimPlanKey(p.userId, claimKey, today);
    } catch (err) {
      logger.warn({ err, profileId: p.id }, "Daily brief claim failed");
      continue;
    }
    if (!claimed) continue;

    try {
      const brief = await buildDailyBrief(p.userId, p, now, tz);
      const result = await sendPushToUser(
        { userId: p.userId, profileId: p.id },
        {
          title: `Good morning, ${p.name}`,
          body: brief.headline,
          url: "/",
          tag: `daily-brief-${p.id}`,
          data: { kind: "daily-brief", profileId: p.id },
        },
      );
      if (!pushReachedSomeone(result)) throw new Error("Daily brief reached nobody");
      logger.info(
        { profileId: p.id, ...result, headline: brief.headline },
        "Daily brief dispatched",
      );
    } catch (err) {
      await storage.releasePlanKey(p.userId, claimKey);
      logger.warn({ err, profileId: p.id }, "Daily brief failed");
    }
  }
  // Somebody is set up for this, whether or not anything fired just now.
  return true;
}

let timer: NodeJS.Timeout | null = null;
const gate = createWorkGate("dailyBrief");

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

export function startDailyBriefScheduler(): void {
  if (timer) return;
  const align = (TICK_MS / 1000 - (Date.now() / 1000) % (TICK_MS / 1000)) * 1000;
  const run = () => {
    if (!gate.shouldRun()) return;
    runDailyBriefTick()
      .then((foundWork) => gate.record(foundWork))
      .catch((err) => logger.error({ err }, "Daily brief tick failed"));
  };
  setTimeout(() => {
    run();
    timer = setInterval(run, TICK_MS);
  }, align);
  logger.info("Daily brief scheduler started");
}
