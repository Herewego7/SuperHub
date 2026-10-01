import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AnnouncementsBanner } from "@/components/announcements-banner";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Regression coverage for the 2026-08-27 "old announcements flash on login"
// bug: onboarding_status already loads with the "rewards" step marked
// skipped, but the family has ALREADY set a Parent PIN (the real, current
// data source this section is supposed to defer to) — the /api/reward-settings
// request that would reveal that just resolves slower than
// /api/onboarding-status does. Before the fix, "Set up Rewards & Approvals"
// briefly showed in Finish Setting Up before vanishing once reward-settings
// caught up. After the fix, it should never appear at all.

const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6" },
] as any;

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/onboarding-status": {
        rewardsStatus: "skipped",
        rewardsDismissedUntil: null,
      },
      // Deliberately slow — resolves well after onboarding-status does, so a
      // test can catch the item mid-flash if the race still exists.
      "/api/reward-settings": async () => {
        await new Promise((r) => setTimeout(r, 1500));
        return ok({ hasParentPin: true, pinGatedFeatures: [] });
      },
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <AnnouncementsBanner selectedProfiles={["dad"]} profiles={profiles} />
    </QueryClientProvider>
  );
}
