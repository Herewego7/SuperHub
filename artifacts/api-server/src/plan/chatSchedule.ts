/**
 * Calendar and chore sentences from chat. A missing day, time, weekday, or
 * person is asked for. Nothing is saved until those details are present, and
 * a chore is never turned into a to-do.
 */
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type ScheduleProfile = { id: string; name: string };
export type ScheduleEvent = { id: string; title: string; startTime: string | Date; source?: string | null; isAllDay?: boolean | null; location?: string | null; profileIds?: string[] | null };

export type ScheduleTurn =
  | { kind: "ask"; text: string }
  | { kind: "create_event"; title: string; start: string; end: string; allDay: boolean; location: string | null; profileIds: string[]; text: string }
  | { kind: "update_event"; eventId: string; text: string; drivingProfileIds?: string[]; profileIds?: string[]; location?: string; description?: string; recurrenceType?: "daily" | "weekly" | "monthly" | "annually" }
  | { kind: "delete_event"; eventId: string; text: string }
  | { kind: "create_chore"; title: string; profileIds: string[]; daysOfWeek: number[]; points: number; text: string };

type EventDraft = { title: string; date?: string; minutes?: number; endMinutes?: number; allDay?: boolean; location?: string | null; profileIds: string[]; who?: "everyone" | "none" | string[] };
type ChoreDraft = { title: string; days?: number[]; who?: "everyone" | "none" | string[]; points?: number };

function familyToday(now: Date, timeZone: string): { year: number; month: number; day: number; weekday: number } | null {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = SHORT.indexOf(value("weekday"));
  const year = Number(value("year"));
  const month = Number(value("month"));
  const day = Number(value("day"));
  if (!year || !month || !day || weekday < 0) return null;
  return { year, month, day, weekday };
}

function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return isoDate(year, month, day + days);
}

/** A clock time in the family's zone, as a real instant. */
export function zonedDateTime(date: string, minutes: number, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const shown = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(guess);
  const value = (type: string) => Number(shown.find((part) => part.type === type)?.value);
  const asShown = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
  return new Date(guess.getTime() - (asShown - guess.getTime()));
}

function dayLabel(date: string, timeZone: string, minutes?: number, allDay?: boolean): string {
  const at = zonedDateTime(date, minutes ?? 0, timeZone);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(allDay || minutes == null ? {} : { hour: "numeric", minute: "2-digit" }),
  }).format(at);
}

function clockLabel(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minutes % 60).padStart(2, "0")} ${suffix}`;
}

function parseClock(text: string): { minutes: number; endMinutes?: number } | null {
  const match = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*[-–to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const suffix = match[3].toLowerCase();
  if (suffix === "pm" && hour !== 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  const start = hour * 60 + minute;
  if (!match[4]) return { minutes: start };
  let endHour = Number(match[4]);
  const endMinute = match[5] ? Number(match[5]) : 0;
  const endSuffix = (match[6] || suffix).toLowerCase();
  if (endSuffix === "pm" && endHour !== 12) endHour += 12;
  if (endSuffix === "am" && endHour === 12) endHour = 0;
  const end = endHour * 60 + endMinute;
  return end > start ? { minutes: start, endMinutes: end } : { minutes: start };
}

function parseDate(text: string, now: Date, timeZone: string): string | null {
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const today = familyToday(now, timeZone);
  if (!today) return null;
  const todayIso = isoDate(today.year, today.month, today.day);
  if (/\b(today|tonight)\b/i.test(text)) return todayIso;
  if (/\btomorrow\b/i.test(text)) return addDays(todayIso, 1);
  const weekday = text.match(/\b(?:on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (!weekday) return null;
  const index = DAYS.indexOf(weekday[1].toLowerCase());
  return addDays(todayIso, (index - today.weekday + 7) % 7);
}

function parseDays(text: string): number[] | null {
  if (/\b(every day|everyday|daily)\b/i.test(text)) return [0, 1, 2, 3, 4, 5, 6];
  if (/\bweekdays?\b/i.test(text)) return [1, 2, 3, 4, 5];
  if (/\bweekends?\b/i.test(text)) return [0, 6];
  const found = new Set<number>();
  for (const match of text.matchAll(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/gi)) {
    found.add(DAYS.indexOf(match[1].toLowerCase()));
  }
  return found.size > 0 ? [...found].sort((a, b) => a - b) : null;
}

function dayNames(days: number[]): string {
  if (days.length === 7) return "every day";
  if (days.join() === "1,2,3,4,5") return "weekdays";
  if (days.join() === "0,6") return "weekends";
  return days.map((day) => DAYS[day][0].toUpperCase() + DAYS[day].slice(1)).join(", ");
}

function peopleIn(text: string, profiles: ScheduleProfile[]): string[] {
  const ids: string[] = [];
  const named = [...profiles].sort((a, b) => b.name.length - a.name.length);
  let rest = text;
  for (const person of named) {
    const name = person.name.trim();
    if (!name) continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(rest)) {
      ids.push(person.id);
      rest = rest.replace(re, " ");
    }
  }
  return ids;
}

function whoFrom(text: string, profiles: ScheduleProfile[]): ChoreDraft["who"] {
  if (/\b(everyone|the family|all of us)\b/i.test(text)) return "everyone";
  if (/\b(no one|nobody|unassigned)\b/i.test(text)) return "none";
  const ids = peopleIn(text, profiles);
  return ids.length > 0 ? ids : undefined;
}

function parsePoints(text: string): number | null {
  const named = text.match(/\b(\d{1,4})\s*(?:stars?|points?)\b/i);
  const bare = text.trim().match(/^(?:worth\s+)?(\d{1,4})(?:\s*(?:stars?|points?))?[.!?]?$/i);
  const raw = named?.[1] ?? bare?.[1];
  if (raw) {
    const value = Number(raw);
    return value <= 10000 ? value : null;
  }
  if (/^(none|zero|no stars|0)[.!?]?$/i.test(text.trim())) return 0;
  return null;
}

function whoLabel(who: ChoreDraft["who"], profiles: ScheduleProfile[]): string {
  if (who === "everyone") return "everyone";
  if (who === "none" || !who) return "no one";
  const names = who.map((id) => profiles.find((person) => person.id === id)?.name).filter((name): name is string => !!name);
  return names.length > 0 ? names.join(", ") : "no one";
}

function optionNames(profiles: ScheduleProfile[]): string {
  const names = profiles.map((person) => person.name.trim()).filter(Boolean);
  if (names.length === 0) return "everyone, or no one";
  if (names.length === 1) return `${names[0]}, everyone, or no one`;
  if (names.length === 2) return `${names[0]}, ${names[1]}, everyone, or no one`;
  return `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}, everyone, or no one`;
}

function speakerProfile(profiles: ScheduleProfile[], speakerName?: string): ScheduleProfile | undefined {
  const first = speakerName?.trim().toLowerCase();
  if (!first) return undefined;
  return profiles.find((person) => person.name.trim().toLowerCase() === first)
    ?? profiles.find((person) => person.name.trim().toLowerCase().split(/\s+/)[0] === first);
}

/** The person they tried to name, when it is not a weekday or a star value. "me" means the signed-in person. */
function nameAttempt(text: string): string | null {
  const body = text.trim().replace(/[.!?]+$/g, "").replace(/^(?:please\s+)?(?:assign(?:\s+it)?\s+to|give(?:\s+it)?\s+to|it(?:'s| is)\s+for|for)\s+/i, "").trim();
  if (/^(?:me|myself)$/i.test(body)) return "me";
  if (!body || body.split(/\s+/).length > 3) return null;
  if (/^(?:no|nope|nah|skip|none|nothing)$/i.test(body)) return null;
  if (/\b(everyone|the family|all of us|no one|nobody|unassigned)\b/i.test(body)) return null;
  if (parsePoints(body) != null && /^(?:worth\s+)?\d/i.test(body)) return null;
  const words = body.split(/\s+/);
  if (words.every((word) => DAYS.includes(word.toLowerCase().replace(/s$/, "")) || /^(and|on|&)$/i.test(word))) return null;
  return body;
}

export function daysQuestion(title: string): string {
  return `Which days should the chore "${title}" be on?`;
}

export function whoQuestion(title: string, days: number[], profiles: { name: string }[], problem?: string): string {
  const note = problem ? ` ${problem}` : "";
  return `Who should do the chore "${title}" on ${dayNames(days)}?${note} I can assign ${optionNames(profiles)}.`;
}

export function starsQuestion(title: string, days: number[], who: string): string {
  return `How many stars should the chore "${title}" be worth? It is on ${dayNames(days)}, for ${who}.`;
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/\b(at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*[-–to]+\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/gi, " ")
    .replace(/\b(on\s+)?(today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, " ")
    .replace(/\b(all day|for everyone|for the family|for no one|for nobody)\b/gi, " ")
    .replace(/\s+for\s+$/i, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,:-]+|[\s,:-]+$/g, "")
    .trim();
}

function eventDraft(body: string, now: Date, timeZone: string, profiles: ScheduleProfile[]): EventDraft | null {
  const locationMatch = body.match(/\bat\s+(?!\d)([^,]+)$/i);
  const location = locationMatch?.[1]?.trim() || null;
  const withoutPlace = locationMatch ? body.replace(locationMatch[0], " ") : body;
  const clock = parseClock(withoutPlace);
  const date = parseDate(withoutPlace, now, timeZone);
  let title = cleanTitle(withoutPlace);
  for (const person of [...profiles].sort((a, b) => b.name.length - a.name.length)) {
    title = title.replace(new RegExp(`\\bfor\\s+${person.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ");
  }
  title = title.replace(/\s+/g, " ").trim();
  if (!title) return null;
  const who = whoFrom(withoutPlace, profiles);
  return {
    title: title.slice(0, 200),
    date: date ?? undefined,
    minutes: clock?.minutes,
    endMinutes: clock?.endMinutes,
    allDay: /\ball day\b/i.test(body),
    location,
    profileIds: idsFor(who, profiles),
    who,
  };
}

function idsFor(who: EventDraft["who"], profiles: ScheduleProfile[]): string[] {
  if (who === "everyone") return profiles.map((person) => person.id);
  if (who === "none" || !who) return [];
  return who;
}

function eventWhenKey(date: string, minutes?: number, allDay?: boolean): string {
  if (allDay || minutes == null) return `${date}, all day`;
  return `${date} at ${clockLabel(minutes)}`;
}

function passed(text: string): boolean {
  return /^\s*(no|nope|nah|skip|none|nothing|no thanks|no thank you)[.!]?$/i.test(text.trim());
}

export function eventPersonQuestion(title: string, date: string, minutes: number | undefined, allDay: boolean, profiles: { name: string }[], problem?: string): string {
  const note = problem ? ` ${problem}` : "";
  return `Who is "${title}" for on ${eventWhenKey(date, minutes, allDay)}?${note} I can assign ${optionNames(profiles)}.`;
}

function extrasQuestion(title: string, date: string, minutes: number | undefined, allDay: boolean, profiles: { name: string }[], problem?: string): string {
  const note = problem ? `${problem} ` : "";
  return `Want to add a driver, a place, a repeat, or a description for "${title}" on ${eventWhenKey(date, minutes, allDay)}? ${note}Say whichever you want, or no. Drivers can be ${optionNames(profiles)}.`;
}

function eventAsk(draft: EventDraft, timeZone: string, profiles: ScheduleProfile[]): string | null {
  if (!draft.date) return `What day should "${draft.title}" be on?`;
  if (draft.minutes == null && !draft.allDay) return `What time should "${draft.title}" start on ${dayLabel(draft.date, timeZone)} (${draft.date})? Say all day if it lasts the day.`;
  if (!draft.who) return eventPersonQuestion(draft.title, draft.date, draft.minutes, false, profiles);
  return null;
}

function eventReady(draft: EventDraft, timeZone: string, profiles: ScheduleProfile[]): ScheduleTurn {
  const date = draft.date as string;
  const allDay = draft.allDay === true && draft.minutes == null;
  const startMinutes = draft.minutes ?? 0;
  const endMinutes = draft.endMinutes ?? (allDay ? 0 : startMinutes + 60);
  const start = zonedDateTime(date, startMinutes, timeZone);
  const end = allDay ? zonedDateTime(addDays(date, 1), 0, timeZone) : zonedDateTime(date, endMinutes, timeZone);
  const when = allDay
    ? `${dayLabel(date, timeZone, undefined, true)}, all day`
    : `${dayLabel(date, timeZone, startMinutes)} to ${clockLabel(endMinutes >= 24 * 60 ? endMinutes - 24 * 60 : endMinutes)}`;
  const place = draft.location ? ` at ${draft.location}` : "";
  const who = whoLabel(draft.who, profiles);
  const follow = extrasQuestion(draft.title, date, allDay ? undefined : startMinutes, allDay, profiles);
  return {
    kind: "create_event",
    title: draft.title,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay,
    location: draft.location ?? null,
    profileIds: draft.profileIds,
    text: `On the calendar.\n${draft.title}, ${when}${place}, for ${who}.\n${follow}`,
  };
}

function quoted(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[1]?.trim() || null;
}

function continueEvent(last: string, text: string, now: Date, timeZone: string, profiles: ScheduleProfile[], speakerName?: string): ScheduleTurn | null {
  const needDay = quoted(last, /^What day should "(.+)" be on\?$/);
  if (needDay) {
    if (!parseDate(text, now, timeZone) && !parseClock(text) && text.trim().split(/\s+/).length > 3) return null;
    const draft = eventDraft(`${needDay} ${text}`, now, timeZone, profiles) ?? { title: needDay, profileIds: [] };
    draft.title = needDay;
    const ask = eventAsk(draft, timeZone, profiles);
    return ask ? { kind: "ask", text: ask } : eventReady(draft, timeZone, profiles);
  }
  const needTime = last.match(/^What time should "(.+)" start on .+\?/);
  if (needTime?.[1]) {
    const date = parseDate(last, now, timeZone);
    const clock = parseClock(text);
    const allDay = /\ball day\b/i.test(text);
    if (!date) return { kind: "ask", text: last };
    if (!clock && !allDay && text.trim().split(/\s+/).length > 3) return null;
    const who = whoFrom(text, profiles);
    const draft: EventDraft = { title: needTime[1], date, minutes: clock?.minutes, endMinutes: clock?.endMinutes, allDay, location: null, profileIds: idsFor(who, profiles), who };
    const ask = eventAsk(draft, timeZone, profiles);
    return ask ? { kind: "ask", text: ask } : eventReady(draft, timeZone, profiles);
  }
  const needPerson = last.match(/^Who is "(.+)" for on (\d{4}-\d{2}-\d{2})(?:, all day| at (\d{1,2}:\d{2} [AP]M))\?/);
  if (needPerson?.[1] && needPerson[2]) {
    const allDay = !needPerson[3];
    const clock = needPerson[3] ? parseClock(needPerson[3]) : null;
    const picked = pickWho(text, profiles, speakerName);
    if (picked.ignore) return null;
    if (!picked.who) return { kind: "ask", text: eventPersonQuestion(needPerson[1], needPerson[2], clock?.minutes, allDay, profiles, picked.missing ? `I don't see ${picked.missing}.` : undefined) };
    const draft: EventDraft = { title: needPerson[1], date: needPerson[2], minutes: clock?.minutes, allDay, location: null, profileIds: idsFor(picked.who, profiles), who: picked.who };
    return eventReady(draft, timeZone, profiles);
  }
  return null;
}

type EventMark = { title: string; date: string; minutes?: number; allDay: boolean };

function markFrom(match: RegExpMatchArray): EventMark {
  const clock = match[3] ? parseClock(match[3]) : null;
  return { title: match[1], date: match[2], minutes: clock?.minutes, allDay: !match[3] };
}

function localStamp(event: ScheduleEvent, timeZone: string): { date: string; minutes: number } | null {
  const at = new Date(event.startTime);
  if (Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) return null;
  return { date: `${year}-${month}-${day}`, minutes: Number(value("hour")) * 60 + Number(value("minute")) };
}

function eventOn(mark: EventMark, events: ScheduleEvent[], timeZone: string): ScheduleEvent | undefined {
  return events.find((event) => {
    if (event.source === "google" || event.source === "outlook" || event.source === "ical") return false;
    if (event.title.trim().toLowerCase() !== mark.title.trim().toLowerCase()) return false;
    const stamp = localStamp(event, timeZone);
    if (!stamp || stamp.date !== mark.date) return false;
    if (mark.allDay) return event.isAllDay === true;
    return stamp.minutes === mark.minutes;
  });
}

function repeatOf(text: string): "daily" | "weekly" | "monthly" | "annually" | null {
  if (/\b(every day|everyday|daily)\b/i.test(text)) return "daily";
  if (/\b(every week|weekly)\b/i.test(text)) return "weekly";
  if (/\b(every month|monthly)\b/i.test(text)) return "monthly";
  if (/\b(every year|yearly|annually)\b/i.test(text)) return "annually";
  return null;
}

function repeatLabel(kind: "daily" | "weekly" | "monthly" | "annually"): string {
  if (kind === "daily") return "every day";
  if (kind === "weekly") return "every week";
  if (kind === "monthly") return "every month";
  return "every year";
}

type ExtraDetails = {
  drivingProfileIds?: string[];
  location?: string;
  recurrenceType?: "daily" | "weekly" | "monthly" | "annually";
  description?: string;
  missingDriver?: string;
};

function extraDetails(text: string, profiles: ScheduleProfile[], speakerName?: string): ExtraDetails | "none" | null {
  const trimmed = text.trim().replace(/[.!?]+$/g, "");
  if (passed(trimmed) || /^(ok|okay|sure|done|that's it|thats it|thanks|thank you)$/i.test(trimmed)) return "none";
  if (/^(what|when|where|who|why|how|add|create|remove|delete|what's|whats)\b/i.test(trimmed)) return null;
  let rest = trimmed;
  const recurrenceType = repeatOf(rest) ?? undefined;
  if (recurrenceType) rest = rest.replace(/\b(every day|everyday|daily|every week|weekly|every month|monthly|every year|yearly|annually)\b/i, " ");
  let driverText = "";
  const drivenBy = rest.match(/\b(?:driven by|driver is|driver:)\s+([^,]+)/i);
  const driving = rest.match(/\b([^,]+?)\s+(?:is\s+)?driving\b/i);
  if (drivenBy) {
    driverText = drivenBy[1];
    rest = rest.replace(drivenBy[0], " ");
  } else if (driving) {
    driverText = driving[1];
    rest = rest.replace(driving[0], " ");
  }
  let location = "";
  const at = rest.match(/\bat\s+(?!\d)([^,]+)/i);
  const placeIs = rest.match(/\b(?:place|location)\s*(?:is|:)\s+([^,]+)/i);
  if (at) {
    location = at[1].trim();
    rest = rest.replace(at[0], " ");
  } else if (placeIs) {
    location = placeIs[1].trim();
    rest = rest.replace(placeIs[0], " ");
  }
  const note = rest.match(/\b(?:description|note)\s*(?:is|:)\s+(.+)/i);
  if (note) {
    rest = note[1];
  }
  rest = rest.replace(/\s+/g, " ").replace(/^(?:and|also|,|\s)+|(?:,|\s)+$/gi, "").trim();
  let drivingProfileIds: string[] | undefined;
  let missingDriver: string | undefined;
  if (driverText) {
    const picked = pickWho(driverText, profiles, speakerName);
    if (picked.who && picked.who !== "none") drivingProfileIds = idsFor(picked.who, profiles);
    else if (picked.missing) missingDriver = picked.missing;
  } else if (rest) {
    const named = whoFrom(rest, profiles);
    const words = rest.split(/\s+/).length;
    if (named && named !== "none" && words <= 4) {
      drivingProfileIds = idsFor(named, profiles);
      rest = "";
    } else if (/^(?:me|myself)$/i.test(rest)) {
      const mine = speakerProfile(profiles, speakerName);
      if (mine) drivingProfileIds = [mine.id];
      else missingDriver = speakerName?.trim() || "you";
      rest = "";
    }
  }
  const description = rest.replace(/^[,.\s]+|[,.\s]+$/g, "").trim();
  const details: ExtraDetails = {};
  if (drivingProfileIds && drivingProfileIds.length > 0) details.drivingProfileIds = drivingProfileIds;
  if (location) details.location = location.slice(0, 200);
  if (recurrenceType) details.recurrenceType = recurrenceType;
  if (description && !details.drivingProfileIds) details.description = description.slice(0, 500);
  else if (description && (drivenBy || driving || at || placeIs || note || recurrenceType)) details.description = description.slice(0, 500);
  if (missingDriver) details.missingDriver = missingDriver;
  if (!details.drivingProfileIds && !details.location && !details.recurrenceType && !details.description && !details.missingDriver) {
    return trimmed.split(/\s+/).length > 12 ? null : { description: trimmed.slice(0, 500) };
  }
  return details;
}

function continueEventExtra(last: string, text: string, profiles: ScheduleProfile[], events: ScheduleEvent[], timeZone: string, speakerName?: string): ScheduleTurn | null {
  const asked = last.match(/Want to add a driver, a place, a repeat, or a description for "(.+)" on (\d{4}-\d{2}-\d{2})(?:, all day| at (\d{1,2}:\d{2} [AP]M))\?/);
  if (!asked?.[1] || !asked[2]) return null;
  const mark = markFrom(asked);
  const details = extraDetails(text, profiles, speakerName);
  if (details === null) return null;
  if (details === "none") return { kind: "ask", text: `All set. ${mark.title} is on the calendar.` };
  if (details.missingDriver && !details.location && !details.recurrenceType && !details.description) {
    return { kind: "ask", text: extrasQuestion(mark.title, mark.date, mark.minutes, mark.allDay, profiles, `I don't see ${details.missingDriver}.`) };
  }
  const found = eventOn(mark, events, timeZone);
  if (!found) return { kind: "ask", text: `I can't find "${mark.title}" on the calendar to add that.` };
  const bits: string[] = [];
  if (details.drivingProfileIds) {
    const names = details.drivingProfileIds.map((id) => profiles.find((person) => person.id === id)?.name).filter((name): name is string => !!name);
    if (names.length > 0) bits.push(`${names.join(", ")} driving`);
  }
  if (details.location) bits.push(`at ${details.location}`);
  if (details.recurrenceType) bits.push(repeatLabel(details.recurrenceType));
  if (details.description) bits.push(details.description);
  const skipped = details.missingDriver ? `I don't see ${details.missingDriver}, so I left the driver off. ` : "";
  return {
    kind: "update_event",
    eventId: found.id,
    drivingProfileIds: details.drivingProfileIds,
    profileIds: details.drivingProfileIds ? [...new Set([...(found.profileIds ?? []), ...details.drivingProfileIds])] : undefined,
    location: details.location,
    description: details.description,
    recurrenceType: details.recurrenceType,
    text: `${skipped}Added to ${mark.title}: ${bits.join(", ")}.`,
  };
}

function pickWho(text: string, profiles: ScheduleProfile[], speakerName?: string): { who?: EventDraft["who"]; missing?: string; ignore: boolean } {
  const found = whoFrom(text, profiles);
  if (found) return { who: found, ignore: false };
  const attempt = nameAttempt(text);
  if (attempt === "me") {
    const mine = speakerProfile(profiles, speakerName);
    if (mine) return { who: [mine.id], ignore: false };
    return { missing: speakerName?.trim() || "you", ignore: false };
  }
  if (attempt) return { missing: attempt, ignore: false };
  if (text.trim().split(/\s+/).length > 6) return { ignore: true };
  return { ignore: false };
}

function choreAsk(draft: ChoreDraft, profiles: ScheduleProfile[]): string | null {
  if (!draft.days || draft.days.length === 0) return daysQuestion(draft.title);
  if (!draft.who) return whoQuestion(draft.title, draft.days, profiles);
  if (draft.points == null) return starsQuestion(draft.title, draft.days, whoLabel(draft.who, profiles));
  return null;
}

function choreReady(draft: ChoreDraft, profiles: ScheduleProfile[]): ScheduleTurn {
  const days = draft.days ?? [];
  const profileIds = draft.who === "everyone" ? profiles.map((person) => person.id) : draft.who === "none" || !draft.who ? [] : draft.who;
  const who = whoLabel(draft.who, profiles);
  const points = draft.points ?? 0;
  const stars = points === 1 ? "1 star" : `${points} stars`;
  return {
    kind: "create_chore",
    title: draft.title,
    profileIds,
    daysOfWeek: days,
    points,
    text: `On the chore list.\n${draft.title}, ${dayNames(days)}, for ${who}, ${stars}.`,
  };
}

function continueChore(last: string, text: string, profiles: ScheduleProfile[], speakerName?: string): ScheduleTurn | null {
  const needDays = quoted(last, /^Which days should the chore "(.+)" be on\?$/);
  if (needDays) {
    const days = parseDays(text);
    if (!days && text.trim().split(/\s+/).length > 4) return null;
    const draft: ChoreDraft = { title: needDays, days: days ?? undefined, who: whoFrom(text, profiles), points: parsePoints(text) ?? undefined };
    const ask = choreAsk(draft, profiles);
    return ask ? { kind: "ask", text: ask } : choreReady(draft, profiles);
  }
  const needWho = last.match(/^Who should do the chore "(.+)" on .+\?/);
  if (needWho?.[1]) {
    const days = parseDays(last);
    let who = whoFrom(text, profiles);
    if (!days) return { kind: "ask", text: last };
    const attempt = who ? null : nameAttempt(text);
    if (attempt === "me") {
      const mine = speakerProfile(profiles, speakerName);
      if (mine) who = [mine.id];
    }
    if (!who && attempt) {
      const missing = attempt === "me" ? (speakerName?.trim() || "you") : attempt;
      return { kind: "ask", text: whoQuestion(needWho[1], days, profiles, `I don't see ${missing}.`) };
    }
    if (!who && text.trim().split(/\s+/).length > 6) return null;
    if (!who) return { kind: "ask", text: whoQuestion(needWho[1], days, profiles) };
    const draft: ChoreDraft = { title: needWho[1], days, who, points: parsePoints(text) ?? undefined };
    const ask = choreAsk(draft, profiles);
    return ask ? { kind: "ask", text: ask } : choreReady(draft, profiles);
  }
  const needStars = last.match(/^How many stars should the chore "(.+)" be worth\? It is on (.+), for (.+)\.$/);
  if (needStars) {
    const days = parseDays(needStars[2]);
    const who = whoFrom(needStars[3], profiles);
    const points = parsePoints(text);
    if (!days || !who) return { kind: "ask", text: last };
    if (points == null && text.trim().split(/\s+/).length > 4) return null;
    if (points == null) return { kind: "ask", text: last };
    return choreReady({ title: needStars[1], days, who, points }, profiles);
  }
  return null;
}

function eventStart(event: ScheduleEvent, timeZone: string): string {
  const at = new Date(event.startTime);
  if (Number.isNaN(at.getTime())) return event.title;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(event.isAllDay ? {} : { hour: "numeric", minute: "2-digit" }),
  }).format(at);
}

function deleteTurn(title: string, events: ScheduleEvent[], timeZone: string, saidYes: boolean, last?: string): ScheduleTurn | null {
  const matches = events.filter((event) => event.title.trim().toLowerCase() === title.trim().toLowerCase());
  const outside = matches.filter((event) => event.source === "google" || event.source === "outlook" || event.source === "ical");
  const local = matches.filter((event) => !outside.includes(event));
  if (matches.length === 0) return { kind: "ask", text: `I don't see ${title} on the calendar.` };
  if (local.length === 0) {
    const where = outside[0]?.source === "outlook" ? "Outlook" : outside[0]?.source === "ical" ? "a subscribed calendar" : "Google Calendar";
    return { kind: "ask", text: `${matches[0].title} is on ${where}, so I can't remove it from here.` };
  }
  if (local.length > 1 && !saidYes) {
    const lines = local.slice(0, 6).map((event) => `- ${event.title}, ${eventStart(event, timeZone)}`);
    return { kind: "ask", text: `Which ${title} should I delete?\n${lines.join("\n")}` };
  }
  const chosen = local.length === 1 ? local[0] : local.find((event) => last?.includes(eventStart(event, timeZone))) ?? local[0];
  if (!saidYes) return { kind: "ask", text: `Delete ${chosen.title} on ${eventStart(chosen, timeZone)}? Reply yes to delete it.` };
  return { kind: "delete_event", eventId: chosen.id, text: `Removed ${chosen.title} from the calendar.` };
}

function wantsEvent(text: string): string | null {
  const calendar = text.match(/^(?:please\s+)?(?:add|put|schedule|create)\s+(.+?)\s+(?:on|to)\s+(?:the\s+)?(?:family\s+)?calendar\b/i);
  if (calendar?.[1]) return calendar[1];
  const named = text.match(/^(?:please\s+)?(?:add|create|schedule)\s+(?:an?\s+)?(?:event|appointment)\s+(?:called\s+)?(.+)$/i);
  return named?.[1]?.trim() || null;
}

function wantsDelete(text: string): string | null {
  const fromCalendar = text.match(/^(?:please\s+)?(?:delete|remove|cancel)\s+(.+?)\s+from\s+(?:the\s+)?calendar\b/i);
  if (fromCalendar?.[1]) return fromCalendar[1].trim();
  const named = text.match(/^(?:please\s+)?(?:delete|remove|cancel)\s+(?:the\s+)?event\s+(.+?)\.?$/i);
  return named?.[1]?.trim() || null;
}

function wantsChore(text: string): string | null {
  if (/\bto-?dos?\b/i.test(text)) return null;
  const named = text.match(/^(?:please\s+)?(?:add|create)\s+(?:a\s+)?chore\s+(?:called\s+|to\s+)?(.+)$/i);
  if (named?.[1]) return named[1].trim();
  const listed = text.match(/^(?:please\s+)?(?:add|put)\s+(.+?)\s+(?:on|to)\s+(?:the\s+)?chores?\b/i);
  return listed?.[1]?.trim() || null;
}

function yes(text: string): boolean {
  return /^\s*(yes|yep|yeah|yup|sure|ok|okay|confirm|do it|go ahead|please do)(?:\s+please)?[.!]?$/i.test(text.trim());
}

export function scheduleTurn(
  text: string,
  now: Date,
  timeZone: string,
  profiles: ScheduleProfile[],
  events: ScheduleEvent[],
  lastAssistant?: string,
  speakerName?: string,
): ScheduleTurn | null {
  const last = lastAssistant?.trim() ?? "";
  if (last.startsWith("Delete ") && last.includes("Reply yes to delete it") && yes(text)) {
    const title = quoted(last, /^Delete (.+?) on /);
    return title ? deleteTurn(title, events, timeZone, true, last) : null;
  }
  if (last.startsWith("Which ") && last.includes("should I delete?")) {
    const title = quoted(last, /^Which (.+?) should I delete\?/);
    if (!title) return null;
    const picked = events.find((event) => text.toLowerCase().includes(eventStart(event, timeZone).toLowerCase()) || event.title.toLowerCase() === text.trim().toLowerCase());
    if (!picked) return { kind: "ask", text: last };
    return { kind: "ask", text: `Delete ${picked.title} on ${eventStart(picked, timeZone)}? Reply yes to delete it.` };
  }
  const continuedEvent = last ? continueEvent(last, text, now, timeZone, profiles, speakerName) : null;
  if (continuedEvent) return continuedEvent;
  const extra = last ? continueEventExtra(last, text, profiles, events, timeZone, speakerName) : null;
  if (extra) return extra;
  const continuedChore = last ? continueChore(last, text, profiles, speakerName) : null;
  if (continuedChore) return continuedChore;

  const removing = wantsDelete(text);
  if (removing) return deleteTurn(removing, events, timeZone, false);

  const adding = wantsEvent(text);
  if (adding) {
    const draft = eventDraft(adding, now, timeZone, profiles);
    if (!draft) return { kind: "ask", text: "What should the event be called?" };
    const ask = eventAsk(draft, timeZone, profiles);
    return ask ? { kind: "ask", text: ask } : eventReady(draft, timeZone, profiles);
  }

  const chore = wantsChore(text);
  if (chore) {
    let title = cleanTitle(chore).replace(/^(?:called|to)\s+/i, "").trim();
    for (const person of [...profiles].sort((a, b) => b.name.length - a.name.length)) {
      title = title.replace(new RegExp(`\\bfor\\s+${person.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ");
    }
    title = title.replace(/\s+/g, " ").trim();
    if (!title) return { kind: "ask", text: "What chore should I add?" };
    const draft: ChoreDraft = {
      title: title.slice(0, 200),
      days: parseDays(chore) ?? undefined,
      who: whoFrom(chore, profiles),
      points: parsePoints(chore) ?? undefined,
    };
    const ask = choreAsk(draft, profiles);
    return ask ? { kind: "ask", text: ask } : choreReady(draft, profiles);
  }
  return null;
}
