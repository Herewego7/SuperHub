import type { HealthReminder, HealthSchedule } from "@workspace/db";

/** A dose stays sent when nobody was waiting, or at least one push went out. */
export function healthDispatchSticks(sent: number, recipients: number): boolean {
  return recipients === 0 || sent > 0;
}
import { localDate, localDayOfWeek } from "./choreToday";

/**
 * For a given local date (YYYY-MM-DD) and HH:MM in `tz`, returns the UTC
 * Date that represents that wall-clock time in that timezone.
 *
 * We compute the UTC offset for that date in tz and apply it.
 */
function localDateTimeToUtc(date: string, hhmm: string, tz: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return new Date(NaN);
  // Compute the offset by formatting a known UTC instant in tz and reading
  // the wall-clock difference. Two passes converge on the right offset across
  // DST boundaries.
  const guess = new Date(`${date}T${pad(h)}:${pad(m)}:00Z`);
  const offset1 = tzOffsetMinutes(guess, tz);
  const corrected = new Date(guess.getTime() - offset1 * 60_000);
  const offset2 = tzOffsetMinutes(corrected, tz);
  return new Date(guess.getTime() - offset2 * 60_000);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function tzOffsetMinutes(at: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const local = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return Math.round((local - at.getTime()) / 60_000);
}

/**
 * Expand a reminder's schedule into all firing instants strictly within
 * [from, to] (inclusive on both ends). Honors startsAt / endsAt and isPaused.
 *
 * Window is intended to be small (a few minutes) — the dispatcher feeds in
 * a rolling firing window each tick.
 */
export function expandOccurrences(
  reminder: Pick<HealthReminder, "scheduleJson" | "startsAt" | "endsAt" | "isPaused">,
  from: Date,
  to: Date,
  tz: string,
): Date[] {
  if (reminder.isPaused) return [];
  if (reminder.endsAt && reminder.endsAt < from) return [];
  const startsAt = reminder.startsAt ?? new Date(0);

  const sched = reminder.scheduleJson as HealthSchedule;
  const out: Date[] = [];

  const pushIfInWindow = (d: Date) => {
    if (Number.isNaN(d.getTime())) return;
    if (d < startsAt) return;
    if (reminder.endsAt && d > reminder.endsAt) return;
    if (d >= from && d <= to) out.push(d);
  };

  switch (sched.kind) {
    case "once": {
      pushIfInWindow(new Date(sched.at));
      break;
    }
    case "daily": {
      // Walk every local day intersecting the window.
      for (const localDay of localDaysInWindow(from, to, tz)) {
        pushIfInWindow(localDateTimeToUtc(localDay, sched.time, tz));
      }
      break;
    }
    case "weekly": {
      const days = new Set(sched.days);
      for (const localDay of localDaysInWindow(from, to, tz)) {
        const dow = localDayOfWeek(new Date(`${localDay}T12:00:00Z`), tz);
        if (!days.has(dow)) continue;
        pushIfInWindow(localDateTimeToUtc(localDay, sched.time, tz));
      }
      break;
    }
    case "monthly": {
      for (const localDay of localDaysInWindow(from, to, tz)) {
        const dom = Number(localDay.slice(8, 10));
        if (dom !== sched.dayOfMonth) continue;
        pushIfInWindow(localDateTimeToUtc(localDay, sched.time, tz));
      }
      break;
    }
  }

  return out;
}

function localDaysInWindow(from: Date, to: Date, tz: string): string[] {
  const start = localDate(from, tz);
  const end = localDate(to, tz);
  if (start === end) return [start];
  // Walk day-by-day; window is small so this is bounded.
  const days: string[] = [];
  let cursor = new Date(`${start}T12:00:00Z`);
  for (let i = 0; i < 8; i++) {
    const day = localDate(cursor, tz);
    days.push(day);
    if (day === end) break;
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return days;
}
