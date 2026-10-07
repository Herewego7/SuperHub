import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Home's to-do list with a server that takes 2.5 seconds to save. A tick that
// waits for the save shows up late here; one drawn first shows at once.
const SAVE_MS = 2500;

const base = {
  userId: "u1", icon: "✅", points: 0, isActive: true, isBonus: false,
  targetCount: 0, taskType: "todo", daysOfWeek: [], recurrenceType: null,
  endDate: null, profileIds: [], description: null, parentChoreId: null,
};

const todos = [
  { ...base, id: "t1", title: "Return library books", displayOrder: 0 },
  { ...base, id: "t2", title: "Call the dentist", displayOrder: 1 },
];

let completions: { id: string; choreId: string; profileId: string; points: number; completedAt: string }[] = [];

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/auth/user": { id: "u1", email: "test@test.com", onboardingCompletedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      "/api/chores": () => ok(todos),
      "/api/chore-completions": async (url: string, opts?: RequestInit) => {
        if (opts?.method === "POST") {
          await new Promise((resolve) => setTimeout(resolve, SAVE_MS));
          const body = JSON.parse(opts.body as string);
          const row = { id: `c${completions.length + 1}`, choreId: body.choreId, profileId: body.profileId, points: 0, completedAt: new Date().toISOString() };
          completions.push(row);
          return ok(row);
        }
        if (opts?.method === "DELETE") {
          await new Promise((resolve) => setTimeout(resolve, SAVE_MS));
          const [choreId, profileId] = new URL(url, window.location.origin).pathname.split("/").slice(-2);
          completions = completions.filter((row) => !(row.choreId === choreId && row.profileId === profileId));
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
      <FamilyHub />
    </QueryClientProvider>
  );
}
