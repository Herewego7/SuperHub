import { apiRequest, queryClient } from "@/lib/queryClient";

/**
 * Mark an onboarding step "done" wherever it's actually completed — not just
 * from inside the wizard. `RewardsSettingsSection` and the invite form are
 * both shared between onboarding and their permanent home in Settings; a
 * family that skipped a step during setup and later finished it directly in
 * Settings still had it flagged "skipped" forever, since only the wizard's
 * own Continue button ever cleared that. Replaying the walkthrough doesn't
 * fix this either — replay deliberately never re-marks a step "skipped" (see
 * onboarding-wizard.tsx's `skip()`), but it never touches an existing stale
 * "skipped" row either unless that exact step's Continue is pressed again.
 *
 * Safe to call redundantly (e.g. also fires from inside the wizard's own
 * Continue handler) — it's just an idempotent status write.
 */
export function markOnboardingStepDone(step: "profile" | "location" | "rewards" | "invite"): void {
  apiRequest("PATCH", "/api/onboarding-status", { step, action: "done" })
    .catch(() => {})
    .finally(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding-status"] });
    });
}
