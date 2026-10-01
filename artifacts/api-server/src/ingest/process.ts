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
};

export function muteSender(state: HouseholdMail, address: string): HouseholdMail {
  const next = address.trim().toLowerCase();
  if (!next || state.mutedSenders.includes(next)) return state;
  return { ...state, mutedSenders: [...state.mutedSenders, next] };
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
      description: message.snippet,
      taskType: "todo",
      category: "school_email",
      points: 0,
      profileIds,
      daysOfWeek: [],
      slipKey: key,
    });
    if (/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(`${message.subject} ${message.snippet}`)) {
      events.push({
        title: message.subject.trim(),
        description: message.snippet,
        source: "school",
        externalId: key,
        profileIds,
      });
    }
  }
  return { todos, events };
}
