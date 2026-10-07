import { apiRequest, queryClient } from "@/lib/queryClient";

/**
 * Mark an onboarding step "done" wherever it's actually completed — not just
 * from inside setup. `RewardsSettingsSection` and the invite form live in
 * Settings too; a family that skipped a step during setup and later finished
 * it directly in Settings still had it flagged "skipped" forever, since only
 * setup itself ever cleared that. Replaying setup doesn't fix this either — a
 * replay never marks a step "skipped" (see `finishChapter` in
 * lib/setupChat/script.ts), and it clears a stale "skipped" row only when that
 * chapter is finished again.
 *
 * Safe to call redundantly (the setup chat writes the same status) — it's
 * just an idempotent status write.
 */
export function markOnboardingStepDone(step: "profile" | "location" | "rewards" | "invite"): void {
  apiRequest("PATCH", "/api/onboarding-status", { step, action: "done" })
    .catch(() => {})
    .finally(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding-status"] });
    });
}
