import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { installMockApi, baselineRoutes } from "../mockApi";

// A medication push whose dose never reached the server: the device fired it,
// so there is no unacknowledged event and no inbox card to point at. The
// reminder itself still exists.

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/auth/user": {
        id: "u1",
        email: "test@test.com",
        onboardingCompletedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      "/api/profiles": [
        { id: "all", name: "All Family", isAllFamilyProfile: true, initials: "AF", color: "#888" },
        { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult" },
      ],
      "/api/health-reminders": [
        { id: "hr1", profileId: "dad", title: "Blood pressure pill", type: "medication", dose: "1 tablet", location: null, notes: null, isActive: true, snoozeMinutes: 15, scheduleJson: { kind: "daily", time: "09:00" } },
      ],
      "/api/health-reminder-events": [],
    }),
  );

  const u = new URL(window.location.href);
  u.searchParams.set("openTab", "home");
  u.searchParams.set("openAction", "healthReminders");
  window.history.replaceState({}, "", u.toString());
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <FamilyHub />
    </QueryClientProvider>
  );
}
