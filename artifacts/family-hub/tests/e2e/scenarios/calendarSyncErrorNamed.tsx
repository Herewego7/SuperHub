import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Calendar3View } from "@/components/calendar3-view";
import { installMockApi, baselineRoutes } from "../mockApi";

// Two Google connections in one family: Dad's loads, and Google turns Mom's away.
const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "parent", isActive: true, googleCalendarConnected: true },
  { id: "mom", name: "Mom", initials: "M", color: "#a855f7", role: "parent", isActive: true, googleCalendarConnected: true },
];

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/google-calendar/events/mom": () => new Response(JSON.stringify({ error: "Failed to fetch calendar events" }), { status: 500 }),
      "/api/google-calendar/events": [],
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <Calendar3View
        selectedProfiles={[]}
        profiles={profiles as never}
        selectedDate={new Date()}
        onDateChange={() => {}}
      />
    </QueryClientProvider>
  );
}
