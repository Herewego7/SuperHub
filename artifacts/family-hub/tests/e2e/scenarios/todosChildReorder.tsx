import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { PersonTodoList } from "@/components/todos-view";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
] as any;

const base = {
  userId: "u1", icon: "✅", points: 0, isActive: true, isBonus: false, targetCount: 0,
  taskType: "todo", daysOfWeek: [], recurrenceType: null, endDate: null,
  profileIds: ["kid1"], description: null,
};

// One parent with three sub-to-dos — the case where dragging previewed a move
// and then dropped it on the floor.
const todos = [
  { ...base, id: "p1", title: "Pack for camp", displayOrder: 0, parentChoreId: null },
  { ...base, id: "c1", title: "Sunscreen", displayOrder: 1, parentChoreId: "p1" },
  { ...base, id: "c2", title: "Towel", displayOrder: 2, parentChoreId: "p1" },
  { ...base, id: "c3", title: "Water bottle", displayOrder: 3, parentChoreId: "p1" },
];

(window as unknown as { __lastReorderBody?: unknown }).__lastReorderBody = undefined;

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/chores/reorder": (_url: string, opts?: RequestInit) => {
        (window as unknown as { __lastReorderBody?: unknown }).__lastReorderBody = JSON.parse(opts!.body as string);
        return ok({});
      },
      "/api/chores": (url: string, opts?: RequestInit) => {
        if (opts?.method) return ok({});
        return ok(todos);
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
