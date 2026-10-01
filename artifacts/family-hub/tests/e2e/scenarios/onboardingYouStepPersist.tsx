import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { ConfirmDialogHost } from "@/lib/confirmDialog";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Regression coverage for the 2026-08-27 fix: the "Which one is you?" step's
// email/photo fields used to reset to blank every time the step remounted
// (e.g. pressing Back after Continue) — nothing re-read what had already
// been PATCHed to the server. A stateful fake /api/profiles backend is
// needed here (unlike onboardingRenameProfile.tsx's simpler one) since the
// fix specifically depends on a follow-up GET reflecting an earlier PATCH.

interface FakeProfile {
  id: string;
  name: string;
  color: string;
  initials: string;
  role?: string;
  email: string | null;
  photoUrl: string | null;
}

let profiles: FakeProfile[] = [];
let nextId = 1;

export function setup(): void {
  profiles = [];
  nextId = 1;
  installMockApi(
    baselineRoutes({
      "/api/profiles": (url, opts) => {
        const idMatch = /\/api\/profiles\/([^/?]+)/.exec(url);
        if (idMatch) {
          const id = idMatch[1];
          const p = profiles.find((x) => x.id === id);
          if (opts?.method === "PATCH" && p) {
            Object.assign(p, JSON.parse(String(opts.body)));
            return ok(p);
          }
          return ok(p ?? {});
        }
        if (opts?.method === "POST") {
          const body = JSON.parse(String(opts.body));
          const p: FakeProfile = {
            id: `p${nextId++}`,
            name: body.name,
            color: body.color,
            initials: body.initials,
            role: body.role,
            email: null,
            photoUrl: body.photoUrl ?? null,
          };
          profiles.push(p);
          return ok(p);
        }
        return ok(profiles);
      },
    })
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <OnboardingWizard onSignOut={() => {}} />
      <ConfirmDialogHost />
    </QueryClientProvider>
  );
}
