// Fallback timezone used ONLY when a family has no location_settings row yet
// (e.g. onboarding's Location step was skipped) — every scheduler that reads
// a family's timezone needs *some* value to compute "local time" with, and
// this is what the rest of the app already treats as its own default (see
// location_settings.timezone's own column default, and storage.ts/routes.ts,
// which both already fall back to this same value). Previously several
// scheduler files independently fell back to "UTC" instead — for any family
// without a saved location, that silently fired every timed push (bedtime,
// daily brief, weekly recap, health reminders) at the wrong local time,
// often several hours off. "America/Chicago" isn't correct for every family
// either, but it matches this app's own established default elsewhere,
// rather than introducing a second, different wrong answer.
export const DEFAULT_TIMEZONE = "America/Chicago";

/**
 * The calendar date (yyyy-mm-dd) at instant `d` in timezone `tz`.
 *
 * Lives here rather than in choreToday.ts so anything needing "what day is it
 * for this family" can have it without pulling in the database — lib/celebrations.ts
 * is imported by a pure unit test and must stay dependency-free.
 */
export function localDate(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
