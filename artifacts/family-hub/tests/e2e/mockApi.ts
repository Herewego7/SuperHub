// Shared fetch-mocking helper for E2E scenarios. Each scenario calls
// `installMockApi({...overrides})` to stand up a fake backend before
// rendering — this is the same pattern used throughout the 2026-08 session's
// ad hoc verification harnesses, just persisted here so it's reusable.
export function ok(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

export type RouteHandler = (url: string, opts: RequestInit | undefined) => Response | Promise<Response>;

/** A baseline set of routes that satisfy every query the app's shell
 * (FamilyHub, HomeView, etc.) fires on mount, so a scenario only needs to
 * override the handful of routes it actually cares about. */
export function baselineRoutes(overrides: Record<string, RouteHandler | unknown> = {}): RouteHandler {
  const defaults: Record<string, unknown> = {
    "/api/profiles": [
      { id: "all", name: "All Family", isAllFamilyProfile: true, initials: "AF", color: "#888" },
      { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult" },
      { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
    ],
    "/api/chores": [],
    "/api/chore-completions": [],
    "/api/events": [],
    "/api/celebrations": [],
    "/api/health-reminders": [],
    "/api/health-reminder-events": [],
    "/api/reward-settings": {
      parentPin: null, pinGatedFeatures: [], hasParentPin: false,
      redemptionMode: "both", pointsMode: "per_chore", completionBonusPoints: 10,
      centsPerPoint: 8, minCashoutPoints: 80, currencySymbol: "$",
    },
    "/api/reward-redemptions": [],
    "/api/rewards": [],
    "/api/family": { family: { name: "Test Family" }, members: [] },
    "/api/onboarding-status": {},
    "/api/location-settings": null,
    "/api/family/invites": [],
    "/api/shoutouts": [],
    "/api/wishlist-items": [],
    "/api/wallet/pending": [],
    "/api/daily-content": [],
    "/api/achievements": [],
    "/api/streaks": { streak: 0 },
    "/api/streak-freezes": {},
    "/api/points": { points: 0, balance: 0 },
    "/api/auth/user": { id: "u1", email: "test@test.com", onboardingCompletedAt: new Date(0).toISOString(), createdAt: new Date(0).toISOString() },
    "/api/family/my-invite-role": { role: null },
    "/api/weather": { temperature: 70, high: 80, low: 60, condition: "clear" },
  };
  const merged: Record<string, unknown> = { ...defaults, ...overrides };
  // Longest path first, so a specific override (e.g. "/api/shoutouts/") is
  // checked before a more generic default that would otherwise shadow it
  // (e.g. "/api/shoutouts" is a substring of every shoutouts-related URL,
  // including the dismiss/seen endpoint — insertion order alone isn't
  // reliable since object key order only reflects who registered first, not
  // which path is more specific).
  const entries = Object.entries(merged).sort((a, b) => b[0].length - a[0].length);
  return (url: string, opts?: RequestInit) => {
    for (const [path, handler] of entries) {
      if (!url.includes(path)) continue;
      if (typeof handler === "function") return (handler as RouteHandler)(url, opts);
      return ok(handler);
    }
    return ok([]);
  };
}

/** Installs a route handler as `window.fetch`. Call once per scenario. */
export function installMockApi(handler: RouteHandler): void {
  (window as unknown as { fetch: RouteHandler }).fetch = handler;
}
