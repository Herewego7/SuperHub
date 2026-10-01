/**
 * Pure, side-effect-free planning logic for two-way calendar sync edits.
 * Isolated from calendarSync.ts (which does I/O) so it can be unit-tested
 * without touching Google/Outlook or the database. Type-only import of the
 * sync-row shape — nothing here performs runtime work beyond array math.
 */
import type { EventCalendarSync } from "@workspace/db";

export const SYNC_PROVIDERS = ["google", "outlook"] as const;
export type SyncProvider = (typeof SYNC_PROVIDERS)[number];

export interface UpdatePlan {
  toUpdate: EventCalendarSync[];                              // retained copies to patch
  toDelete: EventCalendarSync[];                              // copies whose profile was unassigned
  toCreate: { profileId: string; provider: SyncProvider }[]; // newly assigned profiles
}

/**
 * Given the existing sync links, the event's new assignee set, and whether new
 * copies may be created, decide which external copies to update, delete, and
 * create.
 *
 *  - A profile still assigned and already synced → update its copy.
 *  - A profile no longer assigned → delete its copy.
 *  - A profile newly assigned (and sync enabled) → create a copy per provider.
 *  - A pure error row (sync attempted but no external copy exists) is ignored.
 */
export function planEventUpdate(
  existing: EventCalendarSync[],
  newProfileIds: string[],
  syncEnabled: boolean,
): UpdatePlan {
  const assigned = new Set(newProfileIds);
  // Only rows backed by a real external copy count as "already existing"; a
  // pure error row (sync attempted, nothing created) must not block a retry.
  const existingKey = new Set(
    existing.filter(l => !!l.externalEventId).map(l => `${l.provider}:${l.profileId}`),
  );

  const toUpdate: EventCalendarSync[] = [];
  const toDelete: EventCalendarSync[] = [];
  for (const link of existing) {
    if (link.syncState === "error" && !link.externalEventId) continue;
    if (assigned.has(link.profileId)) toUpdate.push(link);
    else toDelete.push(link);
  }

  const toCreate: { profileId: string; provider: SyncProvider }[] = [];
  if (syncEnabled) {
    for (const profileId of assigned) {
      for (const provider of SYNC_PROVIDERS) {
        if (!existingKey.has(`${provider}:${profileId}`)) toCreate.push({ profileId, provider });
      }
    }
  }

  return { toUpdate, toDelete, toCreate };
}
