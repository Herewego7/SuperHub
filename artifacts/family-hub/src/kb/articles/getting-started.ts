import type { KbArticle } from "../types";

export const gettingStartedArticles: KbArticle[] = [
  {
    id: "welcome",
    title: "Welcome to Family Hub+ — what it does",
    category: "getting-started",
    type: "concept",
    summary: "A quick tour of what Family Hub+ actually covers.",
    tags: ["overview", "intro", "what is this app", "getting started", "tour"],
    blocks: [
      {
        kind: "text",
        text:
          "Family Hub+ is one shared home base for your household: a family calendar, chores and rewards, meal planning, health reminders, and a few things to help everyone stay on the same page. Everything here is organized around the tabs at the bottom (or side) of the app.",
      },
      {
        kind: "steps",
        steps: [
          "Home — a snapshot of the day: events, tasks, stars, and recent activity.",
          "Calendar — the shared family calendar, synced with Google/Outlook/iCal if you connect them.",
          "Chores — everyone's chores, trophies, Star Insights, the reward store, and bonus chores.",
          "To-Dos — one-off things to check off.",
          "Meals — weekly meal planning and the grocery list.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Everything in the app belongs to your family's account, not to any one person's login — everyone who signs in (or joins via invite) sees the same shared calendar, chores, and rewards. The + button on every tab is the quickest way to add things: events, chores, to-dos, health reminders, notes and praise.",
      },
    ],
    related: ["adding-people", "family-members-vs-people"],
    updatedAt: "2026-09-30",
  },
  {
    id: "adding-people",
    title: "Adding the people in your family",
    category: "getting-started",
    type: "how-to",
    summary: "How to add a profile for each family member.",
    tags: ["add profile", "add person", "add child", "add kid", "new family member", "create profile"],
    blocks: [
      {
        kind: "path",
        path: ["Settings", "People", "Add person"],
      },
      {
        kind: "steps",
        steps: [
          "Open Settings and expand People.",
          "Tap Add person.",
          "Enter a Name — Initials fill in automatically but you can override them.",
          "Pick a Profile Color for their calendar events and chore cards, and optionally add a photo (the camera circle next to it).",
          "Under \"This person is a…\", choose Grown-up or Kid. This controls what's PIN-gated for them — see \"Why set a Parent PIN?\" for why that matters.",
          "Tap Save profile.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "For a Kid, the form asks \"Is this kid under 13?\" — if so, saving shows a short parental-consent step. This is a legal requirement (COPPA), not an extra hoop we added for fun.",
      },
    ],
    related: ["family-members-vs-people", "why-set-a-parent-pin", "deleting-profile-vs-account"],
    updatedAt: "2026-09-30",
  },
  {
    id: "family-members-vs-people",
    title: "Family Members vs. People — what's the difference?",
    category: "getting-started",
    type: "concept",
    summary: "Two different concepts that sound alike: who can log in, vs. who the app tracks day to day.",
    tags: [
      "family members", "people", "profiles", "confusing", "difference between",
      "who can log in", "accounts vs profiles",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "These are genuinely two different things, and the names are close enough that it's easy to mix them up.",
      },
      {
        kind: "faq",
        items: [
          {
            q: "What is a \"Family Member\"?",
            a:
              "An adult with their own login to the app — their own email/password or Sign in with Apple. Every Family Member shares the same household data (the same calendar, chores, rewards). You invite someone as a Family Member when you want them to be able to sign in themselves, like a co-parent or spouse.",
          },
          {
            q: "What is a \"Person\" (profile)?",
            a:
              "Anyone the app tracks day to day — kids especially, but really everyone, even if they don't sign in on their own. A Person has a calendar color, can be assigned chores, and earns stars. Kids almost always exist only as a Person, not a Family Member, since they don't need (or shouldn't have) their own login.",
          },
          {
            q: "So can one adult be both?",
            a:
              "Yes — most parents are both a Family Member (they can sign in) and a Person (they show up on the calendar and can be assigned events too).",
          },
        ],
      },
    ],
    related: ["adding-people", "inviting-partner"],
    updatedAt: "2026-09-30",
  },
  {
    id: "inviting-partner",
    title: "Inviting your partner or a caregiver",
    category: "getting-started",
    type: "how-to",
    summary: "Send an invite so someone else can sign in to your family's account.",
    tags: [
      "invite", "invite code", "add spouse", "add co-parent", "share account",
      "caretaker", "grandparent access", "join family",
    ],
    blocks: [
      {
        kind: "path",
        path: ["Settings", "Sharing", "Invite Someone"],
      },
      {
        kind: "steps",
        steps: [
          "Open Settings → Sharing and tap Invite Someone.",
          "Choose who the invite is for: Grown-up, Kid, or Shared device (for something like a shared kitchen tablet).",
          "Enter their email and tap Send Invite to email them a link — or leave the email blank and tap New Code to get a code you can share yourself (the copy buttons next to it copy the code or a link).",
          "When they open the link, or enter the code under \"Have an invite code?\" on the sign-in screen, they'll see a \"Join this family?\" confirmation.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "Joining a family replaces the account's current family data with the invited family's. If the person you're inviting already has their own separate Family Hub+ data, make sure they understand that before accepting.",
      },
      {
        kind: "text",
        text:
          "For a babysitter or grandparent who just needs to see the schedule, use Settings → Sharing → Share with Caretakers instead — it makes a read-only link to this week's schedule, with no login needed.",
      },
    ],
    related: ["family-members-vs-people"],
    updatedAt: "2026-09-30",
  },
];
