import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TodosView } from "@/components/todos-view";
import { ConfirmDialogHost } from "@/lib/confirmDialog";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// The shape from the 2026-09-12 report: TWO top-level to-dos, one of which has
// a single sub-to-do. Ticking one top-level and the sub must NOT celebrate —
// the other top-level is still visibly open.
const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
] as any;

const base = {
  userId: "u1", icon: "✅", points: 0, isActive: true, isBonus: false,
  targetCount: 0, taskType: "todo", daysOfWeek: [], recurrenceType: null,
  endDate: null, profileIds: ["kid1"], description: null, parentChoreId: null,
};

const todos = [
  { ...base, id: "m1", title: "Pack bag", displayOrder: 0 },
  { ...base, id: "m2", title: "Homework", displayOrder: 1 },
  { ...base, id: "s1", title: "Maths page", displayOrder: 0, parentChoreId: "m2" },
];

const completions: any[] = [];

export function setup(): void {
  try { window.localStorage.clear(); } catch { /* private mode */ }
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/chores": () => ok(todos),
      "/api/chore-completions": (_url: string, opts?: RequestInit) => {
        if (opts?.method === "POST") {
          const body = JSON.parse(opts.body as string);
          const row = { id: "c" + (completions.length + 1), choreId: body.choreId, profileId: body.profileId, points: 0, completedAt: new Date().toISOString() };
          completions.push(row);
          return ok(row);
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
