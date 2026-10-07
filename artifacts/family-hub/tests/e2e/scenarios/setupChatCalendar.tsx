import { installSetupChatBackend, SetupChatHost } from "./setupChatBackend";

// Replaying setup from the Calendars chapter, which embeds Settings' own
// Calendar Connections list.
export function setup(): void {
  installSetupChatBackend({
    user: { onboardingCompletedAt: new Date(0).toISOString() },
    profiles: [{ id: "mike", name: "Mike", color: "#5E8FAD", initials: "M", role: "adult", email: "chad@example.com" }],
    location: { city: "Kansas City", state: "MO", country: "United States", timezone: "America/Chicago" },
  });
}

export function Component() {
  return <SetupChatHost initialStep="calendar" />;
}
