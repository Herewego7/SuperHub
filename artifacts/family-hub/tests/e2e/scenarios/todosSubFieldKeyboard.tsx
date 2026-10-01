import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TodosView } from "@/components/todos-view";
import { ConfirmDialogHost } from "@/lib/confirmDialog";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// "Add a to-do under this" opens a field that the software keyboard then
// covers (reported 2026-09-14 with a recording). Enough rows here that the
// LAST one's button — the one in the recording — sits at the bottom of the
// list, which is where the field has nowhere to go but under the keyboard.
const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
] as any;

const base = {
  userId: "u1", icon: "✅", points: 0, isActive: true, isBonus: false,
  targetCount: 0, taskType: "todo", daysOfWeek: [], recurrenceType: null,
  endDate: null, profileIds: ["kid1"], description: null, parentChoreId: null,
};

const titles = [
  "Water the plants", "Fold laundry", "Sort recycling", "Replace air filter",
  "Return library books", "Wash the car", "Call the dentist",
  "Bring books to Little library",
  "Hangers for clothes in office",
  "Clean out aerogarden",
  "Pics of Nays headlights for Warranty",
  "Test",
];
const todos: any[] = titles.map((title, i) => ({ ...base, id: `p${i + 1}`, title, displayOrder: i }));

export function setup(): void {
  try { window.localStorage.clear(); } catch { /* private mode */ }
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/chores": async (_url: string, opts?: RequestInit) => {
        if (opts?.method === "POST") {
          const body = JSON.parse(opts.body as string);
          const row = { ...base, ...body, id: `n${todos.length}`, displayOrder: todos.length };
          todos.push(row);
          return ok(row);
        }
        if (opts?.method === "PATCH" || opts?.method === "DELETE") return ok({});
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
