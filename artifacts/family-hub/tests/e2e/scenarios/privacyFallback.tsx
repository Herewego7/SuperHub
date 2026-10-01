import { PrivacyScreen } from "@/components/privacy-screen";

// 2026-09-30: the default background failed to load and the privacy screen
// opened on an error, though every other picture worked. Nothing is stored,
// so the library's first picture is the choice; the test makes that one fail.
export function setup(): void {
  try { localStorage.removeItem("familyHub_privacyImageUrl"); } catch { /* */ }
}

export function Component() {
  return <PrivacyScreen visible onDismiss={() => {}} />;
}
