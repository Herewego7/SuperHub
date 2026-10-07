import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Praise and a family note on Home's Completed Actions, and the Home tab's
// badge. Praise is stateful: a POST to .../seen marks it seen on the next
// read, so a test can watch the badge clear. Every such POST is recorded on
// window.__seenPosts, in order.

const HOUR = 3_600_000;

export function setup(): void {
  const now = Date.now();
  const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR).toISOString();
  const seen = new Set<string>();
  const posts: string[] = [];
  (window as unknown as { __seenPosts: string[] }).__seenPosts = posts;

  const praise = [
    { id: "p-new", fromProfileId: "dad", toProfileId: "kid1", emoji: "🌟", message: "Great job on the dishes", createdAt: at(1) },
    { id: "p-dad", fromProfileId: "kid1", toProfileId: "dad", emoji: "🥞", message: "Thanks for the pancakes", createdAt: at(2) },
    { id: "p-old", fromProfileId: "dad", toProfileId: "kid1", emoji: "📚", message: "Nice reading", createdAt: at(72) },
    // Older than Completed Actions' seven days, so Home never shows it and the
    // badge must not count it.
    { id: "p-stale", fromProfileId: "dad", toProfileId: "kid1", emoji: "🎨", message: "Lovely painting", createdAt: at(240) },
  ];

  installMockApi(
    baselineRoutes({
      // A new account: at 14 days old the Quick wins sheet opens over the app.
      "/api/auth/user": { id: "u1", email: "test@test.com", onboardingCompletedAt: new Date(now).toISOString(), createdAt: new Date(now).toISOString() },
      "/api/shoutouts/": (url, opts) => {
        const id = url.match(/\/api\/shoutouts\/([^/?]+)\/seen/)?.[1];
        if (id && opts?.method === "POST") {
          posts.push(id);
          seen.add(id);
        }
        return ok({});
      },
      "/api/shoutouts": () =>
        ok(praise.map((p) => ({ ...p, seenAt: seen.has(p.id) ? new Date().toISOString() : null }))),
      "/api/daily-content": [
        { id: "n-1", type: "note", title: "Note", content: "Dentist moved to Thursday", reference: "dad", isActive: true, createdAt: at(0.5) },
      ],
      "/api/daily-content-assignments": [{ id: "a-1", contentId: "n-1", profileId: "all" }],
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
