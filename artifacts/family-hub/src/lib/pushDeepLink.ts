// Tapping a push notification should open the exact thing it was about, not
// just launch the app to whatever screen it happened to be on. Two delivery
// paths feed this:
//   - Web: the service worker (public/sw.js) already navigates to the
//     notification's `data.url` on click, landing on `/?openCelebration=<id>`.
//   - Native (iOS): there is no URL navigation at all — Capacitor's push
//     plugin instead fires a `pushNotificationActionPerformed` event with the
//     original payload's `data` object, which nativeNotifications.ts listens
//     for and forwards here.
// Either path ends up calling `setPendingCelebrationDeepLink`, and
// `consumePendingCelebrationDeepLink` (read once, on mount, and again on the
// custom event below) is what the app actually acts on.

const EVENT_NAME = "familyhub:celebration-deep-link";

// ⚠️ THESE ARE GENUINELY PENDING NOW.
//
// Both setters used to only dispatch a CustomEvent, despite the name. On a
// COLD LAUNCH from a tapped notification that is far too early: iOS delivers
// `pushNotificationActionPerformed` as the app starts, while React is still
// booting and waiting on auth, so the event fired into a window with no
// listener and was lost for good. The app then opened on its default tab —
// Home — which looks exactly like the deep link "working" but doing nothing,
// and is why three separate rounds of fixing the SPOTLIGHT changed nothing:
// its trigger was never set (2026-09-14).
//
// A link that arrives before anyone is listening is held, and handed over the
// moment a subscriber appears.
// ALWAYS dispatch AND buffer. Making the dispatch conditional on a local
// listener count was tried first and is too fragile: anything holding a second
// copy of this module (a dynamic import, a differently-resolved specifier)
// counts its own listeners and would stop broadcasting to the real one. The
// event is the live path; the buffer is only a fallback for a link that
// arrived with nobody home, and the listener clears it so a link handled live
// can never be replayed to the next subscriber.
let pendingCelebration: string | null = null;
let pendingTab: TabDeepLink | null = null;

export function setPendingCelebrationDeepLink(celebrationId: string): void {
  pendingCelebration = celebrationId;
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: celebrationId }));
  } catch {
    // CustomEvent is unavailable in non-browser contexts only — the buffer
    // above still holds it.
  }
}

/** Reads (and clears) a celebration id delivered via the current page URL —
 * the web push click-through path (`/?openCelebration=<id>`). */
export function consumeCelebrationDeepLinkFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("openCelebration");
  if (!id) return null;
  params.delete("openCelebration");
  const next = params.toString();
  const newUrl = window.location.pathname + (next ? `?${next}` : "") + window.location.hash;
  window.history.replaceState({}, "", newUrl);
  return id;
}

/** Subscribes to celebration deep links delivered while the app is already
 * running (native foreground tap, or a same-session web SW postMessage in
 * the future) — returns an unsubscribe function. */
export function onCelebrationDeepLink(handler: (celebrationId: string) => void): () => void {
  const listener = (e: Event) => {
    pendingCelebration = null; // handled live; nothing left to replay
    handler((e as CustomEvent<string>).detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  // Anything that arrived before this subscriber existed. Delivered async so
  // the component finishes mounting first — handing it a link inside its own
  // subscribe call would run the handler mid-render.
  if (pendingCelebration !== null) {
    const id = pendingCelebration;
    pendingCelebration = null;
    setTimeout(() => handler(id), 0);
  }
  return () => window.removeEventListener(EVENT_NAME, listener);
}

// Same pattern as the celebration deep link above, generalized to "which tab
// (and, optionally, which chores sub-tab / follow-up action) should this
// notification tap land on" — the bedtime reminder was the first user of
// this (→ "chores", no sub-tab/action), and several cash-out/chore/reward
// pushes reuse the richer subTab+action form so they land on the exact
// card, not just the right tab.
const TAB_EVENT_NAME = "familyhub:tab-deep-link";

export type TabDeepLink = {
  tab: string;
  /** e.g. "rewards" — passed straight to family-hub.tsx's navigateTo(). */
  subTab?: string;
  /** A follow-up action to run once the tab/sub-tab has landed —
   * "parentControls" opens the Cash-Out Approvals PIN dialog (same as the
   * Announcements deep link); "cashoutStars" spotlights the Cash Out Stars
   * card (same as Home's own Cash Out button); "healthReminders" spotlights
   * the "Health reminders to acknowledge" card on Home; "praiseSection"/
   * "notesSection" spotlight the matching Announcements banner section. */
  action?: "parentControls" | "cashoutStars" | "healthReminders" | "praiseSection" | "notesSection";
  /** Whose reminder/card this is about. Home's health-reminder card only
   *  renders reminders for the CURRENTLY SELECTED profiles, so a push about
   *  one person while someone else is selected produced a Home screen with no
   *  card to scroll to or spotlight at all (2026-09-14). The handler selects
   *  this profile first so the card is guaranteed to be there. */
  profileId?: string;
  /** Evening-plan push body. Staged into the chat thread before Chat mounts. */
  plan?: string;
  /** Text the person sent back on that notification. Lands under the plan. */
  reply?: string;
};

export function setPendingTabDeepLink(link: TabDeepLink): void {
  pendingTab = link;
  try {
    window.dispatchEvent(new CustomEvent(TAB_EVENT_NAME, { detail: link }));
  } catch {
    // See the note above — the buffer still holds it.
  }
}

/** Reads (and clears) a tab deep link delivered via the current page URL —
 * the web push click-through path (`/?openTab=<tab>&openSubTab=<sub>&openAction=<action>`). */
export function consumeTabDeepLinkFromUrl(): TabDeepLink | null {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("openTab");
  if (!tab) return null;
  const subTab = params.get("openSubTab") ?? undefined;
  const action = (params.get("openAction") as TabDeepLink["action"] | null) ?? undefined;
  const profileId = params.get("openProfile") ?? undefined;
  const plan = params.get("openPlan") ?? undefined;
  const reply = params.get("openReply") ?? undefined;
  params.delete("openTab");
  params.delete("openSubTab");
  params.delete("openAction");
  params.delete("openProfile");
  params.delete("openPlan");
  params.delete("openReply");
  const next = params.toString();
  const newUrl = window.location.pathname + (next ? `?${next}` : "") + window.location.hash;
  window.history.replaceState({}, "", newUrl);
  return { tab, subTab, action, profileId, plan, reply };
}

export function onTabDeepLink(handler: (link: TabDeepLink) => void): () => void {
  const listener = (e: Event) => {
    pendingTab = null; // handled live; nothing left to replay
    handler((e as CustomEvent<TabDeepLink>).detail);
  };
  window.addEventListener(TAB_EVENT_NAME, listener);
  if (pendingTab !== null) {
    const link = pendingTab;
    pendingTab = null;
    setTimeout(() => handler(link), 0);
  }
  return () => window.removeEventListener(TAB_EVENT_NAME, listener);
}
