import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { PersonTodoList } from "@/components/todos-view";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Like todosChildReorder, but the fixture behaves like the REAL server:
// /api/chores/reorder writes displayOrder, and GET /api/chores returns rows
// sorted by it. The older fixture always replied with one fixed array, so a
// reorder that never reached the screen still looked fine (2026-09-14: "when I
// drag a sub to-do and let go, it either moves to the top of the list, or
// doesn't move").
const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
] as any;

const base = {
  userId: "u1", icon: "✅", points: 0, isActive: true, isBonus: false, targetCount: 0,
  taskType: "todo", daysOfWeek: [], recurrenceType: null, endDate: null,
  profileIds: ["kid1"], description: null,
};

const todos: any[] = [
  { ...base, id: "p1", title: "Pack for camp", displayOrder: 0, parentChoreId: null },
  { ...base, id: "c1", title: "Sunscreen", displayOrder: 1, parentChoreId: "p1" },
  { ...base, id: "c2", title: "Towel", displayOrder: 2, parentChoreId: "p1" },
  { ...base, id: "c3", title: "Water bottle", displayOrder: 3, parentChoreId: "p1" },
  { ...base, id: "c4", title: "Sandals", displayOrder: 4, parentChoreId: "p1" },
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
        // Exactly what the server does: ORDER BY display_order.
        return ok([...todos].sort((a, b) => a.displayOrder - b.displayOrder));
      },
      "/api/chore-completions": [],
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <PersonTodoList profile={profiles[0]} allProfiles={profiles} />
    </QueryClientProvider>
  );
}
