/** What Home shows for one day. A shared to-do is one chore row, however many people are on it. */
import { withoutUnwatched, type AssignmentLike } from "./outlookAttribution";
import { driverIdsOf } from "./eventDrivers";

export type HomeTodo = {
  id: string;
  taskType: string;
  profileIds: string[];
  isActive?: boolean | null;
};

export function visibleForProfiles<T extends { profileIds?: string[] | null; drivingProfileId?: string | null; drivingProfileIds?: string[] | null }>(rows: T[], selectedIds: string[]): T[] {
  if (selectedIds.length === 0) return rows;
  return rows.filter((row) => {
    const ids = row.profileIds ?? [];
    if (ids.length === 0) return true;
    return ids.some((id) => selectedIds.includes(id)) || driverIdsOf(row).some((id) => selectedIds.includes(id));
  });
}

export function chatVisibleEvents<T extends {
  profileIds?: string[] | null;
  drivingProfileIds?: string[] | null;
  title: string;
  description?: string | null;
  category?: string | null;
  source?: string | null;
  googleCalendarId?: string | null;
  outlookCalendarId?: string | null;
}>(
  events: T[],
  assignments: readonly Pick<AssignmentLike, "calendarId" | "watched" | "isActive">[],
  selectedIds: string[],
  kidName: string | null,
): T[] {
  return visibleForProfiles(withoutUnwatched(events, assignments), selectedIds).filter((event) => mailVisibleToKid(event, kidName));
}

/** Visible events, plus a school drive the selected kid is listed on. The email text stays out of the plan. */
export function eventsForDrivingQuestion<T extends {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  source?: string | null;
  profileIds?: string[] | null;
  drivingProfileId?: string | null;
  drivingProfileIds?: string[] | null;
  googleCalendarId?: string | null;
  outlookCalendarId?: string | null;
}>(
  events: T[],
  assignments: readonly Pick<AssignmentLike, "calendarId" | "watched" | "isActive">[],
  selectedIds: string[],
  kidName: string | null,
): T[] {
  const visible = chatVisibleEvents(events, assignments, selectedIds, kidName);
  if (!kidName) return visible;
  const seen = new Set(visible.map((event) => event.id));
  const drives = withoutUnwatched(events, assignments).filter((event) => {
    if (seen.has(event.id)) return false;
    if (event.source !== "school") return false;
    if (mailVisibleToKid(event, kidName)) return false;
    return driverIdsOf(event).some((id) => selectedIds.includes(id));
  });
  return [...visible, ...drives];
}

export function eventsForDayPlan<T extends {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  source?: string | null;
  profileIds?: string[] | null;
  drivingProfileId?: string | null;
  drivingProfileIds?: string[] | null;
  googleCalendarId?: string | null;
  outlookCalendarId?: string | null;
}>(
  events: T[],
  assignments: readonly Pick<AssignmentLike, "calendarId" | "watched" | "isActive">[],
  selectedIds: string[],
  kidName: string | null,
): T[] {
  return eventsForDrivingQuestion(events, assignments, selectedIds, kidName);
}

export function todosForHome<T extends HomeTodo>(chores: T[], selectedIds: string[], familyIds: string[]): T[] {
  const todos = chores.filter((chore) => chore.taskType === "todo" && chore.isActive !== false);
  const allSelected = familyIds.length > 0 && familyIds.every((id) => selectedIds.includes(id));
  const pool = allSelected
    ? todos.filter((todo) => todo.profileIds.length !== 1)
    : todos.filter((todo) => todo.profileIds.length === 0 || todo.profileIds.some((id) => selectedIds.includes(id)));
  const seen = new Set<string>();
  return pool.filter((todo) => {
    if (seen.has(todo.id)) return false;
    seen.add(todo.id);
    return true;
  });
}

/** A to-do with any completion is done. It does not come back the next day. */
export function openTodos<T extends { id: string }>(todos: T[], completions: { choreId: string }[]): T[] {
  const done = new Set(completions.map((completion) => completion.choreId));
  return todos.filter((todo) => !done.has(todo.id));
}

const NOT_A_CHORE = new Set(["todo", "memory_verse", "affirmation", "bible_verse", "mission", "custom"]);

/** All Family shows the household. One person sees only what they finished. */
export function earlierForHome<T extends { profileId?: string | null; completedAt?: Date | string | null }>(
  completions: T[],
  selectedIds: string[],
  familyIds: string[],
  day: Date,
): T[] {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const allSelected = familyIds.length > 0 && familyIds.every((id) => selectedIds.includes(id));
  return completions.filter((completion) => {
    if (!completion.completedAt) return false;
    const at = new Date(completion.completedAt);
    if (at < start || at >= end) return false;
    if (selectedIds.length === 0 || allSelected) return true;
    return !!completion.profileId && selectedIds.includes(completion.profileId);
  });
}

/** All Family counts the household. One person counts only their chores. */
export function choresForCount<T extends { profileIds: string[] }>(chores: T[], selectedIds: string[], familyIds: string[]): T[] {
  const allSelected = familyIds.length > 0 && familyIds.every((id) => selectedIds.includes(id));
  if (selectedIds.length === 0 || allSelected) return chores;
  return chores.filter((chore) => chore.profileIds.length === 0 || chore.profileIds.some((id) => selectedIds.includes(id)));
}

export function choreProgress(
  chores: Array<HomeTodo & { daysOfWeek?: number[]; recurrenceType?: string | null; targetCount?: number | null; endDate?: Date | string | null }>,
  completions: Array<{ choreId: string; completedAt?: Date | string | null }>,
  day: Date,
): { done: number; total: number } {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const due = chores.filter((chore) => {
    if (chore.isActive === false) return false;
    if (NOT_A_CHORE.has(chore.taskType)) return false;
    if (chore.targetCount && chore.targetCount > 0) return false;
    if (chore.endDate && new Date(chore.endDate) < start) return false;
    if (chore.recurrenceType === "daily") return true;
    return (chore.daysOfWeek ?? []).includes(start.getDay());
  });
  const doneIds = new Set(
    completions
      .filter((completion) => {
        if (!completion.completedAt) return false;
        const at = new Date(completion.completedAt);
        return at >= start && at < end;
      })
      .map((completion) => completion.choreId),
  );
  return { done: due.filter((chore) => doneIds.has(chore.id)).length, total: due.length };
}

export type HorizonEvent = {
  id: string;
  title: string;
  startTime: Date | string;
  recurrenceType?: string | null;
  recurringEventId?: string | null;
  source?: string | null;
};

const SPECIAL_DAY = /\b(birthday|bday|anniversary|holiday|graduation|recital|tournament|picture day)\b/i;

/** A series that comes around at least weekly is a routine. A birthday is not. */
export function routineSeriesIds(events: HorizonEvent[]): Set<string> {
  const bySeries = new Map<string, number[]>();
  for (const event of events) {
    const series = event.recurringEventId;
    if (!series || SPECIAL_DAY.test(event.title)) continue;
    const at = new Date(event.startTime);
    at.setHours(0, 0, 0, 0);
    if (Number.isNaN(at.getTime())) continue;
    const days = bySeries.get(series) ?? [];
    if (!days.includes(at.getTime())) days.push(at.getTime());
    bySeries.set(series, days);
  }
  const routine = new Set<string>();
  for (const [series, days] of bySeries) {
    const ordered = [...days].sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < ordered.length; i++) {
      const gap = Math.round((ordered[i] - ordered[i - 1]) / 86400000);
      if (gap > 0) gaps.push(gap);
    }
    gaps.sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor((gaps.length - 1) / 2)] : Infinity;
    if (median <= 8) routine.add(series);
  }
  return routine;
}

/** Open school mail stays on the to-do. One checked off today stays off Today so it does not reappear. */
export function schoolSlipsHeldOnHome<T extends { id: string; title: string; category?: string | null }>(
  todos: T[],
  completions: { choreId: string; completedAt?: Date | string | null }[],
  day: Date,
): T[] {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const anyDone = new Set(completions.map((completion) => completion.choreId));
  const doneToday = new Set(
    completions.filter((completion) => {
      if (!completion.completedAt) return false;
      const at = new Date(completion.completedAt);
      return at >= start && at < end;
    }).map((completion) => completion.choreId),
  );
  return todos.filter((todo) => {
    if (todo.category !== "school_email") return false;
    if (!anyDone.has(todo.id)) return true;
    return doneToday.has(todo.id);
  });
}

export function schoolEventClock(
  title: string,
  events: { title: string; startTime: Date | string; source?: string | null; isAllDay?: boolean | null }[],
  day: Date,
): string | null {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const event = events.find((item) => {
    if (item.source !== "school" || item.title.toLowerCase() !== title.toLowerCase()) return false;
    const at = new Date(item.startTime);
    return at >= start && at < end;
  });
  if (!event || event.isAllDay) return null;
  const at = new Date(event.startTime);
  if (at.getHours() === 0 && at.getMinutes() === 0) return null;
  let hours = at.getHours();
  const suffix = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${String(at.getMinutes()).padStart(2, "0")} ${suffix}`;
}

export function eventsOnHomeDay<T extends {
  startTime: Date | string;
  source?: string | null;
  title: string;
  description?: string | null;
  category?: string | null;
}>(events: T[], day: Date, kidName: string | null, dinner: string | null, todos: { title: string; category?: string | null }[] = []): T[] {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const slips = new Set(todos.filter((todo) => todo.category === "school_email").map((todo) => todo.title.toLowerCase()));
  return events.filter((event) => {
    if (event.source === "meal" && dinner) return false;
    if (event.source === "school" && slips.has(event.title.toLowerCase())) return false;
    const at = new Date(event.startTime);
    return at >= start && at < end && mailVisibleToKid(event, kidName);
  });
}

/** A school event that never says the kid's name still shows when that kid is driving. */
export function drivesOnHomeDay<T extends {
  title: string;
  description?: string | null;
  source?: string | null;
  category?: string | null;
  startTime: Date | string;
  drivingProfileId?: string | null;
  drivingProfileIds?: string[] | null;
  recurringEventId?: string | null;
}>(events: T[], day: Date, selectedIds: string[], kidName: string | null): T[] {
  if (!kidName) return [];
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const todayEnd = new Date(start);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const until = new Date(start);
  until.setDate(until.getDate() + 8);
  const routine = routineSeriesIds(events);
  return events.filter((event) => {
    if (event.source !== "school") return false;
    const at = new Date(event.startTime);
    if (at < start || at >= until) return false;
    if (event.recurringEventId && routine.has(event.recurringEventId) && at >= todayEnd) return false;
    if (mailVisibleToKid(event, kidName)) return false;
    const drivers = driverIdsOf(event);
    if (selectedIds.length === 0) return drivers.length > 0;
    return drivers.some((id) => selectedIds.includes(id));
  });
}

function celebrationDate(year: number, monthDay: string): Date | null {
  const match = monthDay.match(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  if (!match) return null;
  const month = Number(match[1]);
  const date = new Date(year, month - 1, Number(match[2]));
  date.setHours(0, 0, 0, 0);
  if (date.getMonth() !== month - 1) return new Date(year, 1, 28);
  return date;
}

/** Birthdays after the viewed day, through the same week Horizon uses. Today stays on the Home line. */
export function horizonBirthdays(
  rows: { name: string; monthDay: string; year?: number | null; type?: string | null }[],
  day: Date,
): { id: string; title: string; startTime: Date }[] {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const from = new Date(start);
  from.setDate(from.getDate() + 1);
  const until = new Date(start);
  until.setDate(until.getDate() + 8);
  const found: { id: string; title: string; startTime: Date }[] = [];
    for (const row of rows) {
    if (row.type && row.type !== "birthday" && row.type !== "anniversary") continue;
    let date = celebrationDate(from.getFullYear(), row.monthDay);
    if (!date) continue;
    if (date < from) date = celebrationDate(from.getFullYear() + 1, row.monthDay);
    if (!date || date < from || date >= until) continue;
    const title = celebrationPhrase(row, date.getFullYear());
    if (!title) continue;
    found.push({ id: `birthday-${row.name}-${row.monthDay}`, title, startTime: date });
  }
  return found.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

export function horizonEvents<T extends HorizonEvent>(events: T[], day: Date): T[] {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const from = new Date(start);
  from.setDate(from.getDate() + 1);
  const until = new Date(start);
  until.setDate(until.getDate() + 8);
  const routine = routineSeriesIds(events);
  return events.filter((event) => {
    if (event.source === "meal") return false;
    if (event.recurrenceType === "daily" || event.recurrenceType === "weekly") return false;
    if (event.recurringEventId && routine.has(event.recurringEventId)) return false;
    const at = new Date(event.startTime);
    return at >= from && at < until;
  });
}

/** A kid's list hides school mail that does not name them. Everyone else sees it. */
export function mailVisibleToKid(
  row: { title: string; description?: string | null; category?: string | null; source?: string | null },
  kidName: string | null,
): boolean {
  if (!kidName) return true;
  if (row.category !== "school_email" && row.source !== "school") return true;
  return schoolEmailNames({ title: row.title, description: row.description, category: "school_email" }, kidName);
}

export function schoolEmailNames(
  todo: { title: string; description?: string | null; category?: string | null },
  kidName: string,
): boolean {
  if (todo.category !== "school_email") return true;
  const name = kidName.trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(`${todo.title}\n${todo.description ?? ""}`);
}

function leapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function birthdayOnDay(monthDay: string, key: string): boolean {
  const monthAndDay = key.slice(5);
  if (monthDay === monthAndDay) return true;
  if (monthDay !== "02-29" || monthAndDay !== "02-28") return false;
  return !leapYear(Number(key.slice(0, 4)));
}

function celebrationPhrase(row: { name: string; year?: number | null; type?: string | null }, year: number): string | null {
  const age = row.year ? year - row.year : null;
  if (row.type === "anniversary") return age && age > 0 ? `${row.name}, ${age}-year anniversary` : `${row.name}'s anniversary`;
  if (row.type && row.type !== "birthday") return null;
  return age && age > 0 ? `${row.name} turns ${age}` : `${row.name}'s birthday`;
}

/** The birthday or anniversary line for the day Home is showing. */
export function homeBirthdayLine(
  rows: { name: string; monthDay: string; year?: number | null; type?: string | null }[],
  day: Date,
): string | null {
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const year = day.getFullYear();
  const lines = rows
    .filter((row) => birthdayOnDay(row.monthDay, key))
    .map((row) => celebrationPhrase(row, year))
    .filter((line): line is string => !!line);
  if (lines.length === 0) return null;
  return `${lines.join(". ")}.`;
}

export function dinnerName(meals: Array<{ date: string; slot: string; name: string }>, day: Date): string | null {
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  return meals.find((meal) => meal.date === key && meal.slot === "dinner")?.name ?? null;
}
