import type { QueryClient } from "@tanstack/react-query";

/**
 * Health reminders are fetched under four different query keys, and a change
 * to one has to reach all of them.
 *
 * ⚠️ THIS IS THE BUG, after five wrong theories and as many rebuilds. The
 * reminder form invalidated only its own key —
 * `/api/health-reminders?profileId=X&includePaused=true` — while the device
 * scheduler reads the plain `/api/health-reminders`. React Query treats those
 * as unrelated, so creating, editing, pausing or deleting a reminder never
 * told the scheduler anything. It kept serving the list it had cached earlier,
 * its effect never re-ran, and iOS was never handed the new reminder.
 *
 * Everything that made this so hard to see follows from that one fact:
 *   - the probes worked, because they pass a reminder straight to the sync and
 *     never touch the query;
 *   - "2 planned, 2 held by iOS" was true, but about OLD reminders from an
 *     earlier fetch — never the one being tested;
 *   - "Re-check reminders" reported a healthy device, because it re-syncs the
 *     same stale list;
 *   - pause and delete appeared to work, because nothing was scheduled to
 *     stop.
 *
 * Matching by prefix rather than listing the keys: the next component to fetch
 * reminders with its own filter would otherwise reintroduce this silently, and
 * the failure is invisible until someone misses a dose.
 */
export function isHealthReminderKey(key: readonly unknown[]): boolean {
  const first = key[0];
  // `/api/health-reminder-events` is deliberately NOT matched: acknowledging a
  // dose changes the event, not the schedule, and those callers invalidate it
  // themselves.
  return typeof first === "string" && first.startsWith("/api/health-reminders");
}

/** Invalidate every health-reminder query, whatever filter it was fetched with. */
export function invalidateHealthReminders(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (q) => isHealthReminderKey(q.queryKey),
  });
}
