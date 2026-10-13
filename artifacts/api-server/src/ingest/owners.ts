import { storage } from "../storage";
import { logger } from "../lib/logger";
import { connectedUserIds } from "../scheduler/inboxScan";

type OwnedRow = { id: string; category?: string | null; profileIds?: string[] | null };

/**
 * Inbox to-dos saved before mail had an owner went to everyone in the family.
 * They belong to the adults whose mailbox reads mail. Only rows that still name
 * every profile move, so running it again changes nothing.
 */
export function inboxOwnerFixes(rows: OwnedRow[], audience: readonly string[], owners: readonly string[]): { id: string; profileIds: string[] }[] {
  const everyone = new Set(audience);
  if (owners.length === 0 || everyone.size < 2) return [];
  if (owners.length >= everyone.size && owners.every((id) => everyone.has(id))) return [];
  return rows.flatMap((row) => {
    if (row.category !== "school_email") return [];
    const ids = new Set(row.profileIds ?? []);
    if (![...everyone].every((id) => ids.has(id))) return [];
    return [{ id: row.id, profileIds: [...owners] }];
  });
}

/** The adults with a Google or Outlook mailbox connected. */
async function mailboxOwners(userId: string): Promise<{ audience: string[]; owners: string[] }> {
  const people = await storage.getProfilesByUser(userId);
  const active = people.filter((person) => !person.isAllFamilyProfile && person.isActive !== false);
  const owners: string[] = [];
  for (const person of active) {
    if (person.role === "child" || person.isChild) continue;
    const google = await storage.getGoogleCalendarTokens(person.id);
    const outlook = await storage.getOutlookCalendarTokens(person.id);
    if (google?.accessToken || (outlook?.accessToken && outlook.isActive !== false)) owners.push(person.id);
  }
  return { audience: active.map((person) => person.id), owners };
}

export async function assignInboxOwners(userIds?: string[]): Promise<number> {
  let moved = 0;
  for (const userId of userIds ?? await connectedUserIds()) {
    try {
      const { audience, owners } = await mailboxOwners(userId);
      const fixes = inboxOwnerFixes(await storage.getChoresByUser(userId), audience, owners);
      for (const fix of fixes) {
        await storage.updateChore(fix.id, { profileIds: fix.profileIds }, userId);
        moved += 1;
      }
    } catch (err) {
      logger.warn({ err, userId }, "Inbox owner pass skipped a household");
    }
  }
  if (moved > 0) logger.info({ moved }, "Inbox to-dos moved to their mailbox owner");
  return moved;
}
