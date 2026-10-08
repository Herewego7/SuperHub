import { installSetupChatBackend, SetupChatHost } from "./setupChatBackend";

// Someone who joined Mike's family with an invite code. The family already
// has people and a saved location; this account has not finished setup.
export function setup(): void {
  installSetupChatBackend({
    user: { id: "u2", email: "sarah@example.com", firstName: "Sarah", lastName: "Lee", displayName: "Sarah Lee", family: { id: "f1", role: "member", isOwner: false } },
    profiles: [
      { id: "mike", name: "Mike", color: "#5E8FAD", initials: "M", role: "adult", email: "mike@example.com" },
      { id: "sarah", name: "Sarah", color: "#E07B6A", initials: "S", role: "adult" },
      { id: "ava", name: "Ava", color: "#6DB98A", initials: "A", role: "child" },
    ],
    location: { city: "Kansas City", state: "MO", country: "United States", timezone: "America/Chicago" },
    inviteRole: "parent",
  });
}

export function Component() {
  return <SetupChatHost forJoiner />;
}
