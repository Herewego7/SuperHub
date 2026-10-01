/**
 * Idle screensaver for a wall-mounted / counter-top device (2026-09-16).
 *
 * TWO PROBLEMS, ONE ANSWER.
 *
 * 1. COST. While a tab is focused the app polls every 30-60s. An iPad left
 *    open on the kitchen counter therefore keeps the Replit server awake,
 *    and the database with it — which is the real driver of the "storage"
 *    bill (see CLAUDE.md's Autoscale block). A device that SLEEPS already
 *    stops polling on its own, because the WebView goes hidden and React
 *    Query pauses interval refetches; the problem is precisely the device
 *    configured never to sleep.
 *
 * 2. STALENESS. The obvious fix — poll less often — means the counter iPad
 *    displays out-of-date chores and events to anyone walking past, with no
 *    way to tell. That is worse than a slightly larger bill.
 *
 * The screensaver solves the second problem by making staleness impossible
 * to observe: once it is up, the old data is not on screen at all, and the
 * only route back to the app is an interaction that refreshes it first.
 * Polling can then stop completely rather than merely slow down.
 *
 * ⚠️ THE HANDSHAKE IS THE WHOLE POINT. Dismissing on TOUCH would reintroduce
 * the bug it exists to prevent: the app would render its cached data
 * immediately and the refetch would land seconds later (on Autoscale, after a
 * cold start), so the first thing the viewer sees is the stale screen —
 * looking authoritative, because they just woke it. So the screensaver holds
 * until the data has actually arrived, with a timeout so nobody is ever
 * trapped behind it on a bad connection.
 */

/** How long without interaction before the screensaver appears. */
export const SCREENSAVER_IDLE_MS = 10 * 60_000;
/** Longest the screensaver will hold while waiting for fresh data. */
export const SCREENSAVER_WAKE_TIMEOUT_MS = 4_000;
/** Slowest the idle check ever runs. Local only — never touches the network. */
export const SCREENSAVER_POLL_MAX_MS = 15_000;
export const SCREENSAVER_POLL_MIN_MS = 500;

/**
 * How often to compare the clock against the idle deadline.
 *
 * Derived from the idle period rather than fixed, so the screensaver can
 * never appear much later than asked: a flat 15s check against a 2s idle
 * period would fire at 15 seconds, and the first version of this shipped
 * exactly that way — the E2E test caught it because the overlay simply never
 * appeared. A quarter of the period keeps the overshoot proportional (10
 * minutes checks every 15s, which is the cap).
 */
export function screensaverPollMs(idleMs: number): number {
  return Math.max(SCREENSAVER_POLL_MIN_MS, Math.min(SCREENSAVER_POLL_MAX_MS, Math.floor(idleMs / 4)));
}

export const SCREENSAVER_ENABLED_KEY = "familyHub_screensaver";
/** Test/demo seam: an override in ms, so a test needn't wait ten minutes. */
export const SCREENSAVER_IDLE_OVERRIDE_KEY = "familyHub_screensaverIdleMs";

export function isScreensaverEnabled(): boolean {
  try {
    // Off unless deliberately turned on: this changes what an existing
    // family's dashboard does, and it only earns its keep on a device that
    // is set never to sleep.
    return localStorage.getItem(SCREENSAVER_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setScreensaverEnabled(on: boolean): void {
  try {
    localStorage.setItem(SCREENSAVER_ENABLED_KEY, on ? "true" : "false");
  } catch { /* private mode */ }
}

export function screensaverIdleMs(): number {
  try {
    const raw = Number(localStorage.getItem(SCREENSAVER_IDLE_OVERRIDE_KEY));
    if (Number.isFinite(raw) && raw >= 500) return raw;
  } catch { /* private mode */ }
  return SCREENSAVER_IDLE_MS;
}

/**
 * Whether the screensaver should be showing, from wall-clock elapsed time.
 *
 * ⚠️ Deliberately a function of TIMESTAMPS rather than a `setTimeout` that
 * fires after ten minutes. iOS suspends timers in a backgrounded WebView, so
 * a device that sleeps at minute 3 of idle and wakes at minute 40 would never
 * have fired that timeout — and would come back showing 37-minute-old chores,
 * which is the exact failure this feature exists to prevent. Comparing
 * timestamps on every wake makes sleeping devices correct for free.
 */
export function shouldShowScreensaver(
  lastInteractionAt: number,
  now: number,
  idleMs: number = SCREENSAVER_IDLE_MS,
): boolean {
  return now - lastInteractionAt >= idleMs;
}

/** The events that count as "someone is here". */
export const SCREENSAVER_ACTIVITY_EVENTS = [
  "pointerdown", "keydown", "wheel", "touchstart", "scroll",
] as const;

/**
 * ⚠️ ONE picture, held until the family changes it — deliberately NOT a
 * rotation (2026-09-16). An earlier version cycled through the built-in
 * library, and the objection to it is the right one: a picture someone chose
 * is a picture they like, and rotating others past it means the wall
 * sometimes shows one they don't. The screensaver therefore shows exactly
 * what the privacy screen shows, and changes only when they change it.
 *
 * This also removed the machinery that a rotation needed — a shuffle, a
 * per-day seed to keep the browser cache useful, a cap on how many remote
 * images an idle screen could pull down. None of it has to exist for a
 * single image, which is worth noticing: the simpler product asked less of
 * the code.
 */
