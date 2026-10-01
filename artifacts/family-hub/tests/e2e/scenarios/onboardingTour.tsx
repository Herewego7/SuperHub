import { OnboardingTour } from "@/components/onboarding-tour";

// Regression coverage for the 2026-08-27 rebuild: the Quick Tour's demo
// frames previously showed no tab bar at all (just a family-bar + card
// content, reading as a cropped fragment rather than the real app) and
// carried far more text than needed, including outdated "To-Dos is off by
// default, turn it on in Settings" copy now that To-Dos ships on by default.

export function setup(): void {}

export function Component() {
  return (
    <div style={{ padding: 16, maxWidth: 400, margin: "0 auto" }}>
      <OnboardingTour onDone={() => {}} />
    </div>
  );
}
