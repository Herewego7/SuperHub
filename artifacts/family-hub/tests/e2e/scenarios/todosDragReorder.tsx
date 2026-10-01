import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { PersonTodoList } from "@/components/todos-view";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
] as any;

const todos = [
  { id: "t1", userId: "u1", title: "First", icon: "✅", points: 0, isActive: true, isBonus: false, targetCount: 0, taskType: "todo", daysOfWeek: [], recurrenceType: null, endDate: null, profileIds: ["kid1"], displayOrder: 0, description: null, parentTodoId: null },
  { id: "t2", userId: "u1", title: "Second", icon: "✅", points: 0, isActive: true, isBonus: false, targetCount: 0, taskType: "todo", daysOfWeek: [], recurrenceType: null, endDate: null, profileIds: ["kid1"], displayOrder: 1, description: null, parentTodoId: null },
  { id: "t3", userId: "u1", title: "Third", icon: "✅", points: 0, isActive: true, isBonus: false, targetCount: 0, taskType: "todo", daysOfWeek: [], recurrenceType: null, endDate: null, profileIds: ["kid1"], displayOrder: 2, description: null, parentTodoId: null },
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
