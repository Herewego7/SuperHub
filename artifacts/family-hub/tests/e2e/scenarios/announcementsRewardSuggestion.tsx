import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AnnouncementsBanner } from "@/components/announcements-banner";
import { installMockApi, baselineRoutes } from "../mockApi";

const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6" },
  { id: "paisley", name: "Paisley", initials: "P", color: "#ef4444" },
] as any;

// One pending reward SUGGESTION (a wishlist item) and one pending CASH-OUT —
// two different queues that used to share a single "Cash-Out Approvals" link.
export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/wishlist-items": [
        { id: "w1", title: "New Lego set", status: "pending", submittedByProfileId: "paisley", suggestedPriceCoins: 50 },
      ],
      "/api/wallet/pending": [
        { id: "c1", profileId: "paisley", points: 20, cents: 200, status: "pending", createdAt: new Date().toISOString() },
      ],
    }),
  );
}

export function Component() {
  const [clicked, setClicked] = useState<string[]>([]);
  return (
    <QueryClientProvider client={queryClient}>
      <div data-testid="clicked">{clicked.join(",")}</div>
      <AnnouncementsBanner
        selectedProfiles={["dad"]}
        profiles={profiles}
        onNavigateToParentControls={() => setClicked((c) => [...c, "cashout"])}
        onNavigateToRewardSuggestions={() => setClicked((c) => [...c, "suggestions"])}
      />
    </QueryClientProvider>
  );
}
