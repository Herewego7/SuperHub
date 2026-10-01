import type { KbArticle } from "../types";

export const parentControlsArticles: KbArticle[] = [
  {
    id: "why-set-a-parent-pin",
    title: "Why set a Parent PIN?",
    category: "parent-controls",
    type: "guidance",
    summary: "What the PIN actually protects, and why it's worth setting even on a shared device.",
    tags: [
      "parent pin", "why pin", "do i need a pin", "what does pin do",
      "pin protection", "parental controls", "lock settings", "lock behind pin",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "The Parent PIN exists for one specific situation: your family shares a device (a kitchen iPad, a kid's own tablet) where anyone could open the app — including a child. Without a PIN, whoever's holding the device can change chores, create rewards, or add stars.",
      },
      {
        kind: "text",
        text:
          "Two things always ask for the PIN once one is set: approving or declining a cash-out, and Add or remove stars. Everything else is opt-in: in Settings → Rewards & Approvals → Parent PIN, turn on \"Require a Parent PIN for locked actions\" and tick what to protect under \"Lock behind the Parent PIN\" — creating & managing chores, bonus chores, rewards and to-dos, the Calendar tab's display settings, or opening Settings at all.",
      },
      {
        kind: "note",
        tone: "info",
        text:
          "The locked actions only ask for the PIN when a kid's own profile is the only one selected at the top of the app — viewing \"All Family\" or several people at once isn't gated, since a parent could easily be among the viewers.",
      },
      {
        kind: "text",
        text:
          "If you're not worried about a shared device, you don't strictly need one — but most families with a kitchen tablet or a kid's own device find it worth the 15 seconds to set up.",
      },
    ],
    related: ["setting-changing-pin", "approving-cashout", "adjust-stars-manually"],
    updatedAt: "2026-09-30",
  },
  {
    id: "setting-changing-pin",
    title: "Setting, changing, or resetting a forgotten PIN",
    category: "parent-controls",
    type: "how-to",
    summary: "How to set your first PIN, change an existing one, and what to do if you forget it.",
    tags: [
      "set pin", "change pin", "forgot pin", "reset pin", "pin reset",
      "lost pin", "forgot parent pin", "can't remember pin",
    ],
    blocks: [
      { kind: "path", path: ["Settings", "Rewards & Approvals", "Parent PIN"] },
      {
        kind: "text",
        text: "Setting your very first PIN needs nothing extra — there's nothing to protect yet, so just type a 4-digit PIN, confirm it, and save.",
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Changing an existing PIN is different on purpose: it requires proving you're actually a parent first, so a child on a shared device can't just overwrite it. You'll be asked for either your account's login password, or a one-time code emailed to your own account address.",
      },
      {
        kind: "steps",
        steps: [
          "Open Settings → Rewards & Approvals and expand Parent PIN.",
          "Type the new PIN and confirm it.",
          "If a PIN is already set, enter your Account password — or tap \"Forgot your PIN? Email me a code\" to get a 6-digit code sent to your account's email.",
          "Tap Save PIN settings.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "The emailed code expires after 10 minutes. If it doesn't arrive, tap Resend code, and check that your account has a real email on file.",
      },
    ],
    related: ["why-set-a-parent-pin"],
    updatedAt: "2026-09-30",
  },
];
