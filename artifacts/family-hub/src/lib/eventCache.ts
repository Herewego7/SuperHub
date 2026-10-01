// Saving an event used to leave the UI showing the OLD values until a full
// refetch of /api/events (or, worse, a refetch of every connected Google
// calendar) came back. On a phone that's a visible gap — long enough that
// reopening the event showed the pre-save state, which reads as "the save
// didn't work" and invites a duplicate save.
//
// These helpers write the change the server just confirmed straight into the
// query cache, so the UI is correct the instant the response lands. Callers
// should still invalidate afterwards: this is a head start, not a replacement
// for the authoritative refetch.

import type { QueryClient } from "@tanstack/react-query";

const OCC = "::occ::";

/** Is `id` a synthetic recurring-occurrence of the real row `realId`? */
function isOccurrenceOf(id: string, realId: string): boolean {
  return typeof id === "string" && id.startsWith(`${realId}${OCC}`);
}

/**
 * Merge a saved local event (the PATCH/POST response, which is the real DB
 * row) into the cached ["/api/events"] list.
 *
 * The cache holds the *expanded* list — the real row plus synthetic
 * occurrences whose startTime/endTime are computed, not stored. So an
 * occurrence takes the saved row's ordinary fields (title, assignees, …) but
 * keeps its own computed identity and times; only the real row takes the
 * saved times verbatim.
 *
 * If the recurrence rule itself changed the *set* of occurrences, that can't
 * be fixed by merging — the follow-up refetch reconciles it. The assignee
 * change the user just made still shows immediately, which is the point.
 */
export function applySavedEventToCache(qc: QueryClient, saved: any): void {
  if (!saved?.id) return;
  qc.setQueryData(["/api/events"], (prev: any) => {
    if (!Array.isArray(prev)) return prev;
    let matched = false;
    const next = prev.map((e: any) => {
      if (e?.id === saved.id) {
        matched = true;
        return { ...e, ...saved };
      }
      if (isOccurrenceOf(e?.id, saved.id)) {
        matched = true;
        // Keep this occurrence's own computed id/times and instance markers.
        return {
          ...e,
          ...saved,
          id: e.id,
          startTime: e.startTime,
          endTime: e.endTime,
          isRecurringInstance: e.isRecurringInstance,
          seriesId: e.seriesId,
        };
      }
      return e;
    });
    // A brand-new event isn't in the list yet — append it so it shows at once.
    return matched ? next : [...next, saved];
  });
}

/** Drop a deleted event (and any of its occurrences) from the cached list. */
export function removeEventFromCache(qc: QueryClient, deletedId: string): void {
  if (!deletedId) return;
  // Deleting any occurrence removes the whole series (there's no
  // per-occurrence exception concept), so resolve back to the real row first.
  const idx = deletedId.indexOf(OCC);
  const realId = idx === -1 ? deletedId : deletedId.slice(0, idx);
  qc.setQueryData(["/api/events"], (prev: any) =>
    Array.isArray(prev)
      ? prev.filter((e: any) => e?.id !== realId && !isOccurrenceOf(e?.id, realId))
      : prev,
  );
}

/**
 * Reflect a Google-event assignment change immediately.
 *
 * Assignment is a Family Hub concept Google knows nothing about: the server
 * stores it in our own table and injects it into each event's
 * extendedProperties on read. Refetching it means a round-trip all the way to
 * Google, so patching those same fields in the cache is what makes the change
 * appear instantly.
 *
 * Matching mirrors the server's own rule: a single-occurrence save targets the
 * exact expanded instance id, while a "this and all following" save targets
 * every occurrence of the series at or after the occurrence being edited.
 */
export function applyGoogleAssignmentToCache(
  qc: QueryClient,
  opts: {
    eventId: string;
    recurringEventId?: string | null;
    applyToSeries?: boolean;
    occurrenceStart?: string | null;
    profileIds: string[];
    drivingProfileIds?: string[] | null;
  },
): void {
  const { eventId, recurringEventId, applyToSeries, occurrenceStart, profileIds, drivingProfileIds } = opts;
  const drivers = drivingProfileIds ?? [];
  const seriesMode = !!applyToSeries && !!recurringEventId;
  const fromMs = occurrenceStart ? new Date(occurrenceStart).getTime() : null;

  const targets = (ge: any): boolean => {
    if (!seriesMode) return ge?.id === eventId;
    if (ge?.recurringEventId !== recurringEventId) return false;
    if (fromMs === null) return true;
    const startRaw = ge?.start?.dateTime ?? ge?.start?.date;
    if (!startRaw) return false;
    return new Date(startRaw).getTime() >= fromMs;
  };

  qc.setQueriesData({ queryKey: ["/api/google-calendar/events"] }, (prev: any) => {
    if (!Array.isArray(prev)) return prev;
    let changed = false;
    const next = prev.map((ge: any) => {
      if (!targets(ge)) return ge;
      changed = true;
      return {
        ...ge,
        extendedProperties: {
          ...ge.extendedProperties,
          private: {
            ...ge.extendedProperties?.private,
            familyhub_profile_ids: JSON.stringify(profileIds),
            // Both wire keys, matching what the server emits on read.
            familyhub_driving_profile_ids: JSON.stringify(drivers),
            familyhub_driving_profile_id: drivers[0] ?? "",
          },
        },
      };
    });
    return changed ? next : prev;
  });
}
