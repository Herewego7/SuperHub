import type { Event } from "@workspace/db";

/**
 * Turn this app's recurrence columns into what Google and Outlook each expect.
 *
 * Both describe the same thing in different shapes: Google takes iCalendar
 * lines (`RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU` plus `EXDATE` lines),
 * Outlook takes a structured `PatternedRecurrence` object. Pure functions so
 * the conversion is testable without a network or an account — the part that
 * silently produces a WRONG series is the rule text, not the HTTP call.
 *
 * A local series is stored as one row and expanded on read
 * (lib/eventRecurrence.ts), so the row that syncs IS the series: attaching the
 * rule to that one copy is what makes the external calendar show a series
 * rather than a single event.
 */

const ICAL_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const GRAPH_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function pad(n: number): string { return String(n).padStart(2, "0"); }

/** iCalendar UTC form: 20260914T140000Z */
function icalUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** iCalendar date form: 20260914 */
function icalDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

const FREQ: Record<string, string> = {
  daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", annually: "YEARLY",
};

/** Which weekdays a weekly rule covers. Empty daysOfWeek means "the start
 *  date's own day", which is what every event created before 2026-09-12
 *  means — and what BYDAY has to spell out explicitly for a provider. */
function weeklyDays(event: Event): number[] {
  const days = (event.daysOfWeek ?? []) as number[];
  const clean = [...new Set(days)].filter(d => d >= 0 && d <= 6).sort((a, b) => a - b);
  return clean.length > 0 ? clean : [new Date(event.startTime).getDay()];
}

/**
 * The occurrence instants this series excludes, reconstructed from the stored
 * date keys plus the series' own time of day. EXDATE has to match the
 * occurrence's real start instant or the provider ignores it — and an ignored
 * EXDATE is what would leave a moved occurrence showing TWICE on the external
 * calendar, once in the series and once as its detached copy.
 */
export function excludedInstants(event: Event): Date[] {
  const anchor = new Date(event.startTime);
  return ((event.excludedDates ?? []) as string[])
    .map(key => {
      const [y, m, d] = key.split("-").map(Number);
      if (!y || !m || !d) return null;
      return new Date(y, m - 1, d, anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), 0);
    })
    .filter((d): d is Date => !!d);
}

/** Google Calendar's `recurrence` array. Undefined for a one-off event. */
export function googleRecurrence(event: Event): string[] | undefined {
  const type = event.recurrenceType;
  if (!type || !FREQ[type]) return undefined;

  const parts = [`FREQ=${FREQ[type]}`];
  const interval = Math.max(1, event.recurrenceInterval ?? 1);
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (type === "weekly") {
    parts.push(`BYDAY=${weeklyDays(event).map(d => ICAL_DAYS[d]).join(",")}`);
  }
  if (event.recurrenceEndDate) {
    // "Until 10 Jul" means the whole of the 10th, matching how expansion
    // treats it locally; UNTIL is inclusive, so it points at the END of that
    // day rather than its midnight.
    //
    // ⚠️ UNTIL's value type must match DTSTART's, per RFC 5545. An all-day
    // event's DTSTART is a DATE, so a timestamped UNTIL makes the whole rule
    // invalid — and an invalid rule is rejected or ignored rather than
    // corrected, which loses the end date entirely.
    const end = new Date(event.recurrenceEndDate);
    if (event.isAllDay) {
      parts.push(`UNTIL=${icalDate(end)}`);
    } else {
      end.setHours(23, 59, 59, 0);
      parts.push(`UNTIL=${icalUtc(end)}`);
    }
  }

  const lines = [`RRULE:${parts.join(";")}`];
  const excluded = excludedInstants(event);
  if (excluded.length > 0) {
    lines.push(
      event.isAllDay
        ? `EXDATE;VALUE=DATE:${excluded.map(icalDate).join(",")}`
        : `EXDATE:${excluded.map(icalUtc).join(",")}`,
    );
  }
  return lines;
}

export interface GraphPatternedRecurrence {
  pattern: Record<string, unknown>;
  range: Record<string, unknown>;
}

/** Outlook (Microsoft Graph) `recurrence`. Undefined for a one-off event. */
export function outlookRecurrence(event: Event): GraphPatternedRecurrence | undefined {
  const type = event.recurrenceType;
  if (!type || !FREQ[type]) return undefined;

  const interval = Math.max(1, event.recurrenceInterval ?? 1);
  const start = new Date(event.startTime);
  let pattern: Record<string, unknown>;
  if (type === "daily") {
    pattern = { type: "daily", interval };
  } else if (type === "weekly") {
    pattern = {
      type: "weekly",
      interval,
      daysOfWeek: weeklyDays(event).map(d => GRAPH_DAYS[d]),
      // Graph anchors "every N weeks" to a week start; Sunday matches how
      // expansion walks weeks locally, so the two agree on which weeks are on.
      firstDayOfWeek: "sunday",
    };
  } else if (type === "monthly") {
    pattern = { type: "absoluteMonthly", interval, dayOfMonth: start.getDate() };
  } else {
    pattern = { type: "absoluteYearly", interval, dayOfMonth: start.getDate(), month: start.getMonth() + 1 };
  }

  const startDate = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const range = event.recurrenceEndDate
    ? (() => {
        const e = new Date(event.recurrenceEndDate);
        return {
          type: "endDate",
          startDate,
          endDate: `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`,
        };
      })()
    : { type: "noEnd", startDate };

  return { pattern, range };
}


/**
 * Where a weekly-with-chosen-days series actually starts.
 *
 * Tick Mon+Tue on an event that starts on a Wednesday and the two sides
 * disagree: local expansion keeps the Wednesday (the stored row is always
 * occurrence one) while Google and Outlook expand only Mondays and Tuesdays.
 * The same event would show a different first occurrence in the app and on a
 * connected calendar.
 *
 * Outlook resolves this by moving the start forward to the first ticked day,
 * and that is what happens here — on the way IN, so the stored row already
 * satisfies its own rule and every reader agrees without special cases.
 *
 * Returns null when nothing needs moving.
 */
export function alignStartToWeeklyDays(
  start: Date, end: Date, daysOfWeek: number[] | null | undefined,
): { startTime: Date; endTime: Date } | null {
  const days = [...new Set(daysOfWeek ?? [])].filter(d => d >= 0 && d <= 6);
  if (days.length === 0 || days.includes(start.getDay())) return null;
  // How many days forward to the next ticked weekday (never more than 6).
  let shift = 1;
  while (shift < 7 && !days.includes((start.getDay() + shift) % 7)) shift += 1;
  const ms = shift * 24 * 60 * 60 * 1000;
  return { startTime: new Date(start.getTime() + ms), endTime: new Date(end.getTime() + ms) };
}


/**
 * Which of a series' Outlook instances correspond to occurrences Family Hub
 * has detached, and so should be deleted from the connected calendar.
 *
 * Pulled out of the HTTP call because the matching is where this silently
 * fails: Graph returns `start.dateTime` as a NAIVE string ("2026-09-14T09:00:00")
 * with the zone in a separate field. The series is written with timeZone 'UTC'
 * (see outlookCalendar.toGraphDateTime), so parsing that string without
 * appending the Z it omits interprets it in the SERVER's zone — which matches
 * nothing except on a UTC server, and deleting nothing looks exactly like the
 * feature not existing.
 */
export function outlookInstancesToDelete(
  instances: Array<{ id?: string | null; start?: { dateTime?: string | null } | null } | null | undefined>,
  excluded: Date[],
): string[] {
  const wanted = new Set(excluded.map(d => d.getTime()));
  const ids: string[] = [];
  for (const inst of instances) {
    const raw = inst?.start?.dateTime;
    if (!raw || !inst?.id) continue;
    const hasZone = /[Zz]|[+-]\d\d:?\d\d$/.test(raw);
    const ms = new Date(hasZone ? raw : `${raw}Z`).getTime();
    if (Number.isNaN(ms)) continue;
    if (wanted.has(ms)) ids.push(inst.id);
  }
  return ids;
}
