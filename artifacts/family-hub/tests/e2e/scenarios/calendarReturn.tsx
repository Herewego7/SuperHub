import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { Toaster } from "@/components/ui/toaster";
import { installMockApi, baselineRoutes } from "../mockApi";

// The app shell after a web calendar sign-in. The inbox check never answers,
// so whatever is shown while it runs stays on screen.
export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/auth/user": { id: "u1", email: "test@test.com", onboardingCompletedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      "/api/ingest/scan-status": [],
      "/api/ingest/scan": () => new Promise<Response>(() => {}),
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <FamilyHub />
      <Toaster />
    </QueryClientProvider>
  );
}
