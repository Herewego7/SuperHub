import { parseGoogleEventDates } from "./calendarDates";
import { driverIdsFromGoogleEvent } from "./eventDrivers";

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
