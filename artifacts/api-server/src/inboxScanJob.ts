import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { connectedUserIds } from "./scheduler/inboxScan";
import { scanConnectedInboxes } from "./ingest/scanHousehold";
import { catchUpPending, scanLockFresh } from "./ingest/scanProgress";
import { INBOX_INITIAL_DAYS } from "./ingest/parse";
import { storage } from "./storage";

// Replit Scheduled Deployment run command, from the repo root, after the normal build:
// node artifacts/api-server/dist/inboxScanJob.mjs
// This process stays up until the read finishes, then exits. The website stays on Autoscale.

try {
  const userIds = await connectedUserIds();
  for (const userId of userIds) {
    try {
      const settings = await storage.getCalendarSettingsByUser(userId);
      if (settings?.scanInbox === false) continue;
      const pending = catchUpPending(settings?.inboxScanRequestedAt ?? null, settings?.inboxScanFinishedAt ?? null);
      if (pending && scanLockFresh(settings?.inboxScanStartedAt ?? null, new Date(), settings?.inboxScanFinishedAt ?? null)) {
        logger.info({ userId }, "Inbox read already running");
        continue;
      }
      await scanConnectedInboxes(userId, pending ? INBOX_INITIAL_DAYS : undefined);
    } catch (err) {
      logger.warn({ err, userId }, "Scheduled inbox scan failed");
    }
  }
  logger.info({ households: userIds.length }, "Inbox scan job finished");
} catch (err) {
  logger.error({ err }, "Inbox scan job failed");
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
  process.exit(process.exitCode ?? 0);
}
