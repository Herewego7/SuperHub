import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { HistoryView } from "@/components/history-view";
import { installMockApi, baselineRoutes } from "../mockApi";

// Covers the 2026-08 audit's ACT-2: bonus-chore completions used to be
// indistinguishable from regular ones in Family Activity (both are
// activityType "chore_complete"; only metadata.isBonus separates them).
const profiles = [{ id: "ava", name: "Ava", initials: "A", color: "#ef4444" }] as any;
const now = new Date().toISOString();

export function setup(): void {
  installMockApi(baselineRoutes({
    "/api/profiles": profiles,
    "/api/activity-log": [
      { id: "e1", activityType: "chore_complete", profileId: "ava", profileName: "Ava",
        description: "Completed Make bed", entityTitle: "Make bed", timestamp: now,
        metadata: { isBonus: false } },
      { id: "e2", activityType: "chore_complete", profileId: "ava", profileName: "Ava",
        description: "Completed Clean the garage", entityTitle: "Clean the garage", timestamp: now,
        metadata: { isBonus: true } },
      { id: "e3", activityType: "cashout_requested", profileId: "ava", profileName: "Ava",
        description: "Requested a cash-out", timestamp: now, metadata: {} },
    ],
  }));
}

export function Component() {
  const [open] = useState(true);
  return (
    <QueryClientProvider client={queryClient}>
      <HistoryView open={open} onClose={() => {}} profiles={profiles} />
    </QueryClientProvider>
  );
}
