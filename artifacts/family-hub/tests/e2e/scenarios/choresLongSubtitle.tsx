import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ChoresView } from "@/components/chores-view";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Reproduces the reported wrap: one person with BOTH day chores and target
// chores, so the subtitle is the long "N today · N targets this period", and
// a two-digit star count. That combination pushed the streak badge onto its
// own line for that person only.
const profiles = [
  { id: "kid1", name: "Truitt", initials: "T", color: "#38bdf8", role: "child" },
] as any;

const base = {
  userId: "u1", icon: "🧹", points: 2, isActive: true, isBonus: false,
  taskType: "chore", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], recurrenceType: "weekly",
  endDate: null, profileIds: ["kid1"], description: null, parentChoreId: null, targetCount: 0,
};
const chores = [
  ...Array.from({ length: 11 }, (_, i) => ({ ...base, id: "d" + i, title: "Chore " + i, displayOrder: i })),
  { ...base, id: "t1", title: "Practice piano", targetCount: 3, recurrenceType: "weekly", displayOrder: 20 },
  { ...base, id: "t2", title: "Read", targetCount: 4, recurrenceType: "weekly", displayOrder: 21 },
];

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/chores": chores,
      "/api/chore-completions": [],
      "/api/points/kid1": { points: 16, balance: 16 },
      // chores-view reads the streak from /api/streak-freezes/:id (it carries
      // the whole StreakDetails payload), not /api/streaks/:id.
      "/api/streak-freezes/kid1": { streak: 5, weekKey: "2026-W36", hasFreezeThisWeek: false, frozenDates: [], canUseFreezeForYesterday: false },
      "/api/profile-stats": [{ profileId: "kid1", points: 16, streak: 5 }],
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* 330px is what the real card leaves at 390px: the page's own px-3
          plus the Chores card's p-4. The wrap only happens once the header
          is that narrow, so a full-width harness never reproduced it. */}
      <div style={{ width: 330 }}>
        <ChoresView selectedProfiles={["kid1"]} profiles={profiles} selectedDate={new Date()} embedded />
      </div>
    </QueryClientProvider>
  );
}
