import { db, calendarSettings } from "@workspace/db";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { SCAN_LOCK_MS } from "./scanProgress";

async function touch(userId: string, patch: { inboxScanRequestedAt?: Date; inboxScanStartedAt?: Date; inboxScanFinishedAt?: Date }): Promise<void> {
  const updated = await db.update(calendarSettings).set({ ...patch, updatedAt: new Date() }).where(eq(calendarSettings.userId, userId)).returning({ userId: calendarSettings.userId });
  if (updated.length > 0) return;
  await db.insert(calendarSettings).values({ userId, ...patch }).onConflictDoUpdate({
    target: calendarSettings.userId,
    set: { ...patch, updatedAt: new Date() },
  });
}

export function requestInboxScan(userId: string, now = new Date()): Promise<void> {
  return touch(userId, { inboxScanRequestedAt: now });
}

/** Matches scanLockFresh. One read owns the household until it finishes or the heartbeat goes stale. */
export async function claimInboxScan(userId: string, now = new Date()): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - SCAN_LOCK_MS);
  const updated = await db.update(calendarSettings).set({
    inboxScanStartedAt: now,
    updatedAt: now,
  }).where(and(
    eq(calendarSettings.userId, userId),
    or(
      isNull(calendarSettings.inboxScanStartedAt),
      lt(calendarSettings.inboxScanStartedAt, staleBefore),
      and(
        isNotNull(calendarSettings.inboxScanFinishedAt),
        sql`${calendarSettings.inboxScanFinishedAt} >= ${calendarSettings.inboxScanStartedAt}`,
      ),
    ),
  )).returning({ userId: calendarSettings.userId });
  if (updated.length === 0) return false;
  lastBeat.set(userId, now.getTime());
  return true;
}

const lastBeat = new Map<string, number>();

export async function noteInboxScanRunning(userId: string, now = Date.now()): Promise<void> {
  const prev = lastBeat.get(userId) ?? 0;
  if (now - prev < 60_000) return;
  lastBeat.set(userId, now);
  try {
    await touch(userId, { inboxScanStartedAt: new Date(now) });
  } catch {
    lastBeat.delete(userId);
  }
}

export function finishInboxScanRecord(userId: string, now = new Date()): Promise<void> {
  lastBeat.delete(userId);
  return touch(userId, { inboxScanFinishedAt: now });
}
