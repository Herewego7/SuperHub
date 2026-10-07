import { installSetupChatBackend, SetupChatHost } from "./setupChatBackend";

// A brand-new family: no profiles, nothing saved, signed in as the owner.
export function setup(): void {
  installSetupChatBackend();
}

export function Component() {
  return <SetupChatHost />;
}
