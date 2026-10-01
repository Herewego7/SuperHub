import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TodosView } from "@/components/todos-view";
import { installMockApi, baselineRoutes } from "../mockApi";

const profiles = [{ id: "dad", name: "Dad", initials: "D", color: "#5e8fad" }] as any;

// The exact reported state: two top-level to-dos, one of them already
// checked off (with a completed sub-to-do under it, as in the screenshot).
const base = {
  userId: "u1", icon: "✅", points: 0, isActive: true, isBonus: false, targetCount: 0,
  taskType: "todo", daysOfWeek: [], recurrenceType: null, endDate: null,
  profileIds: ["dad"], description: null, parentChoreId: null,
};
const todos = [
  { ...base, id: "t1", title: "Fix oven", displayOrder: 0 },
  { ...base, id: "t2", title: "Test", displayOrder: 1 },
  { ...base, id: "t3", title: "Test sub", displayOrder: 2, parentChoreId: "t2" },
] as any;

const completions = [
  { id: "c1", choreId: "t2", profileId: "dad", completedAt: new Date().toISOString(), points: 0 },
  { id: "c2", choreId: "t3", profileId: "dad", completedAt: new Date().toISOString(), points: 0 },
] as any;

export function setup(): void {
  installMockApi(baselineRoutes({
    "/api/profiles": profiles,
    "/api/chores": todos,
    "/api/chore-completions": completions,
  }));
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <TodosView profiles={profiles} selectedProfiles={["dad"]} onAddTodo={() => {}} />
    </QueryClientProvider>
  );
}
