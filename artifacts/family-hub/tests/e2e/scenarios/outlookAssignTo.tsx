import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { HomeView } from "@/components/home-view";
import { installMockApi, baselineRoutes } from "../mockApi";

// 2026-09-30: an Outlook calendar's "Assign to:" was ignored — its events went
// to whoever connected the account. Dad's Outlook has a calendar assigned to
// Ava; with the view filtered to Ava, the event must be there.
const PROFILES = [
  { id: "all", name: "All Family", isAllFamilyProfile: true, initials: "AF", color: "#888" },
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult", outlookCalendarConnected: true },
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
];

export function setup(): void {
  const start = new Date(); start.setHours(23, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60_000);
  const iso = (d: Date) => d.toISOString().replace("Z", "0000");
  installMockApi(
    baselineRoutes({
      "/api/auth/user": { id: "u1", email: "test@test.com", onboardingCompletedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      "/api/profiles": PROFILES,
      "/api/calendar-assignments": [{ calendarId: "cal-kids", calendarType: "outlook", profileId: "kid1" }],
      "/api/outlook-calendar/events/dad": [{
        id: "o1", subject: "Swim practice", isAllDay: false,
        start: { dateTime: iso(start), timeZone: "UTC" }, end: { dateTime: iso(end), timeZone: "UTC" },
        calendar: { id: "cal-kids", name: "Kids" },
      }],
    }),
  );
}

export function Component() {
  const Home = HomeView as any;
  return (
    <QueryClientProvider client={queryClient}>
      <Home selectedProfiles={["kid1"]} profiles={PROFILES} selectedDate={new Date()} setActiveTab={() => {}} onSelectProfile={() => {}} />
    </QueryClientProvider>
  );
}
