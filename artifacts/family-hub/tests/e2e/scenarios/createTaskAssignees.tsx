import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { CreateTaskModal } from "@/components/create-task-modal";
import { installMockApi, baselineRoutes } from "../mockApi";

// A five-person family — the size at which the assignee row wraps and the
// "I can only see three of them" report reproduces.
const profiles = [
  { id: "mom", name: "Mom", initials: "M", color: "#a855f7", role: "adult" },
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult" },
  { id: "kid1", name: "Paisley", initials: "P", color: "#ec4899", role: "child" },
  { id: "kid2", name: "Truitt", initials: "T", color: "#f59e0b", role: "child" },
  { id: "kid3", name: "Jett", initials: "J", color: "#10b981", role: "child" },
] as any;

export function setup(): void {
  installMockApi(baselineRoutes({ "/api/profiles": profiles }));
}

export function Component() {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={queryClient}>
      <CreateTaskModal open={open} onOpenChange={setOpen} profiles={profiles} selectedProfiles={[]} initialKind="todo" />
    </QueryClientProvider>
  );
}
