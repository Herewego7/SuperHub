import { eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { profiles, locationSettings } from "@workspace/db";
import { sendPushToUser } from "../lib/push";
import {
  getTodayChoresForProfile,
  localDate,
  localHHMM,
  splitRemaining,
  describeRemaining,
} from "../lib/choreToday";
import { isKidProfile } from "../lib/profileRole";
import { logger } from "../lib/logger";
import { loadProfiles } from "../lib/profileRows";
import { createWorkGate } from "../lib/workGate";
import { DEFAULT_TIMEZONE } from "../lib/timezone";

const sentForDay = new Map<string, true>(); // `${profileId}:${localDate}`
const CATCH_UP_MINUTES = 30;

function pruneSent(now: Date) {
  const cutoff = new Date(now.getTime() - 25 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  for (const k of sentForDay.keys()) {
    const date = k.split(":")[1] ?? "";
    if (date < cutoff) sentForDay.delete(k);
  }
}

function minutesSince(scheduled: string, currentHHMM: string): number {
  const [sh, sm] = scheduled.split(":").map(Number);
  const [ch, cm] = currentHHMM.split(":").map(Number);
  if ([sh, sm, ch, cm].some((n) => Number.isNaN(n))) return -1;
  return ch * 60 + cm - (sh * 60 + sm);
}

/** @returns whether anyone is set up for this — see lib/workGate.ts. */
export async function runBedtimeRemindersTick(now: Date = new Date()): Promise<boolean> {
  pruneSent(now);

  const candidates = await db
    .select()
    .from(profiles)
    .where(isNotNull(profiles.bedtimeCutoff));
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
    if (!p.userId || !p.bedtimeCutoff) continue;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.bedtimeCutoff)) continue;
    const tz = tzCache.get(p.userId) ?? DEFAULT_TIMEZONE;
    const today = localDate(now, tz);
    const dedupKey = `${p.id}:${today}`;
    if (sentForDay.has(dedupKey)) continue;

    const elapsed = minutesSince(p.bedtimeCutoff, localHHMM(now, tz));
    if (elapsed < 0 || elapsed > CATCH_UP_MINUTES) continue;

    // A parent's OWN chore list is usually empty — what a parent actually
    // wants from a bedtime nudge is who in the family still has chores left,
    // not their own (near-always zero) count. A kid's own reminder stays
    // scoped to just their own chores, same as before. Regular/daily chores,
    // target-count chores, and Inspiration items (affirmation/verse/mission —
    // NOT actually "chores," but isChoreDueOn's own filter only excludes
    // to-dos/bonus, so these must be split out explicitly here) are all
    // called out separately — "2 chores, 1 target, 1 inspiration" instead
    // of one bare number that reads as if it's all the same kind of thing.
    let remaining: number;
    let body: string;
    if (isKidProfile(p)) {
      const { due, completedIds } = await getTodayChoresForProfile(
        p.userId,
        p.id,
        now,
        tz,
      );
      const { regular, target, inspiration } = splitRemaining(due, completedIds);
      remaining = regular + target + inspiration;
      body = `Chores remaining: ${describeRemaining(regular, target, inspiration)}`;
    } else {
      const familyProfiles = (
        await loadProfiles(eq(profiles.userId, p.userId))
      ).filter((fp) => !fp.isAllFamilyProfile);
      const byPerson: { name: string; regular: number; target: number; inspiration: number }[] = [];
      let total = 0;
      for (const fp of familyProfiles) {
        const { due, completedIds } = await getTodayChoresForProfile(p.userId, fp.id, now, tz);
        const { regular, target, inspiration } = splitRemaining(due, completedIds);
        total += regular + target + inspiration;
        if (regular + target + inspiration > 0) byPerson.push({ name: fp.name, regular, target, inspiration });
      }
      remaining = total;
      body = byPerson.length > 0
        ? `Chores remaining: ${byPerson.map((x) => `${x.name} — ${describeRemaining(x.regular, x.target, x.inspiration)}`).join(", ")}`
        : "";
    }
    if (remaining <= 0) {
      // Nothing to remind about — still mark sent so we don't re-check all
      // day, since the count won't change retroactively.
      sentForDay.set(dedupKey, true);
      continue;
    }

    try {
      const result = await sendPushToUser(
        { userId: p.userId, profileId: p.id },
        {
          title: `${p.name}, time for bed soon`,
          body,
          // Entire content is "N chores left" — no ambiguity, so this opens
          // straight to Chores instead of wherever the app happens to
          // launch on. Web reads the query param directly; native ignores
          // `url` entirely and instead routes off `data.kind` below (see
          // nativeNotifications.ts).
          url: "/?openTab=chores",
          tag: `bedtime-${p.id}`,
          data: { kind: "bedtime-reminder", profileId: p.id, remaining },
        },
      );
      sentForDay.set(dedupKey, true);
      logger.info(
        { profileId: p.id, remaining, ...result },
        "Bedtime reminder dispatched",
      );
    } catch (err) {
      logger.warn({ err, profileId: p.id }, "Bedtime reminder failed");
    }
  }
  // Somebody is set up for this, whether or not anything fired just now.
  return true;
}

let timer: NodeJS.Timeout | null = null;
const gate = createWorkGate("bedtimeReminders");

// Ticks every 15 minutes, and only while there is someone to notify.
//
// Two separate levers, for two separate reasons (2026-09-16):
//   - 15 minutes, not 5: the database autosuspends after 5 minutes idle, so a
//     5-minute tick sat exactly on that boundary and left no idle margin at
//     all — the 2026-08 widening from 60s to 5min therefore bought nothing.
//     Safe here because the "is this due" check tolerates up to
//     CATCH_UP_MINUTES (30) of drift, so this is a later average delivery
//     inside an unchanged window, not a missed send.
//   - The work gate: a family with nobody set up for this stops querying
//     altogether and only looks again on a shared hourly boundary.
const TICK_MS = 15 * 60_000;

export function startBedtimeReminderScheduler(): void {
  if (timer) return;
  const align = (TICK_MS / 1000 - (Date.now() / 1000) % (TICK_MS / 1000)) * 1000;
  const run = () => {
    if (!gate.shouldRun()) return;
    runBedtimeRemindersTick()
      .then((foundWork) => gate.record(foundWork))
      .catch((err) => logger.error({ err }, "Bedtime reminder tick failed"));
  };
  setTimeout(() => {
    run();
    timer = setInterval(run, TICK_MS);
  }, align);
  logger.info("Bedtime reminder scheduler started");
}
