/**
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

/*
 * NOTE: there is deliberately no "withDrivers" helper any more.
 *
 * Clients used to fold drivers into profileIds on save, so a driver appeared
 * in "Assign to" too. That made removing someone from Assign to impossible
 * while they were still driving — the save succeeded, then re-added them, so
 * the change looked like it silently didn't stick.
 *
 * The two lists are separate now. Everything that needs "a driver counts as
 * being on this event" ORs the two lists at READ time instead: the event
 * filters in calendar3-view/home-view/people-view, and profileIdsOf() in the
 * server's calendarSync, which is what still puts the event on a driver's own
 * Google/Outlook calendar.
 */

/** Order-insensitive comparison, for "did the driver actually change?" checks. */
export function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}

/**
 * Read drivers off a raw Google event. Two wire keys exist: the JSON list, and
 * an older bare-string single id kept so a client that predates multiple
 * drivers still shows one. The list wins when present.
 */
export function driverIdsFromGoogleEvent(googleEvent: any): string[] {
  const priv = googleEvent?.extendedProperties?.private ?? {};
  const raw = priv["familyhub_driving_profile_ids"];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const ids = parsed.filter((x: unknown): x is string => typeof x === "string" && x.length > 0);
        if (ids.length > 0) return Array.from(new Set(ids));
      }
    } catch { /* malformed — fall through to the single id */ }
  }
  const single = priv["familyhub_driving_profile_id"];
  return single ? [single] : [];
}
