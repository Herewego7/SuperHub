import { installSetupChatBackend, SetupChatHost } from "./setupChatBackend";

// Replaying setup from the Invite chapter (Settings' "Replay setup
// walkthrough" or an Announcements "Finish now" card), for a family that
// finished setup long ago.
export function setup(): void {
  installSetupChatBackend({
    user: { onboardingCompletedAt: new Date(0).toISOString() },
    profiles: [{ id: "chad", name: "Chad", color: "#5E8FAD", initials: "C", role: "adult", email: "chad@example.com" }],
    location: { city: "Kansas City", state: "MO", country: "United States", timezone: "America/Chicago" },
  });
}

export function Component() {
  return <SetupChatHost initialStep="invite" />;
}
