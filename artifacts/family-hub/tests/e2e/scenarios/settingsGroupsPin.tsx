import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { SettingsModal } from "@/components/settings-modal";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult" },
  { id: "ava", name: "Ava", initials: "A", color: "#ec4899", role: "child" },
] as any;

const groups = [
  { id: "g1", name: "Grown-ups", icon: "🧑", color: "#6366f1", profileIds: ["dad"], displayOrder: 0 },
  { id: "g2", name: "Kids", icon: "🧒", color: "#ec4899", profileIds: ["ava"], displayOrder: 1 },
  { id: "g3", name: "Everyone", icon: "👥", color: "#22c55e", profileIds: ["dad", "ava"], displayOrder: 2 },
];

export function setup(): void {
  (window as any).__reorderCalls = [];
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/custom-profile-groups": groups,
      // A PIN exists, so changing a profile's role opens the PIN gate.
      "/api/reward-settings": {
        parentPin: "1234", pinGatedFeatures: [], hasParentPin: true,
        redemptionMode: "both", pointsMode: "per_chore", completionBonusPoints: 10,
        centsPerPoint: 8, minCashoutPoints: 80, currencySymbol: "$",
      },
      "/api/custom-profile-groups/reorder": (_url: string, opts?: RequestInit) => {
        try { (window as any).__reorderCalls.push(JSON.parse(String(opts?.body)).orderedIds); } catch {}
        return ok({});
      },
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsModal
        isOpen
        onClose={() => {}}
        profiles={profiles}
        setHiddenTabs={() => {}}
        setDefaultTab={() => {}}
        tabOrder={["home", "calendar", "chores", "todos", "meals"]}
        setTabOrder={() => {}}
        setNavIconsOnly={() => {}}
      />
    </QueryClientProvider>
  );
}
