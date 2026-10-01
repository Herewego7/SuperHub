import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ParentPinSettingsSection } from "@/components/settings-modal";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Regression coverage for the 2026-08-27 change: the "Lock behind the
// Parent PIN" checklist is now split into a "Recommended" group (checked by
// default: chores, bonus chores, rewards, calendar settings) and a "more
// secure" group (unchecked by default: to-dos, opening Settings) — rather
// than one flat, uniformly-unlabeled list.

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/reward-settings": {
        redemptionMode: "both", pointsMode: "per_chore", completionBonusPoints: 10,
        centsPerPoint: 10, currencySymbol: "$", minCashoutPoints: 10,
        // null = "never configured" — the family should see the real
        // shipped defaults, not an empty/pin-disabled state.
        pinGatedFeatures: null, hasParentPin: false,
      },
    })
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ padding: 16, maxWidth: 480 }}>
        <ParentPinSettingsSection />
      </div>
    </QueryClientProvider>
  );
}
