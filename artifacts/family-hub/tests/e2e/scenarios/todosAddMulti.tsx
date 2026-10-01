import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TodosView } from "@/components/todos-view";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
  { id: "kid2", name: "Leo", initials: "L", color: "#3b82f6", role: "child" },
] as any;

(window as unknown as { __addTodoClicks?: number }).__addTodoClicks = 0;

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/chores": (_url: string, opts?: RequestInit) => (opts?.method ? ok({}) : ok([])),
      "/api/chore-completions": [],
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <TodosView
        profiles={profiles}
        selectedProfiles={[]}
        onAddTodo={() => {
          const w = window as unknown as { __addTodoClicks?: number };
          w.__addTodoClicks = (w.__addTodoClicks ?? 0) + 1;
        }}
      />
    </QueryClientProvider>
  );
}
