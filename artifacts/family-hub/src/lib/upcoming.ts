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

function kindOf(row: Row): "todo" | "keyDate" | "event" | "newsletter" {
  if (row.kind) return row.kind;
  if (row.isAllDay) return "keyDate";
  return "event";
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
