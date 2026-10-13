import { parseGoogleEventDates, parseOutlookEventDates, icalDisplayEnd } from "./calendarDates";
import { assignmentProfileIds, outlookEventProfileIds, withoutUnwatched, type AssignmentLike } from "./outlookAttribution";
import { recurringIdFromIcal, recurringIdFromOutlook } from "./upcoming";
import { driverIdsOf, driverIdsFromGoogleEvent } from "./eventDrivers";
import { eventColor } from "./eventColor";
import { forPeople, mailVisibleToKid } from "./homeDay";

/** Where an event lives. Separate from `source`, the app's own tag on a local event (school, meal, scan). */
export type EventProvider = "local" | "google" | "outlook" | "ical";

/** One event as Home and Calendar both see it. External ids are `google-<id>`, `outlook-<id>`, `ical-<id>`. */
export interface FamilyEvent {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  profileIds: string[];
  /** Drivers, as a set — see lib/eventDrivers.ts. */
  drivingProfileIds: string[];
  description?: string | null;
  location?: string | null;
  isAllDay: boolean;
  provider: EventProvider;
  source?: string | null;
  color: string;
  calendarName?: string | null;
  calendarColor?: string | null;
  // raw originals for editing
  localId?: string;
  googleEventId?: string;
  googleProfileId?: string;
  googleCalendarId?: string;
  outlookCalendarId?: string | null;
  recurringEventId?: string | null;
  // Local recurrence (see api-server/src/lib/eventRecurrence.ts) — a
  // synthetic occurrence's `id` is not a real row; edits/deletes must
  // resolve back to the series' first occurrence.
  isRecurringInstance?: boolean;
  seriesId?: string;
  recurrenceType?: "daily" | "weekly" | "monthly" | "annually" | null;
  recurrenceEndDate?: string | null;
  recurrenceInterval?: number | null;
  daysOfWeek?: number[] | null;
}

type Person = { id: string; name?: string; color?: string | null; isAllFamilyProfile?: boolean | null; isChild?: boolean | null; role?: string | null };
type Feed = { profileId: string; rows: any[] };

// Gmail treats addresses as case-insensitive and ignores dots in the local part.
// Normalize before comparing so "John.Doe+tag@gmail.com" == "johndoe@gmail.com".
export function normalizeGmail(email?: string | null): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  const [local, domain] = trimmed.split("@");
  if (!local || !domain) return null;
  const isGoogle = domain === "gmail.com" || domain === "googlemail.com";
  const cleanedLocal = isGoogle
    ? local.replace(/\./g, "").split("+")[0]
    : local.split("+")[0];
  return `${cleanedLocal}@${domain}`;
}

export function mergeFamilyEvents(input: {
  local: any[];
  google: Feed[];
  outlook: Feed[];
  ical: Feed[];
  assignments: readonly AssignmentLike[];
  googleAccounts: readonly { profileId: string; email: string }[];
  people: Person[];
}): FamilyEvent[] {
  const { assignments, people } = input;
  const result: FamilyEvent[] = [];
  const accountByEmail = new Map(
    input.googleAccounts
      .map((account) => [normalizeGmail(account.email), account.profileId] as const)
      .filter((entry): entry is readonly [string, string] => entry[0] !== null),
  );

  // 1. Local events
  for (const e of input.local) {
    if (!e.startTime || !e.endTime) continue;
    const pIds = (e.profileIds as string[] | null) ?? [];
    result.push({
      ...e,
      id: e.id,
      localId: e.id,
      title: e.title,
      startTime: new Date(e.startTime),
      endTime: new Date(e.endTime),
      profileIds: pIds,
      drivingProfileIds: driverIdsOf(e),
      isAllDay: e.isAllDay ?? false,
      provider: "local",
      source: e.source ?? null,
      color: eventColor({ profileIds: pIds }, people),
      isRecurringInstance: e.isRecurringInstance ?? false,
      seriesId: e.seriesId,
      recurrenceType: e.recurrenceType ?? null,
      recurrenceEndDate: e.recurrenceEndDate ?? null,
      recurrenceInterval: e.recurrenceInterval ?? 1,
      daysOfWeek: e.daysOfWeek ?? null,
    });
  }

  // 2. Google Calendar
  // Use iCalUID as the stable dedup key (same event across two calendars gets
  // different ge.id values but the same iCalUID). When the same event appears
  // on multiple family members' calendars, keep the most authoritative copy:
  // an explicit manual assignment (3) beats a creator-email match (2), which
  // beats any weaker fallback (1).
  type Resolved = { ge: any; pIds: string[]; resolveRank: number; pid: string };
  const bestByKey = new Map<string, Resolved>();
  for (const { profileId: pid, rows } of input.google) {
    for (const ge of rows) {
      // With singleEvents every occurrence shares one iCalUID, so the key
      // includes the instance start, NORMALIZED to a canonical instant: the
      // same event on two calendars can serialize its start differently
      // ("...-07:00" vs "...Z"). Timed events key on epoch ms; all-day on date.
      const occurrenceStart = ge.start?.dateTime
        ? String(new Date(ge.start.dateTime).getTime())
        : (ge.start?.date || "");
      const key = `${ge.iCalUID || ge.id}::${occurrenceStart}`;
      let pIds: string[] = [];
      let resolveRank = 1;

      // Priority 1: explicit familyhub assignment stored on the event.
      const stored = ge.extendedProperties?.private?.["familyhub_profile_ids"];
      if (stored) { try { const p = JSON.parse(stored); if (Array.isArray(p) && p.length) { pIds = p; resolveRank = 3; } } catch { } }

      // Priority 2: creator/organizer email → connected account (normalized)
      if (!pIds.length) {
        const email = normalizeGmail(ge.creator?.email) ?? normalizeGmail(ge.organizer?.email);
        const p2 = email ? accountByEmail.get(email) : undefined;
        if (p2) { pIds = [p2]; resolveRank = 2; }
      }

      // Priority 3: match by the event's own google_calendar_id
      const gcalId = ge.extendedProperties?.private?.["google_calendar_id"];
      if (!pIds.length && gcalId) {
        const a = assignments.find((x) => x.calendarId === gcalId && x.calendarType === "google");
        if (a) pIds = assignmentProfileIds(a);
      }

      // Priority 4: fall back to the iterating profile
      if (!pIds.length) pIds = [pid];

      const existing = bestByKey.get(key);
      if (!existing || resolveRank > existing.resolveRank) bestByKey.set(key, { ge, pIds, resolveRank, pid });
    }
  }
  for (const { ge, pIds, pid } of bestByKey.values()) {
    // parseGoogleEventDates handles the all-day EXCLUSIVE end date.
    const { start, end } = parseGoogleEventDates(ge);
    const calendarColor = ge.extendedProperties?.private?.["calendar_color"] || null;
    result.push({
      id: `google-${ge.id}`,
      googleEventId: ge.id,
      googleProfileId: pid,
      googleCalendarId: ge.extendedProperties?.private?.["google_calendar_id"],
      recurringEventId: ge.recurringEventId ?? null,
      title: ge.summary || "Untitled",
      startTime: start,
      endTime: end,
      profileIds: pIds,
      drivingProfileIds: driverIdsFromGoogleEvent(ge),
      description: ge.description,
      location: ge.location,
      isAllDay: !ge.start?.dateTime,
      provider: "google",
      source: null,
      calendarName: ge.extendedProperties?.private?.["calendar_name"] || null,
      calendarColor,
      color: eventColor({ profileIds: pIds, calendarColor }, people),
    });
  }

  // 3. Outlook Calendar
  const known = new Set(people.map((person) => person.id));
  for (const { profileId: pid, rows } of input.outlook) {
    for (const oe of rows) {
      const oPids = outlookEventProfileIds(oe, pid, assignments, known);
      const dates = parseOutlookEventDates(oe);
      result.push({
        id: `outlook-${oe.id}`,
        title: oe.subject || "Untitled",
        startTime: dates.start,
        endTime: dates.end,
        profileIds: oPids,
        drivingProfileIds: [], // Outlook has no driver concept
        description: oe.bodyPreview,
        location: oe.location?.displayName,
        isAllDay: oe.isAllDay ?? false,
        provider: "outlook",
        source: null,
        outlookCalendarId: oe.calendar?.id ?? null,
        calendarName: oe.calendar?.name ?? null,
        recurringEventId: recurringIdFromOutlook(oe),
        color: eventColor({ profileIds: oPids }, people),
      });
    }
  }

  // 4. iCal (.ics URL) subscriptions — read-only, assigned to a single profile.
  for (const { profileId: pid, rows } of input.ical) {
    for (const ie of rows) {
      const start = new Date(ie.start);
      const calendarColor = ie.calendarColor || null;
      result.push({
        id: `ical-${ie.id}`,
        title: ie.title || "Untitled",
        startTime: start,
        endTime: icalDisplayEnd(ie.end, ie.isAllDay ?? false, start),
        profileIds: [pid],
        drivingProfileIds: [], // iCal feeds have no driver concept
        description: ie.description,
        location: ie.location,
        isAllDay: ie.isAllDay ?? false,
        provider: "ical",
        source: null,
        calendarName: "Subscribed Calendar",
        calendarColor,
        recurringEventId: recurringIdFromIcal(ie),
        color: eventColor({ profileIds: [pid], calendarColor }, people),
      });
    }
  }

  return result;
}

/** What a view shows: the people rule, a child's own school mail only, and nothing from an unwatched calendar. */
export function familyEventsFor<T extends { profileIds?: string[] | null; drivingProfileIds?: string[] | null; title: string; source?: string | null; description?: string | null; googleCalendarId?: string | null; outlookCalendarId?: string | null }>(
  events: T[],
  selectedIds: string[],
  people: Person[],
  assignments: readonly Pick<AssignmentLike, "calendarId" | "watched" | "isActive">[],
): T[] {
  const familyIds = people.filter((person) => !person.isAllFamilyProfile).map((person) => person.id);
  const everyoneId = people.find((person) => person.isAllFamilyProfile)?.id ?? null;
  const picked = people.filter((person) => !person.isAllFamilyProfile && selectedIds.includes(person.id));
  const kidName = picked.length === 1 && (picked[0].role === "child" || picked[0].isChild) ? picked[0].name ?? null : null;
  const shown = forPeople(events, selectedIds, familyIds, everyoneId).filter((event) => mailVisibleToKid(event, kidName));
  return withoutUnwatched(shown, assignments);
}
