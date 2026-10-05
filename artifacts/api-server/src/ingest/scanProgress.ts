export type ScanProgress = {
  running: boolean;
  finishedAt: number | null;
  todos: number;
  events: number;
};

const byUser = new Map<string, ScanProgress>();

const idle: ScanProgress = { running: false, finishedAt: null, todos: 0, events: 0 };

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
