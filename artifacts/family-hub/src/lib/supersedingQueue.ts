/**
 * Run async jobs one at a time, and let a newer job cancel one still waiting.
 *
 * Extracted so the rule can be tested without a device, the way
 * `healthReminderPlan` was split from `localHealthReminders` for the same
 * reason. Import-free on purpose.
 *
 * ⚠️ The bug this exists for (2026-09-29, four rebuilds deep): medication
 * reminders were scheduled with iOS and then silently cancelled again.
 * `syncLocalHealthReminders` was called as `void sync(...)` from a React
 * effect that re-runs on most renders, so several syncs overlapped. Each has
 * several awaits before it mutates the notification centre, which leaves room
 * for:
 *
 *   job A starts with the OLD list  -> it wants nothing scheduled
 *   job B starts with the NEW list  -> it schedules reminder X
 *   job A reaches its cancel step, sees X, X is not in ITS wanted set, cancels
 *
 * The device is left holding nothing, while the app and every later inspection
 * look correct — re-running the sync re-schedules X, so it always appeared
 * present when anyone checked.
 *
 * Two guarantees fix it: jobs never overlap, and a job that has been
 * superseded never runs at all.
 */

export interface SupersedingQueue<T> {
  /** Queue a job. Resolves with its result, or `superseded` if a newer job arrived first. */
  run(job: () => Promise<T>): Promise<T>;
}

export function createSupersedingQueue<T>(superseded: () => T): SupersedingQueue<T> {
  let chain: Promise<T> = Promise.resolve(superseded());
  let generation = 0;

  return {
    run(job: () => Promise<T>): Promise<T> {
      const mine = ++generation;
      // ⚠️ `result` is this job's own promise; `chain` is only the baton.
      // Returning `chain` instead hands every caller whatever the LAST job
      // resolved to, so a caller reading its own result gets someone else's —
      // caught by the test below on the first run.
      const result = chain
        .catch(() => superseded())
        .then(() => {
          // Checked HERE, after waiting its turn — not at call time. A job
          // queued behind a long one is exactly the job whose data has gone
          // stale, and it is the one that does the damage.
          if (mine !== generation) return superseded();
          return job();
        });
      // A failed job must not poison the queue for everything after it.
      chain = result.catch(() => superseded());
      return result;
    },
  };
}
