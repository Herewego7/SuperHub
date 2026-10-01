import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { CreateTaskModal } from "@/components/create-task-modal";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult" },
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
] as any;

(window as unknown as { __lastPostBody?: unknown }).__lastPostBody = undefined;
(window as unknown as { __lastPostUrl?: string }).__lastPostUrl = undefined;

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/chores": (url: string, opts?: RequestInit) => {
        if (opts?.method === "POST") {
          (window as unknown as { __lastPostBody?: unknown }).__lastPostBody = JSON.parse(opts.body as string);
          (window as unknown as { __lastPostUrl?: string }).__lastPostUrl = url;
          return ok({ id: "new-chore" });
        }
        return ok([]);
      },
    }),
  );
}

export function Component() {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={queryClient}>
      <CreateTaskModal open={open} onOpenChange={setOpen} profiles={profiles} selectedProfiles={[]} initialKind="todo" />
    </QueryClientProvider>
  );
}
