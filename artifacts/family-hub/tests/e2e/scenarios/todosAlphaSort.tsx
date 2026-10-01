import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TodosView } from "@/components/todos-view";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
] as any;

const base = {
  userId: "u1", icon: "✅", points: 0, isActive: true, isBonus: false, targetCount: 0,
  taskType: "todo", daysOfWeek: [], recurrenceType: null, endDate: null,
  profileIds: ["kid1"], description: null, parentChoreId: null,
};
const todos = [
  { ...base, id: "t1", title: "Alpha one", displayOrder: 0 },
  { ...base, id: "t2", title: "Beta two", displayOrder: 1 },
  { ...base, id: "t3", title: "Gamma three", displayOrder: 2 },
];

(window as unknown as { __reorderCalls?: number }).__reorderCalls = 0;

export function setup(): void {
  // The tab remembers the sort per device; this fixture is the A–Z case.
  try { localStorage.setItem("familyHub_todosSort", "alpha"); } catch { /* ignore */ }
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/chores/reorder": () => {
        (window as unknown as { __reorderCalls?: number }).__reorderCalls!++;
        return ok({});
      },
      "/api/chores": (_url: string, opts?: RequestInit) => (opts?.method ? ok({}) : ok(todos)),
      "/api/chore-completions": [],
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <TodosView profiles={profiles} selectedProfiles={[]} />
    </QueryClientProvider>
  );
}
