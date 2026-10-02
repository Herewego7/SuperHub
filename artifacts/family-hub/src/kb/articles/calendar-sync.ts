import type { KbArticle } from "../types";

export const calendarSyncArticles: KbArticle[] = [
  {
    id: "connecting-google-outlook",
    title: "Connecting Google or Outlook Calendar",
    category: "calendar-sync",
    type: "how-to",
    summary: "Sync an external calendar into your family's shared calendar.",
    tags: [
      "connect google calendar", "connect outlook", "sync calendar", "link calendar",
      "google calendar integration", "outlook integration", "add calendar",
    ],
    blocks: [
      { kind: "path", path: ["Settings", "Calendar", "Connect"] },
      {
        kind: "steps",
        steps: [
          "Open Settings and expand Calendar.",
          "Find the person whose calendar you're connecting and tap Connect on their row (it says Add another if they already have something connected).",
          "Choose Google Calendar or Outlook.",
          "Sign in and approve calendar access when prompted.",
          "Back in Settings, tap the \"N calendars\" bar under that person to choose which of their calendars sync, who each one is assigned to, and where new events go (see \"Choosing which calendars sync\").",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Sync is two-way by default: events you create in SuperHub are also added to that person's calendar. To stop that, turn off \"Add app events to connected calendars\" at the top of the Calendar section.",
      },
      {
        kind: "note",
        tone: "info",
        text:
          "The permission screen only ever asks for calendar access — it's not a \"sign in with Google/Outlook\" flow, and connecting a calendar never creates a separate login.",
      },
    ],
    related: ["choosing-which-calendars-sync", "ical-feeds", "events-wrong-person"],
    updatedAt: "2026-09-30",
  },
  {
    id: "choosing-which-calendars-sync",
    title: "Choosing which calendars sync",
    category: "calendar-sync",
    type: "how-to",
    summary: "Keep a work calendar (or any other) out of the family view.",
    tags: [
      "which calendars sync", "hide calendar", "exclude calendar", "work calendar",
      "manage calendars", "too many calendars", "create new events in", "write calendar",
    ],
    blocks: [
      { kind: "path", path: ["Settings", "Calendar", "N calendars"] },
      {
        kind: "steps",
        steps: [
          "Open Settings and expand Calendar.",
          "Under the person whose account it is, tap the \"N calendars\" bar to expand it.",
          "Tick or untick the box next to each calendar — only ticked calendars are pulled into SuperHub at all. Changes save straight away.",
          "Use the \"Assign to:\" menu under a calendar to choose whose events it holds (see \"My calendar events show the wrong person\").",
          "Under \"Create new events in\", pick which calendar events made in SuperHub are written to.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Unticking a calendar doesn't just hide its events — the app stops fetching it entirely, so it's the right way to keep something like a work calendar fully out of the family view.",
      },
    ],
    related: ["connecting-google-outlook", "events-wrong-person"],
    updatedAt: "2026-09-30",
  },
  {
    id: "ical-feeds",
    title: "Adding a school, sports or team calendar (iCal / URL feed)",
    category: "calendar-sync",
    type: "how-to",
    summary: "Subscribe to any calendar's .ics link — read-only, and assigned to one person.",
    tags: [
      "ical", "ics", "webcal", "subscribe to calendar", "school calendar",
      "sports schedule", "team calendar", "calendar link", "url feed", "read-only calendar",
    ],
    blocks: [
      { kind: "path", path: ["Settings", "Calendar", "Connect", "iCal / URL feed (read-only)"] },
      {
        kind: "steps",
        steps: [
          "Copy the calendar's .ics or webcal:// link from the school, club or app that publishes it.",
          "Open Settings → Calendar and, on the row of the person the events are for, tap Connect (or Add another).",
          "Choose iCal / URL feed (read-only).",
          "Paste the link, give it a name (e.g. School Calendar), optionally pick a colour, and tap Subscribe.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Feeds are read-only — you can't edit their events in SuperHub — and changes at the source can take a while to show up (the app re-reads a feed about every 15 minutes). All of a feed's events belong to the person you added it under; to show them for someone else, remove it and add it again from that person's row.",
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "If a feed stops working, its row in Settings → Calendar shows the error in red under its name instead of the link. Check that the link still opens, then remove the feed (the remove button at the end of its row) and add it again.",
      },
    ],
    related: ["connecting-google-outlook", "calendar-sync-problems", "events-wrong-person"],
    updatedAt: "2026-09-30",
  },
  {
    id: "calendar-sync-problems",
    title: "Google or Outlook stopped syncing / \"couldn't sync\"",
    category: "calendar-sync",
    type: "troubleshooting",
    summary: "What the sync warnings mean, and how to get a connected calendar working again.",
    tags: [
      "calendar not syncing", "sync stopped", "couldn't sync", "reconnect calendar",
      "calendar needs reconnection", "google calendar not updating", "outlook not updating",
      "failed to sync", "sync error", "calendar expired", "no google calendars found",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "Connections to Google and Outlook can expire or be revoked (a changed password, removing the app's access in your Google/Microsoft account, and so on). The app tells you in a few places:",
      },
      {
        kind: "faq",
        items: [
          {
            q: "The Events card on Home says \"Google couldn't sync\" or \"Reconnect it to see your events again\"",
            a: "Tap it — it opens Settings → Calendar. Find the person with the red \"… Calendar needs reconnection\" box and tap Reconnect, then sign in again.",
          },
          {
            q: "Settings says \"No Google calendars found\" (or Outlook)",
            a: "The account didn't hand over any calendars — usually a permissions problem. Tap Reconnect and make sure you allow calendar access on the permission screen.",
          },
          {
            q: "Settings says \"N events recently failed to sync to Google/Outlook\"",
            a: "Those events are still on your SuperHub calendar — only the copy sent to Google or Outlook failed. Reconnect that calendar if it keeps happening.",
          },
          {
            q: "A change I made in Google or Outlook hasn't shown up yet",
            a: "While the app is open it re-checks connected calendars about once a minute, so give it a minute. School/sports feeds (iCal) can take up to about 15 minutes.",
          },
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "If none of that helps, tap Disconnect and then Connect the calendar again from that person's row in Settings → Calendar. Disconnecting clears that account's sync and \"Create new events in\" choices, so you'll need to pick them again.",
      },
    ],
    related: ["connecting-google-outlook", "events-card-missing-events", "events-not-appearing"],
    updatedAt: "2026-09-30",
  },
];
