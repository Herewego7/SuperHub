/**
 * Calendar and chore sentences from chat. A missing day, time, weekday, or
 * person is asked for. Nothing is saved until those details are present, and
 * a chore is never turned into a to-do.
 */
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type ScheduleProfile = { id: string; name: string };
export type ScheduleEvent = { id: string; title: string; startTime: string | Date; source?: string | null; isAllDay?: boolean | null };

export type ScheduleTurn =
  | { kind: "ask"; text: string }
  | { kind: "create_event"; title: string; start: string; end: string; allDay: boolean; location: string | null; profileIds: string[]; text: string }
  | { kind: "delete_event"; eventId: string; text: string }
  | { kind: "create_chore"; title: string; profileIds: string[]; daysOfWeek: number[]; text: string };

type EventDraft = { title: string; date?: string; minutes?: number; endMinutes?: number; allDay?: boolean; location?: string | null; profileIds: string[] };
type ChoreDraft = { title: string; days?: number[]; who?: "everyone" | "none" | string[] };

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
  return {
    title: title.slice(0, 200),
    date: date ?? undefined,
    minutes: clock?.minutes,
    endMinutes: clock?.endMinutes,
    allDay: /\ball day\b/i.test(body),
    location,
    profileIds: peopleIn(withoutPlace, profiles),
  };
}

function eventAsk(draft: EventDraft, timeZone: string): string | null {
  if (!draft.date) return `What day should "${draft.title}" be on?`;
  if (draft.minutes == null && !draft.allDay) return `What time should "${draft.title}" start on ${dayLabel(draft.date, timeZone)} (${draft.date})? Say all day if it lasts the day.`;
  return null;
}

function eventReady(draft: EventDraft, timeZone: string): ScheduleTurn {
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
  return {
    kind: "create_event",
    title: draft.title,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay,
    location: draft.location,
    profileIds: draft.profileIds,
    text: `On the calendar.\n${draft.title}, ${when}${place}.`,
  };
}

function quoted(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[1]?.trim() || null;
}

function continueEvent(last: string, text: string, now: Date, timeZone: string, profiles: ScheduleProfile[]): ScheduleTurn | null {
  const needDay = quoted(last, /^What day should "(.+)" be on\?$/);
  if (needDay) {
    if (!parseDate(text, now, timeZone) && !parseClock(text) && text.trim().split(/\s+/).length > 3) return null;
    const draft = eventDraft(`${needDay} ${text}`, now, timeZone, profiles) ?? { title: needDay, profileIds: [] };
    draft.title = needDay;
    const ask = eventAsk(draft, timeZone);
    return ask ? { kind: "ask", text: ask } : eventReady(draft, timeZone);
  }
  const needTime = last.match(/^What time should "(.+)" start on .+\?/);
  if (needTime?.[1]) {
    const date = parseDate(last, now, timeZone);
    const clock = parseClock(text);
    const allDay = /\ball day\b/i.test(text);
    if (!date) return { kind: "ask", text: last };
    if (!clock && !allDay && text.trim().split(/\s+/).length > 3) return null;
    const draft: EventDraft = { title: needTime[1], date, minutes: clock?.minutes, endMinutes: clock?.endMinutes, allDay, location: null, profileIds: peopleIn(text, profiles) };
    const ask = eventAsk(draft, timeZone);
    return ask ? { kind: "ask", text: ask } : eventReady(draft, timeZone);
  }
  return null;
}

function choreAsk(draft: ChoreDraft): string | null {
  if (!draft.days || draft.days.length === 0) return `Which days should the chore "${draft.title}" be on?`;
  if (!draft.who) return `Who should do the chore "${draft.title}" on ${dayNames(draft.days)}? Say a name, everyone, or no one.`;
  return null;
}

function choreReady(draft: ChoreDraft, profiles: ScheduleProfile[]): ScheduleTurn {
  const days = draft.days ?? [];
  const profileIds = draft.who === "everyone" ? profiles.map((person) => person.id) : draft.who === "none" || !draft.who ? [] : draft.who;
  const names = profileIds.map((id) => profiles.find((person) => person.id === id)?.name).filter((name): name is string => !!name);
  const who = names.length === 0 ? "no one" : names.join(", ");
  return {
    kind: "create_chore",
    title: draft.title,
    profileIds,
    daysOfWeek: days,
    text: `On the chore list.\n${draft.title}, ${dayNames(days)}, for ${who}.`,
  };
}

function continueChore(last: string, text: string, profiles: ScheduleProfile[]): ScheduleTurn | null {
  const needDays = quoted(last, /^Which days should the chore "(.+)" be on\?$/);
  if (needDays) {
    const days = parseDays(text);
    if (!days && text.trim().split(/\s+/).length > 4) return null;
    const draft: ChoreDraft = { title: needDays, days: days ?? undefined, who: whoFrom(text, profiles) };
    const ask = choreAsk(draft);
    return ask ? { kind: "ask", text: ask } : choreReady(draft, profiles);
  }
  const needWho = last.match(/^Who should do the chore "(.+)" on .+\?/);
  if (needWho?.[1]) {
    const days = parseDays(last);
    const who = whoFrom(text, profiles);
    if (!days) return { kind: "ask", text: last };
    if (!who && text.trim().split(/\s+/).length > 3) return null;
    if (!who) return { kind: "ask", text: last };
    return choreReady({ title: needWho[1], days, who }, profiles);
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
  const continuedEvent = last ? continueEvent(last, text, now, timeZone, profiles) : null;
  if (continuedEvent) return continuedEvent;
  const continuedChore = last ? continueChore(last, text, profiles) : null;
  if (continuedChore) return continuedChore;

  const removing = wantsDelete(text);
  if (removing) return deleteTurn(removing, events, timeZone, false);

  const adding = wantsEvent(text);
  if (adding) {
    const draft = eventDraft(adding, now, timeZone, profiles);
    if (!draft) return { kind: "ask", text: "What should the event be called?" };
    const ask = eventAsk(draft, timeZone);
    return ask ? { kind: "ask", text: ask } : eventReady(draft, timeZone);
  }

  const chore = wantsChore(text);
  if (chore) {
    let title = cleanTitle(chore).replace(/^(?:called|to)\s+/i, "").trim();
    for (const person of [...profiles].sort((a, b) => b.name.length - a.name.length)) {
      title = title.replace(new RegExp(`\\bfor\\s+${person.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ");
    }
    title = title.replace(/\s+/g, " ").trim();
    if (!title) return { kind: "ask", text: "What chore should I add?" };
    const draft: ChoreDraft = { title: title.slice(0, 200), days: parseDays(chore) ?? undefined, who: whoFrom(chore, profiles) };
    const ask = choreAsk(draft);
    return ask ? { kind: "ask", text: ask } : choreReady(draft, profiles);
  }
  return null;
}
