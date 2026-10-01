import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { HistoryView } from "@/components/history-view";
import { installMockApi, baselineRoutes } from "../mockApi";

const profiles = [{ id: "ava", name: "Ava", initials: "A", color: "#3b82f6" }] as any;

const entries = [
  {
    id: "act1",
    activityType: "chore_complete",
    profileId: "ava",
    profileName: "Ava",
    profileColor: "#3b82f6",
    profileInitials: "A",
    profilePhotoUrl: null,
    toProfileId: null,
    toProfileName: null,
    toProfileColor: null,
    description: "Completed Make bed",
    entityTitle: "Make bed",
    metadata: { choreId: "c1", isBonus: false, isTargetChore: false },
    timestamp: new Date("2026-08-25T10:00:00.000Z").toISOString(),
  },
  {
    // Notes reach Family Activity as of 2026-09-03 — before that a note
    // vanished for good once it was ticked off in Announcements.
    id: "nt-n1",
    activityType: "note_posted",
    profileId: "ava",
    profileName: "Ava",
    profileColor: "#3b82f6",
    profileInitials: "A",
    profilePhotoUrl: null,
    toProfileId: null,
    toProfileName: "Dad",
    toProfileColor: null,
    description: 'Posted a note for Dad: "Soccer kit is in the hall"',
    entityTitle: "Soccer kit is in the hall",
    metadata: { contentId: "n1" },
    timestamp: new Date("2026-08-25T11:00:00.000Z").toISOString(),
  },
];

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/activity-log": entries,
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Reproduces the real family-hub.tsx wiring exactly: opening the
          drawer scoped to one specific entry (e.g. from Home's Recent
          Activity card). */}
      <HistoryView
        open
        onClose={() => {}}
        profiles={profiles}
        initialTypeFilter={undefined}
        focusEntryId="act1"
      />
    </QueryClientProvider>
  );
}
