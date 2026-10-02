import type { KbArticle } from "../types";

export const troubleshootingArticles: KbArticle[] = [
  {
    id: "events-wrong-person",
    title: "My calendar events show the wrong person",
    category: "calendar-sync",
    type: "troubleshooting",
    summary: "How the app decides who an event is assigned to, and how to change it.",
    tags: [
      "wrong person calendar", "event assigned to wrong person", "wrong color event",
      "calendar shows wrong family member", "event attribution", "misattributed event",
      "assign to", "who is this event for", "wrong owner", "event owner", "change who event is for",
      "wrong name on event", "calendar assignment",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "Every event is assigned to one or more people — the field is called Assign to when you open an event. Its colour and the names shown with it come from those people. Events made in SuperHub are assigned to whoever you pick. For events synced from Google, the app decides in this order:",
      },
      {
        kind: "steps",
        steps: [
          "An assignment someone set on that event in SuperHub (by opening it and changing Assign to). This always wins.",
          "Otherwise, whoever created the event in Google — if their email is a Google account connected in SuperHub, the event goes to that person. This beats the calendar's own setting, so an event Mom adds to a shared \"Kids\" calendar shows as Mom's.",
          "Otherwise, the person chosen in \"Assign to:\" for that calendar in Settings → Calendar.",
          "Otherwise, the person whose Google account the calendar was fetched from.",
        ],
      },
      {
        kind: "faq",
        items: [
          {
            q: "Fix one event",
            a: "Open it on the Calendar tab, change Assign to, and save. If it's a repeating event you'll be asked \"Change assignee for…\" — This event only, or This and all following events.",
          },
          {
            q: "Fix a whole calendar",
            a: "Settings → Calendar → tap the \"N calendars\" bar under the account's owner → change \"Assign to:\" under that calendar. Events someone created from their own connected Google account still go to them (step 2 above) — fix those one at a time.",
          },
          {
            q: "Outlook calendars and iCal / URL feeds",
            a: "An Outlook calendar follows its \"Assign to:\" setting in Settings → Calendar; with none set, its events show under the person whose row it's connected on. Changing Assign to on a single Outlook event doesn't move it — change the calendar's setting instead. iCal / URL feeds always belong to the person you added them under; to show one for someone else, remove it and add it again from that person's row.",
          },
          {
            q: "The event shows someone with a car next to it",
            a: "That's Who's driving?, not who the event is for. A driver also sees the event when only they are selected.",
          },
        ],
      },
    ],
    related: ["choosing-which-calendars-sync", "connecting-google-outlook", "events-card-missing-events"],
    updatedAt: "2026-09-30",
  },
  {
    id: "chore-came-back",
    title: "A completed chore came back / un-checked itself",
    category: "troubleshooting",
    type: "troubleshooting",
    summary: "Why a checked-off chore can appear to revert, and what's actually happening.",
    tags: [
      "chore unchecked itself", "chore came back", "chore reverted", "lost my completion",
      "chore disappeared from done", "unchecked chore",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "A chore only shows as complete for the specific day it was scheduled for. A few things commonly look like \"it came back\" but are actually working as designed:",
      },
      {
        kind: "faq",
        items: [
          {
            q: "It moved to \"Done\" and disappeared from the active list",
            a: "This is normal — a completed chore stays visible for about 30 seconds (so you can see the checkmark), then moves into the collapsed \"Done\" section for the day. It's still recorded as complete; tap \"Done (N)\" to see it.",
          },
          {
            q: "It shows as not-done again the next day",
            a: "Also expected — a chore's completion only counts for the day it was done. Each new scheduled day starts fresh.",
          },
          {
            q: "It really did un-check after you tapped it",
            a: "This usually means it was already completed once that day (checking it off again toggles it back off), or — for a Target chore — that it's tracking progress toward a weekly/monthly count rather than a single done/not-done state.",
          },
        ],
      },
    ],
    related: ["five-kinds-of-tasks", "how-streaks-work"],
    updatedAt: "2026-08-04",
  },
  {
    id: "stars-dont-add-up",
    title: "My star total doesn't look right",
    category: "troubleshooting",
    type: "troubleshooting",
    summary: "Why a star balance can look off, and where it's really coming from.",
    tags: [
      "stars wrong", "points wrong", "star balance incorrect", "missing stars",
      "stars not adding up", "wrong star count", "stars disappeared", "lost stars",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "A star balance is always worked out fresh from the full history — every completed chore, every daily bonus, every reward redeemed, every cash-out, and any stars a parent added or removed by hand. A few things commonly explain a number that looks off:",
      },
      {
        kind: "faq",
        items: [
          {
            q: "Redeeming a reward lowers the balance",
            a: "Rewards and cash-out spend from the same balance, so the total drops the moment something is redeemed. That's intentional.",
          },
          {
            q: "Single chores show 0 stars",
            a: "If your family earns stars by \"Completing all chores for a day\" (Settings → Rewards & Approvals → Everyone), regular chores are worth nothing on their own — finishing the whole day's chores pays one bonus. Bonus chores and Target chores still pay their own value.",
          },
          {
            q: "A pending cash-out request reserves stars",
            a: "The moment a cash-out is requested, those stars are set aside so they can't be spent twice while it waits for a parent. They come back automatically if the request is declined.",
          },
          {
            q: "Someone added or removed stars by hand",
            a: "Adjustments made with + → Add or remove stars change the balance directly and can even take it below zero.",
          },
          {
            q: "Un-checking a chore takes its stars back",
            a: "If a chore was ticked by mistake and then un-ticked, its stars are removed again.",
          },
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "To see where a number came from, tap the person at the top of the app and look at their Star Insights card on the Chores tab (balance over time), or tap the Recent Activity card on Home to open Family Activity — every chore, reward, cash-out and star adjustment is listed there.",
      },
    ],
    related: ["how-stars-work", "adjust-stars-manually", "approving-cashout"],
    updatedAt: "2026-09-30",
  },
  {
    id: "events-not-appearing",
    title: "An event I added isn't showing up on the calendar",
    category: "troubleshooting",
    type: "troubleshooting",
    summary: "The most common reasons a new or synced event doesn't appear.",
    tags: [
      "event not showing", "missing event", "calendar event disappeared",
      "event didn't save", "can't see event", "event not syncing",
    ],
    blocks: [
      {
        kind: "steps",
        steps: [
          "Check who the event is assigned to, and make sure that person is selected at the top of the app — tap All Family to see everyone's events.",
          "If it's a synced Google/Outlook event, open Settings → Calendar, tap the \"N calendars\" bar under that account, and make sure the event's calendar is ticked.",
          "If you just connected a calendar or changed something in Google/Outlook, give it a minute — the app re-checks connected calendars about once a minute while it's open. School/sports feeds can take up to about 15 minutes.",
          "Check the date and view you're on — an event on a different day won't appear until you navigate to it.",
          "Look for a red \"couldn't sync\" or \"needs reconnection\" warning — see \"Google or Outlook stopped syncing\".",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Synced events more than a year in the past or future aren't fetched. If the event was created directly in Google or Outlook and still doesn't appear after all of the above, try Disconnect and Connect again for that calendar under Settings → Calendar.",
      },
    ],
    related: ["events-card-missing-events", "calendar-sync-problems", "choosing-which-calendars-sync"],
    updatedAt: "2026-09-30",
  },
  {
    id: "events-card-missing-events",
    title: "Events aren't showing in the Events card, even though there are events that day",
    category: "troubleshooting",
    type: "troubleshooting",
    summary: "The Events card on Home filters by person, time and date — here's everything that can hide an event.",
    tags: [
      "events card empty", "home events missing", "today's events missing", "events card",
      "no remaining events today", "events not on home", "event missing from home",
      "home page events", "events card wrong", "can't see today's events", "event disappeared from home",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "The Events card on Home shows the events for the date at the top of Home, for the people currently selected. Its header shows how many of each (\"N family members · N events\"). Work through these in order:",
      },
      {
        kind: "faq",
        items: [
          {
            q: "1. Only some people are selected",
            a: "The card only shows events assigned to (or driven by) the people selected at the top of the app. Tap All Family to see everyone. If the event is attributed to the wrong person, see \"My calendar events show the wrong person\".",
          },
          {
            q: "2. It already finished",
            a: "On today, timed events that have ended leave the main list and move to \"Earlier today (N)\" at the bottom of the card — tap it to expand. All-day events stay put all day.",
          },
          {
            q: "3. The card only shows the first few",
            a: "It shows 3 events (6 in the wide layout). Tap \"View All N Events\" underneath for the rest.",
          },
          {
            q: "4. You hid it",
            a: "The eye icon on an event (Hide from today) hides it from this card on this device for that day. There's no undo button — it's still on the Calendar tab, and the card starts fresh the next day.",
          },
          {
            q: "5. You're looking at another day",
            a: "The card follows the date at the top of Home. If it doesn't say Today, tap Today. (Home also returns to today on its own after 10 minutes without a touch.)",
          },
          {
            q: "6. Its calendar isn't ticked",
            a: "Settings → Calendar → tap the \"N calendars\" bar under the account → make sure that calendar is ticked. Unticked calendars aren't fetched at all.",
          },
          {
            q: "7. The connection needs fixing",
            a: "If the card says \"Google couldn't sync\", \"Reconnect it to see your events again\" or \"No calendars selected — tap to connect\", tap it and reconnect in Settings → Calendar.",
          },
          {
            q: "8. It was only just added",
            a: "Events added in Google or Outlook can take about a minute to appear; school/sports feeds up to about 15 minutes.",
          },
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Quick check: open the Calendar tab on the same day with All Family selected. If the event is there but not on Home, it's one of 1–5 above. If it's missing from both, it's a sync issue (6–8).",
      },
    ],
    related: ["events-wrong-person", "calendar-sync-problems", "events-not-appearing"],
    updatedAt: "2026-09-30",
  },
];
