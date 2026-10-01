import type { Event } from "@workspace/db";

// Recurring events are stored as a single row (the first occurrence) with a
// recurrenceType — further occurrences are expanded here at read time, the
// same "one row + read-time expansion" approach chores already use, rather
// than materializing many rows per series. This keeps creation a single
// INSERT and avoids per-occurrence cleanup on edit/delete.
//
// Two things detach an occurrence from its series (2026-09-12):
//   • "This event only"  — the occurrence's date goes into `excludedDates` and
//     a plain, non-recurring event row is created in its place. Expansion just
//     skips excluded dates; nothing else in the series changes.
//   • "This and all following" — the series' `recurrenceEndDate` is pulled
//     back to the day before, and a NEW series starts at the occurrence. This
//     needs no exception data at all: it is two ordinary series.
const DEFAULT_HORIZON_MS = 365 * 24 * 60 * 60 * 1000; // 1 year out when no explicit end date
// Annual recurrence needs a much longer default horizon than the other
// three types — a 1-year-out window barely ever contains next year's
// occurrence of a yearly event, which would make "repeat annually" with no
// explicit end date look like it does almost nothing. 10 years still stays
// well under MAX_OCCURRENCES below (10 annual occurrences vs. its 366 cap).
const ANNUAL_DEFAULT_HORIZON_MS = 10 * 365 * 24 * 60 * 60 * 1000; // 10 years out when no explicit end date
const MAX_OCCURRENCES = 366; // hard safety cap regardless of recurrenceType

export type ExpandedEvent = Event & { isRecurringInstance?: boolean; seriesId?: string };

/** Local YYYY-MM-DD, the key `excludedDates` stores. Deliberately local and
 *  not an ISO instant: an exception has to survive the series later changing
 *  its time of day, and "the Tuesday we moved" is a date, not a timestamp. */
export function occurrenceDateKey(date: Date | string): string {
  const d = new Date(date);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function addInterval(date: Date, type: string, n: number): Date {
  const d = new Date(date);
  if (type === "daily") d.setDate(d.getDate() + n);
  else if (type === "weekly") d.setDate(d.getDate() + n * 7);
  else if (type === "monthly") {
    // Clamp to the target month's last day: a bare setMonth() on the 29th–31st
    // overflows short months (Jan 31 + 1 month → Mar 2/3), which duplicated
    // one month and skipped the intended month-end. Standard calendar-app
    // behavior: Jan 31 → Feb 28/29 → Mar 31 → Apr 30 …
    const dayOfMonth = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(dayOfMonth, lastDay));
  } else if (type === "annually") {
    // Same clamping idea as monthly, for the one date that can actually
    // overflow a year: Feb 29 on a birthday/anniversary lands on Feb 28 in
    // any target year that isn't a leap year, instead of overflowing into
    // Mar 1 the way a bare setFullYear() would.
    const month = d.getMonth();
    const dayOfMonth = d.getDate();
    const targetYear = d.getFullYear() + n;
    const lastDay = new Date(targetYear, month + 1, 0).getDate();
    d.setFullYear(targetYear, month, Math.min(dayOfMonth, lastDay));
  }
  return d;
}

/** Copy a date's wall-clock time of day onto another day. */
function atTimeOf(day: Date, timeSource: Date): Date {
  const d = new Date(day);
  d.setHours(timeSource.getHours(), timeSource.getMinutes(), timeSource.getSeconds(), timeSource.getMilliseconds());
  return d;
}

/**
 * Every start time a series produces AFTER its first occurrence, in order.
 *
 * Weekly with `daysOfWeek` is the interesting case and the reason this is a
 * generator rather than `addInterval` in a loop: "every 2 weeks on Mon and
 * Wed" is not a single fixed step. It walks whole weeks from the week the
 * series starts in, and inside each active week emits the ticked days.
 *
 * ⚠️ The stored row IS the first occurrence, so a Tuesday event ticked for
 * Mon+Tue must not back-fill the Monday before it. Anything at or before the
 * anchor is skipped rather than emitted.
 */
function* occurrenceStarts(event: Event): Generator<Date> {
  const anchor = new Date(event.startTime);
  const type = event.recurrenceType!;
  const interval = Math.max(1, event.recurrenceInterval ?? 1);
  const days = (event.daysOfWeek ?? []) as number[];

  if (type === "weekly" && days.length > 0) {
    const ordered = [...new Set(days)].filter(d => d >= 0 && d <= 6).sort((a, b) => a - b);
    if (ordered.length === 0) return;
    // Sunday of the anchor's own week — every subsequent week is a whole
    // number of `interval` weeks from here, which is what makes "every other
    // week" land on the same pair of days rather than drifting.
    const weekStart = new Date(anchor);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    for (let w = 0; ; w += interval) {
      const base = new Date(weekStart);
      base.setDate(base.getDate() + w * 7);
      for (const dow of ordered) {
        const day = new Date(base);
        day.setDate(day.getDate() + dow);
        const start = atTimeOf(day, anchor);
        if (start.getTime() <= anchor.getTime()) continue; // never before the anchor
        yield start;
      }
    }
  }

  for (let n = 1; ; n += 1) {
    yield addInterval(anchor, type, n * interval);
  }
}

export function expandRecurringEvents(events: Event[], now: Date = new Date()): ExpandedEvent[] {
  const result: ExpandedEvent[] = [];
  for (const event of events) {
    const excludedForAnchor = new Set((event.excludedDates ?? []) as string[]);
    // The stored row is occurrence one, so it can be detached like any other:
    // "this event only" on the FIRST occurrence excludes its own date. Guarded
    // on recurrenceType so a plain event is never hidden by a stray exclusion.
    const anchorDetached = !!event.recurrenceType
      && excludedForAnchor.has(occurrenceDateKey(event.startTime));
    if (!anchorDetached) result.push(event);
    if (!event.recurrenceType) continue;

    // "Until" is inclusive of that whole day: the stored end date is a
    // midnight instant, so comparing occurrence *start times* against it
    // directly would drop a final occurrence happening later that same day
    // (e.g. daily 9am event "until Jul 10" lost its Jul 10 occurrence).
    const defaultHorizonMs = event.recurrenceType === "annually" ? ANNUAL_DEFAULT_HORIZON_MS : DEFAULT_HORIZON_MS;
    const horizon = event.recurrenceEndDate
      ? new Date(new Date(event.recurrenceEndDate).getTime() + 24 * 60 * 60 * 1000 - 1)
      : new Date(now.getTime() + defaultHorizonMs);
    const duration = new Date(event.endTime).getTime() - new Date(event.startTime).getTime();
    const excluded = new Set((event.excludedDates ?? []) as string[]);

    let n = 0;
    for (const occStart of occurrenceStarts(event)) {
      if (occStart > horizon) break;
      n += 1;
      if (n >= MAX_OCCURRENCES) break;
      // An excluded date still counts toward the cap: it occupies a slot in
      // the series either way, and not counting it would let a long list of
      // exceptions quietly extend how far the expansion runs.
      if (excluded.has(occurrenceDateKey(occStart))) continue;
      const occEnd = new Date(occStart.getTime() + duration);
      result.push({
        ...event,
        id: `${event.id}::occ::${n}`,
        startTime: occStart,
        endTime: occEnd,
        isRecurringInstance: true,
        seriesId: event.id,
      });
    }
  }
  return result;
}

/** `<id>::occ::<n>` → `<id>`. A synthetic occurrence's id is not a real row. */
export function resolveSeriesEventId(id: string): string {
  const idx = id.indexOf("::occ::");
  return idx === -1 ? id : id.slice(0, idx);
}
