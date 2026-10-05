import { GoogleCalendarService } from "../googleCalendar";
import { OutlookCalendarService } from "../outlookCalendar";
import { getFreshOutlookAccessToken } from "../calendarSync";
import { storage } from "../storage";
import { applyIngestedMail } from "./saveMail";
import { gmailNewsletterQuery, INBOX_INITIAL_DAYS, INBOX_NEWSLETTER_LIMIT, INBOX_RECENT_DAYS, latestPerSender } from "./parse";
import { inboxBlockReason, inboxMailFailure, inboxScanEnabled, shareScan } from "./process";
import { beginHouseholdScan, finishHouseholdScan } from "./scanProgress";
import { claimInboxScan, finishInboxScanRecord, noteInboxScanRunning, requestInboxScan } from "./scanState";

const inflight = new Map<string, Promise<Awaited<ReturnType<typeof scanOnce>>>>();

export function scanConnectedInboxes(userId: string, days = INBOX_RECENT_DAYS) {
  return shareScan(inflight, userId, async () => {
    beginHouseholdScan(userId);
    if (days >= INBOX_INITIAL_DAYS) {
      try {
        if (!(await claimInboxScan(userId))) {
          finishHouseholdScan(userId, { todos: 0, events: 0 });
          return { todos: [], events: [], scanOff: false, connected: 0, needsReconnect: false };
        }
      } catch (err) {
        console.warn("Inbox scan lock skipped:", err instanceof Error ? err.message : err);
      }
    }
    return scanOnce(userId, days).then(
      async (result) => {
        finishHouseholdScan(userId, { todos: result.todos.length, events: result.events.length });
        if (days >= INBOX_INITIAL_DAYS && !result.mailProblem && !result.needsReconnect) await finishInboxScanRecord(userId);
        return result;
      },
      (err) => {
        finishHouseholdScan(userId, { todos: 0, events: 0 });
        throw err;
      },
    );
  });
}

/** A calendar connection is not a mail connection. Check before the long read so Scan now can say so. */
export async function inboxReadiness(userId: string): Promise<{
  scanOff: boolean;
  connected: number;
  canRead: boolean;
  mailProblem: "scope" | "unavailable" | null;
  needsReconnect: boolean;
}> {
  const settings = await storage.getCalendarSettingsByUser(userId);
  if (!inboxScanEnabled(settings?.scanInbox)) {
    return { scanOff: true, connected: 0, canRead: false, mailProblem: null, needsReconnect: false };
  }
  const people = await storage.getProfilesByUser(userId);
  const owners = people.filter((person) => !person.isAllFamilyProfile && person.role !== "child" && !person.isChild);
  const google = new GoogleCalendarService();
  const outlook = new OutlookCalendarService();
  const checks: Array<"ok" | "scope" | "unavailable" | "auth"> = [];
  let connected = 0;
  for (const owner of owners) {
    const tokens = await storage.getGoogleCalendarTokens(owner.id);
    if (tokens?.accessToken) {
      connected += 1;
      checks.push(await google.gmailAccess(tokens.accessToken, tokens.refreshToken ?? undefined, tokens.tokenExpiry));
    }
    const outlookTokens = await storage.getOutlookCalendarTokens(owner.id);
    if (outlookTokens?.accessToken && outlookTokens.isActive !== false) {
      connected += 1;
      const access = (await getFreshOutlookAccessToken(owner.id)) ?? outlookTokens.accessToken;
      checks.push(await outlook.mailAccess(access));
    }
  }
  const reason = inboxBlockReason(checks);
  return {
    scanOff: false,
    connected,
    canRead: reason === "ok",
    mailProblem: reason === "scope" || reason === "unavailable" ? reason : null,
    needsReconnect: reason === "auth",
  };
}

/** A new Google or Outlook connection starts the 30-day catch-up. The redirect does not wait on it. */
export function scanAfterConnect(profileId: string) {
  return storage.getProfile(profileId).then(async (profile) => {
    if (!profile?.userId) return null;
    await requestInboxScan(profile.userId);
    return scanConnectedInboxes(profile.userId, INBOX_INITIAL_DAYS);
  });
}

async function scanOnce(userId: string, days = INBOX_RECENT_DAYS) {
  const settings = await storage.getCalendarSettingsByUser(userId);
  if (!inboxScanEnabled(settings?.scanInbox)) {
    return { todos: [], events: [], scanOff: true, connected: 0, needsReconnect: false };
  }
  const people = await storage.getProfilesByUser(userId);
  const audience = people.filter((person) => !person.isAllFamilyProfile && person.isActive !== false).map((person) => person.id);
  const owners = people.filter((person) => !person.isAllFamilyProfile && person.role !== "child" && !person.isChild);
  const google = new GoogleCalendarService();
  const outlook = new OutlookCalendarService();
  const messages = [];
  let connected = 0;
  let needsReconnect = false;
  let mailProblem: "scope" | "unavailable" | null = null;
  const note = (err: unknown, label: string) => {
    const kind = inboxMailFailure(err);
    if (kind === "auth") needsReconnect = true;
    else if (kind === "scope" || kind === "unavailable") mailProblem = kind;
    else console.warn(`${label} inbox scan failed:`, err instanceof Error ? err.message : err);
  };
  for (const owner of owners) {
    const tokens = await storage.getGoogleCalendarTokens(owner.id);
    if (tokens?.accessToken) {
      connected += 1;
      try {
        messages.push(...await google.listInbox(tokens.accessToken, tokens.refreshToken ?? undefined, tokens.email || owner.id, tokens.tokenExpiry, days));
        if (days >= INBOX_INITIAL_DAYS) {
          // Outlook has no newsletter search. Bot Life skips that pass there too.
          const older = await google.listInbox(tokens.accessToken, tokens.refreshToken ?? undefined, tokens.email || owner.id, tokens.tokenExpiry, days, {
            query: gmailNewsletterQuery(),
            limit: INBOX_NEWSLETTER_LIMIT,
          });
          messages.push(...latestPerSender(older));
        }
      } catch (err) {
        note(err, "Google");
      }
    }
    const outlookTokens = await storage.getOutlookCalendarTokens(owner.id);
    if (outlookTokens?.accessToken && outlookTokens.isActive !== false) {
      connected += 1;
      try {
        const access = (await getFreshOutlookAccessToken(owner.id)) ?? outlookTokens.accessToken;
        messages.push(...await outlook.listInbox(access, outlookTokens.email || owner.id, days));
      } catch (err) {
        note(err, "Outlook");
      }
    }
  }
  const beat = days >= INBOX_INITIAL_DAYS ? () => noteInboxScanRunning(userId) : undefined;
  await beat?.();
  const saved = await applyIngestedMail(userId, messages, audience, beat);
  return { ...saved, connected, needsReconnect, mailProblem };
}
