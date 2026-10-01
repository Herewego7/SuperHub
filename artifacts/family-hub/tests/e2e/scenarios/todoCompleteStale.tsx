import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TodosView } from "@/components/todos-view";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

const profiles = [{ id: "dad", name: "Dad", initials: "D", color: "#5e8fad" }] as any;

const base = {
  userId: "u1", icon: "✅", points: 0, isActive: true, isBonus: false, targetCount: 0,
  taskType: "todo", daysOfWeek: [], recurrenceType: null, endDate: null,
  profileIds: ["dad"], description: null, parentTodoId: null,
};
const todos = [
  { ...base, id: "t1", title: "Fix oven", displayOrder: 0 },
  { ...base, id: "t2", title: "Call the vet", displayOrder: 1 },
] as any;

// The read-after-write race, made deterministic: the POST succeeds and returns
// the real row, but every GET keeps reporting an empty list — exactly what a
// refetch that lands before the write is visible would see. A UI that refetches
// here un-checks the row it just checked.
export function setup(): void {
  installMockApi(baselineRoutes({
    "/api/profiles": profiles,
    "/api/chores": todos,
    "/api/chore-completions": (_url: string, opts?: RequestInit) => {
      if ((opts?.method || "GET").toUpperCase() === "POST") {
        return ok({ id: "c-real", choreId: "t1", profileId: "dad", completedAt: new Date().toISOString(), points: 0 });
      }
      return ok([]);
    },
  }));
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <TodosView profiles={profiles} selectedProfiles={["dad"]} onAddTodo={() => {}} />
    </QueryClientProvider>
  );
}
