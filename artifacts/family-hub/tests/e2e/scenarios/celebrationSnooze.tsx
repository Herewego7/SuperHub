import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AnnouncementsBanner } from "@/components/announcements-banner";
import { installMockApi, baselineRoutes } from "../mockApi";

const profiles = [{ id: "dad", name: "Dad", initials: "D", color: "#3b82f6" }] as any;

// Two celebrations at different distances, so one scenario covers both ends of
// the checkpoint rule: dismissing "Far" (5 days out) should bring it back at
// 1 day, dismissing "Near" (1 day out) should bring it back on the day.
const celebrations = [
  { id: "far", name: "Far Birthday", type: "birthday", daysUntil: 5,
    nextOccurrence: new Date(Date.now() + 5 * 864e5).toISOString(),
    profileId: null, profileIds: [], photos: [], giftIdeas: [], notes: null,
    ageThisYear: null, showYear: false, customLabel: null },
  { id: "near", name: "Near Birthday", type: "birthday", daysUntil: 1,
    nextOccurrence: new Date(Date.now() + 1 * 864e5).toISOString(),
    profileId: null, profileIds: [], photos: [], giftIdeas: [], notes: null,
    ageThisYear: null, showYear: false, customLabel: null },
];

export function setup(): void {
  // Deliberately does NOT clear localStorage: the test seeds thresholds and
  // reloads to check them, and setup() runs on every load — clearing here
  // wiped the seed before the component could read it. A fresh browser
  // context already starts empty.
  installMockApi(baselineRoutes({
    "/api/profiles": profiles,
    "/api/celebrations": celebrations,
  }));
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ padding: 12 }}>
        <AnnouncementsBanner profiles={profiles} selectedProfiles={[]} />
      </div>
    </QueryClientProvider>
  );
}
