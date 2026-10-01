import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { installMockApi, baselineRoutes } from "../mockApi";
import { setPendingTabDeepLink } from "@/lib/pushDeepLink";

// The 2026-09-14 report: a medication push opened Home and spotlighted
// nothing, on a build that already carried three rounds of spotlight fixes.
// notification, it brought me to the home page, but not to the medication info
// and it didn't spotlight anything" — while the birthday and cash-out pushes
// worked.
//
// The reproduction is the DELAY, not the deep link. HealthReminderInbox
// returns null until /api/health-reminder-events?unack=true resolves, and
// tapping a push cold-launches the app, so the card genuinely isn't in the DOM
// when the deep-link handler runs. Both spotlight() and robustScrollIntoView()
// used to give up silently on a missing element, so the whole thing no-opped.
// This mock holds that one endpoint for 2.5s — far longer than the old fixed
// 200ms timeout, comfortably inside the new wait — while every other route
// answers immediately, exactly like a real cold launch.

const HOLD_MS = 600;

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/auth/user": {
        id: "u1",
        email: "test@test.com",
        onboardingCompletedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      "/api/profiles": [
        { id: "all", name: "All Family", isAllFamilyProfile: true, initials: "AF", color: "#888" },
        { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult" },
        { id: "kid", name: "Paisley", initials: "P", color: "#ec4899", role: "child" },
      ],
      "/api/health-reminders": [
        { id: "hr1", profileId: "kid", title: "Blood pressure pill", type: "medication", dose: "1 tablet", location: null, notes: null, isActive: true, snoozeMinutes: 15, scheduleJson: { kind: "daily", time: "09:00" } },
      ],
      "/api/health-reminder-events": async () => {
        await new Promise((r) => setTimeout(r, HOLD_MS));
        return new Response(
          JSON.stringify([
            { id: "ev1", reminderId: "hr1", profileId: "kid", status: "fired", firedAt: new Date().toISOString(), snoozeUntil: null },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    }),
  );

  // The push tap itself, via the real web click-through path: the scheduler
  // sends `url: "/?openTab=home&openAction=healthReminders"`, and
  // consumeTabDeepLinkFromUrl() reads it off the URL on mount. (The native
  // path dispatches a CustomEvent instead — no good here, since a synchronous
  // dispatch before React mounts has no listener yet.)
  // The NATIVE path, in its real cold-launch order: iOS delivers the tap as
  // the app starts, so nativeNotifications.ts calls setPendingTabDeepLink
  // BEFORE React has mounted and subscribed. Dispatching here — from setup(),
  // which runs before the component renders — reproduces exactly that.
  setPendingTabDeepLink({ tab: "home", action: "healthReminders", profileId: "kid" });
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <FamilyHub />
    </QueryClientProvider>
  );
}
