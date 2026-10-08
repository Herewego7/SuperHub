import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// The kitchen iPad most of the day: Home open, a connected Google calendar,
// and a behaviour board with no timer running. `?timer` starts one, ending in
// ten minutes.
export function setup(): void {
  const timer = new URLSearchParams(window.location.search).has("timer");
  const now = Date.now();
  installMockApi(
    baselineRoutes({
      "/api/auth/user": { id: "u1", email: "test@test.com", onboardingCompletedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      "/api/profiles": [
        { id: "all", name: "All Family", isAllFamilyProfile: true, initials: "AF", color: "#888" },
        { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult", googleCalendarConnected: true },
        { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
      ],
      "/api/google-calendar/events": [],
      "/api/behaviour-board": () => ok({
        settings: null,
        rules: [],
        recentIncidents: [],
        activeIncidents: timer
          ? [{ id: "i1", profileId: "kid1", ruleId: null, startedAt: new Date(now).toISOString(), timerEndsAt: new Date(now + 10 * 60_000).toISOString() }]
          : [],
      }),
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <FamilyHub />
    </QueryClientProvider>
  );
}
