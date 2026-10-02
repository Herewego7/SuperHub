import { eq } from "drizzle-orm";
import { db, googleCalendarTokens, outlookCalendarTokens, profiles } from "@workspace/db";
import { logger } from "../lib/logger";
import { createWorkGate } from "../lib/workGate";
import { scanConnectedInboxes } from "../ingest/scanHousehold";

async function connectedUserIds(): Promise<string[]> {
  const google = await db.select({ userId: profiles.userId }).from(googleCalendarTokens)
    .innerJoin(profiles, eq(profiles.id, googleCalendarTokens.profileId))
    .where(eq(googleCalendarTokens.isActive, true));
  const outlook = await db.select({ userId: profiles.userId }).from(outlookCalendarTokens)
    .innerJoin(profiles, eq(profiles.id, outlookCalendarTokens.profileId))
    .where(eq(outlookCalendarTokens.isActive, true));
  return [...new Set([...google, ...outlook].map((row) => row.userId).filter((id): id is string => !!id))];
}

export async function runInboxScanTick(): Promise<boolean> {
  const userIds = await connectedUserIds();
  if (userIds.length === 0) return false;
  let found = false;
  for (const userId of userIds) {
    try {
      const result = await scanConnectedInboxes(userId);
      if (!result.scanOff && result.connected > 0) found = true;
    } catch (err) {
      logger.warn({ err, userId }, "Inbox scan failed");
    }
  }
  return found;
}

let timer: NodeJS.Timeout | null = null;
const gate = createWorkGate("inboxScan");
const TICK_MS = 30 * 60_000;

export function startInboxScanScheduler(): void {
  if (timer) return;
  const align = (TICK_MS / 1000 - (Date.now() / 1000) % (TICK_MS / 1000)) * 1000;
  const run = () => {
    if (!gate.shouldRun()) return;
    runInboxScanTick()
      .then((foundWork) => gate.record(foundWork))
      .catch((err) => logger.error({ err }, "Inbox scan tick failed"));
  };
  setTimeout(() => {
    run();
    timer = setInterval(run, TICK_MS);
  }, align);
}
