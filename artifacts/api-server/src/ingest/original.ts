import { storage } from "../storage";
import { GoogleCalendarService } from "../googleCalendar";
import { OutlookCalendarService } from "../outlookCalendar";
import { getFreshOutlookAccessToken } from "../calendarSync";
import { gmailWebLink } from "./parse";
import { inboxMailFailure, slipMail } from "./process";

export type OriginalMail = { subject: string; from: string; sentAt: string | null; text: string; webUrl: string | null };
type Answer = { status: number; body: OriginalMail | { error: string } };

/**
 * The email behind an inbox item, fetched with its owner's own connection and
 * never stored. The owner reads it; others only when Share originals is on; never a child.
 */
export async function readOriginal(userId: string, choreId: string, viewerProfileId?: string): Promise<Answer> {
  const missing: Answer = { status: 404, body: { error: "Not found" } };
  const chore = (await storage.getChoresByUser(userId)).find((row) => row.id === choreId);
  const where = chore ? slipMail(chore.description) : null;
  if (!where) return missing;
  const owner = await storage.getProfile(where.ownerProfileId);
  if (!owner || owner.userId !== userId) return missing;
  const viewer = viewerProfileId ? await storage.getProfile(viewerProfileId) : undefined;
  if (viewer && viewer.userId !== userId) return missing;
  const settings = await storage.getCalendarSettingsByUser(userId);
  const child = viewer?.role === "child" || viewer?.isChild === true;
  if (child || (settings?.shareOriginals !== true && viewer?.id !== owner.id)) {
    return { status: 403, body: { error: `Only ${owner.name} can open this email.` } };
  }
  try {
    if (where.provider === "gmail") {
      const tokens = await storage.getGoogleCalendarTokens(owner.id);
      if (!tokens?.accessToken) return { status: 409, body: { error: `Reconnect ${owner.name}'s Google account to open it.` } };
      const mail = await new GoogleCalendarService().readMessage(tokens.accessToken, tokens.refreshToken ?? undefined, tokens.tokenExpiry, where.messageId);
      return { status: 200, body: { ...mail, webUrl: gmailWebLink(tokens.email, where.messageId) } };
    }
    const tokens = await storage.getOutlookCalendarTokens(owner.id);
    if (!tokens?.accessToken || tokens.isActive === false) return { status: 409, body: { error: `Reconnect ${owner.name}'s Outlook account to open it.` } };
    const access = (await getFreshOutlookAccessToken(owner.id)) ?? tokens.accessToken;
    return { status: 200, body: await new OutlookCalendarService().readMessage(access, where.messageId) };
  } catch (err) {
    const code = (err as { code?: unknown; response?: { status?: unknown } })?.response?.status ?? (err as { code?: unknown })?.code;
    if (code === 404 || code === 410) return { status: 410, body: { error: "This email is no longer in the mailbox." } };
    if (inboxMailFailure(err) === "auth") return { status: 409, body: { error: `Reconnect ${owner.name}'s account to open it.` } };
    throw err;
  }
}
