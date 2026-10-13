import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { installMockApi, baselineRoutes } from "../mockApi";

// Home with one connected Google calendar holding one all-day event today.
// Tapping it on Home has to open the same event on the Calendar tab.
function ymd(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

export function setup(): void {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  installMockApi(
    baselineRoutes({
      "/api/auth/user": { id: "u1", email: "test@test.com", onboardingCompletedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      "/api/profiles": [
        { id: "all", name: "All Family", isAllFamilyProfile: true, initials: "AF", color: "#888" },
        { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult", googleCalendarConnected: true },
        { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
      ],
      "/api/google-calendar/accounts": [{ profileId: "dad", email: "dad@gmail.com" }],
      "/api/google-calendar/events": [
        {
          id: "g123",
          iCalUID: "g123@google.com",
          summary: "Soccer tournament",
          start: { date: ymd(today) },
          end: { date: ymd(tomorrow) },
          creator: { email: "dad@gmail.com" },
          extendedProperties: { private: { google_calendar_id: "dad@gmail.com", calendar_name: "Dad" } },
        },
      ],
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
