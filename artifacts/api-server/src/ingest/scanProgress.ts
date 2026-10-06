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

/** Well inside SCAN_LOCK_MS, so a read that is still working never looks abandoned. */
export const SCAN_BEAT_MS = 60_000;

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

export type MailboxRead = { address: string; emails: number; problem?: string };

export type MailTally = {
  reader: string;
  emails: number;
  skipped: number;
  triageSaidNo: number;
  readSaidNo: number;
  readFailed: number;
  nothingNew: number;
  used: number;
};

export type InboxReadSummary = MailTally & { at: number; mailboxes: MailboxRead[]; todos: number; events: number };

export function emptyTally(emails = 0, reader = "off"): MailTally {
  return { reader, emails, skipped: 0, triageSaidNo: 0, readSaidNo: 0, readFailed: 0, nothingNew: 0, used: 0 };
}

const lastReads = new Map<string, InboxReadSummary>();

/** The latest full read per household, so a read that adds nothing can say why. */
export function noteLastRead(userId: string, summary: InboxReadSummary): void {
  lastReads.set(userId, summary);
}

export function lastInboxRead(userId: string): InboxReadSummary | null {
  return lastReads.get(userId) ?? null;
}
