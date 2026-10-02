import { Capacitor } from "@capacitor/core";

/**
 * App Store review prompt, fired after a genuine "aha" moment.
 *
 * Triggered from the "finished every chore for the day" celebration — the
 * emotional peak of the app, and the point at which someone is most likely to
 * feel it actually works.
 *
 * ── Things worth knowing before changing any of this ──────────────────────
 *
 * 1. **iOS decides whether the prompt actually appears, not us.** Apple
 *    rate-limits to roughly 3 displays per user per 365 days across the whole
 *    system. `requestReview()` is a *request*; it very often silently does
 *    nothing. That's why the gates below are deliberately strict — a wasted
 *    request is a wasted slot out of an already tiny budget.
 *
 * 2. **This cannot be tested in TestFlight.** Apple suppresses the prompt
 *    entirely in TestFlight builds. It appears in dev/simulator but never
 *    submits a rating. So the only place this is genuinely observable is a
 *    real App Store build — build conservatively and assume no feedback loop.
 *
 * 3. **Never call this from a button.** Apple's guidelines forbid triggering
 *    `requestReview()` in response to a tap. A deliberate "Rate this app"
 *    control has to deep-link to the App Store page instead — see
 *    `openStoreReviewPage()` below.
 *
 * 4. **Web is a no-op.** There's no equivalent, and the plugin is native-only.
 */

const DAYS_KEY = "familyHub_reviewPromptDays";
const ASKED_KEY = "familyHub_reviewPromptAskedAt";

/**
 * How many *distinct days* a family must have finished their chores before we
 * ask. A prompt on day one reaches someone who hasn't formed an opinion yet,
 * which is how you earn a mediocre rating from an otherwise happy user.
 */
const REQUIRED_GOOD_DAYS = 3;

/**
 * Don't ask again for a year even if the user dismissed without rating. iOS
 * enforces its own limit, but it does so silently — tracking our own means we
 * stop spending requests that would never have displayed anyway.
 */
const REASK_AFTER_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The App Store product id, needed only for the Settings deep link. Assigned
 * by App Store Connect (App Information → General Information → Apple ID) and
 * filled in 2026-09-10. It is stable for the life of the app — it does not
 * change when the app name, bundle id or version does.
 */
const APP_STORE_ID = "";

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function loadDays(): string[] {
  try {
    const raw = localStorage.getItem(DAYS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    // Matches the app's convention of never letting a malformed localStorage
    // value white-screen anything (see familyHub_hiddenTabs).
    return [];
  }
}

/**
 * Records that a "good day" happened. Call this on every all-done celebration,
 * including ones that don't lead to a prompt — it's what builds up the history
 * that eventually unlocks one.
 *
 * Returns the number of distinct good days recorded so far.
 */
export function recordGoodDay(date: Date = new Date()): number {
  const key = dateKey(date);
  const days = loadDays();
  if (!days.includes(key)) {
    days.push(key);
    // Cap the stored history — we only ever compare against REQUIRED_GOOD_DAYS,
    // so there's no reason to grow this unbounded for years.
    try {
      localStorage.setItem(DAYS_KEY, JSON.stringify(days.slice(-(REQUIRED_GOOD_DAYS * 2))));
    } catch {
      /* no-op */
    }
  }
  return days.length;
}

function alreadyAskedRecently(): boolean {
  try {
    const raw = localStorage.getItem(ASKED_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < REASK_AFTER_MS;
  } catch {
    return false;
  }
}

export interface ReviewPromptContext {
  /**
   * Whether the currently-active profile selection is a single kid's profile.
   * A kid checking off their own chores on the shared kitchen iPad is the most
   * likely person to be holding the device at this exact moment — and the least
   * able to write a review (it's the parent's Apple ID). Prompting them burns a
   * request and, worse, hands a rating decision to a child.
   */
  isKidContext: boolean;
}

/**
 * Asks iOS to show the review prompt, if every gate passes. Safe to call
 * unconditionally from a celebration path — it self-limits.
 *
 * Fire-and-forget: never throws, never blocks the celebration it rides on.
 */
export function maybeRequestReview(ctx: ReviewPromptContext, date: Date = new Date()): void {
  void (async () => {
    try {
      // Record the good day regardless of whether we end up asking — a kid
      // finishing their chores still counts as the app working well, it just
      // isn't the right moment to ask.
      const goodDays = recordGoodDay(date);

      if (!Capacitor.isNativePlatform()) return; // web: no equivalent API
      if (ctx.isKidContext) return;
      if (goodDays < REQUIRED_GOOD_DAYS) return;
      if (alreadyAskedRecently()) return;

      // Imported lazily so the plugin (and its native bridge) is only touched
      // on the rare occasion we actually intend to prompt — and so a missing
      // or not-yet-synced plugin can't break the celebration path for
      // everyone else.
      const { InAppReview } = await import("@capacitor-community/in-app-review");

      // Mark BEFORE requesting, not after. iOS gives no callback telling us
      // whether the prompt was actually displayed, so if we only recorded it
      // on success we'd have no way to avoid re-requesting on every future
      // all-done moment.
      try {
        localStorage.setItem(ASKED_KEY, String(Date.now()));
      } catch {
        /* no-op */
      }

      await InAppReview.requestReview();
    } catch {
      // A review prompt is the lowest-stakes thing in the app. It must never
      // surface an error or interfere with the celebration that triggered it.
    }
  })();
}

/**
 * Opens the App Store page with the review composer pre-opened. This is the
 * ONLY correct way to wire a deliberate "Rate this app" button — calling
 * `requestReview()` from a tap violates Apple's guidelines.
 *
 * Returns false if there's nothing to open yet (no APP_STORE_ID configured, or
 * running on web), so the caller can hide the control entirely.
 */
export function openStoreReviewPage(): boolean {
  if (!APP_STORE_ID) return false;
  try {
    window.open(
      `https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`,
      "_blank",
    );
    return true;
  } catch {
    return false;
  }
}

/** Whether a "Rate this app" control has somewhere to go yet. */
export function canOpenStoreReviewPage(): boolean {
  return !!APP_STORE_ID;
}
