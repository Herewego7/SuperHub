import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { PersonTodoList } from "@/components/todos-view";
import { installMockApi, baselineRoutes } from "../mockApi";

const profile = { id: "p1", name: "Ava", initials: "A", color: "#3b82f6", isChild: false, role: "child" } as any;
const profiles = [profile, { id: "p2", name: "Mom", initials: "M", color: "#ef4444", role: "adult" } as any];

const chores = [
  { id: "t1", title: "Clean room", taskType: "todo", profileIds: ["p1"], points: 0, isActive: true, isBonus: false, daysOfWeek: [], displayOrder: 0 },
  { id: "t2", title: "Buy paint", taskType: "todo", profileIds: ["p1"], points: 0, isActive: true, isBonus: false, daysOfWeek: [], displayOrder: 1, parentChoreId: "t1" },
  { id: "t3", title: "Buy brushes", taskType: "todo", profileIds: ["p1"], points: 0, isActive: true, isBonus: false, daysOfWeek: [], displayOrder: 2, parentChoreId: "t1" },
];

export function setup(): void {
  installMockApi(baselineRoutes({ "/api/chores": chores, "/api/chore-completions": [] }));
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ maxWidth: 420, margin: "20px auto" }} className="hearth-theme">
        <PersonTodoList profile={profile} allProfiles={profiles} />
      </div>
    </QueryClientProvider>
  );
}
