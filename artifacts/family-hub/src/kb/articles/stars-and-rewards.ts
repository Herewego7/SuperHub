import type { KbArticle } from "../types";

export const starsAndRewardsArticles: KbArticle[] = [
  {
    id: "how-stars-work",
    title: "How stars work",
    category: "stars-and-rewards",
    type: "concept",
    summary: "Where stars come from, and the two different ways a family can earn them.",
    tags: ["stars", "points", "how stars work", "star system", "earning stars", "star balance"],
    blocks: [
      {
        kind: "text",
        text:
          "Stars are Family Hub+'s currency for chores. A family earns them in one of two ways, chosen once for the whole family in Settings → Rewards & Approvals → Everyone, under \"How do kids earn stars?\":",
      },
      {
        kind: "faq",
        items: [
          {
            q: "Completing each chore",
            a:
              "Every chore has its own star value, and checking it off awards exactly that many stars (\"Make bed → 2⭐, walk dog → 3⭐\").",
          },
          {
            q: "Completing all chores for a day",
            a:
              "Individual chores award nothing on their own — finishing every chore scheduled for that day awards one flat bonus instead (\"All of today's chores done → one bonus\"). Set the amount in \"Stars for finishing the day (family default)\", and override it for one person under Rewards & Approvals → Each person → Daily checklist bonus.",
          },
        ],
      },
      {
        kind: "text",
        text:
          "In either mode, Bonus chores and Target chores pay their own star value, and to-dos and Inspiration items are never worth stars. A parent can also add or remove stars by hand — see \"Adding or removing stars by hand\".",
      },
      {
        kind: "text",
        text:
          "Stars can be spent two ways: on rewards from your family's reward list, or converted to real money via cash-out — see \"Rewards, cash-out, or both\" for how to choose.",
      },
    ],
    related: ["deciding-star-value", "redemption-modes", "adjust-stars-manually", "stars-dont-add-up"],
    updatedAt: "2026-09-30",
  },
  {
    id: "adjust-stars-manually",
    title: "Adding or removing stars by hand",
    category: "stars-and-rewards",
    type: "how-to",
    summary: "Give a star bonus or take stars away without any chore being done.",
    tags: [
      "add stars", "remove stars", "give stars", "take away stars", "deduct stars",
      "manual stars", "adjust stars", "bonus stars", "penalty", "star adjustment",
      "correct star balance", "fix stars",
    ],
    blocks: [
      { kind: "path", path: ["+", "Add or remove stars"] },
      {
        kind: "steps",
        steps: [
          "Tap the + button (on any tab) and choose Add or remove stars.",
          "Enter the Parent PIN and tap Unlock. If no PIN is set, just tap Unlock.",
          "Under For, tap the person.",
          "Drag or scroll the wheel up to add stars, down to remove them — or use the − and + buttons. It goes up to 50 either way per adjustment.",
          "Optionally type a Reason.",
          "Tap the button at the bottom (e.g. \"Add 5 ⭐ for Sam\").",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Every adjustment appears in Family Activity (tap the Recent Activity card on Home) with its reason, and counts in that person's Star Insights. Removing stars can take a balance below zero — nothing stops it.",
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "This screen asks for the PIN every time it opens, even if you entered it a moment ago somewhere else.",
      },
    ],
    related: ["how-stars-work", "stars-dont-add-up", "why-set-a-parent-pin"],
    updatedAt: "2026-09-30",
  },
  {
    id: "deciding-star-value",
    title: "Deciding how many stars a chore should be worth",
    category: "stars-and-rewards",
    type: "guidance",
    summary: "There's no single right answer, but here's a starting point that works for most families.",
    tags: [
      "how many stars", "star value", "how many points", "star amount",
      "chore worth", "pricing chores", "how much should a chore be worth",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "The app won't tell you a \"correct\" number — this is genuinely a family decision — but a simple starting point is to price by effort, then adjust once you see how fast stars pile up. The chore form suggests exactly this with three buttons under Stars per completion:",
      },
      {
        kind: "steps",
        steps: [
          "Quick (a few min) — make your bed, feed the pet: 1 star.",
          "Medium (10–20 min) — unload the dishwasher, take out the trash: 3 stars.",
          "Big job (30+ min) — clean a whole room, help with laundry: 6 stars.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "A useful sanity check: look at how many stars a typical week of chores adds up to, and compare that to what a reward actually costs. If a week of chores buys less than one small reward, most kids lose interest — if it buys five rewards, stars stop feeling meaningful. Aim for roughly one solid reward per week of consistent effort. If cash-out is on, the form also shows roughly what a chore is worth in money at your family's rate.",
      },
      {
        kind: "text",
        text:
          "If your family earns stars by \"Completing all chores for a day\" (see \"How stars work\"), individual chore values don't apply to regular chores at all — only the daily bonus does. Bonus chores still have their own value, since they're extra credit, not part of the daily checklist.",
      },
    ],
    related: ["how-stars-work", "redemption-modes"],
    updatedAt: "2026-09-30",
  },
  {
    id: "redemption-modes",
    title: "Rewards, cash-out, or both — what stars can be spent on",
    category: "stars-and-rewards",
    type: "how-to",
    summary: "Turn the reward list and real-money cash-out on or off, and set what a star is worth.",
    tags: [
      "redemption mode", "switch redemption mode", "cash out only", "rewards only",
      "turn off cash out", "disable reward store", "allowance mode", "stars per dollar",
      "what are stars worth", "exchange rate", "minimum cash out",
    ],
    blocks: [
      { kind: "path", path: ["Settings", "Rewards & Approvals", "Everyone"] },
      {
        kind: "steps",
        steps: [
          "Open Settings → Rewards & Approvals and expand Everyone.",
          "Under \"What can they do with stars?\", switch Spend on rewards and/or Cash out for money on or off.",
          "If cash-out is on, set \"What are stars worth?\" (for example, 10 stars = $1) and, optionally, \"Can cash out once they have\" a minimum number of stars.",
          "Tap Save rewards settings.",
        ],
      },
      {
        kind: "faq",
        items: [
          {
            q: "Spend on rewards only",
            a: "Kids redeem stars for things on your reward list (extra screen time, pick a movie, whatever you've set up). No cash-out option appears.",
          },
          {
            q: "Cash out for money only",
            a: "Stars convert to real money instead — no reward list shown.",
          },
          {
            q: "Both",
            a: "Kids can do either — redeem a reward, or cash out for money.",
          },
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "This is a family-wide setting, not per-person — everyone redeems the same way. Changing it doesn't affect stars already earned; it only changes what they can be spent on going forward.",
      },
    ],
    related: ["how-stars-work", "setting-up-reward-store", "cashing-out-stars", "approving-cashout"],
    updatedAt: "2026-09-30",
  },
  {
    id: "setting-up-reward-store",
    title: "Setting up your reward store",
    category: "stars-and-rewards",
    type: "how-to",
    summary: "Add the things kids can spend stars on.",
    tags: ["reward store", "add reward", "create reward", "catalog", "what can kids buy", "reward list"],
    blocks: [
      { kind: "path", path: ["Chores", "Rewards", "+"] },
      {
        kind: "steps",
        steps: [
          "Go to the Chores tab and find the Rewards card.",
          "Tap the + in the Rewards card header (Add a reward).",
          "Fill in Reward Name, optionally a Description, the Stars Required, and an Icon.",
          "Optionally use Assign to (optional) to make it available to one person only — leave it on Everyone otherwise.",
          "Save — it now shows up in the Rewards card for anyone it applies to.",
        ],
      },
      {
        kind: "text",
        text:
          "To edit or delete rewards later, tap Manage rewards (the checklist icon next to the +) in the same card header.",
      },
      {
        kind: "note",
        tone: "info",
        text:
          "The reward list only appears when Spend on rewards is switched on (see \"Rewards, cash-out, or both\") — it's worth adding a few rewards before turning it on.",
      },
    ],
    related: ["redemption-modes", "deciding-star-value"],
    updatedAt: "2026-09-30",
  },
  {
    id: "cashing-out-stars",
    title: "How a kid cashes out stars for money",
    category: "stars-and-rewards",
    type: "how-to",
    summary: "Requesting a cash-out, and what happens to the stars while a parent decides.",
    tags: [
      "cash out", "cashout", "convert stars to money", "request cash out", "wallet",
      "allowance", "get paid", "cash out stars", "waiting for parent approval",
    ],
    blocks: [
      { kind: "path", path: ["Chores", "Rewards", "Cash Out Stars"] },
      {
        kind: "steps",
        steps: [
          "Tap the kid's own profile at the top of the app, so only they are selected.",
          "On the Chores tab, find Cash Out Stars in the Rewards card. It shows how many stars are available.",
          "Pick an amount with the slider (the smallest is 25¢).",
          "Tap Cash out. It shows \"Request sent! Waiting for parent approval.\"",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "The stars are set aside the moment the request is sent, so they can't be spent twice. If a parent declines, they come straight back. Cash Out Stars only appears when Cash out for money is turned on in Settings → Rewards & Approvals.",
      },
    ],
    related: ["approving-cashout", "redemption-modes"],
    updatedAt: "2026-09-30",
  },
  {
    id: "approving-cashout",
    title: "Approving (or declining) a cash-out request",
    category: "stars-and-rewards",
    type: "how-to",
    summary: "How to review and act on a kid's request to convert stars to money.",
    tags: [
      "approve cash out", "decline cash out", "cash out request", "pending cashout",
      "cash-out approvals", "reject cash out",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "When cash-out is turned on and someone requests one, it waits for a parent's approval — and approving or declining always needs the Parent PIN if one is set.",
      },
      { kind: "path", path: ["Chores", "Rewards", "Cash-Out Approvals"] },
      {
        kind: "steps",
        steps: [
          "On the Chores tab, find the Cash-Out Approvals box in the Rewards card and tap Unlock.",
          "Enter your Parent PIN.",
          "Pending requests are listed with the person's name — tap the ✓ button to approve or the ✕ button to decline.",
          "Declining automatically returns the reserved stars to that person's balance. Tap Lock when you're done.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "The same list is also under Settings → Rewards & Approvals → Approvals → Cash-out approvals, where the buttons are labelled Approve and Decline. If this device has the Cash-out requested alert on (Settings → Notifications → Alerts), you'll also get a notification when a request comes in.",
      },
    ],
    related: ["cashing-out-stars", "redemption-modes", "why-set-a-parent-pin"],
    updatedAt: "2026-09-30",
  },
];
