import { installSetupChatBackend, SetupChatHost } from "./setupChatBackend";

// A new family that closed the app partway through: the saved session is at
// the Parent PIN question, and the people and location are already saved.
export function setup(): void {
  installSetupChatBackend({
    profiles: [{ id: "chad", name: "Chad", color: "#5E8FAD", initials: "C", role: "adult", email: "chad@example.com" }],
    location: { city: "Kansas City", state: "MO", country: "United States", timezone: "America/Chicago" },
    session: {
      version: 1,
      mode: "fresh",
      state: {
        version: 1,
        mode: "fresh",
        q: "pin-ask",
        transcript: [
          { kind: "me", text: "Stars for each chore" },
          { kind: "bot", text: "Saved. Kids earn stars for each chore." },
          { kind: "bot", text: "Want a Parent PIN? It keeps kids from changing chores, rewards and calendar settings." },
        ],
        meId: "chad",
        created: [],
        edits: {},
        pendingNames: [],
        codes: [],
      },
    },
  });
}

export function Component() {
  return <SetupChatHost />;
}
