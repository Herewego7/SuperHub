// The parts of first-run setup that can each be skipped and picked up later.
// The Announcements "Finish setting up" reminders, Home and the setup chat all
// key off these names, and the server stores them under STEP_TO_ONBOARDING_KEY.
export const SKIPPABLE_STEPS = ["you", "location", "calendar", "rewards", "invite"] as const;
export type SkippableStep = (typeof SKIPPABLE_STEPS)[number];

export const STEP_TO_ONBOARDING_KEY: Record<SkippableStep, "profile" | "location" | "calendar" | "rewards" | "invite"> = {
  you: "profile",
  location: "location",
  calendar: "calendar",
  rewards: "rewards",
  invite: "invite",
};
