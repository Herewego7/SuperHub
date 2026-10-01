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
import { loadProfiles } from "../lib/profileRows";
import { expandRecurringEvents } from "../lib/eventRecurrence";
import { eventsOnWatchedCalendars } from "../lib/calendarAssignmentScope";
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

export function moveClock(previous: Date | null | undefined, next: Date | null | undefined): string | null {
  if (!previous || !next || previous.getTime() === next.getTime()) return null;
  let hours = previous.getHours();
  const minutes = previous.getMinutes();
  const suffix = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const mm = String(minutes).padStart(2, "0");
  return `${hours}:${mm} ${suffix}`;
}

export function dueForPlan<T extends {
  taskType?: string | null;
  isActive?: boolean | null;
  daysOfWeek?: number[] | null;
  recurrenceType?: string | null;
  targetCount?: number | null;
  endDate?: Date | string | null;
}>(chores: T[], target: Date): T[] {
  const start = new Date(target);
  start.setHours(0, 0, 0, 0);
  return chores.filter((chore) => {
    if (chore.isActive === false) return false;
    if (chore.taskType === "todo") return true;
    if (chore.taskType && chore.taskType !== "chore") return false;
    if (chore.endDate && new Date(chore.endDate) < start) return false;
    if (chore.targetCount && chore.targetCount > 0) return true;
    if (chore.recurrenceType === "daily") return true;
    return (chore.daysOfWeek ?? []).includes(start.getDay());
  });
}

export function eventsForPlan<T extends { profileIds?: string[] | null; drivingProfileIds?: string[] | null }>(
  events: T[],
  profileId: string,
): T[] {
  return events.filter((event) => {
    const ids = event.profileIds ?? [];
    const drivers = event.drivingProfileIds ?? [];
    return ids.length === 0 || ids.includes(profileId) || drivers.includes(profileId);
  });
}

export function choresForPlan<T extends { id: string; profileIds?: string[] | null; taskType?: string | null }>(
  chores: T[],
  completedIds: string[],
  profileId: string,
  finishedTodoIds: string[] = [],
): T[] {
  const done = new Set(completedIds);
  const finished = new Set(finishedTodoIds);
  return chores.filter((chore) => {
    if (done.has(chore.id)) return false;
    if (chore.taskType === "todo" && finished.has(chore.id)) return false;
    const ids = chore.profileIds ?? [];
    return ids.length === 0 || ids.includes(profileId);
  });
}

function namesPerson(text: string, name: string | null | undefined): boolean {
  const who = name?.trim();
  if (!who) return false;
  const escaped = who.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

export function planBody(input: {
  isChild: boolean;
  kidName?: string | null;
  chores: { title: string; description?: string | null; taskType?: string | null; category?: string | null }[];
  events: { title: string; description?: string | null; movedFrom?: string | null; source?: string | null }[];
  dinner?: string | null;
}): string {
  const lines: string[] = [];
  for (const chore of input.chores) {
    if (chore.taskType && chore.taskType !== "todo" && chore.taskType !== "chore") continue;
    if (input.isChild && chore.category === "school_email" && !namesPerson(`${chore.title}\n${chore.description ?? ""}`, input.kidName)) continue;
    lines.push(chore.title);
  }
  for (const event of input.events) {
    if (input.isChild && event.source === "school" && !namesPerson(`${event.title}\n${event.description ?? ""}`, input.kidName)) continue;
    lines.push(event.movedFrom ? `${event.title} moved from ${event.movedFrom}` : event.title);
  }
  const dinnerLine = input.dinner ? `Dinner. ${input.dinner}` : null;
  const room = dinnerLine ? 5 : 6;
  const kept = lines.slice(0, room);
  if (dinnerLine) kept.push(dinnerLine);
  return kept.join("\n") || "Nothing on the plan.";
}

export function eventClockTitle(title: string, startTime: Date, tz: string, allDay = false): string {
  if (allDay) return title;
  const hhmm = localHHMM(startTime, tz);
  if (!/^\d{2}:\d{2}$/.test(hhmm) || hhmm === "00:00") return title;
  const [rawHours, minutes] = hhmm.split(":").map(Number);
  const suffix = rawHours >= 12 ? "PM" : "AM";
  const hours = rawHours % 12 || 12;
  return `${title}, ${hours}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export function planDayEvents<T extends Parameters<typeof expandRecurringEvents>[0][number]>(
  events: T[],
  target: string,
  tz: string,
  now?: Date,
): T[] {
  return expandRecurringEvents(events, now).filter((event) => localDate(new Date(event.startTime), tz) === target) as T[];
}

export function planTitle(isChild: boolean, timing: string | null | undefined): string {
  const today = timing === "morningOf";
  if (isChild) return today ? "Today" : "Tomorrow";
  return today ? "Today's plan" : "Tomorrow's plan";
}

export function planOpenPath(body: string, profileId?: string): string {
  const person = profileId ? `&openProfile=${encodeURIComponent(profileId)}` : "";
  return `/?openTab=chat&openPlan=${encodeURIComponent(body)}${person}`;
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
  const candidates = await loadProfiles(isNotNull(profiles.eveningPlanTime));
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
    const completions = await storage.getChoreCompletionsByUser(profile.userId);
    const events = await storage.getEventsByUser(profile.userId);
    const meals = await storage.getMealsByUser(profile.userId);
    const target = profile.eveningPlanTiming === "morningOf" ? day : nextDayKey(day);
    const dinner = meals.find((meal) => meal.date === target && meal.slot === "dinner")?.name ?? null;
    const doneToday = completions
      .filter((completion) => completion.completedAt && localDate(new Date(completion.completedAt), tz) === target)
      .map((completion) => completion.choreId);
    const finishedTodos = completions
      .filter((completion) => chores.some((chore) => chore.id === completion.choreId && chore.taskType === "todo"))
      .map((completion) => completion.choreId);
    const openChores = dueForPlan(choresForPlan(chores, doneToday, profile.id, finishedTodos), new Date(`${target}T12:00:00`));
    const assignments = await storage.getCalendarAssignmentsByUser(profile.userId);
    const dayEvents = eventsForPlan(eventsOnWatchedCalendars(planDayEvents(events, target, tz), assignments), profile.id)
      .map((event) => ({
        title: event.movedFrom ? event.title : eventClockTitle(event.title, new Date(event.startTime), tz, event.isAllDay === true),
        description: event.description,
        movedFrom: event.movedFrom,
        source: event.source,
      }));
    const body = planBody({ isChild, kidName: isChild ? profile.name : null, chores: openChores, events: dayEvents, dinner });
    try {
      await sendPushToUser(
        { userId: profile.userId, profileId: profile.id },
        {
          title: planTitle(isChild, profile.eveningPlanTiming),
          body,
          url: planOpenPath(body, profile.id),
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

