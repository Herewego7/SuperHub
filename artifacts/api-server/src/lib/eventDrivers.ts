/**
 * Backend copy of family-hub/src/lib/eventDrivers.ts. api-server does not depend
 * on the frontend package (same tradeoff as lib/groceryMerge.ts), so the two are
 * kept in sync by hand — change both.
 *

 * Drivers on an event are a SET of profiles — one person may drop off and
 * another pick up. There is no ordering and no pickup/dropoff distinction.
 *
 * The data is in transition: `drivingProfileId` (a single id) is the original
 * column and is still dual-written so anything reading it keeps working;
 * `drivingProfileIds` is the source of truth going forward. Every read should
 * go through these helpers rather than touching either field directly, so the
 * old column can eventually be dropped in one place.
 */
export interface HasDrivers {
  drivingProfileId?: string | null;
  drivingProfileIds?: string[] | null;
}

/** Every driver on an event, de-duplicated. Empty array when nobody drives. */
export function driverIdsOf(event: HasDrivers | null | undefined): string[] {
  if (!event) return [];
  const list = Array.isArray(event.drivingProfileIds) ? event.drivingProfileIds : [];
  const ids = list.filter((id): id is string => typeof id === "string" && id.length > 0);
  // Fall back to the legacy single column only when the new one is empty, so a
  // deliberate "no drivers" save isn't resurrected by a stale legacy value.
  if (ids.length === 0 && event.drivingProfileId) return [event.drivingProfileId];
  return Array.from(new Set(ids));
}

/** True when this profile is one of the event's drivers. */
export function isDriver(event: HasDrivers | null | undefined, profileId: string): boolean {
  return driverIdsOf(event).includes(profileId);
}

/**
 * The pair to persist for a given set of drivers: the new list plus the legacy
 * single column, which keeps the first driver so old readers still show one.
 */
export function driverWriteFields(ids: string[]): {
  drivingProfileIds: string[];
  drivingProfileId: string | null;
} {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0)));
  return { drivingProfileIds: unique, drivingProfileId: unique[0] ?? null };
}

/**
 * Assignees for an event, with its drivers folded in. Driving implies
 * attending, so a driver belongs on the event's own list — which is also what
 * makes it reach their calendar, since calendar sync mirrors assignees.
 */
export function withDrivers(profileIds: string[], driverIds: string[]): string[] {
  return Array.from(new Set([...profileIds, ...driverIds]));
}

/** Order-insensitive comparison, for "did the driver actually change?" checks. */
export function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}
