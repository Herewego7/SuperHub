import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useParentGate } from "@/lib/parentGate";
import { installMockApi, baselineRoutes } from "../mockApi";

// The gate dialog for a family that has NOT set a Parent PIN. The server
// accepts any (or no) PIN in that case, so the dialog has no field — which is
// what the removed "No PIN set — tap Unlock…" sentence was explaining.
const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child", isChild: true },
] as any;

(window as unknown as { __gateRan?: boolean }).__gateRan = false;

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      // The gate posts here on confirm; with no PIN set the server accepts
      // anything, which is exactly what the dialog's shape now reflects.
      "/api/reward-settings/verify-pin": { ok: true },
      "/api/reward-settings": {
        redemptionMode: "both", pointsMode: "per_chore", completionBonusPoints: 10,
        centsPerPoint: 10, currencySymbol: "$", minCashoutPoints: 10,
        pinGatedFeatures: null, hasParentPin: false,
      },
    }),
  );
}

function Harness() {
  const { guard, gateDialog } = useParentGate(profiles, ["kid1"]);
  return (
    <div style={{ padding: 16 }}>
      <button
        data-testid="do-gated-thing"
        onClick={() => guard("createChore", () => { (window as any).__gateRan = true; })}
      >
        Gated action
      </button>
      {gateDialog}
    </div>
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  );
}
