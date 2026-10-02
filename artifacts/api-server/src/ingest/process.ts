/**
 * Adapted from Bot Life functions/src/pipeline/process.ts.
 * That file writes Firestore items through Genkit. Here the same mail becomes
 * one chore row and, when the note names a clock time, one event row.
 * Not-relevant and mute-sender live on the household, not on a person.
 */
import { zonedWallClock } from "../lib/timezone";
import { slipKey, type InboundMessage } from "./parse";

export function inboxScanEnabled(scanInbox: boolean | null | undefined): boolean {
  return scanInbox !== false;
}

export type HouseholdMail = {
  mutedSenders: string[];
  dismissedSlipKeys: string[];
};

export type PlannedTodo = {
  title: string;
  description: string;
  taskType: "todo";
  category: "school_email";
  points: 0;
  profileIds: string[];
  daysOfWeek: number[];
  slipKey: string;
};

export type PlannedEvent = {
  title: string;
  description: string;
  source: "school";
  externalId: string;
  profileIds: string[];
  hours: number;
  minutes: number;
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function calendarDate(year: number, month: number, day: number, from: Date, explicitYear: boolean): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const date = new Date(year, month, day);
  if (date.getMonth() !== month) return null;
  if (!explicitYear) {
    const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    if (date < today) date.setFullYear(from.getFullYear() + 1);
  }
  return date;
}

export function slipDate(text: string, from: Date): Date | null {
  const written = text.toLowerCase().match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (written) {
    const name = written[1] === "sept" ? "sep" : written[1];
    const month = MONTHS.indexOf(name) >= 0 ? MONTHS.indexOf(name) : ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(name.slice(0, 3));
    return calendarDate(from.getFullYear(), month, Number(written[2]), from, false);
  }
  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (!numeric) return null;
  const rawYear = numeric[3] ? Number(numeric[3]) : null;
  const year = rawYear == null ? from.getFullYear() : rawYear < 100 ? 2000 + rawYear : rawYear;
  return calendarDate(year, Number(numeric[1]) - 1, Number(numeric[2]), from, rawYear != null);
}

export function slipDayOffset(text: string, from: Date): number | null {
  const match = text.toLowerCase().match(/\b(?:(next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (!match) return null;
  const target = WEEKDAYS.indexOf(match[2]);
  let offset = (target - from.getDay() + 7) % 7;
  if (match[1] && offset === 0) offset = 7;
  return offset;
}

export function slipClock(text: string): { hours: number; minutes: number } | null {
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const suffix = match[3].toLowerCase();
  if (hours < 1 || hours > 12 || minutes > 59) return null;
  if (suffix === "pm" && hours !== 12) hours += 12;
  if (suffix === "am" && hours === 12) hours = 0;
  return { hours, minutes };
}

function wallNow(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return new Date(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
}

function dayShift(note: string, from: Date): number {
  const weekday = slipDayOffset(note, from);
  if (weekday != null) return weekday;
  if (/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/i.test(note)) return 0;
  return 1;
}

/** The clock in the email is the family's wall time, not the server's. */
export function schoolEventStart(note: string, hours: number, minutes: number, now: Date, timeZone: string): Date {
  const start = wallNow(now, timeZone);
  const named = slipDate(note, start);
  if (named) start.setFullYear(named.getFullYear(), named.getMonth(), named.getDate());
  else start.setDate(start.getDate() + dayShift(note, start));
  const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return zonedWallClock(date, hours, minutes, timeZone);
}

export function muteSender(state: HouseholdMail, address: string): HouseholdMail {
  const next = address.trim().toLowerCase();
  if (!next || state.mutedSenders.includes(next)) return state;
  return { ...state, mutedSenders: [...state.mutedSenders, next] };
}

export function choresDismissedBySlip<T extends { id: string; title: string; category?: string | null }>(chores: T[], key: string): string[] {
  return chores.filter((chore) => chore.category === "school_email" && slipKey(chore.title) === key).map((chore) => chore.id);
}

export function withoutDismissedChores<T extends { title: string; category?: string | null }>(
  chores: T[],
  dismissedSlipKeys: readonly string[],
): T[] {
  if (dismissedSlipKeys.length === 0) return chores;
  const dismissed = new Set(dismissedSlipKeys);
  return chores.filter((chore) => chore.category !== "school_email" || !dismissed.has(slipKey(chore.title)));
}

export function withoutDismissedSlips<T extends { title: string; source?: string | null; externalId?: string | null }>(
  events: T[],
  dismissedSlipKeys: readonly string[],
): T[] {
  if (dismissedSlipKeys.length === 0) return events;
  const dismissed = new Set(dismissedSlipKeys);
  return events.filter((event) => {
    if (event.source !== "school") return true;
    return !((event.externalId && dismissed.has(event.externalId)) || dismissed.has(slipKey(event.title)));
  });
}

export function eventsDismissedBySlip<T extends { id: string; title: string; source?: string | null; externalId?: string | null }>(events: T[], key: string): string[] {
  return events
    .filter((event) => event.source === "school" && (event.externalId === key || slipKey(event.title) === key))
    .map((event) => event.id);
}

export function slipBody(fromAddress: string | undefined, snippet: string): string {
  const address = fromAddress?.trim();
  if (!address) return snippet;
  return `From: ${address}\n${snippet}`;
}

export function slipSender(description: string | null | undefined): string | null {
  const match = description?.match(/^From: (\S+)\n/);
  return match?.[1] ?? null;
}

export function slipQuote(description: string | null | undefined): string {
  if (!description) return "";
  return description.replace(/^From: \S+\n/, "");
}

export function suggestedSchool(text: string): string | null {
  const match = text.match(/\b([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,4}\s+(?:School|Academy|Elementary|Middle|High))\b/);
  return match?.[1] ?? null;
}

export function acceptSchool(current: string | null | undefined, suggestion: string): string | null {
  const next = suggestion.trim();
  if (!next) return current?.trim() || null;
  if (current?.trim()) return current.trim();
  return next;
}

export function dismissSlip(state: HouseholdMail, key: string): HouseholdMail {
  if (!key || state.dismissedSlipKeys.includes(key)) return state;
  return { ...state, dismissedSlipKeys: [...state.dismissedSlipKeys, key] };
}

export function ingestMessages(
  messages: InboundMessage[],
  state: HouseholdMail,
  existingKeys: string[],
  profileIds: string[],
): { todos: PlannedTodo[]; events: PlannedEvent[] } {
  const muted = new Set(state.mutedSenders.map((address) => address.toLowerCase()));
  const seen = new Set([...state.dismissedSlipKeys, ...existingKeys]);
  const todos: PlannedTodo[] = [];
  const events: PlannedEvent[] = [];
  for (const message of messages) {
    if (message.fromAddress && muted.has(message.fromAddress.toLowerCase())) continue;
    const key = slipKey(message.subject);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    todos.push({
      title: message.subject.trim(),
      description: slipBody(message.fromAddress, message.snippet),
      taskType: "todo",
      category: "school_email",
      points: 0,
      profileIds,
      daysOfWeek: [],
      slipKey: key,
    });
    const clock = slipClock(`${message.subject} ${message.snippet}`);
    if (clock) {
      events.push({
        title: message.subject.trim(),
        description: message.snippet,
        source: "school",
        externalId: key,
        profileIds,
        hours: clock.hours,
        minutes: clock.minutes,
      });
    }
  }
  return { todos, events };
}
