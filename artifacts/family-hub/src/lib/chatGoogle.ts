import { icalDisplayEnd, parseGoogleEventDates, parseOutlookEventDates } from "./calendarDates";
import { driverIdsFromGoogleEvent } from "./eventDrivers";
import { outlookEventProfileIds, type AssignmentLike } from "./outlookAttribution";
import { recurringIdFromIcal, recurringIdFromOutlook } from "./upcoming";

export type ChatGoogleEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  source: "google";
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  profileIds: string[];
  drivingProfileIds: string[];
  googleEventId: string;
  googleProfileId: string;
  googleCalendarId: string | null;
  recurringEventId: string | null;
};

function assignedIds(event: { extendedProperties?: { private?: Record<string, string> } }, profileId: string): string[] {
  const raw = event.extendedProperties?.private?.["familyhub_profile_ids"];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((id) => typeof id === "string")) return parsed;
    } catch {
      /* A bad assignment falls back to the connected person. */
    }
  }
  return [profileId];
}

type ExternalEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  source: "outlook" | "ical";
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  profileIds: string[];
  drivingProfileIds: string[];
  outlookCalendarId: string | null;
  recurringEventId: string | null;
};

export function chatOutlookEvents(
  batches: { profileId: string; events?: unknown[] | null }[],
  assignments: AssignmentLike[],
  knownIds: string[],
): ExternalEvent[] {
  const seen = new Set<string>();
  const known = new Set(knownIds);
  const rows: ExternalEvent[] = [];
  for (const batch of batches) {
    for (const item of batch.events ?? []) {
      const event = item as {
        id?: string;
        subject?: string;
        bodyPreview?: string;
        isAllDay?: boolean;
        start?: { dateTime?: string; timeZone?: string } | null;
        end?: { dateTime?: string; timeZone?: string } | null;
        location?: { displayName?: string } | null;
        calendar?: { id?: string; name?: string } | null;
        seriesMasterId?: string | null;
      };
      if (!event?.id || seen.has(event.id)) continue;
      seen.add(event.id);
      const { start, end } = parseOutlookEventDates(event);
      rows.push({
        id: `outlook-${batch.profileId}-${event.id}`,
        title: event.subject?.trim() || "Untitled",
        description: event.bodyPreview ?? null,
        location: event.location?.displayName ?? null,
        source: "outlook",
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        isAllDay: event.isAllDay === true,
        profileIds: outlookEventProfileIds(event, batch.profileId, assignments, known),
        drivingProfileIds: [],
        outlookCalendarId: event.calendar?.id ?? null,
        recurringEventId: recurringIdFromOutlook(event),
      });
    }
  }
  return rows;
}

export function chatIcalEvents(
  batches: { profileId: string; events?: unknown[] | null }[],
): ExternalEvent[] {
  const seen = new Set<string>();
  const rows: ExternalEvent[] = [];
  for (const batch of batches) {
    for (const item of batch.events ?? []) {
      const event = item as {
        id?: string;
        title?: string;
        description?: string;
        location?: string;
        start?: string;
        end?: string;
        isAllDay?: boolean;
        uid?: string | null;
      };
      if (!event?.id || !event.start || seen.has(event.id)) continue;
      seen.add(event.id);
      const isAllDay = event.isAllDay === true;
      const start = new Date(event.start);
      const end = event.end ? icalDisplayEnd(event.end, isAllDay, start) : start;
      rows.push({
        id: `ical-${batch.profileId}-${event.id}`,
        title: event.title?.trim() || "Untitled",
        description: event.description ?? null,
        location: event.location ?? null,
        source: "ical",
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        isAllDay,
        profileIds: [batch.profileId],
        drivingProfileIds: [],
        outlookCalendarId: null,
        recurringEventId: recurringIdFromIcal(event),
      });
    }
  }
  return rows;
}

/** Where chat writes a change that belongs on Google. Outlook and a missing calendar stay null. */
export function googleChatWrite(event: {
  source?: string | null;
  googleProfileId?: string;
  googleCalendarId?: string | null;
  googleEventId?: string;
}): string | null {
  if (event.source !== "google" || !event.googleProfileId || !event.googleCalendarId || !event.googleEventId) return null;
  return `/api/google-calendar/events/${encodeURIComponent(event.googleProfileId)}/${encodeURIComponent(event.googleCalendarId)}/${encodeURIComponent(event.googleEventId)}`;
}

/** Google events chat can talk about. A second copy of the same event is dropped. */
export function chatGoogleEvents(
  batches: { profileId: string; events?: unknown[] | null }[],
): ChatGoogleEvent[] {
  const seen = new Set<string>();
  const rows: ChatGoogleEvent[] = [];
  for (const batch of batches) {
    for (const item of batch.events ?? []) {
      const event = item as {
        id?: string;
        summary?: string;
        description?: string;
        location?: string;
        start?: { date?: string | null; dateTime?: string | null };
        end?: { date?: string | null; dateTime?: string | null };
        recurringEventId?: string | null;
        extendedProperties?: { private?: Record<string, string> };
      };
      if (!event?.id || seen.has(event.id)) continue;
      seen.add(event.id);
      const { start, end } = parseGoogleEventDates(event);
      rows.push({
        id: `google-${batch.profileId}-${event.id}`,
        title: event.summary?.trim() || "Untitled",
        description: event.description ?? null,
        location: event.location ?? null,
        source: "google",
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        isAllDay: !event.start?.dateTime,
        profileIds: assignedIds(event, batch.profileId),
        drivingProfileIds: driverIdsFromGoogleEvent(event),
        googleEventId: event.id,
        googleProfileId: batch.profileId,
        googleCalendarId: event.extendedProperties?.private?.["google_calendar_id"] ?? null,
        recurringEventId: event.recurringEventId ?? null,
      });
    }
  }
  return rows;
}
