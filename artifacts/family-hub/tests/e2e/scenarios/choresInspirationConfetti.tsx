import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ChoresView } from "@/components/chores-view";
import { ConfirmDialogHost } from "@/lib/confirmDialog";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// One real chore and one Inspiration item (an affirmation), both open. The
// day is finished once the CHORE is done — the affirmation is something to
// read, not work to get through, and used to hold the celebration hostage.
const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
] as any;

const base = {
  userId: "u1", isActive: true, isBonus: false, targetCount: 0,
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6], recurrenceType: "daily", endDate: null,
  profileIds: ["kid1"], description: null,
};

const chores = [
  { ...base, id: "chore1", title: "Feed the dog", icon: "🐶", points: 2, taskType: "chore", displayOrder: 0 },
  { ...base, id: "insp1", title: "I am kind and brave", icon: "💬", points: 0, taskType: "affirmation", displayOrder: 1 },
];

export function setup(): void {
  // The celebration is deduped per profile per day in localStorage, and the
  // harness reuses one origin across tests — a leftover flag would make this
  // scenario silently unable to celebrate at all.
  try { window.localStorage.clear(); } catch { /* private mode */ }
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/chores": () => ok(chores),
      "/api/chore-completions": (_url: string, opts?: RequestInit) => {
        if (opts?.method === "POST") return ok({ id: "cc1", choreId: "chore1", profileId: "kid1", points: 2, completedAt: new Date().toISOString() });
        return ok([]);
      },
      "/api/chore-skips": [],
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <ChoresView selectedProfiles={["kid1"]} profiles={profiles} selectedDate={new Date()} />
      <ConfirmDialogHost />
    </QueryClientProvider>
  );
}
