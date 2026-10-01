// Free-trial-then-subscribe (2026-08 launch plan). Same window.open pattern
// already established for the App Store review-page link (reviewPrompt.ts) —
// works on both web (opens a new tab) and the native app (Capacitor lets an
// external https: navigation through to the system browser/App Store app).
export function openManageSubscriptionPage(): void {
  window.open("https://apps.apple.com/account/subscriptions", "_blank");
}
