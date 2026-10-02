import { GoogleCalendarService } from "../googleCalendar";
import { OutlookCalendarService } from "../outlookCalendar";
import { getFreshOutlookAccessToken } from "../calendarSync";
import { storage } from "../storage";
import { applyIngestedMail } from "./saveMail";
import { inboxScanEnabled } from "./process";

function denied(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? (err as { code?: unknown }).code : undefined;
  const status = "response" in err ? (err as { response?: { status?: number } }).response?.status : undefined;
  const value = typeof code === "number" ? code : typeof code === "string" ? Number(code) : undefined;
  return value === 401 || value === 403 || status === 401 || status === 403;
}

export async function scanConnectedInboxes(userId: string) {
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
  for (const owner of owners) {
    const tokens = await storage.getGoogleCalendarTokens(owner.id);
    if (tokens?.accessToken) {
      connected += 1;
      try {
        messages.push(...await google.listInbox(tokens.accessToken, tokens.refreshToken ?? undefined, tokens.email || owner.id, tokens.tokenExpiry));
      } catch (err) {
        if (denied(err)) needsReconnect = true;
        else console.warn("Inbox scan failed:", err instanceof Error ? err.message : err);
      }
    }
    const outlookTokens = await storage.getOutlookCalendarTokens(owner.id);
    if (outlookTokens?.accessToken && outlookTokens.isActive !== false) {
      connected += 1;
      try {
        const access = (await getFreshOutlookAccessToken(owner.id)) ?? outlookTokens.accessToken;
        messages.push(...await outlook.listInbox(access, outlookTokens.email || owner.id));
      } catch (err) {
        if (denied(err)) needsReconnect = true;
        else console.warn("Outlook inbox scan failed:", err instanceof Error ? err.message : err);
      }
    }
  }
  const saved = await applyIngestedMail(userId, messages, audience);
  return { ...saved, connected, needsReconnect };
}
