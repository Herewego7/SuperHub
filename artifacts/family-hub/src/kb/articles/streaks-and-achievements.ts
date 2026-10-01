import type { KbArticle } from "../types";

export const streaksAndAchievementsArticles: KbArticle[] = [
  {
    id: "how-streaks-work",
    title: "How streaks work",
    category: "streaks-and-achievements",
    type: "concept",
    summary: "What counts toward a streak, and how streak freezes work.",
    tags: [
      "streaks", "streak count", "how streaks work", "chore streak", "flame icon",
      "streak freeze", "freeze", "missed a day", "save streak",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "A streak counts consecutive days on which someone checked off at least one thing — a chore, a bonus chore or a to-do. It's shown as a flame badge with the number of days next to their star count on the Chores tab.",
      },
      {
        kind: "text",
        text:
          "If a day is missed, the streak normally resets. A Streak Freeze can save it: when yesterday was missed but the day before wasn't, a Freeze button appears next to that person's streak on the Chores tab. Tapping it covers yesterday. It isn't used automatically, and each person gets one per week.",
      },
      {
        kind: "note",
        tone: "info",
        text:
          "A snowflake next to the flame means a freeze is bridging a missed day. \"Streak days off\" (see \"Streaks when chores aren't every day\") can make some days never count against the streak at all.",
      },
    ],
    related: ["streaks-not-every-day"],
    updatedAt: "2026-09-30",
  },
  {
    id: "streaks-not-every-day",
    title: "Streaks when chores aren't every day",
    category: "streaks-and-achievements",
    type: "how-to",
    summary: "How to stop weekends (or any day) from breaking someone's streak.",
    tags: [
      "streak days off", "streak weekends", "streak broke", "streak reset",
      "chores not every day", "streak less than 7 days",
    ],
    blocks: [
      { kind: "path", path: ["Settings", "Rewards & Approvals", "Each person", "Streak days off"] },
      {
        kind: "text",
        text:
          "If someone's chores only happen on weekdays (or any other subset of the week), their streak shouldn't reset just because Saturday and Sunday have nothing scheduled. \"Streak days off\" fixes exactly this.",
      },
      {
        kind: "steps",
        steps: [
          "Open Settings → Rewards & Approvals and expand Each person.",
          "Tap that person's name to expand their settings.",
          "Under Streak days off, tap each day that shouldn't count — weekends, for example.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Days marked as \"off\" are skipped in both directions when the streak is calculated — so a Friday-to-Monday stretch with Saturday/Sunday off still reads as one unbroken streak, not two separate ones.",
      },
    ],
    related: ["how-streaks-work"],
    updatedAt: "2026-09-30",
  },
];
