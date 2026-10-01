// Per-browser (localStorage) toggle for the in-app "event starting soon"
// pop-up — this is a client-side reminder, not a push notification, so it
// doesn't need server/device storage (see push.ts / notificationsPrefs for that).
const ENABLED_KEY = "familyHub_eventRemindersEnabled";

export function getEventRemindersEnabled(): boolean {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    if (raw !== null) return raw !== "false";
  } catch {}
  return true;
}

export function saveEventRemindersEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, String(enabled));
  } catch {}
}
