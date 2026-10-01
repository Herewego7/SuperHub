import type { Chore, ChoreCompletion } from "@workspace/shared-types";

// Shared by chores-view.tsx and people-view.tsx, which both need "is this
// chore due on this date" and "how much progress has a target-count chore
// made this period" — previously each file hand-rolled its own copy, and
// people-view.tsx's copy checked "monthly" against day-of-MONTH
// (`daysOfWeek.includes(date.getDate())`) instead of day-of-week like every
// other recurrence check in the app — a real bug, not just duplication,
// fixed here by standardizing on day-of-week everywhere.
//
// home-view.tsx's "Today's Progress" card is deliberately NOT unified with
// this — it blends in a third bucket (daily content/affirmations) that has
// no chore equivalent, excludes target-count chores and unassigned chores
// entirely, and doesn't check endDate, so its percentage means something
// different by design. Sharing the primitive here doesn't force that surface
// to change what it displays.
export function isChoreScheduledForDate(chore: Chore, date: Date): boolean {
  if (!chore.isActive) return false;
  if (chore.endDate && new Date(chore.endDate) < date) return false;
  if (chore.targetCount && chore.targetCount > 0) return true;
  const dow = date.getDay();
  if (chore.recurrenceType === "daily") return true;
  if (chore.recurrenceType === "weekly" || chore.recurrenceType === "monthly") {
    return chore.daysOfWeek.includes(dow);
  }
  return chore.daysOfWeek.includes(dow);
}

// Compares calendar days only (not time-of-day) — "today" is never future,
// regardless of what time it currently is.
export function isFutureDate(date: Date): boolean {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() > today.getTime();
}

export function getPeriodProgress(
  chore: Chore,
  profileId: string,
  completions: ChoreCompletion[],
  referenceDate: Date,
): number {
  if (!chore.targetCount || chore.targetCount <= 0) return 0;
  const period = chore.recurrenceType || "weekly";
  let start: Date;
  let end: Date;
  if (period === "monthly") {
    start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
    end = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0, 23, 59, 59, 999);
  } else {
    const dow = referenceDate.getDay();
    start = new Date(referenceDate);
    start.setDate(referenceDate.getDate() - dow);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  }
  return completions.filter((c) => {
    if (!c.completedAt) return false;
    const d = new Date(c.completedAt);
    return c.choreId === chore.id && c.profileId === profileId && d >= start && d <= end;
  }).length;
}
