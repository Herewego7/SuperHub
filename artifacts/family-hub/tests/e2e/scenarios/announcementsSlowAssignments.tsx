import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AnnouncementsBanner } from "@/components/announcements-banner";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6" },
] as any;

// Three notes, all assigned to Dad and all previously dismissed on this device
// (the test seeds localStorage with their real `${contentId}:${profileId}`
// keys). Nothing here should ever be visible.
const notes = [1, 2, 3].map((n) => ({
  id: `n${n}`, type: "note", title: "Note", content: `Old note ${n}`,
  reference: "dad", date: new Date().toISOString(), isActive: true,
}));
const assignments = [1, 2, 3].map((n) => ({
  id: `na${n}`, contentId: `n${n}`, profileId: "dad", date: new Date().toISOString(),
}));

// The race, made deterministic: the notes themselves come back at once, their
// assignments a beat later. That is the ordering a cold start actually
// produces, and the one that used to broadcast every note under a `:none` key
// no stored dismissal could match.
export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/daily-content": notes,
      "/api/daily-content-assignments": async () => {
        await new Promise((r) => setTimeout(r, 3000));
        return ok(assignments);
      },
      "/api/daily-content-completions": [],
      "/api/profiles": profiles,
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <AnnouncementsBanner selectedProfiles={["dad"]} profiles={profiles} />
    </QueryClientProvider>
  );
}
