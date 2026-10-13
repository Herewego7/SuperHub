import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { CalendarAssignment, Event, Profile } from "@workspace/shared-types";
import { getQueryFn } from "@/lib/queryClient";
import { mergeFamilyEvents, type FamilyEvent } from "@/lib/familyEvents";

export type CalendarSync = { failing: boolean; profileId?: string; names: string[] };

function syncOf(connected: Profile[], queries: { isError: boolean }[]): CalendarSync {
  const failingAt = queries.findIndex((query) => query.isError);
  return {
    failing: failingAt >= 0,
    // First profile whose connection is erroring, so a banner can open that person's row in Settings.
    profileId: connected[failingAt]?.id,
    names: connected.filter((_, i) => queries[i]?.isError).map((profile) => profile.name),
  };
}

/**
 * Every family event, from the app and each connected calendar, fetched and merged
 * once so Home and Calendar show the same events with the same ids and colors.
 */
export function useFamilyEvents(profiles: Profile[], options: { refetchInterval?: number } = {}) {
  const { data: localEvents = [] } = useQuery<Event[]>({ queryKey: ["/api/events"] });
  const { data: calendarAssignments = [] } = useQuery<CalendarAssignment[]>({
    queryKey: ["/api/calendar-assignments"],
    retry: false,
  });
  const { data: googleAccounts = [] } = useQuery<{ profileId: string; email: string }[]>({
    queryKey: ["/api/google-calendar/accounts"],
    retry: false,
    staleTime: 300_000,
  });

  const regularProfiles = useMemo(() => profiles.filter((p) => !p.isAllFamilyProfile), [profiles]);
  // Query results are matched back to a profile by INDEX into these arrays, so
  // they stay memoized rather than refiltered each render.
  const googleConnected = useMemo(() => regularProfiles.filter((p) => p.googleCalendarConnected), [regularProfiles]);
  const outlookConnected = useMemo(() => regularProfiles.filter((p) => p.outlookCalendarConnected), [regularProfiles]);
  const icalConnected = useMemo(() => regularProfiles.filter((p) => p.icalConnected), [regularProfiles]);
  const feed = (key: string) => (profile: Profile) => ({
    queryKey: [key, profile.id],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 60_000,
    refetchInterval: options.refetchInterval,
  });
  const googleQueries = useQueries({ queries: googleConnected.map(feed("/api/google-calendar/events")) });
  const outlookQueries = useQueries({ queries: outlookConnected.map(feed("/api/outlook-calendar/events")) });
  const icalQueries = useQueries({ queries: icalConnected.map(feed("/api/ical-calendar/events")) });

  // Keyed on each query's dataUpdatedAt: useQueries returns a new array every
  // render, which would otherwise re-merge thousands of events on every switch.
  const googleSig = googleQueries.map((q) => q.dataUpdatedAt ?? 0).join("|");
  const outlookSig = outlookQueries.map((q) => q.dataUpdatedAt ?? 0).join("|");
  const icalSig = icalQueries.map((q) => q.dataUpdatedAt ?? 0).join("|");
  const events = useMemo<FamilyEvent[]>(() => mergeFamilyEvents({
    local: localEvents,
    google: googleConnected.map((profile, i) => ({ profileId: profile.id, rows: (googleQueries[i]?.data ?? []) as any[] })),
    outlook: outlookConnected.map((profile, i) => ({ profileId: profile.id, rows: (outlookQueries[i]?.data ?? []) as any[] })),
    ical: icalConnected.map((profile, i) => ({ profileId: profile.id, rows: (icalQueries[i]?.data ?? []) as any[] })),
    assignments: calendarAssignments,
    googleAccounts,
    people: profiles,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [localEvents, googleSig, outlookSig, icalSig, calendarAssignments, googleAccounts, profiles, googleConnected, outlookConnected, icalConnected]);

  return {
    events,
    calendarAssignments,
    google: syncOf(googleConnected, googleQueries),
    outlook: syncOf(outlookConnected, outlookQueries),
    ical: syncOf(icalConnected, icalQueries),
  };
}
