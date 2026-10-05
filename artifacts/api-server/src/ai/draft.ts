/**
 * One typed sentence becomes one plan item. The person reviews it before anything is saved.
 * The model may rewrite the wording. A time or a date the sentence did not contain is rejected.
 */
import { askJson, geminiClient, READ_MODELS } from "../geminiClient";
import { schoolEventStart, slipClock, slipDate, slipDayOffset } from "../ingest/process";

export const DRAFT_KINDS = ["task", "event", "keyDate", "backpack", "decision"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export type PlanDraft = {
  kind: DraftKind;
  title: string;
  detail: string;
  date: string | null;
  time: string | null;
  who: string[];
};

const SYSTEM = [
  "Turn one sentence a parent typed into a single plan item.",
  "kind is event (something at a time), keyDate (an all-day date), task (something to do), backpack (something to bring or wear), or decision.",
  "date is yyyy-MM-dd or null. time is like 4:00 PM or null. Never invent a date or a time the sentence does not state.",
  "who uses names from the family list exactly. title is short and does not repeat the date.",
  "JSON {\"kind\":string,\"title\":string,\"detail\":string,\"date\":string|null,\"time\":string|null,\"who\":string[]}",
].join(" ");

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function clockLabel(hours: number, minutes: number): string {
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function namedDay(text: string, now: Date): Date | null {
  const written = slipDate(text, now);
  if (written) return written;
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (/\btomorrow\b/i.test(text)) {
    base.setDate(base.getDate() + 1);
    return base;
  }
  if (/\b(today|tonight)\b/i.test(text)) return base;
  const offset = slipDayOffset(text, now);
  if (offset == null) return null;
  base.setDate(base.getDate() + offset);
  return base;
}

function titleOf(text: string): string {
  const head = text.split(/[,;]/)[0] ?? text;
  const title = head
    .replace(/\b(bring|wear|pack|decide|decision|rsvp)\b/gi, "")
    .replace(/\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/gi, "")
    .replace(/\b(today|tonight|tomorrow|next|this)\b/gi, "")
    .replace(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, "")
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/gi, "")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, "")
    .replace(/\b(at|on|for)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const kept = (title || text.trim()).slice(0, 80);
  return kept.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

function mentioned(text: string, names: string[]): string[] {
  return names.filter((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}('s)?\\b`, "i").test(text);
  });
}

export function draftFromSentence(text: string, names: string[], now: Date): PlanDraft {
  const cleaned = text.trim().slice(0, 1000);
  const clock = slipClock(cleaned);
  const day = namedDay(cleaned, now);
  const backpack = /\b(bring|wear|pack)\b/i.test(cleaned);
  const decision = /\b(decide|decision|rsvp)\b/i.test(cleaned);
  const kind: DraftKind = backpack ? "backpack" : decision ? "decision" : clock ? "event" : day ? "keyDate" : "task";
  const tail = cleaned.split(/[,;]/).slice(1).join(", ").trim();
  return {
    kind,
    title: titleOf(cleaned),
    detail: tail.slice(0, 240),
    date: day ? isoDay(day) : null,
    time: clock ? clockLabel(clock.hours, clock.minutes) : null,
    who: mentioned(cleaned, names),
  };
}

function asTime(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const clock = slipClock(raw);
  if (clock) return clockLabel(clock.hours, clock.minutes);
  const hour24 = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!hour24) return null;
  const hours = Number(hour24[1]);
  const minutes = Number(hour24[2]);
  if (hours > 23 || minutes > 59) return null;
  return clockLabel(hours, minutes);
}

/** The model draft, or null when it invented a time, a date, or a person. */
export function acceptModelDraft(text: string, raw: unknown, names: string[], now: Date): PlanDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const kind = DRAFT_KINDS.find((item) => item === row.kind);
  const title = typeof row.title === "string" ? row.title.trim().slice(0, 80) : "";
  if (!kind || !title) return null;
  const time = asTime(row.time);
  const spoken = slipClock(text);
  if (time && !spoken) return null;
  if (time && spoken && time !== clockLabel(spoken.hours, spoken.minutes)) return null;
  const date = typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : null;
  const named = namedDay(text, now);
  if (date && !named) return null;
  if (date && named && date !== isoDay(named)) return null;
  const who = Array.isArray(row.who)
    ? row.who.flatMap((name) => typeof name === "string" ? mentioned(name, names) : [])
    : [];
  return {
    kind,
    title: kind === "decision" ? title.replace(/^decide:\s*/i, "") : title,
    detail: typeof row.detail === "string" ? row.detail.trim().slice(0, 240) : "",
    date,
    time,
    who,
  };
}

export async function readDraft(text: string, names: string[], now: Date): Promise<PlanDraft> {
  const local = draftFromSentence(text, names, now);
  const ai = geminiClient();
  if (!ai) return local;
  const parsed = await askJson(
    ai,
    READ_MODELS,
    SYSTEM,
    `Family: ${names.join(", ") || "none"}\nNow: ${now.toISOString()}\nSentence: ${text.trim().slice(0, 1000)}`,
  );
  return acceptModelDraft(text, parsed, names, now) ?? local;
}

export function draftLine(draft: PlanDraft): string {
  const labels: Record<DraftKind, string> = {
    task: "To-do",
    event: "Event",
    keyDate: "Key date",
    backpack: "Bring",
    decision: "Decision",
  };
  const match = draft.date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const when = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "";
  const clock = draft.time ? `${when ? `${when} at ` : ""}${draft.time}` : when;
  const who = draft.who.length ? `For ${draft.who.join(" and ")}` : "";
  return [labels[draft.kind], draft.title, clock || "No date yet", who].filter(Boolean).join(" · ");
}

export function normalizeDraft(input: unknown, names: string[]): PlanDraft | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const kind = DRAFT_KINDS.find((item) => item === row.kind);
  const title = typeof row.title === "string" ? row.title.trim().slice(0, 80) : "";
  if (!kind || !title) return null;
  const date = typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : null;
  return {
    kind,
    title,
    detail: typeof row.detail === "string" ? row.detail.trim().slice(0, 240) : "",
    date,
    time: asTime(row.time),
    who: Array.isArray(row.who) ? row.who.flatMap((name) => typeof name === "string" ? mentioned(name, names) : []) : [],
  };
}

function numeric(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

export type DraftWrite =
  | { kind: "todo"; title: string; description: string; profileIds: string[] }
  | { kind: "event"; title: string; start: Date; end: Date; allDay: boolean; description: string; profileIds: string[] };

export function draftWrite(draft: PlanDraft, people: { id: string; name: string }[], now: Date, timeZone: string): DraftWrite | null {
  const ids = people.filter((person) => draft.who.some((name) => name.toLowerCase() === person.name.toLowerCase())).map((person) => person.id);
  const due = draft.date ? `Due ${numeric(draft.date)}.` : "";
  if (draft.kind === "event" || draft.kind === "keyDate") {
    if (!draft.date) return null;
    const clock = draft.time ? slipClock(draft.time) : null;
    const allDay = draft.kind === "keyDate" || !clock;
    const start = schoolEventStart(numeric(draft.date), allDay ? 0 : (clock?.hours ?? 0), allDay ? 0 : (clock?.minutes ?? 0), now, timeZone);
    const end = new Date(start.getTime() + (allDay ? 24 * 60 * 60 * 1000 - 60_000 : 60 * 60 * 1000));
    return { kind: "event", title: draft.title, start, end, allDay, description: draft.detail, profileIds: ids };
  }
  const lead = draft.kind === "backpack" ? `Bring ${draft.title}.` : draft.kind === "decision" ? `Decide: ${draft.title}.` : "";
  const title = draft.kind === "decision" ? `Decide: ${draft.title.replace(/^decide:\s*/i, "")}` : draft.title;
  const description = ["Plan: todo", lead, due, draft.detail].filter(Boolean).join("\n");
  return { kind: "todo", title, description, profileIds: ids };
}
