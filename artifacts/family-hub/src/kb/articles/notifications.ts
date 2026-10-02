import type { KbArticle } from "../types";

export const notificationsArticles: KbArticle[] = [
  {
    id: "turning-on-push-notifications",
    title: "Turning on push notifications",
    category: "notifications",
    type: "how-to",
    summary: "How to enable notifications on a device, and choose which alerts it gets.",
    tags: [
      "enable notifications", "push notifications", "turn on notifications",
      "get alerts", "notification settings", "who is this device for",
    ],
    blocks: [
      { kind: "path", path: ["Settings", "Notifications"] },
      {
        kind: "text",
        text:
          "Notifications are set up per device, not per person — this is deliberate. Push delivery is tied to a specific phone, tablet or browser, and this app is often shared (a kitchen iPad) or used across several devices by one person (phone + tablet).",
      },
      {
        kind: "steps",
        steps: [
          "Open Settings → Notifications on the device you want notified. The top box says \"Off for this device\".",
          "Under \"Who is this device for?\", pick a person, or Everyone in the family. The device gets reminders for that person plus anything sent to everyone.",
          "Tap Enable and approve the system permission prompt.",
          "Open Alerts to choose which kinds this device shows — Reward redeemed, Chore assigned to you, Cash-out requested, Family invite accepted, Note posted, Weekly recap, Celebration reminders.",
          "Tap Test to check a notification actually arrives.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "When a new kind of alert is added to the app, devices already set up get it switched on — nothing silently opts a device out of something new. Each person's reminder times (bedtime chore reminder, daily morning brief, weekly recap) are under Schedules in the same section.",
      },
    ],
    related: ["not-getting-notifications", "health-reminders"],
    updatedAt: "2026-09-30",
  },
  {
    id: "not-getting-notifications",
    title: "I'm not getting notifications on my phone",
    category: "notifications",
    type: "troubleshooting",
    summary: "Steps to work through if notifications seem to be enabled but nothing arrives.",
    tags: [
      "no notifications", "not receiving notifications", "notifications not working",
      "push not arriving", "no alerts", "missing notifications",
    ],
    blocks: [
      {
        kind: "steps",
        steps: [
          "Open Settings → Notifications on THIS device. If the top box says \"Off for this device\", tap Enable. Setup doesn't carry over between devices, or between the app and a browser tab.",
          "Open Alerts and check that kind of notification is ticked for this device.",
          "Tap Test. If it fails, the message usually says why (for example, a rejected or expired device token).",
          "On iPhone or iPad, check the device's own Settings → Notifications → SuperHub to make sure notifications are allowed at the iOS level.",
          "If you reinstalled the app or restored your phone, tap Re-register. Old entries under Devices can be removed safely — a device re-adds itself the next time it's opened.",
          "In a web browser, if the top box says \"Blocked — allow notifications for this site in your browser settings\", allow notifications for the site in the browser, then tap Enable.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "If Test reports success but nothing ever shows up, it's most likely a device-level setting rather than an app setting — check the phone's notification settings for the app, and that Do Not Disturb or a Focus mode isn't on.",
      },
    ],
    related: ["turning-on-push-notifications", "medication-reminders-not-arriving"],
    updatedAt: "2026-09-30",
  },
  {
    id: "health-reminders",
    title: "Setting up medication and health reminders",
    category: "notes-and-health",
    type: "how-to",
    summary: "Add a medication, appointment, refill or general reminder for someone.",
    tags: [
      "medication reminder", "medicine reminder", "health reminder", "pill reminder",
      "appointment reminder", "refill reminder", "meds", "dose", "pause reminder",
    ],
    blocks: [
      { kind: "path", path: ["+", "Health reminder"] },
      {
        kind: "steps",
        steps: [
          "Tap + and choose Health reminder, then pick who it's for.",
          "Choose the Type: Medication, Appointment, Refill, or Generic.",
          "Enter a Title (and a Dose for medication, or a Location for an appointment).",
          "Under Schedule, pick One time, Daily, Weekly (then the Days) or Monthly (then the Day of month), and set the Time.",
          "Under Notify, tick who should be reminded, and set Snooze (minutes).",
          "Tap Create.",
        ],
      },
      {
        kind: "text",
        text:
          "To edit, pause or delete a reminder, tap that person at the top of Home and scroll down to Health reminders in their Tasks card. When a reminder is due it also appears on Home under \"Health reminders to acknowledge\" until someone marks it done or snoozes it.",
      },
    ],
    related: ["medication-reminders-not-arriving", "turning-on-push-notifications"],
    updatedAt: "2026-09-30",
  },
  {
    id: "medication-reminders-not-arriving",
    title: "Medication reminders aren't arriving",
    category: "notes-and-health",
    type: "troubleshooting",
    summary: "How to check that reminders are scheduled on your iPhone or iPad, and what to do if they aren't.",
    tags: [
      "medication reminder not working", "pill reminder didn't go off", "missed medication alert",
      "health reminder not arriving", "reminder didn't fire", "meds notification",
      "reminders app closed",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "On iPhone and iPad, health reminders are handed to iOS itself, so they arrive even with the app fully closed. Settings → Notifications shows whether that worked on this device:",
      },
      {
        kind: "faq",
        items: [
          {
            q: "\"Medication reminders: N scheduled on this device\"",
            a: "All good — iOS is holding them. If one still doesn't arrive, check iPhone Settings → Notifications → SuperHub and any Focus mode.",
          },
          {
            q: "\"N found, none schedulable\"",
            a: "Every reminder is paused, ended, or a one-time reminder set in the past. Resume or edit it.",
          },
          {
            q: "\"Medication reminders are not scheduled on this device\"",
            a: "Usually notifications aren't allowed for SuperHub in iPhone Settings. Turn them on, reopen this screen, and tap Re-check reminders.",
          },
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Each iPhone or iPad schedules the whole family's reminders once the app has been opened on it, so reminders can arrive on more than one device. Under the status line, \"Show what iOS is holding\" and \"Test in 60 seconds\" help check a stubborn device.",
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "In a web browser, reminders are sent as web pushes instead and are less dependable. For medication you rely on, use the iPhone/iPad app.",
      },
    ],
    related: ["health-reminders", "not-getting-notifications"],
    updatedAt: "2026-09-30",
  },
];
