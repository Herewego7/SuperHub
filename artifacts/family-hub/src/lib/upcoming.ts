import { appendPlace, eventClockLine, planEventTitle, schoolSlipTitle } from "./chatTools";
import { routineSeriesIds } from "./homeDay";

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
  recurringEventId?: string | null;
  source?: string | null;
  kind?: "todo" | "keyDate" | "event" | "newsletter";
};

export function upcomingKindForMail(categoryOrSource: string | null | undefined): "newsletter" | "todo" {
  return categoryOrSource === "school_email" || categoryOrSource === "school" ? "newsletter" : "todo";
}

/** Outlook names the series on the occurrence. Upcoming uses that id to skip a weekly practice. */
export function recurringIdFromOutlook(event: { seriesMasterId?: string | null }): string | null {
  const id = event.seriesMasterId?.trim();
  return id ? id : null;
}

/** A subscribed calendar uses one uid for every copy of a repeating event. */
export function recurringIdFromIcal(event: { uid?: string | null }): string | null {
  const id = event.uid?.trim();
  return id ? id : null;
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

export function upcomingTitle(row: { title: string; location?: string | null; drivers?: string[] | null }): string {
  return planEventTitle(appendPlace(row.title, row.location), row.drivers);
}

/** The week grid's second line. A short block never renders this. */
export function timeGridDetail(clock: string, location?: string | null): string {
  const place = location?.trim();
  if (!place || clock.toLowerCase().includes(place.toLowerCase())) return clock;
  return `${clock} · ${place}`;
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

/** A school email already checked off leaves the Upcoming list. A place or a driver does not keep it. */
export function withoutCheckedSchoolEvents<T extends { title: string; source?: string | null }>(
  events: T[],
  slips: { title: string }[],
): T[] {
  const titles = new Set(slips.map((slip) => schoolSlipTitle(slip.title).toLowerCase()));
  if (titles.size === 0) return events;
  return events.filter((event) => event.source !== "school" || !titles.has(schoolSlipTitle(event.title).toLowerCase()));
}

export function dropSchoolTodoTwins<T extends { title: string; category?: string | null }>(
  todos: T[],
  events: { title: string; source?: string | null }[],
): T[] {
  const titled = new Set(events.filter((event) => event.source === "school").map((event) => schoolSlipTitle(event.title).toLowerCase()));
  if (titled.size === 0) return todos;
  return todos.filter((todo) => todo.category !== "school_email" || !titled.has(schoolSlipTitle(todo.title).toLowerCase()));
}

export function upcomingRows<T extends Row>(rows: T[], kind: UpcomingKind, day: Date): T[] {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const until = new Date(start);
  until.setDate(until.getDate() + 30);
  const routine = routineSeriesIds(rows);
  return rows.filter((row) => {
    if (row.source === "meal") return false;
    if (row.recurrenceType === "daily" || row.recurrenceType === "weekly") return false;
    if (row.recurringEventId && routine.has(row.recurringEventId)) return false;
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
