export type ScanProgress = {
  running: boolean;
  finishedAt: number | null;
  todos: number;
  events: number;
};

const byUser = new Map<string, ScanProgress>();

const idle: ScanProgress = { running: false, finishedAt: null, todos: 0, events: 0 };

/** A catch-up is owed until a full read finishes after the request. */
export function catchUpPending(requestedAt: Date | null, finishedAt: Date | null): boolean {
  if (!requestedAt) return false;
  if (!finishedAt) return true;
  return requestedAt.getTime() > finishedAt.getTime();
}

/** Ten minutes. The read refreshes this while it is working, so a dead run can be picked up. */
export const SCAN_LOCK_MS = 10 * 60_000;

export function scanLockFresh(startedAt: Date | null, now: Date, finishedAt: Date | null = null, freshMs = SCAN_LOCK_MS): boolean {
  if (!startedAt) return false;
  // A finished read releases the lock even if its heartbeat is recent.
  if (finishedAt && finishedAt.getTime() >= startedAt.getTime()) return false;
  return now.getTime() - startedAt.getTime() < freshMs;
}

export function scanStatusFor(
  memory: ScanProgress,
  row: { requestedAt: Date | null; finishedAt: Date | null },
): { running: boolean; finishedAt: number | null } {
  const pending = catchUpPending(row.requestedAt, row.finishedAt);
  return {
    running: memory.running || pending,
    finishedAt: pending || !row.finishedAt ? null : row.finishedAt.getTime(),
  };
}

export function beginHouseholdScan(userId: string): void {
  byUser.set(userId, { running: true, finishedAt: null, todos: 0, events: 0 });
}

export function finishHouseholdScan(userId: string, counts: { todos: number; events: number }, now = Date.now()): ScanProgress {
  const next = { running: false, finishedAt: now, todos: counts.todos, events: counts.events };
  byUser.set(userId, next);
  return next;
}

export function householdScanProgress(userId: string): ScanProgress {
  return byUser.get(userId) ?? idle;
}
