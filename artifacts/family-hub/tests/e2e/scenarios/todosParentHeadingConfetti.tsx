import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TodosView } from "@/components/todos-view";
import { ConfirmDialogHost } from "@/lib/confirmDialog";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// The shape from the 2026-09-11 recording: one parent to-do used as a heading
// with three sub-to-dos under it, and nothing else on the list. Ticking the
// last CHILD finishes the list — the parent's own circle is a container, not
// a fourth piece of work.
const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
] as any;

const base = {
  userId: "u1", icon: "✅", points: 0, isActive: true, isBonus: false,
  targetCount: 0, taskType: "todo", daysOfWeek: [], recurrenceType: null,
  endDate: null, profileIds: ["kid1"], description: null, parentChoreId: null,
};

const todos = [
  { ...base, id: "p1", title: "Test", displayOrder: 0 },
  { ...base, id: "k1", title: "Sub to do", displayOrder: 0, parentChoreId: "p1" },
  { ...base, id: "k2", title: "Hello", displayOrder: 1, parentChoreId: "p1" },
  { ...base, id: "k3", title: "Hi", displayOrder: 2, parentChoreId: "p1" },
];

// Two of the three children done; the parent itself is untouched.
const completions = [
  { id: "c1", choreId: "k1", profileId: "kid1", points: 0, completedAt: new Date().toISOString() },
  { id: "c2", choreId: "k2", profileId: "kid1", points: 0, completedAt: new Date().toISOString() },
];

export function setup(): void {
  try { window.localStorage.clear(); } catch { /* private mode */ }
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/chores": () => ok(todos),
      "/api/chore-completions": (_url: string, opts?: RequestInit) => {
        if (opts?.method === "POST") {
          return ok({ id: "c3", choreId: "k3", profileId: "kid1", points: 0, completedAt: new Date().toISOString() });
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
