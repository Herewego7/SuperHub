import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TodosView } from "@/components/todos-view";
import { ConfirmDialogHost } from "@/lib/confirmDialog";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// The To-Dos TAB, not the Tasks-card embed — this is what the 2026-09-14
// recording shows: one parent with five sub-to-dos, a second person's card
// below it, and the reorder endpoint behaving like the real one.
const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "parent" },
  { id: "mom", name: "Mom", initials: "M", color: "#ec4899", role: "parent" },
] as any;

const base = {
  userId: "u1", icon: "✅", points: 0, isActive: true, isBonus: false, targetCount: 0,
  taskType: "todo", daysOfWeek: [], recurrenceType: null, endDate: null,
  description: null, parentChoreId: null,
};

const todos: any[] = [
  { ...base, id: "p1", title: "Test", displayOrder: 0, profileIds: ["dad"] },
  { ...base, id: "k1", title: "test 3", displayOrder: 1, profileIds: ["dad"], parentChoreId: "p1" },
  { ...base, id: "k2", title: "Test 5", displayOrder: 2, profileIds: ["dad"], parentChoreId: "p1" },
  { ...base, id: "k3", title: "test 6", displayOrder: 3, profileIds: ["dad"], parentChoreId: "p1" },
  { ...base, id: "k4", title: "test 4", displayOrder: 4, profileIds: ["dad"], parentChoreId: "p1" },
  { ...base, id: "k5", title: "test 2", displayOrder: 5, profileIds: ["dad"], parentChoreId: "p1" },
  { ...base, id: "m1", title: "Find the replacement head", displayOrder: 6, profileIds: ["mom"] },
  { ...base, id: "m2", title: "Reach out about ordering", displayOrder: 7, profileIds: ["mom"] },
  { ...base, id: "m3", title: "Update front porch", displayOrder: 8, profileIds: ["mom"] },
];

export function setup(): void {
  try { window.localStorage.clear(); } catch { /* private mode */ }
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/chores/reorder": (_url: string, opts?: RequestInit) => {
        const { orderedIds } = JSON.parse(opts!.body as string);
        (window as any).__lastReorderBody = { orderedIds };
        orderedIds.forEach((id: string, i: number) => {
          const row = todos.find(t => t.id === id);
          if (row) row.displayOrder = i;
        });
        return ok({});
      },
      "/api/chores": (_url: string, opts?: RequestInit) => {
        if (opts?.method) return ok({});
        return ok([...todos].sort((a, b) => a.displayOrder - b.displayOrder));
      },
      "/api/chore-completions": [],
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <TodosView selectedProfiles={["dad", "mom"]} profiles={profiles} />
      <ConfirmDialogHost />
    </QueryClientProvider>
  );
}
