import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Stateful fake /api/events backend — reproduces the real create→edit→
// re-edit lifecycle the user actually walked through (create a 12pm-1pm
// event, check All Day + save, uncheck + save again), so a bug anywhere in
// that real round trip (submission, cache merge, or day-bucket display
// logic) would show up here exactly as it would against the real backend.
let store: any[] = [];
(window as any).__eventStore = () => store;

function eventsHandler(url: string, opts?: RequestInit) {
  const method = (opts?.method ?? "GET").toUpperCase();
  if (/\/api\/events\/[^/?]+$/.test(url)) {
    const id = url.split("/api/events/")[1].split("?")[0];
    if (method === "PATCH") {
      const body = JSON.parse((opts!.body as string) ?? "{}");
      const idx = store.findIndex((e) => e.id === id);
      if (idx >= 0) store[idx] = { ...store[idx], ...body };
      return ok(store[idx]);
    }
    if (method === "DELETE") {
      store = store.filter((e) => e.id !== id);
      return ok({});
    }
  }
  if (method === "POST") {
    const body = JSON.parse((opts!.body as string) ?? "{}");
    const event = { ...body, id: `ev${store.length + 1}` };
    store.push(event);
    return ok(event);
  }
  return ok(store);
}

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/auth/user": { id: "u1", email: "test@test.com", onboardingCompletedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      "/api/celebrations/calendar": [],
      "/api/events": eventsHandler,
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
