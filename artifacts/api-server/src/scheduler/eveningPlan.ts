/**
 * Adapted from Bot Life functions/src/notify/digest.ts.
 * One plan push per adult. A plan time replaces the daily brief.
 * A second pass the same day does not send again.
 */
import { eq, isNotNull } from "drizzle-orm";
import { db, profiles, locationSettings } from "@workspace/db";
import { sendPushToUser } from "../lib/push";
import { pushReachedSomeone } from "../lib/pushDelivery";
import { localDate, localHHMM } from "../lib/choreToday";
import { driverIdsOf } from "../lib/eventDrivers";
import { logger } from "../lib/logger";
import { createWorkGate } from "../lib/workGate";
import { DEFAULT_TIMEZONE } from "../lib/timezone";
import { loadProfiles } from "../lib/profileRows";
import { expandRecurringEvents } from "../lib/eventRecurrence";
import { eventsOnWatchedCalendars } from "../lib/calendarAssignmentScope";
import { withoutDismissedChores, withoutDismissedSlips } from "../ingest/process";
import { storage } from "../storage";
import { GoogleCalendarService } from "../googleCalendar";

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

export function planKeysForClaim(saved: string[] | null | undefined, held: string[] | null | undefined, today?: string): string[] {
  const keys: string[] = [];
  for (const key of [...(saved ?? []), ...(held ?? [])]) {
    if (!key || keys.includes(key)) continue;
    if (today) {
      const day = key.slice(key.lastIndexOf(":") + 1);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < today) continue;
    }
    keys.push(key);
  }
  return keys;
}

export function moveClock(previous: Date | null | undefined, next: Date | null | undefined, timeZone?: string): string | null {
  if (!previous || !next || previous.getTime() === next.getTime()) return null;
  if (timeZone) {
    const hhmm = localHHMM(previous, timeZone);
    if (!/^\d{2}:\d{2}$/.test(hhmm) || hhmm === "00:00" || hhmm === "24:00") return null;
    const [rawHours, minutes] = hhmm.split(":").map(Number);
    const suffix = rawHours >= 12 ? "PM" : "AM";
    const hours = rawHours % 12 || 12;
    return `${hours}:${String(minutes).padStart(2, "0")} ${suffix}`;
  }
  let hours = previous.getHours();
  const minutes = previous.getMinutes();
  const suffix = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const mm = String(minutes).padStart(2, "0");
  return `${hours}:${mm} ${suffix}`;
}

const MOVE_WINDOW_MS = 36 * 60 * 60 * 1000;

/** A move is news for a day and a half. Older notes stop repeating on every plan. */
export function moveLabel(movedFrom: string | null | undefined, now = new Date()): string | null {
  if (!movedFrom) return null;
  const [label, stamp] = movedFrom.split("\n");
  const clock = label?.trim();
  if (!clock || !stamp?.trim()) return null;
  const at = new Date(stamp.trim());
  if (Number.isNaN(at.getTime())) return null;
  const age = now.getTime() - at.getTime();
  if (age < 0 || age > MOVE_WINDOW_MS) return null;
  return clock;
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

function savedIds(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((id) => typeof id === "string")) return parsed;
  } catch {
    /* A bad assignment falls back to the connected person. */
  }
  return [];
}

/** Google events the evening plan can name. A copy the app already saved is left out. */
export function googlePlanRows(events: unknown[], profileId: string, assignments: { calendarId: string; calendarType?: string | null; profileId?: string | null; audienceProfileIds?: string[] | null; isActive?: boolean | null }[] = []): {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  source: "google";
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  profileIds: string[];
  drivingProfileIds: string[];
  googleCalendarId: string | null;
  outlookCalendarId: null;
}[] {
  const seen = new Set<string>();
  const rows = [];
  for (const item of events) {
    const event = item as {
      id?: string;
      summary?: string;
      description?: string;
      location?: string;
      start?: { date?: string; dateTime?: string };
      end?: { date?: string; dateTime?: string };
      extendedProperties?: { private?: Record<string, string> };
    };
    if (!event?.id || seen.has(event.id)) continue;
    const priv = event.extendedProperties?.private ?? {};
    if (priv.familyhub_origin) continue;
    const start = event.start?.dateTime
      ? new Date(event.start.dateTime)
      : event.start?.date
        ? new Date(`${event.start.date}T00:00:00`)
        : null;
    if (!start || Number.isNaN(start.getTime())) continue;
    seen.add(event.id);
    const end = event.end?.dateTime ? new Date(event.end.dateTime) : start;
    const assigned = savedIds(priv.familyhub_profile_ids);
    const calendarId = priv.google_calendar_id ?? null;
    const assignment = calendarId
      ? assignments.find((item) => item.calendarType === "google" && item.calendarId === calendarId && item.isActive !== false)
      : undefined;
    const audience = (assignment?.audienceProfileIds ?? []).filter((id) => id.length > 0);
    const profileIds = assigned.length > 0 ? assigned : audience.length > 0 ? audience : assignment?.profileId ? [assignment.profileId] : [profileId];
    rows.push({
      id: `google-${profileId}-${event.id}`,
      title: event.summary?.trim() || "Untitled",
      description: event.description ?? null,
      location: event.location ?? null,
      source: "google" as const,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      isAllDay: !event.start?.dateTime,
      profileIds,
      drivingProfileIds: savedIds(priv.familyhub_driving_profile_ids),
      googleCalendarId: priv.google_calendar_id ?? null,
      outlookCalendarId: null,
    });
  }
  return rows;
}

async function googleEventsForPlan(userId: string, assignments: { calendarId: string; calendarType?: string | null; profileId?: string | null; audienceProfileIds?: string[] | null; isActive?: boolean | null }[]) {
  const rows = [];
  const googleCalendar = new GoogleCalendarService();
  const people = await loadProfiles(eq(profiles.userId, userId));
  for (const person of people) {
    if (!person.googleCalendarConnected) continue;
    try {
      const tokens = await storage.getGoogleCalendarTokens(person.id);
      if (!tokens?.isActive) continue;
      const raw = await googleCalendar.getCalendarEvents(
        tokens.accessToken,
        tokens.refreshToken || undefined,
        tokens.selectedCalendarIds,
      );
      rows.push(...googlePlanRows(raw, person.id, assignments));
    } catch (err) {
      logger.warn({ err, profileId: person.id }, "Evening plan skipped Google");
    }
  }
  return rows;
}

export function eventsForPlan<T extends { profileIds?: string[] | null; drivingProfileId?: string | null; drivingProfileIds?: string[] | null }>(
  events: T[],
  profileId: string,
): T[] {
  return events.filter((event) => {
    const ids = event.profileIds ?? [];
    return ids.length === 0 || ids.includes(profileId) || driverIdsOf(event).includes(profileId);
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

/** The school to-do title, without the clock, place, or driver that got added to the line. */
export function schoolSlipTitle(title: string): string {
  const clock = title.match(/^(.*?),\s+\d{1,2}:\d{2}\s+[AP]M\b/i);
  if (clock?.[1]) return clock[1].trim();
  return title.replace(/,\s+[^,]+\s+driving$/i, "").trim();
}

export function withoutSchoolEventsHeldToday<T extends { title: string; source?: string | null }>(
  events: T[],
  heldTitles: string[],
): T[] {
  const held = new Set(heldTitles.map((title) => title.toLowerCase()));
  if (held.size === 0) return events;
  return events.filter((event) => {
    if (event.source !== "school") return true;
    return !held.has(schoolSlipTitle(event.title).toLowerCase());
  });
}

function leapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function birthdayOnDay(monthDay: string, day: string): boolean {
  const monthAndDay = day.slice(5);
  if (monthDay === monthAndDay) return true;
  if (monthDay !== "02-29" || monthAndDay !== "02-28") return false;
  return !leapYear(Number(day.slice(0, 4)));
}

function celebrationPhrase(row: { name: string; year?: number | null; type?: string | null; customLabel?: string | null }, year: number): string | null {
  const age = row.year ? year - row.year : null;
  if (row.type === "anniversary") return age && age > 0 ? `${row.name}, ${age}-year anniversary` : `${row.name}'s anniversary`;
  if (row.type === "other") {
    const label = row.customLabel?.trim();
    return label ? `${row.name}, ${label}` : row.name;
  }
  if (row.type && row.type !== "birthday") return null;
  return age && age > 0 ? `${row.name} turns ${age}` : `${row.name}'s birthday`;
}

/** The birthday or anniversary line for the plan's day. */
export function planBirthdayLine(
  rows: { name: string; monthDay: string; year?: number | null; type?: string | null; customLabel?: string | null }[],
  day: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const year = Number(day.slice(0, 4));
  const lines = rows
    .filter((row) => birthdayOnDay(row.monthDay, day))
    .map((row) => celebrationPhrase(row, year))
    .filter((line): line is string => !!line);
  if (lines.length === 0) return null;
  return `${lines.join(". ")}.`;
}

export function planBody(input: {
  isChild: boolean;
  kidName?: string | null;
  chores: { title: string; description?: string | null; taskType?: string | null; category?: string | null }[];
  events: { title: string; description?: string | null; movedFrom?: string | null; source?: string | null; driving?: boolean }[];
  dinner?: string | null;
  birthday?: string | null;
}): string {
  const rows: { text: string; change: boolean }[] = [];
  if (input.birthday) rows.push({ text: input.birthday, change: true });
  for (const chore of input.chores) {
    if (chore.taskType && chore.taskType !== "todo" && chore.taskType !== "chore") continue;
    if (input.isChild && chore.category === "school_email" && !namesPerson(`${chore.title}\n${chore.description ?? ""}`, input.kidName)) continue;
    rows.push({ text: chore.title, change: false });
  }
  for (const event of input.events) {
    if (event.source === "meal" && input.dinner) continue;
    const unnamedSchool = input.isChild && event.source === "school" && !namesPerson(`${event.title}\n${event.description ?? ""}`, input.kidName);
    if (unnamedSchool && !event.driving) continue;
    const line = event.movedFrom ? `${event.title}, moved from ${event.movedFrom}` : event.title;
    const bare = schoolSlipTitle(event.title);
    const sameSlip = event.source === "school" ? rows.findIndex((item) => item.text.toLowerCase() === bare.toLowerCase()) : -1;
    const row = { text: line, change: Boolean(event.movedFrom) };
    if (sameSlip >= 0) rows[sameSlip] = row;
    else rows.push(row);
  }
  const lines = [...rows.filter((row) => row.change), ...rows.filter((row) => !row.change)].map((row) => row.text);
  const dinnerLine = input.dinner ? `Dinner. ${input.dinner}` : null;
  const room = dinnerLine ? 5 : 6;
  const kept = lines.slice(0, room);
  if (dinnerLine) kept.push(dinnerLine);
  return kept.join("\n") || "Nothing on the plan.";
}

export function planEventTitle(title: string, drivers?: string[] | null): string {
  const names = (drivers ?? []).map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) return title;
  const pretty = names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const line = `${pretty} driving`;
  if (title.toLowerCase().includes(line.toLowerCase())) return title;
  return `${title}, ${line}`;
}

export function appendPlace(line: string, location?: string | null): string {
  const place = location?.trim();
  if (!place) return line;
  if (line.toLowerCase().includes(place.toLowerCase())) return line;
  return `${line}, ${place}`;
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
  for (const profile of candidates) {
    if (!profile.userId || !profile.eveningPlanTime) continue;
    if (pushesForProfile({ planTime: profile.eveningPlanTime, dailyBriefTime: profile.dailyBriefTime }).includes("daily-brief")) continue;
    const settings = await storage.getCalendarSettingsByUser(profile.userId);
    const loc = await db.select().from(locationSettings).where(eq(locationSettings.userId, profile.userId)).limit(1);
    const tz = loc[0]?.timezone ?? DEFAULT_TIMEZONE;
    const day = localDate(now, tz);
    const elapsed = minutesSince(profile.eveningPlanTime, localHHMM(now, tz));
    if (elapsed < 0 || elapsed > CATCH_UP_MINUTES) continue;
    const claimKey = `${profile.id}:${day}`;
    let claimed = false;
    try {
      claimed = await storage.claimPlanKey(profile.userId, claimKey, day);
    } catch (err) {
      logger.warn({ err, profileId: profile.id }, "Evening plan claim failed");
      continue;
    }
    if (!claimed) continue;
    try {
    const isChild = profile.role === "child" || profile.isChild === true;
    const chores = await storage.getChoresByUser(profile.userId);
    const completions = await storage.getChoreCompletionsByUser(profile.userId);
    const assignments = await storage.getCalendarAssignmentsByUser(profile.userId);
    const events = [...await storage.getEventsByUser(profile.userId), ...await googleEventsForPlan(profile.userId, assignments)];
    const meals = await storage.getMealsByUser(profile.userId);
    const celebrations = await storage.getCelebrationsByUser(profile.userId);
    const target = profile.eveningPlanTiming === "morningOf" ? day : nextDayKey(day);
    const dinner = meals.find((meal) => meal.date === target && meal.slot === "dinner")?.name ?? null;
    const doneToday = completions
      .filter((completion) => completion.completedAt && localDate(new Date(completion.completedAt), tz) === target)
      .map((completion) => completion.choreId);
    const finishedTodos = completions
      .filter((completion) => chores.some((chore) => chore.id === completion.choreId && chore.taskType === "todo"))
      .map((completion) => completion.choreId);
    const heldSchool = chores
      .filter((chore) => chore.category === "school_email" && doneToday.includes(chore.id))
      .map((chore) => chore.title);
    const openChores = dueForPlan(
      choresForPlan(withoutDismissedChores(chores, settings?.dismissedSlipKeys ?? []), doneToday, profile.id, finishedTodos),
      new Date(`${target}T12:00:00`),
    );
    const family = new Map((await loadProfiles(eq(profiles.userId, profile.userId))).map((person) => [person.id, person.name]));
    const dayEvents = eventsForPlan(
      eventsOnWatchedCalendars(planDayEvents(withoutDismissedSlips(events, settings?.dismissedSlipKeys ?? []), target, tz), assignments),
      profile.id,
    )
      .map((event) => ({
        title: planEventTitle(
          appendPlace(eventClockTitle(event.title, new Date(event.startTime), tz, event.isAllDay === true), event.location),
          driverIdsOf(event).map((id) => family.get(id)).filter((name): name is string => !!name),
        ),
        description: event.description,
        movedFrom: moveLabel(event.movedFrom, now),
        source: event.source,
        driving: driverIdsOf(event).includes(profile.id),
      }));
    const body = planBody({
      isChild,
      kidName: isChild ? profile.name : null,
      chores: openChores,
      events: withoutSchoolEventsHeldToday(dayEvents, heldSchool),
      dinner,
      birthday: planBirthdayLine(celebrations, target),
    });
      const result = await sendPushToUser(
        { userId: profile.userId, profileId: profile.id },
        {
          title: planTitle(isChild, profile.eveningPlanTiming),
          body,
          url: planOpenPath(body, profile.id),
          tag: `evening-plan-${profile.id}`,
          apnsCategory: "EVENING_PLAN",
          data: { kind: "evening-plan", profileId: profile.id, body },
        },
      );
      if (!pushReachedSomeone(result)) throw new Error("Evening plan reached nobody");
    } catch (err) {
      await storage.releasePlanKey(profile.userId, claimKey);
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

