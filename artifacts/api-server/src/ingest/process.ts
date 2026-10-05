/**
 * Adapted from Bot Life functions/src/pipeline/process.ts.
 * That file writes Firestore items through Genkit. Here the same mail becomes
 * one chore row and, when the note names a clock time, one event row.
 * Not-relevant and mute-sender live on the household, not on a person.
 */
import { zonedWallClock } from "../lib/timezone";
import { slipKey, type InboundMessage } from "./parse";

export function shareScan<T>(inflight: Map<string, Promise<T>>, userId: string, start: () => Promise<T>): Promise<T> {
  const existing = inflight.get(userId);
  if (existing) return existing;
  const job = start().finally(() => {
    if (inflight.get(userId) === job) inflight.delete(userId);
  });
  inflight.set(userId, job);
  return job;
}

export function inboxScanEnabled(scanInbox: boolean | null | undefined): boolean {
  return scanInbox !== false;
}

const GMAIL_READ_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://mail.google.com/",
];

/** null when the token didn't say. A calendar-only grant is false. */
export function gmailScopeGranted(scopes: string[] | null | undefined): boolean | null {
  if (!scopes || scopes.length === 0) return null;
  return scopes.some((scope) => GMAIL_READ_SCOPES.includes(scope));
}

/** One working mailbox is enough. Otherwise report the reason a reconnect can fix. */
export function inboxBlockReason(results: Array<"ok" | "scope" | "unavailable" | "auth">): "ok" | "scope" | "unavailable" | "auth" | "none" {
  if (results.includes("ok")) return "ok";
  if (results.includes("scope")) return "scope";
  if (results.includes("unavailable")) return "unavailable";
  if (results.includes("auth")) return "auth";
  return "none";
}

export function graphNextLink(link: unknown): string | null {
  if (typeof link !== "string" || !link) return null;
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.hostname !== "graph.microsoft.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function inboxListStopped(err: unknown, have: number): boolean {
  return inboxFailure(err) !== "reconnect" && have > 0;
}

export function inboxFailure(err: unknown): "reconnect" | "skip" {
  const kind = inboxMailFailure(err);
  return kind === "auth" || kind === "scope" ? "reconnect" : "skip";
}

function mailStatus(err: object): number | undefined {
  const code = "code" in err ? (err as { code?: unknown }).code : undefined;
  const fromCode = typeof code === "number" ? code : typeof code === "string" ? Number(code) : undefined;
  const status = "status" in err ? (err as { status?: unknown }).status : undefined;
  const fromStatus = typeof status === "number" ? status : undefined;
  const response = "response" in err ? (err as { response?: { status?: number; data?: { error?: { errors?: { reason?: string }[]; status?: string } } } }).response : undefined;
  return fromStatus ?? response?.status ?? (Number.isFinite(fromCode) ? fromCode : undefined);
}

function mailReason(err: object): string {
  const response = "response" in err ? (err as { response?: { data?: { error?: { errors?: { reason?: string }[]; status?: string; message?: string } } } }).response : undefined;
  const error = response?.data?.error;
  const message = typeof error?.message === "string" ? error.message : "";
  if (/has not been used|is disabled|accessNotConfigured/i.test(message)) return "accessNotConfigured";
  if (/insufficient authentication scopes|insufficientPermissions/i.test(message)) return "insufficientPermissions";
  return error?.errors?.[0]?.reason || (error?.status === "PERMISSION_DENIED" ? "" : error?.status) || "";
}

/** A dead token is auth. Mail scope missing is scope. Gmail switched off for the project is unavailable. */
export function inboxMailFailure(err: unknown): "auth" | "scope" | "unavailable" | "skip" {
  if (!err || typeof err !== "object") return "skip";
  const reason = mailReason(err);
  if (reason === "accessNotConfigured") return "unavailable";
  if (reason === "insufficientPermissions") return "scope";
  const status = mailStatus(err);
  if (status === 401) return "auth";
  if (status === 403) return "scope";
  return "skip";
}

export function inboxTokenExpiry(tokenExpiry: Date | string | null | undefined, hasRefresh: boolean): number | undefined {
  if (tokenExpiry) {
    const ms = new Date(tokenExpiry).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return hasRefresh ? 0 : undefined;
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
  endHours?: number;
  endMinutes?: number;
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

function clockFrom(match: RegExpMatchArray): { hours: number; minutes: number } | null {
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const suffix = match[3].toLowerCase();
  if (hours < 1 || hours > 12 || minutes > 59) return null;
  if (suffix === "pm" && hours !== 12) hours += 12;
  if (suffix === "am" && hours === 12) hours = 0;
  return { hours, minutes };
}

const DAY_NEAR = /\b(?:today|tonight|tomorrow|this (?:morning|afternoon|evening)|sunday|monday|tuesday|wednesday|thursday|friday|saturday|january|february|march|april|may|june|july|august|september|october|november|december)\b|\b\d{1,2}\/\d{1,2}\b/i;

function slipRange(text: string): { hours: number; minutes: number; endHours: number; endMinutes: number } | null {
  const ranges = [...text.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi)].flatMap((match) => {
    const suffix = match[3] || match[6];
    const start = clockFrom(["", match[1], match[2] ?? "", suffix] as unknown as RegExpMatchArray);
    const end = clockFrom(["", match[4], match[5] ?? "", match[6]] as unknown as RegExpMatchArray);
    if (!start || !end) return [];
    if (end.hours * 60 + end.minutes <= start.hours * 60 + start.minutes) return [];
    return [{ ...start, endHours: end.hours, endMinutes: end.minutes, index: match.index ?? 0, length: match[0].length }];
  });
  if (ranges.length === 0) return null;
  const near = ranges.find((item) => DAY_NEAR.test(text.slice(Math.max(0, item.index - 24), item.index)));
  const only = ranges.length === 1 ? ranges[0] : null;
  const outside = only
    ? `${text.slice(0, only.index)} ${text.slice(only.index + only.length)}`
    : "";
  const picked = near ?? (only && !/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(outside) ? only : null);
  if (!picked) return null;
  return { hours: picked.hours, minutes: picked.minutes, endHours: picked.endHours, endMinutes: picked.endMinutes };
}

export function slipClock(text: string): { hours: number; minutes: number; endHours?: number; endMinutes?: number } | null {
  const range = slipRange(text);
  if (range) return range;
  const parsed = [...text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi)].flatMap((match) => {
    const clock = clockFrom(match);
    return clock ? [{ clock, index: match.index ?? 0, length: match[0].length }] : [];
  });
  if (parsed.length === 0) return null;
  const before = parsed.find((item) => DAY_NEAR.test(text.slice(Math.max(0, item.index - 24), item.index)));
  if (before) return before.clock;
  const after = parsed.find((item) => DAY_NEAR.test(text.slice(item.index + item.length, item.index + item.length + 24)));
  return (after ?? parsed[0]).clock;
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

function dayShift(note: string, from: Date): number | null {
  const weekday = slipDayOffset(note, from);
  if (weekday != null) return weekday;
  if (/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/i.test(note)) return 0;
  if (/\btomorrow\b/i.test(note)) return 1;
  return null;
}

/** The clock in the email is the family's wall time, not the server's. */
export function schoolEventStart(note: string, hours: number, minutes: number, now: Date, timeZone: string): Date {
  const start = wallNow(now, timeZone);
  const named = slipDate(note, start);
  if (named) start.setFullYear(named.getFullYear(), named.getMonth(), named.getDate());
  else {
    const shift = dayShift(note, start);
    const passed = start.getHours() > hours || (start.getHours() === hours && start.getMinutes() > minutes);
    start.setDate(start.getDate() + (shift == null ? (passed ? 1 : 0) : shift));
  }
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

export function slipBody(fromAddress: string | undefined, snippet: string, body?: string): string {
  const address = fromAddress?.trim();
  const head = !address ? snippet : `From: ${address}\n${snippet}`;
  const extra = body?.trim();
  if (!extra || extra === snippet.trim()) return head;
  return `${head}\n\n${extra}`;
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

export const HELD_EVENT_PREFIX = "event-held:";

export function holdSchoolEvent(keys: readonly string[], key: string): string[] {
  const next = `${HELD_EVENT_PREFIX}${key}`;
  if (!key || keys.includes(next)) return [...keys];
  return [...keys, next];
}

export function dismissSlip(state: HouseholdMail, key: string): HouseholdMail {
  if (!key || state.dismissedSlipKeys.includes(key)) return state;
  return { ...state, dismissedSlipKeys: [...state.dismissedSlipKeys, key] };
}

const FAMILY_PLATFORMS = [
  "parentsquare.com",
  "schoolmessenger.com",
  "konstella.com",
  "classdojo.com",
  "seesaw.me",
  "brightwheel.com",
  "mybrightwheel.com",
  "teamsnap.com",
  "sportsengine.com",
  "signupgenius.com",
  "classroom.google.com",
];

const SCHOOL_WORDS = /\b(school|permission|field trip|picture day|pta|pto|classroom|teacher|homework|practice|recital|tournament|sign-?up|early release|early dismissal|no school|half day|spirit day|book fair|aftercare|conference|parent night|open house|soccer|basketball|baseball|softball|volleyball|football|swim|swimming|cheer)\b/i;

function senderDomain(address: string | undefined): string {
  const at = address?.lastIndexOf("@") ?? -1;
  if (at < 0 || !address) return "";
  return address.slice(at + 1).toLowerCase();
}

function domainIs(domain: string, list: readonly string[]): boolean {
  return list.some((item) => domain === item || domain.endsWith(`.${item}`));
}

export function isSchoolDomain(domain: string): boolean {
  return /(^|\.)k12\.[a-z]{2}\.us$/.test(domain) || /(^|\.)k12\./.test(domain) || /(school|academy|usd|isd)[a-z0-9-]*\.(org|net|edu|us)$/.test(domain);
}

export function mailWorthSaving(message: { subject: string; snippet?: string; body?: string; fromAddress?: string }): boolean {
  const domain = senderDomain(message.fromAddress);
  if (domain && (domainIs(domain, FAMILY_PLATFORMS) || isSchoolDomain(domain))) return true;
  return SCHOOL_WORDS.test(`${message.subject} ${message.snippet ?? ""} ${message.body ?? ""}`);
}

function plannedEvent(message: InboundMessage, key: string, profileIds: string[]): PlannedEvent | null {
  const note = `${message.subject} ${message.body || message.snippet}`.slice(0, 2000);
  const clock = slipClock(note);
  if (!clock) return null;
  return {
    title: message.subject.trim(),
    description: note,
    source: "school",
    externalId: key,
    profileIds,
    hours: clock.hours,
    minutes: clock.minutes,
    ...(clock.endHours != null ? { endHours: clock.endHours, endMinutes: clock.endMinutes } : {}),
  };
}

export function ingestMessages(
  messages: InboundMessage[],
  state: HouseholdMail,
  existingKeys: string[],
  profileIds: string[],
  existingEventKeys: string[] = [],
): { todos: PlannedTodo[]; events: PlannedEvent[] } {
  const muted = new Set(state.mutedSenders.map((address) => address.toLowerCase()));
  const dismissed = new Set(state.dismissedSlipKeys);
  const heldEvents = new Set(
    state.dismissedSlipKeys.flatMap((item) => item.startsWith(HELD_EVENT_PREFIX) ? [item.slice(HELD_EVENT_PREFIX.length)] : []),
  );
  const seen = new Set([...state.dismissedSlipKeys, ...existingKeys]);
  const haveEvent = new Set(existingEventKeys);
  const todos: PlannedTodo[] = [];
  const events: PlannedEvent[] = [];
  for (const message of messages) {
    if (message.fromAddress && muted.has(message.fromAddress.toLowerCase())) continue;
    if (!mailWorthSaving(message)) continue;
    const key = slipKey(message.subject);
    if (!key) continue;
    if (seen.has(key)) {
      if (!dismissed.has(key) && !heldEvents.has(key) && !haveEvent.has(key)) {
        const event = plannedEvent(message, key, profileIds);
        if (event) {
          events.push(event);
          haveEvent.add(key);
        }
      }
      continue;
    }
    seen.add(key);
    todos.push({
      title: message.subject.trim(),
      description: slipBody(message.fromAddress, message.snippet, message.body),
      taskType: "todo",
      category: "school_email",
      points: 0,
      profileIds,
      daysOfWeek: [],
      slipKey: key,
    });
    const event = plannedEvent(message, key, profileIds);
    if (event) {
      events.push(event);
      haveEvent.add(key);
    }
  }
  return { todos, events };
}
