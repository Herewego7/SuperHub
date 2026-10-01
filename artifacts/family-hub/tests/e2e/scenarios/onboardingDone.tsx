import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Replay mode entered at the Invite step, which is two skips from "You're
// all set!" — the step whose tips list was cut down to the one thing the
// Quick Tour doesn't already animate.
const profiles = [
  { id: "mom", name: "Mom", initials: "M", color: "#f59e0b", role: "adult" },
] as any;

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/onboarding-status": {},
      "/api/family/invites": (_url: string, opts?: RequestInit) => (opts?.method ? ok({ code: "ABC12345" }) : ok([])),
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <OnboardingWizard initialStep="invite" onClose={() => {}} onSignOut={() => {}} />
    </QueryClientProvider>
  );
}
