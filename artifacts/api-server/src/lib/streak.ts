// Timezone-aware date helpers for streak calculation.
// All "day keys" are yyyy-mm-dd in the supplied IANA timezone.

function partsInTz(d: Date, tz: string): { y: number; m: number; d: number; weekday: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  const dayName = get("weekday");
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    weekday: map[dayName] ?? 0,
  };
}

export function dateKeyTz(d: Date, tz: string): string {
  const { y, m, d: day } = partsInTz(d, tz);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function todayKeyTz(tz: string, now = new Date()): string {
  return dateKeyTz(now, tz);
}

export function yesterdayKeyTz(tz: string, now = new Date()): string {
  return previousDayKey(todayKeyTz(tz, now));
}

// ISO week key — Monday-start week, identified by the date (yyyy-mm-dd in tz)
// of that week's Monday in the supplied timezone.
export function isoWeekKeyTz(d: Date, tz: string): string {
  const todayKey = dateKeyTz(d, tz);
  const { weekday } = partsInTz(d, tz);
  // Days to subtract to reach Monday: Sun (0) -> 6, Mon (1) -> 0, … Sat (6) -> 5.
  const offset = (weekday + 6) % 7;
  let key = todayKey;
  for (let i = 0; i < offset; i++) key = previousDayKey(key);
  return key;
}

// Pure-string variant: given a yyyy-mm-dd date key, return the Monday-start
// ISO week key (yyyy-mm-dd of that week's Monday). Independent of any
// timezone — operates on the date key directly so it never round-trips
// through a Date and avoids extreme-offset artifacts.
export function isoWeekKeyFromDateKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  // JS Date in UTC for weekday lookup only.
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const weekday = dt.getUTCDay(); // 0=Sun..6=Sat
  const offset = (weekday + 6) % 7;
  let cursor = key;
  for (let i = 0; i < offset; i++) cursor = previousDayKey(cursor);
  return cursor;
}

export function previousDayKey(key: string): string {
  // Pure calendar arithmetic on a yyyy-mm-dd string — independent of any
  // server/user timezone, since "yesterday's date string" is unambiguous.
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function calendarDayDiff(aKey: string, bKey: string): number {
  const toUtc = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((toUtc(aKey) - toUtc(bKey)) / 86_400_000);
}

/** Return the ISO weekday (0=Sun … 6=Sat) for a yyyy-mm-dd key (UTC-based). */
function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/**
 * Compute streak length given the set of completion-day keys and a set of
 * already-consumed freeze keys (each in tz-local yyyy-mm-dd). Each freeze
 * bridges a single missing day. skipDays (0=Sun … 6=Sat) are days that
 * never require a completion — they are silently skipped over in both
 * directions. Returns { streak, frozenDatesUsed }.
 */
export function computeStreak(
  completionKeys: Set<string>,
  freezeKeys: Set<string>,
  tz: string,
  skipDays: number[] = [],
  now = new Date(),
): { streak: number; frozenDatesUsed: string[] } {
  const today = todayKeyTz(tz, now);

  const isSkip = (k: string) => skipDays.includes(weekdayOfKey(k));
  const covers = (k: string) => completionKeys.has(k) || freezeKeys.has(k);

  // Find the most recent non-skip day starting from today.
  let startCursor = today;
  for (let guard = 0; guard < 7 && isSkip(startCursor); guard++) {
    startCursor = previousDayKey(startCursor);
  }
  // The "day before" anchor must skip over skip-days too — otherwise, the
  // morning after a skip day (before that day's own chores are done), this
  // anchor lands on the skip day itself, which is never "covered" by a
  // completion by definition, and the streak incorrectly reports 0 instead
  // of continuing through to the last real completed day before the skip.
  let startPrev = previousDayKey(startCursor);
  for (let guard = 0; guard < 7 && isSkip(startPrev); guard++) {
    startPrev = previousDayKey(startPrev);
  }

  if (!covers(startCursor) && !covers(startPrev)) {
    return { streak: 0, frozenDatesUsed: [] };
  }

  let streak = 0;
  let cursor = covers(startCursor) ? startCursor : startPrev;
  const usedFreezes: string[] = [];

  for (let guard = 0; guard < 10_000; guard++) {
    if (isSkip(cursor)) {
      cursor = previousDayKey(cursor);
      continue;
    }
    if (!covers(cursor)) break;
    streak++;
    if (freezeKeys.has(cursor) && !completionKeys.has(cursor)) {
      usedFreezes.push(cursor);
    }
    cursor = previousDayKey(cursor);
  }

  return { streak, frozenDatesUsed: usedFreezes };
}
