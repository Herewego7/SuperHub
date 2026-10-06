import { GoogleCalendarService } from "../googleCalendar";
import { OutlookCalendarService } from "../outlookCalendar";
import { getFreshOutlookAccessToken } from "../calendarSync";
import { storage } from "../storage";
import { applyIngestedMail } from "./saveMail";
import { gmailNewsletterQuery, INBOX_INITIAL_DAYS, INBOX_NEWSLETTER_LIMIT, INBOX_RECENT_DAYS, latestPerSender } from "./parse";
import { inboxBlockReason, inboxMailFailure, inboxScanEnabled, shareScan } from "./process";
import { beginHouseholdScan, emptyTally, finishHouseholdScan, noteLastRead, SCAN_BEAT_MS, type MailboxRead, type MailTally } from "./scanProgress";
import { claimInboxScan, finishInboxScanRecord, noteInboxScanRunning, requestInboxScan } from "./scanState";

type ScanResult = {
  todos: unknown[];
  events: unknown[];
  scanOff: boolean;
  connected: number;
  needsReconnect: boolean;
  mailProblem?: "scope" | "unavailable" | null;
  mailboxes?: MailboxRead[];
  tally?: MailTally;
};

export type InboxScanDeps = {
  claim: (userId: string) => Promise<boolean>;
  beat: (userId: string) => Promise<void>;
  finish: (userId: string) => Promise<void>;
  read: (userId: string, days: number) => Promise<ScanResult>;
};

const liveDeps: InboxScanDeps = {
  claim: (userId) => claimInboxScan(userId),
  beat: (userId) => noteInboxScanRunning(userId),
  finish: (userId) => finishInboxScanRecord(userId),
  read: (userId, days) => scanOnce(userId, days),
};

const inflight = new Map<string, Promise<ScanResult>>();

export function scanConnectedInboxes(userId: string, days = INBOX_RECENT_DAYS, deps = liveDeps) {
  return shareScan(inflight, userId, async () => {
    beginHouseholdScan(userId);
    const full = days >= INBOX_INITIAL_DAYS;
    if (full) {
      try {
        if (!(await deps.claim(userId))) {
          finishHouseholdScan(userId, { todos: 0, events: 0 });
          return { todos: [], events: [], scanOff: false, connected: 0, needsReconnect: false };
        }
      } catch (err) {
        console.warn("Inbox scan lock skipped:", err instanceof Error ? err.message : err);
      }
    }
    const release = full ? holdLock(() => deps.beat(userId)) : null;
    return deps.read(userId, days).then(
      async (result) => {
        await release?.();
        finishHouseholdScan(userId, { todos: result.todos.length, events: result.events.length });
        if (full) {
          const summary = {
            ...(result.tally ?? emptyTally()),
            at: Date.now(),
            mailboxes: result.mailboxes ?? [],
            todos: result.todos.length,
            events: result.events.length,
          };
          noteLastRead(userId, summary);
          console.log("Inbox read finished:", JSON.stringify(summary));
          // Settles even when a mailbox couldn't be opened. Reconnecting it asks for a new read.
          await deps.finish(userId);
        }
        return result;
      },
      async (err) => {
        await release?.();
        finishHouseholdScan(userId, { todos: 0, events: 0 });
        throw err;
      },
    );
  });
}

/** Refreshes the lock on a clock, so a long download or a slow model call never looks abandoned. */
function holdLock(beat: () => Promise<void>): () => Promise<void> {
  let last = Promise.resolve();
  const timer = setInterval(() => {
    last = beat();
  }, SCAN_BEAT_MS);
  return async () => {
    clearInterval(timer);
    await last;
  };
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

async function scanOnce(userId: string, days = INBOX_RECENT_DAYS): Promise<ScanResult> {
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
  const mailboxes: MailboxRead[] = [];
  let connected = 0;
  let needsReconnect = false;
  let mailProblem: "scope" | "unavailable" | null = null;
  const note = (err: unknown, label: string): string => {
    const kind = inboxMailFailure(err);
    if (kind === "auth") needsReconnect = true;
    else if (kind === "scope" || kind === "unavailable") mailProblem = kind;
    else console.warn(`${label} inbox scan failed:`, err instanceof Error ? err.message : err);
    return kind === "skip" ? (err instanceof Error ? err.message : String(err)).slice(0, 160) : kind;
  };
  for (const owner of owners) {
    const tokens = await storage.getGoogleCalendarTokens(owner.id);
    if (tokens?.accessToken) {
      connected += 1;
      const box: MailboxRead = { address: tokens.email || owner.id, emails: 0 };
      mailboxes.push(box);
      try {
        const recent = await google.listInbox(tokens.accessToken, tokens.refreshToken ?? undefined, tokens.email || owner.id, tokens.tokenExpiry, days);
        box.emails += recent.length;
        messages.push(...recent);
        if (days >= INBOX_INITIAL_DAYS) {
          // Outlook has no newsletter search. Bot Life skips that pass there too.
          const older = latestPerSender(await google.listInbox(tokens.accessToken, tokens.refreshToken ?? undefined, tokens.email || owner.id, tokens.tokenExpiry, days, {
            query: gmailNewsletterQuery(),
            limit: INBOX_NEWSLETTER_LIMIT,
          }));
          box.emails += older.length;
          messages.push(...older);
        }
      } catch (err) {
        box.problem = note(err, "Google");
      }
    }
    const outlookTokens = await storage.getOutlookCalendarTokens(owner.id);
    if (outlookTokens?.accessToken && outlookTokens.isActive !== false) {
      connected += 1;
      const box: MailboxRead = { address: outlookTokens.email || owner.id, emails: 0 };
      mailboxes.push(box);
      try {
        const access = (await getFreshOutlookAccessToken(owner.id)) ?? outlookTokens.accessToken;
        const recent = await outlook.listInbox(access, outlookTokens.email || owner.id, days);
        box.emails += recent.length;
        messages.push(...recent);
      } catch (err) {
        box.problem = note(err, "Outlook");
      }
    }
  }
  const saved = await applyIngestedMail(userId, messages, audience);
  return { ...saved, connected, needsReconnect, mailProblem, mailboxes };
}
