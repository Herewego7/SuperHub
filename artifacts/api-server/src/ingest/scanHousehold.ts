import { GoogleCalendarService } from "../googleCalendar";
import { OutlookCalendarService } from "../outlookCalendar";
import { getFreshOutlookAccessToken } from "../calendarSync";
import { storage } from "../storage";
import { applyIngestedMail } from "./saveMail";
import { inboxMailFailure, inboxScanEnabled, shareScan } from "./process";

const inflight = new Map<string, Promise<Awaited<ReturnType<typeof scanOnce>>>>();

export function scanConnectedInboxes(userId: string) {
  return shareScan(inflight, userId, () => scanOnce(userId));
}

/** A new Google or Outlook connection starts the mail scan. The redirect does not wait on it. */
export function scanAfterConnect(profileId: string) {
  return storage.getProfile(profileId).then((profile) => {
    if (!profile?.userId) return null;
    return scanConnectedInboxes(profile.userId);
  });
}

async function scanOnce(userId: string) {
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
        messages.push(...await google.listInbox(tokens.accessToken, tokens.refreshToken ?? undefined, tokens.email || owner.id, tokens.tokenExpiry));
      } catch (err) {
        note(err, "Google");
      }
    }
    const outlookTokens = await storage.getOutlookCalendarTokens(owner.id);
    if (outlookTokens?.accessToken && outlookTokens.isActive !== false) {
      connected += 1;
      try {
        const access = (await getFreshOutlookAccessToken(owner.id)) ?? outlookTokens.accessToken;
        messages.push(...await outlook.listInbox(access, outlookTokens.email || owner.id));
      } catch (err) {
        note(err, "Outlook");
      }
    }
  }
  const saved = await applyIngestedMail(userId, messages, audience);
  return { ...saved, connected, needsReconnect, mailProblem };
}
