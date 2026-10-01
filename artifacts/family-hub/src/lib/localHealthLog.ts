/**
 * A small persistent log of what this device did with medication reminders.
 *
 * ⚠️ WHY THIS EXISTS. Five theories about why reminders never arrive have each
 * been disproved by a device test, at the cost of a rebuild apiece: permission,
 * the trigger time, the distance ahead, the schedule/cancel sequence, and a
 * genuine race between overlapping syncs. Every one was plausible and every one
 * was wrong, because every diagnostic so far reports the state AT THE MOMENT IT
 * IS READ — and reading it re-runs the sync, which re-schedules whatever was
 * missing. The app has never been able to say what happened while nobody was
 * looking, which is precisely the window the bug lives in.
 *
 * This records events as they happen, survives a force-quit, and can be read
 * back afterwards. It is a debugging instrument, not a feature: it holds no
 * medication names, no doses and no person's name — only ids, counts and
 * timestamps — so it stays safe to paste into a chat.
 */

const KEY = "localHealthLog_v1";
/** Enough to cover several days of syncing without growing without bound. */
const MAX_ENTRIES = 200;

export interface HealthLogEntry {
  /** ISO timestamp, local clock. */
  t: string;
  kind: "sync" | "delivered" | "scheduled" | "cancelled" | "note";
  detail: Record<string, unknown>;
}

export function logHealthEvent(kind: HealthLogEntry["kind"], detail: Record<string, unknown>): void {
  try {
    const entries = readHealthLog();
    entries.push({ t: new Date().toISOString(), kind, detail });
    // Keep the newest; an old entry is worth less than a current one and the
    // quota is small.
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* private mode, blocked storage, or over quota — a diagnostic must never
       be the thing that breaks the feature it is diagnosing. */
  }
}

export function readHealthLog(): HealthLogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearHealthLog(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* see above */
  }
}

/** Compact, paste-friendly rendering — newest last, so it reads as a story. */
export function formatHealthLog(entries: HealthLogEntry[]): string {
  if (entries.length === 0) return "Nothing logged yet.";
  return entries
    .map((e) => {
      const time = new Date(e.t).toLocaleTimeString();
      return `${time} ${e.kind} ${JSON.stringify(e.detail)}`;
    })
    .join("\n");
}
