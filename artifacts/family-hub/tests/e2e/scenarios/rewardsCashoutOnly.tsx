import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { RewardsView } from "@/components/rewards-view";
import { installMockApi, baselineRoutes } from "../mockApi";

const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
] as any;

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/reward-settings": {
        parentPin: null, pinGatedFeatures: [], hasParentPin: false,
        redemptionMode: "cashout_only", pointsMode: "per_chore", completionBonusPoints: 10,
        centsPerPoint: 8, minCashoutPoints: 80, currencySymbol: "$",
      },
      "/api/rewards": [],
      "/api/reward-redemptions": [],
      "/api/wishlist-items": [],
      "/api/wallet/pending": [],
      "/api/points": { points: 94, balance: 94 },
      "/api/wallet/kid1": { availablePoints: 94 },
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <RewardsView selectedProfiles={["kid1"]} profiles={profiles} embedded={false} />
    </QueryClientProvider>
  );
}
