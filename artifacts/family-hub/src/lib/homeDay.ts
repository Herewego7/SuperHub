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
/** A school email hides its calendar copy, including after it is checked off. */
export function schoolSlipsHeldOnHome<T extends { id: string; title: string; category?: string | null }>(
  todos: T[],
  _completions: { choreId: string; completedAt?: Date | string | null }[],
  _day: Date,
): T[] {
  return todos.filter((todo) => todo.category === "school_email");
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

/** The Home to-do line for a school email: title, clock, place, and who is driving. */
export function schoolHomeTitle(
  title: string,
  events: { title: string; startTime: Date | string; source?: string | null; isAllDay?: boolean | null; location?: string | null; drivingProfileIds?: string[] | null }[],
  day: Date,
  people: { id: string; name: string }[] = [],
): string {
  const clock = schoolEventClock(title, events, day);
  let line = clock ? `${title}, ${clock}` : title;
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const event = events.find((item) => {
    if (item.source !== "school" || item.title.toLowerCase() !== title.toLowerCase()) return false;
    const at = new Date(item.startTime);
    return at >= start && at < end;
  });
  const place = event?.location?.trim();
  if (place && !line.toLowerCase().includes(place.toLowerCase())) line = `${line}, ${place}`;
  const names = driverNamesFor(event?.drivingProfileIds, people);
  if (names.length === 0) return line;
  const pretty = names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const driving = `${pretty} driving`;
  if (line.toLowerCase().includes(driving.toLowerCase())) return line;
  return `${line}, ${driving}`;
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
  const slips = new Set(todos.filter((todo) => todo.category === "school_email").map((todo) => slipTitle(todo.title).toLowerCase()));
  return events.filter((event) => {
    if (event.source === "meal" && dinner) return false;
    if (event.source === "school" && slips.has(slipTitle(event.title).toLowerCase())) return false;
    const at = new Date(event.startTime);
    return at >= start && at < end && mailVisibleToKid(event, kidName);
  });
}

function slipTitle(title: string): string {
  const clock = title.match(/^(.*?),\s+\d{1,2}:\d{2}\s+[AP]M\b/i);
  if (clock?.[1]) return clock[1].trim();
  return title.replace(/,\s+[^,]+\s+driving$/i, "").trim();
}

/** Names for the people set to drive. An unknown id stays off the line. */
export function driverNamesFor(
  ids: string[] | null | undefined,
  people: { id: string; name: string }[],
): string[] {
  const names: string[] = [];
  for (const id of ids ?? []) {
    const name = people.find((person) => person.id === id)?.name.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
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
  rows: { name: string; monthDay: string; year?: number | null; type?: string | null; customLabel?: string | null }[],
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
    if (row.type && row.type !== "birthday" && row.type !== "anniversary" && row.type !== "other") continue;
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

/** A checked school email stays off On the Horizon. A place or a driver does not keep it. */
export function horizonWithoutChecked<T extends HorizonEvent>(events: T[], day: Date, slips: { title: string }[]): T[] {
  const titles = new Set(slips.map((slip) => slipTitle(slip.title).toLowerCase()));
  return horizonEvents(events, day).filter((event) => titles.size === 0 || event.source !== "school" || !titles.has(slipTitle(event.title).toLowerCase()));
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

/** The birthday or anniversary line for the day Home is showing. */
export function homeBirthdayLine(
  rows: { name: string; monthDay: string; year?: number | null; type?: string | null; customLabel?: string | null }[],
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

/** Calendar notes often arrive as HTML. Key Dates should show the words, not the tags. */
export function plainEventDetail(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const text = raw
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/NOTE:\s*You can only edit\/save changes[\s\S]*?HoneyBook account\.?\s*/i, "")
    .trim();
  return text || null;
}

export function dinnerName(meals: Array<{ date: string; slot: string; name: string }>, day: Date): string | null {
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  return meals.find((meal) => meal.date === key && meal.slot === "dinner")?.name ?? null;
}

export const PLAN_TODO_FOLD = 8;
export const PLAN_KEY_DATES = 5;
export const PLAN_HORIZON = 3;
export const PLAN_NEWSLETTERS = 3;
export const PLAN_OVERDUE_DAYS = 7;
export const PLAN_COMPLETED_DAYS = 7;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function dayStart(day: Date): Date {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  return start;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function monthIndex(name: string): number {
  const word = name.toLowerCase().replace(".", "");
  const full = MONTHS.indexOf(word === "sept" ? "september" : word);
  if (full >= 0) return full;
  return MONTH_SHORT.indexOf(word.slice(0, 3));
}

function dated(year: number, month: number, date: number, from: Date, explicitYear: boolean): Date | null {
  if (month < 0 || month > 11 || date < 1 || date > 31) return null;
  const at = new Date(year, month, date);
  if (at.getMonth() !== month) return null;
  if (!explicitYear && at < dayStart(from)) {
    const age = Math.round((dayStart(from).getTime() - at.getTime()) / 86400000);
    if (age > PLAN_OVERDUE_DAYS) at.setFullYear(from.getFullYear() + 1);
  }
  return at;
}

/** A month-and-day, or a numeric date, written in an email. A weekday name is not enough. */
export function mailDate(text: string, from: Date): Date | null {
  const span = mailSpan(text, from);
  return span?.start ?? null;
}

export type MailSpan = { start: Date; end: Date | null; time: string | null };

/** The first date in the text, a second date when the note is a range, and a clock when one is written. */
export function mailSpan(text: string, from: Date): MailSpan | null {
  const months = [...text.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi)];
  const numeric = [...text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)];
  const points: Date[] = [];
  for (const match of months) {
    const at = dated(from.getFullYear(), monthIndex(match[1]), Number(match[2]), from, false);
    if (at) points.push(at);
  }
  for (const match of numeric) {
    const rawYear = match[3] ? Number(match[3]) : null;
    const year = rawYear == null ? from.getFullYear() : rawYear < 100 ? 2000 + rawYear : rawYear;
    const at = dated(year, Number(match[1]) - 1, Number(match[2]), from, rawYear != null);
    if (at) points.push(at);
  }
  if (points.length === 0) return null;
  points.sort((a, b) => a.getTime() - b.getTime());
  const start = points[0];
  const end = points.length > 1 && !sameDay(points[0], points[points.length - 1]) ? points[points.length - 1] : null;
  return { start, end, time: mailClock(text) };
}

export function mailClockParts(text: string): { hours: number; minutes: number; label: string } | null {
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const suffix = match[3].toLowerCase();
  if (hours < 1 || hours > 12 || minutes > 59) return null;
  if (suffix === "pm" && hours !== 12) hours += 12;
  if (suffix === "am" && hours === 12) hours = 0;
  const at = new Date();
  at.setHours(hours, minutes, 0, 0);
  return { hours, minutes, label: at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) };
}

export function mailClock(text: string): string | null {
  return mailClockParts(text)?.label ?? null;
}

export function planDateLabel(start: Date, end: Date | null): string {
  const one = (at: Date) => at.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (!end || sameDay(start, end)) return one(start);
  return `${one(start)} – ${one(end)}`;
}

export function sourceChipLabel(sender: string | null, kind: "mail" | "todo"): string {
  if (sender) return `Source: ${sender}`;
  return kind === "mail" ? "Source: School email" : "To-do";
}

export function newsletterInitials(title: string): string {
  const words = title.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return title.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "NL";
}

/** Tonight at 8, tomorrow at 7:30, or Saturday at 9. A custom time must be in the future. */
export function snoozeUntil(which: "tonight" | "tomorrow" | "weekend" | "custom", now: Date, custom?: Date): number | null {
  if (which === "custom") {
    if (!custom || custom.getTime() <= now.getTime()) return null;
    return custom.getTime();
  }
  if (which === "tonight") {
    const at = new Date(now);
    at.setHours(20, 0, 0, 0);
    return at.getTime() > now.getTime() ? at.getTime() : null;
  }
  if (which === "tomorrow") {
    const at = new Date(now);
    at.setDate(at.getDate() + 1);
    at.setHours(7, 30, 0, 0);
    return at.getTime();
  }
  const at = new Date(now);
  at.setHours(9, 0, 0, 0);
  const daysUntilSaturday = (6 - at.getDay() + 7) % 7;
  at.setDate(at.getDate() + daysUntilSaturday);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 7);
  return at.getTime();
}

type PlanChore = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  createdAt?: Date | string | null;
};

function noteOf(row: PlanChore): string {
  return `${row.title}\n${row.description ?? ""}`;
}

function mailTask(text: string): boolean {
  return /\b(due|bring|return|sign|wear|turn in|permission)\b/i.test(text);
}

function completionOn<T extends { choreId: string; completedAt?: Date | string | null }>(todoId: string, completions: T[], day: Date): T | null {
  const start = dayStart(day);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return completions.find((completion) => {
    if (completion.choreId !== todoId || !completion.completedAt) return false;
    const at = new Date(completion.completedAt);
    return at >= start && at < end;
  }) ?? null;
}

/** Open to-dos due that day, overdue ones on today for a week, and ones checked off that day. */
export function planTodoRows<T extends PlanChore>(
  todos: T[],
  completions: { choreId: string; completedAt?: Date | string | null }[],
  day: Date,
  now: Date,
): (T & { done: boolean; overdue: boolean })[] {
  const viewing = dayStart(day);
  const today = dayStart(now);
  const onToday = sameDay(viewing, today);
  const rows: (T & { done: boolean; overdue: boolean })[] = [];
  for (const todo of todos) {
    if (completionOn(todo.id, completions, day)) {
      rows.push({ ...todo, done: true, overdue: false });
      continue;
    }
    if (completions.some((completion) => completion.choreId === todo.id)) continue;
    const due = mailDate(noteOf(todo), today);
    if (due && sameDay(due, viewing)) {
      rows.push({ ...todo, done: false, overdue: false });
      continue;
    }
    if (onToday && due) {
      const age = Math.round((today.getTime() - dayStart(due).getTime()) / 86400000);
      if (age > 0 && age <= PLAN_OVERDUE_DAYS) rows.push({ ...todo, done: false, overdue: true });
      continue;
    }
    if (!due && onToday) rows.push({ ...todo, done: false, overdue: false });
  }
  return rows.sort((a, b) => Number(b.overdue) - Number(a.overdue));
}

function titlesMatch(eventTitle: string, mailTitle: string): boolean {
  return slipTitle(eventTitle).toLowerCase() === slipTitle(mailTitle).toLowerCase();
}

/** A mail date that is not already on a calendar that day. An action with a quote stays a to-do. */
export function mailKeyDates<T extends PlanChore>(
  todos: T[],
  events: { title: string; startTime: Date | string }[],
  now: Date,
): (T & { start: Date; end: Date | null; time: string | null })[] {
  const today = dayStart(now);
  const rows: (T & { start: Date; end: Date | null; time: string | null })[] = [];
  for (const todo of todos) {
    if (todo.category !== "school_email") continue;
    if (mailTask(noteOf(todo)) || mailClock(noteOf(todo))) continue;
    const span = mailSpan(noteOf(todo), today);
    if (!span || dayStart(span.end ?? span.start) < today) continue;
    const covered = events.some((event) => titlesMatch(event.title, todo.title) && sameDay(new Date(event.startTime), span.start));
    if (covered) continue;
    rows.push({ ...todo, ...span });
  }
  return rows.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** A timed note for this day that never became a calendar event. */
export function mailOffCalendar<T extends PlanChore>(
  todos: T[],
  events: { title: string; startTime: Date | string }[],
  day: Date,
  now: Date = new Date(),
): (T & { time: string })[] {
  const rows: (T & { time: string })[] = [];
  for (const todo of todos) {
    if (todo.category !== "school_email") continue;
    const time = mailClock(noteOf(todo));
    if (!time) continue;
    const due = mailDate(noteOf(todo), now);
    if (due && !sameDay(due, day)) continue;
    if (!due && !sameDay(dayStart(day), dayStart(now))) continue;
    if (events.some((event) => titlesMatch(event.title, todo.title) && sameDay(new Date(event.startTime), day))) continue;
    rows.push({ ...todo, time });
  }
  return rows;
}

/** A dated to-do due later this week. Timed mail stays with horizonMail, and a date to add stays a key date. */
export function horizonDatedTodos<T extends PlanChore>(
  todos: T[],
  events: { title: string; startTime: Date | string }[],
  day: Date,
): (T & { start: Date })[] {
  const from = dayStart(day);
  from.setDate(from.getDate() + 1);
  const until = dayStart(day);
  until.setDate(until.getDate() + 8);
  const rows: (T & { start: Date })[] = [];
  for (const todo of todos) {
    const note = noteOf(todo);
    if (!mailTask(note) || mailClock(note)) continue;
    const due = mailDate(note, day);
    if (!due || due < from || due >= until) continue;
    if (events.some((event) => titlesMatch(event.title, todo.title) && sameDay(new Date(event.startTime), due))) continue;
    rows.push({ ...todo, start: due });
  }
  return rows.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Timed mail in the week after the day on screen, still missing from the calendar. */
export function horizonMail<T extends PlanChore>(
  todos: T[],
  events: { title: string; startTime: Date | string }[],
  day: Date,
): (T & { start: Date; time: string })[] {
  const from = dayStart(day);
  from.setDate(from.getDate() + 1);
  const until = dayStart(day);
  until.setDate(until.getDate() + 8);
  const rows: (T & { start: Date; time: string })[] = [];
  for (const todo of todos) {
    if (todo.category !== "school_email") continue;
    const time = mailClock(noteOf(todo));
    const due = mailDate(noteOf(todo), day);
    if (!time || !due || due < from || due >= until) continue;
    if (events.some((event) => titlesMatch(event.title, todo.title) && sameDay(new Date(event.startTime), due))) continue;
    rows.push({ ...todo, start: due, time });
  }
  return rows.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** The latest school letter from each sender in the last two weeks, when it is not a date to add. */
export function newsletterIssues<T extends PlanChore>(todos: T[], now: Date): (T & { when: Date })[] {
  const today = dayStart(now);
  const earliest = new Date(today);
  earliest.setDate(earliest.getDate() - 13);
  const datedIds = new Set(mailKeyDates(todos, [], now).map((row) => row.id));
  const recent = todos.filter((todo) => {
    if (todo.category !== "school_email" || datedIds.has(todo.id)) return false;
    if (mailTask(noteOf(todo)) || mailClock(noteOf(todo))) return false;
    const at = todo.createdAt ? new Date(todo.createdAt) : today;
    return at >= earliest && at < new Date(today.getTime() + 86400000);
  });
  const newest = new Map<string, T & { when: Date }>();
  for (const todo of recent) {
    const sender = todo.description?.match(/^From: (\S+)\n/)?.[1]?.toLowerCase() ?? todo.id;
    const when = todo.createdAt ? new Date(todo.createdAt) : today;
    const held = newest.get(sender);
    if (!held || when > held.when) newest.set(sender, { ...todo, when });
  }
  return [...newest.values()].sort((a, b) => b.when.getTime() - a.when.getTime());
}

/** Finished to-dos from the last 7 days, counting today. Newest first. */
export function completedActions<T extends { id: string; choreId: string; completedAt?: Date | string | null }>(
  completions: T[],
  now: Date,
): T[] {
  const today = dayStart(now);
  const earliest = new Date(today);
  earliest.setDate(earliest.getDate() - (PLAN_COMPLETED_DAYS - 1));
  const end = new Date(today);
  end.setDate(end.getDate() + 1);
  return completions
    .filter((completion) => {
      if (!completion.completedAt) return false;
      const at = new Date(completion.completedAt);
      return at >= earliest && at < end;
    })
    .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime());
}

export function forecastFor(
  days: { date: string; high: number; low: number; condition: string }[] | undefined,
  day: Date,
): { high: number; low: number; condition: string } | null {
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const found = days?.find((item) => item.date === key);
  return found ? { high: found.high, low: found.low, condition: found.condition } : null;
}
