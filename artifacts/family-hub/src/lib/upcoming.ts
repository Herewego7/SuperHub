import { eventClockLine } from "./chatTools";

export const UPCOMING_KINDS = ["all", "todos", "keyDates", "events", "newsletters"] as const;
export type UpcomingKind = (typeof UPCOMING_KINDS)[number];

export const UPCOMING_KIND_LABELS: Record<UpcomingKind, string> = {
  all: "All",
  todos: "To-dos",
  keyDates: "Key dates",
  events: "Events",
  newsletters: "Newsletters",
};

type Row = {
  id: string;
  title: string;
  startTime: Date | string;
  isAllDay?: boolean;
  recurrenceType?: string | null;
  kind?: "todo" | "keyDate" | "event" | "newsletter";
};

export function upcomingKindForMail(categoryOrSource: string | null | undefined): "newsletter" | "todo" {
  return categoryOrSource === "school_email" || categoryOrSource === "school" ? "newsletter" : "todo";
}

/** A school email with a clock is an event. One with no time stays a newsletter. */
export function schoolEventKind(event: { source?: string | null; isAllDay?: boolean | null }): "newsletter" | undefined {
  if (event.source !== "school" || event.isAllDay === false) return undefined;
  return "newsletter";
}

function kindOf(row: Row): "todo" | "keyDate" | "event" | "newsletter" {
  if (row.kind) return row.kind;
  if (row.isAllDay) return "keyDate";
  return "event";
}

export function upcomingClock(row: { startTime: Date | string; kind?: string | null; isAllDay?: boolean | null }): string | null {
  if (row.kind === "todo" || row.isAllDay) return null;
  return eventClockLine("", row.startTime) || null;
}

export function eventSourceChip(source: string | null | undefined): string | null {
  if (source === "scan") return "Scan";
  if (source === "school") return "School email";
  return null;
}

export function dropSchoolTodoTwins<T extends { title: string; category?: string | null }>(
  todos: T[],
  events: { title: string; source?: string | null }[],
): T[] {
  const titled = new Set(events.filter((event) => event.source === "school").map((event) => event.title.toLowerCase()));
  if (titled.size === 0) return todos;
  return todos.filter((todo) => todo.category !== "school_email" || !titled.has(todo.title.toLowerCase()));
}

export function upcomingRows<T extends Row>(rows: T[], kind: UpcomingKind, day: Date): T[] {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const until = new Date(start);
  until.setDate(until.getDate() + 30);
  return rows.filter((row) => {
    const at = new Date(row.startTime);
    if (at < start || at >= until) return false;
    if (kind === "all") return true;
    const got = kindOf(row);
    if (kind === "todos") return got === "todo";
    if (kind === "keyDates") return got === "keyDate";
    if (kind === "events") return got === "event";
    return got === "newsletter";
  });
}
