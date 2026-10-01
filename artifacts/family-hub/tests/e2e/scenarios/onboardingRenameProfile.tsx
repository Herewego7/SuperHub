import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Regression coverage for the 2026-08-27 fix: onboarding's "Add family
// members" step previously showed newly-added names read-only — no way to
// fix a typo until the whole walkthrough finished and Settings → People was
// reached. This verifies the inline pencil-edit round-trips a real
// PATCH /api/profiles/:id.

let created: { id: string; name: string; initials: string; color: string } | null = null;
let patchedName: string | null = null;

export function setup(): void {
  created = null;
  patchedName = null;
  installMockApi(
    baselineRoutes({
      "/api/profiles": (url, opts) => {
        if (opts?.method === "POST") {
          const body = JSON.parse(String(opts.body));
          created = { id: "new-profile-1", name: body.name, initials: body.initials, color: body.color };
          return ok(created);
        }
        return ok([]);
      },
      "/api/profiles/new-profile-1": (url, opts) => {
        if (opts?.method === "PATCH") {
          const body = JSON.parse(String(opts.body));
          patchedName = body.name;
          return ok({ ...created, ...body });
        }
        return ok(created);
      },
    })
  );
}

export function __getState() {
  return { created, patchedName };
}
(window as unknown as { __onboardingRenameState: () => unknown }).__onboardingRenameState = __getState;

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <OnboardingWizard onSignOut={() => {}} />
    </QueryClientProvider>
  );
}
