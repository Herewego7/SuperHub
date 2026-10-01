import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { installMockApi, baselineRoutes } from "../mockApi";

export function setup(): void {
  installMockApi(
    baselineRoutes({
      // Recent account age — the baseline default's epoch createdAt would
      // otherwise trip the 14-day-old "feature nudge" bottom sheet, which
      // opens automatically and blocks clicks on the tab-pill row.
      "/api/auth/user": { id: "u1", email: "test@test.com", onboardingCompletedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      "/api/celebrations": [
        {
          id: "cel-1", userId: "u1", name: "Ava", monthDay: "08-30", year: 2015,
          type: "birthday", customLabel: null, profileId: "kid1", profileIds: ["kid1"],
          notes: null, showYear: true, nextOccurrence: "2026-08-30T00:00:00.000Z",
          daysUntil: 8, ageThisYear: 11, giftIdeas: [], photos: [],
        },
      ],
      // Distinct from "/api/celebrations" above — Calendar3View reads this
      // endpoint specifically (a different shape: .start/.end, not
      // nextOccurrence) via use-celebration-events.ts. Without its own
      // explicit override here, "/api/celebrations/calendar?..." matched
      // the shorter "/api/celebrations" override above by substring
      // (mockApi's route matching is longest-path-first, but only among
      // keys that ARE present — this key simply didn't exist before),
      // silently feeding Calendar3View the wrong shape and crashing it the
      // moment the Calendar tab was ever actually opened in a test.
      "/api/celebrations/calendar": [],
      "/api/health-reminder-events?unack=true": [
        { id: "ev1", reminderId: "r1", profileId: "kid1", scheduledAt: new Date().toISOString(), firedAt: new Date().toISOString(), acknowledgedAt: null },
      ],
      "/api/health-reminders?includePaused=true": [
        { id: "r1", profileId: "kid1", title: "Allergy medicine", type: "medication", dose: "1 tsp", isPaused: false },
      ],
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <FamilyHub />
    </QueryClientProvider>
  );
}
