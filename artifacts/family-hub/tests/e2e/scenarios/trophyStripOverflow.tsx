import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TrophyCaseView } from "@/components/trophy-case-view";
import { installMockApi, baselineRoutes } from "../mockApi";

// Two people so the view renders its all-family SUMMARY (the capped strip),
// not one person's full detail grid.
const profiles = [
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444" },
  { id: "kid2", name: "Leo", initials: "L", color: "#3b82f6" },
] as any;

// Every trophy type in the app, earned by Ava — far more than three rows'
// worth at a phone width, which is the case the cap exists for.
const TYPES = [
  "streak_3", "streak_7", "streak_14", "streak_30", "streak_60", "streak_90",
  "streak_180", "streak_365",
  "first_chore", "chores_10", "chores_25", "chores_50", "chores_100",
  "chores_200", "chores_500", "chores_1000",
  "points_100", "star_250", "star_400", "star_450", "points_500", "star_750",
  "points_1000", "star_1250", "star_1500", "star_1750", "star_2000",
];

const achievements = TYPES.map((type, i) => ({
  id: `a${i}`, profileId: "kid1", type,
  title: type, description: type, earnedAt: new Date().toISOString(),
}));

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/achievements": achievements,
      "/api/chore-completions": [],
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ width: 340 }}>
        <TrophyCaseView selectedProfiles={[]} profiles={profiles} embedded onSelectProfile={() => {}} />
      </div>
    </QueryClientProvider>
  );
}
