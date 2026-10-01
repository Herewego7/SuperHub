import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { installMockApi, baselineRoutes } from "../mockApi";

// Regression coverage for the 2026-08-28 "calendar silently stops syncing"
// bug: a profile whose Google/Outlook connection has expired or been
// revoked still has `googleCalendarConnected`/`outlookCalendarConnected` =
// true (that flag only ever means "was this connected at some point," not
// "is it working right now") — so Home's Events card fell straight through
// to the generic "No remaining events today," with nothing telling the
// family a calendar needed to be reconnected. This scenario marks a profile
// as connected but makes the actual events fetch fail (500), matching what
// really happens when Google rejects an expired/revoked refresh token.

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/auth/user": { id: "u1", email: "test@test.com", onboardingCompletedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      "/api/profiles": [
        { id: "all", name: "All Family", isAllFamilyProfile: true, initials: "AF", color: "#888" },
        { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult", googleCalendarConnected: true },
      ],
      "/api/google-calendar/events": () => new Response(JSON.stringify({ error: "Failed to fetch calendar events" }), { status: 500 }),
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
