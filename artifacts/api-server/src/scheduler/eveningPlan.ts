/**
 * Adapted from Bot Life functions/src/notify/digest.ts.
 * One plan push per adult. A plan time replaces the daily brief.
 * A second pass the same day does not send again.
 */
import { eq, isNotNull } from "drizzle-orm";
import { db, profiles, locationSettings } from "@workspace/db";
import { sendPushToUser } from "../lib/push";
import { localDate, localHHMM } from "../lib/choreToday";
import { logger } from "../lib/logger";
import { createWorkGate } from "../lib/workGate";
import { DEFAULT_TIMEZONE } from "../lib/timezone";
import { storage } from "../storage";

export type PlanPush = "evening-plan" | "daily-brief";

export function pushesForProfile(profile: {
  planTime?: string | null;
  dailyBriefTime?: string | null;
  alreadySentPlan?: boolean;
}): PlanPush[] {
  if (profile.planTime) return profile.alreadySentPlan ? [] : ["evening-plan"];
  if (profile.dailyBriefTime) return ["daily-brief"];
  return [];
}

export function claimPlanSend(sentKeys: string[], profileId: string, day: string): { send: boolean; sentKeys: string[] } {
  const key = `${profileId}:${day}`;
  if (sentKeys.includes(key)) return { send: false, sentKeys };
  return { send: true, sentKeys: [...sentKeys, key] };
}

export function planKeysForClaim(saved: string[] | null | undefined, held: string[] | null | undefined): string[] {
  const keys: string[] = [];
  for (const key of [...(saved ?? []), ...(held ?? [])]) {
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

export function planBody(input: {
  isChild: boolean;
  chores: { title: string; taskType?: string | null; category?: string | null }[];
  events: { title: string; movedFrom?: string | null }[];
  dinner?: string | null;
}): string {
  const lines: string[] = [];
  for (const chore of input.chores) {
    if (chore.taskType && chore.taskType !== "todo" && chore.taskType !== "chore") continue;
    if (input.isChild && chore.category === "school_email") continue;
    lines.push(chore.title);
  }
  for (const event of input.events) {
    lines.push(event.movedFrom ? `${event.title} moved from ${event.movedFrom}` : event.title);
  }
  const dinnerLine = input.dinner ? `Dinner. ${input.dinner}` : null;
  const room = dinnerLine ? 5 : 6;
  const kept = lines.slice(0, room);
  if (dinnerLine) kept.push(dinnerLine);
  return kept.join("\n") || "Nothing on the plan.";
}

export function planOpenPath(body: string): string {
  return `/?openTab=chat&openPlan=${encodeURIComponent(body)}`;
}

const CATCH_UP_MINUTES = 30;

function nextDayKey(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function minutesSince(scheduled: string, currentHHMM: string): number {
  const [sh, sm] = scheduled.split(":").map(Number);
  const [ch, cm] = currentHHMM.split(":").map(Number);
  if ([sh, sm, ch, cm].some((n) => Number.isNaN(n))) return -1;
  return ch * 60 + cm - (sh * 60 + sm);
}

export async function runEveningPlanTick(now: Date = new Date()): Promise<boolean> {
  const candidates = await db.select().from(profiles).where(isNotNull(profiles.eveningPlanTime));
  if (candidates.length === 0) return false;
  const held = new Map<string, string[]>();
  for (const profile of candidates) {
    if (!profile.userId || !profile.eveningPlanTime) continue;
    if (pushesForProfile({ planTime: profile.eveningPlanTime, dailyBriefTime: profile.dailyBriefTime }).includes("daily-brief")) continue;
    const settings = await storage.getCalendarSettingsByUser(profile.userId);
    const loc = await db.select().from(locationSettings).where(eq(locationSettings.userId, profile.userId)).limit(1);
    const tz = loc[0]?.timezone ?? DEFAULT_TIMEZONE;
    const day = localDate(now, tz);
    const elapsed = minutesSince(profile.eveningPlanTime, localHHMM(now, tz));
    if (elapsed < 0 || elapsed > CATCH_UP_MINUTES) continue;
    const claim = claimPlanSend(planKeysForClaim(settings?.planSentKeys, held.get(profile.userId)), profile.id, day);
    if (!claim.send) continue;
    const isChild = profile.role === "child" || profile.isChild === true;
    const chores = await storage.getChoresByUser(profile.userId);
    const events = await storage.getEventsByUser(profile.userId);
    const meals = await storage.getMealsByUser(profile.userId);
    const target = profile.eveningPlanTiming === "morningOf" ? day : nextDayKey(day);
    const dinner = meals.find((meal) => meal.date === target && meal.slot === "dinner")?.name ?? null;
    const dayEvents = events
      .filter((event) => localDate(new Date(event.startTime), tz) === target)
      .map((event) => ({ title: event.title }));
    const body = planBody({ isChild, chores, events: dayEvents, dinner });
    try {
      await sendPushToUser(
        { userId: profile.userId, profileId: profile.id },
        {
          title: isChild ? "Tomorrow" : "Tomorrow's plan",
          body,
          url: planOpenPath(body),
          tag: `evening-plan-${profile.id}`,
          data: { kind: "evening-plan", profileId: profile.id, body },
        },
      );
      await storage.updateCalendarSettings({ planSentKeys: claim.sentKeys, userId: profile.userId });
      held.set(profile.userId, claim.sentKeys);
    } catch (err) {
      logger.warn({ err, profileId: profile.id }, "Evening plan failed");
    }
  }
  return true;
}

let timer: NodeJS.Timeout | null = null;
const gate = createWorkGate("eveningPlan");
const TICK_MS = 15 * 60_000;

export function startEveningPlanScheduler(): void {
  if (timer) return;
  const align = (TICK_MS / 1000 - (Date.now() / 1000) % (TICK_MS / 1000)) * 1000;
  const run = () => {
    if (!gate.shouldRun()) return;
    runEveningPlanTick()
      .then((foundWork) => gate.record(foundWork))
      .catch((err) => logger.error({ err }, "Evening plan tick failed"));
  };
  setTimeout(() => {
    run();
    timer = setInterval(run, TICK_MS);
  }, align);
}

