import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TodosView } from "@/components/todos-view";
import { ConfirmDialogHost } from "@/lib/confirmDialog";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// One person, two open to-dos, one of which has a sub-to-do. Checking the last
// open item off is meant to fire the celebration on this tab.
const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
] as any;

const base = {
  userId: "u1", icon: "✅", points: 0, isActive: true, isBonus: false,
  targetCount: 0, taskType: "todo", daysOfWeek: [], recurrenceType: null,
  endDate: null, profileIds: ["kid1"], description: null, parentChoreId: null,
};

const todos = [
  { ...base, id: "t1", title: "Pack bag", displayOrder: 0 },
  { ...base, id: "t2", title: "Homework", displayOrder: 1 },
  { ...base, id: "t2a", title: "Maths page", displayOrder: 0, parentChoreId: "t2" },
];

// Everything done except "Pack bag" — so one click finishes the list.
const completions = [
  { id: "c2", choreId: "t2", profileId: "kid1", points: 0, completedAt: new Date().toISOString() },
  { id: "c2a", choreId: "t2a", profileId: "kid1", points: 0, completedAt: new Date().toISOString() },
];

export function setup(): void {
  // The celebration dedups per profile per day in localStorage and the harness
  // reuses one origin across tests — a leftover flag would make this scenario
  // silently unable to celebrate at all.
  try { window.localStorage.clear(); } catch { /* private mode */ }
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/chores": () => ok(todos),
      "/api/chore-completions": (_url: string, opts?: RequestInit) => {
        if (opts?.method === "POST") {
          return ok({ id: "c1", choreId: "t1", profileId: "kid1", points: 0, completedAt: new Date().toISOString() });
        }
        return ok(completions);
      },
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <TodosView selectedProfiles={["kid1"]} profiles={profiles} />
      <ConfirmDialogHost />
    </QueryClientProvider>
  );
}
