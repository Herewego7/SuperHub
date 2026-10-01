import type { Event } from "@workspace/db";
import { occurrenceDateKey } from "./eventRecurrence";

/**
 * Editing one occurrence of a repeating event.
 *
 * Three scopes, the same three every calendar offers:
 *   • "series"     — change the whole thing. The original behaviour.
 *   • "occurrence" — this one only. The occurrence's date is added to the
 *     series' `excludedDates` and a plain, non-recurring event takes its
 *     place. Nothing else about the series changes.
 *   • "future"     — this one and everything after it. The series' end date is
 *     pulled back to the day before, and a NEW series starts at this
 *     occurrence carrying the edit. No exception data needed: afterwards there
 *     are simply two series.
 *
 * Pure on purpose — this is the part that is easy to get subtly wrong (an
 * off-by-one on the split date silently duplicates or drops an occurrence),
 * and it needs to be testable without a database.
 */
export type EditScope = "series" | "occurrence" | "future";

export interface RecurringEditPlan {
  /** Fields to write onto the existing series row. */
  seriesPatch: Record<string, unknown>;
  /** A brand-new event row to insert, if this scope needs one. */
  newEvent: Record<string, unknown> | null;
}

/** Fields that describe the recurrence rule itself, rather than the event. */
const RULE_FIELDS = [
  "recurrenceType", "recurrenceEndDate", "recurrenceInterval", "daysOfWeek", "excludedDates",
] as const;

function eventBody(series: Event): Record<string, unknown> {
  const body: Record<string, unknown> = { ...series };
  delete body.id;
  delete body.createdAt;
  for (const f of RULE_FIELDS) delete body[f];
  return body;
}

/** Midnight at the start of the day before `date`, in local time. */
function dayBefore(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function planRecurringEdit(
  series: Event,
  scope: EditScope,
  occurrenceStart: Date,
  updates: Record<string, unknown>,
): RecurringEditPlan {
  const isFirst = occurrenceDateKey(series.startTime) === occurrenceDateKey(occurrenceStart);

  // Nothing to split or detach: either the caller asked for the whole series,
  // or this event does not repeat at all. Editing the FIRST occurrence with
  // scope "future" is also just a series edit — everything from the first
  // occurrence onward IS the series.
  if (scope === "series" || !series.recurrenceType || (scope === "future" && isFirst)) {
    return { seriesPatch: updates, newEvent: null };
  }

  if (scope === "occurrence") {
    const excluded = [...new Set([...((series.excludedDates ?? []) as string[]), occurrenceDateKey(occurrenceStart)])];
    const duration = new Date(series.endTime).getTime() - new Date(series.startTime).getTime();
    const occEnd = new Date(occurrenceStart.getTime() + duration);
    return {
      seriesPatch: { excludedDates: excluded },
      newEvent: {
        ...eventBody(series),
        startTime: occurrenceStart,
        endTime: occEnd,
        // The detached copy stands alone; it must not repeat, or one edit
        // would spawn a second full series on top of the first.
        recurrenceType: null,
        recurrenceEndDate: null,
        recurrenceInterval: 1,
        daysOfWeek: null,
        excludedDates: null,
        ...updates,
      },
    };
  }

  // "future": end the old series the day before this occurrence, and start a
  // new one here. Exclusions that belong to the tail move with it; ones before
  // the split stay behind, so neither side carries the other's exceptions.
  const splitKey = occurrenceDateKey(occurrenceStart);
  const existing = (series.excludedDates ?? []) as string[];
  const duration = new Date(series.endTime).getTime() - new Date(series.startTime).getTime();
  return {
    seriesPatch: { recurrenceEndDate: dayBefore(occurrenceStart) },
    newEvent: {
      ...eventBody(series),
      startTime: occurrenceStart,
      endTime: new Date(occurrenceStart.getTime() + duration),
      recurrenceType: series.recurrenceType,
      recurrenceEndDate: series.recurrenceEndDate ?? null,
      recurrenceInterval: series.recurrenceInterval ?? 1,
      daysOfWeek: series.daysOfWeek ?? null,
      excludedDates: existing.filter(k => k >= splitKey),
      ...updates,
    },
  };
}

/**
 * Deleting ONE occurrence, or this one and everything after it.
 *
 * Same two mechanisms as editing, minus the replacement row — there is nothing
 * to put back. Returns the patch to apply to the series, or null meaning
 * "delete the row outright".
 *
 * Without this the only option offered was the whole series, so removing one
 * cancelled week meant losing the other fifty-one (reported 2026-09-13).
 */
export function planRecurringDelete(
  series: Event,
  scope: EditScope,
  occurrenceStart: Date,
): Record<string, unknown> | null {
  const isFirst = occurrenceDateKey(series.startTime) === occurrenceDateKey(occurrenceStart);

  // Deleting from the first occurrence onward removes everything, and
  // "this event only" on a series with no other occurrences is the same.
  if (scope === "series" || !series.recurrenceType) return null;
  if (scope === "future" && isFirst) return null;

  if (scope === "occurrence") {
    const excluded = [...new Set([
      ...((series.excludedDates ?? []) as string[]),
      occurrenceDateKey(occurrenceStart),
    ])];
    return { excludedDates: excluded };
  }

  const splitKey = occurrenceDateKey(occurrenceStart);
  return {
    recurrenceEndDate: dayBefore(occurrenceStart),
    // Exceptions after the new end are dead weight; keeping them would leave
    // the row claiming to exclude days the series no longer reaches.
    excludedDates: ((series.excludedDates ?? []) as string[]).filter(k => k < splitKey),
  };
}
