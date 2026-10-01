import type { Celebration } from "@workspace/db";
import { DEFAULT_TIMEZONE, localDate } from "./timezone";

// Shared by routes.ts (the /api/celebrations endpoints) and
// scheduler/celebrationReminders.ts (the 30/7-day push reminders) so both
// compute "next occurrence" and "days until" the exact same way.

// Validate MM-DD is a real calendar date in a leap year (so Feb 29 is allowed).
export function isValidMonthDay(monthDay: string): boolean {
  if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(monthDay)) return false;
  const [mm, dd] = monthDay.split("-").map(Number);
  // Use a leap year (2024) so Feb 29 is valid; reject 04-31, 02-30, etc.
  const probe = new Date(2024, mm - 1, dd);
  return probe.getMonth() === mm - 1 && probe.getDate() === dd;
}

// Compute the resolved occurrence date for (year, MM-DD), falling back to Feb 28
// when Feb 29 lands in a non-leap year. Returns null if MM-DD is itself invalid.
export function resolveOccurrence(year: number, monthDay: string): Date | null {
  if (!isValidMonthDay(monthDay)) return null;
  const [mm, dd] = monthDay.split("-").map(Number);
  let occ = new Date(year, mm - 1, dd);
  if (occ.getMonth() !== mm - 1) {
    // Feb 29 in a non-leap year -> observe on Feb 28.
    occ = new Date(year, 1, 28);
  }
  occ.setHours(0, 0, 0, 0);
  return occ;
}

// Compute next occurrence Date for a celebration's MM-DD given a "from" date.
export function nextOccurrence(monthDay: string, from: Date): Date {
  const fromMidnight = new Date(from);
  fromMidnight.setHours(0, 0, 0, 0);
  const fromYear = fromMidnight.getFullYear();
  let candidate = resolveOccurrence(fromYear, monthDay);
  if (!candidate) {
    // Defensive: schema validation should have rejected invalid MM-DD already.
    return fromMidnight;
  }
  if (candidate.getTime() < fromMidnight.getTime()) {
    candidate = resolveOccurrence(fromYear + 1, monthDay)!;
  }
  return candidate;
}

export type CelebrationWithMeta = Celebration & {
  nextOccurrence: string;
  daysUntil: number;
  ageThisYear: number | null;
};

/**
 * ⚠️ `tz` is the FAMILY's timezone, and passing it matters.
 *
 * "Today" used to be whatever calendar day it was on the SERVER — which is UTC
 * on Replit. From about 7pm Central onwards, UTC has already rolled over, so
 * every celebration reported itself a day closer than it was: on the evening of
 * Sep 9 a birthday on Sep 11 was labelled "Tomorrow", while the app's own date
 * header (computed in the browser, correctly local) still read Sep 9. Reported
 * exactly that way on 2026-09-10. The same function backs the 30/7-day push
 * reminders, so those fired a day early for anyone west of UTC too.
 *
 * Both dates below are built in the server's own zone and then only ever
 * SUBTRACTED from each other, so the server's timezone cancels out; Math.round
 * absorbs the ±1h that a DST boundary in that zone would otherwise leave.
 */
export function celebrationsWithMeta(
  rows: Celebration[],
  from: Date,
  tz: string = DEFAULT_TIMEZONE,
): CelebrationWithMeta[] {
  const [ty, tm, td] = localDate(from, tz).split("-").map(Number);
  const today = new Date(ty!, tm! - 1, td!);
  today.setHours(0, 0, 0, 0);
  return rows.map((c) => {
    const next = nextOccurrence(c.monthDay, today);
    const days = Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const ageThisYear = c.year ? next.getFullYear() - c.year : null;
    return { ...c, nextOccurrence: next.toISOString(), daysUntil: days, ageThisYear };
  });
}
