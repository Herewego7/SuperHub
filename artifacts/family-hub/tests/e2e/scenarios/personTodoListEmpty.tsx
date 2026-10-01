import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { PersonTodoList } from "@/components/todos-view";
import { installMockApi, baselineRoutes } from "../mockApi";

// Two people, embedded the way Home's Tasks card does it: one with nothing at
// all, and one whose to-dos are ALL old completions. The second is the case
// that used to slip through — completed to-dos are permanent records but stop
// being displayed after the day they were finished, so the section had rows in
// its data and nothing to render from them.
const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
  { id: "kid2", name: "Leo", initials: "L", color: "#3b82f6", role: "child" },
] as any;

const longAgo = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString();
const oldTodo = {
  id: "t-old", title: "Pack for camp", taskType: "todo", isActive: true,
  profileIds: ["kid2"], daysOfWeek: [], points: 0, displayOrder: 0,
};

export function setup(): void {
  installMockApi(baselineRoutes({
    "/api/profiles": profiles,
    "/api/chores": [oldTodo],
    "/api/chore-completions": [
      { id: "c-old", choreId: "t-old", profileId: "kid2", completedAt: longAgo, points: 0 },
    ],
  }));
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ padding: 12, maxWidth: 420 }} data-testid="empty-person">
        <PersonTodoList profile={profiles[0]} allProfiles={profiles} embedded hideDone />
      </div>
      <div style={{ padding: 12, maxWidth: 420 }} data-testid="old-completions-person">
        <PersonTodoList profile={profiles[1]} allProfiles={profiles} embedded hideDone />
      </div>
    </QueryClientProvider>
  );
}
