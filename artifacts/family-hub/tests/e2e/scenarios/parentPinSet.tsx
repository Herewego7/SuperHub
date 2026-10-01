import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ParentPinSettingsSection } from "@/components/settings-modal";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// The same section for a family that ALREADY has a PIN: the "A PIN is set.
// Enter a new 4-digit PIN to change it." sentence is replaced by a lock glyph
// on the label (2026-09-03).

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/reward-settings": {
        redemptionMode: "both", pointsMode: "per_chore", completionBonusPoints: 10,
        centsPerPoint: 10, currencySymbol: "$", minCashoutPoints: 10,
        // null = "never configured" — the family should see the real
        // shipped defaults, not an empty/pin-disabled state.
        pinGatedFeatures: null, hasParentPin: true,
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
