import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ChoresView } from "@/components/chores-view";
import { ConfirmDialogHost } from "@/lib/confirmDialog";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
] as any;

const chore = {
  id: "chore1", userId: "u1", title: "Feed the dog", icon: "🐶", points: 2,
  isActive: true, isBonus: false, targetCount: 0, taskType: "chore",
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6], recurrenceType: null, endDate: null,
  profileIds: ["kid1"], displayOrder: 0, description: null,
};

(window as unknown as { __lastPatchBody?: unknown }).__lastPatchBody = undefined;
(window as unknown as { __lastPatchUrl?: string }).__lastPatchUrl = undefined;
(window as unknown as { __lastSkipBody?: unknown }).__lastSkipBody = undefined;

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/chores": (url: string, opts?: RequestInit) => {
        if (opts?.method === "PATCH") {
          (window as unknown as { __lastPatchBody?: unknown }).__lastPatchBody = JSON.parse(opts.body as string);
          (window as unknown as { __lastPatchUrl?: string }).__lastPatchUrl = url;
          return ok({ ...chore });
        }
        return ok([chore]);
      },
      "/api/chore-completions": [],
      "/api/chore-skips": (_url: string, opts?: RequestInit) => {
        if (opts?.method === "POST") {
          (window as unknown as { __lastSkipBody?: unknown }).__lastSkipBody = JSON.parse(opts.body as string);
          return ok({ id: "skip1" });
        }
        return ok([]);
      },
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <ChoresView selectedProfiles={["kid1"]} profiles={profiles} selectedDate={new Date()} />
      <ConfirmDialogHost />
    </QueryClientProvider>
  );
}
