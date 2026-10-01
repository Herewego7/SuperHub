import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface CelebrationCalendarEvent {
  id: string;
  celebrationId: string;
  title: string;
  type: "birthday" | "anniversary" | "other";
  monthDay: string;
  year: number | null;
  ageThisYear: number | null;
  profileId: string | null;
  start: string;
  end: string;
  isAllDay: boolean;
}

function toIsoDate(d: Date): string {
  return d.toISOString();
}

export function isCelebrationEventId(id: string | undefined | null): boolean {
  return typeof id === "string" && id.startsWith("celebration-");
}

/**
 * Fetch synthetic celebration events overlapping the given date window.
 * Pass a wide window (e.g. ±6 months around the current view) so a single
 * cached query satisfies day/week/month nav.
 */
export function useCelebrationEvents(rangeStart: Date, rangeEnd: Date) {
  const start = toIsoDate(rangeStart);
  const end = toIsoDate(rangeEnd);
  return useQuery<CelebrationCalendarEvent[]>({
    queryKey: ["/api/celebrations/calendar", start, end],
    queryFn: async () => {
      // apiRequest, not a bare fetch with a relative path: in the native app
      // the webview runs at capacitor://localhost, so "/api/..." resolves
      // against the local bundle rather than the backend and carries no
      // bearer token. That failed silently here (`!res.ok` returned []), so
      // celebrations simply never appeared on the calendar on the phone.
      const url = `/api/celebrations/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
    staleTime: 60_000,
  });
}
