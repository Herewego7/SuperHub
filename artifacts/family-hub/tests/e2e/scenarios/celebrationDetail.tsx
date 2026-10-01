import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { CelebrationDetailDialog } from "@/components/celebrations-view";
import { Toaster } from "@/components/ui/toaster";
import { installMockApi, baselineRoutes } from "../mockApi";

const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
] as any;

const celebration = {
  id: "c1", name: "Ava", type: "birthday", month: 8, day: 30, year: 2015,
  profileId: "kid1", profileIds: ["kid1"], notes: "", daysUntil: 8,
  ageThisYear: 11, showYear: true, nextOccurrence: new Date("2026-08-30T00:00:00Z").toISOString(),
  giftIdeas: [], photos: [],
} as any;

(window as unknown as { __closed?: boolean }).__closed = false;

export function setup(): void {
  installMockApi(baselineRoutes({ "/api/profiles": profiles }));
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <CelebrationDetailDialog
        celebration={celebration}
        onClose={() => { (window as any).__closed = true; }}
        onEdit={() => {}}
      />
      <Toaster />
    </QueryClientProvider>
  );
}
