import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { chores, choreCompletions, choreSkips, type Chore } from "@workspace/db";
import { withoutDismissedChores } from "../ingest/process";
import { storage } from "../storage";
import { localDate } from "./timezone";

/**
 * Local-day helpers shared by every scheduler/brief that thinks in the user's
 * timezone rather than UTC.
 */
// localDate moved to lib/timezone.ts (kept exported here — several
// schedulers import it from this module).
export { localDate } from "./timezone";

export function localHHMM(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(d);
}

export function localDayOfWeek(d: Date, tz: string): number {
  // 0=Sunday … 6=Saturday, computed in the user's timezone.
  const wd = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: tz,
  }).format(d);
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return map[wd] ?? 0;
}

/**
 * Whether a chore is "due" for a given local date for the given profile:
 * - chore.isActive
 * - profileId is in chore.profileIds
 * - NOT a to-do (taskType === "todo") or a bonus chore — neither is part of
 *   the "required chores for today" set anywhere else in the app (Perfect
 *   Day, Home's progress card, the app's own scheduling helper in
 *   lib/choreSchedule.ts on the frontend)
 * - target-count chores are due every day of their period (any day counts
 *   toward the target); "daily" recurrence is due every day; everything
 *   else needs the local day-of-week in chore.daysOfWeek
 * - chore.endDate has not yet passed
 *
 * This used to treat an EMPTY daysOfWeek as "due every day" — which meant
 * every to-do and every chore left with no explicit days (which includes
 * essentially every to-do, since to-dos have no day concept at all) got
 * counted as "due" here, unconditionally, forever. The frontend's own
 * `isChoreScheduledForDate` (lib/choreSchedule.ts) has always done the
 * opposite (empty daysOfWeek + not daily/target-count = NOT due) — so this
 * function silently disagreed with what the app itself shows, inflating the
 * chore counts in the Daily Brief and bedtime-reminder push notifications
 * (both are the only two callers of this, via getTodayChoresForProfile
 * below) well past what a person's own chore list actually shows.
 */
export function isChoreDueOn(
  chore: Pick<Chore, "isActive" | "profileIds" | "daysOfWeek" | "endDate" | "taskType" | "isBonus" | "targetCount" | "recurrenceType">,
  profileId: string,
  localDay: Date,
  tz: string,
): boolean {
  if (chore.isActive === false) return false;
  if (chore.taskType === "todo") return false;
  if (chore.isBonus) return false;
  const ids = (chore.profileIds as string[] | null) ?? [];
  if (!ids.includes(profileId)) return false;
  if (chore.endDate && localDate(chore.endDate, tz) < localDate(localDay, tz)) {
    return false;
  }
  if (chore.targetCount && chore.targetCount > 0) return true;
  if (chore.recurrenceType === "daily") return true;
  const days = (chore.daysOfWeek as number[] | null) ?? [];
  return days.includes(localDayOfWeek(localDay, tz));
}

// Local-calendar-day key arithmetic (yyyy-mm-dd strings), same convention
// `lib/streak.ts` uses — pure UTC Date math on the date components, never a
// real timezone re-conversion, so it can't drift the way parsing a full
// instant can.
function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// The (week or month) window a target-count chore's progress is measured
// against, as of `todayKey` — weekly = Sun-Sat containing today, monthly =
// the calendar month containing today. Mirrors the frontend's own
// `getPeriodProgress` (lib/choreSchedule.ts) so a chore's "is the target met
// yet" answer agrees between the app and these push notifications.
function targetPeriodKeys(
  chore: Pick<Chore, "recurrenceType">,
  todayKey: string,
): { startKey: string; endKey: string } {
  if (chore.recurrenceType === "monthly") {
    const [y, m] = todayKey.split("-").map(Number);
    const startKey = `${y}-${String(m).padStart(2, "0")}-01`;
    const nextMonthFirst = new Date(Date.UTC(y!, m!, 1));
    const endKey = shiftDateKey(
      `${nextMonthFirst.getUTCFullYear()}-${String(nextMonthFirst.getUTCMonth() + 1).padStart(2, "0")}-01`,
      -1,
    );
    return { startKey, endKey };
  }
  const [y, m, d] = todayKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  const startKey = shiftDateKey(todayKey, -dow);
  const endKey = shiftDateKey(startKey, 6);
  return { startKey, endKey };
}

/**
 * Returns the chores due *today* for a given profile, alongside the set of
 * chore ids the profile has already satisfied — a plain/daily chore counts
 * once it has a completion dated TODAY (local); a target-count chore counts
 * once its completions THIS PERIOD (week or month) reach its target, not
 * merely because today itself has no completion row. Without this
 * distinction, a target-count chore whose target was already met earlier in
 * the week kept showing up as "remaining" here forever, since it's due
 * every day (see isChoreDueOn) and "today" alone would never satisfy it.
 */
export async function getTodayChoresForProfile(
  userId: string,
  profileId: string,
  now: Date,
  tz: string,
): Promise<{ due: Chore[]; completedIds: Set<string> }> {
  const today = localDate(now, tz);
  // Widen the UTC window by a day on either side and re-filter in JS.
  const wideStart = new Date(`${today}T00:00:00Z`);
  wideStart.setUTCDate(wideStart.getUTCDate() - 1);
  const wideEnd = new Date(`${today}T23:59:59Z`);
  wideEnd.setUTCDate(wideEnd.getUTCDate() + 1);

  const allChores = withoutDismissedChores(
    await db.select().from(chores).where(eq(chores.userId, userId)),
    (await storage.getCalendarSettingsByUser(userId))?.dismissedSlipKeys ?? [],
  );

  // "Not today" skips: a parent can drop one chore off one person for one day
  // without unassigning it. A skipped chore isn't shown in the app's own list
  // for that day, so a push must not count it either.
  const skipRows = await db
    .select({ choreId: choreSkips.choreId, skipDate: choreSkips.skipDate })
    .from(choreSkips)
    .where(
      and(
        eq(choreSkips.profileId, profileId),
        gte(choreSkips.skipDate, wideStart),
        lte(choreSkips.skipDate, wideEnd),
      ),
    );
  const skippedToday = new Set(
    skipRows.filter((r) => localDate(r.skipDate, tz) === today).map((r) => r.choreId),
  );

  const due = allChores.filter(
    (c) => isChoreDueOn(c, profileId, now, tz) && !skippedToday.has(c.id),
  );

  // Target-count chores need their WHOLE current period, which can reach up
  // to a month back — widen the completions query to cover that when any
  // due chore needs it, instead of always over-fetching.
  const targetChores = due.filter((c) => (c.targetCount ?? 0) > 0);
  let queryStart = wideStart;
  for (const c of targetChores) {
    const { startKey } = targetPeriodKeys(c, today);
    const start = new Date(`${startKey}T00:00:00Z`);
    if (start < queryStart) queryStart = start;
  }

  const completed = await db
    .select({ choreId: choreCompletions.choreId, completedAt: choreCompletions.completedAt })
    .from(choreCompletions)
    .where(
      and(
        eq(choreCompletions.profileId, profileId),
        gte(choreCompletions.completedAt, queryStart),
        lte(choreCompletions.completedAt, wideEnd),
      ),
    );

  const completedIds = new Set<string>();
  for (const c of due) {
    if ((c.targetCount ?? 0) > 0) {
      const { startKey, endKey } = targetPeriodKeys(c, today);
      const count = completed.filter(
        (cc) =>
          cc.choreId === c.id &&
          cc.completedAt &&
          localDate(cc.completedAt, tz) >= startKey &&
          localDate(cc.completedAt, tz) <= endKey,
      ).length;
      if (count >= c.targetCount!) completedIds.add(c.id);
    } else {
      const doneToday = completed.some(
        (cc) => cc.choreId === c.id && cc.completedAt && localDate(cc.completedAt, tz) === today,
      );
      if (doneToday) completedIds.add(c.id);
    }
  }
  return { due, completedIds };
}

/** Splits a due list into how many are still outstanding regular/daily
 * chores, still-unmet target-count chores, and Inspiration items
 * (affirmation/Bible verse/memory verse/mission/custom — anything whose
 * taskType isn't "chore"/"todo") — these three read very differently to a
 * parent ("2 chores left" vs. "hasn't hit this week's target yet" vs. "an
 * affirmation to check off"), so pushes should never collapse them into one
 * bare number. Inspiration items have no targetCount, so without this split
 * they were silently counted as plain "chores" (isChoreDueOn only excludes
 * to-dos and bonus chores, not Inspiration's other taskTypes) — a push
 * saying "1 chore left" for a profile whose only outstanding item was an
 * affirmation was confusing, since nothing in the app's own chore list
 * showed a matching "chore." */
export function splitRemaining(
  due: Pick<Chore, "id" | "targetCount" | "taskType">[],
  completedIds: Set<string>,
): { regular: number; target: number; inspiration: number } {
  let regular = 0;
  let target = 0;
  let inspiration = 0;
  for (const c of due) {
    if (completedIds.has(c.id)) continue;
    if ((c.targetCount ?? 0) > 0) target++;
    else if (c.taskType && c.taskType !== "chore") inspiration++;
    else regular++;
  }
  return { regular, target, inspiration };
}

/** "2 chores" / "1 target" / "2 chores, 1 target, 1 inspiration" / "" (nothing
 * outstanding). */
export function describeRemaining(regular: number, target: number, inspiration = 0): string {
  const parts: string[] = [];
  if (regular > 0) parts.push(`${regular} chore${regular === 1 ? "" : "s"}`);
  if (target > 0) parts.push(`${target} target${target === 1 ? "" : "s"}`);
  if (inspiration > 0) parts.push(`${inspiration} inspiration${inspiration === 1 ? "" : "s"}`);
  return parts.join(", ");
}
