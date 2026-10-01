import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { PersonTodoList } from "@/components/todos-view";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

const profile = { id: "p1", name: "Ava", initials: "A", color: "#3b82f6", role: "child" } as any;
const profiles = [profile];

const chores = [
  // A completed parent with two sub-to-dos — the "says it has to-dos under
  // it but doesn't list them" case.
  { id: "t1", title: "Paint the shed", taskType: "todo", profileIds: ["p1"], points: 0, isActive: true, isBonus: false, daysOfWeek: [], displayOrder: 0 },
  { id: "t2", title: "Buy paint", taskType: "todo", profileIds: ["p1"], points: 0, isActive: true, isBonus: false, daysOfWeek: [], displayOrder: 1, parentChoreId: "t1" },
  { id: "t3", title: "Buy brushes", taskType: "todo", profileIds: ["p1"], points: 0, isActive: true, isBonus: false, daysOfWeek: [], displayOrder: 2, parentChoreId: "t1" },
  // Completed 60 days ago — past the drawer's 30-day window.
  { id: "t4", title: "Ancient errand", taskType: "todo", profileIds: ["p1"], points: 0, isActive: true, isBonus: false, daysOfWeek: [], displayOrder: 3 },
];

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

const completions = [
  { id: "c1", choreId: "t1", profileId: "p1", completedAt: daysAgo(2), points: 0 },
  { id: "c2", choreId: "t2", profileId: "p1", completedAt: daysAgo(2), points: 0 },
  { id: "c4", choreId: "t4", profileId: "p1", completedAt: daysAgo(60), points: 0 },
];

(window as unknown as { __lastDeleteUrl?: string }).__lastDeleteUrl = undefined;

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/chores": chores,
      "/api/chore-completions": (url: string, opts?: RequestInit) => {
        if (opts?.method === "DELETE") {
          (window as unknown as { __lastDeleteUrl?: string }).__lastDeleteUrl = url;
          return ok({});
        }
        return ok(completions);
      },
    }),
  );
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
