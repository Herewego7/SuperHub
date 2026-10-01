/**
 * Adapted from Bot Life functions/src/pipeline/process.ts.
 * That file writes Firestore items through Genkit. Here the same mail becomes
 * one chore row and, when the note names a clock time, one event row.
 * Not-relevant and mute-sender live on the household, not on a person.
 */
import { slipKey, type InboundMessage } from "./parse";

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

export function slipDate(text: string, from: Date): Date | null {
  const match = text.toLowerCase().match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (!match) return null;
  const name = match[1] === "sept" ? "sep" : match[1];
  const month = MONTHS.indexOf(name) >= 0 ? MONTHS.indexOf(name) : ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(name.slice(0, 3));
  const day = Number(match[2]);
  if (month < 0 || day < 1 || day > 31) return null;
  const date = new Date(from.getFullYear(), month, day);
  if (date.getMonth() !== month) return null;
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (date < today) date.setFullYear(from.getFullYear() + 1);
  return date;
}

export function slipDayOffset(text: string, from: Date): number | null {
  const match = text.toLowerCase().match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (!match) return null;
  const target = WEEKDAYS.indexOf(match[1]);
  return (target - from.getDay() + 7) % 7;
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

export function muteSender(state: HouseholdMail, address: string): HouseholdMail {
  const next = address.trim().toLowerCase();
  if (!next || state.mutedSenders.includes(next)) return state;
  return { ...state, mutedSenders: [...state.mutedSenders, next] };
}

export function choresDismissedBySlip<T extends { id: string; title: string; category?: string | null }>(chores: T[], key: string): string[] {
  return chores.filter((chore) => chore.category === "school_email" && slipKey(chore.title) === key).map((chore) => chore.id);
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
