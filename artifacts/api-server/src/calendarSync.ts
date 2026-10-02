/**
 * Two-way calendar sync orchestration.
 *
 * When two-way sync is enabled, events created/edited/deleted in the app are
 * mirrored to EACH assigned profile's connected Google/Outlook calendar — one
 * external copy per assignee per provider. The `event_calendar_syncs` table
 * records every copy so edits/deletes can be propagated and so the copies can
 * be filtered out when calendars are read back (preventing duplicate display).
 *
 * Everything here is best-effort: a failure to reach Google/Outlook must never
 * break the local create/edit/delete. Failures are recorded as a sync row with
 * syncState="error" so they're observable.
 */
import { storage } from "./storage";
import { twoWaySyncFromSettings } from "./lib/settingsOwnership";
import { familyCalendarAccount, familyCalendarCreates, syncTargetsForEvent, writeTargetAllowed } from "./lib/calendarAssignmentScope";
import { googleRecurrence, outlookRecurrence, excludedInstants } from "./lib/recurrenceRule";
import { DEFAULT_TIMEZONE } from "./lib/timezone";
import { GoogleCalendarService } from "./googleCalendar";
import { outlookCalendarService } from "./outlookCalendar";
import { planEventUpdate } from "./calendarSyncPlan";
import type { Event, EventCalendarSync } from "@workspace/db";
import { driverIdsOf, type HasDrivers } from "./lib/eventDrivers";

const googleCalendarService = new GoogleCalendarService();

// Outlook writes to the user's default calendar (/me/events). Stored for record.
const OUTLOOK_DEFAULT_CALENDAR = "default";
// Google writes to the account's primary calendar via the "primary" alias,
// which also works for subsequent get/update/delete calls.
const GOOGLE_PRIMARY_CALENDAR = "primary";

/**
 * Whether THIS family has two-way sync on.
 *
 * Was unscoped — a bare `SELECT ... LIMIT 1` — so whichever family's row
 * happened to sort first governed every family's event writes. That is worse
 * than the matching settings-write bug, because this flag is what decides
 * whether a household's private events get pushed into an external Google or
 * Outlook account.
 *
 * Fails CLOSED on error, deliberately, and unlike the entitlement code which
 * fails open. The cost of wrongly returning true here is writing a family's
 * events somewhere they cannot be recalled; the cost of wrongly returning
 * false is that sync pauses until the error is fixed. Do not "make it
 * consistent" with the entitlement convention.
 */
export async function isTwoWaySyncEnabled(userId: string): Promise<boolean> {
  try {
    const settings = await storage.getCalendarSettingsByUser(userId);
    // A missing row means enabled — see twoWaySyncFromSettings for why, and
    // for the bug that reading `=== true` here caused.
    return twoWaySyncFromSettings(settings);
  } catch {
    return false;
  }
}

/**
 * Who this event belongs to for sync purposes: its assignees plus its drivers.
 * Driving an event implies attending it, so a driver gets a copy on their own
 * calendar. Clients also merge drivers into the assignee list on save; doing it
 * here too means the rule holds no matter which client wrote the row.
 */
function profileIdsOf(event: Pick<Event, "profileIds"> & HasDrivers): string[] {
  const assigned = Array.isArray(event.profileIds) ? (event.profileIds as string[]) : [];
  return Array.from(new Set([...assigned, ...driverIdsOf(event)]));
}

// ── Token helpers ───────────────────────────────────────────────────────────

/**
 * Returns a usable Outlook access token for a profile, refreshing it first if
 * it has expired and we hold a refresh token. Returns null if not connected.
 *
 * Exported so the READ routes (GET events / available-calendars / write-target
 * validation) can share it — those previously used the raw stored
 * accessToken directly, which is only valid for ~1h. Once a token expired,
 * every read silently 401'd into a 500 until some two-way-sync *write*
 * happened to refresh the row, or the user manually reconnected.
 */
export async function getFreshOutlookAccessToken(profileId: string): Promise<string | null> {
  const tokens = await storage.getOutlookCalendarTokens(profileId);
  if (!tokens || !tokens.isActive) return null;

  const stillValid = tokens.tokenExpiry && new Date(tokens.tokenExpiry).getTime() > Date.now() + 60_000;
  if (stillValid) return tokens.accessToken;

  if (tokens.refreshToken && process.env.OUTLOOK_CLIENT_ID && process.env.OUTLOOK_CLIENT_SECRET) {
    try {
      const mailScope = "https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read offline_access";
      let refreshed;
      try {
        refreshed = await outlookCalendarService.refreshAccessToken(
          process.env.OUTLOOK_CLIENT_ID,
          process.env.OUTLOOK_CLIENT_SECRET,
          tokens.refreshToken,
          mailScope,
        );
      } catch {
        refreshed = await outlookCalendarService.refreshAccessToken(
          process.env.OUTLOOK_CLIENT_ID,
          process.env.OUTLOOK_CLIENT_SECRET,
          tokens.refreshToken,
        );
      }
      await storage.saveOutlookCalendarTokens({
        profileId,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token || tokens.refreshToken,
        tokenExpiry: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : null,
        email: tokens.email ?? null,
        isActive: true,
        // saveOutlookCalendarTokens deletes and reinserts the row (see
        // storage.ts) — carry the user's calendar selection AND write target
        // forward, or a routine silent token refresh would reset both to
        // their defaults ("sync all" / "default calendar").
        selectedCalendarIds: tokens.selectedCalendarIds,
        writeCalendarId: tokens.writeCalendarId,
      });
      return refreshed.access_token;
    } catch (err) {
      console.warn(`Outlook token refresh failed for profile ${profileId}:`, err instanceof Error ? err.message : err);
      // Fall back to the (likely stale) token — the write will surface the error.
      return tokens.accessToken;
    }
  }
  return tokens.accessToken;
}

// ── Per-provider primitives ─────────────────────────────────────────────────

/**
 * Remove from an Outlook series the occurrences Family Hub has detached.
 *
 * Best-effort and deliberately swallowed: an extra occurrence on a connected
 * calendar is a visible annoyance, but failing the whole sync (and so the
 * user's edit) over it is worse. The error is logged with the event id so it
 * is findable.
 */
async function pruneOutlookExceptions(accessToken: string, externalEventId: string, event: Event): Promise<void> {
  const excluded = excludedInstants(event);
  if (excluded.length === 0) return;
  try {
    await outlookCalendarService.deleteOccurrences(accessToken, externalEventId, excluded);
  } catch (err) {
    console.warn(
      `pruneOutlookExceptions: left ${excluded.length} detached occurrence(s) on the Outlook copy of event ${event.id}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * The family's own IANA zone, for the provider copies.
 *
 * Google REQUIRES start.timeZone/end.timeZone on a recurring event and rejects
 * the insert without them — a series created here simply never appeared on the
 * connected calendar. It matters beyond satisfying the API too: a weekly 9am
 * event has to stay 9am across a DST change, and only a named zone can say so.
 */
async function familyTimeZone(event: Event): Promise<string> {
  try {
    // No userId means no family to ask, so the default zone is the only
    // honest answer — the old fallback read an arbitrary family's row.
    if (!event.userId) return DEFAULT_TIMEZONE;
    const settings = await storage.getLocationSettingsByUser(event.userId);
    return settings?.timezone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

async function createGoogleCopy(event: Event, profileId: string, calendarId?: string): Promise<void> {
  const tokens = await storage.getGoogleCalendarTokens(profileId);
  if (!tokens || !tokens.isActive) return;
  // User-configured write target (Settings → Manage calendars), falling back
  // to the account's primary calendar — the only behavior before this was
  // configurable. A family calendar is that one calendar, not every write target.
  const targetCalendarId = calendarId || tokens.writeCalendarId || GOOGLE_PRIMARY_CALENDAR;
  const assignments = await storage.getCalendarAssignments(profileId);
  if (!writeTargetAllowed(calendarId, assignments, targetCalendarId)) return;
  try {
    const created = await googleCalendarService.createEvent(
      tokens.accessToken,
      tokens.refreshToken || undefined,
      targetCalendarId,
      {
        title: event.title,
        description: event.description,
        location: event.location,
        start: new Date(event.startTime),
        end: new Date(event.endTime),
        isAllDay: event.isAllDay ?? false,
        profileIds: profileIdsOf(event),
        localEventId: event.id,
        recurrence: googleRecurrence(event),
        timeZone: await familyTimeZone(event),
      },
    );
    if (!created.id) {
      console.warn(`createGoogleCopy: Google returned event without id for local event ${event.id}`);
      return;
    }
    await storage.upsertEventCalendarSync({
      eventId: event.id,
      userId: event.userId!,
      profileId,
      provider: "google",
      externalEventId: created.id,
      externalCalendarId: targetCalendarId,
      syncState: "synced",
      lastError: null,
    });
  } catch (err) {
    await recordError(event.id, event.userId!, profileId, "google", err);
  }
}

async function createOutlookCopy(event: Event, profileId: string, calendarId?: string): Promise<void> {
  const accessToken = await getFreshOutlookAccessToken(profileId);
  if (!accessToken) return;
  const tokens = await storage.getOutlookCalendarTokens(profileId);
  // User-configured write target, falling back to the account's default
  // calendar (undefined → outlookCalendarService.createEvent posts to
  // /me/events) — the only behavior before this was configurable.
  const targetCalendarId = calendarId || tokens?.writeCalendarId || undefined;
  if (targetCalendarId) {
    const assignments = await storage.getCalendarAssignments(profileId);
    if (!writeTargetAllowed(calendarId, assignments, targetCalendarId)) return;
  }
  try {
    const created = await outlookCalendarService.createEvent(
      accessToken,
      {
        title: event.title,
        description: event.description,
        location: event.location,
        start: new Date(event.startTime),
        end: new Date(event.endTime),
        isAllDay: event.isAllDay ?? false,
        recurrence: outlookRecurrence(event),
      },
      targetCalendarId,
    );
    if (!created.id) {
      console.warn(`createOutlookCopy: Outlook returned event without id for local event ${event.id}`);
      return;
    }
    await storage.upsertEventCalendarSync({
      eventId: event.id,
      userId: event.userId!,
      profileId,
      provider: "outlook",
      externalEventId: created.id,
      externalCalendarId: targetCalendarId || OUTLOOK_DEFAULT_CALENDAR,
      syncState: "synced",
      lastError: null,
    });
    // Graph has no EXDATE — holes have to be punched after the fact. Done
    // after the link is recorded so a failure here leaves a synced series
    // with one extra occurrence rather than an orphaned external event.
    await pruneOutlookExceptions(accessToken, created.id, event);
  } catch (err) {
    await recordError(event.id, event.userId!, profileId, "outlook", err);
  }
}

async function updateGoogleCopy(event: Event, link: EventCalendarSync): Promise<void> {
  const tokens = await storage.getGoogleCalendarTokens(link.profileId);
  if (!tokens || !tokens.isActive || !link.externalEventId) return;
  try {
    await googleCalendarService.updateEvent(
      tokens.accessToken,
      tokens.refreshToken || undefined,
      link.externalCalendarId,
      link.externalEventId,
      {
        title: event.title,
        description: event.description ?? "",
        location: event.location ?? "",
        start: new Date(event.startTime),
        end: new Date(event.endTime),
        isAllDay: event.isAllDay ?? false,
        profileIds: profileIdsOf(event),
        // Always sent, never omitted: an event that STOPPED repeating has to
        // clear the rule on the copy too, and `undefined` would leave the old
        // series in place on someone else's calendar.
        recurrence: googleRecurrence(event) ?? [],
        timeZone: await familyTimeZone(event),
      },
    );
  } catch (err) {
    await recordError(event.id, event.userId!, link.profileId, "google", err);
  }
}

async function updateOutlookCopy(event: Event, link: EventCalendarSync): Promise<void> {
  const accessToken = await getFreshOutlookAccessToken(link.profileId);
  if (!accessToken || !link.externalEventId) return;
  try {
    await outlookCalendarService.updateEvent(accessToken, link.externalEventId, {
      title: event.title,
      description: event.description,
      location: event.location,
      start: new Date(event.startTime),
      end: new Date(event.endTime),
      isAllDay: event.isAllDay ?? false,
      // null, not undefined: an event that stopped repeating must clear the
      // pattern on the copy rather than keep the old series.
      recurrence: outlookRecurrence(event) ?? null,
    });
    await pruneOutlookExceptions(accessToken, link.externalEventId, event);
  } catch (err) {
    await recordError(event.id, event.userId!, link.profileId, "outlook", err);
  }
}

async function deleteGoogleCopy(link: EventCalendarSync): Promise<void> {
  const tokens = await storage.getGoogleCalendarTokens(link.profileId);
  if (!tokens || !tokens.isActive || !link.externalEventId) return;
  try {
    await googleCalendarService.deleteEvent(
      tokens.accessToken,
      tokens.refreshToken || undefined,
      link.externalCalendarId,
      link.externalEventId,
    );
  } catch (err) {
    // 404/410 = already gone on Google; treat as success.
    const status = (err as any)?.status ?? (err as any)?.code ?? (err as any)?.response?.status;
    if (status !== 404 && status !== 410) {
      console.warn(`Google delete copy failed (event ${link.eventId}):`, err instanceof Error ? err.message : err);
    }
  }
}

async function deleteOutlookCopy(link: EventCalendarSync): Promise<void> {
  const accessToken = await getFreshOutlookAccessToken(link.profileId);
  if (!accessToken || !link.externalEventId) return;
  try {
    await outlookCalendarService.deleteEvent(accessToken, link.externalEventId);
  } catch (err) {
    const status = (err as any)?.response?.status;
    if (status !== 404 && status !== 410) {
      console.warn(`Outlook delete copy failed (event ${link.eventId}):`, err instanceof Error ? err.message : err);
    }
  }
}

async function recordError(eventId: string, userId: string, profileId: string, provider: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`Two-way sync ${provider} failed (event ${eventId}, profile ${profileId}):`, message);
  try {
    await storage.upsertEventCalendarSync({
      eventId, userId, profileId, provider,
      externalEventId: "",
      externalCalendarId: provider === "google" ? GOOGLE_PRIMARY_CALENDAR : OUTLOOK_DEFAULT_CALENDAR,
      syncState: "error",
      lastError: message.slice(0, 500),
    });
  } catch { /* ignore */ }
}

// ── Public orchestration ────────────────────────────────────────────────────

/** Accounts that actually hold a Google or Outlook connection, whoever a calendar is "for". */
async function connectedCalendarOwners(userId: string) {
  const people = await storage.getProfilesByUser(userId);
  const owners: {
    profileId: string;
    provider: "google" | "outlook";
    isActive?: boolean | null;
    calendarIds?: string[] | null;
    writeCalendarId?: string | null;
  }[] = [];
  for (const person of people) {
    if (person.isAllFamilyProfile) continue;
    const google = await storage.getGoogleCalendarTokens(person.id);
    if (google?.isActive !== false && google?.accessToken) {
      owners.push({
        profileId: person.id,
        provider: "google",
        isActive: google.isActive,
        calendarIds: google.selectedCalendarIds ?? null,
        writeCalendarId: google.writeCalendarId ?? null,
      });
    }
    const outlook = await storage.getOutlookCalendarTokens(person.id);
    if (outlook?.isActive !== false && outlook?.accessToken) {
      owners.push({
        profileId: person.id,
        provider: "outlook",
        isActive: outlook.isActive,
        calendarIds: outlook.selectedCalendarIds ?? null,
        writeCalendarId: outlook.writeCalendarId ?? null,
      });
    }
  }
  return owners;
}

async function familyWriterFor(event: Event) {
  const [assignments, owners, settings] = await Promise.all([
    storage.getCalendarAssignmentsByUser(event.userId!),
    connectedCalendarOwners(event.userId!),
    storage.getCalendarSettingsByUser(event.userId!),
  ]);
  const same = !!event.calendarId && settings?.familyCalendarId === event.calendarId;
  return familyCalendarAccount(event.calendarId, assignments, owners, same ? {
    profileId: settings?.familyCalendarProfileId,
    provider: settings?.familyCalendarProvider,
  } : null);
}

/**
 * Resolve which profile IDs to sync to. If the event is assigned to specific
 * profiles, use those. If it is a family event (no assignees), fall back to
 * every profile that belongs to the user — each connected calendar will get a
 * copy so nobody misses the event.
 */
async function resolveProfileIds(event: Event): Promise<string[]> {
  const assigned = profileIdsOf(event);
  if (assigned.length > 0) return assigned;
  if (!event.userId) return [];
  const all = await storage.getProfilesByUser(event.userId);
  return all.filter(p => !p.isAllFamilyProfile && p.isActive !== false).map(p => p.id);
}

/** Mirror a newly created app event onto each assigned profile's calendars. */
export async function syncEventCreate(event: Event): Promise<void> {
  try {
    if (!event.userId) return;
    if (!(await isTwoWaySyncEnabled(event.userId))) return;
    const writer = await familyWriterFor(event);
    if (writer && event.calendarId) {
      await (writer.provider === "google"
        ? createGoogleCopy(event, writer.profileId, event.calendarId)
        : createOutlookCopy(event, writer.profileId, event.calendarId));
      return;
    }
    if (event.source === "meal") return;
    const profileIds = await resolveProfileIds(event);
    // Run every profile/provider copy concurrently rather than one after the
    // other. Each copy is an independent external round-trip (plus a possible
    // token refresh), so a family of five previously meant ten sequential
    // network calls. Each helper already swallows its own errors, and
    // allSettled means one failing provider can't abort the rest.
    await Promise.allSettled(
      profileIds.flatMap((profileId) => [
        createGoogleCopy(event, profileId),
        createOutlookCopy(event, profileId),
      ]),
    );
  } catch (err) {
    console.warn("syncEventCreate failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Re-attempt any previously-failed pushes for this profile+provider. Called
 * after a (re)connect — a revoked/expired token is the single most common
 * cause of a stuck sync error, but reconnecting alone never retried anything
 * on its own; only editing the event did (via syncEventUpdate, since
 * planEventUpdate already correctly treats a pure error row as needing a
 * fresh create, not an update). This just gives that same retry a trigger
 * that doesn't require the user to go edit the event by hand.
 */
export async function retryFailedSyncsForProfile(profileId: string, provider: "google" | "outlook"): Promise<void> {
  try {
    const events = await storage.getErroredSyncEvents(profileId, provider);
    await Promise.allSettled(events.map((event) => syncEventUpdate(event)));
  } catch (err) {
    console.warn("retryFailedSyncsForProfile failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Mirror an edit. Existing copies are updated; copies for profiles no longer
 * assigned are deleted; newly assigned profiles get fresh copies (when sync is
 * enabled). Edits/deletes to existing copies run regardless of the toggle so an
 * already-synced event stays consistent.
 */
export async function syncEventUpdate(event: Event): Promise<void> {
  try {
    if (!event.userId) return;
    const existing = await storage.getEventCalendarSyncs(event.id);
    const syncEnabled = await isTwoWaySyncEnabled(event.userId);
    const writer = await familyWriterFor(event);
    const profileIds = syncTargetsForEvent(
      event.source,
      writer?.profileId ?? null,
      existing.map((link) => link.profileId),
      writer ? [] : await resolveProfileIds(event),
    );
    const plan = planEventUpdate(existing, profileIds, syncEnabled);
    const creates = familyCalendarCreates(plan.toCreate, writer);

    // planEventUpdate guarantees the three buckets cover disjoint
    // (provider, profileId) pairs, so they're safe to run concurrently — and
    // they need to be: re-assigning an event to the whole family produces one
    // create per newly-assigned profile per provider, which was previously a
    // long chain of sequential external round-trips.
    await Promise.allSettled([
      ...plan.toUpdate.map((link) =>
        link.provider === "google" ? updateGoogleCopy(event, link)
        : link.provider === "outlook" ? updateOutlookCopy(event, link)
        : Promise.resolve(),
      ),
      ...plan.toDelete.map(async (link) => {
        if (link.provider === "google") await deleteGoogleCopy(link);
        else if (link.provider === "outlook") await deleteOutlookCopy(link);
        await storage.deleteEventCalendarSync(link.eventId, link.profileId, link.provider);
      }),
      ...creates.map(({ profileId, provider }) =>
        provider === "google" ? createGoogleCopy(event, profileId, writer && profileId === writer.profileId ? event.calendarId ?? undefined : undefined)
        : provider === "outlook" ? createOutlookCopy(event, profileId, writer && profileId === writer.profileId ? event.calendarId ?? undefined : undefined)
        : Promise.resolve(),
      ),
    ]);
  } catch (err) {
    console.warn("syncEventUpdate failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Delete every external copy of an event. Accepts the previously-fetched sync
 * rows because the local event (and its cascading sync rows) may already be
 * deleted by the time external deletion runs.
 */
export async function syncEventDelete(links: EventCalendarSync[]): Promise<void> {
  try {
    await Promise.allSettled(
      links.map((link) =>
        link.provider === "google" ? deleteGoogleCopy(link)
        : link.provider === "outlook" ? deleteOutlookCopy(link)
        : Promise.resolve(),
      ),
    );
  } catch (err) {
    console.warn("syncEventDelete failed:", err instanceof Error ? err.message : err);
  }
}
