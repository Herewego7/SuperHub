import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration for the Family Hub iOS app.
 *
 * The web app (this package) is the single source of truth — Capacitor wraps the
 * production web build in a native iOS shell. Build the web assets with
 * `pnpm run build:mobile` (which sets BASE_PATH=/ so assets resolve from the
 * webview root) and then `pnpm run cap:sync`.
 *
 * NOTE: `appId` must be a reverse-DNS identifier tied to a domain you control and
 * must match the Bundle Identifier registered in App Store Connect. Change it here
 * before the first real submission if you use a different domain.
 */
const config: CapacitorConfig = {
  appId: "com.hubforfamilies.app",
  appName: "Family Hub",
  // Matches vite's build.outDir (dist/public), relative to this package root.
  webDir: "dist/public",
  ios: {
    // Safe-area insets are handled deterministically via CSS env(safe-area-inset-*)
    // (see index.html's viewport-fit=cover + the header/sheet/dialog padding),
    // not native auto-inset. "always" delegated this to WKWebView's
    // UIScrollView.contentInsetAdjustmentBehavior, which recalculates on scroll
    // -view state changes — including the body scroll-lock every Radix Dialog/
    // Sheet open triggers — and could desync mid-recalculation, intermittently
    // rendering content flush under the notch/home indicator until the next
    // layout pass. "never" removes that native mechanism entirely so there's
    // nothing left to race.
    contentInset: "never",
  },
  plugins: {
    PushNotifications: {
      // REQUIRED for a push to be visible while the app is in the FOREGROUND.
      // @capacitor/push-notifications' willPresent handler
      // (PushNotificationsHandler.swift) reads this key to decide what iOS
      // should display; with the key absent it falls through to `return []`,
      // an empty option set, so iOS shows nothing at all — no banner, no
      // sound, no badge. The push is still delivered (APNs returns 200 and
      // the `pushNotificationReceived` JS event fires), it's just silently
      // suppressed. That made "Send test notification" — which is tapped
      // from inside the app, so the app is necessarily in the foreground when
      // the push lands seconds later — look like it never arrived, even
      // though every server-side layer reported success.
      //
      // Background/locked pushes were never affected: iOS presents those
      // itself without ever consulting willPresent.
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
