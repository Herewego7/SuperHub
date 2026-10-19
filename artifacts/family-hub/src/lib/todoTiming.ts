/**
 * When an email to-do belongs on Today's To-dos. Bot Life's rules (PLAN 10,
 * functions/src/core/plan/timing.ts), which keep Fambot's list to the handful
 * of things that need doing now instead of a second inbox. Kept the same as
 * api-server/src/ingest/todoTiming.ts: Home and the evening plan use it.
 *
 * - An undated item from email shows only today, and only while its email is
 *   at most 2 days old. Ones a person typed stay.
 * - A dated item shows from a few days before it's due, by its type: things
 *   to bring or wear the day before, everything else two days before.
 * - Once overdue, things tied to their day (bring, wear, sign-up, getting
 *   ready for an appointment) and offers that end ("last day") are gone; the
 *   rest stay one more day, then leave with a note saying so.
 */
export type TaskType = "sign_form" | "rsvp" | "pay" | "bring" | "wear" | "sign_up" | "prepare" | "other";

export const TASK_TYPES: readonly TaskType[] = ["sign_form", "rsvp", "pay", "bring", "wear", "sign_up", "prepare", "other"];

/** Undated email to-dos stay on Today while their email is at most this many days old. */
export const INBOX_UNDATED_DAYS = 2;

/** How long a late to-do that can still be done stays on Today. */
export const LATE_DAYS = 1;

/** Older than this, a cleared item isn't mentioned in the cleared note any more. */
export const CLEARED_NOTE_DAYS = 14;

const SHOW_FROM_DAYS: Record<TaskType, number> = {
  sign_form: 2,
  rsvp: 2,
  pay: 2,
  bring: 1,
  wear: 1,
  sign_up: 1,
  prepare: 2,
  other: 2,
};

const TIED_TO_THEIR_DAY: ReadonlySet<TaskType> = new Set(["bring", "wear", "sign_up", "prepare"]);

/** Days before its due day an item first shows on Today. */
export function showFromDays(type: TaskType): number {
  return SHOW_FROM_DAYS[type];
}

/** Days an item stays on Today once overdue. */
export function lateDays(type: TaskType): number {
  return TIED_TO_THEIR_DAY.has(type) ? 0 : LATE_DAYS;
}

const TYPE_LINE = /(?:^|\n)Type: (sign_form|rsvp|pay|bring|wear|sign_up|prepare|other)(?:\n|$)/;

/**
 * An item's type: the one the mail reader saved ("Type: rsvp" in its note),
 * else read from its words. Older items were saved before types existed.
 */
export function taskTypeOf(title: string, note?: string | null): TaskType {
  const saved = note?.match(TYPE_LINE)?.[1] as TaskType | undefined;
  if (saved) return saved;
  const text = `${title}\n${note ?? ""}`;
  if (/\b(?:wear|dress (?:up|as|in)|spirit day|pajama day|crazy hair|color day|jersey day|uniform day)\b/i.test(text)) return "wear";
  if (/\b(?:sign[- ]?ups? (?:open|opens|begin|begins|start|starts)|registration (?:opens|begins|starts))\b/i.test(text)) return "sign_up";
  if (/^\s*bring\b|\b(?:bring|pack|send in|send with)\b|\bbackpack\b|\bsack lunch\b/i.test(text)) return "bring";
  if (/^\s*decide:|\brsvp\b|\blet (?:us|me) know if\b|\b(?:will you|are you) (?:attend|coming)\b/i.test(text)) return "rsvp";
  if (/\b(?:pay|payment|fee|fees|tuition|invoice|balance due)\b|\$\d/i.test(text)) return "pay";
  if (/\b(?:sign|signed|permission slip|form|waiver|consent|return the)\b/i.test(text)) return "sign_form";
  if (/\b(?:appointment|check[- ]?up|physical|dentist|doctor|orthodontist)\b/i.test(text)) return "prepare";
  return "other";
}

/** An offer that can't be done late: once its day is over, it's gone. */
export function hardCutoff(text: string): boolean {
  return /\b(?:last|final)\s+day\b|\bsale ends\b|\bno longer (?:available|open)\b|\b(?:ends|closes|closing) (?:today|tonight)\b|\bexpires?\b/i.test(text);
}

export type TodoPlace = "show" | "late" | "cleared" | "hidden";

/**
 * Where an open to-do goes on a day.
 *
 * `dueIn` is its due day minus the day on screen, in days, or null when it
 * has none. `sentDaysAgo` is how old its email is, or null when that isn't
 * known or a person typed it. "cleared" is gone from Today and counted in
 * the cleared note; "hidden" is simply not today's.
 */
export function todoPlace(opts: {
  type: TaskType;
  inbox: boolean;
  dueIn: number | null;
  viewingToday: boolean;
  sentDaysAgo: number | null;
  cutoff: boolean;
}): TodoPlace {
  const { type, inbox, dueIn, viewingToday, sentDaysAgo, cutoff } = opts;
  if (dueIn === null) {
    if (!viewingToday) return "hidden";
    if (inbox && sentDaysAgo !== null && sentDaysAgo > INBOX_UNDATED_DAYS) return sentDaysAgo <= CLEARED_NOTE_DAYS ? "cleared" : "hidden";
    return "show";
  }
  if (dueIn >= 0) return dueIn <= showFromDays(type) ? "show" : "hidden";
  if (!viewingToday) return "hidden";
  const late = -dueIn;
  if (!cutoff && late <= lateDays(type)) return "late";
  return late <= CLEARED_NOTE_DAYS ? "cleared" : "hidden";
}

/**
 * A to-do that was over before anyone could see it: its email was read more
 * than a day after it arrived (a first scan, or catching up), and its due day
 * had already passed by more than a day. It isn't added at all.
 */
export function overWhenFound(due: Date | null, receivedAt: Date | null, readAt: Date): boolean {
  if (!due || !receivedAt) return false;
  const cutoff = readAt.getTime() - 86_400_000;
  return due.getTime() < cutoff && receivedAt.getTime() < cutoff;
}
