import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TodosView } from "@/components/todos-view";
import { ConfirmDialogHost } from "@/lib/confirmDialog";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Creating a sub-to-do "moves down to an empty spot and then moves back up"
// (reported twice, 2026-09-11 and again 2026-09-13). Measured from the second
// recording: the list drops two row-heights and comes back up one over ~330ms,
// which is the optimistic row and the server's row both being on screen.
//
// The POST is deliberately slow so that window has somewhere to happen.
const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
] as any;

const base = {
  userId: "u1", icon: "✅", points: 0, isActive: true, isBonus: false,
  targetCount: 0, taskType: "todo", daysOfWeek: [], recurrenceType: null,
  endDate: null, profileIds: ["kid1"], description: null, parentChoreId: null,
};

const todos: any[] = [
  { ...base, id: "p1", title: "Test", displayOrder: 0 },
  { ...base, id: "k1", title: "Buy", displayOrder: 0, parentChoreId: "p1" },
];

let nextId = 2;

export function setup(): void {
  try { window.localStorage.clear(); } catch { /* private mode */ }
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/chores": async (url: string, opts?: RequestInit) => {
        if (opts?.method === "DELETE") {
          // A real server removes the row AND any children filed under it.
          const id = url.split("/").pop()!;
          for (let i = todos.length - 1; i >= 0; i--) {
            if (todos[i].id === id || todos[i].parentChoreId === id) todos.splice(i, 1);
          }
          return ok({});
        }
        if (opts?.method === "PATCH") return ok({});
        if (opts?.method === "POST") {
          const body = JSON.parse(opts.body as string);
          await new Promise(r => setTimeout(r, 400));
          const row = { ...base, ...body, id: `k${nextId++}`, displayOrder: todos.length };
          todos.push(row);
          return ok(row);
        }
        return ok(todos);
      },
      "/api/chore-completions": [],
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
