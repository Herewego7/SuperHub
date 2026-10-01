import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { BonusChoresView } from "@/components/bonus-chores-view";
import { ConfirmDialogHost } from "@/lib/confirmDialog";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// The shape from the 2026-09-11 screenshot: a claimed bonus chore, so the
// "<name> completed <when>" line renders in the narrow column left between the
// star box and the Claim button.
const profiles = [
  { id: "kid1", name: "Paisley", initials: "P", color: "#ec4899", role: "child" },
] as any;

const bonusChores = [
  {
    id: "b1", userId: "u1", title: "Hang up 🎒", icon: "🎒", points: 1,
    isActive: true, isBonus: true, targetCount: 0, taskType: "chore",
    daysOfWeek: [], recurrenceType: null, endDate: null, profileIds: [],
    displayOrder: 0, description: null,
  },
  {
    id: "b2", userId: "u1", title: "Mate 5 socks", icon: "🧦", points: 2,
    isActive: true, isBonus: true, targetCount: 0, taskType: "chore",
    daysOfWeek: [], recurrenceType: null, endDate: null, profileIds: [],
    displayOrder: 1, description: null,
  },
];

// Yesterday at 6:18 PM — the exact string in the report, and the longest the
// line ever gets (today/yesterday spell out a time; older dates are "Sep 4").
const yesterday = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(18, 18, 0, 0);
  return d.toISOString();
})();

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/chores": () => ok(bonusChores),
      "/api/chore-completions": () => ok([
        { id: "c1", choreId: "b1", profileId: "kid1", points: 1, completedAt: yesterday },
      ]),
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <BonusChoresView profiles={profiles} selectedProfiles={[]} />
      <ConfirmDialogHost />
    </QueryClientProvider>
  );
}
