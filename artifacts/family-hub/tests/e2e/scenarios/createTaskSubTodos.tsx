import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { CreateTaskModal } from "@/components/create-task-modal";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult" },
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
] as any;

type Post = { title: string; parentChoreId?: string; profileIds: string[] };
(window as unknown as { __posts?: Post[] }).__posts = [];

export function setup(): void {
  let n = 0;
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/chores": (_url: string, opts?: RequestInit) => {
        if (opts?.method === "POST") {
          const body = JSON.parse(opts.body as string);
          (window as unknown as { __posts?: Post[] }).__posts!.push(body);
          return ok({ id: `chore-${++n}` });
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
