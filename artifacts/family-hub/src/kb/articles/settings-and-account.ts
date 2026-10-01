import type { KbArticle } from "../types";

export const settingsAndAccountArticles: KbArticle[] = [
  {
    id: "screensaver-and-privacy-screen",
    title: "The privacy screen and the screensaver",
    category: "settings",
    type: "how-to",
    summary: "Cover the app with a picture and clock on demand, or automatically on an always-on device.",
    tags: [
      "privacy screen", "screensaver", "hide app", "wall display", "kitchen ipad",
      "always on", "clock", "change picture", "background image", "screen saver",
    ],
    blocks: [
      {
        kind: "faq",
        items: [
          {
            q: "Privacy screen",
            a: "Tap the eye icon (Privacy screen) in the top bar to cover the app with a picture, the time and the date. Tap Show app to return. Tap Change image to pick a different picture from the library, or Upload your own photo.",
          },
          {
            q: "Screensaver",
            a: "Settings → Display & Layout → turn on \"Screensaver on this device\". After 10 minutes untouched, it shows the clock over your privacy screen picture. Tap to bring the app back — it refreshes first, so nothing on screen is out of date.",
          },
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Both are per device: the screensaver switch and the chosen picture only apply to the device you set them on. The screensaver is meant for a device set never to sleep, like a kitchen tablet — it's off by default.",
      },
    ],
    related: [],
    updatedAt: "2026-09-30",
  },
  {
    id: "subscription-restore-purchases",
    title: "Subscribing, restoring purchases, and cancelling",
    category: "sharing-and-account",
    type: "how-to",
    summary: "Where the subscription lives, what it unlocks, and how to restore or cancel it.",
    tags: [
      "subscription", "subscribe", "restore purchases", "free trial", "trial ended",
      "cancel subscription", "billing", "family hub plus", "paid", "app store",
      "subscription not showing", "bought on another device",
    ],
    blocks: [
      { kind: "path", path: ["Settings", "Subscription"] },
      {
        kind: "faq",
        items: [
          {
            q: "Subscribing",
            a: "Tap Subscribe Now in Settings → Subscription. Subscribing is only available in the iPhone/iPad app — on the web, open Family Hub+ on your device to subscribe.",
          },
          {
            q: "What it unlocks",
            a: "Snap a Recipe, Import Recipe from URL, redeeming rewards, and cashing out stars. Everything you've already earned is safe either way.",
          },
          {
            q: "It says I'm not subscribed, but I paid",
            a: "On the iPhone/iPad app, tap Restore Purchases, signed in to the same Apple ID you bought with. If it says \"Nothing to restore\", no active subscription was found for that Apple ID.",
          },
          {
            q: "Does the rest of my family need to subscribe?",
            a: "No. If someone in your family is subscribed, everything is unlocked for everyone — only they can change or cancel it.",
          },
          {
            q: "Cancelling or changing plans",
            a: "Tap Manage subscription. Billing, plan changes and cancelling are handled by the App Store.",
          },
        ],
      },
    ],
    related: ["inviting-partner"],
    updatedAt: "2026-09-30",
  },
  {
    id: "signing-out-switching-accounts",
    title: "Signing out, or switching to a different account",
    category: "sharing-and-account",
    type: "how-to",
    summary: "How to sign out, sign in as someone else, and reset a forgotten password.",
    tags: [
      "sign out", "log out", "logout", "switch account", "change account",
      "different account", "wrong account", "forgot password", "reset password", "change password",
    ],
    blocks: [
      { kind: "path", path: ["Settings", "Sign out"] },
      {
        kind: "steps",
        steps: [
          "Open Settings and scroll to the very bottom.",
          "Tap Sign out, then Continue →, then Sign out again to confirm.",
          "On the sign-in screen, sign in with the other account (email and password, or Sign in with Apple).",
        ],
      },
      {
        kind: "faq",
        items: [
          {
            q: "I forgot my password",
            a: "Tap \"Forgot password?\" on the sign-in screen. If you're already signed in, Settings → Account & Family → Change password emails you a reset link. Accounts that use Sign in with Apple have no password to change.",
          },
          {
            q: "I want to join my partner's family instead of my own",
            a: "Don't just sign out — ask them for an invite (see \"Inviting your partner or a caregiver\"). Joining replaces the data in your current family with theirs.",
          },
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Some things belong to the device rather than the account — notification setup, the screensaver and the privacy screen picture — so check them after switching.",
      },
    ],
    related: ["inviting-partner", "family-members-vs-people"],
    updatedAt: "2026-09-30",
  },
];
