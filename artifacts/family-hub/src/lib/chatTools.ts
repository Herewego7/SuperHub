/** Chat tools carried over from Bot Life. Mail tools stay off a kid's thread. */
import { dinnerName } from "./homeDay";

export const CHAT_TOOLS = [
  "get_plan",
  "search",
  "get_newsletters",
  "create_event",
  "update_event",
  "delete_event",
  "create_task",
  "complete_task",
  "assign",
  "create_reminder",
  "get_weather",
  "get_profile",
  "remember_fact",
  "mute_sender",
  "mark_not_relevant",
  "send_feedback",
  "maps_link",
] as const;

const INBOX_TOOLS = new Set(["search", "get_newsletters", "mute_sender", "mark_not_relevant"]);

export function toolsForRole(isChild: boolean): string[] {
  if (!isChild) return [...CHAT_TOOLS];
  return CHAT_TOOLS.filter((tool) => !INBOX_TOOLS.has(tool));
}

export function pointsProfileId(profileIds: string[], profileKey: string): string | null {
  const selected = profileKey.split(",").filter((id) => id && id !== "family");
  if (profileIds.length === 0) return selected[0] ?? null;
  if (selected.length === 1 && profileIds.includes(selected[0])) return selected[0];
  return profileIds[0] ?? null;
}

export function assignChange(
  text: string,
  chores: { id: string; title: string }[],
  profiles: { id: string; name: string }[],
): { choreId: string; profileIds: string[]; reply: string } | { reply: string } | null {
  const match = text.trim().match(/^assign\s+(.+?)\s+to\s+(.+?)\.?$/i);
  if (!match) return null;
  const title = match[1].trim();
  const who = match[2].trim();
  const chore = chores.find((item) => item.title.toLowerCase() === title.toLowerCase());
  if (!chore) return { reply: `I don't see ${title}.` };
  if (/^(nobody|no one|everyone)$/i.test(who)) {
    return { choreId: chore.id, profileIds: [], reply: `${chore.title} is for everyone.` };
  }
  const profile = profiles.find((person) => person.name.toLowerCase() === who.toLowerCase());
  if (!profile) return { reply: `I don't see ${who}.` };
  return { choreId: chore.id, profileIds: [profile.id], reply: `${chore.title} is assigned to ${profile.name}.` };
}

export function feedbackNote(text: string): string | null {
  const match = text.trim().match(/^(?:send\s+)?feedback:?\s+(.+?)\.?$/i);
  const note = match?.[1]?.trim();
  return note ? note : null;
}

export function reminderRequest(
  text: string,
  profiles: { id: string; name: string }[],
): { title: string; profileIds: string[] } | { reply: string } | null {
  const named = text.trim().match(/^remind\s+([A-Za-z]+)\s+to\s+(.+?)\.?$/i);
  if (named && !/^(me|us)$/i.test(named[1])) {
    const profile = profiles.find((person) => person.name.toLowerCase() === named[1].toLowerCase());
    if (!profile) return { reply: `I don't see ${named[1]}.` };
    const title = named[2].trim();
    return title ? { title, profileIds: [profile.id] } : null;
  }
  const self = text.trim().match(/^remind\s+(?:me|us)\s+(?:to\s+)?(.+?)\.?$/i);
  const title = self?.[1]?.trim();
  return title ? { title, profileIds: [] } : null;
}

export function createTodoTitle(text: string): string | null {
  const match = text.trim().match(/^(?:add|create)\s+(?:a\s+)?to-?do\s+(?:called\s+)?(.+?)\.?$/i);
  const title = match?.[1]?.trim();
  return title ? title : null;
}

export function createEventTitle(text: string): string | null {
  const match = text.trim().match(/^(?:add|create)\s+(?:an?\s+)?event\s+(?:called\s+)?(.+?)\.?$/i);
  const title = match?.[1]?.trim();
  return title ? title : null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function eventOn(name: string, from: Date): { title: string; on: Date } | null {
  const weekday = name.match(/^(.*?)\s+(?:on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i);
  if (weekday?.[1]?.trim()) {
    const on = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const target = WEEKDAYS.indexOf(weekday[2].toLowerCase());
    on.setDate(on.getDate() + ((target - on.getDay() + 7) % 7));
    return { title: weekday[1].trim(), on };
  }
  const written = name.match(/^(.*?)\s+(?:on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/i);
  if (written?.[1]?.trim()) {
    const label = written[2].toLowerCase() === "sept" ? "sep" : written[2].toLowerCase();
    const month = MONTHS.indexOf(label) >= 0 ? MONTHS.indexOf(label) : ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(label.slice(0, 3));
    const day = Number(written[3]);
    const on = new Date(from.getFullYear(), month, day);
    if (month < 0 || on.getMonth() !== month) return null;
    const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    if (on < today) on.setFullYear(from.getFullYear() + 1);
    return { title: written[1].trim(), on };
  }
  const numeric = name.match(/^(.*?)\s+(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!numeric?.[1]?.trim()) return null;
  const month = Number(numeric[2]) - 1;
  const day = Number(numeric[3]);
  const rawYear = numeric[4] ? Number(numeric[4]) : null;
  const year = rawYear == null ? from.getFullYear() : rawYear < 100 ? 2000 + rawYear : rawYear;
  const on = new Date(year, month, day);
  if (month < 0 || month > 11 || on.getMonth() !== month) return null;
  if (rawYear == null) {
    const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    if (on < today) on.setFullYear(from.getFullYear() + 1);
  }
  return { title: numeric[1].trim(), on };
}

export function createEventClock(title: string, from = new Date()): { title: string; hours?: number; minutes?: number; day: "today" | "tomorrow"; on?: Date } {
  const match = title.match(/^(.*?)(?:\s+(today|tomorrow))?(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm))?$/i);
  const placed = eventOn((match?.[1] ?? title).trim(), from);
  if (!match || (!match[2] && !match[3] && !placed)) return { title, day: "tomorrow" };
  const name = (placed?.title ?? match[1] ?? "").trim();
  const day = match?.[2]?.toLowerCase() === "today" ? "today" : "tomorrow";
  if (!match?.[3]) return name ? { title: name, day, ...(placed ? { on: placed.on } : {}) } : { title, day: "tomorrow" };
  let hours = Number(match[3]);
  const minutes = match[4] ? Number(match[4]) : 0;
  const suffix = match[5].toLowerCase();
  if (!name || hours < 1 || hours > 12 || minutes > 59) return { title, day: "tomorrow" };
  if (suffix === "pm" && hours !== 12) hours += 12;
  if (suffix === "am" && hours === 12) hours = 0;
  return { title: name, hours, minutes, day, ...(placed ? { on: placed.on } : {}) };
}

export function familyCalendarOffer(familyCalendarId: string | null | undefined): string | null {
  const id = familyCalendarId?.trim();
  if (!id || id === "none") return null;
  return id;
}

export function checkOffTitle(text: string): string | null {
  const match = text.trim().match(/^check off (.+)$/i);
  const title = match?.[1]?.trim();
  return title ? title : null;
}

function dueOnDay(
  chore: {
    taskType?: string | null;
    isActive?: boolean | null;
    daysOfWeek?: number[] | null;
    recurrenceType?: string | null;
    targetCount?: number | null;
    endDate?: Date | string | null;
  },
  start: Date,
): boolean {
  if (chore.isActive === false) return false;
  if (chore.taskType === "todo") return true;
  if (chore.taskType && chore.taskType !== "chore") return false;
  if (chore.endDate && new Date(chore.endDate) < start) return false;
  if (chore.targetCount && chore.targetCount > 0) return true;
  if (chore.recurrenceType === "daily") return true;
  return (chore.daysOfWeek ?? []).includes(start.getDay());
}

export function dayReply(
  text: string,
  input: {
    chores: {
      id?: string;
      title: string;
      taskType?: string | null;
      isActive?: boolean | null;
      daysOfWeek?: number[] | null;
      recurrenceType?: string | null;
      targetCount?: number | null;
      endDate?: Date | string | null;
    }[];
    events: { title: string; startTime: Date | string }[];
    completions?: { choreId: string; completedAt?: Date | string | null }[];
    dinner?: string | null;
    meals?: { date: string; slot: string; name: string }[];
    day: Date;
  },
): string | null {
  const asked = text.trim().match(/\bwhat(?:'s| is) (?:the plan|my day)(?:\s+(?:for|on))?\s*(.*?)\??$/i);
  if (!asked) return null;
  const start = new Date(input.day);
  start.setHours(0, 0, 0, 0);
  const when = asked[1].trim();
  if (when && !/^today$/i.test(when)) {
    const on = moveDay(when, start);
    if (!on) return "I don't know that day.";
    start.setFullYear(on.getFullYear(), on.getMonth(), on.getDate());
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const finishedTodos = new Set(
    (input.completions ?? [])
      .filter((completion) => input.chores.some((chore) => chore.id === completion.choreId && chore.taskType === "todo"))
      .map((completion) => completion.choreId),
  );
  const done = new Set(
    (input.completions ?? [])
      .filter((completion) => {
        if (!completion.completedAt) return false;
        const at = new Date(completion.completedAt);
        return at >= start && at < end;
      })
      .map((completion) => completion.choreId),
  );
  const lines: string[] = [];
  for (const chore of input.chores) {
    if (chore.id && (done.has(chore.id) || finishedTodos.has(chore.id))) continue;
    if (!dueOnDay(chore, start)) continue;
    lines.push(chore.title);
  }
  for (const event of input.events) {
    const at = new Date(event.startTime);
    if (at >= start && at < end) lines.push(event.title);
  }
  const kept = lines.slice(0, 5);
  const askedToday = start.toDateString() === new Date(input.day).toDateString();
  const dinner = input.meals ? dinnerName(input.meals, start) : askedToday ? input.dinner : null;
  if (dinner) kept.push(`Dinner. ${dinner}`);
  return kept.join("\n") || "Nothing on the plan.";
}

export function memoryFact(
  text: string,
  profiles: { id: string; name: string; isAllFamilyProfile?: boolean | null }[],
): { profileId: string; name: string; fact: string } | null {
  const match = text.trim().match(/^remember (?:that )?(.+?) ((?:is|likes|has) .+?)\.?$/i);
  const who = match?.[1]?.trim();
  const fact = match?.[2]?.trim();
  if (!who || !fact) return null;
  const profile = profiles.find((person) => person.name.trim().toLowerCase() === who.toLowerCase());
  if (!profile || profile.isAllFamilyProfile) return null;
  return { profileId: profile.id, name: profile.name, fact };
}

export function forgetFact(
  text: string,
  profiles: { id: string; name: string; facts?: string[] | null; isAllFamilyProfile?: boolean | null }[],
): { profileId: string; name: string; fact: string; facts: string[] } | { reply: string } | null {
  const match = text.trim().match(/^forget (?:that )?(.+?) ((?:is|likes|has) .+?)\.?$/i);
  const who = match?.[1]?.trim();
  const fact = match?.[2]?.trim();
  if (!who || !fact) return null;
  const profile = profiles.find((person) => person.name.trim().toLowerCase() === who.toLowerCase());
  if (!profile || profile.isAllFamilyProfile) return { reply: `I don't see ${who}.` };
  const existing = profile.facts ?? [];
  const facts = existing.filter((item) => item.toLowerCase() !== fact.toLowerCase());
  if (facts.length === existing.length) return { reply: `I don't remember that about ${profile.name}.` };
  return { profileId: profile.id, name: profile.name, fact, facts };
}

export function rememberedFacts(existing: string[], fact: string): string[] {
  if (existing.some((item) => item.toLowerCase() === fact.toLowerCase())) return existing;
  return [...existing, fact];
}

export function memoryReply(
  text: string,
  profiles: { name: string; facts?: string[] | null }[],
): string | null {
  const match = text.trim().match(/^what do you remember about (.+?)\??$/i);
  const who = match?.[1]?.trim();
  if (!who) return null;
  const profile = profiles.find((person) => person.name.trim().toLowerCase() === who.toLowerCase());
  if (!profile) return `I don't see ${who}.`;
  const facts = profile.facts ?? [];
  if (facts.length === 0) return `I don't remember anything about ${profile.name}.`;
  return facts.map((fact) => `${profile.name} ${fact}`).join("\n");
}

export function schoolFact(
  text: string,
  profiles: { id: string; name: string }[],
): { profileId: string; name: string; school: string } | null {
  const match = text.trim().match(/^(.+?)['’]s school is\s+(.+?)\.?$/i);
  const who = match?.[1]?.trim().toLowerCase();
  const school = match?.[2]?.trim();
  if (!who || !school) return null;
  const profile = profiles.find((person) => person.name.trim().toLowerCase() === who);
  if (!profile) return null;
  return { profileId: profile.id, name: profile.name, school };
}

export function schoolReply(
  text: string,
  profiles: { name: string; school?: string | null }[],
  selfName?: string | null,
): string | null {
  const mine = /^what(?:'s| is) my school\??$/i.test(text.trim());
  const named = text.trim().match(/^what(?:'s| is)\s+(.+?)['’]s school\??$/i);
  const who = (mine ? selfName : named?.[1])?.trim();
  if (!who) return null;
  const profile = profiles.find((person) => person.name.trim().toLowerCase() === who.toLowerCase());
  if (!profile) return `I don't see ${who}.`;
  if (!profile.school) return `${profile.name} doesn't have a school saved.`;
  return `${profile.name}'s school is ${profile.school}.`;
}

export function drivingReply(
  text: string,
  events: { title: string; drivingProfileIds?: string[] | null }[],
  profiles: { id: string; name: string }[],
): string | null {
  const asked = text.trim().match(/^who(?:'s| is) driving\s+(.+?)\??$/i)?.[1]?.trim();
  if (!asked) return null;
  const event = events.find((item) => item.title.toLowerCase().includes(asked.toLowerCase()));
  if (!event) return `I don't see ${asked}.`;
  const names = (event.drivingProfileIds ?? [])
    .map((id) => profiles.find((profile) => profile.id === id)?.name)
    .filter((name): name is string => !!name);
  if (names.length === 0) return `Nobody is set to drive ${event.title}.`;
  if (names.length === 1) return `${names[0]} is driving ${event.title}.`;
  const last = names[names.length - 1];
  return `${names.slice(0, -1).join(", ")} and ${last} are driving ${event.title}.`;
}

export function familyReply(
  text: string,
  profiles: { name: string; school?: string | null; facts?: string[] | null; isAllFamilyProfile?: boolean | null }[],
): string | null {
  if (!/^who(?:'s| is) (?:in|on) the family\??$/i.test(text.trim())) return null;
  const people = profiles.filter((person) => person.name.trim() && !person.isAllFamilyProfile);
  if (people.length === 0) return "Nobody is in the family yet.";
  return people.map((person) => [person.name, person.school, ...(person.facts ?? [])].filter(Boolean).join(", ")).join("\n");
}

export function placeReply(text: string, events: { title: string; location?: string | null }[]): string | null {
  const asked = text.trim().match(/^where(?:'s| is)\s+(.+?)\??$/i)?.[1]?.trim();
  if (!asked) return null;
  const event = events.find((item) => item.title.toLowerCase().includes(asked.toLowerCase()));
  const link = (place: string) => `https://maps.apple.com/?q=${encodeURIComponent(place)}`;
  if (!event) return link(asked);
  if (!event.location?.trim()) return `${event.title} doesn't have a place saved.`;
  const place = event.location.trim();
  return `${event.title} is at ${place}. ${link(place)}`;
}

export function weatherReply(
  text: string,
  weather: { location?: string | null; temperature?: number | null; condition?: string | null } | null,
): string | null {
  if (!/^what(?:'s| is) the weather\??$/i.test(text.trim())) return null;
  if (!weather || weather.temperature == null) return "I don't have the weather.";
  const place = weather.location ? ` in ${weather.location}` : "";
  const condition = weather.condition ? `, ${weather.condition}` : "";
  return `${Math.round(weather.temperature)}°${place}${condition}.`;
}

export function newsletterTitles(text: string, rows: { title: string; category?: string | null }[]): string[] | null {
  if (!/^newsletters?\.?$/i.test(text.trim())) return null;
  return rows.filter((row) => row.category === "school_email").map((row) => row.title).slice(0, 5);
}

export function searchHits(text: string, rows: { title: string; description?: string | null }[]): string[] | null {
  const query = text.trim().match(/^search\s+(.+?)\.?$/i)?.[1]?.trim().toLowerCase();
  if (!query) return null;
  return rows
    .filter((row) => `${row.title}\n${row.description ?? ""}`.toLowerCase().includes(query))
    .map((row) => row.title)
    .slice(0, 5);
}

export function muteAddress(text: string): string | null {
  const match = text.trim().match(/^mute\s+(\S+@\S+)$/i);
  const address = match?.[1]?.replace(/\.+$/, "");
  return address || null;
}

export function notRelevantTitle(text: string): string | null {
  const match = text.trim().match(/^(?:not relevant|ignore)\s+(.+?)\.?$/i);
  const title = match?.[1]?.trim();
  return title || null;
}

export function moveEventWhen(text: string, from = new Date()): { title: string; hours?: number; minutes?: number; on?: Date } | null {
  const match = text.trim().match(/^move\s+(.+?)\s+to\s+(.+?)\.?$/i);
  if (!match) return null;
  const title = match[1].trim();
  const when = match[2].trim();
  if (!title || !when) return null;
  const clock = when.match(/^(.*?)(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  let hours: number | undefined;
  let minutes: number | undefined;
  let dayPart = when;
  if (clock) {
    let parsed = Number(clock[2]);
    const parsedMinutes = clock[3] ? Number(clock[3]) : 0;
    const suffix = clock[4].toLowerCase();
    if (parsed >= 1 && parsed <= 12 && parsedMinutes <= 59) {
      if (suffix === "pm" && parsed !== 12) parsed += 12;
      if (suffix === "am" && parsed === 12) parsed = 0;
      hours = parsed;
      minutes = parsedMinutes;
      dayPart = clock[1].replace(/\s+at\s*$/i, "").trim();
    }
  }
  const on = moveDay(dayPart, from);
  if (!on && hours == null) return null;
  return { title, ...(hours != null ? { hours, minutes } : {}), ...(on ? { on } : {}) };
}

export function moveDay(dayPart: string, from: Date): Date | undefined {
  if (!dayPart) return undefined;
  if (/^today$/i.test(dayPart)) return new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (/^tomorrow$/i.test(dayPart)) {
    const on = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    on.setDate(on.getDate() + 1);
    return on;
  }
  return eventOn(`event ${dayPart}`, from)?.on;
}

export function deleteEventTitle(text: string): string | null {
  const match = /^(?:please\s+)?(?:delete|remove|cancel)\s+(?:the\s+)?(?:event\s+)?["']?(.+?)["']?\.?$/i.exec(text.trim());
  const title = match?.[1]?.trim();
  if (!title || /^(?:yes|no)$/i.test(title)) return null;
  return title;
}

/** Imported events stay until the person confirms. App-made rows do not. */
export function importedEventNeedsConfirm(source: string | null | undefined): boolean {
  return !!source && source !== "app" && source !== "meal";
}

export function moveEventAction(source: string | null | undefined, id: string): "keep-meal" | "keep-google" | "confirm" | "move" {
  if (source === "meal") return "keep-meal";
  if (id.startsWith("google-")) return "keep-google";
  if (importedEventNeedsConfirm(source)) return "confirm";
  return "move";
}

export function deleteEventAction(source: string | null | undefined, id: string): "keep" | "confirm" | "delete" {
  if (id.startsWith("google-") || source === "meal") return "keep";
  if (importedEventNeedsConfirm(source)) return "confirm";
  return "delete";
}
